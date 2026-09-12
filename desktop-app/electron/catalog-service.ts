import type { AnimeResult, CatalogProgress, Episode, EpisodeCatalog, EpisodeGroup, ProviderName, ProviderPreference } from "../shared/contracts";
import { animeSources, enabledProviders, unifyAnimeResults } from "../shared/catalog";
import { catalogContext } from "./catalog-requests";
import { getProviderEpisodes, resolveSource, searchOne, type SourceConfig } from "./scraper";

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const scope = (config: SourceConfig) => JSON.stringify([config.aniwaveBaseUrl, config.anidbBaseUrl, config.hianimeBaseUrl]);
export const catalogScope = scope;

export class CatalogService {
  private episodesCache = new Map<string, { episodes: Episode[]; at: number }>();

  async search(query: string, config: SourceConfig, provider: ProviderPreference = "auto", links: string[][] = [], update?: (value: CatalogProgress<AnimeResult[]>) => void) {
    const cleaned = query.trim();
    if (!cleaned) return [];
    if (cleaned.length > 120) throw new Error("Search query is too long");
    // A preferred provider that has since been switched off falls back to every enabled one.
    const enabled = enabledProviders(config);
    const providers = provider !== "auto" && enabled.includes(provider) ? [provider] : enabled;
    const pending = new Set(providers);
    const results = new Map<ProviderName, AnimeResult[]>();
    const errors: Partial<Record<ProviderName, string>> = {};
    const combined = () => unifyAnimeResults(providers.flatMap((name) => results.get(name) ?? []), links);
    await Promise.all(providers.map(async (name) => {
      try { results.set(name, await searchOne(cleaned, name, config)); }
      catch (error) { errors[name] = message(error); }
      finally { pending.delete(name); update?.({ value: combined(), pending: [...pending], errors: { ...errors } }); }
    }));
    catalogContext.getStore()?.signal.throwIfAborted();
    if (!results.size) throw new Error(`All providers failed: ${Object.values(errors).join("; ")}`);
    return combined();
  }

  async episodes(anime: AnimeResult, config: SourceConfig, update?: (value: EpisodeCatalog) => void): Promise<EpisodeCatalog> {
    const enabled = enabledProviders(config);
    const sources = animeSources(anime).filter((source, index, all) => enabled.includes(source.provider) && all.findIndex((other) => other.provider === source.provider) === index);
    const groups = new Map<ProviderName, EpisodeGroup>();
    const snapshot = () => ({ groups: sources.flatMap((source) => groups.has(source.provider) ? [groups.get(source.provider)!] : []) });
    for (const source of sources) {
      const cached = this.episodesCache.get(`${scope(config)}:${source.id}`);
      if (cached && Date.now() - cached.at < 30 * 60_000) groups.set(source.provider, { provider: source.provider, episodes: cached.episodes, refreshing: true });
    }
    if (groups.size) update?.(snapshot());
    await Promise.all(sources.map(async (source) => {
      try {
        const episodes = await getProviderEpisodes(source.id, config);
        catalogContext.getStore()?.signal.throwIfAborted();
        const key = `${scope(config)}:${source.id}`;
        this.episodesCache.delete(key); this.episodesCache.set(key, { episodes, at: Date.now() });
        if (this.episodesCache.size > 200) this.episodesCache.delete(this.episodesCache.keys().next().value!);
        groups.set(source.provider, { provider: source.provider, episodes });
      } catch (error) {
        groups.set(source.provider, { provider: source.provider, episodes: groups.get(source.provider)?.episodes ?? [], error: message(error) });
      }
      update?.(snapshot());
    }));
    catalogContext.getStore()?.signal.throwIfAborted();
    return snapshot();
  }

  async resolve(anime: AnimeResult, config: SourceConfig, update?: (value: CatalogProgress<AnimeResult>) => void) {
    const known = animeSources(anime);
    const pending = new Set(enabledProviders(config).filter((provider) => !known.some((source) => source.provider === provider)));
    const sources = [...known];
    const confirmed: string[] = [];
    const errors: Partial<Record<ProviderName, string>> = {};
    const snapshot = (): AnimeResult => ({ ...anime, sources: [...sources] });
    // Also deliver remembered links immediately, before any missing-provider lookup.
    update?.({ value: snapshot(), pending: [...pending], errors: {} });
    await Promise.all([...pending].map(async (provider) => {
      try {
        const match = await resolveSource(anime, provider, config);
        if (match) {
          const added = animeSources(match.hit);
          sources.push(...added);
          if (match.exact) confirmed.push(...added.map((source) => source.id));
        }
      } catch (error) { errors[provider] = message(error); }
      finally { pending.delete(provider); update?.({ value: snapshot(), pending: [...pending], errors: { ...errors } }); }
    }));
    catalogContext.getStore()?.signal.throwIfAborted();
    return { anime: snapshot(), confirmed };
  }
}
