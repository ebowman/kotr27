/**
 * Pure, revision-bound route analysis. Metres / percent, never elapsed time.
 * The recipe is an interpretation, not a correction of source elevation.
 * See docs/route-analysis.md for unsupported states and numerical tolerances.
 */
export const analysisRecipe = 'route-distance-windows-250m-v1';
export const analysisPolicy = Object.freeze({
  windowM:250, maxGapM:500, sparseAboveM:200, flatGradePercent:0.5,
  climbMinDistanceM:500, climbMinGainM:30, climbMinGradePercent:3,
  coordinateToleranceM:1,
});
const finite = n => typeof n === 'number' && Number.isFinite(n);
const coordinate = p => p && finite(p.lat) && Math.abs(p.lat) <= 90 &&
  finite(p.lon) && Math.abs(p.lon) <= 180;
const elevation = n => finite(n) && n >= -500 && n <= 9000;
const text = s => typeof s === 'string' && s.trim().length > 0;
const date = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) &&
  Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s;
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export function horizontalDistanceM(a, b) {
  const [lat1, lon1, lat2, lon2] = [a.lat,a.lon,b.lat,b.lon].map(n => n*Math.PI/180);
  const h = Math.sin((lat2-lat1)/2)**2 +
    Math.cos(lat1)*Math.cos(lat2)*Math.sin((lon2-lon1)/2)**2;
  return 12742000*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));
}

/** Preserve order. After a discontinuity there is no invented cumulative axis. */
export function measureTrack(input) {
  if (!Array.isArray(input) || input.length > 100000) throw Error('Expected at most 100000 ordered points');
  const issues = [], warnings = [], points = [];
  let distance = 0, gain = 0, loss = 0, geometryOK = input.length >= 2, elevationOK = true;
  if (!geometryOK) issues.push({code:'insufficient-points'});
  for (let i=0; i<input.length; i++) {
    const p = input[i], prev = input[i-1];
    if (!coordinate(p)) { issues.push({code:'invalid-coordinate',pointIndex:i}); geometryOK = false; }
    if (!elevation(p?.elevationM)) {
      issues.push({code:'missing-or-invalid-elevation',pointIndex:i}); elevationOK = false;
    }
    if (i && coordinate(p) && coordinate(prev)) {
      const step = horizontalDistanceM(prev,p);
      const code = p.breakBefore ? 'discontinuity' : step === 0 ? 'duplicate-position' :
        step > analysisPolicy.maxGapM ? 'gap' : null;
      if (code) { issues.push({code,pointIndex:i,stepM:step}); geometryOK = false; }
      else {
        if (step > analysisPolicy.sparseAboveM) warnings.push({code:'sparse-interval',pointIndex:i,stepM:step});
        distance += step;
        if (elevation(p.elevationM) && elevation(prev.elevationM)) {
          gain += Math.max(0,p.elevationM-prev.elevationM);
          loss += Math.max(0,prev.elevationM-p.elevationM);
        }
      }
    }
    points.push({pointIndex:i,lat:finite(p?.lat) ? p.lat : null,lon:finite(p?.lon) ? p.lon : null,
      elevationM:elevation(p?.elevationM) ? p.elevationM : null,
      breakBefore:Boolean(p?.breakBefore),distanceM:geometryOK ? distance : null});
  }
  return {points,issues,warnings,geometryOK,elevationOK,
    totals:{distanceM:geometryOK ? distance : null,
      ascentM:geometryOK && elevationOK ? gain : null,
      descentM:geometryOK && elevationOK ? loss : null,
      netRiseM:geometryOK && elevationOK ? input.at(-1).elevationM-input[0].elevationM : null}};
}

