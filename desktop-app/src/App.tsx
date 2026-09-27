import { usePlayerSession } from "./usePlayerSession";
import { useUpdateInstall } from "./useUpdateInstall";
import SearchPalette from "./SearchPalette";
import SeriesScreen from "./SeriesScreen";
import { useSeriesScroll } from "./useSeriesScroll";
import type { PlayStatus, NowPlaying } from "./playback";
import SettingsScreen, { type SettingsSaveState } from "./SettingsScreen";
import LibrarySection from "./LibrarySection";
import EmptyLibrary from "./EmptyLibrary";
import { Backdrop, type BackdropPage, type BackdropVariant } from "./Backdrop";
import ScheduleSection from "./ScheduleSection";
import { asAnime, libraryEntry, libraryEntryAllWatched, type Row, type LibraryKind } from "./library";
import { shortcut } from "./keys";
import { episodeValue, episodeRowsOf, nextUpIndex, providerList, type EpisodeFilter, type EpisodeSort } from "./episodes";
import { applyTheme } from "./theme";
import { bestQuality } from "../shared/episode-metadata";
import { messageFrom } from "./errors";
import { DEFAULT_STATE, catalogScope } from "../shared/settings";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  AnimeResult,
  BackdropArt,
  BrowseAnime,
  BrowseDiscoveryResult,
  BrowseFilters,
  Episode,
  EpisodeGroup,
  EpisodeCatalog,
  CatalogProgress,
  LibraryEntry,
  MiniPlayerCorner,
  PersistedState,
  ProviderName,
  ProviderPreference,
  Settings,
  TranslationMode,
  UpdateStatus,
  EpisodeUpdateStatus,
  EpisodeUpdate
} from "../shared/contracts";
import { catalogRequestId } from "./catalog-request";
import { useEpisodeMetadata } from "./useEpisodeMetadata";
import { useAnimeSearch } from "./useAnimeSearch";
import { useSeriesMetadata } from "./useSeriesMetadata";
import { useWorkInfo } from "./useWorkInfo";
import { MINI_PLAYER_WIDTH, clampMiniPlayerWidth } from "../shared/contracts";
import { animeSources, enabledProviders, expandWithLinks, likelyDuplicate, mergeKey, overlaps, unifyAnimeResults } from "../shared/catalog";
import { Icon } from "./icons";
import { installPressDip, pressProps } from "./press";
import { useIndicator } from "./useIndicator";
import { useSearchMorph } from "./useSearchMorph";
import { launchFrom, resolveReturn, returnTo } from "./flight";
import { capturePlayer, notePlayOrigin, setPlayOrigin } from "./playerMotion";
import { SiteFooter, type FooterScreen } from "./SiteFooter";
import { updatePending } from "./UpdateUI";
import BrowseScreen, { DEFAULT_BROWSE_STATE, type BrowseViewState } from "./BrowseScreen";
import BrowseDetail from "./BrowseDetail";
import EpisodeUpdatesPanel, { EpisodeUpdatesPage, usePanelPresence } from "./EpisodeUpdatesPanel";

type Screen = "home" | "browse" | "catalog-detail" | "series" | "opening" | "saved" | "recent" | "notifications" | "settings" | "player";
// Vidstack and hls.js load with the first playback, not at startup.
const loadPlayerScreen = () => import("./PlayerScreen");
const PlayerScreen = lazy(loadPlayerScreen);
const HOME_CARDS = 8; // maximum titles shown in each home section

