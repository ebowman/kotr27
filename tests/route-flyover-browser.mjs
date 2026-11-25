// Native installed Chrome, real pinned Mapbox 2.15 WebGL, synthetic provider
// rasters. Never an authenticated provider/geographic-DEM qualification.
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp,readdir,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,extname } from 'node:path';
import { crc32,deflateSync } from 'node:zlib';
import { build } from '../tools/build-release.mjs';
import { readRoutePack } from '../tools/route-pack.mjs';
import { browser,until } from './browser.mjs';

function png(rgb) {
  const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;};
  const chunk=(type,data)=>{
    const b=Buffer.concat([Buffer.from(type),data]);return Buffer.concat([u32(data.length),b,u32(crc32(b))]);
  };
  const row=Buffer.concat([Buffer.alloc(1),Buffer.alloc(256*3,Buffer.from(rgb))]);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),
    chunk('IHDR',Buffer.from('00000100000001000802000000','hex')),
    chunk('IDAT',deflateSync(Buffer.concat(Array(256).fill(row)))),chunk('IEND',Buffer.alloc(0))]);
}
const instrumentation=`
window.nativeFrames=[];
mapboxgl.Map=class extends mapboxgl.Map {
  constructor(options) {
    const height=window.fixtureHeight ?? 100;
    super({...options,testMode:true,style:{version:8,sources:{
      satellite:{type:'raster',tiles:[location.origin+'/kotr27/fixture/sat/{z}/{x}/{y}'],tileSize:256,maxzoom:12},
      dem:{type:'raster-dem',tiles:[location.origin+'/kotr27/fixture/dem/'+height+'/{z}/{x}/{y}'],tileSize:256,maxzoom:11}
    },layers:[{id:'satellite',type:'raster',source:'satellite',paint:{'raster-fade-duration':0}}]}});
    window.nativeMap=this;
    this.on('render',()=>{
      const canvas=this.getCanvas(),gl=this.painter.context.gl;
      const pixels=new Uint8Array(canvas.width*canvas.height*4);
      gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
      let green=0,orange=0,opaque=0;
      for(let i=0;i<pixels.length;i+=16) {
        if(pixels[i+3]>245)opaque++;
        if(Math.abs(pixels[i]-40)<8 && Math.abs(pixels[i+1]-130)<8)green++;
        if(pixels[i]>230 && pixels[i+1]>110 && pixels[i+1]<170 && pixels[i+2]<80)orange++;
      }
      window.nativeFrames.push({green,orange,opaque,total:pixels.length/16});
      if(window.nativeFrames.length>16)window.nativeFrames.shift();
    });
  }
};`;

