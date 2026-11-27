// Actual built /kotr27/ acceptance, not the prototype URL. Uses only isolated
// native Chrome profiles; never captures/overwrites the prior design evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { build } from '../tools/build-release.mjs';
import { browser, until } from './browser.mjs';

async function fixture(t,{cameraBaseline}={}) {
  const tmp=await mkdtemp(join(tmpdir(),'kotr-home-'));
  const out=process.env.KOTR_INTEGRATION_BUILD||join(tmp,'public'),cleanup=[];
  let server;
  t.after(async()=>{
    for (const close of cleanup.reverse()) await close();
    server?.closeAllConnections();
    if (server) await new Promise(resolve=>server.close(resolve));
    await rm(tmp,{recursive:true,force:true});
  });
  if(!process.env.KOTR_INTEGRATION_BUILD)await build('.',out);
  const names=(await readdir(out,{recursive:true})).filter(p=>extname(p));
  const files=new Map(await Promise.all(names.map(async p=>[p,await readFile(join(out,p))])));
  if(cameraBaseline) {
    // Explicit negative control: serve the prior adapter body under this test
    // artifact's import graph. Never modify source, the checkout or a release.
    let old=execFileSync('git',['show',`${cameraBaseline}:js/route-terrain-view.mjs`],{encoding:'utf8'});
    const path=names.find(p=>/^js\/route-terrain-view\./.test(p)),current=files.get(path).toString();
    assert.ok(old.includes('export async function mountRouteTerrain'));
    const imports=new Map([...current.matchAll(/await import\('([^']+)'\)/g)].map(([,path])=>
      [path.replace(/\.[a-f0-9]{24}(?=\.)/,''),path]));
    old=old.replace(/await import\('([^']+)'\)/g,(_,path)=>{
      assert.ok(imports.has(path),`Baseline dependency not in built graph: ${path}`);
      return `await import('${imports.get(path)}')`;
    });
    files.set(path,Buffer.from(current.slice(0,current.indexOf('export async function mountRouteTerrain'))+
      old.slice(old.indexOf('export async function mountRouteTerrain'))));
  }
  const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript',
    '.css':'text/css','.json':'application/json','.gpx':'application/xml'};
  const requests=[],fault={path:null,bytes:null};
  server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost'),path=url.pathname.slice('/kotr27/'.length)||'index.html';
    requests.push({path,referrer:req.headers.referer});
    if (!url.pathname.startsWith('/kotr27/') || !files.has(path)) return res.writeHead(404).end();
    if (fault.path===path) {
      const bytes=fault.bytes;
      if (fault.delayMs) await sleep(fault.delayMs);
      return res.writeHead(bytes?200:503,{'Content-Type':types[extname(path)]}).end(bytes);
    }
    res.writeHead(200,{'Content-Type':types[extname(path)],'Cache-Control':'no-store'}).end(files.get(path));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  return {base:`http://127.0.0.1:${server.address().port}/kotr27/`,files,requests,fault,
    chrome:(events)=>browser({after:fn=>cleanup.push(fn)},events)};
}
const ready=b=>until(()=>b.js(`document.getElementById('fly')?.disabled===false`));
const click=(b,id)=>b.js(`document.getElementById('${id}').click()`);
const select=(b,id,value)=>b.js(`document.getElementById('${id}').value=${JSON.stringify(value)};
  document.getElementById('${id}').dispatchEvent(new Event('change'))`);
const routes=[
  ['rwgps-57874121','D0 Warm-up','19.7'],['rwgps-57873183','D1 Vicentine Hills','67.0'],
  ['rwgps-57874024','D1 Vicentine Hills','86.7'],['rwgps-57873112','D2 Asolo','57.6'],
  ['rwgps-57873019','D2 Monte Grappa','63.2'],['rwgps-57874050','D3 Brentha Valley','53.5'],
  ['rwgps-57874076','D3 Brentha Valley','85.3'],
];
const seek = (b,value)=>b.js(`document.getElementById('seek').value=${value};
  document.getElementById('seek').dispatchEvent(new Event('input'))`);
