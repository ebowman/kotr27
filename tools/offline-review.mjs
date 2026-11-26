// Local-only bounded rehearsal. Never publish these fixture artifacts.
import {createServer} from 'node:http';
import {cp,mkdir,mkdtemp,readFile,readdir,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,extname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from './build-release.mjs';
import {readRoutePack,validatePack} from './route-pack.mjs';
import {canonical} from '../js/offline-contract.mjs';

const source=fileURLToPath(new URL('../',import.meta.url));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(canonical(value)+'\n');
const invalidated=['saved-plans','offline-packs','profile','climbs','pois','cues'];
export async function buildOfflineRehearsal(out) {
  const rel=relative(source,resolve(out));
  if(!rel.startsWith('..'+sep))throw Error('Review artifacts must be outside the source checkout');
  await mkdir(out); // Refuse overwriting a previous review.
  const src=await realpath(await mkdtemp(join(tmpdir(),'kotr-offline-source-')));
  try {
    for(const name of ['index.html','explore.html','assets','js'])
      await cp(join(source,name),join(src,name),{recursive:true});
    await mkdir(join(src,'prototypes/rider-first'),{recursive:true});
    for (const file of ['app.mjs','style.css'])
      await cp(join(source,'prototypes/rider-first',file),join(src,'prototypes/rider-first',file));
    await build(src,join(out,'a'));
    const original=await readRoutePack(src),pack=structuredClone(original.pack);
    const route=pack.catalog.routes.find(r=>pack.catalog.variants.find(v=>v.id===r.variantId)?.dayId==='kotr-d1');
    if(!route?.currentRevisionId)throw Error('Rehearsal requires the cleared D1 route');
    const before=route.currentRevisionId,revision=route.revisions[0],summary=pack.routes.find(r=>r.routeId===route.id);
    summary.source.origin='derived-rehearsal';
    revision.provenance.source+=' · OFFLINE REHEARSAL ONLY (not an organizer revision)';
    const identity={producer:pack.producer,recipe:'route-raw-profile-v1',routeId:route.id,
      geometrySha256:revision.geometrySha256,source:summary.source,provenance:revision.provenance,rights:revision.rights};
    const encoded=(canonical(identity)+'\n').replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
    revision.id=route.id+'-v-'+hash(encoded);route.currentRevisionId=revision.id;summary.revisionId=revision.id;
    for(const ref of [revision.geometry,revision.profile,...revision.downloads])ref.revisionId=revision.id;
    const profile=JSON.parse(await readFile(join(src,revision.profile.path)));
    profile.revisionId=revision.id;
    const bytes=json(profile);revision.profile.sha256=hash(bytes);
    revision.profile.path=`assets/route-profile-${revision.profile.sha256}.json`;
    await writeFile(join(src,revision.profile.path),bytes);
    const report=(previous,changed)=>{
      pack.changeReport={previousManifestSha256:previous,changes:pack.catalog.routes.map(r=>{
        const s=pack.routes.find(s=>s.routeId===r.id), old=original.pack.routes.find(s=>s.routeId===r.id);
        const change=r.id===route.id;
        return {routeId:r.id,kind:change?changed:'unchanged',beforeRevisionId:change?before:r.currentRevisionId,
          afterRevisionId:r.currentRevisionId,pathChanged:change,beforeTotals:old.computed,afterTotals:s.computed,
          annotationsNeedReview:change,annotationIds:[],invalidated:change?invalidated:[]};
      })};
    };
    async function publishFixture() {
      await validatePack(pack,{read:path=>readFile(join(src,path))});
      const bytes=json(pack),sha256=hash(bytes),path=`assets/route-manifest-${sha256}.json`;
      await writeFile(join(src,path),bytes);
      await writeFile(join(src,'assets/route-pack.json'),json({schemaVersion:1,path,sha256}));
      return sha256;
    }
    report(JSON.parse(original.pointerBytes).sha256,'revised');
    const bHash=await publishFixture();
    const html=await readFile(join(src,'index.html'),'utf8');
    await writeFile(join(src,'index.html'),html.replace('<title>','<title>Offline fixture B: '));
    await build(src,join(out,'b'));
    route.status='withdrawn';route.currentRevisionId=null;route.revisions=[];
    Object.assign(summary,{revisionId:null,source:null,computed:null,pointCount:0,sourceCueCount:0,fitEncodedDistanceM:null,
      availability:Object.fromEntries(Object.keys(summary.availability).map(k=>[k,'withdrawn']))});
    pack.catalog.annotations=pack.catalog.annotations.filter(a=>a.routeId!==route.id);
    report(bHash,'withdrawn');
    pack.changeReport.changes.find(c=>c.routeId===route.id).beforeRevisionId=revision.id;
    await publishFixture();
    await writeFile(join(src,'index.html'),html.replace('<title>','<title>Offline WITHDRAWAL fixture: '));
    await build(src,join(out,'withdrawn'));
    return {routeId:route.id,before,after:revision.id};
  } finally {await rm(src,{recursive:true,force:true});}
}

async function serve(out,port) {
  const releases={};
  for(const name of ['a','b','withdrawn']) {
    releases[name]=new Map();
    for(const path of await readdir(join(out,name),{recursive:true})) {
      if(extname(path))releases[name].set(path,await readFile(join(out,name,path)));
    }
  }
  let active='a',offline=false;
  const types={'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.css':'text/css',
    '.json':'application/json','.gpx':'application/gpx+xml'};
  const server=createServer((req,res)=>{
    const u=new URL(req.url,'http://127.0.0.1');
    if(req.method==='POST' && !req.headers.origin && u.pathname.startsWith('/__fixture/')) {
      const action=u.pathname.slice('/__fixture/'.length);
      if(Object.hasOwn(releases,action))active=action;
      else if(action==='offline')offline=true;
      else if(action==='online')offline=false;
      else return res.writeHead(400).end('Unknown fixture action');
      return res.end(`REHEARSAL ${active}; ${offline?'disconnected':'online'}\n`);
    }
    if(offline){req.socket.destroy();return;}
    if(!u.pathname.startsWith('/kotr27/'))return res.writeHead(404).end();
    const path=u.pathname.slice('/kotr27/'.length)||'index.html',bytes=releases[active].get(path);
    if(!bytes)return res.writeHead(404).end();
    res.writeHead(200,{'Content-Type':types[extname(path)]??'text/plain','Cache-Control':'no-store'}).end(bytes);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  const stop=()=>{clearTimeout(timer);server.closeAllConnections();server.close();};
  const timer=setTimeout(stop,20*60*1000);
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  console.log(`REHEARSAL ONLY — http://127.0.0.1:${server.address().port}/kotr27/index.html?area=plan`);
  console.log('20-minute bounded server. POST /__fixture/{a,b,withdrawn,offline,online}; Ctrl-C stops. Artifacts retained for review, never publish.');
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(![3,4].includes(process.argv.length))throw Error('Usage: node tools/offline-review.mjs NEW_ABSOLUTE_OUTPUT_DIRECTORY [PORT]');
  const port=Number(process.argv[3]??0);
  if(!Number.isInteger(port) || port<0 || port>65535)throw Error('PORT must be 0 (automatic) or 1–65535');
  const out=resolve(process.argv[2]);
  const info=await buildOfflineRehearsal(out);
  console.log(JSON.stringify(info));
  await serve(out,port);
}
