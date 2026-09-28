import type { PlayerDiagnosticEvent } from "../shared/player-diagnostics";
import { CatalogService } from "./catalog-service";
import { ScheduleService } from "./schedule-service";
import { SeriesMetadataService } from "./series-metadata-service";
import { WorkInfoService } from "./work-info-service";
import { BackdropService } from "./backdrop-service";
import { IdentityIndex } from "./identity-index";
import { backfillLibraryIdentity } from "./identity-backfill";
import { validateSeriesMetadataRequest } from "./series-metadata-validation";
import { validateScheduleAnimeId, validateScheduleQuery } from "./schedule-validation";
import { catalogScope, sourceSettingsKey } from "../shared/settings";
import { catalogContext, catalogRequests } from "./catalog-requests";
import { EpisodeMetadataCache } from "./episode-metadata-cache";
import { BookmarkMetadataFetcher } from "./bookmark-metadata";
import { availabilityFresh } from "../shared/episode-metadata";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, Notification, session, shell } from "electron";
import { CompanionService, MAX_COMPANION_BYTES } from "./companion-service";
import { EpisodeUpdates } from "./episode-updates";
import type { AnimeResult, CatalogRequest, LibraryEntry, PlayerSession, PlayRequest, ProviderName, ProviderPreference, ScheduleQuery, Settings, TranslationMode } from "../shared/contracts";
import { playerArguments } from "./player";
import { assertPlayerSender, registerPlayerFullscreenEvents, setPlayerFullscreen } from "./player-window";
import { isPlaybackRequest, validatePlayRequest, withMediaCors, withPlaybackReferrer } from "./playback-security";
import { getAvailability, getStreams, providerOrigin, searchOne } from "./scraper";
import { animeSources, expandWithLinks, sourceIds } from "../shared/catalog";
import { refsOf, unique } from "../shared/identity";
import { StateStore } from "./state";
import { installApplicationMenu } from "./menu";
import { PlayerDiagnostics, sanitizeDiagnostic } from "./player-diagnostics";
import { playbackKey } from "../shared/playback";
import { configureVideoRenderingPolicy } from "./video-rendering-policy";
import { isHexColor, resolveTheme } from "../shared/theme";
import { isAllowedExternalUrl } from "../shared/external-url";
import { UpdateService } from "./update-service";
import { LATEST_RELEASE_URL } from "../shared/update";
import { validateUpdateCheck, validateUpdateVersion } from "./update-validation";
import { UpdateInstaller, updateInstallCapability } from "./update-installer";
import { loadSparkle } from "./sparkle";
import { downloadReleaseAsset } from "./update-download";
import { autoUpdater } from "electron-updater";
import { BrowseService } from "./browse-service";
import { BrowseDiscovery } from "./browse-discovery";
import { validateBrowseIdentity, validateBrowseQuery, validateKnownCandidate } from "./browse-validation";
import { subtitlePreferences } from "../shared/subtitle-language";

// Preserve existing settings and library data across the display-name change.
app.setPath("userData", join(app.getPath("appData"), app.isPackaged ? "Ani Desktop" : "ani-desktop"));

// Electron requires Chromium switches to be installed synchronously before app readiness.
const videoRenderingPolicy = configureVideoRenderingPolicy(app.commandLine);
const updateService = new UpdateService(join(app.getPath("userData"), "update-check.json"), app.getVersion(), app.isPackaged);

let mainWindow: BrowserWindow | undefined;
let activePlayback: PlayRequest | undefined;
let activePlaybackId = "";
let playerActive = false;
const playbackSessions = new Map<string, PlayRequest>();
let store: StateStore;
let diagnostics: PlayerDiagnostics;
let updateInstaller: UpdateInstaller;
let episodeMetadata: EpisodeMetadataCache;
let bookmarkMetadata: BookmarkMetadataFetcher;
let episodeUpdates: EpisodeUpdates;
const companionService = new CompanionService(join(app.getPath("userData"), "companions"));
let refreshMenu: () => void = () => undefined;
// In-memory partition: stream segments never reach the disk cache, and the renderer gets no permissions.
const APP_PARTITION = "ani-desktop";

