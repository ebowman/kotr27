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

## 9. Moving Rider release qualification — kotr27-svk.4

Implementer qualification on `epic/kotr27-svk`, based on
`0bacc1e91ba917b17afc92bcc4fcf03d86cee8af`. **Not independent PASS or publication.**
The fresh reviewer must start with an amateur black-box browser journey on the
retained artifact **before reading this walkthrough or implementation**.

### Artifact and scope

Final retained directory: **`/tmp/kotr27-svk4-release-r3`**, served by the tests
under `/kotr27/`, not the prototype URL. Release:
`39b767274f50dfc62e14a55882f1413e11feb81c80e0427fa91616c9e89e826a`.
The deterministic independent-build audit passed: **76 files, 4,200,381 bytes**,
all seven original route IDs/revisions and geometry hashes unchanged, final-byte
content hashes and transitive imports closed. Explicit allowlist excludes
private imports, original FITs, fixtures, tests, docs and evidence.
Earlier `/tmp/kotr27-svk4-release` and `-r2` are superseded diagnostic artifacts.

One runtime integration fix: continuous Rider geometry now uses the same guarded
current-source DEM sampler already used by rendered-frame verification. It
does not reuse a previous height, substitute GPX elevation, relax depth/road
proof, change provider budgets, or alter the model clock/rate. Entry and seeks
still require the active local viewport, not a cached remote destination.
Test changes exercise this handoff, permit the retained artifact in the home
fixture, and open the intentional Profile → Details disclosure before main-climb
and baseline actions. Playback selection now requires a visible, ≥44 px,
hit-testable control and trusted native change, including **1×**.

### Experience, actual rendering and honest limits

* **Desktop 1440×900 and emulated 375×812:** visible Rider/Aerial and ± controls,
  trusted wheel/keyboard/buttons and phone CDP pinch changed the actual rendered
  camera while playback continued; chosen distance survived follow, pause/resume,
  pan/Return and distant seek. Aerial return retained rate, route and model
  identity/history. No silent “slow down when choosing Rider” behavior.
* **Sustained lower/upper Grappa and Asolo, 1× and 16×:** twelve observed regions,
  **33,804 actual render frames**, no hidden frames or unknown under-camera DEM,
  actual clearance **2.524–7.404 m**, and no disagreement between bounded heading
  and actual SDK heading. Of **2,713 current proof samples**, **2,704** passed
  location/elevation/nearby-road proof. Nine isolated 16× samples rejected road
  ink (one also rejected imagery); subsequent proof recovered, without hiding
  terrain. These are not nine successful proofs, nor continuous pixel-level
  visibility certification. Ground sampling was public for 33,802 frames and
  guarded current-source texels for two.
* **Motion/appearance:** Rider is unmistakably forward rather than helicopter
  framing; the near route line and approaching bends can be followed, with
  hills/valley orientation especially clear on upper Grappa. Satellite pixels
  stretch into coarse sloping surfaces; the road is an overlay, not a reconstructed
  road cut or Street View. Asolo shows the next bend but not road-surface detail.
  At 1× the observed regional maximum yaw rates were about **23–58°/s**; at 16×
  some turns reached **1,440°/s**. Accelerated tight turns are emphatically **not
  a calm normal-speed ride**. Playback is persistently labelled beside Play,
  and native 1× selection is reachable at both widths without opening Setup.
  Normal rate is the useful choice for inspecting a bend; 16× remains a fast
  preview. Independent amateur judgement of usability/information/fun remains
  mandatory, not inferred from these numbers.
* **Continuous integrated aerial journey:** 30-second Grappa observations gave
  1,801/1,800 changing poses (desktop/phone); median **16.7 ms**, p95 **18.6/18.3 ms**,
  max **23.5/20.0 ms**. Zero ≥200 ms holds, hidden frames, model-distance
  mismatches or status churn. Asolo native pan produced verified manual terrain;
  Return restored current Follow proof at unchanged distance while paused.
