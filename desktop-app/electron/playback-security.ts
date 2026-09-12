import type { PlayRequest } from "../shared/contracts";
import { normalizeEntry } from "./state";

export function validatePlayRequest(value: PlayRequest): PlayRequest {
  if (!value || typeof value !== "object") throw new Error("Invalid playback request");
  const url = validatedHttpUrl(value.url, "playback");
  if (typeof value.title !== "string" || !value.title.trim() || value.title.length > 300) throw new Error("Invalid playback title");
  const referrer = value.referrer ? validatedHttpUrl(value.referrer, "referrer") : undefined;
  const textTracks = value.textTracks?.slice(0, 20).map((track) => ({
    src: validatedHttpUrl(track.src, "caption"),
    label: typeof track.label === "string" && track.label.trim() ? track.label.trim().slice(0, 80) : "Subtitles",
    lang: typeof track.lang === "string" && /^[a-z0-9-]{1,35}$/i.test(track.lang) ? track.lang : "und",
    default: track.default === true
  }));
  const episode = value.episode;
  if (episode && (typeof episode.id !== "string" || !episode.id || episode.id.length > 512)) throw new Error("Invalid episode identifier");
  return { url, title: value.title.trim(), ...(referrer ? { referrer } : {}), ...(textTracks?.length ? { textTracks } : {}),
    ...(episode ? { episode: { id: episode.id, entry: normalizeEntry(episode.entry) } } : {}) };
}

function validatedHttpUrl(value: string, label: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error(`Invalid ${label} URL`); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`Invalid ${label} URL`);
  return url.toString();
}

export function withPlaybackReferrer(headers: Record<string, string>, referrer?: string): Record<string, string> {
  if (!referrer) return headers;
  const next = Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== "referer"));
  return { ...next, Referer: referrer };
}

export function withMediaCors(headers: Record<string, string[]> = {}): Record<string, string[]> {
  const next = Object.fromEntries(Object.entries(headers).filter(([name]) => !name.toLowerCase().startsWith("access-control-allow-")));
  return {
    ...next,
    "Access-Control-Allow-Origin": ["*"],
    "Access-Control-Allow-Methods": ["GET, HEAD, OPTIONS"],
    "Access-Control-Allow-Headers": ["*"]
  };
}

/** Header rewriting applies only to stream traffic. Page assets and poster images keep their own headers. */
export function isPlaybackRequest(resourceType: string): boolean {
  return resourceType === "xhr" || resourceType === "media";
}
