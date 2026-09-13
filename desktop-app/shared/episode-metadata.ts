import type { EpisodeAvailability, EpisodeQuality } from "./contracts";

const DAY = 24 * 60 * 60 * 1000;
export const METADATA_RETENTION = 7 * DAY;
export const METADATA_LIMIT = 5000;
const fresh = (at: number, ttl: number, now: number) => at <= now && now - at < ttl;
// Missing audio or quality gets another chance soon, including newly released dubs.
export const availabilityFresh = (value: EpisodeAvailability | undefined, now = Date.now()) =>
  !!value && fresh(value.checkedAt, value.sub && value.dub ? DAY : 15 * 60 * 1000, now);
export const qualityFresh = (value: EpisodeQuality | undefined, now = Date.now()) =>
  !!value && fresh(value.checkedAt, value.quality ? DAY : 15 * 60 * 1000, now);
export const bestQuality = (streams: { quality: string }[]) => streams.map((stream) => stream.quality)
  .sort((a, b) => (parseInt(b) || 0) - (parseInt(a) || 0))[0];
