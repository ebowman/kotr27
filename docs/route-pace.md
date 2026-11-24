# Connected pace, ride clock and sensitivity · kotr27-800.15

## Runtime contract

`route-pace.mjs` owns a document-memory scenario, validated rider overrides and
explicit revision-bound chapter-entry stops. Default is **Steady 75% FTP** with
fictional **75 kg rider, 12 kg kit, 220 W FTP**, no stops. Easy 60%, Hard 90% and
All Day use the existing `route-time.mjs` solver. All Day discloses its single
75% moving-duration seed and resolved duration band; it is not physiology,
peak-power inference or a sustainability promise. Pedal kJ are mechanical work,
not food calories. Source-listed gains remain separate from processed windows.

The shared model supplies the pace table, chapter list, ride-clock intervals,
briefing estimate, Semonzo flyover HUD and trip subtotal. Numbers in `data-*`
are source seconds without display rounding. The UI formats minutes only at
the edge. Stops add elapsed time, not moving time/work. Missing or invalid
models produce explicit unavailable/partial subtotals, never a flat substitute.

`routePlayback.replaceRoute` atomically refreshes a matching revision's
projection, pauses, and preserves exact distance, camera mode and renderer
token. It does not reset or integrate another position clock. The elapsed
slider uses `createRouteClock(result).atSecond` and seeks that same controller.
Distance at a stop denotes arrival; exploration *within* a pause explicitly
labels its different elapsed cursor at the same distance. Animation rate is
never rider speed, elapsed riding time or recorded time.

The new explicit `estimateExampleTime` adapter preserves Semonzo's existing
authored, millimetre-rounded windows and chapters, using the same solver and
timeline builder. It does **not** relabel them as organizer analysis. Its basis
is `semonzo-chapters-v1`. The playback adapter maps the raw track endpoint to the
verified profile endpoint (difference below 1 mm); intermediate positions are
not rescaled. Legacy ascent defaults **60/75**, comparison clock **70/80**, and
sensitivity **70–90/default 80** remain unchanged and visibly distinguished.

Common route/revision and Plan/Explore navigation now stays in the current HTML
document: no loss of unrelated rider inputs, scenario or itinerary merely to
read a different route. The two actual legacy example engines still require
their respective HTML documents. That explicit transition or reload loses
unremembered values; scenario/stops are never persisted or put into URLs.
The existing separate rider/preferences consent, revocation, Forget and itinerary
protocols are untouched. Reset/Forget clears the new memory scenario/stops.

## Bounded sensitivity

The shared renderer retains its existing 3D surface, heatmap, keyboard/numeric
selection and four exact comparisons: baseline, weight only, FTP only, both.
Combined changes are independently solved; tiny nonzero deltas never say zero.
Its DOM lookup and immutable profile identity are now injectable; legacy IDs
and behavior are preserved. The optional module loads only when requested and
late completion reads current selection/input, not a captured draft.

Each target names the route, full revision and whole route or selected section.
Selecting a section uses the shared playback selection. Subsets only shift the
distance origin; they retain every existing window and signed rise. The existing
solver validates eligibility. No grade repair, truncation or new detection.
**D4S whole-route time and sensitivity remain unavailable** for processed
grades outside the unchanged bounds. A genuinely valid section can be explored,
with an explicit warning that it does not certify uncertain elevations elsewhere.

Limits: 500 windows per sensitivity target, at most 10 × 10 grid points; at most
8 cached meshes keyed by complete revision identity/section, physical inputs,
kit and effort. Updates coalesce in one RAF, cancel when hidden, and do not run
from playback subscribers. Mode, viewpoint, units and point selection reuse the
mesh. The route-time cache holds at most 32 results keyed by complete identity,
scenario, rider inputs and stops. A route change cannot borrow another revision's
stops or estimates, nor reset unrelated rider values.

Measured packaged Chrome result: **1 initial mesh; 120 seeks + 180 animation
ticks → 0 additional meshes; selecting one section → 1; returning to the whole
route → cache hit; 20 synchronous FTP edits → 1**. Counts reflect successful
actual mesh construction, not estimated frame budgets.

## Exact changed paths

