import { createCatalog, verifyAsset } from './route-catalog.mjs';
import { validatePackPointer, validateRoutePack } from './route-pack-contract.mjs';
import { loadRouteAnalysis } from './route-analysis-loader.mjs';
import { itineraryRows } from './itinerary.mjs';

const decode = bytes => JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
// No catalog prose, location query or remembered ID can become a fetch URL.
// In particular do not follow redirects to a login page or send referrer tokens.
export function publicAssetReader(base, fetcher = globalThis.fetch) {
  const root = new URL('./', base);
  return async path => {
    if (!/^assets\/route-(?:pack(?:\.[a-f0-9]{24})?\.json|(?:manifest-|profile-)?[a-f0-9]{64}\.(?:json|gpx))$/.test(path))
      throw Error('Asset is outside the public route allowlist');
    const response = await fetcher(new URL(path, root), {
      credentials:'omit', referrerPolicy:'no-referrer', redirect:'error',
      signal:AbortSignal.timeout(15000),
    });
    if (!response.ok) throw Error('Public route file unavailable');
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 20*1024*1024) throw Error('Public route file exceeds limit');
    return bytes;
  };
}
export async function loadPlannerPack(read, pointerPath = 'assets/route-pack.json') {
  const pointer = decode(await read(pointerPath));
  validatePackPointer(pointer);
  const bytes = await read(pointer.path);
  await verifyAsset(pointer, bytes);
  const pack = decode(bytes);
  // Validate ALL metadata before rendering even when an individual asset fails.
  await validateRoutePack(pack, {metadataOnly:true});
  return {pack, catalog:createCatalog(pack.catalog)};
}
export async function plannerAnalysis(pack, read, route) {
  return loadRouteAnalysis({pack, readAsset:read, routeId:route.id, revisionId:route.currentRevisionId});
}
// Shared by Plan and Explore. One verification/derivation per pinned revision
// per document; failures stay explicit until a document reload.
export function createAnalysisStore(pack, read) {
  const pending = new Map();
  return (routeId, revisionId) => {
    const key = `${routeId}:${revisionId}`;
    if (!pending.has(key)) pending.set(key,
      loadRouteAnalysis({pack, readAsset:read, routeId, revisionId}));
    return pending.get(key);
  };
}
export function routeSourceLink(route) {
  const match = /^rwgps-(\d+)$/.exec(route.id);
  return match ? `https://ridewithgps.com/routes/${match[1]}` : null;
}
export function downloadName(routeId, revisionId, format) {
  return `${routeId}--${revisionId}.${format}`;
}
export async function downloadRoutes({catalog, choices, format, read, handoff, isCurrent = () => true, report = () => {}}) {
  if (!['gpx','fit'].includes(format)) throw TypeError('Unknown format');
  const rows = itineraryRows(catalog, {version:1, choices});
  const seen = new Set(), results = [];
  for (const row of rows) {
    const {routeId, revisionId} = row.choice;
    const result = {routeId, revisionId, format, status:'failed'};
    try {
      if (!isCurrent()) throw Error('Selection changed; request canceled. Try again explicitly.');
      if (row.status !== 'ready') throw Error('Revision changed or withdrawn: acknowledge before downloading.');
      const ref = row.bundle.revision.downloads?.find(d => d.format === format);
      if (!ref) throw Error(`${format.toUpperCase()} unavailable; no cleared file in this revision.`);
      const key = `${ref.path}:${ref.sha256}`;
      if (seen.has(key)) result.status = 'shared-file-already-offered';
      else {
        const bytes = await read(ref.path);
        await verifyAsset(ref, bytes); // Individual AND batch, on every attempt.
        if (!isCurrent()) throw Error('Selection changed; request canceled. Try again explicitly.');
        result.filename = downloadName(routeId, revisionId, format);
        await handoff(bytes, result.filename, format);
        result.status = 'handed-to-browser';
        seen.add(key);
      }
    } catch (error) {
      // Do not echo network URLs, query strings or opaque provider responses.
      result.message = row.status !== 'ready' ? 'Revision changed or withdrawn: acknowledgment required.' :
        !row.bundle?.revision.downloads?.some(d => d.format === format) ? `${format.toUpperCase()} unavailable; no cleared file.` :
        'Not offered: file unavailable, checksum mismatch, selection changed or browser rejected the request. Retry individually.';
    }
    results.push(result);
    report(result);
  }
  return results;
}
export function browserDownload(bytes, filename, format) {
  const url = URL.createObjectURL(new Blob([bytes], {type:format === 'gpx' ? 'application/gpx+xml' : 'application/octet-stream'}));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.hidden = true;
  document.body.append(a);
  try { a.click(); }
  finally { a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
}
