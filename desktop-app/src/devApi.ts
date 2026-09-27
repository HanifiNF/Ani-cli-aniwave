// Dev-only stand-in for the preload API so the renderer can run in a plain browser (npx vite) for UI work.
// Never bundled into production: main.tsx only imports it under import.meta.env.DEV when window.aniDesktop is absent.
import type { AniDesktopApi, AniPlayerApi, AnimeResult, AnimeSource, Episode, LibraryEntry, PersistedState, PlayerSession, WorkInfo } from "../shared/contracts";
import { animeSources, expandWithLinks, mergeKey, unifyAnimeResults, enabledProviders, providerFromId } from "../shared/catalog";
import { DEFAULT_STATE } from "../shared/settings";
import { browseMatch, browseQueries, identified } from "../shared/browse-source";
import { BACKDROP_POOL } from "../shared/backdrops";
import { DEV_BROWSE } from "./devBrowseFixtures";

const DEV_TAGS = ["Cyberpunk", "Found Family", "Isekai", "Male Protagonist", "Reverse Isekai", "School", "Shounen", "Time Travel", "Tragedy", "Urban Fantasy"];
const DEV_STUDIO_NAMES = [...new Set(DEV_BROWSE.flatMap((anime) => anime.studios))].sort();
const devStudiosRead = new Set<number>();
/** Studios named by the browse fixtures, plus one producer without works so that state can be seen. */
const devStudios = (term: string) => [...DEV_STUDIO_NAMES.map((name, index) => ({ id: index + 1, name, animation: true })), { id: 999, name: "Toei Agency", animation: false }]
  .filter((studio) => studio.name.toLowerCase().includes(term.trim().toLowerCase())).slice(0, 6);

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
  settings: { ...structuredClone(DEFAULT_STATE.settings), playerPath: "/Applications/IINA.app/Contents/MacOS/iina-cli" },
  providerLinks: [], dismissedMergeKeys: []
};

const results: AnimeResult[] = [
  { id: "aniwave:frieren-1", title: "Frieren: Beyond Journey's End", provider: "aniwave", poster: posters.frieren,
    sources: [{ id: "aniwave:frieren-1", provider: "aniwave", title: "Frieren: Beyond Journey's End", aliases: ["Frieren: Beyond Journey's End", "Sousou no Frieren"], poster: posters.frieren }] },
  { id: "anidb:sousou-no-frieren-9", title: "Sousou no Frieren", provider: "anidb", poster: posters.frieren },
  { id: "anidb:frieren-mahou-10", title: "Sousou no Frieren: ●● no Mahou", provider: "anidb" }
];
// What the other providers would return when a series is resolved across sources.
const elsewhere: Record<string, AnimeSource[]> = {
  "aniwave:frieren-1": [{ id: "hianime:sousou-no-frieren-xyz", provider: "hianime", title: "Sousou no Frieren", aliases: ["Sousou no Frieren", "Frieren: Beyond Journey's End"] }],
  "anidb:dandadan-3": [{ id: "aniwave:dandadan-7", provider: "aniwave", title: "Dandadan", aliases: ["Dandadan"] }, { id: "hianime:dandadan-abc", provider: "hianime", title: "Dandadan", aliases: ["Dandadan"] }]
};

