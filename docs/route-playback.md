# Shared route playback · kotr27-800.10

Integration update `.17`: [recorded replay](recorded-replay.md) now uses this
same controller with an optional `recordedReplay` adapter and
`seekRecordedSeconds`. Its source-time cursor supports pauses at unchanged
distance; tick uses accepted seconds × replay rate, **not** route distance /
animation duration. Distance seeks choose first recorded arrival for ordinary
pauses, but decline collapsed gap subtotals with an explicit `seekNotice`;
elapsed/sample seeks remain available. Time seeks can enter pauses. Scenario
replacement and same-recording view/area navigation preserve recorded elapsed,
paused; navigation does not imply a seek or restart. Ordinary
geometry animation and the legacy example semantics below remain unchanged.
The original standalone/integration boundaries below describe `.10` at delivery.

`js/route-playback.mjs` owns **one distance position** independently of a
renderer, rider model or browser scheduler. `js/route-playback-adapters.mjs`
connects the existing revisioned analysis/model and the Semonzo example.
No new dependency, UI, camera path, geometry or physics is introduced.

## Integration boundary

This is a tested, standalone source API, **not shipped UI integration**.
The existing flyover, shell, comparison clock and release-builder inputs are
unchanged. `.11` owns linked map/profile/UI integration; `.12` owns camera
choreography. The new modules must be explicitly added to the allowlisted
release graph by the authorized integrator, with artifact/browser tests.
There is no claim of packaged, browser, Safari, live terrain or accessibility
validation here. Suspended `.8` edits and its known browser failures are not
repaired or included.

When integrating, replace the old flyover's `d`, `playing`, `last` and RAF
accumulator with this controller; **do not run two playback engines**.
One owner calls `tick(timestamp)`, then passes that exact snapshot to every
map, profile and HUD consumer. Consumers may render less often but must not
integrate elapsed time, round a distance back into the controller, resample
their own axis, or use a camera's smoothed coordinates as rider position.
`getSnapshot()` returns the same deeply immutable object until a transition;
all commands return the current snapshot. There are no independent observer
clocks, DOM listeners, fetches, timers or background tasks installed here.

```js
import { createRoutePlayback } from './js/route-playback.mjs';
import { createAnalysisPlaybackRoute } from './js/route-playback-adapters.mjs';

const playback = createRoutePlayback({
  loadRoute: async ({routeId, revisionId}) => {
    const analysis = await loadVerifiedAnalysis(routeId, revisionId);
    return createAnalysisPlaybackRoute(analysis, {
      estimate: currentEstimateFor(analysis.identity),
    });
  },
  reducedMotion: prefersReducedMotion,
  hidden: document.hidden,
});
await playback.selectRoute({routeId, revisionId, distanceM: 0});
// Explicit user action only:
playback.play();
// Exactly one RAF owner, no second map/profile advancement:
const snapshot = playback.tick(monotonicMilliseconds);
renderMap(snapshot); renderProfile(snapshot); renderHUD(snapshot);
```

`loadVerifiedAnalysis` and `currentEstimateFor` above are integration placeholders,
not new functions in this module. Use `loadRouteAnalysis` and the existing shared
route-time estimator; the loader must validate rights, hashes and exact pinned
revision before returning an adapter. No fallback to current revision occurs.
The controller is not another importer or publication gate.

## State and commands

Snapshot fields include `phase`, monotonic `requestId`, pinned `selection`,
complete analysis `identity`, `position`, `distanceM`, `totalDistanceM`,
`chapterId`, ordered `chapters`, previous/next chapter IDs, `animationRate`,
`animationDurationSeconds`, `cameraMode`, `hidden`, `reducedMotion`, `renderer`,
`estimatedRide`, `recordedClock` and `error`.

`distanceM` is an exact convenience projection of `position.distanceM`, not
another accumulator. All position/clock projections are installed atomically.
The analysis adapter retains raw and processed elevations distinctly and uses
the shared `positionAt` query (including ordered loop occurrences). Unsupported
analysis fails explicitly; no invented flat profile, chapter or POI is created.
Generic trusted geometry-only adapters may provide no chapters.

