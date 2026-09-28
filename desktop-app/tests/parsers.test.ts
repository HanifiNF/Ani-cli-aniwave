import { describe, expect, it } from "vitest";
import { findEmbedUrl, hiAnimeEmbedUrls, parseAniDbSeriesMetadata, parseAniwaveEpisodes, parseAniwavePoster, parseAniwaveSchedule, parseAniwaveSearch, parseAniwaveSeriesMetadata, parseAniwaveTooltip, parseAniwaveVidplayId, parseEpisodes, parseHiAnimeEmbed, parseHiAnimeEpisodes, parseHiAnimeSearch, parseHiAnimeSeriesMetadata, parseMasterPlaylist, parseMasterUrl, parseResultUrl, parseSearchPage, parseVidplaySource } from "../electron/parsers";

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

  it("parses AniWave schedule dates, aliases, native episodes, and absolute release times", () => {
    const payload = { result: `<div data-time="2026-09-13"></div><div data-time="2026-09-14"></div><a class="item" href="/watch/late-show-42/ep-3"><div class="time" data-tip="42">09:30 PM</div><div class="ep"><span>Episode 3</span></div><div class="title d-title" data-jp="Late Shō">Late Show</div></a><a class="item old" href="/watch/early-show-41/ep-10.5"><div class="time" data-tip="41">04:55 PM</div><div class="ep"><span>Episode 10.5</span></div><div class="title d-title" data-jp="Early Show JP">Early &amp; Show</div></a>` };
    const result = parseAniwaveSchedule(payload, "2026-09-13", 420);
    expect(result.map((entry) => [entry.anime.id, entry.episode.id, entry.releaseAt])).toEqual([
      ["aniwave:early-show-41", "aniwave:41:10.5", "2026-09-13T09:55:00.000Z"],
      ["aniwave:late-show-42", "aniwave:42:3", "2026-09-13T14:30:00.000Z"]
    ]);
    expect(result[0].anime.sources?.[0].aliases).toEqual(["Early & Show", "Early Show JP"]);
  });

  it("rejects malformed schedule rows and extracts tooltip artwork metadata", () => {
    expect(parseAniwaveSchedule({ result: `<a class="item" href="javascript:alert(1)"><div class="time">noon</div></a>` }, "2026-09-13", 420)).toEqual([]);
    expect(parseAniwaveTooltip(`<div class="title d-title" data-jp="JP Name">English Name</div><div><span>Other names:</span><span>Alias One, 別名</span></div>`, "aniwave:show-42"))
      .toEqual({ animeId: "aniwave:show-42", title: "English Name", aliases: ["English Name", "JP Name", "Alias One", "別名"], poster: undefined });
    expect(parseAniwavePoster(`<img itemprop="image" src="https://img.test/poster.jpg">`)).toBe("https://img.test/poster.jpg");
    expect(parseAniwavePoster(`<meta property="og:image" content="javascript:bad">`)).toBeUndefined();
  });

  it("keeps available and announced AniWave episode counts separate and extracts genres", () => {
    const html = `<span class="ep-status sub"><span>11</span></span><span class="ep-status dub"><span>9</span></span><span class="ep-status total"><span>14</span></span><div><span>Genre:</span><span><a>Adventure</a>, <a>Drama</a>, <a>Fantasy</a>, <a>drama</a></span></div>`;
    expect(parseAniwaveSeriesMetadata(html)).toEqual({ genres: ["Adventure", "Drama", "Fantasy"], availableEpisodes: 11, announcedEpisodes: 14 });
    expect(parseAniwaveSeriesMetadata(`<span class="ep-status total"><span>soon</span></span>`)).toEqual({ genres: [], availableEpisodes: undefined, announcedEpisodes: undefined });
  });

  it("parses HiAnime titles, Unicode aliases, punctuation IDs, and episodes", () => {
    expect(parseHiAnimeSearch([{ English: "Boruto: Naruto Next Generations", title: "Boruto", Japanese: "BORUTO-ボルト-", alternateTitle: "", image: "https://img.test/boruto.jpg", slugs: [...Array.from({ length: 10 }, (_, index) => `old-${index}`), "boruto:-naruto-next-generations-3dmuk9"] }])).toEqual([
      { id: "hianime:boruto:-naruto-next-generations-3dmuk9", title: "Boruto: Naruto Next Generations", poster: "https://img.test/boruto.jpg", provider: "hianime", sources: [{ id: "hianime:boruto:-naruto-next-generations-3dmuk9", title: "Boruto: Naruto Next Generations", aliases: ["Boruto: Naruto Next Generations", "Boruto", "BORUTO-ボルト-"], poster: "https://img.test/boruto.jpg", provider: "hianime" }] }
    ]);
    expect(parseHiAnimeEpisodes({ anime: { episodes: [{ episodeNumber: 2, slug: "show-episode-2-bbb222" }, { episodeNumber: 1, slugs: ["show-episode-1-aaa111"] }] } })).toEqual([
      { id: "hianime:show-episode-1-aaa111", number: "1", provider: "hianime" }, { id: "hianime:show-episode-2-bbb222", number: "2", provider: "hianime" }
    ]);
  });

  it("reads HiAnime availability without treating it as an announced total and accepts explicit AniDB metadata", () => {
    expect(parseHiAnimeSeriesMetadata(JSON.stringify({ anime: { episodes: [{}, {}], genres: ["Fantasy", "冒険", "fantasy"], totalEpisodes: "12" } })))
      .toEqual({ genres: ["Fantasy", "冒険"], availableEpisodes: 2 });
    expect(parseAniDbSeriesMetadata({ data: { genres: [{ name: "Drama" }, "Fantasy"], episodeCount: 24 } }))
      .toEqual({ genres: ["Drama", "Fantasy"], announcedEpisodes: 24 });
  });

  it("extracts HiAnime mode servers and decodes ZokoAnime HLS metadata", () => {
    expect(hiAnimeEmbedUrls({ episode: { link: { sub: ["https://zokoanime.video/sub"], dub: ["https://zokoanime.video/dub"] } } }, "dub")).toEqual(["https://zokoanime.video/dub"]);
    const source = { src: "https://cdn.test/master.m3u8", subtitles: [{ src: "https://cdn.test/en.vtt", label: "English", lang: "en", default: true }] };
    const key = Buffer.from("otaku-embed-v1");
    const plain = Buffer.from(JSON.stringify(source));
    const encoded = Buffer.alloc(plain.length);
    for (let index = 0; index < plain.length; index += 1) encoded[index] = plain[index] ^ key[index % key.length];
    expect(parseHiAnimeEmbed(`<script>window.__P="${encoded.toString("base64")}"</script>`)).toEqual(source);
  });

  it("takes each HiAnime subtitle track's language from its label", () => {
    const source = { src: "https://cdn.test/master.m3u8", subtitles: [{ src: "https://cdn.test/ar.vtt", label: "Arabic", lang: "en" }, { src: "https://cdn.test/x.vtt", label: "Signs", lang: "en" }] };
    const key = Buffer.from("otaku-embed-v1"), plain = Buffer.from(JSON.stringify(source)), encoded = Buffer.alloc(plain.length);
    for (let index = 0; index < plain.length; index += 1) encoded[index] = plain[index] ^ key[index % key.length];
    expect(parseHiAnimeEmbed(`<script>window.__P="${encoded.toString("base64")}"</script>`)?.subtitles.map((track) => track.lang)).toEqual(["ar", "en"]);
  });
});

describe("AniWave search cards", () => {
  it("keeps facts and artwork inside each AniWave search card", () => {
    const card = (slug: string, title: string, type: string, episodes: number) => `<div class="item"><img src="https://img.test/${slug}.jpg"><div class="right">${type}</div><div class="ep-status total"><span>${episodes}</span></div><a class="name" href="/watch/${slug}">${title}</a></div>`;
    const rows = parseAniwaveSearch(card("movie-1", "Movie", "Movie", 1) + card("series-2", "Series", "TV", 12));
    expect(rows[1].sources?.[0]).toMatchObject({ type: "TV", episodes: 12, poster: "https://img.test/series-2.jpg" });
  });
});
