// Optional real-engine integration: download the pinned public mapbox-gl.js
// and run MAPBOX_GL_215=/path/to/mapbox-gl.js node --test tests/preload.mjs.
// Offline fixtures use no account/config. The painted-viewport test additionally
// needs PAINT_RIDE_URL: the normally provisioned package served on loopback.
// It uses local synthetic rasters and the site's ordinary SDK session.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import {execFileSync} from 'node:child_process';
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
const coarseTile=png(Array(256).fill(Buffer.concat([Buffer.alloc(1),
  Buffer.alloc(256*3,Buffer.from([1,94,40]))])));

// Evaluate *inside render*, before GL discards its drawing buffer. This
// oracle knows only the fixture's paint colours; no tile IDs, cache state,
// production coverage function, or SDK layer order. Sample the full lens,
// including its perimeter. The ascent and its antialiased edge may replace
// green pixels. A sprinkle of edge pixels isn't a blank region, but even
// one largely empty local patch fails, not just a large average loss.
function makePaintProbe() {
  let buffer;
  return surface=>{
    const gl=surface===testMap.getCanvas() && testMap.painter.context.gl;
    const w=surface.width,h=surface.height;
    let px;
    if(gl) {
      if(buffer?.length!==4*w*h) buffer=new Uint8Array(4*w*h);
      gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,buffer); px=buffer;
    } else px=surface.getContext('2d').getImageData(0,0,w,h).data;
    let bad=0,worst=0,fine=0,coarse=0;
    for(let y=0;y<h;y+=16) for(let x=0;x<w;x+=16) {
      let n=0,miss=0;
      for(let j=y;j<Math.min(y+16,h);j+=2) for(let i=x;i<Math.min(x+16,w);i+=2) {
        const k=4*(j*w+i),r=px[k],g=px[k+1],b=px[k+2];
        n++;
        if(px[k+3]>245 && r<18 && Math.abs(b-40)<16 && Math.abs(g-154)<16) fine++;
        else if(px[k+3]>245 && r<18 && Math.abs(b-40)<16 && Math.abs(g-94)<16) coarse++;
        else if(!(px[k+3]>245 && r>=15 && g>=89 && g<=167 && b>=30 && b<=58)) miss++;
      }
      bad+=miss; worst=Math.max(worst,miss/n);
    }
    const total=Math.ceil(w/2)*Math.ceil(h/2);
    return {ok:w>0 && h>0 && fine+coarse>total*.75 && bad<total*.01 && worst<.45,
      fine,coarse,bad,worst};
  };
}
const seaLevelTile=png(Array(256).fill(Buffer.concat([Buffer.alloc(1),
  Buffer.alloc(256*3,Buffer.from([1,134,160]))])));
// At km 8.771 the rider is south of this Mercator boundary. Its northern
// neighbour is in the viewport but not under the rider.
function acrossBoundary(path) {
  const [, , z,,y]=path.split('/').map(Number);
  return y/2**z<365/1024;
}
const raisedTile = png(Array(256).fill(Buffer.concat([Buffer.alloc(1),
  Buffer.alloc(256*3,Buffer.from([1,189,80]))]))); // ~1,400 m instead of ~500 m
const coldBase = png(Array(256).fill(Buffer.concat([Buffer.alloc(1),
  Buffer.alloc(256*3,Buffer.from([1,183,116]))]))); // 1,250 m
