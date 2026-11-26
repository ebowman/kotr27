import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readRoutePack } from '../tools/route-pack.mjs';
import { createAnalysisStore } from '../js/trip-planner.mjs';
import { createAnalysisPlaybackRoute } from '../js/route-playback-adapters.mjs';
import { createRoutePlayback } from '../js/route-playback.mjs';
import { estimateRouteTime } from '../js/route-time.mjs';
import { positionAt } from '../js/route-analysis.mjs';
import { cameraJobs, cameraPose, createRoutePresentation, followBearing, shortestAngle, followMotion, officialFlyover, routeLine, routeBounds, frameEvidence, terrainDepthEvidence, flyoverLimits } from '../js/route-flyover.mjs';

// Deterministic packed-depth fixture. Real GPU terrain/ridge coverage is tested
// separately in route-flyover-browser, never inferred from this fixture.
function depthFixture(map) {
  let bound=null;
  const gl={FRAMEBUFFER:1,FRAMEBUFFER_BINDING:2,RGBA:3,UNSIGNED_BYTE:4,
    isContextLost:()=>false,getParameter:()=>bound,bindFramebuffer:(_,value)=>{bound=value;},
    readPixels:(_x,_y,_w,_h,_format,_type,pixels)=>pixels.set([0,0,0,map.clear===false ? 102 : 128])};
  map.transform={width:200,height:200,worldSize:1,projection:{name:'mercator'},
    locationCoordinate:()=>({x:0,y:0}),projMatrix:[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1]};
  map.painter={width:200,height:200,context:{gl},terrain:{
    proxyCoords:[{key:'current'}],terrainTileForTile:{current:{dem:{}}},
    _depthFBO:{width:200,height:200,framebuffer:{}}}};
  return map;
}

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
  const map=depthFixture({project:()=>({x:100,y:100}),queryTerrainElevation:()=>100,
    unproject:()=>{throw Error('Approximate inverse picks are not visibility proof');},queryRenderedFeatures:()=>[{}]});
  const marker={getBoundingClientRect:()=>dot},container={getBoundingClientRect:()=>box};
  const old=globalThis.getComputedStyle;globalThis.getComputedStyle=()=>({opacity:1});
  try {
    assert.equal(frameEvidence(map,p,marker,container,()=>true).ok,true);
    assert.equal(frameEvidence(map,p,marker,container,()=>false).ok,false);
    for (const change of [
      {queryTerrainElevation:()=>null},{queryTerrainElevation:()=>999},
      {painter:depthFixture({clear:false}).painter},{project:()=>({x:-1,y:100})},{painter:null},
      {queryRenderedFeatures:()=>[]},
    ]) assert.equal(frameEvidence({...map,...change},p,marker,container,()=>true).ok,false);
    globalThis.getComputedStyle=()=>({opacity:.2});
    assert.equal(frameEvidence(map,p,marker,container,()=>true).ok,false);
  } finally {globalThis.getComputedStyle=old;}
});

test('rendered depth rejects occlusion, missing/unbound DEM, stale depth and preserves framebuffer binding',()=>{
  const map=depthFixture({}),p={lon:11,lat:45},xy={x:100,y:100};
  assert.equal(terrainDepthEvidence(map,p,xy,100).visible,true);
  assert.equal(map.painter.context.gl.getParameter(),null,'Read restores GL state');
  map.clear=false;
  const blocked=terrainDepthEvidence(map,p,xy,100);
  assert.equal(blocked.visible,false);
  assert.ok(blocked.gap>.0005,'Foreground depth, not inverse ground-coordinate discrepancy, blocks');
  map.clear=true;
  assert.equal(terrainDepthEvidence(map,p,xy,null).visible,false);
  const dem=map.painter.terrain.terrainTileForTile.current.dem;
  delete map.painter.terrain.terrainTileForTile.current.dem;
  assert.equal(terrainDepthEvidence(map,p,xy,100).covered,false,'A numeric rider elevation cannot cover an unbound foreground region');
  map.painter.terrain.terrainTileForTile.current.dem=dem;
  map.painter.terrain._depthFBO.width=100;
  assert.equal(terrainDepthEvidence(map,p,xy,100).visible,false,'Stale resize depth is unknown');
  map.painter.terrain._depthFBO.width=200;
  for(const [surface,visible] of [[-.00049,true],[-.00051,false]]){
    map.painter.context.gl.readPixels=(_x,_y,_w,_h,_format,_type,pixels)=>{
      let value=(surface+1)/2;
      for(let i=3;i>=0;i--){value*=255;pixels[i]=Math.floor(value);value-=pixels[i];}
    };
    assert.equal(terrainDepthEvidence(map,p,xy,100).visible,visible,'Exactly the pinned SDK .0005 NDC bias');
  }
  map.painter.context.gl.readPixels=()=>{throw Error('readback failure');};
  assert.throws(()=>terrainDepthEvidence(map,p,xy,100),/readback/);
  assert.equal(map.painter.context.gl.getParameter(),null,'Failed reads also restore GL state');
});

