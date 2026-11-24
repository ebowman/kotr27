# Versioned route catalog · schema 1

`kotr27-800.4` — static data contract, not route intake or a new site shell.
Runtime implementation and JSDoc types: [route-catalog.mjs](../js/route-catalog.mjs).
The example catalog is [example-catalog.mjs](../js/example-catalog.mjs).
The multi-variant organizer fixture in [tests](../tests/route-catalog.mjs) is
synthetic and is **not packaged**. The subsequent
[offline import contract](route-import.md) adds an explicitly allowlisted
organizer pack via `assets/route-pack.json`: seven provisional records and seven
sanitized geometries after the supplemental short-route FIT handoff. GPX
originals remain unavailable. It uses this same schema
without changing legacy example selection.

## Consumer contract

`createCatalog(data, {audience: 'public', previous})` validates the complete
catalog and returns an immutable snapshot with `data` and
`resolve(routeId, revisionId?)`. Public is the default. Errors identify the
record/field and required correction; records are never silently dropped.
Unknown fields are rejected, including unreviewed extra metadata.

Resolve returns `{event, route, revision}`, never a fallback route. Omitting
revision explicitly resolves `currentRevisionId`; consumers must display that
resolved revision, not claim a pinned link. Supplying an unavailable revision,
unknown ID, withdrawn route/event, or metadata-only route fails. A permitted
superseded revision may be explicitly resolved; callers must label it old.
This module does not implement routing, itinerary selection or update prompts.

`audience: 'internal'` allows local validation of restricted drafts, **not**
public rendering, authentication or permission escalation. Calling `resolve`
still requires the entire catalog to pass public validation. Do not bundle
internal drafts, even if no UI links to them.

Every reference must be byte-checked with `await verifyAsset(ref, bytes)` before
parsing/use. This dependency-free function uses SHA-256 Web Crypto (HTTPS or
localhost in browsers). It throws on mismatch. The current example loader
does this before either legacy consumer sees XML. Schema validity alone does
not verify file contents, the source's honesty, or rights ownership.

## Closed record schema

All arrays below are required, including empty arrays. IDs are nonempty
lowercase letters/digits/hyphens, beginning with a letter, **globally unique**
across entity records, revision bundles and annotations. Names are mutable
display text, not keys. No IDs are derived from route names or geometry hashes.

| Record | Fields beyond common fields |
|---|---|
| Catalog | `schemaVersion: 1`, `events`, `days`, `variants`, `routes`, `annotations` |
| Common entity | `id`, `name`, `status`, `provenance`, `rights` |
| Event | `kind: example / organizer / local`; optional `metadata` |
| Day | `eventId`; optional verified `date` (a source “Day 2” name is **not** a date) |
| Variant | `dayId`; multiple variants per day allowed; no default variant |
| Route | `eventId`, matching event `kind`, optional `variantId`, `currentRevisionId` (ID or `null`), `revisions` |
| Organizer annotation | Common fields plus `routeId`, `revisionId`, `text`; separate from geometry/derived climb/POI measurements |

Organizer routes require a variant linked through a day to their event.
Examples/local routes may have no day/variant. Cross-event associations fail.
Local records never enter a public catalog, even with an “approved” label.
This is not the local file-storage schema.

Statuses are `provisional`, `confirmed`, `superseded`, `withdrawn`. A withdrawn
route is a tombstone with `currentRevisionId: null`, `revisions: []`; it contains
no exports or geometry. Withdrawn events/days/variants require descendant route
tombstones. Remove annotations targeting removed revisions too. No replacement
is inferred. A route with no acquired geometry can remain provisional with
the same null/empty fields, without being withdrawn.

**Provenance:** `{source, observedOn, publishedOn?}`. `source` is a human-readable,
non-secret attribution/reference, not a fetch URL. Dates are real `YYYY-MM-DD`
calendar dates; observation and publication are distinct. Omit an unknown
publication date rather than inventing one.

