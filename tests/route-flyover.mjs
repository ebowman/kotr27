import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readRoutePack } from '../tools/route-pack.mjs';
import { createAnalysisStore } from '../js/trip-planner.mjs';
import { createAnalysisPlaybackRoute } from '../js/route-playback-adapters.mjs';
import { createRoutePlayback } from '../js/route-playback.mjs';
import { estimateRouteTime } from '../js/route-time.mjs';
import { cameraJobs, cameraPose, officialFlyover, routeLine, routeBounds, frameEvidence, flyoverLimits } from '../js/route-flyover.mjs';

test('all actual approved routes: camera jobs at start, steepest, bends, middle and finish preserve every shared projection',async()=>{
  const {pack}=await readRoutePack('.');
  const load=createAnalysisStore(pack,path=>readFile(path));
  for (const r of pack.catalog.routes) {
    const a=await load(r.id,r.currentRevisionId), estimate=estimateRouteTime(a);
    const c=createRoutePlayback({loadRoute:()=>createAnalysisPlaybackRoute(a,{estimate})});
    await c.selectRoute({routeId:r.id,revisionId:r.currentRevisionId});
    const steep=a.windows.reduce((p,w)=>Math.abs(w.gradePercent)>Math.abs(p.gradePercent) ? w : p);
    const distances=[0,steep.startM,a.distanceM*.25,a.distanceM*.5,a.distanceM*.9,a.distanceM];
    for (const d of distances) {
      const before=c.seekDistance(d);
      for (const [mode] of cameraJobs) {
        c.seekDistance(d);
        const after=c.setCameraMode(mode), pose=cameraPose(a,after);
        for (const key of ['distanceM','position','estimatedRide','recordedClock']) assert.deepEqual(after[key],before[key]);
        assert.deepEqual(pose.center,[before.position.lon,before.position.lat]);
        assert.ok(Object.values(pose).flat().every(Number.isFinite));
        assert.ok(pose.pitch<=flyoverLimits.maxPitch && pose.zoom<=flyoverLimits.maxZoom);
        assert.equal(c.play({preserveCamera:true}).cameraMode,mode);
        c.pause();
      }
    }
    if (r.name.startsWith('D4S')) assert.equal(c.getSnapshot().estimatedRide.status,'unavailable');
    const line=routeLine(a), bounds=routeBounds(a);
    assert.ok(line.length<=flyoverLimits.vertices);
    assert.deepEqual(line[0],[a.points[0].lon,a.points[0].lat]);
    assert.deepEqual(line.at(-1),[a.points.at(-1).lon,a.points.at(-1).lat]);
    assert.ok(line.every(([x,y])=>x>=bounds[0][0] && x<=bounds[1][0] && y>=bounds[0][1] && y<=bounds[1][1]));
    const resolved={bundle:{route:r,revision:r.revisions[0]},profile:a,state:{area:'explore',view:'flyover'}};
    assert.equal(officialFlyover(resolved),true);
    assert.equal(officialFlyover({...resolved,bundle:{...resolved.bundle,route:{...r,kind:'local'}}}),false);
    assert.equal(officialFlyover({...resolved,profile:{...a,status:'unsupported'}}),false);
    assert.equal(officialFlyover({...resolved,bundle:{...resolved.bundle,revision:{id:'stale'}}}),false);
    assert.throws(()=>cameraPose(a,{...c.getSnapshot(),identity:{...a.identity,geometrySha256:'stale'}}));
  }
});

