// Synthetic private inputs only, on the built shared homepage. Isolated native
// Chrome + CDP file-input mechanism; no user's browser or preview is touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp,readFile,readdir,writeFile,mkdir,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,extname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { build } from '../tools/build-release.mjs';
import { browser,until } from './browser.mjs';
import { syntheticGPX,syntheticFIT } from './local-route-fixtures.mjs';
import { readRoutePack } from '../tools/route-pack.mjs';
import { loadRouteAnalysis } from '../js/route-analysis-loader.mjs';

function recording({sensors=true,times=[0,1,2,4,50,51,52]}={}) {
  return '<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:t="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" version="1.1">'+
    '<trk><name>Private source sentinel</name><trkseg>'+
    times.map((s,i)=>`<trkpt lat="${45+i*.0001}" lon="11.1234567"><ele>${100+i}</ele>`+
      `<time>${new Date(Date.UTC(2026,0,1)+s*1000).toISOString()}</time>`+
      (sensors?`<extensions><t:TrackPointExtension><t:speed>${i<2||i>4?0:8}</t:speed><t:power>${100+i}</t:power><t:cad>${80+i}</t:cad></t:TrackPointExtension></extensions>`:'')+
      '</trkpt>').join('')+'</trkseg></trk></gpx>';
}
async function fixture(t,{width=1440,height=900,terrain=false,deny=false}={}) {
  const tmp=await mkdtemp(join(tmpdir(),'kotr-relive-')),out=join(tmp,'public'),downloads=join(tmp,'downloads'),cleanup=[];
  await mkdir(downloads);
  let server;
  t.after(async()=>{
    for(const close of cleanup.reverse())await close();
    server?.closeAllConnections();if(server)await new Promise(r=>server.close(r));
    await rm(tmp,{recursive:true,force:true});
  });
  await build('.',out);
  const files=(await readdir(out,{recursive:true})).filter(p=>extname(p));
  const bytes=new Map(await Promise.all(files.map(async p=>[p,await readFile(join(out,p))])));
  const requests=[],network=[],downloadsById=new Map();
  const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.gpx':'application/xml'};
  server=createServer(async(req,res)=>{
    const body=[];for await(const chunk of req)body.push(chunk);
    requests.push({url:req.url,body:Buffer.concat(body).toString()});
    const url=new URL(req.url,'http://localhost'),path=url.pathname.slice('/kotr27/'.length)||'index.html';
    if(!url.pathname.startsWith('/kotr27/')||!bytes.has(path))return res.writeHead(404).end();
    res.writeHead(200,{'Content-Type':types[extname(path)],'Cache-Control':'no-store'}).end(bytes.get(path));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const b=await browser({after:fn=>cleanup.push(fn)},m=>{
    if(m.method==='Network.requestWillBeSent')network.push(m.params.request);
    if(m.method==='Browser.downloadWillBegin')
      downloadsById.set(m.params.guid,{name:m.params.suggestedFilename,state:'inProgress'});
    if(m.method==='Browser.downloadProgress'&&downloadsById.has(m.params.guid))
      downloadsById.get(m.params.guid).state=m.params.state;
  });
  await b.cmd('Page.enable');await b.cmd('Network.enable');
  await b.cmd('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true});
  await b.cmd('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
  if(deny)await b.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
    Object.defineProperty(window,'indexedDB',{get(){throw new DOMException('Denied','SecurityError')}});`});
  await b.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
    Object.defineProperty(window,'mapboxgl',{configurable:true,set(gl){
      Object.defineProperty(window,'mapboxgl',{value:gl,configurable:true});
      window.providerInputs=[];
      const marker=gl.Marker.prototype.setLngLat;
      gl.Marker.prototype.setLngLat=function(p){providerInputs.push(p);return marker.call(this,p)};
      gl.Map=new Proxy(gl.Map,{construct(T,args){window.providerMaps=(window.providerMaps||0)+1;
        const map=new T(...args),remove=map.remove;window.providerRemoved=0;
        for(const key of ['jumpTo','addSource']) {
          const fn=map[key];map[key]=function(...a){providerInputs.push(a);return fn.apply(this,a)};
        }
        map.remove=function(...a){window.providerBounds=this.getBounds().toArray();
          window.providerRemoved++;return remove.apply(this,a)};return map;}});
    }});`});
  const base=`http://127.0.0.1:${server.address().port}/kotr27/`;
  await b.cmd('Page.navigate',{url:base+(terrain?'':'?terrain=off')});
  await until(()=>b.js(`document.getElementById('fly')?.disabled===false && document.getElementById('local-library')?.dataset.ready==='true'`));
  const click=id=>b.js(`document.getElementById(${JSON.stringify(id)}).click()`);
  const select=(id,value)=>b.js(`document.getElementById('${id}').value=${JSON.stringify(value)};
    document.getElementById('${id}').dispatchEvent(new Event('change'))`);
  const evalAsync=async expression=>{
    const r=await b.cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;
  };
  async function pointer(selector,{scroll=false}={}) {
    if(scroll)await b.js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);
    const p=await b.js(`(()=>{
      const el=document.querySelector(${JSON.stringify(selector)}),r=el.getBoundingClientRect();
      const x=r.left+r.width/2,y=r.top+r.height/2;
      return {x,y,hit:el.contains(document.elementFromPoint(x,y)),width:r.width,height:r.height};
    })()`);
    assert.ok(p.hit&&p.width>=44&&p.height>=44,JSON.stringify({selector,...p}));
    await b.cmd('Input.dispatchMouseEvent',{type:'mousePressed',x:p.x,y:p.y,button:'left',clickCount:1});
    await b.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x,y:p.y,button:'left',clickCount:1});
  }
  async function upload(content,name='private-file-sentinel.gpx',{wait=true}={}) {
    await b.js(`document.getElementById('relive-library').open=true`);
    const file=join(tmp,name);await writeFile(file,content);
    await b.cmd('DOM.enable');const {root}=await b.cmd('DOM.getDocument');
    const {nodeId}=await b.cmd('DOM.querySelector',{nodeId:root.nodeId,selector:'#local-file'});
    await b.cmd('DOM.setFileInputFiles',{nodeId,files:[file]});
    if(wait)await until(()=>b.js(`!document.getElementById('local-file').disabled`));
  }
  const elapsed=value=>b.js(`document.getElementById('relive-seek').value=${value};
    document.getElementById('relive-seek').dispatchEvent(new Event('input'))`);
  const state=()=>b.js(`({
    ...document.getElementById('cockpit').dataset,
    speed:document.getElementById('ride-speed').textContent,power:document.getElementById('ride-power').textContent,
    cadence:document.getElementById('ride-cadence').textContent,notice:document.getElementById('ride-notice').textContent,
    sampleText:document.getElementById('relive-sample').textContent,
    dot:document.getElementById('outline-rider')?.getAttribute('visibility')
  })`);
  const action=label=>b.js(`[...document.querySelectorAll('#local-files button')].find(b=>b.textContent===${JSON.stringify(label)}).click()`);
  async function screenshot(name) {
    const dir=process.env.RIDE_RELIVE_EVIDENCE_DIR;if(!dir)return;
    await mkdir(dir,{recursive:true});const {data}=await b.cmd('Page.captureScreenshot',{format:'png'});
    await writeFile(join(dir,name+'.png'),Buffer.from(data,'base64'));
  }
  async function exported(name) {
    // A final filename can briefly exist before Chrome has written its bytes.
    // Wait for the browser's completion, then keep the exact-byte assertion.
    await until(()=>[...downloadsById.values()].some(d=>d.name===name&&d.state==='completed'));
    await until(async()=> (await readdir(downloads)).includes(name));
    return readFile(join(downloads,name));
  }
  return {...b,base,click,select,pointer,upload,elapsed,state,action,evalAsync,screenshot,network,requests,files,exported};
}

