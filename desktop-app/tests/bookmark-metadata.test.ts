import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BookmarkMetadataFetcher } from "../electron/bookmark-metadata";
import { EpisodeMetadataCache } from "../electron/episode-metadata-cache";
import { CatalogService } from "../electron/catalog-service";
import { catalogScope } from "../shared/settings";
import { catalogContext, catalogRequests } from "../electron/catalog-requests";
import { StateStore } from "../electron/state";
import { getAvailability, getProviderEpisodes, getStreams, resolveSource } from "../electron/scraper";
import type { BookmarkMetadataProgress, PersistedState } from "../shared/contracts";

vi.mock("../electron/scraper", () => ({ getAvailability: vi.fn(), getStreams: vi.fn(), getProviderEpisodes: vi.fn(), resolveSource: vi.fn(),
  providerOrigin: (provider: string) => `https://${provider}.bulk.test` }));
let directory: string, cache: EpisodeMetadataCache, fetcher: BookmarkMetadataFetcher, state: PersistedState;
const episode = { id: "aniwave:show:1", number: "1", provider: "aniwave" as const };
const audio = () => ({ sub: true, dub: true, checkedAt: Date.now() });
const run = (signal = new AbortController().signal, update: (value: BookmarkMetadataProgress) => void = () => {}) => fetcher.run(state, signal, update);
beforeEach(async () => {
  vi.resetAllMocks();
  directory = await mkdtemp(join(tmpdir(), "bookmark-metadata-"));
  cache = new EpisodeMetadataCache(join(directory, "metadata.json"));
  fetcher = new BookmarkMetadataFetcher(new CatalogService(), cache);
  state = new StateStore("unused").snapshot();
  state.settings.disabledSources = ["anidb", "hianime"];
  state.bookmarks = [{ animeId: "aniwave:show", title: "Show", lastEpisode: "1", mode: "sub", updatedAt: new Date().toISOString() }];
  vi.mocked(getProviderEpisodes).mockResolvedValue([episode]);
  vi.mocked(getAvailability).mockResolvedValue(audio());
  vi.mocked(getStreams).mockResolvedValue([{ quality: "1080p", url: "https://secret.example/video.m3u8", provider: "aniwave" }]);
});
afterEach(async () => { await cache.flush(); await rm(directory, { recursive: true, force: true }); });

it("persists both audio modes and best quality, deduplicates episodes, and reuses fresh metadata on rerun", async () => {
  state.bookmarks.push({ ...state.bookmarks[0] });
  const before = structuredClone(state);
  const updates: BookmarkMetadataProgress[] = [];
  const first = await run(undefined, (value) => updates.push(value));
  expect(first).toMatchObject({ state: "completed", seriesDone: 2, episodesDone: 1, updatedEpisodes: 1, failedEpisodes: 0 });
  expect(getAvailability).toHaveBeenCalledTimes(1);
  expect(vi.mocked(getStreams).mock.calls.map((call) => call[1])).toEqual(["sub", "dub"]);
  const disk = new EpisodeMetadataCache(join(directory, "metadata.json")); await disk.load();
  expect(disk.get(catalogScope(state.settings), episode.id)).toEqual({ availability: { sub: true, dub: true, checkedAt: expect.any(Number) }, qualities: {
    sub: { quality: "1080p", checkedAt: expect.any(Number) }, dub: { quality: "1080p", checkedAt: expect.any(Number) }
  } });
  expect(await run()).toMatchObject({ cachedEpisodes: 1, updatedEpisodes: 0 });
  expect(getStreams).toHaveBeenCalledTimes(2);
  expect(updates.at(-1)).toEqual(first);
  expect(state).toEqual(before);
});

it("fetches only stale fields and only advertised audio modes", async () => {
  const scope = catalogScope(state.settings);
  cache.recordAvailability(scope, episode.id, { ...audio(), dub: false });
  await run();
  expect(getAvailability).not.toHaveBeenCalled();
  expect(getStreams).toHaveBeenCalledExactlyOnceWith(episode.id, "sub", state.settings);
});

it("discovers enabled providers and follows remembered links", async () => {
  state.settings.disabledSources = ["anidb"];
  vi.mocked(resolveSource).mockResolvedValue({ exact: true, hit: { id: "hianime:show", title: "Show", provider: "hianime" } });
  vi.mocked(getProviderEpisodes).mockImplementation(async (id) => id.startsWith("hianime") ? [{ ...episode, id: "hianime:1", provider: "hianime" }] : [episode]);
  expect(await run()).toMatchObject({ updatedEpisodes: 2 });
  expect(vi.mocked(resolveSource).mock.calls.map((call) => call[1])).toEqual(["hianime"]);
  state.providerLinks = [["aniwave:show", "hianime:show"]];
  vi.mocked(resolveSource).mockClear();
  await run(); expect(resolveSource).not.toHaveBeenCalled();
});

