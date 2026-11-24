import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createCatalog } from '../js/route-catalog.mjs';
import { readRoutePack } from '../tools/route-pack.mjs';
import { emptyItinerary, chooseRoute, itineraryRows, tripTotals, validItinerary } from '../js/itinerary.mjs';
import { loadPlannerPack, publicAssetReader, plannerAnalysis, downloadRoutes, routeSourceLink } from '../js/trip-planner.mjs';
import { createRiderPreferences } from '../js/rider-preferences.mjs';
import { changePreferenceRecord, PreferenceStorageError, decodePreferences, retentionMs } from '../js/preference-storage.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root));
const {pack} = await readRoutePack(root.pathname);
const catalog = createCatalog(pack.catalog);
const analyses = new Map(await Promise.all(catalog.data.routes.map(async route =>
  [route.currentRevisionId, await plannerAnalysis(pack, read, route)])));
const dayOf = route => catalog.data.variants.find(v => v.id === route.variantId).dayId;
const choice = route => ({dayId:dayOf(route), routeId:route.id, revisionId:route.currentRevisionId});
function preferencesFixture() {
  let record = null, version = 0;
  const storage = {
    async read() { return structuredClone(record); },
    async apply(command) {
      const changed = changePreferenceRecord(record, command);
      record = structuredClone(changed.record); return structuredClone(changed.result);
    },
  };
  return {storage, record:() => record,
    make:() => createRiderPreferences({storage, now:() => 1000, token:() => `version-${++version}`})};
}

test('real seven pack: all variants, partial totals and switching only one group', async () => {
  const loaded = await loadPlannerPack(read);
  assert.deepEqual(loaded.pack, pack);
  assert.equal(analyses.size, 7);
  let trip = emptyItinerary();
  for (const route of catalog.data.routes) {
    const before = trip.choices.filter(c => c.dayId !== dayOf(route));
    trip = chooseRoute(catalog, trip, dayOf(route), route.id);
    assert.deepEqual(trip.choices.filter(c => c.dayId !== dayOf(route)), before);
    const totals = tripTotals(catalog, trip, analyses);
    assert.equal(totals.available, trip.choices.length);
    assert.equal(totals.distanceM, trip.choices.reduce((s,c) => s + analyses.get(c.revisionId).distanceM, 0));
    assert.equal(totals.gainM, trip.choices.reduce((s,c) => s + analyses.get(c.revisionId).processedTotals.ascentM, 0));
    assert.match(routeSourceLink(route), /^https:\/\/ridewithgps.com\/routes\/\d+$/);
  }
  assert.equal(trip.choices.length, 4);
  trip = chooseRoute(catalog, trip, trip.choices[0].dayId, null);
  assert.equal(tripTotals(catalog, trip, analyses).selected, 3);
  const unavailable = new Map(analyses);
  unavailable.delete(trip.choices[0].revisionId);
  assert.deepEqual(tripTotals(catalog, trip, unavailable).missing, [trip.choices[0].dayId]);
  assert.equal(tripTotals(catalog, emptyItinerary(), analyses).distanceM, 0);
  assert.equal(validItinerary({version:1, choices:[trip.choices[0],trip.choices[0]]}), false);
});

test('revision replacement / withdrawal never replace or download without acknowledgment', async () => {
  const route = catalog.data.routes[0], trip = {version:1, choices:[choice(route)]};
  const data = structuredClone(catalog.data), revised = data.routes[0];
  revised.currentRevisionId = 'synthetic-replacement-v2';
  revised.revisions[0].id = revised.currentRevisionId;
  for (const ref of [revised.revisions[0].geometry, revised.revisions[0].profile, ...revised.revisions[0].downloads])
    ref.revisionId = revised.currentRevisionId;
  const next = createCatalog(data);
  assert.equal(itineraryRows(next, trip)[0].status, 'changed');
  assert.throws(() => chooseRoute(next, trip, dayOf(route), route.id), /acknowledge/);
  assert.deepEqual(trip.choices[0], choice(route), 'saved identity untouched');
  const results = await downloadRoutes({catalog:next, choices:trip.choices, format:'gpx',
    read:() => assert.fail('stale must not fetch'), handoff:() => assert.fail('must not export')});
  assert.equal(results[0].status, 'failed');
  const accepted = chooseRoute(next, trip, dayOf(route), route.id, {acknowledge:true});
  assert.equal(accepted.choices[0].revisionId, 'synthetic-replacement-v2');
  revised.status = 'withdrawn'; revised.currentRevisionId = null; revised.revisions = [];
  const withdrawn = createCatalog(data);
  assert.equal(itineraryRows(withdrawn, trip)[0].status, 'withdrawn');
  assert.throws(() => chooseRoute(withdrawn, trip, dayOf(route), null), /acknowledge/);
  assert.deepEqual(chooseRoute(withdrawn, trip, dayOf(route), null, {acknowledge:true}), emptyItinerary());
});

