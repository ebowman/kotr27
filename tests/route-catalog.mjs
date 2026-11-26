import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createCatalog, verifyAsset } from '../js/route-catalog.mjs';
import { exampleCatalog, exampleRouteId } from '../js/example-catalog.mjs';

// Entirely synthetic organizer fixture. No event dates, route names or geometry
// from the unapproved 2027 intake; fixture data is never a release input.
const bytes = new TextEncoder().encode('synthetic geometry, not a real route');
const sha256 = createHash('sha256').update(bytes).digest('hex');
const provenance = {source:'Synthetic test fixture only', observedOn:'2026-11-24'};
const rights = {access:'public', redistribution:'approved', approval:'Synthetic test author'};
const record = id => ({id, name:id, status:'provisional', provenance:{...provenance}, rights:{...rights}});
function revision(id = 'fixture-r1', path = 'assets/synthetic.gpx', hash = sha256) {
  const binding = {revisionId:id, geometrySha256:hash};
  const asset = (path, format, digest = hash) => ({...binding, path, format, sha256:digest});
  return {
    id, status:'provisional', provenance:{...provenance}, rights:{...rights},
    geometrySha256:hash, geometry:asset(path, 'gpx'),
    profile:asset('assets/synthetic-profile.json', 'json'),
    climbs:asset('assets/synthetic-climbs.json', 'json'),
    pois:asset('assets/synthetic-pois.json', 'json'),
    downloads:[asset(path, 'gpx'), asset('assets/synthetic.fit', 'fit')],
    units:{distance:'m', elevation:'m', grade:'percent'},
    distanceSemantics:'horizontal-haversine-6371000m',
  };
}
function fixture() {
  return {
    schemaVersion:1,
    events:[{...record('fixture-event'), kind:'organizer'}],
    days:[{...record('fixture-day'), eventId:'fixture-event'}],
    variants:['fixture-short','fixture-long'].map(id => ({...record(id), dayId:'fixture-day'})),
    routes:[{
      ...record('fixture-route'), kind:'organizer', eventId:'fixture-event', variantId:'fixture-short',
      currentRevisionId:'fixture-r1', revisions:[revision()],
    }],
    annotations:[],
  };
}
const mutate = fn => { const data = fixture(); fn(data, data.routes[0], data.routes[0].revisions[0]); return data; };

test('entry pages retire the placeholder without inventing official group/calendar assignments', async () => {
  for(const entry of ['index.html','explore.html']) {
    const html = await readFile(new URL('../'+entry, import.meta.url), 'utf8');
    assert.match(html, /Seven approved provisional event routes/);
    assert.match(html, /Source day labels are not calendar assignments/);
    assert.doesNotMatch(html, /Semonzo|example ascent|await approval|Long groups only|for KOTR 2027 Long groups/i);
  }
});

test('add, rename, replace and withdraw without changing identity or inventing substitutes', () => {
  const original = fixture();
  const added = structuredClone(original);
  added.routes.push({...record('fixture-other-route'), kind:'organizer', eventId:'fixture-event',
    variantId:'fixture-long', currentRevisionId:null, revisions:[]});
  const catalog = createCatalog(added, {previous:original});
  assert.equal(catalog.data.routes.length, 2);
  assert.throws(() => catalog.resolve('fixture-other-route'), /revision unavailable/);
  added.routes[0].name = 'Renamed route';
  added.events[0].name = 'Renamed event';
  added.days[0].name = 'Renamed day';
  added.variants[0].name = 'Renamed variant';
  assert.equal(createCatalog(added, {previous:original}).resolve('fixture-route').route.name, 'Renamed route');
  assert.equal(catalog.resolve('fixture-route').route.name, 'fixture-route', 'snapshot cannot drift with input edits');
  assert.throws(() => { catalog.data.routes[0].name = 'mutation'; }, TypeError);
  const next = structuredClone(added);
  next.routes[0].revisions[0].status = 'superseded';
  const r2 = revision('fixture-r2', 'assets/synthetic-v2.gpx', 'b'.repeat(64));
  // Fresh paths for all changed bytes; never overwrite an old revision's assets.
  for (const key of ['profile','climbs','pois']) r2[key].path = `assets/${key}-v2.json`;
  r2.downloads[1].path = 'assets/synthetic-v2.fit';
  next.routes[0].revisions.push(r2);
  next.routes[0].currentRevisionId = r2.id;
  const replaced = createCatalog(next, {previous:added});
  assert.equal(replaced.resolve('fixture-route').revision.id, 'fixture-r2');
  assert.equal(replaced.resolve('fixture-route','fixture-r1').revision.status, 'superseded');
  assert.throws(() => replaced.resolve('fixture-route','unknown'), /revision unavailable/);
  next.routes[0].status = 'withdrawn';
  next.routes[0].revisions = [];
  next.routes[0].currentRevisionId = null;
  const withdrawn = createCatalog(next, {previous:replaced.data});
  assert.throws(() => withdrawn.resolve('fixture-route'), /withdrawn/);
  assert.throws(() => withdrawn.resolve('fixture-route','fixture-r1'), /withdrawn/);
  assert.throws(() => withdrawn.resolve('unknown'), /unknown route/);
});

