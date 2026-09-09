import { afterEach, describe, expect, it, vi } from "vitest";
import { getEpisodes, searchAnime, type SourceConfig } from "../electron/scraper";

const config: SourceConfig = {
  preferredProvider: "auto",
  aniwaveBaseUrl: "https://aniwave.test",
  anidbBaseUrl: "https://anidb.test"
};

const aniwaveHtml = `<div class="item"><a href="/watch/re-zero-season-4-101"><img src="https://img.test/re-zero.jpg"></a><a class="name d-title" href="/watch/re-zero-season-4-101" data-jp="Re:Zero kara Hajimeru Isekai Seikatsu 4th Season">Re:ZERO Starting Life in Another World Season 4</a></div>`;
const anidbHtml = `<a href="/anime/re-zero-season-4-202"><img src="https://img.test/re-zero.jpg" alt="Re:ZERO Starting Life in Another World Season 4"></a>`;

afterEach(() => vi.unstubAllGlobals());

describe("multi-source scraper", () => {
  it("combines matching results returned by both providers", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return new Response(url.startsWith(config.aniwaveBaseUrl) ? aniwaveHtml : anidbHtml, { status: 200 });
    }));

    const results = await searchAnime("re zero", config, "auto");
    expect(results).toHaveLength(1);
    expect(results[0].sources?.map((source) => source.provider)).toEqual(["aniwave", "anidb"]);
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

    const results = await searchAnime("re zero", config, "auto");
    expect(results.map((result) => result.provider)).toEqual([expectedProvider]);
  });

  it("reports a combined error only when neither provider works", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await expect(searchAnime("re zero", config, "auto")).rejects.toThrow("All providers failed");
  });

  it("does not contact the other provider in an explicit source mode", async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) => new Response(aniwaveHtml, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await searchAnime("re zero", config, "aniwave");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^https:\/\/aniwave\.test\//);
  });

  it("returns independent episode errors without discarding the working catalog", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith(config.anidbBaseUrl)) throw new Error("AniDB offline");
      return new Response(JSON.stringify({ result: `<a data-num="2"></a><a data-num="1"></a>` }), {
        status: 200, headers: { "content-type": "application/json" }
      });
    }));

    const catalog = await getEpisodes({
      id: "aniwave:re-zero-season-4-101", title: "Re:ZERO Season 4", provider: "aniwave",
      sources: [
        { id: "aniwave:re-zero-season-4-101", title: "Re:ZERO Season 4", aliases: ["Re:ZERO Season 4"], provider: "aniwave" },
        { id: "anidb:re-zero-season-4-202", title: "Re:ZERO Season 4", aliases: ["Re:ZERO Season 4"], provider: "anidb" }
      ]
    }, config);

    expect(catalog.groups[0]).toMatchObject({ provider: "aniwave", episodes: [{ number: "1" }, { number: "2" }] });
    expect(catalog.groups[1]).toMatchObject({ provider: "anidb", episodes: [], error: "AniDB offline" });
  });
});
