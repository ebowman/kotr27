// Optional real-engine integration: download the pinned public mapbox-gl.js
// and run MAPBOX_GL_215=/path/to/mapbox-gl.js node --test tests/preload.mjs.
// No account/config, real basemap or authenticated tile requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { crc32, deflateSync } from 'node:zlib';
import { setTimeout as sleep } from 'node:timers/promises';
import { browser, until } from './browser.mjs';

// Solid 256px RGB PNG, valid both as imagery and a constant Mapbox DEM.
const u32 = n => {const b=Buffer.alloc(4); b.writeUInt32BE(n); return b;};
function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  return Buffer.concat([u32(data.length),body,u32(crc32(body))]);
}
const row = Buffer.concat([Buffer.alloc(1),Buffer.alloc(256*3,Buffer.from([1,154,40]))]);
const png = rows => Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),
  chunk('IHDR',Buffer.from('00000100000001000802000000','hex')),
  chunk('IDAT',deflateSync(Buffer.concat(rows))),chunk('IEND',Buffer.alloc(0))]);
const tile = png(Array(256).fill(row));
const raisedTile = png(Array(256).fill(Buffer.concat([Buffer.alloc(1),
  Buffer.alloc(256*3,Buffer.from([1,189,80]))]))); // ~1,400 m instead of ~500 m
// A 1,200 m east-west ridge ~450 m south of the rider at km 5.
// The camera and rider both stand outside this band on 500 m terrain.
function ridgeTile(path) {
  const [, , z, x, y] = path.split('/');
  const rows = Array.from({length:256}, (_, j) => {
    const lat = Math.atan(Math.sinh(Math.PI*(1-2*(+y+(j+.5)/256)/2**z)))*180/Math.PI;
    const relief = 700*Math.min(1,Math.max(0,(.0032-Math.abs(lat-45.8128))/.0012));
    const pixels = Buffer.alloc(769);
    for (let i=0;i<256;i++) {
      const lon = (+x+(i+.5)/256)/2**z*360-180;
      const height = 500+relief*Math.min(1,Math.max(0,(.003-Math.abs(lon-11.761))/.0015));
      pixels.writeUIntBE(Math.round((10000+height)*10),1+3*i,3);
    }
    return pixels;
  });
  return png(rows);
}
const instrument = `
window.hints = []; window.visits = [];
mapboxgl.Marker = class extends mapboxgl.Marker {
  constructor(options) { super(options); if(options.element) window.beacon=this; }
};
mapboxgl.Map = class extends mapboxgl.Map {
  constructor(options) {
    super({...options,testMode:true,style:{version:8,sources:{sat:{type:'raster',
      tiles:[location.origin+'/sat/{z}/{x}/{y}'],tileSize:256,maxzoom:18}},
      layers:[{id:'sat',type:'raster',source:'sat'}]},transformRequest(url,type){
        if(type==='Tile') (window.batch?.tiles || visits).push({url,t:performance.now()});
        return {url};
      }});
    window.testMap=this;
  }
  addSource(id,src) {
    if(id==='dem') {
      src={...src,tiles:[location.origin+'/dem/{z}/{x}/{y}']};
      delete src.url;
    }
    return super.addSource(id,src);
  }
  jumpTo(options,...args) {
    if(!options.preloadOnly) return super.jumpTo(options,...args);
    const pose=()=>JSON.stringify([this.getCenter(),this.getZoom(),this.getPitch(),this.getBearing()]);
    const before=pose();
    window.batch={t:performance.now(),tiles:[],ready:this.areTilesLoaded()};
    try {return super.jumpTo(options,...args);}
    finally { batch.still=before===pose(); hints.push(batch); window.batch=null; }
  }
};`;

