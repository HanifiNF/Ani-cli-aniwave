import { afterEach, describe, expect, it, vi } from "vitest";
import { getStreams, retryAfterDelay, searchOne, type SourceConfig } from "../electron/scraper";
import { catalogContext, catalogRequests } from "../electron/catalog-requests";

import { CatalogService } from "../electron/catalog-service";

const config: SourceConfig = {
  preferredProvider: "auto",
  aniwaveBaseUrl: "https://aniwave.test",
  anidbBaseUrl: "https://anidb.test",
  hianimeBaseUrl: "https://hianime.test"
};

const aniwaveHtml = `<div class="item"><a href="/watch/re-zero-season-4-101"><img src="https://img.test/re-zero.jpg"></a><a class="name d-title" href="/watch/re-zero-season-4-101" data-jp="Re:Zero kara Hajimeru Isekai Seikatsu 4th Season">Re:ZERO Starting Life in Another World Season 4</a></div>`;
const anidbHtml = `<a href="/anime/re-zero-season-4-202"><img src="https://img.test/re-zero.jpg" alt="Re:ZERO Starting Life in Another World Season 4"></a>`;

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("multi-source scraper", () => {
  it("combines matching results returned by both providers", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith(config.aniwaveBaseUrl)) return new Response(aniwaveHtml, { status: 200 });
      if (url.startsWith(config.anidbBaseUrl)) return new Response(anidbHtml, { status: 200 });
      return new Response(JSON.stringify([{ English: "Re:ZERO Starting Life in Another World Season 4", Japanese: "Re:Zero kara Hajimeru Isekai Seikatsu 4th Season", slugs: ["re-zero-season-4-abc123"] }]), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const results = await new CatalogService().search("re zero", config, "auto");
    expect(results).toHaveLength(1);
    expect(results[0].sources?.map((source) => source.provider)).toEqual(["aniwave", "anidb", "hianime"]);
  });

  it.each([
    ["AniWave", config.aniwaveBaseUrl, "anidb"],
    ["AniDB", config.anidbBaseUrl, "aniwave"]
  ] as const)("keeps the working provider usable when %s search fails", async (_label, failingBase, expectedProvider) => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith(failingBase)) throw new Error("provider offline");
      return new Response(url.startsWith(config.aniwaveBaseUrl) ? aniwaveHtml : anidbHtml, { status: 200 });
    }));

    const results = await new CatalogService().search("re zero", config, "auto");
    expect(results.map((result) => result.provider)).toEqual([expectedProvider]);
  });

  it("keeps AniWave and AniDB results when HiAnime is offline", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://animehot.cc/")) throw new Error("HiAnime offline");
      return new Response(url.startsWith(config.aniwaveBaseUrl) ? aniwaveHtml : anidbHtml, { status: 200 });
    }));
    const results = await new CatalogService().search("re zero", config, "auto");
    expect(results).toHaveLength(1);
    expect(results[0].sources?.map((source) => source.provider)).toEqual(["aniwave", "anidb"]);
  });

  it("reports a combined error only when all providers fail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(new CatalogService().search("re zero", config, "auto")).rejects.toThrow("All providers failed");
  });

  it("does not contact the other provider in an explicit source mode", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) => new Response(aniwaveHtml, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await new CatalogService().search("re zero", config, "aniwave");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/aniwave\.test\//);
  });

  it("uses HiAnime's JSON search API only in explicit HiAnime mode", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify([{ English: "Naruto", Japanese: "ナルト", image: "https://img.test/n.jpg", slugs: ["naruto-vwgihd"] }]), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const results = await new CatalogService().search("naruto", config, "hianime");
    expect(results[0]).toMatchObject({ id: "hianime:naruto-vwgihd", provider: "hianime" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", body: JSON.stringify({ title: "naruto" }) });
  });

  it("resolves the other providers by title and alias and leaves out providers with no convincing hit", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith(config.anidbBaseUrl)) {
        // The English title finds nothing; the romanized alias finds the record.
        return new Response(url.includes(encodeURIComponent("Sousou no Frieren")) ? `<a href="/anime/sousou-no-frieren-303"><img src="https://img.test/f.jpg" alt="Sousou no Frieren"></a>` : "", { status: 200 });
      }
      if (url.startsWith("https://animehot.cc/")) {
        const body = JSON.parse(String(init?.body)) as { title: string };
        return new Response(JSON.stringify(body.title === "Frieren: Beyond Journey's End" ? [{ English: "Frieren: Beyond Journey's End Mini Anime", Japanese: "Sousou no Frieren: ●● no Mahou", slugs: ["frieren-mini-abc"] }] : []), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const anime = { id: "aniwave:frieren-101", title: "Frieren: Beyond Journey's End", provider: "aniwave" as const,
      sources: [{ id: "aniwave:frieren-101", provider: "aniwave" as const, title: "Frieren: Beyond Journey's End", aliases: ["Frieren: Beyond Journey's End", "Sousou no Frieren"] }] };
    const { anime: resolved, confirmed } = await new CatalogService().resolve(anime, config);
    expect(resolved.sources?.map((source) => source.id)).toEqual(["aniwave:frieren-101", "anidb:sousou-no-frieren-303"]);
    expect(confirmed).toEqual(["anidb:sousou-no-frieren-303"]);
    expect(fetchMock.mock.calls.map(([input]) => String(input)).filter((url) => url.startsWith(config.aniwaveBaseUrl))).toHaveLength(0);
    // Nothing to do when every provider is already known.
    vi.mocked(fetchMock).mockClear();
    const complete = { ...anime, sources: (["aniwave", "anidb", "hianime"] as const).map((provider) => ({ id: `${provider}:x-1`, provider, title: "x", aliases: ["x"] })) };
    expect((await new CatalogService().resolve(complete, config)).anime).toEqual(complete);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns independent episode errors without discarding the working catalog", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith(config.anidbBaseUrl)) throw new Error("AniDB offline");
      return new Response(JSON.stringify({ result: `<a data-num="2"></a><a data-num="1"></a>` }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }));

    const catalog = await new CatalogService().episodes({
      id: "aniwave:re-zero-season-4-101", title: "Re:ZERO Season 4", provider: "aniwave",
      sources: [
        { id: "aniwave:re-zero-season-4-101", title: "Re:ZERO Season 4", aliases: ["Re:ZERO Season 4"], provider: "aniwave" },
        { id: "anidb:re-zero-season-4-202", title: "Re:ZERO Season 4", aliases: ["Re:ZERO Season 4"], provider: "anidb" }
      ]
    }, config);

    expect(catalog.groups[0]).toMatchObject({ provider: "aniwave", episodes: [{ number: "1" }, { number: "2" }] });
    expect(catalog.groups[1]).toMatchObject({ provider: "anidb", episodes: [], error: "AniDB offline" });
  });

  it("loads a complete HiAnime episode catalog from its anime slug", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ anime: { episodes: [
      { episodeNumber: 2, slug: "naruto-episode-2-bbb222" }, { episodeNumber: 1, slug: "naruto-episode-1-aaa111" }
    ] } }), { status: 200, headers: { "content-type": "application/json" } })));
    const catalog = await new CatalogService().episodes({ id: "hianime:naruto-vwgihd", title: "Naruto", provider: "hianime" }, config);
    expect(catalog.groups).toEqual([{ provider: "hianime", episodes: [
      { id: "hianime:naruto-episode-1-aaa111", number: "1", provider: "hianime" },
      { id: "hianime:naruto-episode-2-bbb222", number: "2", provider: "hianime" }
    ] }]);
  });

  it("resolves a supported HiAnime server into HLS streams and captions", async () => {
    const metadata = { src: "https://media.test/master.m3u8", subtitles: [{ src: "https://media.test/en.vtt", label: "English", lang: "en", default: true }] };
    const key = Buffer.from("otaku-embed-v1"), plain = Buffer.from(JSON.stringify(metadata)), encoded = Buffer.alloc(plain.length);
    for (let index = 0; index < plain.length; index += 1) encoded[index] = plain[index] ^ key[index % key.length];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/episode/")) return new Response(JSON.stringify({ episode: { link: { sub: ["https://zokoanime.video/stream/test"] } } }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.startsWith("https://zokoanime.video/")) return new Response(`<script>window.__P="${encoded.toString("base64")}"</script>`, { status: 200 });
      return new Response("#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1280x720\n720/index.m3u8", { status: 200 });
    }));
    await expect(getStreams("hianime:naruto-episode-1-aaa111", "sub", config)).resolves.toEqual([
      { quality: "720p", url: "https://media.test/720/index.m3u8", masterUrl: "https://media.test/master.m3u8", provider: "hianime", referrer: "https://zokoanime.video/stream/test", textTracks: metadata.subtitles }
    ]);
  });

  it("rejects unsupported HiAnime video hosts", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ episode: { link: { sub: ["https://unknown.test/embed"] } } }), { status: 200, headers: { "content-type": "application/json" } })));
    await expect(getStreams("hianime:naruto-episode-1-aaa111", "sub", config)).rejects.toThrow("unsupported host unknown.test");
  });
});

