import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRiderPreferences, decodePreferences, retentionMs, validatePreferenceLink } from '../js/rider-preferences.mjs';
import { changePreferenceRecord, PreferenceConflict, PreferenceStorageError } from '../js/preference-storage.mjs';
import { selectionLink, readSelection } from '../js/route-state.mjs';
import { exampleCatalog } from '../js/example-catalog.mjs';

const profile = JSON.parse(await readFile(new URL('../assets/semonzo-chapters.v1.json', import.meta.url)));
const now = 1800000000000;
const route = './explore.html?area=explore&view=clock&route=semonzo-example&rev=semonzo-example-v1';
function fixture(initial = null) {
  let record = structuredClone(initial), sequence = 0;
  const calls = [];
  const storage = {
    async read() { calls.push('read'); return structuredClone(record); },
    async apply(command) {
      calls.push(command.type);
      const changed = changePreferenceRecord(record, command);
      record = structuredClone(changed.record);
      return structuredClone(changed.result);
    },
  };
  const make = () => createRiderPreferences({storage, now:() => now, token:() => `token-${++sequence}`});
  return {make, storage, calls, record:() => record};
}
const payload = (f, category = 'rider') => f.record()?.[category]?.value ?? null;
function assertRevoked(f, category = 'rider') {
  assert.equal(f.record()[category].consent, 'revoked');
  assert.equal(f.record()[category].value, null);
  assert.equal(f.record()[category].savedAt, null);
}

test('anonymous/partial/personal provenance, bounds and invalid drafts share existing numeric semantics', async () => {
  const f = fixture(), state = f.make(); await state.ready;
  assert.equal(state.scenario(profile).kind, 'example');
  for (const [mass, ftp, kind, supplied] of [
    ['', '', 'example', {mass:false, ftp:false}], ['20', '', 'partial', {mass:true, ftp:false}],
    ['', '650', 'partial', {mass:false, ftp:true}], ['250', '30', 'personal', {mass:true, ftp:true}],
  ]) {
    await state.update({mass, ftp});
    assert.equal(state.scenario(profile).kind, kind);
    assert.deepEqual(state.scenario(profile).supplied, supplied);
  }
  for (const [field, values] of [
    ['mass', ['19.999', '250.001', 'NaN', '0x50', '1e2', ' ', '-80', '80kg']],
    ['ftp', ['29.999', '650.001', 'Infinity', '-1', '250watts']],
  ]) for (const value of values) {
    state.example();
    await state.update({[field]:value});
    assert.equal(state.scenario(profile).kind, 'invalid');
    assert.ok(state.snapshot().validation.errors[field]);
    assert.equal(state.scenario(profile).estimate, undefined);
  }
  assert.deepEqual(f.calls, ['read'], 'no persistence, even for personal drafts');
});

test('kg/lb display round trips retain exact original text, unit and physics across reload', async () => {
  for (const [mass, enteredUnit] of [['180.123456700', 'lb'], ['81.263444444', 'kg']]) {
    const f = fixture(), state = f.make(); await state.ready;
    await state.update({mass, enteredUnit, unit:enteredUnit, ftp:'250'});
    const baseline = state.scenario(profile);
    for (let i = 0; i < 10; i++) {
      await state.update({unit:'kg'}); await state.update({unit:'lb'});
      assert.deepEqual(state.scenario(profile), baseline);
    }
    await state.update({unit:enteredUnit});
    assert.equal(state.displayedMass(), mass);
    await state.remember('rider', true);
    assert.deepEqual(f.record().rider.value, {mass, enteredUnit, ftp:'250'});
    assert.equal(f.record().preferences, null);
    const reloaded = f.make(); await reloaded.ready;
    assert.equal(reloaded.displayedMass(), mass);
    assert.deepEqual(reloaded.scenario(profile), baseline);
  }
});

