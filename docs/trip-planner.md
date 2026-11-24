# Revision-bound trip planner · kotr27-800.8

Plan now opens the approved seven-route pack, not just an alternate JSON link.
Choose one variant per D1–D4 source group, or leave groups unselected. These
labels are **not calendar dates or departures**. Route preview changes the
shared public route/revision URL, not itinerary membership. The Semonzo example,
legacy seek, clock and sensitivity remain separate; organizer playback is not
implemented here.

## Facts and downloads

- `itinerary.mjs` owns the closed, versioned choice shape, reconciliation and
  aggregation. Totals sum unrounded shared-analysis horizontal distance and
  **derived 250 m window ascent**. Only display is rounded. Source-listed gain
  and raw point gain are separately labeled; no agreement is claimed.
- One choice per group prevents variant double counting. Distinct planned days
  on shared geometry remain distinct rides; identical downloadable files are
  offered only once per batch. Missing analyses produce a named partial subtotal,
  never invented zero ascent.
- `trip-planner.mjs` loads the same pinned public manifest used by the build.
  The shared producer validator's new `metadataOnly` option validates the entire
  metadata/reference graph without claiming payload verification. Each analysis
  then uses the existing `.6` loader; each individual/batch download verifies
  its declared SHA-256 again immediately before browser handoff.
- Only deployment-local, allowlisted public pack paths can be fetched; no
  redirects, credentials or referrer are sent. RWGPS links are reconstructed
  from numeric public route IDs, with no private access codes.
- Filenames are `<routeId>--<fullRevisionId>.gpx`. The current pack has sanitized
  GPX tracks only: no cues, timestamps, device metadata or facility POIs.
  FIT is explicitly unavailable; no raw originals or renamed GPX are offered.
- Downloads report per-file errors, shared-file deduplication and **handed to
  browser**, never “saved.” Browsers/OS may block multiple files; individual
  buttons provide a retry. A selection change during an asynchronous request
  cancels remaining handoffs. Downloaded files are outside app control.

Saved selections retain their exact revision. Changed, withdrawn or missing
records block affected individual downloads and fail visibly within batches,
without preventing other groups' valid downloads. The rider must acknowledge
using the current revision or removing the saved selection. Other groups remain
unchanged. Where the pinned change report covers the saved revision, raw
before/after metrics are shown; otherwise prior metrics are explicitly absent.
The tab stays pinned to its release; this is not live organizer monitoring or
an offline freshness guarantee.

## Consent and compatibility

Default is **document memory**, including when IndexedDB is unavailable.
Reload or crossing between the two HTML documents loses unremembered choices;
same-document preview/navigation preserves them.

Persistence requires both **Remember route/UI choices** and the additional
**Also include my trip itinerary** checkbox. Existing route/UI consent alone
never starts persisting the new itinerary. Incoming active-route links still
take precedence; restored itinerary membership is independent.

The existing database and outer record remain version 2. A route/UI value may
add exactly this optional field:

```text
itinerary: {version: 1, choices: [{dayId, routeId, revisionId}, …]}
```

Only public IDs, at most 100 unique day choices, with no unknown fields, are
accepted. Legacy values without the field still work. Older version-2 readers
reject the additional field rather than overwrite it; existing version-1
database fencing is unchanged.

Opting into the extra scope rotates the existing preferences consent version.
Turning itinerary remembering off revokes **all route/UI saving**, as the UI
discloses; it installs that category's tombstone and keeps the current memory
draft. Forget, expiry, peer invalidation and stale-write conflicts reset the
itinerary using the existing lifecycle. Rider consent remains separate.
No new store, automatic consent migration, settings export or server is added.

## Validation · 2026-11-24

```sh
node --test --test-concurrency=1 tests/trip-planner.mjs tests/trip-planner-browser.mjs tests/rider-preferences.mjs tests/preferences-browser.mjs tests/site-shell.mjs tests/route-state.mjs tests/route-analysis.mjs tests/route-pack.mjs tests/route-catalog.mjs tests/ascent-estimator.mjs tests/ride-clock.mjs tests/climb-sensitivity.mjs tests/climb-sensitivity-browser.mjs tests/flyover.mjs tests/rider-controls.mjs
# 192 passed, 0 failed/skipped
python3 tests/semonzo_chapters.py
# 3 passed
python3 tools/import-routes.py --check
# Seven unchanged revisions; manifest:
# 7f5e6be4133ce03c983e53194e491aa8580638c6f2c8bb5cfb36a768d2709fdc
```

New tests cover all seven choices and exact totals, partial/missing metrics,
synthetic revision replacement/withdrawal, reload, unavailable storage, explicit
additional consent, expiry, stale-tab revoke/Forget, and checksum/cancellation/
partial-download failures. Packaged Chrome at 320/1280px exercises keyboard
type-ahead, navigation focus, 200% text, actual saved GPX checksums, batch failure
and individual retry, FIT absence and manifest failure. Existing shell checks
also exercise 375px, legacy entries and asynchronous GPX focus.

