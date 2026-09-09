import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import type { PlayerCommand } from "../shared/contracts";

export function installApplicationMenu(getPlayer: () => BrowserWindow | undefined): void {
  const update = () => {
    const player = getPlayer();
    const inPlayer = Boolean(player && !player.isDestroyed() && player === BrowserWindow.getFocusedWindow());
    const command = (label: string, action: PlayerCommand, accelerator?: string): MenuItemConstructorOptions => ({
      label, enabled: inPlayer, accelerator,
      click: () => {
        const window = getPlayer();
        if (window && !window.isDestroyed()) window.webContents.send("player-window:command", action);
      }
    });
    const fullscreen: MenuItemConstructorOptions = inPlayer
      ? command("Toggle Fullscreen", "fullscreen", process.platform === "darwin" ? "Control+Command+F" : "F11")
      : { role: "togglefullscreen" };
    const template: MenuItemConstructorOptions[] = [
      ...(process.platform === "darwin" ? [{ label: "Ani Desktop", submenu: [
        { role: "about" }, { type: "separator" }, { role: "services" }, { type: "separator" },
        { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }
      ] } as MenuItemConstructorOptions] : []),
      { label: "File", submenu: [{ role: "close" }, ...(process.platform === "darwin" ? [] : [{ role: "quit" } as MenuItemConstructorOptions])] },
      { role: "editMenu" },
      { label: "Playback", submenu: [
        command("Play / Pause", "play-pause"),
        command("Rewind 10 Seconds", "seek-backward"), command("Forward 10 Seconds", "seek-forward"),
        { type: "separator" }, command("Increase Volume", "volume-up"), command("Decrease Volume", "volume-down"), command("Mute", "mute"),
        { type: "separator" }, command("Captions", "captions"), command("Increase Speed", "speed-up"), command("Decrease Speed", "speed-down"),
        { type: "separator" }, command("Picture in Picture", "pip")
      ] },
      { label: "View", submenu: [fullscreen, ...(!app.isPackaged ? [{ type: "separator" }, { role: "toggleDevTools" }] as MenuItemConstructorOptions[] : [])] },
      { role: "windowMenu" },
      { label: "Help", submenu: [command("Keyboard Shortcuts", "shortcuts", "CommandOrControl+/")] }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  };
  app.on("browser-window-focus", update);
  update();
}
