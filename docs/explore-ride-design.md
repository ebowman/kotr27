# Explore the ride — experience contract v1

**2026-11-26 · kotr27-1ry.1 · design, not implemented behavior.**
Scope: one rider-first player for **Explore / Experiment / Relive**, starting
with Monte Grappa, then the seven approved routes. This proposal is authorized
by the current request; it introduces no additional human-design approval gate.
Older `n00` approval/workflows are not dependencies or authority for this epic.

## 1. Evidence and improvement over 2026

Canonical source read directly from **ebowman/kotr26**, then byte-checked against
commit `98cd86dc6443dcf713e125fa2ef53cee629c4339`:

| Verified source | Relevant behavior, not a feature-copy instruction |
|---|---|
| [flyover.html](https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/flyover.html) | Camera buttons, effort presets, progress/ascent/elapsed and uploaded-FIT sensor ribbon. |
| [js/flyover-engine.js](https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/flyover-engine.js) | `animate` advances route fraction by movie duration, not power. `buildElapsedTimeSeries` supplies separate estimated time. `buildTelemetryIndex`/`updateTelemetryHUD` read uploaded sensors; their distance/index-fraction fallback is **not** our recorded-time contract. |
| [js/power-calculator.js](https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/power-calculator.js) | Gravity/rolling/aero model; All Day duration heuristic; speed solver has a 0.5 m/s floor. Do not copy that floor into uphill coasting. |

**Actual browser inspection:** isolated installed headless Chrome, fresh temporary
profile, 1440×900, on
[the live 2026 D3 Long flyover](https://ebowman.github.io/kotr26/flyover.html?route=KOTR_D3_Long.fit).
Play changed distance from 0.0 to 0.1 km during a three-second observation.
Clicking the four modes produced Chase Cam, Bird's Eye, Side View (Auto), and
Cinematic labels. All Day/Steady/Hard showed 110 W/55%, 150 W/75%, and
180 W/90%; Personalize opened 75 kg and 200 W inputs. Course power, cadence,
speed and HR remained `--`: **no simulated sensor observation**. No profile
was saved or private file imported. At 375×812, with personalization still
open, the All Day button's layout began at x≈−8.7 px; that is a specific layout
observation, not a complete phone usability assessment. DOM retained “Loading
route…” and a canvas existed; neither establishes terrain quality or frame rate.
Parent's separate live walkthrough corroborates controls, not measured physics.
The isolated browser was stopped; existing tabs and preview port 4177 were untouched.

Current source baseline: `f11d1372a1ea016e0fd0d03733a2045a41e2ca70`.
[home-entry](../js/home-entry.mjs) loads the
[rider-first app](../prototypes/rider-first/app.mjs), whose `tick` uses
`distanceM / 90000`: a fixed 90-second traverse. Separately,
[terrain update](../js/route-terrain-view.mjs) gates moving poses with
[frameMs:200](../js/route-flyover.mjs), then calls `jumpTo`.
These explain discrete presentation opportunities; this inspection did not
measure current-browser frame performance.

**Parent's independent live baseline (not this implementer's run):** on public
`f11d137`, default 90-second Grappa traversal, 1440×1000 desktop, isolated MCP
page 22, a 12-second observation recorded 721 RAF observations (median interval
16.7 ms, p95 17.6 ms, maximum 23.6 ms), but only 59
`terrain.dataset.camera` command changes (median 200.3 ms, p95 216.9 ms,
maximum 217 ms). Parent reported zero hidden frames, 8.4 km progressed and
21 requests. This separates healthy RAF delivery from stepped camera commands:
the observed stepping is not explained simply by network fallback. RAF cadence
alone does not prove smooth painted terrain. Page 22 remains parent-owned.

**New value:** effort changes actual modeled progress; gearing explains the
cadence/torque tradeoff without free speed; coasting has consequences; sections
explain the next road; a frozen strategy makes tradeoffs visible; private replay
compares a real recording without fabricating missing observations. A smooth
camera and compact cockpit support these jobs, rather than adding a dashboard.

## 2. First compelling journey: Grappa

1. Keep the calm Routes landing and D2 Monte Grappa / Long default, source-listed
   63.2 km / 1,835 m. Distinguish those organizer totals from processed geometry.
   Enter **Explore the ride** explicitly; offer first-party 2D without terrain.
2. Show route overview, elevation silhouette and selectable sections. Offer
   **Try the main climb**: on the current pinned `rwgps-57873019` revision
   `rwgps-57873019-v-34d3d7bbc5683ba77cc17b5c0381b1c5a70a73f5ed17ce410ead468b7dd22751`,
   analysis `chapter-22` spans 10,750–20,500 horizontal metres, approximately
   853 m processed ascent / 8.75% mean grade. These values were obtained from
   `readRoutePack` → `loadRouteAnalysis`, not invented road measurements.
   This is a derived section label, not a verified summit or named road boundary.
3. Seek there **paused**, with Example rider 75 kg / FTP 220 W / bike+kit 12 kg,
   Steady 75% (165 W). The 2027 default is deliberately not 2026's 200 W.
   Pin Steady, then Play at clearly labelled **16× ride time**; 1× remains
   available. No automatic movement or provider entry on landing.
4. On the climb, choose Hard 90%: speed/progress respond and the ghost shows
   the time/work tradeoff. Shift to an easier gear: cadence rises at the same
   power/speed, crank torque falls. Coast: 0 W, no uphill progress, visible
   **Stalled — choose an effort to resume**. Steady recovers without restart.
