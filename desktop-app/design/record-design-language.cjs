// Records variants/design-language.html: stills of each screen and MP4s of scripted sequences, in design/shots/motion/.
// The page runs on a virtual clock that moves 1/60 s per captured frame, so the video plays back at exactly true speed.
// Usage: env -u ELECTRON_RUN_AS_NODE npx electron design/record-design-language.cjs [stills] [flow] [controls] [reduced]
const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile, rm } = require("node:fs/promises");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process");

// Pauses between steps, as a share of the listed holds. FEEL picks the page's motion profile (responsive, spedup, last).
const HOLD = 0.6, FEEL = process.env.FEEL || "responsive";
const WIDTH = 1240, HEIGHT = 800;
const shots = join(__dirname, "shots"), out = join(shots, "motion");
const page = pathToFileURL(join(__dirname, "variants", "design-language.html")).href;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const want = process.argv.slice(2).filter((a) => !a.startsWith("-") && !a.endsWith(".cjs"));
app.dock?.hide();
app.on("window-all-closed", () => undefined);

// [caption, page script, hold in real milliseconds]
const SEQUENCES = {
  flow: [
    ["Home rises in turn", "mock.go('recent'); mock.go('home')", 1100],
    ["Arrow keys move the selection", "mock.key('ArrowRight')", 450],
    ["", "mock.key('ArrowRight')", 350],
    ["", "mock.key('ArrowDown')", 600],
    ["⌘K, then type: the pill grows into the palette", "mock.key('k', { metaKey: true }); mock.type('the')", 1500],
    ["↓ moves the current row", "mock.key('ArrowDown')", 500],
    ["Enter: the thumbnail becomes the poster", "mock.key('Enter')", 1300],
    ["Filter chips: two-edge indicator, rows glide", "mock.tap('.filter [data-v=Unwatched]')", 1000],
    ["", "mock.tap('.filter [data-v=All]')", 900],
    ["Tick an episode: the Play label crossfades", "mock.tap('#eps .ep:not(.seen) .chk')", 1100],
    ["Play grows into the player", "mock.tap('#playBtn')", 1300],
    ["Esc docks it to the corner", "mock.key('Escape')", 1100],
    ["Drag and throw: it keeps its speed to a corner", "mock.drag('#player', [[-160, -60, 160], [-260, -170, 110]])", 1400],
    ["` expands it again", "mock.key('`')", 1100],
    ["Esc, then back: the poster returns to its card", "mock.key('Escape')", 700],
    ["", "mock.key('Escape')", 1400],
    ["Back mid-flight turns from where it is", "mock.tap('.card[data-id=frontier] .poster')", 150],
    ["", "mock.key('Escape')", 1300],
  ],
  controls: [
    ["Settings", "mock.go('settings')", 1000],
    ["Nav indicator: the leading edge stretches ahead", "mock.go('home')", 800],
    ["", "mock.go('settings')", 900],
    ["Switch: tap", "mock.tap('[aria-label=\"Start fullscreen\"]')", 900],
    ["Switch: drag past the end, it stretches and springs back", "mock.drag('[aria-label=\"Autoplay next episode\"]', [[-30, 0, 260], [-26, 0, 400]])", 1300],
    ["Chips", "mock.tap('[aria-label=Player] [data-v=IINA]')", 700],
    ["", "mock.tap('[aria-label=Player] [data-v=Built-in]')", 900],
    ["Theme: new colours glide in", "mock.tap('.tile[data-theme=gruvbox]')", 1300],
    ["", "mock.tap('.tile[data-theme=nord]')", 1300],
    ["", "mock.tap('.tile[data-theme=graphite]')", 1100],
    ["Seek bar: follows the pointer, stretches past the end", "mock.openSeries('legend', {}); mock.later(900, () => mock.tap('#playBtn'))", 3400],
    ["", "mock.drag('#scrub', [[400, 0, 300], [260, 0, 300], [0, 0, 200]])", 1400],
  ],
};

