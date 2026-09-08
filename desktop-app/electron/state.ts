import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AnimeResult, CustomTheme, LibraryEntry, PersistedState, Settings } from "../shared/contracts";
import { THEME_PRESETS, isHexColor, isThemePreset } from "../shared/theme";

const defaults: PersistedState = {
  bookmarks: [],
  history: [],
  settings: {
    playerPath: process.platform === "win32" ? "mpv.exe" : "mpv",
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

function normalizeEntry(entry: LibraryEntry): LibraryEntry {
  if (!/^(?:(?:aniwave|anidb):)?[a-z0-9-]+-\d+$/i.test(entry.animeId)) throw new Error("Invalid anime identifier");
  if (!entry.title.trim() || entry.title.length > 240) throw new Error("Invalid anime title");
  if (!/^\d+(?:\.\d+)?$/.test(entry.lastEpisode)) throw new Error("Invalid episode number");
  const poster = normalizePoster(entry.poster);
  return { animeId: entry.animeId, title: entry.title.trim(), lastEpisode: entry.lastEpisode, mode: entry.mode === "dub" ? "dub" : "sub", updatedAt: new Date().toISOString(), ...(poster ? { poster } : {}) };
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
        bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
        history: Array.isArray(parsed.history) ? parsed.history : [],
        settings: {
          ...settings,
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

  async saveSettings(settings: Settings): Promise<PersistedState> {
    if (!settings.playerPath.trim()) throw new Error("Player path cannot be empty");
    if (!isThemePreset(settings.theme)) throw new Error("Unknown theme");
    const custom = settings.customTheme ?? {};
    for (const key of ["background", "text", "highlight"] as const) {
      if (!isHexColor(custom[key])) throw new Error(`Custom ${key} colour must be a hex value like #1F2023`);
    }
    this.state.settings = {
      playerPath: settings.playerPath.trim(),
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
    const existing = this.state.bookmarks.findIndex((item) => item.animeId === entry.animeId);
    if (existing >= 0) this.state.bookmarks.splice(existing, 1);
    else this.state.bookmarks.unshift(entry);
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
    const bookmarkIndex = this.state.bookmarks.findIndex((item) => item.animeId === entry.animeId);
    const known = entry.poster ?? this.state.history.find((item) => item.animeId === entry.animeId)?.poster ?? this.state.bookmarks[bookmarkIndex]?.poster;
    const merged = known ? { ...entry, poster: known } : entry;
    this.state.history = [merged, ...this.state.history.filter((item) => item.animeId !== entry.animeId)].slice(0, 100);
    if (bookmarkIndex >= 0) this.state.bookmarks[bookmarkIndex] = merged;
    await this.persist();
    return this.snapshot();
  }

  async removeHistory(animeId: string): Promise<PersistedState> {
    this.state.history = this.state.history.filter((item) => item.animeId !== animeId);
    await this.persist();
    return this.snapshot();
  }

  async clearHistory(): Promise<PersistedState> {
    this.state.history = [];
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

  private async persist(): Promise<void> {
    const serialized = `${JSON.stringify(this.state, null, 2)}\n`;
    this.writeQueue = this.writeQueue.then(async () => {
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
