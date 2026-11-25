import {validateOfflineManifest} from './offline-contract.mjs';
import {offlineStorage} from './offline-storage.mjs';
const base=new URL('./',location.href);
const state=offlineStorage(base.pathname);
export const offlineBase=base;
export function supportedScope() {
  return isSecureContext && (base.pathname==='/kotr27/' ||
    ['localhost','127.0.0.1','[::1]'].includes(base.hostname));
}
export async function registration() {
  if(!supportedScope() || !navigator.serviceWorker) return null;
  const r=await navigator.serviceWorker.getRegistration(base.href);
  if(r && r.scope===base.href && [r.active,r.waiting,r.installing].some(w=>w?.scriptURL===new URL('offline-worker.js',base).href)) return r;
  return null;
}
export function request(worker,type,data={},progress=()=>{}) {
  return new Promise((resolve,reject)=>{
    const channel=new MessageChannel();
    const timer=setTimeout(()=>{channel.port1.close();reject(Error('Offline operation did not confirm completion. Check status; do not assume saved/deleted.'));},120000);
    channel.port1.onmessage=({data:d})=>{
      if(d.progress) {progress(d.progress);return;}
      clearTimeout(timer);channel.port1.close();
      if(d.error) reject(Error(d.error));else resolve(d.result);
    };
    worker.postMessage({type,...data},[channel.port2]);
  });
}
export async function preview() {
  const r=await registration();
  if(r?.active) return request(r.active,'check');
  const response=await fetch(new URL('offline-release.json',base),{cache:'no-store',credentials:'omit',redirect:'error',
    signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw Error('Pack preview needs internet and a built release');
  const text=await response.text();
  if(text.length>512*1024) throw Error('Manifest too large');
  return validateOfflineManifest(JSON.parse(text),path=>fetch(new URL(path,base),{cache:'no-store',
    credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)}));
}
export async function install(days,release,epoch,progress) {
  if(!supportedScope() || !navigator.serviceWorker || !globalThis.caches || !globalThis.indexedDB)
    throw Error('Offline storage unavailable. Keep using the online pages.');
  const existing=await navigator.serviceWorker.getRegistration(base.href);
  if(existing && (existing.scope!==base.href || ![existing.active,existing.waiting,existing.installing]
    .some(w=>w?.scriptURL===new URL('offline-worker.js',base).href)))
    throw Error('Another application owns this worker scope; nothing changed.');
  const r=await navigator.serviceWorker.register(new URL('offline-worker.js',base),{scope:base.href,type:'module',updateViaCache:'none'});
  if(r.waiting) throw Error('Offline engine update waiting. Close other site tabs, reopen, and retry explicitly.');
  const worker=r.active??r.installing;
  if(!worker) throw Error('Offline worker unavailable');
  if(worker.state!=='activated') await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('Offline worker did not activate')),15000);
    const check=()=>{if(['activated','redundant'].includes(worker.state)) {
      clearTimeout(timer);worker.removeEventListener('statechange',check);
      worker.state==='activated'?resolve():reject(Error('Offline worker installation failed'));
    }};
    worker.addEventListener('statechange',check);check();
  });
  return request(worker,'install',{days,release,epoch},progress);
}
export async function packStatus() {
  const r=await registration();
  if(r?.active)return request(r.active,'status');
  const s=await state();
  return {active:null,withdrawn:s.withdrawn,current:s.current,epoch:s.epoch};
}
let deletion=0;
export const deletionGeneration=()=>deletion;
export async function forgetOffline() {
  deletion++; // synchronous view fence, including a registration still in flight
  await state(s=>{s.epoch++;s.active=null;s.generations={};s.pins={};});
  for(const key of await caches.keys()) if(key.startsWith(`kotr27-pack:${base.pathname}:`)) await caches.delete(key);
  const r=await registration();
  if(!r) return {confirmed:true};
  const worker=r.active??r.waiting??r.installing;
  if(!worker) return {confirmed:false,message:'Offline worker unavailable; use site-data controls'};
  const result=await request(worker,'delete');
  // Unregister only our exact scope; never unrelated origin registrations.
  if(!await r.unregister()) return {confirmed:false,message:'Pack removed; worker removal not confirmed'};
  return result;
}
