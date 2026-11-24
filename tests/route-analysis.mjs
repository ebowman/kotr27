import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { analyzeRoute, distanceWindows, chapterAt, positionAt, profileWindow, nextFeatures } from '../js/route-analysis.mjs';
import { loadRouteAnalysis } from '../js/route-analysis-loader.mjs';
import { deriveProfile, readExampleTrack } from '../js/semonzo-profile.mjs';
import { estimateAscent } from '../js/ascent-estimator.mjs';
import { readRoutePack, validatePack } from '../tools/route-pack.mjs';
import { verifyAsset } from '../js/route-catalog.mjs';

const binding = {routeId:'fixture',revisionId:'fixture-v1',geometrySha256:'a'.repeat(64)};
const deg = m=>m/6371000*180/Math.PI;
const p = (m,z=100)=>({lat:0,lon:deg(m),elevationM:z});
const line = (length=2000,rise=100)=>Array.from({length:length/100+1},(_,i)=>p(i*100,100+rise*i*100/length));
const analyze = (points,options={})=>analyzeRoute({...binding,points,...options});
const near = (a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
const annotation = (id,anchor,patch={})=>({id,...binding,kind:'water',text:'Synthetic fixture only',
  source:{name:'Synthetic organizer evidence',observedOn:'2026-11-24'},confidence:'verified',
  approval:'approved',anchor,...patch});
const set = records=>({revisionId:'fixture-annotations-v1',source:'Synthetic test evidence, not actual facilities',records});

test('ascent uses one full-precision axis, windows, chapters and climb contract',()=>{
  const input=line(), a=analyze(input,{sourceTotals:{listed:{distanceM:2001,gainM:120}}});
  assert.equal(a.status,'supported');
  near(a.distanceM,2000);
  near(a.rawTotals.ascentM,100); near(a.processedTotals.ascentM,100);
  assert.equal(a.processedTotals.descentM,0);
  assert.equal(a.chapters.length,1); assert.equal(a.climbs.length,1);
  assert.equal(a.windows.length,8);
  assert.equal(a.chapters[0].kind,'ascent');
  near(a.climbs[0].gradePercent,5);
  assert.equal(a.sourceTotals.listed.gainM,120,'source gain is not a calibration target');
  const all=profileWindow(a,0,a.distanceM);
  assert.deepEqual(all.windows,a.windows);
  near(all.totals.ascentM,a.processedTotals.ascentM);
  assert.deepEqual(chapterAt(a,1000).identity,a.identity);
  assert.deepEqual(positionAt(a,1000).identity,a.identity);
  assert.deepEqual(nextFeatures(a,0,{kinds:['climb']}).features[0],{...a.climbs[0],distanceM:0});
  assert.ok(Object.isFrozen(a.points[0]));
  input[1].elevationM=999;
  assert.notEqual(a.points[1].elevationM,999,'consumer snapshot cannot drift with input mutation');
});

test('full loop retains ordered distance and both signed directions, not start/end chord',()=>{
  const points=[];
  for (let side=0;side<4;side++) for(let i=0;i<10;i++) {
    const x=[i*100,1000,1000-i*100,0][side], y=[0,i*100,1000,1000-i*100][side];
    const d=side*1000+i*100;
    points.push({lat:deg(y),lon:deg(x),elevationM:100+Math.min(d,4000-d)*0.05});
  }
  points.push({...points[0]});
  const a=analyze(points);
  assert.equal(a.status,'supported'); near(a.distanceM,4000,0.0001);
  near(a.rawTotals.ascentM,100); near(a.rawTotals.descentM,100);
  assert.deepEqual(a.chapters.map(c=>c.kind),['ascent','descent']);
  assert.ok(a.windows.some(w=>w.gradePercent<0));
  assert.equal(a.climbs.length,1);
  assert.equal(positionAt(a,a.distanceM).chapterId,a.chapters.at(-1).id);
  assert.equal(nextFeatures(a,a.distanceM).features.length,0);
});

test('out-and-back coordinate ambiguity is explicit; index/distance choose an occurrence',()=>{
  const outward=line(), points=[...outward,...outward.slice(0,-1).reverse()];
  const a=analyze(points,{annotationSet:set([
    annotation('ambiguous',{lat:0,lon:deg(1000)}),
    annotation('outbound',{lat:0,lon:deg(1000),pointIndex:10}),
    annotation('inbound',{pointIndex:30}),
    annotation('start-or-end',{lat:0,lon:0}),
    annotation('distance',{distanceM:3000},{kind:'annotation'}),
  ])});
  near(a.distanceM,4000); near(a.rawTotals.ascentM,100); near(a.rawTotals.descentM,100);
  const [ambiguous,outbound,inbound,start,end]=a.annotations.bindings;
  assert.equal(ambiguous.reason,'ambiguous-coordinate');
  assert.deepEqual(ambiguous.candidatePointIndexes,[10,30]);
  assert.deepEqual(start.candidatePointIndexes,[0,40]);
  near(outbound.distanceM,1000); near(inbound.distanceM,3000); near(end.distanceM,3000);
  assert.equal(a.annotations.pois.length,2);
  assert.equal(nextFeatures(a,2000,{kinds:['water']}).features[0].id,'inbound');
  near(positionAt(a,1000).lon,positionAt(a,3000).lon);
  assert.notDeepEqual(positionAt(a,1000).pointIndexes,positionAt(a,3000).pointIndexes);
});

test('flat and shallow signed terrain stays signed, without invented climbs or stops',()=>{
  for (const rise of [0,5,-5]) {
    const a=analyze(line(2000,rise));
    assert.equal(a.chapters[0].kind,'flat');
    assert.equal(a.climbs.length,0);
    near(a.processedTotals.netRiseM,rise);
    near(a.processedTotals.ascentM,Math.max(0,rise));
    near(a.processedTotals.descentM,Math.max(0,-rise));
    assert.deepEqual(a.annotations.pois,[]);
    assert.equal(a.annotations.poiStatus,'none-verified');
    assert.match(a.annotations.source,/No organizer/);
  }
});

test('smoothing is labeled and raw undulations remain visible, never tuned to listed gain',()=>{
  const points=line();
  points[1].elevationM+=80;
  const a=analyze(points,{sourceTotals:{listed:{gainM:42}}});
  assert.ok(a.rawTotals.ascentM>a.processedTotals.ascentM);
  assert.equal(a.points[1].elevationM,185);
  assert.equal(a.sourceTotals.listed.gainM,42);
  assert.equal(a.rawTotals.basis,'adjacent-published-points-unsmoothed');
  assert.equal(a.processedTotals.basis,a.recipe);
});

test('missing elevation, gaps, discontinuities and duplicates never bridge or flatten',()=>{
  const cases=[
    ['missing-or-invalid-elevation',points=>{points[4].elevationM=null;}],
    ['missing-or-invalid-elevation',points=>{delete points[4].elevationM;}],
    ['missing-or-invalid-elevation',points=>{points[4].elevationM=NaN;}],
    ['gap',points=>points.splice(2,7)],
    ['discontinuity',points=>{points[4].breakBefore=true;}],
    ['duplicate-position',points=>{points[4]={...points[3]};}],
    ['duplicate-position',points=>{points[4]={...points[3],elevationM:999};}],
    ['invalid-coordinate',points=>{points[4].lat=91;}],
  ];
  for (const [code,edit] of cases) {
    const points=line(); edit(points); const a=analyze(points);
    assert.equal(a.status,'unsupported',code);
    assert.ok(a.issues.some(i=>i.code===code),code);
    assert.equal(a.processedTotals,null); assert.equal(a.rawTotals.ascentM,null);
    assert.deepEqual(a.windows,[]); assert.deepEqual(a.chapters,[]); assert.deepEqual(a.climbs,[]);
    for (const result of [positionAt(a,0),chapterAt(a,0),profileWindow(a,0,500),nextFeatures(a,0)])
      assert.equal(result.status,'unsupported');
    if (code==='missing-or-invalid-elevation') {
      near(a.distanceM,2000); assert.equal(a.points[4].elevationM,null);
    } else {
      assert.equal(a.distanceM,null);
      assert.ok(a.points.some(p=>p.distanceM===null));
    }
  }
  for (const points of [[],[p(0)]]) assert.equal(analyze(points).issues[0].code,'insufficient-points');
});

test('sparse support boundary is explicit and exact duplicate input is not silently discarded',()=>{
  const sparse=analyze([p(0),p(300,120),p(600,150)]);
  assert.equal(sparse.status,'supported');
  assert.equal(sparse.warnings.length,2);
  assert.equal(sparse.points.length,3);
  near(sparse.distanceM,600);
  const gap=analyze([p(0),p(501,120)]);
  assert.equal(gap.issues[0].code,'gap');
  assert.equal(gap.processedTotals,null);
});

test('distance windows merge short finish and queries clip without resmoothing',()=>{
  const windows=distanceWindows([{distanceM:0,elevationM:100},{distanceM:1120,elevationM:212}]);
  assert.deepEqual(windows.map(w=>w.endM-w.startM),[250,250,250,370]);
  assert.equal(distanceWindows([{distanceM:0,elevationM:100},{distanceM:120,elevationM:112}]).length,1);
  const a=analyze(line());
  const clipped=profileWindow(a,125,600);
  assert.deepEqual(clipped.windows.map(w=>[w.startM,w.endM]),[[125,250],[250,500],[500,600]]);
  near(clipped.totals.distanceM,475); near(clipped.totals.ascentM,23.75);
  near(positionAt(a,125).processedElevationM,106.25);
  for(const distance of [-1,NaN,Infinity,'10',a.distanceM+1]) assert.throws(()=>positionAt(a,distance),RangeError);
  assert.throws(()=>profileWindow(a,500,500),RangeError);
  assert.throws(()=>nextFeatures(a,0,{limit:0}),RangeError);
  assert.throws(()=>distanceWindows([{distanceM:0,elevationM:0},{distanceM:0,elevationM:10}]),/Unsupported/);
});

test('chapter boundary is half-open and descents/flat sections interrupt climb intervals',()=>{
  const points=line(4000,0).map((p,i)=>({...p,elevationM:i<10 ? 100+i*5 :
    i<20 ? 150 : i<30 ? 150-(i-20)*5 : 100+(i-30)*5}));
  const a=analyze(points);
  assert.deepEqual(a.chapters.map(c=>c.kind),['ascent','flat','descent','ascent']);
  assert.equal(a.climbs.length,2);
  const boundary=a.chapters[1].startM;
  assert.equal(chapterAt(a,boundary).chapter.id,a.chapters[1].id);
  assert.equal(chapterAt(a,boundary-0.01).chapter.id,a.chapters[0].id);
  assert.equal(chapterAt(a,a.distanceM).chapter.id,a.chapters.at(-1).id);
});

test('annotation approval, source/confidence, mismatches and revision invalidation fail closed',()=>{
  const records=[
    annotation('valid',{pointIndex:10}),
    annotation('unverified',{pointIndex:10},{confidence:'unverified'}),
    annotation('pending',{pointIndex:10},{approval:'pending'}),
    annotation('missing-source',{pointIndex:10},{source:null}),
    annotation('bad-date',{pointIndex:10},{source:{name:'Fixture',observedOn:'2026-02-31'}}),
    annotation('other-route',{pointIndex:10},{routeId:'other'}),
    annotation('other-rev',{pointIndex:10},{revisionId:'fixture-v0'}),
    annotation('other-geometry',{pointIndex:10},{geometrySha256:'b'.repeat(64)}),
    annotation('off-route',{lat:1,lon:1}),
    annotation('contradiction',{pointIndex:10,lat:0,lon:0}),
    annotation('too-far',{distanceM:1e6}),
    annotation('exit',{pointIndex:10},{kind:'safe-emergency-exit'}),
  ];
  const a=analyze(line(),{annotationSet:set(records)});
  assert.equal(a.annotations.pois.length,1);
  assert.deepEqual(a.annotations.pois[0].source,records[0].source);
  assert.equal(a.annotations.pois[0].confidence,'verified');
  assert.deepEqual(a.annotations.bindings.slice(1).map(a=>a.status),
    ['unverified','unverified','unsupported','unsupported','needs-review','needs-review','needs-review',
      'unsupported','unsupported','unsupported','unsupported']);
  // Same coordinates still do not grant permission to carry bindings forward.
  const revised=analyze(line(),{revisionId:'fixture-v2',geometrySha256:'b'.repeat(64),annotationSet:set(records.slice(0,1))});
  assert.equal(revised.annotations.bindings[0].status,'needs-review');
  assert.equal(revised.annotations.bindings[0].distanceM,null);
  assert.deepEqual(revised.annotations.pois,[]);
  assert.deepEqual(nextFeatures(revised,0,{kinds:['water']}).features,[]);
  const reapproved=analyze(line(),{revisionId:'fixture-v2',geometrySha256:'b'.repeat(64),
    annotationSet:{...set([annotation('reviewed',{pointIndex:10},
      {revisionId:'fixture-v2',geometrySha256:'b'.repeat(64)})]),revisionId:'fixture-annotations-v2'}});
  assert.equal(reapproved.annotations.pois.length,1);
  assert.notDeepEqual(a.identity,reapproved.identity);
  const annotationOnly=analyze(line(),{annotationSet:{
    ...set([annotation('reviewed-new-text',{pointIndex:10})]),revisionId:'fixture-annotations-v2'}});
  assert.notDeepEqual(a.identity,annotationOnly.identity);
  assert.deepEqual(a.windows,annotationOnly.windows,'annotation-only revisions do not recalculate a different axis');
});

test('unique coordinate anchors bind only to reviewed vertices, all approved feature kinds query in order',()=>{
  const kinds=['feed','water','toilet','caution','viewpoint','annotation'];
  const a=analyze(line(),{annotationSet:set(kinds.map((kind,i)=>annotation(kind,
    i===0 ? {lat:0,lon:deg(100)} : {pointIndex:(i+1)*2},{kind})))});
  const features=nextFeatures(a,0,{kinds,limit:10}).features;
  assert.deepEqual(features.map(f=>f.kind),kinds);
  assert.ok(features.every(f=>f.status==='bound' && f.source.name==='Synthetic organizer evidence'));
  const b=analyze(line(),{annotationSet:set([annotation('not-vertex',{lat:0,lon:deg(150)})])});
  assert.equal(b.annotations.bindings[0].reason,'coordinate-not-on-vertex');
});

test('position interpolation follows the short arc across the antimeridian',()=>{
  const a=analyze([{lat:0,lon:179.999,elevationM:100},{lat:0,lon:-179.999,elevationM:110}]);
  assert.equal(a.status,'supported');
  near(Math.abs(positionAt(a,a.distanceM/2).lon),180);
});

const source = await readRoutePack(fileURLToPath(new URL('../',import.meta.url)));
const load = (row,options={})=>loadRouteAnalysis({pack:source.pack,routeId:row.routeId,revisionId:row.revisionId,
  readAsset:async path=>source.files.get(path),...options});
test('all seven approved routes reuse raw revision axes, retain source discrepancies and no real POIs',async()=>{
  // Recipe regression values, NOT provider truth or calibrated elevation.
  const processed = {
    'rwgps-57873019':[1756.1725194085893,4], 'rwgps-57873112':[707.3120161650891,4],
    'rwgps-57873183':[997.5380454304126,4], 'rwgps-57874024':[1789.4349667044899,8],
    'rwgps-57874050':[680.7416767669963,1], 'rwgps-57874076':[1722.660921830711,9],
    'rwgps-57874121':[82.97274681270197,0],
  };
  let count=0;
  for(const row of source.pack.routes) {
    const a=await load(row); count+=a.points.length;
    assert.equal(a.status,'supported',row.routeId);
    assert.equal(a.revisionId,row.revisionId);
    near(a.distanceM,row.computed.horizontalDistanceM,0.000001);
    near(a.rawTotals.ascentM,row.computed.rawGainM,0.000001);
    near(a.rawTotals.descentM,row.computed.rawLossM,0.000001);
    assert.ok(a.rawTotals.ascentM>a.sourceTotals.listed.gainM);
    assert.equal(a.sourceTotals.fitEncodedDistanceM,row.fitEncodedDistanceM);
    assert.ok(a.processedTotals.ascentM<a.rawTotals.ascentM);
    near(a.processedTotals.ascentM,processed[row.routeId][0],0.000001);
    assert.equal(a.climbs.length,processed[row.routeId][1]);
    assert.equal(a.annotations.poiStatus,'none-verified');
    assert.deepEqual(a.annotations.bindings,[]);
    assert.ok(a.windows.some(w=>w.gradePercent<0));
    assert.ok(a.chapters.some(c=>c.kind==='flat'));
    let distance=0;
    for(const c of a.chapters) { assert.equal(c.startM,distance); distance=c.endM; }
    assert.equal(distance,a.distanceM);
    const interval=profileWindow(a,0,a.distanceM);
    near(interval.totals.ascentM,a.processedTotals.ascentM);
    const next=nextFeatures(a,0,{kinds:['climb'],limit:2000});
    assert.deepEqual(next.features.map(f=>f.id),a.climbs.map(c=>c.id));
    assert.deepEqual(next.identity,a.identity);
    assert.deepEqual(await load(row),a,'same verified inputs are deterministic');
  }
  assert.equal(count,38766);
});

test('loader rejects stale pins and tampered bytes',async()=>{
  const row=source.pack.routes[0];
  await assert.rejects(load(row,{revisionId:'unavailable-v0'}),/revision unavailable/);
  await assert.rejects(load(row,{revisionId:undefined}),/Explicit revision/);
  await assert.rejects(load(row,{readAsset:async path=>Buffer.concat([source.files.get(path),Buffer.from('x')])}),/bytes do not match/);
});

// Rehash BOTH the profile reference/content path and the manifest. Each graph
// has valid byte hashes: these must fail for semantics, not an earlier hash error.
for (const [name,edit,match] of [
  ['matching but unsupported distance semantics',({revision,raw})=>{
    revision.distanceSemantics=raw.distanceSemantics='source-reported';
  }, /unsupported or stale derivation/],
  ['unsupported profile semantics',({raw})=>{raw.distanceSemantics='source-reported';}, /unsupported profile recipe/],
  ['negative source gain',({summary})=>{summary.listed.gainM=-1;}, /invalid source-listed totals/],
  ['negative source distance',({summary})=>{summary.listed.distanceM=-1;}, /invalid source-listed totals/],
  ['extra contradictory summary',({pack,summary})=>{
    pack.routes.push({...structuredClone(summary),listed:{distanceM:1,gainM:1}});
  }, /summary inventory mismatch/],
  ['duplicate contradictory summary with unchanged inventory size',({pack,summary})=>{
    pack.routes[1]={...structuredClone(summary),listed:{distanceM:1,gainM:1}};
  }, /duplicate route summary/],
  ['unknown profile fields',({raw})=>{raw.unreviewedField=true;}, /profile: unexpected\/missing fields/],
  ['unknown summary fields',({summary})=>{summary.unreviewedField=true;}, /route summary: unexpected\/missing fields/],
  ['contradictory point count',({summary})=>{summary.pointCount++;}, /summary differs from pinned profile/],
  ['contradictory profile sample',({raw})=>{raw.samples[10][1]++;}, /not derived from pinned geometry/],
  ['contradictory gap report',({raw})=>{raw.gaps.over200m++;}, /gap report mismatch/],
  ...[
    ['gap maximum',raw=>raw.gaps,'maxM',/invalid gap metadata/],
    ['gap count',raw=>raw.gaps,'over200m',/invalid gap metadata/],
    ['sample distance',raw=>raw.samples[10],0,/not derived from pinned geometry/],
    ['sample elevation',raw=>raw.samples[10],1,/not derived from pinned geometry/],
    ...['horizontalDistanceM','rawGainM','rawLossM'].map(key=>
      [`profile total ${key}`,raw=>raw.totals,key,/invalid totals/]),
  ].flatMap(([field,select,key,match])=>[
    ['numeric string',String],['single-element array',value=>[value]],
  ].map(([type,convert])=>[`${field} as ${type}`,({raw})=>{
    const target=select(raw);
    target[key]=convert(target[key]);
  },match])),
  ...[null,false,true,'',[],{},-1,501].map(value=>[
    `invalid gap maximum ${JSON.stringify(value)}`,
    ({raw})=>{raw.gaps.maxM=value;}, /invalid gap metadata/,
  ]),
  ['unsupported source format',({summary})=>{summary.source.format='other';}, /invalid source provenance/],
  ['unsupported availability claim',({summary})=>{summary.availability.fit='available';}, /unreviewed formats/],
]) {
  test(`loader and release reject rehashed graph: ${name}`,async()=>{
    const row=source.pack.routes[0], pack=structuredClone(source.pack);
    const revision=pack.catalog.routes.find(r=>r.id===row.routeId).revisions[0];
    const summary=pack.routes.find(r=>r.routeId===row.routeId);
    const raw=JSON.parse(source.files.get(revision.profile.path));
    edit({pack,revision,summary,raw});
    const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
    const profileBytes=Buffer.from(JSON.stringify(raw));
    revision.profile.sha256=hash(profileBytes);
    revision.profile.path=`assets/route-profile-${revision.profile.sha256}.json`;
    const manifestBytes=Buffer.from(JSON.stringify(pack));
    const pointer={schemaVersion:1,sha256:hash(manifestBytes),
      path:`assets/route-manifest-${hash(manifestBytes)}.json`};
    await verifyAsset(pointer,manifestBytes);
    await verifyAsset(revision.profile,profileBytes);
    const verifiedPack=JSON.parse(manifestBytes);
    const read=async path=>path===revision.profile.path ? profileBytes : source.files.get(path);
    let releaseError;
    await assert.rejects(validatePack(verifiedPack,{read}),error=>{
      releaseError=error.message;
      assert.match(releaseError,match);
      return true;
    });
    await assert.rejects(load(row,{pack:verifiedPack,readAsset:read}),error=>{
      assert.equal(error.message,releaseError,'runtime and release enforce the same producer rule');
      return true;
    });
  });
}

test('valid seven-route graph loads selected assets only through browser byte types',async()=>{
  for (const row of source.pack.routes) {
    const revision=source.pack.catalog.routes.find(r=>r.id===row.routeId).revisions[0];
    const reads=[];
    const a=await load(row,{readAsset:async path=>{
      reads.push(path);
      const bytes=Uint8Array.from(source.files.get(path));
      return reads.length===1 ? bytes.buffer : bytes;
    }});
    assert.deepEqual(reads,[revision.geometry.path,revision.profile.path]);
    assert.equal(a.status,'supported');
    assert.equal(a.points.length,row.pointCount);
    near(a.distanceM,row.computed.horizontalDistanceM,0.000001);
  }
});

test('source Semonzo adapter is byte-for-number equivalent to existing chapter/model contract',async()=>{
  const gpx=await readFile(new URL('../assets/semonzo.gpx',import.meta.url),'utf8');
  // Minimal DOM facade exercises pure adapter logic; real DOMParser is also
  // exercised by the existing rider-controls/release browser regressions.
  const points=[...gpx.matchAll(/<trkpt lon="([^"]+)" lat="([^"]+)">[\s\S]*?<ele>([^<]+)<\/ele>[\s\S]*?<\/trkpt>/g)]
    .map(([,lon,lat,z])=>({getAttribute:key=>({lat,lon}[key]),querySelector:()=>({textContent:z})}));
  const xml={querySelectorAll:()=>[{querySelectorAll:()=>points}]};
  const profile=deriveProfile(xml);
  const reference=JSON.parse(await readFile(new URL('../assets/semonzo-chapters.v1.json',import.meta.url)));
  assert.equal(readExampleTrack(xml).length,1034);
  assert.deepEqual(profile.segments,reference.segments);
  assert.deepEqual(profile.chapters,reference.chapters);
  assert.equal(profile.distanceM,reference.distanceM);
  assert.deepEqual(estimateAscent(profile),estimateAscent(reference));
});
