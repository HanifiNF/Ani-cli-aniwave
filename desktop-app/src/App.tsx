import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AnimeResult,
  CustomTheme,
  Episode,
  EpisodeGroup,
  LibraryEntry,
  PersistedState,
  ProviderName,
  ProviderPreference,
  Settings,
  ThemePreset,
  TranslationMode
} from "../shared/contracts";
import { useAnimeSearch } from "./useAnimeSearch";
import { THEME_NAMES, THEME_PRESETS, resolveTheme } from "../shared/theme";
import { applyAppIcon } from "./appIcon";
import { animeSources, likelyDuplicate, mergeKey, overlaps, sourceIds, unifyAnimeResults } from "../shared/catalog";

type Screen = "home" | "series" | "saved" | "recent" | "settings";
type RowKind = "results" | "continue" | "saved" | "recent";
interface Row { kind: RowKind; anime?: AnimeResult; entry?: LibraryEntry; }
interface PlayStatus { episode: Episode; phase: "finding" | "opening" | "opened" | "failed"; detail: string; }

const QUALITIES = ["best", "1080p", "720p", "480p", "360p"];
const PROVIDERS: ProviderPreference[] = ["auto", "aniwave", "anidb"];
const EPISODE_CELL = 62; // 56px cell plus 6px gap, used for arrow-key movement in the grid

const emptyState: PersistedState = {
  bookmarks: [],
  history: [],
  settings: {
    playerPath: "mpv", preferredQuality: "best", preferredMode: "sub", preferredProvider: "auto",
    aniwaveBaseUrl: "https://aniwaves.ru", anidbBaseUrl: "https://anidb.app", theme: "graphite", customTheme: { ...THEME_PRESETS.graphite }
  }, providerLinks: [], dismissedMergeKeys: []
};

const providerOf = (id: string): ProviderName => id.startsWith("aniwave:") ? "aniwave" : "anidb";
const asAnime = (entry: LibraryEntry): AnimeResult => ({ id: entry.animeId, title: entry.title, poster: entry.poster, provider: entry.lastProvider ?? providerOf(entry.animeId), sources: animeSources(entry) });
const playerName = (path: string): string => path.split(/[\\/]/).pop()?.replace(/\.exe$/i, "") || "player";

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
  return applyAppIcon(colours);
}

function Art({ src, large }: { src?: string; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  return (
    <span className={`art ${large ? "large" : ""}`}>
      {src && !failed && <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} />}
    </span>
  );
}

function Chips<T extends string>({ label, value, options, onChange }: { label?: string; value: T; options: readonly T[]; onChange: (value: T) => void }) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {label && <span className="lab">{label}</span>}
      {options.map((option) => (
        <button type="button" key={option} role="radio" aria-checked={option === value} className={option === value ? "on" : ""} onClick={() => onChange(option)}>{option}</button>
      ))}
    </div>
  );
}

