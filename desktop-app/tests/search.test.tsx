// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { AniDesktopApi, AnimeResult, BrowseDiscoveryResult, PersistedState, PlayerSession } from "../shared/contracts";
import { THEME_PRESETS } from "../shared/theme";
import { validateSeriesMetadataRequest } from "../electron/series-metadata-validation";

const result = (title: string): AnimeResult[] => [{ id: `aniwave:${title}-1`, title, provider: "aniwave" }];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
let container: HTMLDivElement;
let root: Root;
let state: PersistedState;
let search: ReturnType<typeof vi.fn<AniDesktopApi["search"]>>;
let api: AniDesktopApi;
let load: (session: PlayerSession) => void;
const playerStub = vi.hoisted(() => ({ props: undefined as Record<string, unknown> | undefined }));
vi.mock("../src/PlayerScreen", async () => {
  const React = await import("react");
  return { default: (props: { session: { request: { title: string } }; docked: boolean; corner: string; onCornerChange: (corner: string) => void; width: number; onWidthChange: (width: number) => void; episodeCount?: number; onDock: () => void; onExpand: () => void; onClose: () => void; onEpisodes: () => void; onNext?: () => void; onPrev?: () => void }) => {
    playerStub.props = props;
    React.useEffect(() => { void window.aniDesktop.player.setActive(true); return () => { void window.aniDesktop.player.setActive(false); }; }, []);
    return <div data-testid="player" data-docked={props.docked} data-corner={props.corner} data-width={props.width}>{props.session.request.title}{props.episodeCount ? ` of ${props.episodeCount}` : ""}
      <button type="button" onClick={props.onDock}>dock player</button><button type="button" onClick={props.onEpisodes}>playing episodes</button>
      <button type="button" onClick={props.onClose}>close player</button><button type="button" onClick={() => props.onCornerChange("top-left")}>move player</button><button type="button" onClick={() => props.onWidthChange(333)}>resize player</button>
      <button type="button" disabled={!props.onNext} onClick={props.onNext}>next episode</button></div>;
  } };
});
const input = () => container.querySelector("input")!;
const titles = () => [...container.querySelectorAll(".section-results .t")].map((node) => node.textContent);
async function type(value: string, field = input()) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function advance(ms = 300) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function press(key: string) {
  await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });
}
async function enter(options: KeyboardEventInit = {}) {
  await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...options })); });
}
async function backFromSeries() {
  await act(async () => { container.querySelector<HTMLButtonElement>(".series .crumb")!.click(); });
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((node) => node.textContent === text)!;
  expect(button).toBeDefined();
  await act(async () => { button.click(); });
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  state = {
    bookmarks: [], history: [],
    settings: {
      playerPath: "mpv", playbackTarget: "builtin", startPlayerFullscreen: true, preferredQuality: "best", preferredMode: "sub", preferredProvider: "auto",
      aniwaveBaseUrl: "https://aniwaves.ru", anidbBaseUrl: "https://anidb.app", hianimeBaseUrl: "https://hianimes.se",
      theme: "graphite", customTheme: { ...THEME_PRESETS.graphite }
    }
  };
  search = vi.fn<AniDesktopApi["search"]>().mockImplementation(async (query) => result(query));
  api = {
    player: {
      ready: vi.fn().mockResolvedValue(undefined), onLoad: vi.fn((listener) => { load = listener; return vi.fn(); }),
      onFullscreenChange: vi.fn(() => vi.fn()), onCommand: vi.fn(() => vi.fn()), onNotice: vi.fn(() => vi.fn()), onDiagnosticsChange: vi.fn(() => vi.fn()),
      logDiagnostic: vi.fn(), saveStorage: vi.fn().mockResolvedValue(undefined), setFullscreen: vi.fn(async (fullscreen: boolean) => fullscreen),
      openExternal: vi.fn().mockResolvedValue(true), setActive: vi.fn().mockResolvedValue(undefined)
    },
    listCompanions: vi.fn().mockResolvedValue([]), chooseCompanion: vi.fn().mockResolvedValue(undefined),
    saveCompanion: vi.fn(), companionImage: vi.fn().mockResolvedValue(undefined), removeCompanion: vi.fn().mockResolvedValue(false),
    discoverBrowse: vi.fn(async (anime) => ({ anime: { ...result(anime.title)[0], refs: anime.refs }, errors: {} })),
    search, browseGenres: vi.fn().mockResolvedValue([]), browseTags: vi.fn().mockResolvedValue([]), browse: vi.fn(async (query) => ({ query, entries: [], hasNextPage: false, fetchedAt: Date.now() })), resolveSources: vi.fn(async (anime) => anime), clearSourceLinks: vi.fn(), getState: vi.fn().mockResolvedValue(state),
    workInfo: vi.fn().mockResolvedValue(undefined), identityIndexStatus: vi.fn().mockResolvedValue({ enabled: false, entries: 0, updating: false }), updateIdentityIndex: vi.fn(), splitSource: vi.fn(), episodes: vi.fn().mockResolvedValue({ groups: [{ provider: "aniwave", episodes: [{ id: "ep-1", number: "1", provider: "aniwave" }] }] }),
    seriesMetadata: vi.fn().mockResolvedValue({ sources: [], genres: [] }),
    episodeMetadata: vi.fn().mockResolvedValue(undefined), clearEpisodeMetadata: vi.fn().mockResolvedValue(undefined),
    sourceStatus: vi.fn().mockResolvedValue([]), checkSource: vi.fn().mockResolvedValue(undefined), fetchBookmarkMetadata: vi.fn(),
    schedule: vi.fn<AniDesktopApi["schedule"]>(async (query) => ({ provider: "aniwave", requestedDate: query.date, entries: [], refreshedAt: new Date().toISOString(), status: "unavailable" })),
    scheduleArtwork: vi.fn(async (animeId) => ({ animeId, aliases: [] })),
    backdropArt: vi.fn(async () => undefined),
    bookmarkMetadataStatus: vi.fn().mockResolvedValue(undefined), cancelBookmarkMetadata: vi.fn(),
    availability: vi.fn().mockResolvedValue({ sub: true, dub: true, checkedAt: Date.now() }), cancelCatalog: vi.fn(),
    streams: vi.fn().mockResolvedValue([]), play: vi.fn().mockResolvedValue(true),
    saveSettings: vi.fn(async (settings) => ({ ...state, settings })),
    saveSubtitleAppearance: vi.fn(async (appearance) => appearance),
    openPlayerLogs: vi.fn().mockResolvedValue(undefined),
    episodeUpdates: vi.fn().mockResolvedValue({ updates: [], unreadCount: 0, counts: {}, latestByAnime: {}, checking: false }),
    checkEpisodeUpdates: vi.fn().mockResolvedValue({ updates: [], unreadCount: 0, counts: {}, latestByAnime: {}, checking: false }),
    dismissEpisodeUpdate: vi.fn().mockResolvedValue({ updates: [], unreadCount: 0, counts: {}, latestByAnime: {}, checking: false }),
    markEpisodeUpdateRead: vi.fn().mockResolvedValue({ updates: [], unreadCount: 0, counts: {}, latestByAnime: {}, checking: false }),
    onEpisodeUpdatesChange: vi.fn().mockReturnValue(() => {}),
    onOpenEpisodeUpdates: vi.fn().mockReturnValue(() => {}),
    checkForUpdates: vi.fn().mockResolvedValue({ currentVersion: "development", state: "development" }),
    dismissUpdate: vi.fn().mockResolvedValue({ currentVersion: "development", state: "development" }),
    openLatestRelease: vi.fn().mockResolvedValue(undefined),
    getUpdateInstallStatus: vi.fn().mockResolvedValue({ mode: "unsupported", phase: "idle", detail: "Development" }),
    onUpdateInstallStatus: vi.fn().mockReturnValue(() => {}),
    downloadUpdate: vi.fn(),
    installUpdate: vi.fn(),
    copyText: vi.fn().mockResolvedValue(undefined),
    setAppIcon: vi.fn().mockResolvedValue(undefined),
    toggleBookmark: vi.fn(), removeBookmark: vi.fn(), recordHistory: vi.fn(), removeHistory: vi.fn(), clearHistory: vi.fn(),
    linkSources: vi.fn(), mergeEntries: vi.fn(), dismissMerge: vi.fn()
  };
  window.aniDesktop = api;
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => { root.render(<StrictMode><App /></StrictMode>); });
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove();
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("site footer navigation", () => {
  it("moves between screens, marks the current one, and keeps the search available", async () => {
    expect(container.querySelector(".site-footer")).not.toBeNull();
    expect(container.querySelector('.footer-link[aria-current="page"]')?.textContent).toBe("Home");
    await click("Saved");
    expect(container.querySelector(".page-saved")).not.toBeNull();
    expect(container.querySelector('.footer-link[aria-current="page"]')?.textContent).toBe("Saved");
    expect(input()).not.toBeNull();
    await click("Settings");
    expect(container.querySelector(".page-settings")).not.toBeNull();
    expect(container.querySelector(".search.as-button")?.textContent).toContain("Search anime");
    await click("Home");
    expect(container.querySelector(".page-home")).not.toBeNull();
  });
});

describe("companion contextual dialogue", () => {
  async function remountWithEpisodeUpdate() {
    await act(async () => root.unmount());
    const entry = { animeId: "aniwave:show-1", title: "Show", lastEpisode: "12", mode: "sub" as const, updatedAt: new Date().toISOString(), lastProvider: "aniwave" as const };
    state.history = [entry];
    state.bookmarks = [entry];
    vi.mocked(api.episodeUpdates).mockResolvedValue({ updates: [{ id: "update-13", animeId: entry.animeId, sourceId: entry.animeId, provider: "aniwave", title: "Show", episodeId: "aniwave:show-1:13", episodeNumber: "13", detectedAt: Date.now() - 1_000 }], unreadCount: 1, counts: {}, latestByAnime: {}, checking: false });
    root = createRoot(container);
    await act(async () => root.render(<StrictMode><App /></StrictMode>));
  }
  it("shows the startup update then a dismissible continue prompt without autoplay", async () => {
    await remountWithEpisodeUpdate();
    expect(container.querySelector(".companion-bubble")?.textContent).toContain("Episode 13 of Show is new");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Dismiss companion message"]')!.click());
    expect(container.querySelector(".companion-bubble")?.textContent).toContain("continue Show");
    await click("Continue");
    expect(container.querySelector(".series")).not.toBeNull();
    expect(api.play).not.toHaveBeenCalled();
  });
  it("opens the notified episode focused without autoplay", async () => {
    await remountWithEpisodeUpdate();
    await click("View episode");
    expect(container.querySelector(".series")).not.toBeNull();
    expect(container.querySelector(".companion-bubble")?.textContent).toContain("Show");
    expect(api.markEpisodeUpdateRead).toHaveBeenCalledWith("update-13");
    expect(api.play).not.toHaveBeenCalled();
  });
  it("announces a saved anime even when opening it refreshes episodes", async () => {
    await act(async () => root.unmount());
    state.bookmarks = [{ animeId: "aniwave:saved-1", title: "Saved Anime", lastEpisode: "2", mode: "sub", updatedAt: new Date().toISOString() }];
    root = createRoot(container);
    await act(async () => root.render(<StrictMode><App /></StrictMode>));
    await act(async () => container.querySelector<HTMLButtonElement>(".section-saved .hit")!.click());
    expect(container.querySelector(".series")).not.toBeNull();
    expect(container.querySelector(".companion-bubble")?.textContent).toContain("Saved Anime");
  });
  it("cancels the remaining startup prompt when navigating away", async () => {
    await remountWithEpisodeUpdate();
    await click("Saved");
    expect(container.querySelector(".companion-bubble")?.textContent).toContain("saved");
    await advance(10_100);
    expect(container.querySelector(".companion-bubble")?.textContent ?? "").not.toContain("continue Show");
  });
  it("announces an episode discovered by the delayed startup check", async () => {
    await act(async () => root.unmount());
    let notify!: (status: Awaited<ReturnType<AniDesktopApi["episodeUpdates"]>>) => void;
    vi.mocked(api.onEpisodeUpdatesChange).mockImplementation((listener) => { notify = listener; return () => {}; });
    root = createRoot(container);
    await act(async () => root.render(<StrictMode><App /></StrictMode>));
    expect(container.querySelector(".companion-bubble")).toBeNull();
    await act(async () => notify({ updates: [{ id: "fresh", animeId: "aniwave:show", sourceId: "aniwave:show", provider: "aniwave", title: "Fresh Show", episodeId: "aniwave:show:2", episodeNumber: "2", detectedAt: Date.now() }], unreadCount: 1, counts: {}, latestByAnime: {}, checking: false }));
    expect(container.querySelector(".companion-bubble")?.textContent).toContain("Episode 2 of Fresh Show is new");
  });
  it("speaks on section entry without replaying on a rerender", async () => {
    await click("Saved");
    const first = container.querySelector(".companion-bubble")?.textContent;
    expect(first).toContain("saved");
    await act(async () => { vi.advanceTimersByTime(5_001); });
    expect(container.querySelector(".companion-bubble")).toBeNull();
    await act(async () => root.render(<StrictMode><App /></StrictMode>));
    expect(container.querySelector(".companion-bubble")).toBeNull();
    await click("Home");
    await click("Saved");
    expect(container.querySelector(".companion-bubble")?.textContent).toContain("saved");
  });
  it("previews and saves the companion size from Settings", async () => {
    await click("Settings");
    const slider = container.querySelector<HTMLInputElement>('#companion-size')!;
    expect(slider.value).toBe("100");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(slider, "200");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
      slider.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector("output[for=companion-size]")?.textContent).toBe("200%");
    expect(container.querySelector<HTMLElement>(".companion-pet")?.style.width).toBe("192px");
    await advance(450);
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ companionSize: 200 }));
  });
});