test('separate unchecked consent, denial, revocation, invalidation and forget preserve unrelated scope', async () => {
  const f = fixture(), state = f.make(); await state.ready;
  await state.update({mass:'180', enteredUnit:'lb', unit:'kg', ftp:'245', effort:'faster'});
  await state.select(route);
  assert.equal(f.record(), null, 'unchecked consent and ordinary drafts never persist');
  await state.remember('rider', false);
  assertRevoked(f); // Explicit removal is different from leaving consent unchecked.
  assert.equal(f.record().preferences, null, 'revocation writes only its non-personal category marker');
  await state.remember('preferences', true);
  assertRevoked(f);
  assert.deepEqual(f.record().preferences.value, {unit:'kg', effort:'faster', route});
  const other = f.make(); await other.ready;
  assert.equal(other.scenario(profile).kind, 'example', 'remembering UI cannot remember mass/FTP');
  assert.equal(other.snapshot().input.effort, 'faster');
  // A fresh deletion, not another category's renewal, invalidates the grant.
  await other.forget();
  await state.remember('rider', true);
  assert.equal(state.snapshot().validation.kind, 'example');
  assert.equal(state.snapshot().usable, false);
  await other.remember('preferences', true);
  await other.remember('rider', true);
  await other.update({ftp:'300'});
  await other.update({ftp:'bad'});
  assert.equal(payload(f), null, 'invalid draft removes old stored personal values');
  assert.match(other.snapshot().status, /Invalid rider entries are not saved/);
  await other.update({ftp:'300'});
  await other.remember('rider', false);
  assertRevoked(f);
  assert.ok(f.record().preferences);
  assert.equal(other.snapshot().input.ftp, '300', 'revoke keeps current memory-only draft');
  await other.forget();
  assert.equal(other.scenario(profile).kind, 'example');
  assert.deepEqual(other.snapshot().consent, {rider:false, preferences:false});
  assertRevoked(f); assertRevoked(f, 'preferences');
});

test('corruption and unsupported versions are explicit, not guessed migrations; expiry removes values', async () => {
  const f = fixture(), state = f.make(); await state.ready;
  await state.update({ftp:'280'}); await state.remember('rider', true);
  const valid = f.record();
  for (const bad of [
    {...valid, version:0}, {...valid, version:1}, {...valid, version:3}, {...valid, extra:true},
    {...valid, rider:{...valid.rider, value:{mass:'oops', enteredUnit:'kg', ftp:'280'}}},
    {...valid, rider:{...valid.rider, savedAt:now + 1}},
    {...valid, rider:{...valid.rider, consent:'revoked'}},
    {...valid, preferences:{...valid.rider, value:{unit:'kg', effort:'slower', route:route + '&ftp=280'}}},
  ]) {
    const broken = fixture(bad), s = broken.make(); await s.ready;
    assert.equal(s.scenario(profile).kind, 'example');
    assert.equal(s.snapshot().usable, false);
    assert.match(s.snapshot().status, /Unsupported|Corrupt/);
    assert.deepEqual(broken.calls, ['read']);
    await s.forget();
    assert.equal(s.snapshot().usable, true);
  }
  const expired = fixture({...valid, rider:{...valid.rider, savedAt:now - retentionMs}});
  const anonymous = expired.make(); await anonymous.ready;
  assert.equal(anonymous.scenario(profile).kind, 'example');
  assert.match(anonymous.snapshot().status, /expired/);
  assertRevoked(expired);
  assert.throws(() => decodePreferences(undefined, now), /Unsupported/);
});

test('read/write/delete exceptions are visible, with memory-only recovery and no false saved/deleted claim', async () => {
  for (const operation of ['read','write','forget']) {
    const f = fixture();
    f.storage[operation === 'read' ? 'read' : 'apply'] = async () => { throw new PreferenceStorageError(`Denied ${operation}`); };
    const s = f.make(); await s.ready;
    if (operation === 'write') { await s.update({ftp:'250'}); await s.remember('rider', true); }
    if (operation === 'forget') await s.forget();
    assert.match(s.snapshot().status, new RegExp(`Denied ${operation}.*Stored data may remain`));
    assert.deepEqual(s.snapshot().consent, {rider:false, preferences:false});
    await s.update({ftp:'300'});
    assert.equal(s.scenario(profile).kind, 'partial', 'anonymous/storage-denied mode remains usable');
  }
});

