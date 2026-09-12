export type TranslationMode = "sub" | "dub";
export type ProviderPreference = "auto" | "aniwave" | "anidb" | "hianime";
export type ProviderName = Exclude<ProviderPreference, "auto">;
export type ThemePreset = "graphite" | "paper" | "nord" | "gruvbox" | "mocha" | "solarized-light" | "custom";
export type PlaybackTarget = "builtin" | "external";
/** Where the docked mini player sits while the user browses. */
export type MiniPlayerCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export const MINI_PLAYER_CORNERS: readonly MiniPlayerCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
/** Width of the docked mini player in pixels. Height follows the 16:9 video plus its bar. */
export const MINI_PLAYER_WIDTH = { min: 240, max: 960, default: 400, step: 40 } as const;
export const clampMiniPlayerWidth = (value: unknown, max: number = MINI_PLAYER_WIDTH.max): number => {
  const ceiling = Math.max(MINI_PLAYER_WIDTH.min, Math.min(max, MINI_PLAYER_WIDTH.max));
  return typeof value === "number" && Number.isFinite(value) ? Math.round(Math.min(Math.max(value, MINI_PLAYER_WIDTH.min), ceiling)) : MINI_PLAYER_WIDTH.default;
};

export interface AnimeSource {
  id: string;
  provider: ProviderName;
  title: string;
  aliases: string[];
  poster?: string;
}

export interface AnimeResult {
  id: string;
  title: string;
  poster?: string;
  provider: ProviderName;
  sources?: AnimeSource[];
}

export interface Episode {
  id: string;
  number: string;
  provider: ProviderName;
}

export interface EpisodeGroup {
  provider: ProviderName;
  episodes: Episode[];
  error?: string;
  refreshing?: boolean;
}

export interface EpisodeCatalog { groups: EpisodeGroup[]; }

export interface CatalogRequest { id: string; priority?: "playback" | "selected" | "visible" | "nearby"; refresh?: boolean; }
export interface CatalogProgress<T> { value: T; pending: ProviderName[]; errors: Partial<Record<ProviderName, string>>; }
/** Availability advertised by a supported provider server; playback is verified separately. */
export interface EpisodeAvailability { sub: boolean; dub: boolean; checkedAt: number; }

export interface ProviderProgress {
  lastEpisode: string;
  mode: TranslationMode;
  updatedAt: string;
  completed?: boolean;
}

export interface Stream {
  quality: string;
  url: string;
  masterUrl?: string;
  provider: ProviderName;
  server?: string;
  referrer?: string;
  textTracks?: TextTrackSource[];
}

export interface TextTrackSource {
  src: string;
  label: string;
  lang: string;
  default?: boolean;
}

export interface LibraryEntry {
  animeId: string;
  title: string;
  lastEpisode: string;
  mode: TranslationMode;
  updatedAt: string;
  poster?: string;
  sources?: AnimeSource[];
  lastProvider?: ProviderName;
  progressByProvider?: Partial<Record<ProviderName, ProviderProgress>>;
  completed?: boolean;
}

/** Three colours define a theme; every other tone is mixed from background and text. */
export interface CustomTheme {
  background: string;
  text: string;
  highlight: string;
}

export interface Settings {
  playerPath: string;
  playbackTarget: PlaybackTarget;
  startPlayerFullscreen: boolean;
  autoplayNext?: boolean;
  miniPlayerCorner?: MiniPlayerCorner;
  miniPlayerWidth?: number;
  playerDiagnostics?: boolean;
  preferredQuality: string;
  preferredMode: TranslationMode;
  preferredProvider: ProviderPreference;
  aniwaveBaseUrl: string;
  anidbBaseUrl: string;
  hianimeBaseUrl: string;
  theme: ThemePreset;
  customTheme: CustomTheme;
}

export interface PersistedState {
  bookmarks: LibraryEntry[];
  history: LibraryEntry[];
  settings: Settings;
  providerLinks?: string[][];
  dismissedMergeKeys?: string[];
  playerPreferences?: PlayerPreferences;
  playbackPositions?: Record<string, PlaybackPosition>;
}