describe("release update checks", () => {
  const available = { currentVersion: "1.0.0", latestVersion: "1.1.0", state: "available" as const };

  it("checks after startup, marks the gear, and keeps the notice inside Settings until the version is skipped", async () => {
    vi.mocked(api.checkForUpdates).mockResolvedValue(available);
    vi.mocked(api.dismissUpdate).mockResolvedValue({ ...available, dismissed: true });
    await advance(1_500);
    expect(api.checkForUpdates).toHaveBeenCalledWith(false);
    expect(container.querySelector(".page-home")).not.toBeNull();
    expect(container.querySelector(".icons .nav-badge")).not.toBeNull();
    expect(container.querySelector(".update-notice")).toBeNull();
    await click("settings, update available");
    expect(container.querySelector(".update-notice")?.textContent).toContain("v1.1.0 available");
    expect(container.querySelector(".settings-section-nav .rail-dot")).not.toBeNull();
    await click("Version 1.1.0 is available");
    expect(api.openLatestRelease).toHaveBeenCalledOnce();
    await click("skip");
    expect(api.dismissUpdate).toHaveBeenCalledWith("1.1.0");
    expect(container.querySelector(".update-notice")).toBeNull();
    expect(container.querySelector(".rail-dot")).toBeNull();
    expect(container.querySelector(".nav-badge")).toBeNull();
    expect(container.textContent).toContain("Version 1.1.0 is available");
  });

  it("offers a forced check from the Updates row", async () => {
    vi.mocked(api.checkForUpdates).mockResolvedValue({ currentVersion: "1.0.0", latestVersion: "1.0.0", state: "current" });
    await advance(1_500);
    await click("settings");
    await click("check now");
    expect(api.checkForUpdates).toHaveBeenLastCalledWith(true);
  });
});

describe("built-in player screen", () => {
  const session = (id: string, episodeId: string): PlayerSession => ({ id, preferences: {}, canOpenExternal: false, fullscreen: false,
    request: { url: `https://cdn.test/${episodeId}.m3u8`, title: `Frieren — Episode ${episodeId.slice(-1)}`, episode: { id: episodeId,
      entry: { animeId: "aniwave:frieren-1", title: "Frieren", lastEpisode: episodeId.slice(-1), mode: "sub", updatedAt: "" } } } });

  it("shows the player in place of the page, docks it while browsing, and closes it", async () => {
    vi.mocked(api.episodes).mockResolvedValue({ groups: [{ provider: "aniwave", episodes: [1, 2, 3].map((number) => ({ id: `ep-${number}`, number: String(number), provider: "aniwave" as const })) }] });
    vi.mocked(api.streams).mockResolvedValue([{ quality: "1080p", url: "https://cdn.test/1.m3u8", provider: "aniwave" }]);
    await type("frieren"); await advance(); await enter();
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label^="play episode 2 "]')!.click(); });
    expect(api.play).toHaveBeenCalledOnce();
    await act(async () => load(session("s1", "ep-2")));
    expect(container.querySelector('[data-testid="player"]')?.textContent).toContain("Frieren — Episode 2 of 3");
    expect(container.querySelector(".page")).toBeNull();
    expect(api.player.setActive).toHaveBeenLastCalledWith(true);
    expect(playerStub.props?.onPrev).toBeDefined();

    // Keys belong to the player screen while it is showing.
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(container.querySelector('[data-testid="player"]')).not.toBeNull();

    await click("next episode");
    expect(api.streams).toHaveBeenLastCalledWith("ep-3", "sub", expect.objectContaining({ priority: "playback" }));
    await act(async () => load(session("s2", "ep-3")));
    expect(container.querySelector('[data-testid="player"]')?.textContent).toContain("Episode 3 of 3");
    expect(playerStub.props?.onNext).toBeUndefined();

    // Escape docks: the player stays mounted and playing while the grid comes back.
    const refreshes = vi.mocked(api.getState).mock.calls.length;
    await click("dock player");
    const player = () => container.querySelector<HTMLElement>('[data-testid="player"]');
    expect(player()?.dataset.docked).toBe("true");
    expect(player()?.dataset.corner).toBe("bottom-right");
    expect(container.querySelector(".page")).not.toBeNull();
    expect(container.querySelector('.eps [data-episode="ep-3"]')?.textContent).toContain("Episode 3");
    expect(api.player.setActive).toHaveBeenLastCalledWith(true);
    expect(api.getState).toHaveBeenCalledTimes(refreshes + 1);
    expect(container.querySelector(".now-pill")).toBeNull(); // the corner player itself is the way back

    // Browsing elsewhere keeps it docked; the backtick brings it back.
    await click("saved");
    expect(player()?.dataset.docked).toBe("true");
    // The backtick expands the player even while the search field has focus.
    expect(document.activeElement).toBe(input());
    await press("`");
    expect(player()?.dataset.docked).toBe("false");
    expect(container.querySelector(".page")).toBeNull();
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(player()?.dataset.docked).toBe("false");

    // Moving the corner applies at once and is remembered in settings.
    const saving = deferred<PersistedState>();
    vi.mocked(api.saveSettings).mockReturnValueOnce(saving.promise);
    await click("move player");
    expect(player()?.dataset.corner).toBe("top-left");
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ miniPlayerCorner: "top-left" }));
    await act(async () => saving.resolve({ ...state, settings: { ...state.settings, miniPlayerCorner: "top-left" } }));
    expect(player()?.dataset.corner).toBe("top-left");

    // Resize keys work while the search field has focus, coalesce into one save, and the grip reports a width too.
    expect(player()?.dataset.width).toBe("400");
    vi.mocked(api.saveSettings).mockClear();
    await press("`"); expect(player()?.dataset.docked).toBe("false");
    await click("dock player");
    await click("saved");
    await act(async () => { input().focus(); });
    const typed = input().value;
    await press("="); expect(player()?.dataset.width).toBe("400");
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "=", metaKey: true, bubbles: true })); });
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "=", ctrlKey: true, bubbles: true })); });
    expect(player()?.dataset.width).toBe("480");
    await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "-", metaKey: true, bubbles: true })); });
    expect(player()?.dataset.width).toBe("440");
    expect(input().value).toBe(typed);
    expect(api.saveSettings).not.toHaveBeenCalled();
    await advance(300);
    expect(api.saveSettings).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ miniPlayerWidth: 440 }));
    await click("resize player");
    expect(player()?.dataset.width).toBe("333");
    await advance(300);
    expect(api.saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ miniPlayerWidth: 333 }));

    await click("playing episodes");
    await click("close player");
    expect(player()).toBeNull();
    expect(api.player.setActive).toHaveBeenLastCalledWith(false);
    expect(container.querySelector('.eps [data-episode="ep-3"]')?.textContent).toContain("Episode 3");
  });

  it("keeps next and previous for the playing series while another series is open", async () => {
    vi.mocked(api.episodes).mockResolvedValue({ groups: [{ provider: "aniwave", episodes: [1, 2, 3].map((number) => ({ id: `ep-${number}`, number: String(number), provider: "aniwave" as const })) }] });
    vi.mocked(api.streams).mockResolvedValue([{ quality: "1080p", url: "https://cdn.test/1.m3u8", provider: "aniwave" }]);
    await type("frieren"); await advance(); await enter();
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label^="play episode 2 "]')!.click(); });
    await act(async () => load(session("s1", "ep-2")));
    await click("dock player");
    vi.mocked(api.episodes).mockResolvedValue({ groups: [{ provider: "aniwave", episodes: [{ id: "other-1", number: "1", provider: "aniwave" }] }] });
    await click("home");
    await type("dandadan"); await advance(); await enter();
    expect(container.querySelector("h1")?.textContent).toBe("dandadan");
    expect(container.querySelector('[data-testid="player"]')?.textContent).toContain("Episode 2 of 3");
    await click("next episode");
    expect(api.streams).toHaveBeenLastCalledWith("ep-3", "sub", expect.objectContaining({ priority: "playback" }));
    expect(api.play).toHaveBeenLastCalledWith(expect.objectContaining({ title: "frieren — Episode 3" }));
    await click("playing episodes");
    expect(api.episodes).toHaveBeenLastCalledWith(expect.objectContaining({ id: "aniwave:frieren-1" }), expect.any(Object), expect.any(Function));
  });
});

