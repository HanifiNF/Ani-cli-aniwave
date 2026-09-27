// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WatchCompanion from "../src/WatchCompanion";
import { DEFAULT_STATE } from "../shared/settings";

describe("watch companion overlay", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it("switches supplied art, speaks on click, and hides for fullscreen or opening", async () => {
    const props = { settings: { ...DEFAULT_STATE.settings, companionPetId: "feibi" as const }, screen: "home", fullscreen: false, corner: "bottom-left" as const, dockedPlayer: true };
    await act(async () => root.render(<WatchCompanion {...props} />));
    const pet = container.querySelector<HTMLButtonElement>(".companion-pet")!;
    expect(pet.getAttribute("aria-label")).toBe("Talk to or drag 菲比");
    expect(pet.style.backgroundImage).toContain("pets/feibi/spritesheet.webp");
    expect(Number.parseFloat(container.querySelector<HTMLElement>(".watch-companion")!.style.left)).toBeGreaterThan(100);
    await act(async () => pet.click());
    expect(container.querySelector(".companion-bubble")?.textContent).toContain("Hi!");
    await act(async () => root.render(<WatchCompanion {...props} fullscreen />));
    expect(container.querySelector(".watch-companion")).toBeNull();
    await act(async () => root.render(<WatchCompanion {...props} screen="opening" />));
    expect(container.querySelector(".watch-companion")).toBeNull();
  });
  it("separates dragging from click-to-talk and saves an accessible keyboard move", async () => {
    const onHomeChange = vi.fn();
    await act(async () => root.render(<WatchCompanion settings={{ ...DEFAULT_STATE.settings, companionWander: false }} screen="home" fullscreen={false} corner="bottom-right" dockedPlayer={false} onHomeChange={onHomeChange} />));
    const pet = container.querySelector<HTMLButtonElement>(".companion-pet")!;
    const pointer = (type: string, x: number, y: number) => {
      const event = new Event(type, { bubbles: true }) as PointerEvent;
      Object.defineProperties(event, { pointerId: { value: 1 }, button: { value: 0 }, clientX: { value: x }, clientY: { value: y } });
      pet.dispatchEvent(event);
    };
    await act(async () => { pointer("pointerdown", 30, 100); pointer("pointermove", 90, 100); pointer("pointerup", 90, 100); pet.click(); });
    expect(onHomeChange).toHaveBeenCalledOnce();
    expect(container.querySelector(".companion-bubble")).toBeNull();
    await act(async () => pet.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(onHomeChange).toHaveBeenCalledTimes(2);
    await act(async () => pet.click());
    expect(container.querySelector(".companion-bubble")).not.toBeNull();
  });
  it("shows a selected custom sheet and falls back when that sheet is unavailable", async () => {
    const id = "custom:11111111-1111-4111-8111-111111111111" as const;
    const settings = { ...DEFAULT_STATE.settings, companionPetId: id, companionWander: false };
    const props = { settings, screen: "home", fullscreen: false, corner: "bottom-right" as const, dockedPlayer: false, customName: "My pet" };
    await act(async () => root.render(<WatchCompanion {...props} customImage="data:image/png;base64,AA==" />));
    expect(container.querySelector<HTMLButtonElement>(".companion-pet")?.getAttribute("aria-label")).toContain("My pet");
    await act(async () => root.render(<WatchCompanion {...props} customImage={undefined} />));
    expect(container.querySelector<HTMLButtonElement>(".companion-pet")?.style.backgroundImage).toContain("columbinya");
  });
  it("starts walking after the idle delay even when home overlaps a card", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 16));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    const page = document.createElement("main");
    page.className = "page";
    page.getBoundingClientRect = () => ({ left: 0, top: 68, right: 900, bottom: 600, width: 900, height: 532 } as DOMRect);
    const card = document.createElement("button");
    card.getBoundingClientRect = () => ({ left: 0, top: 400, right: 180, bottom: 600, width: 180, height: 200 } as DOMRect);
    page.append(card);
    document.body.append(page);
    try {
      await act(async () => root.render(<WatchCompanion settings={DEFAULT_STATE.settings} screen="home" fullscreen={false} corner="bottom-right" dockedPlayer={false} />));
      const before = container.querySelector<HTMLElement>(".watch-companion")!.style.left;
      await act(async () => { vi.advanceTimersByTime(7_999); });
      expect(container.querySelector<HTMLElement>(".watch-companion")!.style.left).toBe(before);
      await act(async () => { vi.advanceTimersByTime(501); });
      const after = container.querySelector<HTMLElement>(".watch-companion")!.style.left;
      expect(after).not.toBe(before);
    } finally { page.remove(); }
  });
  it("scales built-in and custom sprites and keeps the bubble attached", async () => {
    const props = { screen: "home", fullscreen: false, corner: "bottom-right" as const, dockedPlayer: false };
    for (const percent of [50, 100, 200]) {
      await act(async () => root.render(<WatchCompanion {...props} settings={{ ...DEFAULT_STATE.settings, companionSize: percent, companionWander: false }} event={{ id: percent, kind: "series", title: "Anime" }} />));
      const aside = container.querySelector<HTMLElement>(".watch-companion")!;
      const pet = container.querySelector<HTMLElement>(".companion-pet")!;
      expect(aside.style.width).toBe(`${96 * percent / 100}px`);
      expect(pet.style.height).toBe(`${104 * percent / 100}px`);
      expect(pet.style.backgroundSize).toBe(`${768 * percent / 100}px ${936 * percent / 100}px`);
      expect(container.querySelector<HTMLElement>(".companion-bubble")?.style.bottom).toBe(`${104 * percent / 100 + 4}px`);
    }
    await act(async () => root.render(<WatchCompanion {...props} settings={{ ...DEFAULT_STATE.settings, companionPetId: "custom:11111111-1111-4111-8111-111111111111", companionSize: 200, companionWander: false }} customImage="data:image/png;base64,AA==" />));
    expect(container.querySelector<HTMLElement>(".companion-pet")?.style.backgroundSize).toBe("1536px 1872px");
  });
  it("shows guaranteed series and section lines immediately and handles startup actions", async () => {
    const onMessageDone = vi.fn();
    const onMessageAction = vi.fn();
    const props = { settings: { ...DEFAULT_STATE.settings, companionWander: false }, screen: "home", fullscreen: false, corner: "bottom-right" as const, dockedPlayer: false, onMessageDone, onMessageAction };
    await act(async () => root.render(<WatchCompanion {...props} event={{ id: 1, kind: "series", title: "Anime", key: "same" }} />));
    await act(async () => root.render(<WatchCompanion {...props} event={{ id: 2, kind: "series", title: "Anime", key: "same" }} />));
    expect(container.querySelector(".companion-bubble")?.textContent).toContain("Anime");
    await act(async () => root.render(<WatchCompanion {...props} screen="saved" event={{ id: 3, kind: "section", section: "saved" }} />));
    expect(container.querySelector(".companion-bubble")?.textContent).toContain("saved");
    await act(async () => root.render(<WatchCompanion {...props} screen="home" event={{ id: 4, kind: "startup-update", title: "Anime", episode: "13", otherCount: 1, targetId: "update-1" }} />));
    expect(container.querySelector(".companion-bubble")?.textContent).toContain("1 other unread update");
    await act(async () => container.querySelector<HTMLButtonElement>(".companion-action")!.click());
    expect(onMessageAction).toHaveBeenCalledWith(expect.objectContaining({ targetId: "update-1" }));
    expect(onMessageDone).not.toHaveBeenCalled();
    await act(async () => root.render(<WatchCompanion {...props} event={{ id: 5, kind: "startup-continue", title: "Recent", targetId: "aniwave:recent" }} />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Dismiss companion message"]')!.click());
    expect(onMessageDone).toHaveBeenCalledWith(5);
  });
  it("keeps an actionable bubble for ten seconds and then advances the startup sequence", async () => {
    vi.useFakeTimers();
    const onMessageDone = vi.fn();
    await act(async () => root.render(<WatchCompanion settings={{ ...DEFAULT_STATE.settings, companionWander: false }} screen="home" fullscreen={false} corner="bottom-right" dockedPlayer={false} event={{ id: 11, kind: "startup-continue", title: "Recent" }} onMessageDone={onMessageDone} />));
    await act(async () => { vi.advanceTimersByTime(9_999); });
    expect(onMessageDone).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(onMessageDone).toHaveBeenCalledWith(11);
    expect(container.querySelector(".companion-bubble")).toBeNull();
  });
});
