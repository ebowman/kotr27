// Public navigation only. Rider values, local filenames and provider tokens
// deliberately have no fields here. The catalog is the identity authority.
export const areas = ['plan', 'explore', 'prepare', 'ride-week'];
export const views = ['briefing', 'clock', 'sensitivity', 'flyover'];
const publicId = value => /^[a-z][a-z0-9-]*$/.test(value || '');
const keys = ['area', 'view', 'day', 'variant', 'route', 'rev', 'chapter', 'at'];

export function readSelection(input, catalog, profiles = {}, exampleId = 'semonzo-example', {loading = false} = {}) {
  const url = new URL(input, 'https://navigation.invalid/');
  const q = url.searchParams;
  const legacySeek = /^#seek-(\d{1,6})$/.exec(url.hash);
  const legacy = /^#seek(?:-|$)/.test(url.hash);
  const bareExplorer = url.pathname.endsWith('/explore.html');
  const state = {
    area:q.get('area') ?? (bareExplorer || legacy ? 'explore' : 'plan'),
    view:q.get('view') ?? (legacy ? 'flyover' : url.hash === '#sensitivity' ? 'sensitivity' : bareExplorer ? 'clock' : 'briefing'),
    dayId:q.get('day') || null, variantId:q.get('variant') || null,
    routeId:q.get('route') || null, revisionId:q.get('rev'),
    chapterId:q.get('chapter') || null, distanceM:0,
  };
  const notices = [];
  const fail = (code, message) => ({state, code, message, notices, bundle:null, profile:null});
  if (q.has('route') && !state.routeId) return fail('invalid', 'This route link cannot be opened: no public route identifier.');
  // Empty revision is a public, non-sensitive blocked-link marker. Unlike an
  // absent revision it must never resolve current; explicit selection clears it.
  if (q.getAll('rev').length > 1) state.revisionId = '';
  if (state.revisionId !== null && !publicId(state.revisionId))
    return fail('invalid', 'This route link cannot be opened: revision unavailable or invalid. Choose an available revision explicitly; nothing has been substituted.');
  if (keys.some(key => q.getAll(key).length > 1)) return fail('invalid', 'This route link cannot be opened: repeated navigation fields.');
  if (!areas.includes(state.area) || !views.includes(state.view))
    return fail('invalid', 'This route link cannot be opened: unknown area or view.');
  if (legacy && !q.has('route')) {
    state.routeId = exampleId;
    if (!legacySeek) {
      state.view = 'briefing';
      notices.push('This legacy section link is invalid. The Semonzo example briefing is available; no official route was selected.');
    } else state.distanceM = Number(legacySeek[1]);
  }
  if (state.routeId?.startsWith('user:'))
    return fail('local', 'Available only in this browser. Local library/import is not available in this release; this link cannot be shared or replaced with an official route.');
  for (const field of ['dayId','variantId','routeId','revisionId']) {
    if (state[field] && !publicId(state[field])) return fail('invalid', 'This route link cannot be opened: invalid public identifier.');
  }
  const day = catalog.data.days.find(d => d.id === state.dayId);
  const variant = catalog.data.variants.find(v => v.id === state.variantId);
  if (state.dayId && !day || state.variantId && !variant || day && variant && variant.dayId !== day.id)
    return fail('invalid', 'This route link cannot be opened: day or variant unavailable.');
  if (variant && !day) state.dayId = variant.dayId;
  if (!state.routeId) {
    if (state.revisionId || state.chapterId || q.has('at'))
      return fail('invalid', 'This route link cannot be opened: select the route for this revision or section.');
    if (day || variant) return fail('choose', 'Choose a route explicitly. No variant has been selected for your trip.');
    state.routeId = exampleId;
  }
  const route = catalog.data.routes.find(r => r.id === state.routeId);
  if (!route) return fail('missing', 'This route link cannot be opened: route not found. Choose a route; nothing has been substituted.');
  if (route.status === 'withdrawn') return fail('withdrawn', 'This route has been withdrawn. Its details and exports are unavailable; no replacement has been selected.');
  const routeVariant = catalog.data.variants.find(v => v.id === route.variantId);
  if (state.variantId && state.variantId !== route.variantId || state.dayId && state.dayId !== routeVariant?.dayId)
    return fail('invalid', 'This route link cannot be opened: route, day and variant do not match.');
  state.variantId = route.variantId || null;
  state.dayId = routeVariant?.dayId || null;
  if (!state.revisionId) {
    state.revisionId = route.currentRevisionId;
    notices.push(`Resolved current revision: ${state.revisionId || 'unavailable'}. The incoming link was not revision-pinned.`);
  }
  let bundle;
  try { bundle = catalog.resolve(state.routeId, state.revisionId); }
  catch { return fail('revision', 'This route link cannot be opened: revision unavailable. View available revisions and choose explicitly; nothing has been substituted.'); }
  if (bundle.revision.status === 'superseded' || state.revisionId !== route.currentRevisionId)
    notices.push(`Changed route: this is an older revision, observed ${bundle.revision.provenance.observedOn}. Review the available revision before choosing it; change comparison is not yet available.`);
  if (q.has('at')) {
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/.test(q.get('at')))
      return fail('invalid', 'This route link cannot be opened: invalid distance in metres.');
    state.distanceM = Number(q.get('at'));
  }
  const profile = profiles[state.revisionId] || null;
  // Do not announce a valid chapter/distance as missing while its bundle's
  // profile is still being loaded. Final validation runs on completion/failure.
  if (!profile && loading)
    return {state, code:'loading', message:'Loading selected profile…', notices, bundle, profile:null};
  if (state.chapterId) {
    const chapter = profile?.chapters.find(c => c.id === state.chapterId);
    if (chapter) state.distanceM = chapter.startM;
    else {
      notices.push('Section unavailable. This revision’s briefing is shown paused; no section was substituted.');
      state.chapterId = null; state.distanceM = 0; state.view = 'briefing';
    }
  }
  if (!Number.isFinite(state.distanceM) || state.distanceM < 0 ||
      profile && state.distanceM > profile.distanceM || !profile && state.distanceM > 0) {
    if (legacy && !q.has('route')) {
      state.distanceM = 0; state.view = 'briefing';
      notices.push('Legacy seek is outside the available example profile. Showing its briefing, not a substituted section.');
    } else return fail('invalid', 'This route link cannot be opened: distance unavailable in this revision.');
  }
  return {state, code:'ready', message:'', notices, bundle, profile};
}

