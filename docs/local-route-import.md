# Private local GPX/FIT · kotr27-800.16

Explore → **Private local routes & recordings** accepts one native file input
at a time. The default is document memory, not localStorage/sessionStorage.
There is no upload, analytics, remote decoding, DEM lookup or local-route map
provider. First-party SVG and the existing shared briefing/pace/playback
controller are used. A recording's animation remains **distance animation**;
recorded replay belongs to `.17`.

## Decoder audit and supported subset

No dependency or copied third-party parser was added. Existing local prior art
was inspected read-only at `/Users/eric.bowman/Projects/src/kotr26`, origin
`git@github.com:ebowman/kotr26.git`, HEAD
`9b2e9e095561ee86e79d0ee24bd85f47f6e21ff5` (the three inspected `js/` files were
unmodified). This is a different revision from the experience document's
historical `98cd86d` baseline. No private activity originals were fetched or
used as fixtures. The existing offline organizer `--check` command below
revalidates already-approved organizer originals read-only; none were copied,
modified or added to the release.

The prior GPX parser uses DOMParser on the main thread, flattens trackpoints,
substitutes zero for missing elevation, and offers remote DEM-sidecar loading.
The prior FIT parser skips CRCs, permits trailing/chained blocks, and reads
compressed timestamp messages without reconstructing the timestamp offset.
The prior store saves without explicit consent or deletion generations.
These behaviors are unsuitable unchanged. The new small decoder is original
code, informed by the existing offline `tools/import-routes.py` length/CRC/
coordinate/gap contract and synthetic binary fixture method, not a bulk copy.
It intentionally rejects formats it cannot interpret faithfully.

- **GPX:** UTF-8 GPX 1.1 track(s)/segments **or** routepoints, not mixed track/
  route geometry. Namespace-aware strict XML subset; malformed nesting,
  duplicate attributes/scalars, unbound/reserved namespaces, DTD/entities,
  external resources and nonfinite/invalid numbers fail. Predefined and numeric
  XML character references are decoded, never executed. XML 1.0 declaration
  (optional UTF-8 encoding) and comments are supported; CDATA, other processing
  instructions, alternate encodings and nested scalar content are explicitly
  unsupported. GPX point times require ISO UTC `Z`, at most three fractional
  digits, valid dates and strictly increasing known sample times.
  XML comments may contain neither `--` nor a trailing `-` before `-->`;
  valid empty comments and isolated hyphens remain supported.
  Outside-root text must be **raw** XML whitespace (space, tab, CR or LF),
  never a character reference, NBSP or other JavaScript whitespace. XML lexical
  separators and padding of GPX numeric/time scalars use that same narrow set;
  ordinary name/metadata character data may still contain non-XML whitespace.
- Recognized Garmin TrackPointExtension/v1 fields: `hr`, `cad`, `power`/`watts`,
  `speed`, `atemp`; data uses explicit units. Unknown metadata/extensions and
  waypoints remain in original bytes, not inferred facilities. A nonstandard
  telemetry namespace with one of those field names is explicitly unsupported.
  Point timestamps or recognized telemetry classify GPX as a recording.
- **FIT:** actual `.FIT` signature, protocol major 1/2, 12/14-byte header,
  exact payload size and trailing file CRC16; validate a nonzero header CRC too.
  Both endian architectures supported. One file_id, type course (6) or
  activity (4), classifies route versus recording independently of timestamps.
  Course timestamps are not proof of an actual ride.
- Decode standard scalar record coordinates (semicircles), base/enhanced
  altitude, time, heart rate, cadence, power, temperature, base/enhanced speed
  and device distance. Invalid sentinels remain null; enhanced altitude/speed
  takes precedence where available. Device distance is **not** the geometric
  distance axis. Other fields/messages stay in original bytes with a notice.
  Compressed timestamp records, developer fields, arrays for recognized
  scalars, chained files, invalid definitions, CRC/truncation errors and
  nonincreasing record timestamps fail explicitly. Re-export uncompressed FIT
  or supported GPX; do not rename an extension to bypass validation.
  Every field definition, including uninterpreted fields and unknown messages,
  must have a standard FIT base-type byte (including its endian flag) and a
  positive size divisible by that type's width before its bytes can be skipped.

