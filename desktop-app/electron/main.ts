import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, ipcMain, nativeImage, session, shell } from "electron";
import type { AnimeResult, LibraryEntry, PlayerSession, PlayRequest, ProviderPreference, Settings, TranslationMode } from "../shared/contracts";
import { playerArguments } from "./player";
import { assertPlayerSender, registerPlayerFullscreenEvents, setPlayerFullscreen } from "./player-window";
import { isPlaybackRequest, validatePlayRequest, withMediaCors, withPlaybackReferrer } from "./playback-security";
import { getEpisodes, getStreams, searchAnime } from "./scraper";
import { StateStore } from "./state";
import { installApplicationMenu } from "./menu";
import { PlayerDiagnostics } from "./player-diagnostics";
import { playbackKey } from "../shared/playback";
import { configureVideoRenderingPolicy } from "./video-rendering-policy";

// Electron requires Chromium switches to be installed synchronously before app readiness.
const videoRenderingPolicy = configureVideoRenderingPolicy(app.commandLine);

let mainWindow: BrowserWindow | undefined;
let activePlayback: PlayRequest | undefined;
let activePlaybackId = "";
let playerActive = false;
const playbackSessions = new Map<string, PlayRequest>();
let store: StateStore;
let diagnostics: PlayerDiagnostics;
let refreshMenu: () => void = () => undefined;
// In-memory partition: stream segments never reach the disk cache, and the renderer gets no permissions.
const APP_PARTITION = "ani-desktop";

function playerPayload(): PlayerSession {
  if (!activePlayback) throw new Error("No stream has been assigned to the player");
  const state = store.snapshot();
  const key = playbackKey(activePlayback);
  return {
    id: activePlaybackId,
    diagnostics: state.settings.playerDiagnostics === true,
    preferences: state.playerPreferences ?? {},
    position: key ? state.playbackPositions?.[key] : undefined,
    request: activePlayback,
    canOpenExternal: Boolean(state.settings.playerPath.trim()),
    fullscreen: Boolean(mainWindow?.isFullScreen())
  };
}

