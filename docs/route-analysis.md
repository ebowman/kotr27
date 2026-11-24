# Shared revisioned route analysis · kotr27-800.6

`js/route-analysis.mjs` is the pure analysis/query contract.
`js/route-analysis-loader.mjs` binds the existing approved import pack to it.
`js/route-pack-contract.mjs` is the browser-safe producer validator shared
with the Node import/release boundary (`tools/route-pack.mjs`).
This adds **runtime derivation**, not new geometry, provider statistics,
organizer facts, rider physics, comparison UI or playback. All seven imported
bundles, raw profiles, GPX downloads and their revisions remain unchanged.

## Load once, share the result

```js
import { loadRouteAnalysis } from './js/route-analysis-loader.mjs';
import { positionAt, profileWindow, chapterAt, nextFeatures } from './js/route-analysis.mjs';

const analysis = await loadRouteAnalysis({
  pack, routeId, revisionId,
  readAsset: async path => /* return pinned asset bytes, not text */ readBytes(path),
});
const position = positionAt(analysis, 1000);
const section = profileWindow(analysis, 1000, 2000);
const chapter = chapterAt(analysis, 1000);
const nextClimb = nextFeatures(analysis, 1000, {kinds:['climb']});
```

The caller first verifies the public manifest against its pointer SHA-256
([import contract](route-import.md)). Node tooling already has
`readRoutePack(root)` for this. A browser caller must likewise verify the
manifest bytes before passing the parsed pack. The loader validates the public
catalog/rights, requires an **explicit revision**, and applies the same closed
producer/summary/profile contract as release validation. Both revision and
profile must independently declare `horizontal-haversine-6371000m`; merely
agreeing on another catalog-supported semantic is insufficient. Duplicate
summaries, negative listed totals, unknown fields, conflicting availability,
source/revision identities or profile samples/totals/gaps are rejected even
when every byte hash was recomputed. It verifies both selected asset hashes,
accepts only the sanitized `route-import-v1` GPX grammar and
`route-raw-profile-v1`, and cross-checks samples/totals against geometry.
All manifest metadata/references are checked; only the selected route's two
asset payloads are read at runtime. Publication uses the same validator with
no selection, checking every asset. Hashes prove byte consistency, not a valid
producer contract. No separate partial loader schema remains.
It does not fetch, discover private inputs, scrape providers or fall back to
the current revision. Hash/producer-contract errors throw, including geometry
unsupported by the importer. The low-level pure analysis entry below returns
explicit unsupported states for its geometry inputs. No module makes a
third-party network request.

For already validated ordered geometry, `analyzeRoute({routeId, revisionId,
geometrySha256, points, sourceTotals?, annotationSet?})` is the pure entry.
Points are `{lat, lon, elevationM, breakBefore?}` in **riding order**.
The low-level entry trusts the caller's geometry hash/rights; it is not an
import/publication gate. Never derive identity from a route name.

The deeply frozen result has:

- `schemaVersion: 1`, `recipe: route-distance-windows-250m-v1`, identity
  `{routeId, revisionId, geometrySha256, recipe, annotationRevisionId}`;
- `status: supported | unsupported`, indexed `issues`, sparse `warnings`;
- ordered `points` with `pointIndex` and `distanceM`; `distanceM` at route end;
- **separate** `sourceTotals`, `rawTotals` and `processedTotals`, with bases;
- `windows`, ordered `chapters`, qualifying `climbs`, and `annotations`
  containing every binding outcome plus only accepted `pois`/`annotations`.

Map/profile/briefing/download/time consumers should retain this one snapshot
and its identity, not derive a separate axis or sum chart display samples.
There is deliberately no general physics adapter in this task. The unchanged
ascent estimator still accepts its existing Semonzo v1 profile, not arbitrary
route-analysis objects. Unsupported results must not become flat estimates.

Queries return the same `identity`. `positionAt` interpolates by ordered
distance, exposes **raw and processed elevation separately**, and reports
bracketing point indexes. Coordinate interpolation follows the short longitude
arc at the antimeridian; it is presentation, not a navigation position fix.
`profileWindow` clips the original processed windows, never resmooths a selected
range. `chapterAt` uses half-open intervals; the final chapter owns the finish.
`nextFeatures` returns starts **at or after** the requested distance, sorted by
distance, kind, ID; filter `kinds` and set `limit` (1–2,000, default 1).
It does not call an ongoing climb the *next* climb; use `chapterAt` for current
context. No feature is `[]`-silently substituted for an unsupported route:
queries return `status: unsupported` with issues. Out-of-range positions on a
supported route throw, rather than silently clamping.