const playerName = (path: string): string => path.split(/[\\/]/).pop()?.replace(/\.exe$/i, "") || "player";
function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [appState, setAppState] = useState<PersistedState>(DEFAULT_STATE);
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [selectedAnime, setSelectedAnime] = useState<AnimeResult>();
  const [episodeGroups, setEpisodeGroups] = useState<EpisodeGroup[]>([]);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [episodeFilter, setEpisodeFilter] = useState<EpisodeFilter>("all");
  const [episodeSort, setEpisodeSort] = useState<EpisodeSort>("newest");
  const [jump, setJump] = useState("");
  const [cursor, setCursor] = useState(0);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string>();
  const [mode, setMode] = useState<TranslationMode>("sub");
  const [provider, setProvider] = useState<ProviderPreference>("auto"); // preferred playback source
  const [quality, setQuality] = useState("best");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [status, setStatus] = useState<PlayStatus>();
  const { session, setSession, fullscreen: playerFullscreen, setFullscreen: setPlayerFullscreen } = usePlayerSession(() => {
    notePlayOrigin();
    setScreen("player"); setStatus(undefined); setError(undefined); setNotice(undefined);
  });
  const [nowPlaying, setNowPlaying] = useState<NowPlaying>();
  const [settingsDraft, setSettingsDraft] = useState<Settings>(DEFAULT_STATE.settings);
  const [subtitleAppearance, setSubtitleAppearance] = useState(DEFAULT_STATE.subtitleAppearance!);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [sourceErrors, setSourceErrors] = useState<Partial<Record<ProviderName, string>>>({});
  const [pendingSources, setPendingSources] = useState<ProviderName[]>([]);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>();
  const [updateChecking, setUpdateChecking] = useState(false);
  const [episodeUpdateStatus, setEpisodeUpdateStatus] = useState<EpisodeUpdateStatus>();
  const [episodeInboxOpen, setEpisodeInboxOpen] = useState(false);
  const episodeInbox = usePanelPresence(episodeInboxOpen);
  // Counts rises in the unread total, so the count can grow in afresh when an episode arrives.
  const [episodeArrivals, setEpisodeArrivals] = useState(0);
  const lastUnread = useRef<number>(undefined);
  const notificationsOrigin = useRef<Screen>("home");
  const [browseState, setBrowseState] = useState<BrowseViewState>(DEFAULT_BROWSE_STATE);
  const [browseAnime, setBrowseAnime] = useState<BrowseAnime>();
  const [browseResolving, setBrowseResolving] = useState(false);
  // A title opened from the browse grid is checked in place; the token tells one attempt from the next.
  const [browseOpening, setBrowseOpening] = useState<{ id: number; token: number }>();
  const [browseResolveError, setBrowseResolveError] = useState<string>();
  const updateInstall = useUpdateInstall(setError);

  // The series page keeps the query in the field; focusing it reopens the palette over the page.
  const [seriesSearch, setSeriesSearch] = useState(false);
  const searchHere = screen === "home" || (screen === "series" && seriesSearch);
  const catalogSearch = useAnimeSearch(query, "auto",
    [appState.settings.aniwaveBaseUrl, appState.settings.anidbBaseUrl, appState.settings.hianimeBaseUrl, enabledProviders(appState.settings).join(",")], searchHere && !composing);
  const { results, lastQuery } = catalogSearch;
  const unifiedResults = useMemo(() => unifyAnimeResults(results, appState.providerLinks ?? []), [results, appState.providerLinks]);

  const fieldRef = useRef<HTMLInputElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const navIndicator = useRef<HTMLElement>(null);
  const searchBox = useRef<HTMLDivElement>(null);
  const searchSurface = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const playToken = useRef(0);
  const playbackRequest = useRef<string | undefined>(undefined);
  const seriesOrigin = useRef<"home" | "browse" | "notifications">("home");
  useEffect(() => () => { if (playbackRequest.current) window.aniDesktop.cancelCatalog(playbackRequest.current); }, []);
  useEffect(() => installPressDip(), []);
  // A card or search row that opens a title lends its poster to the series page (src/flight.ts).
  useEffect(() => {
    const launch = (event: MouseEvent) => {
      const hit = event.target instanceof Element ? event.target.closest(".card .hit, .hit-row .hit") : null;
      if (!hit) return;
      const poster = hit.querySelector(".poster, .thumb");
      launchFrom(poster);
      // A card that resumes playback is also where the player grows from.
      if (hit.matches(".card .hit")) setPlayOrigin(poster);
    };
    document.addEventListener("click", launch, true);
    return () => document.removeEventListener("click", launch, true);
  }, []);
  const mergePromptActive = useRef(false);
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => undefined);

  useEffect(() => {
    window.aniDesktop.getState().then((state) => {
      setAppState(state);
      setSubtitleAppearance(state.subtitleAppearance ?? DEFAULT_STATE.subtitleAppearance!);
      setSettingsDraft(state.settings);
      setMode(state.settings.preferredMode);
      setQuality(state.settings.preferredQuality);
      setProvider(state.settings.preferredProvider);
      setStateLoaded(true);
    }).catch((reason) => setError(messageFrom(reason)));
  }, []);
  useEffect(() => {
    void window.aniDesktop.episodeUpdates().then(setEpisodeUpdateStatus).catch(() => undefined);
    const stopChange = window.aniDesktop.onEpisodeUpdatesChange(setEpisodeUpdateStatus);
    return stopChange;
  }, []);
  useEffect(() => {
    const unread = episodeUpdateStatus?.unreadCount;
    if (unread === undefined) return;
    if (lastUnread.current !== undefined && unread > lastUnread.current) setEpisodeArrivals((count) => count + 1);
    lastUnread.current = unread;
  }, [episodeUpdateStatus?.unreadCount]);
  useEffect(() => window.aniDesktop.onOpenEpisodeUpdates(() => {
    if (screen === "player") {
      void window.aniDesktop.player.setFullscreen(false).catch(() => undefined);
      setScreen("home");
    }
    setEpisodeInboxOpen(true);
  }), [screen]);
  useEffect(() => {
    if (!episodeInboxOpen) return;
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".episode-updates-panel, .episode-updates-trigger")) setEpisodeInboxOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); setEpisodeInboxOpen(false); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); };
  }, [episodeInboxOpen]);

  // Settings apply as they change: the draft updates at once and one save follows shortly after the last edit.
  const settingsSave = useRef<{ timer?: number; pending?: Settings; failed?: Settings }>({});
  const [settingsSaveState, setSettingsSaveState] = useState<SettingsSaveState>("idle");
  const flushSettings = useCallback(async () => {
    window.clearTimeout(settingsSave.current.timer);
    const pending = settingsSave.current.pending;
    if (!pending) return;
    settingsSave.current.pending = undefined;
    try {
      const state = await window.aniDesktop.saveSettings(pending);
      setAppState(state);
      setMode(state.settings.preferredMode);
      setQuality(state.settings.preferredQuality);
      setProvider(state.settings.preferredProvider);
      if (!settingsSave.current.pending) setSettingsSaveState("saved");
    }
    catch (reason) {
      // A newer edit carries the whole draft, so only the latest refusal is worth retrying.
      if (!settingsSave.current.pending) settingsSave.current.failed = pending;
      setSettingsSaveState("error");
      setError(messageFrom(reason));
    }
  }, []);
  // "Saved" is a passing word: the heading goes quiet again shortly after.
  useEffect(() => {
    if (settingsSaveState !== "saved") return;
    const timer = window.setTimeout(() => setSettingsSaveState("idle"), 2_000);
    return () => window.clearTimeout(timer);
  }, [settingsSaveState]);
  const retrySettings = useCallback(() => {
    const failed = settingsSave.current.failed;
    if (!failed) return;
    settingsSave.current.failed = undefined;
    settingsSave.current.pending = failed;
    setError(undefined);
    setSettingsSaveState("saving");
    void flushSettings();
  }, [flushSettings]);
  const changeSettings = useCallback((next: Settings) => {
    setSettingsDraft(next);
    setError(undefined);
    settingsSave.current.pending = next;
    settingsSave.current.failed = undefined;
    setSettingsSaveState("saving");
    window.clearTimeout(settingsSave.current.timer);
    settingsSave.current.timer = window.setTimeout(() => { void flushSettings(); }, 400);
  }, [flushSettings]);
  // Leaving the page saves anything still waiting on the timer.
  useEffect(() => { if (screen !== "settings") void flushSettings(); }, [screen, flushSettings]);

  const changeSubtitleAppearance = useCallback((value: typeof subtitleAppearance) => {
    setSubtitleAppearance(value);
    void window.aniDesktop.saveSubtitleAppearance(value).then((saved) => {
      setAppState((previous) => ({ ...previous, subtitleAppearance: saved }));
    }, (reason) => setError(messageFrom(reason)));
  }, []);

  const checkForUpdates = useCallback((force = false) => {
    if (force) setUpdateChecking(true);
    void window.aniDesktop.checkForUpdates(force).then(setUpdateStatus, (reason) => {
      if (force) setError(messageFrom(reason));
    }).finally(() => { if (force) setUpdateChecking(false); });
  }, []);
  useEffect(() => {
    const first = window.setTimeout(() => checkForUpdates(), 1_500);
    const poll = window.setInterval(() => checkForUpdates(), 60 * 60 * 1_000);
    return () => { window.clearTimeout(first); window.clearInterval(poll); };
  }, [checkForUpdates]);
  const openLatestRelease = useCallback(() => {
    void window.aniDesktop.openLatestRelease().catch((reason) => setError(messageFrom(reason)));
  }, []);
  const dismissUpdate = useCallback(() => {
    if (!updateStatus?.latestVersion) return;
    void window.aniDesktop.dismissUpdate(updateStatus.latestVersion).then(setUpdateStatus, (reason) => setError(messageFrom(reason)));
  }, [updateStatus?.latestVersion]);

  useEffect(() => {
    const refresh = () => { void window.aniDesktop.getState().then(setAppState).catch((reason) => setError(messageFrom(reason))); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  useEffect(() => { if (stateLoaded && appState.settings.playbackTarget === "builtin") void loadPlayerScreen(); }, [stateLoaded, appState.settings.playbackTarget]);

  useEffect(() => {
    if (!stateLoaded || mergePromptActive.current) return;
    const entries = [...appState.history, ...appState.bookmarks].filter((entry, index, all) => all.findIndex((item) => item.animeId === entry.animeId) === index);
    const dismissed = new Set(appState.dismissedMergeKeys ?? []);
    let pair: [LibraryEntry, LibraryEntry] | undefined;
    for (let left = 0; left < entries.length && !pair; left += 1) {
      for (let right = left + 1; right < entries.length; right += 1) {
        if (likelyDuplicate(entries[left], entries[right]) && !dismissed.has(mergeKey(entries[left].animeId, entries[right].animeId))) { pair = [entries[left], entries[right]]; break; }
      }
    }
    if (!pair) return;
    mergePromptActive.current = true;
    const [first, second] = pair;
    const accepted = window.confirm(`These may be the same anime:\n\n“${first.title}”\n“${second.title}”\n\nMerge them while keeping progress from both sources?`);
    const operation = accepted ? window.aniDesktop.mergeEntries(first.animeId, second.animeId) : window.aniDesktop.dismissMerge(first.animeId, second.animeId);
    void operation.then(setAppState, (reason) => setError(messageFrom(reason))).finally(() => { mergePromptActive.current = false; });
  }, [stateLoaded, appState.history, appState.bookmarks, appState.dismissedMergeKeys]);

  const themeSource = screen === "settings" ? settingsDraft : appState.settings;
  useEffect(() => applyTheme(themeSource.theme, themeSource.customTheme), [themeSource.theme, themeSource.customTheme]);

  const filter = query.trim().toLowerCase();
  const matches = (entry: LibraryEntry) => !filter || entry.title.toLowerCase().includes(filter);
  // The search palette covers the home page, or the series page once its field is focused, while a query or its results exist.
  const paletteOpen = searchHere && (Boolean(query.trim()) || unifiedResults.length > 0);
  // The home sections stay on the page behind the palette; the keyboard cursor moves to the results while it is open.
  const sortedSaved = useMemo(() => appState.bookmarks.map((entry, index) => ({ entry, index })).sort((a, b) =>
    (episodeUpdateStatus?.latestByAnime[b.entry.animeId] ?? 0) - (episodeUpdateStatus?.latestByAnime[a.entry.animeId] ?? 0) || a.index - b.index).map((item) => item.entry),
  [appState.bookmarks, episodeUpdateStatus?.latestByAnime]);
  const libraryRows = useMemo<Row[]>(() => [
    ...appState.history.slice(0, HOME_CARDS).map((entry): Row => ({ kind: "continue", entry })),
    ...sortedSaved.slice(0, HOME_CARDS).map((entry): Row => ({ kind: "saved", entry }))
  ], [appState.history, sortedSaved]);
  const rows = useMemo<Row[]>(() => {
    if (searchHere) return paletteOpen ? unifiedResults.map((anime): Row => ({ kind: "results", anime })) : screen === "home" ? libraryRows : [];
    if (screen === "saved") return sortedSaved.filter(matches).map((entry): Row => ({ kind: "saved", entry }));
    if (screen === "recent") return appState.history.filter(matches).map((entry): Row => ({ kind: "recent", entry }));
    return [];
  }, [screen, searchHere, paletteOpen, unifiedResults, libraryRows, appState.history, sortedSaved, filter]);

  // The home, browse, saved, and recent pages carry an illustration behind them: a wash on home, a wash or a corner figure elsewhere, picked afresh on each visit.
  const backdropPage: BackdropPage | undefined = screen === "home" || screen === "browse" || screen === "saved" || screen === "recent" ? screen : undefined;
  const backdropsOn = stateLoaded && appState.settings.emptyBackdrop !== false;
  const [backdrop, setBackdrop] = useState<{ page: BackdropPage; variant: BackdropVariant; art: BackdropArt }>();
  useEffect(() => {
    if (!backdropPage || !backdropsOn) { setBackdrop(undefined); return; }
    const variant: BackdropVariant = backdropPage === "home" || Math.random() < 0.5 ? "wash" : "corner";
    let current = true;
    void window.aniDesktop.backdropArt(variant === "wash" ? "wide" : "portrait")
      .then((art) => { if (current) setBackdrop(art ? { page: backdropPage, variant, art } : undefined); })
      .catch(() => { if (current) setBackdrop(undefined); });
    return () => { current = false; };
  }, [backdropPage, backdropsOn]);
  const focusSearch = () => { if (screen !== "home") go("home"); window.setTimeout(() => fieldRef.current?.focus(), 0); };

  const isSaved = Boolean(selectedAnime && appState.bookmarks.some((entry) => overlaps(entry, selectedAnime)));
  const progress = selectedAnime ? appState.history.find((entry) => overlaps(entry, selectedAnime)) : undefined;
  const player = appState.settings.playbackTarget === "builtin" ? "built-in player" : playerName(appState.settings.playerPath);
  const episodeRows = useMemo(() => episodeRowsOf(episodeGroups, progress, episodeFilter, episodeSort), [episodeGroups, progress, episodeFilter, episodeSort]);
  const episodeCount = new Set(episodeGroups.flatMap((group) => group.episodes.map((episode) => episode.number))).size;
  const selectedEpisodeIndex = Math.max(0, episodeRows.findIndex((row) => row.episode.id === selectedEpisodeId));
  const seriesScroll = useSeriesScroll(listRef, screen === "series", episodesLoading);
  const selectEpisodeAt = (index: number) => {
    const id = episodeRows[index]?.episode.id;
    setSelectedEpisodeId(id);
    if (id) seriesScroll.reveal({ id });
  };
  const sourceScope = catalogScope(appState.settings);
  const metadata = useEpisodeMetadata(listRef, screen === "series", episodeRows.map((row) => row.episode.id), episodeRows[selectedEpisodeIndex]?.episode.id, mode, sourceScope);
  const seriesMetadata = useSeriesMetadata(`${sourceScope}|${enabledProviders(appState.settings).join(",")}`);
  const workInfo = useWorkInfo(`${sourceScope}|${appState.settings.animeInfo !== false}`);
  const linkedAnime = useCallback((anime: AnimeResult) => expandWithLinks(anime, appState.providerLinks ?? []), [appState.providerLinks]);
  const libraryMetadata = useCallback((entry: LibraryEntry) => seriesMetadata.get(linkedAnime(asAnime(entry))), [linkedAnime, seriesMetadata.get]);
  const loadLibraryMetadata = useCallback((entry: LibraryEntry) => seriesMetadata.load(linkedAnime(asAnime(entry)), "visible"), [linkedAnime, seriesMetadata.load]);
  const scheduleMetadata = useCallback((anime: AnimeResult) => seriesMetadata.get(linkedAnime(anime)), [linkedAnime, seriesMetadata.get]);
  const loadScheduleMetadata = useCallback((anime: AnimeResult) => seriesMetadata.load(linkedAnime(anime), "visible"), [linkedAnime, seriesMetadata.load]);
  useEffect(() => {
    if (screen === "series" && selectedAnime) { seriesMetadata.load(linkedAnime(selectedAnime), "selected"); workInfo.load(linkedAnime(selectedAnime), "selected"); }
  }, [screen, selectedAnime, linkedAnime, seriesMetadata.load, workInfo.load]);

  const previousResults = useRef(results);
  useLayoutEffect(() => {
    const previous = previousResults.current[cursor];
    if (screen === "home" && previous && results !== previousResults.current) {
      const index = results.findIndex((anime) => overlaps(previous, anime));
      setCursor(Math.max(0, index));
    }
    previousResults.current = results;
  }, [results]);
  useEffect(() => { if ((screen !== "series" || seriesSearch) && screen !== "player") setCursor(0); }, [screen, seriesSearch, filter]);
  useEffect(() => { if (screen !== "series") setSeriesSearch(false); }, [screen]);
  // Library navigation follows its cursor; series jumps are explicit scroll commands.
  const cursorKey = rows[cursor]?.anime?.id ?? rows[cursor]?.entry?.animeId;
  useEffect(() => {
    if (screen === "series" && !seriesSearch) return;
    const selected = document.querySelector<HTMLElement>('[data-cursor="true"]');
    if (!selected) return;
    const list = selected.closest<HTMLElement>(".page, .palette");
    if (!list) { selected.scrollIntoView({ block: "nearest" }); return; }
    const reveal = () => {
      const rowBounds = selected.getBoundingClientRect();
      const listBounds = list.getBoundingClientRect();
      if (rowBounds.top < listBounds.top + 8) list.scrollTop += rowBounds.top - listBounds.top - 8;
      else if (rowBounds.bottom > listBounds.bottom - 8) list.scrollTop += rowBounds.bottom - listBounds.bottom + 8;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(list);
    return () => observer.disconnect();
  }, [cursorKey, screen, seriesSearch]);
  useEffect(() => {
    if (screen !== "series" && screen !== "settings" && screen !== "player") fieldRef.current?.focus();
  }, [screen]);

  /**
    Runs an app operation, reporting failures in the status pill. Quick actions whose control already shows the result
    (save, a tick, a removed card) pass `quiet`, so no "working" word appears for the moment they take.
  */
  async function run<T>(label: string, operation: () => Promise<T>, { quiet = false } = {}): Promise<T | undefined> {
    if (!quiet) setBusy(label);
    setError(undefined); setNotice(undefined);
    try { return await operation(); }
    catch (reason) { setError(messageFrom(reason)); return undefined; }
    finally { setBusy(undefined); }
  }

  function go(next: Screen) {
    setEpisodeInboxOpen(false);
    setScreen(next);
    setError(undefined); setNotice(undefined);
    if (next !== "home" && next !== "series") setQuery("");
    if (next === "settings") setSettingsDraft(appState.settings);
  }

  // A confirmation ("aniwave split off") says its piece and goes; errors stay until the next action.
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(undefined), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // Watched marks and resume points change while the player has the store.
  const refreshState = () => { void window.aniDesktop.getState().then(setAppState).catch((reason) => setError(messageFrom(reason))); };

  // Returning to the list reveals the playing episode when it belongs to the open series.
  function focusPlayingEpisode() {
    const id = session?.request.episode?.id;
    const index = id && nowPlaying?.anime.id === selectedAnime?.id ? episodeRows.findIndex((row) => row.episode.id === id) : -1;
    if (index >= 0) selectEpisodeAt(index);
  }

  // Docking and expanding move the player box from where it is drawn now (PlayerScreen springs it to the new layout).
  function dockPlayer() {
    capturePlayer();
    setStatus(undefined); setError(undefined); setNotice(undefined);
    setScreen(selectedAnime ? "series" : "home");
    focusPlayingEpisode();
    refreshState();
  }

  function expandPlayer() {
    if (!session) return;
    capturePlayer();
    setScreen("player"); setError(undefined); setNotice(undefined);
  }

  function closePlayer() {
    setSession(undefined); setStatus(undefined);
    if (screen === "player") { setScreen(selectedAnime ? "series" : "home"); focusPlayingEpisode(); }
    refreshState();
  }

  function showPlayingEpisodes() {
    setEpisodeFilter("all");
    if (nowPlaying && selectedAnime?.id !== nowPlaying.anime.id) { void openAnime(nowPlaying.anime, { focusEpisodeId: nowPlaying.episodeId }); refreshState(); return; }
    if (nowPlaying) { setSelectedEpisodeId(nowPlaying.episodeId); seriesScroll.reveal({ id: nowPlaying.episodeId }); }
    dockPlayer();
  }

  // Mini player placement applies at once, so the box lands where it was released, and is saved afterwards.
  async function moveMiniPlayer(miniPlayerCorner: MiniPlayerCorner) {
    setAppState((state) => ({ ...state, settings: { ...state.settings, miniPlayerCorner } }));
    setSettingsDraft((draft) => ({ ...draft, miniPlayerCorner }));
    try { await window.aniDesktop.saveSettings({ ...appState.settings, miniPlayerCorner }); }
    catch (reason) { setNotice(`corner not saved: ${messageFrom(reason)}`); }
  }

  // Repeated resize keys coalesce into one save.
  const widthSave = useRef<{ timer?: ReturnType<typeof setTimeout>; width: number }>({ width: 0 });
  function resizeMiniPlayer(next: number) {
    const miniPlayerWidth = clampMiniPlayerWidth(next, Math.max(MINI_PLAYER_WIDTH.min, window.innerWidth - 48));
    setAppState((state) => ({ ...state, settings: { ...state.settings, miniPlayerWidth } }));
    setSettingsDraft((draft) => ({ ...draft, miniPlayerWidth }));
    widthSave.current.width = miniPlayerWidth;
    clearTimeout(widthSave.current.timer);
    widthSave.current.timer = setTimeout(() => {
      void window.aniDesktop.saveSettings({ ...appState.settings, miniPlayerWidth: widthSave.current.width })
        .catch((reason) => setNotice(`size not saved: ${messageFrom(reason)}`));
    }, 250);
  }
  const miniWidth = appState.settings.miniPlayerWidth ?? MINI_PLAYER_WIDTH.default;

  function goBack() {
    if (screen === "player") { dockPlayer(); return; }
    if (screen === "notifications") { go(notificationsOrigin.current === "notifications" ? "home" : notificationsOrigin.current); return; }
    if (screen === "home") { if (query) setQuery(""); catalogSearch.clear(); return; }
    if (screen === "series" && seriesSearch) { closeSeriesSearch(); return; }
    if (screen === "browse" && browseOpening) { cancelSeries(); setBrowseOpening(undefined); return; }
    if (screen === "catalog-detail") { cancelSeries(); go("browse"); return; }
    if (screen === "series") {
      // The poster flies back to its card when the page going back to shows one.
      const entry = selectedAnime && [...appState.history, ...appState.bookmarks].find((item) => overlaps(item, selectedAnime));
      if (entry) returnTo(document.querySelector(".series .side .poster"), `.card[data-anime="${CSS.escape(entry.animeId)}"] .poster`);
      setSelectedAnime(undefined); go(seriesOrigin.current); return;
    }
    go("home");
  }

  function changeQuery(value: string) {
    setQuery(value);
    if (!value.trim()) catalogSearch.clear();
    if (screen === "home") { setError(undefined); setNotice(undefined); }
    else if (screen === "series") setSeriesSearch(true);
  }

  // Closing the palette over a series leaves the page and the query as they were; the field gives up focus so the next click reopens it.
  function closeSeriesSearch() { setSeriesSearch(false); fieldRef.current?.blur(); }

  const openToken = useRef(0);
  const catalogTasks = useRef(new Set<string>());
  const cancelSeries = () => {
    openToken.current += 1;
    if (playbackRequest.current) {
      playToken.current += 1;
      window.aniDesktop.cancelCatalog(playbackRequest.current); playbackRequest.current = undefined;
    }
    for (const id of catalogTasks.current) window.aniDesktop.cancelCatalog(id);
    catalogTasks.current.clear();
  };
  useEffect(() => {
    if (screen !== "series" && screen !== "player" && screen !== "opening" && screen !== "catalog-detail") { cancelSeries(); setBrowseOpening(undefined); setBusy(undefined); setResolving(false); setEpisodesLoading(false); }
  }, [screen, sourceScope]);
  useEffect(() => () => cancelSeries(), []);

  /** Hands words from Browse to the source search on Home. */
  function searchSourcesFor(words: string) { cancelSeries(); go("home"); setQuery(words.slice(0, 120)); window.setTimeout(() => fieldRef.current?.focus(), 0); }

  function browseFor(filters: Partial<BrowseFilters>) {
    cancelSeries();
    setBrowseState({ ...DEFAULT_BROWSE_STATE, filters: { ...DEFAULT_BROWSE_STATE.filters, ...filters },
      sortBefore: filters.search ? "popularity" : undefined });
    setSelectedAnime(undefined);
    go("browse");
  }

  async function openBrowseAnime(anime: BrowseAnime, retry = false): Promise<void> {
    // From the grid the card reports the check, and a second click on it cancels. Only a title without a source lands on the detail page.
    const inPlace = screen === "browse";
    if (inPlace && browseOpening?.id === anime.anilistId) { cancelSeries(); setBrowseOpening(undefined); return; }
    cancelSeries();
    const token = openToken.current;
    setBrowseAnime(anime); setBrowseResolving(true); setBrowseResolveError(undefined);
    if (inPlace) setBrowseOpening({ id: anime.anilistId, token }); else setScreen("catalog-detail");
    const id = catalogRequestId("browse-open"); catalogTasks.current.add(id);
    try {
      const discovery = await window.aniDesktop.discoverBrowse(anime, { id, priority: "selected", refresh: retry, checkNow: retry });
      if (token !== openToken.current) return;
      if (discovery.anime) {
        refreshState();
        launchFrom(document.querySelector(".browse-grid .card.is-resolving .poster"));
        await openAnime({ ...discovery.anime, poster: discovery.anime.poster ?? anime.cover }, { returnTo: "browse", discovery });
        return;
      }
      const failures = Object.entries(discovery.errors).map(([provider, detail]) => `${provider}: ${detail}`);
      setBrowseResolveError(failures.length ? `Source search was incomplete. ${failures.join(" · ")}` : undefined);
      setScreen("catalog-detail");
    } catch (reason) {
      if (token === openToken.current) { setBrowseResolveError(messageFrom(reason)); setScreen("catalog-detail"); }
    } finally {
      catalogTasks.current.delete(id);
      setBrowseOpening((current) => current?.token === token ? undefined : current);
      if (token === openToken.current) setBrowseResolving(false);
    }
  }

  async function openAnime(anime: AnimeResult, options: { resumeAfter?: string; preferredProvider?: ProviderName; mode?: TranslationMode; autoPlay?: boolean; refresh?: boolean; checkNow?: boolean; focusEpisodeId?: string; returnTo?: "browse" | "notifications"; discovery?: BrowseDiscoveryResult } = {}): Promise<boolean> {
    cancelSeries();
    if (seriesSearch) closeSeriesSearch();
    const replacing = !options.refresh || screen !== "series" || !selectedAnime || !overlaps(selectedAnime, anime);
    if (replacing) seriesOrigin.current = options.returnTo ?? "home";
    const token = openToken.current;
    const animeProgress = appState.history.find((entry) => overlaps(entry, anime));
    const preferred = animeProgress?.lastProvider ?? (provider === "auto" ? options.preferredProvider ?? anime.provider : provider);
    playToken.current += 1;
    if (playbackRequest.current) window.aniDesktop.cancelCatalog(playbackRequest.current);
    setSelectedAnime(anime);
    setEpisodesLoading(true);
    if (replacing || options.focusEpisodeId) { setSelectedEpisodeId(options.focusEpisodeId); seriesScroll.begin(options.focusEpisodeId); }
    if (replacing) setEpisodeGroups([]);
    setStatus(undefined); setJump(""); setSourceErrors(options.discovery?.errors ?? {});
    setScreen(options.autoPlay ? "opening" : "series");
    if (options.mode) setMode(options.mode);
    // The skeleton rows show that episodes are loading; no status word joins them.
    setError(undefined); setNotice(undefined);
    let currentAnime = anime;
    let groups: EpisodeGroup[] = replacing ? [] : episodeGroups;
    let positioned = Boolean(options.focusEpisodeId || (options.refresh && selectedEpisodeId));
    let played = false;
    let attempting = false, finished = false;
    let targetNumber: string | undefined;
    const attempted = new Set<string>();
    const savedProgress = animeProgress?.progressByProvider?.[preferred];
    const resumeEpisode = (savedProgress?.completed ?? animeProgress?.completed) === false && savedProgress?.lastEpisodeId?.startsWith(`${preferred}:`) && enabledProviders(appState.settings).includes(preferred)
      ? { id: savedProgress.lastEpisodeId, number: savedProgress.lastEpisode, provider: preferred } : undefined;
    const known = new Set(animeSources(anime).map((source) => source.id));
    // Browse has already spent this opening's discovery budget, including failed/missing sources.
    const missing = options.discovery ? [] : enabledProviders(appState.settings).filter((name) => !animeSources(anime).some((source) => source.provider === name));
    setPendingSources(missing); setResolving(missing.length > 0);
    const request = async <T,>(purpose: string, operation: (request: import("../shared/contracts").CatalogRequest) => Promise<T>) => {
      const id = catalogRequestId(purpose); catalogTasks.current.add(id);
      try { return await operation({ id, priority: options.autoPlay && purpose === "episodes" ? "playback" : "selected", refresh: options.refresh, checkNow: options.checkNow }); }
      finally { catalogTasks.current.delete(id); }
    };
    const position = (allowFallback = false) => {
      if (token !== openToken.current) return;
      const list = episodeRowsOf(groups, animeProgress, options.autoPlay ? "all" : episodeFilter, episodeSort);
      if (!list.length) return;
      setBusy(undefined);
      const index = nextUpIndex(list, groups, animeProgress, preferred, options.resumeAfter);
      if (!positioned) { positioned = true; setSelectedEpisodeId(list[index]?.episode.id); }
      const preferredReady = groups.some((group) => group.provider === preferred && group.episodes.length);
      const preferredFailed = groups.some((group) => group.provider === preferred && (group.error || (!group.refreshing && !group.episodes.length))) || !enabledProviders(appState.settings).includes(preferred);
      if (options.autoPlay && !played && !attempting && (preferredReady || preferredFailed || allowFallback || attempted.size)) {
        const preferredList = list.filter((row) => row.episode.provider === list[index]?.episode.provider).sort((a, b) => episodeValue(a.number) - episodeValue(b.number));
        const after = savedProgress?.lastEpisode ?? options.resumeAfter ?? animeProgress?.lastEpisode;
        const completed = (savedProgress?.completed ?? animeProgress?.completed) !== false;
        const target = targetNumber
          ? list.find((row) => row.number === targetNumber && !attempted.has(row.episode.id))?.episode
          : preferredList.find((row) => !after || (completed ? episodeValue(row.number) > episodeValue(after) : episodeValue(row.number) >= episodeValue(after)))?.episode;
        if (target && !attempted.has(target.id)) void attempt(target);
      }
    };
    const attempt = async (target: Episode) => {
      if (token !== openToken.current || played || attempting) return;
      attempting = true; attempted.add(target.id); targetNumber = target.number;
      positioned = true; setSelectedEpisodeId(target.id);
      const succeeded = await playEpisode(target, currentAnime, savedProgress?.mode ?? options.mode ?? mode, groups);
      if (token !== openToken.current) return;
      attempting = false;
      if (succeeded) { played = true; return; }
      if (succeeded === false) position(finished);
    };
    const accept = (catalog: EpisodeCatalog) => {
      if (token !== openToken.current) return;
      groups = [...groups.filter((group) => !catalog.groups.some((next) => next.provider === group.provider)), ...catalog.groups];
      setEpisodeGroups(groups); position();
    };
    const load = async (target: AnimeResult) => {
      try { accept(await request("episodes", (req) => window.aniDesktop.episodes(target, req, accept))); }
      catch (error) { if (token === openToken.current) setNotice(messageFrom(error)); }
    };
    if (options.autoPlay && resumeEpisode) void attempt(resumeEpisode);
    const initial = load(anime);
    const extra: Promise<void>[] = [];
    let discoveryErrors: Partial<Record<ProviderName, string>> = {};
    const acceptSources = (progress: CatalogProgress<AnimeResult>) => {
      if (token !== openToken.current) return;
      currentAnime = progress.value; discoveryErrors = progress.errors;
      setSelectedAnime(currentAnime); setPendingSources(progress.pending); setSourceErrors(progress.errors);
      setNowPlaying((playing) => playing && overlaps(playing.anime, currentAnime) ? { ...playing, anime: currentAnime } : playing);
      for (const source of animeSources(currentAnime)) {
        if (known.has(source.id)) continue;
        known.add(source.id);
        extra.push(load({ ...currentAnime, sources: [source] }));
      }
    };
    const discovery = missing.length ? (async () => {
      try {
        const resolved = await request("sources", (req) => window.aniDesktop.resolveSources(anime, req, acceptSources));
        if (token === openToken.current) {
          // The final response also supports browser previews without progress events.
          acceptSources({ value: resolved, pending: [], errors: discoveryErrors });
          refreshState();
        }
      } catch (error) { if (token === openToken.current) setNotice(messageFrom(error)); }
      await Promise.all(extra);
    })() : Promise.resolve();
    void Promise.all([initial, discovery]).then(() => {
      if (token !== openToken.current) return;
      finished = true;
      setEpisodesLoading(false);
      setResolving(false); setPendingSources([]); setBusy(undefined); position(true);
      if (options.autoPlay && !played && !attempting && !attempted.size) setError("No episode is available to continue. Open Episodes to check the series and its sources.");
    });
    await initial;
    return token === openToken.current;
  }

  async function playEpisode(episode: Episode, anime = selectedAnime, playMode = mode, groups = episodeGroups, refresh = false) {
    if (!anime) return;
    const token = ++playToken.current;
    if (playbackRequest.current) window.aniDesktop.cancelCatalog(playbackRequest.current);
    const rowIndex = episodeRows.findIndex((item) => item.episode.id === episode.id);
    if (rowIndex >= 0) selectEpisodeAt(rowIndex);
    setStatus({ episode, phase: "finding", detail: `${playMode} from ${episode.provider}` });
    try {
      const requestId = catalogRequestId("playback");
      playbackRequest.current = requestId;
      const retry = refresh || (status?.phase === "failed" && status.episode.id === episode.id);
      const streams = await window.aniDesktop.streams(episode.id, playMode, { id: requestId, priority: "playback", refresh: retry, checkNow: retry });
      if (playbackRequest.current === requestId) playbackRequest.current = undefined;
      if (token !== playToken.current) return;
      const stream = (quality === "best" ? undefined : streams.find((item) => item.quality === quality)) ?? streams[0];
      if (!stream) throw new Error("no stream was found");
      const best = bestQuality(streams);
      if (best) metadata.record(episode.id, playMode, streams);
      const detail = `${stream.quality} · ${playMode} · ${stream.provider}`;
      setStatus({ episode, phase: "opening", detail });
      const series = providerList(groups, episode.provider);
      setNowPlaying({ episodeId: episode.id, detail, mode: playMode, anime, episodes: series.some((item) => item.id === episode.id) ? series : [episode] });
      const url = appState.settings.playbackTarget === "builtin" && quality === "best" ? stream.masterUrl ?? stream.url : stream.url;
      await window.aniDesktop.play({ url, title: `${anime.title} — Episode ${episode.number}`, referrer: stream.referrer, textTracks: stream.textTracks, episode: { id: episode.id, entry: libraryEntry(anime, episode, playMode) } });
      if (token !== playToken.current) return;
      setAppState(appState.settings.playbackTarget === "builtin"
        ? await window.aniDesktop.getState()
        : await window.aniDesktop.recordHistory(libraryEntry(anime, episode, playMode)));
      setStatus({ episode, phase: "opened", detail });
      return true;
    } catch (reason) {
      if (token === playToken.current) { setStatus({ episode, phase: "failed", detail: messageFrom(reason) }); return false; }
    }
  }

  function cancelPlay() {
    playToken.current += 1;
    if (playbackRequest.current) window.aniDesktop.cancelCatalog(playbackRequest.current);
    playbackRequest.current = undefined; setStatus(undefined);
  }

  // A direct resume starts with one episode; catalog updates fill its playback queue later.
  useEffect(() => {
    setNowPlaying((playing) => {
      if (!playing || !selectedAnime || !overlaps(playing.anime, selectedAnime)) return playing;
      const episode = playing.episodes.find((item) => item.id === playing.episodeId);
      if (!episode) return playing;
      const list = providerList(episodeGroups, episode.provider);
      return list.some((item) => item.id === playing.episodeId) ? { ...playing, anime: selectedAnime, episodes: list } : playing;
    });
  }, [episodeGroups, selectedAnime, nowPlaying?.episodeId]);

  // Saving records the anime with its real progress, never the row the cursor happens to be on.
  async function toggleBookmark() {
    if (!selectedAnime) return;
    const first = episodeRowsOf(episodeGroups, undefined, "all", "oldest")[0]?.episode;
    const entry: LibraryEntry = progress
      ? { ...progress, title: selectedAnime.title, poster: selectedAnime.poster ?? progress.poster, sources: animeSources(selectedAnime) }
      : { ...libraryEntry(selectedAnime, first, mode), completed: false };
    const state = await run("updating saved titles", () => window.aniDesktop.toggleBookmark(entry), { quiet: true });
    if (state) setAppState(state);
  }

  // The checkbox on a row records progress through that episode on its provider.
  async function markWatched(episode: Episode) {
    if (!selectedAnime) return;
    const state = await run("updating progress", () => window.aniDesktop.recordHistory(libraryEntry(selectedAnime, episode, mode)), { quiet: true });
    if (state) setAppState(state);
  }

  // The sidebar button records the last episode on every source at once.
  async function markAllWatched() {
    if (!selectedAnime) return;
    const entry = libraryEntryAllWatched(selectedAnime, episodeGroups, mode, progress?.lastProvider);
    if (!entry) return;
    const state = await run("updating progress", () => window.aniDesktop.recordHistory(entry), { quiet: true });
    if (state) setAppState(state);
  }

  function libraryMergeCandidate(entry: LibraryEntry): LibraryEntry | undefined {
    const entries = [...appState.history, ...appState.bookmarks]
      .filter((candidate, index, all) => all.findIndex((item) => item.animeId === candidate.animeId) === index);
    return entries.find((candidate) => candidate.animeId !== entry.animeId && likelyDuplicate(entry, candidate));
  }

  // Splitting takes one provider record out of the open series; the pair is remembered so search does not regroup it by title.
  async function splitSource(sourceId: string) {
    if (!selectedAnime) return;
    const source = animeSources(selectedAnime).find((item) => item.id === sourceId);
    if (!source || !window.confirm(`Split the ${source.provider} record “${source.title}” off “${selectedAnime.title}”? They will be treated as different anime.`)) return;
    const state = await run("splitting source", () => window.aniDesktop.splitSource(sourceId));
    if (!state) return;
    setAppState(state);
    const remaining = animeSources(selectedAnime).filter((item) => item.id !== sourceId);
    const primary = remaining.find((item) => item.id === selectedAnime.id) ?? remaining[0];
    if (primary) void openAnime({ ...selectedAnime, id: primary.id, provider: primary.provider, poster: selectedAnime.poster ?? primary.poster, sources: remaining, tentative: undefined }, { refresh: true });
    setNotice(`${source.provider} split off`);
  }

  async function manuallyMergeEntry(entry: LibraryEntry) {
    const candidate = libraryMergeCandidate(entry);
    if (!candidate || !window.confirm(`Merge “${entry.title}” with “${candidate.title}” while keeping progress from both sources?`)) return;
    const state = await run("merging library records", () => window.aniDesktop.mergeEntries(entry.animeId, candidate.animeId));
    if (state) { setAppState(state); setNotice("library records merged"); }
  }

  async function activate(row: Row) {
    if (row.anime) { await openAnime(row.anime); return; }
    if (row.entry) await openAnime(asAnime(row.entry), { resumeAfter: row.entry.lastEpisode, preferredProvider: row.entry.lastProvider, mode: row.entry.mode, autoPlay: row.kind !== "saved", refresh: row.kind === "saved" });
  }

  async function openRow(row: Row) {
    if (row.anime) await openAnime(row.anime);
    else if (row.entry) await openAnime(asAnime(row.entry), { resumeAfter: row.entry.lastEpisode, preferredProvider: row.entry.lastProvider, mode: row.entry.mode, refresh: row.kind === "saved" });
  }

  const notificationPoster = (update: EpisodeUpdate) => appState.bookmarks.find((entry) => animeSources(entry).some((source) => source.id === update.sourceId))?.poster;

  function changeEpisodeUpdate(id: string | undefined, action: "read" | "dismiss"): Promise<boolean> {
    const request = action === "read" ? window.aniDesktop.markEpisodeUpdateRead(id) : window.aniDesktop.dismissEpisodeUpdate(id);
    return request.then((status) => { setEpisodeUpdateStatus(status); return true; }, (reason) => { setError(messageFrom(reason)); return false; });
  }

  function openEpisodeUpdate(id: string, focusEpisode: boolean) {
    const update = episodeUpdateStatus?.updates.find((item) => item.id === id);
    if (!update) return;
    const entry = appState.bookmarks.find((item) => animeSources(item).some((source) => source.id === update.sourceId));
    if (!entry) return;
    setEpisodeInboxOpen(false);
    void changeEpisodeUpdate(id, "read");
    void openAnime(asAnime(entry), { preferredProvider: update.provider, focusEpisodeId: focusEpisode ? update.episodeId : undefined, mode: entry.mode, refresh: true, returnTo: screen === "notifications" ? "notifications" : undefined });
  }

  async function removeRow(row: Row) {
    if (!row.entry) return;
    const id = row.entry.animeId;
    const state = await run("removing", () => row.kind === "saved" ? window.aniDesktop.removeBookmark(id) : window.aniDesktop.removeHistory(id), { quiet: true });
    if (state) setAppState(state);
  }

  async function clearHistory() {
    if (!window.confirm("Clear all recent titles?")) return;
    const state = await run("clearing history", () => window.aniDesktop.clearHistory(), { quiet: true });
    if (state) setAppState(state);
  }

  async function clearSourceLinks() {
    if (!window.confirm("Forget every remembered match between providers? Series will be looked up again when opened.")) return;
    const state = await run("forgetting source links", () => window.aniDesktop.clearSourceLinks());
    if (state) { setAppState(state); setNotice("source links forgotten"); }
  }

  // Changing the order or filter keeps the selection on the same row when it is still shown.
  function reorder(filter: EpisodeFilter, sort: EpisodeSort) {
    const id = episodeRows[selectedEpisodeIndex]?.episode.id;
    const next = episodeRowsOf(episodeGroups, progress, filter, sort);
    setEpisodeFilter(filter); setEpisodeSort(sort);
    const index = id ? next.findIndex((row) => row.episode.id === id) : -1;
    setSelectedEpisodeId(next[index >= 0 ? index : 0]?.episode.id);
  }

  function jumpTo(value: string) {
    setJump(value);
    const wanted = value.trim();
    if (!wanted) { seriesScroll.cancelReveal(); return; }
    const index = episodeRows.findIndex((row) => row.number === wanted) ;
    const loose = index >= 0 ? index : episodeRows.findIndex((row) => row.number.startsWith(wanted));
    if (loose >= 0) selectEpisodeAt(loose);
    else seriesScroll.reveal({ number: wanted });
  }

  const moveCursor = (delta: number, length: number) => { if (length) setCursor((current) => Math.min(Math.max(current + delta, 0), length - 1)); };
  // Cards sit in rows: left and right step along a row, up and down move between rows or, on home, between sections.
  function moveCard(key: string) {
    if (rows.length === 0) return;
    const current = rows[cursor];
    if (!current) { setCursor(0); return; }
    if (key === "ArrowLeft" || key === "ArrowRight") {
      const delta = key === "ArrowLeft" ? -1 : 1;
      const next = rows[cursor + delta];
      if (next && (screen !== "home" || next.kind === current.kind)) setCursor(cursor + delta);
      return;
    }
    const grid = document.querySelector<HTMLElement>(".page .cards");
    const columns = grid ? Number.parseInt(getComputedStyle(grid).getPropertyValue("--cols"), 10) || HOME_CARDS : HOME_CARDS;
    if (screen === "home") {
      const firstInSection = rows.findIndex((row) => row.kind === current.kind);
      const sectionSize = rows.filter((row) => row.kind === current.kind).length;
      const sectionOffset = cursor - firstInSection;
      const targetRow = Math.floor(sectionOffset / columns) + (key === "ArrowDown" ? 1 : -1);
      if (targetRow >= 0 && targetRow <= Math.floor((sectionSize - 1) / columns)) {
        setCursor(firstInSection + Math.min(targetRow * columns + sectionOffset % columns, sectionSize - 1));
        return;
      }
      const kinds = [...new Set(rows.map((row) => row.kind))];
      const at = kinds.indexOf(current.kind);
      const targetKind = kinds[at + (key === "ArrowDown" ? 1 : -1)];
      if (!targetKind) return;
      const first = rows.findIndex((row) => row.kind === targetKind);
      const size = rows.filter((row) => row.kind === targetKind).length;
      const targetOffset = (key === "ArrowUp" ? Math.floor((size - 1) / columns) * columns : 0) + sectionOffset % columns;
      setCursor(first + Math.min(targetOffset, size - 1));
      return;
    }
    moveCursor(key === "ArrowDown" ? columns : -columns, rows.length);
  }

  keyHandler.current = (event) => {
    const target = event.target as HTMLElement | null;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
    if (event.isComposing || composing || event.keyCode === 229) return;
    const searchKey = (event.metaKey || event.ctrlKey) && event.key === "k";
    if (screen === "player" || (screen === "series" && !seriesSearch && !searchKey)) return; // Series uses native controls until its search opens; the player owns its keys.
    // The backtick expands the docked player while browsing the library or search results.
    if (event.key === "`" && session && screen !== "settings" && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); expandPlayer(); return; }
    if (event.metaKey || event.ctrlKey) {
      if (event.key === "k" && screen !== "settings") { event.preventDefault(); if (!searchHere && screen !== "series") go("home"); fieldRef.current?.focus(); fieldRef.current?.select(); }
      // Library and settings shortcuts resize the docked player, including while typing.
      else if (session && (event.key === "=" || event.key === "+")) { event.preventDefault(); resizeMiniPlayer(miniWidth + MINI_PLAYER_WIDTH.step); }
      else if (session && (event.key === "-" || event.key === "_")) { event.preventDefault(); resizeMiniPlayer(miniWidth - MINI_PLAYER_WIDTH.step); }
      return;
    }
    if (event.altKey) return;
    if (event.key === "Enter" && target?.closest("button:not(.hit):not(.src-hit)")) return;
    if (screen === "settings") { if (event.key === "Escape") goBack(); return; }
    if (event.key === "Escape") { event.preventDefault(); if (showHints) { setShowHints(false); return; } goBack(); return; }
    if (screen === "browse" || screen === "catalog-detail" || screen === "notifications") return;
    if (screen === "opening") return;
    if (!typing && event.key === "?") { event.preventDefault(); setShowHints((value) => !value); return; }
    if (!typing && event.key === "/") {
      event.preventDefault(); fieldRef.current?.focus(); fieldRef.current?.select(); return;
    }
    if (paletteOpen) {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); moveCursor(event.key === "ArrowUp" ? -1 : 1, rows.length); return; }
    } else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      if (typing && (event.key === "ArrowLeft" || event.key === "ArrowRight") && (target as HTMLInputElement).value) return;
      event.preventDefault(); moveCard(event.key); return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (searchHere && query.trim() && (!catalogSearch.ready && (catalogSearch.pending || target === fieldRef.current))) {
        catalogSearch.searchNow(); return;
      }
      if (rows[cursor]) { launchFrom(document.querySelector('[data-cursor="true"] .poster, [data-cursor="true"] .thumb')); void activate(rows[cursor]); }
      return;
    }
    if (typing) return;
    const row = rows[cursor];
    if (event.key === "x" && row?.entry) void removeRow(row);
    else if (event.key === "o" && row) void openRow(row);
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyHandler.current(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  useLayoutEffect(() => resolveReturn(), [screen]);

  const placeholder = screen === "saved" ? "Filter saved titles" : screen === "recent" ? "Filter recent titles" : "Search anime";
  const searching = catalogSearch.loading;
  const searchError = catalogSearch.error === undefined ? undefined : messageFrom(catalogSearch.error);
  const displayError = error ?? searchError;
  const searchNotice = catalogSearch.providerErrors.length ? "Some results may be missing. Try searching again." : catalogSearch.ready && unifiedResults.length === 0 ? `nothing found for "${lastQuery}"` : undefined;
  const message = displayError ?? busy ?? searchNotice ?? notice;
  const searchMessage = paletteOpen ? (searchError ?? (busy === undefined ? searchNotice : undefined)) : undefined;

  const cardSection = (kind: LibraryKind, heading: string, more?: Screen) => {
    const source = screen === "home" && paletteOpen ? libraryRows : rows;
    const items = source.flatMap((row, index) => row.kind === kind ? [{ row, index: source === rows ? index : -1 }] : []);
    return <LibrarySection key={kind} kind={kind} heading={heading} items={items} cursor={cursor}
      onMore={more ? () => go(more) : undefined}
      onClearHistory={kind === "recent" && appState.history.length ? () => void clearHistory() : undefined}
      onActivate={(row) => void activate(row)} onRemove={(row) => void removeRow(row)} onFocus={setCursor}
      canMerge={(entry) => Boolean(libraryMergeCandidate(entry))} onMerge={(entry) => void manuallyMergeEntry(entry)}
      metadataFor={libraryMetadata} onMetadata={loadLibraryMetadata} freshCounts={episodeUpdateStatus?.counts} />;
  };

  const playingId = session?.request.episode?.id;
  const current = nowPlaying && nowPlaying.episodeId === playingId ? nowPlaying : undefined;
  const playingList = current?.episodes ?? [];
  const playingIndex = playingId ? playingList.findIndex((episode) => episode.id === playingId) : -1;
  const playNeighbour = (offset: number) => {
    const target = playingIndex >= 0 ? playingList[playingIndex + offset] : undefined;
    return current && target ? () => { void playEpisode(target, current.anime, current.mode); } : undefined;
  };
  const playerMessage = status
    ? status.phase === "failed" ? { text: `episode ${status.episode.number}: ${status.detail}`, error: true }
      : status.phase === "opened" ? undefined : { text: `episode ${status.episode.number}: finding a stream ···` }
    : undefined;

  // Next up follows progress, not the cursor: the episode after the last one watched on the provider used last.
  const nextUp = useMemo(() => {
    const all = episodeRowsOf(episodeGroups, progress, "all", "oldest");
    const saved = selectedAnime && appState.bookmarks.find((entry) => overlaps(entry, selectedAnime));
    const row = all[nextUpIndex(all, episodeGroups, progress, progress?.lastProvider ?? (provider === "auto" ? saved?.lastProvider ?? selectedAnime?.provider : provider) ?? "aniwave")];
    return row ? all.find((item) => !item.watched && item.number === row.number) ?? row : undefined;
  }, [episodeGroups, progress, selectedAnime, provider, appState.bookmarks]);
  useSearchMorph(searchBox, searchSurface, paletteOpen);
  // The current section's fill moves between the nav icons; screens outside the nav let it fade.
  useIndicator(navRef, navIndicator, ":scope > button.on", screen === "catalog-detail" ? "browse" : screen);
  // The update notice lives in Settings; a dot on the gear is its only sign elsewhere.
  const navIcon = (target: Screen, name: "home" | "browse" | "bookmark" | "clock" | "gear", text: string, badge = false) => (
    <button type="button" className={screen === target || (target === "browse" && screen === "catalog-detail") ? "on" : ""} title={badge ? `${text} · update available` : text} {...pressProps(() => go(target))}><Icon name={name} />{badge && <i className="nav-badge" aria-hidden="true" />}<span className="sr-only">{badge ? `${text}, update available` : text}</span></button>
  );

  return (
    <div className={`app ${screen === "player" && playerFullscreen ? "is-fullscreen" : ""}`}>
      {backdrop && backdrop.page === backdropPage && <Backdrop key={backdrop.art.id} art={backdrop.art} variant={backdrop.variant} />}
      <header className="bar">
        <div className="brand">
          <button type="button" className="logo" onClick={() => { go("home"); setQuery(""); catalogSearch.clear(); }} aria-label="Home">ANI<em>desktop</em></button>
        </div>
        <div className={`searchbox ${paletteOpen ? "open" : ""}`} ref={searchBox}>
          <i className="omni-surface" ref={searchSurface} aria-hidden="true" />
          {screen === "settings" || screen === "player" || screen === "browse" || screen === "catalog-detail" || screen === "notifications"
            ? <button type="button" className="search as-button" onClick={() => { go("home"); }}><Icon name="search" /><span>Search anime</span><kbd>{shortcut("K")}</kbd></button>
            : <label className="search">
                <Icon name="search" />
                <input ref={fieldRef} value={query} onChange={(event) => changeQuery(event.target.value)}
                  onFocus={(event) => { if (screen === "series" && !seriesSearch) { setSeriesSearch(true); event.target.select(); } }}
                  onBlur={() => { if (!paletteOpen) setSeriesSearch(false); }}
                  onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
                  maxLength={120} placeholder={placeholder} aria-label={placeholder} spellCheck={false} />
                <span className="search-throbber" aria-hidden="true">
                  {catalogSearch.pending && <><span>·</span><span>·</span><span>·</span></>}
                </span>
                <span className="sr-only" role="status">{searching ? "Searching" : catalogSearch.ready ? `${unifiedResults.length} ${unifiedResults.length === 1 ? "title" : "titles"} found for ${lastQuery}` : ""}</span>
                {paletteOpen || query
                  ? <button type="button" className="clear" aria-label="Clear search" onClick={() => { setQuery(""); catalogSearch.clear(); fieldRef.current?.focus(); }}><Icon name="x" /></button>
                  : <kbd>{shortcut("K")}</kbd>}
              </label>}
          {paletteOpen && (
            <SearchPalette results={unifiedResults} query={query} lastQuery={lastQuery} cursor={cursor}
              ready={catalogSearch.ready} pending={catalogSearch.pending} providerErrors={catalogSearch.providerErrors}
              message={searchMessage} error={searchError} closeHint={screen === "series" ? "back to the series" : "close"} onRetry={catalogSearch.retrySources}
              onOpen={(anime) => void openAnime(anime)} onFocus={setCursor} />
          )}
        </div>
        <nav className="icons" aria-label="Sections" ref={navRef}>
          <i className="nav-ind" ref={navIndicator} aria-hidden="true" />
          {navIcon("home", "home", "home")}
          {navIcon("browse", "browse", "browse")}
          {navIcon("saved", "bookmark", "saved")}
          {navIcon("recent", "clock", "recent")}
          <button type="button" className={`episode-updates-trigger${screen === "notifications" ? " on" : ""}`} aria-label={`Notifications, ${episodeUpdateStatus?.unreadCount ?? 0} unread`} aria-expanded={episodeInboxOpen} onClick={() => { if (screen === "player") { void window.aniDesktop.player.setFullscreen(false).catch(() => undefined); setScreen("home"); } setEpisodeInboxOpen((open) => !open); }}><Icon name="bell" />{Boolean(episodeUpdateStatus?.unreadCount) && <span key={`count-${episodeArrivals}`} className={`episode-update-count${episodeArrivals ? " bump" : ""}`}>{episodeUpdateStatus!.unreadCount}</span>}</button>
          {navIcon("settings", "gear", "settings", updatePending(updateStatus))}
        </nav>
      </header>
      {episodeInbox.shown && screen !== "player" && <EpisodeUpdatesPanel panelRef={episodeInbox.ref} closing={episodeInbox.closing} status={episodeUpdateStatus} posterFor={notificationPoster} onEpisode={(id) => openEpisodeUpdate(id, true)} onSeries={(id) => openEpisodeUpdate(id, false)} onMarkRead={(id) => void changeEpisodeUpdate(id, "read")} onDismiss={(id) => changeEpisodeUpdate(id, "dismiss")} onClose={() => setEpisodeInboxOpen(false)} onViewAll={() => { notificationsOrigin.current = screen; go("notifications"); }} />}
      {paletteOpen && <div className="dim" onClick={() => { if (screen === "series") closeSeriesSearch(); else { setQuery(""); catalogSearch.clear(); } }} />}

      <div className="body">
      {session && (
        <Suspense fallback={<div className="player-message">loading player ···</div>}>
          <PlayerScreen
            session={session}
            subtitleAppearance={subtitleAppearance}
            onSubtitleAppearance={changeSubtitleAppearance}
            fullscreen={playerFullscreen}
            onFullscreenChange={setPlayerFullscreen}
            docked={screen !== "player"}
            corner={appState.settings.miniPlayerCorner ?? "bottom-right"}
            onCornerChange={(corner) => void moveMiniPlayer(corner)}
            width={miniWidth}
            onWidthChange={resizeMiniPlayer}
            episodeCount={playingIndex >= 0 && playingList.length > 1 ? playingList.length : undefined}
            detail={current?.detail}
            message={playerMessage}
            autoplayNext={appState.settings.autoplayNext !== false}
            onPrev={playNeighbour(-1)}
            onNext={playNeighbour(1)}
            onRetry={current ? () => {
              const episode = current.episodes.find((item) => item.id === current.episodeId);
              if (episode) void playEpisode(episode, current.anime, current.mode, episodeGroups, true);
            } : undefined}
            onDock={dockPlayer}
            onEpisodes={showPlayingEpisodes}
            onExpand={expandPlayer}
            onClose={closePlayer}
          />
        </Suspense>
      )}
      {/* Progress, confirmations, and errors float over the page, so they never push its content. */}
      {message && !paletteOpen && screen !== "player" && <div key={displayError ? "error" : message} className={`msg status-pill ${displayError ? "err" : ""}`} role={displayError ? "alert" : "status"}>{message}{busy && !displayError && <span className="dots"> ···</span>}</div>}
      {screen !== "player" && <div key={screen} className={`page page-${screen}`}>
        {screen === "opening" && selectedAnime && <div className="empty" role="status">
          <b>{selectedAnime.title}</b>
          <span>{status?.phase === "failed" ? `Episode ${status.episode.number}: ${status.detail}`
            : status?.phase === "opened" ? `Opened in ${player}`
            : status ? `Opening episode ${status.episode.number} · ${status.detail}` : "Finding your next episode…"}</span>
          <div className="acts-row">
            <button type="button" className="btn" onClick={() => { cancelSeries(); go("home"); }}>Cancel</button>
            <button type="button" className="btn" onClick={() => void openAnime(selectedAnime, { focusEpisodeId: status?.episode.id })}>Episodes</button>
          </div>
        </div>}

        {screen === "notifications" && <EpisodeUpdatesPage status={episodeUpdateStatus} posterFor={notificationPoster}
          onEpisode={(id) => openEpisodeUpdate(id, true)} onSeries={(id) => openEpisodeUpdate(id, false)}
          onMarkRead={(id) => void changeEpisodeUpdate(id, "read")} onDismiss={(id) => changeEpisodeUpdate(id, "dismiss")} />}

        {screen === "home" && (
          <>
            {libraryRows.length === 0
              ? <EmptyLibrary kind="home" onAction={focusSearch} />
              : <>
                {cardSection("continue", "Continue watching", "recent")}
                {cardSection("saved", "Saved", "saved")}
              </>}
            <ScheduleSection settings={appState.settings} library={[...appState.history, ...appState.bookmarks]}
              metadataFor={scheduleMetadata} onMetadata={loadScheduleMetadata}
              onOpen={(anime, episode, audio) => void openAnime(expandWithLinks(anime, appState.providerLinks ?? []), { mode: audio, focusEpisodeId: episode.id })} />
          </>
        )}

        {screen === "browse" && <BrowseScreen state={browseState} setState={setBrowseState} enabled={appState.settings.animeInfo !== false}
          openingId={browseOpening?.id} onOpen={(anime) => void openBrowseAnime(anime)} onSearchSources={searchSourcesFor} />}

        {screen === "catalog-detail" && browseAnime && <BrowseDetail anime={browseAnime} resolving={browseResolving} error={browseResolveError}
          onBack={() => { cancelSeries(); go("browse"); }} onRetry={() => void openBrowseAnime(browseAnime, true)}
          onSearch={() => searchSourcesFor(browseAnime.title)} onBrowse={browseFor} />}

        {screen === "saved" && (appState.bookmarks.length === 0
          ? <EmptyLibrary kind="saved" onAction={focusSearch} />
          : rows.length === 0
            ? <div className="section"><div className="section-head"><h2 id="saved-heading">Saved</h2></div><div className="empty"><b>No saved titles match</b>Try a shorter filter.</div></div>
            : cardSection("saved", "Saved"))}

        {screen === "recent" && (appState.history.length === 0
          ? <EmptyLibrary kind="recent" onAction={focusSearch} />
          : rows.length === 0
            ? <div className="section"><div className="section-head"><h2 id="recent-heading">Recent</h2></div><div className="empty"><b>No recent titles match</b>Try a shorter filter.</div></div>
            : cardSection("recent", "Recent"))}

        {screen === "series" && selectedAnime && (
          <SeriesScreen anime={selectedAnime} progress={progress} isSaved={isSaved} player={player} backLabel={seriesOrigin.current === "browse" ? "Browse" : undefined}
            mode={mode} quality={quality} lastQuery={lastQuery} busy={busy ?? (episodesLoading ? "loading episodes" : undefined)} resolving={resolving}
            pendingSources={pendingSources} sourceErrors={sourceErrors} episodeGroups={episodeGroups} episodeRows={episodeRows}
            episodeCount={episodeCount} seriesMetadata={seriesMetadata.get(selectedAnime)} info={workInfo.get(linkedAnime(selectedAnime))} infoLoading={appState.settings.animeInfo !== false && workInfo.loading(linkedAnime(selectedAnime))} nextUp={nextUp} episodeFilter={episodeFilter}
            episodeSort={episodeSort} jump={jump} playingId={playingId} status={status} metadata={metadata} listRef={listRef}
            onPlay={(episode) => void playEpisode(episode)} onBookmark={() => void toggleBookmark()} onBack={goBack} onBrowse={browseFor}
            onMode={setMode} onQuality={setQuality} onCheckSources={() => void openAnime(selectedAnime, { refresh: true, checkNow: true })}
            onRefreshSources={() => {
              void metadata.refresh(episodeGroups.flatMap((group) => group.episodes.map((episode) => episode.id))).catch((error) => setError(messageFrom(error)));
              seriesMetadata.load(linkedAnime(selectedAnime), "selected", true);
              void openAnime(selectedAnime, { refresh: true });
            }} onJump={jumpTo} onWatched={(episode) => void markWatched(episode)}
            onWatchedAll={() => void markAllWatched()} onDismissStatus={cancelPlay} reorder={reorder}
            onRefreshInfo={() => workInfo.load(linkedAnime(selectedAnime), "selected", true)} onSplitSource={(sourceId) => void splitSource(sourceId)} />
        )}

        {screen === "settings" && (
          <SettingsScreen draft={settingsDraft} setDraft={changeSettings} saved={appState.settings} saveState={settingsSaveState} onRetrySave={retrySettings}
            subtitleAppearance={subtitleAppearance} onSubtitleAppearance={changeSubtitleAppearance}
            bookmarkCount={appState.bookmarks.length} linkCount={(appState.providerLinks ?? []).length}
            onClearLinks={() => void clearSourceLinks()}
            updateStatus={updateStatus} updateChecking={updateChecking} onCheckUpdates={() => checkForUpdates(true)} onOpenUpdate={openLatestRelease} onSkipUpdate={dismissUpdate}
            episodeUpdateStatus={episodeUpdateStatus} onCheckEpisodes={() => { void window.aniDesktop.checkEpisodeUpdates(true).then(setEpisodeUpdateStatus); }}
            updateInstall={updateInstall.status} onDownloadUpdate={() => { if (updateStatus?.latestVersion) updateInstall.download(updateStatus.latestVersion); }} onInstallUpdate={updateInstall.install}
            onOpenLogs={() => { void run("opening player logs", () => window.aniDesktop.openPlayerLogs()); }} />
        )}

        {screen !== "opening" && <SiteFooter current={screen === "home" || screen === "browse" || screen === "saved" || screen === "recent" || screen === "settings" ? screen : undefined}
          backdrop={backdrop && backdrop.page === backdropPage ? backdrop.art : undefined}
          onNavigate={(next: FooterScreen) => { setQuery(""); catalogSearch.clear(); go(next); }} />}
      </div>}
      </div>

      {showHints && screen !== "player" && screen !== "series" && (
        <div className="hints" role="note">
          {screen === "settings" ? <><span><b>{shortcut("S")}</b> save</span><span><b>esc</b> back</span></>
            : <><span><b>←→↑↓</b> move</span><span><b>↵</b> {paletteOpen ? "open" : "play"}</span><span><b>o</b> open</span><span><b>x</b> remove</span><span><b>{shortcut("K")}</b> search</span></>}
          {session && <span><b>`</b> player</span>}
          <span><b>?</b> hide</span>
        </div>
      )}
    </div>
  );
}

export default App;