5. The next-road card names the next derived section, distance to it, its
   processed grade range and ascent. Chapter/profile seek never starts playback.
   Finish the section with modeled elapsed and pedal kJ versus the pinned run;
   offer continue, retry, or full-route overview. No fitness score or victory claim.
6. **Relive a recording** opens the existing private local import flow in the
   same player. Actual source-time replay and explicit planned comparison replace
   simulation controls; unknown samples/gaps remain visible.

## 3. Cockpit and navigation

| Surface | Required hierarchy |
|---|---|
| Desktop 1440×900 | Terrain/outline is the main surface. Top: Back, route/variant, mode, source badge. Bottom: compact speed / power / grade / cadence+gear strip, Play/Pause, effort and Coast, profile/progress. Adjacent small next-section card and optional ghost delta. Sections and assumptions expand on demand. |
| Phone 375×812 | Back and truncated route title on separate, non-overlapping targets. Two-row cockpit: speed/power/grade, then gear/cadence and provenance. Persistent Play/Pause + effort/Coast; profile seek below. Sections, comparison and rider settings in one dismissible sheet, not stacked panels. Gear controls remain directly reachable in Experiment. At least half the viewport remains spatial content with sheets closed. |
| No network / terrain off | Same controls, profile, sections and modeled ride on first-party 2D **if required public assets are loaded or explicitly installed**. Label “2D route outline,” not terrain. Cold offline without assets shows “Route not available offline” and recovery; never an endless spinner or fake map. |

Controls have text/accessibility names, ≥44 CSS px touch targets, visible focus,
keyboard equivalents and non-colour status. No horizontal page scroll at 375 px.
Expanded sheets may scroll; never cover the only Pause/Close control. Announce
state changes, not every telemetry frame. Preserve attribution.

Follow answers “where am I going?”; Overview answers “where is this section?”.
Side is an optional gradient-inspection view under More. Existing Cinematic
may remain secondary; no automatic orbit or requirement to recreate old pitch,
zoom, panic and shortcut inventories. Manual map movement pauses the ride;
**Return to rider** reframes while paused. Reduced motion starts paused and
uses static/reframed camera transitions, never forced cinematic motion.

Overview uses exact analysis chapter IDs/ranges. With 55 Grappa chapters, do
not put 55 chips over the map: a compact list can group contiguous ranges for
display, retaining underlying IDs and expandable detail. No new climb detector.
Next-road insight reads the next chapter and the next 1,000 m of processed
windows (clipped at finish); label grade as processed, not instantaneous GPS.
No surface, weather, traffic, corner safety, facility or fatigue inference.

## 4. One player, explicit state and provenance

Modes: **Explore** reads the selected shared scenario; **Experiment** adds
live effort/gear/coast and a pin; **Relive** reads the recorded adapter.
Mode changes pause. One controller owns selection, cursor and play state;
maps, profile, HUD and comparison consume the same immutable snapshot.

| Action/state | Contract |
|---|---|
| Load/change route | Pause, increment request generation, abort/dispose old view work, clear run and cross-route pin/comparison; reject stale success and failure. Start overview paused. Preserve valid rider inputs in document memory, not old route results. |
| Play / Pause / hidden | Play only with valid selected data. Pause freezes ride time/work; hidden pauses and clears wall-time anchor. Returning requires explicit Play. No catch-up for time away. |
| Effort / gear / Coast | Apply at next simulation-step boundary; record action with simulation time. Effort resumes from a coasting stall. Gear alone does not resume a stall. Separate UI pause from simulated zero-speed stall. |
| Seek/chapter/restart | Pause and reset presentation interpolation. Explore seeks the shared model's arrival time. Experiment starts a clearly labelled new trial at the selected distance, elapsed/work zero; no invented history through skipped road. Restart returns to trial origin. |
| Stop/finish | Planned chapter-entry stops use the existing half-open arrival/departure semantics; no progress/work during a stop. A finish is exact and paused. Seek cannot select a hidden point within a stop. |
| Invalid/missing data | Unavailable with reason, never zero or stale values. Geometry navigation can remain available when physics cannot. Invalid rider input disables estimates until corrected/cleared, not silently defaulted. |
| Terrain failure | Initial valid proof gates display. Once shown, retain it during bounded verification with honest status, then one stable 2D fallback. Failure does not fabricate movement or reset the ride. No automatic retries. |

Every quantity carries provenance: `source-listed`, `processed-route`,
`example-model`, `personal-model`, or `recorded-sample`, plus unit, identity and
availability. “Personal” means supplied inputs, **not an actual ride**.
Show example/defaulted fields explicitly, including bike+kit. Modeled speed,
watts and cadence never appear as actual sensors; HR is only a valid recording
sample. Pedal work is mechanical kJ, not calories. FTP fractions are comparisons,
not sustainable-effort, health or pacing guarantees.

## 5. Shared interfaces and gaps

Existing APIs remain authoritative; proposed names below describe new adapters,
not claims that they already exist.

