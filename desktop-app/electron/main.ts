import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, nativeImage, session, shell } from "electron";
import type { AnimeResult, LibraryEntry, PlayerSession, PlayRequest, ProviderPreference, Settings, TranslationMode } from "../shared/contracts";
import { playerArguments } from "./player";
import { assertPlayerSender, registerPlayerFullscreenEvents, setPlayerFullscreen } from "./player-window";
import { validatePlayRequest, withMediaCors, withPlaybackReferrer } from "./playback-security";
import { getEpisodes, getStreams, searchAnime } from "./scraper";
import { StateStore } from "./state";

let mainWindow: BrowserWindow | undefined;
let playerWindow: BrowserWindow | undefined;
let activePlayback: PlayRequest | undefined;
let store: StateStore;
const PLAYER_PARTITION = "ani-desktop-player";

function playerPayload(): PlayerSession {
  if (!activePlayback) throw new Error("No stream has been assigned to the player");
  return {
    request: activePlayback,
    canOpenExternal: Boolean(store.snapshot().settings.playerPath.trim()),
    fullscreen: Boolean(playerWindow?.isFullScreen())
  };
}

function configurePlayerSession(): void {
  const isolated = session.fromPartition(PLAYER_PARTITION);
  isolated.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  const filter = { urls: ["http://*/*", "https://*/*"] };
  isolated.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    callback({ requestHeaders: withPlaybackReferrer(details.requestHeaders, activePlayback?.referrer) });
  });
  isolated.webRequest.onHeadersReceived(filter, (details, callback) => {
    callback({ responseHeaders: withMediaCors(details.responseHeaders) });
  });
}

async function launchExternalPlayer(request: PlayRequest, settings: Settings): Promise<void> {
  if (!settings.playerPath.trim()) throw new Error("Configure an external player path in Settings first");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(settings.playerPath, playerArguments(settings.playerPath, request, settings.startPlayerFullscreen), {
      detached: true,
      stdio: "ignore",
      // Hiding the process also hides VLC's actual video window on Windows.
      windowsHide: false
    });
    child.once("error", (error) => reject(new Error(`Could not start ${settings.playerPath}: ${error.message}`)));
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}

async function openBuiltinPlayer(request: PlayRequest, settings: Settings): Promise<void> {
  activePlayback = request;
  if (playerWindow && !playerWindow.isDestroyed()) {
    playerWindow.setFullScreen(settings.startPlayerFullscreen);
    playerWindow.setTitle(request.title);
    playerWindow.show();
    playerWindow.focus();
    playerWindow.webContents.send("player-window:load", playerPayload());
    return;
  }

  const icon = nativeImage.createFromPath(join(__dirname, "../icon.png"));
  playerWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 640,
    minHeight: 360,
    useContentSize: true,
    fullscreen: settings.startPlayerFullscreen,
    backgroundColor: "#000000",
    title: request.title,
    icon,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "player-preload.js"),
      partition: PLAYER_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  registerPlayerFullscreenEvents(playerWindow);
  playerWindow.setMenuBarVisibility(false);
  playerWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  playerWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  playerWindow.once("ready-to-show", () => playerWindow?.show());
  playerWindow.once("closed", () => { playerWindow = undefined; activePlayback = undefined; });

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) await playerWindow.loadURL(new URL("player.html", `${developmentUrl}/`).toString());
  else await playerWindow.loadFile(join(__dirname, "../../dist/player.html"));
}