async function fixture(t, scenario = 'preload') {
    let demGate, held = 0, coldDestination = false;
    const sdk = await readFile(process.env.MAPBOX_GL_215);
    assert.equal(createHash('sha256').update(sdk).digest('hex'),
      '302ee91531bc123693caa52eb74f71a2fb9ff61311f54d59ec3c04325dc5b2f7');
    const server = createServer(async (req,res) => {
      const path = req.url;
      if (/^\/(sat|dem)\//.test(path)) {
        if (demGate && path.startsWith('/dem/')) { held++; await demGate.promise; }
        await sleep(20);
        res.writeHead(200,{'Content-Type':'image/png','Cache-Control':scenario==='cold'?'no-store':'public, max-age=3600'})
          .end(path.startsWith('/dem/') ? (scenario==='ridge' ? ridgeTile(path) :
            coldDestination ? raisedTile : tile) : tile);
      } else if (path === '/sdk.js') res.end(Buffer.concat([sdk,Buffer.from('\n'+instrument)]));
      // Only SDK layout rules needed by the local fixture (no CDN requests).
      else if (path === '/sdk.css') res.writeHead(200,{'Content-Type':'text/css'}).end(
        '.mapboxgl-map{overflow:hidden}.mapboxgl-canvas,.mapboxgl-marker{position:absolute;top:0;left:0}');
      else if (path === '/js/config.js') res.end('window.KOTR_CONFIG={}');
      else if (path === '/' || /^\/assets\/(flyover\.js|terrain\.js|semonzo\.gpx|ascent\.svg|grappa-relief\.webp)$/.test(path)) {
        let body = await readFile(new URL('..'+(path==='/'?'/index.html':path),import.meta.url));
        if (path.endsWith('terrain.js')) body = body.toString().replace('https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl','/sdk');
        // Drive only the player's RAF deterministically; the SDK keeps its
        // own render loop and its normal terrain/DOM update schedule.
        if (scenario==='ride' && path.endsWith('flyover.js')) body = body.toString().replaceAll('requestAnimationFrame(tick)','(window.stepRide=tick,0)');
        res.end(body);
      } else res.writeHead(404).end();
    });
    server.listen(0,'127.0.0.1'); await once(server,'listening');
    t.after(() => {server.closeAllConnections();server.close();});
    const {cmd,js,exceptions} = await browser(t);
    await cmd('Network.enable');
    await cmd('Network.setBlockedURLs',{urls:['https://*']});
    await cmd('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:true});
    await cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
    await until(()=>js(`!!document.querySelector('.terrain')`));
    return {js,cmd,exceptions,hold:()=>{demGate=Promise.withResolvers();coldDestination=true;},held:()=>held,
      release:()=>{demGate?.resolve();demGate=null;}};
}

test('real 2.15 fetches upcoming imagery and elevation before visible use',
  {skip:!process.env.MAPBOX_GL_215,timeout:60000}, async t => {
    const {js,exceptions} = await fixture(t);
    await js(`performance.setResourceTimingBufferSize(5000); speed.value='4'; play.click()`);
    await sleep(12000);
    const {hints,visits,network,total} = await js(`play.click(); ({hints,visits,total:+seek.max,network:performance.getEntriesByType('resource')
      .filter(e=>e.transferSize>0).map(e=>({url:e.name,t:e.startTime}))})`);
    const largest = Math.max(...hints.map(h=>h.tiles.length));
    t.diagnostic(`${hints.length} hints in 12 s at 4x, ${Math.round(total*4/90*2.5)} m horizon; max ${largest} SDK tile selections/hint`);
    assert.ok(largest <= 64,'phone-sized fixture should only cover one viewport per hint');
    assert.ok(hints.length >= 2 && hints.length <= 9);
    hints.forEach((h,i) => {
      assert.ok(h.ready && h.still);
      if (i) assert.ok(h.t-hints[i-1].t >= 1499);
    });
    for (const kind of ['sat','dem']) {
      const leads=new Map();
      for (const h of hints) for (const {url} of h.tiles) {
        if (!new URL(url).pathname.startsWith('/'+kind+'/')) continue;
        const net = network.find(n=>n.url===url);
        if (!net || net.t<h.t || visits.some(v=>v.url===url && v.t<net.t)) continue;
        const use=visits.find(v=>v.url===url && v.t>net.t);
        if (use) leads.set(url,use.t-net.t);
      }
      assert.ok(leads.size, `expected newly fetched future ${kind} tiles`);
      t.diagnostic(`${kind}: ${leads.size} future matches, max network lead ${Math.round(Math.max(...leads.values()))} ms`);
    }
    assert.deepEqual(exceptions,[]);
  });

test('real terrain marker remains opaque behind an intervening ridge',
  {skip:!process.env.MAPBOX_GL_215,timeout:30000}, async t => {
    const {js,cmd,exceptions} = await fixture(t,'ridge');
    for (const width of [375,1280]) {
      await cmd('Emulation.setDeviceMetricsOverride',{width,height:812,deviceScaleFactor:1,mobile:width<500});
      await js(`testMap.resize(); seek.value=5000; seek.dispatchEvent(new Event('input'));
        window.control=new mapboxgl.Marker({scale:.65}).setLngLat(beacon.getLngLat()).addTo(testMap); void 0`);
      // Positive control: let the unmodified SDK raycast the synthetic DEM
      // and fade its default marker. Merely configuring the option isn't proof.
      await until(()=>js(`control.getElement().style.opacity==='0.2' && beacon.getElement().style.opacity==='1'`));
      const ratio=await js(`(() => {const eye=testMap.getFreeCameraOptions().position.toLngLat(), p=beacon.getLngLat();
        return eye.distanceTo(testMap.unproject(testMap.project(p)))/eye.distanceTo(p)})()`);
      assert.ok(ratio<.9);
      assert.ok(await js(`(() => {const css=getComputedStyle(beacon.getElement()); return css.width==='20px'
        && css.backgroundColor==='rgb(255, 220, 86)' && css.borderTopWidth==='3px'
        && css.borderTopColor==='rgb(22, 60, 52)' && css.boxShadow.includes('rgb(255, 255, 255)')})()`));
      t.diagnostic(`${width}px: terrain hit ${(ratio*100).toFixed(0)}% of way to rider; default opacity 0.2, beacon 1`);
      await js('control.remove(); void 0');
    }
    assert.deepEqual(exceptions,[]);
  });

test('real SDK framing keeps the beacon centered on its position across the ascent',
  {skip:!process.env.MAPBOX_GL_215,timeout:120000}, async t => {
    const {js,cmd,exceptions} = await fixture(t,'ride');
    for (const width of [375,1280]) {
      await cmd('Emulation.setDeviceMetricsOverride',{width,height:812,deviceScaleFactor:1,mobile:width<500});
      await js('testMap.resize(); void 0');
      const sample = `(() => {
        const el=beacon.getElement(), b=el.getBoundingClientRect(), m=testMap.getContainer().getBoundingClientRect();
        const p=testMap.project(beacon.getLngLat());
        return {distance:+seek.value,width:b.width,opacity:+getComputedStyle(el).opacity,
          error:Math.hypot(b.x+b.width/2-m.x-p.x,b.y+b.height/2-m.y-p.y),
          margin:Math.min(b.left-m.left,m.right-b.right,b.top-m.top,m.bottom-b.bottom)};
      })()`;
      const check = s => {
        assert.ok(s.width>=20 && s.opacity===1 && s.margin>=2 && s.error<1.6,JSON.stringify(s));
      };
      for (const rate of [1,4]) {
        let min=Infinity, bends=0;
        // Continuous pass from the start, then a separate seek into the bends.
        for (const [start,end] of [[0,Infinity],[5200,7000]]) {
          await js(`seek.value=${start}; seek.dispatchEvent(new Event('input'))`);
          await until(()=>js(`testMap.areTilesLoaded()`));
          await js(`speed.value='${rate}'; play.click(); window.clock=0; stepRide(clock)`);
          const limit=Math.min(end,await js('+seek.max'));
          let s;
          do {
            // Advance in 100 ms player frames; yield to SDK layout/render
            // between samples. Sample ~every 165 m regardless of speed.
            await js(`for(let i=0;i<${8/rate} && +seek.value<+seek.max;i++) stepRide(clock+=100)`);
            await cmd('Runtime.evaluate',{expression:'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',awaitPromise:true});
            s=await js(sample); check(s); min=Math.min(min,s.margin);
            if (s.distance>=4000 && s.distance<=7000) bends++;
          } while (s.distance<limit);
        }
        assert.ok(bends>=20);
        t.diagnostic(`${width}px ${rate}x: ${bends} samples at km 4–7; minimum beacon-to-edge margin across ride ${min.toFixed(1)}px`);
      }
    }
    assert.deepEqual(exceptions,[]);
  });

for (const width of [375,1280]) for (const rate of [0,1,4]) {
  test(`cold summit → km 5.2, ${width}px ${rate ? rate+'x immediate resume' : 'paused'}`,
    {skip:!process.env.MAPBOX_GL_215,timeout:30000}, async t => {
    const {js,cmd,hold,held,release,exceptions}=await fixture(t,'cold');
    t.after(release);
    await cmd('Emulation.setDeviceMetricsOverride',{width,height:812,deviceScaleFactor:1,mobile:width<500});
    await js(`testMap.resize(); seek.value=seek.max; seek.dispatchEvent(new Event('input'))`);
    await until(()=>js(`!!document.querySelector('.terrain') && testMap.areTilesLoaded()`));
    // Independent GPX interpolation at the displayed metre, not the camera focus.
    const xml=await readFile(new URL('../assets/semonzo.gpx',import.meta.url),'utf8');
    let d=0;
    const track=[];
    for (const m of xml.matchAll(/<trkpt lon="([^"]+)" lat="([^"]+)"><ele>([^<]+)/g)) {
      const [x,y,z]=m.slice(1).map(Number), prev=track.at(-1);
      if(prev) d+=Math.hypot((x-prev[1])*77450,(y-prev[2])*111200);
      track.push([d,x,y,z]);
    }
    hold();
    await js(`window.track=${JSON.stringify(track)}; window.frames=[];
      window.capture=()=>{
        const d=+seek.value, i=track.findIndex(p=>p[0]>=d), a=track[i-1], b=track[i];
        const f=(d-a[0])/(b[0]-a[0]), [lon,lat,h]=a.slice(1).map((v,j)=>v+f*(b[j+1]-v));
        const relief=getComputedStyle(map).visibility!=='visible', g=document.querySelector('#relief-beacon');
        const el=relief?g:beacon.getElement(), box=el.getBoundingClientRect(), m=map.getBoundingClientRect();
        const gps=beacon.getLngLat(), gpsError=Math.hypot((lon-gps.lng)*77450,(lat-gps.lat)*111200);
        const p=relief?new DOMPoint((lon-11.78)*77450/15,-((lat-45.84)*111200*.68+h*.8)/15)
          .matrixTransform(scene.getScreenCTM()):testMap.project([lon,lat]);
        const css=getComputedStyle(el), ink=getComputedStyle(g.lastElementChild);
        const contrast=relief?ink.fill==='rgb(255, 220, 86)' && ink.stroke==='rgb(22, 60, 52)'
          && getComputedStyle(g.firstElementChild).fill==='rgb(255, 255, 255)'
          :css.backgroundColor==='rgb(255, 220, 86)' && css.borderTopColor==='rgb(22, 60, 52)'
          && css.boxShadow.includes('rgb(255, 255, 255)');
        const c=testMap.getFreeCameraOptions(), eye=c.position.toLngLat(), projected=testMap.project(gps);
        frames.push({d,relief,gpsError,t:performance.now(),visible:contrast && box.width>=16 && css.visibility==='visible' && +css.opacity===1,
          center:[box.x+box.width/2,box.y+box.height/2],
          terrainCenter:[m.x+projected.x,m.y+projected.y],
          margin:Math.min(box.left-m.left,m.right-box.right,box.top-m.top,m.bottom-box.bottom),
          error:Math.hypot(box.x+box.width/2-p.x-(relief?0:m.x),box.y+box.height/2-p.y-(relief?0:m.y)),
          camera:[eye.lng*77450,eye.lat*111200,c.position.toAltitude(),testMap.getPitch(),testMap.getBearing()]});
      };
      seek.value=5200; seek.dispatchEvent(new Event('input')); capture();
      if (${rate}) {speed.value='${rate}';play.click();}
      window.record=true; requestAnimationFrame(function frame(){if(record){capture();requestAnimationFrame(frame)}})`);
    await until(()=>held()>0);
    await sleep(350);
    assert.ok(await js('frames.length>=3 && frames.every(f=>f.relief)'));
    release();
    await until(()=>js(`!!document.querySelector('.terrain')`));
    await sleep(400);
    const frames=await js('window.record=false; frames');
    const shown=frames.findIndex(f=>!f.relief);
    assert.ok(shown>0 && frames.slice(shown).every(f=>!f.relief),'single handoff');
    assert.ok(frames[shown].camera[2]-frames[0].camera[2]>200,'camera absorbed late DEM rise before reveal');
    let handoff, extra;
    for(const [i,s] of frames.entries()) {
      assert.ok(s.visible && s.margin>=2 && s.gpsError<.51 && s.error<2,JSON.stringify(s));
      if (!rate) assert.equal(s.d,5200);
      if (!i) continue;
      const prev=frames[i-1], step=s.d-prev.d;
      const motion=Math.hypot(...s.center.map((v,j)=>v-prev.center[j]));
      // Allow normal perspective motion and a finite-speed relief pan, not
      // a discontinuity. At the switch require subpixel-scale agreement in
      // addition to this speed envelope.
      assert.ok(motion<=2+step*1.6+(rate ? .3 : 0)*(s.t-prev.t),`beacon moved ${motion}px over ${step}m at frame ${i}/${shown}`);
      if (i===shown) {
        handoff=motion;
        // Remove only genuine movement in the new camera's projection. A
        // layer-induced sideways step is a defect even while riding quickly.
        extra=Math.hypot(...s.center.map((v,j)=>v-prev.center[j]-(s.terrainCenter[j]-prev.terrainCenter[j])));
        assert.ok(extra<2,`handoff added ${extra}px to projected motion`);
      }
      if (i<shown) continue;
      const delta=s.camera.map((v,j)=>Math.abs(v-prev.camera[j]));
      assert.ok(Math.hypot(...delta.slice(0,3)) <= 2*step+1 &&
        delta[3]<1+step*.05 && delta[4]<1+step*.05,`visible camera step ${delta} for ${step} m`);
    }
    if(rate) assert.ok(frames[shown-1].d>5200 && frames.at(-1).d>frames[shown-1].d);
    t.diagnostic(`${held()} delayed DEM requests; checked ${frames.length} frames from seek; ${shown} on relief; handoff ${handoff.toFixed(2)}px (${extra.toFixed(2)}px beyond projected motion)`);
    assert.deepEqual(exceptions,[]);
  });
}