const catalogService = new CatalogService();
const seriesMetadataService = new SeriesMetadataService(
  (sourceId, config) => catalogService.cachedEpisodeCount(sourceId, config),
  (sourceId, config) => catalogService.availableEpisodeCount(sourceId, config)
);
const scheduleService = new ScheduleService();
const workInfoService = new WorkInfoService();
const backdropService = new BackdropService();
const browseService = new BrowseService();
const browseDiscovery = new BrowseDiscovery();
let identityIndex: IdentityIndex;
const backfill = new AbortController();
/** References the library depends on; the information cache never evicts them. */
const libraryRefs = () => {
  const state = store.snapshot();
  return new Set([...state.bookmarks, ...state.history].flatMap((entry) => refsOf(store.withWork({ id: entry.animeId, title: entry.title, provider: animeSources(entry)[0].provider, sources: animeSources(entry) }))));
};
/** Candidate works for a search from the metadata service, when it is on. The local index answers separately, per grouping pass. */
const searchCandidates = (query: string) => store.snapshot().settings.animeInfo !== false ? workInfoService.candidates(query, true) : Promise.resolve([]);
const localCandidates = (query: string, titles: string[]) => store.snapshot().settings.offlineIndex ? identityIndex.candidatesForSearch(query, titles) : [];
const catalogConsumers = new Map<string, AbortController>();
const catalogSenders = new WeakSet<Electron.WebContents>();
function catalogCall<T>(event: Electron.IpcMainInvokeEvent, request: CatalogRequest | undefined, operation: (update: (value: unknown) => void) => Promise<T>): Promise<T> {
  assertPlayerSender(mainWindow, event);
  if (request && (typeof request.id !== "string" || request.id.length > 200)) throw new Error("Invalid catalog request");
  const key = `${event.sender.id}:${request?.id ?? randomUUID()}`;
  catalogConsumers.get(key)?.abort();
  const controller = new AbortController();
  catalogConsumers.set(key, controller);
  if (!catalogSenders.has(event.sender)) {
    catalogSenders.add(event.sender);
    const senderId = event.sender.id;
    event.sender.once("destroyed", () => { for (const [id, consumer] of catalogConsumers) if (id.startsWith(`${senderId}:`)) consumer.abort(); });
  }
  const priority = request?.priority === "playback" ? 0 : request?.priority === "selected" ? 1 : request?.priority === "nearby" ? 3 : 2;
  return catalogContext.run({ signal: controller.signal, priority, refresh: request?.refresh, recoveryChecks: request?.checkNow === true ? new Set() : undefined, scope: catalogScope(store.snapshot().settings) }, async () => {
    try {
      return await operation((value) => {
        if (request && !controller.signal.aborted && !event.sender.isDestroyed()) event.sender.send("catalog:update", { id: request.id, value });
      });
    } finally {
      if (catalogConsumers.get(key) === controller) catalogConsumers.delete(key);
    }
  });
}

