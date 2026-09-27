// Exercise production React, CSS and preload in an isolated Electron window. All catalog
// responses are controlled locally so both load orders and late responses are repeatable.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { DEFAULT_STATE } = require('../dist-electron/shared/settings.js');

const directory = mkdtempSync(join(tmpdir(), 'ani-scroll-test-'));
app.setPath('userData', join(directory, 'user-data'));
const delay = ms => new Promise(done => setTimeout(done, ms));
const anime = { animeId: 'aniwave:fixture', title: 'Re:ZERO -Starting Life in Another World- Season 4', lastEpisode: '2', mode: 'sub', lastProvider: 'aniwave', updatedAt: new Date().toISOString() };
const other = { ...anime, animeId: 'aniwave:other', title: 'Other series fixture' };
const state = { ...DEFAULT_STATE, bookmarks: [anime, other], history: [anime], settings: {
  ...DEFAULT_STATE.settings, emptyBackdrop: false, playbackTarget: 'external', disabledSources: ['anidb', 'hianime']
} };
const episode = number => ({ id: `aniwave:ep${number}`, number: String(number), provider: 'aniwave' });
const catalog = { groups: [{ provider: 'aniwave', episodes: Array.from({ length: 16 }, (_, i) => episode(i + 1)) }] };
const info = { refs: [], title: anime.title, titles: { romaji: 'Re:Zero kara Hajimeru Isekai Seikatsu' }, synonyms: [], type: 'TV', episodes: 16,
  year: 2026, season: 'spring', status: 'ongoing', genres: ['Action', 'Fantasy'], studios: ['White Fox'], score: 85,
  description: 'Subaru and his allies emerged victorious, but at great cost. '.repeat(9), relations: [], source: 'anilist', fetchedAt: Date.now() };
