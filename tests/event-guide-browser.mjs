import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../tools/build-release.mjs';
import { readRoutePack } from '../tools/route-pack.mjs';
import { browser, until } from './browser.mjs';
import { syntheticGPX } from './local-route-fixtures.mjs';

async function fixture(t,{fault=null,denyStorage=false}={}) {
  const tmp=await mkdtemp(join(tmpdir(),'kotr-guide-')),out=join(tmp,'public');
  const cleanup=[],jobs=new Set(),errors=[],network=[],events=[];
  let server;
  t.after(async()=>{
    for(const close of cleanup)await close();
    if(server?.listening) {
      const closed=new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
      server.closeAllConnections();await closed;
    }
    await Promise.all([...jobs]);await rm(tmp,{recursive:true,force:true});
    assert.deepEqual(errors,[]);
  });
  const source=fileURLToPath(new URL('../',import.meta.url));
  await build(source,out);
  const {pack}=await readRoutePack(source),files=await readdir(out,{recursive:true});
  const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css',
    '.json':'application/json','.gpx':'application/xml'};
  server=createServer((req,res)=>{
    const job=(async()=>{
      const url=new URL(req.url,'http://localhost'),path=url.pathname.slice('/kotr27/'.length)||'index.html';
      if(!url.pathname.startsWith('/kotr27/')||!files.includes(path)||!types[extname(path)])
        return res.writeHead(404).end();
      if(fault?.(path,pack))return res.writeHead(503).end('unavailable');
      const data=path.startsWith('js/config.')?'window.KOTR_CONFIG = {};':await readFile(join(out,path));
      res.writeHead(200,{'Content-Type':types[extname(path)],'Cache-Control':'no-store'}).end(data);
    })().catch(e=>{errors.push(e);res.destroy();}).finally(()=>jobs.delete(job));
    jobs.add(job);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const b=await browser({after:fn=>cleanup.push(fn)},m=>{
    if(m.method==='Network.requestWillBeSent')network.push(m.params.request.url);
    if(m.method==='Page.lifecycleEvent')events.push(m.params);
  });
  await b.cmd('Page.enable');await b.cmd('Page.setLifecycleEventsEnabled',{enabled:true});
  await b.cmd('Network.enable');await b.cmd('Network.setBlockedURLs',{urls:['https://*']});
  await b.cmd('Emulation.setDeviceMetricsOverride',{width:375,height:850,deviceScaleFactor:1,mobile:true});
  await b.cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  if(denyStorage)await b.cmd('Page.addScriptToEvaluateOnNewDocument',{source:
    `Object.defineProperty(window,'indexedDB',{get(){throw new DOMException('Denied','SecurityError')}});`});
  const evaluate=async expression=>{
    const r=await b.cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;
  };
  const base=`http://127.0.0.1:${server.address().port}/kotr27/`;
  async function navigate(url,{planner=true}={}) {
    const {loaderId}=await b.cmd('Page.navigate',{url});
    await until(()=>events.some(e=>e.loaderId===loaderId&&e.name==='DOMContentLoaded'));
    await until(()=>b.js(`document.getElementById('site-shell')?.dataset.ready==='true' &&
      ${planner?"document.getElementById('trip-planner')?.dataset.ready==='true'":'true'}`));
  }
  const shell=files.find(f=>f.startsWith('js/site-shell.'));
  const session=files.find(f=>f.startsWith('js/route-session.'));
  const select=patch=>evaluate(`import('./${shell}').then(m=>m.navigateSelection(${JSON.stringify(patch)}))`);
  const snapshot=()=>evaluate(`import('./${session}').then(m=>m.routePlayback.getSnapshot())`);
  async function upload() {
    const path=join(tmp,'private-print-sentinel.gpx');
    await writeFile(path,syntheticGPX({recording:true}));
    await b.cmd('DOM.enable');
    const {root}=await b.cmd('DOM.getDocument');
    const {nodeId}=await b.cmd('DOM.querySelector',{nodeId:root.nodeId,selector:'#local-file'});
    await b.cmd('DOM.setFileInputFiles',{nodeId,files:[path]});
    await until(()=>b.js(`!document.getElementById('local-file').disabled &&
      new URL(location.href).searchParams.get('route')?.startsWith('user:')`));
  }
  const key=async(key,code,n)=>{
    for(const type of ['keyDown','keyUp'])await b.cmd('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:n,
      ...(type==='keyDown'&&key==='Enter'?{text:'\r'}:{})});
  };
  async function printText() {
    const {data}=await b.cmd('Page.printToPDF',{preferCSSPageSize:true,displayHeaderFooter:false,printBackground:false});
    const bytes=Buffer.from(data,'base64');assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
    const process=spawn('pdftotext',['-layout','-','-']);
    const chunks=[],err=[];process.stdout.on('data',b=>chunks.push(b));process.stderr.on('data',b=>err.push(b));
    const done=once(process,'close');process.stdin.end(bytes);
    const [code]=await done;assert.equal(code,0,Buffer.concat(err).toString());
    return Buffer.concat(chunks).toString();
  }
  return {...b,evaluate,navigate,base,pack,files,network,select,snapshot,key,printText,session,upload};
}

