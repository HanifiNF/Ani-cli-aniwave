// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AniDesktopApi } from "../shared/contracts";

const bridge = vi.hoisted(() => ({ api: undefined as unknown as AniDesktopApi,
  handlers: new Map<string, Set<(...args: any[]) => void>>(), send: vi.fn(), invoke: vi.fn() }));
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: (_name: string, api: AniDesktopApi) => { bridge.api = api; } },
  ipcRenderer: { send: bridge.send, invoke: bridge.invoke,
    on: (name: string, handler: (...args: any[]) => void) => { const set = bridge.handlers.get(name) ?? new Set(); set.add(handler); bridge.handlers.set(name, set); },
    removeListener: (name: string, handler: (...args: any[]) => void) => bridge.handlers.get(name)?.delete(handler) }
}));
const toggle = (enabled: boolean) => { for (const handler of bridge.handlers.get("player:diagnostics-change") ?? []) handler({}, enabled); };
beforeAll(async () => { await import("../electron/preload"); });
beforeEach(async () => {
  document.body.innerHTML = '<div id="player" tabindex="0"></div>';
  bridge.send.mockClear();
  bridge.invoke.mockResolvedValue({ id: "session-1", diagnostics: false });
  await bridge.api.player.ready();
});
const press = async (target: Element, extra: KeyboardEventInit = {}) => {
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", shiftKey: true, bubbles: true, cancelable: true, ...extra }));
  await new Promise(resolve => setTimeout(resolve, 10));
};

describe("player keyboard diagnostics", () => {
  it("observes consumed and repeated keys without changing their behavior", async () => {
    toggle(true);
    const consume = (event: KeyboardEvent) => { event.preventDefault(); event.stopImmediatePropagation(); };
    window.addEventListener("keydown", consume, true);
    try {
      await press(document.querySelector("#player")!, { repeat: true });
      expect(bridge.send).toHaveBeenCalledExactlyOnceWith("player:diagnostic", "session-1",
        expect.objectContaining({ event: "keyboard", key: "ArrowRight", shift: true, repeat: true, prevented: true, target: "player" }));
    } finally { window.removeEventListener("keydown", consume, true); }
    bridge.send.mockClear();
    const event = new KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(event.defaultPrevented).toBe(false);
    expect(bridge.send).toHaveBeenCalledWith("player:diagnostic", "session-1", expect.objectContaining({ phase: "keyup", prevented: false }));
  });

  it("stays quiet when disabled and excludes editable and composition input", async () => {
    await press(document.body);
    expect(bridge.send).not.toHaveBeenCalled();
    toggle(true);
    document.body.innerHTML = '<input type="password"><textarea></textarea><div contenteditable><span>private</span></div><div role="textbox"></div>';
    for (const target of document.querySelectorAll("input,textarea,span,[role=textbox]")) await press(target, { key: "a", code: "KeyA" });
    await press(document.body, { isComposing: true });
    expect(bridge.send).not.toHaveBeenCalled();
    await press(document.body);
    expect(bridge.send).toHaveBeenCalledTimes(1);
    toggle(false);
    await press(document.body);
    expect(bridge.send).toHaveBeenCalledTimes(1);
  });

  it("stops observing once the player screen is left", async () => {
    toggle(true);
    await bridge.api.player.setActive(false);
    await press(document.body);
    expect(bridge.send).not.toHaveBeenCalled();
    expect(bridge.invoke).toHaveBeenCalledWith("player:active", false);
  });
});