test('individual and batch verify exact bytes; FIT, partial failure, duplicates and async cancellation explicit', async () => {
  const routes = catalog.data.routes;
  for (const route of routes) {
    const expected = await read(route.revisions[0].geometry.path);
    const results = await downloadRoutes({catalog, choices:[choice(route)], format:'gpx', read,
      handoff:(bytes, name) => {
        assert.deepEqual(Buffer.from(bytes), expected);
        assert.equal(name, `${route.id}--${route.currentRevisionId}.gpx`);
        assert.doesNotMatch(Buffer.from(bytes).toString(), /<time>|<metadata>|<name>|<extensions>|privacy|device/i);
      }});
    assert.equal(results[0].status,'handed-to-browser');
  }
  const selected = catalog.data.days.map(day => choice(routes.find(r => dayOf(r) === day.id)));
  const badPath = routes.find(r => r.id === selected[1].routeId).revisions[0].geometry.path;
  const outcomes = await downloadRoutes({catalog, choices:selected, format:'gpx',
    read:path => path === badPath ? Buffer.from('tampered') : read(path), handoff:() => {}});
  assert.equal(outcomes.filter(r => r.status === 'failed').length,1);
  assert.equal(outcomes.filter(r => r.status === 'handed-to-browser').length,3);
  const fits = await downloadRoutes({catalog, choices:selected, format:'fit',
    read:() => assert.fail('FIT must not fetch'), handoff:() => assert.fail('no fake FIT')});
  assert.ok(fits.every(r => r.status === 'failed' && /FIT unavailable/.test(r.message)));
  let current = true, handed = false;
  const canceled = await downloadRoutes({catalog, choices:[selected[0]], format:'gpx',
    read:async path => { current = false; return read(path); }, handoff:() => { handed = true; }, isCurrent:() => current});
  assert.equal(canceled[0].status,'failed'); assert.equal(handed,false);
  // Distinct planned days sharing a file count as rides, but export once.
  const data = structuredClone(catalog.data);
  const a = data.routes.find(r => r.id === selected[0].routeId);
  const b = data.routes.find(r => r.id === selected[1].routeId);
  b.revisions[0].geometrySha256 = a.revisions[0].geometrySha256;
  b.revisions[0].geometry = {...a.revisions[0].geometry, revisionId:b.currentRevisionId};
  delete b.revisions[0].profile;
  b.revisions[0].downloads = [b.revisions[0].geometry];
  const shared = await downloadRoutes({catalog:createCatalog(data), choices:selected.slice(0,2),
    format:'gpx', read, handoff:() => {}});
  assert.deepEqual(shared.map(r => r.status), ['handed-to-browser','shared-file-already-offered']);
});

test('public loader rejects unsafe paths, pointer/manifest mismatch, redirects and private referrers', async () => {
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++;
    assert.equal(url.search, '');
    assert.equal(options.credentials,'omit');
    assert.equal(options.referrerPolicy,'no-referrer');
    assert.equal(options.redirect,'error');
    return {ok:true, arrayBuffer:async () => new ArrayBuffer(0)};
  };
  const reader = publicAssetReader('https://static.invalid/kotr27/index.html?privacy_code=secret',fetcher);
  for (const path of ['.private/original.fit','assets/../secret','https://private.invalid/a','assets/route-pack.json?token=x'])
    await assert.rejects(reader(path), /allowlist/);
  assert.equal(calls,0);
  await reader('assets/route-pack.json'); assert.equal(calls,1);
  await assert.rejects(loadPlannerPack(async path => path === 'assets/route-pack.json' ? read(path) : Buffer.from('{}')), /bytes do not match/);
});