## Units, recipe, thresholds and tolerance

- Degrees WGS84 for coordinates; all `M` values are metres, grades percent.
  Horizontal distance is adjacent haversine, radius **6,371,000 m**.
  Do not sort points, collapse loops, use straight start-to-finish distance or
  substitute FIT-encoded/source-listed distance.
- Raw gain/loss sum positive/negative deltas of the published elevations.
  Both are positive magnitudes; net rise retains sign. The separate source
  facts include RWGPS-listed metres/gain, FIT-encoded metres and provenance.
  Observation/handoff timestamps are **not provider revision dates**.
- Processed elevations are linearly sampled at **250 m boundaries anchored at
  the route start**. Keep the original endpoints; merge a final partial window
  with its predecessor. A route shorter than 250 m has one window.
  Floating-point residuals within `1e-8 m` of the 500 m tail decision do not
  merge an otherwise full final window. Represent each window by its signed
  endpoint line. No moving average, statistical outlier deletion, DEM,
  inferred elevation provider or tuning to RWGPS gains occurs.
- This distance-window interpretation can omit short hills/dips within a
  window. **Raw points and raw gain/loss remain available**; processed metrics
  must be labeled “derived, 250 m windows,” never “corrected” or “source gain.”
  Descents are signed, not clipped to ascent-only. Flat classification never
  zeroes a window's small signed rise.
- Chapters are maximal adjacent runs of window class: `ascent` above **+0.5%**,
  `descent` below **−0.5%**, otherwise `flat`. They cover the complete supported
  distance in order; IDs are ordinal and **valid only inside this identity**.
  A chapter's aggregate grade is net rise / horizontal run × 100, never a
  mean of window grades.
- A climb is an ascent chapter with length **≥500 m**, processed positive gain
  **≥30 m**, and aggregate grade **≥3%**. Descents and flat-class windows split
  climbs; no valley bridging or “same named mountain” aggregation. These are
  conservative descriptive thresholds, not organizer segment definitions,
  climb categories, safety claims or physiological difficulty.
- Compute before rounding. Shared analysis retains IEEE-754 precision.
  Imported samples match within **0.00001 m**, raw totals within **0.001 m**,
  accommodating the importer's decimal serialization. These are numerical
  tolerances, not GPS/elevation accuracy. Display rounding must not feed back
  into calculation or itinerary totals.

## Unsupported rather than fabricated

At most 100,000 points. Fewer than two, invalid coordinates, consecutive
duplicate positions (even with equal elevation), a `breakBefore` discontinuity,
or adjacent separation **>500 m** make the complete profile/chapter/climb
analysis unsupported. Sparse intervals **>200 m and ≤500 m** remain supported
with indexed warnings, matching the importer. This policy does not prove that
the road connects. Do not repair by joining track segments or dropping points.

Missing/nonfinite/out-of-bounds elevation (allowed −500..9,000 m) also makes
analysis unsupported. Geometry-only cumulative distance can still be known,
but gain/loss/processed totals are null and no estimate is supplied.
After a geometry discontinuity, point distances are null: later portions are
not relocated onto an invented continuous axis. Input order and explicit
breaks remain in the point records; there are no interpolated windows across
the interruption. The current importer rejects such inputs even earlier;
the pure API additionally protects future validated/local callers.

Repeated **nonconsecutive** coordinates are normal loops/out-and-backs, not
duplicate errors. Different visits retain different indexes/distances.

## Reviewed annotations and POIs

There are **no verified organizer facility POIs** in the approved pack.
Default state has empty bindings/POIs, `poiStatus: none-verified` and an
explicit source explanation. This means *unknown*, not “no water needed” or
“no facilities exist.” FIT navigation cue counts/text are never promoted to
facilities, safe descents or emergency exits. Calendar/departures remain
unverified; this module infers neither.

A separately reviewed sidecar can be passed as `annotationSet`:

```js
{
  revisionId: 'reviewed-annotations-v1', // immutable sidecar revision
  source: 'Reviewed organizer evidence reference',
  records: [{
    id: 'reviewed-feature-id',
    routeId, revisionId, geometrySha256, // exact geometry bundle binding
    kind: 'annotation', // or feed, water, toilet, caution, viewpoint
    text: 'Approved text only',
    source: {name: 'Evidence reference', observedOn: '2026-11-24'},
    confidence: 'verified', // unverified is retained but never queried as a POI
    approval: 'approved',   // pending/missing is not publishable evidence
    anchor: {pointIndex: 100},
  }],
}
```