| Action | Transition / invariant |
|---|---|
| Initial | `idle`, no route/position; 3D disabled, overview camera. |
| `selectRoute({routeId, revisionId, distanceM?, chapterId?})` | Immediately `loading`, clear old details, increment request identity, pause, disable 3D. Matching complete success → `ready`, or `paused` for an explicit section/distance. No autoplay. Errors → `error`. |
| `play()` | Ready/paused → `playing` from current position. At finish, replay from zero. Repeated Play is idempotent. Hidden, invalid route or opted-in buffering/unavailable renderer cannot queue Play for later. Reduced motion still allows explicit Play. |
| `pause()` / `manipulate()` | Playing → `paused`; clear timestamp anchor. No distance/camera movement. Manual map exploration must call this at interaction start, not only after drag completion. |
| `seekDistance(m, {strict:false})` | Pause, clamp ordinary finite UI distances into route bounds, use follow framing. Invalid/non-numeric drafts do not seek. `strict:true` rejects out-of-range values without moving. A seek to finish remains paused; next Play replays. |
| `selectChapter(id)`, `nextChapter()`, `previousChapter()` | Adjacent chapter **start**, paused, same distance axis. Half-open chapter ownership, finish owned by last chapter. Invalid/boundary commands pause without seeking; null neighbor IDs allow UI disabling/explanation. No chapters leaves distance seeking available. |
| `restart()` | Zero, paused, follow camera. |
| `backToOverview()` | Pause and overview camera, **preserve distance**. |
| `setCameraMode(mode)` | Follow/overview/side/cinematic only; pause, preserve distance and estimates. “Return to rider” is `setCameraMode('follow')`, not seek or Play. Actual camera work is downstream. |
| `setAnimationRate(rate)` | 0.5/1/2/4 only; pause and retain position/estimates. Values are animation multipliers, never rider speed. |
| `setHidden(boolean)` | Pause and discard anchor on visibility changes; returning visible never resumes. Wire before the next animation tick. |
| `setReducedMotion(boolean)` | Pause, retain position. Snapshot tells renderers to suppress transitions/inertia; no automatic motion either way. |
| `clear()` | `idle`, invalidate outstanding loads/terrain, remove position/details. Preferences such as rate/reduced motion remain. |
| Route load/projection failure | `error`, selected revision and error code retained; no private loader exception text. Last valid position/details retained on projection failure. Explicit `selectRoute` retries; no automatic loop. |

Load success **and** rejection from any superseded request are ignored, including
A→B→A, retry of the same identity, and `clear()` while pending. Commands requiring
route data do not queue during loading/error. A loader that never resolves remains
loading; caller can select another route or clear. Cancellation/timeouts are
loader concerns, not a speculative fallback here.

Restoration requires explicit nonempty route/revision identifiers; malformed,
nonfinite, negative or out-of-range distances and absent chapters produce an
error, not clamping/substitution. A valid chapter takes precedence over a valid
distance. The shell's existing `readSelection` remains responsible for URL syntax,
rights/catalog selection, old-revision notices and its explicit legacy-invalid
link recovery. The legacy adapter accepts its `code:ready` result; other results
clear playback. Neither shared links nor route loads imply Play or enable 3D.

## Timing and optional terrain

At 1× a route traversal is **150 animation seconds** by default, preserving the
Semonzo movie convention. A positive duration may be injected for tests/other
presentations. This is not a ride duration and must not be labeled as one.
At rate `r`, animation distance is elapsed accepted seconds × total metres /
animation duration × `r`, anchored at the last explicit action. Normal frame
partitions agree within floating-point tolerance. Repeated actions/timestamps
are deterministic at each rate; fixed distance/chapter actions are rate
independent. Naturally, the same wall time playing at 4× travels farther than 1×.

The first timestamp after Play only establishes the anchor. To preserve existing
stall semantics, a foreground frame gap ≤500 ms is capped at 150 ms; >500 ms
advances only 1/60 second, with no deferred debt. All consumers use that same
accepted step. Hidden-tab time never reaches this calculation. Backwards or
nonfinite timestamps pause rather than introduce a negative jump.

`enable3D()` is explicit opt-in, pauses and returns a snapshot with a new
`renderer.requestId` token. Capture that token for **every** callback from this
renderer request. Pass it to `setRendererStatus(token, status)`; statuses are
loading/ready/flat/promoting/unavailable. Tokens remain unique across route
switches, clear and retry, so late callbacks cannot affect a new route or attempt.
Current capability transitions pause without moving. Late ready/flat cannot
resume, replay or reset. Do not fetch tiles merely because the controller exists.
`enable3D(false)` pauses and restores profile-only capability; renderer failure
does not make valid route/profile data an error. Future UI must offer this
fallback, bind visibility/reduced-motion changes and expose error reasons.

## Adapter and clock contracts

A trusted loader returns `{identity, distanceM, chapters, positionAt,
estimatedAtDistance?, recordedAtDistance?}`. Identity includes at least the exact
route/revision and should retain the full analysis hash/recipe/annotation binding.
`positionAt(m)` must return that exact numeric `distanceM`; chapters are empty or
unique, ordered, contiguous and cover the whole distance. Outputs must be
structured-cloneable plain data; synchronous projection failure is explicit.
Adapters must be stable for their lifetime, not close over changing scenarios.

