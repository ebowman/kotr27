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
