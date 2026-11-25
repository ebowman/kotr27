# Private recorded replay · kotr27-800.17

Explore's native GPX/FIT library now opens recordings with complete timestamps
in **Recorded ride replay**. Routes/courses still use geometry animation.
The decoder and library/storage authority from `.16` are unchanged. No private
originals were used for development: tests use invented sensors/times, synthetic
geometry and already-approved public geometry. No backend, network decoder,
GPS permission, sharing, race ranking or medical interpretation is added.

## Actuals and clocks

`recorded-replay.mjs` consumes `decoded.samples` and `decoded.points` separately.
It never reparses a file or replaces missing data with physics. Samples must
all have finite, strictly increasing timestamps; otherwise recorded replay is
explicitly unavailable, while supported geometry remains readable. FIT course
timestamps do not make a course an activity. GPX namespace/time restrictions,
FIT compressed timestamp/developer-field rejection and the importer envelope
remain exactly as documented in [local import](local-route-import.md).

Available actuals carry decoded-file format, sample timestamp, value and unit:

| Signal | Valid decoded values | Unit |
|---|---|---|
| Power | finite 0–65,534 | W |
| Cadence | finite 0–254 | rpm |
| Speed | finite 0–200 | m/s |
| Heart rate | finite 1–254 | bpm |

These are encoding/validity bounds, **not physiological validation**. Null,
absent, nonfinite, out-of-range or untimestamped signals are unavailable.
Zero power/cadence/speed is meaningful; zero heart rate is unavailable.
Actual telemetry is shown **only at an exact sample timestamp**, never held,
interpolated or backfilled. Previous/next sample and keyboard-arrow seek make
the exact readings accessible even during sparse recordings.

Elapsed = selected source timestamp minus the first source timestamp.
Between samples, the last coordinate can be shown with its **sample age**;
it is never called an interpolated current GPS observation. In a timestamp
gap (>30 s), coordinate gap, segment break or >500 m spatial edge, position is
unavailable between samples. Timestamped coordinate-less FIT signals remain
readable. Raw elevation is not repaired or interpolated. The profile uses
individual sample dots, with missing heights absent.

Moving/paused are **speed-qualified interval summaries**, not device timer
totals: both endpoint speeds >0 means moving; both zero means paused; a
transition/missing speed means unknown. Gap intervals are unknown regardless
of speed. The three prefixes reconcile to selected elapsed. FIT timer breaks
remain gaps; no unimplemented timer-event clock is invented. These summaries
do not certify continuous movement between endpoint measurements.

The existing document-wide `route-session` / `.10` controller remains the
only RAF/position owner. An optional `recordedReplay` adapter supplies source
duration, `atSecond` and first-arrival `secondAtDistance`. The controller
exposes `seekRecordedSeconds`, uses timestamp seconds at 1× (not total
distance / 150 animation seconds), and advances distance only to the selected
sample's supported geometry distance. Pauses can advance recorded time while
distance stays unchanged. Source elapsed, position, telemetry and totals are
installed atomically. Replacement preserves the source-time selection.
Same-recording/revision view/area navigation and same-document Back/Forward
pause without reselecting by distance, retaining exact elapsed even inside a
stationary pause or between samples. No elapsed cache is transferred to a
different recording; a fresh recording/link load starts at source time zero.
Hidden-tab/stall policy, Play/Pause, restart, overview and 0.5/1/2/4× controls
remain shared. Rates change presentation, never timestamps or actual power.

Continuous recordings reuse `.11` analysis chapters and its first-party
outline projection; chapter selection seeks first recorded arrival. The
recorded view links raw profile, outline and textual position to the same
snapshot and distance. It deliberately does not render a derived elevation
as an actual observation. Unsupported continuous analysis (including pauses,
missing elevation or disconnected runs) does not block timestamp replay.
Distance is a **supported sample-edge geometry subtotal**, not an actual
traveled-distance total or device odometer. An edge contributes only when
consecutive timestamped samples have consecutive geometry points, no segment
break, separation ≤500 m and timestamp interval ≤30 s. The interval classifier
and distance accumulation share that same gap decision: a 61-second gap adds
no endpoint chord. The outline also breaks at that edge. Inside a gap the last
supported subtotal remains visible as such, but current position/distance and
planned comparison are unavailable. At the next exact sample, that coordinate
is valid without adding the omitted chord to the subtotal.