test('cross-tab deletion invalidates pending writes and cannot resurrect personal data or consent', async () => {
  const first = fixture(), unsaved = first.make(), deleting = first.make();
  await Promise.all([unsaved.ready, deleting.ready]);
  await unsaved.update({ftp:'310'});
  await deleting.forget();
  await unsaved.remember('rider', true);
  assertRevoked(first);
  assert.deepEqual(unsaved.snapshot().consent, {rider:false, preferences:false});
  const f = fixture(), old = f.make(); await old.ready;
  await old.update({ftp:'321'}); await old.remember('rider', true);
  const peer = f.make(); await peer.ready;
  await peer.forget();
  await old.update({ftp:'322'}); // No broadcast: atomic token guard still catches it.
  assert.equal(old.snapshot().usable, false);
  assert.equal(old.snapshot().validation.kind, 'example');
  assertRevoked(f);
  const current = f.make(); await current.ready;
  await current.update({ftp:'333'}); await current.remember('rider', true);
  const pending = current.update({ftp:'334'});
  current.externalChange();
  await pending;
  assert.equal(current.snapshot().validation.kind, 'example');
  assert.deepEqual(current.snapshot().consent, {rider:false, preferences:false});
  await current.update({ftp:'335'});
  assert.equal(f.record().rider.value.ftp, '333', 'queued stale update was canceled');
  const consentRace = f.make(); await consentRace.ready;
  const pendingConsent = consentRace.remember('rider', true);
  const deletion = consentRace.forget();
  await Promise.all([pendingConsent, deletion]);
  assert.deepEqual(consentRace.snapshot().consent, {rider:false, preferences:false});
  assertRevoked(f);
});

test('a late focus check or initial read cannot cancel Forget or restore deleted state', async () => {
  const f = fixture(), state = f.make(); await state.ready;
  await state.update({ftp:'300'}); await state.remember('rider', true);
  const stored = structuredClone(f.record()), gate = Promise.withResolvers();
  f.storage.read = () => gate.promise;
  const check = state.check();
  await Promise.resolve();
  const forgotten = state.forget();
  gate.resolve(stored);
  await Promise.all([check, forgotten]);
  assertRevoked(f);
  assert.match(state.snapshot().status, /All app-owned/);
  assert.equal(state.snapshot().validation.kind, 'example');
  const initialGate = Promise.withResolvers();
  f.storage.read = () => initialGate.promise;
  const opening = f.make();
  await Promise.resolve();
  opening.externalChange();
  initialGate.resolve(stored);
  await opening.ready;
  assert.equal(opening.snapshot().validation.kind, 'example');
  assert.deepEqual(opening.snapshot().consent, {rider:false, preferences:false});
});

test('peer invalidation cannot cancel explicit Forget queued behind a focus read', async () => {
  const f = fixture(), state = f.make(); await state.ready;
  await state.update({ftp:'300'}); await state.remember('rider', true);
  const read = f.storage.read, entered = Promise.withResolvers(), release = Promise.withResolvers();
  f.storage.read = async () => {
    f.storage.read = read;
    const snapshot = await read();
    entered.resolve();
    await release.promise;
    return snapshot;
  };
  const checking = state.check();
  await entered.promise;
  const peer = f.make(); await peer.ready; // Renewal broadcast delayed.
  const forgotten = state.forget();
  state.externalChange(); // The delayed broadcast arrives after the click.
  assert.match(state.snapshot().status, /Clearing/);
  release.resolve();
  await Promise.all([checking, forgotten]);
  assertRevoked(f);
  assertRevoked(f, 'preferences');
  assert.match(state.snapshot().status, /All app-owned/);
  await peer.update({ftp:'301'}); // Stale renewal/writer cannot undo deletion.
  const reloaded = f.make(); await reloaded.ready;
  assert.equal(reloaded.snapshot().input.ftp, '');
  assert.deepEqual(reloaded.snapshot().consent, {rider:false, preferences:false});
});