- Runtime: `js/route-pace.mjs`, `js/route-pace-view.mjs`,
  `js/route-time.mjs`, `js/route-playback.mjs`,
  `js/route-playback-adapters.mjs`, `js/climb-sensitivity-view.mjs`,
  `js/route-briefing-view.mjs`, `js/site-shell.mjs`,
  `js/trip-planner-view.mjs`, `assets/flyover.js`, `assets/site.css`,
  `index.html`.
- Build/tests: `tools/build-release.mjs`, `tests/route-pace.mjs`,
  `tests/route-pace-browser.mjs`, `tests/flyover.mjs`,
  `tests/rider-controls.mjs`, `tests/release.mjs`, `tests/site-shell.mjs`,
  `tests/trip-planner-browser.mjs`.
- Evidence: `docs/route-pace.md`.

The release allowlist and exact transitive-hash mutation tests include both
new modules. No dependencies, geometry, pack metadata, private originals,
credentials or storage schema were added/changed.

## Validation · 24 November 2026

```sh
node --test --test-concurrency=1 tests/route-time.mjs tests/route-playback.mjs tests/route-analysis.mjs tests/route-state.mjs tests/ascent-estimator.mjs tests/ride-clock.mjs tests/climb-sensitivity.mjs tests/trip-planner.mjs tests/rider-preferences.mjs tests/route-catalog.mjs tests/route-pack.mjs tests/route-briefing.mjs tests/route-comparison.mjs
# 189 passed, 0 failed.

node --test --test-concurrency=1 tests/route-pace.mjs tests/route-pace-browser.mjs tests/route-briefing-browser.mjs tests/route-comparison-browser.mjs tests/trip-planner-browser.mjs tests/preferences-browser.mjs tests/release.mjs tests/release-lifecycle.mjs tests/site-shell.mjs tests/climb-sensitivity-browser.mjs tests/rider-controls.mjs tests/flyover.mjs
# 67 passed, 1 failed before the download-completion correction below.

node --test --test-concurrency=1 tests/trip-planner-browser.mjs tests/route-pace-browser.mjs tests/site-shell.mjs
# After correction: 9 passed, 0 failed.

node --test tests/route-pace.mjs
# Final numerical run, including D4S valid/invalid subset checks: 5 passed.

python3 tests/semonzo_chapters.py
# 3 passed.
python3 tools/import-routes.py --check
# Seven unchanged revisions; manifest:
# 7f5e6be4133ce03c983e53194e491aa8580638c6f2c8bb5cfb36a768d2709fdc
```

New pure assertions cover all seven inputs, source-second equality at multiple
distances across controller/clock/pace, exact chapter/trip reconciliation,
stops, units, invalid/clear, revision isolation, section bounds, four isolated
factors, Semonzo authored units and non-resetting scenario replacement.
New packaged 375px tests use actual native keyboard/text input, blocked external
providers, shared totals, optional stops, named targets, rapid switching, late
route completion/input preservation, default no storage/network and exact HUD
projection. New navigation waits for the replacement default execution context
before evaluating the document. No privacy/error assertions were weakened.

Initial failures corrected in scope:

- The new sensitivity content was initially empty but unhidden. It now remains
  hidden with explicit status until an actual model is ready.
- Legacy accessibility heading expectations and the flyover fixture's explicit
  module inventory now include their new dependencies/pane.
- Release assertions now require the exact expanded transitive hash graph,
  including both entry freshness markers; unrelated camera/geometry bytes stay
  unchanged.
- The shell test now checks retained-document navigation rather than demanding
  a refetch. It waits for the independent planner before baselining request
  counts (an initial 1280px failure observed 8 versus 7 outstanding GPXs).
- The final broad planner test observed the SHA-256 of **empty bytes** while
  checking a filename that had appeared before Chrome finished writing.
  `trip-planner-browser.mjs` now waits for correlated `downloadWillBegin` /
  `downloadProgress: completed` events for single and batch downloads.
  Cancellation fails; exact checksums, privacy and unexpected errors remain
  strict. This follows the separately established completion mechanism, not a
  retry-until-green or a production download change. The corrected dependent
  nine-test run passes. The earlier 67/68 result is retained above, not called
  an all-green run.

