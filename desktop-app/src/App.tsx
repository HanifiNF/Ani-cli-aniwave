import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import type {
  AnimeResult,
  CustomTheme,
  Episode,
  EpisodeGroup,
  LibraryEntry,
  MiniPlayerCorner,
  PersistedState,
  PlayerSession,
  ProviderName,
  ProviderPreference,
  Settings,
  ThemePreset,
  TranslationMode
} from "../shared/contracts";
import { useAnimeSearch } from "./useAnimeSearch";
import { THEME_NAMES, THEME_PRESETS, resolveTheme, videoBrand } from "../shared/theme";
import { MINI_PLAYER_WIDTH, clampMiniPlayerWidth } from "../shared/contracts";
import { applyAppIcon } from "./appIcon";
import { animeSources, likelyDuplicate, mergeKey, overlaps, sourceIds, unifyAnimeResults } from "../shared/catalog";
import { Icon } from "./icons";

type Screen = "home" | "series" | "saved" | "recent" | "settings" | "player";
// Vidstack and hls.js load with the first playback, not at startup.
const loadPlayerScreen = () => import("./PlayerScreen");
const PlayerScreen = lazy(loadPlayerScreen);
type RowKind = "results" | "continue" | "saved" | "recent";
interface Row { kind: RowKind; anime?: AnimeResult; entry?: LibraryEntry; }
interface PlayStatus { episode: Episode; phase: "finding" | "opening" | "opened" | "failed"; detail: string; }
/** What the player is showing, captured when playback starts so browsing elsewhere does not change it. */
interface NowPlaying { episodeId: string; detail: string; mode: TranslationMode; anime: AnimeResult; episodes: Episode[]; }
/** One source row in the grouped episode list. */
interface EpisodeRow { episode: Episode; number: string; watched: boolean; first: boolean; }
type EpisodeFilter = "all" | "unwatched" | "watched";
type EpisodeSort = "newest" | "oldest";

const QUALITIES = ["best", "1080p", "720p", "480p", "360p"];
const PROVIDERS: ProviderPreference[] = ["auto", "aniwave", "anidb", "hianime"];
const PROVIDER_ORDER: ProviderName[] = ["aniwave", "anidb", "hianime"];
const HOME_CARDS = 8; // cards per row on the home screen; the full lists use the same column count
const QUALITY_CACHE_KEY = "ani.episodeQuality";
const QUALITY_CACHE_LIMIT = 3000;

const emptyState: PersistedState = {
  bookmarks: [],
  history: [],
  settings: {
    playerPath: "", playbackTarget: "builtin", startPlayerFullscreen: true, autoplayNext: true, preferredQuality: "best", preferredMode: "sub", preferredProvider: "auto",
    aniwaveBaseUrl: "https://aniwaves.ru", anidbBaseUrl: "https://anidb.app", hianimeBaseUrl: "https://hianimes.se", theme: "graphite", customTheme: { ...THEME_PRESETS.graphite }
  }, providerLinks: [], dismissedMergeKeys: []
};

const providerOf = (id: string): ProviderName => id.startsWith("aniwave:") ? "aniwave" : id.startsWith("hianime:") ? "hianime" : "anidb";
const asAnime = (entry: LibraryEntry): AnimeResult => ({ id: entry.animeId, title: entry.title, poster: entry.poster, provider: entry.lastProvider ?? providerOf(entry.animeId), sources: animeSources(entry) });
const playerName = (path: string): string => path.split(/[\\/]/).pop()?.replace(/\.exe$/i, "") || "player";
const episodeValue = (number: string): number => { const value = Number.parseFloat(number); return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY; };
const qualityValue = (quality: string): number => Number.parseInt(quality, 10) || 0;

