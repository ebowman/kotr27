import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readRoutePack } from '../tools/route-pack.mjs';
import { analyzeRoute } from '../js/route-analysis.mjs';
import { createAnalysisStore } from '../js/trip-planner.mjs';
import { briefingAt, outlineProjection, sectionSummary } from '../js/route-briefing.mjs';
import { createAnalysisPlaybackRoute } from '../js/route-playback-adapters.mjs';
import { createRoutePlayback } from '../js/route-playback.mjs';
import { estimateRouteTime } from '../js/route-time.mjs';
const synthetic = points => analyzeRoute({routeId:'test-route',revisionId:'test-revision',
  geometrySha256:'a'.repeat(64),points});

test('real seven-route briefings share verification, preserve extreme grades and disclose no POIs', async () => {
  const {pack}=await readRoutePack('.');
  let reads=0, unsupportedTime=0;
  const load=createAnalysisStore(pack,async path=>{reads++;return readFile(path);});
  for (const route of pack.catalog.routes) {
    const [a,b]=await Promise.all([load(route.id,route.currentRevisionId),load(route.id,route.currentRevisionId)]);
    assert.equal(a,b);
    const c=createRoutePlayback({loadRoute:()=>createAnalysisPlaybackRoute(a,{estimate:estimateRouteTime(a)})});
    await c.selectRoute({routeId:route.id,revisionId:route.currentRevisionId});
    for (const d of [0,a.distanceM/2,a.distanceM-.01,a.distanceM]) {
      const snap=c.seekDistance(d), briefing=briefingAt(a,d);
      assert.equal(briefing.remainingM,a.distanceM-d);
      assert.equal(briefing.current.id,snap.chapterId);
      assert.equal(briefing.poi,null);
      assert.match(sectionSummary(a,briefing.current),/derived, 250 m windows; not verified road grade/);
      if (briefing.hardest) assert.equal(briefing.hardest.ascentM,Math.max(...a.climbs.map(c=>c.ascentM)));
      c.setCameraMode('cinematic');
      assert.deepEqual(c.getSnapshot().position,snap.position);
    }
    assert.equal(briefingAt(a,a.distanceM).next,null);
    if (c.getSnapshot().estimatedRide.status==='unavailable') {
      unsupportedTime++;
      assert.ok(a.windows.some(w=>Math.abs(w.gradePercent)>50));
      assert.equal(c.play().phase,'playing');
    }
  }
  assert.equal(reads,14,'one pair of verified assets per route, not a second seven-route load');
  assert.equal(unsupportedTime,1);
});

test('out-and-back and closed loop retain riding-order occurrences and near-finish feature queries', () => {
  const a=synthetic(Array.from({length:21},(_,i)=>({
    lat:45+(i<=10 ? i : 20-i)*.001,lon:11,elevationM:100+(i<=10 ? i : 20-i)*10,
  })));
  assert.equal(a.status,'supported');
  const project=outlineProjection(a.points);
  assert.deepEqual(project(a.points[0]),project(a.points.at(-1)));
  assert.equal(briefingAt(a,0).current.kind,'ascent');
  assert.equal(briefingAt(a,a.distanceM).current.kind,'descent');
  assert.equal(briefingAt(a,a.distanceM-.001).next,null);
  assert.equal(briefingAt(a,a.distanceM).remainingM,0);
  const unsupported=synthetic([{lat:45,lon:11,elevationM:null},{lat:45.001,lon:11,elevationM:null}]);
  assert.equal(briefingAt(unsupported,0).status,'unsupported');
  assert.match(briefingAt(unsupported,0).message,/No substitute/);
});

test('accepted sourced POI distance is occurrence-bound, no later verified feature at finish', () => {
  const points=Array.from({length:21},(_,i)=>({lat:45+i*.001,lon:11,elevationM:100+i*10}));
  const a=analyzeRoute({routeId:'test-route',revisionId:'test-revision',geometrySha256:'a'.repeat(64),points,
    annotationSet:{revisionId:'reviewed-v1',source:'Synthetic test evidence',records:[{
      id:'test-viewpoint',routeId:'test-route',revisionId:'test-revision',geometrySha256:'a'.repeat(64),
      kind:'viewpoint',text:'Synthetic reviewed viewpoint',source:{name:'Synthetic test evidence',observedOn:'2026-11-24'},
      confidence:'verified',approval:'approved',anchor:{pointIndex:10},
    }]}});
  const b=briefingAt(a,100);
  assert.equal(b.poi.distanceM,a.points[10].distanceM);
  assert.equal(b.poi.source.name,'Synthetic test evidence');
  assert.equal(briefingAt(a,a.distanceM).poi,null);
});

test('stale verified route responses cannot install old briefing position', async () => {
  const a=synthetic(Array.from({length:10},(_,i)=>({lat:45+i*.001,lon:11,elevationM:100+i*10})));
  const older=Promise.withResolvers(), newer=Promise.withResolvers();
  const c=createRoutePlayback({loadRoute:({revisionId})=>revisionId==='old' ? older.promise : newer.promise});
  const old=c.selectRoute({routeId:'test-route',revisionId:'old'});
  const next=c.selectRoute({routeId:'test-route',revisionId:'new'});
  const route=revisionId=>({...createAnalysisPlaybackRoute(a),
    identity:{...a.identity,revisionId}});
  newer.resolve(route('new')); await next;
  const snapshot=c.getSnapshot();
  older.resolve(route('old')); await old;
  assert.equal(c.getSnapshot(),snapshot);
  assert.equal(c.getSnapshot().identity.revisionId,'new');
});