test('fractional-DPR depth allocation accepts SDK ceiling sizes but rejects genuinely stale dimensions',()=>{
  const map=depthFixture({}),p={lon:11,lat:45};
  for(const [width,height,dpr] of [[375,812,1.25],[375,813,1.25],[375,813,1.5],[1440,900,1]]){
    map.transform.width=width;map.transform.height=height;
    map.painter.width=width*dpr;map.painter.height=height*dpr;
    const fbo=map.painter.terrain._depthFBO;
    fbo.width=Math.ceil(map.painter.width);fbo.height=Math.ceil(map.painter.height);
    const xy={x:width/2,y:height/2};
    assert.equal(terrainDepthEvidence(map,p,xy,100).visible,true,`${width}x${height} DPR ${dpr}`);
    for(const axis of ['width','height']){
      const current=fbo[axis];
      for(const stale of [current-1,current+1]){
        fbo[axis]=stale;
        assert.equal(terrainDepthEvidence(map,p,xy,100).visible,false,`Stale ${axis} ${stale}`);
        assert.equal(terrainDepthEvidence(map,p,xy,100).gap,null);
      }
      fbo[axis]=current;
    }
    map.clear=false;
    assert.equal(terrainDepthEvidence(map,p,xy,100).visible,false,'Fractional DPR does not excuse occlusion');
    map.clear=true;
    assert.equal(terrainDepthEvidence(map,p,xy,null).visible,false,'Missing DEM remains unknown');
  }
});

test('manual proof verifies viewport resources without asserting rider framing, road or occlusion',()=>{
  const map=depthFixture({unproject:xy=>({lng:xy.x,lat:xy.y}),queryTerrainElevation:()=>100});
  const check=()=>frameEvidence(map,null,null,null,()=>true,'manual');
  assert.deepEqual(check(),{mode:'manual',imagery:true,elevation:true,depth:true,ok:true});
  assert.equal(frameEvidence(map,null,null,null,()=>false,'manual').ok,false);
  map.queryTerrainElevation=p=>p.lng===10?null:100;
  assert.equal(check().elevation,false,'One missing viewport DEM sample fails');
  map.queryTerrainElevation=()=>100;
  delete map.painter.terrain.terrainTileForTile.current.dem;
  assert.equal(check().ok,false,'All current viewport proxy regions need DEM');
  map.painter.terrain.terrainTileForTile.current.dem={};
  map.painter.terrain._depthFBO.width--;
  assert.equal(check().depth,false,'Stale depth fails in manual too');
  map.painter.terrain._depthFBO.width++;
  map.painter.context.gl.isContextLost=()=>true;
  assert.equal(check().depth,false);
  map.painter.context.gl.isContextLost=()=>false;
  map.painter.context.gl.readPixels=(_x,_y,_w,_h,_f,_t,pixels)=>pixels.fill(255);
  assert.equal(check().depth,false,'Clear/empty depth is not terrain');
  map.painter.context.gl.readPixels=()=>{throw Error('GPU readback failure');};
  assert.throws(check,/GPU readback/);
});

