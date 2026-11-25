// Final packaged evidence, not a physical-phone or full accessibility certification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir, loadavg, cpus } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { join, dirname, extname } from 'node:path';
import { build } from '../tools/build-release.mjs';
import { readRoutePack } from '../tools/route-pack.mjs';
import { browser, until } from './browser.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function artifact(t) {
  const temp=await mkdtemp(join(tmpdir(),'kotr-final-')),out=join(temp,'kotr27');
  const cleanup=[],jobs=new Set(),errors=[];
  let server;
  t.after(async()=>{
    for(const close of cleanup)await close();
    if(server?.listening) {
      const closed=new Promise(resolve=>server.close(resolve));
      server.closeAllConnections();await closed;
    }
    await Promise.all([...jobs]);await rm(temp,{recursive:true,force:true});
    assert.deepEqual(errors,[]);
  });
  await build('.',out);
  const files=(await readdir(out,{recursive:true})).filter(p=>p!== 'js' && p!=='assets').sort();
  const {pack}=await readRoutePack('.');
  return {temp,out,files,pack,cleanup,serve:async()=>{
    const types={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript',
      '.css':'text/css','.json':'application/json','.gpx':'application/xml'};
    server=createServer((req,res)=>{
      const job=(async()=>{
        const url=new URL(req.url,'http://localhost'),path=url.pathname.slice('/kotr27/'.length)||'index.html';
        if(!url.pathname.startsWith('/kotr27/')||!files.includes(path)||!types[extname(path)])
          return res.writeHead(404).end();
        // Actual artifact bytes, including browser-public config (never logged).
        res.writeHead(200,{'Content-Type':types[extname(path)],'Cache-Control':'max-age=600'})
          .end(await readFile(join(out,path)));
      })().catch(error=>{errors.push(error.message);res.destroy();}).finally(()=>jobs.delete(job));
      jobs.add(job);
    });
    server.listen(0,'127.0.0.1');await once(server,'listening');
    return `http://127.0.0.1:${server.address().port}/kotr27/`;
  }};
}