for (const category of ['all','rider','preferences']) for (const blocked of ['read','write'])
  test(`${category} removal survives peer invalidation behind an in-flight ${blocked}`, async () => {
    const f = fixture(), state = f.make(); await state.ready;
    await state.update({ftp:'300'});
    await state.select(route);
    await state.remember('rider', true); await state.remember('preferences', true);
    const key = blocked === 'read' ? 'read' : 'apply';
    const operation = f.storage[key], entered = Promise.withResolvers(), release = Promise.withResolvers();
    f.storage[key] = async (...args) => {
      f.storage[key] = operation;
      entered.resolve();
      await release.promise;
      return operation(...args);
    };
    const pending = blocked === 'read' ? state.check() : state.update({ftp:'301'});
    await entered.promise;
    const peer = f.make(); await peer.ready;
    await peer.update({unit:'lb'});
    const otherBefore = structuredClone(f.record());
    const removing = category === 'all' ? state.forget() : state.remember(category, false);
    state.externalChange();
    assert.match(state.snapshot().status, /Clearing|Removing/);
    release.resolve();
    await Promise.all([pending, removing]);
    assert.match(state.snapshot().status, /removed/);
    assert.equal(state.snapshot().usable, false, 'removal cannot re-enable consent after invalidation');
    assert.deepEqual(state.snapshot().consent, {rider:false, preferences:false});
    // Same-grant saves remain authorized until THAT category is revoked.
    // A held save may therefore commit FTP301 before preferences-only removal.
    if (blocked === 'write') otherBefore.rider.value.ftp = '301';
    for (const key of ['rider','preferences']) {
      if (category === 'all' || category === key) assertRevoked(f, key);
      else assert.deepEqual(f.record()[key], otherBefore[key],
        'preserve the current other category without adopting its authority');
    }
    await peer.update(category === 'preferences' ? {unit:'kg'} : {ftp:'302'});
    assert.equal(peer.snapshot().usable, false, 'stale peer save loses its category consent comparison');
    assertRevoked(f, category === 'all' ? 'rider' : category);
    const reloaded = f.make(); await reloaded.ready;
    assert.equal(reloaded.snapshot().consent[category === 'all' ? 'rider' : category], false);
  });

test('late initial renewal cannot resurrect a removed category, without any broadcast', async () => {
  for (const category of ['all','rider','preferences']) {
    const f = fixture(), state = f.make(); await state.ready;
    await state.update({ftp:'300'});
    await state.select(route);
    await state.remember('rider', true); await state.remember('preferences', true);
    const read = f.storage.read, entered = Promise.withResolvers(), release = Promise.withResolvers();
    f.storage.read = async () => {
      f.storage.read = read;
      const old = await read();
      entered.resolve();
      await release.promise;
      return old;
    };
    const opening = f.make();
    await entered.promise;
    if (category === 'all') await state.forget();
    else await state.remember(category, false);
    const removed = structuredClone(f.record());
    release.resolve();
    await opening.ready;
    assert.deepEqual(f.record(), removed);
    assert.deepEqual(opening.snapshot().consent, {rider:false, preferences:false});
    assert.equal(opening.snapshot().input.ftp, '');
    assert.equal(opening.snapshot().usable, false);
  }
});

test('in-flight privacy transactions survive notifications and expose actual deletion failures', async () => {
  for (const category of ['all','rider','preferences']) for (const denied of [false,true]) {
    const f = fixture(), state = f.make(); await state.ready;
    await state.update({ftp:'300'});
    await state.remember('rider', true); await state.remember('preferences', true);
    const operation = f.storage.apply, entered = Promise.withResolvers(), release = Promise.withResolvers();
    f.storage.apply = async (...args) => {
      entered.resolve();
      await release.promise;
      if (denied) throw new PreferenceStorageError('Deletion denied');
      return operation(...args);
    };
    const removing = category === 'all' ? state.forget() : state.remember(category, false);
    await entered.promise;
    const revoked = category === 'all' ? 'rider' : category;
    await state.remember(revoked, true);
    assert.equal(state.snapshot().consent[revoked], false, 'pending removal cannot silently regain consent');
    assert.match(state.snapshot().status, /Removal still pending/);
    state.externalChange();
    assert.match(state.snapshot().status, /Clearing|Removing/);
    release.resolve();
    await removing;
    state.externalChange(); // Late notifications must not hide a failed erasure.
    if (denied) {
      assert.match(state.snapshot().status, /Deletion denied.*Stored data may remain/);
      assert.doesNotMatch(state.snapshot().status, /All app-owned.*removed|Stored rider values removed/);
      assert.ok(f.record().rider);
    } else {
      assert.match(state.snapshot().status, /removed/);
      assertRevoked(f, category === 'all' ? 'rider' : category);
    }
    assert.deepEqual(state.snapshot().consent, {rider:false, preferences:false});
  }
});