test('follow yaw uses broad actual Grappa context and bounded shortest-angle turns',async()=>{
  assert.equal(shortestAngle(179,-179),2);
  assert.equal(shortestAngle(-179,179),-2);
  assert.equal(followBearing(-179,179,200),181);
  assert.equal(followBearing(179,-179,200),-181);
  assert.equal(followBearing(120,0,10000),3,'Suspension never accumulates a large turn');
  assert.equal(followBearing(120,0,0),0,'No elapsed update means no autonomous rotation');
  assert.equal(followBearing(-90,undefined,0),-90,'Explicit reset starts at selected context');
  const {pack}=await readRoutePack('.');
  const route=pack.catalog.routes.find(r=>r.id==='rwgps-57873019');
  const a=await createAnalysisStore(pack,path=>readFile(path))(route.id,route.currentRevisionId);
  let priorLocal,priorTarget,bearing,localMax=0,targetTravel=0,localTravel=0,smoothedMax=0;
  for(let distanceM=0;distanceM<=a.distanceM;distanceM+=a.distanceM/450) {
    const snapshot={identity:a.identity,position:positionAt(a,distanceM),distanceM,cameraMode:'follow'};
    const pose=cameraPose(a,snapshot);
    const local=cameraPose(a,{...snapshot,cameraMode:'side'}).bearing-90;
    const next=followBearing(pose.bearing,bearing,200);
    assert.deepEqual(pose.center,[snapshot.position.lon,snapshot.position.lat]);
    if(bearing!==undefined)smoothedMax=Math.max(smoothedMax,Math.abs(shortestAngle(bearing,next)));
    if(priorLocal!==undefined){
      const step=Math.abs(shortestAngle(priorLocal,local));
      localMax=Math.max(localMax,step);localTravel+=step;
      targetTravel+=Math.abs(shortestAngle(priorTarget,pose.bearing));
    }
    bearing=next;priorLocal=local;priorTarget=pose.bearing;
  }
  assert.ok(localMax>90,'Actual route contains abrupt local hairpin heading changes');
  assert.ok(targetTravel<localTravel/2,'Broad context materially reduces route tangent coupling');
  assert.ok(smoothedMax<=followMotion.yawDegreesPerSecond*.2+1e-9);
  console.log('Actual Grappa yaw regression:',{localMax,localTravel,targetTravel,smoothedMax});
});

// Execute the actual adapter with a deterministic SDK/clock, retaining the real
// camera and frame-proof functions. This is lifecycle evidence, not map imagery.
async function terrainFixture() {
  const source=(await readFile(new URL('../js/route-terrain-view.mjs',import.meta.url),'utf8'))
    .replace(/^import .*;\n/,'')
    .replace(/await import\('[^']+'\);/g,'')
    .replace('export async function mountRouteTerrain','async function mountRouteTerrain');
  let now=0, map, visibility='hidden', manualCalls=0;
  const timers=new Map(), frames=new Map(), transitions=[], statuses=[], poses=[], presented=[];
  const box={left:0,top:0,right:200,bottom:200,width:200,height:200};
  const container={clientWidth:200,clientHeight:200,dataset:{},
    getBoundingClientRect:()=>box,
    style:{get visibility(){return visibility;},set visibility(v){
      if(v!==visibility)transitions.push(v);visibility=v;
    }}};
  class FixtureMap {
    events={}; imagery=true; elevation=100; clear=true; road=true; removed=0; fits=0;
    constructor(options){this.options=options;map=this;depthFixture(this);}
    on(name,fn){this.events[name]=fn;}
    once(name,fn){this.on(name,fn);}
    emit(name,e={}){this.events[name]?.(e);}
    addControl(){} addSource(){} addLayer(){} setTerrain(){} triggerRepaint(){} resize(){}
    getSource(){return {tiles:[],tileSize:256};}
    jumpTo(pose){poses.push({at:now,...pose});if(pose.center)this.center=pose.center;if(pose.pitch!==undefined)this.pitch=pose.pitch;}
    getPitch(){return this.pitch;} fitBounds(){this.fits++;}
    project(){return {x:100,y:100};}
    queryTerrainElevation(){return this.elevation;}
    unproject(){return {lng:this.center[0]+(this.clear?0:.01),lat:this.center[1]};}
    queryRenderedFeatures(){return this.road?[{}]:[];}
    remove(){this.removed++;}
  }
  class Marker {setLngLat(){return this;} addTo(){return this;}}
  const gl={Map:FixtureMap,Marker,NavigationControl:class {},supported:()=>true,maxParallelImageRequests:16};
  const window={mapboxgl:gl,KOTR_CONFIG:{MAPBOX_TOKEN:'fixture'},
    kotrTerrainTools:{loadSDK:async()=>true,rasterCoverage:m=>()=>m.imagery}};
  const document={hidden:false,events:{},addEventListener(name,fn){this.events[name]=fn;},
    removeEventListener(name){delete this.events[name];},createElement:()=>({setAttribute(){},
    getBoundingClientRect:()=>({left:90,top:90,right:110,bottom:110,width:20,height:20})})};
  const proof=(...args)=>{
    const old=globalThis.getComputedStyle;globalThis.getComputedStyle=()=>({opacity:1});
    try {return frameEvidence(...args);} finally {globalThis.getComputedStyle=old;}
  };
  let nextTimer=0;
  const mount=new Function('window','document','devicePixelRatio','performance','setTimeout','clearTimeout',
    'cameraPose','followBearing','routeBounds','routeLine','frameEvidence','limits',
    'createRoutePresentation','requestAnimationFrame','cancelAnimationFrame',
    source+'\nreturn mountRouteTerrain;')(window,document,1,{now:()=>now},
    (fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,at:now+ms});return id;},
    id=>timers.delete(id),cameraPose,followBearing,routeBounds,routeLine,proof,flyoverLimits,
    createRoutePresentation,fn=>{const id=++nextTimer;frames.set(id,fn);return id;},id=>frames.delete(id));
  const identity={revisionId:'test',geometrySha256:'test'};
  const position={lon:11,lat:45,rawElevationM:100,elevationM:100,distanceM:0};
  const analysis={identity,status:'supported',distanceM:100,
    points:[position,{...position,lon:11.001,distanceM:100}],
    windows:[{startM:0,endM:100,startElevationM:100,endElevationM:100}],
    chapters:[{id:'one',startM:0,endM:100}]};
  const snapshot={identity,position:positionAt(analysis,0),distanceM:0,phase:'playing',cameraMode:'follow'};
  const controller=new AbortController();
  const handle=await mount({container,analysis,snapshot,signal:controller.signal,
    onPresent:s=>presented.push(s),
    onStatus:(state,message)=>statuses.push({state,message}),onManual(){manualCalls++;}});
  map.emit('load');
  return {map,handle,container,statuses,transitions,controller,gl,snapshot,timers,frames,poses,presented,analysis,document,
    manualCalls:()=>manualCalls,
    async replace(){
      const handle=await mount({container,analysis,snapshot,signal:new AbortController().signal,
        onStatus:(state,message)=>statuses.push({state,message}),onManual(){manualCalls++;}});
      map.emit('load');return {map,handle};
    },
    advance(ms){now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}
      for(const [id,fn] of [...frames]){frames.delete(id);fn(now);}}};
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
    f.advance(400);
    f.map.emit('render');
    assert.equal(JSON.parse(f.container.dataset.frame).ok,false,'Never relabel invalid proof');
    f.advance(400);f.map.emit('render');
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

