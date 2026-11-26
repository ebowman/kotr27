import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../tools/build-release.mjs';
import { readRoutePack } from '../tools/route-pack.mjs';
import { browser, until } from './browser.mjs';
import { loadRouteAnalysis } from '../js/route-analysis-loader.mjs';
import { sensitivityProfile } from '../js/route-pace.mjs';
import { evaluateClimbSensitivityPoint } from '../js/climb-sensitivity.mjs';

async function fixture(t) {
  const tmp=await mkdtemp(join(tmpdir(),'kotr-pace-')), out=join(tmp,'public');
  const cleanup=[], jobs=new Set(), errors=[], network=[], contexts=[], gates=new Map();
  let server;
  t.after(async()=>{
    for (const gate of gates.values()) gate.resolve();
    for (const close of cleanup) await close();
    if (server?.listening) {
      const closed=new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
      server.closeAllConnections(); await closed;
    }
    await Promise.all([...jobs]); await rm(tmp,{recursive:true,force:true});
    assert.deepEqual(errors,[]);
  });
  const source=fileURLToPath(new URL('../',import.meta.url));
  await build(source,out);
  const files=await readdir(out,{recursive:true}), {pack}=await readRoutePack(source);
  async function serve(req,res) {
    const url=new URL(req.url,'http://localhost'), path=url.pathname.slice('/kotr27/'.length)||'index.html';
    const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript',
      '.css':'text/css','.json':'application/json','.gpx':'application/xml'};
    if (!url.pathname.startsWith('/kotr27/') || !files.includes(path) || !types[extname(path)])
      return res.writeHead(404).end();
    await gates.get(path)?.promise;
    const data=path.startsWith('js/config.') ? 'window.KOTR_CONFIG = {};' : await readFile(join(out,path));
    res.writeHead(200,{'Content-Type':types[extname(path)],'Cache-Control':'no-store'}).end(data);
  }
  server=createServer((req,res)=>{
    const job=serve(req,res).catch(e=>{errors.push(e);res.destroy();}).finally(()=>jobs.delete(job));
    jobs.add(job);
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const b=await browser({after:fn=>cleanup.push(fn)},m=>{
    if (m.method==='Network.requestWillBeSent') network.push(m.params.request.url);
    if (m.method==='Runtime.executionContextCreated' && m.params.context.auxData?.isDefault)
      contexts.push(m.params.context);
  });
  await b.cmd('Page.enable'); await b.cmd('Network.enable');
  await b.cmd('Network.setBlockedURLs',{urls:['https://*']});
  const evaluate=async expression=>{
    const r=await b.cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails)); return r.result.value;
  };
  const base=`http://127.0.0.1:${server.address().port}/kotr27/`;
  const file=prefix=>files.find(f=>f.startsWith(`js/${prefix}.`));
  const session=file('route-session'), shell=file('site-shell');
  async function navigate(url) {
    const seen=contexts.length, result=await b.cmd('Page.navigate',{url});
    assert.ok(!result.errorText);
    // Observe the NEW default execution context before issuing DOM readiness
    // reads; do not evaluate against an about-to-be-replaced old document.
    await until(()=>contexts.slice(seen).some(c=>c.auxData.frameId===result.frameId && c.origin===new URL(base).origin));
  }
  const ready=()=>until(()=>b.js(`document.getElementById('site-shell')?.dataset.ready==='true' &&
    document.getElementById('pace-total')?.dataset.elapsedSeconds !== undefined`));
  const snapshot=()=>evaluate(`import('./${session}').then(m=>m.routePlayback.getSnapshot())`);
  const select=route=>evaluate(`import('./${shell}').then(m=>m.navigateSelection({area:'explore',view:'briefing',
    routeId:'${route.id}',revisionId:'${route.currentRevisionId}',dayId:null,variantId:null}))`);
  const set=(id,value,event='input')=>b.js(`{const e=document.getElementById('${id}');
    e.value=${JSON.stringify(String(value))};e.dispatchEvent(new Event('${event}'));}`);
  const key=async(key,code,n)=>{for(const type of ['keyDown','keyUp']) await b.cmd('Input.dispatchKeyEvent',
    {type,key,code,windowsVirtualKeyCode:n,...(key==='Enter' && type==='keyDown'?{text:'\r'}:{})});};
  return {...b,base,pack,files,gates,network,navigate,ready,evaluate,snapshot,select,set,key,session,shell};
}