describe("live catalog search", () => {
  it("browses AniList without searching providers until a catalog title is opened", async () => {
    vi.mocked(api.browseGenres).mockResolvedValue(["Action", "Comedy"]);
    vi.mocked(api.browse).mockImplementation(async (query) => ({ query, hasNextPage: true, fetchedAt: Date.now(), entries: [{
      anilistId: 42, refs: ["anilist:42"], title: "Catalog Pick", titles: ["Catalog Pick"], cover: "https://img.test/42.jpg",
      genres: ["Action"], type: "TV", year: 2026, status: "ongoing", score: 80, episodes: 12, studios: []
    }] }));
    await click("Browse");
    await advance(0);
    expect(api.browse).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }), expect.objectContaining({ priority: "visible" }), expect.any(Function));
    expect(api.search).not.toHaveBeenCalled();
    expect(api.discoverBrowse).not.toHaveBeenCalled();
    await act(async () => { container.querySelector<HTMLButtonElement>(".browse .card .hit")!.click(); });
    await advance(0);
    expect(api.discoverBrowse).toHaveBeenCalledWith(expect.objectContaining({ refs: ["anilist:42"], title: "Catalog Pick", year: 2026 }), expect.objectContaining({ priority: "selected" }));
    expect(api.search).not.toHaveBeenCalled();
    expect(api.episodes).toHaveBeenCalledWith(expect.objectContaining({ poster: "https://img.test/42.jpg" }), expect.anything(), expect.anything());
    expect(container.querySelector(".series h1")?.textContent).toBe("Catalog Pick");
    expect(container.querySelector(".series .crumb")?.textContent).toBe("Browse");
    await act(async () => { container.querySelector<HTMLButtonElement>(".series .crumb")!.click(); });
    expect(container.querySelector(".browse")).not.toBeNull();
  });
  it("tracks Settings sections and jumps without saving anything", async () => {
    await click("settings");
    const page = container.querySelector<HTMLElement>(".page-settings")!;
    const headings = [...container.querySelectorAll<HTMLElement>('.settings .group h3[id^="settings-"]')];
    const nav = container.querySelector<HTMLElement>('.settings-section-nav')!;
    expect(headings.map((heading) => heading.textContent)).toEqual(["Playback", "Defaults", "Appearance", "Anime information", "Episode metadata", "Sources", "Episode updates", "Updates"]);
    expect([...nav.querySelectorAll("button")].map((button) => button.textContent)).toEqual(headings.map((heading) => heading.textContent));
    const positions = new Map(headings.map((heading, index) => [heading.id, 120 + index * 200]));
    vi.spyOn(page, "getBoundingClientRect").mockReturnValue({ top: 0 } as DOMRect);
    for (const heading of headings) vi.spyOn(heading, "getBoundingClientRect").mockImplementation(() => ({ top: positions.get(heading.id)! } as DOMRect));
    const scrollTo = vi.fn();
    page.scrollTo = scrollTo;
    await act(async () => page.dispatchEvent(new Event("scroll")));
    expect(nav.querySelector('[aria-current="location"]')?.textContent).toBe("Playback");
    // Every heading has its own entry, so the last one past the line is the current section.
    positions.set("settings-defaults", 50); positions.set("settings-anime-information", 60);
    await act(async () => page.dispatchEvent(new Event("scroll")));
    expect(nav.querySelector('[aria-current="location"]')?.textContent).toBe("Anime information");
    const sourcesButton = [...nav.querySelectorAll("button")].find((button) => button.textContent === "Sources")!;
    await act(async () => sourcesButton.click());
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: expect.any(Number) }));
    expect(document.activeElement?.id).toBe("settings-sources");
    expect(document.activeElement?.classList.contains("jump-hit")).toBe(true);
    // The pick holds while the smooth scroll passes other sections, until the user scrolls by hand.
    await act(async () => page.dispatchEvent(new Event("scroll")));
    expect(nav.querySelector('[aria-current="location"]')?.textContent).toBe("Sources");
    await act(async () => { page.dispatchEvent(new Event("wheel")); page.dispatchEvent(new Event("scroll")); });
    expect(nav.querySelector('[aria-current="location"]')?.textContent).toBe("Anime information");
    // A short last section never reaches the line, so the end of the page names it.
    Object.defineProperties(page, { scrollHeight: { value: 3000, configurable: true }, clientHeight: { value: 700, configurable: true }, scrollTop: { value: 2300, configurable: true, writable: true } });
    await act(async () => page.dispatchEvent(new Event("scroll")));
    expect(nav.querySelector('[aria-current="location"]')?.textContent).toBe("Updates");
    page.scrollTop = 1000;
    await act(async () => page.dispatchEvent(new Event("scroll")));
    expect(nav.querySelector('[aria-current="location"]')?.textContent).toBe("Anime information");
    expect(api.saveSettings).not.toHaveBeenCalled();
    const jump = container.querySelector<HTMLSelectElement>("#settings-section-jump")!;
    expect(jump.options).toHaveLength(headings.length);
    await click("home");
    expect(container.querySelector(".settings-section-nav")).toBeNull();
  });
  it("shows saved episode alerts in the bell and lets the user clear them", async () => {
    const listener = vi.mocked(api.onEpisodeUpdatesChange).mock.calls[0][0];
    await act(async () => listener({ updates: [{ id: "u1", animeId: "aniwave:show", title: "Show", sourceId: "aniwave:show", provider: "aniwave", episodeId: "aniwave:show:13", episodeNumber: "13", detectedAt: Date.now() }], unreadCount: 1, counts: { "aniwave:show": 13 }, latestByAnime: {}, checking: false }));
    const bell = container.querySelector<HTMLButtonElement>('[aria-label="Notifications, 1 unread"]')!;
    expect(bell).not.toBeNull();
    await act(async () => bell.click());
    expect(container.querySelector(".episode-updates-panel")?.textContent).toContain("Episode 13");
    await act(async () => container.querySelector<HTMLButtonElement>(".notification-panel-actions button")!.click());
    expect(api.dismissEpisodeUpdate).toHaveBeenCalledWith(undefined);
  });
  it("opens the full notifications page, preserves read items, and closes the dropdown with Escape", async () => {
    const listener = vi.mocked(api.onEpisodeUpdatesChange).mock.calls[0][0];
    const update = { id: "u2", animeId: "aniwave:show", title: "Show", sourceId: "aniwave:show", provider: "aniwave" as const, episodeId: "aniwave:show:13", episodeNumber: "13", detectedAt: Date.now() - 3_600_000 };
    await act(async () => listener({ updates: [update], unreadCount: 1, counts: {}, latestByAnime: {}, checking: false }));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Notifications, 1 unread"]')!.click());
    expect(container.querySelector(".notification-preview-foot")?.textContent).toContain("1 hour ago");
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(container.querySelector(".episode-updates-panel")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Notifications, 1 unread"]')!.click());
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(container.querySelector(".episode-updates-panel")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Notifications, 1 unread"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>(".episode-updates-view-all")!.click());
    expect(container.querySelector(".page-notifications .notification-card")).not.toBeNull();
    expect(container.querySelector(".episode-updates-panel")).toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Mark Episode 13 of Show as read"]')!.click());
    expect(api.markEpisodeUpdateRead).toHaveBeenCalledWith("u2");
    await act(async () => listener({ updates: [{ ...update, readAt: Date.now() }], unreadCount: 0, counts: {}, latestByAnime: {}, checking: false }));
    expect(container.querySelector(".page-notifications .notification-card.read")).not.toBeNull();
    expect(container.querySelector('[aria-label="Notifications, 0 unread"] .episode-update-count')).toBeNull();
  });
  it("opens an episode notification on its series without starting playback", async () => {
    state.bookmarks = [{ animeId: "aniwave:show", title: "Show", lastEpisode: "1", mode: "sub", updatedAt: "", poster: "https://example.test/show.webp", sources: [{ id: "aniwave:show", provider: "aniwave", title: "Show", aliases: ["Show"] }] }];
    const listener = vi.mocked(api.onEpisodeUpdatesChange).mock.calls[0][0];
    await act(async () => listener({ updates: [{ id: "u3", animeId: "aniwave:show", title: "Show", sourceId: "aniwave:show", provider: "aniwave", episodeId: "ep-1", episodeNumber: "1", detectedAt: Date.now() }], unreadCount: 1, counts: {}, latestByAnime: {}, checking: false }));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Notifications, 1 unread"]')!.click());
    expect(container.querySelector<HTMLImageElement>(".episode-updates-panel .notification-poster img")?.src).toBe("https://example.test/show.webp");
    await act(async () => container.querySelector<HTMLButtonElement>(".episode-updates-view-all")!.click());
    await act(async () => container.querySelector<HTMLButtonElement>(".notification-card-foot button:last-child")!.click());
    expect(api.markEpisodeUpdateRead).toHaveBeenCalledWith("u3");
    expect(container.querySelector(".page-series")).not.toBeNull();
    expect(api.play).not.toHaveBeenCalled();
    await backFromSeries();
    expect(container.querySelector(".page-notifications")).not.toBeNull();
    await act(async () => listener({ updates: [{ id: "u3", animeId: "aniwave:show", title: "Show", sourceId: "aniwave:show", provider: "aniwave", episodeId: "ep-1", episodeNumber: "1", detectedAt: Date.now(), readAt: Date.now() }], unreadCount: 0, counts: {}, latestByAnime: {}, checking: false }));
    await act(async () => container.querySelector<HTMLButtonElement>(".notification-card-foot button:first-child")!.click());
    expect(container.querySelector(".page-series")).not.toBeNull();
    expect(api.play).not.toHaveBeenCalled();
  });
  it("applies opt-in diagnostics on change and opens the log folder from settings", async () => {
    await click("settings");
    const toggle = container.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Diagnostics logging"]')!;
    const status = container.querySelector<HTMLElement>(".save-state")!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(status.textContent).toBe("");
    await act(async () => { toggle.click(); });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    expect(status.textContent).toBe("Saving…");
    await click("open logs");
    expect(api.openPlayerLogs).toHaveBeenCalledOnce();
    expect(api.saveSettings).not.toHaveBeenCalled();
    await advance(400);
    expect(api.saveSettings).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ playerDiagnostics: true }));
    expect(status.textContent).toBe("Saved");
    await advance(2_000);
    expect(status.textContent).toBe("");
  });
  it("coalesces quick edits into one save, and leaving the page saves at once", async () => {
    await click("settings");
    await click("dub"); await click("720p"); await advance(100); await click("480p");
    expect(api.saveSettings).not.toHaveBeenCalled();
    await click("home");
    expect(api.saveSettings).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ preferredMode: "dub", preferredQuality: "480p" }));
  });
  it("reports a save the main process refused and keeps the edit for the next try", async () => {
    vi.mocked(api.saveSettings).mockRejectedValueOnce(new Error("External player path is required"));
    await click("settings"); await click("external"); await advance(400);
    expect(container.querySelector(".save-word")?.textContent).toBe("Not saved");
    expect(container.querySelector(".msg.err")?.textContent).toContain("External player path is required");
    await advance(5_000);
    expect(container.querySelector(".save-word")?.textContent).toBe("Not saved");
    const path = container.querySelector<HTMLInputElement>("#player")!;
    await type("/usr/local/bin/mpv", path); await advance(400);
    expect(api.saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ playbackTarget: "external", playerPath: "/usr/local/bin/mpv" }));
    expect(container.querySelector(".save-state")?.textContent).toBe("Saved");
  });
  it("retries a refused save from the heading", async () => {
    vi.mocked(api.saveSettings).mockRejectedValueOnce(new Error("Disk is full"));
    await click("settings"); await click("dub"); await advance(400);
    expect(api.saveSettings).toHaveBeenCalledOnce();
    await click("retry");
    expect(api.saveSettings).toHaveBeenCalledTimes(2);
    expect(api.saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ preferredMode: "dub" }));
    expect(container.querySelector(".save-state")?.textContent).toBe("Saved");
    expect(container.querySelector(".save-retry")).toBeNull();
    expect(container.querySelector(".msg.err")).toBeNull();
  });
  it("opens the subtitle rows under Playback and applies them as they change", async () => {
    await click("settings");
    const row = container.querySelector<HTMLButtonElement>(".subtitle-row")!;
    expect(row.textContent).toContain("sans · 100% · outline · no background");
    // The rows stay mounted so closing can animate; while closed they are inert and hidden.
    const editor = container.querySelector<HTMLElement>("#subtitle-editor")!;
    expect(editor.dataset.open).toBe("false"); expect(editor.hasAttribute("inert")).toBe(true); expect(editor.getAttribute("aria-hidden")).toBe("true");
    await act(async () => { row.click(); });
    expect(editor.dataset.open).toBe("true"); expect(editor.hasAttribute("inert")).toBe(false);
    await act(async () => { container.querySelector<HTMLButtonElement>('#subtitle-editor button[aria-label="Increase subtitle size"]')!.click(); });
    expect(api.saveSubtitleAppearance).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ size: 110 }));
    expect(row.textContent).toContain("sans · 110% · outline · no background");
    expect(api.saveSettings).not.toHaveBeenCalled();
  });
  it.each([false, true])("continues the right episode when completed is %s", async (completed) => {
    const state = await api.getState();
    state.history = [{ animeId: "aniwave:fixture-1", title: "Fixture", lastEpisode: "1", mode: "sub", updatedAt: "", completed,
      lastProvider: "aniwave", progressByProvider: { aniwave: { lastEpisode: "1", mode: "sub", updatedAt: "", completed } } }];
    vi.mocked(api.episodes).mockResolvedValue({ groups: [{ provider: "aniwave", episodes: [
      { id: "episode-1", number: "1", provider: "aniwave" }, { id: "episode-2", number: "2", provider: "aniwave" }
    ] }] });
    await act(async () => { root.render(<StrictMode><App key="resume" /></StrictMode>); });
    await press("Enter");
    expect(api.streams).toHaveBeenCalledExactlyOnceWith(completed ? "episode-2" : "episode-1", "sub", expect.objectContaining({ priority: "playback" }));
  });

  it.each([false, true])("loads library counts and continues on the last provider across series identities (completed: %s)", async (completed) => {
    state.history = [{ animeId: "aniwave:fixture-1", title: "Fixture", lastEpisode: "12", mode: "sub", updatedAt: "", completed,
      lastProvider: "hianime", sources: [
        { id: "aniwave:fixture-1", provider: "aniwave", title: "Fixture", aliases: ["Fixture"] },
        { id: "hianime:fixture-2", provider: "hianime", title: "Fixture", aliases: ["Fixture"] }
      ], progressByProvider: { hianime: { lastEpisode: "12", mode: "sub", updatedAt: "", completed } } }];
    state.bookmarks = state.history;
    vi.mocked(api.seriesMetadata).mockImplementation(async (anime) => {
      validateSeriesMetadataRequest(anime);
      return { genres: [], sources: [
        { sourceId: "aniwave:fixture-1", provider: "aniwave", genres: [], availableEpisodes: 13, checkedAt: Date.now() },
        { sourceId: "hianime:fixture-2", provider: "hianime", genres: [], availableEpisodes: 12, checkedAt: Date.now() }
      ] };
    });
    vi.mocked(api.episodes).mockResolvedValue({ groups: (["aniwave", "hianime"] as const).map((provider) => ({
      provider,
      episodes: [12, 13].map((number) => ({ id: `${provider}:episode-${number}`, number: String(number), provider }))
    })) });
    vi.mocked(api.streams).mockResolvedValue([{ quality: "1080p", url: "https://video.test/episode.m3u8", provider: "hianime" }]);
    vi.mocked(api.recordHistory).mockResolvedValue(state);
    await act(async () => { root.render(<StrictMode><App key="cross-provider" /></StrictMode>); });
    expect(api.seriesMetadata).toHaveBeenCalledWith(expect.objectContaining({ id: "aniwave:fixture-1", provider: "aniwave" }), expect.any(Object), expect.any(Function));
    const badges = [...container.querySelectorAll(".card .badge.hi")];
    expect(badges.length).toBeGreaterThan(0);
    expect(badges.map((badge) => badge.textContent)).toEqual(badges.map(() => "EP 12/12"));
    await act(async () => { container.querySelector<HTMLButtonElement>(".section-continue .hit")!.click(); });
    expect(api.streams).toHaveBeenCalledExactlyOnceWith(`hianime:episode-${completed ? 13 : 12}`, "sub", expect.objectContaining({ priority: "playback" }));
  });

  it("keeps the saved playback provider when history has been cleared", async () => {
    state.bookmarks = [{ animeId: "aniwave:fixture-1", title: "Fixture", lastEpisode: "19", mode: "sub", updatedAt: "",
      lastProvider: "hianime", sources: [
        { id: "aniwave:fixture-1", provider: "aniwave", title: "Fixture", aliases: ["Fixture"] },
        { id: "hianime:fixture-2", provider: "hianime", title: "Fixture", aliases: ["Fixture"] }
      ] }];
    vi.mocked(api.episodes).mockResolvedValue({ groups: [
      { provider: "aniwave", episodes: [{ id: "aniwave:episode-1", number: "1", provider: "aniwave" }] },
      { provider: "hianime", episodes: [{ id: "hianime:episode-20", number: "20", provider: "hianime" }] }
    ] });
    await act(async () => { root.render(<StrictMode><App key="saved-provider" /></StrictMode>); });
    await act(async () => { container.querySelector<HTMLButtonElement>(".section-saved .hit")!.click(); });
    expect(container.querySelector(".series")).not.toBeNull();
    expect(api.episodes).toHaveBeenCalledWith(expect.objectContaining({ id: "aniwave:fixture-1", provider: "aniwave" }), expect.any(Object), expect.any(Function));
    await click("Play Ep 20");
    expect(api.streams).toHaveBeenCalledExactlyOnceWith("hianime:episode-20", "sub", expect.objectContaining({ priority: "playback" }));
  });

  it("recolours the icon as a theme is picked and keeps the saved theme", async () => {
    const icon = () => decodeURIComponent(document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href);
    await click("settings"); await click("nord");
    expect(icon()).toContain('fill="#88C0D0"');
    await click("mocha"); await advance(400);
    expect(api.saveSettings).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ theme: "mocha" }));
    await click("home");
    expect(icon()).toContain('fill="#CBA6F7"');
  });

  it.each(["keyboard", "mouse"])("uses native episode buttons after opening a search result with the %s", async (method) => {
    const pending = deferred<Awaited<ReturnType<AniDesktopApi["episodes"]>>>();
    vi.mocked(api.episodes).mockReturnValue(pending.promise);
    await type("frieren"); await advance();
    if (method === "keyboard") await press("Enter");
    else await act(async () => { container.querySelector<HTMLButtonElement>(".section-results .hit")!.click(); });
    await act(async () => pending.resolve({ groups: [{ provider: "aniwave", episodes: Array.from({ length: 6 }, (_, index) => ({ id: `ep-${index + 1}`, number: String(index + 1), provider: "aniwave" as const })) }] }));
    // Newest first: episode 6 is on top and, with nothing watched, episode 1 is next up.
    const cells = [...container.querySelectorAll<HTMLButtonElement>(".eps .src-hit")];
    expect(cells.map((cell) => cell.textContent)).toEqual(["Episode 6aniwave", "Episode 5aniwave", "Episode 4aniwave", "Episode 3aniwave", "Episode 2aniwave", "Episode 1aniwave"]);
    expect(cells.every((cell) => cell.tabIndex === 0)).toBe(true);
    expect(container.querySelector(".eps .cur, .eps .in-cur, .eps [data-cursor]")).toBeNull();
    await act(async () => { input().blur(); });
    for (const key of ["ArrowUp", "ArrowDown", "Enter", "s", "/", "Escape", "?", "`"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
      await act(async () => { document.activeElement!.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(false);
    }
    // The search shortcut reopens the held results over the series; Escape closes them and the series stays.
    for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
      const event = new KeyboardEvent("keydown", { key: "k", ...modifier, bubbles: true, cancelable: true });
      await act(async () => { document.activeElement!.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(input());
      expect(titles()).toEqual(["frieren"]);
      expect(container.querySelector(".series")).not.toBeNull();
      await press("Escape");
      expect(container.querySelector(".palette")).toBeNull();
      expect(input().value).toBe("frieren");
    }
    expect(api.streams).not.toHaveBeenCalled();
    expect(api.toggleBookmark).not.toHaveBeenCalled();
    expect(container.querySelector(".series")).not.toBeNull();
    expect(container.querySelector(".hints")).toBeNull();
    expect(container.querySelector(".bar kbd")).toBeNull();
    await act(async () => { cells[4].focus(); });
    await press("ArrowUp"); expect(document.activeElement).toBe(cells[4]);
    await act(async () => { cells[4].click(); });
    expect(api.streams).toHaveBeenCalledExactlyOnceWith("ep-2", "sub", expect.objectContaining({ priority: "playback" }));
    // Typing searches in place over the series page.
    await type("another title"); await advance(); expect(titles()).toEqual(["another title"]);
    expect(container.querySelector(".series")).not.toBeNull();
  });

  it("keeps provider-native episode lists and plays from the selected source tab", async () => {
    search.mockResolvedValue([{
      id: "aniwave:re-zero-101", title: "Re:ZERO Season 4", provider: "aniwave",
      sources: [
        { id: "aniwave:re-zero-101", title: "Re:ZERO Season 4", aliases: ["Re:ZERO Season 4"], provider: "aniwave" },
        { id: "anidb:re-zero-202", title: "Re:ZERO Season 4", aliases: ["Re:ZERO Season 4"], provider: "anidb" }
      ]
    }]);
    vi.mocked(api.episodes).mockResolvedValue({ groups: [
      { provider: "aniwave", episodes: [{ id: "aniwave:episode-15", number: "15", provider: "aniwave" }] },
      { provider: "anidb", episodes: [{ id: "anidb:episode-81", number: "81", provider: "anidb" }] }
    ] });
    vi.mocked(api.streams).mockResolvedValue([{ quality: "1080p", url: "https://video.test/81.m3u8", provider: "anidb" }]);
    vi.mocked(api.recordHistory).mockResolvedValue(await api.getState());

    await type("re zero"); await advance(); await press("Enter");
    expect([...container.querySelectorAll(".grp-head")].map((node) => node.textContent)).toEqual(["Ep 81", "Ep 15Next up"]);
    const episode = container.querySelector<HTMLButtonElement>('[aria-label="play episode 81 from anidb"]')!;
    expect(episode).toBeDefined();
    await act(async () => { episode.click(); });
    expect(api.streams).toHaveBeenCalledExactlyOnceWith("anidb:episode-81", "sub", expect.objectContaining({ priority: "playback" }));
    expect(api.play).toHaveBeenCalledWith(expect.objectContaining({ episode: expect.objectContaining({ entry: expect.objectContaining({
      lastProvider: "anidb", lastEpisode: "81",
      progressByProvider: expect.objectContaining({ anidb: expect.objectContaining({ lastEpisode: "81" }) })
    }) }) }));
  });

  it("marks next up from progress regardless of jump, sort, or filter", async () => {
    const state = await api.getState();
    state.history = [{ animeId: "aniwave:frieren-1", title: "frieren", lastEpisode: "7", mode: "sub", updatedAt: "", completed: false,
      lastProvider: "aniwave", progressByProvider: { aniwave: { lastEpisode: "7", mode: "sub", updatedAt: "", completed: false } } }];
    vi.mocked(api.episodes).mockResolvedValue({ groups: [{ provider: "aniwave", episodes: Array.from({ length: 9 }, (_, index) => ({ id: `ep-${index + 1}`, number: String(index + 1), provider: "aniwave" as const })) }] });
    await act(async () => { root.render(<StrictMode><App key="progress" /></StrictMode>); });
    await type("frieren"); await advance(); await press("Enter");
    const nextUp = () => container.querySelector(".grp-head .up")?.parentElement?.textContent;
    const playButton = () => [...container.querySelectorAll<HTMLButtonElement>(".series .side .btn")][0].textContent;
    expect(nextUp()).toBe("Ep 7Next up"); expect(playButton()).toBe("Play Ep 7");
    await type("8", container.querySelector<HTMLInputElement>('[aria-label="Jump to episode"]')!);
    expect(nextUp()).toBe("Ep 7Next up"); expect(playButton()).toBe("Play Ep 7");
    await act(async () => { container.querySelector<HTMLButtonElement>('[title="Oldest first"]')!.click(); });
    expect(nextUp()).toBe("Ep 7Next up");
    await act(async () => { [...container.querySelectorAll("button")].find((node) => node.textContent === "Watched")!.click(); });
    expect(nextUp()).toBeUndefined(); expect(playButton()).toBe("Play Ep 7");
    expect([...container.querySelectorAll(".eps .src-hit")].map((node) => node.textContent)).toEqual(["Episode 1aniwave", "Episode 2aniwave", "Episode 3aniwave", "Episode 4aniwave", "Episode 5aniwave", "Episode 6aniwave"]);
  });

  it("marks every episode on every source watched from the sidebar button", async () => {
    search.mockResolvedValue([{
      id: "aniwave:re-zero-101", title: "Re:ZERO Season 4", provider: "aniwave",
      sources: [
        { id: "aniwave:re-zero-101", title: "Re:ZERO Season 4", aliases: ["Re:ZERO Season 4"], provider: "aniwave" },
        { id: "anidb:re-zero-202", title: "Re:ZERO Season 4", aliases: ["Re:ZERO Season 4"], provider: "anidb" }
      ]
    }]);
    vi.mocked(api.episodes).mockResolvedValue({ groups: [
      { provider: "aniwave", episodes: [{ id: "aniwave:ep-2", number: "2", provider: "aniwave" }, { id: "aniwave:ep-1", number: "1", provider: "aniwave" }] },
      { provider: "anidb", episodes: [{ id: "anidb:ep-1", number: "1", provider: "anidb" }] }
    ] });
    // Like the real store, each answer is a new state object.
    vi.mocked(api.recordHistory).mockImplementation(async (entry) => { const next = { ...(await api.getState()), history: [entry] }; vi.mocked(api.getState).mockResolvedValue(next); return next; });

    await type("re zero"); await advance(); await press("Enter");
    const button = () => [...container.querySelectorAll<HTMLButtonElement>(".series .side .stack .btn")].find((node) => node.textContent?.includes("watched"))!;
    expect(button().textContent).toBe("Mark all watched"); expect(button().disabled).toBe(false);
    expect(container.querySelectorAll('.eps .chk[aria-checked="true"]')).toHaveLength(0);
    await act(async () => { button().click(); });
    expect(api.recordHistory).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      animeId: "aniwave:re-zero-101", lastProvider: "aniwave", lastEpisode: "2", completed: true,
      progressByProvider: { aniwave: expect.objectContaining({ lastEpisode: "2", lastEpisodeId: "aniwave:ep-2", completed: true }), anidb: expect.objectContaining({ lastEpisode: "1", lastEpisodeId: "anidb:ep-1", completed: true }) }
    }));
    expect(container.querySelectorAll('.eps .chk[aria-checked="true"]')).toHaveLength(3);
    expect(button().textContent).toBe("All watched"); expect(button().disabled).toBe(true);
  });

  it("shows unified genre bubbles and keeps announced totals separate from available episodes", async () => {
    vi.mocked(api.seriesMetadata).mockResolvedValue({ genres: ["Adventure", "Fantasy"], sources: [
      { sourceId: "aniwave:frieren-1", provider: "aniwave", genres: ["Adventure"], availableEpisodes: 11, announcedEpisodes: 14, checkedAt: Date.now() }
    ] });
    vi.mocked(api.episodes).mockResolvedValue({ groups: [{ provider: "aniwave", episodes: Array.from({ length: 11 }, (_, index) => ({ id: `ep-${index + 1}`, number: String(index + 1), provider: "aniwave" as const })) }] });
    await type("frieren"); await advance(); await press("Enter");
    await act(async () => { await Promise.resolve(); });
    expect([...container.querySelectorAll(".genre-bubbles button")].map((node) => node.textContent)).toEqual(["Adventure", "Fantasy"]);
    expect(container.querySelector(".genre-bubbles")?.previousElementSibling?.classList.contains("stack")).toBe(true);
    expect(container.querySelector(".genre-bubbles")?.nextElementSibling?.classList.contains("prefs")).toBe(true);
    const facts = container.querySelector(".facts")?.textContent;
    expect(facts).toContain("Available episodes11");
    expect(facts).toContain("Announced total14");
  });

  it("shows series information from the work behind a series", async () => {
    vi.mocked(api.workInfo).mockImplementation(async (_anime, _request, update) => {
      const info = { refs: ["anilist:154587", "mal:52991"], title: "Frieren: Beyond Journey's End", titles: { romaji: "Sousou no Frieren", english: "Frieren: Beyond Journey's End" }, synonyms: [], type: "TV" as const, episodes: 28, year: 2023, season: "fall",
        status: "finished" as const, genres: ["Fantasy"], studios: ["madhouse"], score: 89, description: "An elf mage outlives her party.", cover: "https://img.test/cover.jpg",
        relations: [{ relation: "sequel", refs: ["anilist:182255"], title: "Frieren Season 2", type: "TV" as const }], fetchedAt: Date.now(), source: "anilist" as const };
      update?.(info); return info;
    });
    await type("frieren"); await advance(); await enter();
    expect(api.workInfo).toHaveBeenCalledWith(expect.objectContaining({ id: "aniwave:frieren-1" }), expect.objectContaining({ priority: "selected" }), expect.any(Function));
    expect(container.querySelector(".synopsis")?.textContent).toBe("An elf mage outlives her party.");
    const facts = [...container.querySelectorAll(".facts div")].map((node) => node.textContent);
    expect(facts).toEqual(expect.arrayContaining(["FormatTV · Fall 2023", "StatusFinished", "Studiomadhouse", "Score8.9", "Announced total28"]));
    expect(container.querySelector(".series .meta > span:not(.tag)")?.textContent).toBe("Sousou no Frieren");
    expect([...container.querySelectorAll(".genre-bubbles button")].map((node) => node.textContent)).toEqual(["Fantasy"]);
    await click("Refresh info");
    expect(api.workInfo).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ refresh: true }), expect.any(Function));
  });

  it("splits a source off a grouped series after confirmation and reopens the rest", async () => {
    const grouped: AnimeResult = { id: "aniwave:frieren-1", title: "frieren", provider: "aniwave", tentative: true, sources: [
      { id: "aniwave:frieren-1", provider: "aniwave", title: "frieren", aliases: ["frieren"] }, { id: "hianime:frieren-x", provider: "hianime", title: "Frieren (Uncensored)", aliases: ["Frieren (Uncensored)"] }
    ] };
    search.mockResolvedValue([grouped]);
    const confirm = vi.fn(() => true); vi.stubGlobal("confirm", confirm);
    vi.mocked(api.splitSource).mockResolvedValue({ ...state, dismissedMergeKeys: ["aniwave:frieren-1|hianime:frieren-x"] });
    await type("frieren"); await advance();
    expect(container.querySelector(".section-results .tag.quiet")?.textContent).toBe("grouped by title");
    await enter();
    expect([...container.querySelectorAll(".series .meta .src-tag")].map((node) => node.firstChild?.textContent)).toEqual(["aniwave", "hianime"]);
    await act(async () => { container.querySelector<HTMLButtonElement>('.src-tag .split[aria-label^="Split hianime"]')!.click(); });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Frieren (Uncensored)"));
    expect(api.splitSource).toHaveBeenCalledWith("hianime:frieren-x");
    expect([...container.querySelectorAll(".series .meta .src-tag")].map((node) => node.firstChild?.textContent)).toEqual(["aniwave"]);
    expect(vi.mocked(api.episodes).mock.calls.at(-1)?.[0].sources?.map((source) => source.id)).toEqual(["aniwave:frieren-1"]);
    expect(container.querySelector(".src-tag .split")).toBeNull();
  });

  it("offers the anime information settings and gates the index download on a saved setting", async () => {
    await click("settings");
    const group = [...container.querySelectorAll(".group")].find((node) => node.querySelector("h3")?.textContent === "Anime information")!;
    expect(group.querySelector('[role="switch"][aria-label="Series details from AniList"]')?.getAttribute("aria-checked")).toBe("true");
    const button = group.querySelector<HTMLButtonElement>(".btn")!;
    expect(button.disabled).toBe(true);
    await act(async () => { group.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Offline title index"]')!.click(); });
    expect(group.textContent).toContain("Applying the index setting…");
    vi.mocked(api.saveSettings).mockImplementation(async (settings) => { state = { ...state, settings }; return state; });
    vi.mocked(api.identityIndexStatus).mockResolvedValue({ enabled: true, entries: 0, updating: false });
    await advance(400);
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ offlineIndex: true }));
    await advance(100);
    const again = [...container.querySelectorAll(".group")].find((node) => node.querySelector("h3")?.textContent === "Anime information")!;
    expect(again.textContent).toContain("Not downloaded yet.");
    vi.mocked(api.updateIdentityIndex).mockResolvedValue({ enabled: true, entries: 41537, updatedAt: Date.now(), updating: false });
    await act(async () => { again.querySelector<HTMLButtonElement>(".btn")!.click(); });
    expect(api.updateIdentityIndex).toHaveBeenCalledOnce();
    expect(again.textContent).toContain(`${(41537).toLocaleString()} titles`);
  });

  it("looks the series up on the other providers and merges their episodes into the grouped list", async () => {
    const pending = deferred<AnimeResult>();
    vi.mocked(api.resolveSources).mockReturnValueOnce(pending.promise);
    vi.mocked(api.episodes).mockImplementation(async (anime) => ({ groups: (anime.sources ?? [{ id: anime.id, provider: anime.provider }]).map((source) => ({ provider: source.provider, episodes: [{ id: `${source.provider}-ep-1`, number: "1", provider: source.provider }] })) }));
    await type("frieren"); await advance(); await press("Enter");
    expect(api.resolveSources).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "aniwave:frieren-1" }), expect.any(Object), expect.any(Function));
    expect(container.querySelectorAll(".eps .src")).toHaveLength(1);
    expect(container.querySelector(".series .meta")?.textContent).toContain("checking other sources");
    await act(async () => pending.resolve({ id: "aniwave:frieren-1", title: "frieren", provider: "aniwave", sources: [
      { id: "aniwave:frieren-1", provider: "aniwave", title: "frieren", aliases: ["frieren"] },
      { id: "anidb:frieren-9", provider: "anidb", title: "Sousou no Frieren", aliases: ["Sousou no Frieren"] }
    ] }));
    // Only the newly found source is fetched, and its rows join the same episode group.
    expect(api.episodes).toHaveBeenLastCalledWith(expect.objectContaining({ sources: [expect.objectContaining({ id: "anidb:frieren-9" })] }), expect.any(Object), expect.any(Function));
    expect([...container.querySelectorAll(".eps .src-hit")].map((node) => node.textContent)).toEqual(["Episode 1aniwave", "Episode 1anidb"]);
    expect(container.querySelectorAll(".grp-head")).toHaveLength(1);
    expect([...container.querySelectorAll(".series .meta .tag")].map((node) => node.textContent)).toEqual(["aniwave", "anidb"]);
    expect(container.querySelector(".series .meta")?.textContent).not.toContain("checking other sources");
    // Playing the anidb row records progress on that provider with every known source attached.
    vi.mocked(api.streams).mockResolvedValue([{ quality: "720p", url: "https://cdn.test/a.m3u8", provider: "anidb" }]);
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="play episode 1 from anidb"]')!.click(); });
    expect(api.play).toHaveBeenCalledWith(expect.objectContaining({ episode: expect.objectContaining({ entry: expect.objectContaining({ lastProvider: "anidb", sources: expect.arrayContaining([expect.objectContaining({ id: "anidb:frieren-9" })]) }) }) }));
  });

  it("saves a series with its real progress and preserves scroll position", async () => {
    const state = await api.getState();
    state.history = [{ animeId: "aniwave:frieren-1", title: "frieren", lastEpisode: "7", mode: "sub", updatedAt: "", completed: false,
      lastProvider: "aniwave", progressByProvider: { aniwave: { lastEpisode: "7", mode: "sub", updatedAt: "", completed: false } } }];
    vi.mocked(api.episodes).mockResolvedValue({ groups: [{ provider: "aniwave", episodes: Array.from({ length: 9 }, (_, index) => ({ id: `ep-${index + 1}`, number: String(index + 1), provider: "aniwave" as const })) }] });
    let saved = false;
    vi.mocked(api.toggleBookmark).mockImplementation(async (entry) => { saved = !saved; return { ...state, bookmarks: saved ? [entry] : [] }; });
    await act(async () => { root.render(<StrictMode><App key="save" /></StrictMode>); });
    await type("frieren"); await advance(); await press("Enter");
    await type("9", container.querySelector<HTMLInputElement>('[aria-label="Jump to episode"]')!);
    const scrolls = vi.mocked(Element.prototype.scrollIntoView).mock.calls.length;
    await click("Save");
    expect(api.toggleBookmark).toHaveBeenLastCalledWith(expect.objectContaining({ lastEpisode: "7", completed: false, lastProvider: "aniwave" }));
    expect(container.querySelector('[aria-pressed="true"]')?.textContent).toBe("Saved");
    await click("Saved");
    expect(container.querySelector('[aria-pressed="true"]')).toBeNull();
    expect(vi.mocked(Element.prototype.scrollIntoView).mock.calls.length).toBe(scrolls);
    // Without any progress, saving records the first episode as not started.
    state.history = [];
    vi.mocked(api.getState).mockResolvedValue(state);
    await act(async () => { root.render(<StrictMode><App key="fresh" /></StrictMode>); });
    await type("frieren"); await advance(); await press("Enter");
    await click("Save");
    expect(api.toggleBookmark).toHaveBeenLastCalledWith(expect.objectContaining({ lastEpisode: "1", completed: false }));
  });

  it("resolves the other providers when a series is continued from the home page", async () => {
    const state = await api.getState();
    state.history = [{ animeId: "aniwave:frieren-1", title: "frieren", lastEpisode: "1", mode: "sub", updatedAt: "2026-09-09T00:00:00Z", lastProvider: "aniwave",
      progressByProvider: { aniwave: { lastEpisode: "1", mode: "sub", updatedAt: "" } } }];
    const pending = deferred<AnimeResult>();
    vi.mocked(api.resolveSources).mockReturnValueOnce(pending.promise);
    vi.mocked(api.episodes).mockImplementation(async (anime) => ({ groups: (anime.sources ?? [{ id: anime.id, provider: anime.provider }]).map((source) => ({ provider: source.provider, episodes: [1, 2].map((number) => ({ id: `${source.provider}-ep-${number}`, number: String(number), provider: source.provider })) })) }));
    vi.mocked(api.streams).mockResolvedValue([{ quality: "1080p", url: "https://cdn.test/2.m3u8", provider: "aniwave" }]);
    await act(async () => { root.render(<StrictMode><App key="continue" /></StrictMode>); });
    await press("Enter");
    // Playback of the next episode starts from the known source while the other providers are still being looked up.
    expect(api.streams).toHaveBeenCalledExactlyOnceWith("aniwave-ep-2", "sub", expect.objectContaining({ priority: "playback" }));
    expect(api.resolveSources).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "aniwave:frieren-1" }), expect.any(Object), expect.any(Function));
    await act(async () => pending.resolve({ id: "aniwave:frieren-1", title: "frieren", provider: "aniwave", sources: [
      { id: "aniwave:frieren-1", provider: "aniwave", title: "frieren", aliases: ["frieren"] },
      { id: "hianime:frieren-x", provider: "hianime", title: "frieren", aliases: ["frieren"] }
    ] }));
    // Resuming stays on the card while the episode is found; the player takes the screen from there.
    expect(container.querySelector(".series")).toBeNull();
    const request = vi.mocked(api.play).mock.calls[0][0];
    await act(async () => load({ id: "continued", request, preferences: {}, fullscreen: false, canOpenExternal: false }));
    await click("playing episodes");
    expect([...container.querySelectorAll(".series .meta .tag")].map((node) => node.textContent)).toEqual(["aniwave", "hianime"]);
    expect([...container.querySelectorAll(".grp-head")].map((node) => node.textContent)).toEqual(["Ep 2Next up", "Ep 1"]);
    expect(container.querySelectorAll(".eps .src")).toHaveLength(4);
  });

  it("drops source lookups that finish after another series was opened", async () => {
    const pending = deferred<AnimeResult>();
    vi.mocked(api.resolveSources).mockReturnValueOnce(pending.promise).mockImplementation(async (anime) => anime);
    await type("frieren"); await advance(); await press("Enter");
    await backFromSeries();
    await type("other"); await advance(); await press("Enter");
    expect(container.querySelector("h1")?.textContent).toBe("other");
    await act(async () => pending.resolve({ id: "aniwave:frieren-1", title: "frieren", provider: "aniwave", sources: [
      { id: "aniwave:frieren-1", provider: "aniwave", title: "frieren", aliases: ["frieren"] },
      { id: "anidb:frieren-9", provider: "anidb", title: "frieren", aliases: ["frieren"] }
    ] }));
    expect(container.querySelector("h1")?.textContent).toBe("other");
    expect([...container.querySelectorAll(".series .meta .tag")].map((node) => node.textContent)).toEqual(["aniwave"]);
  });

  it("keeps focus in search if the user returns there before episodes finish loading", async () => {
    const pending = deferred<Awaited<ReturnType<AniDesktopApi["episodes"]>>>();
    vi.mocked(api.episodes).mockReturnValue(pending.promise);
    await type("frieren"); await advance(); await press("Enter");
    await act(async () => { input().focus(); });
    expect(document.activeElement).toBe(input());
    await act(async () => pending.resolve({ groups: [{ provider: "aniwave", episodes: [{ id: "ep-1", number: "1", provider: "aniwave" }] }] }));
    expect(document.activeElement).toBe(input());
  });

  it.each(["home", "saved", "recent"])("navigates %s with an empty field and activates the selected title", async (screen) => {
    const state = await api.getState();
    const entries = ["first", "second", "third"].map((title) => ({
      animeId: `aniwave:${title}-1`, title, lastEpisode: "1", mode: "sub" as const, completed: false, updatedAt: "2026-09-09T00:00:00Z"
    }));
    state.history = entries;
    state.bookmarks = entries;
    await act(async () => { root.render(<StrictMode><App key="library" /></StrictMode>); });
    if (screen !== "home") await click(screen);
    const selected = () => container.querySelector('.card[data-cursor="true"] .t')?.textContent;
    expect(input().value).toBe("");
    expect(selected()).toBe("first");
    await press("ArrowRight"); expect(selected()).toBe("second");
    await press("ArrowRight"); expect(selected()).toBe("third");
    await press("ArrowLeft"); expect(selected()).toBe("second");
    await press("Enter");
    expect(api.episodes).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "aniwave:second-1" }), expect.any(Object), expect.any(Function));
    if (screen === "saved") {
      expect(container.querySelector("h1")?.textContent).toBe("second");
      expect(api.play).not.toHaveBeenCalled();
      expect(api.streams).not.toHaveBeenCalled();
    } else expect(api.streams).toHaveBeenCalledExactlyOnceWith("ep-1", "sub", expect.objectContaining({ priority: "playback" }));
  });

  it.each(["home", "saved"])("opens a saved card from %s without starting playback", async (screen) => {
    state.bookmarks = [{ animeId: "aniwave:fixture-1", title: "Fixture", lastEpisode: "1", mode: "sub", updatedAt: "", completed: false }];
    state.history = [...state.bookmarks];
    await act(async () => { root.render(<StrictMode><App key="saved-card" /></StrictMode>); });
    if (screen === "saved") await click("saved");
    const card = container.querySelector<HTMLButtonElement>('.section-saved button[aria-label="open Fixture"]');
    expect(card).not.toBeNull();
    await act(async () => { card!.click(); });
    expect(container.querySelector("h1")?.textContent).toBe("Fixture");
    expect(container.querySelectorAll(".eps .src")).toHaveLength(1);
    expect(api.play).not.toHaveBeenCalled();
    expect(api.streams).not.toHaveBeenCalled();
  });

  it("navigates results, returns through the series breadcrumb, and clears with Escape", async () => {
    search.mockResolvedValue([...result("first"), ...result("second")]);
    await type("title"); await advance();
    await press("ArrowDown"); await press("Enter");
    expect(api.episodes).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "aniwave:second-1" }), expect.any(Object), expect.any(Function));
    await backFromSeries(); expect(titles()).toEqual(["first", "second"]);
    await press("Escape"); expect(input().value).toBe(""); expect(titles()).toEqual([]);
  });

  it("debounces typing, trims whitespace, and searches without Enter", async () => {
    await type("f"); await advance(150); await type("fr"); await advance(150);
    await type(" frieren "); await advance(299);
    expect(search).not.toHaveBeenCalled(); await advance(1);
    expect(search).toHaveBeenCalledExactlyOnceWith("frieren", "auto", expect.any(Object), expect.any(Function));
    expect(titles()).toEqual(["frieren"]);
    await type("frieren  "); await advance(); expect(search).toHaveBeenCalledTimes(1);
  });
  it("flushes on Enter once and opens only after current results arrive", async () => {
    const pending = deferred<AnimeResult[]>(); search.mockReturnValue(pending.promise);
    await type("frieren"); await enter(); await enter(); await advance();
    expect(search).toHaveBeenCalledTimes(1); expect(api.episodes).not.toHaveBeenCalled();
    await act(async () => pending.resolve(result("frieren"))); await enter();
    expect(api.episodes).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "aniwave:frieren-1" }), expect.any(Object), expect.any(Function));
  });
  it("keeps previous results labelled while updating and ignores out-of-order successes", async () => {
    await type("first"); await advance();
    const older = deferred<AnimeResult[]>(), newer = deferred<AnimeResult[]>();
    search.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    await type("older"); await advance(); await type("newer");
    expect(titles()).toEqual(["first"]);
    expect(container.querySelector("#results-heading")?.textContent).toContain('result for "first"');
    await enter(); await act(async () => newer.resolve(result("newer")));
    await act(async () => older.resolve(result("older")));
    expect(titles()).toEqual(["newer"]);
    expect(container.querySelector(".search-throbber")?.children).toHaveLength(0);
  });
  it("suppresses obsolete errors during the next query's debounce", async () => {
    const older = deferred<AnimeResult[]>(); search.mockReturnValueOnce(older.promise);
    await type("older"); await advance(); await type("newer");
    await act(async () => older.reject(new Error("old failure")));
    expect(container.textContent).not.toContain("old failure");
    await advance(); expect(titles()).toEqual(["newer"]);
  });
  it("clears results and feedback immediately and ignores completion after clearing", async () => {
    await type("first"); await advance();
    const pending = deferred<AnimeResult[]>(); search.mockReturnValueOnce(pending.promise);
    await type("next"); await advance(); await type("   ");
    expect(titles()).toEqual([]); expect(container.querySelector(".search-throbber")?.children).toHaveLength(0);
    await act(async () => pending.resolve(result("next"))); expect(titles()).toEqual([]);
    await type("cancel before debounce"); await type(""); await advance(); expect(search).toHaveBeenCalledTimes(2);
  });
  it("reuses catalog searches across playback preference changes and expires the cache", async () => {
    await type("frieren"); await advance(); await type("other"); await advance(); await type("frieren");
    expect(titles()).toEqual(["frieren"]); expect(search).toHaveBeenCalledTimes(2);
    await click("settings"); await click("anidb"); await click("home");
    await type("frieren"); await advance(); expect(titles()).toEqual(["frieren"]); expect(search).toHaveBeenCalledTimes(2);
    await type(""); await advance(60_001); await type("frieren"); await advance();
    expect(search).toHaveBeenCalledTimes(3);
    expect(search).toHaveBeenLastCalledWith("frieren", "auto", expect.any(Object), expect.any(Function));
  });
  it("bounds the cache to twenty searches", async () => {
    for (let index = 0; index < 21; index += 1) { await type(`title ${index}`); await advance(); }
    await type("title 0"); await advance(); expect(search).toHaveBeenCalledTimes(22);
  });
  it("cancels obsolete searches and starts a fresh consumer when returning", async () => {
    const pending = deferred<AnimeResult[]>(); search.mockReturnValueOnce(pending.promise);
    await type("frieren"); await advance(); await type("other"); await advance(); await type("frieren"); await advance();
    expect(search).toHaveBeenCalledTimes(3);
    expect(api.cancelCatalog).toHaveBeenCalledWith(search.mock.calls[0][2]!.id);
    await act(async () => pending.resolve(result("frieren"))); expect(titles()).toEqual(["frieren"]);
  });
  it("searches one-character titles only on Enter, shows empty results, and retries failures with Enter", async () => {
    search.mockRejectedValueOnce(new Error("provider unavailable")).mockResolvedValueOnce([]);
    await type("x"); await advance(1000);
    expect(search).not.toHaveBeenCalled();
    expect(container.querySelector(".search-throbber")?.children).toHaveLength(0);
    expect(container.querySelector(".foot-hints")?.textContent).toContain("search now");
    await enter(); expect(search).toHaveBeenCalledExactlyOnceWith("x", "auto", expect.any(Object), expect.any(Function));
    expect(search.mock.calls[0][2]?.checkNow).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("provider unavailable");
    await enter(); expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls[1][2]?.checkNow).toBe(true);
    expect(container.textContent).toContain('nothing found for "x"');
    await type("next"); expect(container.textContent).not.toContain('nothing found for "x"');
    await advance(); expect(search.mock.calls.at(-1)?.[2]?.checkNow).toBe(false);
  });
  it("waits for IME composition and ignores its Enter key", async () => {
    await act(async () => { input().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); });
    await type("そう"); await advance(1000); await enter({ isComposing: true }); expect(search).not.toHaveBeenCalled();
    await type("葬送");
    await act(async () => { input().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); });
    await advance(); expect(search).toHaveBeenCalledExactlyOnceWith("葬送", "auto", expect.any(Object), expect.any(Function));
  });
  it("keeps saved and recent filters local and cancels scheduled searches on navigation", async () => {
    await type("pending"); await click("saved"); await type("filter"); await advance(); expect(search).not.toHaveBeenCalled();
    await click("recent"); await type("another filter"); await advance(); expect(search).not.toHaveBeenCalled();
  });
  it("searches when editing on a series and ignores late search feedback there", async () => {
    await type("first"); await advance(); await enter(); expect(container.querySelector("h1")?.textContent).toBe("first");
    await type("second"); await advance(); expect(titles()).toEqual(["second"]);
    const pending = deferred<AnimeResult[]>(); search.mockReturnValueOnce(pending.promise);
    await type("third"); await advance();
    await act(async () => { container.querySelector<HTMLButtonElement>(".section-results .hit")!.click(); });
    await act(async () => pending.reject(new Error("late search failure")));
    expect(container.querySelector("h1")?.textContent).toBe("second"); expect(container.textContent).not.toContain("late search failure");
  });
  it("shows the throbber from the first keystroke until results arrive", async () => {
    const pending = deferred<AnimeResult[]>(); search.mockReturnValueOnce(pending.promise);
    const throbbing = () => container.querySelector(".search-throbber")?.children.length === 3;
    await type("fr"); expect(throbbing()).toBe(true);
    await advance(); expect(throbbing()).toBe(true);
    await act(async () => pending.resolve(result("fr"))); expect(throbbing()).toBe(false);
  });
  it("keeps results while visiting other screens and drops them with Escape on home", async () => {
    await type("frieren"); await advance();
    await click("saved"); expect(input().value).toBe(""); expect(titles()).toEqual([]);
    await press("Escape"); expect(titles()).toEqual(["frieren"]);
    expect(container.querySelector("#results-heading")?.textContent).toContain('result for "frieren"');
    expect(container.querySelector(".foot-hints")?.textContent).toContain("open");
    await press("Enter"); expect(api.episodes).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "aniwave:frieren-1" }), expect.any(Object), expect.any(Function));
    await backFromSeries(); expect(titles()).toEqual(["frieren"]);
    await press("Escape"); expect(titles()).toEqual([]); expect(search).toHaveBeenCalledTimes(1);
  });
  it("returns from a series without searching again after the cache expires", async () => {
    await type("frieren"); await advance(); await enter();
    expect(container.querySelector("h1")?.textContent).toBe("frieren");
    await advance(60_001); await backFromSeries();
    expect(titles()).toEqual(["frieren"]); expect(search).toHaveBeenCalledTimes(1);
    await enter(); expect(api.episodes).toHaveBeenCalledTimes(2);
  });
  it("uses fresh results after a provider URL changes", async () => {
    await type("frieren"); await advance(); await click("settings");
    const urlInput = [...container.querySelectorAll("input")].find((node) => node.value === "https://aniwaves.ru")!;
    await type("https://new.example", urlInput); await click("home"); await type("frieren"); await advance();
    expect(search).toHaveBeenCalledTimes(2);
  });
});