export interface PlayRequest {
  url: string;
  title: string;
  referrer?: string;
  textTracks?: TextTrackSource[];
  episode?: { id: string; entry: LibraryEntry };
}

export interface PlayerPreferences {
  volume?: number;
  muted?: boolean;
  rate?: number;
  captions?: boolean;
  lang?: string | null;
}

export interface PlaybackPosition { time: number; completed: boolean; updatedAt: string; animeId?: string; }
export interface PlayerStorageUpdate extends PlayerPreferences { time?: number; completed?: boolean; }
export type PlayerCommand = "play-pause" | "seek-backward" | "seek-forward" | "volume-up" | "volume-down" | "mute" | "captions" | "speed-up" | "speed-down" | "pip" | "fullscreen" | "shortcuts";

export interface AniDesktopApi {
  player: AniPlayerApi;
  search(query: string, provider?: ProviderPreference, request?: CatalogRequest, onUpdate?: (progress: CatalogProgress<AnimeResult[]>) => void): Promise<AnimeResult[]>;
  episodes(anime: AnimeResult, request?: CatalogRequest, onUpdate?: (catalog: EpisodeCatalog) => void): Promise<EpisodeCatalog>;
  /** Look the anime up on every provider it is not yet known on, remembering confident matches. */
  resolveSources(anime: AnimeResult, request?: CatalogRequest, onUpdate?: (progress: CatalogProgress<AnimeResult>) => void): Promise<AnimeResult>;
  streams(episodeId: string, mode: TranslationMode, request?: CatalogRequest): Promise<Stream[]>;
  availability(episodeId: string, request?: CatalogRequest): Promise<EpisodeAvailability>;
  cancelCatalog(requestId: string): void;
  play(request: PlayRequest): Promise<boolean>;
  getState(): Promise<PersistedState>;
  saveSettings(settings: Settings): Promise<PersistedState>;
  openPlayerLogs(): Promise<void>;
  setAppIcon(pngDataUrl: string): Promise<void>;
  toggleBookmark(entry: LibraryEntry): Promise<PersistedState>;
  removeBookmark(animeId: string): Promise<PersistedState>;
  recordHistory(entry: LibraryEntry): Promise<PersistedState>;
  removeHistory(animeId: string): Promise<PersistedState>;
  clearHistory(): Promise<PersistedState>;
  /** Forget every remembered provider link, automatic and manual. */
  clearSourceLinks(): Promise<PersistedState>;
  remapEntry(oldAnimeId: string, replacement: AnimeResult): Promise<PersistedState>;
  linkSources(sourceIds: string[]): Promise<PersistedState>;
  mergeEntries(firstAnimeId: string, secondAnimeId: string): Promise<PersistedState>;
  dismissMerge(firstAnimeId: string, secondAnimeId: string): Promise<PersistedState>;
}

export interface PlayerSession {
  id: string;
  request: PlayRequest;
  canOpenExternal: boolean;
  fullscreen: boolean;
  preferences: PlayerPreferences;
  position?: PlaybackPosition;
  diagnostics?: boolean;
}

/** Built-in playback inside the main window. A session describes one stream loaded into the player screen. */
export interface AniPlayerApi {
  /** The active session, if the main process is holding one for this window. */
  ready(): Promise<PlayerSession | undefined>;
  onLoad(listener: (session: PlayerSession) => void): () => void;
  onFullscreenChange(listener: (fullscreen: boolean) => void): () => void;
  onCommand(listener: (command: PlayerCommand) => void): () => void;
  onNotice(listener: (message: string) => void): () => void;
  onDiagnosticsChange(listener: (enabled: boolean) => void): () => void;
  logDiagnostic(sessionId: string, record: Record<string, unknown>): void;
  saveStorage(sessionId: string, update: PlayerStorageUpdate): Promise<void>;
  setFullscreen(fullscreen: boolean): Promise<boolean>;
  openExternal(): Promise<boolean>;
  /** Tell the main process whether the player screen is showing, so menus and diagnostics follow it. */
  setActive(active: boolean): Promise<void>;
}
