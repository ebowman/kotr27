import { areas, changeSelection, readSelection, readPractice, selectionLink as publicSelectionLink } from './route-state.mjs';
import { installPreferences, riderState } from './preferences-view.mjs';
import { createCatalog } from './route-catalog.mjs';
import { publicAssetReader, loadPlannerPack, createAnalysisStore } from './trip-planner.mjs';
import { installTripPlanner } from './trip-planner-view.mjs';
import { createAnalysisPlaybackRoute } from './route-playback-adapters.mjs';
import { routePlayback, registerPlaybackRoute, unregisterPlaybackRoute } from './route-session.mjs';
import { installRouteBriefing } from './route-briefing-view.mjs';
import { installRouteFlyover } from './route-flyover-view.mjs';
import { routePace } from './route-pace.mjs';
import { installRoutePace } from './route-pace-view.mjs';
import { installRouteComparison } from './route-comparison-view.mjs';
import { comparisonViews } from './route-comparison.mjs';
import { installLocalRoutes } from './local-routes-view.mjs';
import { isLocalId } from './local-route-storage.mjs';
import { createRecordedReplay } from './recorded-replay.mjs';
import { installRecordedReplay } from './recorded-replay-view.mjs';
import { installEventGuide } from './event-guide-view.mjs';
import { practiceWeek } from './event-guide.mjs';
import { installRouteWeather } from './route-weather-view.mjs';
import { installOffline } from './offline-view.mjs';

const el = id => document.getElementById(id);
// Common Plan/Explore/pace views run in either shell. Do not lose memory-only
// rider/scenario/itinerary state just to change a route or area.
const documentEntry=location.pathname.endsWith('explore.html') ? 'explore.html' : 'index.html';
function selectionLink(state) {
  if (isLocalId(state.routeId)) {
    const q=new URLSearchParams({area:areas.includes(state.area)?state.area:'explore',
      view:['briefing','clock','sensitivity'].includes(state.view)?state.view:'briefing',route:state.routeId});
    for (const [k,v] of Object.entries(readPractice(new URLSearchParams({
      week:String(state.week??1),goal:state.goal??'social',cue:state.cue??'feel',
    })))) if(v!=={week:1,goal:'social',cue:'feel'}[k]) q.set(k,String(v));
    return `./${documentEntry}?${q}`;
  }
  return publicSelectionLink(state).replace(/^\.\/(?:index|explore)\.html/,`./${documentEntry}`);
}
const labels = {plan:'Plan', explore:'Explore', prepare:'Prepare', 'ride-week':'Ride week'};
let catalog = createCatalog({schemaVersion:1,events:[],days:[],variants:[],routes:[],annotations:[]}),
  planner = null, comparison = null, catalogLoading = true;