for(const width of [1440,375])test(`built Relive ${width}: source samples, pauses/gaps, same cockpit/profile, controls and privacy`,async t=>{
  const f=await fixture(t,{width,height:width===375?812:900});
  const initialURL=await f.js('location.href');
  assert.deepEqual(await f.evalAsync('indexedDB.databases()'),[]);
  await f.pointer('#fly');await f.pointer('#tools-toggle');await f.pointer('#relive-entry',{scroll:true});
  await f.upload(recording());
  await f.action('Export original file');
  assert.equal((await f.exported('Private source sentinel.gpx')).toString(),recording());
  let s=await f.state();
  assert.equal(s.exact,'true');assert.equal(s.power,'100 W');assert.equal(s.speed,'0.0');
  assert.match(s.cadence,/80 rpm/);assert.match(s.sampleText,/2026-01-01T00:00:00.000Z/);
  assert.equal(await f.js(`document.getElementById('ride-mode').value`),'relive');
  assert.equal(await f.js(`document.getElementById('playback-rate').value`),'1');
  assert.deepEqual(await f.js(`[...document.getElementById('playback-rate').options].map(o=>o.value)`),['0.5','1','2','4']);
  assert.equal(await f.js(`document.getElementById('pin-baseline').disabled`),true);
  assert.equal(await f.js(`document.getElementById('gear-easier').disabled`),true);
  assert.equal(await f.js(`document.getElementById('offline').disabled`),true);
  assert.equal(await f.js(`document.getElementById('relive-alternative').disabled`),true,'No model across timestamp gaps');
  await f.pointer('#relive-next',{scroll:true});s=await f.state();
  assert.equal(s.seconds,'1');assert.equal(s.power,'101 W');
  await f.elapsed(.5);s=await f.state();
  assert.equal(s.motion,'paused');assert.equal(s.power,'— W');assert.equal(s.speed,'—');
  assert.match(s.sampleText,/Last-known position only, NOT current telemetry/);
  assert.equal(s.dot,'visible');
  await f.elapsed(10);s=await f.state();
  assert.equal(s.motion,'gap');assert.equal(s.dot,'hidden');assert.equal(s.power,'— W');
  assert.match(s.sampleText,/Position unknown/);
  assert.equal(await f.js(`document.querySelector('#player-map .track').getAttribute('d').split(' M').length`),3,
    'Two disconnected runs, never a chord over timestamp gap');
  await f.screenshot(`relive-${width}-gap`);
  await f.elapsed(50);s=await f.state();assert.equal(s.power,'104 W');assert.equal(s.dot,'visible');
  await f.elapsed(2);await f.pointer('#tools-close');
  const spatial=await f.js(`document.querySelector('.player-bottom').getBoundingClientRect().top-document.querySelector('.player-status').getBoundingClientRect().bottom`);
  assert.ok(spatial>=(width===375?812:900)/2,JSON.stringify({width,spatial}));
  await f.screenshot(`relive-${width}-sample`);
  await f.pointer('#play');await until(async()=>Number((await f.state()).seconds)>2.25);await f.pointer('#play');
  s=await f.state();assert.equal(s.power,'— W');assert.ok(Number(s.seconds)<4,'1× source clock, not movie fraction');
  const paused=s.seconds;await sleep(100);assert.equal((await f.state()).seconds,paused);
  await f.pointer('#play');
  await f.js(`Object.defineProperty(document,'hidden',{configurable:true,value:true});
    document.dispatchEvent(new Event('visibilitychange'));`);
  const hidden=(await f.state()).seconds;await sleep(100);assert.equal((await f.state()).seconds,hidden);
  await f.js(`delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))`);
  assert.match((await f.state()).notice,/paused/);
  await f.pointer('#play');
  await f.cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await until(async()=>/paused/.test((await f.state()).notice));
  await f.pointer('#profile-toggle');await f.js(`document.getElementById('player-profile').focus()`);
  for(const type of ['keyDown','keyUp'])await f.cmd('Input.dispatchKeyEvent',{type,key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  assert.equal((await f.state()).seconds,'4');assert.equal((await f.state()).power,'103 W');
  await f.pointer('#profile-close',{scroll:true});await f.pointer('#tools-toggle');
  await f.js(`document.getElementById('relive-comparison').open=true`);
  await f.select('relive-basis','distance');await f.click('relive-compare');
  assert.match(await f.js(`document.getElementById('relive-alignment').textContent`),/declined.*0 supported segment/);
  assert.match(await f.js(`document.getElementById('relive-difference').textContent`),/off-route.*Actual replay remains/);
  assert.deepEqual(await f.evalAsync('indexedDB.databases()'),[],'No implicit save');
  assert.equal(await f.js('location.href'),initialURL);
  // Open-sheet 200% text: actual pointer targets, not DOM-only clicks.
  await f.js(`document.documentElement.style.fontSize='200%'`);
  await f.pointer('#relive-next',{scroll:true});
  await f.screenshot(`relive-${width}-200-sheet`);await f.pointer('#tools-close');
  assert.equal(await f.js(`document.documentElement.scrollWidth>innerWidth`),false);
  await f.pointer('#play');await f.pointer('#play');await f.pointer('#back');
  await until(()=>f.js(`document.getElementById('fly').disabled===false`));
  assert.equal(await f.js(`document.getElementById('player-route').value`),'rwgps-57873019');
  assert.equal(await f.js(`document.getElementById('local-status').textContent`),'');
  assert.equal(await f.js(`document.getElementById('relive-sample').textContent`),'');
  assert.equal(await f.js(`document.getElementById('relive-seek').max`),'0');
  assert.equal(await f.js(`document.getElementById('cockpit').dataset.sample`),undefined);
  assert.equal(await f.js(`document.querySelectorAll('[data-private]').length`),0);
  const wire=JSON.stringify([...f.network,...f.requests]);
  for(const secret of ['11.1234567','Private source sentinel','private-file-sentinel','2026-01-01T','powerW','user:'])
    assert.ok(!wire.includes(secret),secret+' must never enter a request');
  assert.equal(f.network.filter(r=>/^https?:/.test(r.url)&&!r.url.startsWith(f.base)).length,0);
  assert.deepEqual(f.exceptions,[]);
  t.diagnostic(JSON.stringify({width,spatial,requests:f.network.length,external:0}));
});

test('built Relive library: FIT/missing sensors, course alternative, errors, cancel, storage consent and removal',async t=>{
  const f=await fixture(t);
  await f.click('fly');await f.click('tools-toggle');await f.click('relive-entry');
  await f.upload(recording({sensors:false,times:[0,1,2,3]}));
  assert.equal((await f.state()).power,'— W');assert.equal((await f.state()).speed,'—');
  await f.click('relive-alternative');
  assert.equal(await f.js(`document.getElementById('ride-mode').value`),'experiment');
  assert.match(await f.js(`document.getElementById('speed-provenance').textContent`),/model/);
  await f.select('ride-mode','relive');assert.equal((await f.state()).power,'— W');
  // A loaded private source keeps replay/controls usable on disconnection.
  await f.cmd('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await f.elapsed(1);assert.equal((await f.state()).seconds,'1');
  await f.click('play');await until(async()=>Number((await f.state()).seconds)>1.1);await f.click('play');
  await f.cmd('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  await f.upload(syntheticFIT({recording:true}),'synthetic-only.fit');
  assert.equal((await f.state()).power,'200 W');assert.equal((await f.state()).speed,'—');
  await f.elapsed(2);assert.equal((await f.state()).cadence,'— rpm · recorded');
  await f.upload(syntheticGPX());
  assert.equal(await f.js(`document.getElementById('ride-mode').value`),'explore');
  assert.match(await f.js(`document.getElementById('relive-message').textContent`),/timestamped.*Geometry-only/);
  assert.match(await f.js(`document.getElementById('speed-provenance').textContent`),/model/);
  await f.upload('not a GPX file','invalid.gpx');
  assert.equal(await f.js(`document.getElementById('local-status').textContent`),'Text outside XML root.');
  assert.equal((await f.state()).status,'unavailable');
  // Delay worker delivery, not parser behavior; cancel must reject the late result.
  await f.js(`window.originalPost=Worker.prototype.postMessage;
    Worker.prototype.postMessage=function(...args){window.releaseImport=()=>originalPost.apply(this,args);};`);
  await f.upload(recording(),'cancelled-sentinel.gpx',{wait:false});
  await until(()=>f.js(`document.getElementById('local-cancel').disabled===false`));
  await f.click('local-cancel');
  await f.js(`Worker.prototype.postMessage=window.originalPost`);
  await until(()=>f.js(`document.getElementById('local-file').disabled===false`));
  assert.match(await f.js(`document.getElementById('relive-message').textContent`),/cancelled/);
  assert.equal((await f.state()).status,'unavailable');
  await f.upload(recording());
  assert.deepEqual(await f.evalAsync('indexedDB.databases()'),[]);
  // Select the active row, since earlier memory-only files deliberately survive.
  await f.js(`window.activeId=document.getElementById('player-route').value`);
  await f.js(`[...[...document.querySelectorAll('#local-files li')].filter(li=>li.textContent.includes('Private source sentinel')).at(-1)
    .querySelectorAll('button')].find(b=>b.textContent==='Remember this file on this device').click()`);
  await until(()=>f.js(`document.getElementById('local-status').textContent.includes('Remembered on this device only')`));
  assert.equal((await f.evalAsync('indexedDB.databases()'))[0].name,'kotr27-local-routes');
  await f.click('local-delete-all');await f.click('local-confirm-delete');
  await until(()=>f.js(`document.getElementById('local-status').textContent.includes('All local files deleted')`));
  assert.equal((await f.state()).status,'unavailable');
  assert.equal(await f.js(`document.getElementById('player-map').children.length`),0);
  assert.equal(await f.js(`document.getElementById('relive-source').textContent`),'');
  assert.deepEqual(f.exceptions,[]);
});

test('built public terrain → private → public: provider disposed before parse and private data never requested',async t=>{
  const f=await fixture(t,{terrain:true});
  await f.pointer('#fly');
  await until(()=>f.js(`window.providerMaps===1`));
  await f.pointer('#tools-toggle');await f.pointer('#relive-entry',{scroll:true});
  await until(()=>f.js(`document.getElementById('terrain-status').textContent.includes('Private local')`));
  assert.equal(await f.js('window.providerRemoved'),1);
  const maps=await f.js('window.providerMaps'),boundary=f.network.length;
  const inputs=await f.js('window.providerInputs.length');
  await f.upload(recording());
  await f.elapsed(50);await f.click('tools-close');await f.click('play');await sleep(150);await f.click('play');
  assert.equal(await f.js('window.providerMaps'),maps);
  assert.equal(await f.js('window.providerInputs.length'),inputs,'No camera, marker or source input reaches disposed provider');
  assert.equal(await f.js(`document.getElementById('terrain').children.length`),0);
  await f.click('tools-toggle');await f.click('relive-public');
  await until(()=>f.js(`document.getElementById('player-route').value==='rwgps-57873019' && !document.getElementById('fly').disabled`));
  assert.equal(await f.js('window.providerMaps'),maps,'Return is 2D until explicit public terrain choice');
  assert.equal(await f.js(`document.getElementById('ride-mode').value`),'experiment');
  assert.equal(await f.js(`document.getElementById('relive-source').textContent`),'');
  const requests=f.network.slice(boundary),wire=JSON.stringify(requests);
  const external=requests.filter(r=>/^https?:/.test(r.url)&&!r.url.startsWith(f.base));
  for(const secret of ['11.1234567','Private source sentinel','private-file-sentinel','2026-01-01T','powerW','user:'])
    assert.ok(!wire.includes(secret),secret);
  // Mapbox's image queue can report cancelled/public tile starts after remove.
  // Do not misreport zero network: qualify every such request against the
  // disposed PUBLIC viewport, not a private-derived center/URL or upload.
  const bounds=await f.js('window.providerBounds');
  const tile=([lon,lat],z)=>[(lon+180)/360*2**z,
    (1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*2**z];
  for(const req of external) {
    const url=new URL(req.url),m=/^\/v4\/mapbox\.satellite\/(\d+)\/(\d+)\/(\d+)\.webp$/.exec(url.pathname);
    assert.ok(m,JSON.stringify({method:req.method,origin:url.origin,path:url.pathname}));
    assert.equal(url.origin,'https://api.mapbox.com');assert.equal(req.method,'GET');assert.ok(!req.postData);
    const [z,x,y]=m.slice(1).map(Number),[west,south]=tile(bounds[0],z),[east,north]=tile(bounds[1],z);
    assert.ok(x>=Math.floor(west)-1&&x<=Math.floor(east)+1&&y>=Math.floor(north)-1&&y<=Math.floor(south)+1,
      'Queued tile belongs to the previously authorized public viewport');
  }
  assert.deepEqual(f.exceptions,[]);
  t.diagnostic(`Provider removed before upload; ${requests.length} requests after boundary, ${external.length} queued public viewport tiles; zero private provider inputs/requests.`);
});

test('built denied storage stays explicit; no save bypass, memory replay still removable',async t=>{
  const f=await fixture(t,{deny:true});
  await f.click('fly');await f.click('tools-toggle');await f.click('relive-entry');
  await f.upload(recording());
  await f.action('Remember this file on this device');
  await until(()=>f.js(`document.getElementById('local-status').textContent.includes('denied')`));
  assert.match(await f.js(`document.getElementById('local-status').textContent`),/session-only/);
  await f.action('Delete this file');
  await until(()=>f.js(`document.getElementById('local-status').textContent.includes('Deletion NOT confirmed')`));
  assert.equal((await f.state()).status,'unavailable');
  assert.deepEqual(f.exceptions,[]);
});

test('built Relive explicit plan revision: supported partial segments, declined elapsed and reversal, independent actual clock',async t=>{
  const f=await fixture(t);
  const {pack}=await readRoutePack('.');
  const route=pack.catalog.routes.find(r=>r.id==='rwgps-57874121');
  const analysis=await loadRouteAnalysis({pack,routeId:route.id,revisionId:route.currentRevisionId,
    readAsset:path=>readFile(path)});
  await f.select('landing-route','0');await until(()=>f.js(`!document.getElementById('fly').disabled`));
  await f.click('fly');await f.click('tools-toggle');await f.click('relive-entry');
  // Public approved geometry with invented times/sensors, not a rider's activity.
  const points=analysis.points.slice(100,250);
  const make=pts=>'<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1"><trk><name>Invented partial recording</name><trkseg>'+
    pts.map((p,i)=>`<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.elevationM}</ele><time>${new Date(Date.UTC(2026,0,1)+i*1000).toISOString()}</time></trkpt>`).join('')+
    '</trkseg></trk></gpx>';
  await f.upload(make(points));
  assert.match(await f.js(`document.getElementById('relive-plan').textContent`),new RegExp(route.currentRevisionId));
  await f.click('relive-compare');
  assert.match(await f.js(`document.getElementById('relive-difference').textContent`),/Choose a basis/);
  await f.select('relive-basis','distance');await f.click('relive-compare');
  assert.equal(await f.js(`document.getElementById('relive-difference').dataset.status`),'available');
  assert.match(await f.js(`document.getElementById('relive-difference').textContent`),/arrival unavailable.*Supported segment only/);
  assert.match(await f.js(`document.getElementById('relive-alignment').textContent`),/available.*supported segment/);
  await f.select('relive-basis','elapsed');await f.click('relive-compare');
  assert.match(await f.js(`document.getElementById('relive-difference').textContent`),/beginning at planned start/);
  await f.elapsed(10);assert.equal((await f.state()).seconds,'10');
  await f.upload(make([...points].reverse()));
  await f.select('relive-basis','distance');await f.click('relive-compare');
  await f.elapsed(50);
  assert.match(await f.js(`document.getElementById('relive-difference').textContent`),/ambiguous.*Actual replay remains/);
  assert.equal((await f.state()).seconds,'50');
  await f.js(`window.dispatchEvent(new CustomEvent('kotr-offline-withdrawn',{detail:['rwgps-57874121']}))`);
  await until(()=>f.js(`document.getElementById('terrain-status').textContent.includes('unavailable')`));
  assert.equal(await f.js(`document.getElementById('player-map').children.length`),0);
  assert.equal(await f.js(`document.getElementById('relive-source').textContent`),'');
  assert.deepEqual(f.exceptions,[]);
});

test('built Relive rejects stale import success/failure after public route change',async t=>{
  const f=await fixture(t);
  await f.click('fly');await f.click('tools-toggle');
  for(const failure of [false,true]) {
    await f.js(`document.getElementById('relive-sheet').open=true`);
    await f.js(`window.readFileOriginal=File.prototype.arrayBuffer;
      File.prototype.arrayBuffer=function(){
        const bytes=readFileOriginal.call(this);
        return new Promise((resolve,reject)=>{window.releaseFileRead=()=>${failure?
          "reject(Error('synthetic read failure'))":"bytes.then(resolve,reject)"};});
      };`);
    await f.upload(recording(),'delayed.gpx',{wait:false});
    await until(()=>f.js(`typeof window.releaseFileRead==='function'`));
    await f.select('player-route',failure?'rwgps-57873019':'rwgps-57873112');
    await until(()=>f.js(`!document.getElementById('fly').disabled`));
    await f.js(`File.prototype.arrayBuffer=window.readFileOriginal;releaseFileRead();delete window.releaseFileRead`);
    await sleep(100);
    assert.equal(await f.js(`document.getElementById('local-status').textContent`),'');
    assert.equal(await f.js(`document.getElementById('relive-source').textContent`),'');
    assert.equal(await f.js(`document.getElementById('ride-mode').value`),'experiment');
    assert.equal(await f.js(`document.querySelectorAll('[data-private]').length`),0);
  }
  assert.deepEqual(f.exceptions,[]);
});
