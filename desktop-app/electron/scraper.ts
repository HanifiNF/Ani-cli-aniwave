import type { AnimeResult, Episode, ProviderName, ProviderPreference, Settings, Stream, TranslationMode } from "../shared/contracts";
import { findEmbedUrl, parseAniwaveEpisodes, parseAniwaveSearch, parseAniwaveVidplayId, parseEpisodes, parseMasterPlaylist, parseMasterUrl, parseResultUrl, parseSearchPage, parseVidplaySource } from "./parsers";

const RETRY_DELAY_MS = 750;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
export type SourceConfig = Pick<Settings, "preferredProvider" | "aniwaveBaseUrl" | "anidbBaseUrl">;

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
const fetchText = async (url: string, label: string, referrer?: string) => (await request(url, label, "text/html,application/json;q=0.9,*/*;q=0.8", referrer)).text();
const fetchJson = async (url: string, label: string, referrer?: string) => (await request(url, label, "application/json", referrer)).json() as Promise<unknown>;

function splitId(id: string): { provider: ProviderName; value: string } {
  if (id.startsWith("aniwave:")) return { provider: "aniwave", value: id.slice(8) };
  if (id.startsWith("anidb:")) return { provider: "anidb", value: id.slice(6) };
  return { provider: "anidb", value: id };
}

async function searchOne(query: string, provider: ProviderName, config: SourceConfig): Promise<AnimeResult[]> {
  if (provider === "aniwave") {
    const root = sourceBase(config.aniwaveBaseUrl);
    return parseAniwaveSearch(await fetchText(`${root}/filter?keyword=${encodeURIComponent(query)}`, "AniWave search", `${root}/`));
  }
  const root = sourceBase(config.anidbBaseUrl);
  return parseSearchPage(await fetchText(`${root}/browse?q=${encodeURIComponent(query)}`, "AniDB search", `${root}/`));
}

export async function searchAnime(query: string, config: SourceConfig, requested?: ProviderPreference): Promise<AnimeResult[]> {
  const cleaned = query.trim();
  if (!cleaned) return [];
  if (cleaned.length > 120) throw new Error("Search query is too long");
  const preference = requested ?? config.preferredProvider;
  if (preference !== "auto") return searchOne(cleaned, preference, config);
  const failures: string[] = [];
  for (const provider of ["aniwave", "anidb"] as const) {
    try { const found = await searchOne(cleaned, provider, config); if (found.length) return found; }
    catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
  }
  if (failures.length === 2) throw new Error(`All providers failed: ${failures.join("; ")}`);
  return [];
}

export async function getEpisodes(animeId: string, config: SourceConfig): Promise<Episode[]> {
  const { provider, value } = splitId(animeId);
  if (provider === "aniwave") {
    if (!/^[a-z0-9-]+-\d+$/i.test(value)) throw new Error("Invalid AniWave anime identifier");
    const numeric = value.slice(value.lastIndexOf("-") + 1);
    return parseAniwaveEpisodes(await fetchJson(`${sourceBase(config.aniwaveBaseUrl)}/ajax/episode/list/${numeric}?vrf=`, "AniWave episode lookup"), numeric);
  }
  if (!/^[a-z0-9-]+-\d+$/i.test(value)) throw new Error("Invalid AniDB anime identifier");
  const numeric = value.slice(value.lastIndexOf("-") + 1);
  return parseEpisodes(await fetchJson(`${sourceBase(config.anidbBaseUrl)}/api/frontend/anime/${numeric}/episodes`, "AniDB episode lookup"));
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
