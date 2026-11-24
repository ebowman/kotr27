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

async function fixture(t) {
  const tmp=await mkdtemp(join(tmpdir(),'kotr-briefing-')), out=join(tmp,'public');
  const cleanup=[], inFlight=new Set(), errors=[], requests=[];
  let server;
  const fault={path:null}, gates=new Map();
  t.after(async()=>{
    for (const gate of gates.values()) gate.resolve();
    for (const close of cleanup) await close();
    if (server?.listening) {
      const closed=new Promise((resolve,reject)=>server.close(e=>e ? reject(e) : resolve()));
      server.closeAllConnections(); await closed;
    }
    await Promise.all([...inFlight]);
    await rm(tmp,{recursive:true,force:true});
    if (errors.length) throw new AggregateError(errors,'Briefing fixture failure');
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
    await gates.get(path)?.promise;
    if (path===fault.path) return res.writeHead(503).end('unavailable');
    const data=path.startsWith('js/config.') ? 'window.KOTR_CONFIG = {};' : await readFile(join(out,path));
    res.writeHead(200,{'Content-Type':types[extname(path)],'Cache-Control':'no-store'}).end(data);
  }
  server=createServer((req,res)=>{
    const job=serve(req,res).catch(e=>{errors.push(e);res.destroy();}).finally(()=>inFlight.delete(job));
    inFlight.add(job);
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  const network=[];
  const b=await browser({after:fn=>cleanup.push(fn)},m=>{
    if (m.method==='Network.requestWillBeSent') network.push(m.params.request.url);
  });
  await b.cmd('Page.enable'); await b.cmd('Network.enable');
  await b.cmd('Network.setBlockedURLs',{urls:['https://*']});
  const evaluate=async expression=>{
    const r=await b.cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails)); return r.result.value;
  };
  const base=`http://127.0.0.1:${server.address().port}/kotr27/`;
  const session=files.find(f=>f.startsWith('js/route-session.'));
  const shell=files.find(f=>f.startsWith('js/site-shell.'));
  const snapshot=()=>evaluate(`import('./${session}').then(m=>m.routePlayback.getSnapshot())`);
  const ready=()=>until(()=>b.js(`document.getElementById('site-shell')?.dataset.ready==='true' &&
    document.getElementById('trip-planner')?.dataset.ready==='true' &&
    !!document.getElementById('briefing-map')?.dataset.distance`));
  const link=r=>`${base}explore.html?area=explore&view=briefing&route=${r.id}&rev=${r.currentRevisionId}`;
  const select=r=>evaluate(`import('./${shell}').then(m=>m.navigateSelection({area:'explore',view:'briefing',
    routeId:'${r.id}',revisionId:'${r.currentRevisionId}',dayId:null,variantId:null}))`);
  return {...b,pack,files,requests,network,fault,gates,base,ready,evaluate,snapshot,link,select,session};
}

for (const width of [320,375,1280]) test(`packaged linked briefing ${width}px: no FTP, keyboard, blocked provider, all seven`,async t=>{
  const f=await fixture(t),{cmd,js}=f;
  await cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
  await cmd('Page.navigate',{url:f.link(f.pack.catalog.routes[0])}); await f.ready();
  const key=async(key,code,n)=>{for(const type of ['keyDown','keyUp']) await cmd('Input.dispatchKeyEvent',
    {type,key,code,windowsVirtualKeyCode:n,...(type==='keyDown' && key==='Enter' ? {text:'\r'} : {})});};
  for (const route of f.pack.catalog.routes) {
    await f.select(route);
    await until(async()=> (await f.snapshot()).identity?.routeId===route.id);
    assert.ok(await js(`!document.getElementById('route-briefing').hidden`));
    assert.match(await js(`document.getElementById('route-briefing').textContent`),/provider revision date unknown/);
    assert.match(await js(`document.getElementById('briefing-pois').textContent`),/No verified facility POIs/);
    assert.match(await js(`document.getElementById('briefing-hardest').textContent`),/greatest derived gain|No sustained climb/);
    assert.equal((await f.snapshot()).phase,'ready');
    await js(`document.querySelector('#briefing-chapters button').focus()`);
    await key('Enter','Enter',13);
    await js(`document.getElementById('briefing-seek').focus()`);
    await key('ArrowRight','ArrowRight',39);
    assert.equal((await f.snapshot()).distanceM,100);
    assert.equal(await js('document.activeElement.id'),'briefing-seek');
    assert.match(await js('location.search'),/at=100/);
    const linked=await js(`['briefing-map','briefing-profile','briefing-position'].map(id=>document.getElementById(id).dataset.distance)`);
    assert.deepEqual(linked,['100','100','100']);
    await key('End','End',35);
    assert.equal((await f.snapshot()).distanceM,(await f.snapshot()).totalDistanceM);
    assert.match(await js(`document.getElementById('briefing-position').textContent`),/0.0 km remaining/);
    assert.match(await js(`document.getElementById('briefing-next-poi').textContent`),/No later verified POI/);
    assert.match(await js(`document.getElementById('briefing-next').textContent`),/No later section/);
    const before=(await f.snapshot()).distanceM;
    await js(`document.getElementById('briefing-overview').click()`);
    assert.equal((await f.snapshot()).distanceM,before);
    const atEnd=await f.snapshot();
    if (route.name.startsWith('D4S')) {
      assert.equal(atEnd.estimatedRide.status,'unavailable');
      assert.match(await js(`document.getElementById('briefing-estimate-status').textContent`),/unavailable.*Extreme/);
    }
    await js(`document.getElementById('briefing-restart').click()`);
    assert.equal((await f.snapshot()).distanceM,0);
    // Both chart and outline marker choose the exact shared occurrence.
    const fraction=await js(`(()=>{const p=document.getElementById('briefing-profile'),r=p.getBoundingClientRect();
      const event=new MouseEvent('click',{clientX:r.left+r.width/2,bubbles:true});
      p.dispatchEvent(event); return (event.clientX-r.left)/r.width;})()`);
    const half=await f.snapshot();
    assert.ok(Math.abs(half.distanceM-half.totalDistanceM*fraction)<.01);
    await js(`document.querySelector('#briefing-map text').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
    assert.equal((await f.snapshot()).distanceM,0);
    assert.ok(await js('document.documentElement.scrollWidth<=innerWidth'));
  }
  assert.ok(await js(`document.getElementById('briefing-chapters').compareDocumentPosition(document.getElementById('briefing-profile')) & Node.DOCUMENT_POSITION_FOLLOWING`));
  assert.ok(await js(`document.getElementById('briefing-controls').compareDocumentPosition(document.getElementById('briefing-map')) & Node.DOCUMENT_POSITION_FOLLOWING`));
  await js(`document.documentElement.style.fontSize='200%'`);
  assert.ok(await js('document.documentElement.scrollWidth<=innerWidth'));
  assert.ok(!f.network.some(u=>u.startsWith('https:')),'no optional provider requested');
  for (const r of f.pack.catalog.routes) for (const ref of [r.revisions[0].geometry,r.revisions[0].profile])
    assert.equal(f.requests.filter(p=>p===ref.path).length,1,'reuse verified planner analyses');
  assert.deepEqual(await f.evaluate('indexedDB.databases()'),[]);
  assert.deepEqual(f.exceptions,[]);
});

test('packaged stale route responses and failed geometry never replace selected facts',async t=>{
  const f=await fixture(t),[a,b,c]=f.pack.catalog.routes;
  const gate=Promise.withResolvers();
  f.gates.set(a.revisions[0].profile.path,gate);
  f.fault.path=c.revisions[0].geometry.path;
  await f.cmd('Page.navigate',{url:f.link(a)+'&at=100'});
  await until(()=>f.js(`document.getElementById('site-shell')?.dataset.ready==='true'`));
  assert.ok(await f.js(`document.getElementById('route-briefing').hidden`));
  await f.select(b);
  await until(async()=> (await f.snapshot()).identity?.routeId===b.id);
  gate.resolve(); await f.ready();
  assert.equal((await f.snapshot()).identity.routeId,b.id);
  assert.match(await f.js(`document.getElementById('route-briefing').textContent`),new RegExp(b.name));
  await f.select(c);
  await until(()=>f.js(`document.getElementById('site-content').textContent.includes('Profile unavailable')`));
  assert.ok(await f.js(`document.getElementById('route-briefing').hidden`));
  assert.equal((await f.snapshot()).phase,'idle');
  assert.deepEqual(f.exceptions,[]);
});

test('packaged decisive-climb deep links, finish restoration and invalid sections stay paused',async t=>{
  const f=await fixture(t),route=f.pack.catalog.routes.find(r=>r.name.startsWith('D3L'));
  await f.cmd('Page.navigate',{url:f.link(route)}); await f.ready();
  await f.js(`document.getElementById('briefing-hardest-jump').click()`);
  const climb=await f.snapshot();
  assert.equal(climb.phase,'paused');
  assert.match(await f.js('location.search'),new RegExp(`chapter=${climb.chapterId}`));
  const url=await f.js('location.href');
  await f.cmd('Page.navigate',{url:url+'&link-test=chapter'});
  await until(()=>f.js(`location.search.includes('link-test=chapter')`)); await f.ready();
  assert.equal((await f.snapshot()).distanceM,climb.distanceM);
  assert.equal((await f.snapshot()).chapterId,climb.chapterId);
  assert.equal((await f.snapshot()).phase,'paused');
  await f.js(`{const s=document.getElementById('briefing-seek');s.value=s.max;s.dispatchEvent(new Event('input'));}`);
  const end=await f.snapshot(),endURL=await f.js('location.href');
  assert.ok(Number(new URL(endURL).searchParams.get('at'))<=end.totalDistanceM);
  await f.cmd('Page.navigate',{url:endURL+'&link-test=finish'});
  await until(()=>f.js(`location.search.includes('link-test=finish')`)); await f.ready();
  assert.ok(Math.abs((await f.snapshot()).distanceM-end.totalDistanceM)<.001);
  assert.equal((await f.snapshot()).phase,'paused');
  await f.cmd('Page.navigate',{url:f.link(route)+'&chapter=missing-section'});
  await f.ready();
  assert.match(await f.js(`document.getElementById('site-notice').textContent`),/Section unavailable/);
  assert.equal((await f.snapshot()).distanceM,0);
  assert.notEqual((await f.snapshot()).phase,'playing');
  assert.deepEqual(f.exceptions,[]);
});