test('manual off-rider pan and return use distinct proof; old route timers and events are isolated',async()=>{
  const f=await terrainFixture();
  f.map.emit('render');
  f.map.imagery=false;f.advance(200);f.map.emit('render');
  const oldDeadline=[...f.timers.values()].find(t=>t.at===2700).fn;
  const next=await f.replace();
  next.map.emit('render');
  assert.equal(f.map.removed,1);
  assert.equal(f.timers.size,0,'New proved map clears only its own load deadline');
  next.map.emit('movestart',{originalEvent:{}});
  next.map.project=()=>({x:-900,y:100});
  next.map.road=false;next.map.clear=false;
  f.advance(200);
  next.map.emit('render');
  assert.equal(JSON.parse(f.container.dataset.frame).mode,'manual');
  assert.equal(JSON.parse(f.container.dataset.frame).ok,true);
  f.advance(3500);
  assert.equal(next.map.removed,0);
  const count=f.statuses.length, calls=f.manualCalls();
  oldDeadline();f.map.emit('movestart',{originalEvent:{}});
  f.map.emit('render');f.map.emit('error');f.map.emit('moveend');
  f.handle.update(f.snapshot,true);
  assert.equal(f.statuses.length,count);
  assert.equal(f.manualCalls(),calls,'Disposed map cannot pause the new route');
  assert.equal(f.container.style.visibility,'visible');
  next.map.project=()=>({x:100,y:100});next.map.road=true;
  next.handle.update(f.snapshot,true);next.map.emit('render');
  assert.equal(JSON.parse(f.container.dataset.frame).mode,'follow');
  assert.equal(JSON.parse(f.container.dataset.frame).clear,false,'Return restores strict occlusion immediately');
  next.map.clear=true;f.advance(200);next.map.emit('render');
  assert.equal(JSON.parse(f.container.dataset.frame).ok,true);
  f.advance(3500);
  assert.equal(next.map.removed,0,'Recovered proof cancels the existing outage timer');
  next.handle.dispose();
});

