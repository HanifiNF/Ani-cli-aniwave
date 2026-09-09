import { contextBridge, ipcRenderer } from "electron";
import type { AniDesktopApi, LibraryEntry, PlayRequest, ProviderPreference, Settings, TranslationMode } from "../shared/contracts";

const api: AniDesktopApi = {
  search: (query, provider?: ProviderPreference) => ipcRenderer.invoke("catalog:search", query, provider),
  episodes: (anime) => ipcRenderer.invoke("catalog:episodes", anime),
  streams: (episodeId: string, mode: TranslationMode) => ipcRenderer.invoke("catalog:streams", episodeId, mode),
  play: (request: PlayRequest) => ipcRenderer.invoke("player:play", request),
  getState: () => ipcRenderer.invoke("state:get"),
  saveSettings: (settings: Settings) => ipcRenderer.invoke("state:settings", settings),
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