// Direct CDN addresses for the pool, because the id lookup has no CORS header and cannot be called from a page; the desktop app resolves ids in the main process.
const DEV_BACKDROPS: Record<number, { url: string; sourceUrl?: string; artist?: string; light?: boolean }> = {
  8879: { url: "https://cdn.nekosapi.com/nekos-api/images/original/50133f72-fc17-4949-839d-f045f44135f2.webp", artist: "xilmo", light: true },
  20268: { url: "https://cdn.nekosapi.com/nekos-api/images/original/d4dab856-2751-4507-814a-d250cd784a2b.webp", light: true },
  3295: { url: "https://cdn.nekosapi.com/nekos-api/images/original/e892a847-cf33-446b-8e55-2537caf8c570.webp", sourceUrl: "https://danbooru.donmai.us/post/show/5464083", light: true },
  9002: { url: "https://cdn.nekosapi.com/nekos-api/images/original/d9ccabde-9236-4ef7-980a-ec9d1bd0d440.webp", artist: "ヒトこもる" },
  11649: { url: "https://cdn.nekosapi.com/nekos-api/images/original/77de447c-6e40-4440-b8e0-cd04b92fd6ad.webp" },
  17201: { url: "https://cdn.nekosapi.com/nekos-api/images/original/517d1d16-a6c2-4979-93d0-71ba9ce966d8.webp", light: true },
  1876: { url: "https://cdn.nekosapi.com/nekos-api/images/original/4fda5ff9-c8fe-4889-b314-7aa424adb0e2.webp", sourceUrl: "https://danbooru.donmai.us/post/show/6088096", light: true },
  41078: { url: "https://cdn.nekosapi.com/nekos-api/images/original/ee11efb3-23db-4aa0-91c1-5f4ed6c1b4db.webp", light: true },
  32082: { url: "https://cdn.nekosapi.com/nekos-api/images/original/4c4a2ccf-d0a0-4420-b58a-eefe928dd712.webp", light: true },
  19118: { url: "https://cdn.nekosapi.com/nekos-api/images/original/5557c62c-f135-4318-a8b5-31d983471e28.webp", light: true },
  6708: { url: "https://cdn.nekosapi.com/nekos-api/images/original/8290cedc-763b-4bda-998a-bfe54a70cd06.webp" },
  2524: { url: "https://cdn.nekosapi.com/nekos-api/images/original/efb31ad2-9832-49ff-b61f-d1bdf3e56786.webp", sourceUrl: "https://danbooru.donmai.us/post/show/5891346", light: true },
  15502: { url: "https://cdn.nekosapi.com/nekos-api/images/original/32296cf7-0115-48bc-954c-f3c1b856d208.webp", light: true },
  3754: { url: "https://cdn.nekosapi.com/nekos-api/images/original/dc45ef57-0c25-4c6f-b234-62e68d4ed67c.webp", light: true },
  5834: { url: "https://cdn.nekosapi.com/nekos-api/images/original/c035a692-f80e-4cdc-9e4c-48fe0d63864a.webp" },
  17128: { url: "https://cdn.nekosapi.com/nekos-api/images/original/c13aae6e-8d8a-460c-bf36-21c15aca53cc.webp", light: true },
  30444: { url: "https://cdn.nekosapi.com/nekos-api/images/original/89240e12-51ff-4636-a41d-72a070810286.webp", light: true },
  7579: { url: "https://cdn.nekosapi.com/nekos-api/images/original/9834efcd-d711-4fbf-8dc3-0c2ff8172bb1.webp" },
  1868: { url: "https://cdn.nekosapi.com/nekos-api/images/original/99b83f96-2498-4c45-b6c6-446c2dd6aab9.webp", light: true },
  25265: { url: "https://cdn.nekosapi.com/nekos-api/images/original/19df3895-2003-4f44-bd6c-90b7cf74f2bf.webp", light: true },
  18542: { url: "https://cdn.nekosapi.com/nekos-api/images/original/0e45ed81-bc6f-4ac4-9648-79a278cc0edb.webp", light: true },
  16065: { url: "https://cdn.nekosapi.com/nekos-api/images/original/40d175ef-2261-48b8-a554-f3a871cdfaaf.webp", sourceUrl: "https://twitter.com/i/web/status/894739092893687808" },
  9929: { url: "https://cdn.nekosapi.com/nekos-api/images/original/a0f067e7-ca4a-406c-a3d2-ba938b868a7a.webp" },
  4816: { url: "https://cdn.nekosapi.com/nekos-api/images/original/80fcd2da-ca0b-43dc-a1ba-d20b2dd62625.webp", sourceUrl: "https://danbooru.donmai.us/post/show/5900527" },
  5048: { url: "https://cdn.nekosapi.com/nekos-api/images/original/94781515-8e5e-422f-84fb-233841e16157.webp" },
  10759: { url: "https://cdn.nekosapi.com/nekos-api/images/original/d58f6b86-4cac-49eb-b02c-1e157bb6992e.webp", light: true },
  1236: { url: "https://cdn.nekosapi.com/nekos-api/images/original/77e8ba65-fabb-484d-9c19-20d42c8e2d47.webp", sourceUrl: "https://danbooru.donmai.us/post/show/4922653", light: true },
  16820: { url: "https://cdn.nekosapi.com/nekos-api/images/original/f979d449-5eec-4e72-b44a-a19e3b98b72d.webp", light: true },
  7470: { url: "https://cdn.nekosapi.com/nekos-api/images/original/15580b2e-9d0b-4d95-8899-050829e10964.webp" }
};

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
    async listCompanions() { return []; },
    async chooseCompanion() { throw new Error("Import companions in the Electron app"); },
    async saveCompanion() { throw new Error("Import companions in the Electron app"); },
    async companionImage() { return undefined; },
    async removeCompanion() { return false; },
    async saveSubtitleAppearance(appearance) { state.subtitleAppearance = appearance; return appearance; },
    async search(query) {
      await wait(400);
      const enabled = enabledProviders(state.settings);
      return query.toLowerCase().includes("nothing") ? [] : unifyAnimeResults(results.filter((hit) => enabled.includes(hit.provider)), state.providerLinks ?? []);
    },
    async discoverBrowse(anime) {
      for (const query of browseQueries(anime)) {
        const match = browseMatch(anime, await api.search(query));
        if (match) return { anime: await api.resolveSources(identified(anime, match)), errors: {} };
      }
      return { errors: {} };
    },
    async resolveSources(raw) {
      await wait(900);
      const anime = expandWithLinks(raw, state.providerLinks ?? []);
      const known = animeSources(anime);
      const enabled = enabledProviders(state.settings);
      const extra = known.flatMap((source) => elsewhere[source.id] ?? []).filter((source) => enabled.includes(source.provider) && !known.some((item) => item.provider === source.provider));
      if (extra.length === 0) return anime;
      const sources = [...known, ...extra];
      state.providerLinks = [...(state.providerLinks ?? []), sources.map((source) => source.id)];
      return { ...anime, sources };
    },
    async workInfo(anime, _request, update) {
      await wait(250);
      if (!state.settings.animeInfo || !/frieren/i.test(anime.title)) return undefined;
      const info: WorkInfo = { refs: ["anilist:154587", "mal:52991"], title: "Frieren: Beyond Journey's End", titles: { romaji: "Sousou no Frieren", english: "Frieren: Beyond Journey's End" }, synonyms: [],
        type: "TV", episodes: 28, year: 2023, season: "fall", status: "finished", genres: ["Adventure", "Drama", "Fantasy"], studios: ["madhouse"], score: 89,
        description: "After the party of heroes defeated the Demon King, the elf mage Frieren sets out to understand the people she outlived.",
        cover: posters.frieren, relations: [{ relation: "sequel", refs: ["anilist:182255"], title: "Frieren: Beyond Journey's End Season 2", type: "TV" }], fetchedAt: Date.now(), source: "anilist" };
      update?.(info);
      return info;
    },
    async identityIndexStatus() { return { enabled: state.settings.offlineIndex === true, entries: 0, updating: false }; },
    async updateIdentityIndex() { await wait(600); return { enabled: state.settings.offlineIndex === true, entries: 41537, updatedAt: Date.now(), updating: false }; },
    async episodes(anime) {
      await wait(300);
      const enabled = enabledProviders(state.settings);
      return { groups: (anime.sources ?? [{ id: anime.id, provider: anime.provider }]).filter((source) => enabled.includes(source.provider)).map((source) => source.id.includes("mahou")
        ? { provider: source.provider, episodes: [], error: "AniDB episode lookup failed (503)" }
        : { provider: source.provider, episodes: Array.from({ length: source.provider === "aniwave" ? 28 : 24 }, (_, index): Episode => ({ id: `${source.id}:${index + 1}`, number: String(index + 1), provider: source.provider })) }) };
    },
    async seriesMetadata(anime) {
      await wait(180);
      const sources = animeSources(anime).filter((source) => enabledProviders(state.settings).includes(source.provider)).map((source) => ({
        sourceId: source.id, provider: source.provider, genres: source.provider === "anidb" ? ["Adventure", "Fantasy"] : ["Adventure", "Drama", "Fantasy"],
        availableEpisodes: source.provider === "aniwave" ? 28 : 24, announcedEpisodes: source.provider === "aniwave" ? 28 : undefined, checkedAt: Date.now()
      }));
      return { sources, genres: [...new Set(sources.flatMap((source) => source.genres))].sort() };
    },
    async episodeMetadata() { return undefined; },
    async clearEpisodeMetadata() {},
    async fetchBookmarkMetadata() { throw new Error("Bookmark metadata fetching is available in the desktop app"); },
    async bookmarkMetadataStatus() { return undefined; },
    async cancelBookmarkMetadata() { return undefined; },
    async sourceStatus() { return (["aniwave", "anidb", "hianime"] as const).map((provider) => ({ provider, origin: `https://${provider}.example`, state: "unknown" as const, canRetry: true })); },
    async checkSource() { await wait(300); },
    async schedule(query) {
      await wait(250);
      const entries = [
        ["Frieren: Beyond Journey's End", "frieren-beyond-journeys-end-1", "13", 16, 30, posters.frieren],
        ["Dandadan", "dandadan-3", "4", 19, 0, posters.dandadan],
        ["The Apothecary Diaries", "the-apothecary-diaries-5", "8", 21, 15, posters.apothecary]
      ].map(([title, slug, episode, hour, minute, poster]) => {
        const local = new Date(`${query.date}T00:00:00`); local.setHours(Number(hour), Number(minute));
        const id = `aniwave:${slug}`;
        return { anime: { id, title: String(title), poster: String(poster), provider: "aniwave" as const, sources: [{ id, provider: "aniwave" as const, title: String(title), aliases: [String(title)], poster: String(poster) }] },
          episode: { id: `aniwave:${String(slug).match(/-(\d+)$/)?.[1]}:${episode}`, number: String(episode), provider: "aniwave" as const },
          releaseAt: local.toISOString(), timeLabel: local.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) };
      });
      return { provider: "aniwave", requestedDate: query.date, entries, refreshedAt: new Date().toISOString(), status: "fresh" };
    },
    async scheduleArtwork(animeId) { return { animeId, aliases: [] }; },
    // The browser loads the image straight from the CDN here; the desktop app caches a copy on disk.
    async backdropArt(kind) {
      if (state.settings.emptyBackdrop === false) return undefined;
      const entries = BACKDROP_POOL.filter((entry) => entry.kind === kind && entry.id in DEV_BACKDROPS);
      const entry = entries[Math.floor(Math.random() * entries.length)];
      if (!entry) return undefined;
      await wait(150);
      return { id: entry.id, kind, ...DEV_BACKDROPS[entry.id], src: DEV_BACKDROPS[entry.id].url };
    },
    async browseGenres() { return ["Action", "Adventure", "Comedy", "Drama", "Fantasy", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural"]; },
    async browseTags() { await wait(300); return DEV_TAGS; },
    async browse(query, _request, onUpdate) {
      await wait(500);
      const { filters, page } = query, lower = (values: string[]) => values.map((value) => value.toLowerCase());
      // A studio's list is read a page at a time in the app; two ticks stand in for it here, once per studio.
      if (filters.studio && !devStudiosRead.has(filters.studio.id)) {
        const works = DEV_BROWSE.filter((anime) => anime.studios.includes(filters.studio!.name));
        for (const read of [Math.ceil(works.length / 2), works.length]) { onUpdate?.({ studio: filters.studio.name, read, entries: works.slice(0, 8) }); await wait(1200); }
        devStudiosRead.add(filters.studio.id);
      }
      const term = filters.search?.toLowerCase();
      const matches = DEV_BROWSE.filter((anime) => lower(filters.includeGenres).every((genre) => lower(anime.genres).includes(genre))
        && !lower(filters.excludeGenres).some((genre) => lower(anime.genres).includes(genre))
        && (!term || anime.titles.some((title) => title.toLowerCase().includes(term))) && (!filters.studio || anime.studios.includes(filters.studio.name))
        // The fixtures carry no tags; each tag keeps a fixed third of the catalog so the filter visibly narrows.
        && (filters.tags ?? []).every((tag) => (anime.anilistId + tag.length) % 3 === 0)
        && (!filters.year || anime.year === filters.year) && (!filters.season || anime.season === filters.season) && (!filters.status || anime.status === filters.status)
        && (!filters.format || anime.type === filters.format) && (!filters.minimumScore || (anime.score ?? 0) >= filters.minimumScore)
        && (!filters.minimumEpisodes || (anime.episodes ?? 0) >= filters.minimumEpisodes) && (!filters.maximumEpisodes || (anime.episodes !== undefined && anime.episodes <= filters.maximumEpisodes)));
      const sorted = filters.sort === "score" ? [...matches].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)) : filters.sort === "newest" ? [...matches].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))
        : filters.sort === "title" ? [...matches].sort((a, b) => a.title.localeCompare(b.title)) : matches;
      return { query, entries: sorted.slice((page - 1) * 24, page * 24), hasNextPage: sorted.length > page * 24, fetchedAt: Date.now(),
        ...(filters.search && !filters.studio && page === 1 ? { studios: devStudios(filters.search) } : {}) };
    },
    cancelCatalog() {},
    async availability() { await wait(150); return { sub: true, dub: true, checkedAt: Date.now() }; },
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
    async episodeUpdates() { return { updates: [], unreadCount: 0, counts: {}, latestByAnime: {}, checking: false }; },
    async checkEpisodeUpdates() { return { updates: [], unreadCount: 0, counts: {}, latestByAnime: {}, checking: false, checkedAt: Date.now() }; },
    async dismissEpisodeUpdate() { return { updates: [], unreadCount: 0, counts: {}, latestByAnime: {}, checking: false }; },
    async markEpisodeUpdateRead() { return { updates: [], unreadCount: 0, counts: {}, latestByAnime: {}, checking: false }; },
    onEpisodeUpdatesChange() { return () => {}; },
    onOpenEpisodeUpdates() { return () => {}; },
    async checkForUpdates() { return { currentVersion: "development", state: "development" }; },
    async dismissUpdate() { return { currentVersion: "development", state: "development" }; },
    async openLatestRelease() { window.open("https://github.com/HanifiNF/Ani-cli-aniwave/releases/latest", "_blank", "noopener"); },
    async getUpdateInstallStatus() { return { mode: "unsupported", phase: "idle", detail: "Install updates from a packaged release of ANIdesktop." }; },
    onUpdateInstallStatus() { return () => {}; },
    async downloadUpdate() { throw new Error("Update downloads are available in the desktop app."); },
    async installUpdate() { throw new Error("Update installation is available in the desktop app."); },
    async copyText(text) { await navigator.clipboard.writeText(text); },
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
    async clearSourceLinks() { state.providerLinks = []; return snapshot(); },
    async linkSources(ids) { state.providerLinks = [...(state.providerLinks ?? []), [...new Set(ids)]]; return snapshot(); },
    async splitSource(sourceId) {
      state.providerLinks = (state.providerLinks ?? []).map((group) => group.filter((id) => id !== sourceId)).filter((group) => group.length > 1);
      const detach = (entry: LibraryEntry) => entry.sources && entry.sources.length > 1 && entry.animeId !== sourceId ? { ...entry, sources: entry.sources.filter((source) => source.id !== sourceId) } : entry;
      state.bookmarks = state.bookmarks.map(detach); state.history = state.history.map(detach);
      return snapshot();
    },
    async mergeEntries(firstId, secondId) {
      const all = [...state.bookmarks, ...state.history];
      const first = all.find((item) => item.animeId === firstId), second = all.find((item) => item.animeId === secondId);
      if (!first || !second) throw new Error("Duplicate entries were not found");
      const sources = [...animeSources(first), ...animeSources(second)].filter((source, index, list) => list.findIndex((item) => item.id === source.id) === index);
      const latest = new Date(first.updatedAt) > new Date(second.updatedAt) ? first : second;
      const progressByProvider = { ...(first.progressByProvider ?? {}), ...(second.progressByProvider ?? {}) };
      const lastProvider = latest.lastProvider ?? providerFromId(latest.animeId);
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
