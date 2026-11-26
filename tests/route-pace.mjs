import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readRoutePack } from '../tools/route-pack.mjs';
import { loadRouteAnalysis } from '../js/route-analysis-loader.mjs';
import { createRoutePace, sensitivityProfile, paceScenarios } from '../js/route-pace.mjs';
import { createRouteClock } from '../js/ride-clock.mjs';
import { routeTimeAtDistance, estimateRouteTime } from '../js/route-time.mjs';
import { createRoutePlayback } from '../js/route-playback.mjs';
import { createAnalysisPlaybackRoute } from '../js/route-playback-adapters.mjs';
import { validateRider } from '../js/rider-scenario.mjs';
import { estimateEffort } from '../js/ascent-estimator.mjs';
import { buildClimbSensitivity, compareClimbSensitivity } from '../js/climb-sensitivity.mjs';
const {pack}=await readRoutePack(fileURLToPath(new URL('../',import.meta.url)));
const analyses=await Promise.all(pack.catalog.routes.map(route=>loadRouteAnalysis({pack,routeId:route.id,
  revisionId:route.currentRevisionId,readAsset:path=>readFile(new URL('../'+path,import.meta.url))})));
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} vs ${b}`);
const rider=(patch={})=>validateRider({mass:'',ftp:'',enteredUnit:'kg',effort:'slower',...patch});

test('all seven: same-point pace/controller/clock, chapter/trip totals share exact unrounded models',async()=>{
  const pace=createRoutePace(), a=analyses[0];
  for (const analysis of analyses) for (const scenario of Object.keys(paceScenarios)) {
    pace.setScenario(scenario);
    const model=pace.model(analysis);
    const playback=createRoutePlayback({loadRoute:()=>createAnalysisPlaybackRoute(analysis,{estimate:model})});
    await playback.selectRoute(analysis.identity);
    if (analysis.routeId==='rwgps-57874050') {
      assert.equal(model.status,'unavailable');
      assert.equal(playback.seekDistance(100).phase,'paused'); continue;
    }
    const clock=createRouteClock(model);
    for (const f of [0,.001,.3,.75,1]) {
      const d=analysis.distanceM*f, p=routeTimeAtDistance(model,d);
      assert.deepEqual(playback.seekDistance(d).estimatedRide,p);
      near(clock.atSecond(p.elapsedSeconds).distanceM,d);
      playback.setAnimationRate(4);
      assert.deepEqual(playback.getSnapshot().estimatedRide,p);
    }
    assert.equal(model.total.movingSeconds,model.chapters.reduce((n,c)=>n+c.movingSeconds,0));
    const rows=[{status:'ready',choice:{routeId:analysis.routeId,revisionId:analysis.revisionId}}];
    assert.deepEqual(pace.trip(rows,new Map([[analysis.revisionId,analysis]])).total,model.total);
  }
  const before=pace.model(a);
  pace.setStop(a,a.chapters[1].id,300.125);
  const after=pace.model(a), c=after.chapters[1], clock=createRouteClock(after);
  assert.equal(after.total.movingSeconds,before.total.movingSeconds);
  assert.equal(after.total.elapsedSeconds,after.total.movingSeconds+300.125);
  assert.equal(routeTimeAtDistance(after,c.startM).elapsedSeconds,c.arrivalSeconds);
  assert.equal(clock.atSecond(c.arrivalSeconds+10).status,'stopped');
  assert.equal(clock.atSecond(c.arrivalSeconds+10).distanceM,c.startM);
});

test('physical inputs, units, invalid/clear, revision isolation and bounded model reuse',()=>{
  const pace=createRoutePace(), a=analyses[0], b=analyses[1];
  const original=pace.model(a), other=pace.model(b);
  pace.setRider(rider());
  assert.equal(pace.model(a),original);
  pace.setStop(a,a.chapters[0].id,300);
  assert.equal(pace.model(b),other,'unrelated route model remains cached');
  const updated=pace.model(a);
  pace.setRider(rider({mass:'75',ftp:'220'}));
  assert.equal(pace.model(a).total.movingSeconds,updated.total.movingSeconds);
  pace.setRider(rider({mass:String(75/.45359237),enteredUnit:'lb',ftp:'220'}));
  near(pace.model(a).total.movingSeconds,updated.total.movingSeconds);
  pace.setRider(rider({ftp:'bad'}));
  assert.equal(pace.model(a).status,'unavailable');
  assert.equal(pace.model(a).total,undefined);
  pace.setRider(rider(),true);
  assert.equal(pace.snapshot().scenario,'steady');
  assert.deepEqual(pace.stopsFor(a),[]);
  assert.deepEqual(pace.model(a).total,original.total);
  const revision={...a,revisionId:a.revisionId+'-next',identity:{...a.identity,revisionId:a.revisionId+'-next'}};
  pace.setStop(a,a.chapters[0].id,100);
  assert.deepEqual(pace.stopsFor(revision),[]);
  assert.notEqual(pace.model(a),pace.model(revision));
  const rows=analyses.map(a=>({status:'ready',choice:{routeId:a.routeId,revisionId:a.revisionId}}));
  const trip=pace.trip(rows,new Map(analyses.map(a=>[a.revisionId,a])));
  assert.deepEqual(trip.missing,['rwgps-57874050']);
});

test('selected sensitivity isolates four factors; no repaired D4S whole-route or oversized target',()=>{
  const a=analyses[0], selected=sensitivityProfile(a);
  assert.equal(selected.status,'available');
  const data=buildClimbSensitivity(selected.profile,{riderKgAxis:[65,75,85],ftpWAxis:[200,220,240],
    baseline:{riderKg:75,ftpW:220},bikeKitKg:12,effortFraction:.8});
  const comparisons=compareClimbSensitivity(selected.profile,data,{riderKg:65,ftpW:240});
  for (const [name,riderKg,ftpW] of [['baseline',75,220],['weight',65,220],['ftp',75,240],['combined',65,240]]) {
    const p=comparisons[name], exact=estimateEffort(selected.profile,{riderKg,ftpW,fraction:.8});
    assert.equal(p.movingSeconds,exact.total.movingSeconds);
    assert.equal(p.deltaMinutes,(p.movingSeconds-data.baseline.movingSeconds)/60);
    assert.equal(p.deltaPercent,(p.movingSeconds-data.baseline.movingSeconds)/data.baseline.movingSeconds*100);
  }
  const bad=analyses.find(a=>a.routeId==='rwgps-57874050');
  assert.equal(sensitivityProfile(bad).status,'unavailable');
  assert.equal(sensitivityProfile(bad,'chapter-68').status,'unavailable');
  const eligible=bad.chapters.find(c=>c.kind==='ascent' && sensitivityProfile(bad,c.id).status==='available');
  assert.ok(eligible,'a genuinely bounded subset can be explored without repairing the whole route');
  const bounded=sensitivityProfile(bad,eligible.id).profile;
  assert.equal(bounded.segments.length,bad.windows.filter(w=>w.chapterId===eligible.id).length);
  assert.equal(estimateEffort(bounded).total.movingSeconds>0,true);
  assert.equal(sensitivityProfile(a,'missing').status,'unavailable');
  assert.equal(sensitivityProfile({...a,windows:Array(501).fill(a.windows[0])}).status,'unavailable');
  const chapter=a.chapters[1], part=sensitivityProfile(a,chapter.id);
  assert.equal(part.status,'available');
  assert.equal(part.profile.segments[0].startM,0);
  assert.equal(part.profile.segments.at(-1).endM,chapter.endM-chapter.startM);
});

test('scenario replacement pauses without resetting position, camera or renderer',async()=>{
  const a=analyses[0], pace=createRoutePace();
  const make=()=>createAnalysisPlaybackRoute(a,{estimate:pace.model(a)});
  const engine=createRoutePlayback({loadRoute:make}); await engine.selectRoute(a.identity);
  engine.seekDistance(1234); engine.setCameraMode('side');
  const token=engine.enable3D().renderer.requestId; engine.setRendererStatus(token,'ready');
  engine.play();
  const before=engine.getSnapshot(); pace.setScenario('hard');
  const after=engine.replaceRoute(make());
  assert.equal(after.phase,'paused'); assert.equal(after.distanceM,before.distanceM);
  assert.equal(after.cameraMode,before.cameraMode); assert.deepEqual(after.renderer,before.renderer);
  assert.deepEqual(after.estimatedRide,routeTimeAtDistance(pace.model(a),1234));
  assert.throws(()=>engine.replaceRoute({...make(),identity:{...a.identity,revisionId:'different'}}));
});

test('official route adapter preserves units and exact solver totals at every named fraction',()=>{
  const analysis=analyses[0], identity=analysis.identity;
  const profile={schemaVersion:1,chapters:analysis.chapters,segments:analysis.windows};
  for (const [scenario,fraction] of [['easy',.6],['steady',.75],['hard',.9]]) {
    const result=estimateRouteTime(analysis,{scenario});
    assert.equal(result.status,'available');
    assert.equal(result.total.movingSeconds,estimateEffort(profile,{fraction}).total.movingSeconds);
    assert.equal(createRouteClock(result).atSecond(result.total.elapsedSeconds).distanceM,analysis.distanceM);
    assert.deepEqual(routeTimeAtDistance(result,analysis.distanceM),
      {status:'available',identity,distanceM:analysis.distanceM,...result.total});
  }
});
