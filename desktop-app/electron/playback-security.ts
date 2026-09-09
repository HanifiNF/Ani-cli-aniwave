import type { PlayRequest } from "../shared/contracts";

export function validatePlayRequest(value: PlayRequest): PlayRequest {
  if (!value || typeof value !== "object") throw new Error("Invalid playback request");
  const url = validatedHttpUrl(value.url, "playback");
  if (typeof value.title !== "string" || !value.title.trim() || value.title.length > 300) throw new Error("Invalid playback title");
  const referrer = value.referrer ? validatedHttpUrl(value.referrer, "referrer") : undefined;
  return { url, title: value.title.trim(), ...(referrer ? { referrer } : {}) };
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