test('actual paint gate rejects missing imagery/elevation, rider occlusion, stale registration and absent route',()=>{
  const p={lon:11,lat:45,rawElevationM:100}, box={left:0,top:0,right:200,bottom:200,width:200,height:200};
  const dot={left:89,top:89,right:111,bottom:111,width:22,height:22};
  const map={project:()=>({x:100,y:100}),queryTerrainElevation:()=>100,
    unproject:()=>({lng:11,lat:45}),queryRenderedFeatures:()=>[{}]};
  const marker={getBoundingClientRect:()=>dot},container={getBoundingClientRect:()=>box};
  const old=globalThis.getComputedStyle;globalThis.getComputedStyle=()=>({opacity:1});
  try {
    assert.equal(frameEvidence(map,p,marker,container,()=>true).ok,true);
    assert.equal(frameEvidence(map,p,marker,container,()=>false).ok,false);
    for (const change of [
      {queryTerrainElevation:()=>null},{queryTerrainElevation:()=>999},
      {unproject:()=>({lng:11.01,lat:45})},{project:()=>({x:-1,y:100})},
      {queryRenderedFeatures:()=>[]},
    ]) assert.equal(frameEvidence({...map,...change},p,marker,container,()=>true).ok,false);
    globalThis.getComputedStyle=()=>({opacity:.2});
    assert.equal(frameEvidence(map,p,marker,container,()=>true).ok,false);
  } finally {globalThis.getComputedStyle=old;}
});

// Execute the actual adapter with a deterministic SDK/clock, retaining the real
// camera and frame-proof functions. This is lifecycle evidence, not map imagery.
async function terrainFixture() {
  const source=(await readFile(new URL('../js/route-terrain-view.mjs',import.meta.url),'utf8'))
    .replace(/^import .*;\n/,'')
    .replace(/await import\('[^']+'\);/g,'')
    .replace('export async function mountRouteTerrain','async function mountRouteTerrain');
  let now=0, map, visibility='hidden';
  const timers=new Map(), transitions=[], statuses=[];
  const box={left:0,top:0,right:200,bottom:200,width:200,height:200};
  const container={clientWidth:200,clientHeight:200,dataset:{},
    getBoundingClientRect:()=>box,
    style:{get visibility(){return visibility;},set visibility(v){
      if(v!==visibility)transitions.push(v);visibility=v;
    }}};
  class FixtureMap {
    events={}; imagery=true; elevation=100; clear=true; road=true; removed=0;
    constructor(options){this.options=options;map=this;}
    on(name,fn){this.events[name]=fn;}
    once(name,fn){this.on(name,fn);}
    emit(name,e={}){this.events[name]?.(e);}
    addControl(){} addSource(){} addLayer(){} setTerrain(){} triggerRepaint(){} resize(){}
    getSource(){return {tiles:[],tileSize:256};}
    jumpTo(pose){this.center=pose.center;} fitBounds(){}
    project(){return {x:100,y:100};}
    queryTerrainElevation(){return this.elevation;}
    unproject(){return {lng:this.center[0]+(this.clear?0:.01),lat:this.center[1]};}
    queryRenderedFeatures(){return this.road?[{}]:[];}
    remove(){this.removed++;}
  }
  class Marker {setLngLat(){return this;} addTo(){return this;}}
  const gl={Map:FixtureMap,Marker,NavigationControl:class {},supported:()=>true,maxParallelImageRequests:16};
  const window={mapboxgl:gl,KOTR_CONFIG:{MAPBOX_TOKEN:'fixture'},
    kotrTerrainTools:{loadSDK:async()=>true,rasterCoverage:()=>()=>map.imagery}};
  const document={hidden:false,createElement:()=>({setAttribute(){},
    getBoundingClientRect:()=>({left:90,top:90,right:110,bottom:110,width:20,height:20})})};
  const proof=(...args)=>{
    const old=globalThis.getComputedStyle;globalThis.getComputedStyle=()=>({opacity:1});
    try {return frameEvidence(...args);} finally {globalThis.getComputedStyle=old;}
  };
  let nextTimer=0;
  const mount=new Function('window','document','devicePixelRatio','performance','setTimeout','clearTimeout',
    'cameraPose','routeBounds','routeLine','frameEvidence','limits',
    source+'\nreturn mountRouteTerrain;')(window,document,1,{now:()=>now},
    (fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,at:now+ms});return id;},
    id=>timers.delete(id),cameraPose,routeBounds,routeLine,proof,flyoverLimits);
  const identity={revisionId:'test',geometrySha256:'test'};
  const position={lon:11,lat:45,rawElevationM:100,elevationM:100,distanceM:0};
  const analysis={identity,distanceM:100,points:[position,{...position,lon:11.001,distanceM:100}]};
  const snapshot={identity,position,distanceM:0,phase:'playing',cameraMode:'follow'};
  const controller=new AbortController();
  const handle=await mount({container,analysis,snapshot,signal:controller.signal,
    onStatus:(state,message)=>statuses.push({state,message}),onManual(){}});
  map.emit('load');
  return {map,handle,container,statuses,transitions,controller,gl,snapshot,timers,
    advance(ms){now+=ms;for(const [id,t] of timers)if(t.at<=now){timers.delete(id);t.fn();}}};
}