Collapsed gap endpoints share a subtotal but need not share a location.
`secondAtDistance` returns `null` at those subtotals; an explicit distance seek
pauses without moving the cursor and exposes `seekNotice` directing the user
to elapsed/sample seek. Ordinary stationary pauses retain first-arrival
distance semantics. Source-time restart still goes to zero, including when a
gap begins there. Recordings with gap intervals have no continuous-analysis
chapter-distance controls: those chapters use the geometry-only axis and
cannot be relabeled onto this shorter subtotal. This does not disable replay
or the independently matched planned-route distance axis.

Both visible recording outlines—the replay map and missing-elevation/
unsupported-analysis overview—consume the **same `supportedPointEdges` set**
from that recording's replay model. They do not reconstruct time thresholds
or confuse sample indices with geometry indices after coordinate-less FIT
samples. Non-recording route outlines retain their geometry-only rules. If a
recording has no complete timestamp model, the fallback overview explicitly
declines instead of drawing a falsely continuous recording across unknown gaps.

## Explicit planned comparison

The disclosure starts with **no plan and no basis**. Choose an exact public
organizer revision, recorded-elapsed or matched-distance basis, and acknowledge
that choice. Any changed revision/basis clears the comparison and acknowledgment.
This association is user intent, not provenance inferred from a recording.
Source, revision and basis remain in visible text. No private selection,
filename, telemetry, coordinates, timestamp or plan association enters a URL
or preferences. The existing opaque local ID remains nonportable.

Matching uses a bounded segment grid in a local equirectangular projection:

- 30 m candidate corridor; candidates spanning >100 m of planned distance
  decline as multiple occurrences, rather than choosing the nearest branch.
- Conflicting segment directions (cosine <0.5) at candidates >20 m apart
  also decline. This intentionally rejects some bends/hairpins and short
  out-and-backs rather than manufacture precise alignment.
- Accepted route distance is monotonic. Backward movement >1 m declines;
  up to 1 m projection jitter retains the prior distance. Forward jumps
  >max(100 m, twice recorded edge length) cannot create aligned segments.
- Only consecutive matched edges form aligned segments. Isolated hits,
  timestamp gaps, missing times, breaks and spatial edges >500 m do not.
  Off-route/ambiguous ranges and aligned point/distance ranges are reported
  separately; UI range lists explicitly show only the first 100 of each.
- A partial overlap is **only those segments**, never whole-route coverage.
  Closed loops, reversals, intersections, detours and proximity ambiguity can
  conservatively decline. No heading/speed hypothesis selects a hidden lap.

These are display matching thresholds, **not safety or navigation guidance**.
“Conservative corridor + unique occurrence + monotonic sequence” describes
confidence, not exact GPS truth.

**Matched distance** shows the recorded sample position and the corresponding
position on the exact planned revision, including spatial separation. If the
recording begins within 30 m of an unambiguous planned start and a model exists,
it additionally shows recorded elapsed minus modeled arrival time. Arrival
does not identify time inside a planned stop. A partial-start recording gets
no invented time offset.