async function fixture(t,{real=false,headless=true}={}) {
  const temp=await mkdtemp(join(tmpdir(),'kotr-flyover-')),out=join(temp,'public');
  const cleanups=[],jobs=new Set(),errors=[],network=[],lifecycle=[];
  let server;
  t.after(async()=>{
    for(const close of cleanups)await close();
    if(server?.listening) {
      const closed=new Promise(resolve=>server.close(resolve));server.closeAllConnections();await closed;
    }
    await Promise.all([...jobs]);await rm(temp,{recursive:true,force:true});
    assert.deepEqual(errors,[]);
  });
  await build('.',out);
  const {pack}=await readRoutePack('.'),files=await readdir(out,{recursive:true});
  let sdk,css;
  if(real) {
    const js=process.env.MAPBOX_GL_215 ? await readFile(process.env.MAPBOX_GL_215,'utf8') :
      await fetch('https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.js').then(r=>{assert.equal(r.status,200);return r.text();});
    sdk=js+instrumentation;
    css=await fetch('https://api.mapbox.com/mapbox-gl-js/v2.15.0/mapbox-gl.css').then(r=>{assert.equal(r.status,200);return r.text();});
  }
  const types={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.json':'application/json','.gpx':'application/xml'};
  async function serve(req,res) {
    const path=new URL(req.url,'http://localhost').pathname.slice('/kotr27/'.length)||'index.html';
    if(path.startsWith('fixture/')) {
      const h=Number(path.split('/')[2]),v=Math.round((h+10000)*10);
      const tile=path.startsWith('fixture/dem/') ? png([v>>16,(v>>8)&255,v&255]) : png([40,130,80]);
      return res.writeHead(200,{'Content-Type':'image/png'}).end(tile);
    }
    if(!files.includes(path) || !types[extname(path)])return res.writeHead(404).end();
    const data=path.startsWith('js/config.') ? "window.KOTR_CONFIG={MAPBOX_TOKEN:'pk.fixture'};" : await readFile(join(out,path));
    res.writeHead(200,{'Content-Type':types[extname(path)],'Cache-Control':'no-store'}).end(data);
  }
  server=createServer((req,res)=>{
    const job=serve(req,res).catch(e=>{errors.push(String(e));res.destroy();}).finally(()=>jobs.delete(job));jobs.add(job);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const b=await browser({after:fn=>cleanups.push(fn)},(m,cmd)=>{
    if(m.method==='Network.requestWillBeSent')network.push(m.params.request.url);
    if(m.method==='Page.lifecycleEvent')lifecycle.push(m.params);
    if(m.method==='Fetch.requestPaused') {
      const p=m.params,url=p.request.url;
      const body=url.endsWith('mapbox-gl.js') ? sdk : url.endsWith('mapbox-gl.css') ? css : '';
      const job=(real && body ? cmd('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:200,
        responseHeaders:[{name:'Content-Type',value:url.endsWith('.css') ? 'text/css' : 'text/javascript'}],
        body:Buffer.from(body).toString('base64')}) :
        cmd('Fetch.failRequest',{requestId:p.requestId,errorReason:'BlockedByClient'}))
        .catch(e=>errors.push(String(e))).finally(()=>jobs.delete(job));jobs.add(job);
    }
  },{headless});
  await b.cmd('Page.enable');await b.cmd('Network.enable');
  await b.cmd('Page.setLifecycleEventsEnabled',{enabled:true});
  await b.cmd('Fetch.enable',{patterns:[{urlPattern:'https://*'}]});
  const base=`http://127.0.0.1:${server.address().port}/kotr27/`;
  const session=files.find(f=>f.startsWith('js/route-session.')),shell=files.find(f=>f.startsWith('js/site-shell.'));
  const evaluate=async expression=>{
    const r=await b.cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
    assert.ok(!r.exceptionDetails,JSON.stringify(r.exceptionDetails));return r.result.value;
  };
  const command=(name,...args)=>evaluate(`import('./${session}').then(m=>m.routePlayback.${name}(...${JSON.stringify(args)}))`);
  async function navigate(r) {
    const url=base+`explore.html?area=explore&view=flyover&route=${r.id}&rev=${r.currentRevisionId}`;
    const nav=await b.cmd('Page.navigate',{url});
    // Wait the destination loader's DOMContentLoaded, not an evaluation racing
    // the expected replacement of the old CDP execution context.
    await until(()=>lifecycle.some(e=>e.loaderId===nav.loaderId && e.name==='DOMContentLoaded'));
    await until(()=>b.js(`!document.getElementById('route-flyover')?.hidden && !!document.getElementById('flyover-seek') &&
      document.getElementById('trip-planner')?.dataset.ready==='true'`));
  }
  return {...b,base,pack,files,network,navigate,evaluate,command,
    snapshot:()=>command('getSnapshot'),
    select:r=>evaluate(`import('./${shell}').then(m=>m.navigateSelection({area:'explore',view:'flyover',routeId:'${r.id}',revisionId:'${r.currentRevisionId}',dayId:null,variantId:null}))`),
  };
}

test('native Chrome packaged controls: all seven, reduced motion, rapid cameras, denied SDK, exact times',async t=>{
  const f=await fixture(t);
  await f.cmd('Emulation.setDeviceMetricsOverride',{width:375,height:850,deviceScaleFactor:1,mobile:true});
  await f.cmd('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  await f.navigate(f.pack.catalog.routes[0]);
  t.diagnostic(JSON.stringify(await f.cmd('Browser.getVersion')));
  for(const r of f.pack.catalog.routes) {
    await f.select(r);
    await until(async()=>(await f.snapshot()).identity?.routeId===r.id);
    await f.command('seekDistance',(await f.snapshot()).totalDistanceM/2);
    const before=await f.snapshot();
    for(const mode of ['follow','overview','side','cinematic','side','overview']) {
      await f.js(`document.getElementById('flyover-${mode}').click()`);
      const after=await f.snapshot();
      for(const key of ['distanceM','position','estimatedRide','recordedClock'])assert.deepEqual(after[key],before[key]);
      assert.equal(after.cameraMode,mode);
    }
    if(r.name.startsWith('D4S'))assert.equal(before.estimatedRide.status,'unavailable');
    assert.ok(await f.js(`document.documentElement.scrollWidth<=innerWidth`));
    assert.equal(await f.js(`document.querySelectorAll('#route-flyover canvas').length`),0);
  }
  assert.ok(!f.network.some(u=>u.startsWith('https:')),'zero provider requests before opt-in');
  await f.js(`document.getElementById('route-flyover').focus()`);
  await f.cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'3',code:'Digit3',windowsVirtualKeyCode:51,text:'3'});
  assert.equal((await f.snapshot()).cameraMode,'side');
  const touch=await f.js(`(()=>{
    const b=document.getElementById('flyover-cinematic');b.scrollIntoView({block:'center'});
    const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};
  })()`);
  await f.cmd('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});
  await f.cmd('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await until(async()=>(await f.snapshot()).cameraMode==='cinematic');
  await f.js(`document.getElementById('flyover-seek').focus()`);
  await f.cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
  const before=await f.snapshot();
  await f.js(`document.getElementById('flyover-enable').click()`);
  await until(()=>f.js(`document.getElementById('route-flyover').dataset.status==='unavailable'`));
  assert.equal((await f.snapshot()).distanceM,before.distanceM);
  assert.equal((await f.snapshot()).renderer.enabled,false);
  assert.ok(await f.js(`!document.getElementById('route-briefing').hidden`));
  assert.equal(await f.js(`document.querySelectorAll('#route-flyover canvas').length`),0);
  assert.deepEqual(f.exceptions,[]);
});

// Read-only bounded diagnostics: no visibility override, synthetic map input,
// animation suppression or application readiness changes.
async function installPointerProbe(f) {
  await f.js(`(()=>{
    window.pointerProbe?.dispose();
    const canvas=nativeMap.getCanvas(),container=document.getElementById('official-terrain');
    const describe=e=>e?{tag:e.tagName,id:e.id,classes:typeof e.className==='string'?e.className:''}:null;
    const box=r=>({x:r.x,y:r.y,width:r.width,height:r.height});
    const rect=e=>box(e.getBoundingClientRect());
    const history=[],events=[],shifts=[],updates=[],focus=[];let frame,scrollAt=null,renderAt=null,previous;
    const push=(list,value)=>{list.push(value);if(list.length>16)list.shift();};
    const sample=(point=null)=>{
      const r=rect(canvas),p=point??{x:r.x+r.width*.4,y:r.y+r.height*.4},style=getComputedStyle(canvas);
      return {at:performance.now(),point:p,rect:r,hit:describe(document.elementFromPoint(p.x,p.y)),
        hitCanvas:document.elementFromPoint(p.x,p.y)===canvas,
        scroll:{x:scrollX,y:scrollY,lastAt:scrollAt},viewport:{width:innerWidth,height:innerHeight,
          visual:visualViewport?{x:visualViewport.offsetLeft,y:visualViewport.offsetTop,width:visualViewport.width,
            height:visualViewport.height,scale:visualViewport.scale}:null},
        focused:document.hasFocus(),canvas:{connected:canvas.isConnected,visibility:style.visibility,display:style.display,
          pointerEvents:style.pointerEvents,opacity:style.opacity},
        containerVisibility:getComputedStyle(container).visibility,
        render:{at:renderAt,status:document.getElementById('route-flyover').dataset.status,
          proof:container.dataset.frame?JSON.parse(container.dataset.frame):null,moving:nativeMap.isMoving()}};
    };
    const scroll=()=>{scrollAt=performance.now();},render=()=>{renderAt=performance.now();};
    const focused=e=>push(focus,{at:performance.now(),type:e.type,trusted:e.isTrusted,target:describe(e.target)});
    window.addEventListener('focus',focused);window.addEventListener('blur',focused);
    const input=e=>push(events,{at:performance.now(),type:e.type,trusted:e.isTrusted,
      buttons:e.buttons,x:e.clientX,y:e.clientY,target:describe(e.target),state:sample({x:e.clientX,y:e.clientY})});
    const jump=nativeMap.jumpTo;
    nativeMap.jumpTo=function(...args){push(updates,{at:performance.now(),stack:new Error().stack});return jump.apply(this,args);};
    const mutations=new MutationObserver(()=>push(history,sample()));
    mutations.observe(container,{attributes:true,attributeFilter:['style','data-frame']});
    document.addEventListener('scroll',scroll,true);nativeMap.on('render',render);
    for(const type of ['mousedown','mousemove','mouseup'])document.addEventListener(type,input,true);
    const observer=new PerformanceObserver(list=>{
      for(const entry of list.getEntries())push(shifts,{at:entry.startTime,value:entry.value,
        sources:(entry.sources??[]).slice(0,3).map(s=>({node:describe(s.node),previous:box(s.previousRect),current:box(s.currentRect)}))});
    });observer.observe({type:'layout-shift',buffered:false});
    function tick() {
      const s=sample(),key=JSON.stringify([s.rect,s.hit,s.scroll.x,s.scroll.y,s.containerVisibility,s.render.status,s.render.proof]);
      if(key!==previous){push(history,s);previous=key;}frame=requestAnimationFrame(tick);
    }
    window.pointerProbe={sample,history,events,shifts,updates,focus,dispose(){
      cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('scroll',scroll,true);
      mutations.disconnect();nativeMap.jumpTo=jump;
      window.removeEventListener('focus',focused);window.removeEventListener('blur',focused);
      nativeMap.off('render',render);
      for(const type of ['mousedown','mousemove','mouseup'])document.removeEventListener(type,input,true);
    }};tick();
  })()`);
}

async function stableCanvas(f) {
  const result=await f.evaluate(`new Promise(resolve=>{
    let previous=null,frame;
    const deadline=setTimeout(()=>{cancelAnimationFrame(frame);resolve({error:'Canvas did not become stably hittable',last:pointerProbe.sample()});},5000);
    function check() {
      const s=pointerProbe.sample();
      const ready=s.hitCanvas && s.canvas.connected && s.canvas.visibility==='visible' &&
        s.containerVisibility==='visible' && s.render.status==='ready' && s.render.proof?.ok && !s.render.moving;
      const key=ready?JSON.stringify([s.rect,s.scroll.x,s.scroll.y,s.viewport]):null;
      if(key!==null && key===previous) {clearTimeout(deadline);resolve(s);return;}
      if(s.render.status==='unavailable') {clearTimeout(deadline);resolve({error:'Terrain unavailable',last:s});return;}
      previous=key;frame=requestAnimationFrame(check);
    }
    frame=requestAnimationFrame(check);
  })`);
  assert.ok(!result.error,JSON.stringify(result));
  return result;
}

async function nativeDrag(f,t) {
  await installPointerProbe(f);
  try {
    await f.js(`nativeMap.getCanvas().scrollIntoView({block:'center',behavior:'instant'})`);
    const hover=await stableCanvas(f);
    // Native hover can focus the page, causing local-library reconciliation →
    // shell render → terrain revalidation/hiding. Two RAFs BEFORE that input
    // cannot establish readiness AFTER it. Never retry a failed press/gesture.
    await f.cmd('Input.dispatchMouseEvent',{type:'mouseMoved',...hover.point,button:'none',buttons:0});
    const hit=await stableCanvas(f),drag=hit.point;
    assert.equal(hit.hitCanvas,true,'Native press requires a visible, verified, stable canvas hit.');
    await f.cmd('Input.dispatchMouseEvent',{type:'mousePressed',...drag,button:'left',buttons:1,clickCount:1});
    try {
      const press=await f.js(`pointerProbe.events.find(e=>e.type==='mousedown')`);
      assert.ok(press?.trusted && press.buttons===1 && press.target.tag==='CANVAS' &&
        press.state.hitCanvas && press.state.containerVisibility==='visible',
      `The single native press must actually reach the visible canvas: ${JSON.stringify(press)}`);
      await f.cmd('Input.dispatchMouseEvent',{type:'mouseMoved',x:drag.x+20,y:drag.y+20,button:'left',buttons:1});
      await until(()=>f.js(`document.getElementById('flyover-orientation').textContent.includes('Manual')`));
    } finally {
      await f.cmd('Input.dispatchMouseEvent',{type:'mouseReleased',x:drag.x+20,y:drag.y+20,button:'left',buttons:0,clickCount:1});
    }
    await until(()=>f.js('!nativeMap.isMoving()'));
    assert.match(await f.js(`document.getElementById('flyover-orientation').textContent`),/Manual/);
    const evidence=await f.js(`({events:pointerProbe.events,focus:pointerProbe.focus,updates:pointerProbe.updates})`);
    const focusRefresh=evidence.updates.find(e=>e.stack.includes('local-routes-view'));
    if(focusRefresh)t.diagnostic(`Native hover focus-refresh settled before single trusted canvas press: ${JSON.stringify({
      focus:evidence.focus,refreshAt:focusRefresh.at,readyAt:hit.at,
      events:evidence.events.map(e=>({at:e.at,type:e.type,trusted:e.trusted,buttons:e.buttons,target:e.target,
        visibility:e.state.containerVisibility})),
    })}`);
  } catch(error) {
    t.diagnostic(`Native drag failure: ${JSON.stringify(await f.js(`({
      current:pointerProbe.sample(),history:pointerProbe.history,events:pointerProbe.events,
      shifts:pointerProbe.shifts,updates:pointerProbe.updates,focus:pointerProbe.focus})`))}`);
    throw error;
  } finally { await f.js('pointerProbe.dispose()'); }
}

async function nativeClick(f,id) {
  await f.evaluate(`new Promise(resolve=>{
    document.getElementById(${JSON.stringify(id)}).scrollIntoView({block:'center'});
    requestAnimationFrame(()=>requestAnimationFrame(resolve));
  })`);
  const point=await f.js(`(()=>{
    const r=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();
    return {x:r.x+r.width/2,y:r.y+r.height/2};
  })()`);
  assert.equal(await f.js(`document.elementFromPoint(${point.x},${point.y})?.id`),id);
  await f.cmd('Input.dispatchMouseEvent',{type:'mouseMoved',...point,button:'none',buttons:0});
  for(const type of ['mousePressed','mouseReleased'])
    await f.cmd('Input.dispatchMouseEvent',{type,...point,button:'left',buttons:type==='mousePressed' ? 1 : 0,clickCount:1});
}

test('native drag readiness rejects the old hit point during an actual focus-refresh frame gate', {timeout:120000},async t=>{
  const f=await fixture(t,{real:true});
  await f.cmd('Emulation.setDeviceMetricsOverride',{width:800,height:900,deviceScaleFactor:1,mobile:false});
  await f.navigate(f.pack.catalog.routes.find(r=>r.name.startsWith('D1')));
  await f.command('seekDistance',(await f.snapshot()).totalDistanceM*.5);
  await f.js(`window.fixtureHeight=${(await f.snapshot()).position.rawElevationM}`);
  await f.js(`document.getElementById('flyover-enable').click()`);
  await until(()=>f.js(`document.getElementById('official-terrain').style.visibility==='visible'`));
  const before=await f.snapshot();
  await installPointerProbe(f);
  await f.evaluate(`new Promise(resolve=>{
    nativeMap.getCanvas().scrollIntoView({block:'center'});
    requestAnimationFrame(()=>requestAnimationFrame(resolve));
  })`);
  const old=await stableCanvas(f);
  // Deterministic notification control, NOT a synthetic drag: exercise the
  // real async focus/storage reconciliation and renderer's safety gate.
  // Observe its hidden interval in a microtask, regardless of render speed.
  const negative=await f.evaluate(`new Promise((resolve,reject)=>{
    const container=document.getElementById('official-terrain');
    const observer=new MutationObserver(()=>{
      if(getComputedStyle(container).visibility!=='hidden')return;
      const hit=pointerProbe.sample(${JSON.stringify(old.point)});
      observer.disconnect();clearTimeout(deadline);resolve(hit);
    });
    const deadline=setTimeout(()=>{observer.disconnect();reject(Error('Focus refresh did not exercise the frame gate'));},5000);
    observer.observe(container,{attributes:true,attributeFilter:['style']});
    window.dispatchEvent(new Event('focus'));
  })`);
  assert.equal(old.hitCanvas,true);
  assert.equal(negative.hitCanvas,false,'Old separate hit check must reject a now-hidden canvas.');
  assert.equal(negative.hit.id,'flyover-viewport');
  assert.equal(negative.containerVisibility,'hidden');
  assert.deepEqual(negative.rect,old.rect,'The demonstrated race is frame visibility, not stale geometry.');
  assert.equal(negative.scroll.y,old.scroll.y);
  assert.equal(negative.render.status,'ready','A stale ready label alone cannot authorize native input.');
  const updates=await f.js('pointerProbe.updates');
  assert.ok(updates.some(e=>e.stack.includes('local-routes-view') && e.stack.includes('route-terrain-view')));
  assert.equal(await f.js('pointerProbe.events.length'),0,'No mouse input before the actual canvas is hittable.');
  t.diagnostic(`Negative control: ${JSON.stringify({before:old,hidden:negative,source:updates[0].stack})}`);
  await nativeDrag(f,t);
  const after=await f.snapshot();
  for(const key of ['distanceM','position','estimatedRide','recordedClock'])assert.deepEqual(after[key],before[key]);
  assert.deepEqual(f.exceptions,[]);
});

test('native same-preset reselection and refinements reconcile manual UI with the actual camera', {timeout:120000},async t=>{
  const f=await fixture(t,{real:true});
  await f.cmd('Emulation.setDeviceMetricsOverride',{width:800,height:900,deviceScaleFactor:1,mobile:false});
  const route=f.pack.catalog.routes.find(r=>r.name.startsWith('D1'));
  await f.navigate(route);
  await f.command('seekDistance',(await f.snapshot()).totalDistanceM*.5);
  await f.js(`window.fixtureHeight=${(await f.snapshot()).position.rawElevationM}`);
  await nativeClick(f,'flyover-enable');
  const painted=()=>until(()=>f.js(`document.getElementById('official-terrain').style.visibility==='visible' &&
    document.getElementById('route-flyover').dataset.status==='ready' && !nativeMap.isMoving()`));
  await painted();
  const camera=()=>f.js(`({lng:nativeMap.getCenter().lng,lat:nativeMap.getCenter().lat,
    pitch:nativeMap.getPitch(),zoom:nativeMap.getZoom(),bearing:nativeMap.getBearing()})`);
  const sameCamera=(actual,expected)=>{
    // Terrain-adjusted fitBounds can vary by a few millionths of a zoom level.
    // 1e-4 zoom is <0.06 px across this viewport; route/model equality below is exact.
    for(const key of Object.keys(expected))assert.ok(Math.abs(actual[key]-expected[key])<(key==='zoom' ? 1e-4 : 1e-6),
      `${key}: expected ${expected[key]}, actual ${actual[key]}`);
  };
  async function assertTracking(mode,before) {
    await painted();
    const after=await f.snapshot();
    for(const key of ['distanceM','position','estimatedRide','recordedClock'])assert.deepEqual(after[key],before[key]);
    assert.equal(after.cameraMode,mode);
    assert.equal(after.phase,'paused');
    assert.equal(await f.js(`document.getElementById('flyover-${mode}').getAttribute('aria-pressed')`),'true');
    assert.doesNotMatch(await f.js(`document.getElementById('flyover-orientation').textContent`),/Manual/);
    assert.doesNotMatch(await f.js(`document.getElementById('flyover-status').textContent`),/Manual/);
    assert.equal(await f.js(`JSON.parse(document.getElementById('official-terrain').dataset.frame).ok`),true);
  }
  for(const mode of ['follow','overview','side','cinematic']) {
    await nativeClick(f,`flyover-${mode}`);await painted();
    const expected=await camera(),before=await f.snapshot();
    await nativeDrag(f,t);
    const dragged=await camera();
    assert.ok(Math.hypot(dragged.lng-expected.lng,dragged.lat-expected.lat)>1e-6,'native drag actually moved the camera');
    assert.equal(await f.js(`document.getElementById('flyover-${mode}').getAttribute('aria-pressed')`),'false');
    await nativeClick(f,`flyover-${mode}`);await painted();
    sameCamera(await camera(),expected);
    await assertTracking(mode,before);
    t.diagnostic(`${mode}: trusted drag → same preset restored actual camera and all shared projections.`);
  }
  await nativeClick(f,'flyover-follow');await painted();
  await f.js(`document.querySelector('#route-flyover details').open=true`);
  for(const [key,value] of [['pitch',40],['zoom',12]]) {
    const before=await f.snapshot();
    await nativeDrag(f,t);
    await f.js(`(()=>{
      const input=document.getElementById('flyover-${key}');input.value=${value};
      input.dispatchEvent(new Event('input',{bubbles:true}));
    })()`);
    await assertTracking('follow',before);
    const actual=await camera();
    assert.ok(Math.abs(actual.lng-before.position.lon)<1e-6 && Math.abs(actual.lat-before.position.lat)<1e-6);
    assert.ok(Math.abs(actual[key]-value)<1e-6);
  }
  await nativeClick(f,'flyover-side');await painted();
  const beforeSide=await f.snapshot(),bearing=(await camera()).bearing;
  await nativeDrag(f,t);
  await nativeClick(f,'flyover-swap-side');
  await assertTracking('side',beforeSide);
  assert.ok(Math.abs(Math.abs((await camera()).bearing-bearing)-180)<1e-6);
  await nativeDrag(f,t);
  await nativeClick(f,'flyover-return');
  await assertTracking('follow',beforeSide);
  // Reset is also an explicit reframe when distance and mode are already zero/Follow.
  await nativeClick(f,'flyover-reset');await painted();
  const start=await f.snapshot();
  await nativeDrag(f,t);
  await nativeClick(f,'flyover-reset');
  await assertTracking('follow',start);
  const resetCamera=await camera();
  assert.ok(Math.abs(resetCamera.lng-start.position.lon)<1e-6 && Math.abs(resetCamera.lat-start.position.lat)<1e-6);
  assert.equal(await f.js(`document.getElementById('flyover-pitch').value`),'45');
  assert.equal(await f.js(`document.getElementById('flyover-zoom').value`),'12.6');
  assert.deepEqual(f.exceptions,[]);
});

test('native Chrome real WebGL: cold steep/bendy/long route frames, manual, context-loss fallback', {timeout:120000},async t=>{
  const f=await fixture(t,{real:true});
  await f.cmd('Emulation.setDeviceMetricsOverride',{width:800,height:900,deviceScaleFactor:1,mobile:false});
  for(const prefix of ['D1','D3L','D4L']) {
    const r=f.pack.catalog.routes.find(r=>r.name.startsWith(prefix));
    await f.navigate(r);
    await f.command('seekDistance',(await f.snapshot()).totalDistanceM*.5);
    await f.js(`window.fixtureHeight=${(await f.snapshot()).position.rawElevationM}`);
    await f.js(`document.getElementById('flyover-enable').click()`);
    await until(()=>f.js(`document.getElementById('route-flyover').dataset.status==='ready' ||
      document.getElementById('route-flyover').dataset.status==='unavailable'`));
    assert.equal(await f.js(`document.getElementById('route-flyover').dataset.status`),'ready',
      await f.js(`document.getElementById('flyover-status').textContent`));
    const before=await f.snapshot();
    for(const mode of ['follow','overview','side','cinematic']) {
      await f.js(`document.getElementById('flyover-${mode}').click()`);
      await until(()=>f.js(`document.getElementById('official-terrain').style.visibility==='visible' ||
        document.getElementById('route-flyover').dataset.status==='unavailable'`));
      assert.equal(await f.js(`document.getElementById('route-flyover').dataset.status`),'ready',
        await f.js(`JSON.stringify({text:document.getElementById('flyover-status').textContent,frame:document.getElementById('official-terrain').dataset.frame,requests:document.getElementById('official-terrain').dataset.requests})`));
      const proof=await f.js(`JSON.parse(document.getElementById('official-terrain').dataset.frame)`);
      assert.equal(proof.ok,true);
      const pixels=await f.js(`nativeFrames.at(-1)`);
      assert.ok(pixels.green>pixels.total*.7 && pixels.orange>0,JSON.stringify(pixels));
      assert.deepEqual((await f.snapshot()).position,before.position);
      assert.deepEqual((await f.snapshot()).estimatedRide,before.estimatedRide);
      t.diagnostic(`${prefix} ${mode}: ${JSON.stringify({proof,pixels})}`);
    }
    assert.equal(await f.js(`document.querySelectorAll('#route-flyover canvas').length`),1);
    await nativeDrag(f,t);
    await f.js(`document.getElementById('flyover-return').click()`);
    assert.equal((await f.snapshot()).cameraMode,'follow');
    if(prefix==='D4L') {
      await f.command('setCameraMode','cinematic');
      await f.command('play',{preserveCamera:true});
      await until(async()=>(await f.snapshot()).distanceM>before.distanceM+10);
      assert.equal((await f.snapshot()).cameraMode,'cinematic');
      t.diagnostic('Native cinematic playback advances the shared position and retains its camera job.');
      await f.command('pause');
      await f.command('seekDistance',before.distanceM);
      const {targetId}=await f.cmd('Target.createTarget',{url:'about:blank'});
      await f.cmd('Target.activateTarget',{targetId});
      await until(()=>f.js('document.hidden'));
      assert.equal(await f.js(`document.querySelectorAll('#route-flyover canvas').length`),0);
      assert.equal((await f.snapshot()).distanceM,before.distanceM);
      t.diagnostic('Native background tab disposes the canvas without changing route distance.');
      await f.cmd('Target.closeTarget',{targetId});
      await until(()=>f.js('!document.hidden'));
      assert.equal(await f.js(`document.querySelectorAll('#route-flyover canvas').length`),0,'no background auto-resume');
      await f.js(`document.getElementById('flyover-enable').click()`);
      await until(()=>f.js(`document.getElementById('route-flyover').dataset.status==='ready'`));
    }
    if(prefix==='D1') await f.js(`nativeMap.queryTerrainElevation=()=>null;nativeMap.triggerRepaint();void 0`);
    else if(prefix==='D3L') await f.js(`nativeMap.unproject=()=>({lng:0,lat:0});nativeMap.triggerRepaint();void 0`);
    else await f.js(`nativeMap.fire('webglcontextlost');void 0`);
    await until(()=>f.js(`document.getElementById('route-flyover').dataset.status==='unavailable'`));
    assert.equal(await f.js(`document.getElementById('route-flyover').dataset.status`),'unavailable');
    assert.equal(await f.js(`document.querySelectorAll('#route-flyover canvas').length`),0);
    assert.equal((await f.snapshot()).distanceM,before.distanceM);
    t.diagnostic(`${prefix}: explicit fallback disposed canvas and preserved distance.`);
  }
  assert.deepEqual(f.exceptions,[]);
});

// Operator-deferred on 2026-11-25: never silently count an unsupported/headless
// outcome as working fullscreen. This opt-in check keeps the real API assertion
// and uses a normal visible Chrome window with the same isolated owned profile.
test('native visible Chrome fullscreen qualification (operator deferred)', {
  skip:process.env.KOTR_FLYOVER_FULLSCREEN==='1' ? false : 'DEFERRED / UNVERIFIED by operator; not a product PASS',
  timeout:60000,
},async t=>{
  const f=await fixture(t,{real:true,headless:false});
  const route=f.pack.catalog.routes.find(r=>r.name.startsWith('D4L'));
  await f.navigate(route);
  await f.cmd('Page.bringToFront');
  const {targetInfo}=await f.cmd('Target.getTargetInfo');
  t.diagnostic(`Visible startup: ${JSON.stringify({version:await f.cmd('Browser.getVersion'),
    window:await f.cmd('Browser.getWindowForTarget',{targetId:targetInfo.targetId})})}`);
  await f.command('seekDistance',(await f.snapshot()).totalDistanceM*.5);
  await f.js(`window.fixtureHeight=${(await f.snapshot()).position.rawElevationM}`);
  await f.js(`document.getElementById('flyover-enable').click()`);
  await until(()=>f.js(`document.getElementById('route-flyover').dataset.status==='ready'`));
  await f.js(`(()=>{
    const root=document.getElementById('route-flyover'),button=document.getElementById('flyover-fullscreen');
    const activation=()=>({isActive:navigator.userActivation.isActive,hasBeenActive:navigator.userActivation.hasBeenActive});
    window.fullscreenProbe={};
    button.addEventListener('click',e=>{
      fullscreenProbe.click={isTrusted:e.isTrusted,target:e.target.id,currentTarget:e.currentTarget.id,
        connected:e.currentTarget.isConnected,activation:activation()};
    },{capture:true,once:true});
    const request=root.requestFullscreen;
    root.requestFullscreen=function(...args) {
      fullscreenProbe.invocation={id:this.id,tag:this.tagName,connected:this.isConnected,
        sameRoot:this===root,activeDocument:this.ownerDocument===document,hidden:document.hidden,
        enabled:document.fullscreenEnabled,activation:activation()};
      try {
        return request.apply(this,args).then(value=>{
          fullscreenProbe.resolved=true;return value;
        },error=>{
          fullscreenProbe.rejected={name:error.name,message:error.message};throw error;
        });
      } catch(error) {
        fullscreenProbe.rejected={name:error.name,message:error.message};throw error;
      }
    };
  })()`);
  const full=await f.js(`(()=>{
    const b=document.getElementById('flyover-fullscreen');b.scrollIntoView({block:'center'});
    const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};
  })()`);
  assert.equal(await f.js(`document.elementFromPoint(${full.x},${full.y})?.id`),'flyover-fullscreen');
  for(const type of ['mousePressed','mouseReleased'])
    await f.cmd('Input.dispatchMouseEvent',{type,...full,button:'left',clickCount:1});
  await until(()=>f.js(`document.fullscreenElement?.id==='route-flyover' ||
    document.getElementById('flyover-status').textContent.includes('Fullscreen unavailable')`));
  const fullscreen=await f.js(`({element:document.fullscreenElement?.id ?? null,probe:fullscreenProbe,
    status:document.getElementById('flyover-status').textContent})`);
  t.diagnostic(`Native fullscreen: ${JSON.stringify(fullscreen)}`);
  t.diagnostic(`Native window: ${JSON.stringify(await f.cmd('Browser.getWindowForTarget',{targetId:targetInfo.targetId}))}`);
  assert.equal(fullscreen.element,'route-flyover','Native fullscreen must actually enter fullscreen, not merely report support.');
  assert.equal(fullscreen.probe.click.isTrusted,true);
  assert.equal(fullscreen.probe.invocation.activation.isActive,true);
  assert.equal(fullscreen.probe.invocation.connected,true);
  await f.evaluate('document.exitFullscreen()');
  assert.deepEqual(f.exceptions,[]);
});
