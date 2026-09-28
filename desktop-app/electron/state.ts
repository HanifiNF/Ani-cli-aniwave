import { DEFAULT_STATE } from "../shared/settings";
import { normalizeCompanionPreferences } from "../shared/companion";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { MINI_PLAYER_CORNERS, clampMiniPlayerWidth, type AnimeResult, type AnimeSource, type CustomTheme, type LibraryEntry, type MiniPlayerCorner, type PersistedState, type ProviderName, type Settings, type PlayRequest, type Work } from "../shared/contracts";
import { playbackKey, validateStorageUpdate } from "../shared/playback";
import { PROVIDER_NAMES, providerFromId, animeSources, isProviderName, mergeKey, overlaps, sourceIds } from "../shared/catalog";
import { isRef, mediaTypeOf, positiveInteger, unique, yearOf } from "../shared/identity";

const WORK_LIMIT = 5000;
const newWorkId = () => `work:${randomBytes(8).toString("hex")}`;

import { isHexColor, isThemePreset } from "../shared/theme";
import { normalizeSubtitleAppearance, validateSubtitleAppearance } from "../shared/subtitle-appearance";
import type { SubtitleAppearance } from "../shared/contracts";
import { normalizeSubtitleLanguage } from "../shared/subtitle-language";

/** Bindings that should become or extend a remembered work. */
export interface Binding { ids: string[]; refs?: string[]; title?: string; sources?: AnimeSource[]; tentative?: boolean; type?: unknown; year?: unknown; episodes?: unknown; poster?: unknown; }

function normalizePoster(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

const normalizeDisabledSources = (value: unknown): ProviderName[] => Array.isArray(value) ? PROVIDER_NAMES.filter((provider) => value.includes(provider)) : [];
const normalizeCorner = (value: unknown): MiniPlayerCorner => (MINI_PLAYER_CORNERS as readonly unknown[]).includes(value) ? value as MiniPlayerCorner : "bottom-right";

const HIANIME_SLUG = "[\\p{L}\\p{N}:!'().,_+~-]+(?:-[\\p{L}\\p{N}:!'().,_+~-]+)*";
const isProviderId = (id: unknown): id is string => typeof id === "string" && (
  id.length <= 512 && (/^(?:aniwave|anidb):[a-z0-9-]+-\d+$/i.test(id) || new RegExp(`^hianime:${HIANIME_SLUG}$`, "u").test(id))
);

function normalizeWork(value: unknown): Work | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || !/^work:[0-9a-f]{16}$/.test(raw.id) || typeof raw.title !== "string" || raw.title.length > 240) return undefined;
  const records = Array.isArray(raw.records) ? unique(raw.records.filter(isProviderId)) : [];
  const refs = Array.isArray(raw.refs) ? unique(raw.refs.filter(isRef)) : [];
  if (!records.length && !refs.length) return undefined;
  const type = mediaTypeOf(raw.type), year = yearOf(raw.year), episodes = positiveInteger(raw.episodes), poster = normalizePoster(raw.poster);
  return { id: raw.id, title: raw.title, records, refs, updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date(0).toISOString(),
    ...(type ? { type } : {}), ...(year ? { year } : {}), ...(episodes ? { episodes } : {}), ...(raw.tentative === true ? { tentative: true } : {}), ...(poster ? { poster } : {}) };
}

export function normalizeEntry(entry: LibraryEntry): LibraryEntry {
  if (!isProviderId(entry.animeId) && !/^[a-z0-9-]+-\d+$/i.test(entry.animeId)) throw new Error("Invalid anime identifier");
  if (!entry.title.trim() || entry.title.length > 240) throw new Error("Invalid anime title");
  if (!/^\d+(?:\.\d+)?$/.test(entry.lastEpisode)) throw new Error("Invalid episode number");
  const poster = normalizePoster(entry.poster);
  const sources = animeSources(entry).map((source) => {
    if (!isProviderId(source.id) || source.provider !== providerFromId(source.id)) throw new Error("Invalid source identifier");
    return { ...source, aliases: [...new Set([source.title, ...(source.aliases ?? [])])], poster: normalizePoster(source.poster) };
  });
  const lastProvider = entry.lastProvider && sources.some((source) => source.provider === entry.lastProvider) ? entry.lastProvider : sources[0].provider;
  const updatedAt = new Date().toISOString();
  const completed = entry.completed !== false;
  const progressByProvider = { ...entry.progressByProvider };
  progressByProvider[lastProvider] = {
    ...(progressByProvider[lastProvider] ?? { lastEpisode: entry.lastEpisode, mode: entry.mode === "dub" ? "dub" : "sub", updatedAt }),
    ...(entry.completed !== undefined ? { completed } : {})
  };
  for (const [name, raw] of Object.entries(progressByProvider)) {
    if (!raw) continue;
    const progress = { ...raw };
    if (typeof progress.lastEpisodeId !== "string" || progress.lastEpisodeId.length > 512 || !progress.lastEpisodeId.startsWith(`${name}:`)) delete progress.lastEpisodeId;
    progressByProvider[name as ProviderName] = progress;
  }
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
  const primary = sources.find((source) => source.provider === "aniwave") ?? sources.find((source) => source.provider === "anidb") ?? sources[0];
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
  const fallback = DEFAULT_STATE.settings.customTheme;
  return {
    background: isHexColor(record.background) ? record.background : fallback.background,
    text: isHexColor(record.text) ? record.text : fallback.text,
    highlight: isHexColor(record.highlight) ? record.highlight : fallback.highlight
  };
}

