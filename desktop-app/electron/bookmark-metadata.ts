import type { BookmarkMetadataProgress, PersistedState, ProviderName } from "../shared/contracts";
import { animeSources, enabledProviders, expandWithLinks } from "../shared/catalog";
import { availabilityFresh, qualityFresh } from "../shared/episode-metadata";
import { catalogContext, catalogRequests } from "./catalog-requests";
import { CatalogService } from "./catalog-service";
import { catalogScope } from "../shared/settings";
import { EpisodeMetadataCache } from "./episode-metadata-cache";
import { getAvailability, getStreams, providerOrigin } from "./scraper";

/** One manual, low-priority pass. Successful fields survive cancellation and partial failures. */
export class BookmarkMetadataFetcher {
  private active?: AbortController;
  private progress?: BookmarkMetadataProgress;
  constructor(private readonly catalog: CatalogService, private readonly cache: EpisodeMetadataCache) {}

  snapshot(): BookmarkMetadataProgress | undefined { return this.progress && structuredClone(this.progress); }

  start(state: PersistedState): BookmarkMetadataProgress {
    if (!this.active) void this.run(state, new AbortController().signal, () => {}).catch((error: unknown) => {
      if (this.progress) this.progress = { ...this.progress, state: "failed", error: error instanceof Error ? error.message : String(error) };
    });
    return this.snapshot()!;
  }

  cancel() {
    this.active?.abort();
    if (this.active && this.progress) this.progress = { ...this.progress, state: "cancelling" };
    return this.snapshot();
  }

  async run(state: PersistedState, parent: AbortSignal, update: (value: BookmarkMetadataProgress) => void): Promise<BookmarkMetadataProgress> {
    if (this.active) throw new Error("Bookmark metadata is already being fetched");
    const controller = new AbortController();
    this.active = controller;
    const signal = AbortSignal.any([parent, controller.signal]);
    const scope = catalogScope(state.settings), generation = this.cache.generation;
    const progress: BookmarkMetadataProgress = { state: "running", seriesTotal: state.bookmarks.length, seriesDone: 0,
      episodesDone: 0, cachedEpisodes: 0, updatedEpisodes: 0, failedEpisodes: 0, skippedSources: [] };
    const skipped = new Set<ProviderName>(), seen = new Set<string>();
    let lastUpdate = 0;
    const emit = (force = false) => {
      progress.skippedSources = [...skipped];
      this.progress = { ...progress, state: this.active?.signal.aborted ? "cancelling" : progress.state, skippedSources: [...skipped] };
      if (!force && Date.now() - lastUpdate < 100) return;
      lastUpdate = Date.now(); update({ ...progress, skippedSources: [...skipped] });
    };
    const check = () => {
      if (generation !== this.cache.generation) controller.abort();
      signal.throwIfAborted();
    };
    const config = () => {
      // A bulk run leaves recovery to interactive requests and explicit source checks.
      for (const provider of enabledProviders(state.settings)) {
        const health = catalogRequests.health.snapshot(providerOrigin(provider, state.settings));
        if (health.state === "paused" || health.state === "checking") skipped.add(provider);
      }
      return { ...state.settings, disabledSources: [...new Set([...(state.settings.disabledSources ?? []), ...skipped])] };
    };
    try {
      await catalogContext.run({ signal, priority: 4, scope }, async () => {
        emit();
        for (const entry of state.bookmarks) {
          check();
          progress.currentSeries = entry.title; emit(true);
          const sources = animeSources(entry);
          const linked = expandWithLinks({ id: entry.animeId, title: entry.title, poster: entry.poster, provider: sources[0].provider, sources }, state.providerLinks ?? []);
          const { anime } = await this.catalog.resolve(linked, config(), (value) => {
            for (const provider of Object.keys(value.errors) as ProviderName[]) skipped.add(provider);
          });
          check();
          const catalog = await this.catalog.episodes(anime, config());
          check();
          for (const group of catalog.groups) {
            if (group.error) { skipped.add(group.provider); continue; }
            for (const episode of group.episodes) {
              check();
              if (seen.has(episode.id)) continue;
              seen.add(episode.id);
              const cached = this.cache.get(scope, episode.id);
              let availability = cached?.availability;
              let changed = false, failed = false;
              const unavailable = () => !enabledProviders(config()).includes(group.provider);
              if (!availabilityFresh(availability)) {
                if (unavailable()) continue;
                try {
                  availability = await getAvailability(episode.id, state.settings);
                  check(); this.cache.recordAvailability(scope, episode.id, availability); changed = true;
                } catch {
                  check(); failed = true;
                  // An episode-specific failure can be retried next run; outages stop this source now.
                  config();
                }
              }
              if (!failed && availability) for (const mode of ["sub", "dub"] as const) {
                if (!availability[mode] || qualityFresh(cached?.qualities[mode])) continue;
                if (unavailable()) { failed = true; break; }
                try {
                  const streams = await getStreams(episode.id, mode, state.settings);
                  check(); this.cache.recordStreams(scope, episode.id, mode, streams); changed = true;
                } catch { check(); failed = true; config(); }
              }
              progress.episodesDone++;
              if (failed) progress.failedEpisodes++;
              else if (changed) progress.updatedEpisodes++;
              else progress.cachedEpisodes++;
              emit();
            }
          }
          progress.seriesDone++; emit();
        }
        check(); progress.state = "completed";
      });
    } catch (error) {
      progress.state = signal.aborted ? "cancelled" : "failed";
      if (!signal.aborted) progress.error = error instanceof Error ? error.message : String(error);
    } finally {
      await this.cache.flush();
      this.active = undefined;
    }
    progress.currentSeries = undefined; emit(true);
    return progress;
  }
}
