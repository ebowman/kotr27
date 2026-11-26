import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { build } from '../tools/build-release.mjs';
import { readRoutePack } from '../tools/route-pack.mjs';
import { browser, startupPageTarget, until } from './browser.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const retired=/^(?:assets\/(?:semonzo|flyover)|js\/(?:example-catalog|semonzo-profile|rider-controls|chapter-reveal|plan-comparison))\./;
async function source(t) {
  const tmp=await mkdtemp(join(tmpdir(),'kotr-release-'));
  t.after(()=>rm(tmp,{recursive:true,force:true}));
  const src=join(tmp,'source');await mkdir(src);
  for(const path of ['assets','js','index.html','explore.html'])
    await cp(new URL('../'+path,import.meta.url),join(src,path),{recursive:true});
  await writeFile(join(src,'js/config.js'),'window.KOTR_CONFIG = {};');
  return {tmp,src};
}

test('browser startup selects only the unique command-line blank page',async()=>{
  const page={targetId:'startup',type:'page',url:'about:blank'};
  const ignored=[{targetId:'worker',type:'service_worker',url:'about:blank'},
    {targetId:'other-page',type:'page',url:'https://example.invalid/'}];
  let calls=0;
  assert.equal(await startupPageTarget(async method=>{
    assert.equal(method,'Target.getTargets');return {targetInfos:++calls===1?ignored:[...ignored,page]};
  }),'startup');
  assert.equal(calls,2);
  await assert.rejects(startupPageTarget(async()=>({targetInfos:[page,{...page,targetId:'duplicate'}]})),/Ambiguous startup/);
  await assert.rejects(startupPageTarget(async()=>({targetInfos:[{...page,targetId:''}]})),/no target ID/);
  const error=Error('discovery failed');
  await assert.rejects(startupPageTarget(async()=>{throw error;}),e=>e===error);
});

