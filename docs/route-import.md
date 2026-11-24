# Offline route import and replacement · kotr27-800.5

> Note that these routes will likely change slightly, so make sure that we ahve a good pipeline to ingest a changed .gpx file, that needs to be a core capability of this system

This is the production import/replacement workflow, not a one-off conversion.
It now publishes **seven available geometries and seven metadata records**,
following the user's supplemental standard/short-route FIT handoff. It does
not add the multi-route UI, offline installer, detailed climb chapters or
navigation. The Semonzo example and legacy links remain separate and unchanged.

## Run / replace / review

Requirements: Python 3.11+, Node 22+, and **fitparse 1.2.0**. The pinned
dependency is in `tools/route-import-requirements.txt`; the importer also checks
the audited parser's `base.py` SHA-256. No dependency was installed for this
change. For a new offline environment, provision that exact version from an
approved local wheel/source archive (for example
`python3 -m pip install --no-index --find-links /approved/wheels -r tools/route-import-requirements.txt`).
Do not silently substitute another FIT parser/version.

From the physical project root:

```sh
python3 tools/import-routes.py --check
python3 tools/import-routes.py
python3 tests/route_import.py
node --test tests/route-pack.mjs tests/route-catalog.mjs
node tools/build-release.mjs /absolute/path/to/NEW-public-artifact
```

Default configuration: `tools/route-import.json`. Default input directory:
`.private/route-intake/`. Original FIT bytes, full checksums and private source
provenance stay there, untouched and Git-ignored. **Do not rerun the private
intake evidence writer to update routes.** The new importer only reads inputs.
No browser, authentication, provider fetch, DEM or network is involved.

For an actual changed GPX:

1. Retain the old original. Place the new, approved export under a **new**
   filename in the approved private input directory. Do not overwrite evidence.
   Review its route identity and publication rights; access is not permission.
2. Edit the existing route's `input` in the config: `file`, `format: "gpx"`,
   `origin: "replacement-export"`, its actual input `observedOn` date, and its
   full SHA-256. Keep `id`, `day` and
   `variant` unchanged. The name may change without changing identity.
   Obtain the checksum with
   `shasum -a 256 .private/route-intake/changed-d1.gpx`.
   Check/retain `publicApproved: true` only after approval. Config display text
   is explicitly reviewed public content, never copied from file metadata.
   The top-level `observedOn` is the event inventory observation, not an import
   clock: leave it unchanged unless re-reviewing that metadata. Per-input
   observation dates keep an update from invalidating unrelated routes.
3. Run validation, inspect the printed report, then run import:

   ```sh
   python3 tools/import-routes.py --config tools/route-import.json --check
   python3 tools/import-routes.py --config tools/route-import.json
   ```

4. Review the report's old/new revisions, `pathChanged`, before/after raw
   totals, invalidated consumers and `annotationsNeedReview`. Check the
   changed geometry itself; passing numerical checks is not road-safety,
   connectivity or navigation certification. Reapprove annotations separately.
5. Run the tests/build above and independently review the artifact before the
   parent stages/commits/releases. No deployment occurs during import.

`--input-root` and `--output-root` allow isolated rehearsal roots; output must
not be inside the input directory. Use physical, non-symlink directories.
`--check` does **not** create output/locks or modify the active pointer.
Unchanged reimports are no-ops, retaining the prior report/manifest verbatim.
Reports describe a transition, not the wall-clock time of the last command.
The same input bytes, config and prior manifest produce identical output;
a fresh initial import is deterministic without a prior manifest.

To add: explicitly approve a new stable ID and its source-label associations.
To remove: remove its config record; the report records removal, with no alias.
To withdraw: retain the ID, set `status: "withdrawn"` and `input: null`.
To record a still-missing original: keep provisional status with `input: null`.
Never invent substitute geometry. Existing day/variant/event associations
cannot be changed under an existing route ID. New identities require review.

## Public contract and atomicity

`assets/route-pack.json` is the single source pointer to a full-hash immutable
`assets/route-manifest-<sha256>.json`. Its manifest contains:

- The existing closed catalog v1, validated through `createCatalog`, with
  current-only organizer bundles and honest metadata-only/tombstone records.