function configureAppSession(): void {
  const isolated = session.fromPartition(APP_PARTITION);
  isolated.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  const filter = { urls: ["http://*/*", "https://*/*"] };
  isolated.webRequest.onBeforeSendHeaders(filter, (details, callback) => {
    callback({ requestHeaders: isPlaybackRequest(details.resourceType) ? withPlaybackReferrer(details.requestHeaders, activePlayback?.referrer) : details.requestHeaders });
  });
  isolated.webRequest.onHeadersReceived(filter, (details, callback) => {
    callback({ responseHeaders: isPlaybackRequest(details.resourceType) ? withMediaCors(details.responseHeaders) : details.responseHeaders });
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
  const win = mainWindow;
  if (!win || win.isDestroyed()) throw new Error("The app window is not available");
  const fresh = !playerActive;
  activePlayback = request;
  activePlaybackId = randomUUID();
  const id = activePlaybackId;
  diagnostics.record(id, { event: "session-start", version: app.getVersion() });
  if (videoRenderingPolicy.directCompositionDisabled) {
    diagnostics.record(id, { event: "video-render-policy", platform: "win32", enabled: true,
      reason: "direct-composition-disabled" });
  }
  playbackSessions.set(id, request);
  if (playbackSessions.size > 8) playbackSessions.delete(playbackSessions.keys().next().value!);
  if (request.episode) await store.recordHistory({ ...request.episode.entry, completed: false });
  win.webContents.send("player:load", playerPayload());
  // Preserve the viewer's window mode when moving between episodes; only a fresh session starts fullscreen.
  if (fresh && settings.startPlayerFullscreen && !win.isFullScreen()) {
    diagnostics.record(id, { event: "fullscreen-request", fullscreen: true });
    void setPlayerFullscreen(win, true).catch((error: unknown) => {
      diagnostics.record(id, { event: "fullscreen-error" });
      if (!win.isDestroyed()) win.webContents.send("player:notice", error instanceof Error ? error.message : "Fullscreen could not be entered");
    });
  }
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
    fullscreenable: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      partition: APP_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  const win = mainWindow;
  const logWindow = (event: string) => {
    if (win.isDestroyed() || !activePlayback) return;
    const [width, height] = win.getContentSize();
    diagnostics.record(activePlaybackId, { event, width, height, fullscreen: win.isFullScreen() });
  };
  for (const event of ["enter-full-screen", "leave-full-screen", "resize", "focus", "blur", "unresponsive", "responsive"] as const) {
    win.on(event as "resize", () => logWindow(event));
  }
  win.webContents.on("render-process-gone", (_event, details) => {
    if (activePlayback) diagnostics.record(activePlaybackId, { event: "renderer-gone", reason: details.reason, exitCode: details.exitCode });
    playerActive = false; activePlayback = undefined; refreshMenu();
  });
  registerPlayerFullscreenEvents(win);

  win.once("ready-to-show", () => {
    if (!capturePath) win.show();
  });
  win.once("closed", () => {
    if (activePlayback) diagnostics.record(activePlaybackId, { event: "closed" });
    mainWindow = undefined; playerActive = false; activePlayback = undefined; playbackSessions.clear(); refreshMenu();
  });
  if (capturePath) {
    win.webContents.once("did-finish-load", () => {
      setTimeout(async () => {
        const image = await mainWindow?.webContents.capturePage();
        if (image) await writeFile(capturePath, image.toPNG());
        app.quit();
      }, 750);
    });
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => event.preventDefault());

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) void win.loadURL(developmentUrl);
  else void win.loadFile(join(__dirname, "../../dist/index.html"));
}

function registerIpc(): void {
  ipcMain.handle("app:icon", (event, pngDataUrl: unknown) => {
    assertPlayerSender(mainWindow, event);
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
  ipcMain.handle("state:settings", async (_event, settings: Settings) => {
    const state = await store.saveSettings(settings);
    const enabled = state.settings.playerDiagnostics === true;
    diagnostics.setEnabled(enabled);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("player:diagnostics-change", enabled);
    return state;
  });
  ipcMain.handle("player:open-logs", async (event) => {
    assertPlayerSender(mainWindow, event);
    await diagnostics.flush();
    await mkdir(diagnostics.directory, { recursive: true });
    const error = await shell.openPath(diagnostics.directory);
    if (error) throw new Error("Could not open the player logs folder");
  });
  ipcMain.handle("state:bookmark", (_event, entry: LibraryEntry) => store.toggleBookmark(entry));
  ipcMain.handle("state:bookmark-remove", (_event, animeId: string) => store.removeBookmark(String(animeId)));
  ipcMain.handle("state:history", (_event, entry: LibraryEntry) => store.recordHistory(entry));
  ipcMain.handle("state:history-remove", (_event, animeId: string) => store.removeHistory(String(animeId)));
  ipcMain.handle("state:history-clear", () => store.clearHistory());
  ipcMain.handle("state:remap", (_event, oldAnimeId: string, replacement) => store.remapEntry(oldAnimeId, replacement));
  ipcMain.handle("state:link-sources", (_event, sourceIds: string[]) => store.linkSources(sourceIds));
  ipcMain.handle("state:merge-entries", (_event, firstAnimeId: string, secondAnimeId: string) => store.mergeEntries(firstAnimeId, secondAnimeId));
  ipcMain.handle("state:dismiss-merge", (_event, firstAnimeId: string, secondAnimeId: string) => store.dismissMerge(firstAnimeId, secondAnimeId));
  ipcMain.handle("player:play", async (event, request: PlayRequest) => {
    assertPlayerSender(mainWindow, event);
    const validated = validatePlayRequest(request);
    const settings = store.snapshot().settings;
    if (settings.playbackTarget === "external") await launchExternalPlayer(validated, settings);
    else await openBuiltinPlayer(validated, settings);
    return true;
  });
  ipcMain.handle("player:ready", (event) => { assertPlayerSender(mainWindow, event); return activePlayback ? playerPayload() : undefined; });
  ipcMain.handle("player:active", (event, active: unknown) => {
    assertPlayerSender(mainWindow, event);
    playerActive = active === true;
    if (!playerActive && activePlayback) { diagnostics.record(activePlaybackId, { event: "session-end" }); activePlayback = undefined; }
    refreshMenu();
  });
  ipcMain.on("player:diagnostic", (event, sessionId: unknown, record: unknown) => {
    try { assertPlayerSender(mainWindow, event); } catch { return; }
    if (typeof sessionId === "string" && playbackSessions.has(sessionId)) diagnostics.record(sessionId, record);
  });
  ipcMain.handle("player:fullscreen", async (event, fullscreen: unknown) => {
    assertPlayerSender(mainWindow, event);
    const id = activePlaybackId;
    diagnostics.record(id, { event: "fullscreen-request", fullscreen });
    try {
      const result = await setPlayerFullscreen(mainWindow, fullscreen);
      diagnostics.record(id, { event: "fullscreen-result", fullscreen: result });
      return result;
    } catch (error) {
      diagnostics.record(id, { event: "fullscreen-error" });
      throw error;
    }
  });
  ipcMain.handle("player:storage", async (event, sessionId: string, update: unknown) => {
    assertPlayerSender(mainWindow, event);
    const request = playbackSessions.get(sessionId);
    if (!request) throw new Error("Unknown playback session");
    await store.savePlayerStorage(request, update);
  });
  ipcMain.handle("player:external", async (event) => {
    assertPlayerSender(mainWindow, event);
    await launchExternalPlayer(playerPayload().request, store.snapshot().settings);
    return true;
  });
}

app.whenReady().then(async () => {
  store = new StateStore(join(app.getPath("userData"), "state.json"));
  await store.load();
  diagnostics = new PlayerDiagnostics(join(app.getPath("userData"), "logs"));
  diagnostics.setEnabled(store.snapshot().settings.playerDiagnostics === true);
  app.setName("Ani Desktop");
  refreshMenu = installApplicationMenu(() => mainWindow, () => playerActive);
  configureAppSession();
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

let flushingDiagnostics = false;
app.on("before-quit", (event) => {
  if (flushingDiagnostics || !diagnostics) return;
  flushingDiagnostics = true;
  event.preventDefault();
  const timeout = setTimeout(() => app.quit(), 2000);
  void diagnostics.close().then(() => { clearTimeout(timeout); app.quit(); });
});
