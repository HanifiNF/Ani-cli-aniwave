import type { AnimeResult, Episode, TranslationMode } from "../shared/contracts";

export interface PlayStatus { episode: Episode; phase: "finding" | "opening" | "opened" | "failed"; detail: string; }
/** What the player is showing, captured when playback starts so browsing elsewhere does not change it. */
export interface NowPlaying { episodeId: string; detail: string; mode: TranslationMode; anime: AnimeResult; episodes: Episode[]; }