| Reuse | Interface and required integration |
|---|---|
| [route-analysis-loader](../js/route-analysis-loader.mjs), [route-analysis](../js/route-analysis.mjs) | Hash-verified `loadRouteAnalysis`, `identity`, `windows`, `chapters`, `positionAt`. Preserve geometry, recipes, source/processed totals and IDs. |
| [route-time](../js/route-time.mjs) | `estimateRouteTime(analysis, options)`, `routeTimeAtDistance`. Authoritative steady scenarios, stops, assumptions and unavailable domain; never re-estimate from screen totals. |
| [route-pace](../js/route-pace.mjs) | `createRoutePace().model/snapshot/setScenario/setRider`; reuse validated input ownership/cache keys. Add a document-memory live-control adapter, not another persisted profile. Resolve All Day once on the whole route, not each section. |
| [ascent-estimator](../js/ascent-estimator.mjs) | `estimateEffort` and existing window solver/validation. Extract a shared window-motion primitive without changing legacy positive-power results; add explicitly tested zero-power/stall support for the live adapter. Do not make a second physics engine. |
| [ride-clock](../js/ride-clock.mjs) | `createRouteClock(result).atSecond` drives Explore and baseline positions. New interactive advance traverses the same window solutions and splits steps at window/control/stop boundaries. Existing `createRideClock` example behavior remains intact. |
| [route-playback](../js/route-playback.mjs), [route-session](../js/route-session.mjs) | Reuse immutable snapshot, request-generation, pause/visibility and route lifecycle patterns. Replace the rider-first app's private distance timer; keep legacy geometry-only playback honestly labelled, not called simulation. |
| [recorded-replay](../js/recorded-replay.mjs) | `createRecordedReplay`, `actualAtSample`, `matchRecordedRoute`, `compareRecorded`; no parser or sensor interpolation fork. |
| [local-route-import](../js/local-route-import.mjs) | `importLocalFile`, existing worker, limits, cancellation and explicit storage consent. Retain the existing library/removal/export controls. |

Proposed pure boundary:

```text
createRideSimulation({analysis, rider, scenario, originM, modelVersion})
  command({type: effort|gear|coast, value})   // validated, step-boundary action
  advance(stepSeconds) -> RideSnapshot
  seek(distanceM) / pause() / pinBaseline()

RideSnapshot v1:
  identity, modelVersion, mode, phase, sequence, trialOriginM,
  simulationSeconds, distanceM, position, chapterId,
  speedMps, pedalPowerW, cadenceRpm, gear, pedalWorkKJ,
  motion: moving|planned-stop|stalled|finished,
  assumptions, provenance, unavailableReasons, baseline
```

Controller-owned scheduling wraps this pure core; the core performs no I/O,
RAF, storage or map calls. Recorded mode supplies its own source elapsed,
sample identity/age and signals rather than pretending to be this simulation.

#### Implemented pure boundary (kotr27-1ry.3)

`js/ride-simulation.mjs` now exports `createRideSimulation(options)`,
`createSimulationScheduler(model, {rate:16})`, `rideRiderFromInput(input)`,
`rideSimulationModel`, `simulationStepSeconds` and `exampleDrivetrain`.
The proposed names above are design intent; **no cockpit or ghost UI is added**.

- Options: complete supported `analysis`; optional numeric `rider` with
  `riderKg/bikeKitKg/ftpW`; shared `scenario` (default Steady), custom `fraction`,
  chapter-entry `stops`; `mode:'explore'|'experiment'` (default Experiment);
  `originM` (default 0); example `gear:{frontTeeth,rearTeeth}`; optional exact
  exported `modelVersion`. All Day resolves once on the whole route.
  Invalid options return `status:'unavailable'`, `issues` and
  `unavailableReasons`, without a usable model. Omitted rider fields alone
  use labelled examples. `rideRiderFromInput({mass,enteredUnit,ftp})` reuses
  the existing text validator and returns either `{status:'available',rider}`
  or unavailable; never pass an unavailable result's missing rider as `{}`.
- An available model exposes `snapshot()`, `play()`, `pause()`,
  `advance(seconds)`, `command(action)`, `seek(distanceM)`, `restart()` and
  `exportTrial()`. It starts paused; advance while paused is a no-op.
  Commands are Experiment-only: `{type:'effort',value:0.4..0.9}`,
  `{type:'gear',value:{frontTeeth,rearTeeth}}`, or `{type:'coast'}`.
  They apply at the next advance boundary. Optional `atSeconds` schedules
  a non-past simulation-time action; integration splits there, with stable
  insertion order for ties. Invalid runtime actions throw before mutation.
- Explore uses `createRouteClock` directly; seek chooses shared arrival
  seconds/work. Experiment seek starts a new zero-time/zero-work trial with
  the current applied controls, clearing applied and pending actions.
  Restart resets to that trial's origin and initial controls, also clearing
  actions. Both pause. Instantiate a new model for route/rider/scenario/mode
  changes; do not amend old history. Full route finish is exact and paused.
- Frozen snapshots include route `identity`, full `modelIdentity`,
  `sequence`, `phase`, `motion`, `positionAt` position, horizontal distance,
  simulation seconds, delivered/target crank watts, fractional FTP, gear,
  cadence, crank torque (null at zero rpm), mechanical kJ, units and
  provenance. Processed grade remains visible during a stop. `coast` is an
  explicit control choice; requested positive effort may also deliver zero
  watts at a gravity-only cap, with zero modeled cadence. No HR is generated.
  `remainingSeconds` is available only for steady Explore or at finish,
  otherwise null (no speculative interactive ETA).
- `exportTrial()` freezes model identity (route revision, rider, resolved
  scenario, assumptions and version), origin, initial controls, applied
  action history, capture time and stops. Pending future actions are excluded;
  replay holds the last applied action. A later pin consumer can construct
  the same model/origin/controls and schedule those actions; seek or changed
  model identity must clear its comparison. This task does not implement a
  second replay controller or pin persistence.
- The optional pure scheduler has `play/pause/setRate/frame(timestampMs)`.
  Frame results contain adjacent `previous/current` snapshots, fractional
  `alpha`, `steps`, `rate` and `notice`. It uses 0.02-second steps, ≤750 per
  callback; >250 ms gaps or non-monotonic timestamps pause/discard debt.
  Rate changes pause/rebase. The UI must call pause on hidden/manual movement,
  and explicitly Play on return. External seek/restart/pause rebases by
  sequence. No extrapolation across discontinuities; camera/UI integration
  belongs to the next task.