describe("progressive catalog navigation", () => {
  it("resumes by saved ID before lists arrive, updates the queue, and opens the playing episode's series", async () => {
    state.history = [{ animeId: "aniwave:fixture-1", title: "Fixture", lastEpisode: "2", mode: "dub", updatedAt: "", completed: false,
      lastProvider: "aniwave", progressByProvider: { aniwave: { lastEpisode: "2", lastEpisodeId: "aniwave:1:2", mode: "dub", updatedAt: "", completed: false } } }];
    const pending = deferred<Awaited<ReturnType<AniDesktopApi["episodes"]>>>();
    vi.mocked(api.episodes).mockReturnValue(pending.promise);
    vi.mocked(api.streams).mockResolvedValue([{ quality: "1080p", url: "https://cdn.test/2.m3u8", provider: "aniwave" }]);
    vi.mocked(api.play).mockImplementation(async (request) => { load({ id: "direct", request, preferences: {}, fullscreen: false, canOpenExternal: false }); return true; });
    await act(async () => root.render(<StrictMode><App key="direct" /></StrictMode>));
    await press("Enter");
    expect(api.streams).toHaveBeenCalledExactlyOnceWith("aniwave:1:2", "dub", expect.objectContaining({ priority: "playback" }));
    expect(container.querySelector(".series")).toBeNull();
    expect(container.querySelector('[data-testid="player"]')).not.toBeNull();
    expect(playerStub.props?.onNext).toBeUndefined();
    await act(async () => pending.resolve({ groups: [{ provider: "aniwave", episodes: [1, 2, 3].map((number) => ({ id: `aniwave:1:${number}`, number: String(number), provider: "aniwave" })) }] }));
    expect(playerStub.props?.onNext).toBeDefined();
    await click("playing episodes");
    expect(container.querySelector(".series h1")?.textContent).toBe("Fixture");
    expect(container.querySelector<HTMLElement>('.src.playing')?.dataset.episode).toBe("aniwave:1:2");
    expect(vi.mocked(api.play).mock.calls[0][0].episode?.entry.progressByProvider?.aniwave?.lastEpisodeId).toBe("aniwave:1:2");
    await click("next episode");
    expect(api.streams).toHaveBeenLastCalledWith("aniwave:1:3", "dub", expect.any(Object));
  });

  it("cancels direct continuation and ignores a stream arriving after navigation", async () => {
    state.history = [{ animeId: "aniwave:fixture-1", title: "Fixture", lastEpisode: "1", mode: "sub", updatedAt: "", completed: false,
      lastProvider: "aniwave", progressByProvider: { aniwave: { lastEpisode: "1", lastEpisodeId: "aniwave:1:1", mode: "sub", updatedAt: "", completed: false } } }];
    const pending = deferred<Awaited<ReturnType<AniDesktopApi["streams"]>>>();
    vi.mocked(api.streams).mockReturnValue(pending.promise);
    await act(async () => root.render(<StrictMode><App key="cancel-direct" /></StrictMode>));
    await press("Enter");
    // The card finds its episode in place, carrying the travelling arc; Escape stops it and Home stays as it was.
    expect(container.querySelector(".page-home .card.is-resolving")).not.toBeNull(); expect(container.querySelector(".series")).toBeNull();
    const request = vi.mocked(api.streams).mock.calls[0][2]!;
    await press("Escape");
    expect(api.cancelCatalog).toHaveBeenCalledWith(request.id);
    await act(async () => pending.resolve([{ quality: "720p", url: "https://cdn.test/1.m3u8", provider: "aniwave" }]));
    expect(api.play).not.toHaveBeenCalled(); expect(container.querySelector(".page-home")).not.toBeNull();
    expect(container.querySelector(".card.is-resolving")).toBeNull();
  });

  it("tries the same episode on another source after direct resolution fails", async () => {
    state.history = [{ animeId: "aniwave:fixture-1", title: "Fixture", lastEpisode: "2", mode: "sub", updatedAt: "", completed: false,
      lastProvider: "aniwave", progressByProvider: { aniwave: { lastEpisode: "2", lastEpisodeId: "aniwave:1:2", mode: "sub", updatedAt: "", completed: false } } }];
    vi.mocked(api.episodes).mockResolvedValue({ groups: [{ provider: "hianime", episodes: [{ id: "hianime:two", number: "2", provider: "hianime" }] }] });
    vi.mocked(api.streams).mockRejectedValueOnce(new Error("Source offline")).mockResolvedValue([{ quality: "720p", url: "https://cdn.test/2.m3u8", provider: "hianime" }]);
    await act(async () => root.render(<StrictMode><App key="fallback-direct" /></StrictMode>));
    await press("Enter");
    expect(api.streams).toHaveBeenNthCalledWith(2, "hianime:two", "sub", expect.any(Object));
    expect(api.play).toHaveBeenCalledOnce();
  });

  it("goes on to the series page from the card when a stream cannot be found", async () => {
    state.history = [{ animeId: "aniwave:fixture-1", title: "Fixture", lastEpisode: "1", mode: "sub", updatedAt: "", completed: true }];
    vi.mocked(api.episodes).mockResolvedValue({ groups: [{ provider: "aniwave", episodes: [1, 2].map((number) => ({ id: `aniwave:1:${number}`, number: String(number), provider: "aniwave" })) }] });
    vi.mocked(api.streams).mockRejectedValue(new Error("no stream was found"));
    await act(async () => root.render(<StrictMode><App key="resume-failed" /></StrictMode>));
    await press("Enter");
    expect(container.querySelector(".series h1")?.textContent).toBe("Fixture");
    expect(container.querySelector(".play-note")?.textContent).toContain("no stream was found");
    expect(container.querySelector(".play-note")?.textContent).toContain("Try again");
  });

  it("opens the series page without an error when the viewer is caught up", async () => {
    state.history = [{ animeId: "aniwave:fixture-1", title: "Fixture", lastEpisode: "2", mode: "sub", updatedAt: "", completed: true }];
    vi.mocked(api.episodes).mockResolvedValue({ groups: [{ provider: "aniwave", episodes: [1, 2].map((number) => ({ id: `aniwave:1:${number}`, number: String(number), provider: "aniwave" })) }] });
    await act(async () => root.render(<StrictMode><App key="caught-up" /></StrictMode>));
    await press("Enter");
    expect(api.streams).not.toHaveBeenCalled();
    expect(container.querySelector(".series h1")?.textContent).toBe("Fixture");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector(".status-pill")).toBeNull();
  });

  it("waits for a new episode instead of replaying the last cached completed episode", async () => {
    state.history = [{ animeId: "aniwave:fixture-1", title: "Fixture", lastEpisode: "2", mode: "sub", updatedAt: "", completed: true }];
    const pending = deferred<Awaited<ReturnType<AniDesktopApi["episodes"]>>>();
    vi.mocked(api.episodes).mockImplementation((_anime, _request, update) => {
      update?.({ groups: [{ provider: "aniwave", refreshing: true, episodes: [{ id: "aniwave:1:2", number: "2", provider: "aniwave" }] }] });
      return pending.promise;
    });
    await act(async () => root.render(<StrictMode><App key="cached-next" /></StrictMode>));
    await press("Enter"); expect(api.streams).not.toHaveBeenCalled();
    await act(async () => pending.resolve({ groups: [{ provider: "aniwave", episodes: [{ id: "aniwave:1:3", number: "3", provider: "aniwave" }] }] }));
    expect(api.streams).toHaveBeenCalledExactlyOnceWith("aniwave:1:3", "sub", expect.any(Object));
  });

  it("opens partial search results while a slower provider is still pending", async () => {
    const pending = deferred<AnimeResult[]>();
    search.mockReturnValueOnce(pending.promise);
    await type("frieren"); await advance();
    await act(async () => { search.mock.calls[0][3]!({ value: [result("frieren")[0], { id: "hianime:frieren-x", title: "frieren", provider: "hianime" }], pending: ["anidb"], errors: {} }); });
    expect(titles()).toEqual(["frieren"]);
    // One row for both providers, with a chip per source and no merge affordance.
    expect([...container.querySelectorAll(".section-results .srcs .tag")].map((node) => node.textContent)).toEqual(["aniwave", "hianime"]);
    expect(container.querySelector(".section-results .mini-act")).toBeNull();
    await act(async () => { search.mock.calls[0][3]!({ value: [result("frieren")[0], { id: "hianime:frieren-x", title: "frieren", provider: "hianime" }], pending: [], errors: { anidb: "AniDB search failed (503)" } }); });
    expect(container.querySelector('.palette [role="status"]')?.textContent).toContain("Some results may be missing.");
    await enter(); expect(container.querySelector("h1")?.textContent).toBe("frieren");
    expect(vi.mocked(api.episodes).mock.calls[0][0].sources?.map((source) => source.provider)).toEqual(["aniwave", "hianime"]);
    expect(api.cancelCatalog).toHaveBeenCalledWith(search.mock.calls[0][2]!.id);
    await act(async () => pending.resolve(result("late")));
    expect(container.querySelector("h1")?.textContent).toBe("frieren");
  });

  it("keeps native button focus when source rows are inserted above it", async () => {
    const pending = deferred<AnimeResult>();
    vi.mocked(api.resolveSources).mockReturnValueOnce(pending.promise);
    vi.mocked(api.episodes).mockImplementation(async (anime) => ({ groups: (anime.sources ?? [{ id: anime.id, provider: anime.provider }]).map((source) => ({ provider: source.provider, episodes: [1, 2, 3, 4].map((number) => ({ id: `${source.provider}:${number}`, number: String(number), provider: source.provider })) })) }));
    await type("frieren"); await advance(); await enter();
    const episodeButton = container.querySelector<HTMLButtonElement>('[aria-label="play episode 2 from aniwave"]')!;
    await act(async () => { episodeButton.focus(); });
    await act(async () => pending.resolve({ ...result("frieren")[0], sources: [
      { id: "aniwave:frieren-1", provider: "aniwave", title: "frieren", aliases: [] },
      { id: "hianime:frieren-2", provider: "hianime", title: "frieren", aliases: [] }
    ] }));
    expect(document.activeElement).toBe(episodeButton);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("play episode 2 from aniwave");
    expect(container.querySelectorAll(".src")).toHaveLength(8);
  });

  it("shows an early episode group and retains discovery failures after completion", async () => {
    const episodes = deferred<Awaited<ReturnType<AniDesktopApi["episodes"]>>>(), discovery = deferred<AnimeResult>();
    vi.mocked(api.episodes).mockReturnValueOnce(episodes.promise);
    vi.mocked(api.resolveSources).mockReturnValueOnce(discovery.promise);
    await type("frieren"); await advance(); await enter();
    const catalog = { groups: [{ provider: "aniwave" as const, episodes: [{ id: "aniwave:1:1", number: "1", provider: "aniwave" as const }] }] };
    await act(async () => { vi.mocked(api.episodes).mock.calls[0][2]!(catalog); });
    expect(container.querySelectorAll(".src")).toHaveLength(1);
    expect(container.textContent).not.toContain("loading episodes");
    await act(async () => {
      vi.mocked(api.resolveSources).mock.calls[0][2]!({ value: result("frieren")[0], pending: [], errors: { anidb: "503" } });
      discovery.resolve(result("frieren")[0]); episodes.resolve(catalog);
    });
    expect(container.textContent).toContain("anidb: 503");
  });
});