// A valid proof exists on the render event, then the next follow frame marks it
// stale. Observe that event instead of aliasing the 200ms proof cadence with a
// 500ms poll. No visibility/readiness/camera override.
async function currentTerrain(b) {
  const r=await b.cmd('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`new Promise((resolve,reject)=>{
    const el=document.getElementById('terrain');
    let timer;const observer=new MutationObserver(check);
    function done(error,p){observer.disconnect();clearTimeout(timer);error?reject(Error(error)):resolve(p);}
    function check(){
      const p=JSON.parse(el.dataset.frame||'{}');
      if(p.ok && p.current && p.distanceM===Number(el.dataset.distance) &&
          document.getElementById('player').classList.contains('online'))done(null,p);
      else if(document.getElementById('terrain-status').textContent.includes('unavailable'))
        done(document.getElementById('terrain-status').textContent+' '+JSON.stringify(p));
    }
    observer.observe(el,{attributes:true,attributeFilter:['data-frame']});
    timer=setTimeout(()=>done('No current rendered terrain proof'),14000);check();
  })`});
  assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;
}

// Public-map-only, bounded diagnostics. Never record credentials/query strings,
// private geometry, or rewrite an SDK result. Keep the final pre-disposal state.
function observeTerrainDeadlines() {
  const start=window.setTimeout,clear=window.clearTimeout,pending=new Map();
  window.terrainDeadlines=[];
  const record=event=>{terrainDeadlines.push({at:performance.now(),...event});
    if(terrainDeadlines.length>128)terrainDeadlines.shift();};
  window.setTimeout=function(fn,ms,...args) {
    if(typeof fn!=='function'||![2500,12000].includes(ms)||
      !new Error().stack.includes('route-terrain-view'))return start.call(this,fn,ms,...args);
    const id=start.call(this,function(...a){pending.delete(id);record({type:'fire',id,ms});return fn.apply(this,a);},ms,...args);
    pending.set(id,ms);record({type:'start',id,ms});return id;
  };
  window.clearTimeout=function(id){
    if(pending.has(id)){record({type:'clear',id,ms:pending.get(id)});pending.delete(id);}
    return clear.call(this,id);
  };
}

function observeTerrainEntry(m,version) {
  window.terrainEntries??=[];
  const record={created:performance.now(),events:[],states:[],queries:[]};
  terrainEntries.push(record);
  const push=(list,value,limit)=>{list.push(value);if(list.length>limit)list.shift();};
  const event=(type,detail={})=>push(record.events,{at:performance.now(),type,...detail},512);
  const snapshot=reason=>{
    try {
      const el=document.getElementById('terrain'),p=m.getFreeCameraOptions().position,ll=p.toLngLat();
      const sources=['dem','rider-dem','rider-satellite'].map(id=>{
        const c=m.style?._otherSourceCaches?.[id],source=m.getSource(id);
        const tiles=Object.values(c?._tiles??{}).map(t=>({
          id:t.tileID.canonical,state:t.state,uses:t.uses,aborted:!!t.aborted,
          dem:!!t.dem,demUid:t.dem?.uid,uid:t.uid,texture:!!t.demTexture,
          needsUpload:t.needsDEMTextureUpload,requested:t.timeAdded,
        }));
        return {id,exists:!!source,loaded:c?._sourceLoaded,paused:c?._paused,tiles};
      });
      push(record.states,{at:performance.now(),reason,
        center:m.getCenter().toArray(),zoom:m.getZoom(),pitch:m.getPitch(),
        moving:m.isMoving(),zooming:m.isZooming(),terrain:m.getTerrain(),
        activeDEM:m.painter?.terrain?.sourceCache?.getSource()?.id,
        // Do not add a diagnostic elevation query: the SDK memoizes lookups.
        // Observe the application's returned queries below, without priming it.
        position:ll,altitude:p.toAltitude(),lastQuery:record.queries.at(-1),
        camera:JSON.parse(el.dataset.camera||'{}'),pose:JSON.parse(el.dataset.pose||'{}'),
        proof:JSON.parse(el.dataset.frame||'{}'),sources,
        status:document.getElementById('terrain-status').textContent},80);
    } catch {event('snapshot-unavailable',{reason});}
  };
  for(const name of ['jumpTo','setTerrain','setMaxZoom']) {
    const fn=m[name];
    m[name]=function(...args) {
      event(name,{argument:args[0]});
      return fn.apply(this,args);
    };
  }
  const query=m.queryTerrainElevation;
  m.queryTerrainElevation=function(point,...args) {
    const height=query.call(this,point,...args);
    if(!window.entryQueryTrace)return height;
    const stack=new Error().stack;
    const stage=stack.includes('riderGeometry')?'geometry':stack.includes('riderOrbit')?'orbit':null;
    if(stage) {
      const xy=m.project(point);
      push(record.queries,{at:performance.now(),stage,point,height,pixel:xy,
        viewport:{width:m.getCanvas().clientWidth,height:m.getCanvas().clientHeight},
        activeDEM:m.painter?.terrain?.sourceCache?.getSource()?.id},256);
    }
    return height;
  };
  for(const name of ['sourcedataloading','sourcedata','idle','error'])m.on(name,e=>{
    event(name,{sourceId:e.sourceId,dataType:e.sourceDataType,loaded:e.isSourceLoaded,
      tile:e.coord?.canonical,error:e.error?{name:e.error.name,status:e.error.status}:undefined});
    if(name==='error'||e.sourceId==='rider-dem')snapshot(name);
  });
  let last=-Infinity;
  m.on('render',()=>{
    if(performance.now()-last<200)return;
    last=performance.now();snapshot('render');
  });
  const remove=m.remove;
  m.remove=function(...args){snapshot('before-remove');event('remove');return remove.apply(this,args);};
}

function publicNetworkTrace() {
  const requests=new Map();
  return {requests,onEvent(e) {
    const p=e.params;
    if(e.method==='Network.requestWillBeSent' && /^https?:/.test(p.request.url)) {
      const u=new URL(p.request.url);
      requests.set(p.requestId,{path:u.origin+u.pathname,start:p.timestamp,wall:p.wallTime,type:p.type});
      if(requests.size>8000)requests.delete(requests.keys().next().value);
    }
    const r=requests.get(p?.requestId);if(!r)return;
    if(e.method==='Network.responseReceived')Object.assign(r,{response:p.timestamp,status:p.response.status,
      cached:p.response.fromDiskCache||p.response.fromServiceWorker});
    if(e.method==='Network.loadingFinished')Object.assign(r,{finished:p.timestamp,bytes:p.encodedDataLength});
    if(e.method==='Network.loadingFailed')Object.assign(r,{failed:p.timestamp,error:p.errorText,canceled:p.canceled});
  }};
}

async function installRiderSampler(b,f) {
  const path=[...f.files.keys()].find(p=>/^js\/route-flyover\.[a-f0-9]+\.mjs$/.test(p));
  assert.ok(path);
  await b.js(`(async()=>{const helpers=await import(${JSON.stringify(f.base+path)});
    window.riderSampler=helpers.riderTerrainElevation;window.riderRaster=helpers.riderRasterEvidence;})()`);
}
async function observeRasterCoverage(b) {
  await b.js(`(()=>{
    const m=observedTerrain;
    let strict;
    window.rasterMismatches??=[];
    m.on('render',()=>{
      const tr=m.painter?.terrain;
      if(!tr?.proxyCoords || performance.now()-(window.lastRaster?.at||0)<200)return;
      if(!strict && m.getSource('rider-satellite'))strict=kotrTerrainTools.rasterCoverage(m);
      const proof=JSON.parse(document.getElementById('terrain').dataset.frame||'{}');
      window.lastRaster={at:performance.now(),strict:strict?.(),visible:proof.raster,proxies:tr.proxyCoords.map(p=>({
        id:p.canonical,wrap:p.wrap,layers:m.getStyle().layers.filter(l=>l.type==='raster'&&l.layout?.visibility!=='none').map(l=>{
          const c=m.style._getSourceCache(l.source);
          return {source:l.source,tiles:(tr.proxyToSource[p.key]?.[c.id]||[]).map(id=>({
            id:id.canonical,wrap:id.wrap,texture:!!c.getTile(id)?.texture}))};
        })}))};
      if(proof.current && performance.now()-proof.at<10 && proof.raster?.ok && lastRaster.strict===false && rasterMismatches.length<20)
        rasterMismatches.push({distance:proof.distanceM,geometrySha256:proof.geometrySha256,...lastRaster});
    });return true;
  })()`);
}
test('Rider resource qualification: explicit paused full-route seeks, not a playback-duration claim',async t=>{
  const f=await fixture(t),b=await f.chrome();
  await b.cmd('Page.enable');
  await b.cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await b.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
    Object.defineProperty(window,'mapboxgl',{configurable:true,set(gl){
      Object.defineProperty(window,'mapboxgl',{value:gl,configurable:true});
      gl.Map=new Proxy(gl.Map,{construct(T,args){return window.observedTerrain=new T(...args);}});
    }});`});
  await b.cmd('Page.navigate',{url:f.base});await ready(b);
  await installRiderSampler(b,f);
  await click(b,'fly');await currentTerrain(b);
  const evidence=[];
  try {
    for(const id of ['rwgps-57873019','rwgps-57873112'].filter(id=>!process.env.RIDER_RESOURCE_ROUTE || id===process.env.RIDER_RESOURCE_ROUTE)) {
      if(id==='rwgps-57873112'){await select(b,'player-route',id);await ready(b);await currentTerrain(b);}
      await observeRasterCoverage(b);
      await click(b,'view-rider');await currentTerrain(b);
      for(let i=0;i<=512;i++) {
        await seek(b,Math.round(i*1000/512));
        const proof=await currentTerrain(b);
        const resources=await b.js(`({requests:Number(document.getElementById('terrain').dataset.requests),
          unique:Number(document.getElementById('terrain').dataset.uniqueRequests),
          playing:document.getElementById('play').getAttribute('aria-label')==='Pause route preview'})`);
        evidence.push({id,i,distance:proof.distanceM,clearance:proof.clearance,...resources});
        assert.equal(resources.playing,false);
        assert.equal(proof.mode,'rider');assert.ok(proof.elevation&&proof.road);
      }
      t.diagnostic(JSON.stringify(evidence.at(-1)));
    }
  } finally {
    const dir=process.env.RIDE_EXPLORER_EVIDENCE_DIR;
    if(dir){await mkdir(dir,{recursive:true});await writeFile(join(dir,'resource-traversal.json'),JSON.stringify(evidence,null,2));
      await writeFile(join(dir,'resource-traversal-last.json'),JSON.stringify(await b.js(`({
        frame:JSON.parse(document.getElementById('terrain').dataset.frame||'{}'),
        camera:JSON.parse(document.getElementById('terrain').dataset.camera||'{}'),raster:window.lastRaster,
        mismatches:window.rasterMismatches})`),null,2));}
    await screenshot(b,'resource-traversal-last');
  }
});
test('pinned DEM boundary lifecycle diagnostic',async t=>{
  const f=await fixture(t),b=await f.chrome();
  await b.cmd('Page.enable');
  await b.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
    Object.defineProperty(window,'mapboxgl',{configurable:true,set(gl){
      Object.defineProperty(window,'mapboxgl',{value:gl,configurable:true});
      gl.Map=new Proxy(gl.Map,{construct(T,args){return window.observedTerrain=new T(...args);}});
    }});`});
  await b.cmd('Page.navigate',{url:f.base});await ready(b);
  await installRiderSampler(b,f);
  await click(b,'fly');await currentTerrain(b);await seek(b,214);await currentTerrain(b);
  await click(b,'view-rider');await currentTerrain(b);
  await b.js(`window.boundary=[];
    observedTerrain.on('render',()=>{
      const m=observedTerrain,p=m.getFreeCameraOptions().position,ll=p.toLngLat(),ground=m.queryTerrainElevation(ll);
      if(boundary.length>=1200)return;
      const terrain=m.painter.terrain,cache=terrain.sourceCache,source=cache.getSource();
      const candidates=[...Object.values(cache._tiles).map(tile=>({tile,where:'active'})),
        ...Object.values(cache._cache.data).flat().map(x=>({tile:x.value,where:'cache'}))];
      const tiles=candidates.filter(({tile})=>{
        const c=tile.tileID.canonical,n=2**c.z;
        return Math.floor(p.x*n)===c.x && Math.floor(p.y*n)===c.y;
      }).map(({tile,where})=>{
        const c=tile.tileID.canonical,n=2**c.z,dem=tile.dem;
        const x=(p.x*n-c.x)*dem.dim,y=(p.y*n-c.y)*dem.dim,i=Math.floor(x),j=Math.floor(y);
        const q=[dem.get(i,j),dem.get(i+1,j),dem.get(i,j+1),dem.get(i+1,j+1)];
        const sampled=(q[0]*(1-x+i)+q[1]*(x-i))*(1-y+j)+(q[2]*(1-x+i)+q[3]*(x-i))*(y-j);
        return {where,id:c,uid:tile.uid,demUid:dem.uid,state:tile.state,uses:tile.uses,
          aborted:tile.aborted,expirationTime:tile.expirationTime,dim:dem.dim,x,y,q,sampled,
          texture:!!tile.demTexture,needsUpload:tile.needsDEMTextureUpload,
          bound:Object.values(terrain.terrainTileForTile).includes(tile)};
      });
      boundary.push({at:performance.now(),adapter:riderSampler(m,ll,mapboxgl.version),
        distance:Number(document.getElementById('cockpit').dataset.distance),
        ground,altitude:p.toAltitude(),tiles,source:{id:source.id,url:source.url,maxzoom:source.maxzoom},
        activeSource:m.getTerrain().source,sourceSame:m.getSource(m.getTerrain().source)===source});
    });void 0;`);
  await click(b,'play');await sleep(6000);await click(b,'play');
  const result=await b.js('boundary');
  const dir=process.env.RIDE_EXPLORER_EVIDENCE_DIR;
  if(dir){await mkdir(dir,{recursive:true});await writeFile(join(dir,'dem-boundary.json'),JSON.stringify(result,null,2));}
  t.diagnostic(JSON.stringify(result.filter(p=>p.ground===null)));
  assert.ok(result.some(p=>p.ground===null),'Reproduce the exact public-query miss');
  for(const p of result) {
    assert.ok(p.adapter && Number.isFinite(p.adapter.height));
    const tile=p.tiles.find(t=>t.id.z===14);
    if(tile) assert.ok(Math.abs(tile.sampled-p.adapter.height)<1e-6,'Independent raw-texel sampler parity');
    assert.ok(p.altitude-p.adapter.height>=1.5);
  }
});

test('built Rider entry ordering: actual Asolo DEM metadata and tile arrivals retain strict proof',async t=>{
  for(const [kind,delay,cold] of [['metadata',0],['metadata',600],['tile',600],['satellite',600],
    ['metadata',0,true],['tile',600,true],['history',0],['history',0,true],
    ['metadata',3500],['tile',3500],['metadata',13000]].filter(([kind,delay])=>
      !process.env.RIDER_ENTRY_CASE||process.env.RIDER_ENTRY_CASE===`${kind}:${delay}`)) {
    await t.test(`${kind} +${delay}ms${cold?' uncached':''}`,async t=>{
      const f=await fixture(t);
      let entering=false,outcome,failure;
      const trace=publicNetworkTrace(),holds=[],jobs=new Set(),protocolErrors=[];
      const b=await f.chrome((e,cmd)=>{
        trace.onEvent(e);
        if(e.method!=='Fetch.requestPaused')return;
        const p=e.params,u=new URL(p.request.url),path=u.origin+u.pathname;
        const selected=entering && (kind==='metadata'?/terrain-dem-v1\.json$/.test(path):
          kind==='tile'?/terrain-dem-v1\/14\//.test(path):/mapbox\.satellite/.test(path));
        const row={path,at:Date.now(),status:p.responseStatusCode,delay:selected?delay:0};
        holds.push(row);
        const job=(async()=>{
          if(selected)await sleep(delay);
          await cmd('Fetch.continueRequest',{requestId:p.requestId});
          row.released=Date.now();
        })().catch(e=>protocolErrors.push(e.message)).finally(()=>jobs.delete(job));
        jobs.add(job);
      });
      await b.cmd('Page.enable');
      await b.cmd('Network.enable');
      if(cold)await b.cmd('Network.setCacheDisabled',{cacheDisabled:true});
      await b.cmd('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
      await b.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
        (${observeTerrainDeadlines.toString()})();
        window.observeTerrainEntry=${observeTerrainEntry.toString()};
        Object.defineProperty(window,'mapboxgl',{configurable:true,set(gl){
          Object.defineProperty(window,'mapboxgl',{value:gl,configurable:true});
          gl.Map=new Proxy(gl.Map,{construct(T,args){
            const m=window.observedTerrain=new T(...args);observeTerrainEntry(m,gl.version);return m;
          }});
        }});`});
      try {
        await b.cmd('Page.navigate',{url:f.base});await ready(b);
        await click(b,'fly');await currentTerrain(b);
        if(kind==='history') {
          await seek(b,190);await currentTerrain(b);
          await click(b,'view-rider');await currentTerrain(b);
          for(const target of [222,800,190,310,350]) {
            await seek(b,target);await currentTerrain(b);
          }
          await click(b,'view-aerial');await currentTerrain(b);
        }
        await select(b,'player-route','rwgps-57873112');await ready(b);await currentTerrain(b);
        await seek(b,210);await currentTerrain(b);
        // Intercept only the explicit entry's selected real resources, never
        // disposed-map requests during the preceding Grappa scene history.
        if(delay)await b.cmd('Fetch.enable',{patterns:[{urlPattern:kind==='metadata'?
          '*mapbox.mapbox-terrain-dem-v1.json*':kind==='tile'?
          '*mapbox.mapbox-terrain-dem-v1/14/8730/5842.*':'*mapbox.satellite/18/139691/93475.*',
          requestStage:'Response'}]});
        const deadlineStart=await b.js('terrainDeadlines.length');
        entering=true;await b.js(`entryQueryTrace=true;
          window.entryPresentation=[];
          window.entryPresentationObserver=new MutationObserver(()=>{
            const el=document.getElementById('terrain'),p=JSON.parse(el.dataset.frame||'{}');
            entryPresentation.push({at:performance.now(),
              online:document.getElementById('player').classList.contains('online'),
              visibility:getComputedStyle(el).visibility,ok:p.ok,current:p.current});
            if(entryPresentation.length>256)entryPresentation.shift();
          });
          entryPresentationObserver.observe(document.getElementById('player'),
            {attributes:true,attributeFilter:['class']});
          entryPresentationObserver.observe(document.getElementById('terrain'),
            {attributes:true,attributeFilter:['style','data-frame']});`);
        await click(b,'view-rider');
        if(delay>12000) {
          const r=await b.cmd('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`
            new Promise((resolve,reject)=>{
              const el=document.getElementById('terrain-status');
              const observer=new MutationObserver(check);
              const timeout=setTimeout(()=>{observer.disconnect();reject(Error('Entry exceeded its finite deadline'));},14000);
              function check(){
                if(!el.textContent.includes('unavailable'))return;
                observer.disconnect();clearTimeout(timeout);
                resolve({at:performance.now(),status:el.textContent,
                  online:document.getElementById('player').classList.contains('online'),
                  visibility:getComputedStyle(document.getElementById('terrain')).visibility});
              }
              observer.observe(el,{childList:true,subtree:true,characterData:true});check();
            })`});
          assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));
          outcome=r.result.value;
          assert.match(outcome.status,/Selected Rider terrain.*12 seconds/);
          assert.equal(outcome.online,false);assert.equal(outcome.visibility,'hidden');
          await Promise.all([...jobs]);await sleep(300);
          assert.equal(await b.js(`document.getElementById('player').classList.contains('online')`),false,
            'Late actual provider arrival cannot resurrect terminal entry');
        } else {
          const proof=await currentTerrain(b);
          outcome=proof;
          assert.equal(proof.mode,'rider');assert.equal(proof.located,true);
          assert.ok(proof.elevation&&proof.road&&proof.imagery);
        }
        await b.js('entryPresentationObserver.disconnect()');
        const presentation=await b.js('entryPresentation');
        assert.ok(presentation.some(p=>!p.online&&p.visibility==='hidden'),'New entry is honestly 2D before proof');
        assert.ok(presentation.every(p=>!p.online || p.ok),'Never publish an unproved entry');
        const deadlines=(await b.js('terrainDeadlines')).slice(deadlineStart);
        const start=deadlines.find(p=>p.type==='start');
        assert.ok(start);assert.equal(start.ms,12000);
        const end=deadlines.find(p=>p.id===start.id&&p.type===(delay>12000?'fire':'clear'));
        assert.ok(end);
        assert.equal(deadlines.filter(p=>p.type==='start'&&p.at<=end.at).length,1,
          'One acquisition, never renewed by frame/tile traffic');
        if(delay>12000)assert.ok(end.at-start.at>=11999&&end.at-start.at<13500);
        // The selected DEM gates entry geometry. One high-resolution imagery
        // refinement does not: already-bound real parent imagery can satisfy
        // the unchanged rendered-pixel proof before that refinement arrives.
        else if(delay && kind!=='satellite')assert.ok(end.at-start.at>=delay);
        if(delay)assert.ok(holds.some(r=>r.delay===delay),'The intended real response was actually held');
        assert.deepEqual(b.exceptions,[]);
      } catch(error) {
        failure=error.message;throw error;
      } finally {
        await Promise.all([...jobs]);
        const dir=process.env.RIDE_EXPLORER_EVIDENCE_DIR;
        if(dir) {
          await mkdir(dir,{recursive:true});
          await writeFile(join(dir,`entry-order-${kind}-${delay}${cold?'-uncached':''}.json`),JSON.stringify({
            network:[...trace.requests.values()],holds,outcome,failure,protocolErrors,
            deadlines:await b.js('terrainDeadlines'),
            presentation:await b.js('window.entryPresentation'),
            entries:await b.js('terrainEntries'),timeOrigin:await b.js('performance.timeOrigin')},null,2));
        }
        if(!failure)assert.deepEqual(protocolErrors,[]);
      }
    });
  }
});

test('built Asolo Rider DEM handoff: current sampled geometry never freezes behind the moving rider',async t=>{
  const f=await fixture(t),b=await f.chrome();
  await b.cmd('Page.enable');
  await b.cmd('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:false});
  await b.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.demMisses=[];window.cameraFrames=[];
    Object.defineProperty(window,'mapboxgl',{configurable:true,set(gl){
      Object.defineProperty(window,'mapboxgl',{value:gl,configurable:true});
      gl.Map=new Proxy(gl.Map,{construct(T,args){
        const m=window.observedTerrain=new T(...args),query=m.queryTerrainElevation;
        let probing=false;
        m.queryTerrainElevation=function(p,...rest){
          const value=query.call(this,p,...rest);
          if(value===null && !probing && window.riderSampler && demMisses.length<1000) {
            probing=true;
            try {demMisses.push({at:performance.now(),point:p,fallback:riderSampler(m,p,gl.version)});}
            finally {probing=false;}
          }
          return value;
        };
        m.on('render',()=>{
          if(!window.sampling)return;
          const el=document.getElementById('terrain'),pos=m.getFreeCameraOptions().position;
          cameraFrames.push({at:performance.now(),bearing:m.getBearing(),
            position:pos.toLngLat(),camera:JSON.parse(el.dataset.camera||'{}'),
            distance:Number(document.getElementById('cockpit').dataset.distance),
            hidden:getComputedStyle(el).visibility!=='visible'});
        });return m;
      }});
    }});`});
  await b.cmd('Page.navigate',{url:f.base});await ready(b);
  await installRiderSampler(b,f);
  await click(b,'fly');await currentTerrain(b);
  await select(b,'player-route','rwgps-57873112');await ready(b);await currentTerrain(b);
  assert.equal(await b.js(`document.getElementById('player-route').value`),'rwgps-57873112');
  // Approach through the preceding DEM tiles: a direct seek past them does
  // not exercise the active→cached tile handoff observed during playback.
  await seek(b,210);await currentTerrain(b);
  await click(b,'view-rider');await currentTerrain(b);
  await b.js('sampling=true;demMisses=[]');
  await click(b,'play');await sleep(35000);await currentTerrain(b);
  await b.js('sampling=false');
  const evidence=await b.js('({frames:cameraFrames,misses:demMisses})');
  const dir=process.env.RIDE_EXPLORER_EVIDENCE_DIR;
  if(dir){await mkdir(dir,{recursive:true});await writeFile(join(dir,'asolo-dem-handoff.json'),JSON.stringify(evidence,null,2));}
  t.diagnostic(JSON.stringify({frames:evidence.frames.length,misses:evidence.misses.length,
    fallbacks:evidence.misses.filter(x=>x.fallback).length,distance:evidence.frames.at(-1)?.distance}));
  assert.ok(evidence.frames.length>200);
  assert.ok(evidence.frames[0].distance<14600 && evidence.frames.at(-1).distance>14700);
  for(const frame of evidence.frames) {
    assert.equal(frame.hidden,false);
    assert.equal(frame.camera.view,'rider',JSON.stringify(frame));
    assert.equal(frame.camera.riderDistanceM,frame.distance);
    assert.ok(Math.abs((frame.camera.bearing-frame.bearing+540)%360-180)<.001,JSON.stringify(frame));
  }
  assert.deepEqual(b.exceptions,[]);
});