test('packaged Prepare 375px: all choices, keyboard, history, checklist memory and global Forget',async t=>{
  const f=await fixture(t),route=f.pack.catalog.routes.find(r=>r.name.startsWith('D3L'));
  await f.navigate(`${f.base}index.html?area=explore&view=briefing&route=${route.id}&rev=${route.currentRevisionId}`);
  await until(()=>f.js(`!!document.getElementById('briefing-hardest-jump')`));
  await f.js(`document.getElementById('briefing-hardest-jump').click()`);
  const start=await f.snapshot();
  await f.js(`[...document.querySelectorAll('#site-content a')].find(a=>a.textContent==='Practise selected section').focus()`);
  await f.key('Enter','Enter',13);
  assert.equal(await f.js(`document.getElementById('prepare-week').value`),'2');
  assert.equal(await f.js('document.activeElement.id'),'site-heading');
  assert.equal((await f.snapshot()).distanceM,start.distanceM);
  for(let week=1;week<=4;week++)for(const goal of ['social','performance'])for(const cue of ['feel','power']) {
    for(const [id,value] of [['week',week],['goal',goal],['cue',cue]])await f.js(`{
      const e=document.getElementById('prepare-${id}');e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('change'));
    }`);
    const p=await f.js(`document.getElementById('prepare-practice').textContent`);
    for(const text of ['Try:','Cue:','Recovery / easier option:','Shorter option:','Missed-week note:'])assert.ok(p.includes(text));
    assert.equal(await f.js(`document.getElementById('prepare-week').value`),String(week));
    assert.equal((await f.snapshot()).distanceM,start.distanceM);
    assert.ok(await f.js('document.documentElement.scrollWidth<=innerWidth'));
  }
  await f.js(`document.getElementById('prepare-cue').focus()`);
  await f.key('ArrowUp','ArrowUp',38);
  // Native select keyboard interaction may commit on Enter on this platform.
  await f.key('Enter','Enter',13);
  assert.equal(await f.js(`document.getElementById('prepare-week').value`),'4');
  await f.js(`document.getElementById('packing-0').focus()`);
  await f.key(' ','Space',32);
  assert.equal(await f.js(`document.getElementById('packing-0').checked`),true);
  await f.select({area:'ride-week'});
  assert.match(await f.js(`document.getElementById('ride-card').textContent`),/What to expect/);
  const history=await f.cmd('Page.getNavigationHistory');
  await f.cmd('Page.navigateToHistoryEntry',{entryId:history.entries[history.currentIndex-1].id});
  await until(()=>f.js(`new URL(location.href).searchParams.get('area')==='prepare'`));
  assert.equal(await f.js(`document.getElementById('packing-0').checked`),true);
  assert.equal(await f.js(`document.getElementById('prepare-week').value`),'4');
  const url=await f.js('location.href');
  await f.navigate(url);
  assert.equal(await f.js(`document.getElementById('packing-0').checked`),false);
  assert.equal(await f.js(`document.getElementById('prepare-week').value`),'4');
  await f.js(`document.getElementById('packing-0').click();document.getElementById('site-preferences').open=true;document.getElementById('preference-forget').click()`);
  await until(()=>f.js(`document.getElementById('preference-forget-status').textContent.startsWith('All app-owned local data removed')`));
  assert.equal(await f.js(`document.getElementById('packing-0').checked`),false);
  await f.js(`document.documentElement.style.fontSize='200%'`);
  assert.ok(await f.js('document.documentElement.scrollWidth<=innerWidth'));
  assert.ok(!f.network.some(u=>u.startsWith('https:')));
  assert.deepEqual(f.exceptions,[]);
});