- `createAnalysisPlaybackRoute(analysis, {estimate?, recording?})` uses the
  existing immutable analysis and `routeTimeAtDistance`. No resmoothing, physics,
  clock integration or estimate recomputation occurs on frames. Estimates must
  match the **complete identity**, not just the route name. Missing estimates,
  invalid rider input or D4S's documented model-domain failure stay explicitly
  unavailable; they do not prevent route/chapter playback.
- `estimatedRide` is the shared **moving / elapsed including planned stops**
  projection at the distance. At a stop distance it selects **arrival**, just
  like `routeTimeAtDistance`; distance cannot locate a moment inside a pause.
  A time-oriented view continues to use `createRouteClock(result).atSecond(t)`
  (or the existing example `createRideClock(...).atMinute(t)`) as its primary
  timeline. Do not replace these with animation seconds or feed animation rate
  into their models. Time-oriented comparison view integration remains `.15`;
  this controller does not simulate two riders or a recorded replay timeline.
- Optional `recording` is `{identity, atDistance(m)}` bound to the exact analysis.
  It projects already validated **recorded elapsed** facts, never inferred rider
  speed/elapsed. Provider results must explicitly report unavailable or ambiguous
  intervals (e.g. arrival/departure during a pause), not interpolate across gaps.
  Recording parsing, validation and elapsed replay are not implemented here.
  Absent recordings are unavailable, never zero or an estimate.
- `createSemonzoPlaybackRoute(points, profile)` takes the **already verified**
  `loadExampleTrack()` / `loadProfile()` outputs. It preserves raw track
  interpolation and authored chapter starts. Only the last chapter endpoint
  follows the raw total rather than the serialized profile's millimetre-rounded
  total, matching the old flyover. It does not certify arbitrary points as the
  approved example; callers must use the existing pinned loader.
- `createLegacyFlyoverAdapter(controller)` supplies `scrub`, `arrow`, `reset`,
  `toggle`, `tick`, `visibility` and resolved `selection` operations. Its legacy
  `reset` intentionally means **zero + overview + paused**; keep the label
  “Restart at route overview,” not the new position-preserving overview label.
  It owns no clock. Wiring it replaces the old mutable clock, not the existing
  camera rail. The new no-queued-autoplay terrain behavior is intentional.

The example's 70/80% scenarios, Half step stop on arrival, 0/5/15-minute stop
choices and comparison clock clamping remain in their existing modules. Invalid
FTP still cannot block chapter/route navigation. The comparison UI's own
minute selection/reset/rounding is unchanged, not silently mapped to animation
progress. Updating scenario estimates later can reload an adapter with the
explicit current distance and pinned identity; it must remain paused.

## Validation evidence

New tests use fake monotonic time and deferred/rejected promises; no network or
browser service is required. They cover every phase, all four rates, shared
immutable consumer state, normal/stalled time, manipulation, visibility,
reduced motion, route races, failed projection/retry, restoration, terrain
tokens, chapter boundaries, clocks, all seven real approved routes and exact
Semonzo adapter behavior. One test executes the **unchanged** `assets/flyover.js`
in a minimal VM DOM, substituting only its file-load seam in memory, and compares
actual old seek/arrow/reset/play/tick/stall/hidden/replay operations to the adapter.
This is an operation oracle, not a browser/rendering qualification.

Initial focused run: 16 passed, 2 failed because the new test fixture expected
GPX latitude before longitude. Correcting only that fixture to the source
attribute order restored the two actual-source Semonzo tests. No production
behavior or mandatory assertion was removed.

Commands (Node's built-in runner, no new lint configuration):

```sh
node --test tests/route-playback.mjs tests/ride-clock.mjs tests/route-time.mjs tests/route-state.mjs tests/route-analysis.mjs tests/ascent-estimator.mjs
python3 tests/semonzo_chapters.py
node --check js/route-playback.mjs
node --check js/route-playback-adapters.mjs
node --check tests/route-playback.mjs
git diff --check
```

Final combined Node run: **100 passed, 0 failed, 0 skipped**, including the
19 new playback tests. Python Semonzo source tests: **3 passed**. All three
syntax checks, tracked diff whitespace and a separate whitespace scan of the
four new untracked files passed. No runtime entry, release builder, suspended
file, private original or geometry asset is changed. No independent review is
claimed; parent review remains required. Nonprogress recovery used: **0/2**.
