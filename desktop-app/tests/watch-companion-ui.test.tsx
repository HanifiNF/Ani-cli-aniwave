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
  afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

  it("switches supplied art, speaks on click, and hides for fullscreen or opening", async () => {
    const props = { settings: { ...DEFAULT_STATE.settings, companionPetId: "feibi" as const }, screen: "home", fullscreen: false, corner: "bottom-left" as const, dockedPlayer: true };
    await act(async () => root.render(<WatchCompanion {...props} />));
    const pet = container.querySelector<HTMLButtonElement>(".companion-pet")!;
    expect(pet.getAttribute("aria-label")).toBe("Talk to 菲比");
    expect(pet.style.backgroundImage).toContain("pets/feibi/spritesheet.webp");
    expect(container.querySelector(".side-right")).not.toBeNull();
    await act(async () => pet.click());
    expect(container.querySelector(".companion-bubble")?.textContent).toContain("Hi!");
    await act(async () => root.render(<WatchCompanion {...props} fullscreen />));
    expect(container.querySelector(".watch-companion")).toBeNull();
    await act(async () => root.render(<WatchCompanion {...props} screen="opening" />));
    expect(container.querySelector(".watch-companion")).toBeNull();
  });
});
