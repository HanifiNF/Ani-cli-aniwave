import type { PlayRequest, PlayerStorageUpdate } from "./contracts";

export function playbackKey(request: PlayRequest): string | undefined {
  return request.episode ? `${request.episode.id}:${request.episode.entry.mode}` : undefined;
}

export function validateStorageUpdate(value: unknown): PlayerStorageUpdate {
  if (!value || typeof value !== "object") throw new Error("Invalid player preferences");
  const input = value as Record<string, unknown>;
  const update: PlayerStorageUpdate = {};
  for (const [key, min, max] of [["volume", 0, 1], ["rate", 0.25, 2], ["time", 0, 604800]] as const) {
    if (!(key in input)) continue;
    const number = input[key];
    if (typeof number !== "number" || !Number.isFinite(number) || number < min || number > max) throw new Error(`Invalid player ${key}`);
    update[key] = number;
  }
  for (const key of ["muted", "captions", "completed"] as const) {
    if (!(key in input)) continue;
    if (typeof input[key] !== "boolean") throw new Error(`Invalid player ${key}`);
    update[key] = input[key];
  }
  if ("lang" in input) {
    if (input.lang !== null && (typeof input.lang !== "string" || input.lang.length > 64)) throw new Error("Invalid caption language");
    update.lang = input.lang as string | null;
  }
  return update;
}
