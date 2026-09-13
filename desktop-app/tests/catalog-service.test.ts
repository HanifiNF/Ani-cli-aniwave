import { beforeEach, describe, expect, it, vi } from "vitest";
import { CatalogService } from "../electron/catalog-service";
import { getProviderEpisodes, resolveSource, searchOne } from "../electron/scraper";
import type { AnimeResult, CatalogProgress, EpisodeCatalog } from "../shared/contracts";
import { animeSources } from "../shared/catalog";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
vi.mock("../electron/scraper", () => ({ getProviderEpisodes: vi.fn(), resolveSource: vi.fn(), searchOne: vi.fn() }));
const config = { preferredProvider: "auto" as const, aniwaveBaseUrl: "https://a.test", anidbBaseUrl: "https://b.test", hianimeBaseUrl: "https://c.test" };
const source = (provider: "aniwave" | "anidb" | "hianime") => ({ id: `${provider}:frieren-1`, provider, title: "Frieren", aliases: ["Frieren"] });
const anime: AnimeResult = { ...source("aniwave"), sources: [source("aniwave"), source("hianime")] };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; };
const tick = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
beforeEach(() => vi.resetAllMocks());

describe("incremental catalog delivery", () => {
  it("restores episode IDs from disk before refreshing their provider", async () => {
    const directory = await mkdtemp(join(tmpdir(), "episode-lists-"));
    const path = join(directory, "lists.json");
    const service = new CatalogService(), restored = new CatalogService();
    try {
      await service.load(path);
      vi.mocked(getProviderEpisodes).mockResolvedValue([{ id: "aniwave:1:2", number: "2", provider: "aniwave" }]);
      await service.episodes({ ...anime, sources: [source("aniwave")] }, config); await service.flush();
      await restored.load(path);
      const slow = deferred<Awaited<ReturnType<typeof getProviderEpisodes>>>();
      vi.mocked(getProviderEpisodes).mockReturnValue(slow.promise);
      const updates: EpisodeCatalog[] = [];
      const pending = restored.episodes({ ...anime, sources: [source("aniwave")] }, config, (value) => updates.push(value));
      expect(updates[0].groups[0]).toMatchObject({ refreshing: true, episodes: [{ id: "aniwave:1:2", number: "2" }] });
      slow.resolve([{ id: "aniwave:1:3", number: "3", provider: "aniwave" }]);
      expect((await pending).groups[0].episodes[0].number).toBe("3");
    } finally { await service.flush(); await restored.flush(); await rm(directory, { recursive: true, force: true }); }
  });

  it("discards invalid and expired persisted catalog entries", async () => {
    const directory = await mkdtemp(join(tmpdir(), "episode-lists-"));
    const path = join(directory, "lists.json"), service = new CatalogService();
    try {
      await writeFile(path, JSON.stringify({ version: 1, entries: [[`${JSON.stringify([config.aniwaveBaseUrl, config.anidbBaseUrl, config.hianimeBaseUrl])}:${source("aniwave").id}`, { at: Date.now() - 8 * 86400000, episodes: [{ id: "aniwave:1:2", number: "2", provider: "aniwave" }] }], [null, {}]] }));
      await service.load(path);
      vi.mocked(getProviderEpisodes).mockResolvedValue([]);
      const updates: EpisodeCatalog[] = [];
      await service.episodes({ ...anime, sources: [source("aniwave")] }, config, (value) => updates.push(value));
      expect(updates.every((value) => value.groups.every((group) => !group.refreshing && !group.episodes.length))).toBe(true);
    } finally { await service.flush(); await rm(directory, { recursive: true, force: true }); }
  });

  it("publishes search hits while another provider is still pending", async () => {
    const slow = deferred<AnimeResult[]>(), updates: CatalogProgress<AnimeResult[]>[] = [];
    vi.mocked(searchOne).mockImplementation(async (_query, provider) => provider === "anidb" ? slow.promise : [{ ...source(provider) }]);
    const result = new CatalogService().search("Frieren", config, "auto", [], (value) => updates.push(value)); await tick();
    expect(updates.at(-1)?.value).toHaveLength(1);
    expect(updates.at(-1)?.pending).toEqual(["anidb"]);
    slow.resolve([]); expect(await result).toHaveLength(1);
  });

  it("leaves switched-off sources out of search, lookup, and episode loading", async () => {
    const off = { ...config, disabledSources: ["anidb" as const] };
    vi.mocked(searchOne).mockImplementation(async (_query, provider) => [{ ...source(provider) }]);
    const hits = await new CatalogService().search("Frieren", off, "anidb");
    expect(hits.flatMap((hit) => animeSources(hit).map((item) => item.provider)).sort()).toEqual(["aniwave", "hianime"]);
    expect(vi.mocked(searchOne).mock.calls.map((call) => call[1])).not.toContain("anidb");
    vi.mocked(resolveSource).mockResolvedValue(undefined);
    const updates: CatalogProgress<AnimeResult>[] = [];
    await new CatalogService().resolve({ ...anime, sources: [source("aniwave")] }, off, (value) => updates.push(value));
    expect(updates[0].pending).toEqual(["hianime"]);
    vi.mocked(getProviderEpisodes).mockResolvedValue([]);
    const catalog = await new CatalogService().episodes({ ...anime, sources: [source("aniwave"), source("anidb")] }, off);
    expect(catalog.groups.map((group) => group.provider)).toEqual(["aniwave"]);
  });

  it("delivers each episode group independently and preserves cached episodes when refresh fails", async () => {
    const service = new CatalogService(), slow = deferred<Awaited<ReturnType<typeof getProviderEpisodes>>>(), updates: EpisodeCatalog[] = [];
    vi.mocked(getProviderEpisodes).mockImplementation(async (id) => id.startsWith("hianime") ? slow.promise : [{ id: "aniwave:1:1", number: "1", provider: "aniwave" }]);
    const first = service.episodes(anime, config, (value) => updates.push(value)); await tick();
    expect(updates.at(-1)?.groups.map((group) => group.provider)).toEqual(["aniwave"]);
    slow.resolve([{ id: "hianime:ep-1", number: "1", provider: "hianime" }]); await first;
    vi.mocked(getProviderEpisodes).mockRejectedValue(new Error("provider offline"));
    const refreshed: EpisodeCatalog[] = [];
    const second = service.episodes(anime, config, (value) => refreshed.push(value));
    expect(refreshed[0].groups.every((group) => group.refreshing && group.episodes.length === 1)).toBe(true);
    expect((await second).groups.every((group) => group.error === "provider offline" && group.episodes.length === 1)).toBe(true);
  });

  it("delivers a discovered provider without waiting for an unrelated failure", async () => {
    const slow = deferred<undefined>(), updates: CatalogProgress<AnimeResult>[] = [];
    vi.mocked(resolveSource).mockImplementation(async (_anime, provider) => {
      if (provider === "anidb") { await slow.promise; throw new Error("503"); }
      return { hit: { ...source("hianime") }, exact: true };
    });
    const result = new CatalogService().resolve({ ...anime, sources: [source("aniwave")] }, config, (value) => updates.push(value)); await tick();
    expect(updates.at(-1)?.value.sources?.map((item) => item.provider)).toEqual(["aniwave", "hianime"]);
    expect(updates.at(-1)?.pending).toEqual(["anidb"]);
    slow.resolve(undefined); expect((await result).confirmed).toEqual(["hianime:frieren-1"]);
    expect(updates.at(-1)?.errors.anidb).toBe("503");
  });
});
