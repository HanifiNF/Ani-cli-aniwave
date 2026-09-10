import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const events = new Set([
  "diagnostics-enabled", "diagnostics-disabled", "session-start", "video-render-policy", "renderer-ready", "keyboard", "command",
  "load-start", "loaded-metadata", "can-play", "play", "playing", "pause", "waiting", "stalled",
  "seeking", "seeked", "ended", "error", "volume-change", "rate-change", "text-track-change", "quality-change",
  "media-seek-request", "media-seeking-request", "media-enter-fullscreen-request", "media-exit-fullscreen-request",
  "fullscreen-request", "fullscreen-result", "fullscreen-error", "enter-full-screen", "leave-full-screen",
  "picture-in-picture-change", "resize", "focus", "blur", "closed", "renderer-gone", "unresponsive", "responsive"
]);
const numbers = new Set(["inputTime", "time", "duration", "volume", "rate", "width", "height", "videoWidth", "videoHeight", "seekTime", "bufferedEnd", "errorCode", "exitCode", "dropped"]);
const booleans = new Set(["shift", "ctrl", "alt", "meta", "repeat", "prevented", "trusted", "paused", "muted", "fullscreen", "enabled"]);
const tokens = new Set(["key", "code", "target", "phase", "command", "reason", "platform", "arch", "electron", "chromium", "version"]);

// Accept a small, flat schema. Arbitrary messages, URLs, titles, and nested error objects never reach disk.
export function sanitizeDiagnostic(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const input = value as Record<string, unknown>;
  if (typeof input.event !== "string" || !events.has(input.event)) return;
  const result: Record<string, string | number | boolean> = { event: input.event };
  for (const key of numbers) if (typeof input[key] === "number" && Number.isFinite(input[key])) result[key] = input[key];
  for (const key of booleans) if (typeof input[key] === "boolean") result[key] = input[key];
  for (const key of tokens) {
    const item = input[key];
    if (typeof item === "string" && /^[a-zA-Z0-9_.+?<>-]{1,64}$/.test(item)) result[key] = item;
  }
  return result;
}

const RETENTION_MS = 5 * 60 * 1000;

export class PlayerDiagnostics {
  readonly filePath: string;
  private queue = Promise.resolve();
  private pending = 0;
  private dropped = 0;
  private enabled = false;
  private warned = false;
  private closed = false;
  private loaded = false;
  private dirty = false;
  private legacyBackup = false;
  private entries: { timestamp: number; line: string }[] = [];
  private readonly maintenance: ReturnType<typeof setInterval>;

  constructor(readonly directory: string) {
    this.filePath = join(directory, "media-player.jsonl");
    // Prune on startup even when diagnostics are disabled. Quiet sessions also expire.
    void this.flush();
    this.maintenance = setInterval(() => { void this.flush(); }, 1000);
    this.maintenance.unref();
  }

  setEnabled(enabled: boolean): void {
    if (this.closed || enabled === this.enabled) return;
    if (!enabled) this.record("", { event: "diagnostics-disabled" });
    this.enabled = enabled;
    if (enabled) this.record("", { event: "diagnostics-enabled", platform: process.platform, arch: process.arch,
      electron: process.versions.electron, chromium: process.versions.chrome });
  }

  record(sessionId: string, value: unknown): void {
    if (this.closed || !this.enabled) return;
    const data = sanitizeDiagnostic(value);
    if (!data) return;
    if (this.pending >= 500) { this.dropped++; return; }
    const timestamp = Date.now();
    const line = JSON.stringify({ timestamp: new Date(timestamp).toISOString(), sessionId: sessionId.slice(0,100), ...data,
      ...(this.dropped ? { dropped: this.dropped } : {}) }) + "\n";
    this.dropped = 0;
    void this.enqueue(async () => {
      await this.load();
      this.entries.push({ timestamp, line });
      this.dirty = true;
    });
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    this.pending++;
    this.queue = this.queue.then(operation).catch(() => {
      if (!this.warned) console.warn("Media player diagnostics could not be written.");
      this.warned = true;
    }).finally(() => { this.pending--; });
    return this.queue;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const read = (file: string) => readFile(file, "utf8").catch(error => {
      if (error.code === "ENOENT") return undefined;
      throw error;
    });
    const [backup, current] = await Promise.all([read(`${this.filePath}.1`), read(this.filePath)]);
    const entries: typeof this.entries = [];
    let malformed = false;
    for (const content of [backup, current]) {
      for (const line of content?.split("\n") ?? []) {
        if (!line.trim()) continue;
        try {
          const row = JSON.parse(line);
          const timestamp = typeof row?.timestamp === "string" ? Date.parse(row.timestamp) : NaN;
          if (!Number.isFinite(timestamp)) { malformed = true; continue; }
          entries.push({ timestamp, line: line + "\n" });
        } catch { malformed = true; }
      }
    }
    this.entries = entries.sort((a, b) => a.timestamp - b.timestamp);
    this.legacyBackup = backup !== undefined;
    this.dirty = this.legacyBackup || malformed;
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await this.load();
    const now = Date.now();
    const kept = this.entries.filter(entry => entry.timestamp > now - RETENTION_MS && entry.timestamp <= now);
    if (kept.length !== this.entries.length) this.dirty = true;
    this.entries = kept;
    if (!this.dirty && !this.legacyBackup) return;
    await mkdir(this.directory, { recursive: true });
    // Batch updates once per second and replace atomically so readers always see complete JSON lines.
    await writeFile(`${this.filePath}.tmp`, this.entries.map(entry => entry.line).join(""), { mode: 0o600 });
    await rename(`${this.filePath}.tmp`, this.filePath);
    this.dirty = false;
    if (this.legacyBackup) {
      await rm(`${this.filePath}.1`, { force: true });
      this.legacyBackup = false;
    }
    this.warned = false;
  }

  flush(): Promise<void> { return this.enqueue(() => this.persist()); }

  close(): Promise<void> {
    this.closed = true;
    clearInterval(this.maintenance);
    return this.flush();
  }
}
