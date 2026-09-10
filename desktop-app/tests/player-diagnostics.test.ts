import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerDiagnostics, sanitizeDiagnostic } from "../electron/player-diagnostics";

let directory: string;
let loggers: PlayerDiagnostics[];
const loggerIn = (path = directory) => {
  const logger = new PlayerDiagnostics(path);
  loggers.push(logger);
  return logger;
};
beforeEach(async () => { loggers = []; directory = await mkdtemp(join(tmpdir(), "ani-diagnostics-")); });
afterEach(async () => {
  for (const logger of loggers) await logger.close();
  vi.useRealTimers(); vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

describe("player diagnostic files", () => {
  it("writes only when enabled and preserves event order and session identifiers", async () => {
    const logger = loggerIn();
    logger.record("session-1", { event: "keyboard", key: "k" });
    await logger.flush();
    expect(await readdir(directory)).toEqual([]);
    logger.setEnabled(true);
    logger.record("session-1", { event: "video-render-policy", platform: "win32", enabled: true, reason: "direct-composition-disabled",
      url: "https://stream.test/?token=secret", title: "private title" });
    logger.record("session-1", { event: "keyboard", key: "ArrowRight", shift: true });
    logger.record("session-1", { event: "seeked", time: 25 });
    logger.setEnabled(false);
    logger.record("session-1", { event: "keyboard", key: "m" });
    await logger.flush();
    const rows = (await readFile(logger.filePath, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(rows.map(row => row.event)).toEqual(["diagnostics-enabled", "video-render-policy", "keyboard", "seeked", "diagnostics-disabled"]);
    expect(rows[1]).toMatchObject({ sessionId: "session-1", platform: "win32", enabled: true, reason: "direct-composition-disabled" });
    expect(rows[1]).not.toHaveProperty("url");
    expect(rows[1]).not.toHaveProperty("title");
    expect(rows[2]).toMatchObject({ sessionId: "session-1", key: "ArrowRight", shift: true });
    expect(rows[3]).toMatchObject({ sessionId: "session-1", time: 25 });
    expect(Number.isFinite(Date.parse(rows[1].timestamp))).toBe(true);
  });

  it("expires records at five minutes while keeping newer events", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-09-10T00:00:00Z").getTime();
    vi.setSystemTime(start);
    const logger = loggerIn();
    logger.setEnabled(true);
    logger.record("old", { event: "pause" });
    await logger.flush();
    vi.setSystemTime(start + 60_000);
    logger.record("recent", { event: "playing" });
    await logger.flush();
    vi.setSystemTime(start + 299_999);
    await logger.flush();
    expect(await readFile(logger.filePath, "utf8")).toContain('"sessionId":"old"');
    vi.setSystemTime(start + 300_000);
    await logger.flush();
    const rows = (await readFile(logger.filePath, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: "recent", event: "playing" });
    expect(await readdir(directory)).toEqual(["media-player.jsonl"]);
  });

  it("expires quiet logs automatically even after diagnostics are disabled", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-09-10T00:00:00Z"));
    const logger = loggerIn();
    logger.setEnabled(true);
    logger.record("session", { event: "pause" });
    logger.setEnabled(false);
    await logger.flush();
    expect(await readFile(logger.filePath, "utf8")).toContain('"event":"pause"');
    vi.setSystemTime(new Date("2026-09-10T00:05:00Z"));
    await vi.advanceTimersByTimeAsync(1000);
    // No flush or new record: only the maintenance timer can prune this file.
    await expect.poll(() => readFile(logger.filePath, "utf8")).toBe("");
  });

  it("prunes stale startup logs and migrates the recent part of the old backup", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-10T00:10:00Z"));
    const row = (timestamp: string, sessionId: string) => JSON.stringify({ timestamp, sessionId, event: "pause" }) + "\n";
    await writeFile(join(directory, "media-player.jsonl.1"), row("2026-09-10T00:04:00Z", "expired-backup") + row("2026-09-10T00:06:00Z", "recent-backup"));
    await writeFile(join(directory, "media-player.jsonl"), row("2026-09-10T00:05:00Z", "expired-current") + row("2026-09-10T00:09:00Z", "recent-current") + 'broken-json\n');
    const logger = loggerIn();
    await logger.flush(); // Startup cleanup works with recording disabled.
    const rows = (await readFile(logger.filePath, "utf8")).trim().split("\n").map(line => JSON.parse(line));
    expect(rows.map(row => row.sessionId)).toEqual(["recent-backup", "recent-current"]);
    expect(await readdir(directory)).toEqual(["media-player.jsonl"]);
    await logger.close();
    vi.setSystemTime(new Date("2026-09-10T01:00:00Z"));
    const restarted = loggerIn();
    await restarted.flush();
    expect(await readFile(restarted.filePath, "utf8")).toBe("");
  });

  it("retains over 1 MiB of recent events without size rotation", async () => {
    const logger = loggerIn();
    logger.setEnabled(true);
    for (let batch = 0; batch < 40; batch++) {
      for (let time = 0; time < 200; time++) logger.record("session-" + "a".repeat(90), { event: "seeked", time });
      await logger.flush();
    }
    const content = await readFile(logger.filePath, "utf8");
    expect(Buffer.byteLength(content)).toBeGreaterThan(1_048_576);
    expect(content.trim().split("\n")).toHaveLength(8001);
    expect(await readdir(directory)).toEqual(["media-player.jsonl"]);
  });

  it("drops URLs, free text, nested payloads, unknown events and nonfinite values", () => {
    expect(sanitizeDiagnostic({ event: "keyboard", key: "ArrowLeft", code: "ArrowLeft", shift: true,
      url: "https://stream.test/?token=secret", message: "password", target: "https://secret", time: Infinity,
      error: { token: "secret" } })).toEqual({ event: "keyboard", shift: true, key: "ArrowLeft", code: "ArrowLeft" });
    expect(sanitizeDiagnostic({ event: "video-render-policy", platform: "win32", enabled: true, reason: "direct-composition-disabled",
      url: "https://stream.test/?token=secret", title: "private title" })).toEqual({
      event: "video-render-policy", enabled: true, reason: "direct-composition-disabled", platform: "win32"
    });
    expect(sanitizeDiagnostic({ event: "private-data", key: "k" })).toBeUndefined();
    expect(sanitizeDiagnostic(null)).toBeUndefined();
  });

  it("recovers from write failures without rejecting or flooding the console", async () => {
    const blocked = join(directory, "blocked");
    await writeFile(blocked, "file instead of folder");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logger = loggerIn(blocked);
    logger.setEnabled(true);
    logger.record("session", { event: "pause" });
    await expect(logger.flush()).resolves.toBeUndefined();
    expect(warning).toHaveBeenCalledTimes(1);
    await rm(blocked);
    logger.record("session", { event: "playing" });
    await logger.flush();
    expect(await readFile(logger.filePath, "utf8")).toContain('"event":"playing"');
  });
});