`decoded.points` holds only ordered geometry and `breakBefore`.
`decoded.samples` independently holds `pointIndex` (nullable), `timeMs`
(nullable), and available sensor fields. FIT coordinate-less samples retain
their signals/time and break the next geometry run. Timer interruptions and
GPX segments also break runs. Partial times remain null with an alignment
warning; no record-index clock or interpolation is invented. Raw originals
retain metadata not decoded here for future explicit interpretation.

Missing elevation, duplicate positions, source segments and >500 m spatial
gaps suppress continuous analysis/estimates under the existing shared recipe.
Disconnected SVG runs never bridge gaps. No profile repair, terrain fetch,
flat substitution or grade clamping occurs. Supported local analyses use the
same estimate domain as official routes; existing D4S unsupported grades stay
unsupported.

## Conservative resource envelope

This first browser implementation narrows, not expands, the architecture's
proposed maximum envelope:

- 4 MiB/file; 20,000 geometry points; 50,000 FIT messages; 1,000 explicit
  segments; 2,000 source waypoints; 400,000 XML tokens; depth 32, at most
  40 attributes per element and 512 characters per interpreted scalar.
- 500 km of supported intervals, bounding continuous 250 m windows to 2,000.
  Coordinates/elevation are validated before analysis. All exceeded limits
  reject the file, never silently truncate data.
- Worker parsing, hashing and analysis; one active import, Cancel and a
  15-second deadline. File bytes move by transferable ArrayBuffer.
  The idle first-party worker stays available for later disconnected imports;
  cancelling/timing out terminates it. A new worker needs its static modules
  available again. Failure is explicit, never a network decoder fallback.
- At most 10 files / 20 MiB originals in session and in the remembered library.
  Active session geometry also has a 40,000-point aggregate budget; additional
  files require explicit deletion, never eviction or silent truncation.
  Derived views are not persisted. The per-import counts bound allocations
  conservatively toward the architecture's 64 MiB derived-data target; this is
  not certification of every browser engine's heap accounting.
- Outline-only rendering uses at most 5,000 display vertices / 1,000 disconnected runs; higher run
  counts show an explicit unavailable outline without losing original data.
  Display decimation never changes measurements or joins gaps.

The packaged Chromium tests exercise 375 px keyboard use and disconnected
imports after code loads. First-ever offline load, an installed offline pack,
Safari/Firefox, physical-phone performance and every FIT device/export variant
are **not** claimed qualified.

## Consent, local identity and deletion

`kotr27-local-routes` is an independent IndexedDB database with `meta` and
`files` stores. It never writes rider/preferences categories, the public catalog
or public packs. Ordinary reads discover without creating a database.
Per-file **Remember this file on this device** is the sole save action.
Metadata and original bytes commit together. There is no auto-save or silent
grant. Usage is shown; quota/denial falls back to existing session memory.

Library `generation` is a category-scoped atomic deletion/expiry tombstone.
Each imported record retains the authority observed before import; Remember
compares it inside a read/write transaction. Per-file/delete-all/expiry rotate
that generation, so even delayed stale-tab grants cannot resurrect files.
Deletion remains possible with no prior local knowledge and keeps the marker,
not `deleteDatabase()`. Delete-all can clear an obsolete/corrupt schema.
Unchanged saves don't rotate the generation. Existing rider/preferences
per-category atomic consent/version protections remain separate and unchanged.