let win;
let episodeRequests = [], infoRequests = [];
const errors = [];
const evaluate = code => win.webContents.executeJavaScript(code, true);
async function waitFor(code) {
  for (let i = 0; i < 150; i++) { if (await evaluate(code)) return; await delay(20); }
  throw new Error(`Timed out: ${code}\n${await evaluate('document.body.innerText')}`);
}
async function waitRequests(episodes = 1, infos = 1) {
  for (let i = 0; i < 150; i++) { if (episodeRequests.length >= episodes && infoRequests.length >= infos) return; await delay(20); }
  throw new Error('Catalog request missing');
}
const scrollTop = () => evaluate('document.querySelector(".page").scrollTop');
const topOf = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top`);
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) <= 2, `${message}: expected ${expected}, got ${actual}`);
async function wheel(amount) {
  win.webContents.sendInputEvent({ type: 'mouseWheel', x: 900, y: 400, deltaY: -amount, deltaX: 0, canScroll: true });
  await delay(300);
}
async function toTop() {
  // Electron caps a wheel event to roughly one viewport, even for a large delta.
  for (let i = 0; i < 10 && await scrollTop() > 0; i++) await wheel(-2000);
  assert.equal(await scrollTop(), 0);
}
async function jump(value) {
  await evaluate(`(() => { const input = document.querySelector('[aria-label="Jump to episode"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await delay(80);
}
const visible = number => evaluate(`(() => {
  const page = document.querySelector('.page').getBoundingClientRect();
  const row = document.querySelector('[data-episode="aniwave:ep${number}"]').getBoundingClientRect();
  return row.top >= page.top && row.bottom <= page.bottom;
})()`);
async function firstVisible() {
  return evaluate(`(() => { const page = document.querySelector('.page');
    const row = [...document.querySelectorAll('[data-episode]')].find(row => row.getBoundingClientRect().bottom > page.getBoundingClientRect().top);
    return { id: row.dataset.episode, top: row.getBoundingClientRect().top };
  })()`);
}
const publish = (value, request = episodeRequests.at(-1)) => win.webContents.send('catalog:update', { id: request.id, value });
async function open(fromSchedule = false) {
  episodeRequests = []; infoRequests = [];
  win.setContentSize(1740, 620);
  await win.loadFile(resolve('dist/index.html'));
  const selector = fromSchedule ? '.schedule-card .hit' : '.section-saved .hit';
  await waitFor(`!!document.querySelector(${JSON.stringify(selector)})`);
  await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await waitRequests();
  await waitFor('!!document.querySelector("h1")');
}
async function showInfo() {
  infoRequests.at(-1).finish(info);
  await waitFor('!!document.querySelector(".about")');
  await delay(100);
}
async function showEpisodes(final = true, value = catalog) {
  if (final) episodeRequests.at(-1).finish(value); else publish(value);
  await waitFor('!!document.querySelector("[data-episode]")');
  await delay(400); // Include the production staggered entrance animations.
}
async function ready(final = true) { await open(); await showInfo(); await showEpisodes(final); }
async function check(name, test) { if (process.env.ANI_SCROLL_TEST && !name.includes(process.env.ANI_SCROLL_TEST)) return; await test(); console.log(`PASS: ${name}`); }

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_request, done) => done({ cancel: true }));
  ipcMain.handle('state:get', () => structuredClone(state));
  for (const channel of ['player:ready', 'player:active', 'app:icon', 'app:update-check', 'app:backdrop', 'catalog:metadata', 'catalog:metadata-clear', 'catalog:schedule-artwork', 'player:storage']) {
    ipcMain.handle(channel, () => undefined);
  }
  ipcMain.handle('catalog:streams', () => [{ url: 'https://fixture.invalid/video.mp4', quality: '1080p', provider: 'aniwave' }]);
  ipcMain.handle('player:play', (_event, request) => {
    // Playback navigation is exercised with an offline media fixture; decoding is covered by test:player.
    win.webContents.send('player:load', { id: 'scroll-fixture', request, fullscreen: false, canOpenExternal: false, preferences: {} });
  });
  ipcMain.handle('catalog:series-metadata', () => ({ sources: [], genres: [] }));
  ipcMain.handle('catalog:availability', () => ({ sub: false, dub: false, checkedAt: Date.now() }));
  ipcMain.handle('catalog:schedule', (_event, query) => ({ requestedDate: query.date, entries: [{
    anime: { id: anime.animeId, title: anime.title, provider: 'aniwave' }, episode: episode(3), releaseAt: new Date().toISOString()
  }] }));
  ipcMain.handle('catalog:episodes', (_event, anime, request) => new Promise(finish => episodeRequests.push({ id: request.id, anime, finish })));
  ipcMain.handle('catalog:work-info', (_event, anime) => new Promise(finish => infoRequests.push({ anime, finish })));
  win = new BrowserWindow({ show: false, width: 1740, height: 620, useContentSize: true, webPreferences: {
    preload: resolve('dist-electron/electron/preload.js'), sandbox: true, contextIsolation: true, backgroundThrottling: false, offscreen: true
  } });
  win.webContents.on('console-message', event => { if (/Uncaught|violates/.test(event.message)) errors.push(event.message); });

  await check('opening stays at the top in both loading orders', async () => {
    await open(); await showEpisodes(false, { groups: [{ ...catalog.groups[0], refreshing: true }] }); await showInfo();
    const headingTop = await topOf('.ep-head');
    episodeRequests.at(-1).finish(catalog); await delay(150);
    assert.equal(await scrollTop(), 0);
    near(await topOf('.ep-head'), headingTop, 'Episode heading after cached results finish refreshing');
    await ready(); assert.equal(await scrollTop(), 0);
  });
  await check('early scrolling through placeholders preserves the reading position', async () => {
    await open(); await showInfo(); await wheel(180);
    assert.ok(await scrollTop() > 0);
    const titleTop = await topOf('h1');
    await showEpisodes(); near(await topOf('h1'), titleTop, 'Header position after placeholders');
  });
  await check('new rows and late series information preserve the visible episode', async () => {
    await open(); await showEpisodes(false); await wheel(600);
    const row = await firstVisible();
    await showInfo(); near(await topOf(`[data-episode="${row.id}"]`), row.top, 'Late info');
    await showEpisodes(true, { groups: [{ ...catalog.groups[0], episodes: [...catalog.groups[0].episodes, episode(17)] }] });
    near(await topOf(`[data-episode="${row.id}"]`), row.top, 'New episode');
  });
  await check('returning to the top clears the reading anchor', async () => {
    await ready(false); await wheel(650); await toTop(); assert.equal(await scrollTop(), 0);
    await showEpisodes(true, { groups: [{ ...catalog.groups[0], episodes: [...catalog.groups[0].episodes, episode(17)] }] });
    assert.equal(await scrollTop(), 0);
  });
  await check('repeated jumps work and resizing respects subsequent scrolling', async () => {
    await ready(); await jump('8'); assert.equal(await visible(8), true);
    await toTop(); assert.equal(await visible(8), false);
    await evaluate(`document.querySelector('[aria-label="Jump to episode"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await delay(100); assert.equal(await visible(8), true);
    await toTop(); await jump(''); await jump('8'); assert.equal(await visible(8), true);
    await toTop(); win.setContentSize(1740, 520); await delay(150); assert.equal(await scrollTop(), 0);
    await wheel(750); const row = await firstVisible();
    win.setContentSize(1600, 600); await delay(150);
    near(await topOf(`[data-episode="${row.id}"]`), row.top, 'Resize while reading');
  });
  await check('schedule requests wait for their episode instead of revealing a fallback', async () => {
    await open(true); await showInfo();
    await showEpisodes(false, { groups: [{ ...catalog.groups[0], episodes: catalog.groups[0].episodes.filter(row => +row.number > 8) }] });
    assert.equal(await scrollTop(), 0);
    await showEpisodes(); assert.equal(await visible(3), true);
  });
  await check('wheel input cancels a deferred schedule jump even before rows exist', async () => {
    await open(true); await showInfo(); await wheel(180);
    const titleTop = await topOf('h1');
    await showEpisodes(); near(await topOf('h1'), titleTop, 'Cancelled schedule jump');
    assert.equal(await visible(3), false);
  });
  await check('jump requests during loading wait for a matching episode', async () => {
    await open(); await showInfo(); await jump('8'); await showEpisodes(); assert.equal(await visible(8), true);
  });
  await check('a removed source row falls back to a surviving visible neighbour', async () => {
    await ready(false); await wheel(700);
    const row = await firstVisible();
    const neighbour = await evaluate(`document.querySelector('[data-episode="${row.id}"]').parentElement.nextElementSibling.querySelector('[data-episode]').dataset.episode`);
    const before = await topOf(`[data-episode="${neighbour}"]`);
    await showEpisodes(true, { groups: [{ ...catalog.groups[0], episodes: catalog.groups[0].episodes.filter(item => item.id !== row.id) }] });
    near(await topOf(`[data-episode="${neighbour}"]`), before, 'Surviving neighbour');
  });
  await check('sorting and empty filters leave valid scroll state', async () => {
    await ready(); await wheel(700); const row = await firstVisible();
    await evaluate('document.querySelector("[title=\\"Oldest first\\"]").click()'); await delay(150);
    const limit = await evaluate('document.querySelector(".page").scrollHeight - document.querySelector(".page").clientHeight');
    // Whether the reordered row lands at the very end depends on row heights; the scroll must stay in range either way.
    const sorted = await scrollTop();
    assert.ok(sorted >= 0 && sorted <= limit + 1, `Sorting keeps the scroll within range: ${sorted} of ${limit}`);
    assert.equal(await visible(Number(row.id.split('ep')[1])), true);
    // The fixture can remove all watched entries through a normal state refresh.
    state.history = [];
    await evaluate('window.dispatchEvent(new Event("focus"))');
    await evaluate(`([...document.querySelectorAll('.ep-head button')].find(button => button.textContent === 'Watched')).click()`);
    await waitFor('!!document.querySelector(".eps .empty")');
    const offset = await scrollTop();
    assert.ok(offset >= 0);
    assert.ok(offset <= await evaluate('document.querySelector(".page").scrollHeight - document.querySelector(".page").clientHeight'));
    await evaluate(`([...document.querySelectorAll('.ep-head button')].find(button => button.textContent === 'All')).click()`);
    await waitFor('!!document.querySelector("[data-episode]")');
    near(await scrollTop(), offset, 'Restoring rows after an empty filter');
    state.history = [anime];
  });
  await check('source refreshes and failures preserve cached episodes in view', async () => {
    await ready(); await wheel(700); const row = await firstVisible();
    await evaluate(`([...document.querySelectorAll('.ep-head button')].find(button => button.textContent === 'Refresh sources')).click()`);
    await waitRequests(2, 1);
    await showEpisodes(false, { groups: [{ ...catalog.groups[0], refreshing: true }] });
    near(await topOf(`[data-episode="${row.id}"]`), row.top, 'Source refresh');
    await showEpisodes(true, { groups: [{ ...catalog.groups[0], error: 'Fixture source unavailable' }] });
    near(await topOf(`[data-episode="${row.id}"]`), row.top, 'Refresh failure');
  });
  await check('unavailable episode requests expire when loading finishes', async () => {
    await open(); await showInfo(); await jump('8');
    episodeRequests.at(-1).finish({ groups: [{ provider: 'aniwave', episodes: [], error: 'Fixture source unavailable' }] });
    await waitFor('!!document.querySelector(".eps .empty")'); assert.equal(await scrollTop(), 0);
    await evaluate(`([...document.querySelectorAll('.ep-head button')].find(button => button.textContent === 'Refresh sources')).click()`);
    await waitRequests(2, 1); await showEpisodes(); assert.equal(await scrollTop(), 0);
  });
  await check('keyboard scrolling cancels pending jumps while still at the top', async () => {
    await open(true); await showInfo();
    await evaluate(`document.querySelector('.page').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }))`);
    await showEpisodes(); assert.equal(await scrollTop(), 0);
  });
  await check('late responses from a previous series do not move the next series', async () => {
    await open(); const oldEpisodes = episodeRequests[0], oldInfo = infoRequests[0];
    await evaluate('document.querySelector(".logo").click()');
    await waitFor('!!document.querySelector(".section-saved .hit")');
    await evaluate(`([...document.querySelectorAll('.section-saved .hit')].find(button => button.getAttribute('aria-label').includes(${JSON.stringify(other.title)}))).click()`);
    await waitRequests(2, 2); await showInfo(); await showEpisodes();
    oldInfo.finish({ ...info, description: 'Late response. '.repeat(200) }); oldEpisodes.finish(catalog); await delay(150);
    assert.equal(await evaluate('document.querySelector("h1").textContent'), other.title);
    assert.equal(await scrollTop(), 0);
  });
  await check('returning from the player reveals its episode once', async () => {
    state.settings.playbackTarget = 'builtin';
    await ready();
    await evaluate('document.querySelector(".side .primary").click()');
    await waitFor('!!document.querySelector(".player-shell.is-expanded")');
    await evaluate(`([...document.querySelectorAll('.now-acts button')].find(button => button.textContent === 'episodes')).click()`);
    await waitFor('!!document.querySelector(".page-series")'); await delay(400);
    assert.equal(await visible(3), true);
    await toTop(); win.setContentSize(1740, 520); await delay(150); assert.equal(await scrollTop(), 0);
    await evaluate(`document.querySelector('[aria-label="Expand player"]').click()`);
    await waitFor('!!document.querySelector(".player-shell.is-expanded")');
    await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await waitFor('!!document.querySelector(".page-series")'); await delay(400);
    assert.equal(await visible(3), true);
  });
  assert.deepEqual(errors, []);
  win.destroy(); rmSync(directory, { recursive: true, force: true }); app.exit(0);
}).catch(error => { console.error(error); if (win) win.destroy(); rmSync(directory, { recursive: true, force: true }); app.exit(1); });
