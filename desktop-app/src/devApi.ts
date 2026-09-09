// Dev-only stand-in for the preload API so the renderer can run in a plain browser (npx vite) for UI work.
// Never bundled into production: main.tsx only imports it under import.meta.env.DEV when window.aniDesktop is absent.
import type { AniDesktopApi, AnimeResult, Episode, LibraryEntry, PersistedState } from "../shared/contracts";
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
    playerPath: "/Applications/IINA.app/Contents/MacOS/iina-cli", preferredQuality: "best", preferredMode: "sub", preferredProvider: "auto",
    aniwaveBaseUrl: "https://aniwaves.ru", anidbBaseUrl: "https://anidb.app", theme: "graphite", customTheme: { ...THEME_PRESETS.graphite }
  }
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

export function installDevApi(): void {
  const api: AniDesktopApi = {
    async search(query) { await wait(400); return query.toLowerCase().includes("nothing") ? [] : results; },
    async episodes(animeId) {
      await wait(300);
      if (animeId.includes("mahou")) throw new Error("AniDB episode lookup failed (503)");
      return Array.from({ length: 28 }, (_, index): Episode => ({ id: `${animeId}:${index + 1}`, number: String(index + 1) }));
    },
    async streams(episodeId, mode) {
      await wait(700);
      if (episodeId.endsWith(":7")) throw new Error(`No ${mode === "dub" ? "dubbed" : "subtitled"} Vidplay server is available`);
      return [{ quality: "1080p", url: "https://cdn.example/1080.m3u8", provider: "aniwave" }, { quality: "720p", url: "https://cdn.example/720.m3u8", provider: "aniwave" }];
    },
    async play() { await wait(300); return true; },
    async getState() { return snapshot(); },
    async saveSettings(settings) { state.settings = settings; return snapshot(); },
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
    }
  };
  window.aniDesktop = api;
}