test('remembered public selection preserves invalid/stale revision state and rejects private queries', async () => {
  for (const revision of ['', 'missing-revision', 'invalid/revision']) {
    const selected = readSelection(`./explore.html?route=semonzo-example&rev=${revision}`, exampleCatalog);
    const link = selectionLink(selected.state);
    assert.equal(validatePreferenceLink(link), true);
    assert.equal(readSelection(link, exampleCatalog).bundle, null);
    const f = fixture(), s = f.make(); await s.ready;
    await s.select(link); await s.remember('preferences', true);
    const reloaded = f.make(); await reloaded.ready;
    assert.equal(reloaded.snapshot().rememberedRoute, link);
  }
  for (const bad of [route + '&mass=80', route + '&ftp=250', route + '#private',
    'https://other.invalid/?area=plan&view=briefing', route + '&route=user:local',
    route + '&rev=duplicate']) assert.equal(validatePreferenceLink(bad), false);
});

for (const removed of ['rider','preferences'])
  test(`cross-category redesign: revoking the other category cannot regain ${removed} consent`, async () => {
    const other = removed === 'rider' ? 'preferences' : 'rider';
    const f = fixture(), a = f.make(); await a.ready;
    await a.update({ftp:'300'}); await a.select(route);
    await a.remember('rider', true); await a.remember('preferences', true);
    const read = f.storage.read, entered = Promise.withResolvers(), release = Promise.withResolvers();
    f.storage.read = async () => {
      f.storage.read = read;
      const stale = await read();
      entered.resolve();
      await release.promise;
      return stale;
    };
    const checking = a.check(); await entered.promise;
    const b = f.make(); await b.ready;
    await b.forget();
    const removedVersion = f.record()[removed].consentVersion;
    const revokingOther = a.remember(other, false);
    release.resolve();
    await Promise.all([checking, revokingOther]);
    assert.equal(f.record()[removed].consentVersion, removedVersion, 'other-category revocation cannot rotate this version');
    const grantsBefore = f.calls.filter(type => type === 'grant').length;
    // Exact review sequence: pace must not restore the remembered FTP.
    await a.update({effort:'faster'});
    assertRevoked(f, removed);
    // Also challenge the revoked category directly, not just irrelevant input.
    await a.update(removed === 'rider' ? {ftp:'301'} : {unit:'lb'});
    assertRevoked(f, removed);
    assert.equal(f.calls.filter(type => type === 'grant').length, grantsBefore, 'ordinary actions never grant');
    const reloaded = f.make(); await reloaded.ready;
    assert.deepEqual(reloaded.snapshot().consent, {rider:false, preferences:false});
    assert.equal(reloaded.snapshot().input.ftp, '');
    // Observation refresh is not write authority, even after the cross-category
    // operation has successfully written its own new revocation marker.
    await a.check();
    await a.update({ftp:'302', unit:'lb', effort:'faster'});
    assertRevoked(f, removed);
    assert.deepEqual(a.snapshot().consent, {rider:false, preferences:false});
    await a.remember(removed, true); // Fresh explicit choice against reviewed version.
    assert.equal(f.record()[removed].consent, 'granted');
    assert.notEqual(f.record()[removed].consentVersion, removedVersion);
    assertRevoked(f, other);
    const afterFreshConsent = f.make(); await afterFreshConsent.ready;
    assert.equal(afterFreshConsent.snapshot().consent[removed], true);
    assert.equal(afterFreshConsent.snapshot().consent[other], false);
    a.externalChange(); // Delayed notifications invalidate, never import grants.
    assert.deepEqual(a.snapshot().consent, {rider:false, preferences:false});
  });

