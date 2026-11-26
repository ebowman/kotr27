import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {analyzeRoute} from '../js/route-analysis.mjs';
import {loadRouteAnalysis} from '../js/route-analysis-loader.mjs';
import {readRoutePack} from '../tools/route-pack.mjs';
import {createRideSimulation,createSimulationScheduler} from '../js/ride-simulation.mjs';
import {indexRideTrial,createRideComparison,comparisonLimits} from '../js/ride-comparison.mjs';

const near = (a,b,eps=1e-6) => assert.ok(Math.abs(a-b)<eps,`${a} vs ${b}`);
const slope = (rise=200) => analyzeRoute({routeId:'fixture',revisionId:'v1',geometrySha256:'a'.repeat(64),
  points:Array.from({length:41},(_,i)=>({lat:0,lon:i*100/6371000*180/Math.PI,
    elevationM:1000+rise*i/40}))});
const available = value => {assert.equal(value.status,'available',JSON.stringify(value));return value;};
const make = (analysis,options={}) => available(createRideSimulation({analysis,...options}));
const pin = (analysis,model) => available(createRideComparison({analysis,trial:model.exportTrial()}));
const run = (model,seconds) => {model.play();return model.advance(seconds);};
const compare = (comparison,model,options) => {
  available(comparison.sync(model.exportTrial()));
  return available(comparison.sample(model.snapshot(),options));
};

test('frozen strategy uses exact applied history, pending is excluded and identical runs coincide',()=>{
  const analysis=slope(),model=make(analysis);
  model.command({type:'effort',value:.9,atSeconds:3.123});
  model.command({type:'coast',atSeconds:12});
  model.command({type:'effort',value:.6,atSeconds:17.3});
  run(model,28);
  model.command({type:'effort',value:.9,atSeconds:300});
  const baseline=pin(analysis,model),saved=JSON.stringify(baseline.recipe);
  assert.equal(baseline.recipe.history.length,3);
  assert.ok(Object.isFrozen(baseline.recipe.history[0]));
  for (const seconds of [28,60,150,299]) {
    if (seconds>model.snapshot().simulationSeconds) model.advance(seconds-model.snapshot().simulationSeconds);
    const result=compare(baseline,model);
    near(result.distanceDeltaM,0);near(result.arrivalDeltaSeconds,0);near(result.pedalWorkDeltaKJ,0);
  }
  model.advance(30);
  assert.ok(compare(baseline,model).distanceDeltaM>0);
  assert.equal(JSON.stringify(baseline.recipe),saved);
  model.seek(500);model.restart();
  assert.equal(baseline.sample(model.snapshot()).status,'unavailable');
  assert.equal(JSON.stringify(baseline.recipe),saved);
});

test('hard effort gives coherent signed equal-time distance and common-arrival work; gear gives no speed',()=>{
  const analysis=slope(),model=make(analysis),baseline=pin(analysis,model);
  model.command({type:'gear',value:{frontTeeth:34,rearTeeth:34}});
  const gear=run(model,20);
  near(compare(baseline,model).distanceDeltaM,0);
  near(compare(baseline,model).pedalWorkDeltaKJ,0);
  assert.ok(gear.cadenceRpm>make(analysis).snapshot().cadenceRpm);
  model.command({type:'effort',value:.9});model.advance(80);
  const result=compare(baseline,model);
  assert.ok(result.distanceDeltaM>0);
  assert.ok(result.arrivalDeltaSeconds<0);
  assert.ok(result.pedalWorkDeltaKJ>0);
  near(result.commonM,result.ghost.distanceM);
  // Equal-time work is NOT substituted for common-distance work.
  assert.ok(model.snapshot().pedalWorkKJ-result.ghost.pedalWorkKJ>result.pedalWorkDeltaKJ);
});

