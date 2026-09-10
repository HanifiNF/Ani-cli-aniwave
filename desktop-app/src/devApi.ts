// Dev-only stand-in for the preload API so the renderer can run in a plain browser (npx vite) for UI work.
// Never bundled into production: main.tsx only imports it under import.meta.env.DEV when window.aniDesktop is absent.
import type { AniDesktopApi, AniPlayerApi, AnimeResult, Episode, LibraryEntry, PersistedState, PlayerSession } from "../shared/contracts";
import { animeSources, mergeKey } from "../shared/catalog";
import { THEME_PRESETS } from "../shared/theme";

const svg = (bg: string, shapes: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="200" height="300" fill="${bg}"/>${shapes}</svg>`)}`;
const posters = {
  frieren: svg("#DCE9F2", '<circle cx="120" cy="80" r="70" fill="#4F7BA6" opacity=".9"/><path d="M0 160 L200 110 L200 300 L0 300Z" fill="#1E2B3A"/>'),
  dandadan: svg("#F5E64A", '<circle cx="70" cy="90" r="45" fill="#E23A3A"/><rect x="40" y="150" width="120" height="30" fill="#111"/>'),
  dungeon: svg("#EAD6B4", '<path d="M0 120 L200 60 L200 300 L0 300Z" fill="#4C7A45"/><circle cx="100" cy="180" r="50" fill="#2E1F14"/>'),
  apothecary: svg("#F3E4E8", '<rect x="20" y="40" width="110" height="120" fill="#B8556E"/><rect x="90" y="120" width="90" height="90" fill="#3B6B58" opacity=".85"/>'),
  vinland: svg("#C9D3D8", '<rect x="30" y="40" width="80" height="80" fill="#3E5563"/><rect x="60" y="170" width="120" height="100" fill="#B04A3A"/>')
};

const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const state: PersistedState = {
  bookmarks: [
    { animeId: "aniwave:frieren-1", title: "Frieren: Beyond Journey's End", lastEpisode: "12", mode: "sub", updatedAt: days(0), poster: posters.frieren },
    { animeId: "anidb:vinland-2", title: "Vinland Saga Season 2", lastEpisode: "19", mode: "sub", updatedAt: days(12), poster: posters.vinland }
  ],
  history: [
    { animeId: "aniwave:frieren-1", title: "Frieren: Beyond Journey's End", lastEpisode: "12", mode: "sub", updatedAt: days(0), poster: posters.frieren },
    { animeId: "anidb:dandadan-3", title: "Dandadan", lastEpisode: "3", mode: "dub", updatedAt: days(1), poster: posters.dandadan },
    { animeId: "aniwave:dungeon-4", title: "Delicious in Dungeon", lastEpisode: "24", mode: "sub", updatedAt: days(3), poster: posters.dungeon },
    { animeId: "aniwave:apothecary-5", title: "The Apothecary Diaries", lastEpisode: "7", mode: "sub", updatedAt: days(7), poster: posters.apothecary },
    { animeId: "anidb:vinland-2", title: "Vinland Saga Season 2", lastEpisode: "19", mode: "sub", updatedAt: days(12), poster: posters.vinland }
  ],
  settings: {
    playerPath: "/Applications/IINA.app/Contents/MacOS/iina-cli", playbackTarget: "builtin", startPlayerFullscreen: true, preferredQuality: "best", preferredMode: "sub", preferredProvider: "auto",
    aniwaveBaseUrl: "https://aniwaves.ru", anidbBaseUrl: "https://anidb.app", theme: "graphite", customTheme: { ...THEME_PRESETS.graphite }
  }, providerLinks: [], dismissedMergeKeys: []
};

const results: AnimeResult[] = [
  { id: "aniwave:frieren-1", title: "Frieren: Beyond Journey's End", provider: "aniwave", poster: posters.frieren },
  { id: "anidb:sousou-no-frieren-9", title: "Sousou no Frieren", provider: "anidb", poster: posters.frieren },
  { id: "anidb:frieren-mahou-10", title: "Sousou no Frieren: ●● no Mahou", provider: "anidb" }
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const snapshot = () => structuredClone(state);
const upsert = (entry: LibraryEntry) => {
  state.history = [{ ...entry, updatedAt: new Date().toISOString() }, ...state.history.filter((item) => item.animeId !== entry.animeId)];
  state.bookmarks = state.bookmarks.map((item) => item.animeId === entry.animeId ? { ...entry, updatedAt: new Date().toISOString() } : item);
};

let sessions = 0;
const loadListeners = new Set<(session: PlayerSession) => void>();
const subscribe = <T>(set: Set<(value: T) => void>, listener: (value: T) => void) => { set.add(listener); return () => { set.delete(listener); }; };
const fullscreenListeners = new Set<(fullscreen: boolean) => void>();
document.addEventListener("fullscreenchange", () => { for (const listener of fullscreenListeners) listener(Boolean(document.fullscreenElement)); });

const player: AniPlayerApi = {
  async ready() { return undefined; },
  onLoad: (listener) => subscribe(loadListeners, listener),
  onFullscreenChange: (listener) => subscribe(fullscreenListeners, listener),
  onCommand: () => () => undefined,
  onNotice: () => () => undefined,
  onDiagnosticsChange: () => () => undefined,
  logDiagnostic() {},
  async saveStorage() {},
  async setFullscreen(fullscreen) {
    // Browser fullscreen stands in for the native window. It needs a user gesture, which keys and clicks provide.
    try { if (fullscreen) await document.documentElement.requestFullscreen(); else if (document.fullscreenElement) await document.exitFullscreen(); }
    catch { /* not allowed outside a gesture */ }
    return Boolean(document.fullscreenElement);
  },
  async openExternal() { throw new Error("External players are available in the desktop app"); },
  async setActive() {}
};

export function installDevApi(): void {
  const api: AniDesktopApi = {
    player,
    async search(query) { await wait(400); return query.toLowerCase().includes("nothing") ? [] : results; },
    async episodes(anime) {
      await wait(300);
      return { groups: (anime.sources ?? [{ id: anime.id, provider: anime.provider }]).map((source) => source.id.includes("mahou")
        ? { provider: source.provider, episodes: [], error: "AniDB episode lookup failed (503)" }
        : { provider: source.provider, episodes: Array.from({ length: source.provider === "aniwave" ? 28 : 24 }, (_, index): Episode => ({ id: `${source.id}:${index + 1}`, number: String(index + 1), provider: source.provider })) }) };
    },
    async streams(episodeId, mode) {
      await wait(700);
      if (episodeId.endsWith(":7")) throw new Error(`No ${mode === "dub" ? "dubbed" : "subtitled"} Vidplay server is available`);
      return [{ quality: "1080p", url: "https://cdn.example/1080.m3u8", provider: "aniwave" }, { quality: "720p", url: "https://cdn.example/720.m3u8", provider: "aniwave" }];
    },
    async play(request) {
      await wait(300);
      if (state.settings.playbackTarget !== "builtin") return true;
      // A public HLS test stream stands in for provider streams while working in the browser.
      const session: PlayerSession = { id: String(++sessions), request: { ...request, url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8" },
        canOpenExternal: false, fullscreen: Boolean(document.fullscreenElement), preferences: {} };
      for (const listener of loadListeners) listener(session);
      return true;
    },
    async getState() { return snapshot(); },
    async saveSettings(settings) { state.settings = settings; return snapshot(); },
    async openPlayerLogs() { throw new Error("Player logs are available in the desktop app"); },
    async setAppIcon() {},
    async toggleBookmark(entry) {
      const index = state.bookmarks.findIndex((item) => item.animeId === entry.animeId);
      if (index >= 0) state.bookmarks.splice(index, 1); else state.bookmarks.unshift(entry);
      return snapshot();
    },
    async removeBookmark(animeId) { state.bookmarks = state.bookmarks.filter((item) => item.animeId !== animeId); return snapshot(); },
    async recordHistory(entry) { upsert(entry); return snapshot(); },
    async removeHistory(animeId) { state.history = state.history.filter((item) => item.animeId !== animeId); return snapshot(); },
    async clearHistory() { state.history = []; return snapshot(); },
    async remapEntry(oldId, replacement) {
      const remap = (item: LibraryEntry) => item.animeId === oldId ? { ...item, animeId: replacement.id, title: replacement.title, poster: replacement.poster } : item;
      state.bookmarks = state.bookmarks.map(remap); state.history = state.history.map(remap);
      return snapshot();
    },
    async linkSources(ids) { state.providerLinks = [...(state.providerLinks ?? []), [...new Set(ids)]]; return snapshot(); },
    async mergeEntries(firstId, secondId) {
      const all = [...state.bookmarks, ...state.history];
      const first = all.find((item) => item.animeId === firstId), second = all.find((item) => item.animeId === secondId);
      if (!first || !second) throw new Error("Duplicate entries were not found");
      const sources = [...animeSources(first), ...animeSources(second)].filter((source, index, list) => list.findIndex((item) => item.id === source.id) === index);
      const latest = new Date(first.updatedAt) > new Date(second.updatedAt) ? first : second;
      const progressByProvider = { ...(first.progressByProvider ?? {}), ...(second.progressByProvider ?? {}) };
      const lastProvider = latest.lastProvider ?? (latest.animeId.startsWith("aniwave:") ? "aniwave" : "anidb");
      const progress = progressByProvider[lastProvider] ?? { lastEpisode: latest.lastEpisode, mode: latest.mode, updatedAt: latest.updatedAt };
      const primary = sources.find((source) => source.provider === "aniwave") ?? sources[0];
      const merged: LibraryEntry = { ...latest, animeId: primary.id, sources, lastProvider, progressByProvider, lastEpisode: progress.lastEpisode, mode: progress.mode, poster: primary.poster ?? first.poster ?? second.poster };
      const replace = (entries: LibraryEntry[]) => entries.some((item) => item.animeId === firstId || item.animeId === secondId)
        ? [merged, ...entries.filter((item) => item.animeId !== firstId && item.animeId !== secondId)] : entries;
      state.bookmarks = replace(state.bookmarks); state.history = replace(state.history);
      state.providerLinks = [...(state.providerLinks ?? []), sources.map((source) => source.id)];
      state.dismissedMergeKeys = [...(state.dismissedMergeKeys ?? []), mergeKey(firstId, secondId)];
      return snapshot();
    },
    async dismissMerge(first, second) { state.dismissedMergeKeys = [...(state.dismissedMergeKeys ?? []), mergeKey(first, second)]; return snapshot(); }
  };
  window.aniDesktop = api;
}