function App() {
  const [screen, setScreen] = useState<Screen>("home");
  const [appState, setAppState] = useState<PersistedState>(emptyState);
  const [query, setQuery] = useState("");
  const [composing, setComposing] = useState(false);
  const [selectedAnime, setSelectedAnime] = useState<AnimeResult>();
  const [episodeGroups, setEpisodeGroups] = useState<EpisodeGroup[]>([]);
  const [activeEpisodeProvider, setActiveEpisodeProvider] = useState<ProviderName>("aniwave");
  const [cursor, setCursor] = useState(0);
  const [mode, setMode] = useState<TranslationMode>("sub");
  const [provider, setProvider] = useState<ProviderPreference>("auto");
  const [quality, setQuality] = useState("best");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [status, setStatus] = useState<PlayStatus>();
  const [settingsDraft, setSettingsDraft] = useState<Settings>(emptyState.settings);
  const [stateLoaded, setStateLoaded] = useState(false);

  const catalogSearch = useAnimeSearch(query, provider,
    [appState.settings.aniwaveBaseUrl, appState.settings.anidbBaseUrl], screen === "home" && !composing);
  const { results, lastQuery } = catalogSearch;
  const unifiedResults = useMemo(() => unifyAnimeResults(results, appState.providerLinks ?? []), [results, appState.providerLinks]);
  const activeEpisodeGroup = episodeGroups.find((group) => group.provider === activeEpisodeProvider);
  const episodes = activeEpisodeGroup?.episodes ?? [];

  const fieldRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
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
  const rows = useMemo<Row[]>(() => {
    if (screen === "home") {
      return [
        ...unifiedResults.map((anime): Row => ({ kind: "results", anime })),
        ...appState.history.slice(0, 3).map((entry): Row => ({ kind: "continue", entry })),
        ...appState.bookmarks.slice(0, 3).map((entry): Row => ({ kind: "saved", entry }))
      ];
    }
    if (screen === "saved") return appState.bookmarks.filter(matches).map((entry): Row => ({ kind: "saved", entry }));
    if (screen === "recent") return appState.history.filter(matches).map((entry): Row => ({ kind: "recent", entry }));
    return [];
  }, [screen, unifiedResults, appState.history, appState.bookmarks, filter]);

  useEffect(() => { if (screen !== "series") setCursor(0); }, [screen, results, filter]);
  useEffect(() => {
    const selected = document.querySelector<HTMLElement>('[data-cursor="true"]');
    const list = selected?.closest<HTMLElement>(".section-scroll");
    if (!selected) return;
    if (!list) { selected.scrollIntoView({ block: "nearest" }); return; }
    // Move only the selected list so keyboard navigation keeps the other sections in place.
    const reveal = () => {
      const rowBounds = selected.getBoundingClientRect();
      const listBounds = list.getBoundingClientRect();
      if (rowBounds.top < listBounds.top) list.scrollTop += rowBounds.top - listBounds.top;
      else if (rowBounds.bottom > listBounds.bottom) list.scrollTop += rowBounds.bottom - listBounds.bottom;
    };
    reveal();
    const observer = new ResizeObserver(reveal);
    observer.observe(list);
    return () => observer.disconnect();
  }, [cursor, screen, rows]);
  useEffect(() => {
    if (screen === "series") gridRef.current?.focus();
    else if (screen !== "settings") fieldRef.current?.focus();
  }, [screen]);
  useEffect(() => {
    const grid = gridRef.current;
    // Follow episode selection while navigating the grid, preserving focus if the user leaves it.
    if (screen === "series" && grid?.contains(document.activeElement)) {
      grid.querySelector<HTMLButtonElement>('[data-cursor="true"]')?.focus({ preventScroll: true });
    }
  }, [screen, cursor, episodes]);

  const isSaved = Boolean(selectedAnime && appState.bookmarks.some((entry) => overlaps(entry, selectedAnime)));
  const progress = selectedAnime ? appState.history.find((entry) => overlaps(entry, selectedAnime)) : undefined;
  const player = playerName(appState.settings.playerPath);

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

  function goBack() {
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

  async function openAnime(anime: AnimeResult, options: { resumeAfter?: string; mode?: TranslationMode; autoPlay?: boolean; allowRemap?: boolean } = {}): Promise<boolean> {
    const animeProgress = appState.history.find((entry) => overlaps(entry, anime));
    playToken.current += 1;
    setSelectedAnime(anime);
    setEpisodeGroups([]); setStatus(undefined);
    setScreen("series");
    if (options.mode) setMode(options.mode);
    setBusy("loading episodes"); setError(undefined); setNotice(undefined);
    let groups: EpisodeGroup[];
    try { groups = (await window.aniDesktop.episodes(anime)).groups; }
    catch (reason) {
      setBusy(undefined);
      if (options.allowRemap) {
        const other: ProviderName = providerOf(anime.id) === "aniwave" ? "anidb" : "aniwave";
        const candidates = await run(`checking ${other} for a replacement`, () => window.aniDesktop.search(anime.title, other));
        const replacement = candidates?.[0];
        if (replacement && window.confirm(`${providerOf(anime.id)} is unavailable. Remap "${anime.title}" to "${replacement.title}" on ${other}?`)) {
          if (await openAnime(replacement, { ...options, allowRemap: false })) {
            setAppState(await window.aniDesktop.remapEntry(anime.id, replacement));
            setNotice(`remapped to ${replacement.title} on ${other}`);
            return true;
          }
          return false;
        }
      }
      setError(messageFrom(reason));
      return false;
    }
    finally { setBusy(undefined); }
    setEpisodeGroups(groups);
    const available = groups.filter((group) => group.episodes.length);
    const wanted = animeProgress?.lastProvider ?? anime.provider;
    const active = available.find((group) => group.provider === wanted)?.provider ?? available.find((group) => group.provider === "aniwave")?.provider ?? available[0]?.provider ?? groups[0]?.provider ?? "aniwave";
    setActiveEpisodeProvider(active);
    const list = groups.find((group) => group.provider === active)?.episodes ?? [];
    let index = 0;
    const sourceProgress = animeProgress?.progressByProvider?.[active];
    const resumeAfter = sourceProgress?.lastEpisode ?? options.resumeAfter ?? (animeProgress?.lastProvider === active ? animeProgress.lastEpisode : undefined);
    if (resumeAfter) {
      const previous = list.findIndex((episode) => episode.number === resumeAfter);
      index = Math.min(previous + 1, list.length - 1);
    }
    setCursor(Math.max(index, 0));
    if (options.autoPlay && list[index]) void playEpisode(list[index], anime, sourceProgress?.mode ?? options.mode ?? mode);
    return true;
  }

  async function playEpisode(episode: Episode, anime = selectedAnime, playMode = mode) {
    if (!anime) return;
    const token = ++playToken.current;
    setCursor(episodes.findIndex((item) => item.id === episode.id) >= 0 ? episodes.findIndex((item) => item.id === episode.id) : cursor);
    setStatus({ episode, phase: "finding", detail: `${playMode} from ${episode.provider}` });
    try {
      const streams = await window.aniDesktop.streams(episode.id, playMode);
      if (token !== playToken.current) return;
      const stream = (quality === "best" ? undefined : streams.find((item) => item.quality === quality)) ?? streams[0];
      if (!stream) throw new Error("no stream was found");
      const detail = `${stream.quality} ${playMode} ${stream.provider}`;
      setStatus({ episode, phase: "opening", detail });
      await window.aniDesktop.play({ url: stream.url, title: `${anime.title} — Episode ${episode.number}`, referrer: stream.referrer });
      if (token !== playToken.current) return;
      setAppState(await window.aniDesktop.recordHistory(libraryEntry(anime, episode, playMode)));
      setStatus({ episode, phase: "opened", detail });
    } catch (reason) {
      if (token === playToken.current) setStatus({ episode, phase: "failed", detail: messageFrom(reason) });
    }
  }

  function cancelPlay() { playToken.current += 1; setStatus(undefined); }

  async function toggleBookmark() {
    if (!selectedAnime) return;
    const state = await run("updating saved titles", () => window.aniDesktop.toggleBookmark(libraryEntry(selectedAnime, episodes[cursor], mode)));
    if (state) setAppState(state);
  }

  function selectEpisodeProvider(next: ProviderName) {
    setActiveEpisodeProvider(next);
    const sourceProgress = progress?.progressByProvider?.[next];
    const list = episodeGroups.find((group) => group.provider === next)?.episodes ?? [];
    const previous = sourceProgress ? list.findIndex((episode) => episode.number === sourceProgress.lastEpisode) : -1;
    setCursor(Math.max(0, Math.min(previous + 1, list.length - 1)));
    setStatus(undefined);
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

  const columns = () => {
    const cells = Array.from(gridRef.current?.children ?? []) as HTMLElement[];
    if (cells.length === 0) return 1;
    const firstRow = cells.filter((cell) => cell.offsetTop === cells[0].offsetTop).length;
    return Math.max(1, firstRow || Math.floor(((gridRef.current?.clientWidth ?? 0) + 6) / EPISODE_CELL));
  };
  const moveCursor = (delta: number, length: number) => { if (length) setCursor((current) => Math.min(Math.max(current + delta, 0), length - 1)); };

  keyHandler.current = (event) => {
    const target = event.target as HTMLElement | null;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
    if (event.isComposing || composing || event.keyCode === 229) return;
    if (event.metaKey || event.ctrlKey) {
      if (event.key === "s" && screen === "settings") { event.preventDefault(); void saveSettings(); }
      return;
    }
    if (event.altKey) return;
    if (event.key === "Enter" && target?.closest("button:not(.hit)") && !target.closest(".grid")) return;
    if (screen === "settings") { if (event.key === "Escape") goBack(); return; }
    if (event.key === "Escape") { event.preventDefault(); goBack(); return; }
    if (!typing && event.key === "/") {
      event.preventDefault(); fieldRef.current?.focus(); fieldRef.current?.select(); return;
    }
    if (screen === "series") {
      const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns(), ArrowDown: columns() };
      if (event.key in moves) {
        if (typing && (event.key === "ArrowLeft" || event.key === "ArrowRight") && (target as HTMLInputElement).value) return;
        event.preventDefault(); moveCursor(moves[event.key], episodes.length); return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (episodes[cursor]) void playEpisode(episodes[cursor]);
        return;
      }
      if (!typing && event.key === "s") void toggleBookmark();
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); moveCursor(event.key === "ArrowUp" ? -1 : 1, rows.length); return; }
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

  const placeholder = screen === "saved" ? "filter saved titles" : screen === "recent" ? "filter recent titles" : screen === "series" ? "search another title" : "search a title";
  const searching = catalogSearch.loading;
  const searchError = catalogSearch.error === undefined ? undefined : messageFrom(catalogSearch.error);
  const displayError = error ?? searchError;
  const searchNotice = catalogSearch.ready && unifiedResults.length === 0 ? `nothing found for "${lastQuery}"` : undefined;
  const message = displayError ?? busy ?? searchNotice ?? notice;

  const renderRow = (row: Row, index: number) => {
    const current = index === cursor;
    const title = row.anime?.title ?? row.entry?.title ?? "";
    const poster = row.anime?.poster ?? row.entry?.poster;
    let sub = "", action = "", side = "";
    if (row.anime) { action = current ? "open series" : ""; side = animeSources(row.anime).map((source) => source.provider).join(" + "); }
    if (row.entry) {
      const progressText = Object.entries(row.entry.progressByProvider ?? {}).map(([name, value]) => `${name} ${value?.lastEpisode}`).join(" · ");
      sub = row.kind === "recent" ? `${progressText || `ep ${row.entry.lastEpisode}`}, ${when(row.entry.updatedAt)}` : `watched through ${progressText || row.entry.lastEpisode}${screen === "home" ? `, ${row.entry.mode}` : ""}`;
      action = "play next"; side = row.entry.mode;
    }
    const canMerge = row.anime ? Boolean(mergeCandidate(row.anime)) : row.entry ? Boolean(libraryMergeCandidate(row.entry)) : false;
    return (
      <div key={`${row.kind}:${row.anime?.id ?? row.entry?.animeId}`} className={`item ${row.entry ? "lib" : ""} ${canMerge ? "has-merge" : ""} ${current ? "cur" : ""}`} data-cursor={current}>
        <button type="button" className="hit" onClick={() => void activate(row)} onFocus={() => setCursor(index)} aria-label={`${row.anime ? "open" : "play next episode of"} ${title}`} />
        <Art src={poster} />
        <span><span className="t">{title}</span>{sub && <span className="s">{sub}</span>}</span>
        <span className="k">{action}</span>
        <span className="k2">{side}</span>
        {row.anime && mergeCandidate(row.anime) && <button type="button" className="rm" onClick={(event) => { event.stopPropagation(); void manuallyLink(row.anime!); }}>merge</button>}
        {row.entry && libraryMergeCandidate(row.entry) && <button type="button" className="rm" onClick={(event) => { event.stopPropagation(); void manuallyMergeEntry(row.entry!); }}>merge</button>}
        {row.entry && <button type="button" className="rm" onClick={(event) => { event.stopPropagation(); void removeRow(row); }}>remove</button>}
      </div>
    );
  };

  const section = (kind: RowKind, heading: string) => {
    const items = rows.map((row, index) => ({ row, index })).filter((item) => item.row.kind === kind);
    if (items.length === 0) return null;
    return (
      <section key={kind} className={`list-section section-${kind}`} aria-labelledby={`${kind}-heading`}>
        <h2 id={`${kind}-heading`}>{kind === "results" ? <span className="search-heading" title={heading}>{heading}</span> : heading}{kind === "results" && <span>{items.length} {items.length === 1 ? "title" : "titles"}</span>}</h2>
        <div className="section-scroll" role="region" aria-labelledby={`${kind}-heading`} tabIndex={0}
          onFocus={(event) => { if (event.target === event.currentTarget) setCursor(items[0].index); }}>
          <div className="list">{items.map(({ row, index }) => renderRow(row, index))}</div>
        </div>
      </section>
    );
  };

  const backButton = <button type="button" onClick={goBack} aria-label="Back" aria-keyshortcuts="Escape"><b>esc</b> back</button>;

  const footLinks = (
    <span className="right">
      {screen !== "home" && <button type="button" onClick={() => go("home")}>search</button>}
      {screen !== "saved" && <button type="button" onClick={() => go("saved")}>saved</button>}
      {screen !== "recent" && <button type="button" onClick={() => go("recent")}>recent</button>}
      {screen !== "settings" && <button type="button" onClick={() => go("settings")}>settings</button>}
      <span>{player}</span>
    </span>
  );

  return (
    <div className="app">
      <div className={`page ${screen === "home" || screen === "saved" || screen === "recent" ? "page-lists" : ""}`}>
        <div className="field">
          {screen === "settings"
            ? <span className="crumb big">settings</span>
            : <div className="search-field">
                <input ref={fieldRef} value={query} onChange={(event) => changeQuery(event.target.value)}
                  onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
                  maxLength={120} placeholder={placeholder} aria-label={placeholder} spellCheck={false} />
                <span className="search-throbber" aria-hidden="true">
                  {catalogSearch.pending && <><span>·</span><span>·</span><span>·</span></>}
                </span>
                <span className="sr-only" role="status">{searching ? "Searching" : catalogSearch.ready ? `${unifiedResults.length} ${unifiedResults.length === 1 ? "title" : "titles"} found for ${lastQuery}` : ""}</span>
              </div>}
          {(screen === "home" || screen === "series") && (
            <div className="groups">
              <Chips label="audio" value={mode} options={["sub", "dub"] as const} onChange={setMode} />
              <Chips label="quality" value={QUALITIES.includes(quality) ? quality : "best"} options={QUALITIES.slice(0, 4)} onChange={setQuality} />
              <Chips label="source" value={provider} options={PROVIDERS} onChange={setProvider} />
            </div>
          )}
          {(screen === "saved" || screen === "recent") && <span className="crumb">{screen}</span>}
        </div>
        {message && <div className={`msg ${displayError ? "err" : ""}`} role={displayError ? "alert" : "status"}>{message}{busy && <span className="dots"> ···</span>}</div>}

        {screen === "home" && (
          rows.length === 0 && !message && !catalogSearch.pending
            ? <div className="empty"><b>Type a title to search</b>Results, titles you are watching, and saved titles appear here.</div>
            : <div className="home-sections" aria-busy={catalogSearch.pending}>
                {section("results", `results for "${lastQuery}"`)}
                {rows.some((row) => row.kind === "continue" || row.kind === "saved") && (
                  <div className="home-library">{section("continue", "continue")}{section("saved", "saved")}</div>
                )}
              </div>
        )}

        {screen === "saved" && (
          <section className="list-section library-section" aria-labelledby="saved-heading">
            <h2 id="saved-heading">saved <span>{rows.length} {rows.length === 1 ? "title" : "titles"}</span></h2>
            <div className="section-scroll" role="region" aria-labelledby="saved-heading" tabIndex={0}>
            {rows.length === 0
              ? <div className="empty"><b>{filter ? "No saved titles match" : "Nothing saved yet"}</b>{filter ? "Try a shorter filter." : "Open a series and choose save. Saved titles keep their place, so play always picks up at the next episode."}</div>
              : <div className="list">{rows.map(renderRow)}</div>}
            </div>
          </section>
        )}

        {screen === "recent" && (
          <section className="list-section library-section" aria-labelledby="recent-heading">
            <h2 id="recent-heading">recent <span>{rows.length} {rows.length === 1 ? "title" : "titles"}</span>{appState.history.length > 0 && <button type="button" className="act" onClick={() => void clearHistory()}>clear history</button>}</h2>
            <div className="section-scroll" role="region" aria-labelledby="recent-heading" tabIndex={0}>
            {rows.length === 0
              ? <div className="empty"><b>{filter ? "No recent titles match" : "Nothing watched yet"}</b>{filter ? "Try a shorter filter." : `Every episode you open in ${player} is listed here.`}</div>
              : <div className="list">{rows.map(renderRow)}</div>}
            </div>
          </section>
        )}

        {screen === "series" && selectedAnime && (
          <>
            <div className="head">
              <Art src={selectedAnime.poster} large />
              <div>
                <div className="crumb">{lastQuery || "search"}  /  series</div>
                <h1>{selectedAnime.title}</h1>
                <div className="sub">
                  <span>{episodes.length ? `${episodes.length} episodes` : busy ? "loading episodes" : "no episodes"}</span>
                  <span>{animeSources(selectedAnime).map((source) => source.provider).join(" + ")}</span>
                  {progress && <span>watched through {progress.lastEpisode}</span>}
                </div>
              </div>
              <div className="acts">
                <button type="button" className="btn quiet" onClick={goBack}>back</button>
                <button type="button" className={`btn ${isSaved ? "on" : ""}`} onClick={() => void toggleBookmark()}>{isSaved ? "saved" : "save"}</button>
              </div>
            </div>
            <div className="bar">
              <span className="crumb">click an episode to play it in {player}</span>
              <div className="chips" role="tablist" aria-label="Episode source">
                {episodeGroups.map((group) => <button type="button" role="tab" aria-selected={group.provider === activeEpisodeProvider} className={group.provider === activeEpisodeProvider ? "on" : ""} key={group.provider} onClick={() => selectEpisodeProvider(group.provider)}>{group.provider}{group.error ? " unavailable" : ` ${group.episodes.length}`}</button>)}
              </div>
            </div>
            {activeEpisodeGroup?.error && <div className="line err" role="alert"><b>{activeEpisodeProvider}</b><span>{activeEpisodeGroup.error}</span><button type="button" className="act" onClick={() => void openAnime(selectedAnime)}>retry</button></div>}
            <div className="grid" ref={gridRef} tabIndex={-1} role="group" aria-label="Episodes">
              {episodes.map((episode, index) => {
                const watched = progress ? Number(episode.number) <= Number(progress.lastEpisode) : false;
                return (
                  <button type="button" key={episode.id} className={`${watched ? "w" : ""} ${index === cursor ? "cur" : ""}`} data-cursor={index === cursor}
                    tabIndex={index === cursor ? 0 : -1} onFocus={() => setCursor(index)}
                    onClick={() => void playEpisode(episode)} aria-label={`play episode ${episode.number}`}>{episode.number}</button>
                );
              })}
            </div>
            {status && (
              <div className={`line ${status.phase === "failed" ? "err" : ""}`} role="status">
                <b>episode {status.episode.number}</b>
                <span>
                  {status.phase === "finding" && <>finding a stream<span className="dots"> ···</span></>}
                  {status.phase === "opening" && <>opening {player}<span className="dots"> ···</span></>}
                  {status.phase === "opened" && `opened in ${player}`}
                  {status.phase === "failed" && status.detail}
                </span>
                {status.phase !== "failed" && <span>{status.detail}</span>}
                <button type="button" className="btn quiet" onClick={cancelPlay}>{status.phase === "finding" || status.phase === "opening" ? "cancel" : "dismiss"}</button>
              </div>
            )}
          </>
        )}

        {screen === "settings" && (
          <form className="kv" onSubmit={(event) => { event.preventDefault(); void saveSettings(); }}>
            <div className="r"><label htmlFor="player">player<small>command or full path. on macOS use IINA's iina-cli</small></label><div className="v"><input id="player" value={settingsDraft.playerPath} onChange={(event) => setSettingsDraft({ ...settingsDraft, playerPath: event.target.value })} /></div></div>
            <div className="r"><span className="k">quality</span><div className="v"><Chips value={settingsDraft.preferredQuality} options={QUALITIES} onChange={(preferredQuality) => setSettingsDraft({ ...settingsDraft, preferredQuality })} /></div></div>
            <div className="r"><span className="k">audio</span><div className="v"><Chips value={settingsDraft.preferredMode} options={["sub", "dub"] as const} onChange={(preferredMode) => setSettingsDraft({ ...settingsDraft, preferredMode })} /></div></div>
            <div className="r"><span className="k">theme<small>presets match common terminal schemes</small></span><div className="v"><div className="chips" role="radiogroup" aria-label="theme">
              {THEME_NAMES.map((name) => {
                const colours = resolveTheme(name, settingsDraft.customTheme);
                return (
                  <button type="button" key={name} role="radio" aria-checked={settingsDraft.theme === name} className={settingsDraft.theme === name ? "on" : ""}
                    onClick={() => setSettingsDraft({ ...settingsDraft, theme: name, customTheme: name === "custom" && settingsDraft.theme !== "custom" ? { ...resolveTheme(settingsDraft.theme, settingsDraft.customTheme) } : settingsDraft.customTheme })}>
                    <i className="sw" style={{ "--sw-bg": colours.background, "--sw-cur": colours.highlight } as React.CSSProperties} />{name.replace("-", " ")}
                  </button>
                );
              })}
            </div></div></div>
            {settingsDraft.theme === "custom" && (
              <div className="r"><span className="k">custom colours<small>the rest is mixed from these. highlight marks the cursor row and selected chips</small></span><div className="v">
                {(["background", "text", "highlight"] as const).map((key) => (
                  <div className="colour" key={key}>
                    <span>{key}</span>
                    <input type="color" value={settingsDraft.customTheme[key]} aria-label={`${key} colour`} onChange={(event) => setSettingsDraft({ ...settingsDraft, customTheme: { ...settingsDraft.customTheme, [key]: event.target.value } })} />
                    <input value={settingsDraft.customTheme[key]} aria-label={`${key} hex`} maxLength={7} spellCheck={false} onChange={(event) => setSettingsDraft({ ...settingsDraft, customTheme: { ...settingsDraft.customTheme, [key]: event.target.value } })} />
                  </div>
                ))}
              </div></div>
            )}
            <div className="r"><span className="k">source<small>auto tries aniwave, then anidb</small></span><div className="v"><Chips value={settingsDraft.preferredProvider} options={PROVIDERS} onChange={(preferredProvider) => setSettingsDraft({ ...settingsDraft, preferredProvider })} /></div></div>
            <div className="r"><label htmlFor="aniwave">aniwave address</label><div className="v"><input id="aniwave" value={settingsDraft.aniwaveBaseUrl} onChange={(event) => setSettingsDraft({ ...settingsDraft, aniwaveBaseUrl: event.target.value })} /></div></div>
            <div className="r"><label htmlFor="anidb">anidb address</label><div className="v"><input id="anidb" value={settingsDraft.anidbBaseUrl} onChange={(event) => setSettingsDraft({ ...settingsDraft, anidbBaseUrl: event.target.value })} /></div></div>
            <div className="acts-row"><button type="button" className="btn quiet" onClick={goBack}>cancel</button><button type="submit" className="btn primary">save changes</button></div>
          </form>
        )}
      </div>

      <div className="foot">
        {screen === "settings" ? <><span><b>⌘s</b> save</span>{backButton}</>
          : screen === "series" ? <><span><b>↑↓←→</b> move</span><span><b>↵</b> play</span><span><b>/</b> search</span>{backButton}</>
          : <><span><b>↑↓</b> move</span><span><b>↵</b> {screen === "home" ? (query.trim() && !catalogSearch.ready ? "search now" : "open") : "play"}</span>{screen !== "home" && backButton}</>}
        {footLinks}
      </div>
    </div>
  );
}

export default App;