function messageFrom(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

function libraryEntry(anime: AnimeResult, episode: Episode | undefined, mode: TranslationMode): LibraryEntry {
  const lastProvider = episode?.provider ?? anime.provider;
  const updatedAt = new Date().toISOString();
  const lastEpisode = episode?.number ?? "1";
  return { animeId: anime.id, title: anime.title, lastEpisode, mode, updatedAt, poster: anime.poster, sources: animeSources(anime), lastProvider, progressByProvider: { [lastProvider]: { lastEpisode, mode, updatedAt } } };
}

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const day = 86_400_000;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= today) return `today ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  if (date.getTime() >= today - day) return "yesterday";
  if (date.getTime() >= today - 6 * day) return date.toLocaleDateString([], { weekday: "short" });
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

function applyTheme(theme: ThemePreset, custom: CustomTheme): () => void {
  const colours = resolveTheme(theme, custom);
  const root = document.documentElement.style;
  root.setProperty("--theme-bg", colours.background);
  root.setProperty("--theme-text", colours.text);
  root.setProperty("--theme-cursor", colours.highlight);
  const brand = videoBrand(colours);
  root.setProperty("--theme-video-brand", brand.colour);
  root.setProperty("--theme-video-brand-text", brand.text);
  return applyAppIcon(colours);
}

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
function episodeRowsOf(groups: EpisodeGroup[], progress: LibraryEntry | undefined, filter: EpisodeFilter, sort: EpisodeSort): EpisodeRow[] {
  const byNumber = new Map<string, Episode[]>();
  for (const provider of PROVIDER_ORDER) {
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
function nextUpIndex(rows: EpisodeRow[], groups: EpisodeGroup[], progress: LibraryEntry | undefined, preferred: ProviderName, resumeAfter?: string): number {
  const available = groups.filter((group) => group.episodes.length);
  const provider = available.find((group) => group.provider === preferred)?.provider ?? PROVIDER_ORDER.find((name) => available.some((group) => group.provider === name)) ?? available[0]?.provider;
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

function loadQualityCache(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(QUALITY_CACHE_KEY) ?? "{}") as Record<string, string>; }
  catch { return {}; }
}
function saveQualityCache(cache: Record<string, string>) {
  try {
    const entries = Object.entries(cache);
    localStorage.setItem(QUALITY_CACHE_KEY, JSON.stringify(Object.fromEntries(entries.slice(-QUALITY_CACHE_LIMIT))));
  } catch { /* storage unavailable */ }
}

function Art({ src, className }: { src?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <span className={`art ${className ?? ""}`}>
      {src && !failed && <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />}
    </span>
  );
}

function Chips<T extends string>({ label, value, options, onChange, names }: { label?: string; value: T; options: readonly T[]; onChange: (value: T) => void; names?: Partial<Record<T, string>> }) {
  return (
    <span className="chips-row">
      {label && <span className="chips-lab">{label}</span>}
      <span className="chips" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button type="button" key={option} role="radio" aria-checked={option === value} className={option === value ? "on" : ""} onClick={() => onChange(option)}>{names?.[option] ?? option}</button>
        ))}
      </span>
    </span>
  );
}

function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [appState, setAppState] = useState<PersistedState>(emptyState);
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [selectedAnime, setSelectedAnime] = useState<AnimeResult>();
  const [episodeGroups, setEpisodeGroups] = useState<EpisodeGroup[]>([]);
  const [episodeFilter, setEpisodeFilter] = useState<EpisodeFilter>("all");
  const [episodeSort, setEpisodeSort] = useState<EpisodeSort>("newest");
  const [jump, setJump] = useState("");
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<TranslationMode>("sub");
  const [provider, setProvider] = useState<ProviderPreference>("auto"); // search scope, from settings
  const [quality, setQuality] = useState("best");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [status, setStatus] = useState<PlayStatus>();
  const [session, setSession] = useState<PlayerSession>();
  const [playerFullscreen, setPlayerFullscreen] = useState(false);
  const [nowPlaying, setNowPlaying] = useState<NowPlaying>();
  const [settingsDraft, setSettingsDraft] = useState<Settings>(emptyState.settings);
  const [stateLoaded, setStateLoaded] = useState(false);
  const [showHints, setShowHints] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [qualities, setQualities] = useState<Record<string, string>>(() => loadQualityCache());

  const catalogSearch = useAnimeSearch(query, provider,
    [appState.settings.aniwaveBaseUrl, appState.settings.anidbBaseUrl, appState.settings.hianimeBaseUrl], screen === "home" && !composing);
  const { results, lastQuery } = catalogSearch;
  const unifiedResults = useMemo(() => unifyAnimeResults(results, appState.providerLinks ?? []), [results, appState.providerLinks]);

  const fieldRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const playToken = useRef(0);
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

  // The main process loads streams into this window. A load replaces the current session and shows the player screen.
  useEffect(() => {
    const player = window.aniDesktop.player;
    const show = (next: PlayerSession | undefined) => {
      if (!next) return;
      setSession(next); setPlayerFullscreen(next.fullscreen);
      setScreen("player"); setStatus(undefined); setError(undefined); setNotice(undefined);
    };
    const unsubscribe = player.onLoad(show);
    const unsubscribeFullscreen = player.onFullscreenChange(setPlayerFullscreen);
    player.ready().then(show, () => undefined);
    return () => { unsubscribe(); unsubscribeFullscreen(); };
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
  const episodeCount = Math.max(0, ...episodeGroups.map((group) => group.episodes.length));

  useEffect(() => { if (screen !== "series" && screen !== "player") setCursor(0); }, [screen, results, filter]);
  // Opening a series shows its header first; the list follows the cursor only once it moves.
  const skipReveal = useRef(false);
  // Reveal follows the selected row itself, so a state refresh (saving, window focus) does not scroll the list back.
  const cursorKey = screen === "series" ? episodeRows[cursor]?.episode.id : rows[cursor]?.anime?.id ?? rows[cursor]?.entry?.animeId;
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
  }, [cursor, cursorKey, screen]);
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
  }, [screen, cursor, episodeRows]);

  // Stream qualities are only known once an episode's streams are resolved. Rows that scroll into view resolve in the
  // background, a few at a time, and the answer is kept so the list fills in at once on the next visit.
  const qualityQueue = useRef<{ pending: string[]; active: number; seen: Set<string> }>({ pending: [], active: 0, seen: new Set() });
  const qualityMode = useRef(mode);
  qualityMode.current = mode;
  useEffect(() => {
    const list = listRef.current;
    if (screen !== "series" || !list || typeof IntersectionObserver === "undefined") return;
    const queue = qualityQueue.current;
    const pump = () => {
      while (queue.active < 2 && queue.pending.length) {
        const id = queue.pending.shift()!;
        queue.active += 1;
        void window.aniDesktop.streams(id, qualityMode.current).then((streams) => {
          const best = streams.map((stream) => stream.quality).sort((a, b) => qualityValue(b) - qualityValue(a))[0];
          if (best) setQualities((current) => { const next = { ...current, [id]: best }; saveQualityCache(next); return next; });
        }, () => undefined).finally(() => { queue.active -= 1; pump(); });
      }
    };
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.episode;
        if (!entry.isIntersecting || !id || queue.seen.has(id) || qualities[id]) continue;
        queue.seen.add(id);
        queue.pending.push(id);
      }
      pump();
    }, { root: list.closest(".page"), rootMargin: "120px 0px" });
    for (const row of list.querySelectorAll<HTMLElement>("[data-episode]")) observer.observe(row);
    return () => observer.disconnect();
  }, [screen, episodeRows, qualities]);

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
    if (index >= 0) setCursor(index);
  }

  function dockPlayer() {
    setStatus(undefined); setError(undefined); setNotice(undefined);
    setScreen(selectedAnime ? "series" : "home");
    focusPlayingEpisode();
    refreshState();
  }

  function expandPlayer() {
    if (session) { setScreen("player"); setError(undefined); setNotice(undefined); }
  }

  function closePlayer() {
    setSession(undefined); setStatus(undefined);
    if (screen === "player") { setScreen(selectedAnime ? "series" : "home"); focusPlayingEpisode(); }
    refreshState();
  }

  function showPlayingEpisodes() {
    if (nowPlaying && selectedAnime?.id !== nowPlaying.anime.id) { void openAnime(nowPlaying.anime); refreshState(); return; }
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

  // Each opened series gets a token so late episode or source lookups for a previous one are dropped.
  const openToken = useRef(0);

  // Other providers are looked up while the known ones load, and their episodes join the list as they arrive.
  async function resolveOtherSources(anime: AnimeResult, token: number) {
    setResolving(true);
    try {
      const resolved = await window.aniDesktop.resolveSources(anime);
      if (token !== openToken.current) return;
      const known = animeSources(anime);
      const added = animeSources(resolved).filter((source) => !known.some((item) => item.id === source.id));
      if (added.length === 0) return;
      setSelectedAnime(resolved);
      // The player's "episodes" action reopens the playing anime, so it should know the new sources as well.
      setNowPlaying((playing) => playing && overlaps(playing.anime, resolved) ? { ...playing, anime: { ...playing.anime, sources: animeSources(resolved) } } : playing);
      const extra = await window.aniDesktop.episodes({ ...resolved, sources: added });
      if (token !== openToken.current) return;
      setEpisodeGroups((current) => [...current.filter((group) => !extra.groups.some((item) => item.provider === group.provider)), ...extra.groups]);
      refreshState();
    } catch (reason) {
      if (token === openToken.current) setNotice(`other sources: ${messageFrom(reason)}`);
    } finally {
      if (token === openToken.current) setResolving(false);
    }
  }

  async function openAnime(anime: AnimeResult, options: { resumeAfter?: string; mode?: TranslationMode; autoPlay?: boolean; allowRemap?: boolean } = {}): Promise<boolean> {
    const animeProgress = appState.history.find((entry) => overlaps(entry, anime));
    playToken.current += 1;
    const token = ++openToken.current;
    setSelectedAnime(anime);
    setEpisodeGroups([]); setStatus(undefined); setJump("");
    setScreen("series");
    if (options.mode) setMode(options.mode);
    setBusy("loading episodes"); setError(undefined); setNotice(undefined);
    const missing = PROVIDER_ORDER.some((provider) => !animeSources(anime).some((source) => source.provider === provider));
    if (missing) void resolveOtherSources(anime, token);
    let groups: EpisodeGroup[];
    try { groups = (await window.aniDesktop.episodes(anime)).groups; }
    catch (reason) {
      setBusy(undefined);
      if (options.allowRemap) {
        const alternatives = PROVIDER_ORDER.filter((item) => item !== providerOf(anime.id));
        let replacement: AnimeResult | undefined;
        let replacementProvider: ProviderName | undefined;
        for (const alternative of alternatives) {
          const candidates = await run(`checking ${alternative} for a replacement`, () => window.aniDesktop.search(anime.title, alternative));
          if (candidates?.[0]) { replacement = candidates[0]; replacementProvider = alternative; break; }
        }
        if (replacement && replacementProvider && window.confirm(`${providerOf(anime.id)} is unavailable. Remap "${anime.title}" to "${replacement.title}" on ${replacementProvider}?`)) {
          if (await openAnime(replacement, { ...options, allowRemap: false })) {
            setAppState(await window.aniDesktop.remapEntry(anime.id, replacement));
            setNotice(`remapped to ${replacement.title} on ${replacementProvider}`);
            return true;
          }
          return false;
        }
      }
      setError(messageFrom(reason));
      return false;
    }
    finally { if (token === openToken.current) setBusy(undefined); }
    if (token !== openToken.current) return false;
    setEpisodeGroups((current) => [...groups, ...current.filter((group) => !groups.some((item) => item.provider === group.provider))]);
    const list = episodeRowsOf(groups, animeProgress, episodeFilter, episodeSort);
    const index = nextUpIndex(list, groups, animeProgress, animeProgress?.lastProvider ?? anime.provider, options.resumeAfter);
    skipReveal.current = true;
    setCursor(index);
    const target = list[index]?.episode;
    if (options.autoPlay && target) void playEpisode(target, anime, animeProgress?.progressByProvider?.[target.provider]?.mode ?? options.mode ?? mode, groups);
    return true;
  }

  /** Episodes on one provider in playing order, for next and previous. */
  const providerList = (groups: EpisodeGroup[], provider: ProviderName) =>
    [...(groups.find((group) => group.provider === provider)?.episodes ?? [])].sort((a, b) => episodeValue(a.number) - episodeValue(b.number));

  async function playEpisode(episode: Episode, anime = selectedAnime, playMode = mode, groups = episodeGroups) {
    if (!anime) return;
    const token = ++playToken.current;
    const rowIndex = episodeRows.findIndex((item) => item.episode.id === episode.id);
    if (rowIndex >= 0) setCursor(rowIndex);
    setStatus({ episode, phase: "finding", detail: `${playMode} from ${episode.provider}` });
    try {
      const streams = await window.aniDesktop.streams(episode.id, playMode);
      if (token !== playToken.current) return;
      const stream = (quality === "best" ? undefined : streams.find((item) => item.quality === quality)) ?? streams[0];
      if (!stream) throw new Error("no stream was found");
      const best = streams.map((item) => item.quality).sort((a, b) => qualityValue(b) - qualityValue(a))[0];
      if (best) setQualities((current) => { const next = { ...current, [episode.id]: best }; saveQualityCache(next); return next; });
      const detail = `${stream.quality} · ${playMode} · ${stream.provider}`;
      setStatus({ episode, phase: "opening", detail });
      const series = anime.id === selectedAnime?.id ? providerList(groups, episode.provider) : [];
      setNowPlaying({ episodeId: episode.id, detail, mode: playMode, anime, episodes: series.some((item) => item.id === episode.id) ? series : [episode] });
      const url = appState.settings.playbackTarget === "builtin" && quality === "best" ? stream.masterUrl ?? stream.url : stream.url;
      await window.aniDesktop.play({ url, title: `${anime.title} — Episode ${episode.number}`, referrer: stream.referrer, textTracks: stream.textTracks, episode: { id: episode.id, entry: libraryEntry(anime, episode, playMode) } });
      if (token !== playToken.current) return;
      setAppState(appState.settings.playbackTarget === "builtin"
        ? await window.aniDesktop.getState()
        : await window.aniDesktop.recordHistory(libraryEntry(anime, episode, playMode)));
      setStatus({ episode, phase: "opened", detail });
    } catch (reason) {
      if (token === playToken.current) setStatus({ episode, phase: "failed", detail: messageFrom(reason) });
    }
  }

  function cancelPlay() { playToken.current += 1; setStatus(undefined); }

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
    if (row.entry) await openAnime(asAnime(row.entry), { resumeAfter: row.entry.lastEpisode, mode: row.entry.mode, autoPlay: true, allowRemap: true });
  }

  async function openRow(row: Row) {
    if (row.anime) await openAnime(row.anime);
    else if (row.entry) await openAnime(asAnime(row.entry), { resumeAfter: row.entry.lastEpisode, mode: row.entry.mode, allowRemap: true });
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
    const id = episodeRows[cursor]?.episode.id;
    const next = episodeRowsOf(episodeGroups, progress, filter, sort);
    setEpisodeFilter(filter); setEpisodeSort(sort);
    const index = id ? next.findIndex((row) => row.episode.id === id) : -1;
    setCursor(index >= 0 ? index : 0);
  }

  function jumpTo(value: string) {
    setJump(value);
    const wanted = value.trim();
    if (!wanted) return;
    const index = episodeRows.findIndex((row) => row.number === wanted) ;
    const loose = index >= 0 ? index : episodeRows.findIndex((row) => row.number.startsWith(wanted));
    if (loose >= 0) setCursor(loose);
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
    if (screen === "home") {
      const kinds = [...new Set(rows.map((row) => row.kind))];
      const at = kinds.indexOf(current.kind);
      const targetKind = kinds[at + (key === "ArrowDown" ? 1 : -1)];
      if (!targetKind) return;
      const offset = cursor - rows.findIndex((row) => row.kind === current.kind);
      const first = rows.findIndex((row) => row.kind === targetKind);
      const size = rows.filter((row) => row.kind === targetKind).length;
      setCursor(first + Math.min(offset, size - 1));
      return;
    }
    moveCursor(key === "ArrowDown" ? HOME_CARDS : -HOME_CARDS, rows.length);
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
    if (!typing && event.key === "?") { event.preventDefault(); setShowHints((value) => !value); return; }
    if (!typing && event.key === "/") {
      event.preventDefault(); fieldRef.current?.focus(); fieldRef.current?.select(); return;
    }
    if (screen === "series") {
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault(); moveCursor(event.key === "ArrowUp" ? -1 : 1, episodeRows.length); return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (episodeRows[cursor]) void playEpisode(episodeRows[cursor].episode);
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
      if (screen === "home" && query.trim() && (catalogSearch.pending || (target === fieldRef.current && !catalogSearch.ready))) {
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
  const searchNotice = catalogSearch.ready && unifiedResults.length === 0 ? `nothing found for "${lastQuery}"` : undefined;
  const message = displayError ?? busy ?? searchNotice ?? notice;
  const searchMessage = paletteOpen ? (searchError ?? (busy === undefined ? searchNotice : undefined)) : undefined;

  const renderCard = (row: Row, index: number) => {
    const current = index === cursor;
    const title = row.entry?.title ?? row.anime?.title ?? "";
    const entry = row.entry;
    const poster = entry?.poster ?? row.anime?.poster;
    const next = entry ? (entry.completed === false ? entry.lastEpisode : String(episodeValue(entry.lastEpisode) === Number.POSITIVE_INFINITY ? entry.lastEpisode : episodeValue(entry.lastEpisode) + 1)) : undefined;
    const progressText = entry ? Object.entries(entry.progressByProvider ?? {}).map(([name, value]) => `${name} ${value?.lastEpisode}`).join(" · ") : "";
    const sub = row.kind === "recent" ? when(entry!.updatedAt)
      : row.kind === "continue" ? `Ep ${entry!.lastEpisode} · ${when(entry!.updatedAt)}`
      : entry ? `${entry.completed === false ? "Started" : "Watched through"} ${progressText || entry.lastEpisode}`
      : animeSources(row.anime!).map((source) => source.provider).join(" · ");
    const canMerge = row.anime ? Boolean(mergeCandidate(row.anime)) : entry ? Boolean(libraryMergeCandidate(entry)) : false;
    const label = row.anime ? `open ${title}` : entry?.completed === false ? `resume ${title}` : `play next episode of ${title}`;
    return (
      <div key={`${row.kind}:${row.anime?.id ?? entry?.animeId}`} className={`card ${current ? "cur" : ""}`} data-cursor={current}>
        <button type="button" className="hit" onClick={() => void activate(row)} onFocus={() => { if (index >= 0) setCursor(index); }} aria-label={label}>
          <Art src={poster} className="poster" />
          <span className="badges">
            {entry && next && <span className="badge hi">EP {next}</span>}
            {entry && <span className="badge">{entry.mode.toUpperCase()}</span>}
          </span>
        </button>
        <span className="t">{title}</span>
        <span className="s">{sub}</span>
        <span className="card-acts">
          {canMerge && <button type="button" className="mini-act" title="Merge with a matching title" onClick={() => { if (row.anime) void manuallyLink(row.anime); else if (entry) void manuallyMergeEntry(entry); }}>merge</button>}
          {entry && <button type="button" className="mini-act" aria-label={`remove ${title}`} title="Remove" onClick={() => void removeRow(row)}><Icon name="x" /></button>}
        </span>
      </div>
    );
  };

  const cardSection = (kind: RowKind, heading: string, more?: Screen) => {
    // Behind the palette the sections come from the library and carry no cursor.
    const source = screen === "home" && paletteOpen ? libraryRows : rows;
    const items = source.map((row, index) => ({ row, index: source === rows ? index : -1 })).filter((item) => item.row.kind === kind);
    if (items.length === 0) return null;
    return (
      <section key={kind} className={`section section-${kind}`} aria-labelledby={`${kind}-heading`}>
        <div className="section-head">
          <h2 id={`${kind}-heading`}>{more ? <button type="button" onClick={() => go(more)}>{heading}<Icon name="chevron" /></button> : heading}</h2>
          {!more && <span className="count">{items.length} {items.length === 1 ? "title" : "titles"}</span>}
          {kind === "recent" && appState.history.length > 0 && <button type="button" className="more" onClick={() => void clearHistory()}>Clear history</button>}
          {more && <button type="button" className="more" onClick={() => go(more)}>See all</button>}
        </div>
        <div className="cards" role="group" aria-labelledby={`${kind}-heading`}>{items.map(({ row, index }) => renderCard(row, index))}</div>
      </section>
    );
  };

  const playingId = session?.request.episode?.id;
  const current = nowPlaying && nowPlaying.episodeId === playingId ? nowPlaying : undefined;
  const playingList = current?.episodes ?? [];
  const playingIndex = playingId ? playingList.findIndex((episode) => episode.id === playingId) : -1;
  const playNeighbour = (offset: number) => {
    const target = playingIndex >= 0 ? playingList[playingIndex + offset] : undefined;
    return current && target ? () => { void playEpisode(target, current.anime, current.mode); } : undefined;
  };
  const playerMessage = status && status.episode.id !== playingId
    ? status.phase === "failed" ? { text: `episode ${status.episode.number}: ${status.detail}`, error: true }
      : status.phase === "opened" ? undefined : { text: `episode ${status.episode.number}: finding a stream ···` }
    : undefined;

  const nextRow = episodeRows[cursor];
  // Next up follows progress, not the cursor: the episode after the last one watched on the provider used last.
  const nextUp = useMemo(() => {
    const all = episodeRowsOf(episodeGroups, progress, "all", "oldest");
    const row = all[nextUpIndex(all, episodeGroups, progress, progress?.lastProvider ?? selectedAnime?.provider ?? "aniwave")];
    return row ? all.find((item) => !item.watched && item.number === row.number) ?? row : undefined;
  }, [episodeGroups, progress, selectedAnime]);
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
            <div className="palette" role="dialog" aria-label="Search results">
              <div className="found" id="results-heading" aria-live="polite">
                {catalogSearch.ready || unifiedResults.length ? <>{unifiedResults.length} {unifiedResults.length === 1 ? "result" : "results"} for "{lastQuery}"</> : catalogSearch.pending ? "Searching…" : "Press Enter to search"}
              </div>
              {searchMessage && <div className={`msg ${searchError ? "err" : ""}`} role={searchError ? "alert" : "status"}>{searchMessage}</div>}
              <div className="section-results" role="listbox" aria-label="Results">
                {rows.map((row, index) => {
                  const anime = row.anime!;
                  const sources = animeSources(anime);
                  const others = sources.filter((source) => source.id !== anime.id);
                  const alias = others.find((source) => source.title !== anime.title)?.title;
                  const merge = mergeCandidate(anime);
                  return (
                    <div key={anime.id} className={`hit-row ${index === cursor ? "cur" : ""}`} data-cursor={index === cursor}>
                      <button type="button" className="hit" role="option" aria-selected={index === cursor} onClick={() => void activate(row)} onFocus={() => setCursor(index)}>
                        <span className="thumb"><Art src={anime.poster} /><span className={`badge ${index === cursor ? "hi" : ""}`}>{anime.provider}</span></span>
                        <span className="text">
                          <span className="t">{anime.title}</span>
                          {alias && <span className="s">{alias}</span>}
                          <span className="m">{[...new Set(sources.map((source) => source.provider))].join(" · ")}</span>
                        </span>
                        <Icon name="chevron" />
                      </button>
                      {merge && <button type="button" className="mini-act" onClick={() => void manuallyLink(anime)}>merge</button>}
                    </div>
                  );
                })}
              </div>
              <div className="foot-hints"><span><b>↑↓</b> move</span><span><b>↵</b> {query.trim() && !catalogSearch.ready ? "search now" : "open"}</span><span><b>esc</b> close</span></div>
            </div>
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
            onDock={dockPlayer}
            onEpisodes={showPlayingEpisodes}
            onExpand={expandPlayer}
            onClose={closePlayer}
          />
        </Suspense>
      )}
      {screen !== "player" && <div className={`page page-${screen}`}>
        {message && !paletteOpen && <div className={`msg ${displayError ? "err" : ""}`} role={displayError ? "alert" : "status"}>{message}{busy && <span className="dots"> ···</span>}</div>}

        {screen === "home" && (
          libraryRows.length === 0
            ? !paletteOpen && <div className="empty"><b>Nothing here yet</b>Search for a title with <kbd>⌘K</kbd>. Titles you watch and save appear here.</div>
            : <>
                {cardSection("continue", "Continue watching", "recent")}
                {cardSection("saved", "Saved", "saved")}
              </>
        )}

        {screen === "saved" && (rows.length === 0
          ? <div className="section"><div className="section-head"><h2 id="saved-heading">Saved</h2></div><div className="empty"><b>{filter ? "No saved titles match" : "Nothing saved yet"}</b>{filter ? "Try a shorter filter." : "Open a series and choose save. Saved titles keep their place, so play always picks up at the next episode."}</div></div>
          : cardSection("saved", "Saved"))}

        {screen === "recent" && (rows.length === 0
          ? <div className="section"><div className="section-head"><h2 id="recent-heading">Recent</h2></div><div className="empty"><b>{filter ? "No recent titles match" : "Nothing watched yet"}</b>{filter ? "Try a shorter filter." : `Every episode you open in ${player} is listed here.`}</div></div>
          : cardSection("recent", "Recent"))}

        {screen === "series" && selectedAnime && (
          <div className="series">
            <aside className="side">
              <Art src={selectedAnime.poster} className="poster" />
              <div className="stack">
                <button type="button" className="btn primary" disabled={!nextUp} onClick={() => nextUp && void playEpisode(nextUp.episode)}>Play Ep {nextUp?.number ?? "…"}<Icon name="play" /></button>
                <button type="button" className={`btn ${isSaved ? "on" : ""}`} onClick={() => void toggleBookmark()} aria-pressed={isSaved}>{isSaved ? "Saved" : "Save"}<Icon name="bookmark" /></button>
              </div>
              <div className="prefs">
                <Chips label="Audio" value={mode} options={["sub", "dub"] as const} onChange={setMode} />
                <Chips label="Quality" value={QUALITIES.includes(quality) ? quality : "best"} options={QUALITIES.slice(0, 4)} onChange={setQuality} />
              </div>
            </aside>
            <div className="main">
              <button type="button" className="crumb" onClick={goBack}><Icon name="back" />{lastQuery ? `Results for “${lastQuery}”` : "Home"}</button>
              <h1>{selectedAnime.title}</h1>
              <div className="meta">
                {animeSources(selectedAnime).map((source) => <span className="tag" key={source.id}>{source.provider}</span>)}
                {resolving && <span className="tag quiet" role="status">checking other sources<span className="dots"> ···</span></span>}
                {animeSources(selectedAnime).find((source) => source.title !== selectedAnime.title) && <span>{animeSources(selectedAnime).find((source) => source.title !== selectedAnime.title)!.title}</span>}
              </div>
              <div className="facts">
                <div><small>Episodes</small>{episodeCount || (busy ? "…" : "none")}</div>
                <div><small>Progress</small>{progress ? `${progress.completed === false ? "Started" : "Watched through"} ${progress.lastEpisode}` : "Not started"}</div>
                <div><small>Last source</small>{progress ? `${progress.lastProvider ?? providerOf(progress.animeId)} · ${progress.mode}` : "—"}</div>
                <div><small>Plays in</small>{player}</div>
              </div>
              {episodeGroups.filter((group) => group.error).map((group) => (
                <div className="msg err" role="alert" key={group.provider}><b>{group.provider}</b> {group.error} <button type="button" className="link" onClick={() => void openAnime(selectedAnime)}>retry</button></div>
              ))}
              <div className="ep-head">
                <h2>Episodes</h2>
                <Chips value={episodeFilter} options={["all", "unwatched", "watched"] as const} onChange={(value) => reorder(value, episodeSort)} names={{ all: "All", unwatched: "Unwatched", watched: "Watched" }} />
                <label className="jump"><Icon name="search" /><input value={jump} onChange={(event) => jumpTo(event.target.value)} placeholder="Jump to" aria-label="Jump to episode" inputMode="numeric" /></label>
                <span className="sort" role="radiogroup" aria-label="Sort">
                  <button type="button" role="radio" aria-checked={episodeSort === "oldest"} className={episodeSort === "oldest" ? "on" : ""} title="Oldest first" onClick={() => reorder(episodeFilter, "oldest")}><Icon name="up" /></button>
                  <button type="button" role="radio" aria-checked={episodeSort === "newest"} className={episodeSort === "newest" ? "on" : ""} title="Newest first" onClick={() => reorder(episodeFilter, "newest")}><Icon name="down" /></button>
                </span>
              </div>
              <div className="eps" ref={listRef} tabIndex={-1} role="group" aria-label="Episodes">
                {episodeRows.length === 0 && !busy && <div className="empty">{episodeFilter === "all" ? "No episodes found." : `No ${episodeFilter} episodes.`}</div>}
                {episodeRows.map((row, index) => {
                  const isCursor = index === cursor;
                  const groupCursor = nextRow?.number === row.number;
                  return (
                    <div key={row.episode.id} className={`src-wrap ${row.first ? "first" : ""} ${groupCursor ? "in-cur" : ""}`}>
                      {row.first && <h4 className="grp-head">Ep {row.number}{nextUp?.number === row.number && <span className="up">Next up</span>}</h4>}
                      <div className={`src ${row.watched ? "w" : ""} ${isCursor ? "cur" : ""} ${playingId === row.episode.id ? "playing" : ""}`} data-cursor={isCursor} data-episode={row.episode.id}>
                        <button type="button" className="src-hit" tabIndex={isCursor ? 0 : -1} onFocus={() => setCursor(index)}
                          onClick={() => void playEpisode(row.episode)} aria-label={`play episode ${row.number} from ${row.episode.provider}`}>
                          <span className="t">Episode {row.number}<small>{row.episode.provider}</small>{playingId === row.episode.id && <em>playing</em>}</span>
                          {qualities[row.episode.id] && <span className="q">{qualities[row.episode.id]}</span>}
                          <Icon name="play" className="play" />
                        </button>
                        <button type="button" className="chk" role="checkbox" aria-checked={row.watched} aria-label={`mark watched through episode ${row.number} on ${row.episode.provider}`} title="Mark watched through here" onClick={() => void markWatched(row.episode)}>
                          {row.watched && <Icon name="check" />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              {status && (
                <div className={`status ${status.phase === "failed" ? "err" : ""}`} role="status">
                  <b>Episode {status.episode.number}</b>
                  <span>
                    {status.phase === "finding" && <>Finding a stream<span className="dots"> ···</span></>}
                    {status.phase === "opening" && <>Opening {player}<span className="dots"> ···</span></>}
                    {status.phase === "opened" && `Opened in ${player}`}
                    {status.phase === "failed" && status.detail}
                  </span>
                  {status.phase !== "failed" && <span className="detail">{status.detail}</span>}
                  <button type="button" className="link" onClick={cancelPlay}>{status.phase === "finding" || status.phase === "opening" ? "Cancel" : "Dismiss"}</button>
                </div>
              )}
            </div>
          </div>
        )}

        {screen === "settings" && (
          <form className="settings" onSubmit={(event) => { event.preventDefault(); void saveSettings(); }}>
            <h1>Settings</h1>
            <div className="group"><h3>Playback</h3><div className="box">
              <div className="r"><span className="k">Player<small>Built-in works without installing another player</small></span><Chips value={settingsDraft.playbackTarget} options={["builtin", "external"] as const} onChange={(playbackTarget) => setSettingsDraft({ ...settingsDraft, playbackTarget })} names={{ builtin: "built-in" }} /></div>
              <div className="r"><span className="k">Start playback<small>Go fullscreen as soon as an episode starts</small></span><Chips value={settingsDraft.startPlayerFullscreen ? "fullscreen" : "windowed"} options={["fullscreen", "windowed"] as const} onChange={(value) => setSettingsDraft({ ...settingsDraft, startPlayerFullscreen: value === "fullscreen" })} /></div>
              <div className="r"><span className="k">Next episode<small>Built-in player only. Autoplay waits five seconds and can be cancelled</small></span><Chips value={settingsDraft.autoplayNext !== false ? "autoplay" : "manual"} options={["autoplay", "manual"] as const} onChange={(value) => setSettingsDraft({ ...settingsDraft, autoplayNext: value === "autoplay" })} /></div>
              <div className="r"><span className="k">Player diagnostics<small>Local keyboard and playback logs for troubleshooting</small></span><span className="v-row"><Chips label="logging" value={settingsDraft.playerDiagnostics ? "on" : "off"} options={["off", "on"] as const} onChange={(value) => setSettingsDraft({ ...settingsDraft, playerDiagnostics: value === "on" })} /><button type="button" className="btn small" onClick={() => { void run("opening player logs", () => window.aniDesktop.openPlayerLogs()); }}>open logs</button></span></div>
              <div className="r"><label htmlFor="player" className="k">External fallback<small>Optional for built-in playback. On macOS use IINA's iina-cli</small></label><input id="player" value={settingsDraft.playerPath} placeholder={settingsDraft.playbackTarget === "external" ? "required" : "optional"} onChange={(event) => setSettingsDraft({ ...settingsDraft, playerPath: event.target.value })} /></div>
            </div></div>
            <div className="group"><h3>Defaults</h3><div className="box">
              <div className="r"><span className="k">Quality</span><Chips value={settingsDraft.preferredQuality} options={QUALITIES} onChange={(preferredQuality) => setSettingsDraft({ ...settingsDraft, preferredQuality })} /></div>
              <div className="r"><span className="k">Audio</span><Chips value={settingsDraft.preferredMode} options={["sub", "dub"] as const} onChange={(preferredMode) => setSettingsDraft({ ...settingsDraft, preferredMode })} /></div>
              <div className="r"><span className="k">Source<small>Auto combines aniwave, anidb, and hianime</small></span><Chips value={settingsDraft.preferredProvider} options={PROVIDERS} onChange={(preferredProvider) => setSettingsDraft({ ...settingsDraft, preferredProvider })} /></div>
            </div></div>
            <div className="group"><h3>Appearance</h3><div className="box">
              <div className="r"><span className="k">Theme<small>Presets match common terminal schemes</small></span><span className="chips" role="radiogroup" aria-label="theme">
                {THEME_NAMES.map((name) => {
                  const colours = resolveTheme(name, settingsDraft.customTheme);
                  return (
                    <button type="button" key={name} role="radio" aria-checked={settingsDraft.theme === name} className={settingsDraft.theme === name ? "on" : ""}
                      onClick={() => setSettingsDraft({ ...settingsDraft, theme: name, customTheme: name === "custom" && settingsDraft.theme !== "custom" ? { ...resolveTheme(settingsDraft.theme, settingsDraft.customTheme) } : settingsDraft.customTheme })}>
                      <i className="sw" style={{ "--sw-bg": colours.background, "--sw-cur": colours.highlight } as React.CSSProperties} />{name.replace("-", " ")}
                    </button>
                  );
                })}
              </span></div>
              {settingsDraft.theme === "custom" && (
                <div className="r"><span className="k">Custom colours<small>The rest is mixed from these. Highlight marks the selected card, row, and chip</small></span><span className="colours">
                  {(["background", "text", "highlight"] as const).map((key) => (
                    <span className="colour" key={key}>
                      <span>{key}</span>
                      <input type="color" value={settingsDraft.customTheme[key]} aria-label={`${key} colour`} onChange={(event) => setSettingsDraft({ ...settingsDraft, customTheme: { ...settingsDraft.customTheme, [key]: event.target.value } })} />
                      <input value={settingsDraft.customTheme[key]} aria-label={`${key} hex`} maxLength={7} spellCheck={false} onChange={(event) => setSettingsDraft({ ...settingsDraft, customTheme: { ...settingsDraft.customTheme, [key]: event.target.value } })} />
                    </span>
                  ))}
                </span></div>
              )}
            </div></div>
            <div className="group"><h3>Sources</h3><div className="box">
              <div className="r"><label htmlFor="aniwave" className="k">aniwave address</label><input id="aniwave" value={settingsDraft.aniwaveBaseUrl} onChange={(event) => setSettingsDraft({ ...settingsDraft, aniwaveBaseUrl: event.target.value })} /></div>
              <div className="r"><label htmlFor="anidb" className="k">anidb address</label><input id="anidb" value={settingsDraft.anidbBaseUrl} onChange={(event) => setSettingsDraft({ ...settingsDraft, anidbBaseUrl: event.target.value })} /></div>
              <div className="r"><label htmlFor="hianime" className="k">hianime address</label><input id="hianime" value={settingsDraft.hianimeBaseUrl} onChange={(event) => setSettingsDraft({ ...settingsDraft, hianimeBaseUrl: event.target.value })} /></div>
              <div className="r"><span className="k">Source links<small>{(appState.providerLinks ?? []).length} remembered {(appState.providerLinks ?? []).length === 1 ? "match" : "matches"} between providers. Forget them if a series shows the wrong records together</small></span><button type="button" className="btn small" disabled={!(appState.providerLinks ?? []).length} onClick={() => void clearSourceLinks()}>forget source links</button></div>
            </div></div>
            <div className="acts-row"><button type="button" className="btn" onClick={goBack}>cancel</button><button type="submit" className="btn primary">save changes</button></div>
          </form>
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
