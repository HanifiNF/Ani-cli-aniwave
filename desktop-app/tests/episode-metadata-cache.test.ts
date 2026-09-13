import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EpisodeMetadataCache } from "../electron/episode-metadata-cache";
import { availabilityFresh, qualityFresh, METADATA_LIMIT, METADATA_RETENTION } from "../shared/episode-metadata";

let directory: string, file: string, now: number, cache: EpisodeMetadataCache;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "ani-metadata-")); file = join(directory, "episode-metadata.json");
  now = Date.now(); cache = new EpisodeMetadataCache(file, () => now);
});
afterEach(async () => { await cache.flush(); await rm(directory, { recursive: true, force: true }); });
const streams = [{ quality: "720p", url: "https://private.test/signed?token=secret" }, { quality: "1080p", url: "https://private.test/full" }];

describe("persistent episode metadata", () => {
  it("restores audio and separate mode qualities across restarts, without playback URLs", async () => {
    cache.recordAvailability("source-a", "episode-1", { sub: true, dub: true, checkedAt: now });
    cache.recordStreams("source-a", "episode-1", "sub", streams);
    cache.recordStreams("source-a", "episode-1", "dub", [{ quality: "480p" }]);
    await cache.flush();
    const restarted = new EpisodeMetadataCache(file, () => now); await restarted.load();
    expect(restarted.get("source-a", "episode-1")).toEqual({ availability: { sub: true, dub: true, checkedAt: now }, qualities: { sub: { quality: "1080p", checkedAt: now }, dub: { quality: "480p", checkedAt: now } } });
    expect(restarted.get("source-b", "episode-1")).toBeUndefined();
    expect(await readFile(file, "utf8")).not.toMatch(/https|secret|token|url/);
  });
  it("expires negative results earlier and keeps stale metadata for a limited refresh fallback", async () => {
    const audio = { sub: true, dub: false, checkedAt: now }, quality = { quality: "1080p", checkedAt: now };
    cache.recordAvailability("a", "e", audio); cache.recordStreams("a", "e", "sub", streams);
    now += 16 * 60 * 1000;
    expect(availabilityFresh(audio, now)).toBe(false); expect(qualityFresh(quality, now)).toBe(true);
    expect(qualityFresh({ checkedAt: audio.checkedAt }, now)).toBe(false);
    now += 24 * 60 * 60 * 1000;
    expect(qualityFresh(quality, now)).toBe(false); expect(cache.get("a", "e")?.qualities.sub?.quality).toBe("1080p");
    now += METADATA_RETENTION;
    expect(cache.get("a", "e")).toBeUndefined();
  });
  it("persists explicit invalidation and removes qualities for audio that becomes unavailable", async () => {
    cache.recordStreams("a", "e", "dub", streams);
    cache.recordAvailability("a", "e", { sub: true, dub: false, checkedAt: now });
    expect(cache.get("a", "e")?.qualities.dub).toBeUndefined();
    const generation = cache.generation;
    await cache.clear("a", ["e"]); expect(cache.generation).toBeGreaterThan(generation);
    const restarted = new EpisodeMetadataCache(file, () => now); await restarted.load();
    expect(restarted.get("a", "e")).toBeUndefined();
  });
  it("bounds the cache and tolerates missing, damaged, or invalid files", async () => {
    await cache.load();
    await writeFile(file, "{broken"); await cache.load();
    await writeFile(file, JSON.stringify({ version: 1, entries: [["invalid", null], [JSON.stringify(["a", "future"]), { availability: { sub: true, dub: true, checkedAt: now + 1 } }]] }));
    await cache.load(); expect(cache.get("a", "future")).toBeUndefined();
    for (let i = 0; i <= METADATA_LIMIT; i++) cache.recordStreams("a", String(i), "sub", streams);
    expect(cache.get("a", "0")).toBeUndefined(); expect(cache.get("a", String(METADATA_LIMIT))).toBeDefined();
    await cache.flush(); expect(JSON.parse(await readFile(file, "utf8")).entries).toHaveLength(METADATA_LIMIT);
  });
});
