import { contextBridge, ipcRenderer } from "electron";
import type { AniPlayerApi, PlayerSession } from "../shared/contracts";

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
  setFullscreen: (fullscreen) => ipcRenderer.invoke("player-window:fullscreen", fullscreen),
  openExternal: () => ipcRenderer.invoke("player-window:external"),
  close: () => ipcRenderer.invoke("player-window:close")
};

contextBridge.exposeInMainWorld("aniPlayer", api);
