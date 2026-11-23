# Reading the ascent estimate

`estimateAscent(profile, options = {})` in `js/ascent-estimator.mjs` is a
synchronous ES module with no storage, network or UI dependencies. Pass the
[v1 chapter dataset](semonzo-chapters.md) directly. With no options this is a
fictional 75 kg rider carrying 12 kg of bike and kit, with a 220 W FTP. The
slower scenario assumes a steady 60% of FTP (132 W); the faster assumes 75%
(165 W). These are illustrative sustained efforts, not a training prescription
or threshold power held until the summit.

Pass a plain options object. Its only supported fields are `riderKg` [20,250],
`bikeKitKg` [3,60], `ftpW` [30,650], and `slowerFraction` and `fasterFraction`
[0.4,0.9] (inclusive, with slower strictly below faster). Omit the argument
or pass `{}` for the example; omit individual fields to keep their defaults.
Every supplied field must be a finite number, not a string or `undefined`.
Unknown keys, including `targetFraction` and nested overrides, throw.

For example, `estimateAscent(profile, { ftpW: 240, slowerFraction: 0.65, fasterFraction: 0.8 })`
compares two steady plans for the same rider: 156 W in `total.slower` versus
192 W in `total.faster`. Each fraction applies to every chapter; there is no
per-chapter pacing option. To compare different assumptions, call again
with the changed fields and keep the other inputs fixed.

These limits describe the model domain, not judgments about riders. Unsupported
values or malformed profiles throw (no coercion or partial result). Use the
smoothed windows, not individual noisy GPX samples. Preserve ordinary dips;
reject discontinuous windows, runs under 1 m and absolute window grades over
50% rather than silently inventing terrain.

Output `schemaVersion: 1` includes `assumptions` (actual masses, FTP, fractions,
target watts and physics constants), `chapters` in input order keyed by `id`,
and `total`. Each chapter and the total carry `slower` and `faster` records:
`movingSeconds` and `pedalWorkKJ`. Read the time bracket **faster to slower**;
keep each work figure paired with its scenario. It is not a confidence
interval. Work means mechanical energy delivered at the pedals, not food
calories. Totals sum unrounded chapter values; round only for display.

Each chapter's `windows` retain its segments' distance and elevation endpoints
in metres and the two unrounded solver records (`slower`, `faster`). The pure
`createRideClock(state, paceB, stopMinutes = 0)` in `js/ride-clock.mjs` uses
these records from one `riderScenario`. Rebuild it when inputs change. Its
`atMinute(n)` clamps a finite shared minute to `[0, maxMinute]` and returns
`{minute, a, b}`. Each marker has `chapterId`, `distanceM`, `elevationM` and
`status` (`moving`, `stopped` or `finished`). Positions interpolate on the
smoothed window, not live GPS. Plan A uses `state.effort`; Plan B accepts
either effort and a 0, 5 or 15 minute stop. A nonzero stop holds at entry to
Half step, including arrival but excluding departure. A marker stays at the
summit from its own finish minute onward (`finishMinuteA` or `finishMinuteB`).
Invalid rider states, unsupported plan choices and invalid minute queries
return `null`, not the last valid result.

