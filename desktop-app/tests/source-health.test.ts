import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SourceHealth } from "../electron/source-health";

let directory: string, path: string, health: SourceHealth;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ani-source-health-")); path = join(directory, "source-health.json");
  health = new SourceHealth(); await health.load(path);
});
afterEach(async () => { await health.flush(); vi.useRealTimers(); await rm(directory, { recursive: true, force: true }); });

it("persists a pause and its backoff across restarts, and forgets successful recovery", async () => {
  health.failure(health.acquire("https://source.test", false));
  await health.flush();
  const next = new SourceHealth(); await next.load(path);
  expect(() => next.acquire("https://source.test", false)).toThrow("paused");
  next.failure(next.acquire("https://source.test", true));
  expect(next.blocked("https://source.test", false)?.retryAt).toBeGreaterThanOrEqual(Date.now() + 119_900);
  next.success(next.acquire("https://source.test", true)); await next.flush();
  const recovered = new SourceHealth(); await recovered.load(path);
  expect(recovered.acquire("https://source.test", false).probe).toBe(false);
  expect(JSON.parse(await readFile(path, "utf8")).hosts).toEqual([]);
});

it("honors Retry-After even for manual checks and preserves it across restarts", async () => {
  vi.useFakeTimers();
  health.failure(health.acquire("source", false), 600_000);
  expect(() => health.acquire("source", true)).toThrow("Source asked us to wait");
  await health.flush();
  const next = new SourceHealth(); await next.load(path);
  await vi.advanceTimersByTimeAsync(599_999);
  expect(() => next.acquire("source", true)).toThrow("wait");
  await vi.advanceTimersByTimeAsync(1);
  expect(next.acquire("source", false).probe).toBe(true);
});

it("expires old outage records and rebuilds a damaged cache", async () => {
  vi.useFakeTimers(); health.failure(health.acquire("old", false)); await health.flush();
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
  const next = new SourceHealth(); await next.load(path);
  expect(next.acquire("old", false).probe).toBe(false);
  await writeFile(path, "{damaged"); await new SourceHealth().load(path);
  await writeFile(path, JSON.stringify({ version: 1, hosts: [["invalid", { failures: 2, until: "forever" }], null] }));
  const invalid = new SourceHealth(); await invalid.load(path);
  expect(invalid.acquire("invalid", false).probe).toBe(false);
});

it("preserves a concurrent Retry-After received while a recovery probe is running", () => {
  const first = health.acquire("source", false), second = health.acquire("source", false);
  health.failure(first);
  const probe = health.acquire("source", true);
  health.failure(second, 300_000);
  health.success(probe);
  expect(() => health.acquire("source", true)).toThrow("Source asked us to wait");
});

it("bounds saved host state and excludes in-flight probe flags and response data", async () => {
  for (let i = 0; i < 110; i++) health.failure(health.acquire(`host-${i}`, false));
  health.acquire("host-109", true); await health.flush();
  const serialized = await readFile(path, "utf8");
  expect(JSON.parse(serialized).hosts).toHaveLength(100);
  expect(serialized).not.toMatch(/probing|generation|body|token/);
});

it("reports unknown, reachable, paused, and checking states from real request outcomes", () => {
  expect(health.snapshot("source")).toEqual({ state: "unknown", canRetry: true });
  const initial = health.acquire("source", false);
  expect(health.snapshot("source").state).toBe("unknown");
  health.success(initial);
  expect(health.snapshot("source")).toMatchObject({ state: "reachable", checkedAt: expect.any(Number) });
  health.failure(health.acquire("source", false));
  expect(health.snapshot("source")).toMatchObject({ state: "paused", canRetry: true });
  const probe = health.acquire("source", true);
  expect(health.snapshot("source")).toMatchObject({ state: "checking", canRetry: false });
  health.failure(probe, 60_000);
  expect(health.snapshot("source")).toMatchObject({ state: "paused", canRetry: false, serverRequested: true });
});
