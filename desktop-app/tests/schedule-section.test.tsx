// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScheduleSection from "../src/ScheduleSection";
import { DEFAULT_STATE } from "../shared/settings";
import type { AniDesktopApi, ScheduleEntry } from "../shared/contracts";

const makeEntry = (title: string, id: number, episode: string, releaseAt: string): ScheduleEntry => ({
  anime: { id: `aniwave:${title.toLowerCase()}-${id}`, title, provider: "aniwave", sources: [{ id: `aniwave:${title.toLowerCase()}-${id}`, title, aliases: [title], provider: "aniwave" }] },
  episode: { id: `aniwave:${id}:${episode}`, number: episode, provider: "aniwave" }, releaseAt, timeLabel: ""
});
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const scheduleResult = (date: string, title: string) => ({ provider: "aniwave" as const, requestedDate: date,
  refreshedAt: new Date().toISOString(), status: "fresh" as const, entries: [makeEntry(title, title === "Sunday" ? 1 : 2, "1", `${date}T12:00:00.000Z`)] });

describe("Home schedule section", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const open = vi.fn();
  const schedule = vi.fn<AniDesktopApi["schedule"]>();

  beforeEach(() => {
    // Use one absolute instant so UTC CI and local GMT+7 classify releases identically.
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-14T11:00:00.000Z"));
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("IntersectionObserver", class { observe() {} disconnect() {} });
    window.aniDesktop = { schedule, scheduleArtwork: vi.fn(async (animeId) => ({ animeId, aliases: [] })), cancelCatalog: vi.fn() } as unknown as AniDesktopApi;
    schedule.mockResolvedValue({ provider: "aniwave", requestedDate: "2026-09-14", refreshedAt: new Date().toISOString(), status: "fresh", entries: [
      makeEntry("Later", 2, "4", "2026-09-14T14:00:00.000Z"),
      makeEntry("Earlier", 1, "3", "2026-09-14T09:00:00.000Z")
    ] });
    container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  });

  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("selects Monday, labels the season, sorts cards, dims unreleased entries, shows genre chips, and opens without playing", async () => {
    await act(async () => { root.render(<ScheduleSection settings={DEFAULT_STATE.settings} library={[]} onOpen={open}
      metadataFor={() => ({ sources: [], genres: ["Fantasy", "Adventure", "Drama", "Comedy"] })} onMetadata={() => undefined} />); });
    expect(container.querySelector("h2")?.textContent).toBe("Schedule");
    expect(schedule).toHaveBeenLastCalledWith({ date: "2026-09-14", utcStart: new Date(2026, 8, 14).toISOString(), utcEnd: new Date(2026, 8, 15).toISOString(), mode: "sub" }, expect.anything());
    expect(container.querySelector(".schedule-sub")?.textContent).toContain("Summer 2026");
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs).toHaveLength(7);
    expect(tabs.find((tab) => tab.ariaSelected === "true")?.textContent).toContain("Mon");
    expect(tabs.filter((tab) => tab.classList.contains("today")).map((tab) => tab.textContent)).toEqual(["Mon14"]);
    expect(tabs.map((tab) => tab.querySelector("small")?.textContent)).toEqual(["12", "13", "14", "15", "16", "17", "18"]);
    expect([...container.querySelectorAll('[aria-label="Schedule audio"] [role="radio"]')].map((button) => `${button.textContent}:${button.ariaChecked}`)).toEqual(["Sub:true", "Dub:false"]);
    expect([...container.querySelectorAll(".schedule-card .t")].map((node) => node.textContent)).toEqual(["Earlier", "Later"]);
    expect([...container.querySelectorAll(".schedule-card .tag:not(.more)")].map((node) => node.textContent)).toEqual(["Fantasy", "Adventure", "Drama", "Comedy", "Fantasy", "Adventure", "Drama", "Comedy"]);
    expect(container.querySelectorAll(".schedule-card .tag[hidden], .schedule-card .tag.more:not(.probe)")).toHaveLength(0);
    const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    expect([...container.querySelectorAll(".schedule-card .badge")].map((node) => node.textContent)).toEqual(["EP 3", "EP 4"]);
    expect([...container.querySelectorAll(".schedule-card")].map((card) => card.classList.contains("upcoming") ? "upcoming" : "aired")).toEqual(["aired", "upcoming"]);
    expect(container.querySelector(".schedule-card.aired .s")?.textContent).toBe(`Aired · ${clock("2026-09-14T09:00:00.000Z")}`);
    expect(container.querySelector(".schedule-card.upcoming .s")?.textContent).toBe(`${clock("2026-09-14T14:00:00.000Z")} · in 3h`);
    await act(async () => { container.querySelector<HTMLButtonElement>(".schedule-card .hit")!.click(); });
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ title: "Earlier" }), expect.objectContaining({ number: "3" }), "sub");
  });

  it("ignores a superseded day response during rapid tab changes", async () => {
    const monday = deferred<ReturnType<typeof scheduleResult>>(), sunday = deferred<ReturnType<typeof scheduleResult>>();
    schedule.mockImplementation((query) => query.date === "2026-09-14" ? monday.promise : sunday.promise);
    await act(async () => { root.render(<ScheduleSection settings={DEFAULT_STATE.settings} library={[]} onOpen={open} />); });
    await act(async () => { container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1].click(); });
    await act(async () => { monday.resolve(scheduleResult("2026-09-14", "Monday")); await monday.promise; });
    expect(container.querySelector(".schedule-card .t")?.textContent).not.toBe("Monday");
    await act(async () => { sunday.resolve(scheduleResult("2026-09-13", "Sunday")); await sunday.promise; });
    expect(container.querySelector(".schedule-card .t")?.textContent).toBe("Sunday");
  });

  it("counts down on later days and shifts the strip at local midnight, keeping a selection that is still shown", async () => {
    schedule.mockImplementation(async (query) => scheduleResult(query.date, "Show"));
    const selected = () => container.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.title;
    const label = (date: Date) => date.toLocaleDateString([], { month: "short", day: "numeric" });
    const now = new Date(), later = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3), tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    await act(async () => { root.render(<ScheduleSection settings={DEFAULT_STATE.settings} library={[]} onOpen={open} />); });
    await act(async () => { container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[5].click(); });
    expect(selected()).toBe(label(later));
    expect(container.querySelector(".schedule-card.upcoming .s")?.textContent).toMatch(/ · in \d/);
    await act(async () => { vi.advanceTimersByTime(tomorrow.getTime() - now.getTime() + 1); });
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.findIndex((tab) => tab.classList.contains("today"))).toBe(2);
    expect(tabs[2].title).toBe(label(tomorrow));
    expect(selected()).toBe(label(later));
    expect(tabs[4].ariaSelected).toBe("true");
  });

  it("follows today across local midnight when today was selected", async () => {
    schedule.mockImplementation(async (query) => scheduleResult(query.date, "Show"));
    const now = new Date(), tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    await act(async () => { root.render(<ScheduleSection settings={DEFAULT_STATE.settings} library={[]} onOpen={open} />); });
    await act(async () => { vi.advanceTimersByTime(tomorrow.getTime() - now.getTime() + 1); });
    const tab = container.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!;
    expect(tab.classList.contains("today")).toBe(true);
    expect(tab.title).toBe(tomorrow.toLocaleDateString([], { month: "short", day: "numeric" }));
  });

  it("hides cards whose audio mode or source address does not match the active request", async () => {
    const dub = deferred<ReturnType<typeof scheduleResult>>();
    schedule.mockImplementation(async (query) => query.mode === "dub" ? dub.promise : scheduleResult(query.date, "Sub Show"));
    await act(async () => { root.render(<ScheduleSection settings={DEFAULT_STATE.settings} library={[]} onOpen={open} />); });
    expect(container.querySelector(".schedule-card .t")?.textContent).toBe("Sub Show");
    await act(async () => { [...container.querySelectorAll<HTMLButtonElement>('[aria-label="Schedule audio"] [role="radio"]')].find((button) => button.textContent === "Dub")!.click(); });
    expect(schedule).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "dub" }), expect.anything());
    expect(container.querySelector(".schedule-card .t")).toBeNull();
    await act(async () => { dub.resolve(scheduleResult("2026-09-14", "Dub Show")); await dub.promise; });
    expect(container.querySelector(".schedule-card .t")?.textContent).toBe("Dub Show");

    const changed = { ...DEFAULT_STATE.settings, aniwaveBaseUrl: "https://alternate.test" };
    const alternate = deferred<ReturnType<typeof scheduleResult>>();
    schedule.mockReturnValueOnce(alternate.promise);
    await act(async () => { root.render(<ScheduleSection settings={changed} library={[]} onOpen={open} />); });
    expect(container.querySelector(".schedule-card .t")).toBeNull();
    await act(async () => { alternate.resolve(scheduleResult("2026-09-14", "Alternate")); await alternate.promise; });
    expect(container.querySelector(".schedule-card .t")?.textContent).toBe("Alternate");
  });
});