* **Climb and immediate controls:** at the test climb, paused Hard changed
  165→198 W and 6.4→7.7 km/h; Easier changed 50→57 rpm at the same speed.
  Coast immediately showed 0 W/0 rpm and genuine uphill stall. Elapsed,
  distance and work stayed fixed until Play. The 96 px profile stayed above,
  not over, the cockpit; closed-profile phone road space was 408.8/812 px.
  Native 200% text journeys scrolled to Back/Play/Close without horizontal
  overflow; this is not a promise that all controls fit simultaneously.
* **Privacy/data:** all seven approved variants retain exact identities;
  Brentha Standard's unsupported physics remains explicitly unavailable, not
  normalized into fabricated estimates. First-party 2D and installed offline
  paths remain usable; cold offline/denied storage remain honest. Relive fixtures
  are explicitly synthetic recordings, not a person's ride or measured field
  study. Integrated private import had zero private provider inputs/requests;
  the dedicated transition test separately observed twelve queued **old public**
  viewport tiles after disposal, checked against those bounds. Storage withdrawal,
  Forget, stale grants, private deeplinks and provider-failure paths remain tested.

### Reproduction and correction history

Run from the physical project root. Build to a **new absent** external directory
for reproduction; do not overwrite the retained review artifact.

```sh
node tools/build-release.mjs /tmp/kotr27-svk4-release-r3
KOTR_INTEGRATION_BUILD=/tmp/kotr27-svk4-release-r3 \
RIDE_EXPLORER_EVIDENCE_DIR=/tmp/kotr27-svk4-r3-evidence \
node --test --test-name-pattern='built forward rider|built Asolo Rider DEM handoff|built moving camera|built compact cockpit' tests/rider-home.mjs

node --test tests/route-flyover.mjs
node --test --test-name-pattern='final public artifact' tests/final-qualification.mjs
node --check js/route-terrain-view.mjs
node --check tests/explore-integration.mjs
node --check tests/rider-home.mjs
node --check tests/route-flyover.mjs
```

Final results: **8/8 browser cases**, **25/25 camera/DEM/model cases**,
**1/1 deterministic artifact audit**, syntax checks passed.
Before the camera-only correction, the broad model/release command from §8
(ascent/time/pace/clock/simulation/flyover/playback/analysis/insights/comparison/
recorded/local/controls/release/pack files) passed **195/195**. No physics or
route-data implementation changed; this is baseline evidence, not a claim
that those 195 cases were all rerun after the camera fix.

Final stable-source integrated/legacy command:

```sh
KOTR_INTEGRATION_BUILD=/tmp/kotr27-svk4-release-r3 \
RIDE_EXPLORER_EVIDENCE_DIR=/tmp/kotr27-svk4-r3-legacy-evidence \
RIDE_RELIVE_EVIDENCE_DIR=/tmp/kotr27-svk4-r3-legacy-evidence \
node --test --test-concurrency=1 \
  --test-name-pattern='terrain readiness|integrated packaged|packaged|built baseline|built sections|built 375px|built cockpit|built root|built Relive|built public terrain|built denied|native |manifest binds|opt-in|atomic update|worker termination|delete fences|network withdrawal|homepage withdrawal|first-ever|worker-disabled|preferences fixture|held planner' \
  tests/explore-integration.mjs tests/rider-home.mjs tests/ride-relive-browser.mjs \
  tests/offline-packs.mjs tests/release-lifecycle.mjs tests/local-routes-browser.mjs \
  tests/route-flyover-browser.mjs tests/trip-planner-browser.mjs \
  tests/route-briefing-browser.mjs tests/route-pace-browser.mjs \
  tests/route-comparison-browser.mjs tests/event-guide-browser.mjs \
  tests/preferences-browser.mjs
```

Result: **116 passed, zero failed, one explicitly deferred fullscreen case**
(117 including nested cases). This is a complete green **selected invocation**,
not every test in the repository. The name filter excludes the separately run
sustained Rider/resource diagnostics. Home/integration consumed the retained
artifact; companion fixtures independently built the same stable source.
Real-provider cold WebGL, legacy Grappa/Asolo manual controls, road/depth
negative controls, denied SDK, imagery/DEM HTTP failure and context-loss
fallback completed in this invocation. That establishes availability during
these observations, not a provider uptime guarantee or an explanation for
earlier uninstrumented connection failures.

Failures are retained, not relabelled:

1. Initial integration: **1 pass, 2 fail**, both hit-testing hidden main-climb
   controls. Opening Details and asserting the seek's already-active Follow
   state fixed the obsolete test journey; unchanged native Asolo pan/Return
   remained mandatory. Corrected integration passed **3/3**.
2. Initial sustained camera selection: **6 pass, 1 fail**. At Asolo 14.609–14.651 km,
   26 phone render frames held the camera while model distance advanced; the
   heading equality assertion caught it. This was **not attributed to provider
   connection timeout**. Public-only geometry can return no pose at a DEM
   handoff although guarded current-source texels remain usable. The new
   deterministic unit case demonstrates that null-pose mechanism and preserves
   wrong-source/stale/LOD/upload/expiry fail-closed checks for geometry too.
   The new 35-second Asolo diagnostic crosses the affected region and records
   actual lookup misses/fallbacks without altering returned provider values.
3. An overly broad first correction also admitted cached terrain on distant
   paused seeks. Its focused run passed the Asolo case but failed the existing
   Grappa 80% seek proof (requested and actual cameras differed). Restricting
   fallback to established **continuous playback** preserved relocation. The
   final complete eight-case run passed, including both distant seeks. A new
   synthetic unit fixture initially lacked supported-analysis metadata; that
   fixture was completed, not its assertions relaxed.
4. One broad diagnostic invocation was stopped when its negative name filter
   unexpectedly admitted expensive already-qualified cases; it has **no whole-run
   PASS**. A subsequent explicitly selected run passed **113**, with **one
   operator-deferred fullscreen case**. Earlier inherited legacy invocations
   that each had failures remain failed invocations; passing cases spread across
   them never became a green whole run.

Evidence retained outside the release:
`/tmp/kotr27-svk4-r3-evidence/` contains regional `rider-{1,16}x-{1440,375}-*.json`,
native-control/seek records, current-camera/DEM/depth/road proof and
`*-approach.png`, `*-moving.png`, `*-native-return.png` images.
`asolo-dem-handoff.json` contains the separate actual handoff observation
(2,107 render frames, six public-query misses with guarded fallback available).
`/tmp/kotr27-svk4-r3-legacy-evidence/` contains the integrated/Relive images.
Original failure evidence remains under `/tmp/kotr27-svk4-evidence/` and
`/tmp/kotr27-svk4-r2-evidence/`, not overwritten with successful results.

Environment: Apple M4 Max, macOS, installed isolated headless Chrome
158.0.8127.88, DPR 1. No human study, physical phone, Safari, fullscreen or Pages
publication claimed. Parent owns fresh independent review, scoped commit and
actual public desktop/phone verification after publication.

Final preservation check matched all 298 baseline fingerprints except the five
owned runtime/test/doc paths; the 47 unrelated instruction edits' binary diff,
empty index, HEAD and branch were unchanged. The retained artifact matched an
independent final-source build byte-for-byte (76 files). Scoped `git diff
--check` passed. Own test browsers/servers exited; parent preview 4177 was left
running. No Beads writes, discovered adjacent tasks, commits, merge or push.

### Independent review FAIL: Asolo entry investigation

The subsequent independent review **did not PASS**. Its 16× desktop case failed
entering Rider at Asolo **12,074.07 m** after the Grappa regions: `loading-rider`,
pitch 0°, missing ground/clearance and false proofs ended in the existing bounded
2D fallback. The other seven camera cases, 25 unit cases, artifact audit and
complete selected legacy invocation (116 pass, zero fail, one fullscreen
deferral) passed. This does **not** make the root release qualified. Original
failure evidence is preserved at
`/tmp/kotr27-svk4-review-independent-camera/rider-16x-1440-failure.json` and
`rider-16x-1440-asolo-failed.png`. That run did not capture request/source events,
so a provider failure is **not established** retrospectively.

Correction work first adds bounded, public-only diagnostics to the existing
browser tests: query-free snapshots of source load/active DEM/tiles/upload state,
actual camera and ownership events; original geometry/orbit query results and
their viewport coordinates; sanitized request start/response/finish/failure
timings/status. URL query strings are discarded. No SDK result, height, proof,
clock, rate, deadline or source cache is changed. Extra diagnostic elevation
queries were removed after inspecting the pinned SDK's memoized lookup behavior;
the passive trace observes calls the app already makes, rather than priming it.

