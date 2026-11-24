import { exampleCatalog, exampleRouteId } from './example-catalog.mjs';
import { loadProfile, loadExampleTrack } from './semonzo-profile.mjs';
import { areas, changeSelection, readSelection, selectionLink } from './route-state.mjs';
import { installPreferences, riderState } from './preferences-view.mjs';
import { createCatalog } from './route-catalog.mjs';
import { publicAssetReader, loadPlannerPack, createAnalysisStore } from './trip-planner.mjs';
import { installTripPlanner } from './trip-planner-view.mjs';
import { createAnalysisPlaybackRoute, createSemonzoPlaybackRoute } from './route-playback-adapters.mjs';
import { routePlayback, registerPlaybackRoute, subscribePlayback } from './route-session.mjs';
import { installRouteBriefing } from './route-briefing-view.mjs';
import { estimateRouteTime } from './route-time.mjs';
import { installRouteComparison } from './route-comparison-view.mjs';
import { comparisonViews } from './route-comparison.mjs';

const el = id => document.getElementById(id);
const labels = {plan:'Plan', explore:'Explore', prepare:'Prepare', 'ride-week':'Ride week'};
let catalog = exampleCatalog, planner = null, comparison = null, catalogLoading = true;
const profiles = {};
const pendingProfiles = new Set();
let current, flyoverStarted = false, profileLoading = true;
const resolveLocation = () => {
  const query = new URL(location.href).searchParams;
  const revision = query.get('rev') ?? catalog.data.routes.find(r=>r.id===query.get('route'))?.currentRevisionId;
  const resolved = readSelection(location.href, catalog, profiles, exampleRouteId,
    {loading:profileLoading || catalogLoading || pendingProfiles.has(revision)});
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
  <header class="site-header"><span class="site-brand">KOTR / 2027</span><nav class="site-nav" aria-label="Main navigation"></nav></header>
  <div class="site-context"><p class="site-label" id="site-catalog-status">Loading approved provisional routes</p>
    <p id="site-selection"></p>
    <p>Source D1–D4 labels are not verified calendar assignments. Departures and logistics are pending; no itinerary is inferred. Semonzo remains a separate example.</p></div>
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
    No offline pack is installed by this site; ordinary browser caching is not an offline guarantee.</footer>`;
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
  riderState.select(href);
  for (const a of shell.querySelectorAll('a')) {
    const patch=linkPatches.get(a);
    if (patch) a.href=selectionLink(changeSelection(next,patch));
  }
}
const linkedBriefing = installRouteBriefing(shell, reflectPosition);
subscribePlayback(snapshot=>{
  if (snapshot.identity?.routeId!==exampleRouteId || !snapshot.position) return;
  const text=el('site-example-position');
  if (text) text.textContent=`${(snapshot.distanceM/1000).toFixed(1)} km selected · ` +
    `${((snapshot.totalDistanceM-snapshot.distanceM)/1000).toFixed(1)} km remaining. No verified stop or water information.`;
  const cursor=el('site-profile-cursor');
  if (cursor) {
    const x=1000*snapshot.distanceM/snapshot.totalDistanceM;
    cursor.setAttribute('x1',x); cursor.setAttribute('x2',x);
  }
  for (const link of shell.querySelectorAll('#site-chapters a')) {
    if (new URL(link.href).searchParams.get('chapter')===snapshot.chapterId) link.setAttribute('aria-current','location');
    else link.removeAttribute('aria-current');
  }
});
installPreferences(shell.querySelector('.site-header'), {
  edit:() => {
    if (el('personal') && !el('legacy-explorer').hidden) {
      el('personal').open = true;
      el('mass').focus();
    } else navigateSelection({area:'explore', view:'clock'});
  },
  selection:() => selectionLink(current.state),
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
  const example = bundle.route.id === exampleRouteId;
  const section = card(parent, example ? 'Semonzo example briefing' : `${bundle.route.name} · Briefing`,
    example ?
    'Semonzo → Monte Grappa summit. A provisional ascent study, not an official event route, stage or group assignment. Surface and stops are not verified.'
    : 'The linked route briefing below uses the selected revision. No example geometry or estimates have been substituted.');
  node('p', `${bundle.revision.provenance.source} Observed ${bundle.revision.provenance.observedOn}.`, section);
  if (!example) {
    if (!profile) node('p', pendingProfiles.has(state.revisionId) ? 'Verifying selected route profile…' :
      'Profile unavailable: route files could not be verified. Reload to retry; route metadata and other choices remain available.',section);
    link(section, 'Plan this route / verified downloads', {area:'plan', view:'briefing'});
    return;
  }
  if (example) node('p', 'Distances follow the track’s horizontal great-circle axis; elevation is approximate.', section);
  if (!profile) {
    node('p', profileLoading ? 'Loading selected profile… Navigation remains available.' :
      'The selected profile is unavailable. Route status and navigation remain available; no distance or elevation estimates are shown.', section);
    return;
  }
  const gain = profile.chapters.reduce((sum,c) => sum + c.ascentM, 0);
  node('p', `${(profile.distanceM/1000).toFixed(1)} km · ${Math.round(gain)} m derived ascent, sampled at 250 m (not raw point-to-point ascent).`, section);
  const position=node('p', `${(state.distanceM/1000).toFixed(1)} km selected · ${((profile.distanceM-state.distanceM)/1000).toFixed(1)} km remaining. No verified stop or water information.`, section);
  position.id='site-example-position';
  const list = node('ol', '', section); list.id = 'site-chapters';
  for (const c of profile.chapters) {
    const li = node('li', '', list);
    const a = link(li, `${c.name} · ${(c.startM/1000).toFixed(1)}–${(c.endM/1000).toFixed(1)} km`, {chapterId:c.id, distanceM:c.startM});
    if (state.chapterId === c.id) a.setAttribute('aria-current','location');
    node('span', c.notice, li);
  }
  const heights = [profile.segments[0].startElevationM, ...profile.segments.map(s => s.endElevationM)];
  const low = Math.min(...heights), high = Math.max(...heights);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'site-profile'; svg.setAttribute('viewBox','0 0 1000 100'); svg.setAttribute('preserveAspectRatio','none');
  svg.setAttribute('role','img'); svg.setAttribute('aria-label',`Example elevation profile, ${Math.round(low)} to ${Math.round(high)} metres. Sections are listed above.`);
  const path = document.createElementNS(svg.namespaceURI,'path');
  const points = [[0, heights[0]], ...profile.segments.map(s => [s.endM, s.endElevationM])];
  path.setAttribute('d', `M0 100 L${points.map(([d,h]) => `${1000*d/profile.distanceM} ${95-90*(h-low)/(high-low)}`).join(' L')} L1000 100 Z`);
  path.setAttribute('fill','#729379'); svg.append(path); section.append(svg);
  const cursor=document.createElementNS(svg.namespaceURI,'line');
  cursor.id='site-profile-cursor';
  for (const [k,v] of Object.entries({x1:0,x2:0,y1:0,y2:100,stroke:'#8a3c22','stroke-width':4})) cursor.setAttribute(k,v);
  svg.append(cursor);
}
function render(focus = false, notify = true) {
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
  content.setAttribute('aria-busy', String(profileLoading || catalogLoading || pendingProfiles.has(s.revisionId)));
  if (planner) planner.root.hidden = s.area !== 'plan';
  const grid = node('div','',content); grid.className = 'site-grid';
  if (s.area === 'plan') {
    const intro = card(grid, 'A clear start, without a map',
      'Build a trip from the approved provisional route pack below. Source names and revisions are preserved; dates, departures, fundraising and organizer logistics remain unverified. Nothing here is an announced schedule.');
    const actions = node('div','',intro); actions.className = 'site-actions';
    if (bundle) {
      link(actions, 'Read selected route briefing', {area:'explore', view:'briefing'});
      link(actions, 'Compare routes / Skyline / Radial', {area:'explore', view:'compare'});
      if (bundle.route.id === exampleRouteId) link(actions, 'Open optional example flyover', {area:'explore', view:'flyover'});
    }
  } else if (s.area === 'prepare') {
    const prepare = card(grid, 'Start with the example', 'Practice weeks, packing checklist and chapter-linked training are not yet available. You can already read the example sections and explore optional time assumptions without entering FTP.');
    const actions = node('div','',prepare); actions.className = 'site-actions';
    if (bundle) {
      link(actions, 'Read selected section', {area:'explore', view:'briefing'});
      link(actions, 'Explore example time assumptions', {area:'explore', view:'clock'});
    }
    card(grid, 'Rider information stays optional', 'The ride clock and sensitivity tools share one validated profile and use fictional assumptions for omitted values. Entries stay in memory unless you choose Remember in Preferences & privacy; never in navigation links.');
  } else if (s.area === 'ride-week') {
    const ride = card(grid, 'Briefing · awaiting verification', 'Calendar mapping, departure, contacts, logistics and sourced stops are not published. There is no “today” or “tomorrow” assignment. This is not live tracking or turn-by-turn navigation.');
    const actions = node('div','',ride); actions.className = 'site-actions';
    if (bundle) link(actions, 'Read selected route / section', {area:'explore', view:'briefing'});
    const downloads = card(grid, 'Downloads in Plan; print, offline & weather pending', 'Choose route downloads in Plan. No ride card, saved offline pack or weather service is installed. Do not rely on cached pages for navigation or current event information.');
    link(downloads, 'Open trip planner', {area:'plan', view:'briefing'});
  }
  if (bundle && s.area === 'explore') {
    const actions = node('div','',content); actions.className = 'site-actions';
    for (const [view,label] of (bundle.route.id === exampleRouteId ?
      [['briefing','Route briefing'],['clock','Example ride clock'],['sensitivity','FTP / weight sensitivity'],['flyover','Optional 3D flyover']] :
      [['briefing','Route briefing'],['compare','Compare variants'],['skyline','Skyline'],['radial','Radial']])) {
      const a = link(actions,label,{view});
      if (s.view === view) a.setAttribute('aria-current','page');
    }
    if (bundle.route.id === exampleRouteId) node('p', '3D is optional and uses online Mapbox services: requests expose your IP and the example region to the provider. Playback is an animation, not an estimated ride time. Open only if you want motion and online terrain.', content);
    if (!comparisonViews.includes(s.view)) briefing(content);
    if (comparisonViews.includes(s.view) && !comparison)
      node('p','Route comparison unavailable while the approved catalog is loading or could not be verified.',content);
  }
  const explorer = el('legacy-explorer'), flyover = el('climb');
  const clockLink = document.querySelector('[data-site-clock]');
  if (clockLink) {
    clockLink.href = selectionLink({...s, area:'explore', view:'clock'});
    clockLink.onclick = event => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault(); navigateSelection({area:'explore',view:'clock'});
    };
  }
  const exampleEngine = bundle?.route.id === exampleRouteId && bundle.revision.id === catalog.resolve(exampleRouteId).revision.id;
  if (bundle && s.area === 'explore' && s.view !== 'briefing' && !comparisonViews.includes(s.view) && !exampleEngine)
    node('p', 'This interactive view is unavailable for the selected revision. Its route briefing remains available; no example has been substituted.', content);
  if (explorer) explorer.hidden = !exampleEngine || s.area !== 'explore' || !['clock','sensitivity'].includes(s.view);
  if (flyover) flyover.hidden = !exampleEngine || s.area !== 'explore' || s.view !== 'flyover';
  if (explorer && !explorer.hidden && s.view === 'sensitivity') el('sensitivity').open = true;
  if (flyover && !flyover.hidden && !profileLoading) {
    flyover.dataset.distance = s.distanceM;
    startFlyover();
  }
  linkedBriefing.show(current);
  comparison?.show(current);
  if (notify) {
    if (code === 'ready' && profiles[s.revisionId]?.status !== 'unsupported' && profiles[s.revisionId])
      routePlayback.selectRoute(s);
    else routePlayback.clear();
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
async function startFlyover() {
  if (flyoverStarted) return;
  flyoverStarted = true;
  try {
    for (const source of document.querySelectorAll('script[data-flyover-src]')) {
      await new Promise((resolve,reject) => {
        const script = document.createElement('script');
        script.src = source.dataset.flyoverSrc;
        // Optional config/terrain failure must not block the local profile.
        script.onload = resolve;
        script.onerror = () => source.dataset.flyoverSrc.includes('/flyover.') ? reject(Error('Flyover unavailable')) : resolve();
        document.head.append(script);
      });
    }
  } catch {
    el('message').textContent = '3D unavailable; route briefing and profile still available. Reload to try again.';
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
  const url = new URL(href, location.href);
  // Keep each legacy engine in its own document; browser history restores the
  // same public selection. No rider inputs are copied between documents.
  const here = location.pathname.endsWith('explore.html') ? 'explore.html' : 'index.html';
  if (!url.pathname.endsWith(here)) {
    riderState.select(href).then(() => location.assign(href));
    return;
  }
  riderState.select(href);
  history[replace ? 'replaceState' : 'pushState'](null, '', href);
  current = resolveLocation();
  render(focus, notify);
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
const restore = () => { current = resolveLocation(); riderState.select(selectionLink(current.state)); render(true); };
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
    const data = {};
    for (const key of ['events','days','variants','routes','annotations'])
      data[key] = [...exampleCatalog.data[key], ...loaded.catalog.data[key]];
    catalog = createCatalog({schemaVersion:1, ...data});
    const analysisFor = createAnalysisStore(loaded.pack,read);
    comparison = installRouteComparison(shell, {catalog:loaded.catalog, analysisFor,
      navigate:navigateSelection, href:patch=>selectionLink(changeSelection(current.state,patch))});
    for (const route of loaded.catalog.data.routes) for (const revision of route.revisions) {
      pendingProfiles.add(revision.id);
      analysisFor(route.id,revision.id).then(analysis=>{
        profiles[revision.id]=analysis;
        if (analysis.status==='supported') registerPlaybackRoute(createAnalysisPlaybackRoute(analysis,
          {estimate:estimateRouteTime(analysis)}));
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
    el('site-catalog-status').textContent = 'Approved provisional routes · source labels, not a calendar schedule';
  } catch {
    el('site-catalog-status').textContent = 'Approved route pack unavailable or failed verification. Reload to retry; example remains separate.';
  }
  catalogLoading = false;
})();
const exampleReady = (async () => {
  try {
    const revision = catalog.resolve(exampleRouteId).revision.id;
    profiles[revision] = await loadProfile();
    registerPlaybackRoute(createSemonzoPlaybackRoute(await loadExampleTrack(),profiles[revision]));
  } catch { /* Named profile-unavailable state is rendered, never a fake total. */ }
  profileLoading = false;
})();
export const shellReady = (async () => {
  await Promise.all([catalogReady, exampleReady]);
  current = resolveLocation();
  render((location.search.length > 0 || location.hash.length > 0) && document.activeElement === document.body);
  shell.dataset.ready = 'true';
  return current;
})();