test('manual missing viewport imagery DEM depth provider GPU and budgets remain bounded terminal failures',async()=>{
  for(const failure of ['imagery','dem','depth','error','webglcontextlost','budget']) {
    const f=await terrainFixture();f.map.emit('render');
    f.map.emit('movestart',{originalEvent:{}});f.map.emit('render');
    if(failure==='imagery')f.map.imagery=false;
    if(failure==='dem')delete f.map.painter.terrain.terrainTileForTile.current.dem;
    if(failure==='depth')f.map.painter.terrain._depthFBO.width--;
    if(['imagery','dem','depth'].includes(failure)){
      f.advance(200);
      f.map.emit('render');
      assert.equal(JSON.parse(f.container.dataset.frame).ok,false);
      for(let i=0;i<5;i++){
        f.advance(500);
        f.map.emit('movestart',{originalEvent:{}});f.map.emit('render');
      }
    } else if(failure==='budget'){
      for(let i=0;i<=flyoverLimits.tileRequests;i++)f.map.options.transformRequest('https://fixture/tile','Tile');
      await Promise.resolve();
    } else f.map.emit(failure);
    assert.equal(f.statuses.at(-1).state,'unavailable',failure);
    assert.equal(f.map.removed,1);
    assert.equal(f.timers.size,0);
    const count=f.statuses.length;
    f.advance(12000);f.map.emit('render');
    assert.equal(f.statuses.length,count);
  }
});

test('route replacement resets tile budget and isolates already queued old-map failures',async()=>{
  const f=await terrainFixture();f.map.emit('render');
  for(let i=0;i<flyoverLimits.tileRequests;i++)f.map.options.transformRequest('https://fixture/old','Tile');
  // Queue the old failure, then replace before its microtask executes.
  f.map.options.transformRequest('https://fixture/old-over-budget','Tile');
  const next=await f.replace();next.map.emit('render');
  await Promise.resolve();
  assert.equal(next.map.removed,0);
  assert.equal(f.container.style.visibility,'visible');
  next.map.emit('movestart',{originalEvent:{}});
  for(let i=0;i<flyoverLimits.tileRequests;i++)next.map.options.transformRequest('https://fixture/new','Tile');
  await Promise.resolve();f.advance(200);next.map.emit('render');
  assert.equal(next.map.removed,0,'New route gets exactly its own existing 240-request budget');
  assert.equal(Number(f.container.dataset.requests),240);
  next.map.options.transformRequest('https://fixture/new-over-budget','Tile');
  await Promise.resolve();
  assert.equal(next.map.removed,1);
  assert.match(f.statuses.at(-1).message,/tile budget/);
});