/** Rebuild rather than copy a URL: unknown/private query fields never escape. */
export function selectionLink(state) {
  const q = new URLSearchParams();
  q.set('area', areas.includes(state.area) ? state.area : 'plan');
  q.set('view', views.includes(state.view) ? state.view : 'briefing');
  for (const [key, field] of [['day','dayId'],['variant','variantId'],['route','routeId'],['rev','revisionId'],['chapter','chapterId']])
    if (publicId(state[field])) q.set(key, state[field]);
  // Redact an unsafe revision without changing "invalid" into "use current".
  if (state.revisionId != null && !publicId(state.revisionId)) q.set('rev', '');
  if (state.routeId && !publicId(state.routeId)) q.set('route', '');
  if (Number.isFinite(state.distanceM) && state.distanceM > 0) q.set('at', String(Math.round(state.distanceM * 1000) / 1000));
  const page = state.area === 'explore' && state.view !== 'flyover' ? 'explore.html' : 'index.html';
  return `./${page}?${q}`;
}

export function changeSelection(state, patch) {
  const changedRoute = ['routeId','revisionId','dayId','variantId'].some(k => k in patch && patch[k] !== state[k]);
  return {...state, ...(changedRoute && {chapterId:null, distanceM:0, view:'briefing'}), ...patch};
}
