import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createRecordedReplay, actualAtSample, matchRecordedRoute, compareRecorded, replayLimits } from '../js/recorded-replay.mjs';
import { createRoutePlayback } from '../js/route-playback.mjs';
import { analyzeRoute, horizontalDistanceM } from '../js/route-analysis.mjs';
import { estimateRouteTime } from '../js/route-time.mjs';
import { parseLocalBytes } from '../js/local-route-parser.mjs';
import { syntheticGPX, syntheticFIT } from './local-route-fixtures.mjs';

const points=(n=100)=>Array.from({length:n},(_,i)=>({lat:45+i*.0001,lon:11,elevationM:100}));
const analysis=p=>analyzeRoute({routeId:'plan',revisionId:'exact-rev',geometrySha256:'a'.repeat(64),points:p});
function recording(p=points(),samples=null) {
  const id='user:synthetic',revisionId='local-synthetic';
  return {id,revisionId,decoded:{kind:'recording',format:'FIT',points:p,
    samples:samples??p.map((_,i)=>({pointIndex:i,timeMs:1700000000000+i*1000,powerW:200,cadenceRpm:80,speedMps:10,heartRateBpm:120}))},
  analysis:analyzeRoute({routeId:id,revisionId,geometrySha256:'b'.repeat(64),points:p})};
}
test('actual units, timestamps and provenance; missing/invalid never modeled or held',()=>{
  const a=actualAtSample({timeMs:1,powerW:0,cadenceRpm:0,speedMps:0,heartRateBpm:0},'FIT');
  assert.equal(a.powerW.value,0);assert.equal(a.cadenceRpm.unit,'rpm');assert.equal(a.speedMps.unit,'m/s');
  assert.equal(a.heartRateBpm.status,'unavailable');
  for(const sample of [{powerW:200},{timeMs:1,powerW:NaN},{timeMs:1,powerW:65535},{timeMs:1,powerW:'200'}])
    assert.equal(actualAtSample(sample,'GPX').powerW.status,'unavailable');
  const r=createRecordedReplay(recording());
  assert.equal(r.atSecond(0).signals.powerW.provenance,'FIT decoded sample');
  assert.equal(r.atSecond(.5).signals.powerW.status,'unavailable');
  assert.equal(r.atSecond(.5).position.pointIndex,0);
  assert.equal(r.atSecond(.5).sampleAgeSeconds,.5);
  const missing=recording();delete missing.decoded.samples[3].cadenceRpm;
  assert.equal(createRecordedReplay(missing).atSecond(3).signals.cadenceRpm.status,'unavailable');
});
test('pause, moving and timestamp gaps are distinct; missing-time recordings decline',()=>{
  const r=recording(points(5));
  r.decoded.samples.forEach((s,i)=>{s.timeMs=1000+[0,1000,2000,42000,43000][i];s.speedMps=i<3?0:10;});
  const replay=createRecordedReplay(r);
  assert.deepEqual(replay.intervals,['paused','paused','gap','moving']);
  const end=replay.atSecond(43);
  assert.equal(end.elapsedSeconds,43);assert.equal(end.pausedSeconds,2);assert.equal(end.movingSeconds,1);assert.equal(end.unknownSeconds,40);
  assert.equal(replay.atSecond(20).position,null);
  assert.equal(replay.atSecond(20).signals.powerW.status,'unavailable');
  r.decoded.samples[2].timeMs=null;
  assert.equal(createRecordedReplay(r).status,'unavailable');
});
test('timestamp gap excludes its chord from the subtotal, chapters, distance seek and comparison inside the gap',async()=>{
  const r=recording(points(6));
  r.decoded.samples.forEach((s,i)=>s.timeMs=1000+[0,1,62,63,64,65][i]*1000);
  const plan=analysis(r.decoded.points),replay=createRecordedReplay(r);
  assert.equal(r.analysis.status,'supported','geometry-only analysis still includes the chord');
  const edge=(a,b)=>horizontalDistanceM(r.decoded.points[a],r.decoded.points[b]);
  const before=edge(0,1),total=before+edge(2,3)+edge(3,4)+edge(4,5);
  assert.equal(replay.atSecond(1).distanceM,before);
  assert.equal(replay.atSecond(30).distanceM,before);
  assert.equal(replay.atSecond(62).distanceM,before);
  assert.equal(replay.atSecond(65).distanceM,total);
  assert.equal(replay.supportedPointEdges.has(2),false);
  assert.deepEqual(replay.adapter.chapters,[],'do not bind geometry-only chapters to a shorter axis');
  assert.equal(replay.secondAtDistance(before),null);
  assert.throws(()=>replay.adapter.positionAt(before),/Ambiguous/);
  const match=matchRecordedRoute(r.decoded,plan),estimate=estimateRouteTime(plan);
  for(const basis of ['elapsed','distance']) {
    assert.equal(compareRecorded(replay.atSecond(30),match,plan,estimate,basis).status,'unavailable');
    assert.equal(compareRecorded(replay.atSecond(62),match,plan,estimate,basis).status,'available');
  }
  const engine=createRoutePlayback({loadRoute:()=>replay.adapter});
  await engine.selectRoute({routeId:r.id,revisionId:r.revisionId});
  engine.seekRecordedSeconds(63.5);
  engine.seekDistance(before);
  assert.equal(engine.getSnapshot().phase,'paused');
  assert.equal(engine.getSnapshot().recordedClock.elapsedSeconds,63.5);
  assert.match(engine.getSnapshot().seekNotice,/collapsed gap/);
  engine.seekRecordedSeconds(62);
  assert.equal(engine.getSnapshot().seekNotice,null);
  engine.restart();assert.equal(engine.getSnapshot().recordedClock.elapsedSeconds,0);
  engine.seekDistance(total);assert.equal(engine.getSnapshot().recordedClock.elapsedSeconds,65);
  // A start gap also has a zero subtotal: loading/restart still means source
  // time zero, but an explicit collapsed-distance request declines.
  r.decoded.samples[1].timeMs=32000;
  const startGap=createRecordedReplay(r);
  assert.equal(startGap.secondAtDistance(0),null);
  const other=createRoutePlayback({loadRoute:()=>startGap.adapter});
  await other.selectRoute({routeId:r.id,revisionId:r.revisionId});
  assert.equal(other.getSnapshot().phase,'ready');
  other.seekRecordedSeconds(32);other.restart();
  assert.equal(other.getSnapshot().recordedClock.elapsedSeconds,0);
});
test('distance inclusion uses the same 30-second boundary as the clock gap classifier',()=>{
  for(const delta of [29.999,30,30.001]) {
    const r=recording(points(2));
    r.decoded.samples[1].timeMs=r.decoded.samples[0].timeMs+delta*1000;
    const replay=createRecordedReplay(r),gap=delta>30;
    assert.equal(replay.intervals[0],gap?'gap':'moving');
    assert.equal(replay.atSecond(delta).distanceM,gap?0:horizontalDistanceM(...r.decoded.points));
    assert.equal(replay.supportedPointEdges.has(1),!gap);
  }
});
test('coordinate-less FIT samples retain actual telemetry; elevation is never filled',()=>{
  const r=recording();r.decoded.samples[1].pointIndex=null;r.decoded.points[2].elevationM=null;
  const replay=createRecordedReplay(r);
  assert.equal(replay.atSecond(1).position,null);
  assert.equal(replay.atSecond(1).signals.powerW.value,200);
  assert.equal(replay.atSecond(2).position.elevationM,null);
});
test('native supported decoder metadata feeds replay without parser expansion; FIT course not activity',()=>{
  for(const bytes of [new TextEncoder().encode(syntheticGPX({recording:true})),syntheticFIT({recording:true})]) {
    const r=recording();r.decoded=parseLocalBytes(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
    const replay=createRecordedReplay(r);
    assert.equal(replay.status,'available');assert.equal(replay.atSecond(0).signals.heartRateBpm.status,'available');
    assert.equal(replay.atSecond(2).signals.cadenceRpm.status,r.decoded.format==='FIT'?'unavailable':'available');
  }
  const bytes=syntheticFIT(),r=recording();r.decoded=parseLocalBytes(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  assert.equal(createRecordedReplay(r).status,'unavailable');
});
test('single controller uses source elapsed seconds through stationary pauses at every rate; seek/restart/replace/hidden',async()=>{
  const r=recording(points(5));r.decoded.points[1]={...r.decoded.points[0]};
  r.decoded.samples[0].speedMps=r.decoded.samples[1].speedMps=0;
  const replay=createRecordedReplay(r),engine=createRoutePlayback({loadRoute:()=>replay.adapter});
  await engine.selectRoute({routeId:r.id,revisionId:r.revisionId});
  for(const rate of [.5,1,2,4]) {
    engine.seekRecordedSeconds(.25);engine.setAnimationRate(rate);engine.play();engine.tick(0);engine.tick(100);
    assert.equal(engine.getSnapshot().recordedClock.elapsedSeconds,.25+.1*rate);
    assert.equal(engine.getSnapshot().distanceM,0,'pause does not move distance to manufacture elapsed');
    engine.replaceRoute(replay.adapter);
    assert.equal(engine.getSnapshot().recordedClock.elapsedSeconds,.25+.1*rate);
  }
  engine.seekRecordedSeconds(2);engine.setHidden(true);engine.tick(1e6);
  assert.equal(engine.getSnapshot().recordedClock.elapsedSeconds,2);
  engine.setHidden(false);engine.restart();assert.equal(engine.getSnapshot().recordedClock.elapsedSeconds,0);
  engine.seekRecordedSeconds(4);assert.equal(engine.getSnapshot().distanceM,replay.adapter.distanceM);
  engine.clear();assert.equal(engine.getSnapshot().recordedClock.status,'unavailable');
});
test('supported plan/actual fixtures: explicit bases, full identity and model unavailable never blocks distance replay',()=>{
  const r=recording(),a=analysis(r.decoded.points),replay=createRecordedReplay(r),match=matchRecordedRoute(r.decoded,a);
  assert.equal(match.status,'available');assert.equal(match.segments.length,1);
  assert.equal(match.points.every(p=>p.status==='matched'),true);
  const estimate=estimateRouteTime(a),actual=replay.atSecond(50);
  for(const basis of ['elapsed','distance']) {
    const c=compareRecorded(actual,match,a,estimate,basis);
    assert.equal(c.status,'available');assert.equal(c.identity.revisionId,'exact-rev');
    assert.equal(c.actual.lat,r.decoded.points[50].lat);
    assert.ok(Number.isFinite(c.deltaM));
  }
  assert.equal(compareRecorded(actual,match,a,null,'elapsed').status,'unavailable');
  assert.equal(compareRecorded(actual,match,a,null,'distance').status,'available');
  assert.equal(compareRecorded(actual,match,a,{...estimate,identity:{revisionId:'other'}},'distance').status,'unavailable');
  assert.equal(compareRecorded(actual,match,a,estimate,'').status,'unavailable');
});
test('out-and-back ambiguity, reversals, detours and partial overlap are explicit, not nearest-coordinate full matches',()=>{
  const forward=points(),outback=[...forward,...forward.slice(0,-1).reverse()];
  const a=analysis(outback),r=recording(forward.slice(10,80));
  const ambiguous=matchRecordedRoute(r.decoded,a);
  assert.equal(ambiguous.status,'declined');assert.ok(ambiguous.points.some(p=>p.status==='ambiguous'));
  const plan=analysis(forward),partial=matchRecordedRoute(r.decoded,plan);
  assert.equal(partial.status,'available');assert.ok(partial.segments[0].startM>100);
  assert.ok(partial.segments.at(-1).endM<plan.distanceM);
  const actual=createRecordedReplay(r).atSecond(10);
  assert.equal(compareRecorded(actual,partial,plan,estimateRouteTime(plan),'distance').status,'available');
  assert.match(compareRecorded(actual,partial,plan,estimateRouteTime(plan),'elapsed').reason,/planned start/);
  const reverse=recording([...forward].reverse()),rev=matchRecordedRoute(reverse.decoded,plan);
  assert.equal(rev.status,'declined');assert.ok(rev.points.some(p=>p.reason==='Reversal in route order'));
  const detour=recording();detour.decoded.points[50].lon+=.01;
  const d=matchRecordedRoute(detour.decoded,plan);
  assert.equal(d.points[50].status,'off-route');assert.equal(d.segments.length,2);
  const short=points(5),shortPlan=analysis([...short,...short.slice(0,-1).reverse()]);
  const shortMatch=matchRecordedRoute(recording(short).decoded,shortPlan);
  assert.ok(shortMatch.points.some(p=>p.reason==='Conflicting nearby directions/occurrences'));
});
test('matching never bridges time/spatial breaks or isolated hits',()=>{
  const r=recording(),plan=analysis(r.decoded.points);
  r.decoded.points[50].breakBefore=true;
  const m=matchRecordedRoute(r.decoded,plan);
  assert.equal(m.segments.length,2);assert.equal(m.segments[0].endPoint,49);
  r.decoded.samples.forEach((s,i)=>s.timeMs+=i>=75?60000:0);
  assert.equal(matchRecordedRoute(r.decoded,plan).segments.length,3);
});
test('entirely stationary recording needs no artificial positive distance or elevation model',async()=>{
  const r=recording(Array.from({length:5},()=>({lat:45,lon:11,elevationM:null})));
  r.decoded.samples.forEach(s=>s.speedMps=0);
  const replay=createRecordedReplay(r),engine=createRoutePlayback({loadRoute:()=>replay.adapter});
  await engine.selectRoute({routeId:r.id,revisionId:r.revisionId});
  assert.equal(engine.getSnapshot().phase,'ready');
  engine.seekRecordedSeconds(2);
  assert.equal(engine.getSnapshot().distanceM,0);
  assert.equal(engine.getSnapshot().recordedClock.pausedSeconds,2);
  assert.equal(engine.getSnapshot().recordedClock.position.elevationM,null);
});
test('20k×8k work is bounded by indexed candidates, dense loops decline within the explicit budget',()=>{
  const p=points(8000),a=analysis(p),r=recording(Array.from({length:20000},(_,i)=>({...p[Math.floor(i/2.5)]})));
  const start=performance.now(),m=matchRecordedRoute(r.decoded,a);
  assert.ok(m.stats.candidateTests<=replayLimits.candidateTests+1);
  assert.ok(m.stats.cellEntries<=replayLimits.cellEntries+1);
  assert.ok(performance.now()-start<3000,'bounded fixture completes without quadratic scan');
  const dense=Array.from({length:8000},(_,i)=>({lat:45+(i%2)*.0001,lon:11,elevationM:100}));
  const declined=matchRecordedRoute(recording(points(100)).decoded,analysis(dense));
  assert.ok(declined.stats.candidateTests<=replayLimits.candidateTests+1);
  assert.notEqual(declined.status,'available');
});
test('two private recordings are isolated and cannot mutate the public plan',()=>{
  const plan=analysis(points()),before=JSON.stringify(plan);
  const a=recording(),b=recording();b.decoded.samples[0].powerW=345;
  const one=createRecordedReplay(a),two=createRecordedReplay(b);
  matchRecordedRoute(a.decoded,plan);
  assert.equal(one.atSecond(0).signals.powerW.value,200);assert.equal(two.atSecond(0).signals.powerW.value,345);
  assert.equal(JSON.stringify(plan),before);
});