BroadcastChannel messages contain only `changed`, no identity/payload. Focus/
visibility and transactional checks cover missed messages; stale responses
are fenced against newer local operations. A committed deletion removes
originals/index entries and active memory/views/playback registrations.
Delete-all also rotates a distinct forget marker so other tabs clear unsaved
session files, whereas deleting one file never sweeps unrelated session files.
In-flight save IDs participate in deletion reconciliation before their success
receipt arrives. A changed library generation plus absence revokes pending save
candidates as well as known persisted records, not untouched never-saved session
files. A success receipt is followed by a fresh metadata read; failed/uncertain
receipts also reconcile rather than silently restoring a working session copy.
A save failure carries a storage-owned `writeOutcome`: `not-written` before a
transaction starts, `aborted` only after a trusted native terminal abort for
that transaction, or `unknown`. A successful transaction returns `committed`.
A bubbling request error is not yet a rollback; the store waits for the terminal
abort/complete event. Confirmed no-write/abort failures retain session fallback
even if reconciliation reads are denied. An unknown receipt discards that
candidate's active memory/views immediately, not unrelated never-saved files,
and explicitly warns that the outcome is unknown and a durable file may remain.
It never labels the candidate definitely unsaved. A committed receipt followed
by unavailable deletion authority also discards its active candidate.
A surviving committed ID is tracked even when an unrelated deletion supersedes
its receipt, so subsequent per-file deletion still clears it. These observations
do not refresh that file's save authority. Reimport/new consent uses a new ID.
Automatic library discovery waits for queued preference privacy operations;
explicit library deletion does not. This preserves existing settings lifecycle
ordering without granting authority across categories.
Deletion failure removes active memory but explicitly says **NOT confirmed**,
keeps durable records visible for recovery, and offers retry/browser site-data
controls. No success is assumed. Files expire 90 days after consented save,
on the next library read (an intentionally conservative maximum retention,
not sliding activity tracking).

**Global Preferences Forget** invokes the settings controller's removal API and
the local library's `forget()` API through an explicit injected callback. Both
invalidate active memory and pending work synchronously, then independently
commit their existing category tombstones. Each reports a confirmed/unconfirmed
outcome; the global status announces success only after both confirm. Partial
failure names which category remains unconfirmed, retains an explicit retry,
and does not restore active views or adopt consent. No cross-database atomicity
is claimed; one category's failure never prevents the other's deletion.

Local routes use cryptographically random `user:<UUIDv4>` identities and
separate internal local revision IDs. URLs contain only area, view and the
opaque local ID: never filenames, source metadata, hashes, positions, times,
telemetry or seek distance. Local links are expressly nonportable, not public
share links. Missing/deleted IDs stay unavailable and offer import/library
recovery; no organizer fallback. Local IDs are not saved by public route/UI
preferences. A local `view=flyover` link resolves to local briefing, never
starts a provider. The existing example-only provider subscription also
rejects nonexample playback identities.

## Validation entry points

Synthetic fixtures are generated in `tests/local-route-fixtures.mjs`, including
real FIT definition/data bytes and correct CRCs. No user originals or binary
activity fixtures are committed. `tests/local-routes.mjs` covers the pure
decoder/consent contract. `tests/local-routes-browser.mjs` builds the actual
allowlisted artifact, uses native CDP file input and keyboard events, checks
requests/URLs/bodies, IDB consent/reload/deletion/denial/quota, and disconnected
operation. The build hashes worker URLs and transitive dependencies; release
tests explicitly verify worker `new URL()` references too.

### Actual validation · 2026-11-25

Node v26.10.0 and headless Chrome, generated temporary release trees and
synthetic files; no dependency installation:

```sh
node --test --test-concurrency=1 tests/local-routes.mjs tests/local-routes-browser.mjs tests/release.mjs tests/rider-controls.mjs
# 18 passed, 0 failed.

node --test --test-concurrency=1 tests/rider-preferences.mjs tests/preferences-browser.mjs tests/trip-planner-browser.mjs
# 82 passed, 0 failed.

node --test --test-concurrency=1 tests/route-analysis.mjs tests/route-pack.mjs tests/route-catalog.mjs tests/route-time.mjs tests/route-playback.mjs tests/route-state.mjs tests/trip-planner.mjs tests/ascent-estimator.mjs tests/ride-clock.mjs tests/climb-sensitivity.mjs tests/route-pace.mjs tests/route-comparison.mjs
# 144 passed, 0 failed.

node --test --test-concurrency=1 tests/route-briefing-browser.mjs tests/route-pace-browser.mjs tests/route-comparison-browser.mjs tests/site-shell.mjs tests/release-lifecycle.mjs tests/flyover.mjs tests/climb-sensitivity-browser.mjs
# 20 passed, 1 failed: source flyover fixture omitted the five new modules,
# preventing shell startup. Updated only that exact static fixture allowlist.
node --test tests/flyover.mjs
# Subsequent targeted run: 1 passed, 0 failed.

python3 tools/import-routes.py --check
# PASS, checkOnly:true; seven existing revisions, unchanged manifest:
# 7f5e6be4133ce03c983e53194e491aa8580638c6f2c8bb5cfb36a768d2709fdc
python3 tests/semonzo_chapters.py
# 3 passed.

for file in js/local-route*.mjs js/site-shell.mjs js/preferences-view.mjs js/route-briefing-view.mjs js/route-pace-view.mjs js/route-pace.mjs js/route-session.mjs js/route-state.mjs tools/build-release.mjs tests/local-route*.mjs tests/release.mjs tests/rider-controls.mjs tests/flyover.mjs; do node --check "$file" || exit; done
git --no-pager diff --check
git --no-pager diff --exit-code -- assets tools/route-import.json
# All exit 0. No asset or organizer intake configuration changes.
```

Earlier iterations exposed and corrected: a synthetic oversized fixture whose
elevations exceeded bounds before its point limit; local seek resets on focus;
library discovery racing queued settings privacy checks (existing preference
tests remain unchanged); release inventory/transitive-hash expectations and
the new accessibility heading; the new stale-tab test gating `databases()`
instead of the save path's `open()`; and a missing-record test waiting for shell
readiness rather than completion of local-library discovery. These failed runs
are not counted as passes. No unexplained exception was suppressed or unrelated
test repaired. Fresh independent review remains required.

### First independent-review corrective pass · 2026-11-25

The independent review found four blockers in that implementation; the earlier
passing checks did not cover them. Corrections and additional evidence:

1. Global Preferences Forget now coordinates both explicit deletion APIs and
   reports per-category confirmation. Packaged tests cover a recording's
   committed-but-unacknowledged save, global deletion, peer-memory invalidation,
   missing-link reload, each direction of partial failure, and explicit retry.
2. Pending save IDs now participate in generation/absence reconciliation.
   Real two-tab tests hold the native transaction-completion callback **after
   commit**, let the peer delete the file, then deliver success or inject an
   uncertain error receipt. Neither restores the old record/view; an unrelated
   never-saved session file still opens, and a fresh import can be explicitly
   remembered under a new ID. Another test changes the generation for a
   nonmatching ID during the held receipt, then verifies later deletion of the
   surviving committed file is still tracked.