const withdrawnRoutes=new Set();
function applyWithdrawals(ids) {
  for(const id of ids)withdrawnRoutes.add(id);
  const data=structuredClone(catalog.data);
  for(const route of data.routes) if(withdrawnRoutes.has(route.id)) {
    for(const revision of route.revisions) {
      delete profiles[revision.id];playbackFactories.delete(revision.id);
      unregisterPlaybackRoute(route.id,revision.id);routePace.forgetRoute(route.id);
    }
    route.status='withdrawn';route.currentRevisionId=null;route.revisions=[];
  }
  data.annotations=data.annotations.filter(a=>!withdrawnRoutes.has(a.routeId));
  catalog=createCatalog(data);
  planner?.withdraw([...withdrawnRoutes]);
  // Comparison's cached models cannot outlive a permission withdrawal.
  if(comparison) {comparison.root.remove();comparison=null;}
  if(current) {current=resolveLocation();render(false);}
}
window.addEventListener('kotr-offline-withdrawn',event=>{
  if(event.detail.some(id=>!withdrawnRoutes.has(id)))applyWithdrawals(event.detail);
});
const profiles = {};
const pendingProfiles = new Set();
const playbackFactories = new Map();
const recordings = new Map();
function preparePlayback(revisionId) {
  const entry=playbackFactories.get(revisionId);
  if (!entry) return null;
  const route=entry.make(entry.recorded ? null : routePace.model(entry.analysis));
  registerPlaybackRoute(route);
  return route;
}
routePace.subscribe(()=>{
  const snapshot=routePlayback.getSnapshot();
  const route=preparePlayback(snapshot.identity?.revisionId);
  if (route) routePlayback.replaceRoute(route);
});
let current;
const resolveLocation = () => {
  const query = new URL(location.href).searchParams;
  if (query.get('route')?.startsWith('user:')) {
    const id=query.get('route'), record=isLocalId(id) && localLibrary.get(id);
    const state={area:areas.includes(query.get('area'))?query.get('area'):'explore',
      view:['briefing','clock','sensitivity'].includes(query.get('view'))?query.get('view'):'briefing',
      routeId:id,revisionId:record?.revisionId??null,dayId:null,variantId:null,chapterId:null,distanceM:0,...readPractice(query)};
    const result={state,code:'local',message:localLibrary.missing(),notices:[],bundle:null,profile:null};
    if (!isLocalId(id) || query.getAll('route').length!==1) return {...result,message:'Invalid local identifier. Import again; no organizer route substituted.'};
    if (!record) return result;
    const snapshot=routePlayback.getSnapshot();
    if(snapshot.identity?.routeId===id && snapshot.identity.revisionId===record.revisionId) {
      state.distanceM=snapshot.distanceM;
      state.chapterId=current?.state.routeId===id ? current.state.chapterId : null;
    }
    return {...result,code:'ready',message:'Private local file · not portable · no external map.',
      profile:record.analysis,bundle:{route:{id,name:record.name,kind:'local',currentRevisionId:record.revisionId},
        revision:{id:record.revisionId,status:'local',provenance:{source:'Private local import',observedOn:'this device'}}}};
  }
  const revision = query.get('rev') ?? catalog.data.routes.find(r=>r.id===query.get('route'))?.currentRevisionId;
  const resolved = readSelection(location.href, catalog, profiles,
    {loading:catalogLoading || pendingProfiles.has(revision)});
  if(withdrawnRoutes.has(query.get('route'))) return {...resolved,code:'withdrawn',bundle:null,profile:null,notices:[],
    message:'This route has been withdrawn. Its details and exports are unavailable; no replacement has been selected.'};
  if (catalogLoading && resolved.code === 'missing')
    return {...resolved, code:'loading', message:'Loading approved route catalog…'};
  return resolved;
};
const listeners = new Set();
const linkPatches = new WeakMap();
const node = (tag, text, parent) => {
  const element = document.createElement(tag);
  if (text) element.textContent = text;
  parent?.append(element);
  return element;
};
const shell = el('site-shell');
// All inserted HTML is fixed UI copy. Catalog names and notices use textContent.
shell.innerHTML = `
  <header class="site-header"><a class="site-brand" href="./index.html">KOTR / 2027 · Routes</a><nav class="site-nav" aria-label="Main navigation"></nav></header>
  <div class="site-context"><p class="site-label" id="site-catalog-status">Loading approved provisional routes</p>
    <p id="site-selection"></p>
    <p>Source D1–D4 labels are not verified calendar assignments. Departures and logistics are pending; no itinerary is inferred.</p></div>
  <h1 id="site-heading" tabindex="-1">Plan your ride</h1>
  <div id="site-notice" role="status" aria-live="polite"></div>
  <div id="site-recovery" class="site-actions"></div>
  <details id="site-route-picker"><summary>Choose a route / view available revisions</summary>
    <div class="site-choices">
      <label>Day<select id="site-day"></select></label>
      <label>Variant<select id="site-variant"></select></label>
      <label>Route<select id="site-route"></select></label>
      <label>Revision<select id="site-revision"></select></label>
    </div><p>Selection previews a route only. Build your itinerary explicitly in Plan.</p>
  </details>
  <div id="site-content"></div>
  <footer class="site-footer">Static companion preview · Not for navigation. No account or FTP needed.
    Offline packs are optional; ordinary browser caching is not an offline guarantee.</footer>`;
