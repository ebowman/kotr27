import { createPreferenceStorage } from './preference-storage.mjs';
import { createRiderPreferences } from './rider-preferences.mjs';

// Messages contain no settings: peers invalidate, never adopt consent or data.
let channel = null;
if (typeof BroadcastChannel === 'function') {
  try { channel = new BroadcastChannel('kotr27-preferences'); }
  catch (error) {
    if (!['SecurityError','NotSupportedError'].includes(error.name)) throw error;
    // Per-category transactional consent checks still prevent stale writes.
    // Disclose delayed invalidation below; recheck on visibility/focus.
  }
}
export const riderState = createRiderPreferences({
  storage:createPreferenceStorage(), announce:() => channel?.postMessage('changed'),
});
if (channel) channel.onmessage = () => riderState.externalChange();
window.addEventListener('pageshow', event => { if (event.persisted) riderState.check(); });
window.addEventListener('focus', () => riderState.check());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') riderState.check();
});

export function installPreferences(parent, {edit, selection}) {
  const details = document.createElement('details');
  details.id = 'site-preferences';
  details.innerHTML = `
    <summary>Preferences &amp; privacy (optional)</summary>
    <p id="preference-profile"></p>
    <button id="preference-edit" type="button">Edit optional rider inputs</button>
    <p>Default: memory only, lost when this document closes. Rider values never enter public links,
      telemetry or network requests. Local permission is not publication permission.</p>
    <label><input id="remember-rider" type="checkbox"> Remember on this device: rider values</label>
    <label><input id="remember-preferences" type="checkbox"> Remember on this device: route/UI choices</label>
    <label><input id="remember-itinerary" type="checkbox"> Also include my trip itinerary in remembered route/UI choices</label>
    <p>Route/UI choices save the selected public route and revision, trip itinerary, display unit and Plan A pace,
      separately from weight and FTP. Stored routes are opened explicitly, never substituted for a link.
      Itinerary choices restore separately from the active route link; changed revisions need acknowledgment.
      Turning off itinerary remembering revokes route/UI saving too, preventing stale tabs from restoring it.
      Other controls remain memory-only.</p>
    <p>Device storage is not encrypted against other users of this browser profile or a backup.
      Settings expire after 90 days without use, on next open. Browser policy may deny or evict them.
      Other tabs return to anonymous use when settings change; they cannot silently restore consent.</p>
    <p id="preference-cross-tab" hidden>Immediate cross-tab messaging is unavailable. Settings are checked
      on focus and before saves; inactive tabs may display old entries until focused.</p>
    <p id="preference-status" role="status" aria-live="polite"></p>
    <a id="preference-route" hidden>Open remembered route / revision</a>
    <button id="preference-forget" type="button">Forget all local rider values and preferences</button>
    <p>Forget resets active rider calculations and removes this app’s stored settings, not unrelated
      site data or the public route link currently open. No offline pack or activity library is installed.
      Browser site-data settings can also remove HTTP cache. Personal-settings import/export is not approved.</p>`;
  parent.append(details);
  const el = id => details.querySelector(`#${id}`);
  el('preference-cross-tab').hidden = !!channel;
  el('preference-edit').onclick = edit;
  for (const category of ['rider','preferences']) {
    el(`remember-${category}`).onchange = async event => {
      const enabled = event.target.checked;
      if (category === 'preferences' && enabled)
        riderState.select(selection());
      await riderState.remember(category, enabled);
    };
  }
  el('preference-forget').onclick = () => riderState.forget();
  el('remember-itinerary').onchange = event => riderState.rememberItinerary(event.target.checked);
  riderState.subscribe(state => {
    for (const category of ['rider','preferences']) {
      el(`remember-${category}`).checked = state.consent[category];
      el(`remember-${category}`).disabled = !state.usable;
    }
    el('remember-itinerary').checked = state.rememberTrip && state.consent.preferences;
    el('remember-itinerary').disabled = !state.usable || !state.consent.preferences;
    el('preference-status').textContent = state.status;
    if (!state.usable || state.status.includes('expired after')) details.open = true;
    const {validation:v} = state;
    el('preference-profile').textContent = v.kind === 'invalid' ? 'Invalid rider inputs; no estimate. Correct or clear the errors.' :
      `${{example:'Anonymous fictional example', partial:'Partly supplied profile', personal:'Personal scenario'}[v.kind]}. ` +
      `Weight ${v.supplied.mass ? 'supplied' : 'assumed'}; FTP ${v.supplied.ftp ? 'supplied' : 'assumed'}. Bike/kit always assumed.`;
    const link = el('preference-route');
    link.hidden = !state.rememberedRoute;
    if (state.rememberedRoute) link.href = state.rememberedRoute;
    else link.removeAttribute('href');
  });
}
