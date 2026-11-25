// Bounded artifact-only preview. No fixture revisions, source server or deployment.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readdir, readFile } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build-release.mjs';

const [destination,portText='0']=process.argv.slice(2),port=Number(portText);
if(!destination||process.argv.length>4||!Number.isInteger(port)||port<0||port>65535)
  throw Error('Usage: node tools/qualification-preview.mjs NEW_EXTERNAL_OUTPUT_DIRECTORY [PORT]');
const out=resolve(destination);
await build(fileURLToPath(new URL('../',import.meta.url)),out);
const files=new Set(await readdir(out,{recursive:true}));
const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript',
  '.css':'text/css','.gpx':'application/xml','.json':'application/json'};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const path=url.pathname.slice('/kotr27/'.length)||'index.html';
  if(!['GET','HEAD'].includes(req.method))return res.writeHead(405).end();
  if(!url.pathname.startsWith('/kotr27/')||!files.has(path)||!types[extname(path)])
    return res.writeHead(404).end();
  try {
    const bytes=await readFile(join(out,path));
    res.writeHead(200,{'Content-Type':types[extname(path)],'Content-Length':bytes.length,
      'Cache-Control':'max-age=600','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:bytes);
  } catch {res.writeHead(500).end('Artifact read failed');}
});
server.listen(port,'127.0.0.1');await once(server,'listening');
const manifest=JSON.parse(await readFile(join(out,'offline-release.json')));
console.log(`Artifact: ${out}\nRelease: ${manifest.release}\nURL: http://127.0.0.1:${server.address().port}/kotr27/index.html?area=plan\nStops after 20 minutes; Ctrl-C stops earlier. Artifact retained; no fixtures or deployment.`);
let closing=false;
function stop() {
  if(closing)return;closing=true;clearTimeout(timer);
  server.closeAllConnections();server.close();
}
const timer=setTimeout(stop,20*60*1000);
process.once('SIGINT',stop);process.once('SIGTERM',stop);