test('packaged 375px keyboard/no-map: shared times, stops, factors, bounded meshes, privacy and retired links',async t=>{
  const f=await fixture(t), route=f.pack.catalog.routes[0], {js}=f;
  await f.cmd('Emulation.setDeviceMetricsOverride',{width:375,height:900,deviceScaleFactor:1,mobile:true});
  await f.navigate(`${f.base}index.html?area=explore&view=briefing&route=${route.id}&rev=${route.currentRevisionId}`);
  await f.ready();
  await until(()=>js(`document.getElementById('trip-planner')?.dataset.ready==='true'`));
  assert.equal(await js(`document.getElementById('pace-scenario').value`),'steady');
  await js(`document.getElementById('briefing-seek').focus()`);
  await f.key('ArrowRight','ArrowRight',39);
  assert.equal((await f.snapshot()).distanceM,100);
  async function samePoint() {
    const p=(await f.snapshot()).estimatedRide;
    for (const id of ['pace-position','pace-clock-readout','briefing-estimate-status']) {
      const data=await js(`({...document.getElementById('${id}').dataset})`);
      assert.equal(Number(data.movingSeconds),p.movingSeconds,id);
      assert.equal(Number(data.elapsedSeconds),p.elapsedSeconds,id);
    }
  }
  await samePoint();
  const original=(await f.snapshot()).estimatedRide.elapsedSeconds;
  await f.set('briefing-rate',4,'change'); await samePoint();
  assert.equal((await f.snapshot()).estimatedRide.elapsedSeconds,original);
  // Actual native text entry updates the common rider owner, without map/FTP gates.
  await js(`document.getElementById('pace-ftp').focus()`);
  await f.cmd('Input.insertText',{text:'260'});
  assert.equal(await js('document.activeElement.id'),'pace-ftp');
  await samePoint();
  assert.ok((await f.snapshot()).estimatedRide.elapsedSeconds<original);
  await f.set('pace-mass','75');
  const kg=(await f.snapshot()).estimatedRide.elapsedSeconds;
  await f.set('pace-unit','lb','change');
  assert.equal((await f.snapshot()).estimatedRide.elapsedSeconds,kg);
  assert.equal(await js(`document.getElementById('pace-unit').value`),'lb');
  await f.set('pace-scenario','hard','change'); await samePoint();
  assert.match(await js(`document.getElementById('pace-assumptions').textContent`),/90%/);
  await f.set('pace-scenario','all-day','change');
  assert.match(await js(`document.getElementById('pace-assumptions').textContent`),/75% seed/);
  await f.set('pace-scenario','steady','change');
  // Common Plan/Explore and route/revision navigation never changes documents
  // or drops physical preferences. Test public controls, not only store calls.
  await js(`document.querySelector('.site-nav a[href*="area=plan"]').click()`);
  assert.equal(await js(`document.getElementById('pace-ftp').value`),'260');
  await js(`document.querySelector('.site-nav a[href*="area=explore"]').click()`);
  assert.equal(await js(`document.getElementById('pace-ftp').value`),'260');
  assert.equal(await js('location.pathname'),'/kotr27/index.html');
  await f.set('pace-stop',5);
  const total=await js(`({...document.getElementById('pace-total').dataset})`);
  assert.equal(Number(total.stopSeconds),300);
  assert.equal(Number(total.elapsedSeconds),Number(total.movingSeconds)+300);
  const day=f.pack.catalog.variants.find(v=>v.id===route.variantId).dayId;
  await f.set(`trip-choice-${day}`,route.id,'change');
  assert.deepEqual(await js(`({...document.getElementById('trip-time').dataset})`),
    {...total,pedalWorkKJ:await js(`document.getElementById('trip-time').dataset.pedalWorkKJ`)});
  await f.set('pace-clock',100);
  assert.equal((await f.snapshot()).distanceM,0);
  assert.match(await js(`document.getElementById('pace-clock-readout').textContent`),/Within planned stop/);
  assert.equal(Number(await js(`document.getElementById('pace-position').dataset.elapsedSeconds`)),0);
  await f.set('pace-clock',400); await samePoint();
  await js(`document.getElementById('pace-sensitivity').open=true`);
  const meshReady=()=>until(()=>js(`!document.getElementById('pace-sens-content').hidden &&
    document.getElementById('pace-sens-error').textContent===''`));
  await meshReady();
  assert.match(await js(`document.getElementById('pace-sensitivity-name').textContent`),new RegExp(route.name));
  const builds=Number(await js(`document.getElementById('route-pace').dataset.meshBuilds`));
  assert.equal(builds,1);
  await f.set('pace-sens-mode','heatmap','change');
  await js(`document.getElementById('pace-sens-chart').focus()`);
  await f.key('ArrowRight','ArrowRight',39); await f.key('ArrowUp','ArrowUp',38);
  const cards=await js(`Object.fromEntries([...document.querySelectorAll('#pace-sens-comparisons section')].map(e=>
    [e.dataset.scenario,Object.fromEntries([...e.querySelectorAll('data')].map(d=>[d.dataset.field,Number(d.value)]))]))`);
  assert.equal(cards.weight.ftpW,cards.baseline.ftpW);
  assert.equal(cards.ftp.riderKg,cards.baseline.riderKg);
  assert.equal(cards.combined.riderKg,cards.weight.riderKg);
  assert.equal(cards.combined.ftpW,cards.ftp.ftpW);
  for (const p of Object.values(cards)) {
    assert.ok(Math.abs(p.deltaMinutes-(p.movingMinutes-cards.baseline.movingMinutes))<1e-10);
    assert.ok(Math.abs(p.deltaPercent-p.deltaMinutes/cards.baseline.movingMinutes*100)<1e-10);
  }
  await f.evaluate(`import('./${f.session}').then(({routePlayback:p})=>{
    for(let i=0;i<120;i++) p.seekDistance(i*10);
    p.play(); for(let i=0;i<180;i++) p.tick(i*16); p.pause();
  })`);
  assert.equal(Number(await js(`document.getElementById('route-pace').dataset.meshBuilds`)),builds,
    '120 seeks plus 180 animation ticks: zero meshes');
  const section=await js(`document.getElementById('pace-sensitivity-target').options[1].value`);
  await f.set('pace-sensitivity-target',section,'change'); await meshReady();
  assert.equal((await f.snapshot()).chapterId,section);
  assert.match(await js(`document.getElementById('pace-sensitivity-name').textContent`),/section 1/);
  await f.set('pace-sensitivity-target','','change'); await meshReady();
  assert.equal(Number(await js(`document.getElementById('route-pace').dataset.meshBuilds`)),builds+1,
    'one section mesh, return to cached whole-route mesh');
  await js(`{const e=document.getElementById('pace-ftp'); for(let i=0;i<20;i++){
    e.value=String(270+i);e.dispatchEvent(new Event('input'));}}`);
  await meshReady();
  assert.equal(Number(await js(`document.getElementById('route-pace').dataset.meshBuilds`)),builds+2,'20 edits coalesced');
  t.diagnostic('Measured: 1 initial mesh; 120 seeks + 180 ticks = 0 meshes; 1 section mesh; return = cache hit; 20 synchronous rider edits = 1 mesh.');
  await f.set('pace-ftp','bad');
  assert.equal((await f.snapshot()).estimatedRide.status,'unavailable');
  assert.equal(await js(`document.getElementById('pace-total').dataset.elapsedSeconds`),undefined);
  assert.ok(await js(`document.getElementById('pace-sens-content').hidden`));
  await js(`document.getElementById('briefing-next-button').click()`);
  assert.equal((await f.snapshot()).phase,'paused');
  await js(`document.getElementById('pace-clear').focus()`); await f.key('Enter','Enter',13);
  await meshReady(); await samePoint();
  assert.equal(await js(`document.getElementById('pace-ftp').value`),'');
  assert.equal(await js(`document.getElementById('pace-unit').value`),'kg');
  assert.equal(Number(await js(`document.getElementById('pace-total').dataset.stopSeconds`)),0);
  for (const r of f.pack.catalog.routes) {
    await f.select(r); await until(async()=> (await f.snapshot()).identity?.routeId===r.id);
    if (r.name.startsWith('D4S')) {
      assert.equal((await f.snapshot()).estimatedRide.status,'unavailable');
      assert.match(await js(`document.getElementById('pace-total').textContent`),/unavailable/);
      assert.ok(await js(`document.getElementById('pace-sens-content').hidden`));
    } else await meshReady();
    assert.ok(await js('document.documentElement.scrollWidth<=innerWidth'));
  }
  assert.ok(!f.network.some(u=>u.startsWith('https:')));
  assert.deepEqual(await f.evaluate('indexedDB.databases()'),[]);
  assert.equal(await js('localStorage.length'),0);
  assert.ok(!await js(`/ftp|mass|weight|220|260/.test(location.search)`));
  // Retired selections clear the controller, rather than substituting a route.
  await f.evaluate(`import('./${f.shell}').then(m=>m.navigateSelection({area:'explore',view:'flyover',
    routeId:'semonzo-example',revisionId:null,dayId:null,variantId:null}))`);
  await until(()=>js(`document.getElementById('site-notice')?.textContent.includes('retired')`));
  assert.equal((await f.snapshot()).phase,'idle');
  assert.ok(await js(`document.getElementById('route-pace').hidden && !document.getElementById('flyover-ride-time')`));
  assert.deepEqual(f.exceptions,[]);
});