/** Shared Semonzo/general window engine. No rounding and no statistical filter. */
export function distanceWindows(samples) {
  const windowM = analysisPolicy.windowM;
  if (!Array.isArray(samples) || samples.length < 2 || samples.length > 100000)
    throw Error('Invalid distance window input');
  samples.forEach((s,i) => {
    if (!finite(s.distanceM) || s.distanceM > 50000000 || !elevation(s.elevationM) ||
        (i === 0 ? s.distanceM !== 0 : s.distanceM <= samples[i-1].distanceM))
      throw Error('Unsupported distance/elevation samples');
  });
  const end = samples.at(-1).distanceM, windows = [];
  let i = 1, start = 0, z = samples[0].elevationM;
  while (start < end) {
    const next = end-start < 2*windowM-1e-8 ? end : start+windowM;
    while (samples[i].distanceM < next) i++;
    const lo = samples[i-1], hi = samples[i];
    const height = lo.elevationM + (next-lo.distanceM)/(hi.distanceM-lo.distanceM)*(hi.elevationM-lo.elevationM);
    windows.push({startM:start,endM:next,startElevationM:z,endElevationM:height});
    start = next; z = height;
  }
  return windows;
}
function metrics(windows) {
  const ascentM = windows.reduce((n,w)=>n+Math.max(0,w.endElevationM-w.startElevationM),0);
  const descentM = windows.reduce((n,w)=>n+Math.max(0,w.startElevationM-w.endElevationM),0);
  const distanceM = windows.reduce((n,w)=>n+w.endM-w.startM,0);
  const netRiseM = windows.at(-1).endElevationM-windows[0].startElevationM;
  return {distanceM,ascentM,descentM,netRiseM,gradePercent:100*netRiseM/distanceM};
}
const terrain = w => Math.abs(w.gradePercent) <= analysisPolicy.flatGradePercent ? 'flat' :
  w.gradePercent > 0 ? 'ascent' : 'descent';
function chaptersFrom(windows) {
  const chapters = [];
  for (const w of windows) {
    let c = chapters.at(-1);
    if (!c || c.kind !== terrain(w)) {
      c = {id:`chapter-${chapters.length+1}`,kind:terrain(w),startM:w.startM,windows:[]};
      chapters.push(c);
    }
    c.windows.push(w); w.chapterId = c.id;
  }
  return chapters.map(({windows:parts,...c})=>({...c,endM:parts.at(-1).endM,...metrics(parts),
    source:'derived-distance-windows',confidence:'derived'}));
}
const poiKinds = ['feed','water','toilet','caution','viewpoint'];

function bindAnnotations(analysis, set) {
  if (!set || !text(set.revisionId) || !text(set.source) || !Array.isArray(set.records) || set.records.length > 2000)
    throw Error('Expected a bounded, versioned annotation set with source');
  const ids = new Set();
  const bindings = set.records.map(a => {
    if (!a || !text(a.id) || ids.has(a.id)) throw Error('Invalid/duplicate annotation ID');
    ids.add(a.id);
    const string = s=>typeof s === 'string' ? s : null;
    const item = {id:a.id,kind:string(a.kind),text:string(a.text),
      source:a.source ? {name:string(a.source.name),observedOn:string(a.source.observedOn)} : null,
      confidence:string(a.confidence),routeId:string(a.routeId),revisionId:string(a.revisionId),
      geometrySha256:string(a.geometrySha256),distanceM:null};
    const result = (status,reason) => ({...item,status,reason});
    if (a.routeId !== analysis.routeId || a.revisionId !== analysis.revisionId ||
        a.geometrySha256 !== analysis.geometrySha256)
      return result('needs-review','revision-mismatch');
    if (!['annotation',...poiKinds].includes(a.kind) || !text(a.text) ||
        !text(a.source?.name) || !date(a.source?.observedOn) ||
        !['verified','unverified'].includes(a.confidence))
      return result('unsupported','invalid-source-or-annotation');
    if (a.approval !== 'approved' || a.confidence !== 'verified')
      return result('unverified','approval-or-confidence-unverified');
    if (analysis.status !== 'supported') return result('unsupported','route-analysis-unsupported');
    const anchor = a.anchor;
    if (!anchor || typeof anchor !== 'object') return result('unsupported','missing-position');
    const keys = Object.keys(anchor).sort().join(',');
    let distanceM, pointIndex;
    if (keys === 'distanceM') {
      if (!finite(anchor.distanceM) || anchor.distanceM < 0 || anchor.distanceM > analysis.distanceM)
        return result('unsupported','distance-out-of-range');
      distanceM = anchor.distanceM;
    } else if (['pointIndex','lat,lon,pointIndex'].includes(keys)) {
      pointIndex = anchor.pointIndex;
      if (!Number.isInteger(pointIndex) || !analysis.points[pointIndex])
        return result('unsupported','point-index-out-of-range');
      if (keys !== 'pointIndex' && (!coordinate(anchor) ||
          horizontalDistanceM(anchor,analysis.points[pointIndex]) > analysisPolicy.coordinateToleranceM))
        return result('unsupported','coordinate-anchor-mismatch');
      distanceM = analysis.points[pointIndex].distanceM;
    } else if (keys === 'lat,lon' && coordinate(anchor)) {
      const candidates = analysis.points.filter(p => horizontalDistanceM(anchor,p) <= analysisPolicy.coordinateToleranceM);
      if (candidates.length !== 1)
        return {...result('unsupported',candidates.length ? 'ambiguous-coordinate' : 'coordinate-not-on-vertex'),
          candidatePointIndexes:candidates.map(p=>p.pointIndex)};
      pointIndex = candidates[0].pointIndex; distanceM = candidates[0].distanceM;
    } else return result('unsupported','unsupported-anchor');
    return {...item,status:'bound',reason:null,distanceM,...(pointIndex === undefined ? {} : {pointIndex})};
  });
  return {revisionId:set.revisionId,source:set.source,
    status:bindings.some(a=>a.status==='bound') ? 'available' : 'none-verified',
    poiStatus:bindings.some(a=>a.status==='bound' && poiKinds.includes(a.kind)) ? 'available' : 'none-verified',
    bindings,annotations:bindings.filter(a=>a.status==='bound' && a.kind==='annotation'),
    pois:bindings.filter(a=>a.status==='bound' && poiKinds.includes(a.kind))};
}

