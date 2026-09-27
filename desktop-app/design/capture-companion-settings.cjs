// Mock variants of a dedicated Companion section in Settings, drawn inside the live Settings page (npx vite, dev API)
// so they use the app's own styles. The live Chips and Switch nodes are cloned in; crops land in design/shots/companion-*.png.
// Usage: env -u ELECTRON_RUN_AS_NODE npx electron design/capture-companion-settings.cjs
const { app, BrowserWindow } = require("electron");
const { writeFile, mkdir } = require("node:fs/promises");
const { join } = require("node:path");

const URL = process.env.APP_URL || "http://127.0.0.1:5173/";
const out = join(__dirname, "shots");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.dock?.hide();

const STYLE = `
  .watch-companion { display: none !important; }
  .mk-sprite { display: block; width: calc(var(--h) * 192 / 208); height: var(--h); background-repeat: no-repeat; background-size: calc(var(--h) * 1536 / 208) calc(var(--h) * 9); background-position: 0 0; }
  .mk-tiles { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; }
  .mk-tile { display: flex; flex-direction: column; gap: 6px; }
  .mk-tile .prev { position: relative; height: 72px; display: grid; place-items: end center; border-radius: var(--radius-sm); border: 1px solid var(--rule); background: var(--bg); overflow: hidden; }
  .mk-tile .prev .mk-sprite { margin-bottom: -2px; }
  .mk-tile.on .prev { border-color: transparent; box-shadow: inset 0 0 0 2px var(--cursor); }
  .mk-tile > span:last-child { font-size: 12px; color: var(--muted); text-align: center; }
  .mk-tile.on > span:last-child { color: var(--text); }
  .mk-tile.add .prev { place-items: center; color: var(--muted); }
  .mk-tile.add .prev svg { width: 18px; height: 18px; }
  .mk-tile .initial { place-items: center; font-size: 22px; color: var(--muted); }
  .mk-well { width: 34px; height: 34px; flex: none; border-radius: var(--radius-sm); background-color: var(--bg); background-repeat: no-repeat; background-size: calc(1536px * .27) calc(1872px * .27); background-position: -9px 0; }
  .mk-disclosure { width: 100%; text-align: left; color: inherit; cursor: pointer; }
  .mk-disclosure .subtitle-chevron { width: 16px; height: 16px; }
  .mk-disclosure[aria-expanded="true"] .subtitle-chevron { transform: rotate(180deg); }
  .mk-body { background: color-mix(in oklab, var(--raised), var(--bg) 35%); border-top: 1px solid var(--rule); }
  .mk-body .r { padding: 11px 18px 11px 30px; }
  .mk-body .r:first-child { border-top: 0; }
  .mk-body .r .k { font-size: 13px; }
  .mk-body .mk-tiles { grid-template-columns: repeat(6, 1fr); }
  .mk-import { background: color-mix(in oklab, var(--raised), var(--bg) 35%); }
  .mk-import .r { padding-left: 30px; }
  .mk-import input { width: 200px; height: 30px; padding: 0 12px; border-radius: var(--radius-sm); background: var(--bg); font-size: 13px; }
  .mk-guide { padding: 0 18px 14px 30px; color: var(--muted); font-size: 12px; line-height: 1.55; }
  .mk-guide p { margin: 0 0 6px; max-width: 66ch; }
  .mk-link { color: var(--muted); font-size: 13px; }
  .mk-link:hover { color: var(--text); }
  .mk-group .r .btn.ghost { background: none; color: var(--muted); white-space: nowrap; }
  .mk-group .r .btn.ghost:hover:not(:disabled) { background: var(--bg); color: var(--text); }
  .mk-tile.add.open .prev { border-color: transparent; box-shadow: inset 0 0 0 1.5px var(--dim); color: var(--text); }
`;