This is a binding input, not an extension of the closed catalog/importer
schemas or an authorization to publish new organizer records. The publisher
must review source, rights and text, pin the sidecar content, and allocate a
**new immutable annotation-set revision for any change**, including observation
or approval changes. Cache/query identity includes that revision. `verified`
describes the evidence at its observation date, not guaranteed live facility
availability. No current sidecar is published.

Allowed anchors: exact `pointIndex`; explicit route `distanceM`; a vertex
`{lat,lon}`; or `{lat,lon,pointIndex}` to disambiguate a visit. Coordinates
match vertices within **1 m**, never the closest vertex/line by guess.
Zero matches is unsupported; multiple matches is `ambiguous-coordinate` with
candidate indexes. Even nearby adjacent vertices are ambiguous until an
explicit index/distance is reviewed. Mid-edge coordinate-only snapping is
unsupported: provide a reviewed route distance instead.

Any route/revision/hash mismatch is **needs-review**, with no bound distance,
even if coordinates are unchanged. Changed geometry cannot carry old stops
forward by closest point, name, fractional progress or matching coordinates.
Reviewers must supply new exact revision bindings/anchors. Invalid source,
unknown feature kinds or contradictory anchors are unsupported; missing
approval/unverified confidence stays unverified. Only bound, approved,
source-qualified records enter the ordered queries. Rejected bindings remain
visible for review, not silently discarded.

## Legacy and publication compatibility

`js/semonzo-profile.mjs` is now the adapter using the shared haversine/window
engine, retaining its four authored names, notices, breaks, rounded v1 fields,
GPX reader and loader. The 75 source windows and all estimator results compare
exactly to `assets/semonzo-chapters.v1.json`. The adapter still rounds to
0.001 m as documented in [the legacy contract](semonzo-chapters.md).
Those authored chapters are not applied to official D3L or other routes.

The importer/raw manifest recipes remain unchanged. Their
`climbs: unavailable-analysis-not-produced` means *no persisted importer climb
asset*; the new runtime recipe is independently labeled and is not written
into an immutable v1 bundle. A future persisted analysis producer needs an
explicit new producer contract. Replacements invalidate analysis by revision;
the existing changed-GPX import rehearsal remains the publication gate.
The independent Python importer/Node release verifier retain their existing
raw integrity calculations; they are validation oracles, not alternate
consumer profile/chapter engines.

The public builder allowlists just the three new browser modules, rewriting
their transitive hashed imports and the Semonzo dependency. No private data,
docs, tests, original FIT, extra GPX, or source regression JSON ships.

## Validation

Focused suite: `node --test tests/route-analysis.mjs`. It covers ascent,
full-loop, out-and-back, flat/shallow signed terrain, raw-vs-window gain,
missing elevation, sparse/gapped/duplicate/interrupted data, tail windows,
clipped queries, boundary ownership, coordinate ambiguity, source/confidence,
revision invalidation, antimeridian interpolation, all **38,766 approved
points**, asset/raw-profile tampering and exact Semonzo/model regression.

Existing import and release tests exercise deterministic builds, allowlist
exclusion, atomic replacement and changed-GPX rehearsal. Release tests now
also require analysis-only changes to invalidate both legacy entry dependency
trees. The flyover and optional terrain fixture allowlists include the new
transitive module; no assertions or readiness gates are removed.

Initial implementation validation on 2026-11-24, before the corrective pass,
Node 26.10.0 / Python 3.14.7:

```sh
node --test tests/route-analysis.mjs
# 15 passed
python3 tests/semonzo_chapters.py
# 3 passed
python3 tools/import-routes.py --check
# Seven unchanged revisions; manifest 7f5e6be4133ce03c983e53194e491aa8580638c6f2c8bb5cfb36a768d2709fdc
python3 tests/route_import.py
# 11 passed, including four-to-seven addition and same-ID D1 changed-GPX rehearsal
node --test --test-concurrency=1 tests/route-analysis.mjs tests/route-pack.mjs tests/route-catalog.mjs tests/ascent-estimator.mjs tests/ride-clock.mjs tests/climb-sensitivity.mjs tests/flyover.mjs tests/rider-controls.mjs tests/release.mjs tests/site-shell.mjs tests/climb-sensitivity-browser.mjs
# 67 passed, including deterministic allowlisted builds and packaged browser checks
node --test tests/preload.mjs
# 42 skipped: optional local SDK/terrain inputs not provisioned, NOT passes
```

