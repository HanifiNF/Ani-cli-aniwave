// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { AniDesktopApi, AnimeResult, PersistedState, PlayerSession } from "../shared/contracts";
import { THEME_PRESETS } from "../shared/theme";

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
  state = {
    bookmarks: [], history: [],
    settings: {
      playerPath: "mpv", playbackTarget: "builtin", startPlayerFullscreen: true, preferredQuality: "best", preferredMode: "sub", preferredProvider: "auto",
      aniwaveBaseUrl: "https://aniwaves.ru", anidbBaseUrl: "https://anidb.app",
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
    search, getState: vi.fn().mockResolvedValue(state), episodes: vi.fn().mockResolvedValue({ groups: [{ provider: "aniwave", episodes: [{ id: "ep-1", number: "1", provider: "aniwave" }] }] }),
    streams: vi.fn().mockResolvedValue([]), play: vi.fn().mockResolvedValue(true),
    saveSettings: vi.fn(async (settings) => ({ ...state, settings })),
    openPlayerLogs: vi.fn().mockResolvedValue(undefined),
    setAppIcon: vi.fn().mockResolvedValue(undefined),
    toggleBookmark: vi.fn(), removeBookmark: vi.fn(), recordHistory: vi.fn(), removeHistory: vi.fn(), clearHistory: vi.fn(), remapEntry: vi.fn(),
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

describe("built-in player screen", () => {
  const session = (id: string, episodeId: string): PlayerSession => ({ id, preferences: {}, canOpenExternal: false, fullscreen: false,
    request: { url: `https://cdn.test/${episodeId}.m3u8`, title: `Frieren — Episode ${episodeId.slice(-1)}`, episode: { id: episodeId,
      entry: { animeId: "aniwave:frieren-1", title: "Frieren", lastEpisode: episodeId.slice(-1), mode: "sub", updatedAt: "" } } } });

  it("shows the player in place of the page, docks it while browsing, and closes it", async () => {
    vi.mocked(api.episodes).mockResolvedValue({ groups: [{ provider: "aniwave", episodes: [1, 2, 3].map((number) => ({ id: `ep-${number}`, number: String(number), provider: "aniwave" as const })) }] });
    vi.mocked(api.streams).mockResolvedValue([{ quality: "1080p", url: "https://cdn.test/1.m3u8", provider: "aniwave" }]);
    await type("frieren"); await advance(); await enter();
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="play episode 2"]')!.click(); });
    expect(api.play).toHaveBeenCalledOnce();
    await act(async () => load(session("s1", "ep-2")));
    expect(container.querySelector('[data-testid="player"]')?.textContent).toContain("Frieren — Episode 2 of 3");
    expect(container.querySelector(".field")).toBeNull();
    expect(container.querySelector(".foot")?.textContent).toContain("next");
    expect(api.player.setActive).toHaveBeenLastCalledWith(true);
    expect(playerStub.props?.onPrev).toBeDefined();

    // Keys belong to the player screen while it is showing.
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(container.querySelector('[data-testid="player"]')).not.toBeNull();

    await click("next episode");
    expect(api.streams).toHaveBeenLastCalledWith("ep-3", "sub");
    await act(async () => load(session("s2", "ep-3")));
    expect(container.querySelector('[data-testid="player"]')?.textContent).toContain("Episode 3 of 3");
    expect(playerStub.props?.onNext).toBeUndefined();

    // Escape docks: the player stays mounted and playing while the grid comes back.
    const refreshes = vi.mocked(api.getState).mock.calls.length;
    await click("dock player");
    const player = () => container.querySelector<HTMLElement>('[data-testid="player"]');
    expect(player()?.dataset.docked).toBe("true");
    expect(player()?.dataset.corner).toBe("bottom-right");
    expect(container.querySelector(".field")).not.toBeNull();
    expect(container.querySelector('.grid [data-cursor="true"]')?.textContent).toBe("3");
    expect(api.player.setActive).toHaveBeenLastCalledWith(true);
    expect(api.getState).toHaveBeenCalledTimes(refreshes + 1);
    expect(container.querySelector(".foot")?.textContent).toContain("now playing");

    // Browsing elsewhere keeps it docked; the backtick brings it back.
    await click("saved");
    expect(player()?.dataset.docked).toBe("true");
    // The backtick expands the player even while the search field has focus.
    expect(document.activeElement).toBe(input());
    await press("`");
    expect(player()?.dataset.docked).toBe("false");
    expect(container.querySelector(".field")).toBeNull();
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
    expect(container.querySelector(".foot")?.textContent).not.toContain("size");
    await click("dock player");
    expect(container.querySelector(".foot")?.textContent).toContain("size");
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

    await click("close player");
    expect(player()).toBeNull();
    expect(api.player.setActive).toHaveBeenLastCalledWith(false);
    expect(container.querySelector(".foot")?.textContent).not.toContain("now playing");
    expect(container.querySelector('.grid [data-cursor="true"]')?.textContent).toBe("3");
  });

  it("keeps next and previous for the playing series while another series is open", async () => {
    vi.mocked(api.episodes).mockResolvedValue({ groups: [{ provider: "aniwave", episodes: [1, 2, 3].map((number) => ({ id: `ep-${number}`, number: String(number), provider: "aniwave" as const })) }] });
    vi.mocked(api.streams).mockResolvedValue([{ quality: "1080p", url: "https://cdn.test/1.m3u8", provider: "aniwave" }]);
    await type("frieren"); await advance(); await enter();
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="play episode 2"]')!.click(); });
    await act(async () => load(session("s1", "ep-2")));
    await click("dock player");
    vi.mocked(api.episodes).mockResolvedValue({ groups: [{ provider: "aniwave", episodes: [{ id: "other-1", number: "1", provider: "aniwave" }] }] });
    await click("search");
    await type("dandadan"); await advance(); await enter();
    expect(container.querySelector("h1")?.textContent).toBe("dandadan");
    expect(container.querySelector('[data-testid="player"]')?.textContent).toContain("Episode 2 of 3");
    await click("next episode");
    expect(api.streams).toHaveBeenLastCalledWith("ep-3", "sub");
    expect(api.play).toHaveBeenLastCalledWith(expect.objectContaining({ title: "frieren — Episode 3" }));
    await click("playing episodes");
    expect(api.episodes).toHaveBeenLastCalledWith(expect.objectContaining({ id: "aniwave:frieren-1" }));
  });
});