for(const playbackRate of [1,16]) for(const [width,height] of [[1440,900],[375,812]])
test(`built forward rider ${playbackRate}x ${width}: current DEM, actual camera and nearby rendered road on Grappa and Asolo`,async t=>{
  const f=await fixture(t,{cameraBaseline:process.env.RIDE_CAMERA_BASELINE});
  {
    const {requests,onEvent}=publicNetworkTrace(),b=await f.chrome(onEvent);
    await b.cmd('Page.enable');await b.cmd('Network.enable');
    await b.cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    if(width===375)await b.cmd('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
    await b.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
      (${observeTerrainDeadlines.toString()})();
      window.observeTerrainEntry=${observeTerrainEntry.toString()};
      Object.defineProperty(window,'mapboxgl',{configurable:true,set(gl){
        Object.defineProperty(window,'mapboxgl',{value:gl,configurable:true});
        gl.Map=new Proxy(gl.Map,{construct(T,args){
          const m=window.observedTerrain=new T(...args);
          observeTerrainEntry(m,gl.version);
          const actual=()=>{
            const p=m.getFreeCameraOptions().position,ll=p.toLngLat(),ground=m.queryTerrainElevation(ll);
            return {scale:m.transform.worldSize,zoom:m.getZoom(),altitude:p.toAltitude(),ground,
              clearance:Number.isFinite(ground)?p.toAltitude()-ground:null,
              distance:Number(document.getElementById('terrain').dataset.distance)};
          };
          // Read before the captured listener and at its input mutation's
          // microtask checkpoint, after synchronous camera handling. A queued
          // microtask in this earlier listener would run BEFORE that handler.
          // Same rider position: later zoom includes terrain-orbit movement.
          let pendingWheel=false;
          const inputObserver=new MutationObserver(()=>{
            if(pendingWheel) {
              window.riderWheelEvidence.after=actual();pendingWheel=false;
            }
          });
          inputObserver.observe(document.getElementById('terrain'),{attributes:true,attributeFilter:['data-input']});
          m.on('remove',()=>inputObserver.disconnect());
          m.getCanvasContainer().addEventListener('wheel',e=>{
            window.riderWheelEvidence={trusted:e.isTrusted,before:actual()};pendingWheel=true;
          },{capture:true});
          return m;
        }});
      }});`});
    await b.cmd('Page.navigate',{url:f.base});await ready(b);
    await installRiderSampler(b,f);
    await select(b,'playback-rate',String(playbackRate));
    const pointer=async id=>{
      const p=await b.js(`(()=>{
        const el=document.getElementById('${id}'),r=el.getBoundingClientRect();
        return {x:r.x+r.width/2,y:r.y+r.height/2,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),
          width:r.width,height:r.height,disabled:el.disabled};
      })()`);
      assert.ok(p.hit && !p.disabled && p.width>=44 && p.height>=44,JSON.stringify({id,...p}));
      await b.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});
      await b.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});
    };
    const state=()=>b.js(`({playing:document.getElementById('play').getAttribute('aria-label')==='Pause route preview',
      ...document.getElementById('cockpit').dataset,rate:document.getElementById('playback-rate').value,
      zoom:observedTerrain.getZoom(),scale:observedTerrain.transform.worldSize,pitch:observedTerrain.getPitch(),
      proof:JSON.parse(document.getElementById('terrain').dataset.frame||'{}'),
      camera:JSON.parse(document.getElementById('terrain').dataset.camera||'{}')})`);
    try {
    await pointer('fly');await currentTerrain(b);
    for (const [route,target,label] of [
      ['rwgps-57873019',190,'grappa-lower'],['rwgps-57873019',310,'grappa-upper'],
      ['rwgps-57873112',210,'asolo'],
    ].filter(row=>!process.env.RIDER_REGION || row[2]===process.env.RIDER_REGION)) {
      if(label==='asolo') {await select(b,'player-route',route);await ready(b);await currentTerrain(b);}
      await seek(b,process.env.RIDER_SEEK?Number(process.env.RIDER_SEEK):target);await currentTerrain(b);
      const paused=await state();
      await b.js('entryQueryTrace=true');
      await pointer('view-rider');
      try {await currentTerrain(b);} catch(e) {
        await screenshot(b,`rider-${playbackRate}x-${width}-${label}-failed`);
        t.diagnostic(JSON.stringify(await state()));throw e;
      }
      await b.js('entryQueryTrace=false');
      if(process.env.RIDE_EXPLORER_EVIDENCE_DIR) {
        await mkdir(process.env.RIDE_EXPLORER_EVIDENCE_DIR,{recursive:true});
        await writeFile(join(process.env.RIDE_EXPLORER_EVIDENCE_DIR,
          `entry-${playbackRate}x-${width}-${label}.json`),JSON.stringify({
            network:[...requests.values()],entry:await b.js('terrainEntries.at(-1)'),
            deadlines:await b.js('terrainDeadlines'),
            timeOrigin:await b.js('performance.timeOrigin')},null,2));
      }
      assert.equal((await state()).distance,paused.distance);
      assert.equal((await state()).playing,false);
      assert.equal((await state()).proof.mode,'rider','Old aerial implementation must fail');
      t.diagnostic(JSON.stringify({width,label,detail:await b.js(`(()=>{
        const m=observedTerrain,s=m.style._otherSourceCaches['rider-satellite'];
        const p=m.getFreeCameraOptions().position;
        const loaded=Object.values(s._tiles).filter(t=>t.state==='loaded').map(t=>t.tileID.canonical);
        const near=loaded.filter(c=>Math.floor(p.x*2**c.z)===c.x&&Math.floor(p.y*2**c.z)===c.y);
        return {sourceMax:m.getSource('rider-satellite').maxzoom,loaded:loaded.length,near,
          proxyMax:Math.max(...m.painter.terrain.proxyCoords.map(c=>c.canonical.z))};
      })()`)}));
      await screenshot(b,`rider-${playbackRate}x-${width}-${label}-paused`);
      await b.js(`(()=>{
        const el=document.getElementById('terrain'),map=observedTerrain;
        window.riderEvidence={frames:[],proofs:[],hidden:0};
        const render=()=>{
          const pos=map.getFreeCameraOptions().position,ll=pos.toLngLat(),publicGround=map.queryTerrainElevation(ll);
          const terrain=riderSampler(map,ll,mapboxgl.version),ground=terrain?.height ?? null;
          const c=JSON.parse(el.dataset.camera||'{}');
          riderEvidence.frames.push({at:performance.now(),pose:JSON.parse(el.dataset.pose||'{}'),
            camera:{bearing:c.bearing,target:c.target,yawRate:c.yawRate,pitch:c.pitch,position:c.position,
              altitude:c.altitude,ground:c.ground,orbit:c.orbit},altitude:pos.toAltitude(),ground,publicGround,terrain,
            clearance:Number.isFinite(ground)?pos.toAltitude()-ground:null,pitch:map.getPitch(),bearing:map.getBearing(),
            distance:Number(document.getElementById('cockpit').dataset.distance)});
          if(getComputedStyle(el).visibility!=='visible')riderEvidence.hidden++;
        };map.on('render',render);
        const observer=new MutationObserver(()=>{
          const p=JSON.parse(el.dataset.frame||'{}');if(p.current)riderEvidence.proofs.push(p);
        });observer.observe(el,{attributes:true,attributeFilter:['data-frame']});
        riderEvidence.dispose=()=>{map.off('render',render);observer.disconnect();};
      })()`);
      await pointer('play');
      await sleep(1500);
      const approach=await state();
      await screenshot(b,`rider-${playbackRate}x-${width}-${label}-approach`);
      assert.equal(approach.proof.road,true,JSON.stringify({message:'Forward approach must not be a blank hillside',
        distance:approach.distance,bearing:approach.camera.bearing,target:approach.camera.target}));
      t.diagnostic(JSON.stringify({width,label,refinedImagery:await b.js(`(()=>{
        const m=observedTerrain,p=m.getFreeCameraOptions().position,s=m.style._otherSourceCaches['rider-satellite'];
        return Object.values(s._tiles).filter(t=>t.state==='loaded').map(t=>t.tileID.canonical)
          .filter(c=>Math.floor(p.x*2**c.z)===c.x&&Math.floor(p.y*2**c.z)===c.y);
      })()`)}));
      await sleep(process.env.RIDER_SEEK?4500:playbackRate===1?24500:58500);await currentTerrain(b);
      const moving=await state();
      assert.equal(moving.playing,true);
      assert.ok(Number(moving.distance)>Number(paused.distance));
      await pointer('zoom-nearer');await currentTerrain(b);
      const close=await state();assert.equal(close.playing,true);
      assert.ok(close.camera.clearance<moving.camera.clearance);
      await sleep(3000);await currentTerrain(b);
      await screenshot(b,`rider-${playbackRate}x-${width}-${label}-moving`);
      await pointer('zoom-farther');await currentTerrain(b);
      assert.equal((await state()).playing,true);
      // Bounded observation transfer: serializing tens of thousands of nested
      // samples in one CDP request itself blocks RAF and trips the honest
      // no-catch-up clock. Never change the clock to accommodate the observer.
      const counts=await b.js(`riderEvidence.dispose();({frames:riderEvidence.frames.length,
        proofs:riderEvidence.proofs.length,hidden:riderEvidence.hidden})`);
      const evidence={frames:[],proofs:[],hidden:counts.hidden};
      for(const key of ['frames','proofs'])for(let i=0;i<counts[key];i+=key==='frames'?400:20)
        evidence[key].push(...await b.js(`riderEvidence.${key}.slice(${i},${i+(key==='frames'?400:20)})`));
      const dir=process.env.RIDE_EXPLORER_EVIDENCE_DIR;
      if(dir)await writeFile(join(dir,`rider-${playbackRate}x-${width}-${label}.json`),JSON.stringify(evidence,null,2));
      assert.equal(evidence.hidden,0);
      assert.ok(evidence.frames.length>60);
      assert.ok(evidence.proofs.filter(p=>p.ok && p.mode==='rider').length>10);
      assert.deepEqual(evidence.frames.filter(p=>!(p.clearance>=1.5 && p.clearance<=10 && p.pitch>=45 && p.pitch<=85.001)),[]);
      const angle=(a,b)=>((b-a+540)%360+360)%360-180,rates=[];
      for(let i=1;i<evidence.frames.length;i++) {
        const p=evidence.frames[i-1],q=evidence.frames[i],dt=(q.pose.at-p.pose.at)/1000;
        assert.ok(Math.abs(angle(q.camera.bearing,q.bearing))<.001,'Actual heading matches bounded camera, not only SDK arguments');
        if(dt>0 && dt<=.25 && q.distance>=p.distance && q.distance-p.distance<30) {
          const rate=Math.abs(angle(p.bearing,q.bearing))/dt;rates.push(rate);
          const scale=playbackRate===1?1:4;
          assert.ok(rate<=360*scale+.01,JSON.stringify({p,q,rate}));
          assert.ok(Math.abs(q.camera.yawRate-p.camera.yawRate)<=3600*scale**2*dt+.01,'Actual consecutive pose acceleration is bounded');
        }
      }
      rates.sort((a,b)=>a-b);
      t.diagnostic(JSON.stringify({width,label,actualYaw:{maximum:rates.at(-1),p99:rates[Math.floor(rates.length*.99)]}}));
      if(label==='grappa-lower') {
        const x=width*.8,y=height*.45,before=await state();
        assert.equal(await b.js(`document.elementFromPoint(${x},${y}).tagName`),'CANVAS');
        const inputBefore=await b.js(`document.getElementById('terrain').dataset.input`);
        await b.cmd('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX:0,deltaY:-70});
        try {await until(()=>b.js(`document.getElementById('terrain').dataset.input!==${JSON.stringify(inputBefore)}`));}
        catch(e) {
          if(dir)await writeFile(join(dir,`rider-${playbackRate}x-${width}-${label}-wheel-failed.json`),JSON.stringify({before,state:await state()},null,2));
          await screenshot(b,`rider-${playbackRate}x-${width}-${label}-wheel-failed`);throw e;
        }
        await until(()=>b.js(`!observedTerrain.isZooming()`));await currentTerrain(b);
        const wheel=await state();
        assert.equal(wheel.playing,true);assert.equal(wheel.rate,before.rate);
        assert.equal(wheel.proof.geometrySha256,before.proof.geometrySha256);
        assert.ok(wheel.camera.desiredZoom>before.camera.desiredZoom,JSON.stringify({before:before.camera.desiredZoom,after:wheel.camera.desiredZoom}));
        assert.ok(wheel.proof.clearance<before.proof.clearance*.97,'Actual measured camera gets closer');
        const nativeWheel=await b.js('window.riderWheelEvidence');
        assert.equal(nativeWheel.trusted,true);
        assert.equal(nativeWheel.after.distance,nativeWheel.before.distance);
        assert.ok(nativeWheel.after.scale>nativeWheel.before.scale*1.02,JSON.stringify(nativeWheel));
        t.diagnostic(JSON.stringify({width,nativeWheel:{before:{scale:before.scale,clearance:before.proof.clearance,desired:before.camera.desiredZoom},
          after:{scale:wheel.scale,clearance:wheel.proof.clearance,desired:wheel.camera.desiredZoom}}}));
        await sleep(1000);await currentTerrain(b);
        assert.ok(Math.abs((await state()).camera.desiredZoom-wheel.camera.desiredZoom)<.001);
        await b.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
        await b.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
        const keyBefore=await state();
        await b.cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'-',code:'Minus',windowsVirtualKeyCode:189});
        await b.cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'-',code:'Minus',windowsVirtualKeyCode:189});
        await sleep(500);await currentTerrain(b);
        const keyboard=await state();
        assert.equal(keyboard.playing,true);
        assert.equal(keyboard.proof.geometrySha256,wheel.proof.geometrySha256);
        assert.ok(keyboard.camera.desiredZoom<wheel.camera.desiredZoom);
        assert.ok(keyboard.proof.clearance>keyBefore.proof.clearance*1.03,'Keyboard changes actual measured camera distance');
        await b.cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'+',code:'Equal',modifiers:2});
        await b.cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'+',code:'Equal',modifiers:2});
        await b.js(`document.getElementById('playback-rate').focus()`);
        await b.cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'-',code:'Minus'});
        await b.cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'-',code:'Minus'});
        await currentTerrain(b);
        assert.equal((await state()).camera.desiredZoom,keyboard.camera.desiredZoom,'Modified shortcuts and form focus do not zoom the camera');
        assert.equal((await state()).rate,keyboard.rate);
        let pinch;
        if(width===375) {
          const before=await state(),points=gap=>[{x:width/2-gap,y,id:1},{x:width/2+gap,y,id:2}];
          await b.cmd('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(25)});
          for(let gap=27;gap<=35;gap+=2) {
            await b.cmd('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(gap)});await sleep(35);
          }
          await b.cmd('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
          await until(()=>b.js(`!observedTerrain.isZooming()`));await currentTerrain(b);
          const after=await state();pinch={before,after};
          assert.equal(after.playing,true);
          assert.equal(after.proof.geometrySha256,before.proof.geometrySha256);
          assert.ok(after.camera.desiredZoom>before.camera.desiredZoom);
          assert.ok(after.proof.clearance<before.proof.clearance*.97,'Pinch changes actual measured camera distance');
          await sleep(700);await currentTerrain(b);
          assert.equal((await state()).camera.desiredZoom,after.camera.desiredZoom);
          // Cancellation must restore ordinary single-pointer pan, not leave
          // the public drag handler disabled or two competing zoom owners.
          await b.cmd('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(25)});
          await b.cmd('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
          assert.equal(await b.js('observedTerrain.dragPan.isEnabled()'),true);
        }
        if(dir)await writeFile(join(dir,`rider-${playbackRate}x-${width}-native-controls.json`),
          JSON.stringify({wheel:{before,after:wheel,native:nativeWheel},keyboard:{before:keyBefore,after:keyboard},pinch},null,2));
        await pointer('play');const stopped=await state();
        // A 16x switchback pause can leave bounded yaw/support damping in
        // flight. Compare distance controls at the SAME settled scene, not a
        // stale pre-pause proof while the safety lift is still coming down.
        await until(()=>b.js(`(()=>{
          const c=JSON.parse(document.getElementById('terrain').dataset.camera||'{}');
          return c.view==='rider' && Math.abs(c.yawRate)<=.1 &&
            Math.abs(((c.target-c.bearing+540)%360+360)%360-180)<=.1 &&
            Math.abs(c.pitch-c.targetPitch)<=.1 && Math.abs(c.support-c.neededSupport)<=.01;
        })()`));
        await currentTerrain(b);const paused=await state();
        assert.equal(paused.distance,stopped.distance);assert.equal(paused.seconds,stopped.seconds);
        await pointer('zoom-farther');await currentTerrain(b);
        const pausedFar=await state();
        assert.equal(pausedFar.playing,false);assert.equal(pausedFar.distance,paused.distance);
        assert.equal(pausedFar.seconds,paused.seconds);
        assert.ok(pausedFar.proof.clearance>paused.proof.clearance,
          JSON.stringify({before:paused.proof.clearance,after:pausedFar.proof.clearance}));
        await pointer('zoom-nearer');await currentTerrain(b);
        assert.ok(Math.abs((await state()).camera.desiredZoom-paused.camera.desiredZoom)<.001);
        await pointer('play');await currentTerrain(b);
        // Native pan transfers to aerial inspection, pauses, and keeps the
        // requested Rider preference for Return. Manual depth is not weakened.
        await b.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
        for(let i=1;i<=8;i++) {
          await b.cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:x-i*6,y,button:'left',buttons:1});await sleep(30);
        }
        await b.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:x-48,y,button:'left',clickCount:1});
        await until(async()=>!(await state()).playing);
        assert.equal((await currentTerrain(b)).mode,'manual');
        assert.equal(await b.js(`document.getElementById('view-rider').getAttribute('aria-pressed')`),'false');
        assert.match(await b.js(`document.getElementById('zoom-help').textContent`),/Manual exploration/);
        await pointer('return-rider');assert.equal((await currentTerrain(b)).mode,'rider');
        assert.equal(await b.js(`document.getElementById('view-rider').getAttribute('aria-pressed')`),'true');
        assert.equal((await state()).playing,false);
        assert.ok(Math.abs((await state()).camera.desiredZoom-paused.camera.desiredZoom)<.001);
        await pointer('play');await currentTerrain(b);
        await screenshot(b,`rider-${playbackRate}x-${width}-${label}-native-return`);
        await pointer('play');
        const preference=(await state()).camera.desiredZoom;
        const seeks=[];
        for(const target of [800,190]) {
          await seek(b,target);const proof=await currentTerrain(b),s=await state();
          assert.equal(s.playing,false);
          assert.equal(s.camera.desiredZoom,preference);
          assert.equal(s.camera.riderDistanceM,Number(s.distance));
          assert.equal(proof.distanceM,Number(s.distance));
          seeks.push({target,distance:proof.distanceM,cameraDistance:s.camera.riderDistanceM,
            desiredZoom:s.camera.desiredZoom,clearance:proof.clearance,position:proof.position});
          await screenshot(b,`rider-${playbackRate}x-${width}-seek-${target}`);
        }
        if(dir)await writeFile(join(dir,`rider-${playbackRate}x-${width}-seeks.json`),JSON.stringify(seeks,null,2));
        await pointer('play');await currentTerrain(b);
        const running=await state();
        await pointer('view-aerial');await currentTerrain(b);
        assert.equal((await state()).playing,true);
        await pointer('view-rider');await currentTerrain(b);
        const reentered=await state();
        assert.equal(reentered.playing,true);assert.equal(reentered.rate,running.rate);
        assert.equal(reentered.origin,running.origin);assert.equal(reentered.history,running.history);
        assert.equal(reentered.proof.geometrySha256,running.proof.geometrySha256);
        assert.equal(reentered.camera.desiredZoom,preference);
        assert.ok(Number(reentered.distance)>=Number(running.distance));
      }
      await pointer('view-aerial');await currentTerrain(b);
      const aerial=await state();
      assert.equal(aerial.playing,true);assert.equal(aerial.pitch,45);
      assert.equal(aerial.rate,moving.rate);assert.equal(aerial.proof.mode,'follow');
      await pointer('play');
      t.diagnostic(JSON.stringify({width,label,frames:evidence.frames.length,
        valid:evidence.proofs.filter(p=>p.ok).length,clearance:[Math.min(...evidence.frames.map(p=>p.clearance)),
          Math.max(...evidence.frames.map(p=>p.clearance))],distance:[evidence.frames[0].distance,evidence.frames.at(-1).distance],
        requests:await b.js(`Number(document.getElementById('terrain').dataset.requests)`),
        uniqueRequests:await b.js(`Number(document.getElementById('terrain').dataset.uniqueRequests)`)}));
    }
    assert.deepEqual(b.exceptions,[]);
    } catch(error) {
      await screenshot(b,`rider-${playbackRate}x-${width}-failure`);
      const dir=process.env.RIDE_EXPLORER_EVIDENCE_DIR;
      if(dir)await writeFile(join(dir,`rider-${playbackRate}x-${width}-failure.json`),
        JSON.stringify({state:await state(),recent:await b.js(`window.riderEvidence && ({
          frames:riderEvidence.frames.slice(-200),proofs:riderEvidence.proofs.slice(-20),hidden:riderEvidence.hidden})`)},null,2));
      if(dir)await writeFile(join(dir,`entry-${playbackRate}x-${width}-failure.json`),
        JSON.stringify({network:[...requests.values()],entries:await b.js('terrainEntries'),
          deadlines:await b.js('terrainDeadlines'),
          timeOrigin:await b.js('performance.timeOrigin')},null,2));
      t.diagnostic(JSON.stringify({failure:await state(),
        status:await b.js(`document.getElementById('terrain-status').textContent`)}));
      throw error;
    }
  }
});

test('built moving camera: trusted wheel/buttons/keyboard/pinch retain zoom and the one ride clock at desktop/375',async t=>{
  const f=await fixture(t,{cameraBaseline:process.env.RIDE_CAMERA_BASELINE});
  for(const [width,height] of [[1440,900],[375,812]]) {
    const b=await f.chrome();
    await b.cmd('Page.enable');
    await b.cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    if(width===375)await b.cmd('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2});
    await b.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
      Object.defineProperty(window,'mapboxgl',{configurable:true,set(gl){
        Object.defineProperty(window,'mapboxgl',{value:gl,configurable:true});
        gl.Map=new Proxy(gl.Map,{construct(T,args){return window.observedTerrain=new T(...args);}});
      }});`});
    await b.cmd('Page.navigate',{url:f.base});await ready(b);
    const pointer=async id=>{
      if(['main-climb','profile-close'].includes(id))
        await b.js(`document.getElementById('${id}').scrollIntoView({block:'center'})`);
      const p=await b.js(`(()=>{
        const el=document.getElementById('${id}'),r=el.getBoundingClientRect();
        return {x:r.x+r.width/2,y:r.y+r.height/2,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),
          width:r.width,height:r.height,bottom:r.bottom};
      })()`);
      assert.ok(p.hit && p.width>=44 && p.height>=44,JSON.stringify({id,...p}));
      if(id.startsWith('zoom-')) assert.ok(p.bottom<await b.js(`document.querySelector('.player-bottom').getBoundingClientRect().top`));
      await b.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});
      await b.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});
    };
    const state=()=>b.js(`({
      zoom:observedTerrain.getZoom(),scale:observedTerrain.transform.worldSize,pitch:observedTerrain.getPitch(),
      ...document.getElementById('cockpit').dataset,at:performance.now(),
      playing:document.getElementById('play').getAttribute('aria-label')==='Pause route preview',
      rate:document.getElementById('playback-rate').value,route:document.getElementById('player-route').value
    })`);
    await pointer('fly');await currentTerrain(b);
    await pointer('profile-toggle');await pointer('profile-details-toggle');await pointer('main-climb');await pointer('profile-close');
    await pointer('return-rider');await currentTerrain(b);
    const start=await state();
    assert.equal(start.zoom,12.6);
    assert.equal(start.pitch,45);
    await b.js(`(()=>{
      window.zoomEvidence={frames:[],proofs:[],inputs:[],gestures:[],hidden:0};
      const el=document.getElementById('terrain'),map=observedTerrain;
      const input=e=>{if(zoomEvidence.inputs.length<100)zoomEvidence.inputs.push({type:e.type,trusted:e.isTrusted,target:e.target.tagName});};
      for(const type of ['wheel','keydown','touchstart','click'])document.addEventListener(type,input,true);
      const render=()=>{
        const c=document.getElementById('cockpit');
        zoomEvidence.frames.push({at:performance.now(),zoom:map.getZoom(),scale:map.transform.worldSize,
          pitch:map.getPitch(),distance:Number(c.dataset.distance),seconds:Number(c.dataset.seconds),
          playing:document.getElementById('play').getAttribute('aria-label')==='Pause route preview'});
        if(getComputedStyle(el).visibility!=='visible')zoomEvidence.hidden++;
      };
      map.on('render',render);
      for(const type of ['touchstart','touchmove','touchend','zoomstart','zoomend'])
        map.on(type,e=>zoomEvidence.gestures.push({type,zoom:map.getZoom(),input:e.originalEvent?.type,
          touches:e.originalEvent?.touches?.length}));
      const observer=new MutationObserver(()=>{
        const p=JSON.parse(el.dataset.frame||'{}');
        if(p.current)zoomEvidence.proofs.push(p);
      });observer.observe(el,{attributes:true,attributeFilter:['data-frame']});
      zoomEvidence.dispose=()=>{map.off('render',render);observer.disconnect();
        for(const type of ['wheel','keydown','touchstart','click'])document.removeEventListener(type,input,true);};
    })()`);
    await pointer('play');
    const before=await state();
    assert.equal(before.playing,true);
    const x=width*.65,y=height*.45;
    assert.equal(await b.js(`document.elementFromPoint(${x},${y}).tagName`),'CANVAS');
    for(let i=0;i<5;i++) {
      await b.cmd('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX:0,deltaY:-100});
      await sleep(180);
    }
    await until(()=>b.js(`!observedTerrain.isZooming()`));
    const wheel=await state();
    assert.equal(wheel.playing,true,JSON.stringify(wheel));
    assert.ok(wheel.zoom>13.3 && wheel.zoom<=16,JSON.stringify(wheel));
    assert.ok(wheel.scale>start.scale*1.6);
    assert.equal(wheel.pitch,start.pitch);assert.equal(wheel.rate,before.rate);
    await currentTerrain(b);
    await screenshot(b,`moving-zoom-${width}-wheel`);
    await sleep(3500);
    const held=await state();
    assert.ok(Math.abs(held.zoom-wheel.zoom)<.001,'No snapback over many follow frames (SDK terrain adjustment <.001)');
    assert.equal(held.playing,true);
    assert.ok(Number(held.distance)>Number(wheel.distance));
    const rate=(Number(held.seconds)-Number(wheel.seconds))/((held.at-wheel.at)/1000);
    assert.ok(Math.abs(rate-Number(held.rate))<1,JSON.stringify({rate,selected:held.rate}));
    await pointer('zoom-farther');
    const far=await state();assert.ok(far.zoom<held.zoom-.4);assert.equal(far.playing,true);
    await pointer('zoom-nearer');
    assert.ok(Math.abs((await state()).zoom-held.zoom)<.001);
    // Focus the actual canvas by a trusted click; never Escape a native select
    // (Escape bubbles into Back on this app).
    await b.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});
    await b.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});
    await b.cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'-',code:'Minus',windowsVirtualKeyCode:189});
    await b.cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'-',code:'Minus',windowsVirtualKeyCode:189});
    await sleep(500);
    const key=await state();assert.ok(key.zoom<far.zoom);assert.equal(key.playing,true);
    if(width===375) {
      const points=gap=>[{x:width/2-gap,y,id:1},{x:width/2+gap,y,id:2}];
      await b.cmd('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(25)});
      for(let gap=30;gap<=60;gap+=5) {
        await b.cmd('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(gap)});await sleep(35);
      }
      await b.cmd('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      await until(()=>b.js(`!observedTerrain.isZooming()`));
      const pinch=await state();assert.ok(pinch.zoom>key.zoom+.5,JSON.stringify({key,pinch,
        gestures:await b.js('zoomEvidence.gestures'),inputs:await b.js('zoomEvidence.inputs')}));
      assert.equal(pinch.playing,true);
      assert.ok(await b.js(`zoomEvidence.inputs.some(e=>e.type==='touchstart' && e.trusted && e.target==='CANVAS')`));
    }
    // Buttons reach a substantially closer scale while still moving, not just
    // a paused endpoint or a DOM value claiming that the camera changed.
    for(let i=0;i<6 && (await state()).zoom<14.4;i++)await pointer('zoom-nearer');
    const closeMoving=await state();
    assert.ok(closeMoving.zoom>=14.4 && closeMoving.scale>start.scale*3.4);
    await sleep(2500);await currentTerrain(b);
    assert.equal((await state()).playing,true);
    assert.ok(Math.abs((await state()).zoom-closeMoving.zoom)<.001);
    await currentTerrain(b);
    const near=await state();
    await screenshot(b,`moving-zoom-${width}-controls`);
    const evidence=await b.js(`zoomEvidence.dispose();({...zoomEvidence,dispose:undefined})`);
    assert.equal(evidence.hidden,0);
    assert.ok(evidence.frames.length>100);
    assert.ok(evidence.frames.filter(p=>p.playing && p.zoom>13).length>60);
    assert.ok(evidence.proofs.filter(p=>p.ok && p.mode==='follow' && p.road && p.clear).length>10);
    assert.ok(evidence.inputs.filter(e=>e.type==='wheel' && e.trusted && e.target==='CANVAS').length===5);
    assert.ok(evidence.inputs.some(e=>e.type==='keydown' && e.trusted && e.target==='CANVAS'));
    const invalid=evidence.frames.filter(p=>!Number.isFinite(p.zoom) || p.zoom<10 || p.zoom>16 || Math.abs(p.pitch-45)>1e-8);
    assert.deepEqual(invalid,[],'Finite bounded zoom and unchanged pitch on every rendered frame');
    await pointer('play');const paused=await state();
    await sleep(300);assert.equal((await state()).distance,paused.distance);
    await pointer('play');await sleep(350);
    assert.ok(Math.abs((await state()).zoom-near.zoom)<.001);
    // Deliberate pan is still inspection and explicitly pauses; zoom isn't.
    await b.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});
    for(let i=1;i<=8;i++) {
      await b.cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:x-i*8,y,button:'left',buttons:1});await sleep(30);
    }
    await b.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:x-64,y,button:'left',clickCount:1});
    await until(async()=>!(await state()).playing);
    await currentTerrain(b);
    assert.match(await b.js(`document.getElementById('terrain-status').textContent`),/Manual/);
    await pointer('return-rider');assert.ok(Math.abs((await state()).zoom-near.zoom)<.001);
    await currentTerrain(b);
    // Source resolution stays fixed even at the finite closer bound.
    // Cover the entire 10..16 range plus fractional native zoom, not an
    // assumed integer starting point after the SDK's terrain adjustment.
    for(let i=0;i<16;i++) {
      if(await b.js(`document.getElementById('zoom-nearer').disabled`))break;
      await pointer('zoom-nearer');
    }
    assert.ok(Math.abs((await state()).zoom-16)<.001,'Actual terrain-adjusted maximum zoom');
    assert.equal(await b.js(`document.getElementById('zoom-nearer').disabled`),true);
    await currentTerrain(b);
    const budget=await b.js(`({requests:Number(document.getElementById('terrain').dataset.requests),
      satellite:observedTerrain.getSource('satellite').maxzoom,dem:observedTerrain.getSource('dem').maxzoom})`);
    assert.ok(budget.requests<=240);assert.equal(budget.satellite,12);assert.equal(budget.dem,11);
    await screenshot(b,`moving-zoom-${width}-bound`);
    await pointer('profile-toggle');
    await b.js(`document.getElementById('player-profile').focus()`);
    await b.cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
    await b.cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
    await pointer('profile-close');
    await sleep(250);
    await screenshot(b,`moving-zoom-${width}-seek`);
    t.diagnostic(JSON.stringify({seekProof:await b.js(`(()=>{
      const m=observedTerrain,rider=m._markers.find(m=>m.getElement().classList.contains('route-rider')).getLngLat();
      const p=m.project(rider),line=m.getSource('route')._data.geometry.coordinates;
      return {proof:JSON.parse(document.getElementById('terrain').dataset.frame||'{}'),
        zoom:m.getZoom(),vertices:line.length,
        approximatePointFeatures:m.queryRenderedFeatures([[p.x-8,p.y-8],[p.x+8,p.y+8]],{layers:['route']}).length,
        renderedRoadFeatures:m.queryRenderedFeatures({layers:['route']}).length};
    })()`)}));
    await currentTerrain(b);
    assert.ok(Math.abs((await state()).zoom-16)<.001,'Seek retains camera distance');
    await select(b,'player-route','rwgps-57873112');await ready(b);await currentTerrain(b);
    assert.equal((await state()).zoom,12.6,'New route resets distance');
    await pointer('tools-toggle');await click(b,'offline');
    assert.equal(await b.js(`document.getElementById('zoom-nearer').disabled && document.getElementById('zoom-farther').disabled`),true);
    assert.match(await b.js(`document.getElementById('zoom-help').textContent`),/requires online terrain/);
    assert.equal(await b.js(`document.querySelectorAll('#terrain canvas').length`),0);
    await pointer('tools-close');
    await pointer('back');
    assert.deepEqual(b.exceptions,[]);
    t.diagnostic(JSON.stringify({width,wheelZoom:wheel.zoom,heldZoom:held.zoom,actualRate:rate,
      selectedRate:held.rate,closeMovingZoom:closeMoving.zoom,renderFrames:evidence.frames.length,
      validProofs:evidence.proofs.filter(p=>p.ok).length,budget}));
  }
});
async function screenshot(b,name) {
  const dir=process.env.RIDE_EXPLORER_EVIDENCE_DIR;
  if (!dir) return;
  await mkdir(dir,{recursive:true});
  const {data}=await b.cmd('Page.captureScreenshot',{format:'png'});
  await writeFile(join(dir,name+'.png'),Buffer.from(data,'base64'));
}

