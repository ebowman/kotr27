// Node 22+ and Chrome. Serve only the release files, under a Pages-style prefix.
// CHROME=/path/to/chrome node --test tests/flyover.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { browser, until } from './browser.mjs';

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
  const {cmd, js, exceptions} = await browser(t, (m, send) => {
    if (m.method === 'Fetch.requestPaused') {
      const script = m.params.request.url.endsWith('.js');
      send('Fetch.fulfillRequest',{requestId:m.params.requestId, responseCode:200,
        responseHeaders:[{name:'Content-Type',value:script?'text/javascript':'text/css'}],
        body:Buffer.from(script?sdk:'').toString('base64')});
    }
  });
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
  await until(async () => (await box()) !== firstFrame);
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
