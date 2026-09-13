import { catalogContext, catalogRequests, CatalogNetworkError } from "./catalog-requests";
import type { AnimeResult, Episode, EpisodeAvailability, ProviderName, Settings, Stream, TranslationMode } from "../shared/contracts";
import { animeSources, sourceMatch } from "../shared/catalog";
import { findEmbedUrl, hiAnimeEmbedUrls, parseAniwaveEpisodes, parseAniwaveSearch, parseAniwaveVidplayId, parseEpisodes, parseHiAnimeEmbed, parseHiAnimeEpisodes, parseHiAnimeSearch, parseMasterPlaylist, parseMasterUrl, parseResultUrl, parseSearchPage, parseVidplaySource } from "./parsers";

const RETRY_DELAY_MS = 750;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
export type SourceConfig = Pick<Settings, "preferredProvider" | "aniwaveBaseUrl" | "anidbBaseUrl" | "hianimeBaseUrl" | "disabledSources">;
const HIANIME_API_BASE = "https://animehot.cc/api";
export function providerOrigin(provider: ProviderName, config: SourceConfig): string {
  return new URL(provider === "hianime" ? HIANIME_API_BASE : provider === "aniwave" ? config.aniwaveBaseUrl : config.anidbBaseUrl).origin;
}

function sourceBase(value: string): string {
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Source URLs must use HTTP or HTTPS");
  return url.toString().replace(/\/$/, "");
}
function absolute(value: string, relativeTo: string): string {
  const url = new URL(value, relativeTo);
  if (!/^https?:$/.test(url.protocol)) throw new Error("Unsupported source URL");
  return url.toString();
}
export function retryAfterDelay(value: string | null, now = Date.now()): number {
  if (!value?.trim()) return 0;
  const clean = value.trim();
  const delay = /^\d+$/.test(clean) ? Number(clean) * 1000 : Date.parse(clean) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}

async function responseBody(url: string, label: string, accept: string, referrer?: string, body?: unknown): Promise<string> {
  const context = catalogContext.getStore();
  const execute = async (signal?: AbortSignal, recovery = false) => {
    const attempts = recovery ? 1 : 2;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      signal?.throwIfAborted();
      if (attempt > 0) await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal?.reason); };
        const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, RETRY_DELAY_MS);
        signal?.addEventListener("abort", abort, { once: true });
      });
      try {
        const response = await fetch(url, {
          method: body === undefined ? "GET" : "POST",
          headers: { "User-Agent": USER_AGENT, Accept: accept, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(referrer ? { Referer: referrer } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000)
        });
        if (response.ok) return await response.text();
        await response.body?.cancel();
        if (response.status !== 429 && response.status < 500) throw new Error(`${label} failed (${response.status})`);
        const retryAfter = retryAfterDelay(response.headers.get("retry-after"));
        if (response.status === 429 || retryAfter > 0 || attempt === attempts - 1) throw new CatalogNetworkError(`${label} failed (${response.status})`, retryAfter);
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        if (error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError")) throw new CatalogNetworkError(`${label}: ${error.message}`);
        throw error;
      }
    }
    throw new Error(`${label} failed`);
  };
  if (!context) return execute();
  const ttl = /search|server lookup|stream lookup/.test(label) ? 60_000 : /episode lookup/.test(label) ? 30_000 : 20_000;
  return catalogRequests.read(JSON.stringify([url, accept, referrer, body]), new URL(url).origin, ttl, execute, context);
}
const fetchText = (url: string, label: string, referrer?: string) => responseBody(url, label, "text/html,application/json;q=0.9,*/*;q=0.8", referrer);
const fetchJson = async (url: string, label: string, referrer?: string): Promise<unknown> => JSON.parse(await responseBody(url, label, "application/json", referrer));
const postJson = async (url: string, body: unknown, label: string, referrer?: string): Promise<unknown> => JSON.parse(await responseBody(url, label, "application/json", referrer, body));

function splitId(id: string): { provider: ProviderName; value: string } {
  if (id.startsWith("aniwave:")) return { provider: "aniwave", value: id.slice(8) };
  if (id.startsWith("anidb:")) return { provider: "anidb", value: id.slice(6) };
  if (id.startsWith("hianime:")) return { provider: "hianime", value: id.slice(8) };
  return { provider: "anidb", value: id };
}