- `routes`: source byte hash/format/origin; separate source-listed metres and
  gain, source FIT-encoded distance, recomputed totals, point/cue counts and
  explicit unavailable-format/analysis reasons. No private filename/path is
  copied into this contract.
- `changeReport`: previous manifest hash, every current or removed route,
  before/after revision/totals, geometry-path changes, annotation IDs needing
  review and invalidation of saved plans, offline packs, profile/climbs/POIs/cues.

Geometry is canonical UTF-8 GPX 1.1 containing only a fixed creator, one
track/segment and latitude/longitude/elevation. Coordinates round to eight
decimal places and elevations to three; calculations use those **published**
points, not a different private precision. GPX and profile filenames contain
their full byte hashes. A bundle ID hashes stable route ID, geometry hash,
source byte hash/format/origin, producer/recipe version and rights/provenance.
Names and filenames are not identity. Identical geometry from a different
source export may intentionally have a new bundle identity.

Each raw profile JSON is `route-raw-profile-v1`: ordered
`[cumulativeHorizontalMetres, elevationMetres]` samples, raw totals and gap
warnings, bound to the exact revision and geometry hash. The release validator
independently recomputes all samples/totals from the pinned GPX. **No climb
chapters, smoothing, facility POIs or transferable climb recipe are invented.**
Changed geometry rebuilds the profile/download unit; previous annotations are
not automatically rebound. Unsupported/stale recipes or extra profile fields
fail publication.

Import parses and validates the entire next graph before any publication write.
It uses an exclusive writer lock, same-filesystem staging, fsynced immutable
files and **one atomic pointer replacement last**. Existing immutable bytes
cannot be overwritten. Ordinary staged/pre-pointer failures remove newly
created assets and preserve the previous pointer byte-for-byte; tests inject
both failures. Concurrent imports fail, never retry or steal a lock.

A process kill/power failure before the pointer switch can leave a stale lock,
hidden stage or unreferenced immutable assets. They are **not a committed pack**;
readers/builds follow only the validated pointer. Stop and have an operator
inspect an interrupted writer rather than automatically repairing/deleting it.
This is a local filesystem transaction, not a multi-host database or a promise
of filesystem-level power-loss durability. Old immutable files are retained as
local history; the public builder copies only the current reachable graph.
Withdrawal cannot recall previously downloaded/deployed bytes.

Consumers must read/verify the manifest hash, validate `catalog`, resolve a
specific `(routeId, revisionId)` and verify referenced asset bytes before use.
An old pinned revision absent from the new current-only catalog throws
`revision unavailable`; never catch that and silently resolve current.
The report/revision identities let later saved-plan/offline consumers recognize
staleness without implementing their UI here. Source `route-pack.json` is not
a mutable download alias for route geometry.

## Validation / unsupported states

- At most 20 MiB/file, 100,000 geometry points, 250,000 FIT messages, 2,000
  source cues/waypoints, and 100 configured routes. No silent truncation.
- No traversal, absolute input filenames, dot components or symlinks in input,
  output or asset paths. All published route paths have fixed prefixes and full
  hashes under `assets/`; no recursive source/private-folder publishing.
- GPX: UTF-8, namespace/version 1.1, exactly one track and one segment.
  Multiple tracks/segments, any `rte`/`rtept` geometry (including nested elements
  inside tracks/segments/point extensions), DTD/entities,
  foreign geometry namespaces and nested/ambiguous points are rejected.
  File names, free text, metadata, waypoints and extensions are not published.
- FIT: exact header/payload/trailer size, independent CRC-16 plus parser CRC
  checking and complete bounded iteration. Optional zero header CRC is omitted,
  not falsely verified. Require course (not activity), one file/course/lap, and
  one start/stop timer pair. Interrupted/multi-lap/unknown-message courses are
  explicitly unsupported. Require every record's position/elevation/distance;
  conflicting altitude sources, nonmonotonic distances, inconsistent lap totals,
  or invalid/out-of-order cues fail. No partial-record bridging.
- All positions/elevations finite; latitude ±90°, longitude ±180°, elevation
  −500..9,000 m. Missing elevation is rejected, never zero-filled or DEM-filled.
  Consecutive identical positions are currently unsupported.
