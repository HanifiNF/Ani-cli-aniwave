import { usePlayerSession } from "./usePlayerSession";
import SearchPalette from "./SearchPalette";
import SeriesScreen from "./SeriesScreen";
import type { PlayStatus, NowPlaying } from "./playback";
import SettingsScreen from "./SettingsScreen";
import LibrarySection from "./LibrarySection";
import { asAnime, libraryEntry, libraryEntryAllWatched, type Row, type LibraryKind } from "./library";
import { episodeValue, episodeRowsOf, nextUpIndex, providerList, type EpisodeFilter, type EpisodeSort } from "./episodes";
import { applyTheme } from "./theme";
import { bestQuality } from "../shared/episode-metadata";
import { messageFrom } from "./errors";
import { DEFAULT_STATE, catalogScope } from "../shared/settings";
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  AnimeResult,
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
  TranslationMode
} from "../shared/contracts";
import { catalogRequestId } from "./catalog-request";
import { useEpisodeMetadata } from "./useEpisodeMetadata";
import { useAnimeSearch } from "./useAnimeSearch";
import { MINI_PLAYER_WIDTH, clampMiniPlayerWidth } from "../shared/contracts";
import { animeSources, enabledProviders, likelyDuplicate, mergeKey, overlaps, sourceIds, unifyAnimeResults } from "../shared/catalog";
import { Icon } from "./icons";
import { withTransition } from "./transition";