`node --check` on all 15 changed/new JS test/runtime/tool files and
`git diff --check` passed. No separate configured lint runner exists.
After final source/variant-label copy, the nine planner API/browser tests and
syntax/whitespace checks passed:

```sh
node --test tests/trip-planner.mjs tests/trip-planner-browser.mjs
# 9 passed
node --check js/trip-planner-view.mjs
node --check js/route-pack-contract.mjs
git diff --check
# All passed
```

### Outstanding release-validation blocker

```sh
node --test tests/release.mjs tests/trip-planner.mjs tests/rider-preferences.mjs
# 54 passed, 1 failed: strict release interception-error assertion
```

The warm-release fixture reported **Invalid InterceptionId** for a planner
profile request while entry freshness replaced the page. Its deterministic
build, allowlist, transitive hash, privacy and earlier browser assertions ran,
but the overall release test **did not pass**. The strict assertion and network
interception behavior were not weakened. An isolated read-only HEAD `e3b7340`
baseline in a temporary directory passed all three release tests; historical
documentation also records this intermittent error. Causality remains uncertain,
so this is retained as a validation blocker, not called an unrelated pass.
No retry-until-green or out-of-scope harness repair was performed.

During implementation, a null-bundle loading error was fixed; the shell tests
now pass. A teardown race from newly asynchronous asset reads is bounded to
fixture teardown. The macOS desktop native-select popup probe did not commit
the choice via CDP; native type-ahead plus Tab now passes desktop and phone
keyboard journeys without synthetic selection for that assertion.
Nonprogress recovery allowance consumed: **2 of 2**, restored measurable
progress on that keyboard probe; no independent review has occurred.

No live provider, Safari/physical-device, offline-pack or GPX device-navigation
qualification is claimed. Public geometry, revisions, the 11 private originals,
unrelated installer/config/backups and the index are unchanged. No Beads writes,
staging, commits, closure, push or merge.

## Independent-review corrective pass · 2026-11-24

The review found two mandatory blockers. Their original evidence above is
historical, not erased by the following correction.

### Sparse persisted choices

`Array.prototype.every` skipped a hole preserved by IndexedDB structured clone.
`validItinerary` now checks `Array.from(choices)`, making holes explicit invalid
entries before restoration or aggregation. No consent protocol, database
version, expiry or migration behavior changed.

```sh
node --test --test-name-pattern='sparse' tests/trip-planner.mjs tests/trip-planner-browser.mjs
# Before fix: 2 failed (validator accepted the hole; browser planner not ready).
# After fix: 2 passed.
```

The browser regression puts/gets `choices:Array(1)` through actual IndexedDB
and verifies `{length:1,hasZero:false}`. Reload explicitly reports corrupt
route/UI preferences; consent stays absent; selecting a route still works in
memory without changing the corrupt stored consent version. Explicit Forget
then allows fresh consent and an ordinary valid itinerary reload. Unit checks
also reject undefined/null entries and sparse structured clones.

### Deterministic interception lifecycle and fixture correction

New `tests/release-lifecycle.mjs` builds two real release artifacts, holds the
freshness response, and deliberately leaves exactly one planner profile paused
at Fetch interception while the other six complete. It correlates the held
Fetch ID with its Network request ID, frame ID and loader ID.

Negative control: release the freshness response and observe actual `_kotr`
navigation to a **different loader in the same frame**. Continuing the old
Fetch ID then deterministically returns `Invalid InterceptionId`. The held
request still has **no terminal Network event**; `loadingFailed` is not used
as cancellation evidence.

Positive control: continue that same held request before allowing freshness,
observe its `Network.loadingFinished` and complete planner, then release the
response. Completion precedes the replacement frame and there are no protocol
errors. Recorded event sequences were **333 < 352** in the focused run and
**322 < 341** in the broader run. Both controls passed in both runs. These are
causal controls, not evidence inferred from an ordinary green rerun; they
establish the reproduced mechanism, not the identity of every historical race.

The warm-release fixture now controls its own freshness response at this
completion boundary. It asserts the old cached release and complete old planner
are present, an actual freshness request is held, no continuation command is
unresolved, and replacement has not happened before opening the gate. Explicit
fixture navigation also waits for planner/continuation completion. Every
request still uses the original same-origin continuation / foreign-origin
failure policy, and **all unexpected protocol errors still fail**. No generic
catch, invalid-ID filter, request-privacy exception, application behavior change
or shared `tests/browser.mjs` modification was made. The negative control alone
explicitly asserts its intentionally injected stale command's exact error.

```sh
node --test tests/release-lifecycle.mjs
# Initial diagnostic: 1 passed, obsolete-ID mechanism established.
node --test --test-concurrency=1 tests/release-lifecycle.mjs tests/release.mjs
# After adding positive control/completion gate: 5 passed.
node --test --test-concurrency=1 tests/trip-planner.mjs tests/trip-planner-browser.mjs tests/rider-preferences.mjs tests/preferences-browser.mjs tests/release-lifecycle.mjs tests/release.mjs tests/site-shell.mjs
# Final broader correction validation: 95 passed, 1 failed.
```