export async function searchOne(query: string, provider: ProviderName, config: SourceConfig): Promise<AnimeResult[]> {
  if (provider === "aniwave") {
    const root = sourceBase(config.aniwaveBaseUrl);
    return parseAniwaveSearch(await fetchText(`${root}/filter?keyword=${encodeURIComponent(query)}`, "AniWave search", `${root}/`));
  }
  if (provider === "hianime") {
    const root = sourceBase(config.hianimeBaseUrl);
    return parseHiAnimeSearch(await postJson(`${HIANIME_API_BASE}/search`, { title: query }, "HiAnime search", `${root}/`));
  }
  const root = sourceBase(config.anidbBaseUrl);
  return parseSearchPage(await fetchText(`${root}/browse?q=${encodeURIComponent(query)}`, "AniDB search", `${root}/`));
}

const RESOLVE_QUERIES = 3;

/** Resolve each provider independently; an outage stops alias attempts for that provider. */
export async function resolveSource(anime: AnimeResult, provider: ProviderName, config: SourceConfig): Promise<{ hit: AnimeResult; exact: boolean } | undefined> {
  const known = animeSources(anime);
  const queries = [...new Set([anime.title, ...known.flatMap((source) => [source.title, ...source.aliases])].map((value) => value.trim()).filter(Boolean))].slice(0, RESOLVE_QUERIES);
  let likely: AnimeResult | undefined;
  for (const query of queries) {
    const hits = await searchOne(query, provider, config);
    for (const hit of hits) {
      const match = sourceMatch(anime, hit);
      if (match === "exact") return { hit, exact: true };
      if (match === "likely" && !likely) likely = hit;
    }
  }
  return likely ? { hit: likely, exact: false } : undefined;
}

export async function getProviderEpisodes(animeId: string, config: SourceConfig): Promise<Episode[]> {
  const { provider, value } = splitId(animeId);
  if (provider === "aniwave") {
    if (!/^[a-z0-9-]+-\d+$/i.test(value)) throw new Error("Invalid AniWave anime identifier");
    const numeric = value.slice(value.lastIndexOf("-") + 1);
    return parseAniwaveEpisodes(await fetchJson(`${sourceBase(config.aniwaveBaseUrl)}/ajax/episode/list/${numeric}?vrf=`, "AniWave episode lookup"), numeric);
  }
  if (provider === "hianime") {
    if (!/^[\p{L}\p{N}:!'().,_+~-]+(?:-[\p{L}\p{N}:!'().,_+~-]+)*$/u.test(value)) throw new Error("Invalid HiAnime anime identifier");
    return parseHiAnimeEpisodes(await fetchJson(`${HIANIME_API_BASE}/anime/${encodeURIComponent(value)}`, "HiAnime episode lookup", `${sourceBase(config.hianimeBaseUrl)}/`));
  }
  if (!/^[a-z0-9-]+-\d+$/i.test(value)) throw new Error("Invalid AniDB anime identifier");
  const numeric = value.slice(value.lastIndexOf("-") + 1);
  return parseEpisodes(await fetchJson(`${sourceBase(config.anidbBaseUrl)}/api/frontend/anime/${numeric}/episodes`, "AniDB episode lookup"));
}

async function getEpisodeServers(episodeId: string, config: SourceConfig): Promise<unknown> {
  const { provider, value } = splitId(episodeId);
  if (provider === "aniwave") {
    const match = value.match(/^(\d+):([0-9.]+)$/);
    if (!match) throw new Error("Invalid AniWave episode identifier");
    const root = sourceBase(config.aniwaveBaseUrl);
    return fetchJson(`${root}/ajax/server/list?servers=${encodeURIComponent(match[1])}&eps=${encodeURIComponent(match[2])}`, "AniWave server lookup", `${root}/`);
  }
  if (provider === "hianime") {
    if (!/^[\p{L}\p{N}:!'().,_+~-]+(?:-[\p{L}\p{N}:!'().,_+~-]+)*$/u.test(value)) throw new Error("Invalid HiAnime episode identifier");
    return fetchJson(`${HIANIME_API_BASE}/episode/${encodeURIComponent(value)}`, "HiAnime stream lookup", `${sourceBase(config.hianimeBaseUrl)}/`);
  }
  if (!/^\d+$/.test(value)) throw new Error("Invalid AniDB episode identifier");
  return fetchJson(`${sourceBase(config.anidbBaseUrl)}/api/frontend/episode/${value}/languages`, "AniDB stream lookup");
}