for (const category of ['rider','preferences']) for (const kind of ['grant','renew'])
  test(`queued ${category} ${kind} loses to a peer Forget without notifications`, async () => {
    const f = fixture(), owner = f.make(); await owner.ready;
    await owner.update({ftp:'300'}); await owner.select(route);
    await owner.remember('rider', true); await owner.remember('preferences', true);
    const deleting = f.make(); await deleting.ready;
    const apply = f.storage.apply, entered = Promise.withResolvers(), release = Promise.withResolvers();
    f.storage.apply = async command => {
      if (command.type === kind && command.category === category) {
        f.storage.apply = apply;
        entered.resolve();
        await release.promise;
      }
      return apply(command);
    };
    const actor = kind === 'renew' ? f.make() : owner;
    const pending = kind === 'renew' ? actor.ready : actor.remember(category, true);
    await entered.promise;
    await deleting.forget();
    release.resolve();
    await pending;
    assertRevoked(f, category);
    assert.equal(actor.snapshot().consent[category], false);
  });

test('transaction contract returns only one category; renewal/save never rotate consent versions', () => {
  let record = null;
  const command = c => {
    const changed = changePreferenceRecord(record, {...c, now});
    record = changed.record;
    return changed.result;
  };
  command({type:'grant', category:'rider', expected:null, nextVersion:'rider-grant', value:{mass:'', enteredUnit:'kg', ftp:'300'}});
  command({type:'grant', category:'preferences', expected:null, nextVersion:'ui-grant', value:{unit:'kg', effort:'slower', route}});
  const before = structuredClone(record.rider);
  const result = command({type:'revoke', category:'preferences', nextVersion:'ui-revoked'});
  assert.deepEqual(Object.keys(result).sort(), ['consent','consentVersion','savedAt','value']);
  assert.deepEqual(record.rider, before);
  command({type:'renew', category:'rider', expected:'rider-grant'});
  assert.deepEqual(record.rider, before);
  assert.throws(() => command({type:'save', category:'rider', expected:result.consentVersion, value:before.value}), PreferenceConflict);
  assert.throws(() => command({type:'save', category:'preferences', expected:'ui-revoked', value:{unit:'lb', effort:'faster', route}}), PreferenceConflict);
  command({type:'forget', versions:{rider:'rider-deleted', preferences:'ui-deleted'}});
  assert.throws(() => command({type:'renew', category:'rider', expected:'rider-grant'}), PreferenceConflict);
  assert.deepEqual(record, {version:2,
    rider:{consentVersion:'rider-deleted', consent:'revoked', savedAt:null, value:null},
    preferences:{consentVersion:'ui-deleted', consent:'revoked', savedAt:null, value:null}});
});

test('retention is independently checked; tombstones have no personal payload and cannot expire into authority', async () => {
  const f = fixture(), s = f.make(); await s.ready;
  await s.update({ftp:'300'}); await s.remember('rider', true); await s.remember('preferences', true);
  const original = structuredClone(f.record());
  original.rider.savedAt = now - retentionMs;
  const aged = fixture(original), opening = aged.make(); await opening.ready;
  assertRevoked(aged, 'rider');
  assert.equal(aged.record().preferences.consent, 'granted');
  const tombstone = structuredClone(aged.record().rider);
  for (let i = 0; i < 10; i++) await opening.update({effort:i % 2 ? 'slower' : 'faster'});
  assert.deepEqual(aged.record().rider, tombstone);
  assert.throws(() => changePreferenceRecord(original, {type:'renew', category:'rider',
    expected:original.rider.consentVersion, now}), PreferenceConflict);
  assert.equal(decodePreferences(aged.record(), now + 10 * retentionMs).rider.consent, 'revoked');
  assert.deepEqual(Object.keys(aged.record()).sort(), ['preferences','rider','version'], 'constant-size record, not a tombstone history');
});

