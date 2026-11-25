import { importLocalFile, prepareLocalParser } from './local-route-import.mjs';
import { createLocalRouteStorage, isLocalId, libraryLimits } from './local-route-storage.mjs';
import { outlineProjection } from './route-briefing.mjs';
import { horizontalDistanceM } from './route-analysis.mjs';

const node=(tag,text,parent,id)=>{
  const e=document.createElement(tag); e.textContent=text; parent.append(e); if(id)e.id=id; return e;
};
export function installLocalRoutes(parent,{open,changed,removed,storageBarrier=()=>Promise.resolve()}) {
  const storage=createLocalRouteStorage(), memory=new Map(), persisted=new Set(), saving=new Map();
  let meta={generation:null,entries:[]}, ready=false, busy=false, controller, epoch=0, selected=null;
  let syncSerial=0;
  prepareLocalParser(); // First-party code only; keep worker available after disconnection.
  const root=node('section','',parent,'local-library');
  node('h2','Private local routes & recordings',root);
  node('p','GPX 1.1 or supported FIT course/activity. One file at a time: 4 MiB, 20,000 geometry points, '+
    '50,000 FIT messages, 1,000 segments, 2,000 waypoints, 500 km of supported intervals. Unsupported encodings fail explicitly; no silent truncation. '+
    'Files, names, original metadata and telemetry stay on this device. No uploads, external lookups or local-route 3D.',root);
  node('p','Default: document memory only (lost on reload). Remember is explicit per file, stored in IndexedDB for up to 90 days. '+
    'Local links work only in this browser with a remembered file; they are not portable or public share links. '+
    'Recorded samples are retained separately; complete timestamps enable private recorded replay below. Session decoded budget: 40,000 geometry points across files. No offline pack is installed.',root);
  const label=node('label','Import GPX or FIT for this session',root);
  const input=node('input','',label,'local-file'); input.type='file'; input.accept='.gpx,.fit';
  const cancel=node('button','Cancel import',root,'local-cancel'); cancel.type='button'; cancel.disabled=true;
  const status=node('p','',root,'local-status'); status.setAttribute('role','status');
  const list=node('ul','',root,'local-files');
  const all=node('button','Delete all local routes & recordings',root,'local-delete-all'); all.type='button';
  const confirm=node('div','',root,'local-delete-confirm'); confirm.hidden=true;
  node('p','Delete originals and local records from this library and session? Rider preferences and organizer routes are unaffected.',confirm);
  const yes=node('button','Confirm delete all local files',confirm,'local-confirm-delete');
  const no=node('button','Keep local files',confirm); no.onclick=()=>{confirm.hidden=true;all.focus();};
  yes.type=no.type='button';
  all.onclick=()=>{confirm.hidden=false;yes.focus();};
  const details=node('section','',parent,'local-details'); details.hidden=true;
  const announce=text=>{status.textContent=text;};
  const setBusy=value=>{busy=value;input.disabled=value;cancel.disabled=!value;renderList();};
  function rememberState(record) { record.libraryGeneration=meta.generation; return record; }
  function admit(record) {
    if([...memory.values()].reduce((n,r)=>n+r.decoded.points.length,0)+record.decoded.points.length>40000)
      throw Error('Session limit: 40,000 decoded geometry points across files. Delete another local file first; nothing truncated.');
    memory.set(record.id,record);
  }
  function drop(id) {
    memory.delete(id); persisted.delete(id); removed(id);
    if (selected===id) { details.replaceChildren(); }
  }
  function renderList() {
    root.setAttribute('aria-busy',String(busy || saving.size>0));
    list.replaceChildren();
    const entries=new Map(meta.entries.map(e=>[e.id,e]));
    for (const r of memory.values()) entries.set(r.id,r);
    for (const [id,r] of entries) {
      const li=node('li',`${r.name} · ${r.decoded?.kind||'remembered local file'} · `+
        `${meta.entries.some(e=>e.id===id) ? 'remembered on this device' : 'session only'} `,list);
      const button=(text,action)=>{
        const b=node('button',text,li); b.type='button'; b.disabled=busy;
        b.onclick=()=>action(); return b;
      };
      button('Open in shared explorer',()=>load(id));
      if (memory.has(id) && !meta.entries.some(e=>e.id===id))
        button('Remember this file on this device',async()=>{
          const ticket=++epoch;setBusy(true);
          const attempt={generation:r.libraryGeneration};
          saving.set(id,attempt);
          let writeOutcome='unknown';
          try {
            const saved=await storage.apply({type:'save',expected:r.libraryGeneration,record:r});
            writeOutcome=saved.writeOutcome;
            // A successful response may have been held AFTER COMMIT while a
            // peer deleted the record. Never treat that receipt as current state.
            const readEpoch=epoch, result=await storage.read();
            if(readEpoch===epoch)reconcile(result.meta);
            if(ticket!==epoch)return;
            if(!memory.has(id) || !meta.entries.some(e=>e.id===id))
              throw Error('Local file deleted while saving. Import again; no session copy restored.');
            persisted.add(id);
            announce('Remembered on this device only. Delete here at any time.'); broadcast();
          } catch (error) {
            if(writeOutcome!=='committed')writeOutcome=error.writeOutcome??'unknown';
            // Unknown is not an abort. Discard its active candidate now, even
            // if reconciliation is denied; never downgrade it to session-only
            // and then lose its deletion identity in finally.
            if(writeOutcome==='unknown'){drop(id);changed();}
            try {
              const readEpoch=epoch, result=await storage.read();
              if(readEpoch===epoch)reconcile(result.meta);
            } catch {
              // A known aborted/denied initial save still permits memory-only
              // use. After a commit, unreadable deletion authority is unknown.
              if(writeOutcome==='committed'){drop(id);changed();}
            }
            if(ticket===epoch)announce(`${error.message} ${writeOutcome==='unknown' ?
              'Save outcome unknown. No active copy retained; a stored file may remain. Recheck the library when storage is available.' :
              memory.has(id) ? meta.entries.some(e=>e.id===id) ?
                'Current library confirms a remembered file.' : 'File remains session-only.' :
              'No active copy retained; import again.'}`);
          } finally {
            if(saving.get(id)===attempt)saving.delete(id);
            if(ticket===epoch)setBusy(false);
            else renderList();
          }
        });
      button('Delete this file',()=>erase(id));
    }
    node('li',`Remembered usage: ${meta.entries.length}/${libraryLimits.files} files · `+
      `${(meta.entries.reduce((n,e)=>n+e.bytes,0)/1048576).toFixed(2)}/20 MiB originals. `+
      'Derived views are recomputed, not persisted.',list);
  }
  async function erase(id=null) {
    epoch++; controller?.abort(); setBusy(true);
    // Remove memory immediately, but never claim durable removal before commit.
    for (const key of id ? [id] : [...memory.keys()]) drop(key);
    changed();
    let outcome;
    try {
      const result=await storage.apply({type:id ? 'delete' : 'forget',id,nextGeneration:crypto.randomUUID()});
      meta=result.meta;
      announce(id ? 'Local file deleted.' : 'All local files deleted; library permission revoked.');
      broadcast();
      outcome={confirmed:true};
    } catch (error) {
      announce(`Deletion NOT confirmed: ${error.message} Close other tabs or use browser site-data controls, then retry.`);
      outcome={confirmed:false,message:error.message};
    }
    finally {confirm.hidden=true;setBusy(false);changed();}
    return outcome;
  }
  yes.onclick=()=>erase();
  cancel.onclick=()=>controller?.abort();
  input.onchange=async()=>{
    const file=input.files[0]; input.value=''; if (!file || busy) return;
    if (memory.size>=10 || [...memory.values()].reduce((n,r)=>n+r.buffer.byteLength,0)+file.size>libraryLimits.bytes)
      return announce('Session limit: 10 files / 20 MiB originals. Delete a local file first.');
    const ticket=++epoch, generation=meta.generation;
    controller=new AbortController(); setBusy(true); announce('Parsing locally in a cancellable worker…');
    try {
      const r=await importLocalFile(file,{signal:controller.signal});
      if (ticket!==epoch) return;
      r.libraryGeneration=generation; admit(r);
      announce(`Imported ${r.decoded.format} ${r.decoded.kind} for this session. Nothing saved or uploaded.`);
      open(r);
    } catch(error) { if(ticket===epoch) announce(error.message); }
    finally { if(ticket===epoch) setBusy(false); }
  };
  async function load(id) {
    if (memory.has(id)) {open(memory.get(id));return;}
    const ticket=++epoch; setBusy(true); controller=new AbortController();
    try {
      const {meta:observed,file}=await storage.read(id);
      meta=observed;
      if (!file) throw Error('Local file unavailable. Import again; no organizer route substituted.');
      if(memory.size>=10 || [...memory.values()].reduce((n,r)=>n+r.buffer.byteLength,0)+file.buffer.byteLength>libraryLimits.bytes)
        throw Error('Session limit: 10 files / 20 MiB originals. Delete a local file first.');
      const r=await importLocalFile(new File([file.buffer],file.name),{id,signal:controller.signal});
      const latest=await storage.read();
      if (ticket!==epoch) return;
      meta=latest.meta;
      if (observed.generation!==meta.generation || !meta.entries.some(e=>e.id===id))
        throw Error('Library changed during load; local file was not restored.');
      rememberState(r); admit(r); persisted.add(id); open(r);
      announce('Opened remembered local file. No network lookup.');
    } catch(error) {if(ticket===epoch) announce(error.message);}
    finally {if(ticket===epoch){setBusy(false);changed();}}
  }
  function reconcile(next) {
    const old=meta; meta=next;
    if (old.generation!==meta.generation) {
      epoch++; controller?.abort(); setBusy(false);
    }
    if((old.forgetGeneration??null)!==(meta.forgetGeneration??null)) {
      for(const id of [...memory.keys()])drop(id);
      announce('Delete-all in another tab revoked this library and cleared active local files. Import again to start a new session.');
    }
    // A generation may change because a DIFFERENT file was deleted during
    // this save. Observe any surviving committed ID even if its old receipt
    // will be ignored. This is deletion tracking, never renewed save authority.
    for(const id of memory.keys())if(meta.entries.some(e=>e.id===id))persisted.add(id);
    // Pending saves are not yet in `persisted`, even if their transaction has
    // already committed. A changed category tombstone plus absence invalidates
    // their authority too. Untouched, never-saved session files are not swept.
    for(const [id,attempt] of saving) if(attempt.generation!==meta.generation &&
      !meta.entries.some(e=>e.id===id))drop(id);
    for(const id of [...persisted])if(!meta.entries.some(e=>e.id===id))drop(id);
    renderList();changed();
  }
  async function sync() {
    const ticket=epoch, serial=++syncSerial;
    try {
      // Let an already queued settings privacy operation finish before an
      // automatic library discovery. Explicit local deletion never waits here.
      await storageBarrier();
      if(ticket!==epoch || serial!==syncSerial)return;
      const result=await storage.read();
      if(ticket!==epoch || serial!==syncSerial)return;
      reconcile(result.meta);
    } catch(error) { announce(error.message); }
  }
  // Broadcast contains no names, IDs, bytes or coordinates. Focus rechecks are
  // authoritative even where BroadcastChannel is unavailable.
  let channel=null;
  try {if(typeof BroadcastChannel==='function')channel=new BroadcastChannel('kotr27-library-changed');}
  catch(error) {
    if(!['SecurityError','NotSupportedError'].includes(error.name))throw error;
    announce('Cross-tab messaging unavailable. Library is checked on focus and every saved write.');
  }
  const broadcast=()=>channel?.postMessage('changed');
  if(channel) channel.onmessage=()=>sync();
  window.addEventListener('focus',sync);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});
  const initial=(async()=>{
    await sync();ready=true;changed();
    const id=new URL(location.href).searchParams.get('route');
    if(isLocalId(id) && meta.entries.some(e=>e.id===id)) await load(id);
    root.dataset.ready='true';
  })();
  function show(state,recording=null) {
    root.hidden=state.area!=='explore';
    const r=memory.get(state.routeId); selected=r?.id??null;
    details.hidden=!r || state.area!=='explore';
    details.replaceChildren();
    if (!r || details.hidden) return;
    node('h2',`${r.name} · private local ${r.decoded.kind}`,details);
    node('p','Not an organizer route. Available only in this browser; no public sharing, external map or 3D is enabled for local files.',details);
    for(const text of r.decoded.notices) node('p',text,details);
    node('p',`${r.decoded.points.length} geometry points · ${r.decoded.samples.length} separate samples · ${r.decoded.segments} source segments. `+
      'Continuous geometry supports shared briefing analysis. Recorded replay uses source timestamps separately; missing times are never invented.',details);
    if(r.analysis.status==='supported') return;
    node('p','Continuous analysis unavailable: '+[...new Set(r.analysis.issues.map(i=>i.code))].join(', ')+
      '. Outline only; gaps are not joined, missing heights are not filled.',details);
    // Recording edges belong to the same timestamp-qualified model as replay.
    // Never reconstruct them using geometry alone, sample-index guesses or a
    // second time threshold (coordinate-less FIT samples shift point indices).
    let supportedEdges=null;
    if(r.decoded.kind==='recording') {
      if(recording?.status!=='available' || recording.adapter.identity.routeId!==r.id ||
        recording.adapter.identity.revisionId!==r.revisionId) {
        node('p','Recording outline unavailable without a complete timestamp replay model. No continuous fallback is drawn across unknown recording gaps.',details);
        return;
      }
      supportedEdges=recording.supportedPointEdges;
    }
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.id='local-outline';svg.setAttribute('viewBox','0 0 400 400');svg.setAttribute('role','img');
    svg.setAttribute('aria-label','Local route outline. Disconnected segments and gaps are not joined.');
    const points=r.decoded.points, project=outlineProjection(points);
    // No decimation across a gap: render independent runs, then cap display
    // vertices inside each run. Original geometry/samples remain untouched.
    const runs=[];let run=[];
    for(const [i,p] of points.entries()) {
      const gap=supportedEdges ? !supportedEdges.has(i) :
        p.breakBefore || run.length && horizontalDistanceM(run.at(-1),p)>500;
      if(run.length && gap) {runs.push(run);run=[];}
      run.push(p);
    }
    if(run.length)runs.push(run);
    if(runs.length>1000) {
      node('p','Outline unavailable: more than 1,000 disconnected runs. Original geometry retained; gaps are never joined to simplify display.',details);
      return;
    }
    for(const segment of runs) {
      const path=document.createElementNS(svg.namespaceURI,'path');
      const step=Math.max(1,Math.ceil(points.length/3000));
      const display=segment.filter((p,i)=>i===0 || i===segment.length-1 || i%step===0);
      path.setAttribute('d','M'+display.map(p=>project(p).join(',')).join(' L'));
      path.setAttribute('fill','none');path.setAttribute('stroke','#163c34');path.setAttribute('stroke-width','2');
      svg.append(path);
    }
    details.append(svg);
  }
  return {root,initial,show,get:id=>memory.get(id),load,forget:()=>erase(),
    isReady:()=>ready,
    missing:()=>ready ? 'Local file unavailable in this session. Import again or open a remembered file below. This link is not portable; no organizer route substituted.' :
      'Checking this browser’s local library…',
  };
}
