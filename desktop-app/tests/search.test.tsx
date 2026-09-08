// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import type { AniDesktopApi, AnimeResult, PersistedState } from "../shared/contracts";
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
let search: ReturnType<typeof vi.fn<AniDesktopApi["search"]>>;
let api: AniDesktopApi;
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
  const state: PersistedState = {
    bookmarks: [], history: [],
    settings: {
      playerPath: "mpv", preferredQuality: "best", preferredMode: "sub", preferredProvider: "auto",
      aniwaveBaseUrl: "https://aniwaves.ru", anidbBaseUrl: "https://anidb.app",
      theme: "graphite", customTheme: { ...THEME_PRESETS.graphite }
    }
  };
  search = vi.fn<AniDesktopApi["search"]>().mockImplementation(async (query) => result(query));
  api = {
    search, getState: vi.fn().mockResolvedValue(state), episodes: vi.fn().mockResolvedValue([{ id: "ep-1", number: "1" }]),
    streams: vi.fn().mockResolvedValue([]), play: vi.fn().mockResolvedValue(true),
    saveSettings: vi.fn(async (settings) => ({ ...state, settings })),
    toggleBookmark: vi.fn(), removeBookmark: vi.fn(), recordHistory: vi.fn(), removeHistory: vi.fn(), clearHistory: vi.fn(), remapEntry: vi.fn()
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

describe("live catalog search", () => {
  it.each(["keyboard", "mouse"])("focuses episodes after opening a search result with the %s", async (method) => {
    const pending = deferred<Awaited<ReturnType<AniDesktopApi["episodes"]>>>();
    vi.mocked(api.episodes).mockReturnValue(pending.promise);
    await type("frieren"); await advance();
    if (method === "keyboard") await press("Enter");
    else await act(async () => { container.querySelector<HTMLButtonElement>(".section-results .hit")!.click(); });
    await act(async () => pending.resolve(Array.from({ length: 6 }, (_, index) => ({ id: `ep-${index + 1}`, number: String(index + 1) }))));
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

  it("keeps focus in search if the user returns there before episodes finish loading", async () => {
    const pending = deferred<Awaited<ReturnType<AniDesktopApi["episodes"]>>>();
    vi.mocked(api.episodes).mockReturnValue(pending.promise);
    await type("frieren"); await advance(); await press("Enter");
    expect(document.activeElement).toBe(container.querySelector(".grid"));
    await press("/"); expect(document.activeElement).toBe(input());
    await act(async () => pending.resolve([{ id: "ep-1", number: "1" }]));
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
    expect(api.episodes).toHaveBeenCalledExactlyOnceWith("aniwave:second-1");
    expect(api.streams).toHaveBeenCalledExactlyOnceWith("ep-1", "sub");
  });

  it("navigates results, opens the selected series, and returns and clears with Escape", async () => {
    search.mockResolvedValue([...result("first"), ...result("second")]);
    await type("title"); await advance();
    await press("ArrowDown"); await press("Enter");
    expect(api.episodes).toHaveBeenCalledExactlyOnceWith("aniwave:second-1");
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
    expect(api.episodes).toHaveBeenCalledExactlyOnceWith("aniwave:frieren-1");
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
    await press("Enter"); expect(api.episodes).toHaveBeenCalledExactlyOnceWith("aniwave:frieren-1");
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