test('optional metadata/assets absent means unknown, not zero or invented content', () => {
  const data = mutate((_, route, rev) => {
    for (const field of ['profile','climbs','pois','downloads']) delete rev[field];
  });
  const {revision:r, event} = createCatalog(data).resolve('fixture-route');
  assert.equal(r.profile, undefined);
  assert.equal(r.downloads, undefined);
  assert.equal(event.metadata, undefined);
  data.events[0].metadata = {
    startDate:{value:'2028-02-29', provenance, rights},
    timezone:{value:'Europe/Rome', provenance, rights},
  };
  createCatalog(data);
  data.events[0].metadata.startDate.value = '2027-02-29';
  assert.throws(() => createCatalog(data), /metadata.startDate.value.*real YYYY/);
});

test('malformed records, duplicate identities, bad bindings and units fail at their field', () => {
  const cases = [
    [d => { d.schemaVersion = 2; }, /schemaVersion/],
    [d => { d.routes = null; }, /routes.*array/],
    [d => { d.routes.length = 2; }, /missing array entry/],
    [d => { d.events[0] = null; }, /events\[0\].*record/],
    [d => { d.days.push({...d.days[0]}); }, /duplicate ID/],
    [d => { d.variants[0].id = d.routes[0].id; }, /duplicate ID|unknown variants/],
    [(d,r) => { r.kind = 'example'; }, /kind.*match event/],
    [(d,r) => { r.variantId = 'missing'; }, /unknown variants/],
    [(d,r,v) => { v.geometrySha256 = 'a'.repeat(64); }, /mixed revision/],
    [(d,r,v) => { v.geometry.sha256 = 'a'.repeat(64); }, /must equal geometrySha256/],
    [(d,r,v) => { v.geometry.sha256 = 'short'; }, /full SHA-256/],
    [(d,r,v) => { v.units.distance = 'km'; }, /units.distance/],
    [(d,r,v) => { v.units.grade = 'degrees'; }, /units.grade/],
    [(d,r,v) => { v.distanceSemantics = 'road'; }, /distanceSemantics/],
    [(d,r,v) => { v.profile.revisionId = 'old-revision'; }, /profile.*mixed revision/],
    [(d,r,v) => { v.pois.geometrySha256 = 'a'.repeat(64); }, /pois.*mixed revision/],
    [(d,r,v) => { v.downloads[1].revisionId = 'old-revision'; }, /downloads.*mixed revision/],
    [(d,r,v) => { v.downloads.push({...v.downloads[0]}); }, /duplicate download/],
    [(d,r,v) => { v.profile.path = v.geometry.path; v.profile.sha256 = 'c'.repeat(64); }, /conflicting SHA/],
    [(d,r,v) => { v.status = 'superseded'; }, /cannot select a superseded/],
    [(d,r) => { r.status = 'withdrawn'; }, /tombstones/],
    [(d,r) => { r.distance = 100; }, /unknown field/],
    [d => { d.events[0].metadata = {location:{value:'Somewhere', provenance, rights:{...rights, access:'private'}}}; }, /metadata.location.rights.*public/],
    [d => { d.days[0].status = 'withdrawn'; }, /withdrawn day/],
    [d => { d.events[0].status = 'withdrawn'; }, /withdrawn event/],
  ];
  for (const [edit, error] of cases) assert.throws(() => createCatalog(mutate(edit)), error);
  for (const path of ['../secret.gpx','/assets/x.gpx','https://invalid/x.gpx','assets/../x.gpx',
    'assets/%2e%2e/x.gpx','assets/x.gpx?code=secret','assets/x.gpx#x','assets\\x.gpx','assets//x.gpx']) {
    assert.throws(() => createCatalog(mutate((d,r,v) => { v.geometry.path = path; })), /safe.*path/);
  }
});

