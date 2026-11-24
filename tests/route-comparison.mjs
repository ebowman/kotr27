import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readRoutePack } from '../tools/route-pack.mjs';
import { createAnalysisStore } from '../js/trip-planner.mjs';
import { createCatalog } from '../js/route-catalog.mjs';
import { tripTotals } from '../js/itinerary.mjs';
import { readSelection, selectionLink } from '../js/route-state.mjs';
import { validatePreferenceLink } from '../js/preference-storage.mjs';
import { comparisonRow, comparisonScales, profileSamples, profilePoint, radialPoint, variantDelta } from '../js/route-comparison.mjs';
import { analyzeRoute, positionAt } from '../js/route-analysis.mjs';

const {pack}=await readRoutePack('.');
const catalog=createCatalog(pack.catalog), load=createAnalysisStore(pack,p=>readFile(p));
const analyses=new Map(), rows=[];
for (const r of catalog.data.routes) {
  const a=await load(r.id,r.currentRevisionId); analyses.set(r.currentRevisionId,a);
  rows.push(comparisonRow(catalog,r.id,r.currentRevisionId,a));
}
test('all seven comparison metrics exactly reconcile with canonical analysis and trip totals',()=>{
  assert.equal(rows.length,7);
  for (const row of rows) {
    assert.equal(row.status,'supported');
    const totals=tripTotals(catalog,{version:1,choices:[{
      dayId:row.variant.dayId,routeId:row.route.id,revisionId:row.bundle.revision.id,
    }]},analyses);
    assert.equal(row.distanceM,totals.distanceM);
    assert.equal(row.ascentM,totals.gainM);
    assert.equal(profileSamples(row.analysis).at(-1).distanceM,row.distanceM);
    assert.equal(row.analysis.sourceTotals.listed.gainM,
      pack.routes.find(s=>s.routeId===row.route.id).listed.gainM);
  }
  for (const day of catalog.data.days.slice(1)) {
    const short=rows.find(r=>r.variant.dayId===day.id && r.variant.name==='short');
    const long=rows.find(r=>r.variant.dayId===day.id && r.variant.name==='long');
    assert.deepEqual(variantDelta(short,long),{
      distanceM:long.analysis.distanceM-short.analysis.distanceM,
      ascentM:long.analysis.processedTotals.ascentM-short.analysis.processedTotals.ascentM,
    });
  }
});
test('equal distance and normalized progress differ; shared elevation does not autoscale per panel',()=>{
  const scale=comparisonScales(rows), short=rows.reduce((a,b)=>a.distanceM<b.distanceM ? a : b);
  const end=profileSamples(short.analysis).at(-1);
  assert.ok(profilePoint(end,short,scale,'distance')[0]<1);
  assert.equal(profilePoint(end,short,scale,'progress')[0],1);
  const elevation={distanceM:0,elevationM:100};
  assert.equal(profilePoint(elevation,rows[0],scale)[1],profilePoint(elevation,rows[1],scale)[1]);
  // Filtering is display-only: pass the inventory scale unchanged to each row.
  for (const row of rows.slice(0,2)) for (const sample of profileSamples(row.analysis)) {
    const p=profilePoint(sample,row,scale);
    assert.ok(p.every(n=>n>=0 && n<=1));
  }
  const d4s=rows.find(r=>r.route.name.startsWith('D4S'));
  assert.ok(d4s.analysis.windows.some(w=>Math.abs(w.gradePercent)>50),'extremes retained, never clamped');
});
test('radial is normalized progress, preserves ordered occurrences and uses shared elevation radius',()=>{
  const scale=comparisonScales(rows), row=rows[0], h=100;
  const start=radialPoint(0,h,row,scale), finish=radialPoint(row.distanceM,h,row,scale);
  assert.ok(Math.hypot(start[0]-finish[0],start[1]-finish[1])<1e-10);
  const quarter=radialPoint(row.distanceM/4,h,row,scale);
  assert.ok(quarter[0]>200); assert.ok(Math.abs(quarter[1]-200)<1e-10);
  const rotated=radialPoint(0,h,row,scale,90);
  assert.deepEqual(rotated,quarter);
  assert.deepEqual(radialPoint(0,h,rows[1],scale),start);
});
test('missing elevation, failed verification, wrong identity and withdrawn routes never yield plausible comparison',()=>{
  const r=rows[0], id=r.bundle.revision.id;
  for (const a of [null,{...r.analysis,status:'unsupported'},
    {...r.analysis,identity:{...r.analysis.identity,revisionId:'stale'}},
    {...r.analysis,identity:{...r.analysis.identity,geometrySha256:'0'.repeat(64)}}]) {
    const missing=comparisonRow(catalog,r.route.id,id,a);
    assert.equal(missing.status,'unavailable');
    assert.equal(missing.distanceM,undefined); assert.equal(variantDelta(missing,rows[1]),null);
  }
  const data=structuredClone(catalog.data), withdrawn=data.routes[0];
  withdrawn.status='withdrawn'; withdrawn.currentRevisionId=null; withdrawn.revisions=[];
  data.annotations=data.annotations.filter(a=>a.routeId!==withdrawn.id);
  const result=comparisonRow(createCatalog(data),withdrawn.id,id,r.analysis);
  assert.equal(result.status,'unavailable'); assert.equal(result.analysis,undefined);
  assert.equal(comparisonScales([result]),null);
  assert.equal(variantDelta(rows[0],rows.find(r=>r.variant.dayId!==rows[0].variant.dayId)),null);
});
test('comparison modes preserve revision-pinned chapter links and consent URL validation',()=>{
  const row=rows[0], chapter=row.analysis.chapters[1];
  for (const view of ['compare','skyline','radial']) {
    const href=selectionLink({area:'explore',view,routeId:row.route.id,revisionId:row.bundle.revision.id,
      chapterId:chapter.id,distanceM:chapter.startM});
    const restored=readSelection(href,catalog,Object.fromEntries(analyses));
    assert.equal(restored.code,'ready'); assert.equal(restored.state.view,view);
    assert.equal(restored.state.chapterId,chapter.id); assert.equal(restored.state.distanceM,chapter.startM);
    assert.ok(validatePreferenceLink(href));
  }
});
test('reviewed POI keeps its source and exact occurrence in radial, linear and briefing links',()=>{
  const base=rows[0], original=base.analysis, pointIndex=50;
  const identity={routeId:base.route.id,revisionId:base.bundle.revision.id,
    geometrySha256:base.bundle.revision.geometrySha256};
  const a=analyzeRoute({...identity,points:original.points,
    annotationSet:{revisionId:'test-reviewed-v1',source:'Synthetic test evidence',records:[{
      ...identity,id:'test-water',kind:'water',text:'Synthetic reviewed water',
      confidence:'verified',approval:'approved',source:{name:'Synthetic test evidence',observedOn:'2026-11-24'},
      anchor:{pointIndex},
    }]}});
  const poi=a.annotations.pois[0], row=comparisonRow(catalog,base.route.id,base.bundle.revision.id,a);
  assert.equal(poi.distanceM,original.points[pointIndex].distanceM);
  assert.equal(poi.source.name,'Synthetic test evidence'); assert.equal(poi.confidence,'verified');
  const position=positionAt(a,poi.distanceM), scale=comparisonScales(rows);
  assert.ok(radialPoint(poi.distanceM,position.processedElevationM,row,scale).every(Number.isFinite));
  assert.equal(profilePoint({distanceM:poi.distanceM,elevationM:position.processedElevationM},row,scale)[0],
    poi.distanceM/scale.distanceM);
  const href=selectionLink({area:'explore',view:'briefing',routeId:row.route.id,
    revisionId:row.bundle.revision.id,chapterId:null,distanceM:poi.distanceM});
  const restored=readSelection(href,catalog,{[row.bundle.revision.id]:a});
  assert.ok(Math.abs(restored.state.distanceM-poi.distanceM)<.001);
  assert.equal(restored.state.chapterId,null);
});
