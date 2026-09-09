import { contextBridge, ipcRenderer } from "electron";
import type { AniPlayerApi, PlayerCommand, PlayerSession } from "../shared/contracts";

const api: AniPlayerApi = {
  ready: () => ipcRenderer.invoke("player-window:ready"),
  onLoad(listener) {
    const handler = (_event: Electron.IpcRendererEvent, session: PlayerSession) => listener(session);
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
  saveStorage: (sessionId, update) => ipcRenderer.invoke("player-window:storage", sessionId, update),
  setFullscreen: (fullscreen) => ipcRenderer.invoke("player-window:fullscreen", fullscreen),
  openExternal: () => ipcRenderer.invoke("player-window:external"),
  close: () => ipcRenderer.invoke("player-window:close")
};

contextBridge.exposeInMainWorld("aniPlayer", api);