describe("source recovery HTTP policy", () => {
  it("parses Retry-After seconds and dates and ignores invalid or past values", () => {
    const now = Date.UTC(2026, 8, 13);
    expect(retryAfterDelay("120", now)).toBe(120_000);
    expect(retryAfterDelay(new Date(now + 60_000).toUTCString(), now)).toBe(60_000);
    expect(retryAfterDelay(new Date(now - 1000).toUTCString(), now)).toBe(0);
    expect(retryAfterDelay("invalid", now)).toBe(0);
    expect(retryAfterDelay(null, now)).toBe(0);
  });

  it("waits on rate limits, keeps refresh protected, and sends only one HTTP request for recovery", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async () => new Response("busy", { status: 429, headers: { "Retry-After": "60" } }));
    vi.stubGlobal("fetch", fetch);
    const testConfig = { ...config, aniwaveBaseUrl: "https://rate-limit.test" };
    const request = (refresh = false, checkNow = false) => catalogContext.run({ signal: new AbortController().signal, scope: "rate-limit", priority: 2, refresh,
      recoveryChecks: checkNow ? new Set() : undefined }, () => searchOne("test", "aniwave", testConfig));
    await expect(request()).rejects.toThrow("429");
    await expect(request(true, true)).rejects.toThrow("Source asked us to wait");
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    fetch.mockImplementation(async () => new Response("offline", { status: 503 }));
    await expect(request()).rejects.toThrow("503");
    expect(fetch).toHaveBeenCalledTimes(2); // The probe has no internal HTTP retry.
    await expect(request(true)).rejects.toThrow("paused");
    fetch.mockImplementation(async () => new Response(aniwaveHtml));
    expect(await request(true, true)).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("backs off after a timeout without treating a missing record as a source outage", async () => {
    const fetch = vi.fn(async () => { throw new DOMException("Timed out", "TimeoutError"); });
    vi.stubGlobal("fetch", fetch);
    const testConfig = { ...config, aniwaveBaseUrl: "https://timeout.test" };
    const request = () => catalogContext.run({ signal: new AbortController().signal, scope: "timeout", priority: 2 }, () => searchOne("test", "aniwave", testConfig));
    await expect(request()).rejects.toThrow("Timed out");
    await expect(request()).rejects.toThrow("paused");
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", { status: 404 })));
    await expect(catalogContext.run({ signal: new AbortController().signal, scope: "missing", priority: 2 },
      () => searchOne("test", "aniwave", { ...config, aniwaveBaseUrl: "https://missing.test" }))).rejects.toThrow("404");
    expect(catalogRequests.health.blocked("https://missing.test", false)).toBeUndefined();
  });
});

