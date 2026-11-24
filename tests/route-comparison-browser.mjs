import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../tools/build-release.mjs';
import { readRoutePack } from '../tools/route-pack.mjs';
import { browser, until } from './browser.mjs';

async function fixture(t) {
  const tmp=await mkdtemp(join(tmpdir(),'kotr-comparison-')), out=join(tmp,'public');
  const cleanup=[], pending=new Set(), errors=[], requests=[], network=[], downloads=[];
  const downloadPath=join(tmp,'downloads'); await mkdir(downloadPath);
  let server, seq=0, navigation, context;
  const fault={path:null};
  t.after(async()=>{
    for (const close of cleanup) await close();
    if (server?.listening) {
      const closed=new Promise((resolve,reject)=>server.close(e=>e ? reject(e) : resolve()));
      server.closeAllConnections(); await closed;
    }
    await Promise.all([...pending]);
    await rm(tmp,{recursive:true,force:true});
    if (errors.length) throw new AggregateError(errors,'Comparison fixture errors');
  });
  const source=fileURLToPath(new URL('../',import.meta.url));
  await build(source,out);
  const {pack}=await readRoutePack(source), files=await readdir(out,{recursive:true});
  const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript',
    '.css':'text/css','.gpx':'application/xml','.json':'application/json'};
  async function serve(req,res) {
    const url=new URL(req.url,'http://localhost'), path=url.pathname.slice('/kotr27/'.length)||'index.html';
    requests.push(path);
    if (!url.pathname.startsWith('/kotr27/') || !files.includes(path) || !types[extname(path)])
      return res.writeHead(404).end();
    if (path===fault.path) return res.writeHead(503).end('unavailable');
    const data=path.startsWith('js/config.') ? 'window.KOTR_CONFIG = {};' : await readFile(join(out,path));
    res.writeHead(200,{'Content-Type':types[extname(path)],'Cache-Control':'no-store'}).end(data);
  }
  server=createServer((req,res)=>{
    const job=serve(req,res).catch(e=>{errors.push(e);res.destroy();}).finally(()=>pending.delete(job));
    pending.add(job);
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const b=await browser({after:fn=>cleanup.push(fn)},m=>{
    seq++;
    if (m.method==='Network.requestWillBeSent') network.push(m.params.request.url);
    if (m.method==='Browser.downloadWillBegin' || m.method==='Browser.downloadProgress')
      downloads.push({method:m.method,...m.params});
    if (m.method==='Page.frameNavigated' && !m.params.frame.parentId) navigation={...m.params.frame,seq};
    if (m.method==='Runtime.executionContextCreated' && m.params.context.auxData?.isDefault)
      context={...m.params.context,seq};
  });
  await b.cmd('Page.enable'); await b.cmd('Network.enable');
  await b.cmd('Network.setBlockedURLs',{urls:['https://*']});
  const evaluate=async expression=>{
    const r=await b.cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails)); return r.result.value;
  };
  const base=`http://127.0.0.1:${server.address().port}/kotr27/`;
  const module=name=>files.find(f=>f.startsWith(`js/${name}.`));
  const snapshot=()=>evaluate(`import('./${module('route-session')}').then(m=>m.routePlayback.getSnapshot())`);
  const ready=()=>until(()=>b.js(`document.getElementById('site-shell')?.dataset.ready==='true' &&
    document.getElementById('trip-planner')?.dataset.ready==='true' &&
    document.getElementById('route-comparison')?.dataset.ready==='true'`));
  const goto=async url=>{
    const before=seq;
    await b.cmd('Page.navigate',{url});
    // No Runtime polling against the outgoing document: wait for the intended
    // destination frame AND its fresh default execution context first.
    await until(()=>navigation?.seq>before && navigation.url===url &&
      context?.seq>navigation.seq && context.auxData.frameId===navigation.id);
    await ready();
  };
  const link=(r,view='compare')=>`${base}explore.html?area=explore&view=${view}&route=${r.id}&rev=${r.currentRevisionId}`;
  const select=patch=>evaluate(`import('./${module('site-shell')}').then(m=>m.navigateSelection(${JSON.stringify(patch)}))`);
  const key=async(key,code,n)=>{for(const type of ['keyDown','keyUp']) await b.cmd('Input.dispatchKeyEvent',
    {type,key,code,windowsVirtualKeyCode:n,...(type==='keyDown' && (key==='Enter' || key.length===1) ?
      {text:key==='Enter' ? '\r' : key} : {})});};
  return {...b,pack,files,requests,network,downloads,downloadPath,fault,base,ready,evaluate,snapshot,link,select,goto,key,module};
}