it("keeps healthy providers working and skips a failed catalog for the rest of the batch", async () => {
  state.settings.disabledSources = ["hianime"];
  state.bookmarks.push({ ...state.bookmarks[0], animeId: "aniwave:other" });
  vi.mocked(resolveSource).mockRejectedValue(new Error("503"));
  expect(await run()).toMatchObject({ state: "completed", skippedSources: ["anidb"], updatedEpisodes: 1, seriesDone: 2 });
  expect(resolveSource).toHaveBeenCalledTimes(1);
});

it("respects paused sources without attempting recovery", async () => {
  const snapshot = vi.spyOn(catalogRequests.health, "snapshot").mockReturnValue({ state: "paused", canRetry: true });
  try {
    expect(await run()).toMatchObject({ skippedSources: ["aniwave"], updatedEpisodes: 0 });
    expect(getAvailability).not.toHaveBeenCalled(); expect(getProviderEpisodes).not.toHaveBeenCalled();
  } finally { snapshot.mockRestore(); }
});

it("uses one episode at a time at background priority and cancels without writing late results", async () => {
  const controller = new AbortController();
  let release!: (value: ReturnType<typeof audio>) => void;
  let context: ReturnType<typeof catalogContext.getStore>;
  vi.mocked(getAvailability).mockImplementation(() => {
    context = catalogContext.getStore();
    return new Promise((resolve) => { release = resolve; });
  });
  vi.mocked(getProviderEpisodes).mockResolvedValue([episode, { ...episode, id: "aniwave:show:2" }]);
  const pending = run(controller.signal);
  await vi.waitFor(() => expect(getAvailability).toHaveBeenCalledTimes(1));
  expect(context?.priority).toBe(4); expect(context?.refresh).toBeUndefined(); expect(context?.recoveryChecks).toBeUndefined();
  await expect(run()).rejects.toThrow("already being fetched");
  controller.abort(); release(audio());
  expect(await pending).toMatchObject({ state: "cancelled", episodesDone: 0 });
  expect(cache.get(catalogScope(state.settings), episode.id)).toBeUndefined();
  expect(getStreams).not.toHaveBeenCalled();
});

it("preserves successful metadata when one quality fails and retries only missing fields", async () => {
  vi.mocked(getStreams).mockImplementation(async (_id, mode) => {
    if (mode === "dub") throw new Error("host failed");
    return [{ quality: "720p", url: "https://example.com/video", provider: "aniwave" }];
  });
  expect(await run()).toMatchObject({ failedEpisodes: 1, updatedEpisodes: 0 });
  vi.mocked(getStreams).mockClear(); await run();
  expect(getAvailability).toHaveBeenCalledTimes(1);
  expect(getStreams).toHaveBeenCalledExactlyOnceWith(episode.id, "dub", state.settings);
});

it("stops when cache invalidation fences an in-flight result", async () => {
  vi.mocked(getAvailability).mockImplementation(async () => { await cache.clear(catalogScope(state.settings), [episode.id]); return audio(); });
  expect(await run()).toMatchObject({ state: "cancelled", episodesDone: 0 });
  expect(cache.get(catalogScope(state.settings), episode.id)).toBeUndefined();
});

it("owns a single background job and exposes progress and completion to later observers", async () => {
  let release!: (value: ReturnType<typeof audio>) => void;
  vi.mocked(getAvailability).mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  expect(fetcher.start(state).state).toBe("running");
  await vi.waitFor(() => expect(getAvailability).toHaveBeenCalledTimes(1));
  expect(fetcher.start(state)).toMatchObject({ state: "running", currentSeries: "Show" });
  const snapshot = fetcher.snapshot()!; snapshot.skippedSources.push("aniwave");
  expect(fetcher.snapshot()?.skippedSources).toEqual([]);
  release(audio());
  await vi.waitFor(() => expect(fetcher.snapshot()).toMatchObject({ state: "completed", updatedEpisodes: 1 }));
  expect(getAvailability).toHaveBeenCalledTimes(1);
});

it("cancels an app-owned job without needing the original request", async () => {
  let release!: (value: ReturnType<typeof audio>) => void;
  vi.mocked(getAvailability).mockImplementation(() => new Promise((resolve) => { release = resolve; }));
  fetcher.start(state);
  await vi.waitFor(() => expect(getAvailability).toHaveBeenCalledTimes(1));
  expect(fetcher.cancel()?.state).toBe("cancelling");
  expect(fetcher.snapshot()?.state).toBe("cancelling");
  release(audio());
  await vi.waitFor(() => expect(fetcher.snapshot()?.state).toBe("cancelled"));
  expect(getStreams).not.toHaveBeenCalled();
});

it("retains unexpected failures for Settings to display later", async () => {
  const service = new CatalogService();
  vi.spyOn(service, "resolve").mockRejectedValue(new Error("Catalog failed"));
  fetcher = new BookmarkMetadataFetcher(service, cache);
  fetcher.start(state);
  await vi.waitFor(() => expect(fetcher.snapshot()).toMatchObject({ state: "failed", error: "Catalog failed" }));
});
