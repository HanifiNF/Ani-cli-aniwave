/* Runs the production player, preload and fullscreen bridge in an isolated Electron app.
   Requires ffmpeg on PATH. ANI_PLAYER_NATIVE_TEST=1 also exercises the native window manager. */
const { app, BrowserWindow, ipcMain, session, Menu } = require('electron');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { mkdtempSync, readFileSync, rmSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, extname } = require('node:path');
const { generateFixtures } = require('./player-fixtures.cjs');
const { assertPlayerSender, registerPlayerFullscreenEvents, setPlayerFullscreen } = require('../dist-electron/electron/player-window.js');
const { StateStore } = require('../dist-electron/electron/state.js');
const { playbackKey } = require('../dist-electron/shared/playback.js');
const { installApplicationMenu } = require('../dist-electron/electron/menu.js');

const directory = mkdtempSync(join(tmpdir(), 'ani-player-integration-'));
app.setPath('userData', join(directory, 'user-data'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const native = process.env.ANI_PLAYER_NATIVE_TEST === '1';
let win, server, store;
let id = 0;
let current;
const contexts = new Map();
let fullscreenRequests = 0;
let simulatedFullscreen = false;
let rejectedMediaRequest = false;
const errors = [];
const requests = [];
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const evaluate = (code) => win.webContents.executeJavaScript(code, true).catch(error => { throw new Error(`${error.message}\nExpression: ${code}`); });
async function waitFor(expression, label, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await delay(50);
  }
  throw new Error(`Timed out: ${label}\n${JSON.stringify(await evaluate("({html:document.body.innerText, video:document.querySelector('video')?.error?.message})"))}`);
}
const key = async (value, extra = {}) => evaluate(`(() => {
  const target = document.activeElement || document.body;
  for (const type of ['keydown','keyup']) target.dispatchEvent(new KeyboardEvent(type, {key:${JSON.stringify(value)}, bubbles:true, cancelable:true, ...${JSON.stringify(extra)}}));
})()`);
const info = () => evaluate(`(() => {const v=document.querySelector('video'); return {time:v.currentTime, paused:v.paused, volume:v.volume, muted:v.muted, rate:v.playbackRate, source:v.currentSrc, width:v.videoWidth,height:v.videoHeight};})()`);
const payload = () => ({ id: String(id), request: current, canOpenExternal: false,
  fullscreen: native ? win.isFullScreen() : simulatedFullscreen,
  preferences: store.snapshot().playerPreferences ?? {}, position: store.snapshot().playbackPositions?.[playbackKey(current)] });
async function load(path, episode = 'one') {
  id++;
  current = { url: `http://127.0.0.1:${server.address().port}/${path}`, title: `Integration ${episode}`,
    episode: { id: `aniwave:fixture-${episode}`, entry: { animeId:'aniwave:fixture-1', title:'Player fixture', lastEpisode:episode === 'one' ? '1' : '2', mode:'sub', updatedAt:'', lastProvider:'aniwave' } } };
  contexts.set(String(id), current);
  await store.recordHistory({ ...current.episode.entry, completed:false });
  if (id === 1) await win.loadFile(resolve('dist/player.html'));
  else win.webContents.send('player-window:load', payload());
  await waitFor(`document.title === ${JSON.stringify(current.title)} && document.querySelector('video')?.readyState >= 3`, 'HLS ready');
  await waitFor("document.querySelector('video')?.currentSrc.startsWith('blob:')", 'bundled HLS engine');
}
async function checkGeometry(width, height, aspect = 16/9) {
  if (width && height) win.setContentSize(width, height);
  await delay(150);
  const geometry = await evaluate(`(() => {
    const r=e=>{const b=e.getBoundingClientRect();return [b.x,b.y,b.width,b.height]};
    return {viewport:[innerWidth,innerHeight], boxes:[...document.querySelectorAll('.player-shell,[data-media-player],[data-media-provider],video')].map(r),fit:getComputedStyle(document.querySelector('video')).objectFit};
  })()`);
  for (const [x,y,w,h] of geometry.boxes) {
    assert.ok(Math.abs(x)<1 && Math.abs(y)<1 && Math.abs(w-geometry.viewport[0])<1 && Math.abs(h-geometry.viewport[1])<1, JSON.stringify(geometry));
  }
  assert.equal(geometry.fit,'contain');
  const video = await info();
  assert.ok(Math.abs(video.width/video.height - aspect)<0.01);
  if (Math.abs(geometry.viewport[0]/geometry.viewport[1] - aspect) < 0.01) return;
  const shot = await win.webContents.capturePage();
  if (process.env.ANI_PLAYER_CAPTURE_DIR) {
    mkdirSync(process.env.ANI_PLAYER_CAPTURE_DIR,{recursive:true});
    writeFileSync(join(process.env.ANI_PLAYER_CAPTURE_DIR,`${native && win.isFullScreen() ? 'fullscreen' : width+'x'+height}-${video.width}x${video.height}.png`),shot.toPNG());
  }
  const bitmap = shot.toBitmap(), size = shot.getSize();
  // Test a point deep inside a letterbox/pillarbox, away from controls and focus rings.
  const [x,y] = geometry.viewport[0]/geometry.viewport[1] > aspect ? [5,Math.floor(size.height/2)] : [Math.floor(size.width/2),5];
  const pixel = [...bitmap.subarray((y*size.width+x)*4,(y*size.width+x)*4+3)];
  assert.ok(pixel.every(value => value<12), `Expected black bars, got ${pixel}`);
}

app.whenReady().then(async () => {
  generateFixtures(join(directory,'media'));
  store = new StateStore(join(directory,'state.json')); await store.load();
  server = createServer((req,res) => {
    const path = new URL(req.url,'http://localhost').pathname;
    if (path.includes('..')) { res.writeHead(400).end(); return; }
    // Exercise recovery from one transient segment failure.
    if (!rejectedMediaRequest && path.endsWith('segment01.m4s')) { rejectedMediaRequest = true; res.writeHead(503).end(); return; }
    try {
      const data=readFileSync(join(directory,'media',path));
      res.writeHead(200, {'Access-Control-Allow-Origin':'*','Content-Type': ({'.m3u8':'application/vnd.apple.mpegurl','.m4s':'video/mp4','.mp4':'video/mp4','.vtt':'text/vtt'})[extname(path)] || 'application/octet-stream'});
      res.end(data);
    } catch {res.writeHead(404).end();}
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const partition = session.fromPartition('ani-player-integration');
  partition.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  partition.setPermissionCheckHandler(()=>false);
  partition.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(details,callback)=>{
    requests.push(details.url);
    callback({cancel:!details.url.startsWith('http://127.0.0.1:')});
  });
  win = new BrowserWindow({width:960,height:640,useContentSize:true,show:false,backgroundColor:'#000000',fullscreenable:true,resizable:true,
    webPreferences:{preload:resolve('dist-electron/electron/player-preload.js'),partition:'ani-player-integration',sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  win.webContents.on('console-message', (event) => { if (/violates|Uncaught/.test(event.message)) errors.push(event.message); });
  registerPlayerFullscreenEvents(win);
  installApplicationMenu(()=>win);
  ipcMain.handle('player-window:ready',event=>{assertPlayerSender(win,event);return payload();});
  ipcMain.handle('player-window:storage',async(event,sessionId,update)=>{assertPlayerSender(win,event);await store.savePlayerStorage(contexts.get(sessionId),update);});
  ipcMain.handle('player-window:fullscreen',async(event,fullscreen)=>{
    assertPlayerSender(win,event); fullscreenRequests++;
    if(native) return setPlayerFullscreen(win,fullscreen);
    await delay(80); simulatedFullscreen=fullscreen; win.webContents.send('player-window:fullscreen-change',fullscreen);return fullscreen;
  });
  ipcMain.handle('player-window:external',()=>false);
  ipcMain.handle('player-window:close',()=>win.close());

  await load('master.m3u8');
  console.log('PASS: bundled HLS startup with production CSP');
  await waitFor("!document.querySelector('video').paused", 'autoplay');
  await key('k'); await waitFor("document.querySelector('video').paused", 'K before click');
  await key(' '); await waitFor("!document.querySelector('video').paused", 'Space before click');
  await key('k'); await waitFor("document.querySelector('video').paused", 'pause');
  const before=(await info()).time;
  await key('ArrowRight'); await waitFor(`document.querySelector('video').currentTime >= ${before+9}`, 'seek forward');
  await key('ArrowLeft'); await waitFor(`document.querySelector('video').currentTime < ${before+2}`, 'seek backward');
  await key('m'); assert.equal((await info()).muted,true);
  await key('m'); assert.equal((await info()).muted,false);
  await key('ArrowDown'); await waitFor("document.querySelector('video').volume < 1", 'volume shortcut');
  await key('>', {shiftKey:true}); await waitFor("document.querySelector('video').playbackRate > 1", 'speed shortcut');
  await key('5'); await waitFor("document.querySelector('video').currentTime >= 15", 'percentage seek');
  await waitFor("document.querySelector('[data-media-player]').hasAttribute('data-captions')", 'captions loaded');
  await key('c'); await waitFor("!document.querySelector('[data-media-player]').hasAttribute('data-captions')", 'captions off');
  await key('c'); await waitFor("document.querySelector('[data-media-player]').hasAttribute('data-captions')", 'captions on');
  console.log('PASS: real Vidstack keyboard playback, seeking, mute, volume, speed, captions');

  if(native) {win.show();win.focus();}
  await key('f'); await key('f',{repeat:true});
  await waitFor("!!document.querySelector('.is-native-fullscreen')", 'fullscreen state');
  assert.equal(fullscreenRequests,1);
  assert.equal(await evaluate('document.fullscreenElement === null'),true);
  if(native) { assert.equal(win.isFullScreen(),true); await checkGeometry(); }
  await evaluate(`document.querySelector('.vds-menu-button[data-root]').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,button:0}))`);
  await waitFor("!!document.querySelector('.vds-menu-items[data-open]')",'settings menu open');
  await key('Escape');
  await waitFor("!document.querySelector('.vds-menu-items[data-open]')", 'Escape dismisses menu');
  assert.equal(await evaluate("!!document.querySelector('.is-native-fullscreen')"),true);
  await key('Escape'); await waitFor("!!document.querySelector('.is-windowed')", 'Escape fullscreen');
  await evaluate(`(() => { const provider=document.querySelector('[data-media-provider]'), b=provider.getBoundingClientRect();
    for(let i=0;i<2;i++) provider.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,button:0,clientX:b.x+b.width*0.1,clientY:b.y+b.height/2})); })()`);
  await waitFor("!!document.querySelector('.is-native-fullscreen')", 'gesture request native fullscreen');
  await evaluate(`(() => { const provider=document.querySelector('[data-media-provider]'), b=provider.getBoundingClientRect();
    for(let i=0;i<2;i++) provider.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,button:0,clientX:b.x+b.width*0.9,clientY:b.y+b.height/2})); })()`);
  await waitFor("!!document.querySelector('.is-windowed')", 'gesture request exits native fullscreen');
  console.log(`PASS: native fullscreen bridge, repeat guard, menu Escape, double-click${native?' and window manager':''}`);

  await key('?',{shiftKey:true}); await waitFor("document.querySelector('dialog').open", 'shortcuts dialog');
  const paused=(await info()).paused;
  await key('k'); assert.equal((await info()).paused,paused);
  await evaluate("document.querySelector('dialog button').click()");
  await waitFor("!document.querySelector('dialog').open",'close shortcuts');
  console.log('PASS: shortcut reference isolates playback keys');
  if(native) {
    const menu = Menu.getApplicationMenu();
    const playback = menu.items.find(item=>item.label==='Playback').submenu;
    const play = playback.items.find(item=>item.label==='Play / Pause');
    assert.ok(play.enabled);
    play.click(); await waitFor("!document.querySelector('video').paused",'native playback menu');
    play.click(); await waitFor("document.querySelector('video').paused",'native playback menu pause');
    const view = menu.items.find(item=>item.label==='View').submenu;
    assert.ok(!view.items.some(item=>/zoom/i.test(item.label)));
    console.log('PASS: native playback menu commands and player zoom removal');
    if(await evaluate('document.pictureInPictureEnabled')) {
      await key('i'); await waitFor('!!document.pictureInPictureElement','picture in picture shortcut');
      await key('i'); await waitFor('!document.pictureInPictureElement','exit picture in picture');
      console.log('PASS: picture in picture shortcut');
    }
  }

  await evaluate(`document.querySelector('.vds-menu-button[data-root]').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,button:0}))`);
  await waitFor("!!document.querySelector('.vds-quality-menu')",'quality menu available');
  await evaluate(`document.querySelector('.vds-quality-menu .vds-menu-item').dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,button:0}))`);
  await waitFor("document.querySelectorAll('.vds-quality-radio').length >= 3", 'HLS quality choices');
  await evaluate(`(() => { const option=[...document.querySelectorAll('.vds-quality-radio')].find(e=>e.textContent.includes('90p'));
    if(!option) throw new Error('Missing 90p rendition'); option.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,button:0})); })()`);
  await key('Escape');
  await evaluate(`document.querySelector('[data-media-player]').focus()`);
  await key('k');
  await waitFor("document.querySelector('video').videoWidth === 160", 'quality switch');
  await key('k');
  console.log('PASS: bundled HLS exposes quality options and switches rendition');
  const saved=await info();
  await delay(350);
  await load('master.m3u8?rotated-token=yes');
  await waitFor(`document.querySelector('video').currentTime >= ${saved.time-1}`, 'stable episode resume');
  assert.equal((await info()).rate,saved.rate);
  assert.equal((await info()).volume,saved.volume);
  console.log('PASS: preferences and resume survive changing stream URLs');
  await key('k');
  await checkGeometry(640,360,16/9);
  await checkGeometry(960,640,16/9);
  await checkGeometry(900,400,16/9);
  await load('classic/index.m3u8','two'); await key('k'); await checkGeometry(960,600,4/3);
  await load('portrait/index.m3u8','three'); await key('k'); await checkGeometry(960,600,9/16);
  console.log('PASS: full-window sizing and black bars for 16:9, 4:3 and portrait video');
  await evaluate("document.querySelector('video').currentTime=31.8; document.querySelector('video').play()");
  await waitFor("document.querySelector('video').ended",'end playback'); await delay(400);
  assert.equal(store.snapshot().history[0].completed,true);
  assert.equal(store.snapshot().playbackPositions[playbackKey(current)].time,0);
  assert.ok(rejectedMediaRequest,'Transient failure fixture was requested');
  assert.deepEqual(errors,[]);
  assert.ok(requests.every(url=>url.startsWith('http://127.0.0.1:')),'Unexpected CDN request');
  console.log('PASS: completion recorded, transient HLS failure recovered, zero CDN/CSP errors');
  win.destroy();server.close();await delay(100);rmSync(directory,{recursive:true,force:true});app.exit(0);
}).catch(error=>{console.error(error);if(win&&!win.isDestroyed())win.destroy();server?.close();app.exit(1);});