test('shared numerical higher-mass and higher-power trends; incompatible rider identity is refused',()=>{
  const analysis=slope();
  const normal=make(analysis),heavy=make(analysis,{rider:{riderKg:90}}),power=make(analysis,{rider:{ftpW:270}});
  const indices=[normal,heavy,power].map(model=>available(indexRideTrial({analysis,trial:model.exportTrial()})));
  assert.ok(indices[1].atSecond(100).distanceM<indices[0].atSecond(100).distanceM);
  assert.ok(indices[2].atSecond(100).distanceM>indices[0].atSecond(100).distanceM);
  const baseline=pin(analysis,normal);
  assert.equal(baseline.sync(heavy.exportTrial()).status,'unavailable');
  const foreign={...normal.snapshot(),modelIdentity:{...normal.modelIdentity,
    route:{...normal.modelIdentity.route,revisionId:'v2'}}};
  assert.equal(baseline.sample(foreign).status,'unavailable');
});

test('coast baseline stalls finitely and resumes only in live; downhills and exact finish stay finite',()=>{
  for (const rise of [0,400,-400]) {
    const analysis=slope(rise),model=make(analysis);
    model.command({type:'coast'});run(model,1);
    const baseline=pin(analysis,model);
    model.command({type:'effort',value:.75});model.advance(100);
    const result=compare(baseline,model);
    assert.ok(Number.isFinite(result.distanceDeltaM));
    if (rise>=0) {
      assert.equal(result.ghost.distanceM,0);
      assert.equal(result.baselineFinishSeconds,null);
      assert.equal(result.arrivalDeltaSeconds,0);
      assert.equal(result.pedalWorkDeltaKJ,0);
    }
    assert.equal(baseline.sample(model.snapshot(),{seconds:86401}).status,'unavailable');
    assert.ok(baseline.diagnostics().baselineSegments<=analysis.windows.length+3);
  }
  const analysis=slope(),finished=make(analysis);
  finished.seek(analysis.distanceM);
  const baseline=pin(analysis,finished),result=compare(baseline,finished);
  assert.equal(result.distanceDeltaM,0);assert.equal(result.arrivalDeltaSeconds,0);
  assert.equal(result.pedalWorkDeltaKJ,0);assert.equal(result.baselineFinishSeconds,0);
  assert.equal(baseline.diagnostics().baselineSegments,0);
});

test('planned stop arrival is first reached, never departure; commands can occur within stops',()=>{
  const analysis=slope(),stops=[{chapterId:analysis.chapters[0].id,seconds:10}];
  const model=make(analysis,{stops});
  model.command({type:'effort',value:.9,atSeconds:4});
  run(model,6);
  const index=available(indexRideTrial({analysis,trial:model.exportTrial()}));
  assert.equal(index.arrivalAt(0).simulationSeconds,0);
  assert.equal(index.atSecond(9).distanceM,0);
  assert.equal(index.atSecond(10).distanceM,0);
  model.advance(100);
  near(index.atSecond(106).distanceM,model.snapshot().distanceM);
  near(index.atSecond(106).pedalWorkKJ,model.snapshot().pedalWorkKJ);
  const varied=analyzeRoute({routeId:'stops',revisionId:'v1',geometrySha256:'b'.repeat(64),
    points:Array.from({length:41},(_,i)=>({lat:0,lon:i*100/6371000*180/Math.PI,
      elevationM:1000+Math.min(i,40-i)*10}))});
  const stopModel=make(varied,{stops:varied.chapters.map(c=>({chapterId:c.id,seconds:7.25}))});
  const stopIndex=available(indexRideTrial({analysis:varied,trial:stopModel.exportTrial()}));
  for (const chapter of varied.chapters) {
    const arrival=stopIndex.arrivalAt(chapter.startM).simulationSeconds;
    near(stopIndex.atSecond(arrival+7).distanceM,chapter.startM);
    assert.ok(stopIndex.atSecond(arrival+7.5).distanceM>chapter.startM);
  }
});