for (const [width,height] of [[1440,900],[375,812]])
test(`built compact cockpit ${width}: native paused controls, road/profile, disclosures and 200% text`,async t=>{
  const f=await fixture(t),b=await f.chrome();
  await b.cmd('Page.enable');
  await b.cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  await b.cmd('Page.navigate',{url:f.base});await ready(b);
  const pointer=async(selector,{scroll=false,fraction=.5}={})=>{
    if(scroll)await b.js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    const p=await b.js(`(()=>{
      const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();
      const x=r.left+r.width*${fraction},y=r.top+r.height/2;
      return {x,y,width:r.width,height:r.height,hit:el.contains(document.elementFromPoint(x,y))};
    })()`);
    assert.ok(p.hit && p.width>=44 && p.height>=44,JSON.stringify({selector,...p}));
    await b.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});
    await b.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});
  };
  const state=()=>b.js(`({
    ...document.getElementById('cockpit').dataset,
    power:parseFloat(document.getElementById('ride-power').textContent),
    speed:parseFloat(document.getElementById('ride-speed').textContent),
    cadence:parseFloat(document.getElementById('ride-cadence').textContent),
    gear:document.getElementById('ride-gear').textContent,
    effort:document.querySelector('.efforts [aria-pressed=true]')?.textContent,
    notice:document.getElementById('ride-notice').textContent,
    play:document.getElementById('play').getAttribute('aria-label')
  })`);
  const space=()=>b.js(`(()=>{
    const rect=s=>document.querySelector(s).getBoundingClientRect().toJSON();
    return {camera:rect('.camera-distance'),bottom:rect('.player-bottom'),cockpit:rect('#cockpit'),
      profile:rect('#profile-panel'),player:rect('#player'),scroll:document.getElementById('player').scrollWidth,
      top:document.getElementById('player').scrollTop};
  })()`);
  const frozen=(a,b)=>assert.deepEqual([a.seconds,a.distance,a.work],[b.seconds,b.distance,b.work]);
  await pointer('#fly');await currentTerrain(b);
  await pointer('#view-rider');await currentTerrain(b);
  let layout=await space();
  await screenshot(b,`compact-${width}-closed`);
  t.diagnostic(JSON.stringify(await b.js(`[...document.querySelectorAll('.telemetry,#road-card,.ride-actions,.gears,.efforts,.playbar,.player-status')]
    .map(e=>({el:e.className||e.id,text:e.textContent,rect:e.getBoundingClientRect().toJSON()}))`)));
  assert.ok(layout.bottom.top-layout.camera.bottom>=height/2,JSON.stringify(layout));
  assert.equal(layout.top,0);assert.equal(layout.scroll,width);
  await screenshot(b,`compact-${width}-closed`);
  await pointer('#profile-toggle');
  assert.equal(await b.js(`document.getElementById('profile-details').hidden`),true);
  await pointer('#player-profile',{fraction:.2});
  const proof=await currentTerrain(b);
  assert.ok(proof.current && proof.ok && proof.road && proof.clearance,'Actual rendered terrain, not just camera inputs');
  layout=await space();
  assert.ok(layout.profile.bottom<=layout.cockpit.top,'Profile never overlays the cockpit');
  assert.ok(layout.profile.height<=100,JSON.stringify(layout));
  assert.ok(layout.profile.top-layout.camera.bottom>=height*.3,JSON.stringify(layout));
  assert.equal(layout.top,0);
  assert.match(await b.js(`document.getElementById('road-current').textContent`),/Climb 22.*km.*m left/);
  assert.match(await b.js(`document.getElementById('road-ahead').textContent`),/Next 1.0 km.*%/);
  const initial=await state();
  assert.equal(initial.power,165);
  await pointer('[data-effort="0.9"]');
  const hard=await state();frozen(hard,initial);
  assert.equal(hard.power,198);assert.equal(hard.effort,'Hard');assert.ok(hard.speed>initial.speed);
  await pointer('#gear-easier');const easyGear=await state();frozen(easyGear,initial);
  assert.notEqual(easyGear.gear,initial.gear);assert.ok(easyGear.cadence>hard.cadence);
  assert.equal(easyGear.speed,hard.speed);assert.match(easyGear.notice,/Faster legs.*same km\/h/);
  await pointer('#gear-harder');await pointer('#gear-easier');await pointer('#coast');
  const coast=await state();frozen(coast,initial);
  assert.equal(coast.effort,'Coast');assert.equal(coast.power,0);assert.equal(coast.cadence,0);
  assert.equal(coast.speed,0);assert.equal(coast.motion,'stalled');
  assert.match(coast.notice,/Coasting · stopped; choose effort/);
  await pointer('#profile-close');
  const coastingLayout=await space();
  assert.ok(coastingLayout.bottom.top-coastingLayout.camera.bottom>=height/2,JSON.stringify(coastingLayout));
  await pointer('#profile-toggle');
  await pointer('[data-effort="0.6"]');const easy=await state();frozen(easy,initial);
  assert.equal(easy.power,132);assert.equal(easy.effort,'Easy');assert.equal(Number(easy.history),6);
  await screenshot(b,`compact-${width}-profile-immediate`);
  // Keyboard seek remains on the same visible profile, then due-now pinning.
  await pointer('#player-profile',{fraction:.2});
  const beforeKey=await state();
  for(const type of ['keyDown','keyUp'])await b.cmd('Input.dispatchKeyEvent',{type,key:'ArrowRight'});
  assert.equal(Number((await state()).distance),Number(beforeKey.distance)+250);
  await pointer('#profile-details-toggle');
  await pointer('#main-climb',{scroll:true});
  await pointer('#pin-baseline',{scroll:true});
  assert.equal(await b.js(`document.getElementById('comparison-hud').hidden`),false);
  await pointer('#profile-details-toggle',{scroll:true});
  await pointer('[data-effort="0.9"]',{scroll:true});
  const beforePlay=await state();
  await pointer('#play');
  await until(async()=>Number((await state()).seconds)>2);
  await pointer('#play');
  const afterPlay=await state();
  assert.ok(Number(afterPlay.distance)>Number(beforePlay.distance));
  assert.ok(Number(afterPlay.work)>Number(beforePlay.work));
  assert.ok(await b.js(`Number(document.getElementById('comparison-hud').dataset.distanceDelta)>0`));
  await currentTerrain(b);
  await screenshot(b,`compact-${width}-resumed`);
  await pointer('#profile-close');
  // Enlarge actual CSS text, not viewport scaling. Scroll each real target
  // into view and hit it natively; no simultaneous-visibility promise at 200%.
  await b.js(`document.documentElement.style.fontSize='200%'`);
  await pointer('#profile-toggle',{scroll:true});
  const large=await space();
  assert.equal(large.scroll,width);
  assert.ok(large.profile.bottom<=large.cockpit.top);
  await pointer('#profile-details-toggle',{scroll:true});
  await pointer('#main-climb',{scroll:true});
  await pointer('#profile-close',{scroll:true});
  await pointer('#play',{scroll:true});
  await until(async()=>Number((await state()).seconds)>1);
  await pointer('#play',{scroll:true});
  await screenshot(b,`compact-${width}-text200-controls`);
  await pointer('#tools-toggle',{scroll:true});
  await pointer('#tools-panel details summary',{scroll:true});
  assert.match(await b.js(`document.querySelector('#tools-panel details[open]').textContent`),/Road surfaces and road cuts are not modeled/);
  assert.equal((await space()).scroll,width);
  await screenshot(b,`compact-${width}-text200-setup`);
  await pointer('#tools-close',{scroll:true});
  await pointer('#profile-toggle',{scroll:true});
  await pointer('#back',{scroll:true});
  assert.equal(await b.js(`document.getElementById('player').hidden`),true);
  assert.deepEqual(b.exceptions,[]);
  t.diagnostic(JSON.stringify({width,layout,initial,hard,easyGear,coast,easy,afterPlay,large}));
});

