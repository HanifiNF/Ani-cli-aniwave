// Records the live renderer (npx vite, in-memory dev API) running scripted interactions, as MP4s in design/shots/motion/.
// The page runs at quarter speed (Chromium animations through DevTools, the spring engine through its capture hook), and
// frames come from the DevTools screencast with the renderer's own timestamps, so the video plays back at true speed.
// Usage: env -u ELECTRON_RUN_AS_NODE npx electron design/record-app-motion.cjs [flow] [controls]
const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile, rm, link } = require("node:fs/promises");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");

const RATE = 0.25, URL = process.env.APP_URL || "http://127.0.0.1:5173/";
const out = join(__dirname, "shots", "motion");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.dock?.hide();
app.on("window-all-closed", () => undefined);

// Page helpers: a real press (down, a short hold, up, click), typing, keys, and a drag along legs of [dx, dy, ms].
const HELPERS = `
  window.rec = {
    el: (s) => typeof s === "string" ? document.querySelector(s) : s,
    at: (el) => { const r = el.getBoundingClientRect(); return { clientX: r.left + r.width / 2, clientY: r.top + Math.min(r.height / 2, 20), bubbles: true, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }; },
    async tap(s, hold = 70) { const el = rec.el(s); if (!el) throw new Error("missing " + s); const p = rec.at(el); el.dispatchEvent(new PointerEvent("pointerdown", p)); await rec.sleep(hold); el.dispatchEvent(new PointerEvent("pointerup", p)); el.dispatchEvent(new MouseEvent("click", { ...p, detail: 1 })); },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms / ${RATE})),
    async type(text) { const i = document.querySelector(".search input"); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; for (let n = 1; n <= text.length; n++) { set.call(i, text.slice(0, n)); i.dispatchEvent(new Event("input", { bubbles: true })); await rec.sleep(80); } },
    key(k, o = {}) { (document.activeElement || document.body).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...o })); },
    async drag(s, legs) { const el = rec.el(s); el.setPointerCapture = () => {}; el.hasPointerCapture = () => true; el.releasePointerCapture = () => {}; let p = rec.at(el); el.dispatchEvent(new PointerEvent("pointerdown", p));
      for (const [dx, dy, ms] of legs) { const n = Math.max(1, Math.round(ms / 16)), x0 = p.clientX, y0 = p.clientY; for (let k = 1; k <= n; k++) { p = { ...p, clientX: x0 + dx * k / n, clientY: y0 + dy * k / n }; el.dispatchEvent(new PointerEvent("pointermove", p)); await rec.sleep(16); } }
      el.dispatchEvent(new PointerEvent("pointerup", p)); }
  };
`;

// [page script, hold afterwards in real milliseconds]
const SEQUENCES = {
  flow: [
    ["", 700],
    ["await rec.type('frieren')", 900],
    ["await rec.tap('.section-results .hit')", 1100],
    ["await rec.tap('.chips [role=radio]:nth-of-type(2)')", 500],
    ["await rec.tap('.ep-head .chips [role=radio]:nth-of-type(1)')", 700],
    ["await rec.tap('.series .btn.primary')", 2600],
    ["rec.key('Escape')", 1100],
    ["await rec.drag('.mini-bar', [[-300, -120, 140], [-500, -300, 90]])", 1300],
    ["rec.key('`')", 1100],
    ["rec.key('Escape')", 900],
    ["await rec.tap('.mini-close')", 600],
    ["await rec.tap('.series .crumb')", 1300],
  ],
  // Home scrolled to Saved, open a saved title, go back: the page returns as it was and the poster lands on its Saved card.
  "return": [
    ["", 600],
    ["document.querySelector('.page').scrollTop = 350", 700],
    ["await rec.tap('[data-origin-group=\"saved\"] .card .hit')", 1500],
    ["await rec.tap('.series .crumb')", 1600],
    ["", 200],
  ],
  // A Browse card (AniList cover) opens a series showing another picture: the flyer crossfades in the air, both ways.
  "browse-poster": [
    ["await rec.tap('[title=browse]')", 2200],
    ["await rec.tap([...document.querySelectorAll('.browse-grid .card')].find((c) => /Frieren/.test(c.textContent)).querySelector('.hit'))", 2400],
    ["await rec.tap('.series .crumb')", 1400],
  ],
  // The Settings save indicator: the arc turns while saving, becomes the tick, and "Sav" never moves.
  "save-state": [
    ["await rec.tap('[title^=settings]')", 1000],
    ["await rec.tap('.settings [role=switch]')", 2900],
  ],
  // Continue watching finds the next episode on the card (the travelling arc), then the player grows out of the card.
  resume: [
    ["", 600],
    ["await rec.tap('.page-home .card .hit')", 3400],
  ],
  controls: [
    ["await rec.tap('[title=settings]')", 1000],
    ["await rec.tap('[aria-label=\"Start fullscreen\"]')", 700],
    ["await rec.drag('[aria-label=\"Autoplay next episode\"]', [[-30, 0, 200], [-24, 0, 300]])", 900],
    ["await rec.tap('.settings [role=radiogroup] [role=radio]:nth-of-type(3)')", 600],
    ["await rec.tap('.settings [role=radiogroup] [role=radio]:nth-of-type(1)')", 800],
    ["await rec.tap('.tile:nth-of-type(4)')", 1100],
    ["await rec.tap('.tile:nth-of-type(1)')", 1100],
    ["await rec.tap('.settings-section-nav button:nth-of-type(4)')", 1100],
    ["await rec.tap('[title=home]')", 900],
    ["await rec.tap('[title=browse]')", 800],
    ["await rec.tap('[title=saved]')", 800],
    ["await rec.tap('[title=home]')", 900],
  ],
};

