import {preview, install, packStatus, forgetOffline, deletionGeneration, registration} from './offline-client.mjs';
import {selectedResources} from './offline-contract.mjs';

export function installOffline(parent,{storageBarrier=async()=>{}}={}) {
  const root=document.createElement('section');
  root.id='offline-packs';root.className='site-card';
  root.innerHTML=`
    <h2>Offline day packs · optional</h2>
    <p>First download needs internet. Select source days, then explicitly save their cleared variants.
      Includes this release’s app, text, route outline, elevation/profile, climb derivations, local parsers and available GPX exports.
      FIT is unavailable, not a renamed GPX. D1–D4 are source labels, not calendar dates.</p>
    <p>No offline coverage for terrain/Mapbox, weather, live alerts, participant data or personal recordings.
      First-ever offline visits cannot load the app. Saved revisions cannot establish currentness while disconnected.</p>
    <fieldset id="offline-days"><legend>Days to save (all cleared variants of each chosen day)</legend></fieldset>
    <p id="offline-preview">Check the online revision to preview days and sizes before choosing to save.</p>
    <div class="site-actions"><button id="offline-check" type="button">Check online revision / preview</button>
      <button id="offline-save" type="button" disabled>Download selected days / replace pack</button>
      <button id="offline-delete" type="button">Delete offline packs</button>
      <button id="offline-reload" type="button">Reload saved release</button></div>
    <progress id="offline-progress" max="1" value="0" aria-label="Offline download bytes"></progress>
    <p id="offline-status" role="status" aria-live="polite">No offline guarantee until a complete pack is saved and reloaded.</p>
    <p id="offline-currentness" role="status"></p>
    <p>Opt-in Cache Storage on this device; no persistence permission requested. Browser denial, eviction or clearing can remove packs.
      Limit: 25 MiB per route, 50 MiB active, 100 MiB including staging/old tabs, with 20% quota headroom.
      Old tabs retain their release until closed. Close old tabs if the budget is full.
      Delete removes these packs only; global Forget also clears personal data. Files already downloaded are outside app control.</p>`;
  parent.append(root);
  const el=id=>root.querySelector('#offline-'+id);
  let manifest=null,busy=false,version=0,epoch=0,outcome='',refreshSerial=0;
  const selected=()=>[...el('days').querySelectorAll('input:checked')].map(x=>x.value);
  function selection() {
    try {
      const refs=selectedResources(manifest,selected());
      el('preview').textContent=`Release ${manifest.release} · ${refs.reduce((n,r)=>n+r.bytes,0).toLocaleString()} bytes · ${refs.length} verified first-party resources.`;
      el('save').disabled=busy;
    } catch {el('save').disabled=true;el('preview').textContent=manifest?`Release ${manifest.release} · choose days to see bytes.`:'Preview unavailable; connect to the published release.';}
  }
  async function refresh() {
    const serial=++refreshSerial,own=version;
    try {
      const s=await packStatus(), a=s.active;
      if(serial!==refreshSerial || own!==version)return s;
      const text=!a?'Not saved. Ordinary HTTP caching is not an offline pack.' :
        `${a.restricted?'Saved shell only — catalog retired after withdrawal; reconnect and replace for remaining days':a.complete?'Saved complete':'Incomplete / evicted — reconnect to repair'} · ${a.bytes.toLocaleString()} bytes · saved ${new Date(a.savedAt).toISOString()} · release ${a.release} · days ${a.days.join(', ')}.`;
      if(!busy) el('status').textContent=text+' '+outcome;
      el('currentness').textContent=`${navigator.onLine?'Saved revision; currentness unverified until an online check.':'Offline: saved revision; changes/withdrawals cannot be checked.'} `+
        (s.verifiedAt?`Last online verification ${new Date(s.verifiedAt).toISOString()}. `:'')+
        (a && s.current && s.current!==a.release?'New release available: preview and explicitly replace pack, then reload. ':'')+
        (s.pinned && a && s.pinned!==a.release?'This tab retains its older release. Reload to use the new complete pack. ':'')+
        (s.withdrawn?.length?'Known withdrawn routes blocked: '+s.withdrawn.join(', ')+'. Delete the old pack.':'');
      if(s.withdrawn?.length) window.dispatchEvent(new CustomEvent('kotr-offline-withdrawn',{detail:s.withdrawn}));
      return s;
    } catch {if(serial===refreshSerial && own===version)
      el('status').textContent='Offline storage unavailable or denied. No offline guarantee; online pages remain usable.';}
  }
  async function check() {
    const own=++version;
    try {
      const next=await preview();
      if(own!==version)return;
      manifest=next;
      const prior=selected();
      el('days').querySelectorAll('label').forEach(n=>n.remove());
      for(const day of manifest.days) {
        const label=document.createElement('label'), input=document.createElement('input');
        input.type='checkbox';input.value=day.id;input.checked=prior.includes(day.id);
        input.disabled=!manifest.routes.some(r=>r.day===day.id && r.revision && r.status!=='withdrawn');
        input.onchange=selection;
        label.append(input,document.createTextNode(' '+day.name));el('days').append(label);
      }
      selection();
      const status=await refresh();
      if(!status)throw Error('Storage unavailable');
      epoch=status.epoch;
      el('currentness').textContent+=` Online release verified just now: ${manifest.release}. Reload/update is explicit.`;
    } catch {
      await refresh();
      el('currentness').textContent+=' Online check failed: currentness/withdrawals cannot be verified.';
    }
  }
  el('check').onclick=check;
  el('save').onclick=async()=>{
    if(busy || !manifest)return;
    busy=true;outcome='';selection();
    const fence=deletionGeneration();
    try {
      el('status').textContent='Staging — not yet saved. Previous complete pack retained until verification finishes.';
      await install(selected(),manifest.release,epoch,({loaded,total})=>{
        el('progress').max=total;el('progress').value=loaded;
      });
      if(fence!==deletionGeneration()) throw Error('Canceled by Forget/delete');
      busy=false;outcome='Reload once now to enter the saved release before disconnecting.';await refresh();
    } catch(error) {
      busy=false;outcome=`Not saved / update incomplete: ${error.message}.`;await refresh();
    } finally {busy=false;selection();}
  };
  const forget=async()=>{
    version++;manifest=null;selection();
    const result=await forgetOffline();
    await refresh();
    return result;
  };
  el('delete').onclick=async()=>{
    try {
      const result=await forget();
      if(!result.confirmed)throw Error(result.message);
      outcome='Offline packs deleted; pending saves revoked. Reconnect before reloading.';await refresh();
    } catch(error) {outcome='Deletion NOT confirmed: '+error.message;el('status').textContent=outcome;}
  };
  el('reload').onclick=()=>location.reload();
  navigator.serviceWorker?.addEventListener('message',e=>{
    if(e.data?.type==='kotr-offline-change') refresh();
  });
  window.addEventListener('online',check);
  window.addEventListener('offline',refresh);
  const ready=(async()=>{
    await storageBarrier();
    await refresh();
    // Before opt-in, even preview is explicit. Existing packs check permission
    // and freshness on entry/reconnect; failed network reads never mean current.
    try {if(await registration())await check();} catch {}
    root.dataset.ready='true';
  })();
  return {root,forget,ready};
}
