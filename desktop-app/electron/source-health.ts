import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { SourceHealthStatus } from "../shared/contracts";

const DELAYS = [30_000, 120_000, 300_000, 900_000];
const RETENTION = 24 * 60 * 60 * 1000;
interface Health {
  failures: number;
  until: number;
  serverUntil: number;
  updatedAt: number;
  generation: number;
  probing: boolean;
  checkedAt?: number;
}
export interface HealthPermit { host: string; state: Health; generation: number; probe: boolean; }
export class SourcePausedError extends Error {
  constructor(readonly retryAt: number, probing = false, serverRequested = false) {
    const seconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
    super(probing ? "Checking source recovery; other requests are paused."
      : `${serverRequested ? "Source asked us to wait" : "Source temporarily paused"}. Next check in ${seconds < 60 ? `${seconds}s` : `${Math.ceil(seconds / 60)}m`}.${serverRequested ? "" : " Retry checks again."}`);
    this.name = "SourcePausedError";
  }
}

/** Shared by actual service origin, with one recovery request and bounded, disposable persistence. */
export class SourceHealth {
  private states = new Map<string, Health>();
  private path?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private writes = Promise.resolve();
  private dirty = false;

  snapshot(host: string): SourceHealthStatus {
    const state = this.states.get(host), now = Date.now();
    if (!state || (!state.probing && state.until <= now && now - (state.failures ? state.updatedAt : state.checkedAt ?? state.updatedAt) >= RETENTION)) return { state: "unknown", canRetry: true };
    if (state.failures) return { state: state.probing ? "checking" : "paused", checkedAt: state.updatedAt,
      retryAt: state.until, canRetry: !state.probing && state.serverUntil <= now, serverRequested: state.serverUntil > now };
    return { state: state.checkedAt === undefined ? "unknown" : "reachable", checkedAt: state.checkedAt, canRetry: true };
  }

  blocked(host: string, checkNow: boolean): SourcePausedError | undefined {
    const state = this.states.get(host), now = Date.now();
    if (state?.failures && (state.probing || state.serverUntil > now || (!checkNow && state.until > now))) {
      return new SourcePausedError(state.until, state.probing, state.serverUntil > now);
    }
  }

  acquire(host: string, checkNow: boolean): HealthPermit {
    const now = Date.now();
    let state = this.states.get(host);
    if (state && !state.probing && state.until <= now && now - (state.failures ? state.updatedAt : state.checkedAt ?? state.updatedAt) >= RETENTION) {
      this.states.delete(host); state = undefined;
    }
    if (!state) {
      state = { failures: 0, until: 0, serverUntil: 0, updatedAt: now, generation: 0, probing: false };
      this.states.set(host, state);
      if (this.states.size > 100) {
        const oldest = [...this.states].find(([key, value]) => key !== host && !value.probing);
        if (oldest) this.states.delete(oldest[0]);
      }
    }
    if (state.failures) {
      const blocked = this.blocked(host, checkNow);
      if (blocked) throw blocked;
      state.probing = true;
    }
    return { host, state, generation: state.generation, probe: state.probing };
  }

  success(permit: HealthPermit): void {
    if (!this.current(permit)) return;
    permit.state.checkedAt = Date.now();
    if (!permit.probe) return;
    Object.assign(permit.state, { failures: 0, until: 0, serverUntil: 0, probing: false, generation: permit.generation + 1 });
    this.changed();
  }

  failure(permit: HealthPermit, retryAfterMs = 0): void {
    const now = Date.now(), serverUntil = retryAfterMs > 0 ? now + retryAfterMs : 0;
    if (!this.current(permit)) {
      // An older concurrent failure cannot advance the backoff, but its Retry-After still applies.
      if (this.states.get(permit.host) === permit.state && permit.state.failures && serverUntil > permit.state.serverUntil) {
        permit.state.serverUntil = serverUntil; permit.state.until = Math.max(permit.state.until, serverUntil);
        permit.state.generation++; permit.state.probing = false; this.changed();
      }
      return;
    }
    const failures = Math.min(permit.state.failures + 1, DELAYS.length);
    Object.assign(permit.state, { failures, until: Math.max(now + DELAYS[failures - 1], serverUntil), serverUntil,
      updatedAt: now, probing: false, generation: permit.generation + 1 });
    this.changed();
  }

  cancel(permit: HealthPermit): void {
    if (this.current(permit) && permit.probe) permit.state.probing = false;
  }

  private current(permit: HealthPermit): boolean {
    return this.states.get(permit.host) === permit.state && permit.state.generation === permit.generation;
  }

  async load(path: string): Promise<void> {
    this.path = path;
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")), now = Date.now();
      if (parsed.version !== 1 || !Array.isArray(parsed.hosts)) return;
      for (const row of parsed.hosts.slice(-100)) {
        if (!Array.isArray(row) || typeof row[0] !== "string" || row[0].length > 2048) continue;
        const value = row[1];
        if (!value || !Number.isInteger(value.failures) || value.failures < 1 || value.failures > DELAYS.length
          || ![value.until, value.serverUntil, value.updatedAt].every((at) => typeof at === "number" && Number.isFinite(at) && at >= 0)
          || value.updatedAt > now || (value.until <= now && now - value.updatedAt >= RETENTION)) continue;
        this.states.set(row[0], { failures: value.failures, until: value.until, serverUntil: value.serverUntil,
          updatedAt: value.updatedAt, generation: 0, probing: false });
      }
    } catch {
      // Source health can be learned again if the file is absent or damaged.
    }
  }

  private changed(): void {
    this.dirty = true;
    if (this.path && !this.timer) this.timer = setTimeout(() => { void this.flush(); }, 250);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.path && this.dirty) {
      this.dirty = false;
      const now = Date.now(), path = this.path;
      const hosts = [...this.states].filter(([, value]) => value.failures && (value.until > now || now - value.updatedAt < RETENTION))
        .map(([host, { failures, until, serverUntil, updatedAt }]) => [host, { failures, until, serverUntil, updatedAt }]);
      const serialized = JSON.stringify({ version: 1, hosts });
      this.writes = this.writes.then(async () => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(`${path}.new`, serialized, "utf8");
        await rename(`${path}.new`, path);
      }).catch(() => { this.dirty = true; });
    }
    await this.writes;
  }
}