**Remaining validation blocker:** the broader run's 375px packaged shell case
failed with `Error: Inspected target navigated or closed`, surfaced at
`tests/browser.mjs:64:25` (`dispatch`), then `browser.mjs:70:7` (socket reader).
The protocol wrapper did not preserve the triggering test-step location.
The release lifecycle controls, strict warm-release fixture, both planner
viewports, sparse IndexedDB recovery and all consent tests passed in that run.
This new failure is **not classified as unrelated and was not retried**.
The implementation is not claiming an overall PASS; fresh independent review
and disposition of the remaining validation failure are still needed.

`node --check` passed for `js/itinerary.mjs`, both planner tests,
`tests/release-lifecycle.mjs`, and `tests/release.mjs`; whitespace checks passed.
Nonprogress allowance remains **2/2 consumed**, unchanged by this concrete
blocker-reduction pass. No further speculative recovery loop was started.

## Bounded lifecycle repair · 2026-11-24

Resumed only `kotr27-800.8` on `epic/kotr27-800`, HEAD `a423236`, under the
explicit new lifecycle-repair authorization. The live bead remained
`in_progress`, assigned to Eric Bowman. All 18 handed-off owned-file,
11 private-file and 50 foreign-file fingerprints matched before this pass;
the index was empty. Subsequent physics/playback commits were preserved.

### Confirmed preferences-fixture shutdown race corrected

The fixture registered artifact deletion before server and browser cleanup.
Node runs these after hooks in registration order. Moreover, closing a socket
does not finish an asynchronous request handler: a background planner-profile
read could still reach `readFile` after the artifact had been removed.

`tests/preferences-browser.mjs` now has one ordered, awaitable cleanup:

1. Await the existing browser cleanup (Chrome exit and pipe cleanup).
2. Stop the HTTP listener, close active connections, and await server closure.
3. Await every tracked request handler.
4. Remove the artifact.

Unexpected handler errors are collected and fail cleanup with `AggregateError`;
there is no ENOENT exemption or ignored-error filter. Consent assertions and
legacy-controls readiness are unchanged.

The regression holds an actual planner-profile handler before its disk read.
After legacy controls are ready, it starts cleanup and observes browser/server
shutdown complete while that handler remains outstanding. The profile must
still exist. Releasing the read must drain the handler before deletion.
A deliberate negative control moved deletion ahead of handler draining:
the regression failed with ENOENT for that profile. Restoring the ordered
cleanup made the same regression pass. This is causal ordering evidence,
not merely a green rerun.

```sh
node --test --test-concurrency=1 tests/preferences-browser.mjs
# Corrected fixture: 32 passed, 0 failed.
node --test --test-name-pattern='fixture drains' tests/preferences-browser.mjs
# Deliberate premature-removal mutation: 0 passed, 1 failed (ENOENT).
# Mutation removed; restored correction: 1 passed, 0 failed.
node --check tests/preferences-browser.mjs
node --check tests/site-shell.mjs
git diff --check
# Passed.
```

### Navigation blocker remains unresolved — no overall PASS

`tests/site-shell.mjs` now records the failing CDP method/parameters,
test-step callsite, send boundary and recent sequenced frame/execution-context
events, then rethrows the original error. `Page.enable` supplies frame events.
This changes diagnostics only, not readiness or error handling.
The shared `tests/browser.mjs` is untouched.

```sh
node --test --test-name-pattern='375px' tests/site-shell.mjs
# Instrumented case: 1 passed. NOT causal resolution of the earlier failure.
```

The bounded hypothesis was that reload acknowledgment could precede document
replacement and permit a readiness command against the old document. Three
one-off `node --input-type=module -e` HTTP/CDP probes held a reload response:

- Awaiting `Runtime.evaluate` before releasing the response timed out (15 s).
- Using `Page.getFrameTree` as a barrier also timed out (15 s); that command
  was not an independent barrier while the renderer awaited navigation.
- Sending the evaluation without awaiting it, then releasing the response,
  completed successfully. The recorded frame retained its ID but changed loader
  and default execution context. This did **not** reproduce
  `Inspected target navigated or closed`.

These are diagnostic failures/counterevidence, not successful acceptance tests.
There is still no captured failing command with its causal frame transition
for the historical 375px failure, nor a deterministic reproduction supporting
a protocol correction. No speculative shared-browser fix, catch-and-ignore,
error filter, full-suite rerun or retry-until-green was added.

This pass reduces the confirmed teardown blocker only. Navigation diagnosis
stops for lack of causal progress; the original **2/2 nonprogress allowance
remains consumed**, not reset. No fresh independent review has occurred.
The parent must retain the navigation blocker and obtain a narrow disposition
before further corrective investigation; this is not ready for commit/closure.

Only `tests/preferences-browser.mjs`, `tests/site-shell.mjs` and this document
changed in this pass. Private and foreign fingerprints, the empty index,
branch and HEAD were rechecked unchanged. No runtime, public geometry,
shared browser helper, Beads state, staging, commit, closure or delegation
changes were made; no discovered beads, push or merge.
