import type { MediaPlayerInstance } from "@vidstack/react";

const mediaEvents = [
  "load-start", "loaded-metadata", "can-play", "play", "playing", "pause", "waiting", "stalled",
  "seeking", "seeked", "ended", "error", "volume-change", "rate-change", "text-track-change", "quality-change",
  "picture-in-picture-change", "media-seek-request", "media-seeking-request",
  "media-enter-fullscreen-request", "media-exit-fullscreen-request"
];

export function observePlayerDiagnostics(root: HTMLElement, getPlayer: () => MediaPlayerInstance | null,
  emit: (record: Record<string, unknown>) => void): () => void {
  const record = (event: Event) => {
    const player = getPlayer();
    const state = player?.state;
    const video = root.querySelector("video");
    const detail: unknown = (event as CustomEvent).detail;
    emit({ event: event.type, time: state?.currentTime, duration: state?.duration, paused: state?.paused,
      volume: state?.volume, muted: state?.muted, rate: state?.playbackRate,
      videoWidth: video?.videoWidth, videoHeight: video?.videoHeight,
      width: root.clientWidth, height: root.clientHeight,
      bufferedEnd: video?.buffered.length ? video.buffered.end(video.buffered.length - 1) : undefined,
      seekTime: event.type.includes("seek") && typeof detail === "number" ? detail : undefined,
      enabled: typeof detail === "boolean" ? detail : undefined,
      errorCode: event.type === "error" && detail && typeof detail === "object" && "code" in detail ? detail.code : undefined
    });
  };
  for (const event of mediaEvents) root.addEventListener(event, record, true);
  return () => { for (const event of mediaEvents) root.removeEventListener(event, record, true); };
}