test('built baseline: first Grappa what-if loop in 2D and terrain, coherent clocks, phone and enlarged hit targets',async t=>{
  const f=await fixture(t);
  assert.ok(JSON.parse(f.files.get('offline-release.json')).common.some(p=>/^js\/ride-comparison\.[a-f0-9]{24}\.mjs$/.test(p)));
  for (const terrain of [false,true]) for (const [width,height] of [[1440,900],[375,812]]) {
    const outside=[],b=await f.chrome(m=>{
      if (m.method==='Network.requestWillBeSent' && /^https?:/.test(m.params.request.url) &&
          !m.params.request.url.startsWith(f.base)) outside.push(m.params.request.url);
    });
    await b.cmd('Page.enable');await b.cmd('Network.enable');
    await b.cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await b.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
      Object.defineProperty(window,'mapboxgl',{configurable:true,set(gl){
        Object.defineProperty(window,'mapboxgl',{value:gl,configurable:true});
        gl.Map=new Proxy(gl.Map,{construct(T,args){return window.observedTerrain=new T(...args);}});
      }});`});
    await b.cmd('Page.navigate',{url:f.base+(terrain?'':'?terrain=off')});await ready(b);
    const pointer=async(selector,scroll=true)=>{
      if (scroll) await b.js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
      const p=await b.js(`(()=>{
        const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();
        const x=r.left+r.width/2,y=r.top+r.height/2;
        return {x,y,hit:el.contains(document.elementFromPoint(x,y)),width:r.width,height:r.height};
      })()`);
      assert.ok(p.hit && p.width>=44 && p.height>=44,JSON.stringify({selector,...p}));
      await b.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});
      await b.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});
    };
    const state=()=>b.js(`({
      ...document.getElementById('comparison-hud').dataset,
      active:!document.getElementById('comparison-hud').hidden,
      distance:Number(document.getElementById('cockpit').dataset.distance),
      elapsed:Number(document.getElementById('cockpit').dataset.seconds),
      origin:Number(document.getElementById('cockpit').dataset.origin),
      motion:document.getElementById('cockpit').dataset.motion,
      notice:document.getElementById('comparison-notice').textContent,
      speed:document.getElementById('ride-speed').textContent,
      cadence:document.getElementById('ride-cadence').textContent
    })`);
    const readyTerrain=async()=>{
      if (!terrain) return;
      await currentTerrain(b);
    };
    await pointer('#fly');await readyTerrain();
    const storageBefore=await b.js(`[Object.keys(localStorage).sort(),Object.keys(sessionStorage).sort(),document.cookie]`);
    await pointer('#profile-toggle');await pointer('#profile-details-toggle');await pointer('#main-climb',true);
    await pointer('#pin-baseline',true);
    let s=await state();
    assert.equal(s.origin,10750);assert.equal(s.elapsed,0);assert.equal(s.active,true);
    assert.equal(Number(s.distanceDelta),0);assert.match(s.notice,/Future timed commands are excluded/);
    await pointer('#profile-close',true);await readyTerrain();
    const spatial=await b.js(`document.querySelector('.player-bottom').getBoundingClientRect().top-
      document.querySelector('.player-status').getBoundingClientRect().bottom`);
    assert.ok(spatial>=height/2,JSON.stringify({width,height,terrain,spatial}));
    await screenshot(b,`baseline-${width}-${terrain?'terrain':'2d'}-pinned`);
    await pointer('#play');
    await until(async()=>Number((await state()).seconds)>5);
    assert.ok(Math.abs(Number((await state()).distanceDelta))<.02,'Identical presented trials coincide');
    await pointer('[data-effort="0.9"]');
    await until(async()=>Number((await state()).distanceDelta)>2);
    // Measure rendered poses with the ghost active, not only RAF cadence.
    await b.js(`(()=>{
      window.ghostMotion={renders:[],hidden:0,mismatch:0,status:0};
      const el=document.getElementById('terrain'),hud=document.getElementById('comparison-hud');
      const observer=new MutationObserver(records=>ghostMotion.status+=records.length);
      for(const id of ['terrain-status','ride-notice'])observer.observe(document.getElementById(id),{childList:true});
      const sample=()=>{
        ghostMotion.renders.push(performance.now());
        if(${terrain} && getComputedStyle(el).visibility!=='visible')ghostMotion.hidden++;
        if(${terrain} && Number(el.dataset.distance)!==Number(document.getElementById('cockpit').dataset.distance))ghostMotion.mismatch++;
        const ghost=document.querySelector(${JSON.stringify(terrain?'.route-ghost':'#outline-ghost')});
        if(Math.abs(Number(ghost.dataset.distance)-Number(hud.dataset.baselineDistance))>3)ghostMotion.mismatch++;
      };
      if(${terrain})observedTerrain.on('render',sample);
      else {let handle;const frame=()=>{sample();handle=requestAnimationFrame(frame)};handle=requestAnimationFrame(frame);
        ghostMotion.stopFrame=()=>cancelAnimationFrame(handle);}
      ghostMotion.dispose=()=>{observer.disconnect();if(${terrain})observedTerrain.off('render',sample);else ghostMotion.stopFrame();};
    })()`);
    await sleep(terrain?12000:2000);
    const motion=await b.js(`ghostMotion.dispose();({...ghostMotion,dispose:undefined,stopFrame:undefined})`);
    const intervals=motion.renders.slice(1).map((at,i)=>at-motion.renders[i]).sort((a,b)=>a-b);
    assert.ok(motion.renders.length>(terrain?300:60));
    assert.ok(intervals[Math.floor(intervals.length*.95)]<50);
    assert.equal(motion.hidden,0);assert.equal(motion.mismatch,0);assert.equal(motion.status,0);
    await pointer('#play');s=await state();
    assert.ok(Number(s.distanceDelta)>2);assert.ok(Number(s.arrivalDelta)<0);assert.ok(Number(s.workDelta)>0);
    if (terrain) {
      assert.equal(await b.js(`observedTerrain.getPitch()`),45);
      assert.equal(await b.js(`document.querySelector('.route-ghost').hidden`),false);
      assert.equal(await b.js(`!!(document.querySelector('.route-ghost').compareDocumentPosition(
        document.querySelector('.route-rider')) & Node.DOCUMENT_POSITION_FOLLOWING)`),true,
      'Live rider paints above an overlapping hollow ghost');
    }
    await screenshot(b,`baseline-${width}-${terrain?'terrain':'2d'}-hard-gap`);
    const paused=s;
    await sleep(120);
    assert.equal((await state()).distance,paused.distance);
    assert.equal((await state()).baselineDistance,paused.baselineDistance);
    await pointer('#gear-easier');await pointer('#play');
    await until(async()=>(await state()).cadence!==paused.cadence);
    await pointer('#play');
    assert.equal((await state()).speed,paused.speed,'Gear changes cadence, not speed on the same window');
    if (!terrain) {
      const beforeRate=await state();
      await select(b,'playback-rate','4');
      assert.equal((await state()).seconds,beforeRate.seconds);
      assert.equal((await state()).baselineDistance,beforeRate.baselineDistance);
      await select(b,'playback-rate','16');await pointer('#play');
      const {targetInfo}=await b.cmd('Target.getTargetInfo');
      const other=await b.cmd('Target.createTarget',{url:'about:blank'});
      try {
        await until(()=>b.js(`document.hidden`));
        const hidden=await state();await sleep(200);
        assert.equal((await state()).baselineDistance,hidden.baselineDistance);
        assert.equal((await state()).distance,hidden.distance);
        await b.cmd('Target.activateTarget',{targetId:targetInfo.targetId});
        await until(()=>b.js(`!document.hidden`));
        assert.equal((await state()).seconds,hidden.seconds);
      } finally {await b.cmd('Target.closeTarget',{targetId:other.targetId});}
      await pointer('#play');
      await b.cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      await until(()=>b.js(`document.getElementById('play').getAttribute('aria-label')==='Play route preview'`));
      const reduced=await state();await sleep(100);
      assert.equal((await state()).baselineDistance,reduced.baselineDistance);
      await b.cmd('Emulation.setEmulatedMedia',{features:[]});
      // Media changes dispatch asynchronously. Wait for the pause/rebase on
      // restoring the preference before the next deliberate Play.
      await b.cmd('Runtime.evaluate',{expression:`new Promise(resolve=>
        requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,awaitPromise:true});
    }
    await pointer('#coast');
    assert.equal((await state()).motion,'stalled');
    assert.match(await b.js(`document.getElementById('ride-notice').textContent`),/Coasting/);
    await pointer('#play');await until(async()=>(await state()).motion==='stalled');
    const stalled=await state();await sleep(500);s=await state();
    assert.equal(s.distance,stalled.distance);assert.ok(Number(s.baselineDistance)>Number(stalled.baselineDistance));
    await pointer('[data-effort="0.75"]');await until(async()=>(await state()).distance>stalled.distance);
    await pointer('#play');await pointer('#profile-toggle');await pointer('#repin-baseline',true);
    assert.ok(Math.abs(Number((await state()).distanceDelta))<.02);
    await pointer('#remove-baseline',true);assert.equal((await state()).active,false);
    await pointer('#pin-baseline',true);await pointer('#retry-section',true);
    s=await state();assert.equal(s.active,false);assert.equal(s.elapsed,0);assert.match(s.notice,/Seek/);
    await pointer('#pin-baseline',true);await pointer('#profile-close',true);
    await pointer('#tools-toggle');await pointer('#restart',true);
    assert.equal((await state()).active,false);assert.match((await state()).notice,/Restart/);
    await pointer('#tools-close');await pointer('#profile-toggle');await pointer('#pin-baseline',true);
    await pointer('#profile-close',true);
    // Model/rider edits cannot keep a misaligned pin to fake mass comparison.
    await pointer('#tools-toggle');await b.js(`document.getElementById('rider-mass').value='90';
      document.getElementById('rider-mass').dispatchEvent(new Event('input'))`);
    assert.equal((await state()).active,false);assert.match((await state()).notice,/Rider or model/);
    await pointer('#tools-close');await pointer('#profile-toggle');await pointer('#pin-baseline',true);
    await pointer('#profile-close',true);await select(b,'player-route','rwgps-57873112');await ready(b);
    assert.equal((await state()).active,false);assert.match((await state()).notice,/Route changed/);
    if (!terrain) {
      await pointer('#profile-toggle');await pointer('#pin-baseline',true);await pointer('#profile-close',true);
      await select(b,'player-route','rwgps-57874050');await ready(b);
      assert.equal((await state()).active,false);
      assert.equal(await b.js(`document.getElementById('cockpit').dataset.status`),'unavailable');
      assert.equal(await b.js(`document.getElementById('outline-ghost').getAttribute('visibility')`),'hidden');
      await select(b,'player-route','rwgps-57873112');await ready(b);
    }
    if (width===375 && !terrain) {
      await b.js(`document.documentElement.style.fontSize='200%'`);
      await pointer('#profile-toggle');await pointer('#pin-baseline',true);
      await pointer('#profile-close',true);
      await pointer('#tools-toggle');
      for (const selector of ['#back','#player-route','#play','#tools-toggle','#tools-close']) {
        await b.js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
        const ok=await b.js(`(()=>{
          const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();
          return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));
        })()`);
        assert.ok(ok,`200% Setup: ${selector}`);
      }
      await screenshot(b,'baseline-375-text-200-setup');
      await pointer('#tools-close');await pointer('#profile-toggle');
      for (const selector of ['#back','#player-route','#play','#profile-toggle']) {
        await b.js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
        const ok=await b.js(`(()=>{
          const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();
          return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));
        })()`);
        assert.ok(ok,`200% Profile: ${selector}`);
      }
      await pointer('#remove-baseline',true);
      await screenshot(b,'baseline-375-text-200-profile');
    }
    assert.equal(await b.js(`document.documentElement.scrollWidth`),width);
    if (!terrain) assert.deepEqual(outside,[]);
    assert.deepEqual(await b.js(`[Object.keys(localStorage).sort(),Object.keys(sessionStorage).sort(),document.cookie]`),storageBefore,
      'No baseline storage beyond the already loaded terrain SDK');
    assert.deepEqual(b.exceptions,[]);
    t.diagnostic(JSON.stringify({width,height,terrain,spatial,frames:motion.renders.length,
      p95:intervals[Math.floor(intervals.length*.95)],hidden:motion.hidden,statusChanges:motion.status}));
    await click(b,'back');
  }
});

