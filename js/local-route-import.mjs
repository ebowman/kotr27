import { importLimits } from './local-route-parser.mjs';

let parser=null, active=false;
export function prepareLocalParser() {
  if(parser) return;
  try {
    parser=new Worker(new URL('./local-route-worker.mjs',import.meta.url),{type:'module'});
    parser.onerror=event=>{event.preventDefault();parser?.terminate();parser=null;};
  } catch { parser=null; }
}
export function importLocalFile(file,{id=`user:${crypto.randomUUID()}`,signal}={}) {
  if (!file || file.size<=0 || file.size>importLimits.bytes)
    return Promise.reject(Error('Choose one non-empty GPX/FIT file up to 4 MiB.'));
  return new Promise((resolve,reject)=>{
    if(active) return reject(Error('Another import is running. Cancel it first.'));
    active=true;
    let worker, timer, settled=false;
    const end=(error,result)=>{
      if (settled) return; settled=true;
      clearTimeout(timer); signal?.removeEventListener('abort',cancel); active=false;
      if(error) {worker?.terminate();if(parser===worker)parser=null;}
      else if(worker) {worker.onmessage=null;worker.onerror=event=>{
        event.preventDefault();worker.terminate();if(parser===worker)parser=null;
      };}
      error ? reject(error) : resolve(result);
    };
    const cancel=()=>end(Error('Import cancelled; nothing saved.'));
    if (signal?.aborted) return cancel();
    signal?.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(()=>end(Error('Import exceeded 15 seconds; nothing saved.')),importLimits.timeoutMs);
    try {
      prepareLocalParser(); worker=parser;
      if(!worker) throw Error('Worker unavailable');
      worker.onmessage=({data})=>end(data.error ? Error(data.error) : null,data.record);
      worker.onerror=event=>{event.preventDefault();end(Error('Local parser unavailable; nothing saved.'));};
      file.arrayBuffer().then(buffer=>{
        if (!settled) worker.postMessage({buffer,name:file.name,id},[buffer]);
      },()=>end(Error('File could not be read; nothing saved.')));
    } catch { end(Error('Local worker unavailable; nothing saved.')); }
  });
}
