// Presentation only: never resample geometry, rederive ascent or rate difficulty.
export const comparisonViews = ['compare','skyline','radial'];
export function comparisonRow(catalog, routeId, revisionId, analysis) {
  const route = catalog.data.routes.find(r => r.id === routeId);
  let bundle;
  try { bundle = catalog.resolve(routeId, revisionId); }
  catch { return {route, status:'unavailable', reason:'Route/revision withdrawn or unavailable; no replacement selected.'}; }
  const variant = catalog.data.variants.find(v => v.id === route.variantId);
  const row = {route, bundle, variant, status:'unavailable',
    reason:'Validated profile unavailable; distance, ascent and views are not substituted.'};
  if (analysis?.status !== 'supported' || analysis.identity.routeId !== routeId ||
      analysis.identity.revisionId !== bundle.revision.id ||
      analysis.identity.geometrySha256 !== bundle.revision.geometrySha256) return row;
  return {...row, status:'supported', analysis, distanceM:analysis.distanceM,
    ascentM:analysis.processedTotals.ascentM, recipe:analysis.recipe};
}
export function profileSamples(analysis) {
  return [{distanceM:0, elevationM:analysis.windows[0].startElevationM},
    ...analysis.windows.map(w => ({distanceM:w.endM, elevationM:w.endElevationM}))];
}
// Compute over the complete available comparison inventory, not the visible
// subset. Hiding a long/high route cannot make a smaller route appear larger.
export function comparisonScales(rows) {
  const available = rows.filter(r => r.status === 'supported');
  if (!available.length) return null;
  const heights = available.flatMap(r => profileSamples(r.analysis).map(p => p.elevationM));
  const lowM = Math.floor(Math.min(...heights)/100)*100;
  return {distanceM:Math.ceil(Math.max(...available.map(r => r.distanceM))/10000)*10000,
    lowM, highM:Math.max(lowM+100, Math.ceil(Math.max(...heights)/100)*100)};
}
export function profilePoint(sample, row, scale, axis = 'distance') {
  return [sample.distanceM / (axis === 'progress' ? row.distanceM : scale.distanceM),
    (sample.elevationM-scale.lowM)/(scale.highM-scale.lowM)];
}
export function radialPoint(distanceM, elevationM, row, scale, rotation = 0) {
  const angle = (distanceM/row.distanceM*360 + rotation - 90)*Math.PI/180;
  const radius = 45 + 110*(elevationM-scale.lowM)/(scale.highM-scale.lowM);
  return [200+radius*Math.cos(angle), 200+radius*Math.sin(angle)];
}
export function variantDelta(standard, longer) {
  if (standard?.status !== 'supported' || longer?.status !== 'supported' ||
      !standard.variant?.dayId || standard.variant.dayId !== longer.variant?.dayId ||
      standard.recipe !== longer.recipe) return null;
  return {distanceM:longer.distanceM-standard.distanceM, ascentM:longer.ascentM-standard.ascentM};
}
