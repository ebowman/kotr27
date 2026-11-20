// Optional real-engine integration: download the pinned public mapbox-gl.js
// and run MAPBOX_GL_215=/path/to/mapbox-gl.js node --test tests/preload.mjs.
// No account/config, real basemap or authenticated tile requests.
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
    if (scenario==='real-road') {
      const crop=execFileSync('python3',['-c',`from PIL import Image
import sys
im=Image.open(sys.argv[1])
assert im.size==(3600,3600) and im.tag_v2[33922][3:5]==(11.,46.)
sys.stdout.buffer.write(im.crop((2300,300,3300,900)).convert("I").convert("I;16").tobytes())`,
        process.env.KOTR_N45E011_TIF],{maxBuffer:2000000});
      roadHeight=(lon,lat)=>crop.readUInt16LE(2*(1000*Math.max(0,Math.min(599,Math.floor((46-lat)*3600)-300))
        +Math.max(0,Math.min(999,Math.floor((lon-11)*3600)-2300))));
    }
    let demGate, held = 0, coldDestination = false, missingSat=false, sat404s=0, northGate, missingNorth=false, dem404s=0;
    let satGate=scenario==='slow' ? Promise.withResolvers() : null;
    const sdk = await readFile(process.env.MAPBOX_GL_215);
    assert.equal(createHash('sha256').update(sdk).digest('hex'),
      '302ee91531bc123693caa52eb74f71a2fb9ff61311f54d59ec3c04325dc5b2f7');
    const server = createServer(async (req,res) => {
      const path = req.url;
      if (/^\/(sat|dem)\//.test(path)) {
        if (path.startsWith('/dem/') && missingNorth && acrossBoundary(path)) {
          dem404s++; res.writeHead(404).end(); return;
        }
        if (northGate && path.startsWith('/dem/') && acrossBoundary(path)) { held++; await northGate.promise; }
        if (path.startsWith('/sat/')) {
          const [, , z,x]=path.split('/').map(Number);
          if ((missingSat && (z<15 || x%2)) || (scenario==='parent' && z>13)) {
            sat404s++;
            res.writeHead(404).end(); return;
          }
        }
        if (satGate && path.startsWith('/sat/')) { held++; await satGate.promise; }
        if (demGate && path.startsWith('/dem/')) { held++; await demGate.promise; }
        await sleep(20);
        res.writeHead(200,{'Content-Type':'image/png','Cache-Control':['cold','partial','dem-hole'].includes(scenario)?'no-store':'public, max-age=3600'})
          .end(path.startsWith('/dem/') ? (roadHeight ? elevationTile(path,roadHeight) :
            ['ridge','ride'].includes(scenario) ? elevationTile(path) :
            scenario==='seam' && acrossBoundary(path) ? seaLevelTile :
            scenario==='spike' ? spikedTile : coldDestination ? raisedTile : scenario==='cold' ? coldBase : tile) : tile);
      } else if (path === '/sdk.js') res.end(Buffer.concat([sdk,Buffer.from('\n'+instrument+
        (scenario==='overview' ? overviewProbe : ''))]));
      // Only SDK layout rules needed by the local fixture (no CDN requests).
      else if (path === '/sdk.css') res.writeHead(200,{'Content-Type':'text/css'}).end(
        '.mapboxgl-map{overflow:hidden}.mapboxgl-canvas,.mapboxgl-marker{position:absolute;top:0;left:0}');
      else if (path === '/js/config.js') res.end('window.KOTR_CONFIG={}');
      else if (path === '/' || /^\/assets\/(flyover\.js|terrain\.js|semonzo\.gpx)$/.test(path)) {
        let body = await readFile(new URL('..'+(path==='/'?'/index.html':path),import.meta.url));
        // Keep the real route geometry; give its test GPX a vertical datum
        // consistent with the synthetic DEM used for the camera experiments.
        if (path.endsWith('.gpx') && !roadHeight) body=body.toString().replace(
          /(<trkpt lon="([^"]+)" lat="([^"]+)"><ele>)([^<]+)/g,(_,tag,lon,lat,h)=>
            tag+((scenario==='cold' ? 1250 : ['ride','ridge'].includes(scenario) ? ridgeHeight(+lon,+lat) : 500)+h*.01));
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
    const slow=scenario==='slow';
    await cmd('Emulation.setDeviceMetricsOverride',{width:slow?1280:375,height:812,deviceScaleFactor:1,mobile:!slow});
    await cmd('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/`});
    if (slow) await until(()=>js(`document.querySelector('#deck')?.hidden===false`));
    else await until(()=>js(`document.querySelector('#message')?.textContent.startsWith('Satellite terrain ·')`));
    return {js,cmd,exceptions,dropSat:()=>{missingSat=true;},sat404s:()=>sat404s,
      holdNorth:()=>{northGate=Promise.withResolvers();}, dropNorth:()=>{missingNorth=true;},dem404s:()=>dem404s,
      hold:()=>{demGate=Promise.withResolvers();coldDestination=true;},held:()=>held,
      release:()=>{demGate?.resolve();demGate=null;satGate?.resolve();satGate=null;northGate?.resolve();northGate=null;}};
}

// Inspect the SDK's fitted camera, selected tiles and rendered features at
// reveal. The fixture has local tiles, not a live authenticated basemap.
const overviewProbe=`
window.fits=[]; window.switches=[]; window.reveals=[];
const proto=mapboxgl.Map.prototype, fit=proto.fitBounds, terrain=proto.setTerrain;
proto.setTerrain=function(v){ switches.push(v?.source ?? null); return terrain.call(this,v); };
proto.fitBounds=function(...args){
  fits.push(this.getTerrain()?.source ?? null);
  const result=fit.apply(this,args);
  const capture=()=>{
    if(map.getAttribute('aria-busy')!=='false' || this.getPitch()!==0) return;
    this.off('render',capture);
    const cache=this.style._getSourceCache('sat'),drawn=new Set(cache.getRenderableIds());
    const ids=this.transform.coveringTiles(cache.getSource());
    reveals.push({imagery:ids.length>0 && ids.every(id=>drawn.has(id.key) || cache.hasRenderableParent(id)),
      route:this.queryRenderedFeatures({layers:['ascent']}).length>0,
      color:this.getPaintProperty('ascent','line-color'),fade:this.getPaintProperty('sat','raster-fade-duration')});
  };
  queueMicrotask(()=>this.on('render',capture)); // after application's reveal check
  return result;
};`;

test('flat overview has raster coverage and rendered ascent on cold load and repeated resets',
  {skip:!process.env.MAPBOX_GL_215,timeout:30000}, async t=>{
    const {js,exceptions}=await fixture(t,'overview');
    assert.deepEqual(await js(`switches`),[]);
    assert.equal(await js(`visits.some(v=>new URL(v.url).pathname.startsWith('/dem/'))`),false);
    for(let i=0;i<3;i++){
      const reveal=await until(()=>js(`reveals[${i}]`));
      assert.deepEqual(reveal,{imagery:true,route:true,color:'#ff932e',fade:0});
      if(i===2) break;
      await js(i ? `seek.value=5200; seek.dispatchEvent(new Event('input'))` : 'play.click()');
      await until(()=>js(`testMap.getTerrain()?.source==='dem' && map.getAttribute('aria-busy')==='false'`));
      await js(`reset.click(); reset.click()`);
    }
    assert.deepEqual(await js('fits'),[null,null,null]);
    assert.deepEqual(await js('switches'),['dem',null,'dem',null]);
    assert.deepEqual(exceptions,[]);
  });

for (const failure of ['spike','seam','timeout']) test(`3D ${failure} restores a gated flat overview`,
  {skip:!process.env.MAPBOX_GL_215,timeout:40000},async t=>{
    const {js,hold,release,exceptions}=await fixture(t,failure);
    if(failure==='timeout') {hold();t.after(release);}
    await js(`window.unsafe=false;
      testMap.on('render',()=>{if(testMap.getTerrain() && map.getAttribute('aria-busy')==='false') unsafe=true;});
      ${failure==='seam' ? `seek.value=8771; seek.dispatchEvent(new Event('input'))` : 'play.click()'}`);
    assert.ok(await js(`map.getAttribute('aria-busy')==='true' && (${failure==='seam'} || mode.textContent==='Buffering')`));
    if(failure==='timeout') await sleep(20200);
    await until(()=>js(`message.textContent.startsWith('3D flyover unavailable. Flat satellite overview')`));
    assert.ok(await js(`!unsafe && play.disabled && !seek.disabled && +seek.value===0 && !testMap.getTerrain()
      && map.getAttribute('aria-busy')==='false' && testMap.queryRenderedFeatures({layers:['ascent']}).length>0`));
    await js(`seek.value=5200;seek.dispatchEvent(new Event('input'))`);
    assert.ok(await js(`+seek.value===5200 && mode.textContent==='Elevation profile' && !testMap.getTerrain()`));
    assert.deepEqual(exceptions,[]);
  });

test('flat refit expires despite continuing satellite tiles when the ascent cannot render',
  {skip:!process.env.MAPBOX_GL_215,timeout:32000},async t=>{
    const {js,exceptions}=await fixture(t,'spike');
    await js(`testMap.getSource('ascent').setData({type:'FeatureCollection',features:[]});
      play.click()`);
    await until(()=>js(`play.disabled && !testMap.getTerrain() && map.getAttribute('aria-busy')==='true'`));
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
    await sleep(20000);
    await until(()=>js(`map.parentElement.hidden && message.checkVisibility() &&
      message.textContent==='Satellite terrain unavailable. Use the elevation profile below.'`));
    const spans=await js(`[contentTimes,tileTimes].map(ts=>ts.at(-1)-ts[0])`);
    assert.ok(spans.every(ms=>ms>16000),JSON.stringify(spans));
    assert.ok(await js(`play.disabled && !seek.disabled`));
    await js(`seek.value=5200;seek.dispatchEvent(new Event('input'))`);
    assert.ok(await js(`+seek.value===5200 && mode.textContent==='Elevation profile' && stats.textContent.includes('5.2 km')`));
    assert.deepEqual(exceptions,[]);
  });

for (const cold of [true,false]) test(`northern DEM missing at 8771 m: ${cold?'cold hold then coverage arrives':'visible ride hides on 404 until bounded flat recovery'}`,
  {skip:!process.env.MAPBOX_GL_215,timeout:40000},async t=>{
    const {js,holdNorth,dropNorth,release,held,dem404s,exceptions}=await fixture(t,'dem-hole');
    const seek8771=`seek.value=8771; seek.dispatchEvent(new Event('input'))`;
    if (!cold) {
      await js(seek8771);
      await until(()=>js(`testMap.getTerrain() && map.getAttribute('aria-busy')==='false'`));
    }
    if (cold) { holdNorth(); t.after(release); } else dropNorth();
    const reloadDEM=`testMap.style._getSourceCache('dem').clearTiles(); testMap.triggerRepaint()`;
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
      ${cold ? seek8771 : reloadDEM}`);
    const state=await until(async()=>{
      const v=await js('coverage()');
      // Wait for this destination camera: during the cold camera update
      // that same screen pixel can still sample a covered southern tile.
      return (cold ? held() : dem404s() && v?.loaded) && v?.holes && v.rider===500 && v.probe===null && v;
    });
    t.diagnostic(JSON.stringify(state));
    await until(()=>js(`!exposed && message.textContent==='Loading terrain elevation…' && getComputedStyle(map).visibility==='hidden'`));
    await js('play.click()');
    await sleep(350);
    assert.ok(await js(`+seek.value===8771 && mode.textContent==='Buffering' && !exposed`));
    if (cold) {
      release();
      await until(()=>js(`!exposed && coverage()?.holes===0 && getComputedStyle(map).visibility==='visible' && +seek.value>8771`))
        .catch(async e=>{throw Error(await js(`JSON.stringify([exposed,coverage(),message.textContent,+seek.value])`),{cause:e});});
    } else {
      await sleep(20000);
      await until(()=>js(`message.textContent.startsWith('3D flyover unavailable. Flat satellite overview')`));
      assert.ok(await js(`!exposed && play.disabled && !seek.disabled && !testMap.getTerrain() &&
        getComputedStyle(map).visibility==='visible' && testMap.queryRenderedFeatures({layers:['ascent']}).length>0`));
    }
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
      terrain:!!testMap.getTerrain(),gps:beacon.getLngLat(), elevation:testMap.queryTerrainElevation(beacon.getLngLat())})`),{cause:err});});
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
    await js(`${scenario==='partial' ? "testMap.style._getSourceCache('sat').clearTiles();" : ''}
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

test('real terrain ray reaches the rider past an intervening ridge',
  {skip:!process.env.MAPBOX_GL_215,timeout:30000}, async t => {
    const {js,cmd,exceptions} = await fixture(t,'ridge');
    for (const width of [375,1280]) {
      await cmd('Emulation.setDeviceMetricsOverride',{width,height:812,deviceScaleFactor:1,mobile:width<500});
      await js(`testMap.resize(); seek.value=5000; seek.dispatchEvent(new Event('input'));
        window.control=new mapboxgl.Marker({scale:.65}).setLngLat(beacon.getLngLat()).addTo(testMap); void 0`);
      await until(()=>js(`testMap.areTilesLoaded()`));
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
        return {distance:+seek.value,status:message.textContent,width:b.width,opacity:+getComputedStyle(el).opacity,
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
            if (s.opacity!==1 || (inBends && (!s.loaded || s.hitRatio<.9))) {
              await until(async()=>{
                s=await js(sample);
                return s.loaded && s.opacity===1 && (!inBends || s.hitRatio>=.9);
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
    {skip:!process.env.MAPBOX_GL_215,timeout:30000}, async t => {
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
