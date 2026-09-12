import type { AnimeResult, Episode, EpisodeCatalog, ProviderName, ProviderPreference, Settings, Stream, TranslationMode } from "../shared/contracts";
import { animeSources, sourceMatch, unifyAnimeResults } from "../shared/catalog";
import { findEmbedUrl, hiAnimeEmbedUrls, parseAniwaveEpisodes, parseAniwaveSearch, parseAniwaveVidplayId, parseEpisodes, parseHiAnimeEmbed, parseHiAnimeEpisodes, parseHiAnimeSearch, parseMasterPlaylist, parseMasterUrl, parseResultUrl, parseSearchPage, parseVidplaySource } from "./parsers";

const RETRY_DELAY_MS = 750;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
export type SourceConfig = Pick<Settings, "preferredProvider" | "aniwaveBaseUrl" | "anidbBaseUrl" | "hianimeBaseUrl">;
const HIANIME_API_BASE = "https://animehot.cc/api";

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
async function request(url: string, label: string, accept: string, referrer?: string): Promise<Response> {
  let response!: Response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // Live search can fire several requests in quick succession; give a rate limit a moment before retrying.
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: accept, ...(referrer ? { Referer: referrer } : {}) }, signal: AbortSignal.timeout(15_000) });
    if (response.ok) return response;
    if (response.status !== 429 && response.status < 500) break;
  }
  throw new Error(`${label} failed (${response.status})`);
}
async function postJson(url: string, body: unknown, label: string, referrer?: string): Promise<unknown> {
  let response!: Response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    response = await fetch(url, { method: "POST", headers: { "User-Agent": USER_AGENT, Accept: "application/json", "Content-Type": "application/json", ...(referrer ? { Referer: referrer } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    if (response.ok) return response.json() as Promise<unknown>;
    if (response.status !== 429 && response.status < 500) break;
  }
  throw new Error(`${label} failed (${response.status})`);
}
const fetchText = async (url: string, label: string, referrer?: string) => (await request(url, label, "text/html,application/json;q=0.9,*/*;q=0.8", referrer)).text();
const fetchJson = async (url: string, label: string, referrer?: string) => (await request(url, label, "application/json", referrer)).json() as Promise<unknown>;

function splitId(id: string): { provider: ProviderName; value: string } {
  if (id.startsWith("aniwave:")) return { provider: "aniwave", value: id.slice(8) };
  if (id.startsWith("anidb:")) return { provider: "anidb", value: id.slice(6) };
  if (id.startsWith("hianime:")) return { provider: "hianime", value: id.slice(8) };
  return { provider: "anidb", value: id };
}

async function searchOne(query: string, provider: ProviderName, config: SourceConfig): Promise<AnimeResult[]> {
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

export async function searchAnime(query: string, config: SourceConfig, requested?: ProviderPreference, links: string[][] = []): Promise<AnimeResult[]> {
  const cleaned = query.trim();
  if (!cleaned) return [];
  if (cleaned.length > 120) throw new Error("Search query is too long");
  const preference = requested ?? config.preferredProvider;
  if (preference !== "auto") return searchOne(cleaned, preference, config);
  const settled = await Promise.allSettled((["aniwave", "anidb", "hianime"] as const).map((provider) => searchOne(cleaned, provider, config)));
  const found = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (settled.every((result) => result.status === "rejected")) {
    throw new Error(`All providers failed: ${settled.map((result) => result.status === "rejected" && (result.reason instanceof Error ? result.reason.message : String(result.reason))).join("; ")}`);
  }
  return unifyAnimeResults(found, links);
}

const ALL_PROVIDERS: readonly ProviderName[] = ["aniwave", "anidb", "hianime"];
const RESOLVE_QUERIES = 3;

/** Find the anime on every provider it is not yet known on. Each provider is searched with the title and aliases
 *  until a hit shares an alias, or failing that names the same franchise and season. Providers that fail or
 *  return no convincing hit are simply left out. */
export async function resolveSources(anime: AnimeResult, config: SourceConfig): Promise<{ anime: AnimeResult; confirmed: string[] }> {
  const known = animeSources(anime);
  const missing = ALL_PROVIDERS.filter((provider) => !known.some((source) => source.provider === provider));
  if (missing.length === 0) return { anime, confirmed: [] };
  const queries = [...new Set([anime.title, ...known.flatMap((source) => [source.title, ...source.aliases])].map((value) => value.trim()).filter(Boolean))].slice(0, RESOLVE_QUERIES);
  const found = await Promise.all(missing.map(async (provider): Promise<{ hit: AnimeResult; exact: boolean } | undefined> => {
    let likely: AnimeResult | undefined;
    for (const query of queries) {
      let hits: AnimeResult[];
      try { hits = await searchOne(query, provider, config); } catch { continue; }
      for (const hit of hits) {
        const match = sourceMatch(anime, hit);
        if (match === "exact") return { hit, exact: true };
        if (match === "likely" && !likely) likely = hit;
      }
    }
    return likely ? { hit: likely, exact: false } : undefined;
  }));
  const matches = found.filter((item): item is { hit: AnimeResult; exact: boolean } => Boolean(item));
  if (matches.length === 0) return { anime, confirmed: [] };
  const extra = matches.flatMap((item) => animeSources(item.hit));
  // Only alias-confirmed matches are worth remembering; a franchise-and-season guess stays a one-off.
  const confirmed = matches.filter((item) => item.exact).flatMap((item) => animeSources(item.hit).map((source) => source.id));
  const sources = [...known, ...extra].filter((source, index, all) => all.findIndex((item) => item.id === source.id) === index);
  return { anime: { ...anime, sources }, confirmed };
}

async function getProviderEpisodes(animeId: string, config: SourceConfig): Promise<Episode[]> {
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

export async function getEpisodes(anime: AnimeResult, config: SourceConfig): Promise<EpisodeCatalog> {
  const sources = animeSources(anime).filter((source, index, all) => all.findIndex((item) => item.provider === source.provider) === index);
  const settled = await Promise.allSettled(sources.map((source) => getProviderEpisodes(source.id, config)));
  return {
    groups: sources.map((source, index) => settled[index].status === "fulfilled"
      ? { provider: source.provider, episodes: (settled[index] as PromiseFulfilledResult<Episode[]>).value }
      : { provider: source.provider, episodes: [], error: (settled[index] as PromiseRejectedResult).reason instanceof Error ? (settled[index] as PromiseRejectedResult).reason.message : String((settled[index] as PromiseRejectedResult).reason) })
  };
}

export async function getStreams(episodeId: string, mode: TranslationMode, config: SourceConfig): Promise<Stream[]> {
  const { provider, value } = splitId(episodeId);
  if (provider === "aniwave") {
    const match = value.match(/^(\d+):([0-9.]+)$/);
    if (!match) throw new Error("Invalid AniWave episode identifier");
    const root = sourceBase(config.aniwaveBaseUrl);
    const servers = await fetchJson(`${root}/ajax/server/list?servers=${encodeURIComponent(match[1])}&eps=${encodeURIComponent(match[2])}`, "AniWave server lookup", `${root}/`);
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
    return parseMasterPlaylist(await fetchText(masterUrl, "Video playlist", embed.toString()), masterUrl, "aniwave", embed.toString()).map((stream) => ({ ...stream, server: "Vidplay" }));
  }
  if (provider === "hianime") {
    if (!/^[\p{L}\p{N}:!'().,_+~-]+(?:-[\p{L}\p{N}:!'().,_+~-]+)*$/u.test(value)) throw new Error("Invalid HiAnime episode identifier");
    const root = sourceBase(config.hianimeBaseUrl);
    const payload = await fetchJson(`${HIANIME_API_BASE}/episode/${encodeURIComponent(value)}`, "HiAnime stream lookup", `${root}/`);
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
          .map((stream) => ({ ...stream, server: "ZokoAnime", textTracks: parsed.subtitles }));
      } catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
    }
    throw new Error(`No supported HiAnime server could be resolved: ${failures.join("; ")}`);
  }
  if (!/^\d+$/.test(value)) throw new Error("Invalid AniDB episode identifier");
  const root = sourceBase(config.anidbBaseUrl);
  const payload = await fetchJson(`${root}/api/frontend/episode/${value}/languages`, "AniDB stream lookup");
  const embedUrl = findEmbedUrl(payload, mode);
  if (!embedUrl) throw new Error(`No ${mode === "dub" ? "dubbed" : "subtitled"} source is available`);
  const embedPage = await fetchText(absolute(embedUrl, root), "Video host", root);
  const rawMasterUrl = parseMasterUrl(embedPage);
  if (!rawMasterUrl) throw new Error("The video host response has changed");
  const masterUrl = absolute(rawMasterUrl, embedUrl);
  return parseMasterPlaylist(await fetchText(masterUrl, "Video playlist", embedUrl), masterUrl, "anidb", embedUrl);
}
