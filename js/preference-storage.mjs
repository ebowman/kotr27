import { validateRider } from './rider-scenario.mjs';
import { validItinerary } from './itinerary.mjs';

// Only this named database belongs to rider/preferences. No origin-wide clear.
export const preferenceDatabase = 'kotr27-preferences';
export const retentionMs = 90 * 24 * 60 * 60 * 1000;
export const preferenceCategories = ['rider','preferences'];
const storeName = 'settings';

export class PreferenceStorageError extends Error {}
export class PreferenceConflict extends Error {}
export class PreferenceRecordError extends Error {}
const sameKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) &&
  Object.keys(value).sort().join() === [...keys].sort().join();
const invalidRecord = message => { throw new PreferenceRecordError(message); };
const version = value => typeof value === 'string' && value.length > 0 && value.length <= 128;

export function validatePreferenceLink(link) {
  if (typeof link !== 'string' || link.length > 2000 ||
      !/^\.\/(?:index|explore)\.html\?/.test(link)) return false;
  const url = new URL(link, 'https://local.invalid/');
  if (url.hash) return false;
  const allowed = {
    area:/^(plan|explore|prepare|ride-week)$/, view:/^(briefing|clock|sensitivity|flyover|compare|skyline|radial)$/,
    day:/^[a-z][a-z0-9-]*$/, variant:/^[a-z][a-z0-9-]*$/,
    route:/^(?:[a-z][a-z0-9-]*)?$/, rev:/^(?:[a-z][a-z0-9-]*)?$/,
    chapter:/^[a-z][a-z0-9-]*$/, at:/^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/,
  };
  return url.searchParams.has('area') && url.searchParams.has('view') &&
    [...url.searchParams].every(([key, value]) => allowed[key]?.test(value) &&
      url.searchParams.getAll(key).length === 1);
}

function validateValue(category, value) {
  // An invalid rider draft clears its saved payload, without persisting the
  // draft or invented example measurements. Its existing grant is unchanged.
  if (category === 'rider') {
    if (value === null) return;
    if (!sameKeys(value, ['mass','enteredUnit','ftp']) || typeof value.mass !== 'string' ||
        typeof value.ftp !== 'string' || !['kg','lb'].includes(value.enteredUnit) ||
        validateRider({...value, effort:'slower'}).kind === 'invalid')
      invalidRecord('Corrupt rider values. No personal values were restored.');
  } else if (!(sameKeys(value, ['unit','effort','route']) ||
      sameKeys(value, ['unit','effort','route','itinerary']) && validItinerary(value.itinerary)) || !['kg','lb'].includes(value.unit) ||
      !['slower','faster'].includes(value.effort) || !validatePreferenceLink(value.route))
    invalidRecord('Corrupt route/UI preferences. No preferences were restored.');
}

export function decodePreferences(record, now) {
  if (record === null) return {version:2, rider:null, preferences:null};
  if (record?.version !== 2)
    invalidRecord('Unsupported settings version. No migration is available; forget local data to start again.');
  if (!sameKeys(record, ['version','rider','preferences']))
    invalidRecord('Corrupt settings record. Forget local data to start again.');
  for (const category of preferenceCategories) {
    const entry = record[category];
    if (entry === null) continue;
    if (!sameKeys(entry, ['consentVersion','consent','savedAt','value']) ||
        !version(entry.consentVersion) || !['granted','revoked'].includes(entry.consent))
      invalidRecord('Corrupt consent record. No settings were restored.');
    if (entry.consent === 'revoked') {
      if (entry.value !== null || entry.savedAt !== null)
        invalidRecord('Corrupt revocation marker. No settings were restored.');
    } else {
      if (!Number.isFinite(entry.savedAt) || entry.savedAt < 0 || entry.savedAt > now)
        invalidRecord('Corrupt settings date. No personal values were restored.');
      validateValue(category, entry.value);
    }
  }
  return record;
}

export const expiredPreference = (entry, now) => entry?.consent === 'granted' &&
  now - entry.savedAt >= retentionMs;
const revoked = consentVersion => ({consentVersion, consent:'revoked', savedAt:null, value:null});