/** Callers supply verified bytes/identity; loadRouteAnalysis is the pack boundary. */
export function analyzeRoute({routeId,revisionId,geometrySha256,points,sourceTotals=null,
  annotationSet={revisionId:'none-verified-v1',source:'No organizer annotations or facility POIs verified; navigation cues are not facility evidence.',records:[]}}) {
  if (!text(routeId) || !text(revisionId) || !/^[a-f0-9]{64}$/.test(geometrySha256))
    throw Error('Revision and geometry identity required');
  const measured = measureTrack(points);
  const supported = measured.geometryOK && measured.elevationOK;
  const windows = supported ? distanceWindows(measured.points).map(w=>({...w,
    gradePercent:100*(w.endElevationM-w.startElevationM)/(w.endM-w.startM)})) : [];
  const chapters = chaptersFrom(windows);
  const climbs = chapters.filter(c=>c.kind === 'ascent' && c.distanceM >= analysisPolicy.climbMinDistanceM &&
    c.ascentM >= analysisPolicy.climbMinGainM && c.gradePercent >= analysisPolicy.climbMinGradePercent)
    .map(c=>({...c,id:`climb-${c.id}`,chapterId:c.id,kind:'climb'}));
  const analysis = {schemaVersion:1,recipe:analysisRecipe,routeId,revisionId,geometrySha256,
    units:{distance:'m',elevation:'m',grade:'percent'},distanceSemantics:'horizontal-haversine-6371000m',
    policy:analysisPolicy,status:supported ? 'supported' : 'unsupported',
    issues:measured.issues,warnings:measured.warnings,distanceM:measured.totals.distanceM,
    sourceTotals:sourceTotals === null ? null : structuredClone(sourceTotals),
    rawTotals:{basis:'adjacent-published-points-unsmoothed',...measured.totals},
    processedTotals:supported ? {basis:analysisRecipe,...metrics(windows)} : null,
    points:measured.points,windows,chapters,climbs};
  analysis.annotations = bindAnnotations(analysis,annotationSet);
  analysis.identity = {routeId,revisionId,geometrySha256,recipe:analysisRecipe,annotationRevisionId:annotationSet.revisionId};
  return freeze(analysis);
}