- Preserve file order; never sort by time/distance. GPX times must be absent
  entirely or present at every point, zoned ISO8601 and strictly increasing.
  FIT record times have the same all-or-none/order rule and, when present,
  must lie within the timer interval. Timer start must strictly precede stop
  independently of whether record timestamps exist; untimed records remain
  supported when the timer pair is valid. Times are validated then discarded;
  course timestamps are not activity evidence, schedules or estimates.
- Maximum permitted adjacent horizontal separation is **500 m**, an explicit
  coarse-sampling review policy, not proof of connectivity. Steps **over 200 m**
  are counted in profile warnings. This accepts the real 207–311 m maxima
  without silently declaring them precise navigation. Larger gaps require a
  repaired/source-approved export; no interpolation or interrupted-segment
  joining. No temporal gap is converted into fabricated movement or speed.

Distance uses adjacent-point haversine, Earth radius **6,371,000 m** to match
the existing catalog semantics. Intake used 6,371,008.8 m; normalization plus
that radius difference explains the small distance differences below.
Raw gain/loss sum positive/negative adjacent elevation deltas, **no smoothing**.
The material difference from source-listed gain remains unresolved, especially
D4L; neither source figures nor raw figures silently replace one another.

## Actual current output · seven supplied FITs

All records are provisional. May 20–24, 2027 is the observed event range;
**no D1–D4 calendar dates, departure times or provider revision dates** are
inferred. Preserve Brentha spelling and intake surface/estimate caveats.

Revision prefixes below abbreviate the full IDs/hashes in the manifest.

| Stable route | Points | Revision suffix prefix | Computed horizontal m | Raw gain m | Source-listed gain m |
|---|---:|---|---:|---:|---:|
| rwgps-57874121 · D1 | 1,205 | `eaac1b60720e` | 19,679.205892 | 147.4 | 100 |
| rwgps-57873183 · D2S | 5,729 | `3361fbb7f97f` | 66,899.895314 | 1,618.0 | 1,089 |
| rwgps-57874024 · D2L | 8,365 | `b826857646e1` | 86,647.403710 | 2,731.4 | 1,929 |
| rwgps-57873112 · D3S | 5,016 | `8f41a27bfcfa` | 57,495.555887 | 1,165.2 | 837 |
| rwgps-57873019 · D3L | 6,738 | `34d3d7bbc568` | 63,157.792376 | 2,766.2 | 1,835 |
| rwgps-57874050 · D4S | 3,606 | `4d9c0ac2fe37` | 53,419.783864 | 1,261.6 | 666 |
| rwgps-57874076 · D4L | 8,107 | `35a93faf0abb` | 85,221.360973 | 3,613.2 | 1,753 |

Current manifest: `7f5e6be4133ce03c983e53194e491aa8580638c6f2c8bb5cfb36a768d2709fdc`.
The **38,766 points** are derived from seven supplied FITs, **not downloaded GPX
originals**. All seven FIT originals are now privately available and validated;
**all seven GPX originals remain unavailable**.

