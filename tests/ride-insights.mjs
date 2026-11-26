import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readRoutePack} from '../tools/route-pack.mjs';
import {loadRouteAnalysis} from '../js/route-analysis-loader.mjs';
import {analyzeRoute,positionAt} from '../js/route-analysis.mjs';
import {rideInsights,sectionName} from '../js/ride-insights.mjs';
import {routeSection,routeBounds,flyoverLimits} from '../js/route-flyover.mjs';
import {createRideSimulation} from '../js/ride-simulation.mjs';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} vs ${b}`);
const slope=rise=>analyzeRoute({routeId:'fixture',revisionId:'v1',geometrySha256:'a'.repeat(64),
  points:Array.from({length:21},(_,i)=>({lat:0,lon:i*100/6371000*180/Math.PI,elevationM:1000+rise*i/20}))});
test('climb, descent, flat, partial windows, final endpoint and missing analysis are honest',()=>{
  for (const rise of [200,-200,0]) {
    const a=slope(rise), before=JSON.stringify(a),r=rideInsights(a,125);
    near(r.remaining.distanceM,a.distanceM-125);
    near(r.remaining.ascentM,Math.max(0,rise)*(a.distanceM-125)/a.distanceM);
    near(r.ahead.distanceM,1000);near(r.ahead.minGradePercent,rise/20);
    assert.match(sectionName(a,r.current),rise>0?/Climb/:rise<0?/Descent/:/Level/);
    assert.equal(r.next,null);
    const end=rideInsights(a,a.distanceM);
    assert.equal(end.current.id,a.chapters.at(-1).id);
    assert.equal(end.finished,true);assert.equal(end.remaining.ascentM,0);
    assert.equal(end.ahead.minGradePercent,null);assert.equal(end.ahead.distanceM,0);
    near(rideInsights(a,a.distanceM-100).ahead.distanceM,100);
    assert.equal(JSON.stringify(a),before);
    assert.throws(()=>rideInsights(a,-1),RangeError);
  }
  assert.equal(rideInsights(null,0).status,'unavailable');
  const missing=analyzeRoute({routeId:'missing',revisionId:'v1',geometrySha256:'b'.repeat(64),
    points:[{lat:0,lon:0},{lat:0,lon:.001}]});
  assert.equal(rideInsights(missing,0).status,'unavailable');
});
test('actual seven revisions: main Grappa climb, next section, completed selection, Asolo and unmodified anomaly',async()=>{
  const {pack}=await readRoutePack('.');
  const identities=new Set();
  for (const r of pack.routes) {
    const a=await loadRouteAnalysis({pack,...r,readAsset:path=>readFile(path)});
    identities.add(a.identity.geometrySha256);
    const beginning=rideInsights(a,0);
    assert.deepEqual(beginning.identity,a.identity);
    for (const chapter of a.chapters) {
      const state=rideInsights(a,chapter.startM,chapter.id);
      assert.equal(state.current,chapter);
      near(state.remaining.ascentM,chapter.ascentM);
      const coords=routeSection(a,chapter.id),start=positionAt(a,chapter.startM),end=positionAt(a,chapter.endM);
      assert.deepEqual(coords[0],[start.lon,start.lat]);
      assert.deepEqual(coords.at(-1),[end.lon,end.lat]);
      assert.ok(coords.length<=flyoverLimits.vertices);
      const bounds=routeBounds(a,chapter.id);
      assert.ok(coords.every(([x,y])=>x>=bounds[0][0] && x<=bounds[1][0] && y>=bounds[0][1] && y<=bounds[1][1]));
      assert.equal(rideInsights(a,chapter.endM,chapter.id).selectedRemaining.distanceM,0);
      assert.equal(rideInsights(a,chapter.endM,chapter.id).selectedRemaining.ascentM,0);
    }
    if (r.routeId==='rwgps-57873019') {
      const c=beginning.mainClimb;
      assert.equal(c.id,'chapter-22');assert.equal(c.startM,10750);assert.equal(c.endM,20500);
      near(c.ascentM,852.8323756912412);
      const entry=rideInsights(a,c.startM,c.id);
      near(entry.ahead.minGradePercent,6.963605463160297);
      near(entry.ahead.maxGradePercent,9.396862371157317);
      assert.equal(entry.next.id,'chapter-23');
      const end=rideInsights(a,c.endM,c.id);
      assert.equal(end.current.id,'chapter-23');assert.equal(end.selected.id,'chapter-22');
      assert.equal(end.selectedRemaining.distanceM,0);
    }
    if (r.routeId==='rwgps-57874050') {
      assert.equal(createRideSimulation({analysis:a}).status,'unavailable');
      assert.equal(rideInsights(a,25500).ahead.inputAnomaly,true);
      assert.ok(a.windows[102].gradePercent>68,'Never repair published geometry');
    }
    if (r.routeId==='rwgps-57873112') assert.notEqual(beginning.mainClimb?.startM,10750);
  }
  assert.equal(identities.size,7);
});
