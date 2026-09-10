import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { MINI_PLAYER_CORNERS, type AnimeResult, type CustomTheme, type LibraryEntry, type MiniPlayerCorner, type PersistedState, type Settings, type PlayRequest } from "../shared/contracts";
import { playbackKey, validateStorageUpdate } from "../shared/playback";
import { animeSources, mergeKey, overlaps, sourceIds } from "../shared/catalog";
import { THEME_PRESETS, isHexColor, isThemePreset } from "../shared/theme";

const defaults: PersistedState = {
  bookmarks: [],
  history: [],
  providerLinks: [],
  dismissedMergeKeys: [],
  settings: {
    playerPath: "",
    playbackTarget: "builtin",
    startPlayerFullscreen: true,
    autoplayNext: true,
    miniPlayerCorner: "bottom-right",
    playerDiagnostics: false,
    preferredQuality: "best",
    preferredMode: "sub",
    preferredProvider: "auto",
    aniwaveBaseUrl: "https://aniwaves.ru",
    anidbBaseUrl: "https://anidb.app",
    theme: "graphite",
    customTheme: { ...THEME_PRESETS.graphite }
  }
};

function normalizePoster(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

const normalizeCorner = (value: unknown): MiniPlayerCorner => (MINI_PLAYER_CORNERS as readonly unknown[]).includes(value) ? value as MiniPlayerCorner : "bottom-right";

export function normalizeEntry(entry: LibraryEntry): LibraryEntry {
  if (!/^(?:(?:aniwave|anidb):)?[a-z0-9-]+-\d+$/i.test(entry.animeId)) throw new Error("Invalid anime identifier");
  if (!entry.title.trim() || entry.title.length > 240) throw new Error("Invalid anime title");
  if (!/^\d+(?:\.\d+)?$/.test(entry.lastEpisode)) throw new Error("Invalid episode number");
  const poster = normalizePoster(entry.poster);
  const sources = animeSources(entry).map((source) => ({ ...source, aliases: [...new Set([source.title, ...(source.aliases ?? [])])], poster: normalizePoster(source.poster) }));
  const lastProvider = entry.lastProvider ?? sources[0].provider;
  const updatedAt = new Date().toISOString();
  const completed = entry.completed !== false;
  const progressByProvider = { ...entry.progressByProvider };
  progressByProvider[lastProvider] = {
    ...(progressByProvider[lastProvider] ?? { lastEpisode: entry.lastEpisode, mode: entry.mode === "dub" ? "dub" : "sub", updatedAt }),
    ...(entry.completed !== undefined ? { completed } : {})
  };
  return { animeId: entry.animeId, title: entry.title.trim(), lastEpisode: entry.lastEpisode, mode: entry.mode === "dub" ? "dub" : "sub", updatedAt, sources, lastProvider, progressByProvider, completed, ...(poster ? { poster } : {}) };
}

function migrateEntry(entry: LibraryEntry): LibraryEntry {
  const sources = animeSources(entry);
  const lastProvider = entry.lastProvider ?? sources[0].provider;
  return {
    ...entry, sources, lastProvider,
    progressByProvider: entry.progressByProvider ?? { [lastProvider]: { lastEpisode: entry.lastEpisode, mode: entry.mode, updatedAt: entry.updatedAt } }
  };
}

function combineEntries(left: LibraryEntry, right: LibraryEntry): LibraryEntry {
  const sources = [...animeSources(left), ...animeSources(right)].filter((source, index, all) => all.findIndex((item) => item.id === source.id) === index);
  const progressByProvider = { ...(left.progressByProvider ?? migrateEntry(left).progressByProvider), ...(right.progressByProvider ?? migrateEntry(right).progressByProvider) };
  const latest = new Date(left.updatedAt).getTime() >= new Date(right.updatedAt).getTime() ? left : right;
  const lastProvider = latest.lastProvider ?? animeSources(latest)[0].provider;
  const progress = progressByProvider[lastProvider] ?? { lastEpisode: latest.lastEpisode, mode: latest.mode, updatedAt: latest.updatedAt };
  const primary = sources.find((source) => source.provider === "aniwave") ?? sources[0];
  return {
    animeId: primary.id,
    title: primary.title || latest.title,
    poster: primary.poster ?? left.poster ?? right.poster,
    lastEpisode: progress.lastEpisode, mode: progress.mode, updatedAt: latest.updatedAt, completed: progress.completed ?? latest.completed,
    sources, lastProvider, progressByProvider
  };
}

function normalizeTheme(value: unknown): CustomTheme {
  const record = (value && typeof value === "object" ? value : {}) as Partial<CustomTheme>;
  const fallback = defaults.settings.customTheme;
  return {
    background: isHexColor(record.background) ? record.background : fallback.background,
    text: isHexColor(record.text) ? record.text : fallback.text,
    highlight: isHexColor(record.highlight) ? record.highlight : fallback.highlight
  };
}

export class StateStore {
  private state: PersistedState = structuredClone(defaults);
  private writeQueue = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<PersistedState>;
      const settings = { ...defaults.settings, ...(parsed.settings ?? {}) };
      this.state = {
        bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks.map(migrateEntry) : [],
        history: Array.isArray(parsed.history) ? parsed.history.map(migrateEntry) : [],
        providerLinks: Array.isArray(parsed.providerLinks) ? parsed.providerLinks : [],
        dismissedMergeKeys: Array.isArray(parsed.dismissedMergeKeys) ? parsed.dismissedMergeKeys : [],
        playerPreferences: parsed.playerPreferences ? validateStorageUpdate(parsed.playerPreferences) : {},
        playbackPositions: parsed.playbackPositions ?? {},
        settings: {
          ...settings,
          playbackTarget: settings.playbackTarget === "external" ? "external" : "builtin",
          startPlayerFullscreen: typeof settings.startPlayerFullscreen === "boolean" ? settings.startPlayerFullscreen : true,
          autoplayNext: settings.autoplayNext !== false,
          miniPlayerCorner: normalizeCorner(settings.miniPlayerCorner),
          playerDiagnostics: settings.playerDiagnostics === true,
          theme: isThemePreset(settings.theme) ? settings.theme : "graphite",
          customTheme: normalizeTheme(settings.customTheme)
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  snapshot(): PersistedState {
    return structuredClone(this.state);
  }

  async savePlayerStorage(request: PlayRequest, value: unknown): Promise<void> {
    const { time, completed, ...preferences } = validateStorageUpdate(value);
    this.state.playerPreferences = { ...this.state.playerPreferences, ...preferences };
    const key = playbackKey(request);
    if (key && time !== undefined) {
      const positions = this.state.playbackPositions ?? {};
      positions[key] = { time: completed ? 0 : time, completed: completed ?? false, updatedAt: new Date().toISOString(), animeId: request.episode?.entry.animeId };
      this.state.playbackPositions = Object.fromEntries(Object.entries(positions)
        .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt)).slice(0, 500));
    }
    if (completed && request.episode) {
      const playing = request.episode.entry;
      const provider = playing.lastProvider ?? animeSources(playing)[0].provider;
      for (const list of [this.state.history, this.state.bookmarks]) {
        for (const entry of list) {
          const progress = entry.progressByProvider?.[provider];
          if (!overlaps(entry, playing) || progress?.lastEpisode !== playing.lastEpisode || progress.mode !== playing.mode) continue;
          progress.completed = true;
          if (entry.lastProvider === provider) entry.completed = true;
        }
      }
    }
    await this.persist();
  }

  async saveSettings(settings: Settings): Promise<PersistedState> {
    if (settings.playbackTarget !== "builtin" && settings.playbackTarget !== "external") throw new Error("Unknown playback target");
    if (settings.playbackTarget === "external" && !settings.playerPath.trim()) throw new Error("External player path cannot be empty");
    if (!isThemePreset(settings.theme)) throw new Error("Unknown theme");
    const custom = settings.customTheme ?? {};
    for (const key of ["background", "text", "highlight"] as const) {
      if (!isHexColor(custom[key])) throw new Error(`Custom ${key} colour must be a hex value like #1F2023`);
    }
    this.state.settings = {
      playerPath: settings.playerPath.trim(),
      playbackTarget: settings.playbackTarget,
      startPlayerFullscreen: Boolean(settings.startPlayerFullscreen),
      autoplayNext: settings.autoplayNext !== false,
      miniPlayerCorner: normalizeCorner(settings.miniPlayerCorner),
      playerDiagnostics: settings.playerDiagnostics === true,
      preferredQuality: settings.preferredQuality.trim() || "best",
      preferredMode: settings.preferredMode === "dub" ? "dub" : "sub",
      preferredProvider: settings.preferredProvider,
      aniwaveBaseUrl: normalizeSource(settings.aniwaveBaseUrl, "AniWave"),
      anidbBaseUrl: normalizeSource(settings.anidbBaseUrl, "AniDB"),
      theme: settings.theme,
      customTheme: { background: custom.background, text: custom.text, highlight: custom.highlight }
    };
    await this.persist();
    return this.snapshot();
  }

  async toggleBookmark(rawEntry: LibraryEntry): Promise<PersistedState> {
    const entry = normalizeEntry(rawEntry);
    const existing = this.state.bookmarks.findIndex((item) => overlaps(item, entry));
    if (existing >= 0) this.state.bookmarks.splice(existing, 1);
    else {
      const historyEntry = this.state.history.find((item) => overlaps(item, entry));
      this.state.bookmarks.unshift(historyEntry ? combineEntries(historyEntry, entry) : entry);
    }
    await this.persist();
    return this.snapshot();
  }

  async removeBookmark(animeId: string): Promise<PersistedState> {
    this.state.bookmarks = this.state.bookmarks.filter((item) => item.animeId !== animeId);
    await this.persist();
    return this.snapshot();
  }

  async recordHistory(rawEntry: LibraryEntry): Promise<PersistedState> {
    const entry = normalizeEntry(rawEntry);
    const bookmarkIndex = this.state.bookmarks.findIndex((item) => overlaps(item, entry));
    const historyEntry = this.state.history.find((item) => overlaps(item, entry));
    const known = entry.poster ?? historyEntry?.poster ?? this.state.bookmarks[bookmarkIndex]?.poster;
    let merged = known ? { ...entry, poster: known } : entry;
    if (historyEntry) merged = combineEntries(historyEntry, merged);
    this.state.history = [merged, ...this.state.history.filter((item) => !overlaps(item, entry))].slice(0, 100);
    if (bookmarkIndex >= 0) this.state.bookmarks[bookmarkIndex] = merged;
    await this.persist();
    return this.snapshot();
  }

  async removeHistory(animeId: string): Promise<PersistedState> {
    const entry = this.state.history.find((item) => item.animeId === animeId);
    const ids = entry ? sourceIds(entry) : [animeId];
    this.state.playbackPositions = Object.fromEntries(Object.entries(this.state.playbackPositions ?? {})
      .filter(([, position]) => !position.animeId || !ids.includes(position.animeId)));
    this.state.history = this.state.history.filter((item) => item.animeId !== animeId);
    await this.persist();
    return this.snapshot();
  }

  async clearHistory(): Promise<PersistedState> {
    this.state.history = [];
    this.state.playbackPositions = {};
    await this.persist();
    return this.snapshot();
  }

  async remapEntry(oldAnimeId: string, replacement: AnimeResult): Promise<PersistedState> {
    if (!/^(?:aniwave|anidb):[a-z0-9-]+-\d+$/i.test(replacement.id)) throw new Error("Invalid replacement identifier");
    if (!replacement.title.trim() || replacement.title.length > 240) throw new Error("Invalid replacement title");
    const poster = normalizePoster(replacement.poster);
    const remap = (entry: LibraryEntry): LibraryEntry => entry.animeId === oldAnimeId
      ? { ...entry, animeId: replacement.id, title: replacement.title, updatedAt: new Date().toISOString(), ...(poster ? { poster } : {}) }
      : entry;
    this.state.bookmarks = this.state.bookmarks.map(remap);
    this.state.history = this.state.history.map(remap);
    await this.persist();
    return this.snapshot();
  }

  async linkSources(ids: string[]): Promise<PersistedState> {
    const unique = [...new Set(ids.filter((id) => /^(?:aniwave|anidb):/i.test(id)))];
    if (unique.length < 2) return this.snapshot();
    const links = this.state.providerLinks ?? [];
    const touching = links.filter((group) => group.some((id) => unique.includes(id)));
    const combined = [...new Set([...unique, ...touching.flat()])];
    this.state.providerLinks = [...links.filter((group) => !touching.includes(group)), combined];
    await this.persist();
    return this.snapshot();
  }

  async mergeEntries(firstAnimeId: string, secondAnimeId: string): Promise<PersistedState> {
    const all = [...this.state.bookmarks, ...this.state.history];
    const first = all.find((entry) => entry.animeId === firstAnimeId), second = all.find((entry) => entry.animeId === secondAnimeId);
    if (!first || !second) throw new Error("Duplicate entries were not found");
    const merged = combineEntries(first, second);
    const mergeList = (entries: LibraryEntry[]) => {
      const affected = entries.filter((entry) => overlaps(entry, first) || overlaps(entry, second));
      if (affected.length === 0) return entries;
      const firstIndex = entries.findIndex((entry) => affected.includes(entry));
      return entries.flatMap((entry, index) => index === firstIndex ? [merged] : affected.includes(entry) ? [] : [entry]);
    };
    await this.linkSources([...sourceIds(first), ...sourceIds(second)]);
    this.state.bookmarks = mergeList(this.state.bookmarks);
    this.state.history = mergeList(this.state.history);
    this.state.dismissedMergeKeys = [...new Set([...(this.state.dismissedMergeKeys ?? []), mergeKey(firstAnimeId, secondAnimeId)])];
    await this.persist();
    return this.snapshot();
  }

  async dismissMerge(firstAnimeId: string, secondAnimeId: string): Promise<PersistedState> {
    this.state.dismissedMergeKeys = [...new Set([...(this.state.dismissedMergeKeys ?? []), mergeKey(firstAnimeId, secondAnimeId)])];
    await this.persist();
    return this.snapshot();
  }

  private async persist(): Promise<void> {
    const serialized = `${JSON.stringify(this.state, null, 2)}\n`;
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.new`;
      await writeFile(temporary, serialized, "utf8");
      await rename(temporary, this.filePath);
    });
    await this.writeQueue;
  }
}

function normalizeSource(value: string, label: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error(`${label} source URL is invalid`); }
  if (!/^https?:$/.test(url.protocol)) throw new Error(`${label} source URL must use HTTP or HTTPS`);
  return url.toString().replace(/\/$/, "");
}
