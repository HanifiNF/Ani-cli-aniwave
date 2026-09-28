// Mock variants of the Home schedule's day strip in the design language, drawn over the live renderer (npx vite, dev API)
// so they use the app's own styles and springs (the indicators run on src/motion.ts's Edges). Each variant is recorded as
// an MP4 (quarter speed, played back at true speed, as design/record-app-motion.cjs does) and a still of the strip.
// Output: design/shots/motion/schedule-<variant>.mp4 and design/shots/schedule-days-<variant>.png.
// Usage: env -u ELECTRON_RUN_AS_NODE npx electron design/record-schedule-days.cjs [variant ...]
const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile, rm, link } = require("node:fs/promises");
const { join } = require("node:path");
const { execFileSync } = require("node:child_process");

const RATE = 0.25, URL = process.env.APP_URL || "http://127.0.0.1:5173/";
const shots = join(__dirname, "shots"), out = join(shots, "motion");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.dock?.hide();
app.on("window-all-closed", () => undefined);

// A different list for every day, answering after 450 ms of video time (the dev API's own wait is not slowed).
const PATCH = (delay) => `(() => { let a; Object.defineProperty(window, "aniDesktop", { configurable: true, get: () => a, set: (v) => {
  const TITLES = [["Frieren: Beyond Journey's End", "#DCE9F2", "#4F7BA6"], ["Dandadan", "#F5E64A", "#E23A3A"], ["The Apothecary Diaries", "#F3E4E8", "#B8556E"],
    ["Delicious in Dungeon", "#EAD6B4", "#4C7A45"], ["Vinland Saga", "#C9D3D8", "#3E5563"], ["Kaiju No. 8", "#D8E6D0", "#2F6B4F"], ["Blue Lock", "#D6E2F7", "#2B4FA3"],
    ["Spy x Family", "#F6E3CF", "#C4553A"], ["Oshi no Ko", "#F4D9EC", "#8A3A8C"], ["Mashle", "#EFE8D6", "#6B5A3A"]];
  const poster = (bg, fg, n) => "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="200" height="300" fill="' + bg + '"/><circle cx="' + (60 + n * 17 % 90) + '" cy="' + (80 + n * 29 % 80) + '" r="' + (38 + n * 7 % 30) + '" fill="' + fg + '"/><path d="M0 ' + (170 + n * 13 % 60) + ' L200 ' + (120 + n * 11 % 70) + ' L200 300 L0 300Z" fill="' + fg + '" opacity=".55"/></svg>');
  v.schedule = async (query) => {
    await new Promise((r) => setTimeout(r, ${delay}));
    const day = Number(query.date.slice(-2)), count = 3 + day % 3;
    const entries = Array.from({ length: count }, (_, k) => {
      const n = (day * 3 + k * 2 + (query.mode === "dub" ? 5 : 0)) % TITLES.length, [title, bg, fg] = TITLES[n];
      const local = new Date(query.date + "T00:00:00"); local.setHours(13 + k * 2, (n * 15) % 60);
      const id = "aniwave:mock-" + n, art = poster(bg, fg, n);
      return { anime: { id, title, poster: art, provider: "aniwave", sources: [{ id, provider: "aniwave", title, aliases: [title], poster: art }] },
        episode: { id: id + ":" + (day % 12 + k + 1), number: String(day % 12 + k + 1), provider: "aniwave" }, releaseAt: local.toISOString(), timeLabel: "" };
    });
    return { provider: "aniwave", requestedDate: query.date, entries, refreshedAt: new Date().toISOString(), status: "fresh" };
  };
  a = v; } }); })();`;

// Page helpers: a real press (down, a short hold, up, click).
const HELPERS = `
  window.rec = {
    at: (el) => { const r = el.getBoundingClientRect(); return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true }; },
    async tap(el, hold = 70) { if (!el) throw new Error("missing"); const p = rec.at(el); el.dispatchEvent(new PointerEvent("pointerdown", p)); await rec.sleep(hold); el.dispatchEvent(new PointerEvent("pointerup", p)); el.dispatchEvent(new MouseEvent("click", { ...p, detail: 1 })); },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms / ${RATE})),
    day: (n) => document.querySelectorAll(".schedule-days button")[n],
    audio: (n) => document.querySelectorAll(".schedule-audio button")[n],
  };
`;