test('same scheduler interpolation basis, pause/rate/hidden ownership, bounded memoization',()=>{
  const analysis=slope(),model=make(analysis),baseline=pin(analysis,model);
  const scheduler=createSimulationScheduler(model);
  scheduler.play();scheduler.frame(0);
  for (let frame=1;frame<=720;frame++) {
    const {previous,current,alpha}=scheduler.frame(frame*16.667);
    const result=baseline.sample(current,{
      seconds:previous.simulationSeconds+(current.simulationSeconds-previous.simulationSeconds)*alpha,
      distanceM:previous.distanceM+(current.distanceM-previous.distanceM)*alpha,
    });
    near(result.distanceDeltaM,0);
  }
  const before=model.snapshot();
  scheduler.pause();scheduler.frame(90000);
  near(model.snapshot().simulationSeconds,before.simulationSeconds);
  scheduler.setRate(60);
  near(compare(baseline,model).distanceDeltaM,0);
  assert.equal(baseline.diagnostics().builds,1);
  assert.ok(baseline.diagnostics().baselineSegments<=analysis.windows.length+1);
  const tooMany={...model.exportTrial(),history:Array(comparisonLimits.history+1).fill({type:'coast',atSeconds:0})};
  assert.equal(indexRideTrial({analysis,trial:tooMany}).status,'unavailable');
});

test('bounded history stress and a sought coasting origin replay without retaining query frames',t=>{
  const analysis=slope(),model=make(analysis);
  for (let i=0;i<comparisonLimits.history;i++)
    model.command({type:'effort',value:i%2?.6:.9,atSeconds:i/32});
  run(model,40);
  const start=performance.now(),baseline=pin(analysis,model);
  for (let i=0;i<10000;i++)
    assert.equal(baseline.sample(model.snapshot()).status,'available');
  const diagnostics=baseline.diagnostics();
  assert.equal(diagnostics.builds,1);
  assert.ok(diagnostics.baselineSegments<comparisonLimits.history+analysis.windows.length*2);
  t.diagnostic(JSON.stringify({queries:10000,...diagnostics,elapsedMs:performance.now()-start}));
  model.command({type:'coast'});model.advance(.1);model.seek(1000);
  const coast=pin(analysis,model);
  run(model,300);
  assert.equal(compare(coast,model).distanceDeltaM,0);
  assert.equal(compare(coast,model).baselineFinishSeconds,null);
});

test('all supported public routes: indexed arrivals/work reconcile simulation through windows and first Grappa trial',async t=>{
  const {pack}=await readRoutePack('.');
  for (const route of pack.routes) {
    const analysis=await loadRouteAnalysis({pack,routeId:route.routeId,revisionId:route.revisionId,
      readAsset:path=>readFile(path)});
    const model=createRideSimulation({analysis});
    if (model.status !== 'available') {assert.equal(route.routeId,'rwgps-57874050');continue;}
    if (route.routeId==='rwgps-57873019') model.seek(10750);
    run(model,17);
    model.command({type:'effort',value:.9});model.advance(44);
    model.command({type:'coast'});model.advance(21);
    model.command({type:'effort',value:.6});model.advance(2);
    const start=performance.now(),index=available(indexRideTrial({analysis,trial:model.exportTrial()}));
    t.diagnostic(`${route.routeId}: ${index.segmentCount} segments, ${(performance.now()-start).toFixed(1)} ms compile`);
    for (const seconds of [84,300,800,4000,20000]) {
      model.advance(seconds-model.snapshot().simulationSeconds);
      const actual=model.snapshot(),sample=index.atSecond(seconds);
      near(sample.distanceM,actual.distanceM,1e-5);near(sample.pedalWorkKJ,actual.pedalWorkKJ,1e-5);
      const arrival=index.arrivalAt(actual.distanceM);
      assert.ok(arrival.simulationSeconds<=actual.simulationSeconds+1e-6);
    }
  }
});
