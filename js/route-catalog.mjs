/**
 * Catalog v1. All paths are deployment-root-relative, never URLs.
 * See docs/route-catalog.md for the closed schema and publication contract.
 *
 * @typedef {'provisional'|'confirmed'|'superseded'|'withdrawn'} Status
 * @typedef {'example'|'organizer'|'local'} Kind
 * @typedef {{source:string, observedOn:string, publishedOn?:string}} Provenance
 * @typedef {{access:'public'|'participant'|'private',
 *   redistribution:'approved'|'unknown'|'denied', approval?:string}} Rights
 * @typedef {{id:string, name:string, status:Status, provenance:Provenance, rights:Rights}} Record
 * @typedef {{revisionId:string, geometrySha256:string}} Binding
 * @typedef {Binding & {path:string, sha256:string, format:string}} Asset
 * @typedef {Binding & {recipe:string}} Derivation
 * @typedef {{id:string, status:Status, provenance:Provenance, rights:Rights,
 *   geometrySha256:string, geometry:Asset, profile?:Asset|Derivation,
 *   climbs?:Asset|Derivation, pois?:Asset, downloads?:Asset[],
 *   units:{distance:'m', elevation:'m', grade:'percent'},
 *   distanceSemantics:'horizontal-haversine-6371000m'|'source-reported'}} Revision
 * @typedef {Record & {eventId:string, variantId?:string, kind:Kind,
 *   currentRevisionId:string|null, revisions:Revision[]}} Route
 * @typedef {{value:string, provenance:Provenance, rights:Rights}} VerifiedValue
 * @typedef {Record & {kind:Kind, metadata?:{startDate?:VerifiedValue,
 *   endDate?:VerifiedValue, timezone?:VerifiedValue, location?:VerifiedValue}}} Event
 * @typedef {Record & {eventId:string, date?:VerifiedValue}} Day
 * @typedef {Record & {dayId:string}} Variant
 * @typedef {Record & {routeId:string, revisionId:string, text:string}} Annotation
 * @typedef {{schemaVersion:1, events:Event[], days:Day[], variants:Variant[],
 *   routes:Route[], annotations:Annotation[]}} Catalog
 */