async function record(name) {
  const dir = join(out, `frames-app-${name}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const win = new BrowserWindow({ width: 1240, height: 800, show: false, frame: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false } });
  await win.loadURL(URL);
  await wait(2000);
  const js = (code) => win.webContents.executeJavaScript(code);
  await js(`${HELPERS}; true`);
  const cdp = win.webContents.debugger;
  cdp.attach("1.3");
  await cdp.sendCommand("Animation.enable");
  await cdp.sendCommand("Animation.setPlaybackRate", { playbackRate: RATE });
  await js(`window.__aniMotionRate = ${RATE}; true`);
  const frames = [], writes = [];
  cdp.on("message", (_event, method, params) => {
    if (method !== "Page.screencastFrame") return;
    const file = join(dir, `${String(frames.length).padStart(5, "0")}.jpg`);
    frames.push({ file, at: params.metadata.timestamp * 1000 });
    writes.push(writeFile(file, Buffer.from(params.data, "base64")));
    void cdp.sendCommand("Page.screencastFrameAck", { sessionId: params.sessionId }).catch(() => undefined);
  });
  await cdp.sendCommand("Page.startScreencast", { format: "jpeg", quality: 90, maxWidth: 1240, maxHeight: 800, everyNthFrame: 1 });
  await wait(300);
  for (const [code, hold] of SEQUENCES[name]) {
    if (code) await js(`(async () => { ${code} })().then(() => true)`);
    if (process.env.TRACE) console.log(code.slice(0, 60), "→", await js(`(document.querySelector(".player-shell")?.className ?? "no player") + " | flyers " + document.querySelectorAll(".flyer").length`));
    await wait(hold / RATE);
    // The screencast only sends a frame when something repaints; a one-pixel change at the corner makes sure the
    // settled state of each step reaches the video.
    await js(`(() => { let dot = document.getElementById("rec-dot"); if (!dot) { dot = document.createElement("i"); dot.id = "rec-dot"; dot.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;z-index:9999;pointer-events:none"; document.body.append(dot); } dot.style.background = dot.style.background === "rgba(0, 0, 0, 0.01)" ? "rgba(0, 0, 0, 0.02)" : "rgba(0, 0, 0, 0.01)"; return true; })()`);
    await wait(120);
  }
  await cdp.sendCommand("Page.stopScreencast");
  await Promise.all(writes);
  win.destroy();
  if (frames.length < 2) throw new Error("no frames");
  const seq = join(dir, "seq");
  await mkdir(seq);
  const start = frames[0].at, end = frames[frames.length - 1].at;
  const ticks = Math.ceil((end - start) * RATE / (1000 / 60));
  for (let tick = 0, i = 0; tick < ticks; tick++) {
    while (i + 1 < frames.length && (frames[i + 1].at - start) * RATE <= tick * (1000 / 60)) i++;
    await link(frames[i].file, join(seq, `${String(tick).padStart(5, "0")}.jpg`));
  }
  const video = join(out, `app-${name}.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "60", "-i", join(seq, "%05d.jpg"), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-c:v", "libx264", "-crf", "18", "-movflags", "+faststart", video]);
  await rm(dir, { recursive: true, force: true });
  console.log(`recorded ${video} (${frames.length} frames, ${(ticks / 60).toFixed(2)} s)`);
}

app.whenReady().then(async () => {
  await mkdir(out, { recursive: true });
  const jobs = process.argv.slice(2).filter((a) => SEQUENCES[a]);
  for (const job of jobs.length ? jobs : Object.keys(SEQUENCES)) await record(job);
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
