import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from '../tools/build-release.mjs';
import { readRoutePack } from '../tools/route-pack.mjs';
import { browser, until } from './browser.mjs';

async function fixture(t) {
  const tmp = await mkdtemp(join(tmpdir(),'kotr-trip-'));
  let tearingDown = false;
  t.after(() => { tearingDown = true; return rm(tmp,{recursive:true,force:true}); });
  const out = join(tmp,'public'), downloads = join(tmp,'downloads');
  await mkdir(downloads);
  const source = fileURLToPath(new URL('../',import.meta.url));
  await build(source,out);
  const {pack} = await readRoutePack(source);
  const files = await readdir(out,{recursive:true});
  const types = {'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript',
    '.css':'text/css','.gpx':'application/xml','.json':'application/json'};
  const faults = {path:null, corrupt:false, pack:false};
  const served = [];
  const server = createServer(async (req,res) => {
    const url = new URL(req.url,'http://localhost');
    const path = url.pathname.slice('/kotr27/'.length) || 'index.html';
    if (!url.pathname.startsWith('/kotr27/') || !files.includes(path) || !types[extname(path)])
      return res.writeHead(404).end();
    served.push({path, referrer:req.headers.referer});
    if (path === faults.path || faults.pack && path.startsWith('assets/route-pack.')) {
      if (!faults.corrupt) return res.writeHead(503).end('unavailable');
      return res.writeHead(200,{'Content-Type':types[extname(path)]}).end('tampered');
    }
    try {
      const bytes = path.startsWith('js/config.') ? 'window.KOTR_CONFIG = {};' : await readFile(join(out,path));
      res.writeHead(200,{'Content-Type':types[extname(path)],'Cache-Control':'no-store'}).end(bytes);
    } catch (error) {
      if (!tearingDown || error.code !== 'ENOENT') throw error;
      res.writeHead(404).end();
    }
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return {pack, files, downloads, faults, served, base:`http://127.0.0.1:${server.address().port}/kotr27/`};
}

for (const width of [320,1280]) test(`packaged planner ${width}px: seven choices, keyboard, exact downloads, reload and changes`, async t => {
  const f = await fixture(t);
  const requests = [];
  const {cmd,js,exceptions} = await browser(t,m => {
    if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  });
  await cmd('Page.enable');
  await cmd('Network.enable');
  await cmd('Network.setBlockedURLs',{urls:['https://*']});
  await cmd('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<600});
  await cmd('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:f.downloads});
  const ready = () => until(() => js(`document.querySelector('#trip-planner')?.dataset.ready === 'true' &&
    document.querySelector('#site-shell')?.dataset.ready === 'true'`));
  const key = async (key,code,n) => {
    for (const type of ['keyDown','keyUp']) await cmd('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:n,
      ...(type === 'keyDown' && (key === 'Enter' || key === 'd') && {text:key === 'Enter' ? '\r' : 'd'})});
  };
  const evaluate = async expression => {
    const result = await cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const preferences = f.files.find(file => file.startsWith('js/preferences-view.'));
  const state = expression => evaluate(`import('./${preferences}').then(async ({riderState:s}) => {${expression}})`);
  const choose = (day,id) => js(`(() => {const e=document.getElementById('trip-choice-${day}');e.value='${id}';e.dispatchEvent(new Event('change'));})()`);
  await cmd('Page.navigate',{url:f.base});
  await ready();
  assert.equal(await js(`document.querySelectorAll('.trip-route').length`),7);
  assert.match(await js(`document.getElementById('trip-summary').textContent`),/0 of 4/);
  assert.deepEqual(await evaluate('indexedDB.databases()'),[]);
  assert.ok(await js(`document.documentElement.scrollWidth <= innerWidth`));
  assert.ok(await js(`[...document.querySelectorAll('.trip-route a[href^="https:"]')].every(a =>
    /^https:\\/\\/ridewithgps.com\\/routes\\/\\d+$/.test(a.href) && a.rel === 'noreferrer')`));
  const d1 = f.pack.catalog.routes.find(r => r.variantId.startsWith('kotr-d1'));
  await js(`document.getElementById('trip-choice-kotr-d1').focus()`);
  // Native type-ahead selects D1 without a platform popup window (which CDP
  // key dispatch cannot drive on desktop macOS). Tab commits the choice.
  await key('d','KeyD',68);
  await key('Tab','Tab',9);
  await until(() => js(`document.getElementById('trip-summary').textContent.includes('1 of 4')`));
  assert.notEqual(await js('document.activeElement.tagName'),'BODY','keyboard focus is retained in the planner');
  for (const route of f.pack.catalog.routes) {
    const day = f.pack.catalog.variants.find(v => v.id === route.variantId).dayId;
    await choose(day,route.id);
    assert.equal(await js(`document.getElementById('trip-choice-${day}').value`),route.id);
  }
  assert.match(await js(`document.getElementById('trip-summary').textContent`),/4 of 4/);
  await choose('kotr-d2','');
  assert.match(await js(`document.getElementById('trip-summary').textContent`),/3 of 4/);
  assert.equal(await js(`document.getElementById('trip-choice-kotr-d1').value`),d1.id);
  await js(`document.querySelector('.trip-route .site-actions a').focus()`);
  await key('Enter','Enter',13);
  assert.equal(await js('document.activeElement.id'),'site-heading');
  assert.match(await js('location.href'),/route=rwgps-\d+&rev=rwgps-/);
  assert.match(await js(`document.getElementById('trip-summary').textContent`),/3 of 4/,'preview did not change itinerary');
  await js(`document.getElementById('site-preferences').open=true; document.getElementById('remember-preferences').click()`);
  await state('await s.settled(); return true;');
  assert.equal(await state('return s.snapshot().rememberTrip;'),false);
  await js(`document.getElementById('remember-itinerary').click()`);
  await state('await s.settled(); return true;');
  assert.equal(await state('return s.snapshot().rememberTrip;'),true);
  const saved = await state('return s.snapshot().itinerary;');
  await cmd('Page.reload'); await ready();
  assert.deepEqual(await state('return s.snapshot().itinerary;'),saved);
  assert.match(await js('location.href'),/route=rwgps-/,'incoming active route is separate');
  // Single download bytes match the public revision (not the raw private FIT).
  await js(`document.getElementById('trip-gpx-${d1.id}').click()`);
  await until(async () => (await readdir(f.downloads)).some(n => n === `${d1.id}--${d1.currentRevisionId}.gpx`));
  const downloaded = await readFile(join(f.downloads,`${d1.id}--${d1.currentRevisionId}.gpx`));
  assert.equal(createHash('sha256').update(downloaded).digest('hex'),d1.revisions[0].geometry.sha256);
  await until(() => js(`document.getElementById('trip-download-results').textContent.includes('handed-to-browser')`));
  assert.doesNotMatch(downloaded.toString(),/<time>|<name>|<metadata>|<extensions>/);
  // One corrupt batch member must not suppress healthy choices or pretend saved.
  const bad = f.pack.catalog.routes.find(r => r.id === saved.choices.find(c => c.routeId !== d1.id).routeId);
  f.faults.path = bad.revisions[0].geometry.path; f.faults.corrupt = true;
  await js(`document.getElementById('trip-download-gpx').click()`);
  await until(() => js(`!document.getElementById('trip-download-gpx').disabled &&
    document.getElementById('trip-download-results').textContent.includes('Not offered')`));
  const report = await js(`document.getElementById('trip-download-results').textContent`);
  assert.match(report,/checksum mismatch/); assert.match(report,/handed-to-browser/);
  assert.ok(!(await readdir(f.downloads)).some(n => n.startsWith(bad.id)));
  f.faults.path = null;
  await js(`document.getElementById('trip-gpx-${bad.id}').click()`);
  await until(async () => (await readdir(f.downloads)).some(n => n === `${bad.id}--${bad.currentRevisionId}.gpx`));
  for (const name of await readdir(f.downloads)) {
    const route = f.pack.catalog.routes.find(r => name === `${r.id}--${r.currentRevisionId}.gpx`);
    if (!route) continue; // Browser may suffix an already-saved duplicate.
    assert.equal(createHash('sha256').update(await readFile(join(f.downloads,name))).digest('hex'),route.revisions[0].geometry.sha256);
  }
  await until(() => js(`!document.getElementById('trip-download-fit').disabled`));
  await js(`document.getElementById('trip-download-fit').click()`);
  await until(() => js(`document.getElementById('trip-download-results').textContent.includes('FIT unavailable')`));
  assert.ok(!(await readdir(f.downloads)).some(n => n.endsWith('.fit')));
  // A stale saved selection is loaded, not silently replaced by current.
  await state(`const trip=s.snapshot().itinerary;trip.choices.find(c=>c.dayId==='kotr-d1').revisionId='old-revision';await s.setItinerary(trip);`);
  await cmd('Page.reload'); await ready();
  assert.ok(await js(`document.getElementById('trip-choice-kotr-d1').disabled && document.getElementById('trip-gpx-${d1.id}').disabled`));
  assert.match(await js(`document.getElementById('trip-summary').textContent`),/Partial subtotal/);
  assert.match(await js(`document.querySelector('.trip-change').textContent`),/NOT been replaced/);
  await js(`document.getElementById('trip-ack-kotr-d1').focus()`);
  await key('Enter','Enter',13);
  await state('await s.settled();');
  assert.equal((await state('return s.snapshot().itinerary;')).choices.find(c => c.dayId === 'kotr-d1').revisionId,d1.currentRevisionId);
  await state(`const trip=s.snapshot().itinerary;trip.choices.find(c=>c.dayId==='kotr-d1').routeId='removed-route';await s.setItinerary(trip);`);
  assert.ok(await js(`!document.getElementById('trip-ack-kotr-d1') && !!document.getElementById('trip-remove-kotr-d1')`));
  await js(`document.getElementById('trip-remove-kotr-d1').click()`);
  assert.ok(!(await state('return s.snapshot().itinerary;')).choices.some(c => c.dayId === 'kotr-d1'));
  await js(`document.documentElement.style.fontSize='200%'`);
  assert.ok(await js(`document.documentElement.scrollWidth <= innerWidth`),'200% text has no overflow');
  await js(`document.documentElement.style.fontSize=''; document.getElementById('preference-forget').click()`);
  await state('await s.settled();');
  assert.match(await js(`document.getElementById('trip-summary').textContent`),/0 of 4/);
  await choose('kotr-d1',d1.id);
  await cmd('Page.reload'); await ready();
  assert.match(await js(`document.getElementById('trip-summary').textContent`),/0 of 4/,'unremembered itinerary does not survive reload');
  assert.ok(!requests.some(url => /mapbox|\.private|privacy_code|original.*fit/i.test(url)));
  assert.ok(f.served.filter(r => r.path.startsWith('assets/route-')).every(r => !r.referrer));
  assert.deepEqual(exceptions,[]);
});

test('packaged planner: storage denial, missing metrics and manifest failure stay usable and explicit', async t => {
  const f = await fixture(t);
  const route = f.pack.catalog.routes[0], day = f.pack.catalog.variants.find(v => v.id === route.variantId).dayId;
  f.faults.path = route.revisions[0].profile.path;
  const {cmd,js,exceptions} = await browser(t);
  await cmd('Page.enable');
  await cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
    Object.defineProperty(window,'indexedDB',{get(){throw new DOMException('Denied','SecurityError')}});`});
  await cmd('Page.navigate',{url:f.base});
  await until(() => js(`document.querySelector('#trip-planner')?.dataset.ready === 'true'`));
  assert.match(await js(`document.getElementById('preference-status').textContent`),/Memory-only/);
  assert.match(await js(`document.getElementById('trip-planner').textContent`),/Metrics unavailable/);
  await js(`document.getElementById('trip-choice-${day}').value='${route.id}';document.getElementById('trip-choice-${day}').dispatchEvent(new Event('change'))`);
  assert.match(await js(`document.getElementById('trip-summary').textContent`),/Partial subtotal/);
  assert.ok(await js(`document.getElementById('remember-itinerary').disabled`));
  f.faults.pack = true;
  await cmd('Page.reload');
  await until(() => js(`document.querySelector('#site-shell')?.dataset.ready === 'true'`));
  assert.match(await js(`document.getElementById('site-catalog-status').textContent`),/failed verification/);
  assert.equal(await js(`document.querySelector('#trip-planner')`),null);
  assert.equal(await js(`document.querySelectorAll('.site-nav a').length`),4);
  assert.deepEqual(exceptions,[]);
});

test('packaged planner rejects sparse IndexedDB choices and recovers in memory without adopting consent', async t => {
  const f = await fixture(t);
  const {cmd,js,exceptions} = await browser(t);
  await cmd('Page.enable');
  const evaluate = async expression => {
    const result = await cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    assert.ok(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const preferences = f.files.find(file => file.startsWith('js/preferences-view.'));
  const state = expression => evaluate(`import('./${preferences}').then(async ({riderState:s}) => {${expression}})`);
  const ready = () => until(() => js(`document.querySelector('#trip-planner')?.dataset.ready === 'true' &&
    document.querySelector('#site-shell')?.dataset.ready === 'true'`));
  await cmd('Page.navigate',{url:f.base});
  await ready();
  // Real IndexedDB put/get structured-clones the hole; JSON fixtures cannot.
  const sparse = await evaluate(`new Promise((resolve,reject) => {
    const request=indexedDB.open('kotr27-preferences',2);
    request.onupgradeneeded=()=>request.result.createObjectStore('settings');
    request.onerror=()=>reject(request.error);
    request.onsuccess=()=>{
      const db=request.result, tx=db.transaction('settings','readwrite'), store=tx.objectStore('settings');
      store.put({version:2,rider:null,preferences:{consent:'granted',consentVersion:'sparse-browser',
        savedAt:Date.now(),value:{unit:'kg',effort:'slower',route:'./index.html?area=plan&view=briefing',
          itinerary:{version:1,choices:Array(1)}}}},'current');
      const read=store.get('current');
      read.onsuccess=()=>{ const choices=read.result.preferences.value.itinerary.choices;
        tx.oncomplete=()=>{db.close();resolve({length:choices.length,hasZero:Object.hasOwn(choices,0)});}; };
      tx.onabort=()=>reject(tx.error);
    };
  })`);
  assert.deepEqual(sparse,{length:1,hasZero:false});
  await cmd('Page.reload');
  await ready();
  assert.match(await js(`document.getElementById('preference-status').textContent`),/Corrupt route\/UI preferences.*Memory-only/);
  assert.deepEqual(await state('return s.snapshot().consent;'),{rider:false,preferences:false});
  assert.equal(await state('return s.snapshot().itinerary;'),null);
  const route = f.pack.catalog.routes.find(r => r.variantId.startsWith('kotr-d1'));
  await js(`document.getElementById('trip-choice-kotr-d1').value='${route.id}';
    document.getElementById('trip-choice-kotr-d1').dispatchEvent(new Event('change'))`);
  assert.match(await js(`document.getElementById('trip-summary').textContent`),/1 of 4/);
  assert.ok(await js(`document.getElementById('remember-preferences').disabled`));
  const storedVersion = await evaluate(`new Promise((resolve,reject)=>{
    const r=indexedDB.open('kotr27-preferences',2);r.onerror=()=>reject(r.error);
    r.onsuccess=()=>{const db=r.result,tx=db.transaction('settings'),q=tx.objectStore('settings').get('current');
      q.onsuccess=()=>resolve(q.result.preferences.consentVersion);tx.oncomplete=()=>db.close();};
  })`);
  assert.equal(storedVersion,'sparse-browser','memory fallback does not overwrite corrupt storage');
  await state('await s.forget();');
  assert.equal(await state('return s.snapshot().usable;'),true);
  assert.equal(await state('return s.snapshot().itinerary;'),null);
  assert.deepEqual(await state('return s.snapshot().consent;'),{rider:false,preferences:false});
  await state(`await s.setItinerary({version:1,choices:[{dayId:'kotr-d1',routeId:'${route.id}',revisionId:'${route.currentRevisionId}'}]});
    await s.remember('preferences',true);await s.rememberItinerary(true);`);
  await cmd('Page.reload'); await ready();
  assert.match(await js(`document.getElementById('trip-summary').textContent`),/1 of 4/);
  assert.deepEqual(exceptions,[]);
});