`node --check` passes for changed runtime/test/build JavaScript; scoped
whitespace checks pass. No separate configured lint runner exists. Real
terrain/provider qualification, Safari/physical-device, offline packs and
physiological validation were not performed or implied.

Foreign tracked-diff fingerprint remains
`2e9888966fe6d6ada8ba0aba143f484d23d2cfa21c62c35df9cbd83540e5c162`,
matching the prior recorded preservation evidence. Index empty, branch
`epic/kotr27-800`, HEAD `40aa685097ebd9805abe7f03960e7126868bb70c`.
The separately named sessionfiles baseline was not located within bounded
read attempts; this pass does not claim independent comparison of its 11
private-file/backup hashes. No such files were edited.

No discovered beads or Beads writes, staging, commit, close, delegation, push
or merge. Bead remains `in_progress`, assigned to Eric Bowman. Nonprogress
recovery allowance consumed: **0/2** (specific findings decreased).
Fresh independent parent review remains required.

## First independent-review correction · 24 November 2026

Review found a concrete acceptance blocker: switching from a supported
sensitivity target to D4S whole-route hid the panel but retained the renderer's
old profile, identity and rider state. Editing sensitivity effort could rebuild
that old route beneath the D4S heading. The original implementation was **not
accepted**. The new packaged regression reproduced the failure before this fix:
the unsupported-target reason became empty after control events.

`installSensitivity` now exposes **`invalidate(message)`**, distinct from
temporary scheduler cancellation. It clears the active profile, identity,
rider state, data and current key; clears rendered values; retains the
unavailable reason; cancels work and advances a generation fence. Controls
cannot activate an unsupported target. Numeric selection controls are no-ops
without data. `setProfile` invalidates the previous active state before
installing the new profile; fresh rider inputs are required to render it.
Correctly identity/physical-input-keyed immutable cache entries remain bounded
and reusable. A canceled or obsolete callback cannot publish over new state.
The pace view uses this API instead of only canceling and hiding DOM content.

Packaged regressions cover:

- Supported whole route → D4S whole route → effort and all other controls:
  no mesh, no values, unchanged explicit unavailable reason.
- Eligible D4S section → unsupported whole route, with a valid calculation
  queued in the same task and subsequent effort edits: no old result can return.
- Return to a valid section with updated rider weight/FTP: exact independent
  numerical result at current effort; repeat return reuses the correct cache.
- Delayed sensitivity-module response while switching to D4S and editing
  rider inputs: zero meshes after completion; return to a valid route uses
  the latest physical inputs, not the pre-load draft.

Commands/results for this correction:

```sh
node --test --test-name-pattern='unsupported sensitivity targets' tests/route-pace-browser.mjs
# Before fix: 1 failed, unsupported-target reason incorrectly cleared.
# After fix: 1 passed.

node --test --test-concurrency=1 tests/climb-sensitivity.mjs tests/climb-sensitivity-browser.mjs tests/route-pace.mjs
# 21 passed, 0 failed.

node --test --test-concurrency=1 tests/route-pace-browser.mjs tests/release.mjs tests/rider-controls.mjs
# 12 passed, 0 failed, including both new regressions and strict packaged
# release/privacy checks. Existing 120-seek/180-tick/20-edit budgets still pass.

node --check js/climb-sensitivity-view.mjs
node --check js/route-pace-view.mjs
node --check tests/route-pace-browser.mjs
git diff --check
# All passed.
```

Only four paths changed relative to the reviewed assignment:
`js/climb-sensitivity-view.mjs`, `js/route-pace-view.mjs`,
`tests/route-pace-browser.mjs`, and this evidence document.
No data, physics bounds, scenario labels, dependencies or consent code changed.

The supplied `files/800-15-review-baseline.json` was located for this pass:
all **11 private and 50 foreign file hashes match**. The other 17 of 21 owned
paths remain identical to that baseline. Index remains empty; branch/HEAD and
`in_progress` Eric Bowman assignment are unchanged. No Beads writes, staging,
commit or closure. No discovered beads. Nonprogress allowance remains **0/2**.
Fresh independent review follows; these implementer checks are not a review PASS.