it("shares the server response between audio metadata and playback without extra video-host requests", async () => {
  const { catalogContext } = await import("../electron/catalog-requests");
  const { getAvailability } = await import("../electron/scraper");
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/server/list")) return new Response(JSON.stringify({ result: '<div class="type" data-type="sub"><li data-sv-id="4" data-link-id="sub-id"></li></div><div class="type" data-type="dub"><li data-sv-id="4" data-link-id="dub-id"></li></div>' }));
    if (url.includes("/ajax/sources")) return new Response(JSON.stringify({ result: { url: "https://host.test/embed-1/token" } }));
    if (url.includes("/getSources")) return new Response(JSON.stringify({ sources: [{ file: "https://cdn.test/master.m3u8" }] }));
    return new Response("#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080\n1080.m3u8");
  });
  vi.stubGlobal("fetch", fetchMock);
  await catalogContext.run({ signal: new AbortController().signal, priority: 2, scope: "availability-test" }, async () => {
    const audio = await getAvailability("aniwave:101:1", config);
    expect(audio).toMatchObject({ sub: true, dub: true }); expect(fetchMock).toHaveBeenCalledTimes(1);
    const [first, second] = await Promise.all([getStreams("aniwave:101:1", "sub", config), getStreams("aniwave:101:1", "sub", config)]);
    expect(first).toEqual(second); expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
