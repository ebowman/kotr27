// Browser/Node boundary for an already hash-verified public route-pack manifest.
// Only sanitized producer GPX is accepted; this is NOT a general GPX importer.
import { createCatalog } from './route-catalog.mjs';
import { analyzeRoute } from './route-analysis.mjs';
import { validateRoutePack, readPackGeometry } from './route-pack-contract.mjs';

/**
 * readAsset(path) returns bytes from the pinned pack, not a mutable route alias.
 * No implicit current-revision fallback. Annotation sets are separately reviewed.
 */
export async function loadRouteAnalysis({pack,routeId,revisionId,readAsset,annotationSet}) {
  if (!revisionId || pack?.schemaVersion !== 1 || pack.producer !== 'route-import-v1')
    throw Error('Explicit revision and supported public pack required');
  const catalog = createCatalog(pack.catalog);
  const {revision,event} = catalog.resolve(routeId,revisionId);
  // Hashes alone cannot establish producer semantics. Use the same closed
  // graph/profile/summary validator as publication, reading only this route.
  const files = await validateRoutePack(pack,{read:readAsset,selectedRouteId:routeId});
  const summary = pack.routes.find(r=>r.routeId===routeId);
  // Hash/profile verification can finish several route promises in one
  // microtask checkpoint. Start each derivation in a new task so its analysis,
  // model and view subscribers cannot extend that entire verification batch.
  // This is only scheduling: callers still await the same fully verified pin.
  await new Promise(resolve=>setTimeout(resolve,0));
  return analyzeRoute({routeId,revisionId,geometrySha256:revision.geometrySha256,
    points:readPackGeometry(files.get(revision.geometry.path)).map(([lat,lon,elevationM])=>({lat,lon,elevationM})),
    annotationSet,
    sourceTotals:{listed:{...summary.listed,basis:'RWGPS source-listed; not calibrated to derived gain'},
      fitEncodedDistanceM:summary.fitEncodedDistanceM,
      sourceFormat:summary.source.format,sourceOrigin:summary.source.origin,
      provenance:event.provenance}});
}
