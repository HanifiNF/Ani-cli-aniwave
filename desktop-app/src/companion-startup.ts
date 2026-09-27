import type { EpisodeUpdateStatus, LibraryEntry } from "../shared/contracts";
import type { CompanionEvent } from "./companion-dialogue";

export type CompanionPrompt = Omit<CompanionEvent, "id">;

/** Only existing local records are consulted; this never requests a provider. */
export function companionStartupPrompts(status: EpisodeUpdateStatus | undefined, history: LibraryEntry[]): CompanionPrompt[] {
  const prompts: CompanionPrompt[] = [];
  const unread = (status?.updates ?? []).filter((update) => !update.readAt).sort((a, b) => b.detectedAt - a.detectedAt);
  if (unread.length) {
    const latest = unread[0];
    prompts.push({ kind: "startup-update", title: latest.title, episode: latest.episodeNumber, otherCount: unread.length - 1, targetId: latest.id });
  }
  const recent = [...history].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  if (recent) prompts.push({ kind: "startup-continue", title: recent.title, targetId: recent.animeId });
  return prompts;
}