### Units and gearing: explicit v1 simplification

Use SI internally: horizontal route metres, road speed m/s, seconds, kg, watts,
joules (display kJ), grade rise/run (display percent). For a window with run
`r`, rise `h`, road length `L=hypot(r,h)`, horizontal progress is road speed
times `r/L`; do not integrate road speed directly onto the horizontal axis.

**Quasi-steady**, matching current analysis: no inertia, acceleration, flywheel,
fatigue or braking skill model. Effort changes equilibrium speed at a step
boundary; camera smoothing must not imply a different physical speed.
Reuse current gravity 9.81, air density 1.2, CdA 0.35, rolling coefficient
0.005, efficiency 0.95 and road-speed cap 12.5 m/s (45 km/h). The cap is a
model bound, not a safe descent speed. Show reduced delivered watts at the cap.
Keep current validated rider/FTP/grade bounds and positive-power solver.

Zero-power extension: load `N = mass*g*(h + Crr*r)/L`, drag factor
`D = rho*CdA/2`. If `N >= 0`, coast speed is zero; if `N < 0`, equilibrium
coast speed is `min(cap, sqrt(-N/D))`. No positive minimum speed, negative
progress, infinite ETA, NaN, or infinite-work loop. A stalled run can accrue
elapsed time but no distance/work; remaining arrival time is unavailable until
an effort is chosen. Explicitly label the immediate stop as this model's
no-momentum approximation, not what a real bicycle does.

Example drivetrain: 34/50 tooth rings, cassette
11/13/15/17/19/21/24/28/32/34, wheel circumference 2.105 m; default 34×28.
`cadenceRpm = speedMps * 60 / (circumferenceM * frontTeeth/rearTeeth)` while
pedaling; coast cadence is zero. Crank torque is `powerW / (2π*rpm/60)` when
rpm > 0, otherwise unavailable. Easier/harder controls expose the actual ratio.
At fixed delivered power, gears change cadence/torque, **not speed or work**.
Gear insight is this mechanical tradeoff, not invented fatigue or a hidden
cadence-based power multiplier. These are example equipment assumptions, not
decoded actual gearing.

### Three independent clocks

1. **Simulation/source clock:** one controller consumes monotonic wall-time
   deltas. Fixed 0.02 s simulation steps; rate choices 1/4/16/60× for modeled
   exploration, default 16×, prominently labelled. Keep fractional accumulator.
   A foreground gap >250 ms pauses with a stalled-frame notice, discarding
   unsimulated debt; at ≤250 ms and 60×, at most 750 steps per callback.
   Rate changes pause/rebase, not alter physics. Recorded replay defaults 1×
   and retains existing 0.5/1/2/4× source-time behavior.
2. **Presentation clock:** one RAF renders every available frame, interpolating
   between adjacent simulation snapshots, evaluating `positionAt` on the same
   distance axis. Never extrapolate across seek, pause, route change or gaps.
   Camera may filter heading/pose using wall seconds (e.g. 0.25 s smoothing
   constant, existing 12°/s shortest-angle heading bound); marker/profile share
   one presented distance. HUD may refresh at 100 ms; immediate controls and
   final paused values flush synchronously. No 200 ms pose throttle, queued
   `easeTo` animations or second distance integrator.
3. **Verification/diagnostic clock:** expensive depth/coverage proof at most
   every 200 ms, after render, for that rendered pose/identity/sequence.
   Proof freshness is not animation cadence and proof callbacks never advance
   the rider. Preserve initial proof, 12 s map load / existing outer SDK
   deadline, 2.5 s outage deadline, 240 tile requests, 32-tile cache and
   4-million-pixel bound. Movement cannot extend an outage deadline.
   Reduced diagnostic frequency must not weaken proof predicates or relabel
   stale evidence as current. Keep diagnostics local and free of private data.

## 6. Pinning, replay and privacy

**Pin baseline** freezes full route identity, model version, validated rider
assumptions, trial origin, stops and the current trial's control history.
Beyond the last recorded action, hold its selected effort/gear/coast.
Replay that frozen strategy at the same trial elapsed; do not mutate it when
live controls change. Show both markers and signed distance delta
`liveM − pinnedM`. At a common reached distance, show
`liveArrivalSeconds − pinnedArrivalSeconds` (negative = live arrived sooner).
Do not mix equal-time and equal-distance comparisons. A stalled baseline has
no future arrival estimate. Seek starts a new trial and clears the active pin;
changed rider/model identity invalidates comparison with an explanation.
Pinning itself neither seeks nor saves anything. Explicit Repin replaces it.

Relive uses complete strictly increasing source timestamps, not movie fraction.
Preserve [recorded-replay semantics](recorded-replay.md): exact-sample-only
telemetry; between samples any last coordinate is labelled with sample age;
>30 s/coordinate/segment gaps have no current position or inferred chord.
No smoothing across gaps and no forward-filled sensor values. Sample-step and
elapsed seek stay usable; ambiguous collapsed-distance seeks decline.
Partial/ambiguous route matches cannot become whole-route or time comparisons.
Planned revision and elapsed-versus-distance basis require explicit selection.
Effort/gear controls are disabled for actuals; “Try a modeled alternative”
switches to Experiment without overwriting recording data.

