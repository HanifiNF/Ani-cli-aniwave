import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { PLAYER_FULLSCREEN_CHANGED, assertPlayerSender, registerPlayerFullscreenEvents, setPlayerFullscreen } from "../electron/player-window";

function windowMock() {
  const events = new EventEmitter();
  const webContents = { isDestroyed: vi.fn(() => false), mainFrame: {}, send: vi.fn() };
  const playerWindow = Object.assign(events, {
    isDestroyed: vi.fn(() => false), isFullScreen: vi.fn(() => false), setFullScreen: vi.fn(), webContents
  }) as unknown as BrowserWindow;
  return { playerWindow, webContents, events };
}
afterEach(() => vi.useRealTimers());

describe("native player window fullscreen", () => {
  it("accepts only the player main frame as an IPC sender", () => {
    const { playerWindow, webContents } = windowMock();
    const valid = { sender: webContents, senderFrame: webContents.mainFrame } as unknown as IpcMainInvokeEvent;
    expect(() => assertPlayerSender(playerWindow, valid)).not.toThrow();
    expect(() => assertPlayerSender(playerWindow, { ...valid, senderFrame: {} } as IpcMainInvokeEvent)).toThrow("Unknown player sender");
    expect(() => setPlayerFullscreen(playerWindow, "true")).toThrow("Fullscreen state must be a boolean");
  });

  it("waits for the native transition and suppresses repeated toggles", async () => {
    const { playerWindow, events } = windowMock();
    const done = vi.fn();
    const first = setPlayerFullscreen(playerWindow, true);
    first.then(done);
    expect(setPlayerFullscreen(playerWindow, false)).toBe(first);
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    expect(playerWindow.setFullScreen).toHaveBeenCalledExactlyOnceWith(true);
    events.emit("enter-full-screen");
    await expect(first).resolves.toBe(true);
    expect(events.listenerCount("enter-full-screen")).toBe(0);
  });

  it("reports rejected window manager transitions and allows another attempt", async () => {
    vi.useFakeTimers();
    const { playerWindow, events } = windowMock();
    const failed = expect(setPlayerFullscreen(playerWindow, true)).rejects.toThrow("window manager");
    await vi.advanceTimersByTimeAsync(5000);
    await failed;
    const retry = setPlayerFullscreen(playerWindow, true);
    events.emit("enter-full-screen");
    await expect(retry).resolves.toBe(true);
  });

  it("cleans up an outstanding transition when the window closes", async () => {
    const { playerWindow, events } = windowMock();
    const pending = setPlayerFullscreen(playerWindow, true);
    events.emit("closed");
    await expect(pending).rejects.toThrow("closed");
    expect(events.listenerCount("leave-full-screen")).toBe(0);
  });

  it("publishes native enter and leave events to the renderer", () => {
    const { playerWindow, webContents, events } = windowMock();
    registerPlayerFullscreenEvents(playerWindow);
    events.emit("enter-full-screen"); events.emit("leave-full-screen");
    expect(webContents.send).toHaveBeenNthCalledWith(1, PLAYER_FULLSCREEN_CHANGED, true);
    expect(webContents.send).toHaveBeenNthCalledWith(2, PLAYER_FULLSCREEN_CHANGED, false);
  });
});