test('built sections: actual profile pointer/keyboard, shared paused trials, seven identities and bounded phone disclosure',async t=>{
  const f=await fixture(t),b=await f.chrome();
  await b.cmd('Page.enable');
  const manifest=JSON.parse(f.files.get('offline-release.json'));
  assert.ok(manifest.common.some(p=>/^js\/ride-insights\.[a-f0-9]{24}\.mjs$/.test(p)));
  const state=()=>b.js(`({
    ...document.getElementById('road-card').dataset,
    distance:Number(document.getElementById('cockpit').dataset.distance),
    seconds:Number(document.getElementById('cockpit').dataset.seconds),
    history:Number(document.getElementById('cockpit').dataset.history),
    current:document.getElementById('road-current').textContent,
    ahead:document.getElementById('road-ahead').textContent,
    detail:document.getElementById('section-detail').textContent,
    profile:document.getElementById('profile-range').dataset.chapterId,
    map:document.getElementById('outline-section').dataset.chapterId,
    play:document.getElementById('play').getAttribute('aria-label')
  })`);
  const pointer=async(selector,fraction=.5,scroll=true)=>{
    if (scroll) await b.js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    const p=await b.js(`(()=>{
      const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();
      const x=r.left+r.width*${fraction},y=r.top+r.height/2;
      return {x,y,hit:el.contains(document.elementFromPoint(x,y)),width:r.width,height:r.height};
    })()`);
    assert.ok(p.hit,JSON.stringify({selector,...p}));
    assert.ok(p.width>=44 && p.height>=44,JSON.stringify({selector,...p}));
    await b.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});
    await b.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});
  };
  const key=async key=>{
    await b.cmd('Input.dispatchKeyEvent',{type:'keyDown',key});
    await b.cmd('Input.dispatchKeyEvent',{type:'keyUp',key});
  };
  for (const [width,height] of [[1440,900],[375,812]]) {
    await b.cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await b.cmd('Page.navigate',{url:f.base+'?terrain=off'});await ready(b);
    await pointer('#fly');await pointer('#profile-toggle');await pointer('#profile-details-toggle');await pointer('#main-climb');
    let s=await state();
    assert.equal(s.distance,10750);assert.equal(s.seconds,0);assert.equal(s.history,0);
    assert.equal(s.play,'Play route preview');assert.equal(s.selected,'chapter-22');
    assert.equal(s.map,s.selected);assert.equal(s.profile,s.selected);
    assert.match(s.current,/Climb 22.*9.8 km.*853 m left/);
    assert.match(s.ahead,/\+7.0% to \+9.4%/);
    assert.match(s.detail,/8.7% processed average/);
    assert.equal(await b.js(`document.getElementById('camera').value`),'section');
    await pointer('#profile-close');await sleep(50);
    await screenshot(b,`sections-${width}-main-climb-2d`);
    const spatial=await b.js(`document.querySelector('.player-bottom').getBoundingClientRect().top-
      document.querySelector('.player-status').getBoundingClientRect().bottom`);
    assert.ok(spatial>=height/2,JSON.stringify({width,height,spatial}));
    await pointer('#return-rider');
    assert.equal((await state()).distance,s.distance);
    await pointer('#profile-toggle');await pointer('#player-profile',.25);
    s=await state();
    assert.equal(s.seconds,0);assert.equal(s.history,0);assert.equal(s.play,'Play route preview');
    assert.equal(await b.js(`document.activeElement.id`),'player-profile');
    const pointerDistance=s.distance;
    await key('ArrowRight');assert.ok(Math.abs((await state()).distance-pointerDistance-250)<1e-6);
    assert.ok(await b.js(`document.activeElement.matches(':focus-visible')`));
    await key('End');s=await state();
    assert.match(s.current,/Route complete/);assert.match(s.detail,/section complete/);
    assert.match(await b.js(`document.getElementById('road-transition').textContent`),/No next section/);
    assert.equal(s.profile,'chapter-55');assert.equal(s.map,'chapter-55');
    await key('Home');assert.equal((await state()).distance,0);
    if (width===375) {
      await b.cmd('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:1});
      const point=await b.js(`(()=>{
        const r=document.getElementById('player-profile').getBoundingClientRect();
        return {x:r.left+r.width*.4,y:r.top+r.height/2};
      })()`);
      await b.cmd('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});
      await b.cmd('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      s=await state();
      assert.ok(s.distance>0);assert.equal(s.seconds,0);assert.equal(s.play,'Play route preview');
      await b.cmd('Emulation.setTouchEmulationEnabled',{enabled:false});
    }
    await pointer('#sections summary');
    await pointer('[data-chapter-id="chapter-22"]');
    await screenshot(b,`sections-${width}-survey-2d`);
    // A real short derived descent completes without resetting the chosen trial
    // or changing its selection/history. No simulation clock is faked.
    const short=await b.js(`[...document.querySelectorAll('#section-list button')].find(e=>
      e.textContent.startsWith('Descent') && Number(e.dataset.endM)-Number(e.dataset.startM)<=500)?.dataset.chapterId`);
    assert.ok(short);
    await pointer(`[data-chapter-id="${short}"]`);
    await pointer('#profile-close');await select(b,'playback-rate','60');await pointer('#play');
    await until(async()=>!(await state()).current.startsWith(`Descent ${short.split('-')[1]} ·`));
    await pointer('#play');s=await state();
    assert.equal(s.selected,short);assert.equal(s.profile,short);assert.equal(s.map,short);
    assert.match(s.detail,/section complete; Play continues without resetting this trial/);
    assert.ok(s.seconds>0);assert.equal(s.history,0);
    await pointer('#back');await pointer('#fly');
    assert.equal((await state()).distance,s.distance);
    const revisions=[];
    for (const [id] of routes) {
      await select(b,'player-route',id);await ready(b);
      s=await state();revisions.push(s.revision);
      assert.equal(s.distance,0);assert.match(s.revision,new RegExp('^'+id+'-'));
      assert.equal(s.profile,'chapter-1');assert.equal(s.map,'chapter-1');
      if (id==='rwgps-57874050') {
        await click(b,'profile-toggle');
        await b.js(`document.querySelector('[data-chapter-id="chapter-68"]').click()`);
        assert.match((await state()).current,/slope uncertain/);
        assert.match((await state()).ahead,/slope uncertain/);
        assert.equal(await b.js(`document.getElementById('play').disabled`),true);
        await click(b,'profile-close');
      }
    }
    assert.equal(new Set(revisions).size,7);
    assert.equal(await b.js(`document.documentElement.scrollWidth`),width);
    t.diagnostic(JSON.stringify({width,height,selectedSectionSpatial:spatial}));
  }
  assert.deepEqual(b.exceptions,[]);
});

test('built 375px enlarged Profile keeps navigation, seek and playback actual hit targets accessible',async t=>{
  const f=await fixture(t),b=await f.chrome();
  await b.cmd('Page.enable');
  await b.cmd('Emulation.setDeviceMetricsOverride',{width:375,height:812,deviceScaleFactor:1,mobile:false});
  await b.cmd('Page.navigate',{url:f.base+'?terrain=off&layout=long-name'});await ready(b);
  await b.js(`document.documentElement.style.fontSize='200%'`);
  const hit = id=>b.js(`(()=>{
    const el=document.getElementById(${JSON.stringify(id)});
    el.scrollIntoView({block:'center'});
    const r=el.getBoundingClientRect();
    const x=r.left+r.width/2,y=r.top+r.height/2,top=document.elementFromPoint(x,y);
    return {id:el.id,x,y,hit:top?.id||top?.tagName,accessible:!!top && el.contains(top),rect:r.toJSON()};
  })()`);
  const pointer = async id=>{
    const target=await hit(id);
    assert.ok(target.accessible,JSON.stringify(target));
    await b.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:target.x,y:target.y,button:'left',clickCount:1});
    await b.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:target.x,y:target.y,button:'left',clickCount:1});
  };
  // Fly itself may be below the enlarged landing viewport.
  await b.js(`document.getElementById('fly').scrollIntoView({block:'center'})`);
  await pointer('fly');
  await pointer('profile-toggle');
  await until(()=>b.js(`!document.getElementById('profile-panel').hidden`));
  const targets=[];
  for(const id of ['back','player-route','play','profile-toggle','player-profile','profile-close'])
    targets.push(await hit(id));
  assert.ok(targets.every(x=>x.accessible),JSON.stringify(targets));
  assert.ok(await b.js(`document.getElementById('profile-panel').getBoundingClientRect().top>=
    document.querySelector('.player-header').getBoundingClientRect().bottom`));
  assert.equal(await b.js(`document.documentElement.scrollWidth`),375);
  await screenshot(b,'correction-375-text-200-profile');
  await pointer('player-profile');
  assert.ok(await b.js(`Number(document.getElementById('cockpit').dataset.distance)>0`));
  await pointer('play');
  await until(()=>b.js(`document.getElementById('play').getAttribute('aria-label')==='Pause route preview' &&
    Number(document.getElementById('cockpit').dataset.seconds)>0`));
  await b.js(`window.pressedMutations=0;
    window.pressedObserver=new MutationObserver(records=>pressedMutations+=records.length);
    pressedObserver.observe(document.getElementById('cockpit'),{subtree:true,attributes:true,attributeFilter:['aria-pressed']});`);
  await sleep(350);
  assert.equal(await b.js(`pressedObserver.disconnect();pressedMutations`),0,
    'Unchanged effort state is not rewritten on animation frames');
  await pointer('play');
  assert.equal(await b.js(`document.getElementById('play').getAttribute('aria-label')`),'Play route preview');
  await pointer('profile-toggle');
  assert.equal(await b.js(`document.getElementById('profile-panel').hidden`),true,'Visible Profile toggle closes the sheet');
  // Resize while open as well: header/playbar measurements must be live, not
  // a fixed 110px header assumption or a one-time opening measurement.
  await pointer('tools-toggle');
  await b.js(`document.documentElement.style.fontSize='150%'`);
  await sleep(50);
  await b.js(`document.documentElement.style.fontSize='200%'`);
  assert.ok((await hit('tools-close')).accessible);
  assert.ok((await hit('back')).accessible);
  assert.ok((await hit('player-route')).accessible);
  assert.ok((await hit('play')).accessible);
  await screenshot(b,'correction-375-text-200-setup');
  await pointer('tools-close');
  await b.js(`document.documentElement.style.fontSize='200%'`);
  await pointer('profile-toggle');
  await pointer('back');
  assert.equal(await b.js(`document.getElementById('player').hidden`),true,'Back receives a real pointer click through the open Profile state');
  assert.deepEqual(b.exceptions,[]);
  t.diagnostic(JSON.stringify({profileAt200Percent:targets}));
});

