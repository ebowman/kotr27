// Separate library category/database: never touches rider consent or public data.
export const localRouteDatabase='kotr27-local-routes';
export const libraryLimits=Object.freeze({files:10,bytes:20*1024*1024,retentionMs:90*86400000});
export const isLocalId=id=>/^user:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id||'');
const empty=()=>({version:1,generation:null,forgetGeneration:null,entries:[]});
const need=(ok,message)=>{if(!ok) throw Error(message);};
function decodeMeta(value,now) {
  const meta=value??empty();
  need(meta.version===1 && Array.isArray(meta.entries) && meta.entries.length<=libraryLimits.files &&
    (meta.generation===null || typeof meta.generation==='string' && meta.generation.length>0 && meta.generation.length<=128),
  'Unsupported/corrupt local library; delete all to reset.');
  need(meta.forgetGeneration==null || typeof meta.forgetGeneration==='string' &&
    meta.forgetGeneration.length>0 && meta.forgetGeneration.length<=128,'Corrupt library deletion marker; delete all to reset.');
  const ids=new Set();
  let bytes=0;
  for(const e of meta.entries) {
    need(e && isLocalId(e.id) && !ids.has(e.id) && typeof e.name==='string' && e.name.length<=100 &&
      Number.isInteger(e.bytes) && e.bytes>0 && e.bytes<=4*1024*1024 &&
      Number.isFinite(e.savedAt) && e.savedAt>=0 && e.savedAt<=now,'Corrupt local library entry; delete all to reset.');
    ids.add(e.id);bytes+=e.bytes;
  }
  need(bytes<=libraryLimits.bytes,'Corrupt library byte budget; delete all to reset.');
  return meta;
}
export function libraryChange(previous,command,now=Date.now()) {
  const meta=decodeMeta(previous,now);
  const next={...meta,entries:[...meta.entries]};
  if (command.type==='save') {
    need(command.expected===meta.generation,'Library changed in another tab. Import again before choosing Remember; nothing saved.');
    const r=command.record;
    need(isLocalId(r?.id) && r.buffer instanceof ArrayBuffer && r.buffer.byteLength>0 &&
      r.buffer.byteLength<=4*1024*1024 && typeof r.name==='string' && r.name.length<=100,'Invalid local record.');
    need(!meta.entries.some(e=>e.id===r.id),'Local record already exists; it was not overwritten.');
    need(meta.entries.length<libraryLimits.files &&
      meta.entries.reduce((n,e)=>n+e.bytes,0)+r.buffer.byteLength<=libraryLimits.bytes,'Library limit: 10 files / 20 MiB. Use session memory or delete files.');
    next.entries.push({id:r.id,name:r.name,bytes:r.buffer.byteLength,savedAt:now});
  } else if (command.type==='delete' || command.type==='forget' || command.type==='expire') {
    need(typeof command.nextGeneration==='string' && command.nextGeneration.length>0,'Missing deletion generation.');
    // This generation is a durable category tombstone even for an empty DB.
    // Never deleteDatabase: a delayed save must not see an empty authority again.
    next.generation=command.nextGeneration;
    if(command.type==='forget')next.forgetGeneration=next.generation;
    next.entries=command.type==='forget' ? [] : meta.entries.filter(e=>command.type==='delete' ?
      e.id!==command.id : now-e.savedAt<libraryLimits.retentionMs);
  } else throw Error('Unknown local library operation.');
  return next;
}
export function createLocalRouteStorage(getFactory=()=>globalThis.indexedDB,clock=Date.now) {
  async function connect(create) {
    const factory=getFactory();
    need(typeof factory?.databases==='function','Local storage unavailable; session memory still works.');
    if (!create && !(await factory.databases()).some(d=>d.name===localRouteDatabase)) return null;
    return new Promise((resolve,reject)=>{
      const request=factory.open(localRouteDatabase,1);
      let blocked=false;
      request.onupgradeneeded=()=>{
        request.result.createObjectStore('meta');
        request.result.createObjectStore('files');
      };
      request.onerror=()=>reject(Error(`Local storage unavailable (${request.error?.name}). Session memory still works.`));
      request.onblocked=()=>{blocked=true;reject(Error('Local library blocked by another tab. Close it and retry explicitly.'));};
      request.onsuccess=()=>{if(blocked) request.result.close(); else resolve(request.result);};
    });
  }
  async function run(command=null,id=null) {
    // Only a terminal native abort confirms rollback. A request error or an
    // untrusted/injected failure receipt does not prove the write never landed.
    let db, writeOutcome='not-written';
    try {
      db=await connect(Boolean(command));
      if (!db) return {meta:empty(),file:null};
      return await new Promise((resolve,reject)=>{
        let result, failure;
        const tx=db.transaction(['meta','files'],command ? 'readwrite' : 'readonly');
        writeOutcome='unknown';
        const metadata=tx.objectStore('meta'), files=tx.objectStore('files');
        const req=metadata.get('current');
        req.onsuccess=()=>{
          try {
            let meta=req.result??empty();
            if (command) {
              // Forget must remain possible for an obsolete/corrupt schema.
              if (command.type==='forget') meta=empty();
              const next=libraryChange(meta,command,clock());
              if (command.type==='forget') files.clear();
              else for (const e of meta.entries) if (!next.entries.some(n=>n.id===e.id)) files.delete(e.id);
              if (command.type==='save') {
                const {id,name,buffer}=command.record;
                files.put({id,name,buffer},id);
              }
              metadata.put(next,'current'); meta=next;
            }
            decodeMeta(meta,clock());
            result={meta,file:null};
            if (id && meta.entries.some(e=>e.id===id)) {
              const f=files.get(id); f.onsuccess=()=>{
                try {
                  const file=f.result,entry=meta.entries.find(e=>e.id===id);
                  need(file && file.id===id && file.name===entry.name && file.buffer instanceof ArrayBuffer &&
                    file.buffer.byteLength===entry.bytes,'Corrupt/missing local original. Delete this file and import again.');
                  result.file=file;
                } catch(error) {failure=error;tx.abort();}
              };
            }
          } catch (error) { failure=error; tx.abort(); }
        };
        tx.oncomplete=()=>resolve(command ? {...result,writeOutcome:'committed'} : result);
        // Request errors bubble before rollback; wait for the terminal event.
        tx.onerror=()=>{};
        tx.onabort=event=>{
          writeOutcome=event.isTrusted && event.target===tx ? 'aborted' : 'unknown';
          reject(failure||Error(`Local storage transaction failed (${tx.error?.name||'unconfirmed'}). Nothing confirmed saved/deleted.`));
        };
      });
    } catch (error) {
      const failure=Error(error instanceof DOMException ?
        `Local storage denied (${error.name}). Deletion is NOT confirmed.` : error.message,{cause:error});
      if(command)failure.writeOutcome=writeOutcome;
      throw failure;
    } finally { db?.close(); }
  }
  return {
    read:async id=>{
      let result=await run(null,id);
      if (result.meta.entries.some(e=>clock()-e.savedAt>=libraryLimits.retentionMs)) {
        await run({type:'expire',nextGeneration:crypto.randomUUID()});
        result=await run(null,id);
      }
      return result;
    },
    apply:run,
  };
}