const fail = (path, message) => { throw Error(`Catalog ${path}: ${message}`); };
const text = (value, path) => {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f]/.test(value))
    fail(path, 'expected nonempty text without control characters');
};
const choice = (value, values, path) => {
  if (!values.includes(value)) fail(path, `expected ${values.join(' | ')}`);
};
const id = (value, path) => {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]*$/.test(value))
    fail(path, 'expected a stable lowercase ID (letters, digits, hyphens)');
};
const hash = (value, path) => {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))
    fail(path, 'expected a full SHA-256 hex digest');
};
const date = (value, path) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value)
    fail(path, 'expected a real YYYY-MM-DD date');
};
function object(value, required, optional, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    fail(path, 'expected a plain record');
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'required field missing');
  for (const key of Object.keys(value))
    if (![...required, ...optional].includes(key)) fail(`${path}.${key}`, 'unknown field; do not publish unreviewed extensions');
}
function array(value, path) {
  if (!Array.isArray(value)) fail(path, 'expected an array');
  for (let i = 0; i < value.length; i++)
    if (!Object.hasOwn(value, i)) fail(`${path}[${i}]`, 'missing array entry');
  return value;
}
function provenance(value, path) {
  object(value, ['source','observedOn'], ['publishedOn'], path);
  text(value.source, `${path}.source`);
  date(value.observedOn, `${path}.observedOn`);
  if (value.publishedOn !== undefined) date(value.publishedOn, `${path}.publishedOn`);
}
function rights(value, path, audience) {
  object(value, ['access','redistribution'], ['approval'], path);
  choice(value.access, ['public','participant','private'], `${path}.access`);
  choice(value.redistribution, ['approved','unknown','denied'], `${path}.redistribution`);
  if (value.approval !== undefined) text(value.approval, `${path}.approval`);
  if (value.redistribution === 'approved' && !value.approval)
    fail(path, 'approved redistribution requires an approval reference');
  if (audience === 'public' && (value.access !== 'public' || value.redistribution !== 'approved'))
    fail(path, 'public catalog requires public access AND approved redistribution; omit this record');
}
const common = ['id','name','status','provenance','rights'];
const statuses = ['provisional','confirmed','superseded','withdrawn'];
const kinds = ['example','organizer','local'];
const canonical = value => JSON.stringify(value, (_, v) =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/**
 * Validate, snapshot and freeze the only consumer contract. Throws a field-path
 * error, never filters restricted records or silently chooses another route.
 * `internal` is for local validation, NOT an authenticated publishing mechanism.
 * `previous` detects edits that reuse an immutable bundle ID across releases.
 * @param {Catalog} input
 * @param {{audience?:'public'|'internal', previous?:Catalog}} options
 */
export function createCatalog(input, {audience = 'public', previous} = {}) {
  choice(audience, ['public','internal'], 'audience');
  object(input, ['schemaVersion','events','days','variants','routes','annotations'], [], '$');
  if (input.schemaVersion !== 1) fail('schemaVersion', 'only version 1 is supported');
  const seen = new Set();
  function unique(value, path) {
    id(value, path);
    if (seen.has(value)) fail(path, `duplicate ID ${value}`);
    seen.add(value);
  }
  function record(value, required, optional, path) {
    object(value, [...common, ...required], optional, path);
    unique(value.id, `${path}.id`);
    text(value.name, `${path}.name`);
    choice(value.status, statuses, `${path}.status`);
    provenance(value.provenance, `${path}.provenance`);
    rights(value.rights, `${path}.rights`, audience);
  }
  function verified(value, path, isDate = false) {
    object(value, ['value','provenance','rights'], [], path);
    (isDate ? date : text)(value.value, `${path}.value`);
    provenance(value.provenance, `${path}.provenance`);
    rights(value.rights, `${path}.rights`, audience);
  }
  const indexes = {};
  for (const group of ['events','days','variants','routes','annotations']) {
    indexes[group] = new Map();
    array(input[group], group).forEach((value, i) => {
      // Check shape before indexing (null/malformed input must be actionable).
      if (!value || typeof value !== 'object') fail(`${group}[${i}]`, 'expected a record');
      indexes[group].set(value.id, value);
    });
  }
  function linked(group, key, path) {
    id(key, path);
    const value = indexes[group].get(key);
    if (!value) fail(path, `unknown ${group} ID ${key}`);
    return value;
  }
  input.events.forEach((event, i) => {
    const p = `events[${i}]`;
    record(event, ['kind'], ['metadata'], p);
    choice(event.kind, kinds, `${p}.kind`);
    if (audience === 'public' && event.kind === 'local') fail(p, 'local data cannot enter a public catalog');
    if (event.metadata !== undefined) {
      object(event.metadata, [], ['startDate','endDate','timezone','location'], `${p}.metadata`);
      for (const [field, value] of Object.entries(event.metadata))
        verified(value, `${p}.metadata.${field}`, field.endsWith('Date'));
      const {startDate, endDate, timezone} = event.metadata;
      if (startDate && endDate && startDate.value > endDate.value) fail(`${p}.metadata`, 'endDate precedes startDate');
      if (timezone) {
        try { new Intl.DateTimeFormat('en', {timeZone:timezone.value}); }
        catch { fail(`${p}.metadata.timezone`, 'expected a recognized timezone'); }
      }
    }
  });
  input.days.forEach((day, i) => {
    const p = `days[${i}]`;
    record(day, ['eventId'], ['date'], p);
    linked('events', day.eventId, `${p}.eventId`);
    if (day.date !== undefined) verified(day.date, `${p}.date`, true);
  });
  input.variants.forEach((variant, i) => {
    const p = `variants[${i}]`;
    record(variant, ['dayId'], [], p);
    linked('days', variant.dayId, `${p}.dayId`);
  });
  function reference(ref, revision, formats, p, recipe = false) {
    const derived = ref && Object.hasOwn(ref, 'recipe');
    object(ref, derived ? ['recipe','revisionId','geometrySha256'] :
      ['path','sha256','format','revisionId','geometrySha256'], [], p);
    if (ref.revisionId !== revision.id || ref.geometrySha256 !== revision.geometrySha256)
      fail(p, `mixed revision; bind to ${revision.id} and its geometrySha256`);
    if (derived) {
      if (!recipe) fail(p, 'this asset cannot be a runtime derivation');
      id(ref.recipe, `${p}.recipe`);
    } else {
      if (typeof ref.path !== 'string' ||
          !/^(?:assets|js)\/[a-zA-Z0-9_-]+(?:[./-][a-zA-Z0-9_-]+)*$/.test(ref.path) ||
          ref.path.split('/').some(s => s === '.' || s === '..'))
        fail(`${p}.path`, 'expected a safe assets/ or js/ deployment-relative path; no URLs, escapes or query strings');
      hash(ref.sha256, `${p}.sha256`);
      choice(ref.format, formats, `${p}.format`);
    }
  }
  input.routes.forEach((route, i) => {
    const p = `routes[${i}]`;
    record(route, ['eventId','kind','currentRevisionId','revisions'], ['variantId'], p);
    const event = linked('events', route.eventId, `${p}.eventId`);
    choice(route.kind, kinds, `${p}.kind`);
    if (route.kind !== event.kind) fail(`${p}.kind`, 'must match event kind; examples are not organizer routes');
    if (route.variantId !== undefined) {
      const variant = linked('variants', route.variantId, `${p}.variantId`);
      const day = linked('days', variant.dayId, `${p}.variantId`);
      if (day.eventId !== route.eventId) fail(`${p}.variantId`, 'variant belongs to another event');
      if ((day.status === 'withdrawn' || variant.status === 'withdrawn') && route.status !== 'withdrawn')
        fail(p, 'withdrawn day/variant requires a withdrawn route tombstone');
    }
    if (event.status === 'withdrawn' && route.status !== 'withdrawn')
      fail(p, 'withdrawn event requires a withdrawn route tombstone');
    if (route.kind === 'organizer' && !route.variantId) fail(`${p}.variantId`, 'organizer routes require an explicit day/variant');
    array(route.revisions, `${p}.revisions`).forEach((revision, j) => {
      const r = `${p}.revisions[${j}]`;
      object(revision, ['id','status','provenance','rights','geometrySha256','geometry','units','distanceSemantics'],
        ['profile','climbs','pois','downloads'], r);
      unique(revision.id, `${r}.id`);
      choice(revision.status, ['provisional','confirmed','superseded'], `${r}.status`);
      provenance(revision.provenance, `${r}.provenance`);
      rights(revision.rights, `${r}.rights`, audience);
      hash(revision.geometrySha256, `${r}.geometrySha256`);
      object(revision.units, ['distance','elevation','grade'], [], `${r}.units`);
      for (const [key, unit] of Object.entries({distance:'m', elevation:'m', grade:'percent'}))
        choice(revision.units[key], [unit], `${r}.units.${key}`);
      choice(revision.distanceSemantics, ['horizontal-haversine-6371000m','source-reported'], `${r}.distanceSemantics`);
      reference(revision.geometry, revision, ['gpx','geojson'], `${r}.geometry`);
      if (revision.geometry.sha256 !== revision.geometrySha256) fail(`${r}.geometry.sha256`, 'must equal geometrySha256');
      for (const field of ['profile','climbs','pois'])
        if (revision[field] !== undefined) reference(revision[field], revision, ['json'], `${r}.${field}`, field !== 'pois');
      const formats = new Set();
      if (revision.downloads !== undefined) array(revision.downloads, `${r}.downloads`).forEach((ref, k) => {
        reference(ref, revision, ['gpx','fit'], `${r}.downloads[${k}]`);
        if (formats.has(ref.format)) fail(`${r}.downloads[${k}]`, 'duplicate download format');
        formats.add(ref.format);
        if (ref.path === revision.geometry.path && ref.sha256 !== revision.geometry.sha256)
          fail(`${r}.downloads[${k}]`, 'same asset path has conflicting hash');
      });
    });
    if (route.status === 'withdrawn') {
      if (route.currentRevisionId !== null || route.revisions.length)
        fail(p, 'withdrawn routes must be tombstones: null currentRevisionId and no revisions');
    } else if (route.currentRevisionId !== null) {
      const current = route.revisions.find(r => r.id === route.currentRevisionId);
      if (!current) fail(`${p}.currentRevisionId`, 'not a revision of this route');
      if (current.status === 'superseded') fail(`${p}.currentRevisionId`, 'cannot select a superseded revision as current');
    } else if (route.revisions.length) fail(p, 'available revisions require an explicit currentRevisionId');
  });
  input.annotations.forEach((annotation, i) => {
    const p = `annotations[${i}]`;
    record(annotation, ['routeId','revisionId','text'], [], p);
    text(annotation.text, `${p}.text`);
    const route = linked('routes', annotation.routeId, `${p}.routeId`);
    if (!route.revisions.some(r => r.id === annotation.revisionId))
      fail(`${p}.revisionId`, 'annotation must target an available revision of this route');
  });
  // One physical path cannot mean different bytes anywhere in a catalog.
  const paths = new Map();
  for (const route of input.routes) for (const revision of route.revisions) {
    for (const ref of [revision.geometry, revision.profile, revision.climbs, revision.pois, ...(revision.downloads ?? [])]) {
      if (!ref?.path) continue;
      if (paths.has(ref.path) && paths.get(ref.path) !== ref.sha256)
        fail(`asset ${ref.path}`, 'conflicting SHA-256 hashes; use immutable asset paths');
      paths.set(ref.path, ref.sha256);
    }
  }
  if (previous !== undefined) {
    const old = createCatalog(previous, {audience:'internal'}).data;
    for (const [group, fields] of Object.entries({
      events:['kind'], days:['eventId'], variants:['dayId'], routes:['eventId','kind','variantId'],
    })) {
      const priorRecords = new Map(old[group].map(r => [r.id, r]));
      for (const record of input[group]) {
        const prior = priorRecords.get(record.id);
        if (prior && fields.some(field => record[field] !== prior[field]))
          fail(`${group}.${record.id}`, 'identity changed; allocate a new stable ID rather than relabel an example or association');
      }
    }
    const bundles = new Map(old.routes.flatMap(route => route.revisions.map(r => [r.id, {routeId:route.id, revision:r}])));
    const content = ({status, rights:permission, ...rest}) => rest;
    for (const route of input.routes) for (const revision of route.revisions) {
      const prior = bundles.get(revision.id);
      if (prior && (prior.routeId !== route.id || canonical(content(prior.revision)) !== canonical(content(revision))))
        fail(`revision ${revision.id}`, 'immutable bundle changed; allocate a new revision ID');
    }
    const annotations = new Map(old.annotations.map(a => [a.id, a]));
    for (const annotation of input.annotations) {
      const prior = annotations.get(annotation.id);
      if (prior && canonical(content(prior)) !== canonical(content(annotation)))
        fail(`annotation ${annotation.id}`, 'immutable annotation changed; allocate a new annotation ID');
    }
  }
  const data = freeze(structuredClone(input));
  return Object.freeze({
    data,
    /** Resolve exactly one revision, or fail. No substitute for withdrawn/missing data. */
    resolve(routeId, revisionId) {
      // Internal validation grants no permission, even for nested metadata.
      if (audience === 'internal') return createCatalog(data).resolve(routeId, revisionId);
      const route = data.routes.find(r => r.id === routeId);
      if (!route) fail('selection.routeId', `unknown route ${routeId}`);
      const event = data.events.find(e => e.id === route.eventId);
      if (route.status === 'withdrawn' || event.status === 'withdrawn') fail('selection', 'route/event withdrawn; no replacement selected');
      rights(route.rights, 'selection.route.rights', 'public');
      rights(event.rights, 'selection.event.rights', 'public');
      const revision = route.revisions.find(r => r.id === (revisionId ?? route.currentRevisionId));
      if (!revision) fail('selection.revisionId', 'revision unavailable; no geometry or substitute selected');
      rights(revision.rights, 'selection.revision.rights', 'public');
      return Object.freeze({route, revision, event});
    },
  });
}

/** Verify actual bytes, not just manifest declarations. Call before parsing/use. */
export async function verifyAsset(ref, bytes) {
  hash(ref.sha256, 'asset.sha256');
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    b => b.toString(16).padStart(2, '0')).join('');
  if (actual !== ref.sha256) fail('asset.sha256', 'bytes do not match the pinned asset; do not use this revision');
}