function query(analysis, distanceM) {
  if (analysis.status !== 'supported') return {status:'unsupported',identity:analysis.identity,issues:analysis.issues};
  if (!finite(distanceM) || distanceM < 0 || distanceM > analysis.distanceM)
    throw RangeError('Position outside revision distance');
  return null;
}
/** Half-open chapter ownership, with the finish owned by the last chapter. */
export function chapterAt(analysis, distanceM) {
  const unsupported = query(analysis,distanceM);
  if (unsupported) return unsupported;
  return {status:'supported',identity:analysis.identity,
    chapter:analysis.chapters.find(c=>distanceM >= c.startM && distanceM < c.endM) ?? analysis.chapters.at(-1)};
}
function bracket(points, distanceM) {
  let lo=0, hi=points.length-1;
  while (hi-lo > 1) {
    const mid = Math.floor((lo+hi)/2);
    if (points[mid].distanceM < distanceM) lo=mid; else hi=mid;
  }
  return [points[lo],points[hi]];
}
/** Position is distance/order-based, never inferred from nearest coordinates. */
export function positionAt(analysis, distanceM) {
  const unsupported = query(analysis,distanceM);
  if (unsupported) return unsupported;
  const [a,b] = bracket(analysis.points,distanceM);
  const fraction = (distanceM-a.distanceM)/(b.distanceM-a.distanceM);
  const mix = (x,y)=>x+fraction*(y-x);
  // Use the short longitude arc at the antimeridian.
  const lonDelta = ((b.lon-a.lon+540)%360)-180;
  const w = analysis.windows.find(w=>distanceM < w.endM) ?? analysis.windows.at(-1);
  return {status:'supported',identity:analysis.identity,distanceM,pointIndexes:[a.pointIndex,b.pointIndex],
    lat:mix(a.lat,b.lat),lon:((a.lon+fraction*lonDelta+540)%360)-180,
    rawElevationM:mix(a.elevationM,b.elevationM),
    processedElevationM:w.startElevationM+(distanceM-w.startM)/(w.endM-w.startM)*(w.endElevationM-w.startElevationM),
    chapterId:chapterAt(analysis,distanceM).chapter.id};
}
/** Clip the SAME processed windows, not a new smoothing pass anchored at startM. */
export function profileWindow(analysis, startM, endM) {
  const unsupported = query(analysis,startM);
  if (unsupported) return unsupported;
  query(analysis,endM);
  if (endM <= startM) throw RangeError('Expected increasing profile interval');
  const windows = analysis.windows.filter(w=>w.endM>startM && w.startM<endM).map(w=>{
    const at = x=>w.startElevationM+(x-w.startM)/(w.endM-w.startM)*(w.endElevationM-w.startElevationM);
    const start = Math.max(startM,w.startM), end = Math.min(endM,w.endM);
    return {...w,startM:start,endM:end,startElevationM:at(start),endElevationM:at(end)};
  });
  return {status:'supported',identity:analysis.identity,windows,totals:metrics(windows)};
}
/** Features starting at/after the position, stable ties; no inferred safe exits. */
export function nextFeatures(analysis, distanceM, {kinds=['chapter','climb',...poiKinds,'annotation'],limit=1} = {}) {
  const unsupported = query(analysis,distanceM);
  if (unsupported) return unsupported;
  if (!Number.isInteger(limit) || limit < 1 || limit > 2000 || !Array.isArray(kinds) ||
      kinds.some(k=>!['chapter','climb',...poiKinds,'annotation'].includes(k)))
    throw RangeError('Invalid feature query');
  const features = [
    ...analysis.chapters.map(c=>({...c,terrain:c.kind,kind:'chapter',distanceM:c.startM})),
    ...analysis.climbs.map(c=>({...c,distanceM:c.startM})),
    ...analysis.annotations.annotations,...analysis.annotations.pois,
  ].filter(f=>kinds.includes(f.kind) && f.distanceM >= distanceM)
    .sort((a,b)=>a.distanceM-b.distanceM || a.kind.localeCompare(b.kind,'en') || a.id.localeCompare(b.id,'en'))
    .slice(0,limit);
  return {status:'supported',identity:analysis.identity,features};
}
