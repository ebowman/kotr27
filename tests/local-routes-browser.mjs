import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp,readdir,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from '../tools/build-release.mjs';
import { browser,until } from './browser.mjs';
import { syntheticGPX,syntheticFIT } from './local-route-fixtures.mjs';
import { readRoutePack } from '../tools/route-pack.mjs';
import { loadRouteAnalysis } from '../js/route-analysis-loader.mjs';

function clockFixtureGPX(times,{stationary=false,powerBase=100}={}) {
  return '<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:t="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" version="1.1">'+
    '<trk><name>Clock regression fixture</name><trkseg>'+
    times.map((s,i)=>`<trkpt lat="${45+(stationary?0:i*.0001)}" lon="11.1234567"><ele>100</ele>`+
      `<time>${new Date(Date.UTC(2026,0,1)+s*1000).toISOString()}</time>`+
      `<extensions><t:TrackPointExtension><t:speed>${stationary?0:8}</t:speed><t:power>${powerBase+i}</t:power>`+
      '</t:TrackPointExtension></extensions></trkpt>').join('')+'</trkseg></trk></gpx>';
}

async function fixture(t,{deny=false}={}) {
  const tmp=await mkdtemp(join(tmpdir(),'kotr-local-')),out=join(tmp,'public');
  let server;
  const cleanup=[],inflight=new Set(),errors=[],network=[],events=[],requests=[],messages=[];
  t.after(async()=>{
    for(const close of cleanup)await close();
    if(server?.listening) {
      const closed=new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
      server.closeAllConnections();await closed;
    }
    await Promise.all([...inflight]);await rm(tmp,{recursive:true,force:true});
    assert.deepEqual(errors,[]);
  });
  await build(fileURLToPath(new URL('../',import.meta.url)),out);
  const files=await readdir(out,{recursive:true});
  const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.gpx':'application/xml'};
  server=createServer((req,res)=>{
    const job=(async()=>{
      const body=[];for await(const chunk of req)body.push(chunk);
      requests.push({url:req.url,method:req.method,body:Buffer.concat(body).toString()});
      const url=new URL(req.url,'http://localhost'),path=url.pathname.slice('/kotr27/'.length)||'index.html';
      if(!url.pathname.startsWith('/kotr27/')||!files.includes(path)||!types[extname(path)])return res.writeHead(404).end();
      res.writeHead(200,{'Content-Type':types[extname(path)],'Cache-Control':'no-store',
        // No importer may use connect APIs, even to the first-party server.
        // Public pack fetches still need same origin; private data is checked
        // against every request body/URL below.
        'Content-Security-Policy':"connect-src 'self'; worker-src 'self'"}).end(await readFile(join(out,path)));
    })().catch(e=>{errors.push(e);res.destroy();}).finally(()=>inflight.delete(job));
    inflight.add(job);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const b=await browser({after:fn=>cleanup.push(fn)},m=>{
    if(m.method==='Network.requestWillBeSent')network.push(m.params.request);
    if(m.method==='Page.lifecycleEvent')events.push(m.params);
    if(m.method==='Target.receivedMessageFromTarget')messages.push({...m.params,message:JSON.parse(m.params.message)});
  });
  await b.cmd('Page.enable');await b.cmd('Page.setLifecycleEventsEnabled',{enabled:true});
  await b.cmd('Network.enable');await b.cmd('Network.setBlockedURLs',{urls:['https://*']});
  if(deny)await b.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
    Object.defineProperty(window,'indexedDB',{get(){throw new DOMException('Denied','SecurityError')}});`});
  const evaluate=async expression=>{
    const r=await b.cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;
  };
  const base=`http://127.0.0.1:${server.address().port}/kotr27/`;
  async function navigate(url) {
    const {loaderId}=await b.cmd('Page.navigate',{url});
    await until(()=>events.some(e=>e.loaderId===loaderId&&e.name==='DOMContentLoaded'));
    await until(()=>b.js(`document.getElementById('site-shell')?.dataset.ready==='true' &&
      document.getElementById('trip-planner')?.dataset.ready==='true' &&
      document.getElementById('local-library')?.dataset.ready==='true'`));
  }
  async function upload(bytes,name='private-original-sentinel.gpx',wait=true) {
    const path=join(tmp,name);await writeFile(path,bytes);
    await b.cmd('DOM.enable');
    const {root}=await b.cmd('DOM.getDocument');
    const {nodeId}=await b.cmd('DOM.querySelector',{nodeId:root.nodeId,selector:'#local-file'});
    await b.cmd('DOM.setFileInputFiles',{nodeId,files:[path]});
    if(wait)await until(()=>b.js(`!document.getElementById('local-file').disabled`));
  }
  const action=text=>b.js(`[...document.querySelectorAll('#local-files button')].find(b=>b.textContent===${JSON.stringify(text)}).click()`);
  const storage=files.find(f=>f.startsWith('js/local-route-storage.'));
  const shell=files.find(f=>f.startsWith('js/site-shell.'));
  const session=files.find(f=>f.startsWith('js/route-session.'));
  async function peerPage(url) {
    const {targetId}=await b.cmd('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await b.cmd('Target.attachToTarget',{targetId,flatten:false});
    let serial=0;
    const cmd=async(method,params={})=>{
      const id=++serial;
      await b.cmd('Target.sendMessageToTarget',{sessionId,message:JSON.stringify({id,method,params})});
      const response=await until(()=>messages.find(m=>m.sessionId===sessionId&&m.message.id===id));
      assert.ok(!response.message.error,JSON.stringify(response));return response.message.result;
    };
    const js=async expression=>{
      const r=await cmd('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
      assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;
    };
    await cmd('Runtime.enable');await cmd('Page.enable');
    await cmd('Page.setLifecycleEventsEnabled',{enabled:true});
    const {loaderId}=await cmd('Page.navigate',{url});
    await until(()=>messages.some(m=>m.sessionId===sessionId&&m.message.method==='Page.lifecycleEvent'&&
      m.message.params.loaderId===loaderId&&m.message.params.name==='DOMContentLoaded'));
    await until(()=>js(`document.getElementById('site-shell')?.dataset.ready==='true'`));
    return {js,cmd,exceptions:()=>messages.filter(m=>m.sessionId===sessionId&&m.message.method==='Runtime.exceptionThrown')};
  }
  return {...b,evaluate,navigate,upload,action,base,network,requests,files,storage,shell,session,peerPage};
}

// Hold delivery, NOT the transaction: a peer must observe the committed bytes
// and be able to delete them while the originating save is still unresolved.
async function holdSaveCompletion(f,{reportError=false}={}) {
  await f.evaluate(`{
    const transaction=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(...args) {
      const tx=transaction.apply(this,args);
      if(this.name==='kotr27-local-routes'&&args[1]==='readwrite') {
        IDBDatabase.prototype.transaction=transaction;
        Object.defineProperty(tx,'oncomplete',{set(listener) {
          tx.addEventListener('complete',event=>{
            window.saveCommitted=true;
            window.releaseSaveCompletion=()=>{
              ${reportError ? "tx.onabort(new Event('abort'))" : 'listener.call(tx,event)'};
            };
          });
        }});
      }
      return tx;
    };
  }`);
}

// Deny only this tab's reconciliation reads; writes and the peer remain real
// IndexedDB transactions. Counters provide barriers, not timing assumptions.
async function denyLibraryReads(f) {
  await f.evaluate(`{
    window.denyLibraryRead=true;window.deniedLibraryReads=0;window.completedLibraryReads=0;
    const transaction=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(...args) {
      const read=this.name==='kotr27-local-routes'&&args[1]==='readonly';
      if(read&&denyLibraryRead) {
        window.deniedLibraryReads++;
        throw new DOMException('Temporarily denied reconciliation','SecurityError');
      }
      const tx=transaction.apply(this,args);
      if(read)tx.addEventListener('complete',()=>window.completedLibraryReads++);
      return tx;
    };
  }`);
}

test('packaged native-file 375px: GPX/FIT route and recording, keyboard, offline, memory default and URL privacy',async t=>{
  const f=await fixture(t);
  await f.cmd('Emulation.setDeviceMetricsOverride',{width:375,height:900,deviceScaleFactor:1,mobile:true});
  await f.navigate(f.base+'index.html?area=explore&view=briefing');
  const official=await f.js(`document.querySelector('#site-route').innerHTML`);
  assert.deepEqual(await f.evaluate('indexedDB.databases()'),[]);
  for(const [bytes,name] of [[syntheticGPX(),'private-original-sentinel.gpx'],
    [syntheticGPX({recording:true}),'private-recording.gpx'],
    [syntheticFIT(),'wrong-extension.gpx'],[syntheticFIT({recording:true}),'private-activity.fit']]) {
    await f.upload(bytes,name);
    assert.match(await f.js(`document.getElementById('local-status').textContent`),/Imported/);
    assert.match(await f.js(`document.getElementById('site-selection').textContent`),/local/);
    assert.equal(await f.js(`document.querySelector('#site-route').innerHTML`),official);
    const recorded=/recording|activity/.test(name);
    assert.ok(await f.js(`!document.getElementById('${recorded?'recorded-replay':'route-briefing'}').hidden`));
    assert.ok(await f.js(`!document.getElementById('${recorded?'replay-map':'briefing-map'}').hidden`));
    const url=new URL(await f.js('location.href'));
    assert.deepEqual([...url.searchParams.keys()],['area','view','route']);
    assert.match(url.searchParams.get('route'),/^user:[0-9a-f-]{36}$/);
    await f.js(`document.getElementById('${recorded?'replay-seek':'briefing-seek'}').focus()`);
    for(const type of ['keyDown','keyUp'])await f.cmd('Input.dispatchKeyEvent',{type,key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
    if(recorded) {
      assert.equal(await f.evaluate(`import('./${f.session}').then(m=>m.routePlayback.getSnapshot().recordedClock.elapsedSeconds)`),1);
      assert.match(await f.js(`document.getElementById('replay-heartRateBpm').textContent`),/decoded sample/);
    } else assert.equal(await f.evaluate(`import('./${f.session}').then(m=>m.routePlayback.getSnapshot().distanceM)`),100);
    assert.equal(await f.js('location.href'),url.href,'seek/coordinates/time never enter local URL');
    assert.ok(await f.js('document.documentElement.scrollWidth<=innerWidth'));
  }
  assert.deepEqual(await f.evaluate('indexedDB.databases()'),[]);
  // Preferences grant remains separate and can never adopt a private link.
  await f.js(`document.getElementById('remember-preferences').click()`);
  await until(()=>f.js(`document.getElementById('preference-status').textContent.includes('Remember') ||
    document.getElementById('remember-preferences').checked`));
  assert.deepEqual(f.exceptions,[]);
  // Worker has loaded; later imports work with the network disconnected.
  const networkCount=f.network.length,requestCount=f.requests.length;
  await f.cmd('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await f.upload(syntheticGPX({multi:true,missing:true}),'offline-local.gpx');
  assert.match(await f.js(`document.getElementById('local-status').textContent`),/Imported/);
  assert.equal(await f.js(`document.querySelectorAll('#local-outline path').length`),2);
  assert.ok(await f.js(`document.getElementById('local-details').textContent.includes('Continuous analysis unavailable')`));
  assert.equal(f.network.length,networkCount);assert.equal(f.requests.length,requestCount);
  await f.cmd('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  const link=await f.js('location.href');await f.navigate(link);
  assert.match(await f.js(`document.getElementById('site-notice').textContent`),/unavailable.*Import again/);
  assert.equal(await f.js(`document.getElementById('site-selection').textContent`),'No route opened. Choose explicitly; no replacement has been selected.');
  for(const r of [...f.requests,...f.network]) {
    assert.equal(r.method,'GET');assert.ok(!r.body&&!r.postData);
    assert.doesNotMatch(r.url,/private-original|private-recording|private-activity|11\.1234567|heartRate|Synthetic/);
    assert.ok(!r.url.startsWith('https:'),'no provider request');
  }
  assert.deepEqual(f.exceptions,[]);
});

test('packaged recorded replay: native upload, exact official revision/basis ACK, D4S model decline, linked controls, deletion and no remote centers',async t=>{
  const f=await fixture(t);
  await f.cmd('Emulation.setDeviceMetricsOverride',{width:375,height:900,deviceScaleFactor:1,mobile:true});
  await f.navigate(f.base+'index.html?area=explore&view=briefing');
  const {pack}=await readRoutePack(fileURLToPath(new URL('../',import.meta.url)));
  const catalog=await f.js(`document.getElementById('site-route').innerHTML`);
  const snapshots=()=>f.evaluate(`import('./${f.session}').then(m=>m.routePlayback.getSnapshot())`);
  for(const name of ['D1','D4S']) {
    const r=pack.catalog.routes.find(r=>r.name.startsWith(name));
    const a=await loadRouteAnalysis({pack,routeId:r.id,revisionId:r.currentRevisionId,
      readAsset:path=>readFile(new URL('../'+path,import.meta.url))});
    // Invented recording timestamps/sensors on public geometry; no private originals.
    const points=a.points.slice(100,250);
    const bytes=`<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:t="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" version="1.1"><trk><name>Private replay sentinel</name><trkseg>`+
      points.map((p,i)=>`<trkpt lat="${p.lat}" lon="${p.lon}"><ele>${p.elevationM}</ele>`+
        `<time>${new Date(Date.UTC(2026,0,1)+i*1000).toISOString()}</time><extensions><t:TrackPointExtension>`+
        `<t:power>${210+i}</t:power><t:hr>120</t:hr>${i===2?'':'<t:cad>80</t:cad>'}<t:speed>8</t:speed>`+
        `</t:TrackPointExtension></extensions></trkpt>`).join('')+'</trkseg></trk></gpx>';
    const count=f.network.length;
    await f.upload(bytes,'private-replay-sentinel.gpx');
    await until(()=>f.js(`document.getElementById('replay-powerW')?.textContent.includes('210 W')`));
    if(name==='D1')assert.deepEqual(await f.evaluate('indexedDB.databases()'),[]);
    else assert.equal(await f.evaluate(`import('./${f.storage}').then(async m=>(await m.createLocalRouteStorage().read()).meta.entries.length)`),0);
    assert.equal(await f.js(`document.getElementById('site-route').innerHTML`),catalog);
    assert.equal((await snapshots()).estimatedRide.status,'unavailable','actual replay never installs a modeled local estimate');
    const url=await f.js('location.href');
    await f.js(`document.getElementById('replay-comparison').open=true;
      document.getElementById('replay-plan').value=${JSON.stringify(r.currentRevisionId)};
      document.getElementById('replay-plan').dispatchEvent(new Event('change'));
      document.getElementById('replay-basis').value='distance';
      document.getElementById('replay-basis').dispatchEvent(new Event('change'));
      document.getElementById('replay-apply').click()`);
    assert.match(await f.js(`document.getElementById('replay-selection').textContent`),/acknowledge/);
    await f.js(`document.getElementById('replay-ack').checked=true;document.getElementById('replay-apply').click()`);
    assert.equal(await f.js(`document.getElementById('replay-difference').dataset.status`),'available');
    assert.match(await f.js(`document.getElementById('replay-selection').textContent`),new RegExp(r.currentRevisionId));
    assert.match(await f.js(`document.getElementById('replay-alignment').textContent`),/partial overlap is not a whole-route match/);
    if(name==='D4S') assert.match(await f.js(`document.getElementById('replay-assumptions').textContent`),/model unavailable/);
    await f.js(`document.getElementById('replay-seek').focus()`);
    for(let i=0;i<2;i++) for(const type of ['keyDown','keyUp'])
      await f.cmd('Input.dispatchKeyEvent',{type,key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
    assert.equal((await snapshots()).recordedClock.elapsedSeconds,2);
    assert.match(await f.js(`document.getElementById('replay-powerW').textContent`),/212 W.*GPX decoded sample/);
    assert.match(await f.js(`document.getElementById('replay-cadenceRpm').textContent`),/unavailable/);
    await f.js(`document.getElementById('replay-scenario').value='hard';document.getElementById('replay-scenario').dispatchEvent(new Event('change'))`);
    assert.match(await f.js(`document.getElementById('replay-powerW').textContent`),/212 W.*GPX decoded sample/);
    assert.equal((await snapshots()).recordedClock.elapsedSeconds,2);
    assert.deepEqual(await f.js(`['replay-map','replay-profile','replay-position'].map(id=>document.getElementById(id).dataset.distance)`),
      Array(3).fill(String((await snapshots()).distanceM)));
    await f.js(`document.getElementById('replay-rate').value='4';document.getElementById('replay-rate').dispatchEvent(new Event('change'));
      document.getElementById('replay-overview').click()`);
    assert.equal((await snapshots()).recordedClock.elapsedSeconds,2);
    await f.js(`document.getElementById('replay-play').click()`);
    await until(async()=> (await snapshots()).recordedClock.elapsedSeconds>2);
    await f.js(`document.getElementById('replay-play').click()`);
    assert.equal((await snapshots()).phase,'paused');
    // A changed basis (and changed revision) cannot silently reuse the grant.
    await f.js(`document.getElementById('replay-basis').value='elapsed';document.getElementById('replay-basis').dispatchEvent(new Event('change'))`);
    assert.equal(await f.js(`document.getElementById('replay-ack').checked`),false);
    assert.equal(await f.js(`document.getElementById('replay-difference').dataset.status`),'unavailable');
    await f.js(`document.getElementById('replay-ack').checked=true;document.getElementById('replay-apply').click()`);
    assert.match(await f.js(`document.getElementById('replay-difference').textContent`),/planned start/);
    await f.js(`document.getElementById('replay-plan').selectedIndex=1;document.getElementById('replay-plan').dispatchEvent(new Event('change'))`);
    assert.equal(await f.js(`document.getElementById('replay-ack').checked`),false);
    assert.equal(await f.js('location.href'),url);
    assert.ok(await f.js('document.documentElement.scrollWidth<=innerWidth'));
    assert.equal(f.network.length,count,'upload, replay, matching, scenario and controls need no requests');
    await f.action('Delete this file');
    await until(()=>f.js(`document.getElementById('local-status').textContent.includes('deleted')`));
    assert.equal(await f.js(`document.getElementById('recorded-replay').textContent`),'');
    assert.equal((await snapshots()).recordedClock.status,'unavailable');
    assert.match(await f.js(`document.getElementById('site-notice').textContent`),/unavailable/);
  }
  for(const r of [...f.requests,...f.network]) {
    assert.equal(r.method,'GET');assert.ok(!r.body&&!r.postData);assert.ok(!r.url.startsWith('https:'));
    assert.doesNotMatch(r.url,/private-replay|Private|powerW|heartRate|user:/);
  }
  assert.deepEqual(f.exceptions,[]);
});

test('packaged actual stale tab grant cannot cross delete-all; peer deletion clears active local views',async t=>{
  const f=await fixture(t);
  await f.navigate(f.base+'index.html?area=explore&view=briefing');
  await f.upload(syntheticGPX());
  await f.action('Remember this file on this device');
  await until(()=>f.js(`document.getElementById('local-status').textContent.includes('Remembered on')`));
  const url=await f.js('location.href'),peer=await f.peerPage(url);
  await until(()=>peer.js(`document.getElementById('local-status').textContent.includes('Opened remembered')`));
  // Hold a new grant before its database connection. Peer deletion commits
  // first; the old grant must fail inside its own atomic transaction.
  await f.upload(syntheticFIT(),'pending.fit');
  await f.evaluate(`{
    window.grantGate=Promise.withResolvers();
    const transaction=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(...args) {
      const tx=transaction.apply(this,args);
      if(this.name==='kotr27-local-routes'&&args[1]==='readwrite')
        tx.addEventListener('abort',()=>window.libraryTxAborted=true);
      return tx;
    };
    const original=IDBFactory.prototype.open;
    IDBFactory.prototype.open=function(...args){
      const request=original.apply(this,args);
      if(args[0]==='kotr27-local-routes') {
        Object.defineProperty(request,'onsuccess',{set(listener){
          request.addEventListener('success',event=>{
            window.grantEntered=true;
            grantGate.promise.then(()=>listener.call(request,event));
          });

        }});
      }
      return request;
    };
  }`);
  await f.action('Remember this file on this device');
  await until(()=>f.js('window.grantEntered===true'));
  await peer.js(`document.getElementById('local-delete-all').click();document.getElementById('local-confirm-delete').click()`);
  await until(()=>peer.js(`document.getElementById('local-status').textContent.includes('All local files deleted')`));
  await f.evaluate('grantGate.resolve()');
  await until(()=>f.js('window.libraryTxAborted===true'));
  // Broadcast may invalidate the UI response first; storage is the authority.
  await until(async()=>await f.evaluate(`import('./${f.storage}').then(m=>m.createLocalRouteStorage().read()).then(r=>r.meta.entries.length===0)`));
  assert.match(await peer.js(`document.getElementById('site-notice').textContent`),/unavailable/);
  assert.equal(await peer.js(`document.getElementById('local-details').textContent`),'');
  assert.equal(await peer.js(`document.getElementById('route-briefing').textContent`),'');
  assert.doesNotMatch(await peer.js(`document.getElementById('route-pace').textContent`),/Synthetic private sentinel/);
  assert.deepEqual(peer.exceptions(),[]);assert.deepEqual(f.exceptions,[]);
});

test('packaged paused/missing-time recordings retain honest sample and gap controls without continuous elevation model',async t=>{
  const f=await fixture(t);await f.navigate(f.base+'index.html?area=explore&view=briefing');
  const point=(i)=>`<trkpt lat="45" lon="11.1234567">`+
    `<time>${new Date(Date.UTC(2026,0,1)+[0,1000,2000,42000,43000][i]).toISOString()}</time>`+
    '<extensions><t:TrackPointExtension><t:speed>0</t:speed><t:power>0</t:power></t:TrackPointExtension></extensions></trkpt>';
  const bytes='<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:t="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" version="1.1">'+
    `<trk><name>Paused sample</name><trkseg>${Array.from({length:5},(_,i)=>point(i)).join('')}</trkseg></trk></gpx>`;
  await f.upload(bytes,'paused.gpx');
  await until(()=>f.js(`document.getElementById('replay-powerW')?.textContent.includes('0 W')`));
  assert.match(await f.js(`document.getElementById('replay-position').textContent`),/raw elevation unavailable/);
  await f.evaluate(`import('./${f.session}').then(m=>m.routePlayback.seekRecordedSeconds(1.5))`);
  assert.match(await f.js(`document.getElementById('replay-position').textContent`),/paused 1.5 s/);
  assert.match(await f.js(`document.getElementById('replay-powerW').textContent`),/unavailable/);
  await f.evaluate(`import('./${f.session}').then(m=>m.routePlayback.seekRecordedSeconds(20))`);
  assert.match(await f.js(`document.getElementById('replay-position').textContent`),/Position unavailable/);
  assert.equal(await f.js(`document.querySelector('#replay-map circle').getAttribute('visibility')`),'hidden');
  await f.upload(bytes.replace(/<time>[^<]+<\/time>/,''),'missing-time.gpx');
  assert.match(await f.js(`document.getElementById('replay-unavailable').textContent`),/Missing times are not invented/);
  assert.equal(await f.js(`document.getElementById('replay-play')`),null);
  assert.deepEqual(f.exceptions,[]);
});

test('packaged 375px same-recording navigation preserves exact source time, pauses, and never lends time to a different recording',async t=>{
  const f=await fixture(t);
  await f.cmd('Emulation.setDeviceMetricsOverride',{width:375,height:900,deviceScaleFactor:1,mobile:true});
  await f.navigate(f.base+'index.html?area=explore&view=briefing');
  await f.upload(clockFixtureGPX([0,1,2,3,4,5],{stationary:true}),'stationary-navigation.gpx');
  const snapshot=()=>f.evaluate(`import('./${f.session}').then(m=>m.routePlayback.getSnapshot())`);
  const seek=n=>f.evaluate(`import('./${f.session}').then(m=>m.routePlayback.seekRecordedSeconds(${n}))`);
  const nav=label=>f.js(`[...document.querySelectorAll('.site-nav a')].find(a=>a.textContent===${JSON.stringify(label)}).click()`);
  await until(async()=> (await snapshot()).recordedClock.status==='available');
  const id=(await snapshot()).identity.routeId;
  await seek(3);
  assert.match(await f.js(`document.getElementById('replay-powerW').textContent`),/^103 W/);
  await f.js(`[...document.querySelectorAll('#site-content a')].find(a=>a.textContent==='Recorded replay / planned comparison').click()`);
  assert.equal((await snapshot()).recordedClock.elapsedSeconds,3);
  assert.equal((await snapshot()).phase,'paused');
  assert.match(await f.js(`document.getElementById('replay-powerW').textContent`),/^103 W/);
  await seek(3.5);
  await nav('Prepare');
  assert.equal((await snapshot()).recordedClock.elapsedSeconds,3.5);
  assert.equal((await snapshot()).phase,'paused');
  await nav('Explore');
  assert.equal((await snapshot()).recordedClock.elapsedSeconds,3.5);
  assert.equal((await snapshot()).recordedClock.sampleAgeSeconds,.5);
  assert.match(await f.js(`document.getElementById('replay-powerW').textContent`),/unavailable/);
  await f.js('history.back()');
  await until(()=>f.js(`document.getElementById('site-heading').textContent==='Prepare for the ride'`));
  assert.equal((await snapshot()).recordedClock.elapsedSeconds,3.5);
  await f.js('history.forward()');
  await until(()=>f.js(`document.getElementById('site-heading').textContent==='Explore the route'`));
  assert.equal((await snapshot()).recordedClock.elapsedSeconds,3.5);
  // Play and leave in the same event task: no RAF can advance before navigation.
  await f.js(`document.getElementById('replay-play').click();
    [...document.querySelectorAll('.site-nav a')].find(a=>a.textContent==='Prepare').click()`);
  assert.equal((await snapshot()).phase,'paused');
  assert.equal((await snapshot()).recordedClock.elapsedSeconds,3.5);
  await nav('Explore');
  assert.equal((await snapshot()).phase,'paused');
  await f.evaluate(`import('./${f.session}').then(m=>m.routePlayback.seekDistance(0))`);
  assert.equal((await snapshot()).recordedClock.elapsedSeconds,0,'explicit pause-distance seek still selects first arrival');
  await seek(3);
  await f.js(`document.getElementById('replay-restart').click()`);
  assert.equal((await snapshot()).recordedClock.elapsedSeconds,0,'restart is an intentional source-time reset');
  await seek(3.5);
  await f.upload(clockFixtureGPX([0,1,2,3,4,5],{stationary:true,powerBase:700}),'different-recording.gpx');
  await until(async()=> (await snapshot()).identity?.routeId!==id);
  assert.equal((await snapshot()).recordedClock.elapsedSeconds,0);
  assert.match(await f.js(`document.getElementById('replay-powerW').textContent`),/^700 W/);
  assert.equal((await snapshot()).phase,'ready');
  assert.deepEqual(f.exceptions,[]);
});

test('packaged timestamp gap excludes its chord, splits outline, and declines ambiguous seek and inside-gap comparison',async t=>{
  const f=await fixture(t);await f.navigate(f.base+'index.html?area=explore&view=briefing');
  await f.upload(clockFixtureGPX([0,1,62,63,64,65]),'timestamp-gap.gpx');
  const snapshot=()=>f.evaluate(`import('./${f.session}').then(m=>m.routePlayback.getSnapshot())`);
  const seek=n=>f.evaluate(`import('./${f.session}').then(m=>m.routePlayback.seekRecordedSeconds(${n}))`);
  await until(async()=> (await snapshot()).recordedClock.status==='available');
  assert.deepEqual((await snapshot()).chapters,[]);
  assert.equal(await f.js(`document.querySelector('#replay-map path').getAttribute('d').split('M').length-1`),2);
  await seek(1);const before=(await snapshot()).distanceM;
  await seek(62);assert.equal((await snapshot()).distanceM,before);
  assert.match(await f.js(`document.getElementById('replay-position').textContent`),/timestamp\/coordinate gaps excluded/);
  await seek(65);
  assert.ok(Math.abs((await snapshot()).distanceM-6371000*Math.PI/180*.0004)<1e-6);
  await seek(63.5);
  await f.evaluate(`import('./${f.session}').then(m=>m.routePlayback.seekDistance(${before}))`);
  assert.equal((await snapshot()).recordedClock.elapsedSeconds,63.5);
  assert.match(await f.js(`document.getElementById('replay-position').textContent`),/Distance seek unavailable at collapsed gap/);
  await seek(30);
  assert.equal((await snapshot()).distanceM,before);
  assert.match(await f.js(`document.getElementById('replay-position').textContent`),/Current distance unavailable inside gap/);
  assert.equal(await f.js(`document.querySelector('#replay-map circle').getAttribute('visibility')`),'hidden');
  await f.js(`document.getElementById('replay-comparison').open=true;
    document.getElementById('replay-plan').selectedIndex=1;
    document.getElementById('replay-plan').dispatchEvent(new Event('change'));
    document.getElementById('replay-basis').value='distance';
    document.getElementById('replay-basis').dispatchEvent(new Event('change'));
    document.getElementById('replay-ack').checked=true;document.getElementById('replay-apply').click()`);
  assert.equal(await f.js(`document.getElementById('replay-difference').dataset.status`),'unavailable');
  assert.match(await f.js(`document.getElementById('replay-difference').textContent`),/position unavailable in timestamp\/coordinate gap/);
  assert.deepEqual(f.exceptions,[]);
});

test('packaged 375px missing-elevation fallback and replay share timestamp/spatial boundaries and FIT point indices',async t=>{
  const f=await fixture(t);
  await f.cmd('Emulation.setDeviceMetricsOverride',{width:375,height:900,deviceScaleFactor:1,mobile:true});
  await f.navigate(f.base+'index.html?area=explore&view=briefing');
  const noElevation=xml=>xml.replace(/<ele>[^<]+<\/ele>/g,'');
  const continuous=noElevation(clockFixtureGPX([0,1,2,3,4,5]));
  const timedGap=noElevation(clockFixtureGPX([0,1,62,63,64,65]));
  // Keep the new location after the jump, rather than invent a return edge.
  const spatialGap=continuous.replace(/lat="([^"]+)"/g,(all,lat)=>
    `lat="${Number(lat)>=45.0002 ? Number(lat)+.02 : lat}"`);
  const cases=[
    ['noele-continuous.gpx',continuous,[6]],
    ['noele-timestamp-gap.gpx',timedGap,[2,4]],
    ['noele-spatial-gap.gpx',spatialGap,[2,4]],
    // Sample 2 has no coordinate. Geometry indices after it differ from sample
    // indices: both renderers must preserve all 39 actual geometry vertices.
    ['missing-coordinate.fit',syntheticFIT({recording:true,gap:true,missing:true}),[2,37]],
  ];
  for(const [name,bytes,expected] of cases) {
    await f.upload(bytes,name);
    await until(()=>f.js(`document.getElementById('local-outline') && document.getElementById('replay-map')`));
    assert.ok(await f.js(`!document.getElementById('local-details').hidden && !document.getElementById('recorded-replay').hidden`));
    const runs=await f.js(`(()=>{
      const vertices=selector=>[...document.querySelectorAll(selector)].flatMap(p=>
        p.getAttribute('d').split('M').slice(1).map(run=>
          run.trim().split(/\\s*L\\s*/).map(pair=>pair.split(',').map(Number))));
      return {fallback:vertices('#local-outline path'),replay:vertices('#replay-map path')};
    })()`);
    assert.deepEqual(runs.fallback.map(run=>run.length),expected,name);
    assert.deepEqual(runs.replay,runs.fallback,`${name}: identical geometry indices/vertices and gap boundaries`);
    assert.match(await f.js(`document.getElementById('local-details').textContent`),/gaps are not joined/);
    assert.ok(await f.js('document.documentElement.scrollWidth<=innerWidth'));
    if(name==='noele-timestamp-gap.gpx') {
      await f.evaluate(`import('./${f.session}').then(m=>m.routePlayback.seekRecordedSeconds(30))`);
      assert.match(await f.js(`document.getElementById('replay-position').textContent`),/Current distance unavailable inside gap/);
    }
    // Avoid library capacity influencing the boundary fixtures.
    await f.action('Delete this file');
    await until(()=>f.js(`document.getElementById('local-status').textContent.includes('deleted')`));
    assert.equal(await f.js(`document.getElementById('local-outline')`),null);
  }
  await f.upload(timedGap.replace(/<time>[^<]+<\/time>/,''),'noele-partial-time.gpx');
  assert.equal(await f.js(`document.getElementById('local-outline')`),null);
  assert.match(await f.js(`document.getElementById('local-details').textContent`),/Recording outline unavailable without a complete timestamp replay model/);
  assert.deepEqual(f.exceptions,[]);
});

test('packaged quota abort keeps memory, cancel stays responsive, old local flyover link cannot start provider',async t=>{
  const f=await fixture(t);
  await f.navigate(f.base+'index.html?area=explore&view=briefing');
  await f.upload(syntheticGPX());
  await f.evaluate(`{
    window.originalPut=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args){
      if(this.name==='files')throw new DOMException('Full','QuotaExceededError');
      return originalPut.apply(this,args);
    };
  }`);
  await f.action('Remember this file on this device');
  await until(()=>f.js(`document.getElementById('local-status').textContent.includes('session-only')`));
  assert.match(await f.js(`document.getElementById('local-status').textContent`),/QuotaExceededError/);
  assert.equal(await f.evaluate(`import('./${f.storage}').then(m=>m.createLocalRouteStorage().read()).then(r=>r.meta.entries.length)`),0);
  await f.evaluate('IDBObjectStore.prototype.put=originalPut');
  await f.action('Remember this file on this device');
  await until(()=>f.js(`document.getElementById('local-status').textContent.includes('Remembered on')`));
  const url=await f.js('location.href');
  await f.navigate(url.replace('view=briefing','view=flyover'));
  await until(()=>f.js(`document.getElementById('local-status').textContent.includes('Opened remembered')`));
  assert.equal(await f.js(`document.querySelectorAll('script[src*="mapbox"],script[src*="flyover."]').length`),0);
  assert.ok(!f.network.some(r=>r.url.startsWith('https:')));
  await f.upload(syntheticGPX({count:20000}),'cancel.gpx',false);
  await f.js(`document.getElementById('local-cancel').click()`);
  await until(()=>f.js(`document.getElementById('local-status').textContent.includes('cancelled')`));
  assert.equal(await f.js(`document.querySelector('#local-file').disabled`),false);
  assert.deepEqual(f.exceptions,[]);
});

test('packaged explicit IndexedDB consent, reload, stale save after deletion and delete-all tombstone',async t=>{
  const f=await fixture(t);
  await f.navigate(f.base+'explore.html?area=explore&view=briefing');
  await f.upload(syntheticGPX());
  const url=await f.js('location.href'),id=new URL(url).searchParams.get('route');
  // Actual native keyboard activation of the visible per-file consent control.
  await f.js(`window.consentTrace=[];
    window.consentButton=[...document.querySelectorAll('#local-files button')].find(b=>b.textContent.startsWith('Remember'));
    for(const type of ['focusin','keydown','keyup','click'])
      document.addEventListener(type,e=>consentTrace.push({type,key:e.key,trusted:e.isTrusted,
        target:e.target.id||e.target.textContent.slice(0,55),targetConnected:e.target.isConnected,
        originalConnected:consentButton.isConnected}),true);
    new MutationObserver(()=>consentTrace.push({type:'library-render',connected:consentButton.isConnected,
      focus:document.activeElement.id||document.activeElement.tagName}))
      .observe(document.getElementById('local-files'),{childList:true});
    consentButton.focus()`);
  // This fixture uploads through CDP, not a foreground native file picker.
  // A later first browser focus can re-read the library and replace the button
  // between JS focus() and Enter. Exercise a real tab return, observe its
  // authoritative refresh, then focus the current control once before Enter.
  const {targetInfo}=await f.cmd('Target.getTargetInfo');
  const other=await f.cmd('Target.createTarget',{url:'about:blank'});
  try {
    await until(()=>f.js('document.hidden'));
    const renders=await f.js(`consentTrace.filter(e=>e.type==='library-render').length`);
    await f.cmd('Target.activateTarget',{targetId:targetInfo.targetId});
    t.diagnostic(JSON.stringify(await f.js(`({beforeNativeHover:{hidden:document.hidden,
      focused:document.hasFocus(),renders:consentTrace.filter(e=>e.type==='library-render').length}})`)));
    // As in the existing native terrain fixture, activation alone need not
    // focus a headless document. A trusted hover establishes native focus.
    await f.cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:10,y:10,button:'none',buttons:0});
    await until(()=>f.js(`!document.hidden && document.hasFocus() &&
      consentTrace.filter(e=>e.type==='library-render').length>${renders}`));
  } finally {await f.cmd('Target.closeTarget',{targetId:other.targetId});}
  await f.js(`[...document.querySelectorAll('#local-files button')].find(b=>b.textContent.startsWith('Remember')).focus()`);
  assert.equal(await f.js(`document.activeElement.textContent`),'Remember this file on this device');
  for(const type of ['keyDown','keyUp'])await f.cmd('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='keyDown'?{text:'\r'}:{})});
  try {await until(()=>f.js(`document.getElementById('local-status').textContent.includes('Remembered on')`));}
  finally {t.diagnostic(JSON.stringify(await f.js(`({consentTrace,status:document.getElementById('local-status').textContent})`)));}
  assert.equal(await f.js(`consentTrace.some(e=>e.type==='click'&&e.trusted&&e.targetConnected&&
    e.target==='Remember this file on this device')`),true);
  assert.deepEqual((await f.evaluate('indexedDB.databases()')).map(d=>d.name),['kotr27-local-routes']);
  await f.navigate(url);
  await until(()=>f.js(`document.getElementById('local-status').textContent.includes('Opened remembered')`));
  assert.equal(await f.js('location.href'),url);
  assert.ok(await f.js(`document.getElementById('site-selection').textContent.includes('Synthetic private sentinel')`));
  // Independent storage clients represent tabs; hold stale authority before
  // deletion, then attempt the same bytes afterward inside an IDB transaction.
  await f.evaluate(`import('./${f.storage}').then(async m=>{
    window.peer=m.createLocalRouteStorage();window.stale=await peer.read(${JSON.stringify(id)});
  })`);
  await f.action('Delete this file');
  await until(()=>f.js(`document.getElementById('local-status').textContent==='Local file deleted.'`));
  assert.match(await f.js(`document.getElementById('site-notice').textContent`),/unavailable/);
  const conflict=await f.evaluate(`peer.apply({type:'save',expected:stale.meta.generation,record:stale.file})
    .then(()=>false,e=>e.message)`);
  assert.match(conflict,/another tab/);
  assert.equal(await f.evaluate(`peer.read().then(r=>r.meta.entries.length)`),0);
  await f.navigate(url);
  assert.match(await f.js(`document.getElementById('site-notice').textContent`),/unavailable/);
  await f.upload(syntheticFIT({recording:true}),'remembered.fit');
  await f.action('Remember this file on this device');
  await until(()=>f.js(`document.getElementById('local-status').textContent.includes('Remembered on')`));
  await f.js(`document.getElementById('local-delete-all').click();document.getElementById('local-confirm-delete').click()`);
  await until(()=>f.js(`document.getElementById('local-status').textContent.includes('All local files deleted')`));
  const meta=await f.evaluate(`import('./${f.storage}').then(m=>m.createLocalRouteStorage().read())`);
  assert.equal(meta.meta.entries.length,0);assert.ok(meta.meta.generation);
  assert.deepEqual(f.exceptions,[]);
});

test('packaged corrupt input, storage denial, deletion failure and session fallback are explicit',async t=>{
  const f=await fixture(t,{deny:true});
  await f.navigate(f.base+'index.html?area=explore&view=briefing');
  await f.upload(syntheticGPX());
  await f.action('Remember this file on this device');
  await until(()=>f.js(`document.getElementById('local-status').textContent.includes('session-only')`));
  assert.match(await f.js(`document.getElementById('site-selection').textContent`),/local/);
  await f.action('Delete this file');
  await until(()=>f.js(`document.getElementById('local-status').textContent.includes('Deletion NOT confirmed')`));
  assert.match(await f.js(`document.getElementById('site-notice').textContent`),/unavailable/);
  const fit=syntheticFIT();fit[50]^=1;
  await f.upload(fit,'corrupt.fit');
  assert.match(await f.js(`document.getElementById('local-status').textContent`),/CRC/);
  await f.upload('<gpx>broken','broken.gpx');
  assert.match(await f.js(`document.getElementById('local-status').textContent`),/GPX|XML/);
  await f.upload(Buffer.alloc(4*1024*1024+1),'too-large.gpx');
  assert.match(await f.js(`document.getElementById('local-status').textContent`),/4 MiB/);
  assert.deepEqual(f.exceptions,[]);
});

test('packaged native parser rejects malformed comments and invalid FIT unknown types; valid unknown data works',async t=>{
  const f=await fixture(t);
  await f.navigate(f.base+'index.html?area=explore&view=briefing');
  const bad=syntheticGPX().replace('<trk>','<!--bad---><trk>');
  assert.equal(await f.evaluate(`new DOMParser().parseFromString(${JSON.stringify(bad)},'application/xml')
    .getElementsByTagName('parsererror').length>0`),true);
  await f.upload(bad,'bad-comment.gpx');
  assert.match(await f.js(`document.getElementById('local-status').textContent`),/Malformed XML comment/);
  for(const unknownMessage of [false,true]) {
    await f.upload(syntheticFIT({unknownMessage,unknownField:{type:255,size:1}}),'invalid-field.fit');
    assert.match(await f.js(`document.getElementById('local-status').textContent`),/FIT field base type or width/);
    await f.upload(syntheticFIT({unknownMessage,unknownField:{type:0x84,size:4}}),'valid-unknown.fit');
    assert.match(await f.js(`document.getElementById('local-status').textContent`),/Imported FIT route/);
  }
  await f.upload(syntheticGPX().replace('<trk>','<!----><!--valid - comment--><trk>'),'valid-comments.gpx');
  assert.match(await f.js(`document.getElementById('local-status').textContent`),/Imported GPX/);
  assert.deepEqual(f.exceptions,[]);
});

test('packaged native XML rejects raw outside-root references and non-XML lexical whitespace',async t=>{
  const f=await fixture(t);
  await f.navigate(f.base+'index.html?area=explore&view=briefing');
  const valid=syntheticGPX(),body=valid.slice(valid.indexOf('<gpx'));
  const invalid=[
    ...['&#32;','&#x20;','\u00a0','\u2003'].flatMap(raw=>['<!--before-->'+raw+body,valid+raw]),
    valid.replace('<?xml ','<?xml\u00a0'),valid.replace('<gpx ','<gpx\u00a0'),
    valid.replace('version="1.1"','version\u00a0="1.1"'),valid.replace('</gpx>','</gpx\u00a0>'),
    valid.replace('</gpx>','<extensions\u00a0/></gpx>'),
    valid.replace('<?xml','<?XML'),valid.replace('version="1.0"',`version='1.0"`),
    valid.replace('encoding="UTF-8"',`encoding='UTF-8"`),
  ];
  for(const text of invalid) {
    assert.equal(await f.evaluate(`new DOMParser().parseFromString(${JSON.stringify(text)},'application/xml')
      .getElementsByTagName('parsererror').length>0`),true);
    await f.upload(text,'invalid-whitespace.gpx');
    assert.match(await f.js(`document.getElementById('local-status').textContent`),/XML/);
    assert.doesNotMatch(await f.js(`document.getElementById('local-status').textContent`),/Imported/);
    assert.equal(await f.js(`document.querySelectorAll('#local-files button').length`),0);
  }
  const prefixed=body.replace(/<(\/?)(gpx|trk|name|trkseg|trkpt|ele)(?=[ >])/g,'<$1g:$2')
    .replace('xmlns=','xmlns:g=');
  for(const text of [' \t<!--before-->'+prefixed+'\r\n<!--after--> \t',
    valid.replace('version="1.0"',`version = '1.0'`).replace('encoding="UTF-8"',`encoding = 'utf-8'`),
    valid.replace('<gpx ','<gpx \t\r\n').replace('</gpx>','<extensions \t/></gpx>')+'\r\n']) {
    assert.equal(await f.evaluate(`new DOMParser().parseFromString(${JSON.stringify(text)},'application/xml')
      .getElementsByTagName('parsererror').length`),0);
    await f.upload(text,'valid-whitespace.gpx');
    assert.match(await f.js(`document.getElementById('local-status').textContent`),/Imported GPX/);
  }
  assert.deepEqual(f.exceptions,[]);
});

for(const reportError of [false,true])
test(`packaged read-denied committed receipt (${reportError?'synthetic uncertain error':'success'}) cannot retain peer-deleted bytes after focus`,async t=>{
  const f=await fixture(t);
  await f.navigate(f.base+'index.html?area=explore&view=briefing');
  await f.upload(syntheticGPX().replace('Synthetic private sentinel','Unrelated never-saved survivor'));
  await f.upload(syntheticFIT({recording:true}),'uncertain-target.fit');
  const url=await f.js('location.href');
  await holdSaveCompletion(f,{reportError});
  await f.js(`[...document.querySelectorAll('#local-files li')].find(e=>e.textContent.includes('uncertain-target.fit'))
    .querySelectorAll('button')[1].click()`);
  await until(()=>f.js('window.saveCommitted===true'));
  await denyLibraryReads(f);
  const peer=await f.peerPage(url);
  await until(()=>peer.js(`document.getElementById('local-status').textContent.includes('Opened remembered')`));
  await peer.js(`[...document.querySelectorAll('#local-files button')].find(b=>b.textContent==='Delete this file').click()`);
  await until(()=>peer.js(`document.getElementById('local-status').textContent==='Local file deleted.'`));
  await until(()=>f.js('window.deniedLibraryReads>0'));
  // The committed response was held; denial prevented the deletion broadcast
  // from removing the origin's candidate. Now deliver the fault-injected receipt.
  assert.match(await f.js(`document.getElementById('site-selection').textContent`),/uncertain-target/);
  await f.evaluate('releaseSaveCompletion()');
  await until(()=>f.js(`document.getElementById('local-library').getAttribute('aria-busy')==='false'`));
  assert.match(await f.js(`document.getElementById('local-status').textContent`),
    reportError ? /Save outcome unknown.*No active copy retained/ : /No active copy retained/);
  assert.doesNotMatch(await f.js(`document.getElementById('local-status').textContent`),/session-only|nothing saved/i);
  assert.equal(await peer.js(`import('./${f.storage}').then(m=>m.createLocalRouteStorage().read()).then(r=>r.meta.entries.length)`),0);
  for(const phase of ['denied','restored']) {
    if(phase==='restored') {
      await f.evaluate(`window.denyLibraryRead=false;window.dispatchEvent(new Event('focus'))`);
      await until(()=>f.js('window.completedLibraryReads>0'));
    }
    assert.doesNotMatch(await f.js(`document.getElementById('local-files').textContent`),/uncertain-target/);
    assert.match(await f.js(`document.getElementById('local-files').textContent`),/Unrelated never-saved survivor/);
    assert.equal(await f.js(`document.getElementById('local-details').textContent`),'');
    assert.equal(await f.js(`document.getElementById('route-briefing').textContent`),'');
    assert.match(await f.js(`document.getElementById('site-notice').textContent`),/unavailable/);
  }
  await f.action('Open in shared explorer');
  assert.match(await f.js(`document.getElementById('site-selection').textContent`),/Unrelated never-saved survivor/);
  assert.deepEqual(peer.exceptions(),[]);assert.deepEqual(f.exceptions,[]);
});

for(const failure of ['quota','request-error'])
test(`packaged confirmed native abort (${failure}) keeps memory despite denied reconciliation`,async t=>{
  const f=await fixture(t);
  await f.navigate(f.base+'index.html?area=explore&view=briefing');
  await f.upload(syntheticGPX());
  await f.evaluate(`{
    window.originalPut=IDBObjectStore.prototype.put;
    const transaction=IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction=function(...args) {
      const tx=transaction.apply(this,args);
      if(this.name==='kotr27-local-routes'&&args[1]==='readwrite')
        tx.addEventListener('abort',event=>window.nativeAbort=event.isTrusted&&event.target===tx);
      return tx;
    };
    IDBObjectStore.prototype.put=function(...args) {
      if(this.name==='files') {
        ${failure==='quota' ? "throw new DOMException('Synthetic quota denial','QuotaExceededError');" :
          'this.add(...args); return this.add(...args);'}
      }
      return originalPut.apply(this,args);
    };
  }`);
  await denyLibraryReads(f);
  await f.action('Remember this file on this device');
  await until(()=>f.js(`document.getElementById('local-library').getAttribute('aria-busy')==='false'`));
  assert.equal(await f.js('window.nativeAbort'),true);
  assert.ok(await f.js('window.deniedLibraryReads>0'));
  assert.match(await f.js(`document.getElementById('local-status').textContent`),/File remains session-only/);
  assert.match(await f.js(`document.getElementById('local-status').textContent`),
    failure==='quota' ? /QuotaExceededError/ : /ConstraintError/);
  assert.match(await f.js(`document.getElementById('site-selection').textContent`),/Synthetic private sentinel/);
  // Verify the store API's outcome, not only the UI wording. The quota fault
  // is synthetic; rollback and the duplicate-key request error are native IDB.
  assert.equal(await f.evaluate(`import('./${f.storage}').then(m=>m.createLocalRouteStorage().apply({
    type:'save',expected:null,record:{id:'user:00000000-0000-4000-8000-000000000001',name:'Synthetic',buffer:new ArrayBuffer(16)}
  })).then(()=>null,e=>e.writeOutcome)`),'aborted');
  await f.evaluate(`IDBObjectStore.prototype.put=originalPut;window.denyLibraryRead=false;window.dispatchEvent(new Event('focus'))`);
  await until(()=>f.js('window.completedLibraryReads>0'));
  assert.equal(await f.evaluate(`import('./${f.storage}').then(m=>m.createLocalRouteStorage().read()).then(r=>r.meta.entries.length)`),0);
  await f.action('Open in shared explorer');
  assert.match(await f.js(`document.getElementById('site-selection').textContent`),/Synthetic private sentinel/);
  await f.action('Remember this file on this device');
  await until(()=>f.js(`document.getElementById('local-status').textContent.includes('Remembered on')`));
  assert.equal(await f.evaluate(`import('./${f.storage}').then(m=>m.createLocalRouteStorage().read()).then(r=>r.meta.entries.length)`),1);
  assert.deepEqual(f.exceptions,[]);
});

for(const reportError of [false,true])
test(`packaged peer per-file delete defeats committed-response-held save (${reportError?'error':'success'}); unrelated session survives`,async t=>{
  const f=await fixture(t);
  await f.navigate(f.base+'index.html?area=explore&view=briefing');
  await f.upload(syntheticGPX().replace('Synthetic private sentinel','Unrelated session survivor'));
  await f.upload(syntheticFIT({recording:true}),'race-target.fit');
  const url=await f.js('location.href'),id=new URL(url).searchParams.get('route');
  await holdSaveCompletion(f,{reportError});
  await f.js(`[...document.querySelectorAll('#local-files li')].find(e=>e.textContent.includes('race-target.fit'))
    .querySelectorAll('button')[1].click()`);
  await until(()=>f.js('window.saveCommitted===true'));
  const peer=await f.peerPage(url);
  await until(()=>peer.js(`document.getElementById('local-status').textContent.includes('Opened remembered')`));
  await peer.js(`[...document.querySelectorAll('#local-files button')].find(b=>b.textContent==='Delete this file').click()`);
  await until(()=>peer.js(`document.getElementById('local-status').textContent==='Local file deleted.'`));
  await until(()=>f.js(`document.getElementById('site-notice').textContent.includes('unavailable')`));
  await f.evaluate('releaseSaveCompletion()');
  await until(()=>f.js(`document.getElementById('local-library').getAttribute('aria-busy')==='false'`));
  assert.equal(await f.evaluate(`import('./${f.storage}').then(m=>m.createLocalRouteStorage().read()).then(r=>r.meta.entries.length)`),0);
  assert.doesNotMatch(await f.js(`document.getElementById('local-files').textContent`),/race-target/);
  assert.match(await f.js(`document.getElementById('local-files').textContent`),/Unrelated session survivor/);
  assert.equal(await f.js(`document.getElementById('local-details').textContent`),'');
  assert.equal(await f.js(`document.getElementById('route-briefing').textContent`),'');
  await f.action('Open in shared explorer');
  assert.match(await f.js(`document.getElementById('site-selection').textContent`),/Unrelated session survivor/);
  // A genuinely new import/explicit consent uses fresh authority and a new ID;
  // neither a late successful nor an uncertain old receipt can resurrect A.
  await f.upload(syntheticFIT({recording:true}),'new-grant.fit');
  const fresh=new URL(await f.js('location.href')).searchParams.get('route');
  assert.notEqual(fresh,id);
  await f.js(`[...document.querySelectorAll('#local-files li')].find(e=>e.textContent.includes('new-grant.fit'))
    .querySelectorAll('button')[1].click()`);
  await until(()=>f.js(`document.getElementById('local-status').textContent.includes('Remembered on')`));
  const ids=await f.evaluate(`import('./${f.storage}').then(m=>m.createLocalRouteStorage().read()).then(r=>r.meta.entries.map(e=>e.id))`);
  assert.deepEqual(ids,[fresh]);
  assert.deepEqual(peer.exceptions(),[]);assert.deepEqual(f.exceptions,[]);
});

test('packaged unrelated tombstone during held save does not lose later per-file deletion tracking',async t=>{
  const f=await fixture(t);
  await f.navigate(f.base+'index.html?area=explore&view=briefing');
  await f.upload(syntheticFIT({recording:true}),'tracked-after-race.fit');
  await holdSaveCompletion(f);
  await f.action('Remember this file on this device');
  await until(()=>f.js('window.saveCommitted===true'));
  const peer=await f.peerPage(await f.js('location.href'));
  await until(()=>peer.js(`document.getElementById('local-status').textContent.includes('Opened remembered')`));
  await peer.js(`import('./${f.storage}').then(async m=>{
    await m.createLocalRouteStorage().apply({type:'delete',
      id:'user:00000000-0000-4000-8000-000000000000',nextGeneration:crypto.randomUUID()});
    const channel=new BroadcastChannel('kotr27-library-changed');channel.postMessage('changed');channel.close();
  })`);
  await until(()=>f.js(`document.getElementById('local-files').textContent.includes('remembered on this device')`));
  await f.evaluate('releaseSaveCompletion()');
  await until(()=>f.js(`document.getElementById('local-library').getAttribute('aria-busy')==='false'`));
  await peer.js(`[...document.querySelectorAll('#local-files button')].find(b=>b.textContent==='Delete this file').click()`);
  await until(()=>f.js(`document.getElementById('site-notice').textContent.includes('unavailable')`));
  assert.doesNotMatch(await f.js(`document.getElementById('local-files').textContent`),/tracked-after-race/);
  assert.equal(await f.evaluate(`import('./${f.storage}').then(m=>m.createLocalRouteStorage().read()).then(r=>r.meta.entries.length)`),0);
  assert.deepEqual(peer.exceptions(),[]);assert.deepEqual(f.exceptions,[]);
});

test('packaged global Preferences Forget clears recording, pending committed save, all views and peer memory',async t=>{
  const f=await fixture(t);
  await f.navigate(f.base+'index.html?area=explore&view=briefing');
  await f.upload(syntheticFIT({recording:true}),'global-recording.fit');
  await holdSaveCompletion(f);
  await f.action('Remember this file on this device');
  await until(()=>f.js('window.saveCommitted===true'));
  const url=await f.js('location.href'),peer=await f.peerPage(url);
  await until(()=>peer.js(`document.getElementById('local-status').textContent.includes('Opened remembered')`));
  await f.js(`document.getElementById('preference-forget').click()`);
  assert.equal(await f.js(`document.getElementById('local-details').textContent`),'');
  await until(()=>f.js(`document.getElementById('preference-forget-status').textContent.startsWith('All app-owned local data removed')`));
  await until(()=>peer.js(`document.getElementById('site-notice').textContent.includes('unavailable')`));
  await f.evaluate('releaseSaveCompletion()');
  await until(()=>f.js(`document.getElementById('local-library').getAttribute('aria-busy')==='false'`));
  const record=await f.evaluate(`import('./${f.storage}').then(m=>m.createLocalRouteStorage().read())`);
  assert.equal(record.meta.entries.length,0);assert.ok(record.meta.forgetGeneration);
  for(const b of [f,peer]) {
    assert.equal(await b.js(`document.getElementById('local-details').textContent`),'');
    assert.equal(await b.js(`document.getElementById('route-briefing').textContent`),'');
    assert.equal(await b.js(`document.getElementById('recorded-replay').textContent`),'');
    assert.doesNotMatch(await b.js(`document.getElementById('local-files').textContent`),/global-recording/);
  }
  const pref=f.files.find(p=>p.startsWith('js/preference-storage.'));
  const settings=await f.evaluate(`import('./${pref}').then(m=>m.createPreferenceStorage().read())`);
  assert.equal(settings.rider.consent,'revoked');assert.equal(settings.preferences.consent,'revoked');
  await f.navigate(url);
  assert.match(await f.js(`document.getElementById('site-notice').textContent`),/unavailable/);
  assert.deepEqual(peer.exceptions(),[]);assert.deepEqual(f.exceptions,[]);
});

for(const failedCategory of ['files','settings'])
test(`packaged global Forget reports ${failedCategory} partial failure and explicit retry removes all`,async t=>{
  const f=await fixture(t);
  await f.navigate(f.base+'index.html?area=explore&view=briefing');
  await f.upload(syntheticFIT({recording:true}),'partial-failure.fit');
  await f.action('Remember this file on this device');
  await until(()=>f.js(`document.getElementById('local-status').textContent.includes('Remembered on')`));
  const preferences=f.files.find(p=>p.startsWith('js/preferences-view.'));
  await f.evaluate(`import('./${preferences}').then(async m=>{
    await m.riderState.update({ftp:'300'});await m.riderState.remember('rider',true);
    await m.riderState.remember('preferences',true);
  })`);
  await f.evaluate(`{
    window.realClear=IDBObjectStore.prototype.clear;
    IDBObjectStore.prototype.clear=function(...args){
      if(this.name===${JSON.stringify(failedCategory)})throw new DOMException('Denied deletion','SecurityError');
      return realClear.apply(this,args);
    };
  }`);
  await f.js(`document.getElementById('preference-forget').click()`);
  await until(()=>f.js(`document.getElementById('preference-forget-status').textContent.startsWith('Forget incomplete')`));
  const status=await f.js(`document.getElementById('preference-forget-status').textContent`);
  assert.match(status,failedCategory==='files' ? /Rider values\/preferences: removed.*Local files: deletion NOT confirmed/ :
    /Rider values\/preferences: deletion NOT confirmed.*Local files: removed/);
  assert.equal(await f.js(`document.getElementById('local-details').textContent`),'');
  assert.equal(await f.evaluate(`import('./${preferences}').then(m=>m.riderState.snapshot().input.ftp)`),'');
  assert.equal(await f.evaluate(`import('./${f.storage}').then(m=>m.createLocalRouteStorage().read()).then(r=>r.meta.entries.length)`),
    failedCategory==='files'?1:0);
  await f.evaluate('IDBObjectStore.prototype.clear=realClear');
  await f.js(`document.getElementById('preference-forget').click()`);
  await until(()=>f.js(`document.getElementById('preference-forget-status').textContent.startsWith('All app-owned local data removed')`));
  assert.equal(await f.evaluate(`import('./${f.storage}').then(m=>m.createLocalRouteStorage().read()).then(r=>r.meta.entries.length)`),0);
  const pref=f.files.find(p=>p.startsWith('js/preference-storage.'));
  const settings=await f.evaluate(`import('./${pref}').then(m=>m.createPreferenceStorage().read())`);
  assert.equal(settings.rider.consent,'revoked');assert.equal(settings.preferences.consent,'revoked');
  assert.deepEqual(f.exceptions,[]);
});