document.querySelector('main').append(shell.querySelector('.site-footer'));
function reflectPosition(snapshot, chapterId = null) {
  if (!snapshot.position || snapshot.identity?.routeId !== current.state.routeId ||
      snapshot.identity?.revisionId !== current.state.revisionId) return;
  // Persistable selection is not a second playback accumulator. Keep a rounded
  // finish link inside the exact route endpoint (which can end mid-millimetre).
  const distanceM=Math.round(snapshot.distanceM*1000)/1000 > snapshot.totalDistanceM ?
    Math.floor(snapshot.totalDistanceM*1000)/1000 : snapshot.distanceM;
  const next = {...current.state, distanceM, chapterId};
  // Scrubbing updates links without replacing the controls or reloading the
  // controller from a rounded URL. Exact distance lives only in the controller.
  current = {...current, state:next};
  const href=selectionLink(next);
  history.replaceState(null,'',href);
  if (!isLocalId(next.routeId)) riderState.select(href);
  for (const a of shell.querySelectorAll('a')) {
    const patch=linkPatches.get(a);
    if (patch && a.dataset.practice==='true')
      patch.week=practiceWeek(current.profile?.chapters?.find(c=>c.id===snapshot.chapterId));
    if (patch) a.href=selectionLink(changeSelection(next,patch));
  }
}
const linkedBriefing = installRouteBriefing(shell, reflectPosition);
const linkedFlyover = installRouteFlyover(shell, reflectPosition);
const eventGuide = installEventGuide(shell,{navigate:navigateSelection,link});
const weather = installRouteWeather(shell);
const offline = installOffline(shell,{storageBarrier:()=>riderState.ready});
const linkedPace = installRoutePace(shell, riderState, reflectPosition);
const linkedReplay = installRecordedReplay(shell,{onSeek:reflectPosition,
  plans:()=>catalog.data.routes.filter(r=>r.kind==='organizer').flatMap(r=>r.revisions.map(revision=>({
    name:r.name,revisionId:revision.id,source:revision.provenance.source,
    analysis:()=>profiles[revision.id],
  }))),
});
const localLibrary=installLocalRoutes(shell,{
  storageBarrier:()=>riderState.settled(),
  open(record) {
    profiles[record.revisionId]=record.analysis;
    const replay=createRecordedReplay(record);
    if(record.decoded.kind==='recording')recordings.set(record.revisionId,replay);
    if(replay.status==='available') {
      playbackFactories.set(record.revisionId,{analysis:record.analysis,recorded:true,make:()=>replay.adapter});
    } else if(record.analysis.status==='supported') {
      playbackFactories.set(record.revisionId,{analysis:record.analysis,
        make:estimate=>createAnalysisPlaybackRoute(record.analysis,{estimate})});
    }
    navigateSelection({area:'explore',view:'briefing',routeId:record.id,revisionId:record.revisionId,dayId:null,variantId:null});
  },
  removed(id) {
    const revision=`local-${id.slice(5)}`;
    linkedReplay.forget(id);recordings.delete(revision);
    delete profiles[revision];playbackFactories.delete(revision);
    unregisterPlaybackRoute(id,revision);routePace.forgetRoute(id);
  },
  changed() { if(current) {current=resolveLocation();render(false,false);} },
});
installPreferences(shell.querySelector('.site-header'), {
  forgetOffline:offline.forget,
  forgetLocalFiles:()=>{eventGuide.forget();weather.forget();return localLibrary.forget();},
  edit:() => navigateSelection({area:'explore', view:'clock'}),
  selection:() => isLocalId(current.state.routeId) ? null : selectionLink(current.state),
});

