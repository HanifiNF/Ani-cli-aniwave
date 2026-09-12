import type { AnimeResult, AnimeSource, LibraryEntry, ProviderName, Settings } from "./contracts";

export const PROVIDER_NAMES: readonly ProviderName[] = ["aniwave", "anidb", "hianime"];
export const isProviderName = (value: unknown): value is ProviderName => PROVIDER_NAMES.includes(value as ProviderName);
/** Providers that take part in catalog work, in the app's fixed order. */
export function enabledProviders(settings: Pick<Settings, "disabledSources">): ProviderName[] {
  const disabled = settings.disabledSources ?? [];
  return PROVIDER_NAMES.filter((provider) => !disabled.includes(provider));
}

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
      // A group holds at most one record per provider, so a link that has grown to span seasons cannot chain them together.
      const candidates = groups.flatMap((group, index) => !group.some((item) => item.provider === source.provider) && (linked(group, [source], links) || group.some((item) => [...sourceKeys(item)].some((key) => keys.has(key)))) ? [index] : []);
      const indexes = candidates.filter((index, position) => candidates.slice(0, position).every((earlier) => !groups[earlier].some((item) => groups[index].some((other) => other.provider === item.provider))));
      if (indexes.length === 0) groups.push([source]);
      else {
        const combined = [...groups[indexes[0]], source, ...indexes.slice(1).flatMap((index) => groups[index])]
          .filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index);
        groups[indexes[0]] = combined;
        for (const index of indexes.slice(1).sort((a, b) => b - a)) groups.splice(index, 1);
      }
    }
  }
  // A second pass joins records the exact alias match missed but that clearly name the same season of one franchise.
  for (let left = 0; left < groups.length; left += 1) {
    for (let right = groups.length - 1; right > left; right -= 1) {
      const a = groups[left], b = groups[right];
      if (a.some((source) => b.some((other) => other.provider === source.provider))) continue;
      if (likelyDuplicate(asResult(a), asResult(b))) { groups[left] = [...a, ...b]; groups.splice(right, 1); }
    }
  }
  return groups.map((sources) => {
    const primary = sources.find((source) => source.provider === "aniwave") ?? sources[0];
    const english = sources.find((source) => source.provider === "aniwave")?.title ?? sources.find((source) => source.provider === "anidb")?.title ?? sources.find((source) => source.provider === "hianime")?.title ?? primary.title;
    return { id: primary.id, title: english, poster: primary.poster ?? sources.find((source) => source.poster)?.poster, provider: primary.provider, sources };
  });
}

const asResult = (sources: AnimeSource[]): AnimeResult => ({ id: sources[0].id, title: sources[0].title, provider: sources[0].provider, sources });

/** How confidently a search hit on another provider names the same anime: by a shared alias, or by franchise and season. */
export function sourceMatch(anime: AnimeResult | LibraryEntry, candidate: AnimeResult): "exact" | "likely" | undefined {
  const keys = new Set(animeSources(anime).flatMap((source) => [...sourceKeys(source)]));
  if (animeSources(candidate).some((source) => [...sourceKeys(source)].some((key) => keys.has(key)))) return "exact";
  return likelyDuplicate(anime, candidate) ? "likely" : undefined;
}

/** Add every record a remembered link ties to this anime, so library entries and player state see all sources. */
export function expandWithLinks(anime: AnimeResult, links: string[][]): AnimeResult {
  const known = animeSources(anime);
  const ids = new Set(known.map((source) => source.id));
  const linkedIds = links.filter((group) => group.some((id) => ids.has(id))).flat().filter((id) => !ids.has(id));
  if (linkedIds.length === 0) return anime;
  const merged = [...known];
  for (const id of linkedIds) {
    const provider = providerFromId(id);
    if (!merged.some((source) => source.provider === provider)) merged.push({ id, provider, title: anime.title, aliases: [anime.title] });
  }
  return merged.length > known.length ? { ...anime, sources: merged } : anime;
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