function playerPayload(): PlayerSession {
  if (!activePlayback) throw new Error("No stream has been assigned to the player");
  const state = store.snapshot();
  const key = playbackKey(activePlayback);
  return {
    id: activePlaybackId,
    diagnostics: state.settings.playerDiagnostics === true,
    preferences: { ...state.playerPreferences, ...subtitlePreferences(state.settings.subtitleLanguage) },
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
  updateService.opened();
  const capturePath = !app.isPackaged ? process.env.ANI_DESKTOP_CAPTURE_PATH : undefined;
  const icon = nativeImage.createFromPath(join(__dirname, "../icon.png"));
  const settings = store.snapshot().settings;
  const colours = resolveTheme(settings.theme, settings.customTheme);
  if (process.platform === "darwin") app.dock?.setIcon(icon);
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 920,
    minHeight: 620,
    backgroundColor: colours.background,
    title: "ANIdesktop",
    // Extend the renderer to the top edge; the existing header hosts the native controls.
    ...(process.platform === "darwin" ? {
      titleBarStyle: "hiddenInset" as const,
      trafficLightPosition: { x: 20, y: 27 }
    } : {
      titleBarStyle: "hidden" as const,
      titleBarOverlay: { color: colours.background, symbolColor: colours.text, height: 68 },
      autoHideMenuBar: true
    }),
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
  const logWindow = (event: PlayerDiagnosticEvent) => {
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
    if (isAllowedExternalUrl(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event) => event.preventDefault());

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) void win.loadURL(developmentUrl);
  else void win.loadFile(join(__dirname, "../../dist/index.html"));
}

function registerIpc(): void {
  ipcMain.handle("companion:list", (event) => { assertPlayerSender(mainWindow, event); return companionService.list(); });
  ipcMain.handle("companion:choose", async (event) => {
    assertPlayerSender(mainWindow, event);
    const result = await dialog.showOpenDialog(mainWindow!, { title: "Import companion spritesheet", properties: ["openFile"], filters: [{ name: "PNG or WebP images", extensions: ["png", "webp"] }] });
    if (result.canceled || !result.filePaths[0]) return undefined;
    if ((await stat(result.filePaths[0])).size > MAX_COMPANION_BYTES) throw new Error("Companion sheet must be 8 MB or smaller");
    return companionService.stage(await readFile(result.filePaths[0]));
  });
  ipcMain.handle("companion:save", (event, ticket: unknown, name: unknown) => { assertPlayerSender(mainWindow, event); return companionService.commit(ticket, name); });
  ipcMain.handle("companion:image", (event, id: unknown) => { assertPlayerSender(mainWindow, event); return companionService.image(id); });
  ipcMain.handle("companion:remove", async (event, id: unknown) => {
    assertPlayerSender(mainWindow, event);
    const record = (await companionService.list()).find((item) => item.id === id);
    if (!record) return false;
    const answer = await dialog.showMessageBox(mainWindow!, { type: "warning", buttons: ["Cancel", "Remove"], defaultId: 0, cancelId: 0,
      title: "Remove custom companion?", message: `Remove ${record.name} from ANIdesktop?`, detail: "Your original PNG or WebP file is not changed. You can import it again later." });
    if (answer.response !== 1) return false;
    const removed = await companionService.remove(id);
    if (removed && store.snapshot().settings.companionPetId === id) await store.saveSettings({ ...store.snapshot().settings, companionPetId: "columbinya" });
    return removed;
  });
  ipcMain.on("app:titlebar-theme", (event, background: unknown, text: unknown) => {
    assertPlayerSender(mainWindow, event);
    if (!isHexColor(background) || !isHexColor(text)) return;
    if (process.platform === "win32" || process.platform === "linux") {
      mainWindow.setTitleBarOverlay({ color: background, symbolColor: text });
    }
  });
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
  ipcMain.handle("app:update-check", (event, force: unknown) => {
    assertPlayerSender(mainWindow, event);
    return updateService.check(validateUpdateCheck(force));
  });
  ipcMain.handle("app:update-dismiss", (event, version: unknown) => {
    assertPlayerSender(mainWindow, event);
    return updateService.dismiss(validateUpdateVersion(version));
  });
  ipcMain.handle("app:update-open", async (event) => {
    assertPlayerSender(mainWindow, event);
    await shell.openExternal(LATEST_RELEASE_URL);
  });
  ipcMain.handle("app:update-install-status", (event) => {
    assertPlayerSender(mainWindow, event);
    return updateInstaller.snapshot();
  });
  ipcMain.handle("app:update-download", (event, version: unknown) => {
    assertPlayerSender(mainWindow, event);
    return updateInstaller.download(validateUpdateVersion(version));
  });
  ipcMain.handle("app:update-install", async (event) => {
    assertPlayerSender(mainWindow, event);
    await updateInstaller.install();
  });
  // The renderer's session refuses every permission, clipboard writes included, so copying goes through here.
  ipcMain.handle("app:copy-text", (event, text: unknown) => {
    assertPlayerSender(mainWindow, event);
    if (typeof text !== "string" || !text || text.length > 2000) throw new Error("Invalid clipboard text");
    clipboard.writeText(text);
  });
  ipcMain.handle("app:backdrop", (event, kind: unknown) => {
    assertPlayerSender(mainWindow, event);
    if (kind !== "wide" && kind !== "portrait") throw new Error("Unknown backdrop kind");
    if (store.snapshot().settings.emptyBackdrop === false) return undefined;
    return backdropService.pick(kind);
  });
  ipcMain.on("catalog:cancel", (event, id: string) => {
    assertPlayerSender(mainWindow, event);
    catalogConsumers.get(`${event.sender.id}:${id}`)?.abort();
  });
  ipcMain.handle("catalog:source-status", (event) => {
    assertPlayerSender(mainWindow, event);
    const settings = store.snapshot().settings;
    return (["aniwave", "anidb", "hianime"] as const).map((provider) => {
      const origin = providerOrigin(provider, settings);
      return { provider, origin, ...catalogRequests.health.snapshot(origin) };
    });
  });
  ipcMain.handle("catalog:source-check", (event, provider: ProviderName, request?: CatalogRequest) => {
    if (!["aniwave", "anidb", "hianime"].includes(provider)) throw new Error("Unknown source provider");
    return catalogCall(event, { ...request, id: request?.id ?? randomUUID(), refresh: true, checkNow: true }, async () => {
      // Exercise the actual catalog endpoint through the shared recovery gate.
      await searchOne("naruto", provider, store.snapshot().settings);
    });
  });
  ipcMain.handle("catalog:schedule", (event, query: ScheduleQuery, request?: CatalogRequest) => {
    const validated = validateScheduleQuery(query);
    return catalogCall(event, request, () => scheduleService.get(validated, store.snapshot().settings));
  });
  ipcMain.handle("catalog:schedule-artwork", (event, animeId: unknown, request?: CatalogRequest) => {
    const validated = validateScheduleAnimeId(animeId);
    return catalogCall(event, request, () => scheduleService.getArtwork(validated, store.snapshot().settings));
  });
  ipcMain.handle("catalog:search", (event, query: string, provider: ProviderPreference | undefined, rawKnown: unknown, request?: CatalogRequest) => catalogCall(event, request, async (update) => {
    const state = store.snapshot();
    // A work the caller already identified joins every grouping pass, ahead of any title lookup.
    const known = validateKnownCandidate(rawKnown);
    const rows = await catalogService.search(query, state.settings, provider ?? "auto", [], update,
      { works: state.works, dismissed: state.dismissedMergeKeys, candidates: () => searchCandidates(query),
        localCandidates: (term, titles) => [...(known ? [known] : []), ...localCandidates(term, titles)] });
    // Confident groupings become remembered works, so the next search and the library know them without matching again.
    if (!catalogContext.getStore()?.signal.aborted) void store.recordBindings(rows).catch(() => undefined);
    return rows;
  }));
  ipcMain.handle("catalog:browse-genres", (event, request?: CatalogRequest) => catalogCall(event, request, () => {
    if (store.snapshot().settings.animeInfo === false) throw new Error("Enable Anime information in Settings to browse by genre");
    return browseService.genreOptions();
  }));
  ipcMain.handle("catalog:browse-tags", (event, request?: CatalogRequest) => catalogCall(event, request, () => {
    if (store.snapshot().settings.animeInfo === false) throw new Error("Enable Anime information in Settings to browse by genre");
    return browseService.tagOptions();
  }));
  ipcMain.handle("catalog:browse", (event, query: unknown, request?: CatalogRequest) => catalogCall(event, request, (update) => {
    if (store.snapshot().settings.animeInfo === false) throw new Error("Enable Anime information in Settings to browse by genre");
    return browseService.browse(validateBrowseQuery(query), update);
  }));
  ipcMain.handle("catalog:episodes", (event, anime: AnimeResult, request?: CatalogRequest) => catalogCall(event, request, async (update) => {
    const result = await catalogService.episodes(anime, store.snapshot().settings, update);
    const saved = store.snapshot().bookmarks;
    for (const group of result.groups) {
      if (group.error || group.refreshing) continue;
      const source = animeSources(anime).find((item) => item.provider === group.provider);
      const entry = source && saved.find((item) => animeSources(item).some((known) => known.id === source.id));
      if (entry && source && request?.refresh) await episodeUpdates.observe(entry, source.id, group.episodes, store.snapshot().settings);
    }
    return result;
  }));
  ipcMain.handle("catalog:browse-discover", (event, raw: unknown, request?: CatalogRequest) => catalogCall(event, request, async () => {
    const anime = validateBrowseIdentity(raw);
    const state = store.snapshot();
    const result = await browseDiscovery.discover(anime, state.settings, {
      works: state.works, refresh: request?.refresh,
      hints: state.settings.offlineIndex ? identityIndex.candidatesForRefs(anime.refs) : []
    });
    catalogContext.getStore()?.signal.throwIfAborted();
    if (result.anime) await store.recordBindings([result.anime]);
    return result;
  }));
  ipcMain.handle("catalog:series-metadata", (event, anime: AnimeResult, request?: CatalogRequest) => {
    const validated = validateSeriesMetadataRequest(anime);
    return catalogCall(event, request, (update) => seriesMetadataService.metadata(validated, store.snapshot().settings, update));
  });
  ipcMain.handle("catalog:resolve", (event, anime: AnimeResult, request?: CatalogRequest) => catalogCall(event, request, async (update) => {
    const state = store.snapshot();
    const linked = store.withWork(expandWithLinks(anime, state.providerLinks ?? []));
    // Titles the metadata service knows for this work raise the hit rate on providers that list the Japanese name.
    const known = workInfoService.cached(refsOf(linked));
    const synonyms = known ? unique([known.titles.romaji, known.titles.english, ...known.synonyms].filter((value): value is string => Boolean(value))) : [];
    const sources = animeSources(linked);
    const queryable = synonyms.length ? { ...linked, sources: sources.map((source, index) => index === 0 ? { ...source, aliases: unique([...source.aliases, ...synonyms]) } : source) } : linked;
    const { anime: resolved, confirmed, refs } = await catalogService.resolve(queryable, state.settings, update);
    if (confirmed.length || refs.length) await store.bindWork({ ids: [...sourceIds(linked), ...confirmed], refs, title: resolved.title, sources: resolved.sources ?? [] });
    return { ...resolved, sources: resolved.sources?.map((source) => sources.find((item) => item.id === source.id) ?? source) };
  }));
  ipcMain.handle("catalog:work-info", (event, anime: AnimeResult, request?: CatalogRequest) => {
    const validated = validateSeriesMetadataRequest(anime);
    return catalogCall(event, request, async (update) => {
      const settings = store.snapshot().settings;
      const linked = store.withWork(validated);
      const result = await workInfoService.info(linked, { enabled: settings.animeInfo !== false, refresh: request?.refresh, protectedRefs: libraryRefs }, update);
      if (result.refs.length && !catalogContext.getStore()?.signal.aborted) {
        await store.bindWork({ ids: sourceIds(linked), refs: result.refs, title: linked.title, sources: animeSources(linked), type: result.info?.type, year: result.info?.year, episodes: result.info?.episodes });
      }
      return result.info;
    });
  });
  ipcMain.handle("identity:index-status", (event) => {
    assertPlayerSender(mainWindow, event);
    return identityIndex.status(store.snapshot().settings.offlineIndex === true);
  });
  ipcMain.handle("identity:index-update", async (event) => {
    assertPlayerSender(mainWindow, event);
    if (store.snapshot().settings.offlineIndex !== true) throw new Error("Turn on the offline title index and save settings first");
    return identityIndex.update();
  });
  ipcMain.handle("catalog:metadata", (event, episodeId: string) => {
    assertPlayerSender(mainWindow, event);
    if (typeof episodeId !== "string" || episodeId.length > 2048) throw new Error("Invalid episode identifier");
    return episodeMetadata.get(catalogScope(store.snapshot().settings), episodeId);
  });
  ipcMain.handle("catalog:metadata-clear", (event, ids: string[]) => {
    assertPlayerSender(mainWindow, event);
    if (!Array.isArray(ids) || ids.length > 20_000 || ids.some((id) => typeof id !== "string" || id.length > 2048)) throw new Error("Invalid episode identifiers");
    return episodeMetadata.clear(catalogScope(store.snapshot().settings), ids);
  });
  ipcMain.handle("catalog:bookmark-metadata", (event) => {
    assertPlayerSender(mainWindow, event);
    return bookmarkMetadata.start(store.snapshot());
  });
  ipcMain.handle("catalog:bookmark-metadata-status", (event) => {
    assertPlayerSender(mainWindow, event);
    return bookmarkMetadata.snapshot();
  });
  ipcMain.handle("catalog:bookmark-metadata-cancel", (event) => {
    assertPlayerSender(mainWindow, event);
    return bookmarkMetadata.cancel();
  });
  ipcMain.handle("catalog:streams", (event, episodeId: string, mode: TranslationMode, request?: CatalogRequest) => catalogCall(event, request, async () => {
    const settings = store.snapshot().settings, scope = catalogScope(settings), generation = episodeMetadata.generation;
    const streams = await getStreams(episodeId, mode, settings);
    if (!catalogContext.getStore()?.signal?.aborted && generation === episodeMetadata.generation) episodeMetadata.recordStreams(scope, episodeId, mode, streams);
    return streams;
  }));
  ipcMain.handle("catalog:availability", (event, episodeId: string, request?: CatalogRequest) => catalogCall(event, request, async () => {
    const settings = store.snapshot().settings, scope = catalogScope(settings), generation = episodeMetadata.generation;
    const cached = episodeMetadata.get(scope, episodeId)?.availability;
    if (!request?.refresh && availabilityFresh(cached)) return cached!;
    const availability = await getAvailability(episodeId, settings);
    if (!catalogContext.getStore()?.signal?.aborted && generation === episodeMetadata.generation) episodeMetadata.recordAvailability(scope, episodeId, availability);
    return availability;
  }));
  ipcMain.handle("state:get", () => store.snapshot());
  ipcMain.handle("state:subtitle-appearance", async (event, value: unknown) => {
    assertPlayerSender(mainWindow, event);
    return store.saveSubtitleAppearance(value);
  });
  ipcMain.handle("state:settings", async (event, settings: Settings) => {
    assertPlayerSender(mainWindow, event);
    if (settings.companionPetId?.startsWith("custom:") && !(await companionService.list()).some((item) => item.id === settings.companionPetId && item.available)) {
      throw new Error("Selected custom companion is unavailable");
    }
    const previous = store.snapshot().settings;
    const state = await store.saveSettings(settings);
    if (sourceSettingsKey(previous) !== sourceSettingsKey(state.settings)) bookmarkMetadata.cancel();
    if (catalogScope(previous) !== catalogScope(state.settings)) await episodeUpdates.resetSourceScope(state.bookmarks, state.settings);
    else if (sourceSettingsKey(previous) !== sourceSettingsKey(state.settings)) await episodeUpdates.prune(state.bookmarks, state.settings);
    if (state.settings.offlineIndex && !previous.offlineIndex && identityIndex.needsUpdate()) void identityIndex.update();
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
  ipcMain.handle("state:bookmark", async (_event, entry: LibraryEntry) => {
    const state = await store.toggleBookmark(entry); episodeUpdates.seed(state.bookmarks, state.settings);
    await episodeUpdates.prune(state.bookmarks, state.settings); return state;
  });
  ipcMain.handle("episode-updates:status", (event) => { assertPlayerSender(mainWindow, event); return episodeUpdates.snapshot(store.snapshot().settings); });
  ipcMain.handle("episode-updates:check", (event, force: unknown) => {
    assertPlayerSender(mainWindow, event);
    if (force !== undefined && typeof force !== "boolean") throw new Error("Invalid update check");
    const state = store.snapshot();
    return episodeUpdates.check(state.bookmarks, state.settings, force === true);
  });
  ipcMain.handle("episode-updates:dismiss", (event, id: unknown) => {
    assertPlayerSender(mainWindow, event);
    if (id !== undefined && (typeof id !== "string" || id.length > 8192)) throw new Error("Invalid episode update");
    return episodeUpdates.dismiss(id as string | undefined, store.snapshot().settings);
  });
  ipcMain.handle("episode-updates:mark-read", (event, id: unknown) => {
    assertPlayerSender(mainWindow, event);
    if (id !== undefined && (typeof id !== "string" || !id || id.length > 8192)) throw new Error("Invalid episode update");
    return episodeUpdates.markRead(id as string | undefined, store.snapshot().settings);
  });
  ipcMain.handle("state:bookmark-remove", async (_event, animeId: string) => {
    const state = await store.removeBookmark(String(animeId)); await episodeUpdates.prune(state.bookmarks, state.settings); return state;
  });
  ipcMain.handle("state:history", (_event, entry: LibraryEntry) => store.recordHistory(entry));
  ipcMain.handle("state:history-remove", (_event, animeId: string) => store.removeHistory(String(animeId)));
  ipcMain.handle("state:history-clear", () => store.clearHistory());
  ipcMain.handle("state:link-sources", (_event, sourceIds: string[]) => store.linkSources(sourceIds));
  ipcMain.handle("state:split-source", (_event, sourceId: string) => store.splitSource(String(sourceId)));
  ipcMain.handle("state:clear-links", () => store.clearSourceLinks());
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
    const validated = sanitizeDiagnostic(record);
    if (typeof sessionId === "string" && playbackSessions.has(sessionId) && validated) diagnostics.record(sessionId, validated);
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
  let sparkle: ReturnType<typeof loadSparkle>;
  try { sparkle = loadSparkle(app.isPackaged, process.platform, process.resourcesPath); }
  catch { console.error("Sparkle could not load; using manual DMG updates."); }
  const capability = updateInstallCapability(app.isPackaged, process.platform, process.arch, process.env.APPIMAGE, !!sparkle);
  const backend = capability.mode === "automatic" ? autoUpdater : undefined;
  if (backend) {
    backend.autoDownload = false;
    backend.autoInstallOnAppQuit = false;
    backend.autoRunAppAfterInstall = true;
    backend.allowPrerelease = false;
    backend.allowDowngrade = false;
  }
  updateInstaller = new UpdateInstaller({
    capability, currentVersion: app.getVersion(), backend, nativeCheck: sparkle?.check,
    publish: (status) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("app:update-install-status", status); },
    manualDownload: async (version, progress) => {
      const asset = await updateService.asset(version, process.platform, process.arch);
      return downloadReleaseAsset(session.fromPartition("ani-updates"), app.getPath("downloads"), asset, progress);
    },
    // Linux fallback is a manual replacement, so reveal the AppImage instead of running a second app.
    openFile: async (path) => {
      if (process.platform === "linux") { shell.showItemInFolder(path); return ""; }
      return shell.openPath(path);
    },
    beforeInstall: async () => {
      if (process.platform === "linux") {
        const path = process.env.APPIMAGE;
        if (!path || !isAbsolute(path)) throw new Error("Run the installed AppImage before updating.");
        try { await access(path, constants.W_OK); await access(dirname(path), constants.W_OK); }
        catch { throw new Error("Move the AppImage to a writable folder, relaunch it, then try again."); }
      }
      await Promise.all([store.flush(), diagnostics.flush(), episodeMetadata.flush(), catalogService.flush(), seriesMetadataService.flush(), workInfoService.flush(), browseService.flush()]);
    }
  });
  backend?.on("download-progress", (progress) => updateInstaller.progress(progress.percent));
  backend?.on("error", () => updateInstaller.failed());
  store = new StateStore(join(app.getPath("userData"), "state.json"));
  await store.load();
  await companionService.load();
  const selectedCompanion = store.snapshot().settings.companionPetId;
  if (selectedCompanion?.startsWith("custom:") && !(await companionService.list()).some((item) => item.id === selectedCompanion && item.available)) {
    await store.saveSettings({ ...store.snapshot().settings, companionPetId: "columbinya" });
  }
  await catalogService.load(join(app.getPath("userData"), "episode-lists.json"));
  if (process.platform === "win32") app.setAppUserModelId("dev.hanifi.anidesktop");
  episodeUpdates = new EpisodeUpdates(join(app.getPath("userData"), "episode-updates.json"),
    (sourceId, settings) => catalogService.cachedEpisodes(sourceId, settings),
    async (sourceId, settings) => catalogContext.run({ signal: new AbortController().signal, priority: 3, refresh: true, scope: catalogScope(settings) }, async () => {
      const entry = store.snapshot().bookmarks.find((saved) => animeSources(saved).some((source) => source.id === sourceId));
      const source = entry && animeSources(entry).find((item) => item.id === sourceId);
      if (!source) throw new Error("Saved source unavailable");
      const result = await catalogService.episodes({ id: source.id, provider: source.provider, title: source.title, sources: [source] }, settings);
      const group = result.groups.find((item) => item.provider === source.provider);
      if (!group || group.error) throw new Error(group?.error ?? "Episode list unavailable");
      return group.episodes;
    }),
    (status) => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("episode-updates:change", status); },
    (updates) => {
      if (!Notification.isSupported() || !mainWindow || mainWindow.isDestroyed()) return;
      try {
        const notification = new Notification({ title: updates.length === 1 ? `New episode: ${updates[0].title}` : `${updates.length} new anime episodes`,
          body: updates.length === 1 ? `Episode ${updates[0].episodeNumber} · ${updates[0].provider}` : "Open ANIdesktop to see your updates." });
        notification.on("click", () => { mainWindow?.show(); mainWindow?.focus(); mainWindow?.webContents.send("episode-updates:open"); });
        notification.show();
      } catch { /* The bell retains updates if desktop notifications are unavailable. */ }
    });
  await episodeUpdates.load();
  episodeUpdates.seed(store.snapshot().bookmarks, store.snapshot().settings);
  await seriesMetadataService.load(join(app.getPath("userData"), "series-metadata.json"));
  await workInfoService.load(join(app.getPath("userData"), "work-info.json"));
  await backdropService.load(join(app.getPath("userData"), "backdrops"));
  await browseService.load(join(app.getPath("userData"), "browse-cache.json"));
  identityIndex = new IdentityIndex(join(app.getPath("userData"), "title-index.json"));
  await identityIndex.load();
  if (store.snapshot().settings.offlineIndex && identityIndex.needsUpdate()) void identityIndex.update();
  episodeMetadata = new EpisodeMetadataCache(join(app.getPath("userData"), "episode-metadata.json"));
  bookmarkMetadata = new BookmarkMetadataFetcher(catalogService, episodeMetadata);
  await episodeMetadata.load();
  await catalogRequests.health.load(join(app.getPath("userData"), "source-health.json"));
  diagnostics = new PlayerDiagnostics(join(app.getPath("userData"), "logs"));
  diagnostics.setEnabled(store.snapshot().settings.playerDiagnostics === true);
  app.setName("ANIdesktop");
  refreshMenu = installApplicationMenu(() => mainWindow, () => playerActive);
  configureAppSession();
  registerIpc();
  if (!app.isPackaged && process.env.ANI_DESKTOP_SMOKE_QUERY) {
    const config = store.snapshot().settings;
    const results = await catalogService.search(process.env.ANI_DESKTOP_SMOKE_QUERY, config, config.preferredProvider);
    if (results.length === 0) throw new Error("Smoke test search returned no results");
    const catalog = await catalogService.episodes(results[0], config);
    const episodes = catalog.groups.find((group) => group.episodes.length)?.episodes ?? [];
    if (episodes.length === 0) throw new Error("Smoke test found no episodes");
    const streams = await getStreams(episodes[0].id, "sub", config);
    if (streams.length === 0) throw new Error("Smoke test found no streams");
    console.log(JSON.stringify({ title: results[0].title, results: results.length, episodes: episodes.length, qualities: streams.map((stream) => stream.quality) }));
    app.quit();
    return;
  }
  createWindow();
  const checkSaved = () => { const state = store.snapshot(); void episodeUpdates.check(state.bookmarks, state.settings).catch(() => undefined); };
  setTimeout(checkSaved, 10_000).unref();
  setInterval(checkSaved, 60 * 60_000).unref();
  app.on("browser-window-focus", checkSaved);
  // Library entries from before identity learn their references a little after start, well behind interactive work.
  setTimeout(() => { void backfillLibraryIdentity(store, workInfoService, backfill.signal).catch(() => undefined); }, 20_000).unref();
  app.on("activate", () => {
    if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  });
}).catch((error: unknown) => {
  console.error(error);
  app.exit(1);
});

// The app has one window, so closing it quits on every platform. This also finishes a macOS quit
// that closed the window after its quit was reset, which otherwise leaves the app in the Dock.
app.on("window-all-closed", () => app.quit());

let flushingDiagnostics = false;
app.on("before-quit", (event) => {
  if (flushingDiagnostics || !diagnostics) return;
  flushingDiagnostics = true;
  event.preventDefault();
  bookmarkMetadata.cancel();
  backfill.abort();
  const timeout = setTimeout(() => app.quit(), 2000);
  void Promise.allSettled([store.flush(), diagnostics.close(), episodeMetadata.flush(), catalogService.flush(), episodeUpdates.flush(), seriesMetadataService.flush(), workInfoService.flush(), browseService.flush(), catalogRequests.health.flush()]).then(() => { clearTimeout(timeout); app.quit(); });
});
