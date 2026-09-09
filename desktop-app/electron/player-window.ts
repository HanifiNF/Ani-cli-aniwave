import type { BrowserWindow, IpcMainInvokeEvent } from "electron";

export const PLAYER_FULLSCREEN_CHANGED = "player-window:fullscreen-change";

export function assertPlayerSender(playerWindow: BrowserWindow | undefined, event: IpcMainInvokeEvent): asserts playerWindow is BrowserWindow {
  if (
    !playerWindow
    || playerWindow.isDestroyed()
    || event.sender !== playerWindow.webContents
    || event.senderFrame !== playerWindow.webContents.mainFrame
  ) {
    throw new Error("Unknown player sender");
  }
}

export function setPlayerFullscreen(playerWindow: BrowserWindow | undefined, fullscreen: unknown): boolean {
  if (!playerWindow || playerWindow.isDestroyed()) throw new Error("Player window is not available");
  if (typeof fullscreen !== "boolean") throw new Error("Fullscreen state must be a boolean");
  playerWindow.setFullScreen(fullscreen);
  return fullscreen;
}

export function registerPlayerFullscreenEvents(playerWindow: BrowserWindow): void {
  const publish = (fullscreen: boolean) => {
    if (!playerWindow.isDestroyed() && !playerWindow.webContents.isDestroyed()) {
      playerWindow.webContents.send(PLAYER_FULLSCREEN_CHANGED, fullscreen);
    }
  };
  playerWindow.on("enter-full-screen", () => publish(true));
  playerWindow.on("leave-full-screen", () => publish(false));
}
