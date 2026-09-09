export type TranslationMode = "sub" | "dub";
export type ProviderPreference = "auto" | "aniwave" | "anidb";
export type ProviderName = Exclude<ProviderPreference, "auto">;
export type ThemePreset = "graphite" | "paper" | "nord" | "gruvbox" | "mocha" | "solarized-light" | "custom";
export type PlaybackTarget = "builtin" | "external";

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
}

export interface EpisodeCatalog { groups: EpisodeGroup[]; }

export interface ProviderProgress {
  lastEpisode: string;
  mode: TranslationMode;
  updatedAt: string;
}

export interface Stream {
  quality: string;
  url: string;
  masterUrl?: string;
  provider: ProviderName;
  server?: string;
  referrer?: string;
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
  preferredQuality: string;
  preferredMode: TranslationMode;
  preferredProvider: ProviderPreference;
  aniwaveBaseUrl: string;
  anidbBaseUrl: string;
  theme: ThemePreset;
  customTheme: CustomTheme;
}

export interface PersistedState {
  bookmarks: LibraryEntry[];
  history: LibraryEntry[];
  settings: Settings;
  providerLinks?: string[][];
  dismissedMergeKeys?: string[];
}

export interface PlayRequest {
  url: string;
  title: string;
  referrer?: string;
}

export interface AniDesktopApi {
  search(query: string, provider?: ProviderPreference): Promise<AnimeResult[]>;
  episodes(anime: AnimeResult): Promise<EpisodeCatalog>;
  streams(episodeId: string, mode: TranslationMode): Promise<Stream[]>;
  play(request: PlayRequest): Promise<boolean>;
  getState(): Promise<PersistedState>;
  saveSettings(settings: Settings): Promise<PersistedState>;
  setAppIcon(pngDataUrl: string): Promise<void>;
  toggleBookmark(entry: LibraryEntry): Promise<PersistedState>;
  removeBookmark(animeId: string): Promise<PersistedState>;
  recordHistory(entry: LibraryEntry): Promise<PersistedState>;
  removeHistory(animeId: string): Promise<PersistedState>;
  clearHistory(): Promise<PersistedState>;
  remapEntry(oldAnimeId: string, replacement: AnimeResult): Promise<PersistedState>;
  linkSources(sourceIds: string[]): Promise<PersistedState>;
  mergeEntries(firstAnimeId: string, secondAnimeId: string): Promise<PersistedState>;
  dismissMerge(firstAnimeId: string, secondAnimeId: string): Promise<PersistedState>;
}

export interface PlayerSession {
  request: PlayRequest;
  canOpenExternal: boolean;
}

export interface AniPlayerApi {
  ready(): Promise<PlayerSession>;
  onLoad(listener: (session: PlayerSession) => void): () => void;
  openExternal(): Promise<boolean>;
  close(): Promise<void>;
}