// Shared by the variants: sentence-case audio labels, one weight for every tab (so selecting never changes a width), and
// the day's cards swapping in place. The old cards hold the section's height and dim while the new day loads, then blur
// out towards the old day as the new ones rise in turn from the side of the new day.
const SWAP_CSS = `
  .mock-swap .schedule-state { display: none; }
  .section-schedule { position: relative; }
  .mock-old { position: absolute; left: 0; right: 0; pointer-events: none; transition: opacity var(--t-glide); }
  .mock-old.loading { opacity: .45; transition-delay: 120ms; }
  .mock-old.leaving { animation: mock-old-out var(--t-out) both; }
  @keyframes mock-old-out { to { opacity: 0; filter: blur(4px); transform: translateX(calc(var(--dir) * -10px)); } }
  .mock-swap .cards > .card { animation-name: mock-card-in; }
  @keyframes mock-card-in { from { opacity: 0; filter: blur(4px); transform: translateX(calc(var(--dir) * 14px)); } }
`;
const SWAP_JS = `
  const section = document.querySelector(".section-schedule");
  const index = () => [...document.querySelectorAll(".schedule-days button")].findIndex((b) => b.getAttribute("aria-selected") === "true");
  let old, observer;
  const start = (dir) => {
    const cards = section.querySelector(".cards");
    if (!cards.children.length) return;
    old?.remove(); observer?.disconnect();
    section.style.minHeight = section.offsetHeight + "px";
    section.classList.add("mock-swap"); section.style.setProperty("--dir", dir);
    old = cards.cloneNode(true); old.classList.add("mock-old"); old.style.top = cards.offsetTop + "px";
    old.querySelectorAll(".card").forEach((c) => { c.style.animation = "none"; });
    section.append(old);
    requestAnimationFrame(() => old?.classList.add("loading"));
    observer = new MutationObserver(() => {
      if (!cards.children.length) return;
      observer.disconnect();
      const leaving = old; old = undefined; leaving.classList.add("leaving");
      leaving.addEventListener("animationend", () => leaving.remove(), { once: true });
      setTimeout(() => { section.style.minHeight = ""; }, 700 / (window.__aniMotionRate ?? 1));
    });
    observer.observe(cards, { childList: true });
  };
  document.addEventListener("pointerdown", (event) => {
    const day = event.target.closest(".schedule-days button"), audio = event.target.closest(".schedule-audio button");
    if (day && day.getAttribute("aria-selected") !== "true") start(Math.sign([...day.parentElement.querySelectorAll("button")].indexOf(day) - index()));
    if (audio && !audio.classList.contains("on")) start(0);
  }, true);
`;

// An indicator on src/motion.ts's two-edge springs, placed on the container's current item whenever its attributes change.
const INDICATOR_JS = `
  const { Edges } = await import("/src/motion.ts");
  window.mockIndicator = (container, selector, className, place) => {
    const mark = document.createElement("i"); mark.className = className; mark.setAttribute("aria-hidden", "true");
    container.prepend(mark);
    const edges = new Edges((a, b) => { mark.style.transform = "translateX(" + a + "px)"; mark.style.width = (b - a) + "px"; place?.(a, b, mark); });
    const go = (instant) => { const item = container.querySelector(selector); if (!item) return; mark.dataset.today = item.classList.contains("today") ? "1" : ""; edges.to(item.offsetLeft, item.offsetLeft + item.offsetWidth, { instant }); };
    go(true);
    new MutationObserver(() => go(false)).observe(container, { subtree: true, attributes: true, attributeFilter: ["class", "aria-selected"] });
  };
`;

// The chips' lit copy: the labels again, each over its tab, above the indicator and clipped to it.
const LIT_JS = `
  window.mockLit = (container, className) => {
    const lit = document.createElement("span"); lit.className = className; lit.setAttribute("aria-hidden", "true");
    const buttons = [...container.querySelectorAll("button")];
    lit.innerHTML = buttons.map((b) => "<span class='" + b.className + "' style='left:" + b.offsetLeft + "px;top:" + b.offsetTop + "px;width:" + b.offsetWidth + "px'>" + b.innerHTML + "</span>").join("");
    container.append(lit);
    return (a, b) => { lit.style.clipPath = "inset(0 " + (lit.clientWidth - b) + "px 0 " + a + "px round 5px)"; };
  };
`;