const spikeRow=Buffer.concat([Buffer.alloc(1),Buffer.alloc(256*3,Buffer.from([3,247,160]))]);
const spikedTile=png(Array.from({length:256},(_,j)=>j>=96 && j<112 ? spikeRow : row));
// A 1,200 m east-west ridge ~450 m south of the rider at km 5.
// The camera and rider both stand outside this band on 500 m terrain.
function ridgeHeight(lon,lat) {
  const relief = 700*Math.min(1,Math.max(0,(.0032-Math.abs(lat-45.8128))/.0012));
  return 500+relief*Math.min(1,Math.max(0,(.003-Math.abs(lon-11.761))/.0015));
}
function elevationTile(path, heightAt=ridgeHeight) {
  const [, , z, x, y] = path.split('/');
  const rows = Array.from({length:256}, (_, j) => {
    const lat = Math.atan(Math.sinh(Math.PI*(1-2*(+y+(j+.5)/256)/2**z)))*180/Math.PI;
    const pixels = Buffer.alloc(769);
    for (let i=0;i<256;i++) {
      const lon = (+x+(i+.5)/256)/2**z*360-180;
      const height = heightAt(lon,lat);
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
    this.once('load',()=>{
      const proto=Object.getPrototypeOf(this.style._getSourceCache('sat')), preload=proto._preloadTiles;
      proto._preloadTiles=function(tr,done) {
        const pose=()=>JSON.stringify([testMap.getCenter(),testMap.getZoom(),testMap.getPitch(),testMap.getBearing()]);
        const before=pose(), batch={t:performance.now(),tiles:[],ready:testMap.areTilesLoaded(),zoom:tr.zoom};
        window.batch=batch; hints.push(batch);
        try { return preload.call(this,tr,(...args)=>{batch.end=performance.now();done(...args);}); }
        finally { batch.still=before===pose();window.batch=null; }
      };
    });
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
    // Optional real N45 E011 1-arcsecond raster, paired with the original
    // (not re-datumed) road GPX. Decode a small route-area crop once.
    let roadHeight;
    if (scenario==='real-road' || scenario==='ride-road') {
      const crop=execFileSync('python3',['-c',`from PIL import Image
import sys
im=Image.open(sys.argv[1])
assert im.size==(3600,3600) and im.tag_v2[33922][3:5]==(11.,46.)
sys.stdout.buffer.write(im.crop((2300,300,3300,900)).convert("I").convert("I;16").tobytes())`,
        process.env.KOTR_N45E011_TIF],{maxBuffer:2000000});
      roadHeight=(lon,lat)=>crop.readUInt16LE(2*(1000*Math.max(0,Math.min(599,Math.floor((46-lat)*3600)-300))
        +Math.max(0,Math.min(999,Math.floor((lon-11)*3600)-2300))));
    }
    let demGate, held = 0, coldDestination = false, missingSat=false, sat404s=0, northGate, missingNorth=false, dem404s=0, denied=0;
    const staggered=scenario==='preview-staggered';
    let absentPanorama=false;
    if (scenario==='preview-held' || staggered) demGate=Promise.withResolvers();
    let pendingDetail=0,cover404s=0;
    const outageFailures=new Set();
    let restoredReplies=0;
    let satGate=scenario==='slow' ? Promise.withResolvers() : null;
    const sdk = await readFile(process.env.MAPBOX_GL_215);
    assert.equal(createHash('sha256').update(sdk).digest('hex'),
      '302ee91531bc123693caa52eb74f71a2fb9ff61311f54d59ec3c04325dc5b2f7');
    const sourceGPX = await readFile(new URL('../assets/semonzo.gpx',import.meta.url));
    // Keep the synthetic camera fixture and its manifest hash in lockstep.
    // Production loaders still verify every byte; never bypass that check.
    const fixtureGPX = roadHeight ? sourceGPX : sourceGPX.toString().replace(
      /(<trkpt lon="([^"]+)" lat="([^"]+)"><ele>)([^<]+)/g,(_,tag,lon,lat,h)=>
        tag+((scenario==='cold' ? 1250 : ['ride','ridge'].includes(scenario) ? ridgeHeight(+lon,+lat) : 500)+h*.01));
    const hash = data => createHash('sha256').update(data).digest('hex');
    const server = createServer(async (req,res) => {
      const path = req.url;
      if (/^\/(sat|dem|cover)\//.test(path)) {
        if (scenario==='dem-denied' && path.startsWith('/dem/')) {
          denied++; res.writeHead(403).end(); return;
        }
        if (path.startsWith('/dem/') && missingNorth && acrossBoundary(path)) {
          dem404s++; res.writeHead(404).end(); return;
        }
        if (northGate && path.startsWith('/dem/') && acrossBoundary(path)) { held++; await northGate.promise; }
        if (path.startsWith('/sat/')) {
          const [, , z,x]=path.split('/').map(Number);
          if ((missingSat && scenario!=='opening' && (scenario==='outage' || z<15 || x%2)) || (scenario==='parent' && z>13) ||
              (scenario==='opening' && x/2**z<17455/2**15)) {
            sat404s++;
            if (scenario==='outage') outageFailures.add(path);
            res.writeHead(404).end(); return;
          }
          if (outageFailures.has(path)) restoredReplies++;
        }
        if (path.startsWith('/cover/') && missingSat) { cover404s++; res.writeHead(404).end(); return; }
        if (satGate && path.startsWith('/sat/')) {
          held++; pendingDetail++; await satGate.promise; pendingDetail--;
        }
        if (staggered && path.endsWith('?panorama')) {
          if (demGate) { held++; await demGate.promise; }
          if (absentPanorama) { res.writeHead(404).end(); return; }
        } else if (!staggered && demGate && path.startsWith('/dem/')) { held++; await demGate.promise; }
        await sleep(20);
        res.writeHead(200,{'Content-Type':'image/png','Cache-Control':['opening','cold','partial','dem-hole','outage'].includes(scenario)?'no-store':'public, max-age=3600'})
          .end(path.startsWith('/dem/') ? (roadHeight ? elevationTile(path,roadHeight) :
            ['ridge','ride'].includes(scenario) ? elevationTile(path) :
            scenario==='seam' && acrossBoundary(path) ? seaLevelTile :
            scenario==='spike' ? spikedTile : coldDestination ? raisedTile : scenario==='cold' ? coldBase : tile)
            : path.startsWith('/cover/') ? coarseTile : tile);
      } else if (path === '/sdk.js') res.end(Buffer.concat([sdk,Buffer.from('\n'+
        (staggered ? instrument.replace('return {url}',`return {url:url.includes('/dem/') && window.testMap?.getTerrain() ? url+'?panorama' : url}`) : instrument)+
        (['overview','preview-held'].includes(scenario) || staggered ? overviewProbe : '')+
        (['spike','preview-held'].includes(scenario) || staggered ? corruptPreviewProbe : ''))]));
      // Only SDK layout rules needed by the local fixture (no CDN requests).
      else if (path === '/sdk.css') res.writeHead(200,{'Content-Type':'text/css'}).end(
        '.mapboxgl-map{overflow:hidden}.mapboxgl-canvas,.mapboxgl-marker{position:absolute;top:0;left:0}');
      else if (path === '/js/config.js') res.end('window.KOTR_CONFIG={}');
      else if (path === '/' || /^\/assets\/(flyover\.js|terrain\.js|semonzo\.gpx)$/.test(path) ||
          /^\/js\/(semonzo-profile|example-catalog|route-catalog|route-analysis)\.mjs$/.test(path)) {
        let body = await readFile(new URL('..'+(path==='/'?'/index.html':path),import.meta.url));
        // Keep the real route geometry; give its test GPX a vertical datum
        // consistent with the synthetic DEM used for the camera experiments.
        if (path.endsWith('.gpx')) body=fixtureGPX;
        if (path === '/js/example-catalog.mjs') body=body.toString().replace(hash(sourceGPX),hash(fixtureGPX));
        if (path.endsWith('.mjs')) res.setHeader('Content-Type','text/javascript');
        if (path.endsWith('terrain.js')) body = body.toString().replace('https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl','/sdk');
        // Drive only the player's RAF deterministically; the SDK keeps its
        // own render loop and its normal terrain/DOM update schedule.
        if (['ride','ride-road'].includes(scenario) && path.endsWith('flyover.js')) body = body.toString().replaceAll('requestAnimationFrame(tick)','(window.stepRide=tick,0)');
        res.end(body);
      } else res.writeHead(404).end();
    });
    server.listen(0,'127.0.0.1'); await once(server,'listening');
    t.after(() => {server.closeAllConnections();server.close();});
    const origin=`http://127.0.0.1:${server.address().port}`;
    // The pinned SDK's testMode silences auth errors; it doesn't guarantee
    // that a tokenless renderer will keep painting. Use the existing site's
    // normal loopback page/session for optical proof. Never inspect config,
    // intercept session requests or change SDK auth behaviour.
    let url=origin+'/', opticalSDK;
    if(scenario==='opening') {
      const live=new URL(process.env.PAINT_RIDE_URL);
      assert.ok(live.protocol==='http:' && ['localhost','127.0.0.1'].includes(live.hostname) &&
        !live.search && !live.hash && !live.username && !live.password);
      url=live.href;
      server.prependListener('request',(req,res)=>res.setHeader('Access-Control-Allow-Origin',live.origin));
      const localStyle=instrument.replace('testMode:true,','')
        .replace('return super.addSource(id,src)',`if(id==='sat-cover') src={...src,tiles:[location.origin+'/cover/{z}/{x}/{y}']};
          return super.addSource(id,src)`).replaceAll('location.origin',JSON.stringify(origin));
      opticalSDK=Buffer.concat([sdk,Buffer.from('\n'+localStyle)]).toString('base64');
    }
    const {cmd,js,exceptions} = await browser(t,(m,send)=>{
      if(m.method==='Fetch.requestPaused') send('Fetch.fulfillRequest',{requestId:m.params.requestId,
        responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:opticalSDK});
    });
    await cmd('Network.enable');
    if(opticalSDK) await cmd('Fetch.enable',{patterns:[{urlPattern:'https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js'}]});
    else await cmd('Network.setBlockedURLs',{urls:['https://*']});
    const slow=scenario==='slow';
    await cmd('Emulation.setDeviceMetricsOverride',{width:slow?1280:375,height:812,deviceScaleFactor:1,mobile:!slow});
    await cmd('Page.navigate',{url});
    if (slow || scenario==='preview-held' || staggered) await until(()=>js(`document.querySelector('#deck')?.hidden===false`));
    else await until(()=>js(`document.querySelector('#message')?.textContent.startsWith('Satellite overview ·')`));
    return {js,cmd,exceptions,failPanorama:()=>{absentPanorama=true;},holdSat:()=>{satGate=Promise.withResolvers();},dropSat:()=>{missingSat=true;},
      releaseSat:()=>{satGate?.resolve();satGate=null;},pendingDetail:()=>pendingDetail,cover404s:()=>cover404s,
      restoreSat:()=>{missingSat=false;},sat404s:()=>sat404s,restoredReplies:()=>restoredReplies,denied:()=>denied,
      holdNorth:()=>{northGate=Promise.withResolvers();}, dropNorth:()=>{missingNorth=true;},dem404s:()=>dem404s,
      hold:()=>{demGate=Promise.withResolvers();coldDestination=true;},held:()=>held,
      release:()=>{demGate?.resolve();demGate=null;satGate?.resolve();satGate=null;northGate?.resolve();northGate=null;}};
}

// Inspect the SDK's establishing camera, selected tiles and rendered features at
// reveal. The fixture has local tiles, not a live authenticated basemap.
const overviewProbe=`
// One delayed SDK frame queue, not a delayed readiness assertion. Source
// workers and the UI remain live over the last photographed surface.
mapboxgl.Map=class extends mapboxgl.Map {
  _render(...args){
    if(window.delayPreviewFrames && this.getTerrain()?.exaggeration===1.25){
      if(!window.frameDelayStarted){
        window.frameDelayStarted=performance.now();
        setTimeout(()=>{window.delayPreviewFrames=false;this.triggerRepaint()},9000);
      }
      return;
    }
    return super._render(...args);
  }
};
window.overviewDraw=()=>{
  if(map.getAttribute('aria-busy')!=='false' || !testMap.getTerrain() || testMap.getPitch()<45) return;
  const tr=testMap.transform.elevation,caches=['sat','sat-cover'].map(s=>testMap.style._getSourceCache(s));
  return {imagery:tr.proxyCoords.length>0 && tr.proxyCoords.every(id=>tr.terrainTileForTile[id.key]?.dem &&
    caches.some(cache=>tr.proxyToSource[id.key]?.[cache.id]?.some(t=>cache.getTile(t)?.texture))),
    route:testMap.queryRenderedFeatures({layers:['ascent']}).length>0,
    color:testMap.getPaintProperty('ascent','line-color'),fade:testMap.getPaintProperty('sat','raster-fade-duration')};
};`;
// Sample after all render handlers have gated this draw, before composite.
const corruptPreviewProbe=`
window.corruptOpening={mesh:0,flat:0,gaps:0};
mapboxgl.Map=class extends mapboxgl.Map {
  constructor(options){super(options);this.on('render',()=>queueMicrotask(()=>{
    if(mode.textContent!=='Route overview' || map.querySelector('.orbit-hold')) return;
    if(getComputedStyle(map).visibility==='visible') corruptOpening[this.transform.elevation?'mesh':'flat']++;
    else if(corruptOpening.flat) corruptOpening.gaps++;
  }))}
};`;

test('opening terrain has bound DEM, raster textures and rendered ascent on cold load and repeated resets',
  {skip:!process.env.MAPBOX_GL_215,timeout:30000}, async t=>{
    const {js,exceptions}=await fixture(t,'overview');
    assert.equal(await js(`testMap.getTerrain().exaggeration`),1.25);
    for(let i=0;i<3;i++){
      const reveal=await until(()=>js(`overviewDraw()`));
      assert.deepEqual(reveal,{imagery:true,route:true,color:'#ff932e',fade:0});
      if(i===2) break;
      await js(i ? `seek.value=5200; seek.dispatchEvent(new Event('input'))` : 'play.click()');
      await until(()=>js(`testMap.getTerrain()?.source==='dem' && map.getAttribute('aria-busy')==='false'`));
      assert.equal(await js(`testMap.getTerrain().exaggeration`),1);
      await js(`reset.click(); reset.click()`);
    }
    assert.equal(await js('testMap.getTerrain().exaggeration'),1.25);
    assert.deepEqual(exceptions,[]);
  });

for (const throttle of [1,4]) test(`held opening DEM restores a verified panorama at zero (${throttle}x CPU slowdown)`,
  {skip:!process.env.MAPBOX_GL_215,timeout:60000},async t=>{
    const {js,cmd,held,release,exceptions}=await fixture(t,'preview-held');
    t.after(release);
    await cmd('Emulation.setCPUThrottlingRate',{rate:throttle});
    await until(()=>held()>0);
    await sleep(9000); // beyond BOTH original deadlines, even with ready imagery
    await until(()=>js(`message.textContent.includes('Flat imagery without terrain relief')`));
    assert.ok(await js(`corruptOpening.flat>0 && !corruptOpening.mesh && +seek.value===0`));
    const waiting=held(); await sleep(700);
    assert.equal(held(),waiting,'no ongoing DEM retries during flat orbit');
    if (throttle>1) await js(`window.delayPreviewFrames=true`);
    const before=Date.now(); release();
    if (throttle>1) {
      await until(()=>js(`window.frameDelayStarted`));
      await sleep(8200);
      assert.ok(await js(`!corruptOpening.mesh && !!map.querySelector('.orbit-hold')`));
    }
    for(let i=0;i<120 && !await js(`message.textContent.includes('Mountain terrain')`);i++) await sleep(100);
    assert.deepEqual(await js(`overviewDraw()`),{imagery:true,route:true,color:'#ff932e',fade:0});
    assert.deepEqual(await js(`[testMap.transform.elevation.exaggeration(),+seek.value,mode.textContent]`),
      [1.25,0,'Route overview']);
    const bearing=await js(`testMap.getBearing()`);
    await until(()=>js(`!map.querySelector('.orbit-hold') && Math.abs(testMap.getBearing() - (${bearing}))>.02`));
    assert.ok(await js(`corruptOpening.mesh>0 && !corruptOpening.gaps && +seek.value===0`));
    t.diagnostic(`Verified relief ${Date.now()-before} ms after release; ${held()} held requests`);
    assert.deepEqual(exceptions,[]);
  });

for (const outcome of ['late valid tiles','settled outage','Play supersedes']) test(`covered panorama after remount deadline: ${outcome}`,
  {skip:!process.env.MAPBOX_GL_215,timeout:95000},async t=>{
    const {js,cmd,release,failPanorama,held,exceptions}=await fixture(t,'preview-staggered');
    t.after(release);
    await cmd('Emulation.setCPUThrottlingRate',{rate:4});
    // SDK preload requests complete normally. All visible panorama DEM
    // requests, including those issued at remount, stay unanswered.
    for(let i=0;i<200 && !await js(`window.corruptOpening?.flat && testMap.getTerrain() &&
      map.querySelector('.orbit-hold')!==null`);i++) await sleep(100);
    assert.ok(await js(`corruptOpening.flat && testMap.getTerrain()?.exaggeration===1.25`),
      JSON.stringify(await js(`({message:message.textContent,draws:corruptOpening,held:!!map.querySelector('.orbit-hold'),
        elevations:visits.filter(t=>t.url.includes('/dem/')).map(t=>t.url.slice(t.url.indexOf('/dem/')))})`)));
    await js(`window.renders=0;window.mounts=0;const original=testMap.setTerrain;
      testMap.setTerrain=function(...args){mounts++;return original.apply(this,args)};
      testMap.on('render',()=>renders++);void 0`);
    await sleep(31500);
    const quiet=await js(`[renders,visits.length,mounts]`), outstanding=held();
    await sleep(1500);
    assert.deepEqual(await js(`[renders,visits.length,mounts]`),quiet,'no paint, camera or request retry loop');
    assert.equal(held(),outstanding);
    assert.ok(await js(`mounts===0 && corruptOpening.mesh===0 && !corruptOpening.gaps &&
      !!map.querySelector('.orbit-hold') && +seek.value===0`),'verified flat still, original in-flight panorama');
    if (outcome==='Play supersedes') {
      await js(`play.click()`);
      await until(()=>js(`+seek.value>0 && testMap.getTerrain()?.exaggeration!==1.25`));
      release();
      await sleep(600);
      assert.ok(await js(`document.getElementById('preview-motion').hidden &&
        testMap.getTerrain()?.exaggeration!==1.25 && +seek.value>0`));
    } else if (outcome==='settled outage') {
      failPanorama(); release();
      await until(()=>js(`!testMap.getTerrain() && !map.querySelector('.orbit-hold') && mounts===1`)).catch(async err=>{
        throw Error(JSON.stringify(await js(`({mounts,renders,draws:corruptOpening,held:!!map.querySelector('.orbit-hold'),
          message:message.textContent,settled:testMap.areTilesLoaded(),states:Object.values(
            testMap.style._getSourceCache('dem')._tiles).map(t=>t.state)})`)),{cause:err});
      });
      await sleep(800);
      assert.ok(await js(`mounts===1 && !corruptOpening.mesh && !corruptOpening.gaps`));
    } else {
      await cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      await until(()=>js(`document.getElementById('preview-motion').textContent==='Resume preview'`));
      release();
      await until(()=>js(`testMap.areTilesLoaded()`));
      assert.ok(await js(`!!map.querySelector('.orbit-hold') && !corruptOpening.mesh && !mounts`));
      await cmd('Emulation.setEmulatedMedia',{features:[]});
      await until(()=>js(`corruptOpening.mesh && overviewDraw()?.imagery && overviewDraw()?.route`));
      assert.ok(await js(`mounts===0 && !corruptOpening.gaps && +seek.value===0 &&
        testMap.transform.elevation.exaggeration()===1.25`));
    }
    t.diagnostic(`Suspended counts [renders,requests,terrain writes]: ${quiet}; held requests: ${outstanding}`);
    assert.deepEqual(exceptions,[]);
  });

test('seek and reset supersede a pending opening DEM batch',
  {skip:!process.env.MAPBOX_GL_215,timeout:45000},async t=>{
    const {js,held,release,exceptions}=await fixture(t,'preview-held');
    t.after(release);
    await until(()=>held()>0);
    await sleep(9000);
    await until(()=>js(`message.textContent.includes('Flat imagery without terrain relief')`));
    await js(`reset.click();seek.value=5200;seek.dispatchEvent(new Event('input'))`);
    release();
    await until(()=>js(`map.getAttribute('aria-busy')==='false' && mode.textContent==='Paused'`));
    await sleep(600);
    assert.ok(await js(`+seek.value===5200 && !message.textContent.includes('overview') &&
      testMap.getTerrain()?.exaggeration!==1.25`));
    await js(`reset.click()`);
    await until(()=>js(`overviewDraw()?.imagery && mode.textContent==='Route overview' && +seek.value===0`));
    assert.deepEqual(exceptions,[]);
  });

test('orbit moves its viewpoint without riding, suspends in place, and yields immediately to Play',
  {skip:!process.env.MAPBOX_GL_215,timeout:30000}, async t=>{
    const {js,cmd,exceptions}=await fixture(t,'overview');
    await js(`window.motion=document.getElementById('preview-motion');
      window.pose=()=>[testMap.getCenter().lng,testMap.getCenter().lat,testMap.getBearing()];
      window.initial=pose()`);
    const moved=()=>until(()=>js(`Math.abs(pose()[2]-initial[2])>.25 && pose()[0]!==initial[0]`));
    const still=async(expectedHints=0)=>{
      const held=await js(`pose()`);
      await sleep(220);
      assert.deepEqual(await js(`pose()`),held);
      assert.deepEqual(await js(`[+seek.value,!!testMap.getTerrain(),hints.length]`),[0,true,expectedHints]);
    };
    await moved();
    await js('motion.click()'); await still();
    await js('initial=pose(); motion.click()'); await moved();
    await js(`Object.defineProperty(document,'hidden',{value:true,configurable:true});
      document.dispatchEvent(new Event('visibilitychange'))`); await still();
    await js(`initial=pose(); delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))`);
    await moved();
    await cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await until(()=>js(`motion.textContent==='Resume preview'`)); await still();
    assert.deepEqual(await js(`play.click();[motion.hidden,+seek.value,mode.textContent,
      beacon.getLngLat().toArray()]`),[true,0,'Buffering',[11.770429,45.813215]]);
    await until(()=>js(`+seek.value>5`));
    const rideHints=await js('const count=hints.length;reset.click();count');
    await still(rideHints);
    await js('initial=pose();motion.click()'); await moved();
    assert.equal(await js('hints.length'),rideHints,'returning to a moving preview issues no new ride hints');
    // A cold entry with the preference already enabled must not require a
    // change event or an initial token frame of animation to become still.
    await cmd('Page.reload',{ignoreCache:true});
    await until(()=>js(`typeof overviewDraw==='function' && overviewDraw() &&
      document.getElementById('preview-motion').textContent==='Resume preview'`));
    const cold=await js(`testMap.getBearing()`);
    await sleep(220);
    assert.equal(await js(`testMap.getBearing()`),cold);
    assert.deepEqual(exceptions,[]);
  });

for (const failure of ['spike','seam','timeout']) test(`3D ${failure} switches to a gated same-distance flat ride`,
  {skip:!process.env.MAPBOX_GL_215,timeout:40000},async t=>{
    const {js,hold,release,exceptions}=await fixture(t,failure);
    if(failure==='spike') assert.ok(await js(`corruptOpening.mesh===0 && corruptOpening.flat>0 &&
      message.textContent.includes('Flat imagery without terrain relief')`),'no live spike on any opening draw');
    if(failure==='timeout') {
      hold();t.after(release);
      await js(`testMap.style._getSourceCache('dem').clearTiles();
        const dem=testMap.getSource('dem');dem.setTiles(dem.tiles);void 0`);
    }
    const gated=await js(`window.unsafe=false;
      testMap.on('render',()=>{if(testMap.getTerrain() && map.getAttribute('aria-busy')==='false') unsafe=true;});
      seek.value=${failure==='seam'?8771:0};seek.dispatchEvent(new Event('input'));
      ${failure==='seam'?'':'play.click();'}
      map.getAttribute('aria-busy')==='true' && (${failure==='seam'} || mode.textContent==='Buffering')`);
    assert.ok(gated);
    await until(()=>js(`message.textContent.startsWith('Flat satellite ride')`)).catch(async err=>{
      throw Error(JSON.stringify(await js(`({msg:message.textContent,d:+seek.value,
        tiles:testMap.transform.elevation?.visibleDemTiles?.map(t=>[t.tileID.canonical,t.dem.get(0,0)])})`)),{cause:err});
    });
    assert.ok(await js(`!unsafe && !play.disabled && !seek.disabled && !testMap.getTerrain()
      && testMap.getPitch()>=32 && map.getAttribute('aria-busy')==='false' && testMap.queryRenderedFeatures({layers:['ascent']}).length>0`));
    if(failure==='seam') {
      assert.equal(await js('+seek.value'),8771);
      await js('play.click()');
    }
    await until(()=>js(`+seek.value>${failure==='seam'?8771:0} && mode.textContent==='Flat satellite ride'`));
    await js(`seek.value=5200;seek.dispatchEvent(new Event('input'))`);
    assert.ok(await js(`+seek.value===5200 && mode.textContent==='Paused' && !testMap.getTerrain()`));
    assert.deepEqual(exceptions,[]);
  });

test('DEM-only 403 at 8771 m preserves Play and reveals a mesh-free satellite shot at that metre',
  {skip:!process.env.MAPBOX_GL_215,timeout:30000},async t=>{
    const {js,denied,exceptions}=await fixture(t,'dem-denied');
    await js(`window.shown=[];testMap.on('render',()=>{
      if(map.getAttribute('aria-busy')==='false') shown.push({d:+seek.value,mesh:!!testMap.getTerrain()});
    });seek.value=8771; seek.dispatchEvent(new Event('input')); play.click()`);
    await until(()=>js(`+seek.value>8780 && mode.textContent==='Flat satellite ride'`));
    assert.ok(denied()>0);
    assert.ok(await js(`shown[0]?.d===8771 && shown.every(s=>!s.mesh) && testMap.getPitch()>32 &&
      play.textContent==='Pause' && !seek.disabled && testMap.queryRenderedFeatures({layers:['ascent']}).length>0`));
    assert.deepEqual(exceptions,[]);
  });

for (const restoreAt of [1200,7000,null]) test(`satellite outage at 5200 m: ${restoreAt?`network restored at ${restoreAt} ms resumes Play`:'non-sliding deadline preserves profile'}`,
  {skip:!process.env.MAPBOX_GL_215,timeout:35000},async t=>{
    const {js,dropSat,restoreSat,sat404s,restoredReplies,exceptions}=await fixture(t,'outage');
    dropSat();
    await js(`window.retries=0;window.reveals=[];window.flatStart=null;
      new MutationObserver(()=>{
        if (flatStart===null && !testMap.getTerrain() && map.getAttribute('aria-busy')==='true')
          flatStart=performance.now();
      }).observe(message,{childList:true});
      testMap.on('render',()=>{
        if(getComputedStyle(map).visibility==='visible') reveals.push({d:+seek.value,ms:performance.now()-flatStart});
      });
      for(const id of ['sat','sat-cover']) {
        const cache=testMap.style._getSourceCache(id),reload=cache._reloadTile;
        cache._reloadTile=function(key,state){
          if (state==='loading' && this._tiles[key]?.state==='errored') retries++;
          return reload.call(this,key,state);
        };
        cache.clearTiles();
      }
      seek.value=5200;seek.dispatchEvent(new Event('input'));play.click()`);
    await until(()=>js(`!testMap.getTerrain() && message.textContent==='Loading flat satellite ride…'`));
    const initial=sat404s();
    assert.ok(initial>0);
    assert.ok(await js('flatStart!==null'));
    await sleep(Math.max(0,(restoreAt ?? 7000)-await js('performance.now()-flatStart')));
    if(restoreAt) {
      assert.ok(await js(`+seek.value===5200 && play.textContent==='Pause' && reveals.length===0`));
      restoreSat();
      await until(()=>js(`+seek.value>5200 && map.getAttribute('aria-busy')==='false'`));
      const first=await js('reveals[0]');
      assert.equal(first.d,5200);
      assert.ok(first.ms>=restoreAt && first.ms<8000,`first reveal at ${first.ms} ms`);
      t.diagnostic(`first visible frame: ${first.d} m at ${Math.round(first.ms)} ms; playback advanced`);
      assert.ok(restoredReplies()>0,'SDK requested previously failed imagery after network restoration');
    } else {
      assert.ok(await js(`mode.textContent==='Buffering' && +seek.value===5200`));
      await sleep(1200);
      assert.ok(await js(`+seek.value===5200 && !seek.disabled && play.disabled &&
        map.parentElement.hidden && mode.textContent==='Elevation profile' &&
        message.textContent.includes('Use the elevation profile') && reveals.length===0`));
      await js(`seek.value=5300;seek.dispatchEvent(new Event('input'))`);
      assert.ok(await js(`stats.textContent.includes('5.3 km ridden')`));
      // Initial viewport and parent discovery can still be in flight when
      // the flat wait starts. Count deliberate re-requests independently.
      const retries=await js('retries');
      assert.ok(retries>0 && retries<=24,`${retries} retries`);
      assert.ok(sat404s()>initial && sat404s()<=128,`${sat404s()} total outage requests`);
      t.diagnostic(`${retries} retries; ${sat404s()} total failed satellite requests`);
      restoreSat();
      await js(`retry.click()`);
      await until(()=>js(`+seek.value===5300 && mode.textContent==='Paused' && !play.disabled &&
        retry.hidden && !map.parentElement.hidden && map.getAttribute('aria-busy')==='false'`));
      await js('play.click()');
      await until(()=>js('+seek.value>5300'));
    }
    assert.deepEqual(exceptions,[]);
  });

test('warm Play with late local image decode retires the wait, not the pending textured draw',
  {skip:!process.env.MAPBOX_GL_215,timeout:35000},async t=>{
    const {js,cmd,exceptions}=await fixture(t,'overview');
    // Warm HTTP assets, fresh map. Hold image *decodes*, not HTTP, SDK
    // rendering or the player clock. Old flatExpired removed this map.
    await cmd('Page.enable');
    await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`{
      const bitmap=window.createImageBitmap.bind(window);
      window.decodeGate=Promise.withResolvers();window.decodes=0;
      window.createImageBitmap=async(...args)=>{const image=await bitmap(...args);
        decodes++;await decodeGate.promise;return image};
    }`});
    await cmd('Page.reload',{ignoreCache:false});
    await until(()=>js(`window.decodeGate && document.querySelector('#deck')?.hidden===false`));
    await js(`map.scrollIntoView({block:'center'});play.click()`);
    await until(()=>js(`decodes && message.textContent.startsWith('Loading flat satellite')`));
    await js(`window.originalMap=testMap;window.size=[map.clientWidth,map.clientHeight];
      window.first=null;testMap.on('render',()=>{
        if(!first && map.getAttribute('aria-busy')==='false'){
          const p=testMap.project(beacon.getLngLat()),poly=map.querySelector('svg polyline');
          first={d:+seek.value,road:testMap.queryRenderedFeatures(p,{layers:['ascent']}).length,
            local:poly?.points.numberOfItems,opacity:+getComputedStyle(beacon.getElement()).opacity,
            texture:['sat','sat-cover'].some(id=>{const c=testMap.style._getSourceCache(id);
              return c.getRenderableIds().some(key=>!!c.getTileByID(key).texture)})};
        }
      });void 0`);
    await sleep(8300);
    assert.ok(await js(`mode.textContent==='Elevation profile' && !retry.hidden && !play.disabled &&
      +seek.value===0 && !first && map.parentElement.clientHeight===0 &&
      size[0]===map.clientWidth && size[1]===map.clientHeight`));
    await js('decodeGate.resolve()');
    await until(()=>js(`+seek.value>0 && retry.hidden && first && map.getAttribute('aria-busy')==='false'`));
    assert.ok(await js(`first.d===0 && first.road && first.local>1 && first.texture && first.opacity===1 &&
      testMap===originalMap && map.parentElement.clientHeight===map.clientHeight`));
    assert.deepEqual(exceptions,[]);
  });

test('flat recovery holds while ascent cannot render, resumes on actual coverage',
  {skip:!process.env.MAPBOX_GL_215,timeout:32000},async t=>{
    const {js,exceptions}=await fixture(t,'spike');
    await js(`window.original=testMap.getSource('ascent')._data;
      testMap.getSource('ascent').setData({type:'FeatureCollection',features:[]});
      play.click()`);
    await until(()=>js(`!testMap.getTerrain() && !testMap.queryRenderedFeatures({layers:['ascent']}).length &&
      message.textContent==='Preparing rider view…'`));
    await js(`window.contentTimes=[]; window.tileTimes=[];
      testMap.on('sourcedata',e=>{
        if(e.sourceId!=='sat') return;
        if(e.sourceDataType==='content') contentTimes.push(performance.now());
        if(e.tile) tileTimes.push(performance.now());
      });

      const sat=testMap.getSource('sat');
      window.reload=setInterval(()=>{
        if(map.parentElement.hidden) {clearInterval(reload); return;}
        sat.setTiles(sat.tiles);
      },1000)`);
    await until(()=>js(`contentTimes.length && tileTimes.length`));
    assert.ok(await js(`+seek.value===0 && mode.textContent==='Buffering' && map.getAttribute('aria-busy')==='true'`));
    await js(`clearInterval(reload);testMap.getSource('ascent').setData(original);void 0`);
    await until(()=>js(`+seek.value>0 && mode.textContent==='Flat satellite ride'`));
    assert.deepEqual(exceptions,[]);
  });

test('delayed DEM prepares during moving flat playback, promotes once usable; corruption stays flat',
  {skip:!process.env.MAPBOX_GL_215,timeout:40000},async t=>{
    const {js,hold,release,held,exceptions}=await fixture(t,'cold');
    hold(); t.after(release);
    await js(`testMap.style._getSourceCache('dem').clearTiles();
      const dem=testMap.getSource('dem');dem.setTiles(dem.tiles);
      seek.value=5200;seek.dispatchEvent(new Event('input'));play.click()`);
    await until(()=>js(`mode.textContent==='Flat satellite ride' && +seek.value>5200`));
    const a=await js('+seek.value');
    await sleep(1750);
    const b=await js('+seek.value');
    assert.ok(held()>0 && b>a+50,'missing DEM must not hold the satellite ride');
    release();
    await until(()=>js(`mode.textContent==='Cinematic flyover' && !!testMap.getTerrain() &&
      map.getAttribute('aria-busy')==='false' && +seek.value>${b}`));
    await js(`window.unsafeShows=0;
      testMap.fire('sourcedata',{sourceId:'dem',tile:{tileID:{canonical:{z:14}},dem:{dim:1,get:()=>9900}}});
      testMap.on('render',()=>{if (testMap.getTerrain() && map.getAttribute('aria-busy')==='false') unsafeShows++});void 0`);
    await until(()=>js(`mode.textContent==='Flat satellite ride'`));
    const c=await js('+seek.value');
    await sleep(3500);
    assert.ok(await js(`!testMap.getTerrain() && unsafeShows===0 && +seek.value>${c}+100`));
    assert.deepEqual(exceptions,[]);
  });

test('Play retains the painted orbit until the 0 m road draw; promotion never paints a neutral viewport',
  {skip:!process.env.MAPBOX_GL_215,timeout:30000},async t=>{
    const {js,exceptions}=await fixture(t,'overview');
    await js(`window.road=testMap.getSource('ascent');window.saved=road._data;
      road.setData({type:'FeatureCollection',features:[]});void 0`);
    await until(()=>js(`!!map.querySelector('.orbit-hold')`));
    const start=await js(`window.hold=map.querySelector('.orbit-hold');
      window.original=hold.toDataURL();window.frames=[];
      window.audit=()=>{const held=map.querySelector('.orbit-hold');
        frames.push({d:+seek.value,live:getComputedStyle(map).visibility==='visible',
          held:!!held && getComputedStyle(held).visibility==='visible',
          mesh:!!testMap.getTerrain(),mode:mode.textContent,pitch:testMap.getPitch(),blend:!!map.querySelector('.mesh-dissolve')})};
      testMap.on('render',audit);play.click();audit();
      [play.textContent,map.parentElement.classList.contains('departing'),frames.at(-1).held]`);
    assert.deepEqual(start,['Pause',true,true]);
    await sleep(350);
    assert.ok(await js(`hold.isConnected && hold.toDataURL()===original && +seek.value===0`));
    await js(`road.setData(saved);void 0`);
    await until(()=>js(`+seek.value>0 && mode.textContent==='Cinematic flyover'`));
    assert.ok(await js(`frames.every(f=>f.live || f.held) &&
      frames.find(f=>f.live)?.d===0 && frames.find(f=>f.live)?.mesh===false &&
      frames.some(f=>f.live && !f.mesh && f.d>0) &&
      frames.filter(f=>f.d>0).every(f=>f.mode!=='Buffering') &&
      frames.find(f=>f.live && f.mesh)?.pitch>30 && frames.some(f=>f.mesh && f.live && f.blend)`));
    assert.deepEqual(exceptions,[]);
  });

test('opening flat ride keeps visible road and imagery while new tiles and promotion are held',
  {skip:!process.env.MAPBOX_GL_215 || (!process.env.PAINT_RIDE_URL && 'requires the normal loopback package session'),timeout:45000},async t=>{
    const {js,hold,holdSat,releaseSat,pendingDetail,release,dropSat,cover404s,exceptions}=await fixture(t,'opening');
    hold(); t.after(release);
    await js(`map.scrollIntoView({block:'center'});const painted=(${makePaintProbe})();window.frames=[];window.audit=()=>{
      const live=getComputedStyle(map).visibility==='visible', hold=map.querySelector('.orbit-hold');
      const surface=live ? testMap.getCanvas() : hold && getComputedStyle(hold).visibility==='visible' && hold;
      const p=testMap.project(beacon.getLngLat()), m=map.getBoundingClientRect(), b=beacon.getElement().getBoundingClientRect();
      frames.push({d:+seek.value,live,paint:surface && painted(surface),mesh:!!testMap.getTerrain(),
        pitch:testMap.getPitch(),center:testMap.getCenter().toArray(),road:!!testMap.queryRenderedFeatures(p,{layers:['ascent']}).length,
        marker:+getComputedStyle(beacon.getElement()).opacity===1 &&
          Math.hypot(b.x+b.width/2-m.x-p.x,b.y+b.height/2-m.y-p.y)<1.6});
    };testMap.on('render',audit);play.click()`);
    await until(()=>js(`mode.textContent==='Flat satellite ride' && +seek.value>0`));
    holdSat();
    // Drop detail, not the verified coarse draw. This exercises an actual
    // outstanding request and a coarse-only interval on every run, not just
    // the possibility of a request if the camera happens to cross a tile.
    await js(`const detail=testMap.getSource('sat');testMap.style._getSourceCache('sat').clearTiles();
      detail.setTiles(detail.tiles);void 0`);
    await until(()=>pendingDetail()>0);
    await until(()=>js(`+seek.value>=140`));
    releaseSat();
    await until(()=>js(`+seek.value>=350`));
    const frames=await js(`testMap.off('render',audit);frames`);
    const rides=frames.filter(f=>f.live), first=rides[0], last=rides.at(-1);
    assert.equal(first?.d,0);
    assert.ok(last.d>=340 && last.center.some((v,i)=>Math.abs(v-first.center[i])>.0001));
    const bad=frames.find(f=>!f.paint?.ok || (f.live && (f.mesh || !f.road || !f.marker || f.pitch<32)));
    assert.ok(!bad,JSON.stringify(bad));
    const mixed=rides.filter(f=>f.paint.fine>100 && f.paint.coarse>100);
    assert.ok(mixed.length,'fine detail and coarse cover should both reach the screen');
    const coarse=rides.filter(f=>f.paint.fine===0 && f.paint.coarse>100);
    assert.ok(coarse.length,'coarse-only draw must remain visible during detail reload');
    t.diagnostic(`${rides.length} verified ride draws: ${mixed.length} mixed, ${coarse.length} coarse-only`);
    assert.ok(await js(`play.textContent==='Pause' && mode.textContent==='Flat satellite ride'`));
    // At the same lens now fail the coarse requests as well, leaving only
    // the fine half of the lens. Inspect GL behind the hold, not the held
    // canvas: the very same paint classifier must see and reject the hole.
    await js('play.click()');
    dropSat(); release();
    await js(`window.hole=null;testMap.on('render',()=>{
      if(hole || testMap.getTerrain())return;
      const sample=painted(testMap.getCanvas());
      if(sample.fine>100 && !sample.ok && sample.worst>.5)
        hole={...sample,live:getComputedStyle(map).visibility==='visible'};
    });
    const cover=testMap.getSource('sat-cover');
    testMap.style._getSourceCache('sat-cover').clearTiles();cover.setTiles(cover.tiles);void 0`);
    await until(()=>cover404s()>0);
    const hole=await until(()=>js('hole'));
    assert.equal(hole.live,false,JSON.stringify(hole));
    t.diagnostic(`paint control rejected ${hole.bad} missing samples alongside ${hole.fine} textured`);
    assert.deepEqual(exceptions,[]);
  });

test('mesh-free Play follows the changing ridge corridor, not just the seek bearing',
  {skip:!process.env.MAPBOX_GL_215,timeout:30000},async t=>{
    const {js,exceptions}=await fixture(t,'spike');
    await js(`seek.value=3950;seek.dispatchEvent(new Event('input'));speed.value='4';play.click()`);
    await until(()=>js(`mode.textContent==='Flat satellite ride'`));
    const samples=[];
    do {
      await sleep(120);
      samples.push(await js(`({b:testMap.getBearing(),d:+seek.value,flat:!testMap.getTerrain()})`));
    } while (samples.at(-1).d<7000);
    const turns=samples.slice(1).map((s,i)=>((s.b-samples[i].b+540)%360)-180);
    assert.ok(samples.every(s=>s.flat));
    const net=turns.reduce((sum,t)=>sum+t,0), travel=turns.reduce((sum,t)=>sum+Math.abs(t),0);
    assert.ok(net>25 && net<70 && travel-net>3 && travel<105,
      `follow the broad ridge and ease through its counterturn: net ${net}, total ${travel} degrees`);
    assert.ok(turns.every((t,i)=>Math.abs(t)<.13*(samples[i+1].d-samples[i].d)+2),'no sudden yaw cut');
    assert.deepEqual(exceptions,[]);
  });

test('established 3D and flat rides hide a lost road on that paint, and resume at the held distance',
  {skip:!process.env.MAPBOX_GL_215,timeout:30000},async t=>{
    const {js,exceptions}=await fixture(t);
    await js(`seek.value=5200;seek.dispatchEvent(new Event('input'));play.click()`);
    await until(()=>js(`+seek.value>5210 && mode.textContent==='Cinematic flyover'`));
    for (const flat of [false,true]) {
      if (flat) {
        await js(`testMap.fire('sourcedata',{sourceId:'dem',tile:{tileID:{canonical:{z:14}},dem:{dim:1,get:()=>9900}}});void 0`);
        await until(()=>js(`mode.textContent==='Flat satellite ride'`));
      }
      await js(`window.roadSource=testMap.getSource('ascent');window.savedRoad=roadSource._data;
        window.noRoad=[];window.watchRoad=()=>{
          if(!testMap.queryRenderedFeatures({layers:['ascent']}).length)
            noRoad.push({d:+seek.value,hidden:getComputedStyle(map).visibility==='hidden'});
        };testMap.on('render',watchRoad);
        roadSource.setData({type:'FeatureCollection',features:[]});void 0`);
      await until(()=>js(`noRoad.length>0 && mode.textContent==='Buffering'`));
      await sleep(350);
      assert.ok(await js(`noRoad.every(s=>s.hidden && s.d===noRoad[0].d) && +seek.value===noRoad[0].d && play.textContent==='Pause'`));
      await js(`roadSource.setData(savedRoad);void 0`);
      await until(()=>js(`+seek.value>noRoad[0].d && map.getAttribute('aria-busy')==='false'`));
      await js(`testMap.off('render',watchRoad);void 0`);
    }
    assert.deepEqual(exceptions,[]);
  });

test('a late unsafe DEM during Play hands off at the same metre and rides to summit and replay',
  {skip:!process.env.MAPBOX_GL_215,timeout:30000},async t=>{
    const {js,exceptions}=await fixture(t);
    await js(`seek.value=+seek.max-1000;seek.dispatchEvent(new Event('input'));play.click()`);
    await until(()=>js(`testMap.getTerrain() && +seek.value>+seek.max-980 && mode.textContent==='Cinematic flyover'`));
    const handoff=await js(`window.distances=[];testMap.on('render',()=>distances.push(+seek.value));
      const before=+seek.value;
      testMap.fire('sourcedata',{sourceId:'dem',tile:{tileID:{canonical:{z:14}},dem:{dim:1,get:()=>9900}}});
      [before,+seek.value,!testMap.getTerrain(),map.getAttribute('aria-busy'),play.textContent]`);
    assert.deepEqual(handoff,[handoff[0],handoff[0],true,'true','Pause']);
    await until(()=>js(`mode.textContent==='Flat satellite ride' && +seek.value>${handoff[0]}`));
    await js(`speed.value='4'`);
    await until(()=>js(`+seek.value===+seek.max && mode.textContent==='Summit' && play.textContent==='Replay flyover'`));
    assert.ok(await js(`distances.every((d,i)=>!i || d>=distances[i-1])`));
    await js(`play.click()`);
    await until(()=>js(`+seek.value>0 && +seek.value<1000 && play.textContent==='Pause'`));
    assert.deepEqual(exceptions,[]);
  });

for (const cold of [true,false]) test(`northern DEM missing at 8771 m: ${cold?'cold seek':'visible ride with 404'} continues on satellite`,
  {skip:!process.env.MAPBOX_GL_215,timeout:40000},async t=>{
    const {js,holdNorth,dropNorth,release,held,dem404s,exceptions}=await fixture(t,'dem-hole');
    const seek8771=`seek.value=8771; seek.dispatchEvent(new Event('input'))`;
    if (!cold) {
      await js(seek8771);
      await until(()=>js(`testMap.getTerrain() && map.getAttribute('aria-busy')==='false'`));
    }
    if (cold) { holdNorth(); t.after(release); } else dropNorth();
    const reloadDEM=`testMap.style._getSourceCache('dem').clearTiles();
      const source=testMap.getSource('dem'); source.setTiles(source.tiles);void 0`;
    await js(`window.exposed=false;
      window.coverage=()=>{
        const tr=testMap.transform.elevation;
        if (!tr || !testMap.getTerrain()) return null;
        return {holes:tr.proxyCoords.filter(id=>!tr.terrainTileForTile[id.key]?.dem).length,
          rider:testMap.queryTerrainElevation(beacon.getLngLat()),
          probe:testMap.queryTerrainElevation(testMap.unproject([168,124])),
          loaded:testMap.isSourceLoaded('dem')};
      };
      testMap.on('render',()=>{
        if (coverage()?.holes && getComputedStyle(map).visibility==='visible') exposed=true;
      });
      ${reloadDEM}; ${cold ? seek8771 : ''}`);
    await until(()=>cold ? held() : dem404s());
    await until(()=>js(`!exposed && !testMap.getTerrain() && getComputedStyle(map).visibility==='visible' && +seek.value===8771`))
      .catch(async err=>{throw Error(await js(`JSON.stringify({exposed,coverage:coverage(),d:+seek.value,msg:message.textContent})`),{cause:err});});
    await js('play.click()');
    await until(()=>js(`!exposed && +seek.value>8771 && mode.textContent==='Flat satellite ride'`));
    assert.deepEqual(exceptions,[]);
  });

test('real road DEM at the 8771 m seam reveals the rider on the ascent',
  {skip:!process.env.MAPBOX_GL_215 || !process.env.KOTR_N45E011_TIF,timeout:30000}, async t=>{
    const {js,exceptions}=await fixture(t,'real-road');
    await js(`seek.value=8771; seek.dispatchEvent(new Event('input'))`);
    const state=await until(()=>js(`(() => {
      if (!testMap.getTerrain() || map.getAttribute('aria-busy')!=='false') return;
      const gps=beacon.getLngLat(), p=testMap.project(gps);
      const halves=testMap.transform.elevation.visibleDemTiles.map(t=>{
        const {y,z}=t.tileID.canonical;return y/2**z<365/1024;
      });
      const tr=testMap.transform.elevation;
      return {covered:tr.proxyCoords.every(id=>tr.terrainTileForTile[id.key]?.dem),
        parents:tr.proxyCoords.filter(id=>tr.terrainTileForTile[id.key]?.tileID.canonical.z<id.canonical.z).length,
        elevation:testMap.queryTerrainElevation(gps),both:halves.includes(true)&&halves.includes(false),
        road:testMap.queryRenderedFeatures([[p.x-4,p.y-4],[p.x+4,p.y+4]],{layers:['ascent']}).length,
        opacity:getComputedStyle(beacon.getElement()).opacity};
    })()`)).catch(async err=>{throw Error(await js(`JSON.stringify({message:message.textContent,
      terrain:!!testMap.getTerrain(),gps:beacon.getLngLat(),
      elevation:testMap.queryTerrainElevation(beacon.getLngLat())})`),{cause:err});});
    assert.ok(state.covered && state.parents>0 && state.both && state.elevation>900 && state.elevation<1050 &&
      state.road && state.opacity==='1',JSON.stringify(state));
    t.diagnostic(`8771 m: ${state.elevation.toFixed(1)} m DEM; road and rider visible with ${state.parents} parent bindings`);
    assert.deepEqual(exceptions,[]);
  });

for (const scenario of ['partial','parent']) test(`finished satellite 404s: ${scenario} viewport`,
  {skip:!process.env.MAPBOX_GL_215,timeout:30000}, async t=>{
    const {js,exceptions,dropSat,sat404s}=await fixture(t,scenario);
    if (scenario==='partial') dropSat();
    // Evict the overview before the cold seek. Leave the SDK in charge of
    // every destination request, fallback selection and source-loaded flag.
    await js(`${scenario==='partial' ? "for(const id of ['sat','sat-cover']) testMap.style._getSourceCache(id).clearTiles();" : ''}
      seek.value=5200; seek.dispatchEvent(new Event('input')); play.click()`);
    const inspect=`(() => {
      if (!window.beacon?.getElement().isConnected || !testMap.isSourceLoaded('sat')) return null;
      const cache=testMap.style._getSourceCache('sat'), src=cache.getSource();
      const ids=testMap.transform.coveringTiles(src), drawn=cache.getRenderableIds().map(k=>cache.getTileByID(k).tileID);
      const ancestor=(a,b)=>a.wrap===b.wrap && a.overscaledZ<=b.overscaledZ && b.scaledTo(a.overscaledZ).key===a.key;
      return {drawn:drawn.length, covered:ids.every(id=>drawn.some(d=>ancestor(d,id))),
        holes:ids.filter(id=>!drawn.some(d=>ancestor(d,id)||ancestor(id,d))).length,
        parents:ids.filter(id=>drawn.some(d=>d.key!==id.key && ancestor(d,id))).length};
    })()`;
    await until(async()=>{const v=await js(inspect); return sat404s() && v?.drawn && (scenario==='partial' ? v.holes : v.parents && v.covered);}).catch(async e=>{
      t.diagnostic(JSON.stringify(await js(`({state:${inspect},status:message.textContent,d:+seek.value,visits:visits.slice(-12)})`))); throw e;
    });
    if (scenario==='partial') {
      await sleep(400);
      assert.deepEqual(await js(`[+seek.value,mode.textContent,getComputedStyle(map).visibility]`),[5200,'Buffering','hidden']);
    } else await until(()=>js(`+seek.value>5200 && getComputedStyle(map).visibility==='visible'`));
    assert.deepEqual(exceptions,[]);
  });

test('slow desktop Play waits for actual satellite imagery, then plays without global idle',
  {skip:!process.env.MAPBOX_GL_215,timeout:30000}, async t=>{
    const {js,held,release,exceptions}=await fixture(t,'slow');
    t.after(release);
    await js(`speed.value='4'; play.click()`);
    await until(()=>held()>0);
    await sleep(900);
    assert.ok(await js(`+seek.value===0 && mode.textContent==='Buffering' && getComputedStyle(map).visibility==='hidden'`));
    await js(`testMap.areTilesLoaded=()=>false`);
    release();
    await until(()=>js(`getComputedStyle(map).visibility==='visible' && +seek.value>0`));
    const start=await js('+seek.value');
    await sleep(600);
    const end=await js('+seek.value');
    assert.ok(start<200 && end>start);
    t.diagnostic(`4x desktop: 0 m during held imagery; ${start} → ${end} m on satellite while global readiness remained false`);
    assert.deepEqual(exceptions,[]);
  });

test('cold 5200 m seek holds for the rendered ascent under the rider',
  {skip:!process.env.MAPBOX_GL_215,timeout:30000}, async t=>{
    const {js,exceptions}=await fixture(t);
    await js(`window.roadCallbacks=[];
      const actor=testMap.getSource('ascent').actor, send=actor.send;
      actor.send=function(type,data,cb,...rest) {
        if (data?.source==='ascent' && ['loadTile','reloadTile'].includes(type)) {
          const deliver=cb;
          cb=(...args)=>roadCallbacks ? roadCallbacks.push(()=>deliver(...args)) : deliver(...args);
        }
        return send.call(this,type,data,cb,...rest);
      };
      testMap.style._getSourceCache('ascent').clearTiles();
      window.roadAtRider=()=>testMap.queryRenderedFeatures(testMap.project(beacon.getLngLat()),{layers:['ascent']}).length;
      seek.value=5200; seek.dispatchEvent(new Event('input')); play.click()`);
    await until(()=>js(`roadCallbacks.length && testMap.isSourceLoaded('sat') && testMap.isSourceLoaded('dem') && !roadAtRider()`))
      .catch(async e=>{t.diagnostic(JSON.stringify(await js(`[roadCallbacks.length,roadAtRider(),message.textContent,+seek.value]`)));throw e});
    await sleep(350);
    assert.deepEqual(await js(`[+seek.value,mode.textContent,getComputedStyle(map).visibility,roadAtRider()]`),
      [5200,'Buffering','hidden',0]);
    await js(`actor.send=send; const pending=roadCallbacks; roadCallbacks=null; pending.forEach(f=>f())`);
    await until(()=>js(`+seek.value>5200 && roadAtRider() && getComputedStyle(map).visibility==='visible'`));
    assert.deepEqual(exceptions,[]);
  });

test('stationary phone rider rechecks native marker occlusion on settled terrain',
  {skip:!process.env.MAPBOX_GL_215,timeout:30000}, async t=>{
    const {js,exceptions}=await fixture(t,'ridge');
    await js(`seek.value=2098; seek.dispatchEvent(new Event('input'))`);
    await until(()=>js(`testMap.areTilesLoaded() && map.getAttribute('aria-busy')==='false'`)).catch(async e=>{
      t.diagnostic(JSON.stringify(await js(`(()=>{const gps=beacon.getLngLat(),p=testMap.project(gps);
        return {msg:message.textContent,gps,p,eye:testMap.getFreeCameraOptions().position.toLngLat(),hit:testMap.unproject(p),
          opacity:getComputedStyle(beacon.getElement()).opacity,behind:beacon._behindTerrain()}})()`))); throw e;
    });
    await sleep(200);
    // Give the SDK marker one obsolete mesh hit. Restore the actual terrain
    // before repainting; no subsequent movement can schedule a marker update.
    await until(()=>js(`beacon._fadeTimer==null`));
    assert.equal(await js(`const behind=beacon._behindTerrain;
      try {
        beacon._behindTerrain=()=>true;
        beacon._evaluateOpacity();
      } finally {beacon._behindTerrain=behind}
      +getComputedStyle(beacon.getElement()).opacity`),.2);
    await until(()=>js(`+getComputedStyle(beacon.getElement()).opacity===1 && message.textContent.startsWith('Satellite terrain ·')`));
    assert.equal(await js('+seek.value'),2098);
    assert.deepEqual(exceptions,[]);
  });

test('real 2.15 fetches upcoming imagery and elevation before visible use',
  {skip:!process.env.MAPBOX_GL_215,timeout:60000}, async t => {
    const {js,exceptions} = await fixture(t);
    // At the slower default begin south of the DEM boundary; starting on
    // it would load both neighbours as visible, not as look-ahead.
    await js(`performance.setResourceTimingBufferSize(5000);window.drawnDEM=new Map();
      testMap.on('render',()=>{
        for(const t of testMap.transform.elevation?.visibleDemTiles || []) {
          const {z,x,y}=t.tileID.canonical,url=location.origin+'/dem/'+z+'/'+x+'/'+y;
          if(!drawnDEM.has(url)) drawnDEM.set(url,performance.now());
        }
      });
      seek.value=5200;seek.dispatchEvent(new Event('input'));
      speed.value='4'; play.click()`);
    await sleep(20000);
    const {hints,visits,demUses,network,total} = await js(`play.click(); ({hints,visits,demUses:Object.fromEntries(drawnDEM),total:+seek.max,network:performance.getEntriesByType('resource')
      .filter(e=>e.transferSize>0).map(e=>({url:e.name,t:e.startTime}))})`);
    const largest = Math.max(...hints.map(h=>h.tiles.length));
    t.diagnostic(`${hints.length} hints in 20 s at 4x, ${Math.min(1800,Math.round(total*4/150*4))} m horizon; max ${largest} SDK tile selections/hint`);
    assert.ok(largest <= 32,'phone-sized fixture should only cover one viewport per hint');
    assert.ok(hints.length >= 2 && hints.length <= 20);
    hints.forEach((h,i) => {
      assert.ok(h.still);
      if (i) assert.ok(h.t-hints[i-1].t >= 999 && h.t>=hints[i-1].end);
    });
    for (const kind of ['sat','dem']) {
      const leads=new Map();
      for (const h of hints) for (const {url} of h.tiles) {
        if (!new URL(url).pathname.startsWith('/'+kind+'/')) continue;
        const net = network.find(n=>n.url===url);
        if (!net || net.t<h.t || visits.some(v=>v.url===url && v.t<net.t)) continue;
        // A decoded, cached DEM can bind with *no second request*.
        const use=kind==='dem' ? demUses[url] : visits.find(v=>v.url===url && v.t>net.t)?.t;
        if (use>net.t) leads.set(url,use-net.t);
      }
      assert.ok(leads.size, `expected newly fetched future ${kind} tiles`);
      t.diagnostic(`${kind}: ${leads.size} future matches, max network lead ${Math.round(Math.max(...leads.values()))} ms`);
    }
    assert.deepEqual(exceptions,[]);
  });

test('real terrain ray reaches the rider past an intervening ridge',
  {skip:!process.env.MAPBOX_GL_215,timeout:30000}, async t => {
    const {js,cmd,exceptions} = await fixture(t,'ridge');
    for (const width of [375,1280]) {
      await cmd('Emulation.setDeviceMetricsOverride',{width,height:812,deviceScaleFactor:1,mobile:width<500});
      const before=await js(`[message.textContent,testMap.getTerrain()?.exaggeration]`);
      await js(`testMap.resize(); seek.value=5000; seek.dispatchEvent(new Event('input'));
        window.control=new mapboxgl.Marker({scale:.65}).setLngLat(beacon.getLngLat()).addTo(testMap); void 0`);
      await until(()=>js(`testMap.areTilesLoaded()`));
      await until(()=>js(`testMap.getTerrain() && map.getAttribute('aria-busy')==='false'`)).catch(async cause=>{
        throw Error(JSON.stringify({width,before,after:await js(`[message.textContent,testMap.getTerrain()?.exaggeration,
          testMap.queryTerrainElevation(beacon.getLngLat())]`)}),{cause});
      });
      await sleep(600); // SDK's marker occlusion check runs on a timer.
      const state=await js(`(() => {
        const c=testMap.getFreeCameraOptions(), p=beacon.getLngLat();
        return {error:p.distanceTo(testMap.unproject(testMap.project(p))),altitude:c.position.toAltitude(),
          eye:c.position.toLngLat(),p, probe:getComputedStyle(control.getElement()).opacity,
          marker:getComputedStyle(beacon.getElement()).opacity};
      })()`);
      const {p,eye,error,altitude}=state;
      const minClearance = (eye,z) => Math.min(...Array.from({length:256},(_,i)=>{
        const f=(i+1)/256;
        return ridgeHeight(p.lng,p.lat)*(1-f)+z*f-
          ridgeHeight(p.lng+(eye.lng-p.lng)*f,p.lat+(eye.lat-p.lat)*f);
      }));
      // Positive geometric control: the previous southward orbit, even
      // from 1,300 m ASL, cuts this very same ridge.
      assert.ok(minClearance({lng:p.lng,lat:p.lat-900/111200},1300)<-200);
      assert.ok(minClearance(eye,altitude)>0 && error<10 && altitude<1900 && state.probe==='1' && state.marker==='1',JSON.stringify(state));
      assert.ok(await js(`(() => {const css=getComputedStyle(beacon.getElement()); return css.width==='20px'
        && css.backgroundColor==='rgb(255, 220, 86)' && css.borderTopWidth==='3px'
        && css.borderTopColor==='rgb(22, 60, 52)' && css.boxShadow.includes('rgb(255, 255, 255)')})()`));
      t.diagnostic(`${width}px: 1200 m ridge, eye ${altitude.toFixed(0)} m, SDK terrain hit ${error.toFixed(1)} m from rider; default opacity 1`);
      await js('control.remove(); void 0');
    }
    assert.deepEqual(exceptions,[]);
  });

test('moving real-road ridge keeps the actual SDK lens composed and the rider on the ascent',
  {skip:!process.env.MAPBOX_GL_215 || !process.env.KOTR_N45E011_TIF,timeout:120000},async t=>{
    const {js,cmd,exceptions}=await fixture(t,'ride-road');
    await js(`window.track=testMap.getSource('ascent')._data.coordinates;
      window.chain=[0];for(let i=1;i<track.length;i++) chain.push(chain.at(-1)+Math.hypot(
        (track[i][0]-track[i-1][0])*77450,(track[i][1]-track[i-1][1])*111200));
      seek.value=3400;seek.dispatchEvent(new Event('input'));play.click();window.clock=0`);
    const ridge=[],refinements=new Set();
    for(let i=0;i<600;i++){
      await cmd('Runtime.evaluate',{expression:'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',awaitPromise:true});
      const sample=await js(`(()=>{
        const d=+seek.value,p=testMap.project(beacon.getLngLat()),cam=testMap.getFreeCameraOptions().position,eye=cam.toLngLat();
        const path=map.querySelector('polyline'),b=beacon.getElement().getBoundingClientRect(),m=map.getBoundingClientRect();
        const vertices=path?Array.from(path.points):[], i=chain.findIndex(z=>z>=d);
        const near=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y)<1.5;
        const road=vertices.some((v,j)=>j>0 && j<vertices.length-1 && near(v,p) &&
          near(v,{x:b.x+b.width/2-m.x,y:b.y+b.height/2-m.y}) &&
          // Rounded seek metres can straddle a GPX vertex.
          [i-1,i,i+1].some(k=>k>0 && k<track.length && near(vertices[j-1],testMap.project(track[k-1])) &&
            near(vertices[j+1],testMap.project(track[k]))));
        // Independent broad chord from the original GPX, not the camera rail.
        const at=m=>track[chain.findIndex(z=>z>=m)], a=at(d-450), bAhead=at(d+750);
        const course=Math.atan2((bAhead[0]-a[0])*77450,(bAhead[1]-a[1])*111200)*180/Math.PI;
        const ahead=testMap.project(at(d+150));
        const sample={d,terrain:!!testMap.getTerrain(),vis:map.getAttribute('aria-busy')==='false',road,
          quarter:((course-testMap.getBearing()+540)%360)-180,
          aheadVisible:Math.min(ahead.x,ahead.y,m.width-ahead.x,m.height-ahead.y)>4,
          msg:message.textContent,unbound:testMap.transform.elevation?.proxyCoords.some(
            id=>!testMap.transform.elevation.terrainTileForTile[id.key]?.dem),
          hit:beacon.getLngLat().distanceTo(testMap.unproject(p)),
          markerError:Math.hypot(b.x+b.width/2-m.x-p.x,b.y+b.height/2-m.y-p.y),
          traceError:Math.min(...vertices.map(v=>Math.hypot(v.x-p.x,v.y-p.y))),
          opacity:+getComputedStyle(beacon.getElement()).opacity,eye:[eye.lng,eye.lat,cam.toAltitude()],
          zoom:testMap.getZoom(),pitch:testMap.getPitch(),bearing:testMap.getBearing()};
        stepRide(clock+=64); // ~8 m: measure the cut, don't stride over it
        return sample;
      })()`);
      if (sample.d>7000) break;
      // Unlike the 3x100 ms burst formerly used here, do not report an
      // unbound mesh as a healthy pose. Require its same-metre reveal,
      // and bound these actual tile waits across the entire ridge.
      if(sample.d>=4000 && !sample.vis && sample.unbound) {
        refinements.add(sample.d);
        assert.ok(refinements.size<=4,JSON.stringify(sample));
        continue;
      }
      if (sample.d>=4000 && sample.d!==ridge.at(-1)?.d) ridge.push(sample);
    }
    const terrain=ridge.filter(s=>s.terrain);
    assert.ok(ridge.at(-1)?.d>6950 && terrain.length===ridge.length && terrain.length>355 &&
      [...refinements].every(d=>ridge.some(s=>s.d===d)),JSON.stringify({samples:ridge.length,
      terrain:terrain.length,last:ridge.at(-1),firstGap:ridge.find(s=>!s.vis || !s.terrain)}));
    const missing=ridge.find(s=>!s.vis || s.opacity!==1 || !s.road);
    assert.ok(!missing,`road and rider at sampled moving positions: ${JSON.stringify(missing)}`);
    const pairs=terrain.slice(1).map((s,i)=>[s,terrain[i]]);
    assert.ok(terrain.filter(s=>s.quarter>10 && s.quarter<80).length>.8*terrain.length &&
      terrain.every(s=>s.aheadVisible),'road ahead in frame; lens predominantly on the trailing quarter');
    const turns=pairs.map(([s,p])=>((s.bearing-p.bearing+540)%360)-180);
    assert.ok(turns.reduce((sum,v)=>sum+Math.abs(v),0)>35 && Math.max(...turns.map(Math.abs))<3,
      'actual terrain lens turns through the ridge without whipping on individual segments');
    const maxZoom=Math.max(...pairs.map(([s,p])=>Math.abs(s.zoom-p.zoom)));
    const maxEye=Math.max(...pairs.map(([s,p])=>Math.hypot((s.eye[0]-p.eye[0])*77450,
      (s.eye[1]-p.eye[1])*111200,s.eye[2]-p.eye[2])/(s.d-p.d)));
    t.diagnostic(`${terrain.length}/${ridge.length} moving ridge samples in 3D; max zoom step ${maxZoom.toFixed(3)}, eye travel ${maxEye.toFixed(2)} m/m`);
    assert.ok(maxZoom<.12 && maxEye<3.5);
    assert.deepEqual(exceptions,[]);
  });

test('moving 3764 m render rejects a zero-margin marker even between terrain picks',
  {skip:!process.env.MAPBOX_GL_215,timeout:30000},async t=>{
    const {js,exceptions}=await fixture(t,'ride');
    await js(`seek.value=3764;seek.dispatchEvent(new Event('input'));play.click()`);
    await until(()=>js(`testMap.getTerrain() && map.getAttribute('aria-busy')==='false'`));
    const result=await js(`(()=>{
      testMap.fire('render'); // validated shot; second paint is inside the pick interval
      const el=beacon.getElement(), m=map.getBoundingClientRect(), b=el.getBoundingClientRect();
      el.style.marginLeft=(m.left-b.left)+'px';
      const margin=el.getBoundingClientRect().left-m.left;
      testMap.fire('render');
      const hidden=getComputedStyle(map).visibility==='hidden';
      el.style.marginLeft='';testMap.triggerRepaint();
      return {margin,hidden,d:+seek.value};
    })()`);
    assert.ok(Math.abs(result.margin)<.1 && result.hidden && result.d===3764,JSON.stringify(result));
    await until(()=>js(`testMap.getTerrain() && map.getAttribute('aria-busy')==='false'`));
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
        const gps=beacon.getLngLat(), p=testMap.project(gps);
        const cam=testMap.getFreeCameraOptions().position, eye=cam.toLngLat();
        return {distance:+seek.value,status:message.textContent,visible:getComputedStyle(map).visibility==='visible',
          width:b.width,opacity:+getComputedStyle(el).opacity,
          loaded:testMap.areTilesLoaded(), gps,eye,z:cam.toAltitude(),riderZ:testMap.queryTerrainElevation(gps),
          road:testMap.queryRenderedFeatures([[p.x-4,p.y-4],[p.x+4,p.y+4]],{layers:['ascent']}).length,
          hitRatio:eye.distanceTo(gps)>1 ? eye.distanceTo(testMap.unproject(p))/eye.distanceTo(gps) :
            (gps.distanceTo(testMap.unproject(p))<1 ? 1 : 0),
          error:Math.hypot(b.x+b.width/2-m.x-p.x,b.y+b.height/2-m.y-p.y),
          margin:Math.min(b.left-m.left,m.right-b.right,b.top-m.top,m.bottom-b.bottom)};
      })()`;
      const check = s => {
        assert.ok(s.width>=19.99 && s.opacity===1 && s.margin>=2 && s.error<1.6,JSON.stringify(s));
      };
      for (const rate of [1,4]) {
        let min=Infinity, minHit=Infinity, earlyError=0;
        const bends=new Set();
        // Continuous pass from the start, then a separate seek into the bends.
        for (const [start,end] of [[0,Infinity],[5200,7000]]) {
          await js(`reset.click()`);
          // Listen before seeking. Snapshot the first visible ride render in
          // the browser, after the application's render gate, not a later poll.
          await js(`window.firstRide=null;
            testMap.on('render',function capture(){
              if (!testMap.getTerrain() || getComputedStyle(map).visibility!=='visible') return;
              firstRide=${sample}; testMap.off('render',capture);
            });
            seek.value=${start}; seek.dispatchEvent(new Event('input'))`);
          const first=await until(()=>js('firstRide'));
          assert.equal(first.distance,start);
          check(first);
          await js(`speed.value='${rate}'; play.click(); window.clock=0; stepRide(clock)`);
          const limit=Math.min(end,await js('+seek.max'));
          let s;
          do {
            // Advance in 100 ms player frames; yield to SDK layout/render
            // between samples. Sample ~every 165 m regardless of speed.
            await js(`for(let i=0;i<${8/rate} && +seek.value<+seek.max;i++) stepRide(clock+=100)`);
            await cmd('Runtime.evaluate',{expression:'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))',awaitPromise:true});
            s=await js(sample);
            // The test clock just advanced up to eight frames in one JS
            // turn. Let the independent SDK catch up at a measuring point
            // before judging terrain that it hasn't drawn yet.
            const inBends=s.distance>=4000 && s.distance<=7000;
            if (!s.visible || s.opacity!==1 || (inBends && (!s.loaded || s.hitRatio<.9))) {
              await until(async()=>{
                s=await js(sample);
                return s.visible && s.loaded && s.opacity===1 && (!inBends || s.hitRatio>=.9);
              }).catch(e=>{throw Error(JSON.stringify(s),{cause:e});});
            }
            check(s); min=Math.min(min,s.margin);
            if (inBends) { bends.add(s.distance); minHit=Math.min(minHit,s.hitRatio); }
            if (s.distance>=400 && s.distance<=700) earlyError=Math.max(earlyError,s.error);
          } while (s.distance<limit);
        }
        assert.ok(bends.size>=20);
        t.diagnostic(`${width}px ${rate}x: max sampled error near 504 m: ${earlyError.toFixed(2)} px; ${bends.size} loaded distances at km 4–7, min ray ratio ${minHit.toFixed(3)}; min edge margin ${min.toFixed(1)} px`);
      }
    }
    assert.deepEqual(exceptions,[]);
  });

for (const width of [375,1280]) for (const rate of [0,1,4]) {
  test(`cold summit → km 5.2, ${width}px ${rate ? rate+'x immediate resume' : 'paused'}`,
    {skip:!process.env.MAPBOX_GL_215,timeout:60000}, async t => {
    const {js,cmd,hold,held,release,exceptions}=await fixture(t,'cold');
    t.after(release);
    await cmd('Emulation.setDeviceMetricsOverride',{width,height:812,deviceScaleFactor:1,mobile:width<500});
    await js(`testMap.resize(); seek.value=seek.max; seek.dispatchEvent(new Event('input'))`);
    await until(()=>js(`message.textContent.startsWith('Satellite terrain ·') && testMap.areTilesLoaded()`)).catch(async e=>{
      t.diagnostic(JSON.stringify(await js(`(()=>{const gps=beacon.getLngLat(),p=testMap.project(gps);
        return {msg:message.textContent,gps,p,eye:testMap.getFreeCameraOptions().position.toLngLat(),hit:testMap.unproject(p),
          road:testMap.queryRenderedFeatures([[p.x-4,p.y-4],[p.x+4,p.y+4]],{layers:['ascent']}).length,
          opacity:getComputedStyle(beacon.getElement()).opacity,loaded:testMap.areTilesLoaded()}})()`))); throw e;
    });
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
        const el=beacon.getElement(), box=el.getBoundingClientRect(), m=map.getBoundingClientRect();
        const gps=beacon.getLngLat(), gpsError=Math.hypot((lon-gps.lng)*77450,(lat-gps.lat)*111200);
        const p=testMap.project([lon,lat]), css=getComputedStyle(el);
        const eye=testMap.getFreeCameraOptions().position.toLngLat();
        frames.push({d,gpsError,loading:message.textContent.startsWith('Loading'),mapVisible:getComputedStyle(map).visibility==='visible',
          visible:box.width>=16 && css.visibility==='visible' && +css.opacity===1,
          margin:Math.min(box.left-m.left,m.right-box.right,box.top-m.top,m.bottom-box.bottom),
          error:Math.hypot(box.x+box.width/2-p.x-m.x,box.y+box.height/2-p.y-m.y),
          dem:testMap.queryTerrainElevation(gps),
          hitRatio:eye.distanceTo(testMap.unproject(testMap.project(gps)))/eye.distanceTo(gps),
          altitude:testMap.getFreeCameraOptions().position.toAltitude()});
      };
      new MutationObserver(()=>{
        if(map.getAttribute('aria-busy')==='false' && !window.reveal){capture();window.reveal=frames.at(-1);}
      }).observe(map,{attributes:true,attributeFilter:['aria-busy']});
      seek.value=5200; seek.dispatchEvent(new Event('input')); capture();
      if (${rate}) {speed.value='${rate}';play.click();}
      window.record=true; requestAnimationFrame(function frame(){if(record){capture();requestAnimationFrame(frame)}})`);
    await until(()=>held()>0);
    await sleep(350);
    assert.ok(await js('frames.length>=3 && frames.every(f=>f.loading && !f.mapVisible && f.d===5200)'));
    release();
    await until(()=>js(`frames.at(-1).altitude>1900 && !frames.at(-1).loading`));
    await sleep(400);
    const frames=await js('window.record=false; frames');
    for(const s of frames) {
      assert.ok((s.mapVisible || s.loading) && s.gpsError<.51,JSON.stringify(s));
      if (!rate) assert.equal(s.d,5200);
    }
    const last=frames.at(-1);
    assert.ok(last.visible && last.margin>=2 && last.error<2 && last.altitude>1900,JSON.stringify(last));
    if(rate) assert.ok(last.d>5200);
    const shown=frames.findIndex(f=>f.mapVisible);
    assert.ok(shown>0 && frames.slice(shown).every(f=>f.mapVisible),'no return to loading in continuous playback');
    const first=await js('window.reveal');
    for (const f of [first,frames[shown]]) assert.ok(f.d===5200 && f.visible && f.margin>=2 && f.error<1.6 &&
      f.hitRatio>=.93 && f.dem>1300 && f.altitude>1900,JSON.stringify(f));
    t.diagnostic(`${held()} delayed DEM requests; first visible at ${first.d} m, ${first.error.toFixed(2)} px error, ray ${first.hitRatio.toFixed(3)}, DEM ${first.dem.toFixed(0)} m`);
    assert.deepEqual(exceptions,[]);
  });
}
