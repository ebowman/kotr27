// Shared browser-safe route-import-v1 contract. Filesystem/CLI stay in tools/.
import { createCatalog, verifyAsset } from './route-catalog.mjs';

const hash = async text => Array.from(new Uint8Array(
  await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),
  b=>b.toString(16).padStart(2,'0')).join('');
const decode = bytes => new TextDecoder('utf-8',{fatal:true}).decode(bytes);
const fail = message => { throw Error(`Route pack: ${message}`); };
const need = (condition, message) => { if (!condition) fail(message); };
const keys = (value, fields, label) => need(value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join('|') === [...fields].sort().join('|'), `${label}: unexpected/missing fields`);
const finite = (n, low, high) => typeof n === 'number' && Number.isFinite(n) && n >= low && n <= high;
const hex = n => typeof n === 'string' && /^[a-f0-9]{64}$/.test(n);
const same = (a,b) => canonical(a) === canonical(b);
function canonical(value) {
  return JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v);
}
const contentPath = (path, type) => new RegExp(`^assets/route-${type}[a-f0-9]{64}\\.${type === '' ? 'gpx' : 'json'}$`).test(path);
const semantics = 'horizontal-haversine-6371000m';
const recipe = 'route-raw-profile-v1';
function totals(value) {
  keys(value, ['horizontalDistanceM','rawGainM','rawLossM'], 'totals');
  for (const n of Object.values(value)) need(finite(n,0,10000000), 'invalid totals');
}
function step(a,b) {
  const [lat1,lon1,lat2,lon2] = [a[0],a[1],b[0],b[1]].map(n=>n*Math.PI/180);
  const h = Math.sin((lat2-lat1)/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin((lon2-lon1)/2)**2;
  return 2*6371000*Math.asin(Math.sqrt(Math.min(1,Math.max(0,h))));
}

export function readPackGeometry(bytes) {
  const text = decode(bytes);
  const start = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="KOTR route-import-v1">\n<trk><trkseg>\n';
  const end = '</trkseg></trk></gpx>\n';
  need(text.startsWith(start) && text.endsWith(end), 'only sanitized importer GPX may ship');
  const lines = text.slice(start.length, -end.length).trimEnd().split('\n');
  need(lines.length >= 2 && lines.length <= 100000, 'point count outside limits');
  return lines.map(line => {
    const match = /^<trkpt lat="(-?\d+\.\d{8})" lon="(-?\d+\.\d{8})"><ele>(-?\d+\.\d{3})<\/ele><\/trkpt>$/.exec(line);
    need(match, 'non-allowlisted GPX fields or invalid point');
    const point = match.slice(1).map(Number);
    need(finite(point[0],-90,90) && finite(point[1],-180,180) && finite(point[2],-500,9000), 'invalid point bounds');
    return point;
  });
}

function validateProfile(data, revision, points) {
  keys(data, ['schemaVersion','recipe','revisionId','geometrySha256','distanceSemantics','samples','totals','gaps'], 'profile');
  need(data.schemaVersion === 1 && data.recipe === recipe && data.distanceSemantics === semantics, 'unsupported profile recipe');
  need(data.revisionId === revision.id && data.geometrySha256 === revision.geometrySha256, 'mixed profile revision');
  need(Array.isArray(data.samples) && data.samples.length === points.length, 'profile point count');
  keys(data.gaps, ['maxM','over200m'], 'gaps');
  need(finite(data.gaps.maxM,0,500) && Number.isInteger(data.gaps.over200m) &&
    finite(data.gaps.over200m,0,points.length-1), 'invalid gap metadata');
  let distance = 0, gain = 0, loss = 0, max = 0, over = 0;
  for (let i=0; i<points.length; i++) {
    const sample = data.samples[i];
    if (i) {
      const gap = step(points[i-1],points[i]);
      need(gap > 0 && gap <= 500, 'geometry duplicate/gap exceeds import policy');
      distance += gap; max = Math.max(max,gap); over += Number(gap > 200);
      const delta = points[i][2] - points[i-1][2];
      gain += Math.max(0,delta); loss += Math.max(0,-delta);
    }
    need(Array.isArray(sample) && sample.length === 2 && finite(sample[0],0,10000000) &&
      finite(sample[1],-500,9000) && Math.abs(sample[0]-distance) < 0.00001 && sample[1] === points[i][2],
    `profile sample ${i} not derived from pinned geometry`);
  }
  totals(data.totals);
  for (const [key,expected] of Object.entries({horizontalDistanceM:distance,rawGainM:gain,rawLossM:loss}))
    need(Math.abs(data.totals[key]-expected) < 0.001, 'profile totals not derived from geometry');
  need(Math.abs(data.gaps.maxM-max)<0.00001 && data.gaps.over200m===over, 'gap report mismatch');
}

/**
 * One closed producer contract for release tooling and runtime analysis.
 * All metadata/references are checked. selectedRouteId limits only asset reads
 * and payload verification; omitted means verify every route for publication.
 * metadataOnly is for initial planner discovery: it does NOT verify payloads.
 * Consumers still verify each analysis/download before using/offering bytes.
 */
export async function validateRoutePack(pack, {read, previous, selectedRouteId, metadataOnly = false} = {}) {
  keys(pack, ['schemaVersion','producer','catalog','routes','changeReport'], 'manifest');
  need(pack.schemaVersion === 1 && pack.producer === 'route-import-v1', 'unsupported producer');
  createCatalog(pack.catalog, {previous:previous?.catalog});
  if (selectedRouteId !== undefined)
    need(pack.catalog.routes.some(r=>r.id===selectedRouteId), 'selected route unavailable');
  need(Array.isArray(pack.routes) && pack.routes.length === pack.catalog.routes.length, 'summary inventory mismatch');
  const summaries = new Map();
  for (const summary of pack.routes) {
    keys(summary, ['routeId','revisionId','listed','source','computed','pointCount','sourceCueCount',
      'fitEncodedDistanceM','availability'], 'route summary');
    need(!summaries.has(summary.routeId), 'duplicate route summary');
    summaries.set(summary.routeId,summary);
    keys(summary.listed, ['distanceM','gainM'], 'source-listed totals');
    need(finite(summary.listed.distanceM,0,10000000) && finite(summary.listed.gainM,0,100000), 'invalid source-listed totals');
    keys(summary.availability, ['geometry','gpx','fit','cues','climbs'], 'availability');
    need(Number.isInteger(summary.sourceCueCount) && finite(summary.sourceCueCount,0,2000), 'invalid cue count');
    need(summary.fitEncodedDistanceM === null || finite(summary.fitEncodedDistanceM,0,10000000), 'invalid source FIT distance');
  }
  const files = new Map();
  function reference(ref, type) {
    need(contentPath(ref.path,type), `asset outside approved route allowlist: ${ref.path}`);
    need(ref.path.includes(ref.sha256), 'asset path must contain its full content hash');
  }
  async function asset(ref) {
    const input = await read(ref.path);
    need(input instanceof ArrayBuffer || input instanceof Uint8Array, 'asset bytes required');
    need(input.byteLength <= 20*1024*1024, 'asset byte limit');
    const bytes = new Uint8Array(input instanceof ArrayBuffer ? input.slice(0) : input);
    await verifyAsset(ref, bytes);
    files.set(ref.path, bytes);
    return bytes;
  }
  for (const route of pack.catalog.routes) {
    const summary = summaries.get(route.id);
    need(summary && summary.revisionId === route.currentRevisionId, 'summary revision mismatch');
    need(route.kind === 'organizer' && route.revisions.length <= 1, 'importer publishes current organizer bundles only');
    if (!route.currentRevisionId) {
      need(summary.source === null && summary.computed === null && summary.pointCount === 0 &&
        summary.sourceCueCount === 0 && summary.fitEncodedDistanceM === null, 'unavailable route contains invented data');
      const withdrawn = route.status === 'withdrawn';
      for (const [key,value] of Object.entries(summary.availability))
        need(value === (withdrawn ? 'withdrawn' : {
          geometry:'unavailable-original-not-supplied',gpx:'unavailable-original-not-supplied',
          fit:'unavailable-no-sanitized-fit-writer',cues:'unavailable-not-reviewed',climbs:'unavailable-analysis-not-produced',
        }[key]), 'invalid unavailable format reason');
      continue;
    }
    keys(summary.source, ['format','sha256','origin'], 'source provenance');
    need(['fit','gpx'].includes(summary.source.format) && hex(summary.source.sha256) &&
      ['user-supplied-original','replacement-export','derived-rehearsal'].includes(summary.source.origin), 'invalid source provenance');
    need(summary.source.format === 'fit' ? summary.fitEncodedDistanceM !== null : summary.fitEncodedDistanceM === null,
      'source distance format mismatch');
    need(same(summary.availability, {geometry:'available',gpx:'sanitized-derived-track-no-cues',
      fit:'unavailable-no-sanitized-fit-writer',cues:'unavailable-not-reviewed',climbs:'unavailable-analysis-not-produced'}),
    'unreviewed formats/derivations');
    const revision = route.revisions[0];
    need(revision.distanceSemantics === semantics && !revision.climbs && !revision.pois &&
      revision.profile?.path && revision.downloads?.length === 1 &&
      same(revision.downloads[0],revision.geometry), 'unsupported or stale derivation/download');
    reference(revision.geometry,'');
    reference(revision.profile,'profile-');
    totals(summary.computed);
    need(Number.isInteger(summary.pointCount) && finite(summary.pointCount,2,100000), 'invalid point count');
    if (!metadataOnly && (selectedRouteId === undefined || selectedRouteId === route.id)) {
      const points = readPackGeometry(await asset(revision.geometry));
      const data = JSON.parse(decode(await asset(revision.profile)));
      validateProfile(data,revision,points);
      need(summary.pointCount === points.length && same(summary.computed,data.totals), 'summary differs from pinned profile');
    }
    // Revision identities are derived from the entire producer/source contract,
    // not filenames or mutable route names.
    const identity = {producer:pack.producer,recipe,routeId:route.id,geometrySha256:revision.geometrySha256,
      source:summary.source,provenance:revision.provenance,rights:revision.rights};
    const pythonJSON = (canonical(identity)+'\n').replace(/[\u007f-\uffff]/g,
      c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
    need(revision.id === route.id+'-v-'+await hash(pythonJSON), 'revision identity does not bind source/recipe/geometry');
  }
  keys(pack.changeReport, ['previousManifestSha256','changes'], 'change report');
  need(pack.changeReport.previousManifestSha256 === null || hex(pack.changeReport.previousManifestSha256), 'invalid previous manifest hash');
  need(Array.isArray(pack.changeReport.changes), 'changes must be an array');
  const changed = new Set();
  for (const change of pack.changeReport.changes) {
    keys(change, ['routeId','kind','beforeRevisionId','afterRevisionId','pathChanged','beforeTotals',
      'afterTotals','annotationsNeedReview','annotationIds','invalidated'], 'change');
    need(typeof change.routeId === 'string' && /^[a-z][a-z0-9-]*$/.test(change.routeId) && !changed.has(change.routeId), 'duplicate/invalid change');
    changed.add(change.routeId);
    need(['removed','added','withdrawn','revised','metadata','unchanged'].includes(change.kind), 'invalid change kind');
    for (const id of [change.beforeRevisionId,change.afterRevisionId])
      need(id === null || typeof id === 'string' && /^[a-z][a-z0-9-]*$/.test(id), 'invalid change revision');
    need(typeof change.pathChanged === 'boolean' && typeof change.annotationsNeedReview === 'boolean', 'invalid review flags');
    for (const value of [change.beforeTotals,change.afterTotals]) if (value !== null) totals(value);
    need(Array.isArray(change.annotationIds) && change.annotationIds.every(id=>typeof id==='string' && /^[a-z][a-z0-9-]*$/.test(id)), 'invalid annotation IDs');
    need(Array.isArray(change.invalidated) && change.invalidated.every(v=>['saved-plans','offline-packs','profile','climbs','pois','cues'].includes(v)), 'invalid invalidation scope');
    const invalidated = change.beforeRevisionId !== null && change.beforeRevisionId !== change.afterRevisionId;
    need(change.annotationsNeedReview === invalidated &&
      same(change.invalidated, invalidated ? ['saved-plans','offline-packs','profile','climbs','pois','cues'] : []),
    'revision transition must invalidate annotations and derived consumers');
    if (!invalidated) need(change.annotationIds.length === 0, 'unchanged revision cannot invalidate annotation IDs');
    const summary = summaries.get(change.routeId);
    need(change.kind === 'removed' ? !summary && change.afterRevisionId === null :
      summary && summary.revisionId === change.afterRevisionId && same(summary.computed,change.afterTotals), 'change report differs from catalog');
  }
  for (const route of pack.catalog.routes) need(changed.has(route.id), 'route absent from report');
  return files;
}

export function validatePackPointer(pointer) {
  keys(pointer, ['schemaVersion','path','sha256'], 'pointer');
  need(pointer.schemaVersion === 1 && contentPath(pointer.path,'manifest-') && hex(pointer.sha256) &&
    pointer.path.includes(pointer.sha256), 'invalid manifest pointer');
}
