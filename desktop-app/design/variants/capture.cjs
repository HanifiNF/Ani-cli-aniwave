// Renders each mockup screen at the app's window size and saves a PNG.
// Usage: env -u ELECTRON_RUN_AS_NODE npx electron design/variants/capture.cjs [variant] [theme,...]
//   variant defaults to b2-palette-art. Screens are discovered from the file's section ids.
//   Themes are captured on the first screen; B2 captures its preset set by default.
const { app, BrowserWindow } = require("electron");
const { writeFile } = require("node:fs/promises");
const { join } = require("node:path");

const variant = process.argv[2] || "b2-palette-art";
const themes = process.argv[3] ? process.argv[3].split(",") : variant === "b2-palette-art" ? ["paper", "nord", "gruvbox", "mocha", "solarized-light"] : [];
const size = { width: Number(process.env.SHOT_WIDTH) || 1240, height: Number(process.env.SHOT_HEIGHT) || 800 };
const suffix = process.env.SHOT_SUFFIX || "";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.dock?.hide();

app.whenReady().then(async () => {
  const win = new BrowserWindow({ ...size, show: false, frame: false, webPreferences: { offscreen: true } });
  await win.loadFile(join(__dirname, `${variant}.html`));
  await wait(500);
  const screens = await win.webContents.executeJavaScript(`[...document.querySelectorAll("section.screen[id]")].map((s) => s.id)`);
  for (const screen of screens) {
    await win.webContents.executeJavaScript(`location.hash = ${JSON.stringify(screen)}; document.fonts.ready.then(() => true)`);
    await wait(400);
    const image = await win.webContents.capturePage();
    await writeFile(join(__dirname, "shots", `${variant}-${screen}${suffix}.png`), image.toPNG());
    console.log(`captured ${variant}-${screen}`);
  }
  const prefix = variant === "b2-palette-art" ? "b2" : variant;
  for (const theme of themes) {
    await win.webContents.executeJavaScript(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}; location.hash = ${JSON.stringify(screens[0])}; true`);
    await wait(300);
    await writeFile(join(__dirname, "shots", `${prefix}-theme-${theme}${suffix}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`captured ${prefix}-theme-${theme}`);
  }
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