`node --check` passes for both new modules, the Semonzo adapter, builder and
all changed JS tests; `git diff --check` passes. No separate configured
TypeScript/lint pipeline or new dependency is introduced. Python's existing
fitparse emits a `utcfromtimestamp` deprecation warning; tests still pass.
The first broad run caught a missing analysis-module entry in the source
flyover test server's explicit allowlist; adding that transitive dependency
resolved it (final rerun above), without changing the app readiness behavior.
No live provider, Safari/device, real-engine terrain or facility-availability
validation is claimed.

### Bounded producer-contract correction

Independent review found that the first loader treated matching but unsupported
distance semantics as acceptable, and did not close the summary schema.
The existing release validator's pure contract was extracted into
`js/route-pack-contract.mjs`, rather than maintaining another validator.
`tools/route-pack.mjs` retains its Node filesystem/CLI and Buffer-returning API;
the shared module uses only standard typed bytes, TextDecoder/Encoder and
Web Crypto. The imported asset bytes, recipe versions, revision identities
and geometry remain unchanged.

Thirteen rehashed-invalid-graph regressions verify **the same rejection
message** from release and runtime validation, including both unsupported
semantics together, negative listed values, duplicate contradictory summaries
with changed/unchanged inventory size, and profile/summary shape conflicts.
Additional checks load the seven real routes through ArrayBuffer/Uint8Array
readers while reading only the selected pair of assets. The release browser
test also loads all seven routes through the packaged hashed modules, after
the unchanged Semonzo no-JSON assertions have completed.

Corrective-pass commands/results (same runtimes, 2026-11-24):

```sh
node --test tests/route-analysis.mjs tests/route-pack.mjs tests/route-catalog.mjs
# 41 passed
node --test --test-concurrency=1 tests/route-analysis.mjs tests/route-pack.mjs tests/route-catalog.mjs tests/ascent-estimator.mjs tests/ride-clock.mjs tests/climb-sensitivity.mjs tests/flyover.mjs tests/rider-controls.mjs tests/release.mjs tests/site-shell.mjs tests/climb-sensitivity-browser.mjs
# 81 passed, including packaged-browser loading of all seven approved routes
python3 tests/semonzo_chapters.py
# 3 passed
python3 tools/import-routes.py --check
# Same seven revisions and manifest hash as above
python3 tests/route_import.py
# 11 passed; original-source, addition/replacement and atomic-build contracts retained
```

Syntax checks cover the shared contract, loader, Node wrapper, builder and
changed tests; diff whitespace checks pass. The initial corrected browser
probe ran before the legacy no-JSON check and therefore failed that assertion;
the explicit organizer-loading phase now follows it, leaving the assertion
unchanged. Optional terrain tests remain the earlier **42 skips**, not new
passes. No private input, geometry, download or revision asset was changed.

### Gap numeric-shape correction · 2026-11-24

The resumed correction rejects coercible `gaps.maxM` before subtraction:
it must be a finite number in 0..500 m. `over200m` must be a numeric integer
in 0..(point count − 1). Both still must match recomputed geometry. Adjacent
sample and total checks already require finite numeric types; regressions
now cover numeric strings and single-element arrays for those fields too.
Twenty-two additional rehashed graph cases exercise both Node publication
and runtime rejection; four gap-type cases also run in the packaged browser.

Commands/results (Node 26.10.0 / Python 3.14.7):

```sh
node --test --test-name-pattern='gap maximum as' tests/route-analysis.mjs
# Before fix: both new cases failed with Missing expected rejection
node --test tests/route-analysis.mjs tests/route-pack.mjs tests/route-catalog.mjs
# After fix: 63 passed
node --test tests/release.mjs
# 3 passed, including rehashed browser rejection and seven valid route loads
python3 tests/route_import.py
# 11 passed; existing dependency deprecation warning remains
python3 tests/semonzo_chapters.py
# 3 passed
python3 tools/import-routes.py --check
# Seven unchanged revisions; same manifest hash recorded above
node --check js/route-pack-contract.mjs
node --check tests/route-analysis.mjs
node --check tests/release.mjs
git diff --check
# All four checks passed
```

The broader 81-test run and 42 optional preload skips above are prior evidence,
not rerun results. Fresh independent review remains required; no nonprogress
recovery attempts consumed (0 of 2). No commit, staging or Beads write.
