import { contextBridge, ipcRenderer } from "electron";
import type { AniDesktopApi, LibraryEntry, PlayRequest, ProviderPreference, Settings, TranslationMode } from "../shared/contracts";

const api: AniDesktopApi = {
  search: (query, provider?: ProviderPreference) => ipcRenderer.invoke("catalog:search", query, provider),
  episodes: (animeId) => ipcRenderer.invoke("catalog:episodes", animeId),
  streams: (episodeId: string, mode: TranslationMode) => ipcRenderer.invoke("catalog:streams", episodeId, mode),
  play: (request: PlayRequest) => ipcRenderer.invoke("player:play", request),
  getState: () => ipcRenderer.invoke("state:get"),
  saveSettings: (settings: Settings) => ipcRenderer.invoke("state:settings", settings),
  toggleBookmark: (entry: LibraryEntry) => ipcRenderer.invoke("state:bookmark", entry),
  recordHistory: (entry: LibraryEntry) => ipcRenderer.invoke("state:history", entry),
  remapEntry: (oldAnimeId, replacement) => ipcRenderer.invoke("state:remap", oldAnimeId, replacement)
};

contextBridge.exposeInMainWorld("aniDesktop", api);