The proposed **entry-frustum deadlock is not supported at this exact point**.
In `/tmp/kotr27-svk4-entry-passive/entry-16x-1440-asolo.json`, all 22 missing
geometry-query observations were at the rider center or its forward aim, both
inside the initial viewport and the same z14 tile **8730/5842**. The center is
at least about 340 m from that tile's edges, beyond the 10 m aim and bounded
128 m orbit search. The actual DEM request returned HTTP 200 in **55.7 ms**;
geometry became available after its arrival, and all 20 recorded orbit queries
were finite. No wider framing, stale-height fallback or longer timer was added
on the strength of the unconfirmed hypothesis. This successful trace does not
explain why the reviewer's tile/ground remained unavailable.

The focused ordering matrix uses actual provider response bodies, with selected
metadata, DEM tile or satellite tile arrivals held by 600 ms, plus uncached and
preceding-Grappa-scene controls. Every delayed case asserts that its intended
real response was actually held and still requires unchanged current
location/elevation/road/imagery proof. An early broad Fetch interceptor captured
an obsolete old-Grappa request and produced `Invalid InterceptionId`; that
diagnostic invocation failed (seven pass, two fail including the parent case).
The interceptor now exists only for a delayed case and its explicitly selected
entry resource, not disposed-map traffic; the protocol-error assertion remains.

```sh
KOTR_INTEGRATION_BUILD=/tmp/kotr27-svk4-release-r3 \
RIDE_EXPLORER_EVIDENCE_DIR=/tmp/kotr27-svk4-entry-passive \
node --test --test-name-pattern='built forward rider 16x 1440|built Rider entry ordering' tests/rider-home.mjs
```

Result: **10 passed, zero failed** (eight ordering/history subcases, their parent,
and the full desktop 16× journey). Earlier progressively instrumented desktop
diagnostics also completed, under `/tmp/kotr27-svk4-entry-diagnostic/` and
`/tmp/kotr27-svk4-entry-query-diagnostic/`; these are successful observations,
**not a correction or a retrospective explanation of the independent failure**.
Public runtime bytes still match release
`39b767274f50dfc62e14a55882f1413e11feb81c80e0427fa91616c9e89e826a`.

The full review-order selection was then run with passive diagnostics to test
cross-case request pressure, rather than only isolated desktop entry:

```sh
KOTR_INTEGRATION_BUILD=/tmp/kotr27-svk4-release-r3 \
RIDE_EXPLORER_EVIDENCE_DIR=/tmp/kotr27-svk4-entry-review-order \
node --test --test-name-pattern='built forward rider|built Asolo Rider DEM handoff|built moving camera|built compact cockpit' tests/rider-home.mjs
node --check tests/rider-home.mjs
git --no-pager diff --check -- tests/rider-home.mjs docs/explore-ride-design.md
node tools/build-release.mjs /tmp/kotr27-svk4-entry-observation
```

Result: **8/8 passed**, syntax/diff checks passed. The new observation artifact
matched all **76 r3 files byte-for-byte**, with the same release ID; it is **not
a product correction**. The correction-baseline's 298 fingerprints changed only
for `tests/rider-home.mjs` and this document; runtime, unrelated work, index,
HEAD and branch were preserved.

**State after those diagnostic-only passes:** why the independent failed entry never acquired
its current DEM is still unknown. Neither an application cause nor an external
request failure has been established for that invocation. Do not waive it based
on these green diagnostic runs or call it provider flakiness. The missing
evidence is a failed entry's correlated request completion/failure, active-source
tile/upload state and original query results; the updated test now retains
those under `entry-16x-1440-failure.json` if the refusal recurs. No speculative
runtime change or altered acceptance is justified by the observed healthy
cases. Further disposition/reproduction must retain this blocker and original
failure evidence. Own helpers exited; parent previews 4177/4189 were not changed.

### Controlled scene-acquisition deadline correction