**Try the rider controls locally.** Serve the checkout over loopback and open
`/explore.html`, or follow “Explore the example ascent” from the flyover.
The companion derives its windows in memory from the same GPX as the flyover.
The committed JSON is a local regression reference, not a release asset;
see the [profile's redistribution note](semonzo-chapters.md).

`riderScenario(profile, { mass, enteredUnit, ftp, effort })` accepts the
original mass and FTP text (`''` means omitted), `kg` or `lb`, and `slower`
or `faster`. Both efforts use the same estimator call with illustrative
fractions 0.70 and 0.80. Consumers select `estimate.total[effort]`.
Valid states carry `kind` (`example`, `partial`, `personal`), `supplied`
flags, `estimate` and `effort`. An `invalid` state carries only `kind` and
field `errors`, never a stale or default estimate. Unit changes convert
the display, not the original entry. Clear resets both inputs and effort.
Run `node --test tests/rider-controls.mjs` to exercise the contract and UI.

## Weight × FTP sensitivity panel

The explorer's sensitivity panel holds sustained effort at **80% FTP by
default**, adjustable from **70–90%**. This is independent of ride-clock
pace and stop settings. FTP alone does not specify duration-specific peak
capacity: neither this fraction nor the resulting time estimates peak power.
Bike and kit stay fixed at **12 kg**, separate from rider weight. Gravity
uses their combined system mass; route, effort, rolling resistance, still-air
drag and drivetrain assumptions stay fixed across comparisons.

The displayed FTP axis spans baseline ±100 W, clipped to [30,650] W; rider
weight spans baseline ±20 kg, clipped to [20,250] kg. Each axis uses nine
uniform samples plus the exact baseline (deduplicated), at most ten samples
per axis and 100 grid points. These are display ranges, not recommended
changes. Pounds change the display only; the model uses the original
unrounded kg equivalent. The fictional/partly assumed/personal baseline
comes from the existing rider inputs; chart selection never overwrites it.

Surface and heatmap share the same exact solver samples and color scale.
The surface joins samples into interpolated visual patches, not additional
solver results; heatmap cells color the sampled values. Selected numeric
readouts and all four comparisons are exact `estimateAscent` results, never
interpolated times: baseline, selected weight with baseline FTP, selected
FTP with baseline weight, and both selected values. The combined result is
evaluated independently, not the sum of isolated savings.

Changes are signed **selected scenario minus baseline**, in minutes and
as a percentage of unrounded baseline seconds: negative is faster, positive
slower, exactly zero unchanged. Comparison cards round only for display;
nonzero differences below 0.01 retain their sign and faster/slower label.
FTP W/kg divides by rider mass, excluding kit. It explains a ratio, not the
whole model: system mass, rolling resistance and aerodynamic drag also matter.
Which change matters more depends on this route, baseline and change size.

This provisional ascent illustrates steady moving time, not advice, a training
or weight prescription, guaranteed performance or an event prediction.
Fatigue, wind, heat and stops are not modeled. Entries are neither persisted
nor transmitted. The released panel uses local hashed modules and the existing
runtime GPX profile, with no external plotting service or shipped chapter JSON.
Run `node --test tests/climb-sensitivity.mjs`,
`node --test tests/climb-sensitivity-browser.mjs` and
`node --test tests/release.mjs` for model, source UI and packaged checks.

**Model.** On each window the road length is the hypotenuse of horizontal run
and signed rise. For road speed *v*, wheel power is
`mass × g × (rise + Crr × run) / roadLength × v + ½ × rho × CdA × v³`.
Solve for constant speed at 95% of target pedal watts, up to an illustrative
45 km/h ceiling. At the ceiling use only the watts needed; coast/brake with
zero pedal work if gravity suffices. Time is road length / speed; pedal work
is actual pedal watts × seconds / 1000. No acceleration, changes of position,
wind or stops. Wind, heat, fatigue, cornering and stops can all change the
actual time. This is a provisional example ascent, not an event prediction.

**Prior-art audit.** KOTR26 `js/power-calculator.js` at `9b2e9e0`
(`calculatePowerForSpeed`, `calculateSpeedForPower`, `calculateRouteMetrics`)
uses total mass, signed grade angle, rolling force, cubic still-air drag and
drivetrain loss. Retain its g=9.81 m/s², Crr=0.005, rho=1.2 kg/m³ and
CdA=0.35 m². Count kit as well as the bike. Instead of its Newton iteration
and special low-power descent approximation, bracket the positive-power
crossing and account for reduced power at the cap. Use chapter windows
instead of raw point grades; do not inherit rounded route durations,
difficulty scoring or calorie conversion.