test('late route completion and rapid switching preserve latest input and exact selected revision',async t=>{
  const f=await fixture(t), [a,b,c]=f.pack.catalog.routes;
  const gate=Promise.withResolvers(); f.gates.set(a.revisions[0].profile.path,gate);
  await f.navigate(`${f.base}index.html?area=explore&view=briefing&route=${b.id}&rev=${b.currentRevisionId}`);
  await f.ready();
  await f.set('pace-ftp','333');
  await f.js(`document.getElementById('pace-ftp').focus()`);
  gate.resolve();
  await until(()=>f.js(`document.getElementById('trip-planner')?.dataset.ready==='true'`));
  assert.equal(await f.js(`document.getElementById('pace-ftp').value`),'333');
  assert.equal(await f.js('document.activeElement.id'),'pace-ftp');
  assert.equal((await f.snapshot()).identity.routeId,b.id);
  await f.evaluate(`import('./${f.shell}').then(m=>{
    for (const r of ${JSON.stringify([a,b,a,c])}) m.navigateSelection({area:'explore',view:'briefing',
      routeId:r.id,revisionId:r.currentRevisionId,dayId:null,variantId:null});
  })`);
  await until(async()=> (await f.snapshot()).identity?.routeId===c.id);
  assert.match(await f.js(`document.getElementById('pace-assumptions').textContent`),/333 W FTP/);
  assert.match(await f.js(`document.getElementById('route-pace').textContent`),new RegExp(c.name));
  assert.equal((await f.snapshot()).phase,'ready');
  assert.deepEqual(f.exceptions,[]);
  assert.deepEqual(await f.evaluate('indexedDB.databases()'),[]);
});

