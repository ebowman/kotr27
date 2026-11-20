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
    'assets/semonzo.gpx':'application/xml'};
  const omit = new Set(), served = new Set(), legacy = [];
  const sdkStarted = Promise.withResolvers();
  const server = createServer(async (req, res) => {
    const file = new URL(req.url,'http://localhost').pathname.replace(/^\/kotr27\//, '') || 'index.html';
    if (/relief|ascent\.svg/.test(file)) legacy.push(file);
    if (!Object.hasOwn(files, file) || omit.has(file)) {
      res.writeHead(404).end(); return;
    }
    // The pinned SDK must start without waiting for GPX parsing.
    if (file === 'assets/semonzo.gpx') await sdkStarted.promise;
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
      getSource(id) { return this[id]; }
      setPaintProperty() {}
      setTerrain(value) { this.terrain = value; }
      hints = [];
      imagery=true;
      getStyle(){return {layers:[{type:'raster',source:'sat'}]};}
      transform={elevation:{get proxyCoords(){return this.visibleDemTiles.map(t=>t.tileID);},
        get terrainTileForTile(){return this.visibleDemTiles;},
        visibleDemTiles:[{tileID:{key:0,canonical:{x:0,y:0,z:14}},dem:{dim:1,get:()=>500}}]},
        coveringTiles:()=>[1,2].map(key=>({key,children:()=>[{key:3}]}))};
      style={_getSourceCache:()=>({getSource:()=>({tileSize:256,maxzoom:18}),
        getRenderableIds:()=>this.imagery?[1,2]:[1],hasRenderableParent:()=>false})};
      isSourceLoaded(){return true;}
      jumpTo(options) { if (options.preloadOnly) this.hints.push(options); }
      getBearing() { return 0; }
      areTilesLoaded() { return this.ready; }
      fitBounds() { this.camera = null; }
      height() {return +stats.textContent.match(/(\\d+) m elevation/)[1];}
      queryTerrainElevation() { return this.height()+100; }
      project() { return {x:map.clientWidth/2,y:map.clientHeight/2}; }
      queryRenderedFeatures(box,opts) {if (!opts) return this.overviewRoad ? [this.layer] : [];
        return opts.layers.includes(this.layer.id) && this.rider &&
        box[0][0]<=map.clientWidth/2 && box[1][0]>=map.clientWidth/2 ? [{layer:this.layer}] : [];}
      triggerRepaint() { /* render events driven by test */ }
      getFreeCameraOptions() { return {position:{toLngLat:()=>({distanceTo:()=>1})},setPitchBearing(){},lookAtPoint(target){this.target = target;}}; }
      unproject() { return this.rider; }
      setFreeCameraOptions(camera) { this.camera = camera; }
      remove() { this.removed = true; }
    },
    Marker: class {
      constructor({element}) { this.el=element; this.el.style.cssText='position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)'; }
      getLngLat(){ return Object.assign(demo.rider,{distanceTo:()=>demo.pickError || 0}); } setLngLat(xy){ demo.rider = xy; }
      addTo(){map.append(this.el);} remove(){this.el.remove();demo.rider = null;}
    },
    MercatorCoordinate:{fromLngLat:(xy, altitude) => ({xy, altitude})},
    LngLatBounds:class { extend(){return this;} }
  };`;
  let sdkGate, failSDK=false;
  const {cmd, js, exceptions} = await browser(t, async (m, send) => {
    if (m.method === 'Fetch.requestPaused') {
      sdkStarted.resolve();
      const script = m.params.request.url.endsWith('.js');
      if (sdkGate) await sdkGate.promise;
      if (failSDK) {
        send('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'Failed'});
        return;
      }
      send('Fetch.fulfillRequest',{requestId:m.params.requestId, responseCode:200,
        responseHeaders:[{name:'Content-Type',value:script?'text/javascript':'text/css'}],
        body:Buffer.from(script?sdk:'').toString('base64')});
    }
  });
  await cmd('Fetch.enable',{patterns:[{urlPattern:'https://api.mapbox.com/*'}]});
  await cmd('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
  sdkGate=Promise.withResolvers();
  await cmd('Page.navigate',{url});
  await until(() => js(`document.querySelector('#deck')?.hidden === false`));
  assert.equal(served.size, Object.keys(files).length);
  assert.ok(await js(`document.documentElement.scrollWidth <= innerWidth`));
  assert.ok(await js(`message.textContent.startsWith('Loading') && !document.querySelector('.viewport img,.viewport svg')`));
  await js(`play.click()`); await sleep(350);
  assert.ok(await js(`+seek.value===0 && mode.textContent==='Buffering'`));
  sdkGate.resolve(); sdkGate=null;
  await until(()=>js(`!!window.demo?.camera`));
  assert.ok(await js(`+seek.value===0 && mode.textContent==='Buffering'`));
  // Even when every source reports ready, a stale DOM pose or terrain
  // pick must not unhide the map or let the clock escape.
  await js(`window.dot=document.querySelector('.rider-beacon'); dot.style.marginLeft='10.9px';
    demo.ready=true; demo.events.render()`);
  assert.ok(await js(`map.getAttribute('aria-busy')==='true' && +seek.value===0`));
  await js(`dot.style.marginLeft=''; demo.pickError=30; demo.events.render()`);
  assert.ok(await js(`map.getAttribute('aria-busy')==='true' && +seek.value===0`));
  await js(`demo.pickError=0; demo.ready=false`);
  await sleep(60); await js('demo.events.render()');
  await until(()=>js(`+seek.value>10 && mode.textContent==='Cinematic flyover'`));
  // Losing visible imagery freezes the *existing* pose; unrelated pending
  // requests (demo.ready=false) must not prevent a visible ride resuming.
  const held=await js(`demo.imagery=false; demo.events.render(); +seek.value`);
  await sleep(350);
  assert.ok(await js(`+seek.value===${held} && mode.textContent==='Buffering'`));
  await js('demo.imagery=true; demo.events.render()');
  await until(()=>js(`+seek.value>${held}`));
  await js(`reset.click()`);
  assert.ok(await js(`demo.options.style.includes('satellite') && demo.terrain === null
    && demo.dem.type === 'raster-dem' && demo.ascent.data.coordinates.length > 100 && demo.layer.source === 'ascent'`));
  assert.equal(await js(`demo.events.render(); map.getAttribute('aria-busy')`),'true');
  assert.equal(await js(`demo.overviewRoad=true; demo.imagery=false; demo.events.render(); map.getAttribute('aria-busy')`),'true');
  assert.equal(await js(`demo.imagery=true; demo.events.render(); map.getAttribute('aria-busy')`),'false');
  assert.equal(await js(`document.querySelector('meta[name=referrer]').content`),'strict-origin-when-cross-origin');
  const box = () => js(`JSON.stringify(demo.camera)`);
  const overview = await box();
  assert.equal(await js(`mode.textContent`),'Route overview');
  assert.match(await js(`stats.textContent`),/18\.\d km remaining/);
  // Drive render notifications separately from playback. Pending visible
  // tiles and data saver must both suppress hints even while playing.
  await js(`speed.value='4'; play.click(); demo.events.render()`);
  assert.equal(await js('demo.hints.length'),0);
  await js(`demo.ready=true; Object.defineProperty(navigator.connection,'saveData',{value:true,configurable:true})`);
  await js('demo.events.render()');
  await sleep(500);
  assert.equal(await js('demo.events.render(); demo.hints.length'),0);
  assert.equal(await js(`delete navigator.connection.saveData; demo.events.render();
    for(let i=0;i<100;i++) demo.events.render(); demo.hints.length`),1);
  await js('reset.click()');
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
        speed.value = '${speedValue}'; play.click(); demo.events.render();
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
      speed.value = '4'; play.click(); demo.events.render();
      next(0); next(1000/60);
      const capture = () => [+seek.value,demo.camera.position.altitude];
      const before = capture();
      demo.queryTerrainElevation = () => null;
      next(2000+1000/60); const after = capture();
      demo.events.render(); const missing=message.textContent;
      demo.queryTerrainElevation = () => demo.height()+220;
      next(4000); const buffered=capture();
      demo.events.sourcedata({sourceId:'dem'}); demo.events.render(); demo.events.render();
      next(8000); const first=capture();
      next(8000+1000/60); const resumed = capture();
      play.click(); return {before,after,buffered,first,resumed,missing,height:demo.height(),step:+seek.max*4/90/60};
    } finally { window.requestAnimationFrame = raf; window.cancelAnimationFrame = cancel; demo.queryTerrainElevation = dem; }
  })()`);
  const {before,after,resumed,step} = delayed;
  assert.match(delayed.missing,/Loading/);
  assert.equal(delayed.buffered[0],after[0]); assert.equal(delayed.first[0],after[0]);
  assert.ok(Math.abs(after[0]-before[0]-step)<1 && Math.abs(resumed[0]-after[0]-step)<1);
  assert.ok(after[1] < before[1] && after[1] > before[1]-60);
  assert.equal(resumed[1],delayed.height+820);
  // A higher DEM sample can arrive between the last frame and the pause
  // click. With no elapsed time only camera altitude should change.
  const onPause = await js(`(() => {
    const dem = demo.queryTerrainElevation;
    const planar = () => [seek.value, demo.rider, demo.camera.position.xy, demo.camera.target];
    try {
      demo.queryTerrainElevation = () => demo.height()+50;
      seek.value = 2450; seek.dispatchEvent(new Event('input'));
      play.click();
      const before = planar(), low = demo.camera.position.altitude;
      demo.queryTerrainElevation = () => demo.height()+250;
      play.click();
      return {before, after:planar(), low, high:demo.camera.position.altitude, height:demo.height()};
    } finally { demo.queryTerrainElevation = dem; }
  })()`);
  assert.deepEqual(onPause.after,onPause.before);
  assert.deepEqual([onPause.low,onPause.high],[onPause.height+650,onPause.height+850]);
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
  await js(`speed.value = '4'; play.click(); demo.events.render()`);
  await until(() => js(`Number(seek.value) > 40`));
  assert.ok(await js('Math.abs(demo.camera.position.altitude-demo.height()-700)<2'));
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
    && mode.textContent === 'Buffering' && +seek.value === 0`));
  await js('reset.click()'); assert.equal(await box(),overview);
  assert.equal(await js('demo.camera'),null);
  // Tap the native range layered directly on the elevation profile.
  const [x,y] = await js(`seek.scrollIntoView({block:'center'}); (()=>{const r=seek.getBoundingClientRect();return [r.x+r.width*.5,r.y+r.height*.5]})()`);
  for (const type of ['mousePressed','mouseReleased']) await cmd('Input.dispatchMouseEvent',{type,x,y,button:'left',clickCount:1});
  assert.ok(await js(`Math.abs(seek.value/seek.max - .5) < .02`));
  // A later DEM refinement can be within regional bounds but disagree
  // with the independent GPX. Never leave that 3D frame visible.
  await js(`demo.events.render(); demo.queryTerrainElevation=()=>demo.height()+600;
    demo.events.sourcedata({sourceId:'dem'}); demo.events.render()`);
  assert.ok(await js(`demo.terrain===null && play.disabled && +seek.value===0 && map.getAttribute('aria-busy')==='true'`));
  await js(`demo.events.render()`);
  assert.ok(await js(`map.getAttribute('aria-busy')==='false' && message.textContent.includes('Flat satellite overview')`));
  const distance = await js('seek.value');
  await js(`demo.events.error({error:{status:403}})`);
  assert.ok(await js(`demo.removed && message.textContent.includes('unavailable')`));
  assert.equal(await js('seek.value'),distance);
  assert.ok(await js(`play.disabled && +seek.value===${distance}`));
  failSDK=true;
  await cmd('Page.navigate',{url:url+'?sdk-failed'});
  await until(()=>js(`location.search==='?sdk-failed' && document.querySelector('#message')?.textContent.includes('unavailable')`));
  assert.ok(await js(`!deck.hidden && profile.getAttribute('d').length>100 && !window.demo`));
  omit.add('js/config.js');
  await cmd('Page.navigate',{url:url+'index.html'});
  await until(()=>js(`location.pathname.endsWith('index.html') && document.querySelector('#deck')?.hidden === false`));
  assert.ok(await js(`message.getAttribute('role')==='status' && message.textContent.includes('unavailable')`));
  assert.ok(await js(`play.disabled && !seek.disabled`));
  omit.add('assets/semonzo.gpx');
  await cmd('Page.navigate',{url});
  await until(()=>js(`document.querySelector('#message')?.textContent.includes('Route data unavailable')`));
  assert.equal(await js('deck.hidden'),true);
  assert.deepEqual(legacy,[]);
  assert.deepEqual(exceptions,[]);
});
