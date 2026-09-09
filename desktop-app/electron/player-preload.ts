import { contextBridge, ipcRenderer } from "electron";
import type { AniPlayerApi, PlayerCommand, PlayerSession } from "../shared/contracts";

let diagnostics = false;
let sessionId = "";
const acceptSession = (session: PlayerSession) => {
  sessionId = session.id;
  diagnostics = session.diagnostics === true;
  return session;
};
ipcRenderer.on("player-window:diagnostics-change", (_event, enabled: unknown) => { diagnostics = enabled === true; });

// Install before renderer handlers so even keys consumed by fullscreen or menus are observable.
// This listener observes input inside the player window and never intercepts it.
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
    if (diagnostics) ipcRenderer.send("player-window:diagnostic", id, { ...record, prevented: event.defaultPrevented });
  }, 0);
}, true);

const api: AniPlayerApi = {
  ready: () => ipcRenderer.invoke("player-window:ready").then(acceptSession),
  onLoad(listener) {
    const handler = (_event: Electron.IpcRendererEvent, session: PlayerSession) => listener(acceptSession(session));
    ipcRenderer.on("player-window:load", handler);
    return () => ipcRenderer.removeListener("player-window:load", handler);
  },
  onFullscreenChange(listener) {
    const handler = (_event: Electron.IpcRendererEvent, fullscreen: unknown) => {
      if (typeof fullscreen === "boolean") listener(fullscreen);
    };
    ipcRenderer.on("player-window:fullscreen-change", handler);
    return () => ipcRenderer.removeListener("player-window:fullscreen-change", handler);
  },
  onCommand(listener) {
    const handler = (_event: Electron.IpcRendererEvent, command: PlayerCommand) => listener(command);
    ipcRenderer.on("player-window:command", handler);
    return () => ipcRenderer.removeListener("player-window:command", handler);
  },
  onNotice(listener) {
    const handler = (_event: Electron.IpcRendererEvent, message: string) => listener(message);
    ipcRenderer.on("player-window:notice", handler);
    return () => ipcRenderer.removeListener("player-window:notice", handler);
  },
  onDiagnosticsChange(listener) {
    const handler = (_event: Electron.IpcRendererEvent, enabled: unknown) => listener(enabled === true);
    ipcRenderer.on("player-window:diagnostics-change", handler);
    return () => ipcRenderer.removeListener("player-window:diagnostics-change", handler);
  },
  logDiagnostic: (id, record) => ipcRenderer.send("player-window:diagnostic", id, record),
  saveStorage: (sessionId, update) => ipcRenderer.invoke("player-window:storage", sessionId, update),
  setFullscreen: (fullscreen) => ipcRenderer.invoke("player-window:fullscreen", fullscreen),
  openExternal: () => ipcRenderer.invoke("player-window:external"),
  close: () => ipcRenderer.invoke("player-window:close")
};

contextBridge.exposeInMainWorld("aniPlayer", api);
