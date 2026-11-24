# Shared route time and effort · kotr27-800.14

`js/route-time.mjs` adapts the revision-bound
[route-analysis snapshot](route-analysis.md) to the **existing** physics solver
in `js/ascent-estimator.mjs`. It does not import raw tracks, correct elevation,
persist rider values, fetch anything, or estimate from source-listed gain.
Geometry support and physics-domain support are distinct.

## Reusable contract

```js
import { estimateRouteTime, routeTimeAtDistance } from './js/route-time.mjs';
import { createRouteClock } from './js/ride-clock.mjs';

// analysis comes from loadRouteAnalysis with a verified pack and explicit revision.
const result = estimateRouteTime(analysis, {
  scenario: 'steady', riderKg: 75, bikeKitKg: 12, ftpW: 220,
  stops: [{chapterId: analysis.chapters[0].id, seconds: 300}],
});
if (result.status === 'available') {
  const tripSummary = result.total;
  const chapterSummary = result.chapters[0];
  const distanceSeek = routeTimeAtDistance(result, 1000);
  const clock = createRouteClock(result);
  const marker = clock.atSecond(600);
}
```

Default options are `steady`, fictional 75 kg rider, 12 kg bike/kit, 220 W FTP,
and **no stops**. `assumptions.defaultedInputs` identifies each omitted rider
value; explicit `undefined`, strings, invalid containers and unknown keys do
not become defaults. No preferences/storage contract is changed.

An available result is deeply frozen, with:

- `schemaVersion: 1`, `model: route-time-steady-windows-v1`, the analysis
  `identity` (route/revision/hash/recipe/annotation revision), and `distanceM`;
- `elevationBasis: route-distance-windows-250m-v1`, actual `assumptions`,
  including watts, constants, resolved fraction, defaulted inputs and caveats;
- ordered `chapters`: ID, kind, endpoints, `movingSeconds`, `pedalWorkKJ`,
  `stopSeconds`, `elapsedSeconds`, entry `arrivalSeconds`/`departureSeconds`,
  and `cumulative` moving/work/stops/elapsed through that chapter;
- `intervals`: the original processed windows plus explicit stopped intervals,
  with unrounded source-second boundaries and cumulative moving/work prefixes;
- `total`: `movingSeconds`, `pedalWorkKJ`, `stopSeconds`, `elapsedSeconds`.

Trip summaries read `total`, chapter views read `chapters`, distance-based
pace/flyover views use `routeTimeAtDistance`, and the clock consumes those same
intervals. None re-solves physics. Keep this snapshot, not independently
rounded display rows. Cache only by full identity, model, rider inputs,
scenario/fraction and stops. All Day must be resolved on the **whole route**;
do not rerun its heuristic separately for each chapter.

The estimator sums windows inside each chapter, then chapters into totals.
Moving time and pedal work reconcile **exactly** with `estimateEffort` at the
same inputs. Elapsed is cumulative moving plus cumulative stops, not a sum
of independently rounded chapter elapsed figures. IEEE-754 regrouping may
differ in the last bits; preserve this summation order. The analysis's
separately summed distance is checked within `1e-8 m`; exact window/chapter
coverage is still required. This is floating-point tolerance, not GPS accuracy.

`routeTimeAtDistance(result, metres)` returns cumulative metrics and identity.
At a stop distance it selects **arrival**, not an arbitrary time within the
pause. The finish returns exact totals. Invalid/out-of-range queries return
an explicit unavailable state, not a clamped position.

`createRouteClock(result)` returns `status`, `identity`, `finishSeconds` and
`atSecond(n)`. Finite times clamp to `[0, finishSeconds]`; other values return
`null`. Positions interpolate processed distance/elevation, not GPS readings.
Intervals are half-open: arrival is stopped, departure moving; finish and
later are finished. An unavailable estimate yields an unavailable clock.
These adapters accept the model result, not arbitrary serialized timelines.

Stops use `{chapterId, seconds}` at **chapter entry**, including route start.
At most 1,000 unique current-chapter stops; each and their total are bounded
to 0–86,400 finite seconds. Zero adds no pause. No facility, end-of-route,
mid-window, departure timestamp or calendar inference is made. Stops add no
moving time or mechanical pedal work; distance alone cannot locate a pause.

## Scenarios and preserved semantics

| API scenario | Assumption |
|---|---|
| `easy` | Constant 60% FTP |
| `steady` (default) | Constant 75% FTP |
| `hard` | Constant 90% FTP |
| `all-day` | One moving-duration seed at 75%; resolve once using bands below |
| `custom` | Explicit `fraction` in [0.4, 0.9]; no named preset override |