test('release/offline graph omits placeholder, pins every import, preserves seven identities and every asset byte',async t=>{
  const {tmp,src}=await source(t), out=join(tmp,'public'), repeat=join(tmp,'repeat');
  const pack=await readRoutePack(await realpath(src));
  // Neither obsolete study fixtures nor unrelated source files are publication inputs.
  await writeFile(join(src,'assets/private.txt'),'not public');
  await writeFile(join(src,'assets/semonzo.gpx'),'retired and deliberately invalid');
  await writeFile(join(src,'js/example-catalog.mjs'),'throw Error("must not import retired catalog")');
  await build(src,out);await build(src,repeat);
  const names=(await readdir(out,{recursive:true})).filter(n=>extname(n));
  assert.deepEqual(names,(await readdir(repeat,{recursive:true})).filter(n=>extname(n)));
  assert.ok(!names.some(n=>retired.test(n)||/private|fixture|prototype|relief|\.svg$|\.webp$/.test(n)));
  const manifest=JSON.parse(await readFile(join(out,'offline-release.json')));
  assert.equal(manifest.routes.length,7);
  assert.deepEqual(manifest.routes.map(r=>r.id).sort(),pack.pack.catalog.routes.map(r=>r.id).sort());
  assert.ok(!manifest.resources.some(r=>retired.test(r.path)));
  assert.ok(!manifest.common.some(p=>retired.test(p)));
  for(const [path,bytes] of pack.files)assert.deepEqual(await readFile(join(out,path)),bytes,path);
  for(const path of names) {
    const bytes=await readFile(join(out,path));
    assert.deepEqual(bytes,await readFile(join(repeat,path)),path);
    if(path.includes('/'))assert.ok(path.includes(hash(bytes))||path.includes(hash(bytes).slice(0,24)),path);
    if(!/\.(?:mjs|js)$/.test(path))continue;
    const text=bytes.toString();
    assert.doesNotMatch(text,/createSemonzoPlaybackRoute|estimateExampleTime|exampleProfile|window\.startTerrain|loadExampleTrack/);
    for(const [,spec] of text.matchAll(/(?:from\s*|import\s*\(|new URL\(\s*)\s*['"](\.[^'"]+\.(?:mjs|js))['"]/g)) {
      assert.match(spec,/\.[a-f0-9]{24}\.(?:mjs|js)$/);
      assert.ok(names.includes(normalize(join(dirname(path),spec))),`${path} → ${spec}`);
    }
  }
  // Current approved geometry is still a mandatory, hash-verified input.
  const geometry=pack.pack.catalog.routes[0].revisions[0].geometry.path;
  await writeFile(join(src,geometry),'tampered');
  await assert.rejects(build(src,join(tmp,'bad')),/hash|bytes|mismatch/i);
  assert.ok(!(await readdir(tmp)).includes('bad'));
  t.diagnostic(`${manifest.resources.length} offline resources; seven route identities and all ${pack.files.size} pack files unchanged`);
});

test('every shipped module edit invalidates exactly its transitive graph and both entry markers',async t=>{
  const {tmp,src}=await source(t), out=join(tmp,'baseline');await build(src,out);
  const names=(await readdir(out,{recursive:true})).filter(n=>extname(n));
  const logical=n=>n.replace(/\.[a-f0-9]{24}\./,'.');
  const modules=names.filter(n=>/\.(?:mjs|js)$/.test(n)&&n.includes('/'));
  const edges=new Map();
  for(const path of modules) {
    const text=await readFile(join(out,path),'utf8');
    edges.set(logical(path),[...text.matchAll(/(?:from\s*|import\s*\(|new URL\(\s*)\s*['"](\.[^'"]+\.(?:mjs|js))['"]/g)]
      .map(([,spec])=>logical(normalize(join(dirname(path),spec)))));
  }
  // Include all modules, not just a hand-maintained subset of the dependency tree.
  for(const file of edges.keys()) {
    const original=await readFile(join(src,file),'utf8'), next=join(tmp,'change-'+file.replaceAll('/','-'));
    await writeFile(join(src,file),'// release dependency regression\n'+original);
    await build(src,next);
    await writeFile(join(src,file),original);
    const changed=new Set([file]);
    let size;
    do {size=changed.size;for(const [path,deps] of edges)if(deps.some(d=>changed.has(d)))changed.add(path);}
    while(size!==changed.size);
    const after=await readdir(next,{recursive:true});
    assert.deepEqual(modules.filter(p=>!after.includes(p)).map(logical).sort(),[...changed].sort(),file);
    for(const entry of ['index.html','explore.html'])
      assert.notDeepEqual(await readFile(join(out,entry)),await readFile(join(next,entry)),`${file} → ${entry}`);
    for(const path of names.filter(p=>p.includes('/')&&!changed.has(logical(p))))
      assert.deepEqual(await readFile(join(out,path)),await readFile(join(next,path)),`${file} preserves ${path}`);
  }
});

test('ordinary warm Pages URL switches releases; unchanged, failed and offline probes retain usable explicit choices',async t=>{
  const {tmp,src}=await source(t), a=join(tmp,'a'), b=join(tmp,'b');
  await build(src,a);
  await writeFile(join(src,'index.html'),(await readFile(join(src,'index.html'),'utf8')).replace('<title>','<title>B: '));
  await writeFile(join(src,'js/site-shell.mjs'),'// release B\n'+await readFile(join(src,'js/site-shell.mjs'),'utf8'));
  await build(src,b);
  const names=await readdir(a,{recursive:true}), bNames=await readdir(b,{recursive:true});
  const allowed=new Set([...names,...bNames]), types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript',
    '.css':'text/css','.json':'application/json','.gpx':'application/xml'};
  const marker=async dir=>(await readFile(join(dir,'index.html'),'utf8')).match(/name="kotr-release" content="([^"]+)"/)[1];
  const markers=new Map([[a,await marker(a)],[b,await marker(b)]]);
  let live=a, fail=false, probes=0, replacements=0, gate=null, gated=0, closing=false;
  t.after(()=>{closing=true;gate?.resolve();});
  const server=createServer(async(req,res)=>{
    if(req.url==='/away')return res.writeHead(200,{'Content-Type':'text/html'}).end('<a href="/kotr27/">Return</a>');
    const url=new URL(req.url,'http://localhost'), file=url.pathname.slice('/kotr27/'.length)||'index.html';
    if(!url.pathname.startsWith('/kotr27/')||!allowed.has(file)||!types[extname(file)])return res.writeHead(404).end();
    if(file==='index.html') {
      if(req.headers['sec-fetch-mode']!=='navigate') {
        probes++;if(fail)return res.destroy();
        if(gate){gated++;await gate.promise;}
      } else if(url.search)replacements++;
    }
    try {res.writeHead(200,{'Content-Type':types[extname(file)],'Cache-Control':'public,max-age=600'}).end(await readFile(join(live,file)));}
    catch(error){if(!closing&&error.code!=='ENOENT')throw error;res.writeHead(404).end();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`, {cmd,js,exceptions}=await browser(t);
  await cmd('Network.enable');
  const ready=()=>until(()=>js(`document.getElementById('site-shell')?.dataset.ready==='true' &&
    document.getElementById('trip-planner')?.dataset.ready==='true'`));
  const visit=async(offline=false)=>{
    await cmd('Page.navigate',{url:base+'/away'});
    await until(()=>js(`!!document.querySelector('a')`));
    if(offline)await cmd('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
    await js(`document.querySelector('a').click()`);
    if(gate) {
      await ready();await until(()=>gated===1);
      assert.equal(await js(`document.querySelector('meta[name="kotr-release"]').content`),markers.get(a));
      gate.resolve();gate=null;
    }
    await until(()=>js(`document.querySelector('meta[name="kotr-release"]')?.content==='${markers.get(live)}'`));
    await ready();
    assert.equal(await js(`document.getElementById('site-route').value`),'');
    assert.equal(await js(`document.getElementById('site-route').options.length`),8);
  };
  await visit();await until(()=>probes===1);
  live=b;gate=Promise.withResolvers();await visit();
  assert.equal(replacements,1);assert.equal(gated,1);
  let before=probes;await visit();await until(()=>probes>before);
  fail=true;before=probes;await visit();await until(()=>probes>before);
  await visit(true);
  assert.equal(replacements,1);assert.deepEqual(exceptions,[]);
});
