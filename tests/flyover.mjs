// Node 22+ and Chrome. Serve only the release files, under a Pages-style prefix.
// CHROME=/path/to/chrome node --test tests/flyover.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { browser, until } from './browser.mjs';

test('phone-sized cinematic orbit, controls and asset fallbacks', {timeout: 60000}, async t => {
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
  // Drive the real playback callback with known foreground timestamps. Starting
  // at 2.45 km crosses the tight switchback at 2.536 km at either speed.
  async function orbit(speedValue, hz, start = 2450) {
    return js(`(() => {
      const raf = window.requestAnimationFrame, cancel = window.cancelAnimationFrame;
      let next;
      window.requestAnimationFrame = cb => { next = cb; return 1; };
      window.cancelAnimationFrame = () => { next = null; };
      try {
        seek.value = ${start}; seek.dispatchEvent(new Event('input'));
        speed.value = '${speedValue}'; play.click();
        const samples = [];
        for (let n = 0; n <= ${hz}; n++) {
          next(1000 * n / ${hz});
          const {position, target} = demo.camera;
          const east = (position.xy[0]-target[0])*77450, south = (target[1]-position.xy[1])*111200;
          samples.push([Math.atan2(east,south),Math.hypot(east,south),
            Math.hypot((target[0]-demo.rider[0])*77450,(target[1]-demo.rider[1])*111200),
            ...target, ...demo.rider, +seek.value]);
        }
        play.click();
        const end = +seek.value, rider = demo.rider;
        // Seeking to the displayed metre should reproduce the moving marker.
        seek.dispatchEvent(new Event('input'));
        const markerError = Math.hypot((demo.rider[0]-rider[0])*77450,(demo.rider[1]-rider[1])*111200);
        return {samples, end, total:+seek.max, markerError, pending:!!next};
      } finally { window.requestAnimationFrame = raf; window.cancelAnimationFrame = cancel; }
    })()`);
  }
  // Warm up both paths before the 2.536 km Semonzo hairpin. Reconstruct the
  // former .32 s rider EMA from the very same frame positions.
  const {samples} = await orbit(4,60,1900);
  let old, oldPrev, newPrev, oldVel, newVel, oldPeak = 0, newPeak = 0, count = 0;
  const diff = (a,b) => a.map((v,i) => (v-b[i])*60);
  const xy = (x,y) => [(x-11.78)*77450,(y-45.84)*111200];
  for (const [,,,lon,lat,rLon,rLat,metres] of samples) {
    const target = xy(lon,lat), rider = xy(rLon,rLat);
    old = old ? old.map((v,i) => v - Math.expm1(-1/60/.32)*(rider[i]-v)) : rider;
    if (newPrev) {
      const ov = diff(old,oldPrev), nv = diff(target,newPrev);
      if (metres >= 2450 && metres <= 2650) {
        count++;
        oldPeak = Math.max(oldPeak, Math.hypot(...diff(ov,oldVel)));
        newPeak = Math.max(newPeak, Math.hypot(...diff(nv,newVel)));
      }
      oldVel = ov; newVel = nv;
    }
    newPrev = target; oldPrev = old;
  }
  t.diagnostic(`4x/60 Hz, 2450–2650 m (${count} frames): peak planar target acceleration ${oldPeak.toFixed(1)} → ${newPeak.toFixed(1)} m/s²`);
  assert.ok(count >= 12 && newPeak < oldPeak*.75);
  // Inject a 2 s foreground stall and a sudden DEM drop, then a rise. The
  // resumed clock owes no distance and the camera never dips below clearance.
  const delayed = await js(`(() => {
    const raf = window.requestAnimationFrame, cancel = window.cancelAnimationFrame;
    const dem = demo.queryTerrainElevation;
    let next;
    window.requestAnimationFrame = cb => { next = cb; return 1; };
    window.cancelAnimationFrame = () => { next = null; };
    try {
      seek.value = 2450; seek.dispatchEvent(new Event('input'));
      speed.value = '4'; play.click();
      next(0); next(1000/60);
      const capture = () => [+seek.value,demo.camera.position.altitude];
      const before = capture();
      demo.queryTerrainElevation = () => null;
      next(2000+1000/60); const after = capture();
      demo.queryTerrainElevation = () => 2300;
      next(2000+2000/60); const resumed = capture();
      play.click(); return {before,after,resumed,step:+seek.max*4/90/60};
    } finally { window.requestAnimationFrame = raf; window.cancelAnimationFrame = cancel; demo.queryTerrainElevation = dem; }
  })()`);
  const {before,after,resumed,step} = delayed;
  assert.ok(Math.abs(after[0]-before[0]-step)<1 && Math.abs(resumed[0]-after[0]-step)<1);
  assert.ok(after[1] < before[1] && after[1] > before[1]-60);
  assert.equal(resumed[1],2900);
  // A higher DEM sample can arrive between the last frame and the pause
  // click. With no elapsed time only camera altitude should change.
  const onPause = await js(`(() => {
    const dem = demo.queryTerrainElevation;
    const planar = () => [seek.value, demo.rider, demo.camera.position.xy, demo.camera.target];
    try {
      demo.queryTerrainElevation = () => 1000;
      seek.value = 2450; seek.dispatchEvent(new Event('input'));
      play.click();
      const before = planar(), low = demo.camera.position.altitude;
      demo.queryTerrainElevation = () => 2000;
      play.click();
      return {before, after:planar(), low, high:demo.camera.position.altitude};
    } finally { demo.queryTerrainElevation = dem; }
  })()`);
  assert.deepEqual(onPause.after,onPause.before);
  assert.deepEqual([onPause.low,onPause.high],[1600,2600]);
  for (const [speedValue,hz] of [[1,60],[4,60],[4,10]]) {
    const {samples,end,total,markerError,pending} = await orbit(speedValue,hz);
    assert.ok(Math.abs(end - (2450 + speedValue * total/90)) < 1);
    assert.ok(markerError <= .501);
    assert.equal(pending,false);
    assert.equal(samples[0][2],0,'seek snaps focus to exact rider');
    assert.ok(samples.some(s => s[2] > 10),'framing smooths independently of marker');
    samples.forEach(([angle,radius,lag],i) => {
      assert.ok(Math.abs(angle - .08*i/hz) < 1e-8,'steady real-time orbit through hairpin');
      assert.ok(Math.abs(radius-900) < .01 && lag < radius/3);
    });
  }
  await js('reset.click()');
  await js(`speed.value = '4'; play.click()`);
  await until(() => js(`Number(seek.value) > 40`));
  assert.equal(await js('demo.camera.position.altitude'),2600);
  const firstFrame = await box(); assert.notEqual(firstFrame,overview);
  await until(async () => (await box()) !== firstFrame);
  await js('play.click()'); const paused = await box();
  const pose = await js('[demo.camera, demo.rider, seek.value]');
  await sleep(100); assert.equal(await box(),paused);
  assert.deepEqual(await js('[demo.camera, demo.rider, seek.value]'),pose);
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
  assert.ok(await js(`play.click(); JSON.stringify(demo.camera.target) === JSON.stringify(demo.ascent.data.coordinates[0])
    && mode.textContent === 'Cinematic flyover' && +seek.value === 0`));
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