async function open() {
  const win = new BrowserWindow({ width: WIDTH, height: HEIGHT, show: false, frame: false, useContentSize: true, webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.setFrameRate(60);
  win.webContents.on("console-message", (e) => { if (e.level === "error") console.log("page:", e.message); });
  await win.loadURL(page);
  const js = (code) => win.webContents.executeJavaScript(code);
  // Show only the frame, at the window's origin.
  await js(`document.body.style.padding = 0; for (const el of document.querySelectorAll(".doc, .sheet")) el.style.display = "none"; document.querySelector(".app").style.borderRadius = 0; true`);
  await wait(1500);
  return { win, js };
}

async function stills() {
  const { win, js } = await open();
  const shot = async (name, code, ms = 900) => {
    if (code) await js(`${code}; true`);
    await wait(ms);
    await writeFile(join(shots, `lang-${name}.png`), (await win.webContents.capturePage()).toPNG());
    console.log(`captured lang-${name}`);
  };
  await shot("home", "", 300);
  await shot("home-cursor", "mock.key('ArrowRight'); mock.key('ArrowDown')");
  await shot("palette", "mock.key('Escape'); mock.key('k', { metaKey: true }); mock.type('the')", 1500);
  await shot("series", "mock.key('Enter')", 1500);
  await shot("player", "mock.tap('#playBtn')", 1400);
  await shot("mini", "mock.key('Escape')", 1200);
  await shot("settings", "mock.tap('#miniClose'); mock.go('settings')", 1200);
  await shot("settings-gruvbox", "mock.tap('.tile[data-theme=gruvbox]')", 1400);
  await shot("series-gruvbox", "mock.openSeries('ladies', {})", 1400);
  await shot("home-paper", "mock.setTheme('paper'); mock.go('home')", 1400);
  // The spec sheet on its own.
  await js(`mock.setTheme('graphite'); document.querySelector(".app").style.display = "none"; document.querySelector(".sheet").style.display = ""; true`);
  win.setContentSize(WIDTH, 900);
  await shot("sheet", "", 1200);
  win.destroy();
}

async function record(name) {
  const dir = join(out, `frames-lang-${name}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const { win, js } = await open();
  if (name === "reduced") await js(`mock.tap('[data-reduced="1"]'); true`);
  // LABEL=1 names the feel in the frame's corner, for side-by-side comparisons.
  if (process.env.LABEL) await js(`document.querySelector(".app").insertAdjacentHTML("beforeend", '<div style="position:absolute;z-index:99;left:16px;bottom:14px;padding:6px 12px;border-radius:999px;background:#000;color:#fff;font:500 22px Inter">${{ responsive: "Responsive (launched)", last: "Last round (from rest)", spedup: "Sped up 2.5x" }[FEEL]}</div>'); true`);
  // From here the page's clock only moves when a frame is taken, so frame n shows exactly n/60 s.
  await js(`mock.motion.virtual = true; document.querySelector('[data-profile="${FEEL}"]').click(); true`);
  let n = 0;
  const writes = [];
  for (const [, code, hold] of name === "reduced" ? SEQUENCES.flow : SEQUENCES[name]) {
    await js(`${code}; true`);
    const frames = Math.round((hold < 300 ? hold : hold * HOLD) / (1000 / 60));
    for (let i = 0; i < frames; i++) {
      await js("mock.frame()");
      const image = await win.webContents.capturePage();
      writes.push(writeFile(join(dir, `${String(n++).padStart(5, "0")}.jpg`), image.toJPEG(92)));
    }
  }
  await Promise.all(writes);
  win.destroy();
  const video = join(out, `lang-${name}${FEEL === "responsive" ? "" : `-${FEEL}`}.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "60", "-i", join(dir, "%05d.jpg"), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-c:v", "libx264", "-crf", "18", "-movflags", "+faststart", video]);
  await rm(dir, { recursive: true, force: true });
  console.log(`recorded ${video} (${n} frames, ${(n / 60).toFixed(2)} s)`);
}

app.whenReady().then(async () => {
  await mkdir(out, { recursive: true });
  const jobs = want.length ? want : ["stills", "flow", "controls"];
  for (const job of jobs) job === "stills" ? await stills() : await record(job);
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
