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
});