it("cancels a pending play lookup when leaving the series and ignores its late response", async () => {
  const pending = deferred<Awaited<ReturnType<AniDesktopApi["streams"]>>>();
  vi.mocked(api.streams).mockReturnValue(pending.promise);
  await type("frieren"); await advance(); await enter();
  await act(async () => container.querySelector<HTMLButtonElement>('.src-hit')!.click());
  const request = vi.mocked(api.streams).mock.calls[0][2]!;
  await backFromSeries(); expect(api.cancelCatalog).toHaveBeenCalledWith(request.id);
  await act(async () => pending.resolve([{ quality: "720p", url: "https://cdn.test/1.m3u8", provider: "aniwave" }]));
  expect(api.play).not.toHaveBeenCalled();
});

describe("responsive library navigation", () => {
  it.each([6, 8])("moves one visual row through a %i-column library", async (columns) => {
    state.bookmarks = Array.from({ length: 16 }, (_, index) => ({ animeId: `aniwave:series-${index + 1}`, title: `Series ${index + 1}`, lastEpisode: "1", mode: "sub", updatedAt: "" }));
    vi.mocked(api.getState).mockResolvedValue({ ...state });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    await act(async () => { container.querySelector<HTMLButtonElement>('button[title="saved"]')!.click(); });
    container.querySelector<HTMLElement>(".cards")!.style.setProperty("--cols", String(columns));
    await press("ArrowDown");
    expect(container.querySelector('.card[data-cursor="true"] .t')?.textContent).toBe(`Series ${columns + 1}`);
    await press("ArrowUp");
    expect(container.querySelector('.card[data-cursor="true"] .t')?.textContent).toBe("Series 1");
  });

  it("moves through a wrapped home section before entering the next section", async () => {
    state.history = Array.from({ length: 8 }, (_, index) => ({ animeId: `aniwave:recent-${index + 1}`, title: `Recent ${index + 1}`, lastEpisode: "1", mode: "sub", updatedAt: "" }));
    state.bookmarks = [{ animeId: "aniwave:saved-1", title: "Saved 1", lastEpisode: "1", mode: "sub", updatedAt: "" }];
    vi.mocked(api.getState).mockResolvedValue({ ...state });
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    container.querySelector<HTMLElement>(".cards")!.style.setProperty("--cols", "6");
    await press("ArrowDown");
    expect(container.querySelector('.card[data-cursor="true"] .t')?.textContent).toBe("Recent 7");
    await press("ArrowDown");
    expect(container.querySelector('.card[data-cursor="true"] .t')?.textContent).toBe("Saved 1");
    await press("ArrowUp");
    expect(container.querySelector('.card[data-cursor="true"] .t')?.textContent).toBe("Recent 7");
    await press("ArrowUp");
    for (let index = 0; index < 4; index++) await press("ArrowRight");
    expect(container.querySelector('.card[data-cursor="true"] .t')?.textContent).toBe("Recent 5");
    await press("ArrowDown");
    expect(container.querySelector('.card[data-cursor="true"] .t')?.textContent).toBe("Recent 8");
  });
});

