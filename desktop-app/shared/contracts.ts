import type { PlayerDiagnosticRecord } from "./player-diagnostics";
import type { CompanionPreferences } from "./companion";

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

/** Distribution format, normalised across providers and indexes. */
export type MediaType = "TV" | "MOVIE" | "OVA" | "ONA" | "SPECIAL" | "MUSIC";
export type WorkStatus = "finished" | "ongoing" | "upcoming" | "unknown";

export interface AnimeSource {
  id: string;
  provider: ProviderName;
  title: string;
  aliases: string[];
  poster?: string;
  /** Facts the provider states on its search card; used to veto or confirm identity matches. */
  type?: MediaType;
  episodes?: number;
  year?: number;
  /** External references the provider itself states, such as "mal:51367". */
  refs?: string[];
}

export interface AnimeResult {
  id: string;
  title: string;
  poster?: string;
  provider: ProviderName;
  sources?: AnimeSource[];
  /** App-owned identity this row is bound to, when known. */
  workId?: string;
  /** External references known for the whole row, such as "mal:51367" or "anilist:146722". */
  refs?: string[];
  /** Set when provider records were grouped by title alone rather than a shared reference or alias. */
  tentative?: boolean;
}

/**
 * One anime as the app knows it, independent of any provider. Library entries and caches key on works; provider
 * records are bound to them and can be replaced without losing history.
 */
export interface Work {
  id: string;
  title: string;
  refs: string[];
  /** Provider record ids bound to this work. Several records from one provider are variants of the same anime. */
  records: string[];
  type?: MediaType;
  year?: number;
  episodes?: number;
  /** Bound by title matching only; a reference or a manual merge clears this. */
  tentative?: boolean;
  updatedAt: string;
}

/** A work as an index or metadata service describes it, used to bind provider records at search time. */
export interface IdentityCandidate {
  refs: string[];
  title: string;
  titles: string[];
  type?: MediaType;
  year?: number;
  episodes?: number;
  status?: WorkStatus;
}

/** Identified catalogue entry used only to discover streaming sources. */
export interface BrowseIdentity extends IdentityCandidate {
  titleVariants?: { english?: string; romaji?: string; native?: string };
}
export interface BrowseDiscoveryResult {
  anime?: AnimeResult;
  errors: Partial<Record<ProviderName, string>>;
}

export interface WorkRelation { relation: string; refs: string[]; title: string; type?: MediaType; }
export interface WorkInfo {
  refs: string[];
  title: string;
  titles: { romaji?: string; english?: string; native?: string };
  synonyms: string[];
  type?: MediaType;
  episodes?: number;
  year?: number;
  season?: string;
  status: WorkStatus;
  genres: string[];
  /** Non-spoiler AniList tags; absent in older cached information. */
  tags?: string[];
  studios: string[];
  /** Average score on a 0–100 scale. */
  score?: number;
  description?: string;
  cover?: string;
  banner?: string;
  nextAiring?: { episode: number; airingAt: number };
  relations: WorkRelation[];
  fetchedAt: number;
  source: "anilist";
  /** Shown from cache while a refresh runs or after one fails. */
  stale?: boolean;
  error?: string;
}

/** "match" orders a title search by closeness and needs a search term. */
export type BrowseSort = "match" | "popularity" | "score" | "newest" | "title";
/** A company AniList credits. Only some of them animate; the rest fund or distribute. */
export interface BrowseStudio { id: number; name: string; animation: boolean; }
export interface BrowseFilters {
  includeGenres: string[];
  excludeGenres: string[];
  year?: number;
  season?: "winter" | "spring" | "summer" | "fall";
  status?: Exclude<WorkStatus, "unknown">;
  format?: MediaType;
  minimumScore?: number;
  minimumEpisodes?: number;
  maximumEpisodes?: number;
  /** Matches English, romaji, and native titles and synonyms. */
  search?: string;
  tags?: string[];
  studio?: BrowseStudio;
  sort: BrowseSort;
}
/** An AniList catalog entry. It deliberately has no streaming-provider id. */
export interface BrowseAnime {
  anilistId: number;
  refs: string[];
  title: string;
  titles: string[];
  titleVariants?: BrowseIdentity["titleVariants"];
  cover?: string;
  genres: string[];
  type?: MediaType;
  year?: number;
  season?: string;
  status: WorkStatus;
  score?: number;
  episodes?: number;
  description?: string;
  studios: string[];
}
export interface BrowseQuery { filters: BrowseFilters; page: number; }
export interface BrowseResult {
  query: BrowseQuery;
  entries: BrowseAnime[];
  hasNextPage: boolean;
  /** Studios whose names match the search term; first page of a title search only. */
  studios?: BrowseStudio[];
  fetchedAt: number;
  cached?: boolean;
  stale?: boolean;
  error?: string;
  retryAt?: number;
}