function createWindow(): void {
  const capturePath = !app.isPackaged ? process.env.ANI_DESKTOP_CAPTURE_PATH : undefined;
  const icon = nativeImage.createFromPath(join(__dirname, "../icon.png"));
  if (process.platform === "darwin") app.dock?.setIcon(icon);
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 920,
    minHeight: 620,
    backgroundColor: "#1F2023",
    title: "Ani Desktop",
    icon,
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
  mainWindow.once("closed", () => { mainWindow = undefined; });
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
  ipcMain.handle("app:icon", (event, pngDataUrl: unknown) => {
    if (!mainWindow || mainWindow.isDestroyed() || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
      throw new Error("Unknown icon sender");
    }
    if (typeof pngDataUrl !== "string" || pngDataUrl.length > 2_000_000 || !pngDataUrl.startsWith("data:image/png;base64,")) {
      throw new Error("Invalid icon image");
    }
    const icon = nativeImage.createFromDataURL(pngDataUrl);
    const size = icon.getSize();
    if (icon.isEmpty() || size.width !== 1024 || size.height !== 1024) throw new Error("Invalid icon dimensions");
    if (process.platform === "darwin") app.dock?.setIcon(icon);
    else mainWindow.setIcon(icon);
  });
  ipcMain.handle("catalog:search", (_event, query: string, provider?: ProviderPreference) => {
    const state = store.snapshot();
    return searchAnime(query, state.settings, provider, state.providerLinks);
  });
  ipcMain.handle("catalog:episodes", (_event, anime: AnimeResult) => getEpisodes(anime, store.snapshot().settings));
  ipcMain.handle("catalog:streams", (_event, episodeId: string, mode: TranslationMode) => getStreams(episodeId, mode, store.snapshot().settings));
  ipcMain.handle("state:get", () => store.snapshot());
  ipcMain.handle("state:settings", (_event, settings: Settings) => store.saveSettings(settings));
  ipcMain.handle("state:bookmark", (_event, entry: LibraryEntry) => store.toggleBookmark(entry));
  ipcMain.handle("state:bookmark-remove", (_event, animeId: string) => store.removeBookmark(String(animeId)));
  ipcMain.handle("state:history", (_event, entry: LibraryEntry) => store.recordHistory(entry));
  ipcMain.handle("state:history-remove", (_event, animeId: string) => store.removeHistory(String(animeId)));
  ipcMain.handle("state:history-clear", () => store.clearHistory());
  ipcMain.handle("state:remap", (_event, oldAnimeId: string, replacement) => store.remapEntry(oldAnimeId, replacement));
  ipcMain.handle("state:link-sources", (_event, sourceIds: string[]) => store.linkSources(sourceIds));
  ipcMain.handle("state:merge-entries", (_event, firstAnimeId: string, secondAnimeId: string) => store.mergeEntries(firstAnimeId, secondAnimeId));
  ipcMain.handle("state:dismiss-merge", (_event, firstAnimeId: string, secondAnimeId: string) => store.dismissMerge(firstAnimeId, secondAnimeId));
  ipcMain.handle("player:play", async (_event, request: PlayRequest) => {
    const validated = validatePlayRequest(request);
    const settings = store.snapshot().settings;
    if (settings.playbackTarget === "external") await launchExternalPlayer(validated, settings);
    else await openBuiltinPlayer(validated, settings);
    return true;
  });
  ipcMain.handle("player-window:ready", (event) => { assertPlayerSender(playerWindow, event); return playerPayload(); });
  ipcMain.handle("player-window:fullscreen", (event, fullscreen: unknown) => {
    assertPlayerSender(playerWindow, event);
    return setPlayerFullscreen(playerWindow, fullscreen);
  });
  ipcMain.handle("player-window:external", async (event) => {
    assertPlayerSender(playerWindow, event);
    await launchExternalPlayer(playerPayload().request, store.snapshot().settings);
    return true;
  });
  ipcMain.handle("player-window:close", (event) => {
    assertPlayerSender(playerWindow, event);
    playerWindow?.close();
  });
}

app.whenReady().then(async () => {
  store = new StateStore(join(app.getPath("userData"), "state.json"));
  await store.load();
  configurePlayerSession();
  registerIpc();
  if (!app.isPackaged && process.env.ANI_DESKTOP_SMOKE_QUERY) {
    const config = store.snapshot().settings;
    const results = await searchAnime(process.env.ANI_DESKTOP_SMOKE_QUERY, config);
    if (results.length === 0) throw new Error("Smoke test search returned no results");
    const catalog = await getEpisodes(results[0], config);
    const episodes = catalog.groups.find((group) => group.episodes.length)?.episodes ?? [];
    if (episodes.length === 0) throw new Error("Smoke test found no episodes");
    const streams = await getStreams(episodes[0].id, "sub", config);
    if (streams.length === 0) throw new Error("Smoke test found no streams");
    console.log(JSON.stringify({ title: results[0].title, results: results.length, episodes: episodes.length, qualities: streams.map((stream) => stream.quality) }));
    app.quit();
    return;
  }
  createWindow();
  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  });
}).catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