A different, falsifiable policy hypothesis **did reproduce an application
defect**. After aerial proof clears the initial 12-second timer, the old adapter
gave a newly selected Rider source only the **2.5-second established-coverage
budget**. Holding its actual successful DEM metadata response for 3.5 seconds
reproduced `loading-rider`, pitch 0°, missing ground and terminal 2D fallback.
This is not evidence that the historical independent failure had that precise
network timing; that invocation's external cause remains unknown.

Negative control, unchanged retained r3:

```sh
KOTR_INTEGRATION_BUILD=/tmp/kotr27-svk4-release-r3 \
RIDER_ENTRY_CASE=metadata:3500 \
RIDE_EXPLORER_EVIDENCE_DIR=/tmp/kotr27-svk4-entry-deadline-before \
node --test --test-name-pattern='built Rider entry ordering' tests/rider-home.mjs
```

Result: **zero pass, two fail** including the parent case, as expected for this
negative control. The trace records initial load timers cleared by aerial proof,
then a 2,500 ms timer starting at browser time **2,824.1 ms** and firing at
**5,325.0 ms**. The intercepted real HTTP 200 response was held **3,501 ms**.
The map was removed before it could acquire that healthy response. No request
failure or invented DEM was needed to reproduce the defect.

The adapter now starts one **existing `loadMs=12000` acquisition deadline** for
explicit Rider entry or a new forced destination after prior proof. It stays
honestly 2D until first current proof. Render/source/damping retries and repeated
resets at the same destination cannot renew it. Success clears it; mode exit,
replacement and disposal cancel it, and obsolete callbacks are inert. Initial
SDK setup/mode flips before any proof retain the original mount deadline rather
than extending it. Established coverage still gets exactly **`coverageMs=2500`**;
continuous playback does not enter the relocation/hiding path. Geometry,
current-source/upload/expiry checks, rendered road/depth/imagery proof, camera
motion, rate and the single model clock are unchanged.

The final retained artifact is `/tmp/kotr27-svk4-release-r5`, release
`9d39629ec23741cfac34907ac1c121b4e5dbefe7bdf4172f6589cb3c2bebc2c9`
(**76 files, 4,201,762 bytes**). A separate final-source build at
`/tmp/kotr27-svk4-release-r5-verify` matches every byte. Original r3 and all
historical failure evidence remain intact. No tests/docs/evidence/private
fixtures enter the explicit public graph; all seven route revisions remain
identical.

Actual final-artifact delayed-source observations in
`/tmp/kotr27-svk4-r5-evidence/entry-order-{metadata-3500,tile-3500,metadata-13000}.json`:

* Metadata held 3.5 s: one 12 s timer, cleared after **3,730.8 ms**, actual
  current Rider location/elevation/road/imagery proof passed.
* DEM tile held 3.5 s: one 12 s timer, cleared after **3,595.4 ms**, the same
  strict rendered proof passed.
* Metadata held 13 s: the one timer fired after **12,001.0 ms**; zero online
  presentation observations, explicit terminal 2D status, and late HTTP 200
  arrival did not resurrect the map. All three had zero interception errors.

These are real provider bodies held at the response boundary, not substituted
terrain. Reproduce an individual case with `RIDER_ENTRY_CASE=metadata:3500`,
`tile:3500` or `metadata:13000`, the r5 build path and the ordering-test command
above. Bounded test-only timer observations retain actual start/clear/fire
events without changing deadlines or SDK query results.

```sh
node --test tests/route-flyover.mjs
node --test --test-name-pattern='release/offline graph' tests/release.mjs
node --test --test-name-pattern='final public artifact' tests/final-qualification.mjs
node tools/build-release.mjs /tmp/kotr27-svk4-release-r5-verify
```

Results: **28/28** camera/lifecycle unit cases; **1/1** release graph test;
**1/1** independent public-artifact audit. New deterministic real-adapter tests
cover missing DEM to the exact deadline, source/frame nonrenewal, initial SDK
delay, mode flips, explicit seek, stale callbacks and disposal. Existing
continuous-coverage/visibility tests remain green. Those lifecycle fixtures
deliberately have no Rider geometry; they are timer evidence, not claims about
WebGL. The browser cases above supply actual rendered proof.

Final built-candidate browser commands:

