import { displayMass, riderScenario, validateRider } from './rider-scenario.mjs';
import { validItinerary } from './itinerary.mjs';
import { decodePreferences, expiredPreference, preferenceCategories, validatePreferenceLink,
  PreferenceConflict, PreferenceRecordError, PreferenceStorageError } from './preference-storage.mjs';
export { decodePreferences, retentionMs, validatePreferenceLink } from './preference-storage.mjs';

const blank = () => ({mass:'', enteredUnit:'kg', ftp:'', unit:'kg', effort:'slower'});
const noVersions = () => ({rider:null, preferences:null});

export function createRiderPreferences({storage, now = Date.now, token = () => crypto.randomUUID(),
  announce = () => {}}) {
  let input = blank(), authority = noVersions(), observed = noVersions();
  let rememberedRoute = null, route = './index.html?area=plan&view=briefing';
  let itinerary = null, rememberTrip = false;
  let usable = true, storageFailed = false, loaded = false, epoch = 0, pendingRemovals = 0;
  let status = 'Memory only. Nothing is saved or sent.', privacyStatus = null, queue = Promise.resolve();
  const listeners = new Set();
  const consent = () => Object.fromEntries(preferenceCategories.map(key => [key, authority[key] !== null]));
  const snapshot = () => ({input:{...input}, validation:validateRider(input), consent:consent(),
    rememberedRoute, itinerary:structuredClone(itinerary), rememberTrip, status, usable});
  const emit = reset => { for (const listener of listeners) listener(snapshot(), reset); };
  function reset() { input = blank(); authority = noVersions(); rememberedRoute = null; itinerary = null; rememberTrip = false; }
  function failure(error, privacy) {
    if (!(error instanceof PreferenceConflict || error instanceof PreferenceRecordError ||
          error instanceof PreferenceStorageError)) throw error;
    if (error instanceof PreferenceConflict) reset();
    authority = noVersions();
    rememberTrip = false;
    usable = false;
    storageFailed = !(error instanceof PreferenceConflict);
    status = `${error.message} Memory-only use remains available. ` +
      (storageFailed ? 'Stored data may remain; use Forget or browser site-data settings.' :
        'Reload or focus this tab to review current consent versions, then choose Remember explicitly.');
    if (privacy) privacyStatus = status;
    emit(error instanceof PreferenceConflict);
  }
  function serial(work, privacy = false) {
    const generation = epoch;
    const result = queue.then(() => privacy || generation === epoch ? work() : undefined);
    queue = result.catch(error => failure(error, privacy));
    return queue;
  }
  const apply = command => storage.apply({...command, now:now()});
  function valueFor(category) {
    if (category === 'preferences') return {unit:input.unit, effort:input.effort, route,
      ...(rememberTrip && itinerary !== null && {itinerary:structuredClone(itinerary)})};
    if (validateRider(input).kind === 'invalid') return null;
    const {mass, enteredUnit, ftp} = input;
    return {mass, enteredUnit, ftp};
  }
  async function save(categories, renew = false) {
    const generation = epoch;
    for (const category of categories) {
      if (generation !== epoch || !usable) return;
      const expected = authority[category];
      if (expected === null) continue; // An observation is never write authority.
      const entry = await apply({type:renew ? 'renew' : 'save', category, expected, value:valueFor(category)});
      if (generation !== epoch) return;
      // Save/renew NEVER adopts any version, including the other category.
      if (category === 'preferences') rememberedRoute = entry.value.route;
      status = category === 'rider' && entry.value === null
        ? 'Invalid rider entries are not saved. Previously saved rider values were removed; correct or clear the errors.'
        : 'Chosen settings saved on this device only. Not publication permission or a backup.';
      announce();
      emit(false);
    }
  }
  function remove(categories, type) {
    let confirmed=false;
    epoch++;
    const generation = epoch;
    for (const category of categories) authority[category] = null;
    if (categories.includes('preferences')) { rememberedRoute = null; rememberTrip = false; }
    const all = type === 'forget';
    if (all) reset();
    pendingRemovals++;
    status = privacyStatus = all ? 'Clearing local rider values and route/UI preferences…' :
      `Removing remembered ${categories[0] === 'rider' ? 'rider values' : 'route/UI preferences'}…`;
    emit(all);
    // Explicit privacy operations survive EVERY epoch invalidation.
    return serial(async () => {
      try {
        const result = await apply(all
          ? {type, versions:{rider:token(), preferences:token()}}
          : {type, category:categories[0], nextVersion:token()});
        confirmed=true;
        for (const category of categories) {
          // A revoke result can update only its OWN observation, not authority.
          observed[category] = (all ? result[category] : result).consentVersion;
          authority[category] = null;
        }
        if (all) {
          storageFailed = false;
          // A committed Forget establishes both current observations even if
          // it superseded initial discovery. This is review, never authority.
          loaded = true;
        }
        if (generation === epoch) usable = !storageFailed;
        privacyStatus = all ? 'All app-owned rider values and route/UI preferences removed. Anonymous example; memory only.' :
          `Remember consent revoked. Stored ${categories[0] === 'rider' ? 'rider values' : 'route/UI preferences'} removed; current entries are memory only for this category.`;
        status = privacyStatus;
        announce();
        emit(all);
      } finally { pendingRemovals--; }
    }, true).then(()=>({confirmed,message:status}));
  }
  const ready = serial(async () => {
    const generation = epoch;
    const record = decodePreferences(await storage.read(), now());
    if (generation !== epoch) return;
    loaded = true;
    let expired = false;
    for (const category of preferenceCategories) {
      const entry = record[category];
      observed[category] = entry?.consentVersion ?? null;
      if (entry?.consent !== 'granted') continue;
      if (expiredPreference(entry, now())) {
        const tombstone = await apply({type:'expire', category, expected:entry.consentVersion, nextVersion:token()});
        if (generation !== epoch) return;
        observed[category] = tombstone.consentVersion;
        expired = true;
        announce();
        continue;
      }
      // Only initial restoration of a validated, existing grant may restore
      // authority without a new click. Its first renewal still checks storage.
      authority[category] = entry.consentVersion;
      if (category === 'rider' && entry.value)
        Object.assign(input, entry.value, {unit:entry.value.enteredUnit});
      if (category === 'preferences') {
        const {unit, effort, route:savedRoute} = entry.value;
        Object.assign(input, {unit, effort});
        route = rememberedRoute = savedRoute;
        itinerary = structuredClone(entry.value.itinerary ?? null);
        rememberTrip = itinerary !== null;
      }
    }
    await save(preferenceCategories, true);
    if (generation !== epoch) return;
    if (expired) status = 'Remembered settings expired after 90 days without use and were removed. Omitted values remain anonymous assumptions.';
    else if (Object.values(authority).some(Boolean))
      status = 'Remembered settings restored on this device. Open the saved route explicitly; incoming links take precedence.';
    emit(false);
  });
  return {
    ready, snapshot,
    subscribe(listener) { listeners.add(listener); listener(snapshot(), false); return () => listeners.delete(listener); },
    scenario:profile => riderScenario(profile, input),
    displayedMass:() => displayMass(input.mass, input.enteredUnit, input.unit),
    update(patch) {
      const next = {...input, ...patch};
      if (!['kg','lb'].includes(next.unit)) throw new TypeError('Unknown display unit');
      validateRider(next);
      const changed = preferenceCategories.filter(category =>
        (category === 'rider' ? ['mass','enteredUnit','ftp'] : ['unit','effort'])
          .some(key => next[key] !== input[key]) && authority[category] !== null);
      input = next;
      if (changed.length) status = 'Updating chosen device settings… Changes are not yet confirmed saved.';
      emit(false);
      return changed.length ? serial(() => save(changed)) : queue;
    },
    select(link) {
      if (!validatePreferenceLink(link)) throw new TypeError('Unsafe preference link');
      route = link;
      return authority.preferences !== null ? serial(() => save(['preferences'])) : queue;
    },
    setItinerary(value) {
      if (!validItinerary(value)) throw TypeError('Invalid itinerary');
      itinerary = structuredClone(value);
      emit(false);
      return rememberTrip && authority.preferences !== null ? serial(() => save(['preferences'])) : queue;
    },
    rememberItinerary(enabled) {
      // Additional explicit scope choice: old route/UI grants alone never
      // start persisting a newly introduced itinerary.
      if (!enabled) return remove(['preferences'], 'revoke');
      if (authority.preferences === null) return queue;
      rememberTrip = true;
      if (rememberTrip && itinerary === null) itinerary = {version:1, choices:[]};
      emit(false);
      // Scope changes rotate the existing category version too. A stale tab
      // cannot write an itinerary after this opt-in is revoked.
      return this.remember('preferences', true);
    },
    async remember(category, enabled) {
      if (!preferenceCategories.includes(category)) throw new TypeError('Unknown consent category');
      if (!enabled) {
        // Null local observations are not proof that nothing can commit: a
        // first grant may already be in flight here or in another tab.
        // Every explicit revocation must install its category marker durably.
        return remove([category], 'revoke');
      }
      // Capture the observation at the CLICK, not after a delayed queue/read.
      // A stale click fails CAS and requires another explicit choice; no retry.
      const generation = epoch, expected = observed[category], wasLoaded = loaded;
      await ready;
      if (generation !== epoch) return;
      if (!wasLoaded || !usable || pendingRemovals) {
        if (pendingRemovals) status = 'Removal still pending. Choose Remember again after it completes.';
        else if (!wasLoaded && usable) status = 'Settings have loaded. Review them and choose Remember again.';
        emit(false); return;
      }
      if (category === 'rider' && validateRider(input).kind === 'invalid') {
        status = 'Not saved. Correct or clear invalid rider entries before choosing Remember.';
        emit(false); return;
      }
      privacyStatus = null;
      status = 'Saving chosen device settings…';
      emit(false);
      return serial(async () => {
        const entry = await apply({type:'grant', category, expected, nextVersion:token(), value:valueFor(category)});
        if (generation !== epoch) return;
        observed[category] = authority[category] = entry.consentVersion;
        if (category === 'preferences') rememberedRoute = entry.value.route;
        status = 'Chosen settings saved on this device only. Not publication permission or a backup.';
        announce();
        emit(false);
      });
    },
    example() {
      input = blank();
      emit(true);
      return serial(() => save(preferenceCategories));
    },
    forget:() => remove(preferenceCategories, 'forget'),
    externalChange() {
      epoch++;
      reset();
      usable = false;
      status = [privacyStatus, 'Local settings changed or were deleted in another tab. This tab is now anonymous and memory only. Reload or focus to review settings before choosing Remember again.'].filter(Boolean).join(' ');
      emit(true);
    },
    check() {
      if (storageFailed) return queue;
      return serial(async () => {
        const generation = epoch;
        const record = decodePreferences(await storage.read(), now());
        if (generation !== epoch) return;
        const changed = preferenceCategories.some(category =>
          observed[category] !== (record[category]?.consentVersion ?? null) || expiredPreference(record[category], now()));
        // Focus/read can refresh observations, NEVER grant/restore authority.
        for (const category of preferenceCategories) observed[category] = record[category]?.consentVersion ?? null;
        loaded = true; // A current validated review can complete superseded discovery.
        // A no-change focus check is not a rider update. Emitting here would
        // hide/redraw dependent controls and could discard keyboard focus.
        if (!changed && usable) return;
        if (changed) {
          epoch++;
          reset();
          status = [privacyStatus, 'Local consent changed in another tab. Memory only; choose Remember explicitly after reviewing.'].filter(Boolean).join(' ');
        } else if (!usable) status = [privacyStatus, 'Current consent versions reviewed. Memory only; choose Remember explicitly.'].filter(Boolean).join(' ');
        usable = true;
        emit(changed);
      });
    },
    settled:() => queue,
  };
}
