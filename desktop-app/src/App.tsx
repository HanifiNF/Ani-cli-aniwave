import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  AnimeResult,
  Episode,
  LibraryEntry,
  PersistedState,
  ProviderName,
  ProviderPreference,
  Settings,
  Stream,
  TranslationMode
} from "../shared/contracts";

type View = "discover" | "bookmarks" | "history";

const emptyState: PersistedState = {
  bookmarks: [],
  history: [],
  settings: { playerPath: "mpv.exe", preferredQuality: "best", preferredMode: "sub", preferredProvider: "auto", aniwaveBaseUrl: "https://aniwaves.ru", anidbBaseUrl: "https://anidb.app" }
};

const providerOf = (id: string): ProviderName => id.startsWith("aniwave:") ? "aniwave" : "anidb";

function messageFrom(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

function libraryEntry(anime: AnimeResult, episode: Episode | undefined, mode: TranslationMode): LibraryEntry {
  return {
    animeId: anime.id,
    title: anime.title,
    lastEpisode: episode?.number ?? "1",
    mode,
    updatedAt: new Date().toISOString()
  };
}

function App() {
  const [view, setView] = useState<View>("discover");
  const [appState, setAppState] = useState<PersistedState>(emptyState);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AnimeResult[]>([]);
  const [selectedAnime, setSelectedAnime] = useState<AnimeResult>();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode>();
  const [streams, setStreams] = useState<Stream[]>([]);
  const [selectedQuality, setSelectedQuality] = useState("best");
  const [mode, setMode] = useState<TranslationMode>("sub");
  const [provider, setProvider] = useState<ProviderPreference>("auto");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<Settings>(emptyState.settings);

  useEffect(() => {
    window.aniDesktop
      .getState()
      .then((state) => {
        setAppState(state);
        setSettingsDraft(state.settings);
        setMode(state.settings.preferredMode);
        setSelectedQuality(state.settings.preferredQuality);
        setProvider(state.settings.preferredProvider);
      })
      .catch((reason) => setError(messageFrom(reason)));
  }, []);

  const isBookmarked = useMemo(
    () => Boolean(selectedAnime && appState.bookmarks.some((entry) => entry.animeId === selectedAnime.id)),
    [appState.bookmarks, selectedAnime]
  );

  async function run<T>(label: string, operation: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setError(undefined);
    setNotice(undefined);
    try {
      return await operation();
    } catch (reason) {
      setError(messageFrom(reason));
      return undefined;
    } finally {
      setBusy(undefined);
    }
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    const found = await run("Searching the library…", () => window.aniDesktop.search(query, provider));
    if (found) {
      setResults(found);
      setSelectedAnime(undefined);
      setEpisodes([]);
      if (found.length === 0) setNotice("No titles matched that search.");
    }
  }

  async function openAnime(anime: AnimeResult, resumeAfter?: string, entryMode?: TranslationMode, allowRemap = false): Promise<boolean> {
    setSelectedAnime(anime);
    setSelectedEpisode(undefined);
    setStreams([]);
    if (entryMode) setMode(entryMode);
    let list: Episode[];
    setBusy("Loading episodes…"); setError(undefined); setNotice(undefined);
    try { list = await window.aniDesktop.episodes(anime.id); }
    catch (reason) {
      setBusy(undefined);
      if (allowRemap) {
        const other: ProviderName = providerOf(anime.id) === "aniwave" ? "anidb" : "aniwave";
        const candidates = await run(`Checking ${other} for a replacement…`, () => window.aniDesktop.search(anime.title, other));
        const replacement = candidates?.[0];
        if (replacement && window.confirm(`${providerOf(anime.id)} is unavailable. Remap “${anime.title}” to “${replacement.title}” on ${other}?`)) {
          if (await openAnime(replacement, resumeAfter, entryMode, false)) {
            setAppState(await window.aniDesktop.remapEntry(anime.id, replacement));
            setNotice(`Remapped to ${replacement.title} on ${other}.`);
            return true;
          }
          return false;
        }
      }
      setError(messageFrom(reason));
      return false;
    }
    finally { setBusy(undefined); }
    setEpisodes(list);
    if (resumeAfter) {
      const previous = list.findIndex((episode) => episode.number === resumeAfter);
      setSelectedEpisode(list[Math.min(previous + 1, list.length - 1)] ?? list[0]);
    }
    return true;
  }

  async function chooseEpisode(episode: Episode) {
    setSelectedEpisode(episode);
    setStreams([]);
    const found = await run(`Finding episode ${episode.number} streams…`, () =>
      window.aniDesktop.streams(episode.id, mode)
    );
    if (found) {
      setStreams(found);
      const preferred = found.find((stream) => stream.quality === appState.settings.preferredQuality);
      setSelectedQuality(preferred?.quality ?? found[0]?.quality ?? "best");
    }
  }

  async function watch() {
    if (!selectedAnime || !selectedEpisode || streams.length === 0) return;
    const stream = streams.find((item) => item.quality === selectedQuality) ?? streams[0];
    const title = `${selectedAnime.title} — Episode ${selectedEpisode.number}`;
    const played = await run("Starting media player…", () => window.aniDesktop.play({ url: stream.url, title, referrer: stream.referrer }));
    if (played === undefined) return;
    const state = await window.aniDesktop.recordHistory(libraryEntry(selectedAnime, selectedEpisode, mode));
    setAppState(state);
    setNotice(`Episode ${selectedEpisode.number} opened in your media player.`);
  }

  async function toggleBookmark() {
    if (!selectedAnime) return;
    const state = await run("Updating bookmarks…", () =>
      window.aniDesktop.toggleBookmark(libraryEntry(selectedAnime, selectedEpisode, mode))
    );
    if (state) setAppState(state);
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    const state = await run("Saving settings…", () => window.aniDesktop.saveSettings(settingsDraft));
    if (state) {
      setAppState(state);
      setMode(state.settings.preferredMode);
      setSelectedQuality(state.settings.preferredQuality);
      setProvider(state.settings.preferredProvider);
      setSettingsOpen(false);
      setNotice("Settings saved.");
    }
  }

  const library = view === "bookmarks" ? appState.bookmarks : appState.history;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">A</span>
          <div><strong>Ani Desktop</strong><small>personal library</small></div>
        </div>
        <nav aria-label="Main navigation">
          <button className={view === "discover" ? "active" : ""} onClick={() => setView("discover")}>
            <span>⌕</span> Discover
          </button>
          <button className={view === "bookmarks" ? "active" : ""} onClick={() => setView("bookmarks")}>
            <span>♡</span> Bookmarks <em>{appState.bookmarks.length}</em>
          </button>
          <button className={view === "history" ? "active" : ""} onClick={() => setView("history")}>
            <span>↺</span> History
          </button>
        </nav>
        <button className="settings-button" onClick={() => setSettingsOpen(true)}>⚙ Settings</button>
        <div className="source-status"><i /> v5 · {provider === "auto" ? "AniWave → AniDB" : provider}</div>
      </aside>

      <main>
        <header>
          <div>
            <p className="eyebrow">{view}</p>
            <h1>{view === "discover" ? "What are we watching?" : view === "bookmarks" ? "Saved for later" : "Continue watching"}</h1>
          </div>
          <div className="header-controls">
            <label className="provider-picker">Source<select value={provider} onChange={(event) => setProvider(event.target.value as ProviderPreference)}><option value="auto">Auto</option><option value="aniwave">AniWave</option><option value="anidb">AniDB</option></select></label>
            <div className="mode-switch" aria-label="Audio mode">
              <button className={mode === "sub" ? "active" : ""} onClick={() => setMode("sub")}>SUB</button>
              <button className={mode === "dub" ? "active" : ""} onClick={() => setMode("dub")}>DUB</button>
            </div>
          </div>
        </header>

        {view === "discover" ? (
          <>
            <form className="search" onSubmit={search}>
              <span>⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search anime titles…" autoFocus />
              <button type="submit" disabled={!query.trim() || Boolean(busy)}>Search</button>
            </form>
            {!selectedAnime && results.length === 0 && (
              <section className="welcome">
                <div className="orb">▶</div>
                <h2>Your CLI, with room to breathe.</h2>
                <p>Search for a series, choose an episode, and send it straight to your media player.</p>
              </section>
            )}
            {!selectedAnime && results.length > 0 && (
              <section>
                <div className="section-heading"><h2>Search results</h2><span>{results.length} titles</span></div>
                <div className="results-grid">
                  {results.map((anime) => (
                    <button className="anime-card" key={anime.id} onClick={() => void openAnime(anime)}>
                      <div className="poster">
                        {anime.poster?.startsWith("http") ? <img src={anime.poster} alt="" /> : <span>{anime.title.slice(0, 1)}</span>}
                      </div>
                      <strong>{anime.title}</strong><small>Open series →</small>
                      <em className="provider-badge">{anime.provider}</em>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        ) : (
          <section>
            <div className="section-heading"><h2>{view === "bookmarks" ? "Your bookmarks" : "Recently watched"}</h2><span>{library.length} titles</span></div>
            {library.length === 0 ? <div className="empty">Nothing here yet.</div> : (
              <div className="library-list">
                {library.map((entry) => (
                  <button key={entry.animeId} onClick={() => { setView("discover"); void openAnime({ id: entry.animeId, title: entry.title, provider: providerOf(entry.animeId) }, entry.lastEpisode, entry.mode, true); }}>
                    <span className="library-initial">{entry.title.slice(0, 1)}</span>
                    <span><strong>{entry.title}</strong><small>Last watched · Episode {entry.lastEpisode} · {entry.mode.toUpperCase()} · {providerOf(entry.animeId)}</small></span>
                    <b>Continue →</b>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {selectedAnime && (
          <section className="detail">
            <button className="back" onClick={() => { setSelectedAnime(undefined); setSelectedEpisode(undefined); setStreams([]); }}>← Results</button>
            <div className="detail-title">
              <div className="detail-initial">{selectedAnime.title.slice(0, 1)}</div>
              <div><p className="eyebrow">Series · {selectedAnime.provider}</p><h2>{selectedAnime.title}</h2><span>{episodes.length} episodes available</span></div>
              <button className={`bookmark ${isBookmarked ? "saved" : ""}`} onClick={() => void toggleBookmark()}>{isBookmarked ? "♥ Saved" : "♡ Save"}</button>
            </div>
            <div className="episode-layout">
              <div>
                <div className="section-heading"><h3>Episodes</h3><span>Select one to resolve streams</span></div>
                <div className="episodes">
                  {episodes.map((episode) => (
                    <button className={selectedEpisode?.id === episode.id ? "active" : ""} key={episode.id} onClick={() => void chooseEpisode(episode)}>{episode.number}</button>
                  ))}
                </div>
              </div>
              <aside className="play-panel">
                <p className="eyebrow">Ready when you are</p>
                <h3>{selectedEpisode ? `Episode ${selectedEpisode.number}` : "Choose an episode"}</h3>
                <label>Quality
                  <select value={selectedQuality} onChange={(event) => setSelectedQuality(event.target.value)} disabled={streams.length === 0}>
                    {streams.length === 0 ? <option>—</option> : streams.map((stream) => <option key={stream.quality}>{stream.quality}</option>)}
                  </select>
                </label>
                <button className="watch" disabled={streams.length === 0 || Boolean(busy)} onClick={() => void watch()}>▶ Watch now</button>
                <small>{mode.toUpperCase()} · external player</small>
                {streams[0]?.server && <small>{streams[0].server} · {streams[0].provider}</small>}
              </aside>
            </div>
          </section>
        )}

        {(busy || error || notice) && <div className={`toast ${error ? "error" : ""}`} role={error ? "alert" : "status"}>{error ?? busy ?? notice}</div>}
      </main>

      {settingsOpen && (
        <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <form className="modal" onSubmit={saveSettings}>
            <div className="section-heading"><div><p className="eyebrow">Preferences</p><h2>Settings</h2></div><button type="button" className="close" onClick={() => setSettingsOpen(false)}>×</button></div>
            <label>Media player executable or full path<input value={settingsDraft.playerPath} onChange={(event) => setSettingsDraft({ ...settingsDraft, playerPath: event.target.value })} /></label>
            <label>Preferred quality<select value={settingsDraft.preferredQuality} onChange={(event) => setSettingsDraft({ ...settingsDraft, preferredQuality: event.target.value })}><option>best</option><option>1080p</option><option>800p</option><option>720p</option><option>480p</option><option>360p</option></select></label>
            <label>Preferred mode<select value={settingsDraft.preferredMode} onChange={(event) => setSettingsDraft({ ...settingsDraft, preferredMode: event.target.value as TranslationMode })}><option value="sub">Subtitled</option><option value="dub">Dubbed</option></select></label>
            <label>Preferred source<select value={settingsDraft.preferredProvider} onChange={(event) => setSettingsDraft({ ...settingsDraft, preferredProvider: event.target.value as ProviderPreference })}><option value="auto">Auto (AniWave, then AniDB)</option><option value="aniwave">AniWave</option><option value="anidb">AniDB</option></select></label>
            <label>AniWave base URL<input value={settingsDraft.aniwaveBaseUrl} onChange={(event) => setSettingsDraft({ ...settingsDraft, aniwaveBaseUrl: event.target.value })} /></label>
            <label>AniDB-compatible base URL<input value={settingsDraft.anidbBaseUrl} onChange={(event) => setSettingsDraft({ ...settingsDraft, anidbBaseUrl: event.target.value })} /></label>
            <div className="modal-actions"><button type="button" onClick={() => setSettingsOpen(false)}>Cancel</button><button className="primary" type="submit">Save settings</button></div>
          </form>
        </div>
      )}
    </div>
  );
}

export default App;