test('unchanged focus reads do not redraw controls or grant authority', async () => {
  const f = fixture(), state = f.make(); await state.ready;
  await state.update({ftp:'300'}); await state.remember('rider', true);
  let notifications = 0;
  state.subscribe(() => notifications++);
  const initial = notifications, before = structuredClone(f.record());
  await state.check(); await state.check();
  assert.equal(notifications, initial, 'preserve dependent keyboard focus on a no-change read');
  assert.deepEqual(f.record(), before, 'focus is not renewal or consent');
  state.externalChange();
  await state.check();
  assert.deepEqual(state.snapshot().consent, {rider:false, preferences:false});
  await state.update({ftp:'301'});
  assert.deepEqual(f.record(), before, 'observed active grants do not authorize an invalidated tab');
});

for (const category of ['rider','preferences']) for (const readFails of [false,true])
  for (const cleanupFails of [false,true])
  test(`consent recovery for ${category} after superseded discovery: read failure ${readFails}, cleanup failure ${cleanupFails}`, async () => {
    const f = fixture(), seed = f.make(); await seed.ready;
    await seed.update({ftp:'311', effort:'faster'});
    await seed.remember('rider', true); await seed.remember('preferences', true);
    const read = f.storage.read, apply = f.storage.apply;
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    f.storage.read = async () => {
      f.storage.read = read;
      const stale = await read();
      entered.resolve(); await release.promise;
      if (readFails) throw new PreferenceStorageError('Discovery denied');
      return stale;
    };
    f.storage.apply = command => {
      if (cleanupFails && command.type === 'forget') throw new PreferenceStorageError('Cleanup denied');
      return apply(command);
    };
    const state = f.make(); await entered.promise;
    const forgetting = state.forget();
    // A click made before the removal completes must not acquire its new version.
    const premature = state.remember(category, true);
    release.resolve();
    await Promise.all([state.ready, forgetting, premature]);
    assert.deepEqual(state.snapshot().consent, {rider:false, preferences:false});
    assert.equal(state.snapshot().input.ftp, '', 'the superseded discovery never restores its payload');
    if (readFails || cleanupFails) await state.check();
    if (cleanupFails) {
      const before = structuredClone(f.record());
      await state.remember(category, true);
      assert.match(state.snapshot().status, /Cleanup denied.*Stored data may remain/);
      assert.equal(state.snapshot().usable, false);
      assert.deepEqual(f.record(), before, 'failed cleanup cannot silently recover or grant');
      f.storage.apply = apply;
      await state.forget(); // Explicit recovery, not an automatic retry.
    }
    assertRevoked(f, 'rider'); assertRevoked(f, 'preferences');
    const removed = structuredClone(f.record());
    await state.update({ftp:'312', effort:'faster'});
    assert.deepEqual(f.record(), removed, 'ordinary actions do not regain authority');
    await state.remember(category, true);
    assert.equal(state.snapshot().consent[category], true, 'fresh explicit consent must recover without reload');
    const other = category === 'rider' ? 'preferences' : 'rider';
    assertRevoked(f, other);
    assert.notEqual(f.record()[category].consentVersion, removed[category].consentVersion);
    const reloaded = f.make(); await reloaded.ready;
    assert.equal(reloaded.snapshot().consent[category], true);
    assert.equal(reloaded.snapshot().consent[other], false);
    assert.equal(reloaded.snapshot().input.ftp, category === 'rider' ? '312' : '');
  });

for (const category of ['rider','preferences'])
  test(`consent recovery for ${category} through reviewed versions after invalidated initial discovery`, async () => {
    const f = fixture(), read = f.storage.read;
    const entered = Promise.withResolvers(), release = Promise.withResolvers();
    f.storage.read = async () => {
      f.storage.read = read;
      const stale = await read(); entered.resolve(); await release.promise;
      return stale;
    };
    const state = f.make(); await entered.promise;
    state.externalChange();
    release.resolve(); await state.ready;
    await state.check();
    await state.update({ftp:'312', effort:'faster'});
    assert.equal(f.record(), null, 'reviewing versions does not grant consent');
    await state.remember(category, true);
    assert.equal(state.snapshot().consent[category], true);
    assert.equal(f.record()[category === 'rider' ? 'preferences' : 'rider'], null);
  });