const setupBrowse = async () => {
  vi.mocked(api.browseGenres).mockResolvedValue(["Action", "Adventure"]);
  vi.mocked(api.browse).mockImplementation(async (query) => ({ query, hasNextPage: true, fetchedAt: Date.now(), entries: [{
    anilistId: 42, refs: ["anilist:42", "mal:42"], title: "Catalog Pick", titles: ["Catalog Pick", "Alternate Title"],
    genres: ["Action"], type: "TV", year: 2026, status: "finished", studios: []
  }] }));
  await click("Browse"); await advance(0);
};

describe("browse navigation and resolution", () => {
  it("opens a series genre as a fresh browse filter and keeps it when returning from another series", async () => {
    await setupBrowse();
    vi.mocked(api.browseGenres).mockResolvedValue(["Action", "Adventure", "Fantasy"]);
    await click("Show more"); await advance(0);
    await act(async () => { container.querySelector<HTMLButtonElement>(".browse-genres button")!.click(); });
    await advance(0);
    vi.mocked(api.seriesMetadata).mockResolvedValue({ genres: ["Fantasy"], sources: [] });
    await click("Home"); await type("frieren"); await advance(); await enter();
    vi.mocked(api.browse).mockClear();
    await click("Fantasy"); await advance(0);
    expect(container.querySelector(".page-browse")).not.toBeNull();
    expect(api.browse).toHaveBeenCalledWith({ page: 1, filters: { includeGenres: ["Fantasy"], excludeGenres: [], sort: "popularity" } }, expect.anything(), expect.any(Function));
    expect(vi.mocked(api.browse).mock.calls.every(([query]) => query.page === 1 && query.filters.includeGenres.join() === "Fantasy")).toBe(true);
    expect(container.querySelector(".page-browse")?.scrollTop).toBe(0);
    vi.mocked(api.browse).mockClear();
    await act(async () => { container.querySelector<HTMLButtonElement>(".browse .card .hit")!.click(); });
    await advance(0);
    expect(container.querySelector(".series .crumb")?.textContent).toBe("Browse");
    await backFromSeries();
    expect(container.querySelector('.browse-genres button.inc')?.textContent).toBe("Fantasy");
    expect(api.browse).not.toHaveBeenCalled();
  });

  it("enters the clicked studio name in Browse and lets its matching studio be selected", async () => {
    const studio = { id: 11, name: "Madhouse", animation: true };
    vi.mocked(api.workInfo).mockResolvedValue({ refs: ["anilist:154587"], title: "Frieren", titles: {}, synonyms: [], status: "finished", genres: ["Fantasy"], studios: ["MAPPA", "Madhouse"], relations: [], fetchedAt: Date.now(), source: "anilist" });
    vi.mocked(api.browse).mockImplementation(async (query) => ({ query, entries: [], studios: query.filters.search ? [studio] : [], hasNextPage: false, fetchedAt: Date.now() }));
    await type("frieren"); await advance(); await enter();
    expect([...container.querySelectorAll(".studio-link")].map((node) => node.textContent)).toEqual(["MAPPA", "Madhouse"]);
    await click("Madhouse"); await advance(0);
    expect(container.querySelector<HTMLInputElement>(".browse-search input")?.value).toBe("Madhouse");
    expect(vi.mocked(api.browse).mock.calls.at(-1)![0]).toEqual({ page: 1, filters: { includeGenres: [], excludeGenres: [], sort: "match", search: "Madhouse" } });
    await act(async () => { container.querySelector<HTMLButtonElement>(".browse-suggest button")!.click(); });
    await advance(0);
    expect(vi.mocked(api.browse).mock.calls.at(-1)![0].filters).toEqual({ includeGenres: [], excludeGenres: [], sort: "popularity", studio });
    expect(container.querySelector(".studio-token")?.textContent).toContain("Madhouse");
  });

  it("opens an AniList tag as a tag filter, separately from genres", async () => {
    vi.mocked(api.workInfo).mockResolvedValue({ refs: ["anilist:154587"], title: "Frieren", titles: {}, synonyms: [], status: "finished", genres: ["Fantasy"], tags: ["Elf", "Travel"], studios: [], relations: [], fetchedAt: Date.now(), source: "anilist" });
    await type("frieren"); await advance(); await enter();
    expect([...container.querySelectorAll('.series-tags button')].map((node) => node.textContent)).toEqual(["Elf", "Travel"]);
    await click("Elf"); await advance(0);
    expect(vi.mocked(api.browse).mock.calls.at(-1)![0]).toEqual({ page: 1, filters: { includeGenres: [], excludeGenres: [], tags: ["Elf"], sort: "popularity" } });
    expect(container.querySelector(".browse-line .token")?.textContent).toContain("Elf");
  });

  it("opens genre filters from a catalog detail without streaming sources", async () => {
    await setupBrowse(); vi.mocked(api.discoverBrowse).mockResolvedValue({ errors: {} });
    await act(async () => { container.querySelector<HTMLButtonElement>(".browse .card .hit")!.click(); });
    await advance(0);
    expect(container.querySelector(".browse-detail")).not.toBeNull();
    await click("Action"); await advance(0);
    expect(container.querySelector(".page-browse")).not.toBeNull();
    expect(vi.mocked(api.browse).mock.calls.at(-1)![0].filters).toEqual({ includeGenres: ["Action"], excludeGenres: [], sort: "popularity" });
  });

  it("preserves arrow navigation inside the filter controls", async () => {
    await setupBrowse(); await click("Filters");
    const controls = container.querySelectorAll(".browse-field input, .browse-panel .chips button, .browse-genres button");
    expect(controls.length).toBeGreaterThan(4);
    for (const control of controls) {
      const event = new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true });
      await act(async () => { control.dispatchEvent(event); });
      expect(event.defaultPrevented).toBe(false);
    }
  });
  it("opens a discovered alias with catalogue references and does not start another source budget", async () => {
    await setupBrowse();
    vi.mocked(api.discoverBrowse).mockResolvedValue({ anime: { id: "aniwave:correct-1", provider: "aniwave", title: "Alternate Title", refs: ["anilist:42", "mal:42"] }, errors: { hianime: "503" } });
    await act(async () => { container.querySelector<HTMLButtonElement>(".browse .card .hit")!.click(); });
    await advance(0);
    expect(api.discoverBrowse).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ refs: ["anilist:42", "mal:42"], titles: ["Catalog Pick", "Alternate Title"] }), expect.objectContaining({ priority: "selected", refresh: false }));
    expect(search).not.toHaveBeenCalled();
    expect(api.resolveSources).not.toHaveBeenCalled();
    expect(api.episodes).toHaveBeenCalledWith(expect.objectContaining({ id: "aniwave:correct-1", refs: ["anilist:42", "mal:42"] }), expect.anything(), expect.anything());
    expect(container.textContent).toContain("503");
  });
  it("reports incomplete discovery and explicitly retries with a fresh budget", async () => {
    await setupBrowse();
    vi.mocked(api.discoverBrowse).mockResolvedValueOnce({ errors: { hianime: "Source discovery timed out after 20 seconds" } });
    await act(async () => { container.querySelector<HTMLButtonElement>(".browse .card .hit")!.click(); });
    await advance(0);
    expect(container.textContent).toContain("Source search was incomplete");
    expect(api.episodes).not.toHaveBeenCalled();
    await click("Retry source search"); await advance(0);
    expect(vi.mocked(api.discoverBrowse).mock.calls[1][1]).toMatchObject({ refresh: true, checkNow: true });
    expect(container.querySelector(".series")).not.toBeNull();
    expect(api.resolveSources).not.toHaveBeenCalled();
  });
  it("offers a manual search when no source matches and keeps Browse marked in the navigation", async () => {
    await setupBrowse();
    vi.mocked(api.discoverBrowse).mockResolvedValue({ errors: {} });
    await act(async () => { container.querySelector<HTMLButtonElement>(".browse .card .hit")!.click(); });
    await advance(0);
    expect(container.querySelector('.icons button[title="browse"]')?.className).toBe("on");
    expect(container.querySelector(".browse-detail .facts")?.textContent).toContain("Finished");
    await click("Search manually");
    expect(container.querySelector(".browse-detail")).toBeNull();
    expect(container.querySelector<HTMLInputElement>(".search input")?.value).toBe("Catalog Pick");
  });
  it("applies typed filters after a pause, holds an invalid entry back, and sends scores on AniList's scale", async () => {
    await setupBrowse(); await click("Filters");
    const input = (label: string) => [...container.querySelectorAll<HTMLInputElement>(".browse-field input")].find((item) => (item.getAttribute("aria-label") ?? item.closest("label")!.textContent) === label)!;
    const type = async (label: string, value: string) => act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input(label), value);
      input(label).dispatchEvent(new Event("input", { bubbles: true }));
    });
    vi.mocked(api.browse).mockClear();
    await type("Episodes from", "24"); await type("Episodes to", "12"); await advance(500);
    expect(input("Episodes to").getAttribute("aria-invalid")).toBe("true");
    expect(api.browse).not.toHaveBeenCalled();
    await type("Episodes to", "26"); await type("Score from", "85"); await advance(500);
    expect(input("Score from").getAttribute("aria-invalid")).toBe("true");
    expect(api.browse).not.toHaveBeenCalled();
    await type("Score from", "8.5");
    expect(container.querySelector(".field-problem")).toBeNull();
    await advance(500);
    expect(api.browse).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ page: 1, filters: expect.objectContaining({ minimumScore: 85, minimumEpisodes: 24, maximumEpisodes: 26 }) }), expect.anything(), expect.any(Function));
    expect([...container.querySelectorAll(".browse-line .token")].map((token) => token.firstChild?.textContent)).toEqual(["Score 8.5+", "24 to 26 episodes"]);
  });
  it("cycles a genre through include, exclude, and off, applying each change at once", async () => {
    await setupBrowse();
    const chip = () => [...container.querySelectorAll<HTMLButtonElement>(".browse-genres button")].find((button) => button.textContent?.startsWith("Action"))!;
    const sent = () => vi.mocked(api.browse).mock.calls.at(-1)![0].filters;
    await act(async () => { chip().click(); }); await advance(0);
    expect(chip().className).toContain("inc"); expect(sent()).toMatchObject({ includeGenres: ["Action"], excludeGenres: [] });
    await act(async () => { chip().click(); }); await advance(0);
    expect(chip().className).toContain("exc"); expect(sent()).toMatchObject({ includeGenres: [], excludeGenres: ["Action"] });
    await act(async () => { chip().click(); }); await advance(0);
    expect(chip().getAttribute("aria-pressed")).toBe("false"); expect(sent()).toMatchObject({ includeGenres: [], excludeGenres: [] });
  });
  it("offers one removal per active filter when nothing matches", async () => {
    await setupBrowse();
    vi.mocked(api.browse).mockImplementation(async (query) => ({ query, hasNextPage: false, fetchedAt: Date.now(), entries: [] }));
    for (const genre of ["Action", "Adventure"]) { await act(async () => { [...container.querySelectorAll<HTMLButtonElement>(".browse-genres button")].find((button) => button.textContent === genre)!.click(); }); await advance(0); }
    expect(container.textContent).toContain("Nothing matches all of these");
    expect([...container.querySelectorAll(".browse-none .fixes button")].map((button) => button.textContent)).toEqual(["Remove Action", "Remove Adventure", "Clear all"]);
    await click("Remove Adventure"); await advance(0);
    expect(vi.mocked(api.browse).mock.calls.at(-1)![0].filters).toMatchObject({ includeGenres: ["Action"] });
  });
  it("retries a failed genre load on its own without touching the page of results", async () => {
    vi.mocked(api.browseGenres).mockRejectedValue(new Error("offline"));
    vi.mocked(api.browse).mockImplementation(async (query) => ({ query, hasNextPage: false, fetchedAt: Date.now(), entries: [] }));
    await click("Browse"); await advance(0);
    expect(container.textContent).toContain("Genres could not load. offline");
    vi.mocked(api.browse).mockClear(); vi.mocked(api.browseGenres).mockResolvedValue(["Action"]);
    await click("Retry"); await advance(0);
    expect(container.querySelector(".browse-genres button")?.textContent).toBe("Action");
    expect(container.textContent).not.toContain("Genres could not load");
    expect(api.browse).not.toHaveBeenCalled();
  });
  it("opens remembered sources returned by main-process discovery", async () => {
    await setupBrowse();
    vi.mocked(api.discoverBrowse).mockResolvedValue({ anime: { id: "aniwave:known-1", title: "Catalog Pick", provider: "aniwave", refs: ["anilist:42"] }, errors: {} });
    await act(async () => { container.querySelector<HTMLButtonElement>(".browse .card .hit")!.click(); });
    await advance(0);
    expect(search).not.toHaveBeenCalled();
    expect(api.resolveSources).not.toHaveBeenCalled();
    expect(api.episodes).toHaveBeenCalledWith(expect.objectContaining({ id: "aniwave:known-1" }), expect.anything(), expect.anything());
  });
  it("checks sources on the card and cancels the check on Escape without leaving Browse", async () => {
    await setupBrowse();
    const pending = deferred<BrowseDiscoveryResult>(); vi.mocked(api.discoverBrowse).mockReturnValue(pending.promise);
    await act(async () => { container.querySelector<HTMLButtonElement>(".browse .card .hit")!.click(); });
    await advance(0);
    expect(container.querySelector(".browse .card.is-resolving [role=status]")?.textContent).toBe("Checking streaming sources");
    expect(container.querySelector(".browse-detail")).toBeNull();
    await press("Escape");
    expect(container.querySelector(".browse .card.is-resolving")).toBeNull();
    await act(async () => { pending.resolve({ anime: result("late")[0], errors: {} }); });
    expect(api.discoverBrowse).toHaveBeenCalledOnce();
    expect(api.cancelCatalog).toHaveBeenCalledWith(expect.stringContaining("browse-open"));
    expect(container.querySelector(".browse")).not.toBeNull();
    expect(container.querySelector(".browse-detail")).toBeNull();
    expect(api.episodes).not.toHaveBeenCalled();
  });
  it("appends the next page under the grid and drops a title the catalog repeats", async () => {
    await setupBrowse();
    const entry = (anilistId: number) => ({ anilistId, refs: [`anilist:${anilistId}`], title: `Title ${anilistId}`, titles: [`Title ${anilistId}`], genres: [], status: "finished" as const, studios: [] });
    vi.mocked(api.browse).mockClear().mockImplementation(async (query) => ({ query: { page: query.page, filters: query.filters }, hasNextPage: false, fetchedAt: Date.now(), entries: [entry(42), entry(43)] }));
    expect(container.querySelector(".browse-more")?.textContent).toBe("1 shownShow more");
    await click("Show more"); await advance(0);
    expect(api.browse).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ page: 2 }), expect.anything(), expect.any(Function));
    expect([...container.querySelectorAll(".browse .card .t")].map((title) => title.textContent)).toEqual(["Catalog Pick", "Title 43"]);
    expect(container.querySelector(".browse-more")?.textContent).toBe("All 2 shown");
  });
});