```sh
KOTR_INTEGRATION_BUILD=/tmp/kotr27-svk4-release-r5 \
RIDE_EXPLORER_EVIDENCE_DIR=/tmp/kotr27-svk4-r5-evidence \
node --test --test-name-pattern='built Rider entry ordering|built forward rider|built Asolo Rider DEM handoff|built moving camera|built compact cockpit' tests/rider-home.mjs

KOTR_INTEGRATION_BUILD=/tmp/kotr27-svk4-release-r5 \
RIDE_EXPLORER_EVIDENCE_DIR=/tmp/kotr27-svk4-r5-focused-evidence \
RIDE_RELIVE_EVIDENCE_DIR=/tmp/kotr27-svk4-r5-focused-evidence \
node --test --test-concurrency=1 \
  --test-name-pattern='built Rider entry ordering|terrain readiness|integrated packaged|built public terrain' \
  tests/rider-home.mjs tests/explore-integration.mjs tests/ride-relive-browser.mjs
```

The first invocation had **18 pass, two fail** including the ordering parent:
all **eight sustained/native camera/cockpit cases passed**, but a new diagnostic
assertion incorrectly required entry to wait for one specific satellite
refinement. Actual current imagery already passed strict proof after 207.7 ms,
before that 600 ms refinement arrived. Existing rendered-pixel proof permits
real bound parent imagery; waiting for that particular high-resolution tile was
never an acceptance requirement. The timing assertion now applies to the
necessary held DEM, not optional satellite refinement. All location, DEM,
depth, road, imagery, actual-held-response and protocol-error assertions remain.
The failed invocation/evidence are retained, **not called a whole-run PASS**.
One early new unit fixture also requested two proofs at the same fake instant
(three pass, one fail); advancing by the existing 200 ms proof cadence fixed the
fixture, not the proof rules.

The second, corrected invocation passed **16/16, zero failures**: all eleven
entry scenarios plus their parent, readiness observer, desktop/375 integrated
journeys and public→private→public disposal. No runtime change or repeated
long-camera run was needed for that test-only correction.

The eight successful camera cases on the unchanged r5 runtime include the
previously failing **16× desktop Asolo entry after Grappa**, both remote seeks,
native zoom/pinch/keyboard/buttons and aerial return. All twelve regional
observations total **33,764 actual render frames**, **zero hidden or
unknown-ground frames**, zero actual-heading mismatches and **2.524–7.404 m**
clearance. Of **2,705** current proof samples, **2,699** passed: six isolated
road-ink rejections, one also imagery, remained honestly rejected and recovered
within the unchanged coverage budget without hiding terrain. Separate Asolo
handoff evidence has **2,108 frames**, six public-query misses and six guarded
current-texel fallbacks.

Integrated native journeys each observed 1,800 poses, median 16.7 ms spacing,
p95 18.7/18.1 ms, no >200 ms holds, hidden frames, mismatches or status chatter.
Asolo native pan/Return and paused native Playback 1× remained usable; camera
operations did not change rate. Private input/request counts were zero. The
separate disposal case identified twelve queued **old public** viewport requests,
not private geometry leakage. The earlier complete legacy116/model195 results
remain baseline evidence; those whole selections were not rerun after this
timer-only correction.

Visual checks still show forward route ink/turns, visible camera and effort/
climb controls, but coarse/stretched imagery and DEM slopes that do not model
road cuts. Normal 1× regional yaw peaks remain approximately 23–58°/s; default
16× accelerated turns can reach 1,440°/s. No Street View, human study, physical
phone, Safari, fullscreen or Pages publication claim is added.

**Handoff:** the demonstrated premature-entry policy defect is corrected and
the candidate is ready for **fresh independent review**, not declared root PASS.
The precise historical review request timing remains unknown. Review the
retained r5 artifact, not parent server 4189's old r3. Parent owns independent
acceptance, commit and public verification. No adjacent task was discovered;
no Beads writes, commits or publication were performed.

Final syntax/scoped diff checks passed. All 298 recorded file fingerprints
matched except the four correction-owned paths (adapter, its unit/browser tests
and this document); HEAD, branch and empty index were unchanged. Own isolated
browsers/servers exited; only the two parent previews remained running, with
4177 and old-r3 4189 still listening. Retained artifacts/evidence remain available.
