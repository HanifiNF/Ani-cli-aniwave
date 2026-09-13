import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CachedEpisodeMetadata, EpisodeAvailability, TranslationMode } from "../shared/contracts";
import { bestQuality, METADATA_LIMIT, METADATA_RETENTION } from "../shared/episode-metadata";

/** Disposable derived metadata. Playback URLs and provider response bodies stay in memory. */
export class EpisodeMetadataCache {
  private entries = new Map<string, CachedEpisodeMetadata>();
  private timer?: ReturnType<typeof setTimeout>;
  private writes = Promise.resolve();
  private dirty = false;
  // Invalidating a series also fences off results from requests already in flight.
  generation = 0;

  constructor(private readonly path: string, private readonly now = Date.now) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8"));
      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return;
      for (const row of parsed.entries.slice(-METADATA_LIMIT)) {
        if (!Array.isArray(row) || typeof row[0] !== "string" || row[0].length > 8192) continue;
        const value = this.normalize(row[1]);
        if (value) this.entries.set(row[0], value);
      }
    } catch {
      // A missing or damaged cache can always be rebuilt from the providers.
    }
  }

  get(scope: string, id: string): CachedEpisodeMetadata | undefined {
    const key = JSON.stringify([scope, id]);
    const value = this.normalize(this.entries.get(key));
    if (!value) { this.entries.delete(key); return; }
    this.entries.delete(key); this.entries.set(key, value);
    return structuredClone(value);
  }

  recordAvailability(scope: string, id: string, availability: EpisodeAvailability): void {
    const value = this.get(scope, id) ?? { qualities: {} };
    value.availability = availability;
    for (const mode of ["sub", "dub"] as const) if (!availability[mode]) delete value.qualities[mode];
    this.put(scope, id, value);
  }

  recordStreams(scope: string, id: string, mode: TranslationMode, streams: { quality: string }[]): void {
    const value = this.get(scope, id) ?? { qualities: {} };
    value.qualities[mode] = { quality: bestQuality(streams), checkedAt: this.now() };
    this.put(scope, id, value);
  }

  async clear(scope: string, ids: string[]): Promise<void> {
    this.generation++;
    for (const id of ids) this.entries.delete(JSON.stringify([scope, id]));
    this.dirty = true;
    await this.flush();
  }

  private put(scope: string, id: string, value: CachedEpisodeMetadata): void {
    const normalized = this.normalize(value);
    if (!normalized) return;
    const key = JSON.stringify([scope, id]);
    this.entries.delete(key); this.entries.set(key, normalized);
    while (this.entries.size > METADATA_LIMIT) this.entries.delete(this.entries.keys().next().value!);
    this.dirty = true;
    if (!this.timer) this.timer = setTimeout(() => { void this.flush(); }, 250);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (this.dirty) {
      this.dirty = false;
      const serialized = JSON.stringify({ version: 1, entries: [...this.entries] });
      this.writes = this.writes.then(async () => {
        await mkdir(dirname(this.path), { recursive: true });
        await writeFile(`${this.path}.new`, serialized, "utf8");
        await rename(`${this.path}.new`, this.path);
      }).catch(() => { this.dirty = true; });
    }
    await this.writes;
  }

  private normalize(raw: unknown): CachedEpisodeMetadata | undefined {
    if (!raw || typeof raw !== "object") return;
    const input = raw as CachedEpisodeMetadata, now = this.now();
    const validTime = (at: unknown): at is number => typeof at === "number" && Number.isFinite(at) && at <= now && now - at < METADATA_RETENTION;
    const value: CachedEpisodeMetadata = { qualities: {} };
    const audio = input.availability;
    if (audio && typeof audio.sub === "boolean" && typeof audio.dub === "boolean" && validTime(audio.checkedAt)) {
      value.availability = { sub: audio.sub, dub: audio.dub, checkedAt: audio.checkedAt };
    }
    for (const mode of ["sub", "dub"] as const) {
      const quality = input.qualities?.[mode];
      if (quality && validTime(quality.checkedAt) && (quality.quality === undefined || (typeof quality.quality === "string" && quality.quality.length <= 64))) {
        value.qualities[mode] = { quality: quality.quality, checkedAt: quality.checkedAt };
      }
    }
    return value.availability || Object.keys(value.qualities).length ? value : undefined;
  }
}