/** Sent while a studio's list of works is read for the first time: how far it is, and its most popular works to show meanwhile. */
export interface BrowseProgress { studio: string; read: number; entries?: BrowseAnime[]; }

export interface IdentityIndexStatus {
  enabled: boolean;
  entries: number;
  updatedAt?: number;
  updating: boolean;
  error?: string;
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

export interface ProviderSeriesMetadata {
  sourceId: string;
  provider: ProviderName;
  genres: string[];
  /** Episodes currently listed by this provider. */
  availableEpisodes?: number;
  /** A separately advertised season total; never inferred from episode lists. */
  announcedEpisodes?: number;
  checkedAt: number;
  stale?: boolean;
  error?: string;
}

export interface SeriesMetadataCatalog {
  sources: ProviderSeriesMetadata[];
  /** Case-insensitively deduplicated genres from the known enabled sources. */
  genres: string[];
}

export interface CatalogRequest { id: string; priority?: "playback" | "selected" | "visible" | "nearby"; refresh?: boolean; checkNow?: boolean; }
export interface SourceHealthStatus {
  state: "unknown" | "reachable" | "paused" | "checking";
  checkedAt?: number;
  retryAt?: number;
  canRetry: boolean;
  serverRequested?: boolean;
}
export interface ProviderSourceStatus extends SourceHealthStatus { provider: ProviderName; origin: string; }
export interface CatalogProgress<T> { value: T; pending: ProviderName[]; errors: Partial<Record<ProviderName, string>>; }

export interface ScheduleQuery {
  /** Local calendar date in YYYY-MM-DD form. */
  date: string;
  /** Inclusive local-day start and exclusive next-day start, serialized as UTC ISO timestamps. */
  utcStart: string;
  utcEnd: string;
  mode: TranslationMode;
}

export interface ScheduleEntry {
  anime: AnimeResult;
  episode: Episode;
  releaseAt: string;
  /** Original provider clock label; use releaseAt to display the user's local time. */
  timeLabel: string;
}

export interface ScheduleResult {
  provider: "aniwave";
  requestedDate: string;
  entries: ScheduleEntry[];
  refreshedAt: string;
  status: "fresh" | "stale" | "unavailable";
  error?: string;
}

export interface ScheduleArtwork {
  animeId: string;
  title?: string;
  aliases: string[];
  poster?: string;
}
/** Availability advertised by a supported provider server; playback is verified separately. */
export interface EpisodeAvailability { sub: boolean; dub: boolean; checkedAt: number; }
export interface EpisodeQuality { quality?: string; checkedAt: number; }
export interface CachedEpisodeMetadata {
  availability?: EpisodeAvailability;
  qualities: Partial<Record<TranslationMode, EpisodeQuality>>;
}

export interface BookmarkMetadataProgress {
  state: "running" | "cancelling" | "completed" | "cancelled" | "failed";
  error?: string;
  seriesTotal: number;
  seriesDone: number;
  currentSeries?: string;
  episodesDone: number;
  cachedEpisodes: number;
  updatedEpisodes: number;
  failedEpisodes: number;
  skippedSources: ProviderName[];
}

export interface ProviderProgress {
  lastEpisode: string;
  lastEpisodeId?: string;
  mode: TranslationMode;
  updatedAt: string;
  completed?: boolean;
}

export interface Stream {
  quality: string;
  url: string;
  masterUrl?: string;
  provider: ProviderName;
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

export interface Settings extends CompanionPreferences {
  playerPath: string;
  playbackTarget: PlaybackTarget;
  startPlayerFullscreen: boolean;
  autoplayNext?: boolean;
  miniPlayerCorner?: MiniPlayerCorner;
  miniPlayerWidth?: number;
  playerDiagnostics?: boolean;
  desktopEpisodeNotifications?: boolean;
  preferredQuality: string;
  preferredMode: TranslationMode;
  preferredProvider: ProviderPreference;
  aniwaveBaseUrl: string;
  anidbBaseUrl: string;
  hianimeBaseUrl: string;
  /** Providers left out of search, lookup, and episode loading. Every provider is on unless listed here. */
  disabledSources?: ProviderName[];
  /** Ask AniList for identity and series information. Off keeps every request to the streaming sources. */
  animeInfo?: boolean;
  /** Keep a local copy of the anime-offline-database for identity matching without network requests. */
  offlineIndex?: boolean;
  /** Show an illustration behind the home, browse, saved, and recent pages. On unless turned off. */
  emptyBackdrop?: boolean;
  theme: ThemePreset;
  customTheme: CustomTheme;
}

export type BackdropKind = "wide" | "portrait";
/** One illustration for a page backdrop, served from the app's own cache. */
export interface BackdropArt {
  id: number;
  kind: BackdropKind;
  /** A data URL of the cached image file. */
  src: string;
  sourceUrl?: string;
  artist?: string;
  /** The dominant colour is pale, so the page shows the image fainter than a dark one. */
  light?: boolean;
}

export interface PersistedState {
  bookmarks: LibraryEntry[];
  history: LibraryEntry[];
  settings: Settings;
  /** Provider records grouped by work; derived from `works` for older code paths. */
  providerLinks?: string[][];
  works?: Work[];
  dismissedMergeKeys?: string[];
  playerPreferences?: PlayerPreferences;
  subtitleAppearance?: SubtitleAppearance;
  playbackPositions?: Record<string, PlaybackPosition>;
}

export interface EpisodeUpdate {
  id: string;
  animeId: string;
  title: string;
  sourceId: string;
  provider: ProviderName;
  episodeId: string;
  episodeNumber: string;
  detectedAt: number;
  readAt?: number;
}

export interface EpisodeUpdateStatus {
  updates: EpisodeUpdate[];
  unreadCount: number;
  counts: Record<string, number>;
  latestByAnime: Record<string, number>;
  checking: boolean;
  checkedAt?: number;
  error?: string;
}

export type UpdateState = "development" | "current" | "available" | "error";

export interface UpdateInstallStatus {
  mode: "automatic" | "native" | "manual" | "unsupported";
  phase: "idle" | "downloading" | "ready" | "installing" | "error";
  detail: string;
  version?: string;
  percent?: number;
  error?: string;
}

export interface UpdateStatus {
  currentVersion: string;
  latestVersion?: string;
  state: UpdateState;
  checkedAt?: number;
  stale?: boolean;
  dismissed?: boolean;
  error?: string;
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

export interface SubtitleAppearance {
  font: "sans" | "serif" | "mono";
  size: number;
  textColor: string;
  backgroundEnabled: boolean;
  backgroundColor: string;
  backgroundOpacity: number;
  edge: "none" | "outline" | "shadow";
  bottomInset: number;
}

export interface PlaybackPosition { time: number; completed: boolean; updatedAt: string; animeId?: string; }
export interface PlayerStorageUpdate extends PlayerPreferences { time?: number; completed?: boolean; }
export type PlayerCommand = "play-pause" | "seek-backward" | "seek-forward" | "volume-up" | "volume-down" | "mute" | "captions" | "speed-up" | "speed-down" | "pip" | "fullscreen" | "shortcuts";

export interface AniDesktopApi {
  player: AniPlayerApi;
  /** `known` names a work the caller has already identified, so matching rows carry its references without a title lookup. */
  search(query: string, provider?: ProviderPreference, request?: CatalogRequest, onUpdate?: (progress: CatalogProgress<AnimeResult[]>) => void, known?: IdentityCandidate): Promise<AnimeResult[]>;
  browseGenres(request?: CatalogRequest): Promise<string[]>;
  browseTags(request?: CatalogRequest): Promise<string[]>;
  browse(query: BrowseQuery, request?: CatalogRequest, onUpdate?: (progress: BrowseProgress) => void): Promise<BrowseResult>;
  discoverBrowse(anime: BrowseIdentity, request?: CatalogRequest): Promise<BrowseDiscoveryResult>;
  episodes(anime: AnimeResult, request?: CatalogRequest, onUpdate?: (catalog: EpisodeCatalog) => void): Promise<EpisodeCatalog>;
  seriesMetadata(anime: AnimeResult, request?: CatalogRequest, onUpdate?: (catalog: SeriesMetadataCatalog) => void): Promise<SeriesMetadataCatalog>;
  /** Look the anime up on every provider it is not yet known on, remembering confident matches. */
  resolveSources(anime: AnimeResult, request?: CatalogRequest, onUpdate?: (progress: CatalogProgress<AnimeResult>) => void): Promise<AnimeResult>;
  /** Series information for the work behind an anime, from cache first and then a metadata service. */
  workInfo(anime: AnimeResult, request?: CatalogRequest, onUpdate?: (info: WorkInfo) => void): Promise<WorkInfo | undefined>;
  identityIndexStatus(): Promise<IdentityIndexStatus>;
  updateIdentityIndex(): Promise<IdentityIndexStatus>;
  streams(episodeId: string, mode: TranslationMode, request?: CatalogRequest): Promise<Stream[]>;
  availability(episodeId: string, request?: CatalogRequest): Promise<EpisodeAvailability>;
  episodeMetadata(episodeId: string): Promise<CachedEpisodeMetadata | undefined>;
  clearEpisodeMetadata(episodeIds: string[]): Promise<void>;
  /** Starts one app-owned background job, or returns the current job if already running. */
  fetchBookmarkMetadata(): Promise<BookmarkMetadataProgress>;
  bookmarkMetadataStatus(): Promise<BookmarkMetadataProgress | undefined>;
  cancelBookmarkMetadata(): Promise<BookmarkMetadataProgress | undefined>;
  sourceStatus(): Promise<ProviderSourceStatus[]>;
  checkSource(provider: ProviderName, request?: CatalogRequest): Promise<void>;
  schedule(query: ScheduleQuery, request?: CatalogRequest): Promise<ScheduleResult>;
  scheduleArtwork(animeId: string, request?: CatalogRequest): Promise<ScheduleArtwork>;
  /** An illustration for a page backdrop, or nothing when the setting is off or no image is available. */
  backdropArt(kind: BackdropKind): Promise<BackdropArt | undefined>;
  cancelCatalog(requestId: string): void;
  play(request: PlayRequest): Promise<boolean>;
  getState(): Promise<PersistedState>;
  episodeUpdates(): Promise<EpisodeUpdateStatus>;
  checkEpisodeUpdates(force?: boolean): Promise<EpisodeUpdateStatus>;
  dismissEpisodeUpdate(id?: string): Promise<EpisodeUpdateStatus>;
  markEpisodeUpdateRead(id?: string): Promise<EpisodeUpdateStatus>;
  onEpisodeUpdatesChange(listener: (status: EpisodeUpdateStatus) => void): () => void;
  onOpenEpisodeUpdates(listener: () => void): () => void;
  saveSettings(settings: Settings): Promise<PersistedState>;
  saveSubtitleAppearance(appearance: SubtitleAppearance): Promise<SubtitleAppearance>;
  openPlayerLogs(): Promise<void>;
  checkForUpdates(force?: boolean): Promise<UpdateStatus>;
  dismissUpdate(version: string): Promise<UpdateStatus>;
  openLatestRelease(): Promise<void>;
  getUpdateInstallStatus(): Promise<UpdateInstallStatus>;
  onUpdateInstallStatus(listener: (status: UpdateInstallStatus) => void): () => void;
  downloadUpdate(version: string): Promise<UpdateInstallStatus>;
  installUpdate(): Promise<void>;
  /** Puts plain text on the system clipboard; the renderer itself has no clipboard permission. */
  copyText(text: string): Promise<void>;
  setAppIcon(pngDataUrl: string): Promise<void>;
  toggleBookmark(entry: LibraryEntry): Promise<PersistedState>;
  removeBookmark(animeId: string): Promise<PersistedState>;
  recordHistory(entry: LibraryEntry): Promise<PersistedState>;
  removeHistory(animeId: string): Promise<PersistedState>;
  clearHistory(): Promise<PersistedState>;
  /** Forget every remembered provider link, automatic and manual. */
  clearSourceLinks(): Promise<PersistedState>;
  linkSources(sourceIds: string[]): Promise<PersistedState>;
  /** Take one provider record out of the work it was grouped with; the pair is not grouped automatically again. */
  splitSource(sourceId: string): Promise<PersistedState>;
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
  logDiagnostic(sessionId: string, record: PlayerDiagnosticRecord): void;
  saveStorage(sessionId: string, update: PlayerStorageUpdate): Promise<void>;
  setFullscreen(fullscreen: boolean): Promise<boolean>;
  openExternal(): Promise<boolean>;
  /** Tell the main process whether the player screen is showing, so menus and diagnostics follow it. */
  setActive(active: boolean): Promise<void>;
}