Private imports stay on device, memory-first, with existing opt-in persistence.
No filename, coordinates, timestamp, sensor data or comparison association in
URLs, analytics, provider requests or exports without explicit existing export
action. Private geometry uses first-party surfaces only, never the terrain
provider. Public terrain remains an explicit disclosed entry. No credentials,
permissions, settings, backend or route-wide provider prefetch is introduced.

## 7. Seven-route extension and release checks

Keep the existing display mapping, immutable IDs and variant distinction:

| Display | Route ID | Current steady-model read |
|---|---|---|
| D0 Warm-up · Standard only | `rwgps-57874121` | available |
| D1 Vicentine Hills · Standard | `rwgps-57873183` | available |
| D1 Vicentine Hills · Long | `rwgps-57874024` | available |
| D2 Asolo · Standard | `rwgps-57873112` | available |
| D2 Monte Grappa · Long | `rwgps-57873019` | available |
| D3 Brentha Valley · Standard | `rwgps-57874050` | unavailable |
| D3 Brentha Valley · Long | `rwgps-57874076` | available |

The read-only verified-pack probe on this date reproduced Brentha Standard's
existing rejection: window 102, `chapter-68`, 25,500–25,750 m, processed rise/run
0.6839293801825441 outside ±0.5. See [route-time](route-time.md) for the second
known offending window. These are unverified input discrepancies, **not actual
road-grade claims**. Preserve overview/profile navigation and explain unavailable
physics; do not flatten, clip, borrow another route or claim seven successful
simulations. This is a known capability limit for parent qualification, not
authority for data repair. Asolo must load its own Standard geometry, never a
shortened Grappa. Display days are not verified calendar/departure assignments.

### Evidence required from implementation children

These are prospective checks, **not tests passed by this documentation bead**.

- **Physics:** deterministic flat/climb/descent and zero-power fixtures; positive
  steady motion reconciles with `estimateEffort`/`createRouteClock` using
  numerical tolerances, not claims of GPS accuracy.
  Compare distance in metres and elapsed in seconds separately,
  each within 1e-6; work within 1e-6 kJ. Higher effort increases uncapped climb
  speed; gear-only changes leave speed/work invariant; coast on nonnegative
  load stalls and effort recovers; boundaries/stops/cap/finish remain finite.
- **Clock independence:** identical action log at identical simulation times
  gives equal state under 30/60/120 Hz callback schedules and every playback
  rate. Pause/hidden/stall/seek do not accumulate catch-up or corrupt work.
  Camera mode, proof frequency, provider latency and terrain failure cannot
  change ride results. Run full Grappa climb and all seven navigation cases.
- **Motion evidence:** instrument presentation timestamps, model steps and
  proof sequences separately. On the declared test device, record 30 seconds
  of Follow; target median presentation gap ≤33 ms and p95 ≤50 ms, with no
  periodic 200 ms pose holds. Report actual frame distribution and video/trace,
  not RAF count as proof of smooth imagery. Verify rider/profile registration,
  calm heading and no terrain/outline flashing; distinguish provider failure
  from local rendering. Do not loosen occlusion/coverage gates to hit targets.
- **Real browser:** desktop and 375-phone Grappa journey: entry, main climb,
  pin, effort, gear, stall/recover, sections, manual map/return, hidden/resume,
  finish; then Asolo switch and each remaining variant. Inspect actual usable
  viewports, keyboard/focus, reduced motion, sheet collisions and long titles.
  State values and cockpit must remain readable at 200% text zoom.
- **Replay/privacy/offline:** synthetic recording with gaps and missing sensors,
  course-not-activity rejection, partial/ambiguous match, removal and consent;
  observe network/storage to prove no private transmission. Test terrain denied,
  timed out, offline warm assets, and cold unavailable assets without fake success.
- **Regression/release:** preserve old deep links, secondary tools, explicit
  provider/storage consent, route hashes and source IDs. Runtime additions use
  existing content-addressed build conventions; update only directly dependent
  build/offline/preview allowlists. Qualify packaged-prefix loading and offline
  assets; do not broadly expose repository/private paths or cache terrain.

For this bead only: bounded canonical source/browser inspection and read-only
seven-route model probe completed; no feature implementation, suite, release,
performance qualification or publication is claimed. Parent owns independent
review and lifecycle. No newly discovered bead is needed for the already
documented Brentha limitation.

## 8. Final integration qualification — 2026-11-26, kotr27-1ry.8

**Corrected qualification candidate; fresh independent review still required.**
The first independent review failed the desktop Asolo post-pan readiness wait.
The bounded correction and its remaining causal uncertainty are recorded below;
earlier passing runs do not override that review. The original failures and
exhausted recovery history are retained. Keep this task in progress until fresh
independent PASS; parent publication and public verification remain separate.
Nothing here claims deployment.

### Artifact and preservation

Built from runtime at `27c6000f151da7799b870aa7f319a8f0741200c7`, on
`epic/kotr27-1ry`, using `tools/build-release.mjs`, served only at `/kotr27/`
by isolated ephemeral test servers. Retained artifact:

- `/tmp/kotr27-1ry8-release`
- Offline release: `aed13a4ad9de129216de604881e8c930bd4854588e55251708f7dd225f1514b8`
- Homepage entry: `98f0088d76e5bf8ccf185684`
- 76 files, 4,160,700 bytes; 73 manifest-bound resources.

Independent repeated builds matched byte for byte. The full relative dependency
graph, including dynamic parser/worker references, resolves inside the artifact.
Every hashed filename matches its final bytes; all seven pinned route revisions
remain unchanged. Explicit allowlisting excludes private originals, tests,
documentation, screenshots, development trees and arbitrary extra assets.
All 54 packaged JavaScript/module syntax checks passed.