const VARIANTS = {
  // The app as it is (B since it was built), with the dev API answering a different list per day so the change shows.
  current: { css: "", js: "" },

  // A: the nav's fill. A quiet surface moves behind the chosen day on two edges; the today dot sits inside the tab.
  "a-fill": {
    css: `
      .schedule-days { position: relative; gap: 2px; margin-right: -4px; }
      .schedule-days button { z-index: 1; padding: 4px 10px 9px; border-radius: var(--radius-sm); font-weight: 500; }
      .schedule-days button.on { font-weight: 500; }
      .schedule-days button.today::after { bottom: 3px; }
      .mock-fill { position: absolute; top: 0; left: 0; bottom: 0; z-index: 0; border-radius: var(--radius-sm); background: var(--raised2); pointer-events: none; }
      .schedule-audio { position: relative; gap: 2px; margin-left: 14px; padding-left: 14px; align-items: center; }
      .schedule-audio button { z-index: 1; padding: 6px 11px; border-radius: var(--radius-sm); }
      .schedule-audio .mock-fill { top: 50%; bottom: auto; height: 30px; margin-top: -15px; }
    `,
    js: `
      mockIndicator(document.querySelector(".schedule-days"), "button.on", "mock-fill");
      mockIndicator(document.querySelector(".schedule-audio"), "button.on", "mock-fill");
    `,
  },

  // B: the segmented chips (Browse filters, the episode filter). Days read on one line, today's number takes the highlight.
  "b-track": {
    css: `
      .schedule-days { position: relative; gap: 2px; padding: 3px; border-radius: var(--radius-sm); background: var(--raised); align-self: center; }
      .schedule-days button, .mock-lit > span { display: inline-flex; align-items: baseline; gap: 4px; padding: 4px 10px; border-radius: var(--radius-inset); font-size: 13px; font-weight: 500; }
      .schedule-days button { z-index: 1; color: var(--muted); }
      .schedule-days button small, .mock-lit > span small { font-size: 13px; font-weight: 500; color: inherit; }
      .schedule-days button.today small, .mock-lit > span.today small { color: var(--cursor); }
      .schedule-days button.today::after { display: none; }
      .mock-ind { position: absolute; top: 3px; bottom: 3px; left: 0; z-index: 0; border-radius: var(--radius-inset); background: var(--raised2); pointer-events: none; }
      .mock-lit { position: absolute; inset: 0; z-index: 2; pointer-events: none; }
      .mock-lit > span { position: absolute; justify-content: center; color: var(--text); }
      .schedule-audio { position: relative; gap: 2px; margin-left: 12px; padding: 3px; border: 0; border-radius: var(--radius-sm); background: var(--raised); align-self: center; }
      .schedule-audio button, .schedule-audio .mock-lit > span { z-index: 1; padding: 4px 12px; border-radius: var(--radius-inset); font-size: 13px; }
    `,
    js: `
      for (const box of [document.querySelector(".schedule-days"), document.querySelector(".schedule-audio")]) {
        const lit = mockLit(box, "mock-lit");
        mockIndicator(box, "button.on", "mock-ind", lit);
      }
    `,
  },

  // C: the strip stays text; a short bar under the chosen day stretches between days, and on today it is the today dot
  // grown into a bar (it takes the highlight there).
  "c-underline": {
    css: `
      .schedule-days { position: relative; }
      .schedule-days button, .schedule-days button.on { font-weight: 500; }
      .mock-bar { position: absolute; left: 0; bottom: -8px; z-index: 1; height: 2px; border-radius: 1px; background: var(--text); pointer-events: none; transition: background var(--t-snap); }
      .mock-bar[data-today="1"] { background: var(--cursor); }
      .schedule-audio { position: relative; }
      .schedule-audio .mock-bar { bottom: -6px; }
    `,
    js: `
      mockIndicator(document.querySelector(".schedule-days"), "button.on", "mock-bar");
      mockIndicator(document.querySelector(".schedule-audio"), "button.on", "mock-bar");
    `,
  },
};

