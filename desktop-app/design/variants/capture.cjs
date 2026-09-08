// Renders each mockup screen at the app's window size and saves a PNG.
// Usage: env -u ELECTRON_RUN_AS_NODE npx electron design/variants/capture.cjs
const { app, BrowserWindow } = require("electron");
const { writeFile } = require("node:fs/promises");
const { join } = require("node:path");

const variant = "b2-palette-art";
const screens = ["home", "series", "saved", "saved-empty", "recent", "settings"];
const size = { width: 1240, height: 800 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.dock?.hide();

app.whenReady().then(async () => {
  const win = new BrowserWindow({ ...size, show: false, frame: false, webPreferences: { offscreen: true } });
  await win.loadFile(join(__dirname, `${variant}.html`));
  await wait(500);
  for (const screen of screens) {
    const exists = await win.webContents.executeJavaScript(`!!document.getElementById(${JSON.stringify(screen)})`);
    if (!exists) continue;
    await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(screen)}; document.fonts.ready.then(() => true)`);
    await wait(400);
    const image = await win.webContents.capturePage();
    await writeFile(join(__dirname, "shots", `${variant}-${screen}.png`), image.toPNG());
    console.log(`captured ${variant}-${screen}`);
  }
  for (const theme of ["paper", "nord", "gruvbox", "mocha", "solarized-light"]) {
    await win.webContents.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; location.hash = "home"; true`);
    await wait(300);
    await writeFile(join(__dirname, "shots", `b2-theme-${theme}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`captured b2-theme-${theme}`);
  }
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