test('terrain presentation stays continuous through successful motion and transient failed proofs',async()=>{
  const f=await terrainFixture();
  assert.equal(f.container.style.visibility,'hidden','No unproved initial map');
  f.map.emit('render');
  assert.equal(JSON.parse(f.container.dataset.frame).ok,true);
  assert.equal(f.container.style.visibility,'visible');
  for(let i=1;i<=8;i++) {
    f.advance(210);
    f.handle.update({...f.snapshot,distanceM:i});
    // This fails on the original adapter on every camera update, even when
    // the immediately following frame has fully valid coverage and geometry.
    assert.equal(f.container.style.visibility,'visible','Camera motion must not reveal the outline');
    f.map.emit('render');
  }
  for(const field of ['imagery','clear','road','elevation']) {
    const valid=f.map[field];
    f.map[field]=field==='elevation'?null:false;
    f.map.emit('render');
    assert.equal(JSON.parse(f.container.dataset.frame).ok,false,'Never relabel invalid proof');
    assert.equal(f.statuses.at(-1).state,'verifying');
    assert.equal(f.container.style.visibility,'visible','Transient verification must not swap surfaces');
    f.advance(200);f.map[field]=valid;f.map.emit('render');
    assert.equal(f.statuses.at(-1).state,'ready');
  }
  f.handle.update({...f.snapshot,distanceM:50,phase:'paused'},true);
  f.map.emit('render');
  assert.deepEqual(f.transitions,['visible'],'Seek also retains the presented terrain');
  f.controller.abort();
  assert.equal(f.map.removed,1);
  assert.equal(f.gl.maxParallelImageRequests,16);
  assert.equal(f.timers.size,0);
});

test('terrain outages keep a fixed deadline; terminal failures dispose once without resurrection',async()=>{
  for(const failure of ['coverage','error','webglcontextlost','budget','initial']) {
    const f=await terrainFixture();
    if(failure!=='initial')f.map.emit('render');
    if(failure==='coverage' || failure==='initial') {
      f.map.imagery=false;f.map.emit('render');
      const duration=failure==='initial'?flyoverLimits.loadMs:flyoverLimits.coverageMs;
      for(let elapsed=0;elapsed<duration;elapsed+=500) {
        f.advance(500);f.handle.update(f.snapshot,true);f.map.emit('render');
      }
    } else if(failure==='budget') {
      for(let i=0;i<=flyoverLimits.tileRequests;i++)f.map.options.transformRequest('https://fixture/tile','Tile');
      await Promise.resolve();
    } else f.map.emit(failure);
    assert.equal(f.statuses.at(-1).state,'unavailable',failure);
    assert.equal(f.container.style.visibility,'hidden',failure);
    assert.equal(f.map.removed,1);
    const count=f.statuses.length;
    f.map.imagery=true;f.map.emit('render');f.handle.update(f.snapshot,true);f.controller.abort();
    assert.equal(f.statuses.length,count,'Late events cannot resurrect failed terrain');
    assert.equal(f.map.removed,1);
    assert.equal(f.timers.size,0);
    assert.equal(f.gl.maxParallelImageRequests,16);
  }
});