**Rights:** `{access, redistribution, approval?}`. Access is `public`,
`participant` or `private`; redistribution is `approved`, `unknown` or `denied`.
Approval requires a nonempty approval reference. Public validation requires
**public AND approved** at every entity, revision, verified metadata value and
annotation. Approval is an audited owner assertion, not inferred from download
access. It covers the whole revision unit and its derivatives/downloads; assets
with different restrictions cannot be slipped into that unit. Use a restricted
draft instead. Permission restrictions can change without rewriting geometry.

Optional event metadata keys are `startDate`, `endDate`, `timezone`, `location`.
Each value is `{value, provenance, rights}`; dates/timezone are validated. Day
`date` uses the same verified-value shape. Absent fields mean unknown; no
fabricated dates, stops, elevation zeroes or unsupported estimates. Other
verified metadata categories need a reviewed schema extension, not an arbitrary
bag of publishable fields.

## Immutable revision unit

A revision has `id`, `status`, `provenance`, `rights`, `geometrySha256`,
`geometry`, `units`, `distanceSemantics`, plus optional `profile`, `climbs`,
`pois`, `downloads`. It is one unit, never independently selected assets.

- `id` is a bundle identity, separate from the full lowercase 64-hex SHA-256 of
  raw geometry bytes. Two bundle IDs can share geometry when derivations change.
- Geometry is a required asset reference with format `gpx` or `geojson`.
- Profile/climbs are JSON asset references **or** versioned runtime recipes.
  POIs are optional JSON assets, not organizer assertions. Downloads are an
  optional array of actual GPX/FIT references, at most one per format. Absence
  means unavailable, not an empty cuesheet or permission to synthesize a file.
- Each asset is `{path, sha256, format, revisionId, geometrySha256}`. Both
  binding fields must match the owning bundle; geometry `sha256` must also
  equal the bundle geometry hash. No two references to one path may disagree
  on its hash. Paths are safe `assets/…` or `js/…` deployment-relative paths:
  no leading slash, dot segments, escaping, URL schemes, query or fragment.
- A runtime derivation is `{recipe, revisionId, geometrySha256}`. Recipe IDs
  must be versioned by their producer when behavior changes; the schema checks
  identity/binding, not algorithm correctness. Consumers must reject unsupported
  recipes. The Semonzo loader implements only `semonzo-250m-v1` and
  `semonzo-chapters-v1`, with the existing regression reference. Packaged module
  bytes are transitively content-hashed by the release builder.
- `units` is exactly `{distance: 'm', elevation: 'm', grade: 'percent'}`.
  `distanceSemantics` is `horizontal-haversine-6371000m` (track-order horizontal
  great-circle cumulative distance, radius 6,371,000 m, not 3-D road length) or
  `source-reported` (do not assume interchangeable with a derived axis).
  Recipe/data payload validators remain responsible for actual samples,
  intervals and measurements; this schema validates the manifest references.
- Bundle status is provisional/confirmed/superseded. The current revision
  cannot be superseded. Withdraw by removing the bundle, retaining a route
  tombstone when withdrawing the route; do not retain accessible old geometry
  as a “withdrawn revision.”

No aggregate distances/gains/times live on route cards or in this manifest.
Measured totals come from the selected, validated profile/geometry derivation,
not independent display constants or GPX header summaries. Source-reported
statistics are not silently merged into derived facts. The existing smoothed
ascent/net rise/raw ascent distinction remains in the
[Semonzo chapter contract](semonzo-chapters.md). There is no new trip-total
aggregator, generalized geometry parser, or multi-route renderer here.

## Add / replace / withdraw

Always provide the last approved catalog as `previous` during an update review.
This detects reuse of an existing bundle ID with changed bytes, references,
recipes, units, provenance or route ownership. Rights/status may change; all
other bundle fields are immutable. Existing event kinds and day/variant/route
associations also cannot change under the same entity ID. Names may change.
Without `previous`, a standalone manifest can only be checked for its internal
consistency; this module is not a historical registry.

Add a route with its explicit variant and a new bundle ID. To replace it, add
the new complete bundle and point `currentRevisionId` to it; mark the old
retained, still permitted bundle superseded. Changed bytes need new asset
paths. To withdraw, remove bundles and their annotations and keep the route
tombstone. No auto-claim, fetch, server write or local persistence occurs.

