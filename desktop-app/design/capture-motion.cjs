// Captures frame bursts around the moments that animate: opening a series, opening search, docking the player.
// Usage: env -u ELECTRON_RUN_AS_NODE npx electron design/capture-motion.cjs [url]
const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const { join } = require("node:path");

const url = process.argv[2] || "http://127.0.0.1:5173/";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.dock?.hide();

app.whenReady().then(async () => {
  const dir = join(__dirname, "shots", "motion");
  await mkdir(dir, { recursive: true });
  const win = new BrowserWindow({ width: 1240, height: 800, show: false, frame: false, webPreferences: { offscreen: true } });
  win.webContents.setFrameRate(60);
  const js = (code) => win.webContents.executeJavaScript(code);
  const burst = async (name, times) => {
    const start = Date.now();
    for (const t of times) {
      const delay = start + t - Date.now();
      if (delay > 0) await wait(delay);
      await writeFile(join(dir, `${name}-${String(t).padStart(4, "0")}.png`), (await win.webContents.capturePage()).toPNG());
    }
    console.log(`captured ${name}`);
  };
  const type = (value) => js(`(() => { const input = document.querySelector(".search input"); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
  const click = (selector) => js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("missing " + ${JSON.stringify(selector)}); el.click(); return true; })()`);
  const key = (k) => js(`window.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(k)}, bubbles: true })); true`);

  await win.loadURL(url);
  await burst("home", [0, 80, 160, 300, 600, 1500]);
  await type("frieren");
  await burst("search", [0, 60, 120, 240, 600, 1500]);
  await click(".section-results .hit");
  await burst("series", [0, 40, 100, 200, 350, 600, 1200]);
  await click('.eps .src[data-cursor="true"] .src-hit');
  await burst("status", [0, 100, 300, 2500]);
  await key("Escape");
  await burst("dock", [0, 60, 120, 180, 260, 600]);
  await key("`");
  await burst("expand", [0, 60, 120, 180, 260, 600]);
  win.destroy();
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
