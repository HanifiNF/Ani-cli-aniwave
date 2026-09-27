// Mock variants of the Settings "update available" row, drawn inside the live Settings page (npx vite, dev API) so they
// use the app's own styles. Each variant replaces the Updates box; crops land in design/shots/update-row-*.png.
// Usage: env -u ELECTRON_RUN_AS_NODE npx electron design/capture-update-row.cjs
const { app, BrowserWindow } = require("electron");
const { writeFile, mkdir } = require("node:fs/promises");
const { join } = require("node:path");

const URL = process.env.APP_URL || "http://127.0.0.1:5173/";
const out = join(__dirname, "shots");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.dock?.hide();

// The dev API has no releases; this makes it report one, as a packaged macOS build without Sparkle would.
const PATCH = `(() => { let a; Object.defineProperty(window, "aniDesktop", { configurable: true, get: () => a, set: (v) => {
  v.checkForUpdates = async () => ({ currentVersion: "0.9.2", latestVersion: "0.10.0", state: "available", checkedAt: Date.now() - 3600e3 });
  v.getUpdateInstallStatus = async () => ({ mode: "manual", phase: "idle", detail: "Download the DMG, open it, then quit ANIdesktop and replace it in Applications." });
  a = v; } }); })();`;

const icon = (d) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const DOWNLOAD = icon('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />');
const MORE = icon('<circle cx="6" cy="12" r=".9" /><circle cx="12" cy="12" r=".9" /><circle cx="18" cy="12" r=".9" />');
const OUT = icon('<path d="M14 5h5v5M19 5l-8 8M17 14v4.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H10" />');
const TEXT = `Version 0.10.0 is available<small>You have 0.9.2 · checked today 19:41</small>`;

const STYLE = `
  .mock-more { width: 30px; padding: 0; justify-content: center; }
  .mock-more .icon, .mock .btn .icon { width: 16px; height: 16px; }
  .mock .v-row { position: relative; }
  .mock .box { overflow: visible; }
  .mock-menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 5; min-width: 184px; padding: 4px; border: 1px solid var(--rule); border-radius: var(--radius); background: var(--raised); }
  .mock-menu button { display: flex; width: 100%; height: 32px; align-items: center; padding: 0 10px; border-radius: var(--radius-sm); font-size: 13px; color: var(--text); }
  .mock-menu button:first-child { background: color-mix(in oklab, var(--bg), var(--text) 6%); }
  .mock-menu hr { margin: 4px 6px; border: 0; border-top: 1px solid var(--rule); }
  .mock-links { display: flex; gap: 14px; margin-top: 8px; }
  .mock-links .link { color: var(--muted); font-size: 12.5px; }
  .mock-links .link:first-child { color: var(--text); }
  .mock-title { display: inline-flex; align-items: center; gap: 6px; }
  .mock-title .icon { width: 14px; height: 14px; color: var(--muted); }
  .mock .v-row .link { color: var(--muted); font-size: 13px; }
`;

// [name, row markup, note under the box or ""]
const VARIANTS = [
  ["a-menu", `<div class="r"><span class="k">${TEXT}</span><span class="v-row">
      <button type="button" class="btn small primary">${DOWNLOAD}Download update</button>
      <button type="button" class="btn small mock-more" aria-label="More update actions">${MORE}</button></span></div>`, ""],
  ["a-menu-open", `<div class="r"><span class="k">${TEXT}</span><span class="v-row">
      <button type="button" class="btn small primary">${DOWNLOAD}Download update</button>
      <button type="button" class="btn small mock-more" aria-label="More update actions">${MORE}</button>
      <span class="mock-menu"><button type="button">View release notes</button><button type="button">Check again</button><hr /><button type="button">Skip this version</button></span></span></div>`, ""],
  ["b-links", `<div class="r"><span class="k">${TEXT}<span class="mock-links"><button type="button" class="link">What’s new</button><button type="button" class="link">Skip this version</button></span></span>
      <span class="v-row"><button type="button" class="btn small primary">${DOWNLOAD}Download update</button></span></div>`, ""],
  ["c-title-link", `<div class="r"><span class="k"><span class="mock-title">Version 0.10.0 is available${OUT}</span><small>You have 0.9.2 · checked today 19:41</small></span>
      <span class="v-row"><button type="button" class="link">skip</button><button type="button" class="btn small primary">${DOWNLOAD}Download update</button></span></div>`, ""],
];

app.whenReady().then(async () => {
  const timer = setTimeout(() => { console.log("timed out"); app.exit(1); }, 60_000);
  await mkdir(out, { recursive: true });
  const win = new BrowserWindow({ width: 1240, height: 800, show: false, frame: false, webPreferences: { offscreen: true } });
  await win.loadURL("about:blank");
  win.webContents.debugger.attach("1.3");
  await win.webContents.debugger.sendCommand("Page.enable");
  await win.webContents.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: PATCH });
  const js = (code) => win.webContents.executeJavaScript(code);
  await win.loadURL(URL);
  await wait(2500);
  await js(`document.querySelector('[title^=settings]').click()`); await wait(900);
  await js(`document.querySelector('#settings-updates').scrollIntoView({ block: "center" }); document.head.insertAdjacentHTML("beforeend", \`<style>${STYLE}</style>\`)`);
  await wait(600);
  const crop = async (name) => {
    const r = await js(`((name) => { const g = document.querySelector('.update-settings').getBoundingClientRect(); return { x: Math.round(g.left - 24), y: Math.round(g.top - 28), width: Math.round(g.width + 48), height: name === "a-menu-open" ? 290 : 190 }; })(${JSON.stringify(name)})`);
    await writeFile(join(out, `update-row-${name}.png`), (await win.webContents.capturePage(r)).toPNG());
    console.log("shot", name);
  };
  await crop("current");
  for (const [name, row, note] of VARIANTS) {
    await js(`(() => { const g = document.querySelector('.update-settings'); g.classList.add('mock'); g.querySelector('.box').innerHTML = \`${row}\`;
      g.querySelectorAll('.group-note').forEach((n) => n.remove()); if (\`${note}\`) g.insertAdjacentHTML("beforeend", \`<div class="group-note">${note}</div>\`); })()`);
    await wait(400);
    await crop(name);
  }
  clearTimeout(timer);
  app.quit();
});