export class StateStore {
  private state: PersistedState = structuredClone(DEFAULT_STATE);
  private writeQueue = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<PersistedState>;
      const settings = { ...DEFAULT_STATE.settings, ...(parsed.settings ?? {}) };
      const works = Array.isArray(parsed.works) ? parsed.works.map(normalizeWork).filter((work): work is Work => Boolean(work)) : [];
      // Older files remembered provider links as bare id groups; each becomes a work without references.
      if (!Array.isArray(parsed.works) && Array.isArray(parsed.providerLinks)) {
        for (const group of parsed.providerLinks) {
          if (!Array.isArray(group)) continue;
          const records = unique(group.filter(isProviderId));
          if (records.length < 2) continue;
          const entry = [...(Array.isArray(parsed.history) ? parsed.history : []), ...(Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [])]
            .find((item) => item && typeof item === "object" && records.includes((item as LibraryEntry).animeId));
          works.push({ id: newWorkId(), title: (entry as LibraryEntry | undefined)?.title ?? records[0], refs: [], records, updatedAt: new Date(0).toISOString() });
        }
      }
      this.state = {
        bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks.map(migrateEntry) : [],
        history: Array.isArray(parsed.history) ? parsed.history.map(migrateEntry) : [],
        works,
        dismissedMergeKeys: Array.isArray(parsed.dismissedMergeKeys) ? parsed.dismissedMergeKeys : [],
        playerPreferences: parsed.playerPreferences ? validateStorageUpdate(parsed.playerPreferences) : {},
        subtitleAppearance: normalizeSubtitleAppearance(parsed.subtitleAppearance),
        playbackPositions: parsed.playbackPositions ?? {},
        settings: {
          ...settings,
          ...normalizeCompanionPreferences(settings),
          playbackTarget: settings.playbackTarget === "external" ? "external" : "builtin",
          startPlayerFullscreen: typeof settings.startPlayerFullscreen === "boolean" ? settings.startPlayerFullscreen : true,
          autoplayNext: settings.autoplayNext !== false,
          miniPlayerCorner: normalizeCorner(settings.miniPlayerCorner),
          miniPlayerWidth: clampMiniPlayerWidth(settings.miniPlayerWidth),
          playerDiagnostics: settings.playerDiagnostics === true,
          desktopEpisodeNotifications: settings.desktopEpisodeNotifications !== false,
          disabledSources: normalizeDisabledSources(settings.disabledSources),
          animeInfo: settings.animeInfo !== false,
          offlineIndex: settings.offlineIndex === true,
          emptyBackdrop: settings.emptyBackdrop !== false,
          theme: isThemePreset(settings.theme) ? settings.theme : "graphite",
          customTheme: normalizeTheme(settings.customTheme)
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  /** The persisted state plus provider links derived from works, for code that still groups by id lists. */
  snapshot(): PersistedState {
    const state = structuredClone(this.state);
    state.providerLinks = (state.works ?? []).filter((work) => work.records.length > 1).map((work) => work.records);
    return state;
  }

  async saveSubtitleAppearance(value: unknown): Promise<SubtitleAppearance> {
    const appearance = validateSubtitleAppearance(value);
    this.state.subtitleAppearance = appearance;
    await this.persist();
    return appearance;
  }

  /** The work a provider record is bound to, if any. */
  workOf(recordId: string): Work | undefined {
    return (this.state.works ?? []).find((work) => work.records.includes(recordId));
  }

  /** The anime with every record and reference its remembered work knows, for lookups and information requests. */
  withWork(anime: AnimeResult): AnimeResult {
    const sources = animeSources(anime);
    const works = (this.state.works ?? []).filter((work) => sources.some((source) => work.records.includes(source.id)) || (anime.refs ?? []).some((value) => work.refs.includes(value)));
    if (!works.length) return anime;
    const refs = unique([...(anime.refs ?? []), ...sources.flatMap((source) => source.refs ?? []), ...works.flatMap((work) => work.refs)]);
    const merged = [...sources];
    for (const id of works.flatMap((work) => work.records)) {
      if (merged.some((source) => source.id === id)) continue;
      const provider = providerFromId(id);
      if (!merged.some((source) => source.provider === provider)) merged.push({ id, provider, title: anime.title, aliases: [anime.title] });
    }
    return { ...anime, sources: merged, workId: works[0].id, ...(refs.length ? { refs } : {}) };
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
    if (!["auto", "aniwave", "anidb", "hianime"].includes(settings.preferredProvider)) throw new Error("Unknown source provider");
    const disabledSources = normalizeDisabledSources(settings.disabledSources);
    if (disabledSources.length >= PROVIDER_NAMES.length) throw new Error("At least one source must stay on");
    const custom = settings.customTheme ?? {};
    for (const key of ["background", "text", "highlight"] as const) {
      if (!isHexColor(custom[key])) throw new Error(`Custom ${key} colour must be a hex value like #1F2023`);
    }
    this.state.settings = {
      ...normalizeCompanionPreferences(settings),
      playerPath: settings.playerPath.trim(),
      playbackTarget: settings.playbackTarget,
      startPlayerFullscreen: Boolean(settings.startPlayerFullscreen),
      autoplayNext: settings.autoplayNext !== false,
      miniPlayerCorner: normalizeCorner(settings.miniPlayerCorner),
      miniPlayerWidth: clampMiniPlayerWidth(settings.miniPlayerWidth),
      playerDiagnostics: settings.playerDiagnostics === true,
      desktopEpisodeNotifications: settings.desktopEpisodeNotifications !== false,
      preferredQuality: settings.preferredQuality.trim() || "best",
      preferredMode: settings.preferredMode === "dub" ? "dub" : "sub",
      // A preferred source that is switched off would search nothing, so it falls back to auto.
      preferredProvider: isProviderName(settings.preferredProvider) && disabledSources.includes(settings.preferredProvider) ? "auto" : settings.preferredProvider,
      subtitleLanguage: normalizeSubtitleLanguage(settings.subtitleLanguage),
      disabledSources,
      animeInfo: settings.animeInfo !== false,
      offlineIndex: settings.offlineIndex === true,
      emptyBackdrop: settings.emptyBackdrop !== false,
      aniwaveBaseUrl: normalizeSource(settings.aniwaveBaseUrl, "AniWave"),
      anidbBaseUrl: normalizeSource(settings.anidbBaseUrl, "AniDB"),
      hianimeBaseUrl: normalizeSource(settings.hianimeBaseUrl, "HiAnime"),
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
    // Combining keeps sources gathered earlier, whether the anime sits in history or only among bookmarks.
    if (historyEntry) merged = combineEntries(historyEntry, merged);
    else if (bookmarkIndex >= 0) merged = combineEntries(this.state.bookmarks[bookmarkIndex], merged);
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

  async clearSourceLinks(): Promise<PersistedState> {
    this.state.works = [];
    await this.persist();
    return this.snapshot();
  }

  async linkSources(ids: string[], sources: AnimeSource[] = []): Promise<PersistedState> {
    return this.bindWork({ ids, sources });
  }

  /** Remember that these records, and these references, name one anime. A manual or referenced binding is never tentative. */
  async bindWork(binding: Binding): Promise<PersistedState> {
    if (this.applyBinding(binding)) await this.persist();
    return this.snapshot();
  }

  /** Remember every confident grouping in a set of search rows at once. */
  async recordBindings(rows: AnimeResult[]): Promise<boolean> {
    let changed = false;
    for (const row of rows) {
      if (row.tentative) continue;
      const sources = animeSources(row);
      const refs = unique([...(row.refs ?? []), ...sources.flatMap((source) => source.refs ?? [])]);
      if (sources.length < 2 && !refs.length) continue;
      changed = this.applyBinding({ ids: sources.map((source) => source.id), refs, title: row.title, sources, poster: row.poster }) || changed;
    }
    if (changed) await this.persist();
    return changed;
  }

  private applyBinding(binding: Binding): boolean {
    const ids = unique(binding.ids.filter(isProviderId));
    const refs = unique((binding.refs ?? []).filter(isRef));
    if (ids.length < 2 && !refs.length) return false;
    const works = this.state.works ?? [];
    const touching = works.filter((work) => work.records.some((id) => ids.includes(id)) || work.refs.some((value) => refs.includes(value)));
    const records = unique([...touching.flatMap((work) => work.records), ...ids]);
    const combinedRefs = unique([...touching.flatMap((work) => work.refs), ...refs]);
    // The site's latest cover replaces an older one: it is what search shows for the title now.
    const bound = binding.sources?.filter((source) => ids.includes(source.id)) ?? [];
    const found = normalizePoster(binding.poster) ?? normalizePoster((bound.find((source) => source.provider === "aniwave" && source.poster) ?? bound.find((source) => source.poster))?.poster);
    const poster = found ?? touching.find((work) => work.poster)?.poster;
    const unchanged = touching.length === 1 && touching[0].records.length === records.length && touching[0].refs.length === combinedRefs.length
      && (!touching[0].tentative || binding.tentative === true) && touching[0].poster === poster;
    if (unchanged) return false;
    const title = binding.title?.trim() || touching[0]?.title || binding.sources?.find((source) => ids.includes(source.id))?.title || ids[0];
    const type = mediaTypeOf(binding.type) ?? touching.find((work) => work.type)?.type;
    const year = yearOf(binding.year) ?? touching.find((work) => work.year)?.year;
    const episodes = positiveInteger(binding.episodes) ?? touching.find((work) => work.episodes)?.episodes;
    const tentative = binding.tentative === true && !combinedRefs.length && touching.every((work) => work.tentative);
    const work: Work = { id: touching[0]?.id ?? newWorkId(), title: title.slice(0, 240), refs: combinedRefs, records, updatedAt: new Date().toISOString(),
      ...(type ? { type } : {}), ...(year ? { year } : {}), ...(episodes ? { episodes } : {}), ...(tentative ? { tentative: true } : {}), ...(poster ? { poster } : {}) };
    this.state.works = [...works.filter((item) => !touching.includes(item)), work];
    this.trimWorks();
    // Library entries for this anime learn the bound records too, so opening them later starts with every source.
    const attach = (entry: LibraryEntry): LibraryEntry => {
      const known = animeSources(entry);
      if (!known.some((source) => records.includes(source.id))) return entry;
      const merged = [...known];
      for (const id of records) {
        if (merged.some((source) => source.id === id)) continue;
        const source = binding.sources?.find((item) => item.id === id) ?? { id, provider: providerFromId(id), title: entry.title, aliases: [entry.title] };
        if (!merged.some((item) => item.provider === source.provider)) merged.push(source);
      }
      return merged.length > known.length ? { ...entry, sources: merged } : entry;
    };
    this.state.bookmarks = this.state.bookmarks.map(attach);
    this.state.history = this.state.history.map(attach);
    return true;
  }

  /** Keep the works table bounded; works the library refers to are never dropped. */
  private trimWorks(): void {
    const works = this.state.works ?? [];
    if (works.length <= WORK_LIMIT) return;
    const kept = new Set([...this.state.bookmarks, ...this.state.history].flatMap((entry) => sourceIds(entry)));
    const disposable = works.filter((work) => !work.records.some((id) => kept.has(id))).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    const drop = new Set(disposable.slice(0, works.length - WORK_LIMIT));
    this.state.works = works.filter((work) => !drop.has(work));
  }

  /** Take one record out of its work. The pair is remembered as split so search does not group it again by title. */
  async splitSource(sourceId: string): Promise<PersistedState> {
    if (!isProviderId(sourceId)) throw new Error("Invalid source identifier");
    const works = this.state.works ?? [];
    const work = works.find((item) => item.records.includes(sourceId));
    if (!work) return this.snapshot();
    const others = work.records.filter((id) => id !== sourceId);
    const remaining: Work = { ...work, records: others, updatedAt: new Date().toISOString() };
    this.state.works = [...works.filter((item) => item !== work), ...(others.length || remaining.refs.length ? [remaining] : [])];
    this.state.dismissedMergeKeys = unique([...(this.state.dismissedMergeKeys ?? []), ...others.map((id) => mergeKey(sourceId, id))]);
    const detach = (entry: LibraryEntry): LibraryEntry => {
      const known = animeSources(entry);
      if (!known.some((source) => source.id === sourceId) || known.length < 2) return entry;
      const sources = entry.animeId === sourceId ? known.filter((source) => !others.includes(source.id)) : known.filter((source) => source.id !== sourceId);
      return sources.length && sources.length < known.length ? { ...entry, sources } : entry;
    };
    this.state.bookmarks = this.state.bookmarks.map(detach);
    this.state.history = this.state.history.map(detach);
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

  async flush(): Promise<void> { await this.writeQueue; }

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