for (const category of ['rider','preferences']) for (const denied of [false,true])
  test(`first ${category} grant followed by revocation before commit: cleanup ${denied ? 'fails visibly' : 'wins'}`, async () => {
    const f = fixture(), state = f.make(); await state.ready;
    await state.update({ftp:'311', effort:'faster'}); await state.select(route);
    assert.equal(f.record(), null);
    const apply = f.storage.apply, entered = Promise.withResolvers(), release = Promise.withResolvers();
    const operations = [], statuses = [];
    state.subscribe(snapshot => statuses.push(snapshot.status));
    f.storage.apply = async command => {
      operations.push(command.type);
      if (command.type === 'grant') {
        entered.resolve();
        await release.promise;
      }
      if (command.type === 'revoke' && denied) throw new PreferenceStorageError('Cleanup denied');
      return apply(command);
    };
    const granting = state.remember(category, true);
    await entered.promise;
    const revoking = state.remember(category, false);
    const afterRevocation = statuses.length - 1;
    assert.deepEqual(state.snapshot().consent, {rider:false, preferences:false});
    release.resolve();
    await Promise.all([granting, revoking]);
    assert.deepEqual(operations, ['grant','revoke'], 'explicit revocation durably follows the first grant');
    assert.ok(!statuses.slice(afterRevocation).some(status => /Nothing is saved|Chosen settings saved/.test(status)));
    if (denied) {
      assert.equal(f.record()[category].consent, 'granted');
      assert.match(state.snapshot().status, /Cleanup denied.*Stored data may remain/);
      state.externalChange();
      assert.match(state.snapshot().status, /Cleanup denied.*Stored data may remain/);
    } else {
      assertRevoked(f, category);
      assert.match(state.snapshot().status, /consent revoked.*removed/);
    }
    const reloaded = f.make(); await reloaded.ready;
    assert.equal(reloaded.snapshot().consent[category], denied);
    assert.equal(reloaded.snapshot().input.ftp, denied && category === 'rider' ? '311' : '');
  });

for (const category of ['rider','preferences']) for (const phase of ['queued','committed-response-held'])
  test(`first ${category} grant revocation also wins with ${phase}`, async () => {
    const f = fixture(), state = f.make(); await state.ready;
    await state.update({ftp:'311', effort:'faster'});
    const apply = f.storage.apply, entered = Promise.withResolvers(), release = Promise.withResolvers();
    if (phase === 'committed-response-held') f.storage.apply = async command => {
      const result = await apply(command);
      if (command.type === 'grant') {
        entered.resolve();
        await release.promise;
      }
      return result;
    };
    const granting = state.remember(category, true);
    if (phase === 'committed-response-held') {
      await entered.promise;
      assert.equal(f.record()[category].consent, 'granted');
      assert.equal(state.snapshot().consent[category], false, 'local authority is still unset before response');
    }
    const revoking = state.remember(category, false);
    release.resolve();
    await Promise.all([granting, revoking]);
    assertRevoked(f, category);
    assert.equal(f.record()[category === 'rider' ? 'preferences' : 'rider'], null);
    assert.deepEqual(state.snapshot().consent, {rider:false, preferences:false});
    assert.match(state.snapshot().status, /consent revoked.*removed/);
  });

for (const category of ['rider','preferences'])
  test(`explicit ${category} revocation with null observations defeats a peer's first grant`, async () => {
    const f = fixture(), grantingTab = f.make(), revokingTab = f.make();
    await Promise.all([grantingTab.ready, revokingTab.ready]);
    await grantingTab.update({ftp:'311', effort:'faster'});
    const apply = f.storage.apply, entered = Promise.withResolvers(), release = Promise.withResolvers();
    f.storage.apply = async command => {
      if (command.type === 'grant') {
        entered.resolve();
        await release.promise;
      }
      return apply(command);
    };
    const granting = grantingTab.remember(category, true);
    await entered.promise;
    await revokingTab.remember(category, false);
    const tombstone = structuredClone(f.record()[category]);
    release.resolve();
    await granting;
    assert.deepEqual(f.record()[category], tombstone);
    assert.equal(grantingTab.snapshot().consent[category], false);
    assert.match(grantingTab.snapshot().status, /Consent changed or expired/);
  });
