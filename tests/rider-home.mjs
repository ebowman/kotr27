// Actual built /kotr27/ acceptance, not the prototype URL. Uses only isolated
// native Chrome profiles; never captures/overwrites the prior design evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { build } from '../tools/build-release.mjs';
import { browser, until } from './browser.mjs';

async function fixture(t) {
  const tmp=await mkdtemp(join(tmpdir(),'kotr-home-')),out=join(tmp,'public'),cleanup=[];
  let server;
  t.after(async()=>{
    for (const close of cleanup.reverse()) await close();
    server?.closeAllConnections();
    if (server) await new Promise(resolve=>server.close(resolve));
    await rm(tmp,{recursive:true,force:true});
  });
  await build('.',out);
  const names=(await readdir(out,{recursive:true})).filter(p=>extname(p));
  const files=new Map(await Promise.all(names.map(async p=>[p,await readFile(join(out,p))])));
  const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript',
    '.css':'text/css','.json':'application/json','.gpx':'application/xml'};
  const requests=[],fault={path:null,bytes:null};
  server=createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost'),path=url.pathname.slice('/kotr27/'.length)||'index.html';
    requests.push({path,referrer:req.headers.referer});
    if (!url.pathname.startsWith('/kotr27/') || !files.has(path)) return res.writeHead(404).end();
    if (fault.path===path) return res.writeHead(fault.bytes?200:503,{'Content-Type':types[extname(path)]}).end(fault.bytes);
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
      for (let i=0;i<34;i++) {
        const s=await state();
        if (s.proof.ok && s.online) return s;
        assert.ok(!s.status.includes('unavailable'),JSON.stringify(s));
        await sleep(500);
      }
      assert.fail('Live built entry terrain did not verify');
    };
    await click(b,'fly');await terrainReady();
    await click(b,'play');
    await until(()=>b.js(`parseFloat(document.getElementById('progress').textContent)>0`));
    // Real DOM drag input, no camera/proof/timing overrides.
    await b.js(`observedTerrain.getCanvas().dispatchEvent(new MouseEvent('mousedown',{
      bubbles:true,clientX:${width/2},clientY:${height/2},button:0,buttons:1}))`);
    for (let i=1;i<=16;i++) {
      await b.js(`document.dispatchEvent(new MouseEvent('mousemove',{
        bubbles:true,clientX:${width/2+i*60},clientY:${height/2},button:0,buttons:1}))`);
      await sleep(40);
    }
    await b.js(`document.dispatchEvent(new MouseEvent('mouseup',{
      bubbles:true,clientX:${width/2+960},clientY:${height/2},button:0}))`);
    await sleep(3500);
    const manual=await terrainReady();
    assert.equal(manual.proof.mode,'manual');assert.equal(manual.playing,false);
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
    await select(b,'player-route','rwgps-57873112');await ready(b);await terrainReady();
    assert.equal(await b.js(`maps.length===2 && maps[0]._removed`),true);
    await click(b,'back');
    assert.equal(await b.js(`document.querySelectorAll('#terrain canvas').length`),0);
    assert.equal(await b.js(`document.activeElement.id`),'fly');
    assert.deepEqual(b.exceptions,[]);
    t.diagnostic(JSON.stringify({width,height,manual:manual.proof,returned:returned.proof}));
  }
});