export async function getAvailability(episodeId: string, config: SourceConfig): Promise<EpisodeAvailability> {
  const { provider } = splitId(episodeId);
  const payload = await getEpisodeServers(episodeId, config);
  const listed = (mode: TranslationMode) => provider === "aniwave" ? Boolean(parseAniwaveVidplayId(payload, mode))
    : provider === "hianime" ? hiAnimeEmbedUrls(payload, mode).some((value) => { try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "zokoanime.video"; } catch { return false; } })
    : Boolean(findEmbedUrl(payload, mode));
  return { sub: listed("sub"), dub: listed("dub"), checkedAt: Date.now() };
}

export async function getStreams(episodeId: string, mode: TranslationMode, config: SourceConfig): Promise<Stream[]> {
  const { provider, value } = splitId(episodeId);
  if (provider === "aniwave") {
    const match = value.match(/^(\d+):([0-9.]+)$/);
    if (!match) throw new Error("Invalid AniWave episode identifier");
    const root = sourceBase(config.aniwaveBaseUrl);
    const servers = await getEpisodeServers(episodeId, config);
    const linkId = parseAniwaveVidplayId(servers, mode);
    if (!linkId) throw new Error(`No ${mode === "dub" ? "dubbed" : "subtitled"} Vidplay server is available`);
    const source = await fetchJson(`${root}/ajax/sources?id=${encodeURIComponent(linkId)}&asi=0&autoPlay=0`, "AniWave source lookup", `${root}/`);
    const embedUrl = parseResultUrl(source);
    if (!embedUrl) throw new Error("AniWave returned no Vidplay URL");
    const embed = new URL(absolute(embedUrl, root));
    const token = embed.pathname.match(/\/embed-1\/([^/?]+)/)?.[1];
    if (!token) throw new Error("Vidplay response has changed");
    const direct = await fetchJson(`${embed.origin}/embed-1/getSources?id=${encodeURIComponent(token)}`, "Vidplay source lookup", embed.toString());
    const rawMaster = parseVidplaySource(direct);
    if (!rawMaster) throw new Error("Vidplay returned no playable stream");
    const masterUrl = absolute(rawMaster, embed.origin);
    return parseMasterPlaylist(await fetchText(masterUrl, "Video playlist", embed.toString()), masterUrl, "aniwave", embed.toString());
  }
  if (provider === "hianime") {
    if (!/^[\p{L}\p{N}:!'().,_+~-]+(?:-[\p{L}\p{N}:!'().,_+~-]+)*$/u.test(value)) throw new Error("Invalid HiAnime episode identifier");
    const root = sourceBase(config.hianimeBaseUrl);
    const payload = await getEpisodeServers(episodeId, config);
    const candidates = hiAnimeEmbedUrls(payload, mode);
    if (candidates.length === 0) throw new Error(`No ${mode === "dub" ? "dubbed" : "subtitled"} HiAnime source is available`);
    const failures: string[] = [];
    for (const candidate of candidates) {
      let embed: URL;
      try { embed = new URL(candidate); } catch { failures.push("invalid embed URL"); continue; }
      if (embed.protocol !== "https:" || embed.hostname !== "zokoanime.video") { failures.push(`unsupported host ${embed.hostname || "unknown"}`); continue; }
      try {
        const parsed = parseHiAnimeEmbed(await fetchText(embed.toString(), "HiAnime video host", `${root}/`));
        if (!parsed) { failures.push(`${embed.hostname} response changed`); continue; }
        const masterUrl = absolute(parsed.src, embed.origin);
        return parseMasterPlaylist(await fetchText(masterUrl, "Video playlist", embed.toString()), masterUrl, "hianime", embed.toString())
          .map((stream) => ({ ...stream, textTracks: parsed.subtitles }));
      } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
    }
    throw new Error(`No supported HiAnime server could be resolved: ${failures.join("; ")}`);
  }
  if (!/^\d+$/.test(value)) throw new Error("Invalid AniDB episode identifier");
  const root = sourceBase(config.anidbBaseUrl);
  const payload = await getEpisodeServers(episodeId, config);
  const embedUrl = findEmbedUrl(payload, mode);
  if (!embedUrl) throw new Error(`No ${mode === "dub" ? "dubbed" : "subtitled"} source is available`);
  const embedPage = await fetchText(absolute(embedUrl, root), "Video host", root);
  const rawMasterUrl = parseMasterUrl(embedPage);
  if (!rawMasterUrl) throw new Error("The video host response has changed");
  const masterUrl = absolute(rawMasterUrl, embedUrl);
  return parseMasterPlaylist(await fetchText(masterUrl, "Video playlist", embedUrl), masterUrl, "anidb", embedUrl);
}