3. XML comments ending with an extra hyphen now fail. Pure and native-file
   tests reject `<!--bad--->` (also rejected by Chrome's XML parser), interior
   double hyphens and unterminated comments; valid comments still import.
4. All FIT definitions validate the complete standard base-type byte and width
   before skipping unknown fields/messages. Synthetic fixtures have real
   correct lengths/CRCs. Both unknown-field and unknown-message cases reject
   `0xff`, reserved/endian-mismatched types and misaligned widths; valid scalar
   and array definitions across all 17 standard base types remain skippable
   without fabricating decoded values.

Final combined run:

```sh
node --test --test-concurrency=1 tests/local-routes.mjs tests/local-routes-browser.mjs tests/rider-preferences.mjs tests/preferences-browser.mjs tests/route-state.mjs tests/release.mjs tests/rider-controls.mjs tests/trip-planner-browser.mjs tests/site-shell.mjs
# 118 passed, 0 failed, 0 skipped.

for file in js/local-route-parser.mjs js/local-routes-view.mjs js/preferences-view.mjs js/rider-preferences.mjs js/site-shell.mjs tests/local-route-fixtures.mjs tests/local-routes.mjs tests/local-routes-browser.mjs; do node --check "$file" || exit; done
git --no-pager diff --check
git --no-pager diff --exit-code -- assets tools/route-import.json
# All exit 0. Index remains unstaged; HEAD remains 9c3fc95.
```

An earlier preference/state run was 83/84: Chrome did not answer
`Target.getTargets` within 15 seconds at startup, before page loading. One bounded
targeted retry passed, and the final full combined run above passed unchanged.
No existing test or timeout was weakened. This pass used synthetic fixtures
only, no original-file reads or new dependencies. Nonprogress recovery allowance
remains **0/2 consumed**; all four reported cases now have passing regressions.
Fresh independent review, not this implementation report, decides acceptance.

### Second independent-review corrective pass · 2026-11-25

The next review passed the four original regressions but found two remaining
edges. This pass addresses those, without expanding decoder features:

1. Outside-root text now validates raw XML whitespace before any entity
   decoding. Prefix/suffix character references, NBSP and other non-XML
   whitespace reject. The tightly related declaration/tag/attribute separators
   and numeric/time padding use XML whitespace too. Pure tests cover those
   lexical positions; packaged native uploads agree with Chrome's XML rejection
   for malformed prefix/suffix/separators while accepting valid whitespace,
   comments and prefixed namespaces. Final probes of the touched declaration
   guard also found mismatched quotes and uppercase `XML` accepted; that same
   guard now rejects both, with pure/native regressions. Valid single quotes,
   whitespace around `=` and case-insensitive UTF-8 encoding names still work.
2. The store now distinguishes confirmed no-write/abort from unknown outcomes.
   The view discards an uncertain candidate rather than retaining it as a
   definitely-unsaved session file and losing its deletion identity. Real
   two-tab tests hold a save receipt after commit, deny origin reconciliation
   reads, delete via the peer, release success or a synthetic uncertain-error
   receipt, then restore reads/focus. The deleted bytes/view cannot be reopened;
   an unrelated never-saved file remains usable. The synthetic error receipt is
   fault injection, **not an observed native post-commit abort**. Separate tests
   verify actual trusted native rollback after an injected quota exception and
   an actual duplicate-key request error: both expose `aborted`, preserve memory
   with reads denied, and permit explicit Remember after recovery.

Validation:

```sh
node --test --test-concurrency=1 tests/local-routes.mjs tests/local-routes-browser.mjs
# 26 passed, 0 failed/skipped/cancelled.

node --test --test-concurrency=1 tests/local-routes.mjs tests/local-routes-browser.mjs tests/rider-preferences.mjs tests/preferences-browser.mjs tests/route-state.mjs tests/release.mjs tests/rider-controls.mjs tests/trip-planner-browser.mjs tests/site-shell.mjs
# 125 passed, 0 failed/skipped/cancelled.

for file in js/local-route-parser.mjs js/local-route-storage.mjs js/local-routes-view.mjs tests/local-routes.mjs tests/local-routes-browser.mjs; do node --check "$file" || exit; done
git --no-pager diff --check
git --no-pager diff --exit-code -- assets tools/route-import.json
git --no-pager diff --cached --stat
git --no-pager log -1 --format='%H %D'
# Syntax/whitespace/asset checks exit 0; index empty; epic/kotr27-800 at 9c3fc95.
```

No failed test or retry in this pass. No dependencies, original-file reads,
Beads writes, staging or commits. Nonprogress recovery remains **0/2 consumed**.
Both reported edges now have passing regressions; fresh independent review is
still required. The documented decoder/resource/browser qualification limits
are unchanged.