test('permission gates apply to metadata, bundles, annotations and example/official boundaries', () => {
  for (const permission of [
    {access:'public',redistribution:'unknown'},
    {access:'public',redistribution:'denied'},
    {...rights,access:'participant'}, {...rights,access:'private'},
  ]) {
    for (const edit of [
      d => { d.events[0].rights = permission; },
      d => { d.days[0].rights = permission; },
      d => { d.variants[0].rights = permission; },
      (d,r) => { r.rights = permission; },
      (d,r,v) => { v.rights = permission; },
    ]) assert.throws(() => createCatalog(mutate(edit)), /public catalog requires/);
  }
  assert.throws(() => createCatalog(mutate((d,r) => { delete r.rights.approval; })), /approval reference/);
  const data = mutate((d,r,v) => { v.rights.redistribution = 'denied'; });
  assert.throws(() => createCatalog(data, {audience:'internal'}).resolve('fixture-route'), /public catalog requires/);
  const privateDay = mutate(d => { d.days[0].rights.access = 'participant'; });
  assert.throws(() => createCatalog(privateDay, {audience:'internal'}).resolve('fixture-route'), /public catalog requires/);
  const local = mutate((d,r) => { d.events[0].kind = r.kind = 'local'; });
  assert.throws(() => createCatalog(local), /local data/);
  const annotation = {...record('notice-v1'), routeId:'fixture-route', revisionId:'fixture-r1', text:'Synthetic organizer note'};
  const notes = fixture();
  notes.annotations.push(annotation);
  createCatalog(notes);
  notes.annotations[0].rights.access = 'participant';
  assert.throws(() => createCatalog(notes), /annotations.*public catalog/);
  notes.annotations[0].rights.access = 'public';
  notes.annotations[0].revisionId = 'missing';
  assert.throws(() => createCatalog(notes), /annotation must target/);
});

test('immutable bundle IDs cannot hide changed geometry, derivation or ownership', () => {
  const before = fixture();
  const changed = structuredClone(before);
  changed.routes[0].revisions[0].profile = {
    revisionId:'fixture-r1', geometrySha256:sha256, recipe:'new-method-v2',
  };
  assert.throws(() => createCatalog(changed, {previous:before}), /immutable bundle changed/);
  changed.routes[0].revisions[0] = structuredClone(before.routes[0].revisions[0]);
  changed.routes[0].id = 'different-owner';
  assert.throws(() => createCatalog(changed, {previous:before}), /immutable bundle changed/);
  // Organizer annotation-only publication does not rewrite geometry/derived facts.
  const annotated = structuredClone(before);
  annotated.annotations.push({...record('notice-v1'), routeId:'fixture-route', revisionId:'fixture-r1', text:'Synthetic notice'});
  createCatalog(annotated, {previous:before});
  const changedNote = structuredClone(annotated);
  changedNote.annotations[0].text = 'Changed notice';
  assert.throws(() => createCatalog(changedNote, {previous:annotated}), /immutable annotation changed/);
  const reclassified = structuredClone(before);
  reclassified.events[0].kind = reclassified.routes[0].kind = 'example';
  assert.throws(() => createCatalog(reclassified, {previous:before}), /identity changed/);
});

test('pinned asset bytes and existing example identity/provenance are verified', async () => {
  await verifyAsset({sha256}, bytes);
  await assert.rejects(verifyAsset({sha256}, new TextEncoder().encode('tampered')), /bytes do not match/);
  const {route, revision:rev} = exampleCatalog.resolve(exampleRouteId);
  assert.equal(route.kind, 'example');
  assert.equal(route.variantId, undefined);
  assert.equal(exampleCatalog.data.events[0].metadata, undefined);
  assert.equal(rev.profile.recipe, 'semonzo-250m-v1');
  await verifyAsset(rev.geometry, await readFile(new URL('../assets/semonzo.gpx', import.meta.url)));
});