test('terrain outages keep a fixed deadline; terminal failures dispose once without resurrection',async()=>{
  for(const failure of ['coverage','error','webglcontextlost','budget','initial']) {
    const f=await terrainFixture();
    if(failure!=='initial')f.map.emit('render');
    if(failure==='coverage' || failure==='initial') {
      f.map.imagery=false;f.advance(200);f.map.emit('render');
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

test('actual occlusion retains honest fallback and never flattens the selected camera',async()=>{
  const f=await terrainFixture();
  f.map.emit('render');
  f.map.clear=false;
  f.advance(200);
  for(let i=0;i<100;i++){
    f.advance(16);f.map.emit('render');
    assert.equal(f.map.pitch,45);
    assert.equal(JSON.parse(f.container.dataset.frame).clear,false,'The failed painted frame stays failed');
  }
  assert.equal(f.map.removed,0);
  f.advance(1000);
  assert.equal(f.map.removed,1);
  assert.equal(f.statuses.at(-1).state,'unavailable');
  f.controller.abort();
});

test('dense actual poses are unthrottled; proof is sequenced at 200ms, with no status tick chatter',async()=>{
  const f=await terrainFixture();f.map.emit('render');
  for(let i=1;i<=1800;i++){
    f.advance(1000/60);
    const distanceM=i/20;
    f.handle.update({...f.snapshot,distanceM,position:positionAt(f.analysis,distanceM)});
    const stale=JSON.parse(f.container.dataset.frame);
    assert.equal(stale.current,false,'Previous pose proof cannot claim the new pose');
    f.map.emit('render');
    const pose=JSON.parse(f.container.dataset.pose),proof=JSON.parse(f.container.dataset.frame);
    assert.equal(pose.distanceM,distanceM,'Dense caller and marker/profile distance remain identical');
    if(proof.current)assert.equal(proof.sequence,pose.sequence);
  }
  assert.equal(f.poses.length,1801,'Real camera commands, not just RAF callbacks');
  assert.ok(JSON.parse(f.container.dataset.frame).proofSequence<=151);
  assert.deepEqual(f.statuses.map(s=>s.state),['ready'],'No ready/verifying flitter during valid motion');
  f.handle.dispose();assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
});

test('sparse known targets interpolate on route without another distance clock; commands and disposal flush',async()=>{
  const f=await terrainFixture();
  const target=distanceM=>({...f.snapshot,distanceM,position:positionAt(f.analysis,distanceM)});
  f.advance(200);f.handle.update(target(20));
  const start=f.poses.length;
  for(let i=0;i<10;i++)f.advance(20);
  assert.equal(f.poses.length-start,10);
  assert.deepEqual(f.presented.slice(-10).map(s=>s.distanceM),[2,4,6,8,10,12,14,16,18,20]);
  for(const s of f.presented)assert.deepEqual(s.position,positionAt(f.analysis,s.distanceM));
  f.advance(200);assert.equal(f.presented.at(-1).distanceM,20,'No extrapolation after target');
  f.handle.update({...target(70),phase:'paused'},true);
  assert.equal(f.presented.at(-1).distanceM,70,'Seek is exact and synchronous');
  f.handle.update(target(70));
  f.advance(200);f.handle.update(target(90));assert.ok(f.frames.size);
  f.handle.update({...target(90),phase:'paused'});
  assert.equal(f.presented.at(-1).distanceM,90);assert.equal(f.frames.size,0);
  f.handle.update(target(90));f.advance(200);f.handle.update(target(100));
  assert.equal(f.presented.at(-1).distanceM,100,'Exact endpoint');
  assert.equal(f.frames.size,0);
  f.handle.update(target(10),true);f.advance(200);f.handle.update(target(20));
  f.handle.dispose();const count=f.poses.length;f.advance(1000);
  assert.equal(f.poses.length,count);assert.equal(f.frames.size,0);
});

test('presentation interpolation and bounded yaw are frame-rate independent; gaps never catch up',async()=>{
  const f=await terrainFixture(),s=f.snapshot;
  for(const hz of [30,60,120]){
    const p=createRoutePresentation(f.analysis);
    p.push(s,0);p.push({...s,distanceM:80,position:positionAt(f.analysis,80)},200);
    let bearing=0;
    for(let i=1;i<=hz;i++)bearing=followBearing(90,bearing,1000/hz);
    assert.ok(Math.abs(bearing-12)<1e-8);
    for(let i=1;i<=hz/10;i++)p.sample(200+i*1000/hz);
    assert.equal(p.sample(300).distanceM,40);
    assert.equal(p.sample(400).distanceM,80);
    assert.equal(p.sample(40000).distanceM,80);
    assert.equal(p.push({...s,distanceM:90},40001).distanceM,90);
    assert.equal(p.pending(40001),false,'Suspension resets rather than paying a motion debt');
  }
  f.handle.dispose();
});

test('overview is framed once, manual owns viewport, hidden/reduced motion and disposal cancel interpolation',async()=>{
  const f=await terrainFixture(),s=f.snapshot;
  f.handle.update({...s,cameraMode:'overview'},true);
  for(let i=1;i<=30;i++){
    f.advance(16);f.handle.update({...s,cameraMode:'overview',distanceM:i,position:positionAt(f.analysis,i)});
  }
  assert.equal(f.map.fits,1,'Moving the overview rider does not repeatedly refit the map');
  f.map.emit('movestart',{originalEvent:{}});
  const commands=f.poses.length;
  f.handle.update({...s,phase:'paused'});
  assert.equal(f.poses.length,commands,'Pause in manual mode never recenters');
  f.handle.update({...s,phase:'paused'},true);
  assert.equal(f.poses.length,commands+1,'Return is exact and immediate');
  f.handle.update(s);f.advance(200);
  f.handle.update({...s,distanceM:20,position:positionAt(f.analysis,20)});
  assert.ok(f.frames.size);
  f.document.hidden=true;f.document.events.visibilitychange();
  assert.equal(f.frames.size,0);
  const last=f.poses.length;f.advance(1000);
  assert.equal(f.poses.length,last,'Hidden time is not a second playback clock');
  f.document.hidden=false;
  f.handle.update({...s,distanceM:40,position:positionAt(f.analysis,40),phase:'paused'});
  assert.equal(f.presented.at(-1).distanceM,40);
  f.handle.update(s);f.advance(200);
  f.handle.update({...s,distanceM:20,position:positionAt(f.analysis,20),reducedMotion:true});
  assert.equal(f.frames.size,0,'Reduced motion never starts an interpolating RAF');
  f.handle.dispose();
  assert.deepEqual(f.document.events,{});
});