Only test synchronization, a new acceptance test, and this document were edited;
**no runtime or allowlist change**. Parent preview 4177 needs no refresh for
these edits. User Chrome and parent pages were not used. No dependency install,
Beads write, commit, close, push or deployment was performed.
Fingerprint comparison preserved all 47 unrelated tracked edits and every
other baseline file outside the four edited tracked paths (297-file execution
baseline). The new integration test is the fifth owned path. Index, HEAD and
branch are unchanged. All 91 canonical Beads fingerprints match the parent's
correction baseline, which includes the parent's review-failure note;
`.8` remains assigned to Eric Bowman, `in_progress`.

### What was observed

| Root requirement | Evidence and limits |
|---|---|
| Compelling Grappa climb | Continuous desktop/phone journeys passed main-climb selection, section/profile pointer and keyboard seek, live effort, gear, coast/stall/recovery, separate rate, pinned equal-time gap and common-distance arrival/work, late switchbacks, then Asolo and private Relive/public return. At the measured hard-effort endpoint: 198 W, 8.1 km/h, 53 rpm; about +217 m at equal trial time, −78.1 s arrival and +0.527 kJ at the common reached distance. Existing tests also cover repin/remove/reset. |
| Calm continuous terrain | Pre-review 30-second samples at 1440×900 and 375×812 recorded **1,801 / 1,800 changing rendered poses**. Desktop median/p95/max gaps: **16.7/18.0/21.2 ms**; phone: **16.7/18.0/19.7 ms**. Both had zero ≥200 ms holds, hidden frames, cockpit/map distance mismatches or terrain-status mutations. Real-provider screenshots show actual public switchbacks, rider, ghost and road-ahead information. Corrective-run measurements appear below; none are universal FPS claims. |
| Honest camera failure/manual behavior | The continuous journey passed Asolo native pan, wheel zoom and paused Return at both sizes, plus Grappa's later switchback segment with current proof and 45° Follow. Existing Grappa manual regression also passed. Separate WebGL fixtures passed denied SDK, missing imagery/DEM, context loss and foreground-ridge rejection without weakening clearance. Earlier four full-route Grappa/Asolo traversals from `.2` remain prior evidence, not rerun here; no runtime changed. |
| Phone usability | The integrated closed ghost scene retained **417.59/812 px** spatial height; existing active-ghost terrain case retained 406.91 px and first-party 2D 420.91 px. Existing 200% text tests and the integrated Relive sheet passed actual navigation, seek, Play/sample-step and sheet-close hit targets without horizontal scrolling. Expanded sheets intentionally occupy spatial space. |
| Seven routes and old tools | All seven D0–D3 IDs/variants, existing public deep links, malformed/retired-link recovery, My week/Essentials and secondary briefing/pace/comparison/planner/Prepare/preferences tests passed. Brentha Standard `rwgps-57874050` still has unavailable physics because existing processed windows exceed the ±50% model domain; geometry/profile/sections remain usable. No clipping, route substitution or source rewrite. |
| Private actual replay | Seven focused Relive tests and both continuous journeys passed. Synthetic FIT/GPX exact samples retain source time, sensors and provenance; between samples telemetry is unavailable, not forward-filled. Gaps remain unknown without connecting chords; sample stepping is readable. Modeled alternatives remain distinct. The continuous fixture uses public Grappa coordinates with invented times/sensors, not a real person's recording. |
| Privacy and consent | First-party-only Relive journeys recorded **zero external requests**. The focused public-terrain → private → public test recorded **12 queued public viewport tile requests after disposal**, each checked against prior public bounds, and **zero private provider inputs/requests**. The longer integrated journey had zero queued tiles after its later boundary; do not generalize that to all transitions. Private geometry remains first-party 2D only. Memory-first import, explicit persistence, export/remove, cancellation, stale callbacks and cross-tab Forget passed. |
| Offline and stale entry | Nine offline tests passed installation/disconnected reload, explicit update, retained old complete packs on failures, withdrawal/tombstones, deletion, cold-unavailable and denied-storage behavior. Two lifecycle tests passed after synchronizing completed old-document requests before the positive-control replacement. |

Screenshots are local evidence, **not shipped**:
`/tmp/kotr27-1ry8-evidence/`. Useful inspected examples:
`integrated-1440-grappa-ghost.png`, `integrated-375-grappa-ghost.png`,
`integrated-1440-grappa-profile.png`, `integrated-375-grappa-switchbacks.png`,
`integrated-375-asolo-return.png`, `integrated-375-private-actual.png`,
`integrated-375-text-200.png`, `integrated-375-public-return.png`, and
`baseline-375-text-200-profile.png`. Integrated images were refreshed by passing
complete runs. The older straight-line Relive fixture tests provenance/gaps;
the public Grappa/Asolo and new synthetic-on-public-geometry images provide
meaningful route shapes. No screenshot alone proves motion or privacy.

### Reproduction and actual results

Run from the physical project root. The build destination must not already
exist; use a new temporary destination for a fresh build.

```sh
node tools/build-release.mjs /tmp/kotr27-1ry8-release
node --test tests/ascent-estimator.mjs tests/route-time.mjs tests/route-pace.mjs \
  tests/ride-clock.mjs tests/ride-simulation.mjs tests/route-flyover.mjs \
  tests/route-playback.mjs tests/route-analysis.mjs tests/ride-insights.mjs \
  tests/ride-comparison.mjs tests/recorded-replay.mjs tests/local-routes.mjs \
  tests/route-comparison.mjs tests/rider-controls.mjs tests/release.mjs tests/route-pack.mjs
node --test --test-name-pattern='final public artifact' tests/final-qualification.mjs
```