test('built cockpit: actual Grappa effort/gear/coast, trial lifecycle, unavailable inputs and seven geometries',async t=>{
  const f=await fixture(t),b=await f.chrome();
  await b.cmd('Page.enable');
  const manifest=JSON.parse(f.files.get('offline-release.json'));
  assert.ok(manifest.common.some(p=>/^js\/ride-simulation\.[a-f0-9]{24}\.mjs$/.test(p)));
  const state=()=>b.js(`({
    ...document.getElementById('cockpit').dataset,
    speed:Number(document.getElementById('ride-speed').textContent),
    power:parseFloat(document.getElementById('ride-power').textContent),
    cadence:parseFloat(document.getElementById('ride-cadence').textContent),
    gear:document.getElementById('ride-gear').textContent,
    notice:document.getElementById('ride-notice').textContent,
    play:document.getElementById('play').getAttribute('aria-label')
  })`);
  const input=(id,value)=>b.js(`document.getElementById('${id}').value=${JSON.stringify(value)};
    document.getElementById('${id}').dispatchEvent(new Event('input'))`);
  for (const [width,height] of [[1440,900],[375,812]]) {
    await b.cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await b.cmd('Page.navigate',{url:f.base+'?terrain=off&layout=long-name'});await ready(b);
    await click(b,'fly');
    assert.equal((await state()).play,'Play route preview');
    assert.equal(await b.js(`document.getElementById('playback-rate').value`),'16');
    await seek(b,200); // Actual first Grappa climb, not synthetic terrain/clock.
    const baseline=await state();
    assert.ok(await b.js(`parseFloat(document.getElementById('ride-grade').textContent)>5`));
    assert.equal(baseline.power,165);
    assert.equal(baseline.seconds,'0');
    assert.match(await b.js(`document.getElementById('rider-assumptions').textContent`),/75 kg · FTP 220 W · bike \+ kit 12 kg/);
    assert.match(await b.js(`document.getElementById('ride-remaining').textContent`),/ETA unknown/);
    await select(b,'playback-rate','1');
    assert.equal((await state()).speed,baseline.speed,'Movie rate never changes km/h');
    await click(b,'gear-easier');
    assert.notEqual((await state()).gear,baseline.gear,'Paused commands apply in the shared model immediately');
    assert.equal((await state()).seconds,baseline.seconds);
    assert.equal((await state()).distance,baseline.distance);
    assert.equal((await state()).work,baseline.work);
    assert.match((await state()).notice,/Faster legs/);
    await click(b,'play');
    await until(async()=>Number((await state()).history)===1);
    await click(b,'play');
    const easier=await state();
    assert.equal(easier.speed,baseline.speed);
    assert.equal(easier.power,baseline.power);
    assert.ok(easier.cadence>baseline.cadence);
    await b.js(`document.querySelector('[data-effort="0.9"]').click()`);
    await click(b,'play');
    await until(async()=>(await state()).power===198);
    await click(b,'play');
    assert.ok((await state()).speed>baseline.speed);
    await click(b,'coast');
    assert.equal((await state()).motion,'stalled');
    await click(b,'play');
    await until(async()=>(await state()).motion==='stalled');
    const stalled=await state();
    await sleep(350);
    assert.equal((await state()).distance,stalled.distance);
    assert.equal(stalled.speed,0);assert.equal(stalled.power,0);assert.equal(stalled.cadence,0);
    assert.match(stalled.notice,/Coasting · stopped; choose effort/);
    await b.js(`document.querySelector('[data-effort="0.75"]').click()`);
    await until(async()=>Number((await state()).distance)>Number(stalled.distance));
    await click(b,'play');
    await screenshot(b,`cockpit-${width}-grappa-climb-2d`);
    const layout=await b.js(`(()=>{
      const top=document.querySelector('.player-status').getBoundingClientRect();
      const bottom=document.querySelector('.player-bottom').getBoundingClientRect();
      return {spatial:bottom.top-top.bottom,scroll:document.documentElement.scrollWidth,
        controls:[...document.querySelectorAll('#cockpit button,.playbar button,.playbar select,#back,#player-route')]
          .map(e=>({id:e.id||e.textContent,r:e.getBoundingClientRect().toJSON()}))};
    })()`);
    assert.equal(layout.scroll,width);
    assert.ok(layout.spatial>=height/2,JSON.stringify(layout));
    assert.ok(layout.controls.every(({r})=>r.width>=44 && r.height>=44 && r.left>=0 && r.right<=width),JSON.stringify(layout));
    t.diagnostic(JSON.stringify({width,height,spatialPixels:layout.spatial,baseline,easier}));
    await click(b,'profile-toggle');
    await seek(b,250);
    const origin=Number((await state()).distance);
    assert.equal((await state()).seconds,'0');assert.equal((await state()).history,'0');
    await click(b,'play');await sleep(300);await click(b,'play');
    await click(b,'restart');
    assert.equal(Number((await state()).distance),origin);
    assert.equal((await state()).seconds,'0');
    await select(b,'ride-mode','explore');
    assert.ok(Number((await state()).seconds)>0);
    assert.equal(await b.js(`document.getElementById('coast').disabled`),true);
    assert.doesNotMatch(await b.js(`document.getElementById('ride-remaining').textContent`),/unknown/);
    await select(b,'ride-mode','experiment');
    await click(b,'tools-toggle');
    await input('rider-mass','bad');
    assert.equal((await state()).status,'unavailable');
    assert.equal(await b.js(`document.getElementById('play').disabled`),true);
    assert.equal(await b.js(`document.getElementById('rider-mass').getAttribute('aria-invalid')`),'true');
    assert.match(await b.js(`document.getElementById('rider-errors').textContent`),/20–250 kg/);
    await seek(b,300);
    assert.ok(Number((await state()).distance)>origin,'Invalid model retains geometry navigation');
    await input('rider-mass','85');await input('rider-ftp','250');
    assert.equal((await state()).status,'available');
    assert.match(await b.js(`document.getElementById('model-provenance').textContent`),/Personal inputs/);
    await input('rider-bike','-20');assert.equal((await state()).status,'unavailable');
    await input('rider-bike','12x');assert.equal((await state()).status,'unavailable');
    await click(b,'rider-reset');
    assert.equal((await state()).status,'available');
    await screenshot(b,`cockpit-${width}-setup`);
    await click(b,'tools-close');
    assert.equal(await b.js(`document.activeElement.id`),'tools-toggle');
    await select(b,'playback-rate','60');await seek(b,999);
    await click(b,'play');
    await until(async()=>(await state()).motion==='finished');
    assert.equal(await b.js(`document.getElementById('seek').value`),'1000');
    assert.equal((await state()).play,'Play route preview');
    // An actual blocked main thread, not fake RAF or a virtual clock.
    await seek(b,200);await click(b,'play');await sleep(100);
    await b.js(`{const start=performance.now();while(performance.now()-start<320){}}`);
    await until(async()=>(await state()).play==='Play route preview');
    assert.match((await state()).notice,/late frame/);
    const paused=await state();await sleep(150);
    assert.equal((await state()).distance,paused.distance);
    await click(b,'play');await sleep(100);
    const {targetInfo}=await b.cmd('Target.getTargetInfo');
    const other=await b.cmd('Target.createTarget',{url:'about:blank'});
    try {
      await until(()=>b.js(`document.hidden`));
      const hidden=await state();
      assert.equal(hidden.play,'Play route preview');
      await sleep(200);assert.equal((await state()).distance,hidden.distance);
      await b.cmd('Target.activateTarget',{targetId:targetInfo.targetId});
      await until(()=>b.js(`!document.hidden`));
      assert.equal((await state()).play,'Play route preview','Return does not auto-resume');
      assert.equal((await state()).seconds,hidden.seconds,'No catch-up while hidden');
    } finally {await b.cmd('Target.closeTarget',{targetId:other.targetId});}
    const geometries=[];
    for (const [id] of routes) {
      await select(b,'player-route',id);await ready(b);
      geometries.push(await b.js(`document.querySelector('#player-map .track').getAttribute('d')`));
      const unavailable=id==='rwgps-57874050';
      assert.equal((await state()).status,unavailable?'unavailable':'available');
      if (unavailable) {
        assert.match((await state()).notice,/grade/i);
        assert.equal(await b.js(`document.getElementById('ride-speed').textContent`),'—');
        await seek(b,500);
        assert.equal(await b.js(`document.getElementById('seek').value`),'500');
      }
    }
    assert.equal(new Set(geometries).size,7);
    assert.deepEqual(await b.js(`[localStorage.length,sessionStorage.length,document.cookie]`),[0,0,'']);
  }
  // Real CSS text enlargement at the narrow viewport. It must remain scrollable,
  // not shrink text back down or hide controls to satisfy a screenshot.
  await select(b,'player-route','rwgps-57873019');await ready(b);
  await b.js(`document.documentElement.style.fontSize='200%'`);
  await click(b,'tools-toggle');
  await screenshot(b,'cockpit-375-text-200-setup');
  assert.equal(await b.js(`document.documentElement.scrollWidth`),375);
  assert.ok(await b.js(`document.getElementById('player').scrollHeight>document.getElementById('player').clientHeight`),
    'Enlarged setup scrolls in the player, never behind an overlapping sheet');
  await click(b,'tools-close');
  await screenshot(b,'cockpit-375-text-200-closed');
  assert.ok(await b.js(`[...document.querySelectorAll('#cockpit button,.playbar button,.playbar select')].every(e=>{
    const r=e.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth;
  })`),'Text zoom must not overflow controls horizontally');
  await b.cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await b.cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  assert.ok(await b.js(`document.activeElement.matches(':focus-visible') && getComputedStyle(document.activeElement).outlineStyle!=='none'`));
  await b.cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await b.cmd('Page.navigate',{url:f.base+'?terrain=off'});await ready(b);await click(b,'fly');
  await sleep(200);assert.equal((await state()).distance,'0');assert.equal((await state()).play,'Play route preview');
  assert.deepEqual(b.exceptions,[]);
});

