/* Runs the production app, preload and fullscreen bridge in an isolated Electron app and drives the
   built-in player screen. Requires ffmpeg on PATH. ANI_PLAYER_NATIVE_TEST=1 also exercises the native window manager. */
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
const { PlayerDiagnostics } = require('../dist-electron/electron/player-diagnostics.js');

const directory = mkdtempSync(join(tmpdir(), 'ani-player-integration-'));
app.setPath('userData', join(directory, 'user-data'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Vidstack respects reduced motion by blocking autoplay. Give this autoplay suite a
// consistent preference regardless of the host desktop's accessibility settings.
app.commandLine.appendSwitch('force-prefers-no-reduced-motion');
const native = process.env.ANI_PLAYER_NATIVE_TEST === '1';
let win, server, store;
let diagnostics;
let id = 0;
let current;
const contexts = new Map();
let fullscreenRequests = 0;
let simulatedFullscreen = false;
let playerActive = false;
let refreshMenu = () => {};
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
  throw new Error(`Timed out: ${label}\n${JSON.stringify(await evaluate("(() => { const v=document.querySelector('video'); return {html:document.body.innerText, error:v?.error?.message, paused:v?.paused, time:v?.currentTime, duration:v?.duration, seekable:v && [...Array(v.seekable.length)].map((_,i)=>[v.seekable.start(i),v.seekable.end(i)]), displayedTimes:[...document.querySelectorAll('.vds-time')].map(e=>({type:e.getAttribute('data-type'),text:e.textContent})), width:v?.videoWidth, src:v?.currentSrc, menu:document.querySelector('.vds-menu-items[data-open]')?.className, active:document.activeElement?.className, buffered:v && [...Array(v.buffered.length)].map((_,i)=>[v.buffered.start(i),v.buffered.end(i)]), frames:v?.getVideoPlaybackQuality?.().totalVideoFrames, qualities:[...document.querySelectorAll('.vds-quality-radio')].map(e=>e.textContent+(e.getAttribute('aria-checked')==='true'?'*':''))}; })()"))}`);
}
const key = async (value, extra = {}) => evaluate(`(() => {
  const target = document.activeElement || document.body;
  for (const type of ['keydown','keyup']) target.dispatchEvent(new KeyboardEvent(type, {key:${JSON.stringify(value)}, bubbles:true, cancelable:true, ...${JSON.stringify(extra)}}));
})()`);
const info = () => evaluate(`(() => {const v=document.querySelector('video'); return {time:v.currentTime, paused:v.paused, volume:v.volume, muted:v.muted, rate:v.playbackRate, source:v.currentSrc, width:v.videoWidth,height:v.videoHeight};})()`);
const payload = () => ({ id: String(id), request: current, canOpenExternal: false, diagnostics: true,
  fullscreen: native ? win.isFullScreen() : simulatedFullscreen,
  preferences: store.snapshot().playerPreferences ?? {}, position: store.snapshot().playbackPositions?.[playbackKey(current)] });
async function load(path, episode = 'one') {
  id++;
  current = { url: `http://127.0.0.1:${server.address().port}/${path}`, title: `Integration ${episode}`,
    episode: { id: `aniwave:fixture-${episode}`, entry: { animeId:'aniwave:fixture-1', title:'Player fixture', lastEpisode:episode === 'one' ? '1' : '2', mode:'sub', updatedAt:'', lastProvider:'aniwave' } } };
  contexts.set(String(id), current);
  await store.recordHistory({ ...current.episode.entry, completed:false });
  if (id === 1) {
    await win.loadFile(resolve('dist/index.html'));
    await waitFor("!!document.querySelector('.app input[aria-label=\"Search anime\"]')", 'app shell');
    assert.equal(await evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches"), false, 'autoplay test motion preference');
  }
  win.webContents.send('player:load', payload());
  await waitFor(`document.title === ${JSON.stringify(current.title)} && document.querySelector('video')?.readyState >= 3`, 'HLS ready');
  await waitFor("document.querySelector('video')?.currentSrc.startsWith('blob:')", 'bundled HLS engine');
}
async function checkGeometry(width, height, aspect = 16/9) {
  if (width && height) win.setContentSize(width, height);
  await delay(150);
  // The playback surface fills the page between the header line and the footer; in fullscreen it fills the window.
  const geometry = await evaluate(`(() => {
    const r=e=>{const b=e.getBoundingClientRect();return [b.x,b.y,b.width,b.height]};
    const surface=r(document.querySelector('.player-surface'));
    return {viewport:[innerWidth,innerHeight], surface, fullscreen:!!document.querySelector('.player-shell.is-fullscreen'),
      boxes:[...document.querySelectorAll('[data-media-player],[data-media-provider],video')].map(r),fit:getComputedStyle(document.querySelector('video')).objectFit};
  })()`);
  const [sx,sy,sw,sh] = geometry.surface;
  assert.ok(Math.abs(sx)<1 && Math.abs(sw-geometry.viewport[0])<1, JSON.stringify(geometry));
  if (geometry.fullscreen) assert.ok(Math.abs(sy)<1 && Math.abs(sh-geometry.viewport[1])<1, JSON.stringify(geometry));
  else assert.ok(sy>0 && sh>geometry.viewport[1]*0.6, JSON.stringify(geometry));
  for (const [x,y,w,h] of geometry.boxes) {
    assert.ok(Math.abs(x-sx)<1 && Math.abs(y-sy)<1 && Math.abs(w-sw)<1 && Math.abs(h-sh)<1, JSON.stringify(geometry));
  }
  assert.equal(geometry.fit,'contain');
  const video = await info();
  assert.ok(Math.abs(video.width/video.height - aspect)<0.01);
  if (Math.abs(sw/sh - aspect) < 0.01) return;
  const shot = await win.webContents.capturePage();
  if (process.env.ANI_PLAYER_CAPTURE_DIR) {
    mkdirSync(process.env.ANI_PLAYER_CAPTURE_DIR,{recursive:true});
    writeFileSync(join(process.env.ANI_PLAYER_CAPTURE_DIR,`${native && win.isFullScreen() ? 'fullscreen' : width+'x'+height}-${video.width}x${video.height}.png`),shot.toPNG());
  }
  const bitmap = shot.toBitmap(), size = shot.getSize();
  // Test a point deep inside a letterbox/pillarbox, away from controls and focus rings.
  const scale = size.width/geometry.viewport[0];
  const [x,y] = sw/sh > aspect ? [Math.floor((sx+5)*scale),Math.floor((sy+sh/2)*scale)] : [Math.floor((sx+sw/2)*scale),Math.floor((sy+5)*scale)];
  const pixel = [...bitmap.subarray((y*size.width+x)*4,(y*size.width+x)*4+3)];
  assert.ok(pixel.every(value => value<12), `Expected black bars, got ${pixel}`);
}

app.whenReady().then(async () => {
  generateFixtures(join(directory,'media'));
  store = new StateStore(join(directory,'state.json')); await store.load();
  diagnostics = new PlayerDiagnostics(join(directory,'logs')); diagnostics.setEnabled(true);
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
  // Offscreen rendering keeps Chromium painting and decoding video in the hidden window; otherwise it can
  // drop the video track for a background player and resolution changes never surface.
  win = new BrowserWindow({width:960,height:640,useContentSize:true,show:false,backgroundColor:'#000000',fullscreenable:true,resizable:true,
    webPreferences:{preload:resolve('dist-electron/electron/preload.js'),partition:'ani-player-integration',sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:!native}});
  win.webContents.on('console-message', (event) => { if (/violates|Uncaught/.test(event.message)) errors.push(event.message); });
  registerPlayerFullscreenEvents(win);
  refreshMenu = installApplicationMenu(()=>win, ()=>playerActive);
  ipcMain.handle('state:get',()=>store.snapshot());
  ipcMain.handle('state:settings',(_event,settings)=>store.saveSettings(settings));
  ipcMain.handle('app:icon',()=>undefined);
  ipcMain.handle('player:ready',event=>{assertPlayerSender(win,event);return playerActive && current ? payload() : undefined;});
  ipcMain.handle('player:active',(event,active)=>{assertPlayerSender(win,event);playerActive=active===true;refreshMenu();});
  ipcMain.handle('player:storage',async(event,sessionId,update)=>{assertPlayerSender(win,event);await store.savePlayerStorage(contexts.get(sessionId),update);});
  ipcMain.on('player:diagnostic',(event,sessionId,record)=>{
    assertPlayerSender(win,event);
    if(contexts.has(sessionId)) diagnostics.record(sessionId,record);
  });
  ipcMain.handle('player:fullscreen',async(event,fullscreen)=>{
    assertPlayerSender(win,event); fullscreenRequests++;
    if(native) return setPlayerFullscreen(win,fullscreen);
    await delay(80); simulatedFullscreen=fullscreen; win.webContents.send('player:fullscreen-change',fullscreen);return fullscreen;
  });
  ipcMain.handle('player:external',()=>false);

  if(native) {win.show();win.focus();}
  await load('master.m3u8');
  await waitFor("document.querySelector('.now')?.textContent.includes('Player fixture') && document.querySelector('.now')?.textContent.includes('episode 1')", 'episode header');
  assert.equal(await evaluate("!!document.querySelector('.app input[aria-label=\"Search anime\"]')"), false, 'search field hidden while playing');
  if (process.env.ANI_PLAYER_CAPTURE_DIR) {
    mkdirSync(process.env.ANI_PLAYER_CAPTURE_DIR,{recursive:true});
    await evaluate("document.querySelector('[data-media-player]').dispatchEvent(new PointerEvent('pointermove',{bubbles:true}))");
    await delay(200);
    writeFileSync(join(process.env.ANI_PLAYER_CAPTURE_DIR,'player-screen.png'),(await win.webContents.capturePage()).toPNG());
  }
  console.log('PASS: bundled HLS startup with production CSP inside the app window');
  await waitFor("!document.querySelector('video').paused", 'autoplay');
  // HLS can report a partial duration during startup; percentage shortcuts use the player duration.
  await waitFor("document.querySelector('.vds-time[data-type=duration]')?.textContent.trim() === '0:32'", 'full fixture duration');
  await key('k'); await waitFor("document.querySelector('video').paused", 'K before click');
  await key(' '); await waitFor("!document.querySelector('video').paused", 'Space before click');
  await key('k'); await waitFor("document.querySelector('video').paused", 'pause');
  const before=(await info()).time;
  await key('ArrowRight'); await waitFor(`document.querySelector('video').currentTime >= ${before+9} && !document.querySelector('video').seeking`, 'seek forward');
  await key('ArrowLeft'); await waitFor(`document.querySelector('video').currentTime < ${before+2} && !document.querySelector('video').seeking`, 'seek backward');
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
  // Fine pointers use our desktop-wide fullscreen gesture. Headless Wayland has
  // no pointer device, so Vidstack keeps seek gestures at the edges of the video.
  await evaluate(`(() => { const provider=document.querySelector('[data-media-provider]'), b=provider.getBoundingClientRect();
    const x=matchMedia('(pointer: fine)').matches ? 0.1 : 0.5;
    for(let i=0;i<2;i++) provider.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,button:0,clientX:b.x+b.width*x,clientY:b.y+b.height/2})); })()`);
  await waitFor("!!document.querySelector('.is-native-fullscreen')", 'gesture request native fullscreen');
  await evaluate(`(() => { const provider=document.querySelector('[data-media-provider]'), b=provider.getBoundingClientRect();
    const x=matchMedia('(pointer: fine)').matches ? 0.9 : 0.5;
    for(let i=0;i<2;i++) provider.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,cancelable:true,button:0,clientX:b.x+b.width*x,clientY:b.y+b.height/2})); })()`);
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
      // Refocus the video surface so native Chromium keeps decoding after PiP closes.
      win.show(); win.focus();
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
  // Sizes stay at or above the app window minimum of 920 by 620.
  await checkGeometry(920,620,16/9);
  await checkGeometry(1240,800,16/9);
  await checkGeometry(1400,620,16/9);
  await load('classic/index.m3u8','two'); await key('k'); await checkGeometry(960,640,4/3);
  await load('portrait/index.m3u8','three'); await key('k'); await checkGeometry(960,640,9/16);
  console.log('PASS: page sizing and black bars for 16:9, 4:3 and portrait video');
  await evaluate("document.querySelector('video').currentTime=31.8; document.querySelector('video').play()");
  await waitFor("document.querySelector('video').ended",'end playback'); await delay(400);
  assert.equal(store.snapshot().history[0].completed,true);
  assert.equal(store.snapshot().playbackPositions[playbackKey(current)].time,0);
  assert.ok(rejectedMediaRequest,'Transient failure fixture was requested');
  assert.deepEqual(errors,[]);
  assert.ok(requests.every(url=>url.startsWith('http://127.0.0.1:')),'Unexpected CDN request');
  console.log('PASS: completion recorded, transient HLS failure recovered, zero CDN/CSP errors');
  // Exercise the real keyboard controller, including the timeline's own focus handler.
  const duration = await evaluate("document.querySelector('video').duration");
  for (const selector of ['[data-media-player]', '[data-media-time-slider]']) {
    for (const [start, direction, expected, repeats] of [
      [5, 'ArrowRight', 25, 0],
      [25, 'ArrowLeft', 5, 0],
      [5, 'ArrowLeft', 0, 0],
      [25, 'ArrowRight', duration, 0],
      [5, 'ArrowRight', duration, 2],
      [25, 'ArrowLeft', 0, 2]
    ]) {
      // Isolate cases that reach the end of the fixture from later seek gestures.
      await load('master.m3u8', `seek-${id}`);
      await waitFor("!document.querySelector('video').paused", 'seek fixture autoplay');
      await evaluate("document.querySelector('video').pause()");
      await waitFor("document.querySelector('[data-media-player]').hasAttribute('data-paused')", 'paused before seeking');
      await evaluate(`document.querySelector('[data-media-player]').dispatchEvent(new CustomEvent('media-seek-request', {detail: ${start}, bubbles: true}))`);
      await waitFor(`Math.abs(document.querySelector('video').currentTime - ${start}) < 0.1 && !document.querySelector('video').seeking`, 'reset seek position');
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      // Capture seek destinations before end-of-media handling can change playback state.
      await evaluate("window.seekDestinations = []; document.querySelector('video').addEventListener('seeking', event => window.seekDestinations.push(event.target.currentTime))");
      await evaluate(`(async () => {
        const target = document.activeElement;
        for (let i = 0; i <= ${repeats}; i++) {
          target.dispatchEvent(new KeyboardEvent('keydown', {
            key: ${JSON.stringify(direction)}, shiftKey: true, repeat: i > 0, bubbles: true, cancelable: true
          }));
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        target.dispatchEvent(new KeyboardEvent('keyup', {key: ${JSON.stringify(direction)}, shiftKey: true, bubbles: true, cancelable: true}));
      })()`);
      await waitFor(`window.seekDestinations.some(time => Math.abs(time - ${expected}) < 0.15)`, `Shift+${direction}, focus ${selector}, start ${start}, repeats ${repeats}`);
      if (expected > 0 && expected < duration) assert.equal((await info()).paused, true, 'Seeking within the video preserves pause');
    }
  }
  console.log('PASS: Shift+Arrow seeks 20 seconds with player/timeline focus, repeats, and playback boundaries');
  await delay(100); await diagnostics.flush();
  const log = readFileSync(diagnostics.filePath,'utf8');
  const records = log.trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(records.some(row=>row.event==='keyboard' && row.key==='ArrowRight' && row.shift && row.phase==='keydown'));
  assert.ok(records.some(row=>row.event==='keyboard' && row.key==='ArrowRight' && row.shift && row.phase==='keyup'));
  assert.ok(records.some(row=>row.event==='media-seek-request' && Math.abs(row.seekTime-25)<0.1));
  assert.ok(records.some(row=>row.event==='seeked' && Math.abs(row.seekTime-25)<0.1));
  assert.ok(!log.includes('http://') && !log.includes('Integration one'));
  diagnostics.setEnabled(false);
  win.webContents.send('player:diagnostics-change',false);
  await delay(100); await diagnostics.flush();
  const disabledLog = readFileSync(diagnostics.filePath,'utf8');
  await key('ArrowRight',{shiftKey:true}); await delay(150); await diagnostics.flush();
  assert.equal(readFileSync(diagnostics.filePath,'utf8'),disabledLog);
  console.log('PASS: keyboard and seek diagnostics reach local logs; disabling stops recording');
  const playbackMenu = () => Menu.getApplicationMenu().items.find(item=>item.label==='Playback').submenu.items.find(item=>item.label==='Play / Pause');
  await evaluate("document.querySelector('video').play()");
  await waitFor("!document.querySelector('video').paused", 'playing before docking');
  await key('Escape');
  await waitFor("!!document.querySelector('.player-shell.is-docked.corner-bottom-right') && !!document.querySelector('.app input[aria-label=\"Search anime\"]')", 'Escape docks the player and shows the app');
  assert.equal(await evaluate("document.querySelector('video').paused"), false, 'playback continues while docked');
  assert.equal(playerActive, true, 'player still active while docked');
  assert.ok(playbackMenu().enabled, 'playback menu stays live while docked');
  const dockedBox = await evaluate("(() => { const b=document.querySelector('.player-shell').getBoundingClientRect(); return [b.x,b.y,b.width,b.height]; })()");
  assert.ok(dockedBox[2] < (await evaluate('innerWidth')) / 2 && dockedBox[0] > dockedBox[2], `docked box ${dockedBox}`);
  if (process.env.ANI_PLAYER_CAPTURE_DIR) writeFileSync(join(process.env.ANI_PLAYER_CAPTURE_DIR,'player-docked.png'),(await win.webContents.capturePage()).toPNG());
  await key(' '); await delay(150);
  assert.equal(await evaluate("document.querySelector('video').paused"), false, 'playback keys are off while docked');
  await evaluate("document.querySelector('.mini-bar [aria-label=\"Pause\"]').click()");
  await waitFor("document.querySelector('video').paused", 'mini bar pauses');
  await evaluate("document.querySelector('.mini-bar [aria-label=\"Play\"]').click()");
  await waitFor("!document.querySelector('video').paused", 'mini bar plays');
  // Drag the bar to the top left and let it snap.
  await evaluate(`(() => { const bar=document.querySelector('.mini-bar'), b=bar.getBoundingClientRect();
    const fire=(type,x,y)=>bar.dispatchEvent(new PointerEvent(type,{pointerId:7,button:0,clientX:x,clientY:y,bubbles:true}));
    fire('pointerdown',b.x+40,b.y+10); fire('pointermove',b.x-600,b.y-400); fire('pointerup',b.x-600,b.y-400); })()`);
  await waitFor("!!document.querySelector('.player-shell.corner-top-left')", 'drag snaps to the top left');
  await waitFor("!!document.querySelector('.player-shell.corner-top-left') && !document.querySelector('.is-dragging')", 'drag released');
  if (process.env.ANI_PLAYER_CAPTURE_DIR) { await delay(100); writeFileSync(join(process.env.ANI_PLAYER_CAPTURE_DIR,'player-docked-moved.png'),(await win.webContents.capturePage()).toPNG()); }
  // Resize keys and the grip change the width; the grip faces the page from the top left corner.
  const widthOf = () => evaluate("document.querySelector('.player-shell').getBoundingClientRect().width");
  const startWidth = await widthOf();
  await key('=', {metaKey: process.platform === 'darwin', ctrlKey: process.platform !== 'darwin'}); await delay(50);
  assert.ok(Math.abs(await widthOf() - (startWidth + 40)) < 1, `resize key grew ${startWidth} to ${await widthOf()}`);
  await key('-', {metaKey: process.platform === 'darwin', ctrlKey: process.platform !== 'darwin'}); await delay(50);
  assert.ok(Math.abs(await widthOf() - startWidth) < 1, 'resize key shrank back');
  await evaluate(`(() => { const grip=document.querySelector('.mini-resize'), b=grip.getBoundingClientRect();
    const fire=(type,x,y)=>grip.dispatchEvent(new PointerEvent(type,{pointerId:8,button:0,clientX:x,clientY:y,bubbles:true}));
    fire('pointerdown',b.x+8,b.y+8); fire('pointermove',b.x+108,b.y+8); fire('pointerup',b.x+108,b.y+8); })()`);
  await waitFor(`Math.abs(document.querySelector('.player-shell').getBoundingClientRect().width - ${startWidth + 100}) < 1`, 'grip resize');
  await delay(400);
  assert.equal(store.snapshot().settings.miniPlayerWidth, Math.round(startWidth + 100), 'width persisted');
  await key('`');
  await waitFor("!!document.querySelector('.player-shell.is-expanded') && !document.querySelector('.app input[aria-label=\"Search anime\"]')", 'backtick expands the player');
  await key('Escape');
  await waitFor("!!document.querySelector('.player-shell.is-docked.corner-top-left')", 'docks again into the remembered corner');
  await evaluate("document.querySelector('.mini-bar [aria-label=\"Stop playback\"]').click()");
  await waitFor("!document.querySelector('.player-surface') && !!document.querySelector('.app input[aria-label=\"Search anime\"]')", 'close removes the player');
  await waitFor(`document.title === 'ANIdesktop'`, 'window title restored');
  assert.equal(playerActive, false, 'player reported inactive');
  assert.ok(!playbackMenu().enabled, 'playback menu disabled without a session');
  console.log('PASS: Escape docks, the mini bar controls, drags and resizes, backtick expands, close ends the session');
  await diagnostics.close();
  win.destroy();server.close();await delay(100);rmSync(directory,{recursive:true,force:true});app.exit(0);
}).catch(error=>{console.error(error);if(win&&!win.isDestroyed())win.destroy();server?.close();app.exit(1);});