Results: **183/183**, then **1/1** graph/privacy/deterministic-artifact check.

```sh
RIDE_EXPLORER_EVIDENCE_DIR=/tmp/kotr27-1ry8-evidence \
RIDE_RELIVE_EVIDENCE_DIR=/tmp/kotr27-1ry8-evidence \
node --test --test-concurrency=1 tests/rider-home.mjs tests/ride-relive-browser.mjs \
  tests/offline-packs.mjs tests/release-lifecycle.mjs tests/local-routes-browser.mjs \
  tests/route-flyover-browser.mjs
```

Initial combined result: **56 pass, 2 fail, 1 deferred fullscreen check**.
The failures were an empty export read before download completion and an
unexpected stale CDP continuation during the lifecycle positive control.
Corrections preserve the exact-byte and no-unexpected-protocol-error assertions:
wait for `Browser.downloadProgress: completed`, and wait for old-document
resources to terminate before releasing the deliberate freshness replacement.
Focused reruns passed **7/7 Relive** and **2/2 lifecycle**. The entire combined
coverage was subsequently rerun together with the new integration test below.

```sh
KOTR_INTEGRATION_BUILD=/tmp/kotr27-1ry8-release \
RIDE_EXPLORER_EVIDENCE_DIR=/tmp/kotr27-1ry8-evidence \
node --test --test-concurrency=1 tests/explore-integration.mjs tests/ride-relive-browser.mjs

KOTR_INTEGRATION_BUILD=/tmp/kotr27-1ry8-release \
RIDE_EXPLORER_EVIDENCE_DIR=/tmp/kotr27-1ry8-evidence \
node --test --test-concurrency=1 tests/explore-integration.mjs tests/release-lifecycle.mjs

KOTR_INTEGRATION_BUILD=/tmp/kotr27-1ry8-release \
RIDE_EXPLORER_EVIDENCE_DIR=/tmp/kotr27-1ry8-evidence \
node --test tests/explore-integration.mjs

node --test --test-concurrency=1 tests/trip-planner-browser.mjs \
  tests/route-briefing-browser.mjs tests/route-pace-browser.mjs \
  tests/route-comparison-browser.mjs tests/event-guide-browser.mjs tests/preferences-browser.mjs
node --check tests/explore-integration.mjs
node --check tests/ride-relive-browser.mjs
node --check tests/release-lifecycle.mjs
node --check tests/local-routes-browser.mjs
git --no-pager diff --check
```

Secondary tools: **55/55 passed**. Edited-test syntax and diff checks passed.
During the initial stopped phase, the first two integration commands retained
two failing integration cases while passing their seven Relive/two lifecycle
companions; the standalone integration command also failed both cases. After
the authorized, traced correction, standalone integration passed **2/2**.

Pre-review combined command:

```sh
KOTR_INTEGRATION_BUILD=/tmp/kotr27-1ry8-release \
RIDE_EXPLORER_EVIDENCE_DIR=/tmp/kotr27-1ry8-evidence \
RIDE_RELIVE_EVIDENCE_DIR=/tmp/kotr27-1ry8-evidence \
node --test --test-concurrency=1 tests/explore-integration.mjs tests/rider-home.mjs \
  tests/ride-relive-browser.mjs tests/offline-packs.mjs tests/release-lifecycle.mjs \
  tests/local-routes-browser.mjs tests/route-flyover-browser.mjs
```

Pre-review result: **60 passed, 0 failed, 1 explicitly deferred fullscreen check**
(61 including nested cases). This includes both continuous journeys, all
seven Relive cases, nine offline cases, both lifecycle cases, 22 legacy local
file cases, seven home cases and camera/failure regressions. The final artifact
audit also passed again with the same 76 files and release hash.

The first continuation run of this combined command had **59 pass, 1 fail,
1 deferred**: the legacy keyboard-consent test timed out awaiting “Remembered
on”. It was not reported as passing. A traced isolated run passed, then a
controlled tab return demonstrated that activation alone left Chrome visible
but unfocused and library refresh replaced the previously focused button.
The first controlled probe stopped at that focus gate. Using the existing
terrain fixture's trusted-hover focus technique, then waiting for the actual
library refresh before focusing the current consent button, produced a trusted
Enter/click on a connected button and completed the unchanged save, reload,
stale-save rejection and deletion assertions. The focused command was:

```sh
node --test --test-name-pattern='packaged explicit IndexedDB consent' tests/local-routes-browser.mjs
```

That corrected case and the subsequent complete combined command passed.
This fixes test input synchronization; it does not claim that background
library refresh preserves an old DOM button or certify all focus behavior.

### Root cause, retained recovery history and review handoff

The initial motion observer included deliberate Pause; stopping observation
before Pause resolved that distinct issue. Native selection then stopped
progress. Recovery **2/2 consumed**: (1) opened-select relative arrows still
failed; (2) native type-ahead worked in a minimal isolated control probe but
still failed in the actual page. Work stopped and the parent retained that
history. The operator then explicitly authorized continued diagnosis and
completion; **this did not reset the original 2/2 allowance**.

The requested hypothesis—`pause()` rendering over the newly chosen rate—was
**disproved**. Source inspection found no rate-value write in that render path.
An actual-artifact event/value-write trace of the failing helper showed:

1. Trusted pointer focus on `playback-rate`, value 16, player visible.
2. The helper's trusted Escape reached the app's documented Back handler.
3. Focus moved to `fly`, player hidden; subsequent trusted characters went to
   `fly`. No select input/change event or app rate-value write occurred.

The correction focuses the closed select without clicking then escaping its
native popup. It uses native character input and requires a **trusted change
event on the requested control/value**, preserved visible player, and exact
selected value. No `.value` assignment or synthetic change event substitutes
for this qualification. Primary actions remain actual hit-tested pointer
press/release; profile navigation also uses native keyboard input. This
preserved the original 16-versus-4 assertion and passed both viewports without
changing runtime code.

Subsequent progress exposed two distinct new-fixture errors: a redundant Return
click after seek had already entered Follow, and missing GPX/telemetry
namespaces in the invented recording. The test now asserts current 45° Follow
there (the later real Asolo pan/Return remains mandatory), and validates its
properly namespaced fixture through the unchanged parser before browser import.
Neither correction weakens product assertions. All remaining journey stages,
including actual parser/worker HTTP requests, now pass.

That was the initial implementer handoff, not independent PASS; the subsequent
review and correction below supersede its readiness claim. No discovered bead
was created and no task bookkeeping was changed by the child. All child-owned
test browsers/servers exited; parent preview and browser pages were untouched.

### Independent review: desktop Asolo readiness correction

The fresh review returned **FAIL**: 59 pass, one desktop post-pan timeout,
one deferred fullscreen check. Phone completed; the reviewer also reported
43 model/release, 55 secondary and one artifact check passing. The timeout
contained no final proof/viewport state or failure screenshot. The current
operator authorized this distinct correction; the original **2/2** nonprogress
history remains consumed, not reset.

Diagnostics were added **before** changing the wait: bounded proof-transition
history, final proof/status, visibility/focus, native drag hit targets, map
movement/bounds and sanitized network-failure paths (no token query strings).
Every readiness failure now captures `integrated-WIDTH-terrain-timeout-LABEL.png`
in the selected evidence directory. Observation stops before private import.

One diagnostic desktop run against `/tmp/kotr27-1ry8-review-release` passed
without changing the original 500 ms polling. Both drag endpoints hit the real
canvas; its observed successful post-pan/Return path had valid terrain. The
run did **not reproduce the reviewer's timeout**, and there is no evidence
justifying a claim that the historical failure was a provider outage or an app
defect.

The source and live trace do establish a test weakness: proof is invalidated on
later renders, while expensive verification runs at a separate 200 ms cadence.
The trace recorded both current-valid and stale transitions. A 500 ms poll is
not guaranteed to observe a valid interval. The test now observes mutations and
reports the **same `online && proof.ok && proof.current` predicate at the actual
observation**, with an additional distance-registration assertion. It does not
relabel a previously stale proof, reuse a last-good fallback, retry the provider
or increase the **17-second** deadline. Production terrain, coverage/clearance
predicates, native drag/zoom/Return and fallback assertions are unchanged.

A deterministic test demonstrates a valid proof arriving and being invalidated
between polls; it also rejects failed-current/offline states, reports terminal
failure and verifies cancellation. This establishes the polling weakness, **not
conclusive retrospective causation of the uninstrumented reviewer timeout**.
That uncertainty must remain visible to the next independent reviewer.

```sh
node --test --test-name-pattern='terrain readiness observer' tests/explore-integration.mjs
KOTR_INTEGRATION_BUILD=/tmp/kotr27-1ry8-review-release \
RIDE_EXPLORER_EVIDENCE_DIR=/tmp/kotr27-1ry8-correction-evidence \
node --test tests/explore-integration.mjs

KOTR_INTEGRATION_BUILD=/tmp/kotr27-1ry8-review-release \
RIDE_EXPLORER_EVIDENCE_DIR=/tmp/kotr27-1ry8-correction-evidence \
RIDE_RELIVE_EVIDENCE_DIR=/tmp/kotr27-1ry8-correction-evidence \
node --test --test-concurrency=1 tests/explore-integration.mjs tests/rider-home.mjs \
  tests/ride-relive-browser.mjs tests/offline-packs.mjs tests/release-lifecycle.mjs \
  tests/local-routes-browser.mjs tests/route-flyover-browser.mjs
```

Focused results: **1/1 observer regression; 3/3 including both complete native
journeys**. Both observed manual proofs had imagery/elevation/depth/current/ok
true; Return restored current Follow proof at unchanged distance while paused.
Corrective combined result: **61 passed, 0 failed, 1 deferred fullscreen check**
(62 including nested cases). This is implementer evidence for fresh review,
not an override of the prior independent FAIL.
The corrective combined journey samples each recorded **1,800 changing poses**
in 30 seconds; desktop median/p95/max **16.7/17.9/21.0 ms**, phone
**16.6/18.4/20.6 ms**, with zero ≥200 ms holds, hidden frames, mismatches or
status changes. The artifact audit passed again: same 76 files, bytes and hash.
New screenshots are under `/tmp/kotr27-1ry8-correction-evidence`; original review
evidence was not overwritten. No production/allowlist bytes changed, so parent
preview 4177 needs no refresh.

Environment: **Apple M4 Max**, installed headless **Chrome 158.0.8127.88**, macOS, desktop and
emulated 375 px phone at DPR 1—not physical-phone, Safari or fullscreen
qualification. Fullscreen remains explicitly deferred; existing Safari/CDP
diagnostics are not newly certified. No source sensor, road-condition, safety,
fatigue or pacing guarantees follow from modeled speed/work. Parent must assess
root experience criteria independently and verify actual public homepage and
Explore interactions **after** any authorized publication.
