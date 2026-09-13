// Captures the live renderer (npx vite, in-memory dev API) screen by screen at the app's window size.
// Usage: env -u ELECTRON_RUN_AS_NODE npx electron design/capture-app.cjs [url]
const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

const url = process.argv[2] || "http://127.0.0.1:5173/";
const size = { width: Number(process.env.SHOT_WIDTH) || 1240, height: Number(process.env.SHOT_HEIGHT) || 800 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.dock?.hide();

app.whenReady().then(async () => {
  await mkdir(join(__dirname, "shots"), { recursive: true });
  const win = new BrowserWindow({ ...size, show: false, frame: false, webPreferences: { offscreen: true } });
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name, ms = 500) => {
    await wait(ms);
    await writeFile(join(__dirname, "shots", `app-${name}${process.env.SHOT_SUFFIX || ""}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`captured app-${name}`);
  };
  const type = (value) => js(`(() => { const input = document.querySelector(".search input"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  const click = (selector) => js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("missing " + ${JSON.stringify(selector)}); el.click(); return true; })()`);
  const key = (k) => js(`window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true })); true`);

  await win.loadURL(url);
  await wait(1200);
  await shot("home");
  await type("frieren");
  await shot("search", 1200);
  await click(".section-results .hit");
  await shot("series", 1200);
  await key("?");
  await shot("series-hints", 200);
  await key("?");
  await click('.eps .src[data-cursor="true"] .src-hit');
  await shot("series-status", 300);
  await shot("player", 2500);
  await key("Escape");
  await shot("mini", 800);
  await click('button[title="recent"]');
  await shot("recent", 600);
  await click('button[title="saved"]');
  await shot("saved", 600);
  await click('button[title="settings"]');
  await shot("settings", 600);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
