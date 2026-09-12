import type { AnimeResult, AnimeSource, LibraryEntry, ProviderName } from "./contracts";

export function normalizedTitle(value: string): string {
  return value.normalize("NFKD").toLowerCase()
    .replace(/\b(\d+)(?:st|nd|rd|th)\b/g, "$1")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

const providerFromId = (id: string): ProviderName => id.startsWith("aniwave:") ? "aniwave" : id.startsWith("hianime:") ? "hianime" : "anidb";

export function animeSources(anime: AnimeResult | LibraryEntry): AnimeSource[] {
  if (anime.sources?.length) return anime.sources;
  const id = "animeId" in anime ? anime.animeId : anime.id;
  const provider = providerFromId(id);
  return [{ id, provider, title: anime.title, aliases: [anime.title], poster: anime.poster }];
}

const sourceKeys = (source: AnimeSource) => new Set([source.title, ...source.aliases].map(normalizedTitle).filter(Boolean));
const linked = (left: AnimeSource[], right: AnimeSource[], links: string[][]) => {
  const ids = new Set([...left, ...right].map((source) => source.id));
  return links.some((group) => group.filter((id) => ids.has(id)).length > 1);
};

export function unifyAnimeResults(results: AnimeResult[], links: string[][] = []): AnimeResult[] {
  const groups: AnimeSource[][] = [];
  for (const result of results) {
    for (const source of animeSources(result)) {
      const keys = sourceKeys(source);
      const indexes = groups.flatMap((group, index) => linked(group, [source], links) || (!group.some((item) => item.provider === source.provider) && group.some((item) => [...sourceKeys(item)].some((key) => keys.has(key)))) ? [index] : []);
      if (indexes.length === 0) groups.push([source]);
      else {
        const combined = [...groups[indexes[0]], source, ...indexes.slice(1).flatMap((index) => groups[index])]
          .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index);
        groups[indexes[0]] = combined;
        for (const index of indexes.slice(1).sort((a, b) => b - a)) groups.splice(index, 1);
      }
    }
  }
  return groups.map((sources) => {
    const primary = sources.find((source) => source.provider === "aniwave") ?? sources[0];
    const english = sources.find((source) => source.provider === "aniwave")?.title ?? sources.find((source) => source.provider === "anidb")?.title ?? sources.find((source) => source.provider === "hianime")?.title ?? primary.title;
    return { id: primary.id, title: english, poster: primary.poster ?? sources.find((source) => source.poster)?.poster, provider: primary.provider, sources };
  });
}

export const sourceIds = (anime: AnimeResult | LibraryEntry): string[] => animeSources(anime).map((source) => source.id);
export const overlaps = (left: AnimeResult | LibraryEntry, right: AnimeResult | LibraryEntry): boolean => {
  const ids = new Set(sourceIds(left));
  return sourceIds(right).some((id) => ids.has(id));
};

function season(value: string): string | undefined {
  const title = normalizedTitle(value);
  return title.match(/(?:season\s+|\s)(\d+)(?:\s+season)?$/)?.[1];
}

export function likelyDuplicate(left: AnimeResult | LibraryEntry, right: AnimeResult | LibraryEntry): boolean {
  if (animeSources(left)[0].provider === animeSources(right)[0].provider || overlaps(left, right)) return false;
  const a = normalizedTitle(left.title), b = normalizedTitle(right.title);
  if (a === b) return true;
  const aSeason = season(a), bSeason = season(b);
  if (!aSeason || aSeason !== bSeason) return false;
  const meaningful = (value: string) => value.split(" ").filter((token) => !["the", "a", "an", "season", "starting", "life", "in", "another", "world", "kara", "hajimeru", "isekai", "seikatsu"].includes(token) && token !== aSeason);
  const aa = meaningful(a), bb = meaningful(b);
  return aa.length > 0 && bb.length > 0 && aa.slice(0, 2).join(" ") === bb.slice(0, 2).join(" ");
}

export const mergeKey = (first: string, second: string): string => [first, second].sort().join("|");