**Recorded elapsed** uses `.14/.15`'s existing scenario result and
`createRouteClock` to position the plan at the same elapsed second from route
start; it requires unambiguous matched recording start within 30 m. It does not
silently shift a partial ride to minute zero at some later route position.
Off-route/ambiguous selected samples decline deltas. Modeled assumptions are
separate from actual telemetry; Hard/90% is not actual power or a sustainability
claim. Whole-model failures (notably D4S's existing grade domain) disable
temporal comparison only; actual replay and matched-distance comparison still
work. The core also rejects a modeled snapshot with a different full identity.

## Bounds and lifecycle

Maximum 50,000 samples, 20,000 recorded and 20,000 planned geometry points.
Replay prefix construction is linear and frame/sample queries use binary
search. Matching uses 100 m grid cells, at most 200,000 segment-cell entries
and 300,000 candidate tests, then explicitly declines on exhaustion (no
partial result). Planned edges >500 m, latitude beyond ±80° or route extent
beyond ±5° of its start are unsupported. No 20k×8k all-pairs scan or unbounded
search/backtracking. Matcher runs synchronously within this fixed envelope;
it has no additional worker, fetch or asynchronous result to resurrect data.
Tests exercise the 20k×8k and dense-loop bounds.

Everything is document memory owned by the existing library. Per-file delete,
delete-all, global Preferences Forget, stale-tab authority and uncertain-save
discard remove replay factories, views/closures and shared-controller state.
The reviewed `.16` storage transactions/fences are untouched. No new storage,
permission or cross-tab message payload exists. Official catalog/assets are
not modified. Local replay always uses first-party SVG; neither an old local
flyover link nor comparison activates remote terrain.

## Validation boundary

Tests cover actual provenance/units, invalid/missing signals, stationary
pauses, gaps, missing timestamps, coordinate-less FIT, decoder reuse,
single-controller time/rate semantics, exact model identity, both bases,
out-and-back/reversal/detour/partial fixtures, bounds and isolation.
Packaged Chrome tests use native file input at 375 px, keyboard sample seek,
actual sample values, explicit plan/basis/ACK, changed-choice revocation,
public D1/D4S partial overlap, D4S model unavailability, synchronized
map/profile/text, unchanged official catalog, deletion and no requests during
import/replay/matching. Existing adverse save, peer deletion and global Forget
tests run against the extended artifact too.

Final validation (2026-11-25):

```sh
node --test tests/recorded-replay.mjs tests/route-playback.mjs tests/local-routes.mjs tests/route-time.mjs tests/route-pace.mjs tests/route-briefing.mjs tests/ride-clock.mjs tests/route-state.mjs tests/rider-preferences.mjs
# 119 passed, 0 failed, 0 skipped

node --test tests/local-routes-browser.mjs tests/release.mjs tests/route-briefing-browser.mjs tests/route-pace-browser.mjs tests/site-shell.mjs
# 37 passed, 0 failed, 0 skipped; actual allowlisted /kotr27/ artifact

for p in js/recorded-replay.mjs js/recorded-replay-view.mjs js/route-playback.mjs js/site-shell.mjs js/local-routes-view.mjs tests/recorded-replay.mjs tests/local-routes-browser.mjs tests/release.mjs tools/build-release.mjs; do node --check "$p" || exit 1; done
git diff --check
# Both passed; no separate configured lint runner
```

Intermediate validation caught release hash-expectation omissions and a test
that incorrectly expected no database after an explicit delete created its
tombstone. A subsequent test insertion landed inside a browser-evaluation
template and failed syntax checking; it was relocated before the final run.
All are corrected in the final evidence above; no failed run is counted as a
pass or mandatory assertion removed.

First independent review found two acceptance blockers despite those initial
tests: same-recording navigation reconstructed elapsed from distance, and the
distance axis still included timestamp-gap chords. The corrective pass keeps
the current shared source cursor for same-recording navigation, and accumulates
distance from the same supported sample intervals used by gap classification.
New native 375px regressions preserve 3 s / 103 W and between-sample 3.5 s
through view/area/history navigation, pause on leaving Play, preserve intentional
seek/restart, and start a different recording at zero. The `[0,1,62,63,64,65]`
fixture now excludes the 61-second-gap chord, splits its outline, declines
collapsed-distance seeking and inside-gap comparison, and has no invalid
geometry-only chapter binding. Unit tests additionally cover the exact
29.999/30/30.001-second threshold and a gap at source start. The final commands
above passed in the corrective pass without retries. Fresh review is still
required; nonprogress recovery allowance remains 0/2 consumed.

Second independent review passed both original corrections but found the
simultaneously visible missing-elevation fallback still joined timestamp gaps.
The next correction passes the existing replay model into the local-library
view, with exact local identity checks, and makes both recording renderers use
its supported point-edge set exclusively. A native 375px regression now checks
identical vertices and runs in both outlines for continuous no-elevation GPX,
the 61-second-gap GPX, a spatial gap, and FIT whose coordinate-less sample shifts
sample versus geometry indices. Incomplete timestamp models explicitly decline
the fallback. The full final runs above passed again without retries; prior
navigation/distance fixes, deletion/Forget fences and matching bounds remain
unchanged. Fresh independent review is still required.

No native Safari, real-device GPS accuracy, broad screen-reader qualification
or independent PASS is claimed. Parent fresh review remains required.
