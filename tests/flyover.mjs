// Node 22+ and Chrome. Serve only the release files, under a Pages-style prefix.
// CHROME=/path/to/chrome node --test tests/flyover.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';

test('phone-sized preview, follow camera, controls and asset fallbacks', {timeout: 60000}, async t => {
  const files = {'index.html':'text/html','assets/flyover.js':'text/javascript',
    'assets/terrain.js':'text/javascript', 'js/config.js':'text/javascript',
    'assets/semonzo.gpx':'application/xml','assets/ascent.svg':'image/svg+xml',
    'assets/grappa-relief.webp':'image/webp'};
  const omit = new Set(), served = new Set();
  const server = createServer(async (req, res) => {
    const file = req.url.replace(/^\/kotr27\//, '') || 'index.html';
    if (!Object.hasOwn(files, file) || omit.has(file)) {
      res.writeHead(404).end(); return;
    }
    // Never serve or inspect the provisioned config in a browser test.
    const data = file === 'js/config.js' ? 'window.KOTR_CONFIG = {};' :
      await readFile(new URL(`../${file}`, import.meta.url));
    served.add(file);
    res.writeHead(200, {'Content-Type':files[file], 'Cache-Control':'no-store'}).end(data);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/kotr27/`;
  const dir = await mkdtemp(join(tmpdir(), 'kotr27-test-'));
  const chrome = spawn(process.env.CHROME || (process.platform === 'darwin'
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome'),
  ['--headless','--disable-background-networking','--disable-extensions','--disable-sync',
    `--user-data-dir=${dir}`, '--remote-debugging-pipe', 'about:blank'], {stdio:['ignore','ignore','pipe','pipe','pipe']});
  chrome.stderr.on('data', data => { if (process.env.DEBUG_CHROME) process.stderr.write(data); });
  const closed = once(chrome, 'close');
  t.after(async () => { chrome.kill(); await closed; await rm(dir, {recursive:true, force:true}); });
  async function until(fn) {
    for (let i=0;i<100;i++) { const v = await fn(); if (v) return v; await sleep(50); }
    assert.fail(`Timed out: ${fn}`);
  }
  let id = 0, sessionId, incoming = '';
  const pending = new Map(), exceptions = [];
  // Intercept the SDK only. Exercise the real DOM, GPX, controller, clock,
  // camera math and fallback without making authenticated network requests.
  const sdk = `window.mapboxgl = {
    Map: class {
      constructor(options) { window.demo = this; this.options = options; this.events = {}; }
      once(name, fn) { setTimeout(fn, 0); }
      on(name, fn) { this.events[name] = fn; }
      addLayer(layer) { this.layer = layer; }
      addSource(id, source) { this[id] = source; }
      setTerrain(value) { this.terrain = value; }
      jumpTo() {}
      fitBounds() { this.camera = null; }
      queryTerrainElevation() { return 2000; }
      getFreeCameraOptions() { return {lookAtPoint(target){this.target = target;}}; }
      setFreeCameraOptions(camera) { this.camera = camera; }
      remove() { this.removed = true; }
    },
    Marker: class { setLngLat(xy){ demo.rider = xy; } addTo(){} remove(){demo.rider = null;} },
    MercatorCoordinate:{fromLngLat:(xy, altitude) => ({xy, altitude})},
    LngLatBounds:class { extend(){return this;} }
  };`;
  function dispatch(m) {
    if (m.method === 'Fetch.requestPaused') {
      const script = m.params.request.url.endsWith('.js');
      cmd('Fetch.fulfillRequest',{requestId:m.params.requestId, responseCode:200,
        responseHeaders:[{name:'Content-Type',value:script?'text/javascript':'text/css'}],
        body:Buffer.from(script?sdk:'').toString('base64')});
    }
    if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.text);
    if (!pending.has(m.id)) return;
    const {resolve,reject} = pending.get(m.id); pending.delete(m.id);
    if (m.error) reject(Error(m.error.message)); else resolve(m.result);
  }
  chrome.stdio[4].setEncoding('utf8').on('data', chunk => {
    incoming += chunk;
    let end;
    while ((end = incoming.indexOf('\0')) >= 0) {
      dispatch(JSON.parse(incoming.slice(0,end))); incoming = incoming.slice(end + 1);
    }
  });
  function cmd(method, params={}) {
    return new Promise((resolve,reject) => {
      pending.set(++id,{resolve,reject}); chrome.stdio[3].write(JSON.stringify({id,method,params,sessionId})+'\0');
    });
  }
  async function js(expression) {
    const r = await cmd('Runtime.evaluate',{expression,returnByValue:true});
    assert.ok(!r.exceptionDetails,expression); return r.result.value;
  }
  const {targetId} = await cmd('Target.createTarget',{url:'about:blank'});
  ({sessionId} = await cmd('Target.attachToTarget',{targetId,flatten:true}));
  await cmd('Runtime.enable');
  await cmd('Fetch.enable',{patterns:[{urlPattern:'https://api.mapbox.com/*'}]});
  await cmd('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
  await cmd('Page.navigate',{url});
  await until(() => js(`document.querySelector('#deck')?.hidden === false`));
  assert.equal(served.size, Object.keys(files).length);
  assert.ok(await js(`document.documentElement.scrollWidth <= innerWidth`));
  await until(() => js(`!!document.querySelector('.terrain')`));
  assert.ok(await js(`demo.options.style.includes('satellite') && demo.terrain.source === 'dem'
    && demo.dem.type === 'raster-dem' && demo.ascent.data.coordinates.length > 100 && demo.layer.source === 'ascent'`));
  assert.equal(await js(`document.querySelector('meta[name=referrer]').content`),'strict-origin-when-cross-origin');
  const box = () => js(`scene.getAttribute('viewBox')`);
  const overview = await box();
  assert.equal(await js(`mode.textContent`),'Route overview');
  assert.match(await js(`stats.textContent`),/18\.\d km remaining/);
  await js(`speed.value = '4'; play.click()`);
  await until(() => js(`Number(seek.value) > 40`));
  assert.ok(await js(`demo.camera.position.altitude === 2300 &&
    JSON.stringify(demo.camera.target) === JSON.stringify(demo.rider) &&
    Math.abs(Math.hypot((demo.camera.position.xy[0]-demo.rider[0])*77450,
    (demo.camera.position.xy[1]-demo.rider[1])*111200)-200)<.01`));
  const firstFrame = await box(); assert.notEqual(firstFrame,overview);
  await sleep(100); assert.notEqual(await box(),firstFrame);
  await js('play.click()'); const paused = await box();
  await sleep(100); assert.equal(await box(),paused);
  await js('seek.focus()');
  async function key(key,code) {
    for (const type of ['keyDown','keyUp']) await cmd('Input.dispatchKeyEvent',{type,key,windowsVirtualKeyCode:code});
  }
  await key('Home',36); await key('ArrowRight',39);
  assert.equal(await js('seek.value'),'100');
  await key('End',35);
  assert.equal(await js('mode.textContent'),'Summit');
  assert.match(await js('stats.textContent'),/1746 m elevation · 0\.0 km remaining/);
  assert.deepEqual(await js('demo.camera.target'),await js('demo.ascent.data.coordinates.at(-1)'));
  await js('play.click()'); await until(()=>js(`mode.textContent === 'Following' && +seek.value < 1000`));
  await js('reset.click()'); assert.equal(await box(),overview);
  assert.equal(await js('demo.camera'),null);
  // Tap the native range layered directly on the elevation profile.
  const [x,y] = await js(`seek.scrollIntoView({block:'center'}); (()=>{const r=seek.getBoundingClientRect();return [r.x+r.width*.5,r.y+r.height*.5]})()`);
  for (const type of ['mousePressed','mouseReleased']) await cmd('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1});
  assert.ok(await js(`Math.abs(seek.value/seek.max - .5) < .02`));
  const distance = await js('seek.value');
  await js(`demo.events.error({error:{status:403}})`);
  assert.ok(await js(`demo.removed && !document.querySelector('.terrain') && message.textContent.includes('relief')`));
  assert.equal(await js('seek.value'),distance);
  await js('play.click()'); await until(()=>js(`+seek.value > ${distance}`));
  omit.add('js/config.js');
  omit.add('assets/grappa-relief.webp');
  await cmd('Page.navigate',{url:url+'index.html'});
  await until(()=>js(`location.pathname.endsWith('index.html') && document.querySelector('#deck')?.hidden === false`));
  assert.ok(await js(`document.querySelector('image[href$="ascent.svg"]') !== null`));
  await js('play.click()'); await until(()=>js('+seek.value > 0'));
  omit.add('assets/semonzo.gpx');
  await cmd('Page.navigate',{url});
  await until(()=>js(`document.querySelector('#message')?.textContent.includes('Playback is unavailable')`));
  assert.equal(await js('deck.hidden'),true);
  assert.deepEqual(exceptions,[]);
});
