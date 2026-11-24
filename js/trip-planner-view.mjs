import { emptyItinerary, itineraryRows, chooseRoute, tripTotals } from './itinerary.mjs';
import { plannerAnalysis, routeSourceLink, downloadRoutes, browserDownload } from './trip-planner.mjs';

const node = (tag, text, parent) => {
  const e = document.createElement(tag); e.textContent = text; parent.append(e); return e;
};
const km = n => (n/1000).toFixed(1);
export function installTripPlanner(parent, {pack, catalog, read, preferences, preview, openRoute}) {
  const analyses = new Map(), errors = new Set();
  let itinerary = preferences.snapshot().itinerary ?? emptyItinerary();
  let generation = 0, busy = false, outcomes = [], pending = true;
  const root = node('section', '', parent);
  root.id = 'trip-planner';
  root.setAttribute('aria-label', 'Trip planner');
  function button(parent, text, id, action, disabled = false) {
    const b = node('button', text, parent); b.type = 'button'; b.id = id;
    b.disabled = disabled; b.onclick = action; return b;
  }
  function update(dayId, routeId, acknowledge = false) {
    preferences.setItinerary(chooseRoute(catalog, itinerary, dayId, routeId, {acknowledge}));
    if (acknowledge) (document.getElementById(`trip-choice-${dayId}`) ?? document.getElementById('trip-summary'))?.focus();
  }
  async function download(choices, format) {
    const request = generation;
    const trigger = document.activeElement?.id;
    busy = true; outcomes = []; render();
    await downloadRoutes({catalog, choices, format, read, handoff:browserDownload,
      isCurrent:() => generation === request,
      report:result => { outcomes.push(result); render(); }});
    busy = false; render();
    if (trigger && document.activeElement === document.body && !root.hidden)
      document.getElementById(trigger)?.focus();
  }
  function render() {
    const focus = root.contains(document.activeElement) ? document.activeElement.id : null;
    root.replaceChildren();
    root.dataset.ready = String(!pending);
    node('h2', 'Build my trip', root);
    for (const event of catalog.data.events)
      node('p', `${event.name} · ${event.status}. ${event.provenance.source}. Observed ${event.provenance.observedOn}.`, root);
    node('p', 'D1–D4 are source group labels, not verified dates or departures. Choose at most one variant per group; nothing is selected by default.', root);
    node('p', 'Selections are memory only unless you opt into Remember route/UI choices AND Also include my trip itinerary in Preferences & privacy. Reload or changing HTML documents loses unremembered choices.', root);
    const rows = itineraryRows(catalog, itinerary);
    const total = tripTotals(catalog, itinerary, analyses);
    const summary = node('p', `${total.selected} of ${catalog.data.days.length} groups selected · ` +
      `${km(total.distanceM)} km horizontal distance · ${Math.round(total.gainM)} m ascent (derived, 250 m windows). ` +
      (total.missing.length ? `Partial subtotal: ${total.available}/${total.selected} routes available. Missing metrics: ${total.missing.join(', ')}.` :
        total.selected ? 'Totals cover selected routes only, not unselected groups.' : 'Empty itinerary; no rides inferred.'), root);
    summary.id = 'trip-summary'; summary.tabIndex = -1; summary.setAttribute('role','status');
    const list = node('ul', '', root); list.id = 'trip-itinerary';
    for (const row of rows) node('li',
      `${row.choice.dayId}: ${row.route?.name ?? row.choice.routeId} · ${row.choice.revisionId} · ${row.status}`, list);
    node('p', 'Derived window ascent can omit short hills; source-listed and raw point gains differ and are not calibrated to agree. No verified facility POIs. GPX is a sanitized track without cues, timestamps or device metadata. FIT unavailable: no sanitized writer; GPX is never renamed to FIT.', root);
    const actions = node('div', '', root); actions.className = 'site-actions';
    for (const format of ['gpx','fit'])
      button(actions, `Download selected ${format.toUpperCase()}`, `trip-download-${format}`,
        () => download(itinerary.choices.map(c => ({...c})), format), busy || !rows.length);
    node('p', 'Browsers may block multiple downloads. “Handed to browser” is not proof of saving; check your Downloads, allow multiple files if wanted, or retry individual files below. Shared files are offered once per batch.', root);
    const results = node('ul', '', root); results.id = 'trip-download-results'; results.setAttribute('role','status');
    if (busy) node('li', 'Checking revision checksums…', results);
    for (const result of outcomes) node('li',
      `${result.routeId} · ${result.format.toUpperCase()}: ${result.message ?? result.status}. ${result.filename ?? ''}`, results);
    // Include removed day IDs: a saved tombstone must remain visible/removable.
    const days = [...catalog.data.days, ...rows.filter(r => !catalog.data.days.some(d => d.id === r.choice.dayId))
      .map(r => ({id:r.choice.dayId, name:'Unavailable saved group', status:'withdrawn'}))];
    for (const day of days) {
      const section = node('fieldset', '', root); section.className = 'trip-day';
      node('legend', `${day.name} · ${day.status}`, section);
      const saved = rows.find(r => r.choice.dayId === day.id), blocked = saved && saved.status !== 'ready';
      if (blocked) {
        const notice = node('div', '', section); notice.className = 'trip-change'; notice.setAttribute('role','status');
        node('p', `Saved selection ${saved.status}: ${saved.choice.revisionId}. Downloads for this group are blocked. Geometry, totals, sections and files may have changed; the old selection has NOT been replaced. Review the current metrics and revision below.`, notice);
        const change = pack.changeReport.changes.find(c => c.routeId === saved.choice.routeId &&
          c.beforeRevisionId === saved.choice.revisionId);
        if (change?.beforeTotals && change.afterTotals) {
          node('p', `Importer change report (raw point basis): ${km(change.beforeTotals.horizontalDistanceM)} → ${km(change.afterTotals.horizontalDistanceM)} km; ` +
            `${Math.round(change.beforeTotals.rawGainM)} → ${Math.round(change.afterTotals.rawGainM)} m raw ascent. Sections, annotations and downloads must be reviewed again.`, notice);
        } else node('p', 'Prior metrics are not in this pack; no old/new metric agreement is asserted. Current route facts are shown below.', notice);
        if (saved.status === 'changed' && saved.route?.currentRevisionId)
          button(notice, 'Acknowledge changes and use current revision', `trip-ack-${day.id}`,
            () => update(day.id, saved.route.id, true), busy);
        button(notice, 'Acknowledge and remove saved selection', `trip-remove-${day.id}`,
          () => update(day.id, null, true), busy);
      }
      const label = node('label', '', section);
      const select = node('select', '', label); select.id = `trip-choice-${day.id}`;
      label.prepend(document.createTextNode(`Use for ${day.name}`));
      select.add(new Option('Not selected', ''));
      const variants = catalog.data.variants.filter(v => v.dayId === day.id).map(v => v.id);
      const routes = catalog.data.routes.filter(r => variants.includes(r.variantId));
      for (const route of routes) {
        const option = new Option(`${route.name} · ${route.status}`, route.id);
        option.disabled = !route.currentRevisionId || route.status === 'withdrawn';
        select.add(option);
      }
      select.value = saved?.choice.routeId ?? '';
      select.disabled = Boolean(blocked || busy);
      select.onchange = () => update(day.id, select.value || null);
      for (const route of routes) {
        const article = node('article', '', section); article.className = 'trip-route';
        node('h3', route.name, article);
        const variant = catalog.data.variants.find(v => v.id === route.variantId);
        node('p', `${variant.name} · ${variant.status}`, article);
        node('p', `${route.status} · ${route.currentRevisionId ?? 'No available revision'}`, article);
        node('p', `${route.provenance.source}. Observed ${route.provenance.observedOn}; provider revision date unknown.`, article);
        const source = routeSourceLink(route);
        if (source) {
          const a = node('a', 'View on Ride with GPS (may require access)', article);
          a.href = source; a.rel = 'noreferrer'; a.referrerPolicy = 'no-referrer';
        }
        const analysis = analyses.get(route.currentRevisionId);
        if (analysis?.status === 'supported') {
          node('p', `${km(analysis.distanceM)} km · ${Math.round(analysis.processedTotals.ascentM)} m ascent — derived, 250 m windows. ` +
            `Raw point ascent: ${Math.round(analysis.rawTotals.ascentM)} m. ` +
            `RWGPS source-listed: ${km(analysis.sourceTotals.listed.distanceM)} km / ${analysis.sourceTotals.listed.gainM} m gain.`, article);
        } else node('p', errors.has(route.id) ? 'Metrics unavailable: route files could not be verified. Reload to retry; no zero-elevation substitute.' :
          route.currentRevisionId ? 'Verifying route metrics…' : 'Geometry and metrics unavailable.', article);
        const controls = node('div', '', article); controls.className = 'site-actions';
        if (route.currentRevisionId) {
          const a = node('a', 'Preview revision (does not change trip)', controls);
          a.href = preview(route); // Shell supplies a public revision-pinned link.
          a.onclick = event => {
            if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault(); openRoute(route);
          };
          const choice = {dayId:day.id, routeId:route.id, revisionId:route.currentRevisionId};
          for (const format of ['gpx','fit'])
            button(controls, format === 'gpx' ? 'Download GPX' : 'FIT unavailable', `trip-${format}-${route.id}`,
              () => download([choice], format), Boolean(busy || blocked || pending || format === 'fit'));
        }
      }
    }
    if (focus) root.querySelector(`[id="${focus}"]`)?.focus();
  }
  preferences.subscribe(state => {
    const next = state.itinerary ?? emptyItinerary();
    if (JSON.stringify(next) === JSON.stringify(itinerary)) return;
    itinerary = next; generation++; render();
  });
  render();
  const ready = Promise.all(catalog.data.routes.map(async route => {
    if (!route.currentRevisionId) return;
    try { analyses.set(route.currentRevisionId, await plannerAnalysis(pack, read, route)); }
    catch { errors.add(route.id); }
  })).then(() => { pending = false; render(); });
  return {root, ready};
}
