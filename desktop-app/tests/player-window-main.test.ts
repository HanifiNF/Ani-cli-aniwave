import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import {
  PLAYER_FULLSCREEN_CHANGED,
  assertPlayerSender,
  registerPlayerFullscreenEvents,
  setPlayerFullscreen
} from "../electron/player-window";

function windowMock() {
  const listeners = new Map<string, () => void>();
  const webContents = {
    isDestroyed: vi.fn(() => false),
    mainFrame: {},
    send: vi.fn()
  };
  const playerWindow = {
    isDestroyed: vi.fn(() => false),
    isFullScreen: vi.fn(() => false),
    setFullScreen: vi.fn(),
    on: vi.fn((event: string, listener: () => void) => { listeners.set(event, listener); }),
    webContents
  } as unknown as BrowserWindow;
  return { playerWindow, webContents, listeners };
}

describe("native player window fullscreen", () => {
  it("accepts only the player main frame as an IPC sender", () => {
    const { playerWindow, webContents } = windowMock();
    const valid = { sender: webContents, senderFrame: webContents.mainFrame } as unknown as IpcMainInvokeEvent;
    expect(() => assertPlayerSender(playerWindow, valid)).not.toThrow();
    expect(() => assertPlayerSender(playerWindow, { ...valid, senderFrame: {} } as IpcMainInvokeEvent)).toThrow("Unknown player sender");
  });

  it("validates and applies requested fullscreen state", () => {
    const { playerWindow } = windowMock();
    expect(setPlayerFullscreen(playerWindow, true)).toBe(true);
    expect(playerWindow.setFullScreen).toHaveBeenCalledWith(true);
    expect(() => setPlayerFullscreen(playerWindow, "true")).toThrow("Fullscreen state must be a boolean");
  });

  it("publishes native enter and leave events to the renderer", () => {
    const { playerWindow, webContents, listeners } = windowMock();
    registerPlayerFullscreenEvents(playerWindow);
    listeners.get("enter-full-screen")?.();
    listeners.get("leave-full-screen")?.();
    expect(webContents.send).toHaveBeenNthCalledWith(1, PLAYER_FULLSCREEN_CHANGED, true);
    expect(webContents.send).toHaveBeenNthCalledWith(2, PLAYER_FULLSCREEN_CHANGED, false);
  });
});