test('unsupported sensitivity targets cannot revive a previous route or section through controls or queued work',async t=>{
  const f=await fixture(t), supported=f.pack.catalog.routes[0];
  const d4=f.pack.catalog.routes.find(r=>r.id==='rwgps-57874050');
  const analysis=await loadRouteAnalysis({pack:f.pack,routeId:d4.id,revisionId:d4.currentRevisionId,
    readAsset:path=>readFile(new URL('../'+path,import.meta.url))});
  const chapter=analysis.chapters.find(c=>c.kind==='ascent' && sensitivityProfile(analysis,c.id).status==='available');
  assert.ok(chapter);
  const profile=sensitivityProfile(analysis,chapter.id).profile;
  await f.cmd('Emulation.setDeviceMetricsOverride',{width:375,height:900,deviceScaleFactor:1,mobile:true});
  await f.navigate(`${f.base}index.html?area=explore&view=briefing&route=${supported.id}&rev=${supported.currentRevisionId}`);
  await f.ready();
  await until(()=>f.js(`document.getElementById('trip-planner')?.dataset.ready==='true'`));
  const settle=()=>f.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const ready=()=>until(()=>f.js(`!document.getElementById('pace-sens-content').hidden &&
    document.getElementById('pace-sens-error').textContent===''`));
  const builds=()=>f.js(`Number(document.getElementById('route-pace').dataset.meshBuilds)`);
  const error=()=>f.js(`document.getElementById('pace-sens-error').textContent`);
  async function unavailableAfterControls(expectedBuilds) {
    const reason=await error();
    assert.match(reason,/unavailable/i);
    await f.set('pace-sens-effort',81);
    // Hidden numeric controls may still receive queued/programmatic events.
    for (const id of ['pace-sens-mode','pace-sens-view','pace-sens-ftp','pace-sens-mass'])
      await f.js(`document.getElementById('${id}').dispatchEvent(new Event('change'))`);
    await f.js(`document.getElementById('pace-sens-home').click()`);
    await settle();
    assert.equal(await error(),reason,'unsupported-target reason survives all controls');
    assert.equal(await builds(),expectedBuilds,'no mesh from the previous profile');
    assert.ok(await f.js(`document.getElementById('pace-sens-content').hidden`));
    assert.equal(await f.js(`document.getElementById('pace-sens-chart').childElementCount`),0);
    assert.equal(await f.js(`document.getElementById('pace-sens-minutes').textContent`),'');
    assert.equal(await f.js(`document.getElementById('pace-sens-minutes').getAttribute('value')`),null);
    assert.equal(await f.js(`document.getElementById('pace-sens-comparisons').childElementCount`),0);
    assert.match(await f.js(`document.getElementById('pace-sensitivity-name').textContent`),/D4S.*whole route/);
  }
  await f.js(`document.getElementById('pace-sensitivity').open=true`); await ready();
  const initial=await builds();
  await f.select(d4);
  await unavailableAfterControls(initial);
  // Inputs entered while unsupported must be used on recovery, not the
  // previously available route's rider baseline.
  await f.set('pace-ftp',333); await f.set('pace-mass',83);
  await f.set('pace-sensitivity-target',chapter.id,'change'); await ready();
  const exact=(riderKg,ftpW,fraction)=>evaluateClimbSensitivityPoint(profile,
    {riderKg,ftpW,bikeKitKg:12,effortFraction:fraction}).movingSeconds/60;
  assert.equal(await f.js(`Number(document.getElementById('pace-sens-minutes').value)`),exact(83,333,.81));
  const sectionBuilds=await builds();
  // Queue a valid-section calculation, then invalidate it in the same task.
  await f.js(`{
    const effort=document.getElementById('pace-sens-effort');
    effort.value='82'; effort.dispatchEvent(new Event('input'));
    const target=document.getElementById('pace-sensitivity-target');
    target.value=''; target.dispatchEvent(new Event('change'));
    effort.value='83'; effort.dispatchEvent(new Event('input'));
  }`);
  await settle();
  await unavailableAfterControls(sectionBuilds);
  await f.set('pace-ftp',344); await f.set('pace-mass',84);
  await f.set('pace-sensitivity-target',chapter.id,'change'); await ready();
  assert.equal(await f.js(`Number(document.getElementById('pace-sens-minutes').value)`),exact(84,344,.81));
  const recovered=await builds();
  await f.set('pace-sensitivity-target','','change');
  await unavailableAfterControls(recovered);
  await f.set('pace-sensitivity-target',chapter.id,'change'); await ready();
  assert.equal(await builds(),recovered,'valid identity/physical-input cache remains reusable');
  await f.select(supported); await ready();
  assert.match(await f.js(`document.getElementById('pace-sensitivity-name').textContent`),new RegExp(supported.name));
  assert.match(await f.js(`document.getElementById('pace-sens-baseline').textContent`),/344 W FTP.*84 kg/);
  assert.deepEqual(f.exceptions,[]);
  assert.ok(!f.network.some(u=>u.startsWith('https:')));
  assert.deepEqual(await f.evaluate('indexedDB.databases()'),[]);
});