test('final public artifact: independent build bytes, all seven revisions, hashes, closure and privacy boundary',async t=>{
  const f=await artifact(t),repeat=join(f.temp,'repeat');
  await build('.',repeat);
  assert.deepEqual((await readdir(repeat,{recursive:true})).filter(p=>!['assets','js'].includes(p)).sort(),f.files);
  let bytes=0;
  for(const path of f.files) {
    const data=await readFile(join(f.out,path));bytes+=data.length;
    assert.deepEqual(data,await readFile(join(repeat,path)),path);
    const text=data.toString();
    assert.doesNotMatch(path,/private|recording|\.fit$|fixture|rehearsal|\.git|docs\/|tests\/|tools\//i);
    assert.doesNotMatch(text,/privacy_code=|BEGIN (?:RSA |OPENSSH )?PRIVATE KEY|github_pat_|ghp_[A-Za-z0-9]{30}|sk\.[A-Za-z0-9_-]{20}|OFFLINE REHEARSAL/);
    if(path.includes('/'))assert.ok(path.includes(sha(data).slice(0,24)),`final-byte filename hash: ${path}`);
    if(/\.(?:mjs|js)$/.test(path))for(const [,spec] of text.matchAll(/(?:from\s*|import\s*\(|new URL\()\s*['"](\.[^'"]+)['"]/g)) {
      if(spec==='../'||spec==='./')continue; // Deployment base URL, not an asset import.
      const target=join(dirname(path),spec);
      assert.ok(f.files.includes(target),`${path} → ${spec}`);
    }
  }
  assert.equal(f.pack.catalog.routes.length,7);
  for(const route of f.pack.catalog.routes) {
    assert.equal(route.revisions.length,1);
    const rev=route.revisions[0];
    assert.equal(route.currentRevisionId,rev.id);
    const gpx=await readFile(join(f.out,rev.geometry.path));
    assert.equal(sha(gpx),rev.geometry.sha256);
    assert.doesNotMatch(gpx.toString(),/<(?:time|name|metadata|extensions|wpt|rtept)(?: |>)/);
    assert.ok(rev.downloads.every(d=>d.format!=='fit'||!d.path),'no private original FIT export');
  }
  t.diagnostic(JSON.stringify({files:f.files.length,bytes,release:JSON.parse(await readFile(join(f.out,'offline-release.json'))).release,
    routes:f.pack.catalog.routes.map(r=>({id:r.id,revision:r.currentRevisionId}))}));
});

for(const width of [320,375,1280])test(`final persona ${width}px: packaged no-input journey, resource timings, contrast and keyboard`,async t=>{
  const f=await artifact(t),base=await f.serve(),requests=[];
  const b=await browser({after:fn=>f.cleanup.push(fn)},m=>{
    if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);
  });
  await runPersona(t,width,f,base,requests,b);
});

  // Explicit diagnostic, not run concurrently with the ordinary browser suite.
  // Fixed two fresh browser processes × cold/warm, never "retry until green".
  // Raw trace/profile stays in memory; output only public source/event attribution.
  if(process.env.KOTR_TRACE==='1')test('bounded 320px cold/warm timeline and V8 attribution',async t=>{
    const f=await artifact(t),base=await f.serve();
    const route=f.pack.catalog.routes.find(r=>r.id==='rwgps-57873019');
    const url=`${base}index.html?area=explore&view=briefing&route=${route.id}&rev=${route.currentRevisionId}`;
    const source=raw=>{
      if(!raw)return '';
      try {const u=new URL(raw);return u.origin===new URL(base).origin?u.pathname:'non-app';}
      catch {return String(raw).slice(0,100);}
    };
    const frame=n=>({name:n.callFrame.functionName||'(anonymous)',source:source(n.callFrame.url),
      line:n.callFrame.lineNumber+1});
    function summarize(events,profile) {
      const mains=new Set(events.filter(e=>e.name==='thread_name'&&e.args?.name==='CrRendererMain').map(e=>`${e.pid}:${e.tid}`));
      assert.ok(mains.size,'renderer main thread metadata required for attribution');
      const spans=events.filter(e=>e.ph==='X'&&e.dur>0&&mains.has(`${e.pid}:${e.tid}`));
      // Chromium emits a nested ThreadControllerImpl wrapper for some tasks.
      // Count the outer RunTask only, not the same work twice.
      const tasks=spans.filter(e=>e.name==='RunTask');
      assert.ok(tasks.length,'actual renderer task durations required');
      const nodes=new Map(profile.nodes.map(n=>[n.id,n])),parents=new Map();
      for(const n of profile.nodes)for(const child of n.children??[])parents.set(child,n.id);
      const samples=[];let ts=profile.startTime;
      for(let i=0;i<(profile.samples??[]).length;i++) {
        const delta=profile.timeDeltas[i];ts+=delta;
        samples.push({ts,delta,node:profile.samples[i]});
      }
      assert.ok(samples.length,'V8 samples required, not an empty successful profile');
      function sampled(begin,end) {
        const self=new Map(),app=new Map();
        for(const s of samples) {
          const ms=Math.max(0,Math.min(s.ts,end)-Math.max(s.ts-s.delta,begin))/1000;
          if(!ms)continue;
          self.set(s.node,(self.get(s.node)||0)+ms);
          let id=s.node;
          while(id) {
            const n=nodes.get(id);
            if(n.callFrame.url.startsWith(base)) {
              app.set(id,(app.get(id)||0)+ms);break;
            }
            id=parents.get(id);
          }
        }
        const top=m=>[...m].sort((a,b)=>b[1]-a[1]).slice(0,8)
          .map(([id,ms])=>({...frame(nodes.get(id)),sampledMs:+ms.toFixed(3)}));
        return {self:top(self),nearestApp:top(app)};
      }
      const span=e=>({event:e.name,wallMs:+(e.dur/1000).toFixed(3),
        threadMs:e.tdur===undefined?null:+(e.tdur/1000).toFixed(3),
        source:source(e.args?.data?.url||e.args?.fileName||e.args?.data?.scriptName),
        function:e.args?.data?.functionName||''});
      const largest=tasks.toSorted((a,b)=>b.dur-a.dur).slice(0,5).map(task=>({
        ...span(task),
        events:spans.filter(e=>e!==task&&e.pid===task.pid&&e.tid===task.tid&&e.ts>=task.ts&&e.ts<task.ts+task.dur)
          .sort((a,b)=>b.dur-a.dur).slice(0,12).map(span),
        samples:sampled(task.ts,task.ts+task.dur),
      }));
      const mainEvents=spans.filter(e=>!/RunTask$/.test(e.name)).sort((a,b)=>b.dur-a.dur).slice(0,12).map(span);
      return {events:events.length,samples:samples.length,rendererTasks:tasks.length,
        tasksOver50ms:tasks.filter(e=>e.dur>=50000).length,largest,mainEvents,
        sampledTotal:sampled(profile.startTime,profile.endTime)};
    }
    for(let run=1;run<=2;run++) {
      const closes=[],requests=[];let events=[],completed;
      try {
        const b=await browser({after:fn=>closes.push(fn)},m=>{
          if(m.method==='Tracing.dataCollected')events.push(...m.params.value);
          if(m.method==='Tracing.tracingComplete')completed?.resolve();
          if(m.method==='Network.requestWillBeSent')requests.push(m.params.request.url);
        });
        await b.cmd('Page.enable');await b.cmd('Network.enable');
        await b.cmd('Network.setBlockedURLs',{urls:['https://*']});
        await b.cmd('Emulation.setDeviceMetricsOverride',{width:320,height:850,deviceScaleFactor:1,mobile:true});
        await b.cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
        await b.cmd('Profiler.enable');await b.cmd('Profiler.setSamplingInterval',{interval:1000});
        await b.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
          window.qualificationLongTasks=[];
          new PerformanceObserver(list=>qualificationLongTasks.push(...list.getEntries().map(e=>({
            start:e.startTime,ms:e.duration,attribution:e.attribution.map(a=>a.name)}))))
            .observe({type:'longtask',buffered:true});
          const observer=new MutationObserver(()=>{
            if(document.querySelector('#trip-planner')?.dataset.ready==='true' &&
               document.querySelector('#briefing-position')?.textContent) {
              window.qualificationReady=performance.now();performance.mark('qualification-ready');observer.disconnect();
            }
          });observer.observe(document,{childList:true,subtree:true,attributes:true});`});
        for(const state of ['cold','warm']) {
          events=[];completed=Promise.withResolvers();
          const host={loadavg:loadavg(),logicalCPUs:cpus().length};
          await b.cmd('Tracing.start',{categories:'toplevel,devtools.timeline,v8,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack',
            transferMode:'ReportEvents'});
          await b.cmd('Profiler.start');
          if(state==='cold')await b.cmd('Page.navigate',{url});else await b.cmd('Page.reload');
          await until(()=>b.js(`!!window.qualificationReady`));
          // Drain observer deliveries and include final layout/paint, fixed window.
          await sleep(250);
          const metrics=await b.js(`({readyMs:qualificationReady,longTasks:qualificationLongTasks,
            resources:performance.getEntriesByType('resource').length,
            transferBytes:performance.getEntriesByType('resource').reduce((s,r)=>s+r.transferSize,0)})`);
          const {profile}=await b.cmd('Profiler.stop');
          await b.cmd('Tracing.end');await completed.promise;
          assert.deepEqual(requests.filter(u=>new URL(u).origin!==new URL(base).origin),[]);
          assert.deepEqual(b.exceptions,[]);
          t.diagnostic(JSON.stringify({run,state,host,metrics,trace:summarize(events,profile)}));
        }
      } finally {for(const close of closes)await close();}
    }
  });
async function runPersona(t,width,f,base,requests,b) {
  const evaluate=async expression=>{
    const r=await b.cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;
  };
  await b.cmd('Page.enable');await b.cmd('Network.enable');
  await b.cmd('Network.setBlockedURLs',{urls:['https://*']});
  await b.cmd('Emulation.setDeviceMetricsOverride',{width,height:850,deviceScaleFactor:1,mobile:width<600});
  await b.cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await b.cmd('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.qualificationLongTasks=[];
    new PerformanceObserver(list=>qualificationLongTasks.push(...list.getEntries().map(e=>({start:e.startTime,ms:e.duration}))))
      .observe({type:'longtask',buffered:true});
    const observer=new MutationObserver(()=>{
      if(document.querySelector('#trip-planner')?.dataset.ready==='true' &&
         document.querySelector('#briefing-position')?.textContent) {
        window.qualificationReady=performance.now();observer.disconnect();
      }
    });observer.observe(document,{childList:true,subtree:true,attributes:true});`});
  const route=f.pack.catalog.routes.find(r=>r.id==='rwgps-57873019');
  const url=`${base}index.html?area=explore&view=briefing&route=${route.id}&rev=${route.currentRevisionId}`;
  const ready=()=>until(()=>b.js(`!!window.qualificationReady`));
  const timings=()=>b.js(`({readyMs:qualificationReady,longTasks:qualificationLongTasks,
    resources:performance.getEntriesByType('resource').length,
    transferBytes:performance.getEntriesByType('resource').reduce((n,r)=>n+r.transferSize,0),
    decodedBytes:performance.getEntriesByType('resource').reduce((n,r)=>n+r.decodedBodySize,0)})`);
  await b.cmd('Page.navigate',{url});await ready();
  assert.ok(await b.js(`PerformanceObserver.supportedEntryTypes.includes('longtask')`));
  const cold=await timings();
  await b.cmd('Page.reload');await ready();
  const warm=await timings();
  const key=async(key,code,n)=>{
    for(const type of ['keyDown','keyUp'])await b.cmd('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:n,
      ...(type==='keyDown'&&key==='Enter'?{text:'\r'}:{})});
  };
  const activate=async selector=>{
    await key('Tab','Tab',9); // Native keyboard modality before checking focus-visible.
    await b.js(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    assert.ok(await b.js(`document.activeElement.matches(':focus-visible')`));
    assert.ok(await b.js(`parseFloat(getComputedStyle(document.activeElement).outlineWidth)>=3`));
    const size=await b.js(`({w:document.activeElement.getBoundingClientRect().width,h:document.activeElement.getBoundingClientRect().height})`);
    assert.ok(size.w>=44&&size.h>=44,`${selector} target ${JSON.stringify(size)}`);
    await key('Enter','Enter',13);
  };
  assert.match(await b.js(`document.getElementById('trip-summary').textContent`),/0 of 4/);
  await activate('#briefing-hardest-jump');
  assert.match(await b.js(`document.getElementById('briefing-position').textContent`),/selected|completed/i);
  const selected=await b.js(`new URL(location.href).searchParams.get('chapter')`);
  await activate('#site-content a[href*="area=prepare"]');
  assert.match(await b.js(`document.body.innerText`),/start anytime|start-anytime/);
  await activate('.site-nav a:nth-child(2)');
  assert.equal(await b.js(`new URL(location.href).searchParams.get('chapter')`),selected);
  assert.equal(await b.js(`new URL(location.href).searchParams.get('route')`),route.id);
  const prefs=f.files.find(p=>p.startsWith('js/preferences-view.'));
  assert.equal(await evaluate(`import('./${prefs}').then(({riderState:s})=>s.snapshot().validation.kind)`),'example');
  // Explicitly selected controls, not a claim that all page elements passed WCAG.
  const contrast=await b.js(`(()=>{
    const rgb=s=>s.match(/[\\d.]+/g).slice(0,3).map(Number);
    const luminance=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4)
      .reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    const ratio=(a,b)=>(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    const body=getComputedStyle(document.body),nav=getComputedStyle(document.querySelector('.site-nav a[aria-current]'));
    return {body:ratio(luminance(rgb(body.color)),luminance(rgb(body.backgroundColor))),
      selectedNav:ratio(luminance(rgb(nav.color)),luminance(rgb(nav.backgroundColor)))};})()`);
  assert.ok(contrast.body>=4.5&&contrast.selectedNav>=4.5);
  assert.ok(await b.js(`document.documentElement.scrollWidth<=innerWidth&&document.getAnimations().length===0`));
  assert.equal(await b.js(`document.querySelectorAll('canvas').length`),0);
  assert.deepEqual(requests.filter(u=>new URL(u).origin!==new URL(base).origin),[]);
  assert.deepEqual(await evaluate('indexedDB.databases()'),[]);
  assert.deepEqual(await evaluate('caches.keys()'),[]);
  assert.deepEqual(await evaluate('navigator.serviceWorker.getRegistrations().then(r=>r.map(x=>x.scope))'),[]);
  assert.ok(await b.js(`localStorage.length===0&&sessionStorage.length===0&&!document.cookie`));
  assert.deepEqual(b.exceptions,[]);
  t.diagnostic(JSON.stringify({width,browser:await b.cmd('Browser.getVersion'),cold,warm,contrast,
    note:'Unthrottled native desktop Chrome; CSS viewport only, not physical phone certification. Long tasks >=50ms are reported, not hidden.'}));
}