The earlier four-geometry manifest
`9fa47d767f0d1c6c925c135c69afcbe97697e62ef71683cd11f87b65f6af726d` remains immutable
source history, excluded from the current public build. The current report
records that actual four-to-seven transition. The three short-route stable
records already existed without geometry, so their changes have `kind:
"revised"`, `beforeRevisionId: null`, first actual `afterRevisionId`, and
`pathChanged: true`; they do not invent a superseded geometry/annotation.
The earlier four bundles, paths, source hashes and derived bytes are unchanged.
No importer algorithm or threshold change was needed to accept the new files.
The [intake availability supplement](route-intake.md#availability-supplement--2026-11-24-after-the-earlier-intake)
preserves the historical four-file report and separately records the new three.

Raw FIT metadata/timestamps/device information cannot ship. No audited sanitized
FIT writer is supplied, so **every public FIT download is explicitly
unavailable**, despite approval of appropriately sanitized downloads. GPX
derivatives deliberately omit the FITs' 43/71/103/97/48/90/77 course points
(D1, D2S, D2L, D3S, D3L, D4S, D4L respectively) and all cue
text, timing and telemetry; they are geometry tracks, not equivalent navigation
exports. Cue counts preserve the existence of source evidence, not navigation
capability. Future reviewed cue/FIT support must version the producer contract.

## Tests and release

`python3 tests/route_import.py` includes a mandatory local real-data rehearsal:
read/check all seven originals against the historical intake plus private
handoff supplement, reconstruct the earlier four-geometry manifest, then add
the three short routes through the same importer. Verify the four earlier
bundles and bytes are unchanged and that the result matches the shipped
transition. Replay that transition into a second root and compare every byte;
also compare two independent fresh seven-route imports. Then derive sanitized
D1 GPX, change one actual midpoint by
0.00002° latitude and +0.25 m, then replace **the same stable ID** in the full
seven-record/seven-geometry catalog. It checks only D1 changes, stale pinned
resolution fails, unrelated bytes stay stable, annotations need review, and
repeating the replacement is a no-op. The changed GPX is labeled
`derived-rehearsal`, exists only in temporary test directories, and does not
replace the shipped D1. Missing private test evidence is a failure, not a pass
or silent synthetic substitute. Initial `eaac1b60720e` → rehearsal `94a77cb2a85a`.

Other tests cover malformed/unsupported GPX, FIT CRC/truncation, rights,
checksums, timestamps, limits, source metadata canaries, path/symlink rejection,
atomic rollback, rename/add/remove/withdraw, and unchanged source originals.
Node tests validate closed manifest/profile payloads, private build exclusion,
transitive hashes, deterministic artifacts, tampered bytes/stale derivations,
and release entry invalidation.

The public builder requires the explicit route pointer, verifies all hashes
and geometry/profile payloads **before creating output**, copies only reachable
immutable assets, and hashes the pointer. Both HTML entries link that hashed
pointer so route updates change their release markers. No importer, dependency
manifest, private inventory/original, source-only docs/tests or recursive
checkout is included. The artifact is built in a private sibling stage and
renamed into a new destination only after completion; later module/read errors
also cannot expose a partial release. Existing output trees are refused.
This does not select organizer routes in the legacy UI.

### Earlier validation · 2026-11-24, before supplemental short-route handoff

- `python3 tests/route_import.py` — **9 passed**, including mandatory real FIT
  CRC/checksum checks and the changed-GPX rehearsal; source originals unchanged.
- `python3 tests/semonzo_chapters.py` — **3 passed**.
- `node --test --test-concurrency=1 tests/route-pack.mjs tests/route-catalog.mjs tests/ascent-estimator.mjs tests/ride-clock.mjs tests/climb-sensitivity.mjs tests/flyover.mjs tests/rider-controls.mjs tests/release.mjs`
  — **46 passed**, including packaged controls and warm-release replacement.
- After the final build CLI import guard correction,
  `node --test tests/route-pack.mjs tests/route-catalog.mjs` — **11 passed**;
  final fresh artifact **34 files / 2,554,493 bytes**, including 10 route-pack
  files and **zero raw FITs**. Temporary artifacts removed.
- Production source reimport left all **10 route-pack files byte-identical**.
  All six private intake files still pass Git exclusion; four FIT hashes match
  the private inventory. Build tests reject private canaries and unreferenced
  assets and compare complete repeat-build bytes.
- Four changed JS/MJS files pass `node --check`; both new Python files pass
  AST syntax checks; `git diff --check` passes. No configured lint runner exists.
  fitparse emits a Python 3.14 datetime deprecation warning; tests pass without
  suppressing it or changing the pinned third-party parser.

No full SDK/preload suite, Safari/cross-browser qualification or actual offline
pack behavior was tested here; none is claimed to pass. No browser/network acquisition,
dependency installation, staging, commit, bead mutation or deployment occurred.

### Seven-route validation · 2026-11-24, before first independent review

This is input completion before the first independent review, not a corrective
review pass. Only the exact three new user-provided files were read outside the
project; source files/database were not modified or enumerated. The private
supplement validates and preserves those three copies and the earlier four
checksums/inventory. All **11 private intake files** are Git-ignored.

- `python3 tools/import-routes.py --check`, then
  `python3 tools/import-routes.py` — the real four-to-seven addition passed
  through the existing pipeline without algorithm/threshold changes.
- `python3 tests/route_import.py` — **9 passed**, now including the actual
  four-to-seven addition, unchanged earlier four bundles, replayed addition
  byte equality, independent fresh seven-route determinism, actual source-path/
  record-ID exclusion, and the changed-GPX rehearsal against all seven routes.
  Only D1 changes during the rehearsal; the other six remain unchanged.
- `node --test --test-concurrency=1 tests/route-pack.mjs tests/route-catalog.mjs tests/ascent-estimator.mjs tests/ride-clock.mjs tests/climb-sensitivity.mjs tests/flyover.mjs tests/rider-controls.mjs tests/release.mjs`
  — **47 passed**, including the new real-addition report regression, build
  privacy/hash checks and legacy packaged controls/warm-release replacement.
- `python3 tests/semonzo_chapters.py` — **3 passed**; changed test syntax and
  `git diff --check` passed. No configured lint runner exists.
- Fresh release: **40 files / 3,861,624 bytes**, including **16 current
  route-pack files**, zero raw FITs, no actual private source paths or record
  IDs from either intake inventory, and no earlier four-geometry manifest.
  Temporary build output was removed.
- Production check plus no-op reimport preserved all **17 source route files**
  byte-for-byte, including the retained historical manifest. Current manifest
  remains `7f5e6be4133ce03c983e53194e491aa8580638c6f2c8bb5cfb36a768d2709fdc`.

The earlier four-file validation record above remains historical evidence.
Current availability is seven validated private FIT originals and seven
sanitized GPX derivatives, not seven GPX originals or public FIT downloads.
Calendar mapping, source revision dates, source-vs-raw gains, cue limitations,
and SDK/offline/cross-browser qualification limits remain unchanged.
No staging, commit, closure, Beads write or deployment was performed.

### Corrective pass 1 · 2026-11-24

The first independent review found two publication-validation gaps. Both were
reproduced with new full-import regressions before changing the implementation:

- CRC-valid FIT courses with untimed records bypassed timer chronology checks.
  Start must now strictly precede stop regardless of record timestamps. Tests
  retain successful publication of a three-point untimed course with start 100 /
  stop 200, reject reversed and equal timer bounds, and verify rejection leaves
  both existing public graphs unchanged and fresh output roots absent.
  The minimal CRC-valid FIT construction is a test-only input fixture, not a
  public sanitized-FIT writer.
- Nested GPX `rte`/`rtept` geometry could be silently discarded. These elements
  are now rejected anywhere in the XML tree, including track/segment/point
  extensions and foreign namespaces. Publication tests cover nested and root
  placements, preserved existing output, absent fresh output and unchanged
  source fixtures. Ordinary non-geometry extensions still import successfully
  and are excluded from public derivatives.

Changed only `tools/import-routes.py`, `tests/route_import.py` and this document
in the corrective pass. Validation:

- `python3 tests/route_import.py` — **11 passed**, including both new full-run
  regressions and the real seven-route addition/replacement/determinism checks.
- `python3 tests/semonzo_chapters.py` — **3 passed**.
- `node --test tests/route-pack.mjs tests/route-catalog.mjs` — **12 passed**,
  including deterministic builds, privacy, transitive hashes and seven-route
  consistency. Browser/SDK suites were not rerun for these parser-only changes.
- `python3 tools/import-routes.py --check` and a production no-op reimport
  passed. All **17 route files**, all **seven current revisions / 38,766 points**
  and all **11 private files** match their pre-correction fingerprints exactly.
  Manifest remains
  `7f5e6be4133ce03c983e53194e491aa8580638c6f2c8bb5cfb36a768d2709fdc`.
- Both changed Python files pass AST syntax checks; `git diff --check` passes.
  The existing fitparse datetime deprecation warning remains unsuppressed.

No schema/derivation change, new dependency, FIT-download writer, UI, staging,
commit, Beads mutation or source-original change. Existing format, calendar,
raw-gain and qualification limitations remain unchanged. Fresh independent
review is still required.
