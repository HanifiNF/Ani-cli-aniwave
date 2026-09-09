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

const transitions = new WeakMap<BrowserWindow, Promise<boolean>>();

export function setPlayerFullscreen(playerWindow: BrowserWindow | undefined, fullscreen: unknown): Promise<boolean> {
  if (!playerWindow || playerWindow.isDestroyed()) throw new Error("Player window is not available");
  if (typeof fullscreen !== "boolean") throw new Error("Fullscreen state must be a boolean");
  // macOS changes Spaces asynchronously. Ignore repeated input until the window
  // confirms its state, including requests made by native menus.
  const pending = transitions.get(playerWindow);
  if (pending) return pending;
  if (playerWindow.isFullScreen() === fullscreen) return Promise.resolve(fullscreen);
  const win = playerWindow;
  const transition = new Promise<boolean>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      win.removeListener("enter-full-screen", entered);
      win.removeListener("leave-full-screen", left);
      win.removeListener("closed", closed);
    };
    const finish = (state: boolean) => { cleanup(); resolve(state); };
    const entered = () => finish(true);
    const left = () => finish(false);
    const closed = () => { cleanup(); reject(new Error("Player window was closed")); };
    const timeout = setTimeout(() => {
      cleanup();
      if (!win.isDestroyed() && win.isFullScreen() === fullscreen) resolve(fullscreen);
      else reject(new Error("The window manager did not complete the fullscreen transition. Try again."));
    }, 5000);
    win.on("enter-full-screen", entered);
    win.on("leave-full-screen", left);
    win.on("closed", closed);
    try { win.setFullScreen(fullscreen); }
    catch (error) { cleanup(); reject(error); }
  });
  const settled = transition.finally(() => transitions.delete(win));
  transitions.set(win, settled);
  return settled;
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