function link(parent, text, patch, {replace = false} = {}) {
  const a = node('a', text, parent);
  linkPatches.set(a,patch);
  a.href = selectionLink(changeSelection(current.state, patch));
  a.addEventListener('click', event => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigateSelection(patch, {replace});
  });
  return a;
}
function card(parent, heading, text) {
  const section = node('section', '', parent);
  section.className = 'site-card';
  node('h2', heading, section);
  node('p', text, section);
  return section;
}
function options(id, records, value, placeholder) {
  const select = el(id);
  select.replaceChildren(new Option(placeholder, ''));
  for (const record of records) select.add(new Option(record.name || record.id, record.id));
  select.value = value || '';
  select.disabled = !records.length;
}
function picker() {
  const s = current.state, routes = catalog.data.routes;
  options('site-day', catalog.data.days, s.dayId, catalog.data.days.length ? 'Choose a day' : 'Official days pending');
  options('site-variant', catalog.data.variants.filter(v => v.dayId === s.dayId), s.variantId, 'Choose a variant');
  options('site-route', routes.filter(r => !s.variantId || r.variantId === s.variantId), s.routeId, 'Choose a route');
  options('site-revision', routes.find(r => r.id === s.routeId)?.revisions || [], s.revisionId, 'Choose an available revision');
}
function briefing(parent) {
  const {profile, state, bundle} = current;
  if (bundle.route.kind==='local') return; // Local provenance/details, common linked controls below.
  const section = card(parent, `${bundle.route.name} · Briefing`,
    'The linked route briefing below uses the selected revision. No geometry or estimates have been substituted.');
  node('p', `${bundle.revision.provenance.source} Observed ${bundle.revision.provenance.observedOn}.`, section);
  if (!profile) node('p', pendingProfiles.has(state.revisionId) ? 'Verifying selected route profile…' :
    'Profile unavailable: route files could not be verified. Reload to retry; route metadata and other choices remain available.',section);
  link(section, 'Plan this route / verified downloads', {area:'plan', view:'briefing'});
}
function render(focus = false, notify = true, {preserveRecording = true} = {}) {
  const active = document.activeElement;
  const activeLink = active?.closest('a')?.href;
  const {state:s, bundle, code, notices} = current;
  document.title = `${labels[s.area] || 'Route link unavailable'} · KOTR 2027 rider companion`;
  el('site-heading').textContent = {plan:'Plan your ride', explore:'Explore the route', prepare:'Prepare for the ride', 'ride-week':'Ride week briefing'}[s.area] || 'Route link unavailable';
  el('site-selection').textContent = bundle
    ? `${bundle.route.name} · ${bundle.route.kind} · ${s.revisionId} · ${bundle.revision.status}`
    : 'No route opened. Choose explicitly; no replacement has been selected.';
  el('site-notice').textContent = [current.message, ...notices].filter(Boolean).join(' ');
  const nav = shell.querySelector('nav'); nav.replaceChildren();
  for (const area of areas) {
    const a = link(nav, labels[area], {area});
    if (area === s.area) a.setAttribute('aria-current','page');
  }
  picker();
  const recovery = el('site-recovery'); recovery.replaceChildren();
  if (code !== 'ready' && code !== 'loading') {
    const choose = node('button','Choose a route',recovery);
    choose.onclick = () => { el('site-route-picker').open = true; el('site-route').focus(); };
    if (catalog.data.routes.find(r => r.id === s.routeId)?.revisions.length) {
      const revisions = node('button','View available revisions',recovery);
      revisions.onclick = () => { el('site-route-picker').open = true; el('site-revision').focus(); };
    }
  } else if (bundle && s.revisionId !== bundle.route.currentRevisionId) {
    link(recovery, 'Use current revision (changes selection)', {revisionId:bundle.route.currentRevisionId});
  }
  const content = el('site-content'); content.replaceChildren();
  content.setAttribute('aria-busy', String(catalogLoading || pendingProfiles.has(s.revisionId)));
  if (planner) planner.root.hidden = s.area !== 'plan';
  const grid = node('div','',content); grid.className = 'site-grid';
  if (s.area === 'plan') {
    const intro = card(grid, 'A clear start, without a map',
      'Build a trip from the approved provisional route pack below. The sourced event date range is listed in the event guide; day/calendar assignments, departures, fundraising and organizer logistics remain pending. Nothing here is an announced ride schedule.');
    const actions = node('div','',intro); actions.className = 'site-actions';
    if (bundle) {
      link(actions, 'Read selected route briefing', {area:'explore', view:'briefing'});
      if(bundle.route.kind!=='local')link(actions, 'Compare routes / Skyline / Radial', {area:'explore', view:'compare'});
    }
  } else if (s.area === 'prepare') {
    const prepare = card(grid, 'Prepare without a prescription', 'Choose a start-anytime practice idea and optional packing checks below. Social/performance goals and feel/power cues are independent. Route sections are context, not a required workout.');
    const actions = node('div','',prepare); actions.className = 'site-actions';
    if (bundle) {
      link(actions, 'Read selected section', {area:'explore', view:'briefing'});
      link(actions, 'Explore optional time assumptions', {area:'explore', view:'clock'});
    }
    card(grid, 'Rider information stays optional', 'The ride clock and sensitivity tools share one validated profile and use fictional assumptions for omitted values. Entries stay in memory unless you choose Remember in Preferences & privacy; never in navigation links.');
  } else if (s.area === 'ride-week') {
    const ride = card(grid, 'Briefing · selected route, not a calendar assignment', 'Read the sourced event snapshot and revisioned route card below. Calendar mapping, departures, contacts, logistics and sourced stops remain pending. This is not live tracking or turn-by-turn navigation.');
    const actions = node('div','',ride); actions.className = 'site-actions';
    if (bundle) link(actions, 'Read selected route / section', {area:'explore', view:'briefing'});
    const downloads = card(grid, 'Downloads, print and optional weather', 'Choose verified route downloads in Plan or print the cleared organizer card below. Save optional offline day packs below before disconnecting. Weather and terrain have no offline coverage. Do not rely on cached pages or printed cards for navigation or current event information.');
    link(downloads, 'Open trip planner', {area:'plan', view:'briefing'});
  }
  if (bundle && s.area === 'explore') {
    const actions = node('div','',content); actions.className = 'site-actions';
    const chapter=current.profile?.chapters?.find(c=>s.chapterId ? c.id===s.chapterId :
      s.distanceM>=c.startM && (s.distanceM<c.endM || s.distanceM===current.profile.distanceM && c.endM===s.distanceM));
    link(actions,'Practise selected section',{area:'prepare',view:'briefing',week:practiceWeek(chapter)}).dataset.practice='true';
    for (const [view,label] of (recordings.get(s.revisionId)?.status==='available' ?
      [['briefing','Recorded replay / planned comparison']] : bundle.route.kind==='local' ?
      [['briefing','Local route briefing'],['clock','Modeled pace (not recorded replay)']] :
      [['briefing','Route briefing'],['clock','Pace / ride clock'],['sensitivity','FTP / weight sensitivity'],['flyover','Optional 3D flyover'],
        ['compare','Compare variants'],['skyline','Skyline'],['radial','Radial']])) {
      const a = link(actions,label,{view});
      if (s.view === view) a.setAttribute('aria-current','page');
    }
    if (!comparisonViews.includes(s.view)) briefing(content);
    if (comparisonViews.includes(s.view) && !comparison)
      node('p','Route comparison unavailable while the approved catalog is loading or could not be verified.',content);
  }
  if (bundle && s.area === 'explore' && s.view === 'flyover' && bundle.route.kind!=='organizer')
    node('p', 'This interactive view is unavailable for the selected revision. Its route briefing remains available; no geometry has been substituted.', content);
  const recording=recordings.get(s.revisionId);
  const geometryView=recording?.status==='available' ? {...current,profile:null} : current;
  linkedBriefing.show(geometryView);
  linkedFlyover.show(geometryView);
  linkedPace.show(geometryView);
  linkedReplay.show(localLibrary.get(s.routeId),recording,s.area==='explore');
  eventGuide.show(current,catalog.data.events.find(e=>e.id==='kotr-2027'));
  weather.show(current,catalog.data.events.find(e=>e.id==='kotr-2027'));
  localLibrary.show(s,recording);
  // The official comparison workspace never retains private analyses/names.
  // Local comparison/replay is a separate capability, not a catalog insertion.
  comparison?.show(s.routeId?.startsWith('user:') ?
    {...current,bundle:null,profile:null,state:{...s,area:'prepare',routeId:null,revisionId:null}} : current);
  if (notify) {
    if (code === 'ready' && (recording?.status==='available' || profiles[s.revisionId]?.status !== 'unsupported' && profiles[s.revisionId])) {
      const live=routePlayback.getSnapshot();
      if(preserveRecording && recording?.status==='available' &&
        live.identity?.routeId===s.routeId && live.identity?.revisionId===s.revisionId &&
        live.recordedClock.status==='available') {
        // Navigation is not a distance seek. Distance loses pause/gap time and
        // between-sample selection; retain the sole controller's exact cursor.
        routePlayback.pause();
      } else {
        preparePlayback(s.revisionId);
        routePlayback.selectRoute(recording?.status==='available' ?
          {routeId:s.routeId,revisionId:s.revisionId} : s);
      }
    } else routePlayback.clear();
  }
  for (const listener of listeners) listener(current);
  if (notify) document.dispatchEvent(new CustomEvent('kotr-selection', {detail:current}));
  if (focus) el('site-heading').focus();
  else if (active && !active.isConnected) {
    // Completing a background profile load must not discard a keyboard user's
    // focus when the shell refreshes its links. Explicit navigation still
    // moves to the heading above.
    const replacement = active.id ? el(active.id) :
      [...document.querySelectorAll('a[href]')].find(a => a.href === activeLink);
    replacement?.focus();
  }
}
export function subscribeSelection(listener) {
  listeners.add(listener);
  if (current) listener(current);
  return () => listeners.delete(listener);
}
export function navigateSelection(patch, {replace = false, focus = true, notify = true} = {}) {
  const snapshot=routePlayback.getSnapshot();
  if (snapshot.position && snapshot.identity.routeId===current.state.routeId &&
      snapshot.identity.revisionId===current.state.revisionId)
    reflectPosition(snapshot,current.state.chapterId && snapshot.distanceM===current.state.distanceM ? current.state.chapterId : null);
  const next = changeSelection(current.state, patch);
  const href = selectionLink(next);
  if (!isLocalId(next.routeId)) riderState.select(href);
  history[replace ? 'replaceState' : 'pushState'](null, '', href);
  current = resolveLocation();
  render(focus, notify, {preserveRecording:
    snapshot.identity?.routeId===next.routeId && snapshot.identity?.revisionId===next.revisionId &&
    !Object.hasOwn(patch,'distanceM') && !Object.hasOwn(patch,'chapterId')});
}
el('site-day').onchange = e => navigateSelection({dayId:e.target.value || null, variantId:null, routeId:null, revisionId:null});
el('site-variant').onchange = e => navigateSelection({variantId:e.target.value || null, routeId:null, revisionId:null});
el('site-route').onchange = e => {
  if (!e.target.value) return;
  navigateSelection({dayId:null, variantId:null, routeId:e.target.value, revisionId:catalog.data.routes.find(r => r.id === e.target.value).currentRevisionId});
};
el('site-revision').onchange = e => { if (e.target.value) navigateSelection({revisionId:e.target.value}); };
document.addEventListener('kotr-seek', () => reflectPosition(routePlayback.getSnapshot()));
// Skip is a focus operation, not route navigation: changing a legacy seek
// fragment would discard its selection. Keep the native href for no-JS use.
document.querySelector('.skip').addEventListener('click', event => {
  if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  el('site-heading').focus();
});
const restore = () => { current = resolveLocation();
  if (!isLocalId(current.state.routeId)) riderState.select(selectionLink(current.state)); render(true); };