test('late sensitivity module completion uses current unsupported target and latest recovery inputs',async t=>{
  const f=await fixture(t), route=f.pack.catalog.routes[0];
  const d4=f.pack.catalog.routes.find(r=>r.id==='rwgps-57874050');
  const module=f.files.find(p=>p.startsWith('js/climb-sensitivity-view.'));
  const gate=Promise.withResolvers(); f.gates.set(module,gate);
  await f.navigate(`${f.base}index.html?area=explore&view=briefing&route=${route.id}&rev=${route.currentRevisionId}`);
  await f.ready();
  await until(()=>f.js(`document.getElementById('trip-planner')?.dataset.ready==='true'`));
  await f.js(`document.getElementById('pace-sensitivity').open=true`);
  await until(()=>f.network.some(url=>url.endsWith(module)));
  await f.select(d4);
  await f.set('pace-ftp',321); await f.set('pace-mass',82);
  gate.resolve();
  await until(()=>f.js(`document.getElementById('pace-sens-error').textContent.includes('Sensitivity unavailable')`));
  await f.set('pace-sens-effort',84);
  await f.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.equal(await f.js(`document.getElementById('route-pace').dataset.meshBuilds`),'0');
  assert.ok(await f.js(`document.getElementById('pace-sens-content').hidden`));
  assert.match(await f.js(`document.getElementById('pace-sens-error').textContent`),/Sensitivity unavailable/);
  await f.select(route);
  await until(()=>f.js(`!document.getElementById('pace-sens-content').hidden`));
  const analysis=await loadRouteAnalysis({pack:f.pack,routeId:route.id,revisionId:route.currentRevisionId,
    readAsset:path=>readFile(new URL('../'+path,import.meta.url))});
  const exact=evaluateClimbSensitivityPoint(sensitivityProfile(analysis).profile,
    {riderKg:82,ftpW:321,bikeKitKg:12,effortFraction:.84});
  assert.equal(await f.js(`Number(document.getElementById('pace-sens-minutes').value)`),exact.movingSeconds/60);
  assert.equal(await f.js(`document.getElementById('route-pace').dataset.meshBuilds`),'1');
  assert.equal(await f.js(`document.getElementById('pace-ftp').value`),'321');
  assert.deepEqual(f.exceptions,[]);
  assert.ok(!f.network.some(u=>u.startsWith('https:')));
  assert.deepEqual(await f.evaluate('indexedDB.databases()'),[]);
});