test('itinerary exact nested schema, explicit extra opt-in, reload, expiry, revoke and Forget fences', async () => {
  const f = preferencesFixture(), a = f.make(); await a.ready;
  const trip = {version:1, choices:[choice(catalog.data.routes[0])]};
  await a.setItinerary(trip); assert.equal(f.record(),null);
  await a.remember('preferences',true);
  assert.equal(f.record().preferences.value.itinerary, undefined, 'old/general UI consent is not extra itinerary consent');
  await a.rememberItinerary(true);
  assert.deepEqual(f.record().preferences.value.itinerary,trip);
  const b = f.make(); await b.ready;
  assert.deepEqual(b.snapshot().itinerary,trip);
  await b.rememberItinerary(false);
  assert.equal(f.record().preferences.consent,'revoked');
  await a.setItinerary(emptyItinerary());
  assert.equal(f.record().preferences.consent,'revoked', 'stale writer cannot restore itinerary without broadcast');
  assert.equal(a.snapshot().itinerary,null);
  const c = f.make(); await c.ready;
  await c.remember('preferences',true); await c.setItinerary(trip); await c.rememberItinerary(true);
  const stale = f.make(); await stale.ready;
  await c.forget(); await stale.setItinerary(trip);
  assert.equal(f.record().preferences.value,null);
  assert.equal(stale.snapshot().itinerary,null);
  const good = {version:2,rider:null,preferences:{consent:'granted',consentVersion:'x',savedAt:1000,
    value:{unit:'kg',effort:'slower',route:'./index.html?area=plan&view=briefing',itinerary:trip}}};
  for (const bad of [{...trip,version:2}, {...trip,secret:'x'},
    {version:1,choices:[{...trip.choices[0],revisionId:'https://private.invalid'}]}]) {
    const record = structuredClone(good); record.preferences.value.itinerary = bad;
    assert.throws(() => decodePreferences(record,1000),/Corrupt/);
  }
  let expiredRecord = structuredClone(good);
  const expired = createRiderPreferences({now:() => 1000 + retentionMs, token:() => 'expired',
    storage:{
      read:async () => structuredClone(expiredRecord),
      apply:async command => {
        const change = changePreferenceRecord(expiredRecord,command);
        expiredRecord = change.record; return change.result;
      },
    }});
  await expired.ready;
  assert.equal(expired.snapshot().itinerary,null);
  assert.equal(expiredRecord.preferences.consent,'revoked');
  assert.equal(expiredRecord.preferences.value,null);
});

test('unavailable storage keeps itinerary usable in memory, never claims persistence', async () => {
  const state = createRiderPreferences({storage:{
    read:async () => { throw new PreferenceStorageError('Denied'); },
    apply:async () => assert.fail('no storage write'),
  }});
  await state.ready;
  const trip = {version:1, choices:[choice(catalog.data.routes[0])]};
  await state.setItinerary(trip);
  assert.deepEqual(state.snapshot().itinerary,trip);
  assert.equal(state.snapshot().usable,false);
  assert.match(state.snapshot().status,/Memory-only/);
  await state.rememberItinerary(true);
  assert.equal(state.snapshot().rememberTrip,false);
});

test('sparse structured-cloned itinerary is rejected before restoration or aggregation', () => {
  for (const choices of [Array(1), [undefined], [null], [...Array(1), choice(catalog.data.routes[0])]]) {
    const itinerary = structuredClone({version:1, choices});
    assert.equal(validItinerary(itinerary),false);
    const record = {version:2,rider:null,preferences:{consent:'granted',consentVersion:'sparse-test',savedAt:1000,
      value:{unit:'kg',effort:'slower',route:'./index.html?area=plan&view=briefing',itinerary}}};
    assert.throws(() => decodePreferences(structuredClone(record),1000),/Corrupt route\/UI preferences/);
    assert.throws(() => tripTotals(catalog,itinerary,analyses),/Invalid itinerary/);
  }
});
