// A durable epoch fences delayed saves across tabs, including registration races.
// Reads never create a database; Forget retains only public lifecycle tombstones.
export const emptyOfflineState=()=>({epoch:0,active:null,generations:{},pins:{},withdrawn:[],blockedPaths:[],verifiedAt:null,current:null});
export function offlineStorage(path) {
  const database=`kotr27-offline:${path}`;
  return async function state(change) {
    if(!change && !(await indexedDB.databases()).some(d=>d.name===database)) return emptyOfflineState();
    const db=await new Promise((resolve,reject)=>{
      const r=indexedDB.open(database,1);
      r.onupgradeneeded=()=>r.result.createObjectStore('state');
      r.onsuccess=()=>resolve(r.result);
      r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Offline storage blocked'));
    });
    try {
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction('state',change?'readwrite':'readonly'),store=tx.objectStore('state');
        let value,error;
        const r=store.get('current');
        r.onsuccess=()=>{try {
          value=r.result??emptyOfflineState();
          if(!Number.isSafeInteger(value.epoch) || !value.generations || !value.pins ||
            !Array.isArray(value.withdrawn) || !Array.isArray(value.blockedPaths)) throw Error('Corrupt offline state');
          if(change){change(value);store.put(value,'current');}
        } catch(e){error=e;tx.abort();}};
        tx.oncomplete=()=>resolve(value);
        tx.onabort=()=>reject(error??tx.error??Error('Offline transaction aborted'));tx.onerror=()=>{};
      });
    } finally {db.close();}
  };
}