// Pure transactional contract used by both IndexedDB and deterministic tests.
// Only grant/revoke/forget/expiry rotate a CATEGORY's consent version. Ordinary
// writes/renewals cannot grant consent, change its version or touch a peer slot.
export function changePreferenceRecord(previous, command) {
  const {type, category, expected, nextVersion, now, value} = command;
  if (!Number.isFinite(now) || now < 0) throw new TypeError('Invalid settings clock');
  if (type === 'forget') {
    if (!preferenceCategories.every(key => version(command.versions?.[key])))
      throw new TypeError('Invalid revocation versions');
    const record = {version:2, rider:revoked(command.versions.rider), preferences:revoked(command.versions.preferences)};
    return {record, result:record}; // Both categories explicitly removed, never granted.
  }
  if (!preferenceCategories.includes(category)) throw new TypeError('Unknown settings category');
  const record = {...decodePreferences(previous, now)}, current = record[category];
  if (['grant','revoke','expire'].includes(type) && !version(nextVersion))
    throw new TypeError('Invalid consent version');
  if (type === 'revoke') {
    record[category] = revoked(nextVersion);
  } else {
    if ((current?.consentVersion ?? null) !== expected ||
        type !== 'grant' && (current?.consent !== 'granted' || type !== 'expire' && expiredPreference(current, now)))
      throw new PreferenceConflict('Consent changed or expired. Nothing saved; review settings and choose Remember again.');
    if (type === 'grant') {
      validateValue(category, value);
      record[category] = {consentVersion:nextVersion, consent:'granted', savedAt:now, value};
    } else if (type === 'save' || type === 'renew') {
      if (type === 'save') validateValue(category, value);
      // Renewal retains the CURRENT payload, never a delayed reader's copy.
      record[category] = {...current, savedAt:now, ...(type === 'save' && {value})};
    } else if (type === 'expire') {
      if (!expiredPreference(current, now)) throw new PreferenceConflict('Settings were used in another tab; expiry was not applied.');
      record[category] = revoked(nextVersion);
    } else throw new TypeError('Unknown settings operation');
  }
  // A single-category operation exposes ONLY its own slot to the caller.
  return {record, result:record[category]};
}

export function createPreferenceStorage(getFactory = () => globalThis.indexedDB, clock = Date.now) {
  async function connect(create) {
    let factory, databases;
    try {
      factory = getFactory();
      if (typeof factory?.databases !== 'function') throw new PreferenceStorageError('Device storage discovery is unavailable.');
      databases = await factory.databases();
    } catch (error) {
      if (error instanceof PreferenceStorageError) throw error;
      if (!(error instanceof DOMException)) throw error;
      throw new PreferenceStorageError(`Device storage unavailable (${error.name}).`);
    }
    // An ordinary anonymous visit does not even create an empty database.
    if (!create && !databases.some(db => db.name === preferenceDatabase)) return null;
    return new Promise((resolve, reject) => {
      // DB version 2 also fences still-open legacy version-1 clients: their
      // next open(…, 1) fails rather than using the superseded global-token
      // protocol against these records. Existing payloads are NOT migrated.
      let request;
      try { request = factory.open(preferenceDatabase, 2); }
      catch (error) {
        if (!(error instanceof DOMException)) throw error;
        reject(new PreferenceStorageError(`Device storage could not open (${error.name}).`));
        return;
      }
      let blocked = false;
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(storeName))
          request.result.createObjectStore(storeName);
      };
      request.onblocked = () => {
        blocked = true;
        reject(new PreferenceStorageError('Device storage is blocked by another tab. Close it and reload.'));
      };
      request.onerror = () => reject(new PreferenceStorageError(`Device storage could not open (${request.error.name}).`));
      request.onsuccess = () => {
        if (blocked) { request.result.close(); return; }
        resolve(request.result);
      };
    });
  }
  async function transaction(mode, create, transform) {
    const db = await connect(create);
    if (!db) return null;
    try {
      return await new Promise((resolve, reject) => {
        let value, failure;
        const tx = db.transaction(storeName, mode), store = tx.objectStore(storeName);
        const request = store.get('current');
        request.onsuccess = () => {
          try {
            const changed = transform(request.result ?? null);
            value = mode === 'readwrite' ? changed.result : changed;
            if (mode === 'readwrite') {
              // Remove every app-owned record, including obsolete schema keys.
              store.clear();
              store.put(changed.record, 'current');
            }
          } catch (error) { failure = error; tx.abort(); }
        };
        tx.oncomplete = () => resolve(value);
        tx.onabort = tx.onerror = () => reject(failure ||
          new PreferenceStorageError(`Device storage transaction failed (${tx.error?.name || 'aborted'}).`));
      });
    } catch (error) {
      if (error instanceof PreferenceConflict || error instanceof PreferenceStorageError || error instanceof PreferenceRecordError) throw error;
      // Only the IndexedDB boundary is translated, never rendering/model errors.
      if (!(error instanceof DOMException)) throw error;
      throw new PreferenceStorageError(`Device storage transaction unavailable (${error.name}).`);
    } finally { db.close(); }
  }
  return {
    read:() => transaction('readonly', false, value => value),
    // Sample time INSIDE the transaction, not before a queued/delayed open.
    // A peer may have legitimately renewed another category while we waited.
    apply:command => transaction('readwrite', true, previous =>
      changePreferenceRecord(previous, {...command, now:clock()})),
  };
}
