// Deterministic diagnosis: a paused planner request belongs to a document,
// not the tab forever. Do not rely on loadingFailed for canceled Fetch pauses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { build } from '../tools/build-release.mjs';
import { browser, until } from './browser.mjs';

for (const mode of ['obsolete','completed']) test(`held planner Fetch ${mode} across actual freshness frame replacement`, async t => {
  const tmp = await mkdtemp(join(tmpdir(),'kotr-lifecycle-'));
  let teardown = false;
  t.after(() => { teardown = true; return rm(tmp,{recursive:true,force:true}); });
  const source = join(tmp,'source'), a = join(tmp,'a'), b = join(tmp,'b');
  await mkdir(source);
  for (const dir of ['assets','js']) await cp(new URL('../'+dir+'/',import.meta.url),join(source,dir),{recursive:true});
  for (const file of ['index.html','explore.html']) await cp(new URL('../'+file,import.meta.url),join(source,file));
  await writeFile(join(source,'js/config.js'),'window.KOTR_CONFIG = {};');
  await build(source,a);
  const html = await readFile(join(source,'index.html'),'utf8');
  await writeFile(join(source,'index.html'),html.replace('<title>','<title>Fresh revision: '));
  await build(source,b);
  const marker = async dir => (await readFile(join(dir,'index.html'),'utf8'))
    .match(/<meta name="kotr-release" content="([a-f0-9]{24})">/)[1];
  const oldMarker = await marker(a), newMarker = await marker(b);
  assert.notEqual(oldMarker,newMarker);
  const files = await readdir(b,{recursive:true});
  const types = {'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript',
    '.css':'text/css','.json':'application/json','.gpx':'application/xml'};
  const freshness = Promise.withResolvers();
  t.after(() => freshness.resolve());
  let freshnessRequests = 0, replacementRequests = 0;
  const server = createServer(async (req,res) => {
    const url = new URL(req.url,'http://localhost'), file = url.pathname.slice('/kotr27/'.length) || 'index.html';
    if (!url.pathname.startsWith('/kotr27/') || !files.includes(file) || !types[extname(file)])
      return res.writeHead(404).end();
    const navigation = req.headers['sec-fetch-mode'] === 'navigate';
    let root = b;
    if (file === 'index.html') {
      if (navigation && !url.searchParams.has('_kotr')) root = a;
      else if (navigation) replacementRequests++;
      else { freshnessRequests++; await freshness.promise; }
    }
    try {
      res.writeHead(200,{'Content-Type':types[extname(file)],'Cache-Control':'no-store'})
        .end(await readFile(join(root,file)));
    } catch (error) {
      if (!teardown || error.code !== 'ENOENT') throw error;
      res.end();
    }
  });
  server.listen(0,'127.0.0.1'); await once(server,'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const network = new Map(), terminal = new Map(), frames = [], pauses = [], errors = [];
  let held = null, sequence = 0;
  const {cmd,js,exceptions} = await browser(t,(m,send) => {
    sequence++;
    if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) frames.push({...m.params.frame,sequence});
    if (m.method === 'Network.requestWillBeSent') network.set(m.params.requestId,m.params);
    if (['Network.loadingFinished','Network.loadingFailed'].includes(m.method)) terminal.set(m.params.requestId,{method:m.method,sequence});
    if (m.method !== 'Fetch.requestPaused') return;
    const p = m.params;
    pauses.push(p);
    if (!held && /\/assets\/route-profile-[a-f0-9]{64}\.json$/.test(p.request.url)) {
      held = p; return; // Deliberate fault injection, released only after navigation.
    }
    const local = new URL(p.request.url).origin === base;
    send(local ? 'Fetch.continueRequest' : 'Fetch.failRequest',
      {requestId:p.requestId,...(!local && {errorReason:'BlockedByClient'})})
      .catch(error => errors.push({id:p.requestId,error:error.message}));
  });
  await cmd('Page.enable');
  await cmd('Network.enable');
  await cmd('Fetch.enable',{patterns:[{urlPattern:'http://*'},{urlPattern:'https://*'}]});
  await cmd('Page.navigate',{url:base+'/kotr27/'});
  await until(() => held && network.has(held.networkId) && freshnessRequests === 1 && frames.length === 1);
  const oldFrame = frames[0], oldRequest = network.get(held.networkId);
  assert.equal(held.frameId,oldFrame.id);
  assert.equal(oldRequest.frameId,oldFrame.id);
  assert.equal(oldRequest.loaderId,oldFrame.loaderId);
  assert.equal(await js(`document.querySelector('meta[name="kotr-release"]').content`),oldMarker);
  // Complete every OTHER planner profile before allowing freshness navigation:
  // there is exactly one deliberately outstanding profile in the old context.
  await until(() => [...network.values()].filter(r => r.loaderId === oldFrame.loaderId &&
    /\/assets\/route-profile-[a-f0-9]{64}\.json$/.test(r.request.url) &&
    terminal.get(r.requestId)?.method === 'Network.loadingFinished').length === 6);
  assert.equal(terminal.has(held.networkId),false,'held request has not completed');
  if (mode === 'completed') {
    // Positive control / corrected scheduling: finish the intercepted work in
    // its original document before allowing our server's freshness response.
    await cmd('Fetch.continueRequest',{requestId:held.requestId});
    await until(() => terminal.get(held.networkId)?.method === 'Network.loadingFinished');
    await until(() => js(`document.querySelector('#trip-planner')?.dataset.ready === 'true'`));
  }
  freshness.resolve();
  await until(() => frames.some(frame => frame.id === oldFrame.id && frame.loaderId !== oldFrame.loaderId));
  const replacement = frames.find(frame => frame.id === oldFrame.id && frame.loaderId !== oldFrame.loaderId);
  assert.equal(new URL(replacement.url).searchParams.get('_kotr'),newMarker);
  await until(() => js(`document.querySelector('meta[name="kotr-release"]')?.content === '${newMarker}' &&
    document.querySelector('#trip-planner')?.dataset.ready === 'true'`));
  // Negative control: sending an old ID AFTER its frame's loader changed must
  // fail. This is the one deliberately asserted protocol error, not filtering
  // unexpected errors from the real warm-release fixture.
  let staleError = null;
  if (mode === 'obsolete') {
    try { await cmd('Fetch.continueRequest',{requestId:held.requestId}); }
    catch (error) { staleError = error.message; }
    assert.equal(staleError,'Invalid InterceptionId.');
  } else {
    assert.ok(terminal.get(held.networkId).sequence < replacement.sequence,
      'completion is observed before the replacing document commits');
  }
  assert.equal(replacementRequests,1);
  assert.deepEqual(errors,[]);
  assert.deepEqual(exceptions,[]);
  t.diagnostic(JSON.stringify({mode,held:{id:held.requestId,networkId:held.networkId,frameId:held.frameId,
    url:held.request.url,loaderId:oldRequest.loaderId,terminal:terminal.get(held.networkId) ?? null},
  replacement:{frameId:replacement.id,loaderId:replacement.loaderId,url:replacement.url,sequence:replacement.sequence},
  continuationAfterReplacement:staleError,otherContinuationErrors:errors}));
});
