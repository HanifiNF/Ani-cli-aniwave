import { describe, expect, it } from "vitest";
import { findEmbedUrl, parseAniwaveEpisodes, parseAniwaveSearch, parseAniwaveVidplayId, parseEpisodes, parseMasterPlaylist, parseMasterUrl, parseResultUrl, parseSearchPage, parseVidplaySource } from "../electron/parsers";

describe("source parsers", () => {
  it("extracts and decodes search results", () => {
    const html = `<a href="/anime/test-show-42"><img src="https://img.test/poster.jpg" alt="Test &amp; Show"></a>`;
    expect(parseSearchPage(html)).toEqual([
      { id: "anidb:test-show-42", title: "Test & Show", poster: "https://img.test/poster.jpg", provider: "anidb", sources: [{ id: "anidb:test-show-42", provider: "anidb", title: "Test & Show", aliases: ["Test & Show"], poster: "https://img.test/poster.jpg" }] }
    ]);
  });

  it("finds episodes in nested API data", () => {
    const payload = { data: { episodes: [{ id: 11, number: 2 }, { id: 10, number: 1 }] } };
    expect(parseEpisodes(payload)).toEqual([{ id: "anidb:10", number: "1", provider: "anidb" }, { id: "anidb:11", number: "2", provider: "anidb" }]);
  });

  it("finds language embeds", () => {
    expect(findEmbedUrl({ streams: [{ jpn: { embed_url: "https:\\/\\/video.test\\/e" } }] }, "sub")).toBe(
      "https://video.test/e"
    );
    expect(findEmbedUrl({ sources: [{ lang: "jpn", embed_url: "https://video.test/sub" }] }, "sub")).toBe(
      "https://video.test/sub"
    );
  });

  it("parses master playlists and relative URLs", () => {
    expect(parseMasterUrl(`player({ file: 'https://video.test/master.m3u8' })`)).toBe(
      "https://video.test/master.m3u8"
    );
    const streams = parseMasterPlaylist(
      "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720\n720/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=640x360\n360/index.m3u8",
      "https://video.test/master.m3u8"
    );
    expect(streams.map((stream) => stream.quality)).toEqual(["720p", "360p"]);
    expect(streams[0]).toMatchObject({ url: "https://video.test/720/index.m3u8", masterUrl: "https://video.test/master.m3u8" });
  });

  it("parses AniWave search and episodes into namespaced IDs", () => {
    const html = `<div class="item"><a href="/watch/naruto-76396"><img data-src="https://img.test/n.jpg"></a><a class="name d-title" href="/watch/naruto-76396" data-jp="Naruto Shippuuden">Naruto Shippuden</a></div>`;
    expect(parseAniwaveSearch(html)).toEqual([{ id: "aniwave:naruto-76396", title: "Naruto Shippuden", poster: "https://img.test/n.jpg", provider: "aniwave", sources: [{ id: "aniwave:naruto-76396", provider: "aniwave", title: "Naruto Shippuden", aliases: ["Naruto Shippuden", "Naruto Shippuuden"], poster: "https://img.test/n.jpg" }] }]);
    expect(parseAniwaveEpisodes({ result: `<a data-num="2" href="/watch/76396/ep-2"></a><a data-num="1" href="/watch/76396/ep-1"></a>` }, "76396")).toEqual([
      { id: "aniwave:76396:1", number: "1", provider: "aniwave" }, { id: "aniwave:76396:2", number: "2", provider: "aniwave" }
    ]);
  });

  it("selects only the requested AniWave Vidplay server and source", () => {
    const payload = { result: `<div class="type" data-type="sub"><ul><li data-sv-id="4" data-link-id="sub-link">Vidplay</li></ul></div><div class="type" data-type="dub"><ul><li data-sv-id="4" data-link-id="dub-link">Vidplay</li></ul></div>` };
    expect(parseAniwaveVidplayId(payload, "sub")).toBe("sub-link");
    expect(parseAniwaveVidplayId(payload, "dub")).toBe("dub-link");
    expect(parseResultUrl({ result: { url: "https:\/\/play.test\/embed-1\/abc" } })).toBe("https://play.test/embed-1/abc");
    expect(parseVidplaySource({ sources: "https:\/\/cdn.test\/master.m3u8" })).toBe("https://cdn.test/master.m3u8");
  });

  it("keeps a media playlist as a best-quality stream", () => {
    expect(parseMasterPlaylist("#EXTM3U\n#EXTINF:10,\nseg.ts", "https://cdn.test/media.m3u8", "aniwave", "https://play.test/embed")).toEqual([
      { quality: "best", url: "https://cdn.test/media.m3u8", provider: "aniwave", referrer: "https://play.test/embed" }
    ]);
  });
});
