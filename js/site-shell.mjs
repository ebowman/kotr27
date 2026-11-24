import { exampleCatalog, exampleRouteId } from './example-catalog.mjs';
import { loadProfile } from './semonzo-profile.mjs';
import { areas, changeSelection, readSelection, selectionLink } from './route-state.mjs';
import { installPreferences, riderState } from './preferences-view.mjs';
import { createCatalog } from './route-catalog.mjs';
import { publicAssetReader, loadPlannerPack } from './trip-planner.mjs';
import { installTripPlanner } from './trip-planner-view.mjs';

const el = id => document.getElementById(id);
const labels = {plan:'Plan', explore:'Explore', prepare:'Prepare', 'ride-week':'Ride week'};
let catalog = exampleCatalog, planner = null, catalogLoading = true;
const profiles = {};
let current, flyoverStarted = false, profileLoading = true;
const resolveLocation = () => {
  const resolved = readSelection(location.href, catalog, profiles, exampleRouteId, {loading:profileLoading});
  if (catalogLoading && resolved.code === 'missing')
    return {...resolved, code:'loading', message:'Loading approved route catalog…'};
  return resolved;
};
const listeners = new Set();
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
    : 'This route’s detailed briefing is not available in this release. No example geometry or estimates have been substituted.');
  node('p', `${bundle.revision.provenance.source} Observed ${bundle.revision.provenance.observedOn}.`, section);
  if (!example) {
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
  node('p', `${(state.distanceM/1000).toFixed(1)} km selected · ${((profile.distanceM-state.distanceM)/1000).toFixed(1)} km remaining. No verified stop or water information.`, section);
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
  content.setAttribute('aria-busy', String(profileLoading || catalogLoading));
  if (planner) planner.root.hidden = s.area !== 'plan';
  const grid = node('div','',content); grid.className = 'site-grid';
  if (s.area === 'plan') {
    const intro = card(grid, 'A clear start, without a map',
      'Build a trip from the approved provisional route pack below. Source names and revisions are preserved; dates, departures, fundraising and organizer logistics remain unverified. Nothing here is an announced schedule.');
    const actions = node('div','',intro); actions.className = 'site-actions';
    if (bundle) {
      link(actions, 'Read selected route briefing', {area:'explore', view:'briefing'});
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
    for (const [view,label] of [['briefing','Route briefing'],['clock','Example ride clock'],['sensitivity','FTP / weight sensitivity'],['flyover','Optional 3D flyover']]) {
      const a = link(actions,label,{view});
      if (s.view === view) a.setAttribute('aria-current','page');
    }
    node('p', '3D is optional and uses online Mapbox services: requests expose your IP and the example region to the provider. Playback is an animation, not an estimated ride time. Open only if you want motion and online terrain.', content);
    briefing(content);
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
  if (bundle && s.area === 'explore' && s.view !== 'briefing' && !exampleEngine)
    node('p', 'This interactive view is unavailable for the selected revision. Its route briefing remains available; no example has been substituted.', content);
  if (explorer) explorer.hidden = !exampleEngine || s.area !== 'explore' || !['clock','sensitivity'].includes(s.view);
  if (flyover) flyover.hidden = !exampleEngine || s.area !== 'explore' || s.view !== 'flyover';
  if (explorer && !explorer.hidden && s.view === 'sensitivity') el('sensitivity').open = true;
  if (flyover && !flyover.hidden && !profileLoading) {
    flyover.dataset.distance = s.distanceM;
    startFlyover();
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
document.addEventListener('kotr-seek', e => navigateSelection({chapterId:null, distanceM:e.detail.distanceM}, {replace:true, focus:false, notify:false}));
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
    await riderState.ready;
    planner = installTripPlanner(shell, {...loaded, read, preferences:riderState,
      openRoute:route => navigateSelection({area:'plan', view:'briefing', routeId:route.id,
        revisionId:route.currentRevisionId, dayId:null, variantId:null}),
      preview:route => selectionLink(changeSelection(current.state, {
        area:'plan', view:'briefing', routeId:route.id, revisionId:route.currentRevisionId,
        dayId:null, variantId:null,
      }))});
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
