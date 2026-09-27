import { describe, expect, it } from "vitest";
import { browseMatch, browseQueries, identified, knownCandidate, rememberedBrowseAnime } from "../shared/browse-source";
import { unifyAnimeResults } from "../shared/catalog";
import type { AnimeResult, BrowseAnime, Work } from "../shared/contracts";

const anime: BrowseAnime = { anilistId: 42, refs: ["anilist:42", "mal:42"], title: "Example Season 2", titles: ["Example Season 2", "Other Name 2", "Another Name 2", "Fourth Name"], genres: [], studios: [], type: "TV", year: 2020, status: "finished" };
const hit = (refs: string[] = [], title = anime.title): AnimeResult => ({ id: "aniwave:example-1", provider: "aniwave", title, refs });
const work: Work = { id: "work:1234567890123456", title: anime.title, refs: anime.refs, records: ["aniwave:example-1", "hianime:example"], updatedAt: new Date().toISOString(), type: "TV", year: 2020 };

describe("browse identity", () => {
  it("rejects conflicting IDs even with another shared ID or an identical title", () => {
    expect(browseMatch(anime, [hit(["anilist:42", "mal:99"])] )).toBeUndefined();
    expect(browseMatch(anime, [hit(["anilist:99"])] )).toBeUndefined();
  });
  const stating = (refs: string[], facts: object, title = anime.title): AnimeResult => ({ ...hit(refs, title), sources: [{ id: "aniwave:example-1", provider: "aniwave", title, aliases: [], ...facts }] });
  it("rejects a conflicting source reference, and a conflicting format or year when only titles agree", () => {
    expect(browseMatch(anime, [stating(anime.refs, { refs: ["mal:99"] })])).toBeUndefined();
    for (const facts of [{ type: "MOVIE" as const }, { year: 2021 }]) expect(browseMatch(anime, [stating([], facts)])).toBeUndefined();
    expect(browseMatch(anime, [stating([], {}, `${anime.title} (2021)`)])).toBeUndefined();
  });
  it("lets a shared ID settle identity when catalogues disagree on year or format", () => {
    // A December premiere belongs to the next year's winter season on AniList and to the premiere year on a provider.
    for (const facts of [{ type: "ONA" as const }, { year: 2019 }]) {
      const row = stating(["mal:42"], facts, "Provider spelling");
      expect(browseMatch(anime, [hit(), row])).toBe(row);
    }
  });
  it("matches a release variant by title only when no plain spelling matches", () => {
    const variant = hit([], "Example Season 2 (Uncensored)");
    expect(browseMatch(anime, [variant])).toBe(variant);
    const plain = { ...hit(), id: "aniwave:example-2" };
    expect(browseMatch(anime, [variant, plain])).toBe(plain);
    expect(browseMatch(anime, [variant, { ...hit([], "Example Season 2 (Dub)"), id: "aniwave:example-3" }])).toBeUndefined();
  });
  it("ignores the announced episode total, which a provider may not have reached", () => {
    const row = stating([], { episodes: 3 });
    expect(browseMatch({ ...anime, episodes: 24 }, [row])).toBe(row);
  });
  it("carries the entry's references into the opened row and describes the entry as an identified work", () => {
    expect(identified(anime, hit(["mal:42"])).refs).toEqual(["mal:42", "anilist:42"]);
    expect(identified(anime, { id: "aniwave:example-1", provider: "aniwave", title: anime.title }).refs).toEqual(anime.refs);
    expect(knownCandidate({ ...anime, episodes: 24 })).toEqual({ refs: anime.refs, title: anime.title, titles: anime.titles, status: "finished", type: "TV", year: 2020, episodes: 24 });
  });
  it("prefers references, accepts a unique alias, and leaves ambiguous matches unresolved", () => {
    const correct = hit(anime.refs, "Provider title");
    expect(browseMatch(anime, [hit(), correct])).toBe(correct);
    const alias = { ...hit([], "Provider title"), sources: [{ id: "aniwave:example-1", provider: "aniwave" as const, title: "Provider title", aliases: ["OTHER NAME 2!"] }] };
    expect(browseMatch(anime, [alias])).toBe(alias);
    expect(browseMatch(anime, [hit(), { ...hit(), id: "aniwave:example-2" }])).toBeUndefined();
    expect(browseMatch(anime, [hit([], "Example Season 1")])).toBeUndefined();
  });
  it("reuses confident remembered records only from enabled sources", () => {
    const known = rememberedBrowseAnime(anime, [work], { disabledSources: ["aniwave"] });
    expect(known?.sources?.map((source) => source.id)).toEqual(["hianime:example"]);
    expect(rememberedBrowseAnime(anime, [{ ...work, tentative: true }], {})).toBeUndefined();
    // A reopening shows the site's cover the first opening found, and the catalogue cover only when none is known.
    expect(rememberedBrowseAnime({ ...anime, cover: "https://anilist.test/cover.jpg" }, [work], {})?.poster).toBe("https://anilist.test/cover.jpg");
    const covered = rememberedBrowseAnime({ ...anime, cover: "https://anilist.test/cover.jpg" }, [{ ...work, poster: "https://site.test/cover.jpg" }], {});
    expect(covered?.poster).toBe("https://site.test/cover.jpg");
    expect(unifyAnimeResults([identified(anime, covered!)])[0].poster).toBe("https://site.test/cover.jpg");
    expect(rememberedBrowseAnime(anime, [{ ...work, refs: ["anilist:42", "mal:99"] }], {})).toBeUndefined();
  });
});

describe("browse query selection", () => {
  it("keeps five distinct complete names and ignores repeated, blank, and overlength spellings", () => {
    expect(browseQueries({ ...anime, titles: [anime.title.toUpperCase(), " ", "x".repeat(121), ...anime.titles, "Fifth Name", "Sixth Name"] }))
      .toEqual([anime.title, "Other Name 2", "Another Name 2", "Fourth Name", "Fifth Name"]);
  });
  it("prioritizes labelled English and romaji titles, with native titles retained as fallback", () => {
    expect(browseQueries({ ...anime, titles: ["例", "Other Name 2", "Another Name 2"], titleVariants: { english: "English Name", romaji: "Romaji Name", native: "例" } }))
      .toEqual([anime.title, "English Name", "Romaji Name", "Other Name 2", "Another Name 2"]);
    expect(browseQueries({ ...anime, titles: ["例", "Other Name 2"] })).toEqual([anime.title, "Other Name 2", "例"]);
    expect(browseQueries({ ...anime, title: "例", titles: ["例", "別名"] })).toEqual(["例", "別名"]);
  });
  it("uses exact-ID index hints while rejecting conflicting or unrelated references", () => {
    const hint = { refs: anime.refs, title: "Index Name", titles: ["Index Name"] };
    expect(browseQueries(anime, [hint])).toEqual([anime.title, "Index Name", "Other Name 2", "Another Name 2", "Fourth Name"]);
    expect(browseQueries(anime, [{ ...hint, refs: ["anilist:99"] }, { ...hint, refs: ["anilist:42", "mal:99"] }])).toEqual(browseQueries(anime));
  });
  it("never invents a franchise-only query by stripping the season or subtitle", () => {
    const title = "Example Season 2: Part 3";
    expect(browseQueries({ ...anime, title, titles: [title] })).toEqual([title]);
  });
});
