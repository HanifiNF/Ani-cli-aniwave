// Records variants/companion-bubble.html at 2x (captures come back at the screen's scale too, so the video is halved): a still per variant (design/shots/bubble-*.png) and one MP4 of the scripted
// sequence with every variant side by side (design/shots/motion/bubble.mp4), on the page's virtual clock (1/60 s per frame).
// Usage: env -u ELECTRON_RUN_AS_NODE npx electron design/record-companion-bubble.cjs
const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile, rm } = require("node:fs/promises");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process");

const ZOOM = 2, SECONDS = 9.2;
const shots = join(__dirname, "shots"), out = join(shots, "motion");
const page = pathToFileURL(join(__dirname, "variants", "companion-bubble.html")).href;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.dock?.hide();
app.on("window-all-closed", () => undefined);

async function open(query) {
  const win = new BrowserWindow({ width: 1700 * ZOOM, height: 760 * ZOOM, show: false, frame: false, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false, zoomFactor: ZOOM } });
  win.webContents.setFrameRate(60);
  win.webContents.on("console-message", (e) => { if (e.level === "error") console.log("page:", e.message); });
  await win.loadURL(`${page}?${query}`);
  await wait(1200);
  const js = (code) => win.webContents.executeJavaScript(code);
  const rect = (selector) => js(`(() => { const r = [...document.querySelectorAll(${JSON.stringify(selector)})].map((el) => el.getBoundingClientRect());
    const x = Math.min(...r.map((b) => b.left)), y = Math.min(...r.map((b) => b.top)), w = Math.max(...r.map((b) => b.right)) - x, h = Math.max(...r.map((b) => b.bottom)) - y;
    return { x: Math.floor((x - 16) * ${ZOOM}), y: Math.floor((y - 16) * ${ZOOM}), width: Math.ceil((w + 32) * ${ZOOM}), height: Math.ceil((h + 16) * ${ZOOM}) }; })()`);
  return { win, js, rect };
}

app.whenReady().then(async () => {
  await mkdir(out, { recursive: true });
  {
    const { win, js, rect } = await open("still");
    for (const id of ["current", "v1", "v2", "v3"]) {
      await writeFile(join(shots, `bubble-${id}.png`), (await win.webContents.capturePage(await rect(`[data-variant="${id}"]`))).toPNG());
      console.log("still", id);
    }
    win.destroy();
  }
  const dir = join(out, "frames-bubble");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const { win, js, rect } = await open("virtual");
  await js(`document.querySelectorAll('[data-scene="line"]').forEach((el) => el.style.display = "none"); mock.script(); true`);
  const area = await rect(".col");
  const writes = [];
  for (let n = 0; n < Math.round(SECONDS * 60); n++) {
    await js("mock.frame()");
    const image = await win.webContents.capturePage(area);
    writes.push(writeFile(join(dir, `${String(n).padStart(5, "0")}.jpg`), image.toJPEG(92)));
  }
  await Promise.all(writes);
  win.destroy();
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "60", "-i", join(dir, "%05d.jpg"), "-vf", "scale=trunc(iw/4)*2:trunc(ih/4)*2,format=yuv420p", "-c:v", "libx264", "-crf", "18", "-movflags", "+faststart", join(out, "bubble.mp4")]);
  await rm(dir, { recursive: true, force: true });
  console.log("video", join(out, "bubble.mp4"));
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
