import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AnimeResult, LibraryEntry, PersistedState, Settings } from "../shared/contracts";

const defaults: PersistedState = {
  bookmarks: [],
  history: [],
  settings: {
    playerPath: process.platform === "win32" ? "mpv.exe" : "mpv",
    preferredQuality: "best",
    preferredMode: "sub",
    preferredProvider: "auto",
    aniwaveBaseUrl: "https://aniwaves.ru",
    anidbBaseUrl: "https://anidb.app"
  }
};

function normalizeEntry(entry: LibraryEntry): LibraryEntry {
  if (!/^(?:(?:aniwave|anidb):)?[a-z0-9-]+-\d+$/i.test(entry.animeId)) throw new Error("Invalid anime identifier");
  if (!entry.title.trim() || entry.title.length > 240) throw new Error("Invalid anime title");
  if (!/^\d+(?:\.\d+)?$/.test(entry.lastEpisode)) throw new Error("Invalid episode number");
  return { ...entry, title: entry.title.trim(), updatedAt: new Date().toISOString() };
}

export class StateStore {
  private state: PersistedState = structuredClone(defaults);
  private writeQueue = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<PersistedState>;
      this.state = {
        bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
        history: Array.isArray(parsed.history) ? parsed.history : [],
        settings: { ...defaults.settings, ...(parsed.settings ?? {}) }
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
    this.state.settings = {
      playerPath: settings.playerPath.trim(),
      preferredQuality: settings.preferredQuality.trim() || "best",
      preferredMode: settings.preferredMode,
      preferredProvider: settings.preferredProvider,
      aniwaveBaseUrl: normalizeSource(settings.aniwaveBaseUrl, "AniWave"),
      anidbBaseUrl: normalizeSource(settings.anidbBaseUrl, "AniDB")
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

  async recordHistory(rawEntry: LibraryEntry): Promise<PersistedState> {
    const entry = normalizeEntry(rawEntry);
    this.state.history = [entry, ...this.state.history.filter((item) => item.animeId !== entry.animeId)].slice(0, 100);
    const bookmarkIndex = this.state.bookmarks.findIndex((item) => item.animeId === entry.animeId);
    if (bookmarkIndex >= 0) this.state.bookmarks[bookmarkIndex] = entry;
    await this.persist();
    return this.snapshot();
  }

  async remapEntry(oldAnimeId: string, replacement: AnimeResult): Promise<PersistedState> {
    if (!/^(?:aniwave|anidb):[a-z0-9-]+-\d+$/i.test(replacement.id)) throw new Error("Invalid replacement identifier");
    if (!replacement.title.trim() || replacement.title.length > 240) throw new Error("Invalid replacement title");
    const remap = (entry: LibraryEntry): LibraryEntry => entry.animeId === oldAnimeId ? { ...entry, animeId: replacement.id, title: replacement.title, updatedAt: new Date().toISOString() } : entry;
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
