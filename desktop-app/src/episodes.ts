import type { Episode, EpisodeGroup, LibraryEntry, ProviderName } from "../shared/contracts";
import { PROVIDER_NAMES } from "../shared/catalog";

/** One source row in the grouped episode list. */
export interface EpisodeRow { episode: Episode; number: string; watched: boolean; first: boolean; }
export type EpisodeFilter = "all" | "unwatched" | "watched";
export type EpisodeSort = "newest" | "oldest";

export const episodeValue = (number: string): number => { const value = Number.parseFloat(number); return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY; };

/** Watched state of one episode on one provider, from that provider's progress or the entry's overall progress. */
function watchedOn(progress: LibraryEntry | undefined, episode: Episode): boolean {
  if (!progress) return false;
  const source = progress.progressByProvider?.[episode.provider];
  const last = source?.lastEpisode ?? (progress.lastProvider === undefined || progress.lastProvider === episode.provider ? progress.lastEpisode : undefined);
  if (last === undefined) return false;
  const completed = source ? source.completed !== false : progress.completed !== false;
  return episodeValue(episode.number) < episodeValue(last) || (episode.number === last && completed);
}

/** Flatten provider lists into one list grouped by episode number, sorted and filtered for display. */
export function episodeRowsOf(groups: EpisodeGroup[], progress: LibraryEntry | undefined, filter: EpisodeFilter, sort: EpisodeSort): EpisodeRow[] {
  const byNumber = new Map<string, Episode[]>();
  for (const provider of PROVIDER_NAMES) {
    for (const episode of groups.find((group) => group.provider === provider)?.episodes ?? []) {
      const list = byNumber.get(episode.number) ?? [];
      list.push(episode);
      byNumber.set(episode.number, list);
    }
  }
  const numbers = [...byNumber.keys()].sort((a, b) => episodeValue(a) - episodeValue(b) || a.localeCompare(b));
  if (sort === "newest") numbers.reverse();
  const rows: EpisodeRow[] = [];
  for (const number of numbers) {
    let first = true;
    for (const episode of byNumber.get(number)!) {
      const watched = watchedOn(progress, episode);
      if (filter === "watched" ? !watched : filter === "unwatched" ? watched : false) continue;
      rows.push({ episode, number, watched, first });
      first = false;
    }
  }
  return rows;
}

/** The row a returning viewer should land on: the episode after their progress on the provider they used last. */
export function nextUpIndex(rows: EpisodeRow[], groups: EpisodeGroup[], progress: LibraryEntry | undefined, preferred: ProviderName, resumeAfter?: string): number {
  const available = groups.filter((group) => group.episodes.length);
  const provider = available.find((group) => group.provider === preferred)?.provider ?? PROVIDER_NAMES.find((name) => available.some((group) => group.provider === name)) ?? available[0]?.provider;
  if (!provider) return 0;
  const list = [...(groups.find((group) => group.provider === provider)?.episodes ?? [])].sort((a, b) => episodeValue(a.number) - episodeValue(b.number));
  const source = progress?.progressByProvider?.[provider];
  // Entries written before per-provider progress existed carry no provider, so their episode applies to any source.
  const after = source?.lastEpisode ?? resumeAfter ?? (progress && (progress.lastProvider === undefined || progress.lastProvider === provider) ? progress.lastEpisode : undefined);
  let target = list[0];
  if (after) {
    const previous = list.findIndex((episode) => episode.number === after);
    const completed = source ? source.completed !== false : progress?.completed !== false;
    target = list[Math.max(0, Math.min(previous + (completed ? 1 : 0), list.length - 1))];
  }
  const exact = target ? rows.findIndex((row) => row.episode.id === target.id) : -1;
  if (exact >= 0) return exact;
  const sameNumber = target ? rows.findIndex((row) => row.number === target.number) : -1;
  return Math.max(0, sameNumber);
}

/** Episodes on one provider in playing order. */
export const providerList = (groups: EpisodeGroup[], provider: ProviderName): Episode[] =>
  [...(groups.find((group) => group.provider === provider)?.episodes ?? [])].sort((a, b) => episodeValue(a.number) - episodeValue(b.number));