// [page script, hold afterwards in real milliseconds of video time]
const STEPS = [
  ["", 600],
  ["await rec.tap(rec.day(3))", 1000],
  ["await rec.tap(rec.day(6))", 1000],
  ["await rec.tap(rec.day(0))", 1000],
  ["await rec.tap(rec.day(2))", 1000],
  ["await rec.tap(rec.audio(1))", 1000],
  ["await rec.tap(rec.audio(0))", 900],
];

async function open(name, delay) {
  const win = new BrowserWindow({ width: 1240, height: 800, show: false, frame: false, paintWhenInitiallyHidden: true, webPreferences: { backgroundThrottling: false } });
  await win.loadURL("about:blank");
  const cdp = win.webContents.debugger;
  cdp.attach("1.3");
  await cdp.sendCommand("Page.enable");
  await cdp.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: PATCH(delay) });
  await win.loadURL(URL);
  await wait(2500);
  const js = (code) => win.webContents.executeJavaScript(code);
  const variant = VARIANTS[name];
  await js(`(async () => { ${HELPERS}
    const page = document.querySelector(".page"), head = document.querySelector(".section-schedule");
    page.scrollTop += head.getBoundingClientRect().top - 150;
    document.head.insertAdjacentHTML("beforeend", \`<style>.watch-companion { display: none; }${name === "current" ? "" : SWAP_CSS}${variant.css}</style>\`);
    ${name === "current" ? "" : 'document.querySelectorAll(".schedule-audio button").forEach((b) => { b.textContent = b.textContent === "SUB" ? "Sub" : "Dub"; });'}
    ${name === "current" ? "" : SWAP_JS + INDICATOR_JS + LIT_JS}
    ${variant.js}
  })().then(() => true)`);
  await wait(600);
  return { win, js, cdp };
}

async function still(name) {
  const { win, js } = await open(name, 250);
  const r = await js(`(() => { const s = document.querySelector(".section-schedule").getBoundingClientRect(); return { x: Math.round(s.left - 20), y: Math.round(s.top - 20), width: Math.round(s.width + 40), height: 330 }; })()`);
  await writeFile(join(shots, `schedule-days-${name}.png`), (await win.webContents.capturePage(r)).toPNG());
  win.destroy();
}

async function record(name) {
  const dir = join(out, `frames-schedule-${name}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const { win, js, cdp } = await open(name, 450 / RATE);
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
  for (const [code, hold] of STEPS) {
    if (code) await js(`(async () => { ${code} })().then(() => true)`);
    await wait(hold / RATE);
    // A one-pixel change so the settled state of each step reaches the screencast.
    await js(`(() => { let dot = document.getElementById("rec-dot"); if (!dot) { dot = document.createElement("i"); dot.id = "rec-dot"; dot.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;z-index:9999;pointer-events:none"; document.body.append(dot); } dot.style.background = dot.style.background === "rgba(0, 0, 0, 0.01)" ? "rgba(0, 0, 0, 0.02)" : "rgba(0, 0, 0, 0.01)"; return true; })()`);
    await wait(120);
  }
  await cdp.sendCommand("Page.stopScreencast");
  await Promise.all(writes);
  win.destroy();
  const seq = join(dir, "seq");
  await mkdir(seq);
  const first = frames[0].at, last = frames[frames.length - 1].at;
  const ticks = Math.ceil((last - first) * RATE / (1000 / 60));
  for (let tick = 0, i = 0; tick < ticks; tick++) {
    while (i + 1 < frames.length && (frames[i + 1].at - first) * RATE <= tick * (1000 / 60)) i++;
    await link(frames[i].file, join(seq, `${String(tick).padStart(5, "0")}.jpg`));
  }
  const video = join(out, `schedule-${name}.mp4`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", "60", "-i", join(seq, "%05d.jpg"), "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p", "-c:v", "libx264", "-crf", "18", "-movflags", "+faststart", video]);
  await rm(dir, { recursive: true, force: true });
  console.log(`recorded ${video} (${(ticks / 60).toFixed(2)} s)`);
}

app.whenReady().then(async () => {
  await mkdir(out, { recursive: true });
  const names = process.argv.slice(2).filter((a) => VARIANTS[a]);
  for (const name of names.length ? names : Object.keys(VARIANTS)) {
    await still(name);
    if (!process.env.STILLS) await record(name);
  }
  app.quit();
}).catch((error) => { console.error(error); app.exit(1); });
