// Public IDs only; this nested version also fences older route/UI readers,
// which reject unknown value fields rather than overwriting an itinerary.
const keys = (v, expected) => v && typeof v === 'object' && !Array.isArray(v) &&
  Object.keys(v).sort().join() === [...expected].sort().join();
const id = v => typeof v === 'string' && /^[a-z][a-z0-9-]{0,199}$/.test(v);
export const emptyItinerary = () => ({version:1, choices:[]});
export function validItinerary(value) {
  return keys(value, ['version','choices']) && value.version === 1 &&
    Array.isArray(value.choices) && value.choices.length <= 100 &&
    // IndexedDB preserves sparse arrays. Array.from makes every missing slot
    // explicit so validation cannot skip a hole then crash during aggregation.
    Array.from(value.choices).every(c => keys(c, ['dayId','routeId','revisionId']) && Object.values(c).every(id)) &&
    new Set(value.choices.map(c => c.dayId)).size === value.choices.length;
}
export function itineraryRows(catalog, itinerary) {
  if (!validItinerary(itinerary)) throw TypeError('Invalid itinerary');
  return itinerary.choices.map(choice => {
    const route = catalog.data.routes.find(r => r.id === choice.routeId);
    const variant = catalog.data.variants.find(v => v.id === route?.variantId);
    let status = 'ready', bundle = null;
    if (!route || route.status === 'withdrawn' || variant?.dayId !== choice.dayId) status = 'withdrawn';
    else if (route.currentRevisionId !== choice.revisionId) status = 'changed';
    else {
      try { bundle = catalog.resolve(choice.routeId, choice.revisionId); }
      catch { status = 'unavailable'; }
    }
    return {choice, route, bundle, status};
  });
}
export function chooseRoute(catalog, itinerary, dayId, routeId, {acknowledge = false} = {}) {
  const row = itineraryRows(catalog, itinerary).find(r => r.choice.dayId === dayId);
  if (row && row.status !== 'ready' && !acknowledge)
    throw Error('Review and acknowledge the changed/withdrawn selection first');
  const choices = itinerary.choices.filter(c => c.dayId !== dayId);
  if (routeId !== null) {
    const {route, revision} = catalog.resolve(routeId);
    const variant = catalog.data.variants.find(v => v.id === route.variantId);
    if (variant?.dayId !== dayId) throw Error('Route does not belong to this day');
    choices.push({dayId, routeId, revisionId:revision.id});
  }
  return {version:1, choices};
}
export function tripTotals(catalog, itinerary, analyses) {
  const rows = itineraryRows(catalog, itinerary);
  const total = {selected:rows.length, available:0, distanceM:0, gainM:0, missing:[]};
  // One choice per day; variants cannot accumulate. The same geometry ridden
  // on different days IS two planned rides (downloads are deduplicated).
  for (const row of rows) {
    const analysis = analyses.get(row.choice.revisionId);
    if (row.status !== 'ready' || analysis?.status !== 'supported' ||
        analysis.identity.routeId !== row.choice.routeId) {
      total.missing.push(row.choice.dayId); continue;
    }
    total.available++;
    total.distanceM += analysis.distanceM;
    total.gainM += analysis.processedTotals.ascentM;
  }
  return total;
}