describe("live catalog search", () => {
  it("saves opt-in diagnostics and opens the log folder from settings", async () => {
    await click("settings");
    const group = container.querySelector('[role="radiogroup"][aria-label="logging"]')!;
    expect(group.querySelector('[aria-checked="true"]')?.textContent).toBe("off");
    await act(async () => { [...group.querySelectorAll("button")].find(button => button.textContent === "on")!.click(); });
    await click("open logs");
    expect(api.openPlayerLogs).toHaveBeenCalledOnce();
    expect(api.saveSettings).not.toHaveBeenCalled();
    await click("save changes");
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ playerDiagnostics: true }));
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
    expect(api.streams).toHaveBeenCalledExactlyOnceWith(completed ? "episode-2" : "episode-1", "sub");
  });

  it("previews icon colours, restores them on cancel, and retains a saved theme", async () => {
    const icon = () => decodeURIComponent(document.querySelector<HTMLLinkElement>('link[rel="icon"]')!.href);
    await click("settings"); await click("nord");
    expect(icon()).toContain('fill="#88C0D0"');
    await click("cancel");
    expect(icon()).toContain('fill="#1F2023"');
    await click("settings"); await click("mocha"); await click("save changes");
    expect(api.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ theme: "mocha" }));
    expect(icon()).toContain('fill="#CBA6F7"');
  });

  it.each(["keyboard", "mouse"])("focuses episodes after opening a search result with the %s", async (method) => {
    const pending = deferred<Awaited<ReturnType<AniDesktopApi["episodes"]>>>();
    vi.mocked(api.episodes).mockReturnValue(pending.promise);
    await type("frieren"); await advance();
    if (method === "keyboard") await press("Enter");
    else await act(async () => { container.querySelector<HTMLButtonElement>(".section-results .hit")!.click(); });
    await act(async () => pending.resolve({ groups: [{ provider: "aniwave", episodes: Array.from({ length: 6 }, (_, index) => ({ id: `ep-${index + 1}`, number: String(index + 1), provider: "aniwave" as const })) }] }));
    const cells = [...container.querySelectorAll<HTMLButtonElement>(".grid button")];
    cells.forEach((cell, index) => Object.defineProperty(cell, "offsetTop", { value: Math.floor(index / 3) * 62 }));
    expect(document.activeElement).toBe(cells[0]);
    await press("ArrowRight"); expect(document.activeElement).toBe(cells[1]);
    await press("ArrowDown"); expect(document.activeElement).toBe(cells[4]);
    await press("ArrowLeft"); expect(document.activeElement).toBe(cells[3]);
    await press("ArrowUp"); expect(document.activeElement).toBe(cells[0]);
    await press("ArrowRight"); await press("Enter");
    expect(api.streams).toHaveBeenCalledExactlyOnceWith("ep-2", "sub");
    await press("/"); expect(document.activeElement).toBe(input());
    expect(input().selectionStart).toBe(0); expect(input().selectionEnd).toBe("frieren".length);
    await press("ArrowLeft");
    expect(container.querySelector('.grid [data-cursor="true"]')).toBe(cells[1]);
    await type("another title"); await advance(); expect(titles()).toEqual(["another title"]);
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
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("aniwave 1");
    await click("anidb 1");
    const episode = container.querySelector<HTMLButtonElement>('[aria-label="play episode 81"]')!;
    expect(episode).toBeDefined();
    await act(async () => { episode.click(); });
    expect(api.streams).toHaveBeenCalledExactlyOnceWith("anidb:episode-81", "sub");
    expect(api.play).toHaveBeenCalledWith(expect.objectContaining({ episode: expect.objectContaining({ entry: expect.objectContaining({
      lastProvider: "anidb", lastEpisode: "81",
      progressByProvider: expect.objectContaining({ anidb: expect.objectContaining({ lastEpisode: "81" }) })
    }) }) }));
  });

  it("keeps focus in search if the user returns there before episodes finish loading", async () => {
    const pending = deferred<Awaited<ReturnType<AniDesktopApi["episodes"]>>>();
    vi.mocked(api.episodes).mockReturnValue(pending.promise);
    await type("frieren"); await advance(); await press("Enter");
    expect(document.activeElement).toBe(container.querySelector(".grid"));
    await press("/"); expect(document.activeElement).toBe(input());
    await act(async () => pending.resolve({ groups: [{ provider: "aniwave", episodes: [{ id: "ep-1", number: "1", provider: "aniwave" }] }] }));
    expect(document.activeElement).toBe(input());
  });

  it.each(["home", "saved", "recent"])("navigates %s with an empty field and activates the selected title", async (screen) => {
    const state = await api.getState();
    const entries = ["first", "second", "third"].map((title) => ({
      animeId: `aniwave:${title}-1`, title, lastEpisode: "1", mode: "sub" as const, updatedAt: "2026-09-09T00:00:00Z"
    }));
    state.history = entries;
    state.bookmarks = entries;
    await act(async () => { root.render(<StrictMode><App key="library" /></StrictMode>); });
    if (screen !== "home") await click(screen);
    const selected = () => container.querySelector('.item[data-cursor="true"] .t')?.textContent;
    expect(input().value).toBe("");
    expect(selected()).toBe("first");
    await press("ArrowDown"); expect(selected()).toBe("second");
    await press("ArrowDown"); expect(selected()).toBe("third");
    await press("ArrowUp"); expect(selected()).toBe("second");
    await press("Enter");
    expect(api.episodes).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "aniwave:second-1" }));
    expect(api.streams).toHaveBeenCalledExactlyOnceWith("ep-1", "sub");
  });

  it("navigates results, opens the selected series, and returns and clears with Escape", async () => {
    search.mockResolvedValue([...result("first"), ...result("second")]);
    await type("title"); await advance();
    await press("ArrowDown"); await press("Enter");
    expect(api.episodes).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "aniwave:second-1" }));
    await press("Escape"); expect(titles()).toEqual(["first", "second"]);
    await press("Escape"); expect(input().value).toBe(""); expect(titles()).toEqual([]);
  });

  it("debounces typing, trims whitespace, and searches without Enter", async () => {
    await type("f"); await advance(150); await type("fr"); await advance(150);
    await type(" frieren "); await advance(299);
    expect(search).not.toHaveBeenCalled(); await advance(1);
    expect(search).toHaveBeenCalledExactlyOnceWith("frieren", "auto");
    expect(titles()).toEqual(["frieren"]);
    await type("frieren  "); await advance(); expect(search).toHaveBeenCalledTimes(1);
  });
  it("flushes on Enter once and opens only after current results arrive", async () => {
    const pending = deferred<AnimeResult[]>(); search.mockReturnValue(pending.promise);
    await type("frieren"); await enter(); await enter(); await advance();
    expect(search).toHaveBeenCalledTimes(1); expect(api.episodes).not.toHaveBeenCalled();
    await act(async () => pending.resolve(result("frieren"))); await enter();
    expect(api.episodes).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "aniwave:frieren-1" }));
  });
  it("keeps previous results labelled while updating and ignores out-of-order successes", async () => {
    await type("first"); await advance();
    const older = deferred<AnimeResult[]>(), newer = deferred<AnimeResult[]>();
    search.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    await type("older"); await advance(); await type("newer");
    expect(titles()).toEqual(["first"]);
    expect(container.querySelector("#results-heading")?.textContent).toContain('results for "first"');
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
  it("reuses recent results, separates providers, and expires the cache", async () => {
    await type("frieren"); await advance(); await type("other"); await advance(); await type("frieren");
    expect(titles()).toEqual(["frieren"]); expect(search).toHaveBeenCalledTimes(2);
    await click("anidb"); await advance(); expect(search).toHaveBeenLastCalledWith("frieren", "anidb");
    await click("auto"); await advance(); expect(search).toHaveBeenCalledTimes(3);
    await type(""); await advance(60_001); await type("frieren"); await advance(); expect(search).toHaveBeenCalledTimes(4);
  });
  it("bounds the cache to twenty searches", async () => {
    for (let index = 0; index < 21; index += 1) { await type(`title ${index}`); await advance(); }
    await type("title 0"); await advance(); expect(search).toHaveBeenCalledTimes(22);
  });
  it("coalesces identical requests already in flight", async () => {
    const pending = deferred<AnimeResult[]>(); search.mockReturnValueOnce(pending.promise);
    await type("frieren"); await advance(); await type("other"); await advance(); await type("frieren"); await advance();
    expect(search).toHaveBeenCalledTimes(2);
    await act(async () => pending.resolve(result("frieren"))); expect(titles()).toEqual(["frieren"]);
  });
  it("searches one-character titles only on Enter, shows empty results, and retries failures with Enter", async () => {
    search.mockRejectedValueOnce(new Error("provider unavailable")).mockResolvedValueOnce([]);
    await type("x"); await advance(1000);
    expect(search).not.toHaveBeenCalled();
    expect(container.querySelector(".search-throbber")?.children).toHaveLength(0);
    expect(container.querySelector(".foot")?.textContent).toContain("search now");
    await enter(); expect(search).toHaveBeenCalledExactlyOnceWith("x", "auto");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("provider unavailable");
    await enter(); expect(search).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('nothing found for "x"');
    await type("next"); expect(container.textContent).not.toContain('nothing found for "x"');
  });
  it("waits for IME composition and ignores its Enter key", async () => {
    await act(async () => { input().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })); });
    await type("そう"); await advance(1000); await enter({ isComposing: true }); expect(search).not.toHaveBeenCalled();
    await type("葬送");
    await act(async () => { input().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); });
    await advance(); expect(search).toHaveBeenCalledExactlyOnceWith("葬送", "auto");
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
    expect(container.querySelector("#results-heading")?.textContent).toContain('results for "frieren"');
    expect(container.querySelector(".foot")?.textContent).toContain("open");
    await press("Enter"); expect(api.episodes).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "aniwave:frieren-1" }));
    await press("Escape"); expect(titles()).toEqual(["frieren"]);
    await press("Escape"); expect(titles()).toEqual([]); expect(search).toHaveBeenCalledTimes(1);
  });
  it("returns from a series without searching again after the cache expires", async () => {
    await type("frieren"); await advance(); await enter();
    expect(container.querySelector("h1")?.textContent).toBe("frieren");
    await advance(60_001); await press("Escape");
    expect(titles()).toEqual(["frieren"]); expect(search).toHaveBeenCalledTimes(1);
    await enter(); expect(api.episodes).toHaveBeenCalledTimes(2);
  });
  it("uses fresh results after a provider URL changes", async () => {
    await type("frieren"); await advance(); await click("settings");
    const urlInput = [...container.querySelectorAll("input")].find((node) => node.value === "https://aniwaves.ru")!;
    await type("https://new.example", urlInput); await click("save changes"); await type("frieren"); await advance();
    expect(search).toHaveBeenCalledTimes(2);
  });
});
