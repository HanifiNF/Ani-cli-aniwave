const PLAYER_DIAGNOSTIC_EVENTS = [
  "diagnostics-enabled", "diagnostics-disabled", "session-start", "session-end", "video-render-policy", "renderer-ready", "keyboard", "command",
  "load-start", "loaded-metadata", "can-play", "play", "playing", "pause", "waiting", "stalled",
  "seeking", "seeked", "ended", "error", "volume-change", "rate-change", "text-track-change", "quality-change",
  "media-seek-request", "media-seeking-request", "media-enter-fullscreen-request", "media-exit-fullscreen-request",
  "fullscreen-request", "fullscreen-result", "fullscreen-error", "enter-full-screen", "leave-full-screen",
  "picture-in-picture-change", "resize", "focus", "blur", "closed", "renderer-gone", "unresponsive", "responsive"
] as const;

export type PlayerDiagnosticEvent = typeof PLAYER_DIAGNOSTIC_EVENTS[number];
export type PlayerDiagnosticRecord = { event: PlayerDiagnosticEvent } & Record<string, unknown>;
const events: ReadonlySet<string> = new Set(PLAYER_DIAGNOSTIC_EVENTS);
export const isPlayerDiagnosticEvent = (event: unknown): event is PlayerDiagnosticEvent => typeof event === "string" && events.has(event);