test('built root: desktop/375 landing, variants, Fly/play/back, companion navigation and private-link recovery',async t=>{
  const f=await fixture(t),outside=[],errors=[];
  const b=await f.chrome((m,send)=>{
    if (m.method==='Fetch.requestPaused') {
      outside.push(m.params.request.url);
      send('Fetch.failRequest',{requestId:m.params.requestId,errorReason:'BlockedByClient'}).catch(e=>errors.push(e.message));
    }
  });
  await b.cmd('Page.enable');
  await b.cmd('Fetch.enable',{patterns:[{urlPattern:'https://*'}]});
  for (const [width,height] of [[1440,900],[375,812]]) {
    const before=outside.length;
    await b.cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await b.cmd('Page.navigate',{url:f.base});await ready(b);
    await until(()=>b.js(`document.querySelector('#offline-packs')?.dataset.ready==='true'`));
    assert.equal(await b.js(`document.querySelector('#site-shell')`),null);
    assert.equal(await b.js(`document.querySelector('#route-title').textContent`),'D2 Monte Grappa');
    assert.equal(await b.js(`document.documentElement.scrollWidth`),width);
    assert.ok(await b.js(`document.querySelector('.entry p').getBoundingClientRect().bottom<=innerHeight`));
    assert.equal(outside.length,before,'Landing has no provider requests');
    assert.deepEqual(await b.js(`[localStorage.length,sessionStorage.length,document.cookie]`),[0,0,'']);
    const storage=await b.cmd('Runtime.evaluate',{expression:`Promise.all([indexedDB.databases(),caches.keys(),
      navigator.serviceWorker.getRegistrations()]).then(a=>a.map(x=>x.length))`,awaitPromise:true,returnByValue:true});
    assert.deepEqual(storage.result.value,[0,0,0],'No new storage or service-worker consent');
    assert.match(await b.js(`document.querySelector('link[title="Approved route catalog"]').href`),
      /\/kotr27\/assets\/route-pack\.[a-f0-9]{24}\.json$/);
    await b.js(`document.querySelector('#variants [aria-pressed=false]').click()`);
    await until(()=>b.js(`document.getElementById('route-title').textContent==='D2 Asolo' && !document.getElementById('fly').disabled`));
    assert.equal(await b.js(`document.activeElement.textContent`),'Standard');
    await b.js(`document.querySelector('#variants [aria-pressed=false]').click()`);await ready(b);
    await click(b,'fly');
    await until(()=>b.js(`document.getElementById('terrain-status').textContent.includes('unavailable')`));
    assert.ok(outside.length>before,'Only Fly requests terrain');
    assert.equal(await b.js(`document.activeElement.id`),'back');
    assert.equal(await b.js(`document.getElementById('player').getBoundingClientRect().height`),height);
    await click(b,'play');
    await until(()=>b.js(`parseFloat(document.getElementById('progress').textContent)>0 &&
      Number(document.getElementById('seek').value)>0`));
    await click(b,'play');
    const paused=await b.js(`document.getElementById('seek').value`);
    await sleep(150);assert.equal(await b.js(`document.getElementById('seek').value`),paused);
    await click(b,'profile-toggle');
    await b.js(`document.getElementById('seek').value=500;document.getElementById('seek').dispatchEvent(new Event('input'))`);
    assert.equal(await b.js(`document.getElementById('position').value`),'31.6 km');
    await b.js(`document.getElementById('offline').checked=true`);
    const denied=outside.length;
    for (const [id,name,distance] of routes) {
      await select(b,'player-route',id);await ready(b);
      assert.equal(await b.js(`document.getElementById('route-title').textContent`),name);
      assert.equal(await b.js(`document.getElementById('distance').textContent`),distance);
    }
    assert.equal(outside.length,denied);
    await click(b,'back');
    assert.equal(await b.js(`document.activeElement.id`),'fly');
    assert.equal(await b.js(`document.querySelectorAll('#terrain canvas').length`),0);
    await b.js(`document.querySelector('nav a').click()`);
    await until(()=>b.js(`document.getElementById('trip-planner')?.dataset.ready==='true'`));
    assert.equal(await b.js(`document.querySelectorAll('.trip-route').length`),7);
    assert.equal(await b.js(`document.getElementById('site-route').value`),'','Preview was not an itinerary assignment');
    assert.ok(await b.js(`!!document.querySelector('#site-preferences') && !!document.querySelector('#local-file')`));
    await b.js(`document.querySelector('.site-brand').click()`);await ready(b);
    await b.js(`document.querySelectorAll('nav a')[1].click()`);
    await until(()=>b.js(`document.getElementById('site-shell')?.dataset.ready==='true'`));
    assert.equal(await b.js(`new URL(location.href).searchParams.get('area')`),'ride-week');
    assert.ok(await b.js(`document.querySelector('#event-guide') && !document.querySelector('#event-guide').hidden`));
    assert.equal(outside.length,denied,'Companion navigation does not preload providers');
  }
  for (const suffix of ['index.html#seek-9000','index.html?route=semonzo-example',
    'index.html?route=rwgps-57873019&rev=invalid%2Fprivate&ftp=300&token=secret']) {
    await b.cmd('Page.navigate',{url:f.base+suffix});
    await until(()=>b.js(`document.getElementById('site-shell')?.dataset.ready==='true'`));
    assert.match(await b.js(`document.getElementById('site-notice').textContent`),/retired|revision unavailable or invalid/);
    assert.ok(await b.js(`document.getElementById('route-flyover').hidden`));
    await b.js(`document.querySelector('.site-nav a').click()`);
    assert.doesNotMatch(await b.js(`location.href`),/private|ftp|token|secret/i);
  }
  assert.ok(f.requests.every(r=>!r.referrer || !/secret|ftp|private/.test(r.referrer)));
  assert.ok(f.requests.every(r=>!r.path.startsWith('prototypes/') && r.path!=='assets/route-pack.json'));
  assert.deepEqual(b.exceptions,[]);assert.deepEqual(errors,[]);
  t.diagnostic('Real built /kotr27/: 1440×900 and 375×812, seven identities, no provider/storage before Fly, working My week/Essentials, retired/invalid-link recovery.');
});

test('built root refuses malformed pointer and never substitutes a failed selected route',async t=>{
  const f=await fixture(t),b=await f.chrome();
  await b.cmd('Page.enable');
  const pointer=[...f.files.keys()].find(p=>/^assets\/route-pack\./.test(p));
  f.fault.path=pointer;f.fault.bytes=JSON.stringify({schemaVersion:1,path:'https://example.invalid/private',sha256:'0'.repeat(64)});
  await b.cmd('Page.navigate',{url:f.base});
  await until(()=>b.js(`document.getElementById('load-status')?.textContent.includes('unavailable')`));
  assert.equal(await b.js(`document.getElementById('fly').disabled`),true);
  f.fault.path=null;
  await b.cmd('Page.navigate',{url:f.base});await ready(b);
  const pack=JSON.parse(f.files.get(JSON.parse(f.files.get(pointer)).path));
  f.fault.path=pack.catalog.routes.find(r=>r.id==='rwgps-57874121').revisions[0].profile.path;
  await select(b,'landing-route','0');
  await until(()=>b.js(`document.getElementById('route-title').textContent==='Route unavailable'`));
  assert.equal(await b.js(`document.getElementById('fly').disabled`),true);
  assert.equal(await b.js(`document.querySelectorAll('#landing-map path').length`),0);
  assert.equal(await b.js(`document.getElementById('landing-route').disabled`),false);
  await select(b,'landing-route','1');await ready(b);
  assert.equal(await b.js(`document.getElementById('route-title').textContent`),'D1 Vicentine Hills');
  // An old failed asset response cannot clear a newer successful selection.
  // Use real delayed HTTP and abort, not a replacement loader or fake clock.
  f.fault.delayMs=500;
  const before=f.requests.length;
  await select(b,'landing-route','0');
  await until(()=>f.requests.slice(before).some(r=>r.path===f.fault.path));
  await select(b,'landing-route','2');await ready(b);
  assert.equal(await b.js(`document.getElementById('route-title').textContent`),'D2 Asolo');
  await sleep(600);
  assert.equal(await b.js(`document.getElementById('route-title').textContent`),'D2 Asolo');
  assert.equal(await b.js(`document.getElementById('cockpit').dataset.status`),'available');
  assert.deepEqual(b.exceptions,[]);
});

test('built root live Chrome: Grappa play, off-rider manual pan/zoom/return, route switch and back at desktop/375',async t=>{
  const f=await fixture(t);
  for (const [width,height] of [[1440,900],[375,812]]) {
    const b=await f.chrome();
    await b.cmd('Page.enable');
    await b.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
      window.maps=[];
      Object.defineProperty(window,'mapboxgl',{configurable:true,set(gl){
        Object.defineProperty(window,'mapboxgl',{value:gl,configurable:true});
        gl.Map=new Proxy(gl.Map,{construct(T,args){const m=new T(...args);maps.push(m);return window.observedTerrain=m;}});
      }});`});
    await b.cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    await b.cmd('Page.navigate',{url:f.base});await ready(b);
    const state=()=>b.js(`({
      proof:JSON.parse(document.getElementById('terrain').dataset.frame||'{}'),
      online:document.getElementById('player').classList.contains('online'),
      status:document.getElementById('terrain-status').textContent,
      distance:Number(document.getElementById('terrain').dataset.distance),
      playing:document.getElementById('play').getAttribute('aria-label')==='Pause route preview'
    })`);
    const terrainReady=async()=>{
      const proof=await currentTerrain(b);
      return {...await state(),proof};
    };
    await click(b,'fly');await terrainReady();
    await click(b,'profile-toggle');await click(b,'main-climb');
    await until(()=>b.js(`document.getElementById('terrain').dataset.section==='chapter-22'`));
    await terrainReady();
    assert.equal((await state()).distance,10750);
    assert.ok(await b.js(`observedTerrain.getSource('selected-section')._data.geometry.coordinates.every(p=>
      observedTerrain.getBounds().contains(p))`));
    assert.equal(await b.js(`observedTerrain.getSource('selected-section')._data.geometry.coordinates.length>2`),true);
    await screenshot(b,`sections-${width}-main-climb-terrain`);
    await click(b,'profile-close');
    await screenshot(b,`sections-${width}-main-climb-terrain-closed`);
    const sectionLayout=await b.js(`(()=>{
      const marker=document.querySelector('#terrain .route-rider').getBoundingClientRect();
      const top=document.querySelector('.player-status').getBoundingClientRect().bottom;
      const bottom=document.querySelector('.player-bottom').getBoundingClientRect().top;
      return {top,bottom,marker:marker.toJSON(),spatial:bottom-top};
    })()`);
    assert.ok(sectionLayout.marker.top>=sectionLayout.top && sectionLayout.marker.bottom<=sectionLayout.bottom,JSON.stringify(sectionLayout));
    assert.ok(sectionLayout.spatial>=height/2,JSON.stringify(sectionLayout));
    t.diagnostic(JSON.stringify({width,height,sectionLayout}));
    await click(b,'return-rider');await terrainReady();
    assert.equal((await state()).distance,10750);
    await seek(b,200);await terrainReady();
    assert.ok(await b.js(`parseFloat(document.getElementById('ride-grade').textContent)>5`));
    await b.js(`(()=>{
      window.cockpitMotion={renders:[],hidden:0,mismatch:0};
      let previous;
      const sample=()=>{
        const terrain=document.getElementById('terrain'),pose=terrain.dataset.pose;
        if(pose && pose!==previous) {
          const center=observedTerrain.getCenter();
          cockpitMotion.renders.push({at:performance.now(),center:[center.lng,center.lat]});
          previous=pose;
        }
        if(getComputedStyle(terrain).visibility!=='visible')cockpitMotion.hidden++;
        if(Number(terrain.dataset.distance)!==Number(document.getElementById('cockpit').dataset.distance))cockpitMotion.mismatch++;
      };
      observedTerrain.on('render',sample);
      cockpitMotion.dispose=()=>observedTerrain.off('render',sample);
    })()`);
    await click(b,'play');
    await sleep(12000);
    assert.equal((await state()).playing,true,'Actual simulation remains playing during measured interval');
    await click(b,'play');await terrainReady();
    const motion=await b.js(`cockpitMotion.dispose();({...cockpitMotion,dispose:undefined})`);
    const intervals=motion.renders.slice(1).map((s,i)=>s.at-motion.renders[i].at).sort((a,b)=>a-b);
    assert.ok(motion.renders.length>300,'Continuous actual model-driven rendered poses, not 200ms steps');
    assert.ok(intervals[Math.floor(intervals.length*.95)]<50);
    assert.equal(motion.hidden,0);assert.equal(motion.mismatch,0);
    assert.ok(motion.renders.at(-1).center.some((n,i)=>n!==motion.renders[0].center[i]));
    const spatial=await b.js(`document.querySelector('.player-bottom').getBoundingClientRect().top-
      document.querySelector('.player-status').getBoundingClientRect().bottom`);
    assert.ok(spatial>=height/2,`Live terrain spatial height ${spatial}/${height}`);
    await screenshot(b,`cockpit-${width}-grappa-climb-terrain`);
    t.diagnostic(JSON.stringify({width,height,spatial,modelRate:16,climbMotion:{
      frames:motion.renders.length,median:intervals[Math.floor(intervals.length*.5)],
      p95:intervals[Math.floor(intervals.length*.95)],max:intervals.at(-1)}}));
    const beforeDrag=(await state()).distance;
    await click(b,'play');
    await until(async()=>(await state()).distance>beforeDrag);
    // Browser input, not untrusted synthetic DOM events. Two in-viewport drags
    // move the rider off screen without relying on pointer delivery beyond the
    // browser window. No camera/proof/timing overrides.
    for (let drag=0;drag<2;drag++) {
      await b.cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:width/2,y:height/2});
      await b.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:width/2,y:height/2,button:'left',buttons:1,clickCount:1});
      for (let i=1;i<=8;i++) {
        await b.cmd('Input.dispatchMouseEvent',{type:'mouseMoved',
          x:width/2+i*width*.35/8,y:height/2,button:'left',buttons:1});
        await sleep(40);
      }
      await b.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:width*.85,y:height/2,button:'left',clickCount:1});
    }
    await sleep(3500);
    t.diagnostic(JSON.stringify({manualProbe:await state(),viewport:await b.js(`({
      hit:document.elementFromPoint(innerWidth/2,innerHeight/2)?.outerHTML?.slice(0,200),
      canvas:observedTerrain.getCanvas().getBoundingClientRect().toJSON(),
      dragEnabled:observedTerrain.dragPan.isEnabled(),dragging:observedTerrain.isMoving(),
      profileHidden:document.getElementById('profile-panel').hidden
    })`)}));
    const manual=await terrainReady();
    assert.equal(manual.proof.mode,'manual',JSON.stringify(manual));assert.equal(manual.playing,false);
    assert.equal(await b.js(`(()=>{
      const rider=observedTerrain._markers.find(m=>m.getElement().classList.contains('route-rider'));
      const p=observedTerrain.project(rider.getLngLat());return p.x<0||p.y<0||p.x>innerWidth||p.y>innerHeight;
    })()`),true);
    const zoom=await b.js('observedTerrain.getZoom()');
    await b.cmd('Input.dispatchMouseEvent',{type:'mouseWheel',x:width/2,y:height/2,deltaX:0,deltaY:-100});
    await sleep(3500);await terrainReady();
    assert.notEqual(await b.js('observedTerrain.getZoom()'),zoom);
    assert.equal((await state()).distance,manual.distance);
    await click(b,'return-rider');const returned=await terrainReady();
    assert.equal(returned.proof.mode,'follow');assert.equal(returned.playing,false);
    assert.equal(returned.distance,manual.distance);
    for (const key of ['framed','aligned','clear','road','elevation','imagery']) assert.equal(returned.proof[key],true,key);
    await select(b,'camera','overview');await terrainReady();
    assert.equal((await state()).playing,false);
    assert.equal(await b.js(`observedTerrain.getPitch()`),0);
    assert.ok(await b.js(`observedTerrain.getSource('route')._data.geometry.coordinates.every(p=>observedTerrain.getBounds().contains(p))`));
    await select(b,'camera','follow');await terrainReady();
    assert.equal((await state()).distance,manual.distance);
    assert.equal(await b.js(`observedTerrain.getPitch()`),45);
    await select(b,'player-route','rwgps-57873112');await ready(b);await terrainReady();
    assert.equal(await b.js(`maps.length===2 && maps[0]._removed`),true);
    await click(b,'profile-toggle');await click(b,'main-climb');await terrainReady();
    assert.notEqual((await state()).distance,10750);
    assert.equal(await b.js(`document.getElementById('terrain').dataset.section`),
      await b.js(`document.getElementById('profile-range').dataset.chapterId`));
    await screenshot(b,`sections-${width}-asolo-terrain`);
    await click(b,'back');
    assert.equal(await b.js(`document.querySelectorAll('#terrain canvas').length`),0);
    assert.equal(await b.js(`document.activeElement.id`),'fly');
    assert.deepEqual(b.exceptions,[]);
    t.diagnostic(JSON.stringify({width,height,manual:manual.proof,returned:returned.proof}));
  }
});