window.addEventListener('popstate', restore);
window.addEventListener('hashchange', restore);
window.addEventListener('pageshow', event => { if (event.persisted) restore(); });

// Lightweight status/navigation renders before geometry, independently of maps.
current = resolveLocation();
render();
const catalogReady = (async () => {
  try {
    const pointerLink = document.querySelector('link[rel="alternate"][title="Approved route catalog"]');
    let pointerPath = 'assets/route-pack.json';
    if (pointerLink) {
      const url = new URL(pointerLink.href), base = new URL('./', location.href);
      if (url.origin !== base.origin || !url.href.startsWith(base.href) || url.search || url.hash)
        throw Error('Invalid public pack pointer');
      pointerPath = url.pathname.slice(base.pathname.length);
    }
    const read = publicAssetReader(location.href);
    const loaded = await loadPlannerPack(read, pointerPath);
    catalog = loaded.catalog;
    const analysisFor = createAnalysisStore(loaded.pack,read);
    comparison = installRouteComparison(shell, {catalog:loaded.catalog, analysisFor,
      navigate:navigateSelection, href:patch=>selectionLink(changeSelection(current.state,patch))});
    for (const route of loaded.catalog.data.routes) for (const revision of route.revisions) {
      pendingProfiles.add(revision.id);
      analysisFor(route.id,revision.id).then(analysis=>{
        if(withdrawnRoutes.has(route.id))return;
        profiles[revision.id]=analysis;
        if (analysis.status==='supported') {
          playbackFactories.set(revision.id,{analysis,make:estimate=>createAnalysisPlaybackRoute(analysis,{estimate})});
          preparePlayback(revision.id);
        }
      }).catch(()=>{ /* Explicit unavailable UI, never substituted geometry. */ }).finally(()=>{
        pendingProfiles.delete(revision.id);
        if (current.state.routeId===route.id && current.state.revisionId===revision.id && !catalogLoading) {
          current=resolveLocation(); render(false);
        }
      });
    }
    await riderState.ready;
    planner = installTripPlanner(shell, {...loaded, read, analysisFor, preferences:riderState,
      openRoute:route => navigateSelection({area:'plan', view:'briefing', routeId:route.id,
        revisionId:route.currentRevisionId, dayId:null, variantId:null}),
      preview:route => selectionLink(changeSelection(current.state, {
        area:'plan', view:'briefing', routeId:route.id, revisionId:route.currentRevisionId,
        dayId:null, variantId:null,
      }))});
    // Plan's choices/downloads precede its secondary comparison workspace.
    shell.append(comparison.root);
    if(withdrawnRoutes.size)applyWithdrawals([...withdrawnRoutes]);
    el('site-catalog-status').textContent = 'Approved provisional routes · source labels, not a calendar schedule';
  } catch {
    el('site-catalog-status').textContent = 'Approved route pack unavailable or failed verification. Reload to retry; no route has been substituted.';
  }
  catalogLoading = false;
})();
export const shellReady = (async () => {
  await Promise.all([catalogReady, offline.ready]);
  current = resolveLocation();
  render((location.search.length > 0 || location.hash.length > 0) && document.activeElement === document.body);
  shell.dataset.ready = 'true';
  return current;
})();