test('packaged date-only zone boundary, all seven revisioned cards and actual print output',async t=>{
  const f=await fixture(t);
  await f.cmd('Emulation.setTimezoneOverride',{timezoneId:'America/Los_Angeles'});
  await f.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
    { const NativeDate=Date; window.Date=class extends NativeDate {
      constructor(...args){super(...(args.length?args:['2027-05-19T22:00:00Z']))}
      static now(){return NativeDate.parse('2027-05-19T22:00:00Z')}
    }; }`});
  await f.navigate(`${f.base}explore.html?area=ride-week&view=briefing`);
  assert.match(await f.js(`document.getElementById('event-countdown').textContent`),/Within.*2027-05-20 in Europe\/Rome/);
  assert.match(await f.js(`document.getElementById('event-dates').textContent`),/2027-05-20.*2027-05-24/);
  const sources=await f.js(`[...document.querySelectorAll('#event-briefing a')].map(a=>a.href)`);
  assert.deepEqual(sources,['https://ridewithgps.com/events/512634','https://data.iana.org/time-zones/tzdb/zone1970.tab']);
  let pdf;
  for(const route of f.pack.catalog.routes) {
    await f.select({area:'ride-week',routeId:route.id,revisionId:route.currentRevisionId,dayId:null,variantId:null});
    await until(async()=> (await f.snapshot()).identity?.routeId===route.id);
    await f.evaluate(`import('./${f.session}').then(m=>m.routePlayback.seekDistance(1000))`);
    const text=await f.js(`document.getElementById('ride-card').textContent`);
    assert.ok(text.includes(route.currentRevisionId));assert.ok(text.includes(route.name));
    assert.match(text,/Selected position 1.0 km/);
    assert.match(text,/Processed ascent.*raw point ascent.*Source-listed/);
    assert.match(text,/As of observation 2026-11-24/);
    if(route.name.startsWith('D4S'))assert.match(text,/Shared ride-time model unavailable/);
    pdf=await f.printText();
    assert.ok(pdf.replace(/\s+/g,'').includes(route.currentRevisionId));
    assert.match(pdf,/not verified road grade/);
    assert.match(pdf,/No actual facility POIs/);
    assert.match(pdf,/Europe\/Rome/);
    assert.match(pdf,/ridewithgps.com\/events\/512634/);
    assert.doesNotMatch(pdf,/Preferences & privacy|Forget all local data|Find a practice ride/);
    assert.ok(pdf.split('\f').filter(p=>p.trim()).length<=4,'bounded print layout');
    assert.ok(await f.js('document.documentElement.scrollWidth<=innerWidth'));
  }
  // Missing/private routes cannot print previously selected organizer details.
  await f.select({area:'ride-week',routeId:'user:00000000-0000-4000-8000-000000000001',revisionId:null,dayId:null,variantId:null});
  pdf=await f.printText();
  assert.match(pdf,/organizer-route only/);assert.doesNotMatch(pdf,/rwgps-578|Processed ascent/);
  await f.select({area:'explore'});
  await f.upload();
  assert.match(await f.js(`document.getElementById('site-selection').textContent`),/Synthetic private sentinel/);
  // Ctrl/P or browser print from Explore also excludes local hidden/view data.
  pdf=await f.printText();
  assert.doesNotMatch(pdf,/Synthetic private sentinel|private-print-sentinel|Recorded|Heart rate|Processed ascent/);
  await f.select({area:'ride-week'});
  assert.match(await f.js(`document.getElementById('ride-card').textContent`),/private local routes.*excluded/);
  pdf=await f.printText();
  assert.doesNotMatch(pdf,/Synthetic private sentinel|private-print-sentinel/);
  assert.ok(!f.network.some(u=>u.startsWith('https:')));
  assert.deepEqual(f.exceptions,[]);
});

test('packaged unavailable catalog/profile, blocked storage and invalid revisions stay honest',async t=>{
  const f=await fixture(t,{denyStorage:true,fault:(path,pack)=>path===pack.catalog.routes[0].revisions[0].geometry.path});
  const route=f.pack.catalog.routes[0];
  await f.navigate(`${f.base}index.html?area=ride-week&route=${route.id}&rev=${route.currentRevisionId}`);
  await until(()=>f.js(`document.getElementById('site-content').getAttribute('aria-busy')==='false'`));
  assert.match(await f.js(`document.getElementById('ride-card').textContent`),/Profile.*unavailable.*No substitute totals/);
  await f.select({area:'prepare',week:3,goal:'performance',cue:'power'});
  assert.match(await f.js(`document.getElementById('prepare-practice').textContent`),/Week 3.*Recovery.*Shorter option/);
  await f.js(`document.getElementById('packing-0').click()`);
  assert.equal(await f.js(`document.getElementById('packing-0').checked`),true);
  await f.select({area:'ride-week',revisionId:'unavailable-revision'});
  assert.match(await f.js(`document.getElementById('ride-card').textContent`),/No cleared organizer route/);
  assert.doesNotMatch(await f.printText(),/Processed ascent/);
  assert.deepEqual(f.exceptions,[]);
  const missing=await fixture(t,{fault:path=>path.startsWith('assets/route-pack.')});
  await missing.navigate(`${missing.base}index.html?area=prepare`,{planner:false});
  assert.match(await missing.js(`document.getElementById('event-countdown').textContent`),/pending verified dates and timezone/);
  assert.match(await missing.js(`document.getElementById('event-dates').textContent`),/pending/);
  assert.ok(await missing.js(`!!document.getElementById('prepare-week')`));
  assert.deepEqual(missing.exceptions,[]);
});