Annotations have their own immutable IDs and target a bundle. Editing their
text/binding requires a new annotation ID (checked against `previous`); it
does not mutate the geometry bundle or redefine derived POIs. Status/rights
can change independently. Render all names/notices as text, never trusted HTML.

## Example compatibility and release boundary

Bare `explore.html` and `index.html#seek-N` still refer only to
`semonzo-example`, bundle `semonzo-example-v1`. Both loaders now obtain verified
bytes from the catalog and share the horizontal-haversine axis; the old flyover
planar distance approximation is no longer an independent total. Chapter
boundaries and legacy metre seeks retain their meanings. No official routes
are inferred from Semonzo names, event dates or old group rules.

The public builder still uses its explicit dependency-first allowlist. It
validates the source catalog/public permissions and GPX hash before creating
output, rewrites the catalog asset path and every transitive module import to
hashed filenames, and hashes final bytes. It refuses newly referenced assets
outside the existing example GPX allowlist. The bounded `.5` importer adds a
separate closed, hash-verified organizer-pack allowlist; see
[route-import.md](route-import.md). This schema alone is **not** permission to
expand either allowlist. Documentation, tests, private intake/originals and
the legacy private JSON reference remain outside the artifact.

The schema cannot detect secrets hidden in otherwise valid prose or grant
legal rights; independent content/approval review and the release allowlist
remain mandatory. It does not revoke already downloaded artifacts. Official
route redistribution, networking/provider terms, full shell routing and
cross-browser qualification remain separate gates.

## Validation recorded for this change

Executed locally on 2026-11-24, without acquiring provider/official route data:

- `node --test --test-concurrency=1 tests/route-catalog.mjs tests/ascent-estimator.mjs tests/ride-clock.mjs tests/climb-sensitivity.mjs tests/flyover.mjs tests/rider-controls.mjs tests/release.mjs`
  — **41 passed**. Includes source flyover, packaged 320/1200px explorer,
  packaged 375/1200px sensitivity, deterministic builds, allowlist/privacy
  gates, transitive content hashes, missing elevation and warm release changes.
- `node --test tests/climb-sensitivity-browser.mjs` — **2 passed**, source
  explorer at 375/1200px.
- `python3 tests/semonzo_chapters.py` — **3 passed**, unchanged source geometry
  and independently reconciled chapter reference.
- `node --check` on each changed JS/MJS file and `git diff --check` — passed.
  No package manifest or configured lint runner exists in this repository.
- `node --test tests/preload.mjs` — **42 skipped**, not passes: optional local
  Mapbox SDK fixture was not configured. Its serving allowlist/hash adaptation
  was updated for the new dependency chain; real-engine camera behavior is
  unverified here. No SDK was downloaded or provider accessed.

This is bounded Chrome/local validation, not `.21` cross-browser qualification.

### Corrective pass 1 · 2026-11-24

Removed the remaining “Long groups only” label from the legacy example entry;
added a focused source-markup regression. The independent review reported
`Invalid InterceptionId.` at the warm-release test's strict protocol-error
assertion (42 passed, 1 failed). Bounded diagnosis retained that assertion and
added a bounded, failure-only trace of request IDs, URLs and network cancellation
events; it does not retry, suppress errors or modify the shared browser harness.

- `node --test --test-name-pattern='ordinary warm Pages URL' tests/release.mjs`
  — **1 passed**, with diagnostic instrumentation.
- `node --test --test-concurrency=1 tests/route-catalog.mjs tests/ascent-estimator.mjs tests/ride-clock.mjs tests/climb-sensitivity.mjs tests/flyover.mjs tests/rider-controls.mjs tests/release.mjs tests/climb-sensitivity-browser.mjs`
  — **44 passed**, the reviewer's exact suite plus the new markup regression.

**Unresolved qualification risk:** the reported interception failure did not
reproduce in either isolated or reviewer-suite context. The fixture pauses
all HTTP requests and navigates during freshness/release replacement; a
canceled paused request is a plausible lifecycle explanation, not an observed
root cause. No evidence yet establishes causality with the catalog loader,
and no infrastructure fix or deterministic-pass claim is made. Stop here
rather than retry until green or change unrelated interception infrastructure.
