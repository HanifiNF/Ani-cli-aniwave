export type TranslationMode = "sub" | "dub";
export type ProviderPreference = "auto" | "aniwave" | "anidb";
export type ProviderName = Exclude<ProviderPreference, "auto">;
export type ThemePreset = "graphite" | "paper" | "nord" | "gruvbox" | "mocha" | "solarized-light" | "custom";

export interface AnimeResult {
  id: string;
  title: string;
  poster?: string;
  provider: ProviderName;
}

export interface Episode {
  id: string;
  number: string;
}

export interface Stream {
  quality: string;
  url: string;
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
}

/** Three colours define a theme; every other tone is mixed from background and text. */
export interface CustomTheme {
  background: string;
  text: string;
  highlight: string;
}

export interface Settings {
  playerPath: string;
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
}

export interface PlayRequest {
  url: string;
  title: string;
  referrer?: string;
}

export interface AniDesktopApi {
  search(query: string, provider?: ProviderPreference): Promise<AnimeResult[]>;
  episodes(animeId: string): Promise<Episode[]>;
  streams(episodeId: string, mode: TranslationMode): Promise<Stream[]>;
  play(request: PlayRequest): Promise<boolean>;
  getState(): Promise<PersistedState>;
  saveSettings(settings: Settings): Promise<PersistedState>;
  toggleBookmark(entry: LibraryEntry): Promise<PersistedState>;
  removeBookmark(animeId: string): Promise<PersistedState>;
  recordHistory(entry: LibraryEntry): Promise<PersistedState>;
  removeHistory(animeId: string): Promise<PersistedState>;
  clearHistory(): Promise<PersistedState>;
  remapEntry(oldAnimeId: string, replacement: AnimeResult): Promise<PersistedState>;
}