type Screen = "home" | "series" | "opening" | "saved" | "recent" | "settings" | "player";
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
    setScreen("player"); setStatus(undefined); setError(undefined); setNotice(undefined);
  });
  const [nowPlaying, setNowPlaying] = useState<NowPlaying>();
  const [settingsDraft, setSettingsDraft] = useState<Settings>(DEFAULT_STATE.settings);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [sourceErrors, setSourceErrors] = useState<Partial<Record<ProviderName, string>>>({});
  const [pendingSources, setPendingSources] = useState<ProviderName[]>([]);

  const catalogSearch = useAnimeSearch(query, "auto",
    [appState.settings.aniwaveBaseUrl, appState.settings.anidbBaseUrl, appState.settings.hianimeBaseUrl, enabledProviders(appState.settings).join(",")], screen === "home" && !composing);
  const { results, lastQuery } = catalogSearch;
  const unifiedResults = useMemo(() => unifyAnimeResults(results, appState.providerLinks ?? []), [results, appState.providerLinks]);

  const fieldRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const playToken = useRef(0);
  const playbackRequest = useRef<string | undefined>(undefined);
  useEffect(() => () => { if (playbackRequest.current) window.aniDesktop.cancelCatalog(playbackRequest.current); }, []);
  const mergePromptActive = useRef(false);
  const keyHandler = useRef<(event: KeyboardEvent) => void>(() => undefined);

  useEffect(() => {
    window.aniDesktop.getState().then((state) => {
      setAppState(state);
      setSettingsDraft(state.settings);
      setMode(state.settings.preferredMode);
      setQuality(state.settings.preferredQuality);
      setProvider(state.settings.preferredProvider);
      setStateLoaded(true);
    }).catch((reason) => setError(messageFrom(reason)));
  }, []);

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

  const settingsDirty = JSON.stringify(settingsDraft) !== JSON.stringify(appState.settings);
  const themeSource = screen === "settings" ? settingsDraft : appState.settings;
  useEffect(() => applyTheme(themeSource.theme, themeSource.customTheme), [themeSource.theme, themeSource.customTheme]);

  const filter = query.trim().toLowerCase();
  const matches = (entry: LibraryEntry) => !filter || entry.title.toLowerCase().includes(filter);
  // The search palette covers the home page while a query or its results exist.
  const paletteOpen = screen === "home" && (Boolean(query.trim()) || unifiedResults.length > 0);
  // The home sections stay on the page behind the palette; the keyboard cursor moves to the results while it is open.
  const libraryRows = useMemo<Row[]>(() => [
    ...appState.history.slice(0, HOME_CARDS).map((entry): Row => ({ kind: "continue", entry })),
    ...appState.bookmarks.slice(0, HOME_CARDS).map((entry): Row => ({ kind: "saved", entry }))
  ], [appState.history, appState.bookmarks]);
  const rows = useMemo<Row[]>(() => {
    if (screen === "home") return paletteOpen ? unifiedResults.map((anime): Row => ({ kind: "results", anime })) : libraryRows;
    if (screen === "saved") return appState.bookmarks.filter(matches).map((entry): Row => ({ kind: "saved", entry }));
    if (screen === "recent") return appState.history.filter(matches).map((entry): Row => ({ kind: "recent", entry }));
    return [];
  }, [screen, paletteOpen, unifiedResults, libraryRows, appState.history, appState.bookmarks, filter]);

  const isSaved = Boolean(selectedAnime && appState.bookmarks.some((entry) => overlaps(entry, selectedAnime)));
  const progress = selectedAnime ? appState.history.find((entry) => overlaps(entry, selectedAnime)) : undefined;
  const player = appState.settings.playbackTarget === "builtin" ? "built-in player" : playerName(appState.settings.playerPath);
  const episodeRows = useMemo(() => episodeRowsOf(episodeGroups, progress, episodeFilter, episodeSort), [episodeGroups, progress, episodeFilter, episodeSort]);
  const episodeCount = new Set(episodeGroups.flatMap((group) => group.episodes.map((episode) => episode.number))).size;
  const seriesCursor = Math.max(0, episodeRows.findIndex((row) => row.episode.id === selectedEpisodeId));
  const setEpisodeCursor = (index: number) => setSelectedEpisodeId(episodeRows[index]?.episode.id);
  const sourceScope = catalogScope(appState.settings);
  const metadata = useEpisodeMetadata(listRef, screen === "series", episodeRows.map((row) => row.episode.id), episodeRows[seriesCursor]?.episode.id, mode, sourceScope);

  // Anchor the first visible source row while asynchronous provider updates insert rows above it.
  const scrollAnchor = useRef<{ id: string; top: number } | undefined>(undefined);
  useLayoutEffect(() => {
    const page = listRef.current?.closest<HTMLElement>(".page");
    const anchor = scrollAnchor.current;
    if (page && anchor) {
      const row = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-episode]") ?? [])].find((item) => item.dataset.episode === anchor.id);
      if (row) page.scrollTop += row.getBoundingClientRect().top - anchor.top;
    }
    const capture = () => {
      if (!page) return;
      const top = page.getBoundingClientRect().top;
      const row = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-episode]") ?? [])].find((item) => item.getBoundingClientRect().bottom > top);
      scrollAnchor.current = row ? { id: row.dataset.episode!, top: row.getBoundingClientRect().top } : undefined;
    };
    capture(); page?.addEventListener("scroll", capture, { passive: true });
    return () => { page?.removeEventListener("scroll", capture); };
  }, [episodeRows, screen]);

  const previousResults = useRef(results);
  useLayoutEffect(() => {
    const previous = previousResults.current[cursor];
    if (screen === "home" && previous && results !== previousResults.current) {
      const index = results.findIndex((anime) => overlaps(previous, anime));
      setCursor(Math.max(0, index));
    }
    previousResults.current = results;
  }, [results]);
  useEffect(() => { if (screen !== "series" && screen !== "player") setCursor(0); }, [screen, filter]);
  // Opening a series shows its header first; the list follows the cursor only once it moves.
  const skipReveal = useRef(false);
  // Reveal follows the selected row itself, so a state refresh (saving, window focus) does not scroll the list back.
  const cursorKey = screen === "series" ? episodeRows[seriesCursor]?.episode.id : rows[cursor]?.anime?.id ?? rows[cursor]?.entry?.animeId;
  useEffect(() => {
    if (skipReveal.current) { skipReveal.current = false; return; }
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
  }, [cursorKey, screen]);
  useEffect(() => {
    if (screen === "series") listRef.current?.focus();
    else if (screen !== "settings" && screen !== "player") fieldRef.current?.focus();
  }, [screen]);
  useEffect(() => {
    const list = listRef.current;
    // Follow the selection while navigating the episode list, preserving focus if the user leaves it.
    if (screen === "series" && list?.contains(document.activeElement)) {
      list.querySelector<HTMLButtonElement>('[data-cursor="true"] .src-hit')?.focus({ preventScroll: true });
    }
  }, [screen, selectedEpisodeId]);

  async function run<T>(label: string, operation: () => Promise<T>): Promise<T | undefined> {
    setBusy(label); setError(undefined); setNotice(undefined);
    try { return await operation(); }
    catch (reason) { setError(messageFrom(reason)); return undefined; }
    finally { setBusy(undefined); }
  }

  function go(next: Screen) {
    setScreen(next);
    setError(undefined); setNotice(undefined);
    if (next !== "home" && next !== "series") setQuery("");
    if (next === "settings") setSettingsDraft(appState.settings);
  }

  // Watched marks and resume points change while the player has the store.
  const refreshState = () => { void window.aniDesktop.getState().then(setAppState).catch((reason) => setError(messageFrom(reason))); };

  // Returning to the list puts the cursor on the playing episode when it belongs to the open series.
  function focusPlayingEpisode() {
    const id = session?.request.episode?.id;
    const index = id && nowPlaying?.anime.id === selectedAnime?.id ? episodeRows.findIndex((row) => row.episode.id === id) : -1;
    if (index >= 0) setEpisodeCursor(index);
  }

  function dockPlayer() {
    withTransition(() => {
      setStatus(undefined); setError(undefined); setNotice(undefined);
      setScreen(selectedAnime ? "series" : "home");
      focusPlayingEpisode();
    });
    refreshState();
  }

  function expandPlayer() {
    if (session) withTransition(() => { setScreen("player"); setError(undefined); setNotice(undefined); });
  }

  function closePlayer() {
    setSession(undefined); setStatus(undefined);
    if (screen === "player") { setScreen(selectedAnime ? "series" : "home"); focusPlayingEpisode(); }
    refreshState();
  }

  function showPlayingEpisodes() {
    setEpisodeFilter("all");
    if (nowPlaying && selectedAnime?.id !== nowPlaying.anime.id) { void openAnime(nowPlaying.anime, { focusEpisodeId: nowPlaying.episodeId }); refreshState(); return; }
    if (nowPlaying) setSelectedEpisodeId(nowPlaying.episodeId);
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
    if (screen === "home") { if (query) setQuery(""); catalogSearch.clear(); return; }
    if (screen === "series") setSelectedAnime(undefined);
    go("home");
  }

  function changeQuery(value: string) {
    setQuery(value);
    if (!value.trim()) catalogSearch.clear();
    if (screen === "home" || screen === "series") {
      setError(undefined); setNotice(undefined);
      if (screen === "series") {
        setSelectedAnime(undefined);
        setScreen("home");
      }
    }
  }

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
    if (screen !== "series" && screen !== "player" && screen !== "opening") { cancelSeries(); setBusy(undefined); setResolving(false); }
  }, [screen, sourceScope]);
  useEffect(() => () => cancelSeries(), []);

  async function openAnime(anime: AnimeResult, options: { resumeAfter?: string; mode?: TranslationMode; autoPlay?: boolean; refresh?: boolean; checkNow?: boolean; focusEpisodeId?: string } = {}): Promise<boolean> {
    cancelSeries();
    const token = openToken.current;
    const animeProgress = appState.history.find((entry) => overlaps(entry, anime));
    const preferred = animeProgress?.lastProvider ?? (provider === "auto" ? anime.provider : provider);
    playToken.current += 1;
    if (playbackRequest.current) window.aniDesktop.cancelCatalog(playbackRequest.current);
    setSelectedAnime(anime);
    if (!options.refresh) { setSelectedEpisodeId(options.focusEpisodeId); scrollAnchor.current = undefined; }
    if (!options.refresh) setEpisodeGroups([]);
    setStatus(undefined); setJump(""); setSourceErrors({});
    setScreen(options.autoPlay ? "opening" : "series");
    if (options.mode) setMode(options.mode);
    setBusy("loading episodes"); setError(undefined); setNotice(undefined);
    let currentAnime = anime;
    let groups: EpisodeGroup[] = options.refresh ? episodeGroups : [];
    let positioned = Boolean(options.focusEpisodeId || (options.refresh && selectedEpisodeId));
    let played = false;
    let attempting = false, finished = false;
    let targetNumber: string | undefined;
    const attempted = new Set<string>();
    const savedProgress = animeProgress?.progressByProvider?.[preferred];
    const resumeEpisode = (savedProgress?.completed ?? animeProgress?.completed) === false && savedProgress?.lastEpisodeId?.startsWith(`${preferred}:`) && enabledProviders(appState.settings).includes(preferred)
      ? { id: savedProgress.lastEpisodeId, number: savedProgress.lastEpisode, provider: preferred } : undefined;
    const known = new Set(animeSources(anime).map((source) => source.id));
    const missing = enabledProviders(appState.settings).filter((name) => !animeSources(anime).some((source) => source.provider === name));
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
      if (!positioned) { positioned = true; skipReveal.current = true; setSelectedEpisodeId(list[index]?.episode.id); }
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
    if (rowIndex >= 0) setEpisodeCursor(rowIndex);
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
    const state = await run("updating saved titles", () => window.aniDesktop.toggleBookmark(entry));
    if (state) setAppState(state);
  }

  // The checkbox on a row records progress through that episode on its provider.
  async function markWatched(episode: Episode) {
    if (!selectedAnime) return;
    const state = await run("updating progress", () => window.aniDesktop.recordHistory(libraryEntry(selectedAnime, episode, mode)));
    if (state) setAppState(state);
  }

  // The sidebar button records the last episode on every source at once.
  async function markAllWatched() {
    if (!selectedAnime) return;
    const entry = libraryEntryAllWatched(selectedAnime, episodeGroups, mode, progress?.lastProvider);
    if (!entry) return;
    const state = await run("updating progress", () => window.aniDesktop.recordHistory(entry));
    if (state) setAppState(state);
  }

  function mergeCandidate(anime: AnimeResult): AnimeResult | undefined {
    return unifiedResults.find((candidate) => candidate.id !== anime.id && likelyDuplicate(anime, candidate));
  }

  function libraryMergeCandidate(entry: LibraryEntry): LibraryEntry | undefined {
    const entries = [...appState.history, ...appState.bookmarks]
      .filter((candidate, index, all) => all.findIndex((item) => item.animeId === candidate.animeId) === index);
    return entries.find((candidate) => candidate.animeId !== entry.animeId && likelyDuplicate(entry, candidate));
  }

  async function manuallyLink(anime: AnimeResult) {
    const candidate = mergeCandidate(anime);
    if (!candidate || !window.confirm(`Merge “${anime.title}” with “${candidate.title}” and remember that they are the same anime?`)) return;
    const state = await run("linking provider records", () => window.aniDesktop.linkSources([...sourceIds(anime), ...sourceIds(candidate)]));
    if (state) { setAppState(state); setNotice("provider records merged"); }
  }

  async function manuallyMergeEntry(entry: LibraryEntry) {
    const candidate = libraryMergeCandidate(entry);
    if (!candidate || !window.confirm(`Merge “${entry.title}” with “${candidate.title}” while keeping progress from both sources?`)) return;
    const state = await run("merging library records", () => window.aniDesktop.mergeEntries(entry.animeId, candidate.animeId));
    if (state) { setAppState(state); setNotice("library records merged"); }
  }

  async function activate(row: Row) {
    if (row.anime) { await openAnime(row.anime); return; }
    if (row.entry) await openAnime(asAnime(row.entry), { resumeAfter: row.entry.lastEpisode, mode: row.entry.mode, autoPlay: row.kind !== "saved" });
  }

  async function openRow(row: Row) {
    if (row.anime) await openAnime(row.anime);
    else if (row.entry) await openAnime(asAnime(row.entry), { resumeAfter: row.entry.lastEpisode, mode: row.entry.mode });
  }

  async function removeRow(row: Row) {
    if (!row.entry) return;
    const id = row.entry.animeId;
    const state = await run("removing", () => row.kind === "saved" ? window.aniDesktop.removeBookmark(id) : window.aniDesktop.removeHistory(id));
    if (state) setAppState(state);
  }

  async function clearHistory() {
    if (!window.confirm("Clear all recent titles?")) return;
    const state = await run("clearing history", () => window.aniDesktop.clearHistory());
    if (state) setAppState(state);
  }

  async function clearSourceLinks() {
    if (!window.confirm("Forget every remembered match between providers? Series will be looked up again when opened.")) return;
    const state = await run("forgetting source links", () => window.aniDesktop.clearSourceLinks());
    if (state) { setAppState(state); setNotice("source links forgotten"); }
  }

  async function saveSettings() {
    const state = await run("saving settings", () => window.aniDesktop.saveSettings(settingsDraft));
    if (state) {
      setAppState(state);
      setMode(state.settings.preferredMode);
      setQuality(state.settings.preferredQuality);
      setProvider(state.settings.preferredProvider);
      setScreen("home");
      setNotice("settings saved");
    }
  }

  // Changing the order or filter keeps the selection on the same row when it is still shown.
  function reorder(filter: EpisodeFilter, sort: EpisodeSort) {
    const id = episodeRows[seriesCursor]?.episode.id;
    const next = episodeRowsOf(episodeGroups, progress, filter, sort);
    setEpisodeFilter(filter); setEpisodeSort(sort);
    const index = id ? next.findIndex((row) => row.episode.id === id) : -1;
    setSelectedEpisodeId(next[index >= 0 ? index : 0]?.episode.id);
  }

  function jumpTo(value: string) {
    setJump(value);
    const wanted = value.trim();
    if (!wanted) return;
    const index = episodeRows.findIndex((row) => row.number === wanted) ;
    const loose = index >= 0 ? index : episodeRows.findIndex((row) => row.number.startsWith(wanted));
    if (loose >= 0) setEpisodeCursor(loose);
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
    if (screen === "player") return; // The player screen owns its keys.
    // The backtick returns to the docked player from anywhere but the settings form; it is never useful in a title search.
    if (event.key === "`" && session && screen !== "settings" && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); expandPlayer(); return; }
    if (event.metaKey || event.ctrlKey) {
      if (event.key === "s" && screen === "settings") { event.preventDefault(); void saveSettings(); }
      else if (event.key === "k" && screen !== "settings") { event.preventDefault(); if (screen !== "home" && screen !== "series") go("home"); fieldRef.current?.focus(); fieldRef.current?.select(); }
      // The corner player grows and shrinks from anywhere while docked, even with the search field focused.
      else if (session && (event.key === "=" || event.key === "+")) { event.preventDefault(); resizeMiniPlayer(miniWidth + MINI_PLAYER_WIDTH.step); }
      else if (session && (event.key === "-" || event.key === "_")) { event.preventDefault(); resizeMiniPlayer(miniWidth - MINI_PLAYER_WIDTH.step); }
      return;
    }
    if (event.altKey) return;
    if (event.key === "Enter" && target?.closest("button:not(.hit):not(.src-hit)")) return;
    if (screen === "settings") { if (event.key === "Escape") goBack(); return; }
    if (event.key === "Escape") { event.preventDefault(); if (showHints) { setShowHints(false); return; } goBack(); return; }
    if (screen === "opening") return;
    if (!typing && event.key === "?") { event.preventDefault(); setShowHints((value) => !value); return; }
    if (!typing && event.key === "/") {
      event.preventDefault(); fieldRef.current?.focus(); fieldRef.current?.select(); return;
    }
    if (screen === "series") {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault(); setEpisodeCursor(Math.min(Math.max(seriesCursor + (event.key === "ArrowUp" ? -1 : 1), 0), episodeRows.length - 1)); return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (episodeRows[seriesCursor]) void playEpisode(episodeRows[seriesCursor].episode);
        return;
      }
      if (!typing && event.key === "s") void toggleBookmark();
      return;
    }
    if (paletteOpen) {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); moveCursor(event.key === "ArrowUp" ? -1 : 1, rows.length); return; }
    } else if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
      if (typing && (event.key === "ArrowLeft" || event.key === "ArrowRight") && (target as HTMLInputElement).value) return;
      event.preventDefault(); moveCard(event.key); return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (screen === "home" && query.trim() && (!catalogSearch.ready && (catalogSearch.pending || target === fieldRef.current))) {
        catalogSearch.searchNow(); return;
      }
      if (rows[cursor]) void activate(rows[cursor]);
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
      canMerge={(entry) => Boolean(libraryMergeCandidate(entry))} onMerge={(entry) => void manuallyMergeEntry(entry)} />;
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
    const row = all[nextUpIndex(all, episodeGroups, progress, progress?.lastProvider ?? (provider === "auto" ? selectedAnime?.provider : provider) ?? "aniwave")];
    return row ? all.find((item) => !item.watched && item.number === row.number) ?? row : undefined;
  }, [episodeGroups, progress, selectedAnime, provider]);
  const navIcon = (target: Screen, name: "home" | "bookmark" | "clock" | "gear", text: string) => (
    <button type="button" className={screen === target ? "on" : ""} title={text} onClick={() => go(target)}><Icon name={name} /><span className="sr-only">{text}</span></button>
  );

  return (
    <div className={`app ${screen === "player" && playerFullscreen ? "is-fullscreen" : ""}`}>
      <header className="bar">
        <div className="brand">
          <button type="button" className="logo" onClick={() => { go("home"); setQuery(""); catalogSearch.clear(); }} aria-label="Home">ANI<em>desktop</em></button>
        </div>
        <div className={`searchbox ${paletteOpen ? "open" : ""}`}>
          {screen === "settings" || screen === "player"
            ? <button type="button" className="search as-button" onClick={() => { go("home"); }}><Icon name="search" /><span>Search anime</span><kbd>⌘K</kbd></button>
            : <label className="search">
                <Icon name="search" />
                <input ref={fieldRef} value={query} onChange={(event) => changeQuery(event.target.value)}
                  onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
                  maxLength={120} placeholder={placeholder} aria-label={placeholder} spellCheck={false} />
                <span className="search-throbber" aria-hidden="true">
                  {catalogSearch.pending && <><span>·</span><span>·</span><span>·</span></>}
                </span>
                <span className="sr-only" role="status">{searching ? "Searching" : catalogSearch.ready ? `${unifiedResults.length} ${unifiedResults.length === 1 ? "title" : "titles"} found for ${lastQuery}` : ""}</span>
                {paletteOpen || query
                  ? <button type="button" className="clear" aria-label="Clear search" onClick={() => { setQuery(""); catalogSearch.clear(); fieldRef.current?.focus(); }}><Icon name="x" /></button>
                  : <kbd>⌘K</kbd>}
              </label>}
          {paletteOpen && (
            <SearchPalette results={unifiedResults} query={query} lastQuery={lastQuery} cursor={cursor}
              ready={catalogSearch.ready} pending={catalogSearch.pending} providerErrors={catalogSearch.providerErrors}
              message={searchMessage} error={searchError} onRetry={catalogSearch.retrySources}
              onOpen={(anime) => void openAnime(anime)} onFocus={setCursor}
              canMerge={(anime) => Boolean(mergeCandidate(anime))} onMerge={(anime) => void manuallyLink(anime)} />
          )}
        </div>
        <nav className="icons" aria-label="Sections">
          {navIcon("home", "home", "home")}
          {navIcon("saved", "bookmark", "saved")}
          {navIcon("recent", "clock", "recent")}
          {navIcon("settings", "gear", "settings")}
        </nav>
      </header>
      {paletteOpen && <div className="dim" onClick={() => { setQuery(""); catalogSearch.clear(); }} />}

      <div className="body">
      {session && (
        <Suspense fallback={<div className="player-message">loading player ···</div>}>
          <PlayerScreen
            session={session}
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
      {screen !== "player" && <div key={screen} className={`page page-${screen}`}>
        {message && !paletteOpen && <div className={`msg ${displayError ? "err" : ""}`} role={displayError ? "alert" : "status"}>{message}{busy && <span className="dots"> ···</span>}</div>}
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

        {screen === "home" && (
          libraryRows.length === 0
            ? !paletteOpen && <div className="empty"><b>Nothing here yet</b>Search for a title with <kbd>⌘K</kbd>. Titles you watch and save appear here.</div>
            : <>
                {cardSection("continue", "Continue watching", "recent")}
                {cardSection("saved", "Saved", "saved")}
              </>
        )}

        {screen === "saved" && (rows.length === 0
          ? <div className="section"><div className="section-head"><h2 id="saved-heading">Saved</h2></div><div className="empty"><b>{filter ? "No saved titles match" : "Nothing saved yet"}</b>{filter ? "Try a shorter filter." : "Open a series and choose save. Select a saved title to browse its episodes."}</div></div>
          : cardSection("saved", "Saved"))}

        {screen === "recent" && (rows.length === 0
          ? <div className="section"><div className="section-head"><h2 id="recent-heading">Recent</h2></div><div className="empty"><b>{filter ? "No recent titles match" : "Nothing watched yet"}</b>{filter ? "Try a shorter filter." : `Every episode you open in ${player} is listed here.`}</div></div>
          : cardSection("recent", "Recent"))}

        {screen === "series" && selectedAnime && (
          <SeriesScreen anime={selectedAnime} progress={progress} isSaved={isSaved} player={player}
            mode={mode} quality={quality} lastQuery={lastQuery} busy={busy} resolving={resolving}
            pendingSources={pendingSources} sourceErrors={sourceErrors} episodeGroups={episodeGroups} episodeRows={episodeRows}
            episodeCount={episodeCount} seriesCursor={seriesCursor} nextUp={nextUp} episodeFilter={episodeFilter}
            episodeSort={episodeSort} jump={jump} playingId={playingId} status={status} metadata={metadata} listRef={listRef}
            onPlay={(episode) => void playEpisode(episode)} onBookmark={() => void toggleBookmark()} onBack={goBack}
            onMode={setMode} onQuality={setQuality} onCheckSources={() => void openAnime(selectedAnime, { refresh: true, checkNow: true })}
            onRefreshSources={() => {
              void metadata.refresh(episodeGroups.flatMap((group) => group.episodes.map((episode) => episode.id))).catch((error) => setError(messageFrom(error)));
              void openAnime(selectedAnime, { refresh: true });
            }} onJump={jumpTo} onCursor={setEpisodeCursor} onWatched={(episode) => void markWatched(episode)}
            onWatchedAll={() => void markAllWatched()} onDismissStatus={cancelPlay} reorder={reorder} />
        )}

        {screen === "settings" && (
          <SettingsScreen draft={settingsDraft} setDraft={setSettingsDraft} saved={appState.settings}
            bookmarkCount={appState.bookmarks.length} linkCount={(appState.providerLinks ?? []).length} dirty={settingsDirty}
            onSave={() => void saveSettings()} onCancel={goBack} onClearLinks={() => void clearSourceLinks()}
            onOpenLogs={() => { void run("opening player logs", () => window.aniDesktop.openPlayerLogs()); }} />
        )}
      </div>}
      </div>

      {showHints && screen !== "player" && (
        <div className="hints" role="note">
          {screen === "settings" ? <><span><b>⌘S</b> save</span><span><b>esc</b> back</span></>
            : screen === "series" ? <><span><b>↑↓</b> move</span><span><b>↵</b> play</span><span><b>s</b> save</span><span><b>/</b> search</span><span><b>esc</b> back</span></>
            : <><span><b>←→↑↓</b> move</span><span><b>↵</b> {paletteOpen ? "open" : "play"}</span><span><b>o</b> open</span><span><b>x</b> remove</span><span><b>⌘K</b> search</span></>}
          {session && <span><b>`</b> player</span>}
          <span><b>?</b> hide</span>
        </div>
      )}
    </div>
  );
}

export default App;
