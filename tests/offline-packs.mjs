import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {mkdtemp, mkdir, readFile, readdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {canonical,validateOfflineManifest,selectedResources} from '../js/offline-contract.mjs';
import {browser,until} from './browser.mjs';
import {buildOfflineRehearsal} from '../tools/offline-review.mjs';

const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css',
  '.json':'application/json','.gpx':'application/gpx+xml'};
// Real Chrome, real SW/CacheStorage/IDB, and a socket-level network outage.
async function fixture(t,scope='/kotr27/') {
  const tmp=await mkdtemp(join(tmpdir(),'kotr-offline-'));
  let cleanup;
  t.after(async()=>{if(cleanup)await cleanup();else await rm(tmp,{recursive:true,force:true});});
  const artifacts=join(tmp,'artifacts'),downloads=join(tmp,'downloads');
  await mkdir(downloads);
  await buildOfflineRehearsal(artifacts);
  const a=join(artifacts,'a'),b=join(artifacts,'b');
  const manifests=await Promise.all([a,b].map(p=>readFile(join(p,'offline-release.json'),'utf8').then(JSON.parse)));
  const files=await readdir(a,{recursive:true}), requests=[], inflight=new Set();
  const fault={path:null,mode:null,release:a,offline:false,manifest:null};
  let held=null;
  const server=createServer((req,res)=>{
    const operation=(async()=>{
      if(fault.offline){req.socket.destroy();return;}
      const url=new URL(req.url,'http://localhost'),path=url.pathname.slice(scope.length)||'index.html';
      requests.push({path,headers:req.headers});
      if(!url.pathname.startsWith(scope) || path.includes('..'))return res.writeHead(404).end();
      if(path===fault.path) {
        if(fault.mode==='hold') {await new Promise(resolve=>{held=resolve;});}
        if(fault.mode==='corrupt')return res.writeHead(200,{'Content-Type':types[extname(path)]}).end('corrupt');
        if(fault.mode==='fail')return res.writeHead(503).end();
      }
      try {
        const bytes=path==='offline-release.json' && fault.manifest?canonical(fault.manifest):await readFile(join(fault.release,path));
        res.writeHead(200,{'Content-Type':types[extname(path)]??'text/plain','Cache-Control':'no-store'}).end(bytes);
      } catch(error){if(error.code!=='ENOENT')throw error;res.writeHead(404).end();}
    })();
    inflight.add(operation);operation.finally(()=>inflight.delete(operation));
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  // Register one ordered teardown: browser first, sockets/handlers second, files last.
  const after=[];const child={after:fn=>after.push(fn)};
  let chrome;
  cleanup=async()=>{
    for(const fn of after.reverse())await fn();
    held?.();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    await Promise.all([...inflight]);await rm(tmp,{recursive:true,force:true});
  };
  const events=[];
  chrome=await browser(child,m=>events.push(m));
  const {cmd,js}=chrome;
  const evaluate=async expression=>{
    const r=await cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;
  };
  await cmd('Page.enable');await cmd('Network.enable');
  await cmd('Network.setBlockedURLs',{urls:['https://*']});
  await cmd('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads,eventsEnabled:true});
  const base=`http://127.0.0.1:${server.address().port}${scope}`;
  const ready=()=>until(()=>js(`(document.querySelector('#landing') ||
    (document.querySelector('#site-shell')?.dataset.ready==='true' &&
    document.querySelector('#trip-planner')?.dataset.ready==='true')) &&
    !!document.querySelector('#offline-check')`));
  const go=async url=>{
    await cmd('Page.navigate',{url});
    await until(()=>js(`location.href===${JSON.stringify(url)} && document.readyState==='complete'`));
    await ready();
  };
  const client=files.find(f=>f.startsWith('js/offline-client.'));
  const api=code=>evaluate(`import('./${client}').then(async m=>{${code}})`);
  const status=()=>api('return m.packStatus()');
  const check=()=>api('return m.preview()');
  const save=(manifest=manifests[0],days=['kotr-d1'])=>api(`const s=await m.packStatus();
    try {await m.install(${JSON.stringify(days)},'${manifest.release}',s.epoch);return {ok:true};}
    catch(e){return {error:e.message};}`);
  return {...chrome,evaluate,api,status,check,save,ready,go,base,tmp,artifacts,downloads,events,requests,fault,manifests,
    releaseHold:()=>held?.(),held:()=>!!held,files};
}

test('manifest binds complete allowlisted release; selected days omit unchosen geometry',async t=>{
  const f=await fixture(t),m=f.manifests[0];
  await validateOfflineManifest(m);
  const refs=selectedResources(m,['kotr-d1']);
  assert.equal(m.routes.length,7);
  assert.ok(refs.some(r=>r.path.includes('local-route-parser')));
  assert.ok(!refs.some(r=>r.path.includes('https:')));
  const d2=m.routes.find(r=>r.day==='kotr-d2');
  assert.ok(d2.paths.every(p=>!refs.some(r=>r.path===p)));
  assert.ok(refs.reduce((n,r)=>n+r.bytes,0)<50*1024**2);
  await assert.rejects(validateOfflineManifest({...m,common:[]}),/checksum/);
  assert.throws(()=>selectedResources(m,['invented-date']),/Choose/);
});

test('opt-in → truly disconnected reload/profile/export → deletion; no private/provider cache',async t=>{
  const f=await fixture(t,'/test-offline/');
  await f.cmd('Emulation.setDeviceMetricsOverride',{width:375,height:900,deviceScaleFactor:1,mobile:true});
  await f.go(f.base+'index.html?area=plan');
  assert.deepEqual(await f.evaluate('indexedDB.databases()'),[]);
  assert.deepEqual(await f.evaluate('caches.keys()'),[]);
  assert.equal(await f.evaluate('navigator.serviceWorker.getRegistration().then(r=>!!r)'),false);
  await f.js(`document.querySelector('#offline-check').click()`);
  await until(()=>f.js(`document.querySelector('#offline-days input[value="kotr-d1"]')!==null`));
  await f.js(`document.querySelector('#offline-days input[value="kotr-d1"]').click();document.querySelector('#offline-save').click()`);
  await until(()=>f.js(`document.querySelector('#offline-status').textContent.includes('Saved complete')`));
  assert.equal(await f.js('!!navigator.serviceWorker.controller'),false,'no force claim');
  assert.equal((await f.status()).active.complete,true);
  assert.equal(await f.js('document.documentElement.scrollWidth<=innerWidth'),true,'saved revision/bytes fit a phone');
  const route=f.manifests[0].routes.find(r=>r.day==='kotr-d1');
  const url=f.base+`index.html?area=explore&view=briefing&route=${route.id}&rev=${route.revision}`;
  await f.go(url);
  assert.equal(await f.js('!!navigator.serviceWorker.controller'),true);
  f.fault.offline=true;
  await f.cmd('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await f.go(url);
  assert.match(await f.js(`document.querySelector('#site-selection').textContent`),/D1/);
  assert.ok(await f.js(`document.querySelector('svg')!==null`));
  await until(()=>f.js(`document.querySelector('#offline-currentness').textContent.includes('cannot be checked')`));
  assert.equal((await f.status()).active.complete,true);
  // Saved common assets must actually render the new root while disconnected.
  // An unsaved default preview stays unavailable, not silently replaced by the
  // saved day. The rider can explicitly select that saved day's D0 route.
  await f.go(f.base);
  await until(()=>f.js(`document.querySelector('#route-title').textContent==='Route unavailable'`));
  assert.equal(await f.js(`document.querySelector('#fly').disabled`),true);
  assert.equal(await f.js(`document.querySelector('#landing-route').disabled`),false);
  await f.js(`document.querySelector('#landing-route').value='0';
    document.querySelector('#landing-route').dispatchEvent(new Event('change'))`);
  await until(()=>f.js(`!document.querySelector('#fly').disabled`));
  assert.equal(await f.js(`document.querySelector('#route-title').textContent`),'D0 Warm-up');
  await f.js(`document.querySelector('#offline').checked=true;document.querySelector('#fly').click();
    document.querySelector('#play').click()`);
  await until(()=>f.js(`parseFloat(document.querySelector('#progress').textContent)>0`));
  await f.js(`document.querySelector('#back').click()`);
  await f.go(url);
  const keys=await f.evaluate(`caches.keys().then(async keys=>Promise.all(keys.map(async k=>
    (await (await caches.open(k)).keys()).map(r=>r.url))))`);
  assert.ok(keys.flat().every(u=>u.startsWith(f.base) && !/mapbox|open-meteo|private|\\.fit/.test(u)));
  await f.go(f.base+`index.html?area=plan&route=${route.id}&rev=${route.revision}`);
  await f.js(`document.querySelector('#trip-gpx-${route.id}').click()`);
  const begin=await until(()=>f.events.find(e=>e.method==='Browser.downloadWillBegin'));
  await until(()=>f.events.some(e=>e.method==='Browser.downloadProgress' && e.params.guid===begin.params.guid && e.params.state==='completed'));
  const bytes=await readFile(join(f.downloads,begin.params.suggestedFilename));
  const ref=f.manifests[0].resources.find(r=>route.paths.includes(r.path) && r.path.endsWith('.gpx'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),ref.sha256);
  // Native local file selection after disconnection also exercises the cached
  // dedicated parser-worker import graph, not just main-thread profiles.
  await f.cmd('DOM.enable');
  const {root}=await f.cmd('DOM.getDocument');
  const {nodeId}=await f.cmd('DOM.querySelector',{nodeId:root.nodeId,selector:'#local-file'});
  await f.cmd('DOM.setFileInputFiles',{nodeId,files:[join(f.downloads,begin.params.suggestedFilename)]});
  await until(()=>f.js(`document.querySelector('#local-status').textContent.includes('Imported')`));
  await f.js(`[...document.querySelectorAll('#local-files button')].find(b=>b.textContent.startsWith('Remember')).click()`);
  await until(()=>f.js(`document.querySelector('#local-status').textContent.includes('Remembered on')`));
  await f.evaluate(`caches.open('another-app').then(c=>c.put('/unrelated',new Response('keep')))`);
  await f.js(`document.querySelector('#site-preferences').open=true;document.querySelector('#preference-forget').click()`);
  await until(()=>f.js(`document.querySelector('#preference-forget-status').textContent.includes('All app-owned local data removed')`));
  assert.equal(await f.js(`document.querySelectorAll('#local-files button').length`),0);
  assert.deepEqual(await f.evaluate('caches.keys()'),['another-app']);
  assert.equal((await f.status()).active,null);
  await f.cmd('Page.navigate',{url:f.base+'index.html?deleted=1'});
  await until(()=>f.js(`!document.querySelector('#site-shell')`));
});

test('atomic update: hash/fetch/quota failures retain old complete pack; explicit B reload and fresh probe',async t=>{
  const f=await fixture(t);
  await f.go(f.base+'index.html');
  assert.deepEqual(await f.save(),{ok:true});
  await f.go(f.base+'index.html?area=prepare');
  const old=(await f.status()).active.release;
  f.fault.release=join(f.artifacts,'b');
  await f.check();
  const b=f.manifests[1],ref=b.resources.find(r=>r.path==='index.html');
  f.fault.path=ref.path;f.fault.mode='corrupt';
  assert.match((await f.save(b)).error,/checksum/);
  assert.equal((await f.status()).active.release,old);
  assert.equal((await f.status()).active.complete,true);
  f.fault.mode='fail';
  assert.match((await f.save(b)).error,/unavailable/);
  assert.equal((await f.status()).active.release,old);
  f.fault.path=null;
  // Real Chrome quota enforcement, not a fake CacheStorage map.
  await f.cmd('Storage.overrideQuotaForOrigin',{origin:new URL(f.base).origin,quotaSize:1});
  assert.match((await f.save(b)).error,/quota/i);
  assert.equal((await f.status()).active.release,old);
  await f.cmd('Storage.overrideQuotaForOrigin',{origin:new URL(f.base).origin});
  const probe=await f.evaluate(`fetch(location.href,{headers:{'X-KOTR-Freshness':'1'},cache:'no-cache'}).then(r=>r.text())`);
  assert.match(probe,/Offline fixture B/,'worker cannot answer its own freshness probe');
  assert.doesNotMatch(await f.js('document.title'),/Offline fixture B/,'old document still pinned');
  assert.deepEqual(await f.save(b),{ok:true});
  assert.equal((await f.status()).pinned,old);
  assert.equal((await f.status()).active.release,b.release);
  await f.cmd('Runtime.evaluate',{expression:`window.peer=window.open('${f.base}index.html?area=plan');`,userGesture:true});
  await until(()=>f.js(`peer?.document.querySelector('#site-shell')?.dataset.ready==='true'`));
  const bMarker=(await readFile(join(f.artifacts,'b','index.html'),'utf8')).match(/name="kotr-release" content="([^"]+)"/)[1];
  assert.equal(await f.js(`peer.document.querySelector('meta[name="kotr-release"]').content`),bMarker);
  const oldHTML=await f.evaluate(`fetch('./index.html').then(r=>r.text())`);
  assert.doesNotMatch(oldHTML,/Offline fixture B/,'old client still serves its own complete HTML');
  assert.equal((await f.evaluate(`caches.keys()`)).length,2,'old client retains old cache alongside new active');
  await f.js('peer.close()');
  await f.go(f.base+'index.html?area=ride-week');
  assert.equal((await f.status()).pinned,b.release);
  assert.equal(await f.js(`document.querySelector('meta[name="kotr-release"]').content`),
    (await readFile(join(f.artifacts,'b','index.html'),'utf8')).match(/name="kotr-release" content="([^"]+)"/)[1]);
  // The actual root belongs to the new saved graph too, not the old planner.
  await f.go(f.base);
  assert.equal(await f.js(`!!document.querySelector('#landing') && !document.querySelector('#site-shell')`),true);
  assert.equal((await f.status()).pinned,b.release);
  assert.equal(await f.js(`document.querySelector('#player-route').options.length`),7);
  const oldRoute=f.manifests[0].routes.find(r=>r.day==='kotr-d1');
  await f.go(f.base+`index.html?area=explore&route=${oldRoute.id}&rev=${oldRoute.revision}`);
  assert.match(await f.js(`document.querySelector('#site-notice').textContent`),/revision unavailable/);
  assert.equal(new URL(await f.js('location.href')).searchParams.get('rev'),oldRoute.revision,'no silent replacement');
  const current=b.routes.find(r=>r.id===oldRoute.id);
  await f.js(`const select=document.querySelector('#site-revision');select.value='${current.revision}';select.dispatchEvent(new Event('change'));`);
  await until(()=>f.js(`document.querySelector('#site-selection').textContent.includes('${current.revision}')`));
});

test('worker termination ignores abandoned staging and retains a complete old release on disconnected reload',async t=>{
  const f=await fixture(t);
  await f.cmd('ServiceWorker.enable');
  await f.go(f.base+'index.html');
  assert.deepEqual(await f.save(),{ok:true});
  await f.go(f.base+'index.html?area=prepare');
  f.fault.release=join(f.artifacts,'b');
  f.fault.path='index.html';f.fault.mode='hold';
  await f.js(`import('./${f.files.find(x=>x.startsWith('js/offline-client.'))}').then(async m=>{
    const s=await m.packStatus();
    m.install(['kotr-d1'],'${f.manifests[1].release}',s.epoch).catch(()=>{});
  })`);
  await until(f.held);
  const versions=f.events.filter(e=>e.method==='ServiceWorker.workerVersionUpdated').flatMap(e=>e.params.versions);
  const version=[...versions].reverse().find(v=>v.scriptURL===f.base+'offline-worker.js' && v.runningStatus==='running');
  assert.ok(version,'actual running worker discovered');
  await f.cmd('ServiceWorker.stopWorker',{versionId:version.versionId});
  f.fault.path=null;f.fault.mode=null;f.releaseHold();
  const recovered=await f.status();
  assert.equal(recovered.active.release,f.manifests[0].release);
  assert.equal(recovered.active.complete,true);
  assert.equal((await f.evaluate('caches.keys()')).length,1,'abandoned staging is removed on worker restart');
  f.fault.offline=true;
  await f.go(f.base+'index.html?area=prepare&interrupted=1');
  assert.equal((await f.status()).pinned,f.manifests[0].release);
});

test('delete fences an in-flight install and stale epoch; eviction is incomplete, not ready',async t=>{
  const f=await fixture(t);
  await f.go(f.base+'index.html');
  assert.deepEqual(await f.save(),{ok:true});
  const oldEpoch=(await f.status()).epoch;
  f.fault.path='index.html';f.fault.mode='hold';
  // Do not await this operation; the server holds one resource mid-staging.
  await f.js(`window.pendingSave=null;import('./${f.files.find(x=>x.startsWith('js/offline-client.'))}').then(async m=>{
    try {await m.install(['kotr-d1'],'${f.manifests[0].release}',${oldEpoch});window.pendingSave='unexpected saved';}
    catch(e){window.pendingSave=e.message;}})`);
  await until(f.held);
  assert.deepEqual(await f.api('return m.forgetOffline()'),{confirmed:true});
  f.fault.path=null;f.fault.mode=null;f.releaseHold();
  await until(()=>f.js('window.pendingSave!==null'));
  assert.match(await f.js('window.pendingSave'),/canceled/);
  assert.equal((await f.status()).active,null);
  assert.deepEqual(await f.evaluate('caches.keys()'),[]);
  const stale=await f.api(`try {await m.install(['kotr-d1'],'${f.manifests[0].release}',${oldEpoch});return 'saved';}catch(e){return e.message;}`);
  assert.match(stale,/canceled/);
  assert.deepEqual(await f.save(),{ok:true});
  await f.evaluate(`caches.keys().then(async ks=>{const c=await caches.open(ks[0]);await c.delete(new URL('index.html',location.href));})`);
  assert.equal((await f.status()).active.complete,false);
  f.fault.offline=true;
  await f.cmd('Page.navigate',{url:f.base+'index.html?evicted=1'});
  await until(()=>f.js(`document.body.textContent.includes('missing or incomplete')`));
});

test('network withdrawal creates durable tombstone, blocks old exports and clears active views',async t=>{
  const f=await fixture(t);
  await f.go(f.base+'index.html');
  assert.deepEqual(await f.save(),{ok:true});
  const route=f.manifests[0].routes.find(r=>r.day==='kotr-d1');
  await f.go(f.base+`index.html?area=plan&route=${route.id}&rev=${route.revision}`);
  f.fault.release=join(f.artifacts,'withdrawn');
  await f.check();
  await until(()=>f.js(`!document.querySelector('#trip-gpx-${route.id}')`));
  assert.ok((await f.status()).withdrawn.includes(route.id));
  assert.equal(await f.evaluate(`fetch('./${route.paths[0]}').then(r=>r.status)`),410);
  assert.equal(await f.evaluate(`fetch('./${f.manifests[0].catalog}').then(r=>r.status)`),410,'old catalog metrics are retired too');
  assert.equal(await f.evaluate(`caches.keys().then(async ks=>(await (await caches.open(ks[0])).match(new URL('${route.paths[0]}',location.href)))!==undefined)`),false);
  f.fault.offline=true;
  await f.cmd('Page.navigate',{url:f.base+`index.html?area=plan&route=${route.id}&rev=${route.revision}`});
  await until(()=>f.js(`document.querySelector('#site-shell')?.dataset.ready==='true'`));
  await until(()=>f.js(`document.querySelector('#site-notice').textContent.includes('withdrawn')`));
  assert.equal(await f.js(`!!document.querySelector('#trip-gpx-${route.id}')`),false);
});

test('homepage withdrawal clears the already loaded preview and does not substitute another route',async t=>{
  const f=await fixture(t);
  await f.go(f.base);
  assert.deepEqual(await f.save(),{ok:true});
  await f.go(f.base);
  await f.js(`document.querySelector('#landing-route').value='0';
    document.querySelector('#landing-route').dispatchEvent(new Event('change'))`);
  await until(()=>f.js(`!document.querySelector('#fly').disabled &&
    document.querySelector('#route-title').textContent==='D0 Warm-up'`));
  f.fault.release=join(f.artifacts,'withdrawn');
  await f.check();
  await until(()=>f.js(`document.querySelector('#route-title').textContent==='Route unavailable'`));
  assert.equal(await f.js(`document.querySelector('#fly').disabled`),true);
  assert.equal(await f.js(`document.querySelectorAll('#landing-map path').length`),0);
  assert.equal(await f.js(`document.querySelector('#distance').textContent`),'—');
  assert.equal(await f.js(`document.querySelector('#landing-route').value`),'0');
});

test('first-ever offline cannot load shell; storage denial leaves online core usable',async t=>{
  const f=await fixture(t);
  f.fault.offline=true;
  await f.cmd('Page.navigate',{url:f.base+'index.html'});
  await until(()=>f.js(`document.readyState==='complete' && !document.querySelector('#site-shell')`));
  f.fault.offline=false;
  await f.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(globalThis,'indexedDB',{get(){throw new DOMException('denied','SecurityError')}});`});
  await f.go(f.base+'index.html?area=plan');
  assert.equal(await f.js(`document.querySelectorAll('.trip-route').length`),7);
  await until(()=>f.js(`document.querySelector('#offline-status').textContent.includes('unavailable')`));
  assert.match(await f.api(`try {await m.packStatus();return 'unexpected';}catch(e){return e.name;}`),/SecurityError/);
});

test('worker-disabled browser keeps the online planner usable and denies save explicitly',async t=>{
  const f=await fixture(t);
  await f.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`Object.defineProperty(navigator,'serviceWorker',{value:undefined});`});
  await f.go(f.base+'index.html?area=plan');
  assert.equal(await f.js(`document.querySelectorAll('.trip-route').length`),7);
  assert.match((await f.save()).error,/Offline storage unavailable/);
  assert.deepEqual(await f.evaluate('caches.keys()'),[]);
});