const DEFAULT_FILTERS = { includeGenres: [], excludeGenres: [], sort: "popularity" as const };

describe("search inside browse", () => {
  const entry = (anilistId: number, title: string) => ({ anilistId, refs: [`anilist:${anilistId}`], title, titles: [title], genres: ["Action"], type: "TV" as const, status: "finished" as const, studios: [] });
  const toei = { id: 18, name: "Toei Animation", animation: true }, producer = { id: 141, name: "Toei Video", animation: false };
  const setupSearch = async () => {
    vi.mocked(api.browseGenres).mockResolvedValue(["Action", "Adventure"]);
    vi.mocked(api.browse).mockImplementation(async (query) => ({ query, hasNextPage: false, fetchedAt: Date.now(),
      entries: query.filters.studio ? [entry(21, "ONE PIECE")] : query.filters.search === "toei" ? [entry(7, "Toei Robot Girls")] : query.filters.search ? [] : [entry(42, "Catalog Pick")],
      ...(query.filters.search && !query.filters.studio ? { studios: query.filters.search.startsWith("toei") ? [toei, producer] : [] } : {}) }));
    await click("Browse"); await advance(0);
  };
  const field = () => container.querySelector<HTMLInputElement>(".browse-search input")!;
  const typeTerm = async (value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(), value); field().dispatchEvent(new Event("input", { bubbles: true })); });
  const key = async (target: Element, name: string) => act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
  const lastFilters = () => vi.mocked(api.browse).mock.calls.at(-1)![0].filters;
  const titles = () => [...container.querySelectorAll(".browse .card .t")].map((node) => node.textContent);

  it("lists the catalog at rest, searches titles by best match, and returns to the catalog and its sort when the term goes", async () => {
    await setupSearch();
    expect(titles()).toEqual(["Catalog Pick"]);
    await click("Top rated"); await advance(0);
    vi.mocked(api.browse).mockClear();
    await typeTerm("t"); await advance(700);
    expect(api.browse).not.toHaveBeenCalled();
    await typeTerm("toei"); await advance(300);
    expect(api.browse).not.toHaveBeenCalled();
    await advance(400);
    expect(lastFilters()).toMatchObject({ search: "toei", sort: "match" });
    expect(titles()).toEqual(["Toei Robot Girls"]);
    expect([...container.querySelectorAll('.browse-sort [role="radio"]')].map((node) => node.textContent)).toEqual(["Best match", "Popular", "Top rated", "Newest", "A–Z"]);
    expect(container.querySelector(".bar .search.as-button")).not.toBeNull();
    await typeTerm(""); await advance(0);
    expect(lastFilters()).toMatchObject({ sort: "score" }); expect(lastFilters().search).toBeUndefined();
    expect(titles()).toEqual(["Catalog Pick"]);
    expect(container.querySelector('.browse-sort [aria-checked="true"]')?.textContent).toBe("Top rated");
  });
  it("offers matching studios, takes one from the keyboard, and returns to the earlier sort", async () => {
    await setupSearch();
    await typeTerm("toei"); await advance(700);
    const suggestions = () => [...container.querySelectorAll<HTMLButtonElement>(".browse-suggest button")];
    expect(suggestions().map((button) => button.textContent)).toEqual(["Toei Animationanimation studio", "Toei Videoproducer"]);
    await key(field(), "ArrowDown");
    expect(document.activeElement).toBe(suggestions()[0]);
    await key(suggestions()[0], "ArrowRight");
    expect(document.activeElement).toBe(suggestions()[1]);
    await key(suggestions()[1], "ArrowLeft");
    await act(async () => { suggestions()[0].click(); }); await advance(0);
    expect(lastFilters()).toMatchObject({ studio: toei, sort: "popularity" }); expect(lastFilters().search).toBeUndefined();
    expect(container.querySelector(".studio-token")?.textContent).toContain("Toei Animation");
    expect(field().value).toBe(""); expect(field().placeholder).toBe("Title within Toei Animation");
    expect(container.querySelector('.reveal[data-open="true"] .browse-suggest')).toBeNull();
    expect(titles()).toEqual(["ONE PIECE"]);
    await key(container.querySelector(".browse .card .hit")!, "Escape");
    expect(document.activeElement).toBe(field());
    await key(field(), "Backspace"); await advance(0);
    expect(container.querySelector(".studio-token")).toBeNull();
    expect(titles()).toEqual(["Catalog Pick"]);
  });
  it("points at the studio when no title matches, and hands the words to the source search", async () => {
    await setupSearch();
    await typeTerm("toei ani"); await advance(700);
    expect(container.textContent).toContain("No titles contain “toei ani”");
    await key(field(), "Enter"); await advance(0);
    expect(lastFilters()).toMatchObject({ studio: toei });
    await act(async () => { container.querySelector<HTMLButtonElement>(".studio-token button")!.click(); }); await advance(0);
    await typeTerm("zzzz"); await advance(700);
    expect(container.textContent).toContain("Nothing matches all of these");
    await click("Search sources for “zzzz”");
    expect(container.querySelector(".browse")).toBeNull();
    expect(container.querySelector<HTMLInputElement>(".search input")?.value).toBe("zzzz");
  });
  it("clears the term on the first Escape and only then lets Escape leave", async () => {
    await setupSearch();
    await typeTerm("toei"); await advance(700);
    await key(field(), "Escape"); await advance(0);
    expect(field().value).toBe(""); expect(container.querySelector(".browse")).not.toBeNull();
    expect(titles()).toEqual(["Catalog Pick"]);
    await key(field(), "Escape");
    expect(container.querySelector(".browse")).not.toBeNull();
  });
  it("shows a studio's popular works while its list is read, with the filters stepped back", async () => {
    await setupSearch();
    const pending = deferred<import("../shared/contracts").BrowseResult>();
    vi.mocked(api.browse).mockImplementation(async (query, _request, update) => { update?.({ studio: "Toei Animation", read: 25, entries: [entry(21, "ONE PIECE")] }); return pending.promise.then((result) => ({ ...result, query })); });
    await typeTerm("toei"); await advance(700);
    expect(container.querySelector(".browse-reading")?.textContent).toContain("Fetching Toei Animation's catalog · 25 so far");
    expect(titles()).toEqual(["ONE PIECE"]);
    expect(container.querySelector(".browse-genres")?.parentElement?.className).toContain("is-waiting");
    await act(async () => { pending.resolve({ query: { page: 1, filters: DEFAULT_FILTERS }, entries: [entry(22, "Dragon Ball")], hasNextPage: false, fetchedAt: Date.now() }); });
    expect(container.querySelector(".browse-reading")).toBeNull();
    expect(titles()).toEqual(["Dragon Ball"]);
  });
  it("adds tags from the filters panel, which has no studio field of its own", async () => {
    vi.mocked(api.browseTags).mockResolvedValue(["Isekai", "Reverse Isekai", "Time Travel"]);
    await setupBrowse(); await click("Filters"); await advance(0);
    const box = () => container.querySelector<HTMLInputElement>('.typeahead input[aria-label="Tags"]')!;
    await act(async () => { box().focus(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(box(), "isek"); box().dispatchEvent(new Event("input", { bubbles: true })); });
    expect([...container.querySelectorAll(".typeahead-list button")].map((button) => button.textContent)).toEqual(["Isekai", "Reverse Isekai"]);
    await key(box(), "ArrowDown"); await key(box(), "Enter"); await advance(0);
    expect(lastFilters()).toMatchObject({ tags: ["Reverse Isekai"] });
    expect([...container.querySelectorAll(".browse-line .token")].map((token) => token.textContent)).toEqual(["Reverse Isekai×"]);
    expect([...container.querySelectorAll(".typeahead input")].map((input) => input.getAttribute("aria-label"))).toEqual(["Tags"]);
  });
});