const CHEVRON = `<svg class="icon subtitle-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>`;
const PLUS = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>`;
const PETS = [["columbinya", "Columbinya"], ["endminguga", "GUGUGAGA"], ["feibi", "菲比"]];
const sheet = (id) => `url(/pets/${id}/spritesheet.webp)`;
const stepper = (value) => `<span class="stepper" role="group"><button type="button">−</button><output><span class="stepper-value">${value}%</span></output><button type="button">+</button></span>`;
const tiles = (h, { custom = false } = {}) => `<span class="mk-tiles">${PETS.map(([id, name]) => `<button type="button" class="mk-tile${id === "feibi" ? " on" : ""}"><span class="prev"><span class="mk-sprite" style="--h:${h}px;background-image:${sheet(id)}"></span></span><span>${name}</span></button>`).join("")}
  ${custom ? `<button type="button" class="mk-tile"><span class="prev initial">M</span><span>Mika</span></button>` : ""}
  <button type="button" class="mk-tile add"><span class="prev">${PLUS}</span><span>import</span></button></span>`;
const well = (id = "feibi") => `<span class="mk-well" style="background-image:${sheet(id)}"></span>`;
// The first row: on/off plus the hello that used to be its own Preview row.
const master = `<div class="r"><span class="k">Watch companion<small>A little animated friend with preset comments while you browse and watch</small></span><span class="v-row"><button type="button" class="btn small ghost">say hello</button>{{switch}}</span></div>`;
const chatty = `<div class="r"><span class="k">Chattiness<small>Preset comments are rate-limited; clicking the companion always makes it talk</small></span>{{chips}}</div>`;
const wander = `<div class="r"><span class="k">Wandering<small>Walks near its home while you browse. Reduced motion keeps it still</small></span>{{switch}}</div>`;
const size = `<div class="r"><span class="k">Size<small>The companion, its speech bubble, and its wandering space</small></span>${stepper(100)}</div>`;
const home = `<div class="r"><span class="k">Home<small>Drag the companion, or focus it and use the arrow keys, to move it</small></span><button type="button" class="btn small ghost" disabled>reset</button></div>`;
const importRows = `<div class="mk-import"><div class="r"><span class="k">Import a companion<small>A transparent 1536 × 1872 PNG or WebP sheet, 8 MB at most</small></span><span class="v-row"><input placeholder="Name" value="Mika" /><button type="button" class="btn small">choose image</button></span></div>
  <div class="mk-guide"><p><b style="color:var(--text);font-weight:500">How to make one.</b> Eight columns and nine rows of 192 × 208 cells, transparent where unused. Rows from the top: idle (6 frames), run right (8), run left (8), wave (4), jump (5), failed (8), waiting (6), working (6), review (6).</p><p>The file is copied to this installation only. Imported companions share the built-in dialogue.</p></div></div>`;

// [name, box markup]
const VARIANTS = [
  // A: a dedicated section, every setting its own row; the character picker uses the theme tiles' idiom.
  ["a-flat", `${master}<div class="r stack"><span class="k">Character<small>Imported companions sit beside the included three</small></span>${tiles(64)}</div>${chatty}${wander}${size}${home}`],
  ["a-flat-import", `${master}<div class="r stack"><span class="k">Character<small>Imported companions sit beside the included three</small></span>${tiles(64).replace("mk-tile add", "mk-tile add open")}</div>${importRows}${chatty}${wander}${size}${home}`],
  // B: one disclosure row, as Subtitle appearance: the section is two rows until opened.
  ["b-disclosure", `${master}<button type="button" class="r mk-disclosure" aria-expanded="false"><span class="k">菲比<small>normal chattiness · wanders · 100%</small></span><span class="v-row">${well()}${CHEVRON}</span></button>`],
  ["b-disclosure-open", `${master}<button type="button" class="r mk-disclosure" aria-expanded="true"><span class="k">菲比<small>normal chattiness · wanders · 100%</small></span><span class="v-row">${well()}${CHEVRON}</span></button>
    <div class="mk-body"><div class="r stack"><span class="k">Character</span>${tiles(60)}</div>${chatty}${wander}${size}${home}</div>`],
  // C: flat behaviour rows; only the character picker (and importing) sits behind a disclosure row.
  ["c-character", `${master}<button type="button" class="r mk-disclosure" aria-expanded="false"><span class="k">Character<small>菲比 · included</small></span><span class="v-row">${well()}${CHEVRON}</span></button>${chatty}${wander}${size}${home}`],
  ["c-character-open", `${master}<button type="button" class="r mk-disclosure" aria-expanded="true"><span class="k">Character<small>菲比 · included</small></span><span class="v-row">${well()}${CHEVRON}</span></button>
    <div class="mk-body"><div class="r stack"><span class="k">Pick one, or import your own</span>${tiles(60)}</div>${importRows.replace('class="mk-import"', 'class="mk-import" style="border-top:1px solid var(--rule)"')}</div>${chatty}${wander}${size}${home}`],
];

app.whenReady().then(async () => {
  const timer = setTimeout(() => { console.log("timed out"); app.exit(1); }, 60_000);
  await mkdir(out, { recursive: true });
  const win = new BrowserWindow({ width: 1240, height: 1500, show: false, frame: false, webPreferences: { offscreen: true } });
  const js = (code) => win.webContents.executeJavaScript(code);
  await win.loadURL(URL);
  await wait(2500);
  await js(`document.querySelector('[title^=settings]').click()`); await wait(1200);
  await js(`[...document.querySelectorAll('.tile')].find((tile) => tile.textContent.trim() === 'gruvbox')?.click()`); await wait(800);
  await js(`document.head.insertAdjacentHTML("beforeend", \`<style>${STYLE}</style>\`)`);
  const crop = async (name, selector) => {
    await js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({ block: "start" }); document.querySelector('.page-settings').scrollBy(0, -40)`);
    await wait(300);
    const r = await js(`(() => { const g = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(g.left - 24), y: Math.round(g.top - 28), width: Math.round(g.width + 48), height: Math.round(g.height + 44) }; })()`);
    await writeFile(join(out, `companion-${name}.png`), (await win.webContents.capturePage(r)).toPNG());
    console.log("shot", name, r.width, r.height);
  };
  // The page as it stands: the companion rows at the end of Appearance.
  await crop("current", "#settings-appearance + .box");
  await js(`(() => {
    const box = document.querySelector('#settings-appearance + .box');
    const rows = [...box.children];
    const start = rows.findIndex((row) => row.textContent.startsWith("Watch companion"));
    window.__mk = { switch: rows[start].querySelector('.switch').outerHTML, chips: [...rows].find((row) => row.textContent.startsWith("Chattiness")).querySelector('.chips-row').outerHTML };
    rows.slice(start).forEach((row) => row.remove());
    const group = document.createElement('div');
    group.className = 'group mk-group';
    group.innerHTML = '<h3>Companion</h3><div class="box"></div>';
    box.parentElement.after(group);
  })()`);
  await crop("appearance-after", "#settings-appearance + .box");
  for (const [name, markup] of VARIANTS) {
    await js(`(() => { const box = document.querySelector('.mk-group .box'); box.innerHTML = ${JSON.stringify(markup)}.replaceAll('{{switch}}', window.__mk.switch).replaceAll('{{chips}}', window.__mk.chips); })()`);
    await wait(500);
    await crop(name, ".mk-group");
  }
  clearTimeout(timer);
  app.quit();
});