All Day's seed bands are `<2 h:80%`, `2–<3:75%`, `3–<4:70%`, `4–<5:65%`,
`5–<7:60%`, `≥7:55%`, as specified in
[the experience contract](full-site-experience.md#time-scenarios-rider-preferences-and-recorded-replay).
`assumptions.allDay` records seed fraction/time and resolved fraction.
Stops never affect that seed. There is no convergence iteration, hidden
fatigue model or guarantee of sustainability. Discontinuous bands can yield
discontinuous estimates. `allDayFraction(seconds)` returns `null` for invalid
duration. **90% is not universally sustainable. No peak-power inference.**

The legacy `estimateAscent` 60/75 defaults, existing ride-clock 70/80 choices
and sensitivity **70–90%, default 80%** remain unchanged and distinct.
`estimateEffort(profile, {riderKg, bikeKitKg, ftpW, fraction})` is the new
single-fraction low-level entry; it shares profile validation, integration,
and the unchanged `modelWindow` solver with `estimateAscent`. It throws for
invalid inputs, while the route adapter returns explicit unavailable states.

Units/bounds remain rider 20–250 kg, bike/kit 3–60 kg, FTP 30–650 W,
fraction 0.4–0.9, elevations −500–9,000 m, horizontal window run ≥1 m,
absolute signed window grade ≤50%, distance ≤1,000,000 m, ≤10,000 windows
and no more chapters than windows. No coercion, truncation or grade clamping.
Each window uses at most 56 bisections; named/custom estimates make one pass,
All Day at most two. Memory and query scans are bounded by windows plus stops.

The [existing physics](ascent-estimator.md) retains signed descents, reduced
power/coasting at the 45 km/h cap, road length from horizontal run/signed rise,
and fixed still-air/rolling/drivetrain assumptions. It excludes acceleration,
wind, heat, fatigue, traffic and cornering. **Mechanical pedal kJ are not food
calories.** Estimated moving, stop-inclusive, recorded and animation time are
different quantities. No downstream UI or playback controller is changed.

## Unavailable states and the seven current inputs

No supported elevation, incompatible analysis contract, invalid options/stops
or any out-of-domain window yields `status: unavailable`, `model`, `issues`,
and **no partial totals, chapters, intervals or stale/default estimate**.
Model-domain failures retain revision identity. Grade errors report the
first failing zero-based `segmentIndex`, chapter ID, start/end metres, numeric
`value`, `minimum`, `maximum`, and `unit: rise/run` (multiply by 100 for percent).
Nothing is silently flattened, clipped or repaired.

All seven approved inputs are exercised. Six currently support every modeled
chapter/scenario. **D4S, `rwgps-57874050`, is explicitly unavailable** for
physics at revision
`rwgps-57874050-v-4d9c0ac2fe378c343d595efd2cd5c27f268cab47ff7ca34df5210cd29684441a`.
Its current processed windows contain:

| Distance | Chapter | Processed input grade |
|---|---|---|
| 25,500–25,750 m | `chapter-68`, window index 102 | +68.392938% |
| 26,000–26,250 m | `chapter-69`, window index 104 | −57.795718% |

These are **unverified source/model-input discrepancies, not verified real
road grades**. The first is returned as the numeric rejection reason; tests
also retain evidence of the second. Import validity does not establish
physics-domain validity. No claim is made about the cause, and no elevation,
geometry, source/processed gain, analysis recipe or solver bound is changed.
Raw and source totals remain separate from this processed-window model.

## Validation and integration boundary

Focused commands:

```sh
node --test tests/route-time.mjs tests/route-analysis.mjs tests/ascent-estimator.mjs tests/ride-clock.mjs tests/climb-sensitivity.mjs
node --check js/ascent-estimator.mjs
node --check js/ride-clock.mjs
node --check js/route-time.mjs
node --check tests/route-time.mjs
git diff --check -- js/ascent-estimator.mjs js/ride-clock.mjs
```

Final focused run on 2026-11-24: **89 passed, 0 failed, 0 skipped**.
`node --test --test-name-pattern='a stop changes|optional fields map|equal or indistinguishable' tests/rider-controls.mjs`
passed its **3 selected non-browser tests**; `python3 tests/semonzo_chapters.py`
passed **3**. The four syntax checks, scoped diff whitespace check and
new-file trailing-whitespace check passed. No separate lint configuration or
browser/release run is claimed for this task.

The initial test incorrectly required seven available estimates: the run had
85 passes/1 failure at D4S's preserved grade bound. After explicit scope
clarification, the contract test requires six supported results plus D4S's
numeric unavailable state for all four named scenarios, with no partial result.
This corrects the test's assumption, **not physics or data**. Earlier initial
failures also caught overly strict comparison of separately summed analysis
distance and a regrouped test expression for stop departure; both now respect
the documented full-precision summation semantics.

Semonzo results at defaults, 70/80 UI fractions and rider extremes match the
pre-change serialized SHA-256
`808b418ec1fa148e715ebc80b95451bd9bf0a211ba897a72bf8e6e7a549142e1`.
New tests cover flat/climb/descent/coasting, stops, no elevation, parameter
extremes, uphill monotonicity, unsupported input and maximum-size computation.
Existing estimator, clock and sensitivity tests remain unchanged.

The new route-time module has **no runtime entry import** yet. The clock
adapter adds no transitive dependency, so this task does not edit the release
allowlist. UI adoption and allowlisting the new module belong to `.15`; no
deployed seven-route time UI, browser integration or `.8` fixture repair is
claimed here. Independent review remains required.
