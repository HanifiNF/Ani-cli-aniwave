import type { AnimeResult, Episode, EpisodeGroup, LibraryEntry, ProviderName, TranslationMode } from "../shared/contracts";
import { animeSources, providerFromId } from "../shared/catalog";
import { providerList } from "./episodes";

export type LibraryKind = "continue" | "saved" | "recent";
export interface LibraryRow { kind: LibraryKind; entry: LibraryEntry; anime?: never; }
export type Row = LibraryRow | { kind: "results"; anime: AnimeResult; entry?: never };

export const asAnime = (entry: LibraryEntry): AnimeResult => ({ id: entry.animeId, title: entry.title, poster: entry.poster, provider: entry.lastProvider ?? providerFromId(entry.animeId), sources: animeSources(entry) });

export function libraryEntry(anime: AnimeResult, episode: Episode | undefined, mode: TranslationMode): LibraryEntry {
  const lastProvider = episode?.provider ?? anime.provider;
  const updatedAt = new Date().toISOString();
  const lastEpisode = episode?.number ?? "1";
  return { animeId: anime.id, title: anime.title, lastEpisode, mode, updatedAt, poster: anime.poster, sources: animeSources(anime), lastProvider, progressByProvider: { [lastProvider]: { lastEpisode, lastEpisodeId: episode?.id, mode, updatedAt } } };
}

/** An entry recording the final episode on every provider that lists any, so the whole series shows as watched. */
export function libraryEntryAllWatched(anime: AnimeResult, groups: EpisodeGroup[], mode: TranslationMode, preferred?: ProviderName): LibraryEntry | undefined {
  const updatedAt = new Date().toISOString();
  const progressByProvider: NonNullable<LibraryEntry["progressByProvider"]> = {};
  for (const group of groups) {
    const last = providerList(groups, group.provider).at(-1);
    if (last) progressByProvider[group.provider] = { lastEpisode: last.number, lastEpisodeId: last.id, mode, updatedAt, completed: true };
  }
  const providers = Object.keys(progressByProvider) as ProviderName[];
  const lastProvider = providers.includes(preferred ?? anime.provider) ? preferred ?? anime.provider : providers[0];
  if (!lastProvider) return undefined;
  return { animeId: anime.id, title: anime.title, lastEpisode: progressByProvider[lastProvider]!.lastEpisode, mode, updatedAt, completed: true, poster: anime.poster, sources: animeSources(anime), lastProvider, progressByProvider };
}
