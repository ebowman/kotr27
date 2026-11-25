// Built as a module worker. Never skipWaiting or claim existing clients.
import {validateOfflineManifest, selectedResources, verifiedResponse, packLimits} from '../js/offline-contract.mjs';
import {offlineStorage} from '../js/offline-storage.mjs';

const base=new URL('./',self.location.href), prefix=`kotr27-pack:${base.pathname}:`;
const state=offlineStorage(base.pathname), running=new Set(), jobs=new Map();
const url=path=>new URL(path,base).href;
const network=(path,signal)=>fetch(url(path),{cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',
  signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});
async function manifest(signal) {
  const r=await network('offline-release.json',signal);
  if(!r.ok) throw Error('Release check needs internet');
  const text=await r.text();
  if(text.length>512*1024) throw Error('Manifest too large');
  return validateOfflineManifest(JSON.parse(text),path=>network(path,signal));
}
async function broadcast() {
  for(const client of await self.clients.matchAll({type:'window',includeUncontrolled:true}))
    if(client.url.startsWith(base.href)) client.postMessage({type:'kotr-offline-change'});
}
async function clean() {
  const live=new Set((await self.clients.matchAll({type:'window'})).map(c=>c.id));
  const before=await state();
  if(!Object.keys(before.generations).length) {
    for(const key of await caches.keys()) if(key.startsWith(prefix)) await caches.delete(key);
    return;
  }
  const s=await state(s=>{
    for(const [key,g] of Object.entries(s.generations)) if(g.staging && !running.has(key)) delete s.generations[key];
    for(const id of Object.keys(s.pins)) if(!live.has(id)) delete s.pins[id];
    for(const [key,g] of Object.entries(s.generations))
      if(key!==s.active && !Object.values(s.pins).includes(key) && !g.staging) delete s.generations[key];
  });
  for(const key of await caches.keys()) if(key.startsWith(prefix) && !s.generations[key]) await caches.delete(key);
}
async function complete(g,blocked=[]) {
  if(!g || g.staging) return false;
  try {
    await validateOfflineManifest(g.manifest);
    for(const ref of selectedResources(g.manifest,g.days)) {
      if(blocked.includes(ref.path))continue;
      const response=await caches.match(url(ref.path),{cacheName:g.key});
      if(!response) return false;
      await verifiedResponse(response,ref);
    }
    return true;
  } catch {return false;}
}
async function check(signal) {
  const m=await manifest(signal), before=await state();
  // No storage before opt-in. A registered empty worker need not recreate data.
  if(!Object.keys(before.generations).length && !before.current) return m;
  const updated=await state(s=>{
    for(const g of Object.values(s.generations)) for(const r of g.manifest.routes) {
      const next=m.routes.find(x=>x.id===r.id);
      if(r.revision && (!next || next.status==='withdrawn')) {
        if(!s.withdrawn.includes(r.id)) s.withdrawn.push(r.id);
        // The shared old catalog also contains route metrics/annotations.
        // Retire it, not just GPX/profile payloads. Keep only the explanatory
        // shell until the rider explicitly installs a permitted new release.
        for(const p of [...r.paths,g.manifest.catalog]) if(!s.blockedPaths.includes(p)) s.blockedPaths.push(p);
      }
    }
    s.current=m.release; s.verifiedAt=Date.now();
  });
  for(const g of Object.values(updated.generations)) {
    if((await state()).epoch!==updated.epoch) break;
    const cache=await caches.open(g.key);
    for(const path of updated.blockedPaths)await cache.delete(url(path));
    if((await state()).epoch!==updated.epoch)await caches.delete(g.key);
  }
  await broadcast();
  return m;
}
async function status(clientId) {
  await clean();
  const s=await state(), g=s.generations[s.active], pinned=s.generations[s.pins[clientId]];
  return {active:g?{release:g.manifest.release,days:g.days,bytes:g.bytes,savedAt:g.savedAt,
    complete:await complete(g,s.blockedPaths),
    restricted:s.blockedPaths.includes(g.manifest.catalog)}:null, pinned:pinned?.manifest.release??null,
    current:s.current,verifiedAt:s.verifiedAt,withdrawn:s.withdrawn,epoch:s.epoch};
}
async function install(days, expected, expectedEpoch, progress, signal) {
  // The caller supplies day IDs and the preview release, never arbitrary bytes/URLs.
  await clean();
  const m=await check(signal);
  if(m.release!==expected) throw Error('Release changed since preview. Check again before downloading.');
  const refs=selectedResources(m,days), bytes=refs.reduce((n,r)=>n+r.bytes,0), old=await state();
  if(m.routes.some(r=>days.includes(r.day) && r.revision && r.status!=='withdrawn' && old.withdrawn.includes(r.id)))
    throw Error('Known withdrawn day: delete pack and check current routes');
  const estimate=await navigator.storage.estimate();
  if(!Number.isFinite(estimate.quota) || !Number.isFinite(estimate.usage) ||
    estimate.usage+bytes>estimate.quota*0.8) throw Error('Insufficient quota (20% headroom required)');
  const key=prefix+crypto.randomUUID();
  signal.throwIfAborted();
  const start=await state(s=>{
    if(s.epoch!==expectedEpoch) throw Error('Download canceled by Forget/delete. Preview again explicitly.');
    const used=Object.values(s.generations).reduce((n,g)=>n+g.bytes,0);
    if(used+bytes>packLimits.total || Object.values(s.generations).some(g=>g.staging))
      throw Error('Staging budget busy/full. Close older pack tabs or delete and retry.');
    s.generations[key]={key,manifest:m,days,bytes,staging:true,savedAt:null};
  });
  running.add(key);
  const epoch=start.epoch;
  const fence=async()=>{
    const s=await state();
    if(s.epoch!==epoch || !s.generations[key]) throw Error('Download canceled by deletion or another tab');
  };
  try {
    const cache=await caches.open(key);
    await fence();
    let loaded=0;
    for(const ref of refs) {
      const response=await verifiedResponse(await network(ref.path,signal),ref);
      await fence();
      await cache.put(url(ref.path),response);
      loaded+=ref.bytes;progress({loaded,total:bytes});
    }
    const candidate={...start.generations[key],staging:false};
    if(!await complete(candidate)) throw Error('Incomplete staged generation');
    // Only this small IDB transaction activates. Cache writes never imply ready.
    await state(s=>{
      if(s.epoch!==epoch || !s.generations[key] || s.current && s.current!==m.release ||
        m.routes.some(r=>days.includes(r.day) && r.revision && r.status!=='withdrawn' && s.withdrawn.includes(r.id)))
        throw Error('Download canceled: deletion or revision changed');
      s.generations[key]={...candidate,savedAt:Date.now()};
      s.active=key;s.current=m.release;s.verifiedAt=Date.now();
    });
    await broadcast();
  } catch(error) {
    await caches.delete(key);
    await state(s=>{delete s.generations[key];});
    throw error;
  } finally {running.delete(key);}
}
async function remove() {
  // Durable fence survives terminated workers and late cache writes. Tombstones
  // contain only public route IDs/paths, not personal data; never delete another app.
  await state(s=>{s.epoch++;s.active=null;s.generations={};s.pins={};});
  for(const controller of jobs.keys())controller.abort(Error('Download canceled by deletion'));
  await Promise.all([...jobs.values()]);
  for(const key of await caches.keys()) if(key.startsWith(prefix)) await caches.delete(key);
  await broadcast();
  return {confirmed:true};
}
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  // An interrupted worker left only uncommitted staging; it is never a fallback.
  const s=await state();
  if(Object.values(s.generations).some(g=>g.staging))
    await state(s=>{for(const [key,g] of Object.entries(s.generations)) if(g.staging) delete s.generations[key];});
  await clean();
})()));
self.addEventListener('message',event=>{
  const port=event.ports[0], source=event.source;
  if(!port || !source?.url?.startsWith(base.href)) return;
  event.waitUntil((async()=>{
    try {
      const {type,days,release,epoch}=event.data??{};
      let result;
      if(type==='status') result=await status(source.id);
      else if(type==='check') result=await check();
      else if(type==='install') {
        const controller=new AbortController();
        let done;
        jobs.set(controller,new Promise(resolve=>{done=resolve;}));
        try {result=await install(days,release,epoch,p=>port.postMessage({progress:p}),controller.signal);}
        finally {jobs.delete(controller);done();}
      }
      else if(type==='delete') result=await remove();
      else throw Error('Unknown offline operation');
      port.postMessage({result:result??true});
    } catch(e) {port.postMessage({error:e.name==='QuotaExceededError'?'Quota exceeded; previous complete pack retained':e.message});}
  })());
});
self.addEventListener('fetch',event=>{
  const u=new URL(event.request.url);
  if(u.origin!==base.origin || !u.pathname.startsWith(base.pathname) || event.request.method!=='GET') return;
  // Never satisfy our own freshness probe, even if ordinary HTML is pinned.
  if(event.request.headers.get('X-KOTR-Freshness')==='1' || u.pathname===base.pathname+'offline-release.json') {
    event.respondWith(fetch(event.request,{cache:'no-store'}));return;
  }
  event.respondWith((async()=>{
    const s=await state();
    let path=u.pathname.slice(base.pathname.length)||'index.html';
    if(s.blockedPaths.includes(path)) return new Response('Known withdrawn route. Reconnect and choose a permitted revision.',{status:410});
    let key=s.pins[event.clientId];
    if(event.request.mode==='navigate') {
      key=s.active;
      const g=s.generations[key];
      if(g && await complete(g,s.blockedPaths)) {
        const id=event.resultingClientId;
        if(id) await state(s=>{if(s.generations[key])s.pins[id]=key;});
      } else {
        try {return await fetch(event.request,{cache:'no-store'});}
        catch {return new Response('Offline pack missing or incomplete. Reconnect to download again. First-ever offline use is unavailable.',
          {status:503,headers:{'Content-Type':'text/plain'}});}
      }
    }
    let g=s.generations[key];
    // Dedicated parser workers are clients too, but their module-import fetches
    // may have no document clientId. Only content-addressed modules can use this
    // fallback: their filename binds their entire rewritten import graph. Never
    // use it for mutable HTML, catalog metadata or route data.
    if(!g && /^(?:js|assets)\/[a-z0-9-]+\.[a-f0-9]{24}\.(?:mjs|js)$/.test(path)) {
      g=Object.values(s.generations).find(candidate=>!candidate.staging &&
        candidate.manifest.resources.some(ref=>ref.path===path));
      key=g?.key;
    }
    if(!g || g.staging) return fetch(event.request);
    const ref=g.manifest.resources.find(r=>r.path===path);
    if(!ref) return new Response('Not part of this saved release. Reconnect/check updates.',{status:404});
    const response=await caches.match(url(path),{cacheName:key});
    // Hash again on use: browser storage is not authority.
    try {return await verifiedResponse(response??await network(path),ref);}
    catch {return new Response('Saved resource unavailable or corrupt. Reconnect to repair the pack.',{status:503});}
  })().catch(()=>fetch(event.request).catch(()=>new Response('Offline storage unavailable; reconnect or delete the pack.',{status:503}))));
});
