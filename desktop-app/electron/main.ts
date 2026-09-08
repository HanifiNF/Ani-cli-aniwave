import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, shell } from "electron";
import type { LibraryEntry, PlayRequest, ProviderPreference, Settings, TranslationMode } from "../shared/contracts";
import { playerArguments } from "./player";
import { getEpisodes, getStreams, searchAnime } from "./scraper";
import { StateStore } from "./state";

let mainWindow: BrowserWindow | undefined;
let store: StateStore;

function createWindow(): void {
  const capturePath = !app.isPackaged ? process.env.ANI_DESKTOP_CAPTURE_PATH : undefined;
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 920,
    minHeight: 620,
    backgroundColor: "#0b0d12",
    title: "Ani Desktop",
    show: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => {
    if (!capturePath) mainWindow?.show();
  });
  if (capturePath) {
    mainWindow.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        const image = await mainWindow?.webContents.capturePage();
        if (image) await writeFile(capturePath, image.toPNG());
        app.quit();
      }, 750);
    });
  }
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) void mainWindow.loadURL(developmentUrl);
  else void mainWindow.loadFile(join(__dirname, "../../dist/index.html"));
}

function registerIpc(): void {
  ipcMain.handle("catalog:search", (_event, query: string, provider?: ProviderPreference) => searchAnime(query, store.snapshot().settings, provider));
  ipcMain.handle("catalog:episodes", (_event, animeId: string) => getEpisodes(animeId, store.snapshot().settings));
  ipcMain.handle("catalog:streams", (_event, episodeId: string, mode: TranslationMode) => getStreams(episodeId, mode, store.snapshot().settings));
  ipcMain.handle("state:get", () => store.snapshot());
  ipcMain.handle("state:settings", (_event, settings: Settings) => store.saveSettings(settings));
  ipcMain.handle("state:bookmark", (_event, entry: LibraryEntry) => store.toggleBookmark(entry));
  ipcMain.handle("state:history", (_event, entry: LibraryEntry) => store.recordHistory(entry));
  ipcMain.handle("state:remap", (_event, oldAnimeId: string, replacement) => store.remapEntry(oldAnimeId, replacement));
  ipcMain.handle("player:play", async (_event, request: PlayRequest) => {
    const url = new URL(request.url);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Invalid playback URL");
    const settings = store.snapshot().settings;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(settings.playerPath, playerArguments(settings.playerPath, { ...request, url: url.toString() }), {
        detached: true,
        stdio: "ignore",
        // Hiding the process also hides VLC's actual video window on Windows.
        // GUI players are detached already, so no console window is inherited.
        windowsHide: false
      });
      child.once("error", (error) => reject(new Error(`Could not start ${settings.playerPath}: ${error.message}`)));
      child.once("spawn", () => {
        child.unref();
        resolve();
      });
    });
    return true;
  });
}

app.whenReady().then(async () => {
  store = new StateStore(join(app.getPath("userData"), "state.json"));
  await store.load();
  registerIpc();
  if (!app.isPackaged && process.env.ANI_DESKTOP_SMOKE_QUERY) {
    const config = store.snapshot().settings;
    const results = await searchAnime(process.env.ANI_DESKTOP_SMOKE_QUERY, config);
    if (results.length === 0) throw new Error("Smoke test search returned no results");
    const episodes = await getEpisodes(results[0].id, config);
    if (episodes.length === 0) throw new Error("Smoke test found no episodes");
    const streams = await getStreams(episodes[0].id, "sub", config);
    if (streams.length === 0) throw new Error("Smoke test found no streams");
    console.log(JSON.stringify({ title: results[0].title, results: results.length, episodes: episodes.length, qualities: streams.map((stream) => stream.quality) }));
    app.quit();
    return;
  }
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
