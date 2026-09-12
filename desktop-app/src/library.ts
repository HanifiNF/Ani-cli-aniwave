import type { AnimeResult, Episode, LibraryEntry, TranslationMode } from "../shared/contracts";
import { animeSources, providerFromId } from "../shared/catalog";

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