for (const width of [375,1280]) test(`packaged comparison ${width}px: shared selection, honest axes, keyboard, no tiles`,async t=>{
  const f=await fixture(t),{js,key}=f;
  await f.cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
  const long=f.pack.catalog.routes.find(r=>r.name.startsWith('D2L'));
  const short=f.pack.catalog.routes.find(r=>r.name.startsWith('D2S'));
  await f.goto(f.link(long));
  await until(async()=> (await f.snapshot()).identity?.routeId===long.id);
  assert.equal(await js(`document.querySelectorAll('.comparison-route').length`),2);
  assert.match(await js(`document.getElementById('comparison-deltas').textContent`),/Long minus Short.*\+.*derived ascent/);
  assert.match(await js(`document.getElementById('comparison-scales').textContent`),/equal distance/);
  assert.match(await js(`document.querySelector('.comparison-route').textContent`),/NOT a common map scale/);
  assert.match(await js(`document.querySelector('.comparison-route').textContent`),/No verified POIs/);
  const accessibility=await f.cmd('Accessibility.getFullAXTree');
  assert.ok(accessibility.nodes.some(n=>n.role?.value==='region' &&
    n.name?.value==='Route comparison, skyline and radial overview'));
  assert.ok(accessibility.nodes.some(n=>n.role?.value==='combobox' &&
    n.name?.value==='Compare profile horizontal axis'));
  if (width===375) assert.ok(await js(`document.querySelector('.comparison-route details').open`),'phone text alternative open by default');
  await js(`document.getElementById('comparison-axis').focus()`);
  // Native type-ahead works without opening a macOS select popup, which CDP
  // does not drive consistently. Still actual browser keyboard events.
  await key('n','KeyN',78); await key('Tab','Tab',9);
  await until(()=>js(`document.getElementById('comparison-axis').value==='progress'`));
  assert.match(await js(`document.getElementById('comparison-scales').textContent`),/normalized progress.*NOT equal road distance/);
  const scale=await js(`document.getElementById('comparison-scales').textContent`);
  await js(`document.querySelector('input[data-route="${short.id}"]').focus()`);
  await key(' ','Space',32);
  assert.equal(await js(`document.querySelectorAll('.comparison-route').length`),1);
  assert.equal(await js(`document.getElementById('comparison-scales').textContent`),scale);
  await key(' ','Space',32);
  // Native keyboard route selection retains focus even when the panels rebuild.
  await js(`document.querySelector('.comparison-route[data-route="${short.id}"] button').focus()`);
  await key('Enter','Enter',13);
  await until(async()=> (await f.snapshot()).identity?.routeId===short.id);
  assert.equal(await js(`document.activeElement.textContent`),'Select route for exploration');
  const chapter=await js(`(()=>{const card=document.querySelector('.comparison-route[data-route="${short.id}"]');
    card.querySelector('details').open=true; const b=card.querySelectorAll('ol button')[1]; b.focus(); return b.textContent;})()`);
  await key('Enter','Enter',13);
  let state=await f.snapshot();
  assert.ok(state.distanceM>0); assert.match(await js('location.search'),/chapter=/);
  const selectedChapter=state.chapterId, selectedDistance=state.distanceM;
  assert.equal(await js(`document.querySelector('.comparison-route[data-selected="true"]').dataset.chapter`),selectedChapter);
  for (const view of ['skyline','radial','compare']) {
    await js(`document.querySelector('#route-comparison a[data-view="${view}"]').focus()`);
    await key('Enter','Enter',13);
    await until(()=>js(`new URL(location.href).searchParams.get('view')==='${view}'`));
    state=await f.snapshot();
    assert.equal(state.identity.routeId,short.id); assert.equal(state.chapterId,selectedChapter);
    assert.equal(state.distanceM,selectedDistance);
    assert.equal(await js('document.activeElement.id'),'site-heading');
    assert.ok(await js(`document.querySelector('.comparison-route[data-selected="true"] button[aria-current]')!==null`));
    assert.ok(await js('document.documentElement.scrollWidth<=innerWidth'));
    if (view==='radial') {
      const values=await js(`Array.from(document.querySelectorAll('.comparison-route[data-selected="true"] svg')).map(e=>[e.dataset.chapter,e.dataset.distance])`);
      assert.deepEqual(values,[[selectedChapter,String(selectedDistance)],[selectedChapter,String(selectedDistance)]]);
      assert.match(await js(`document.getElementById('comparison-scales').textContent`),/NOT geography or equal kilometres/);
      await js(`Array.from(document.querySelectorAll('#route-comparison button')).find(b=>b.textContent==='Rotate right +30°').focus()`);
      await key('Enter','Enter',13);
      assert.match(await js(`document.getElementById('comparison-scales').textContent`),/Rotation 30°/);
      assert.equal((await f.snapshot()).distanceM,selectedDistance);
      // Radial numbered mark selects the same shared chapter as the list.
      const marker=await js(`(()=>{const e=document.querySelector('.comparison-route[data-selected="true"] .comparison-radial text');
        e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
      assert.equal(await js(`document.elementFromPoint(${marker.x},${marker.y}).getAttribute('data-chapter')`),
        await js(`document.querySelector('.comparison-route[data-selected="true"] .comparison-radial text').dataset.chapter`),
        'first spaced marker is not hidden under a later label');
      for (const type of ['mousePressed','mouseReleased']) await f.cmd('Input.dispatchMouseEvent',
        {type,...marker,button:'left',clickCount:1});
      assert.equal((await f.snapshot()).distanceM,0);
      await js(`{const c=document.querySelector('.comparison-route[data-selected="true"]');c.querySelector('details').open=true;c.querySelectorAll('ol button')[1].focus();}`);
      await key('Enter','Enter',13);
      assert.equal((await f.snapshot()).chapterId,selectedChapter);
    }
  }
  assert.ok(await js(`document.querySelector('.comparison-route details').compareDocumentPosition(document.querySelector('.comparison-profile')) & Node.DOCUMENT_POSITION_FOLLOWING`));
  // Revision-pinned briefing link retains the selected occurrence.
  await js(`document.querySelector('.comparison-route[data-selected="true"] .comparison-open').focus()`);
  const pinned=await js('document.activeElement.href');
  assert.match(pinned,new RegExp(`rev=${short.currentRevisionId}`)); assert.match(pinned,new RegExp(`chapter=${selectedChapter}`));
  await key('Enter','Enter',13);
  await until(()=>js(`!document.getElementById('route-briefing').hidden`));
  assert.equal((await f.snapshot()).chapterId,selectedChapter);
  assert.equal(await js(`document.querySelector('#briefing-chapters button[aria-current]').textContent`),chapter);
  await f.select({view:'radial'});
  const restore=await js('location.href');
  await f.goto(restore+'&comparison-test=restored');
  assert.equal((await f.snapshot()).chapterId,selectedChapter);
  assert.equal((await f.snapshot()).phase,'paused');
  await f.select({chapterId:null,distanceM:1234});
  await until(async()=> (await f.snapshot()).distanceM===1234);
  const exact=await js(`document.querySelector('.comparison-route[data-selected="true"] .comparison-open').href`);
  assert.equal(new URL(exact).searchParams.get('chapter'),null,'arbitrary distance must not snap to containing chapter');
  assert.equal(new URL(exact).searchParams.get('at'),'1234');
  await f.evaluate(`import('./${f.module('route-session')}').then(m=>m.routePlayback.seekDistance(m.routePlayback.getSnapshot().totalDistanceM))`);
  const finish=await js(`document.querySelector('.comparison-route[data-selected="true"] .comparison-open').href`);
  assert.ok(Number(new URL(finish).searchParams.get('at'))<=(await f.snapshot()).totalDistanceM);
  await js(`document.documentElement.style.fontSize='200%'`);
  assert.ok(await js('document.documentElement.scrollWidth<=innerWidth'),'200% text');
  assert.ok(!f.network.some(u=>u.startsWith('https:')),'no external map imagery requested');
  // Exactly one pair per route per document; compare adds no geometry loader.
  for (const r of f.pack.catalog.routes) for (const ref of [r.revisions[0].geometry,r.revisions[0].profile])
    assert.equal(f.requests.filter(p=>p===ref.path).length,2);
  assert.deepEqual(await f.evaluate('indexedDB.databases()'),[]);
  assert.deepEqual(f.exceptions,[]);
});

test('packaged Plan with comparison preserves completed download bytes (browser completion barrier)',async t=>{
  const f=await fixture(t);
  await f.cmd('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:f.downloadPath,eventsEnabled:true});
  await f.goto(f.base+'index.html?area=plan&view=briefing');
  for (const route of f.pack.catalog.routes) {
    const name=`${route.id}--${route.currentRevisionId}.gpx`;
    await f.js(`document.getElementById('trip-gpx-${route.id}').click()`);
    const started=await until(()=>f.downloads.find(d=>d.suggestedFilename===name));
    await until(()=>f.downloads.some(d=>d.guid===started.guid && d.state==='completed'));
    // Filename existence is not a completion signal: Chrome can create the
    // destination before writing it. Check only after the actual browser event.
    const bytes=await readFile(join(f.downloadPath,name));
    assert.equal(createHash('sha256').update(bytes).digest('hex'),route.revisions[0].geometry.sha256);
  }
  assert.deepEqual(f.exceptions,[]);
});

test('packaged comparison: missing data and withdrawn fixture stay explicit; Plan does not infer itinerary',async t=>{
  const f=await fixture(t),route=f.pack.catalog.routes.find(r=>r.name.startsWith('D2L'));
  f.fault.path=route.revisions[0].profile.path;
  await f.goto(f.link(route));
  assert.match(await f.js(`document.querySelector('.comparison-route[data-route="${route.id}"]').textContent`),/Validated profile unavailable/);
  assert.equal(await f.js(`document.querySelector('.comparison-route[data-route="${route.id}"] svg')`),null);
  assert.match(await f.js(`document.getElementById('comparison-deltas').textContent`),/unavailable/);
  await f.goto(f.base+'index.html?area=plan&view=briefing');
  assert.ok(await f.js(`!document.getElementById('route-comparison').hidden`));
  const preferences=f.module('preferences-view');
  assert.equal(await f.evaluate(`import('./${preferences}').then(m=>m.riderState.snapshot().itinerary)`),null);
  assert.match(await f.js(`document.getElementById('trip-summary').textContent`),/0 of 4/);
  // Exercise the packaged view's tombstone path with a validated synthetic
  // catalog. No changed metadata bypasses the production manifest verifier.
  const result=await f.evaluate(`(async()=>{
    const {createCatalog}=await import('./${f.module('route-catalog')}');
    const {installRouteComparison}=await import('./${f.module('route-comparison-view')}');
    const data=${JSON.stringify(f.pack.catalog)}, r=data.routes[0], old=r.currentRevisionId;
    r.status='withdrawn';r.currentRevisionId=null;r.revisions=[];
    data.annotations=data.annotations.filter(a=>a.routeId!==r.id);
    const host=document.createElement('section');document.body.append(host);
    const v=installRouteComparison(host,{catalog:createCatalog(data),analysisFor:async()=>null,
      navigate:()=>{throw Error('must not select withdrawn');},href:()=>''});
    await v.ready;
    v.show({state:{area:'explore',view:'compare',routeId:r.id,revisionId:old,distanceM:0},bundle:null,profile:null});
    const card=host.querySelector('.comparison-route');
    const result={text:card.textContent,charts:card.querySelectorAll('svg').length,buttons:card.querySelectorAll('button').length};
    host.remove();return result;
  })()`);
  assert.match(result.text,/withdrawn or unavailable/); assert.equal(result.charts,0); assert.equal(result.buttons,0);
  assert.deepEqual(f.exceptions,[]);
});
