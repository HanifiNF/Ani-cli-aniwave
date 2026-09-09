import { contextBridge, ipcRenderer } from "electron";
import type { AniDesktopApi, AniPlayerApi, LibraryEntry, PlayRequest, PlayerCommand, PlayerSession, ProviderPreference, Settings, TranslationMode } from "../shared/contracts";

let diagnostics = false;
let sessionId = "";
const acceptSession = (session: PlayerSession | undefined) => {
  sessionId = session?.id ?? "";
  diagnostics = session?.diagnostics === true;
  return session;
};
ipcRenderer.on("player:diagnostics-change", (_event, enabled: unknown) => { diagnostics = enabled === true; });

// Install before renderer handlers so even keys consumed by fullscreen or menus are observable.
// This listener observes input while a playback session is active and never intercepts it.
for (const phase of ["keydown", "keyup"] as const) window.addEventListener(phase, (event) => {
  if (!diagnostics || !sessionId || event.isComposing) return;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('input, textarea, select, [contenteditable], [role="textbox"], [role="searchbox"], [role="spinbutton"]')) return;
  const id = sessionId;
  const record = { event: "keyboard", phase, key: event.key === " " ? "Space" : event.key,
    inputTime: performance.timeOrigin + event.timeStamp,
    time: document.querySelector("video")?.currentTime,
    paused: document.querySelector("video")?.paused,
    code: event.code, shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey,
    repeat: event.repeat, trusted: event.isTrusted,
    target: target?.closest('[data-media-time-slider]') ? "timeline" : target?.closest('[role="slider"]') ? "slider"
      : target?.closest('[role^="menu"]') ? "menu" : target?.closest("dialog") ? "dialog"
      : target?.closest('button, [role="button"]') ? "button" : "player" };
  // Observe preventDefault after the renderer has handled the key.
  setTimeout(() => {
    if (diagnostics && sessionId === id) ipcRenderer.send("player:diagnostic", id, { ...record, prevented: event.defaultPrevented });
  }, 0);
}, true);

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const player: AniPlayerApi = {
  ready: () => ipcRenderer.invoke("player:ready").then(acceptSession),
  onLoad: (listener) => subscribe<PlayerSession>("player:load", (session) => listener(acceptSession(session)!)),
  onFullscreenChange: (listener) => subscribe<unknown>("player:fullscreen-change", (fullscreen) => { if (typeof fullscreen === "boolean") listener(fullscreen); }),
  onCommand: (listener) => subscribe<PlayerCommand>("player:command", listener),
  onNotice: (listener) => subscribe<string>("player:notice", listener),
  onDiagnosticsChange: (listener) => subscribe<unknown>("player:diagnostics-change", (enabled) => listener(enabled === true)),
  logDiagnostic: (id, record) => ipcRenderer.send("player:diagnostic", id, record),
  saveStorage: (id, update) => ipcRenderer.invoke("player:storage", id, update),
  setFullscreen: (fullscreen) => ipcRenderer.invoke("player:fullscreen", fullscreen),
  openExternal: () => ipcRenderer.invoke("player:external"),
  setActive: (active) => {
    if (!active) acceptSession(undefined);
    return ipcRenderer.invoke("player:active", active);
  }
};

const api: AniDesktopApi = {
  player,
  search: (query, provider?: ProviderPreference) => ipcRenderer.invoke("catalog:search", query, provider),
  episodes: (anime) => ipcRenderer.invoke("catalog:episodes", anime),
  streams: (episodeId: string, mode: TranslationMode) => ipcRenderer.invoke("catalog:streams", episodeId, mode),
  play: (request: PlayRequest) => ipcRenderer.invoke("player:play", request),
  getState: () => ipcRenderer.invoke("state:get"),
  saveSettings: (settings: Settings) => ipcRenderer.invoke("state:settings", settings),
  openPlayerLogs: () => ipcRenderer.invoke("player:open-logs"),
  setAppIcon: (pngDataUrl: string) => ipcRenderer.invoke("app:icon", pngDataUrl),
  toggleBookmark: (entry: LibraryEntry) => ipcRenderer.invoke("state:bookmark", entry),
  removeBookmark: (animeId: string) => ipcRenderer.invoke("state:bookmark-remove", animeId),
  recordHistory: (entry: LibraryEntry) => ipcRenderer.invoke("state:history", entry),
  removeHistory: (animeId: string) => ipcRenderer.invoke("state:history-remove", animeId),
  clearHistory: () => ipcRenderer.invoke("state:history-clear"),
  remapEntry: (oldAnimeId, replacement) => ipcRenderer.invoke("state:remap", oldAnimeId, replacement),
  linkSources: (sourceIds) => ipcRenderer.invoke("state:link-sources", sourceIds),
  mergeEntries: (firstAnimeId, secondAnimeId) => ipcRenderer.invoke("state:merge-entries", firstAnimeId, secondAnimeId),
  dismissMerge: (firstAnimeId, secondAnimeId) => ipcRenderer.invoke("state:dismiss-merge", firstAnimeId, secondAnimeId)
};

contextBridge.exposeInMainWorld("aniDesktop", api);
