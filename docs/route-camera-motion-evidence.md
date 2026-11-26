# Continuous route camera — 2026-11-26

Scope: `kotr27-1ry.2`; camera presentation only. The rider-first source
controller still traverses a route in 90 seconds. No physics/cockpit changes.

## Scheduling and proof contract

- Both existing controllers publish on RAF. The adapter now presents their
  exact shared distance on every update, preserving profile registration.
  Follow retains broad route-context heading, a wall-time 12°/s shortest-angle
  bound and 45° default pitch; no queued `easeTo` animations.
- Sparse producers can supply `onPresent(snapshot)` for their linked profile
  too. Only then does the adapter interpolate known targets on `positionAt`,
  over the observed 50–250 ms interval. It never extrapolates or integrates
  speed. Dense updates, explicit commands, pause, endpoint, reduced motion and
  gaps flush exactly; hidden/dispose cancel pending presentation.
- Expensive proof runs after render, at most every 200 ms. `data-frame`
  retains **historical** facts with timestamp, geometry identity, distance,
  pose/render/proof sequences and `current`. A later pose/render invalidates
  `current`; `ok` alone is not current-frame evidence. Tests now check freshness.
- Status changes are deduplicated. A sustained failed proof announces verifying
  after 400 ms, but its original outage deadline starts immediately and is
  never extended by movement. Initial gating, 12 s load, 2.5 s outage,
  240 requests, 32-tile cache, 4M pixels, ceil framebuffer allocation and all
  imagery/current-DEM/depth/road/framing predicates remain unchanged.

## Actual live motion

MacBook Pro Mac16,6, Apple M4 Max, 64 GB; native installed headless
Chrome 158.0.8127.88, pinned Mapbox 2.15, DPR 1, live approved public
Mapbox imagery/DEM. Phone means a **375×812 viewport on this Mac**, not
physical-phone performance. Desktop was 1440×900. No concurrent child-owned
browser check ran during timing; pre-existing browsers were untouched.

Command:

```sh
node --test --test-name-pattern='Grappa and Asolo full continuous motion' prototypes/rider-first/terrain-check.mjs
```

Final run passed: four complete normal-speed routes, then actual off-rider
pan/zoom and Return at both sizes. Each timing window spans about 31 seconds.
Samples are changing camera commands and changing centers on actual SDK render
events, not counts of an unrelated RAF. GPU road/depth/registration proof is
recorded separately.

| View / route | Commands / changing renders | Render median / p95 / max (ms) | Minimum proof interval |
|---|---:|---:|---:|
| Desktop Grappa | 1860 / 1859 | 16.7 / 18.8 / 34.2 | 200 ms |
| Desktop Asolo | 1861 / 1860 | 16.7 / 18.6 / 23.5 | 200 ms |
| 375 Grappa | 1861 / 1860 | 16.7 / 18.5 / 21.5 | 200 ms |
| 375 Asolo | 1860 / 1860 | 16.7 / 18.5 / 26.5 | 200 ms |

No 200 ms pose holds, hidden terrain or terminal fallback. Follow pitch stayed
45°. Each route produced only two status text mutations (play/pause), despite
occasional transient failed proofs. Actual timestamp-derived yaw peaked at
12.24°/s using command timestamps, rather than the filter's earlier input
timestamps; deterministic filter tests enforce 12°/s. Maximum profile/presented-distance disagreement was
1.82e-12 m. Rendered rider/center screen registration was within 2 px;
meter diagnostics retained a 0.134 m maximum rather than claiming exact
geographic floating-point equality. All four finishes had fresh valid proof
at the exact endpoint and a rendered camera at the source finish.
Full-route requests peaked at 52/49 desktop and 22/30 phone; manual exploration
raised these only to 53 and 33. These observations are not a universal 60fps
or provider-availability promise.

## Other checks and limitations

`node --test tests/route-flyover.mjs tests/route-playback.mjs tests/route-session.mjs`
passed 35 tests: dense/sparse motion, no drift, frame partition independence,
pause/seek/endpoint, manual/overview, hidden/reduced motion/dispose, fixed
outage deadlines, current proof and prior terrain safety predicates.

`node --test tests/route-flyover-browser.mjs` final full run: **11 passed,
1 explicitly deferred fullscreen check, 0 failed**. Packaged-prefix build,
all-seven controls, trusted manual drag/Return and camera reselection, reduced
motion, background disposal, missing DEM/imagery HTTP failures, actual rendered
foreground-ridge rejection and manual-versus-follow depth semantics passed.
This suite uses real Chrome/Mapbox WebGL with synthetic provider rasters;
it is not substituted for the separate live geographic qualification above.

`node --test --test-name-pattern='live fractional-DPR|native live map retains terminal' prototypes/rider-first/terrain-check.mjs`
passed both checks: live fractional allocations and six follow/manual
provider-error, context-loss and request-budget terminal fallbacks.
The fractional-DPR check was then strengthened to require **current** proof
after every resize and final pause; its focused rerun passed at DPR 1.25/1.5
(including 468.75×1016.25 → 469×1017 framebuffer allocation).
`node --check` on the changed modules/tests and `git diff --check` passed.

The first live attempt failed a newly introduced centimetre center-equality
assertion, not cadence or terrain. It was corrected to the existing visible
2 px registration criterion, retaining the meter measurement. A packaged
manual-ridge assertion initially rejected the added proof metadata; it now
checks unchanged manual predicates **and** identity/freshness metadata. Its
focused rerun passed. Neither correction weakened a mandatory criterion.

Fullscreen remains the existing explicit operator-deferred browser check,
not a product PASS. The previously tracked CDP issues `kotr27-ghf` /
`kotr27-67b` were not reproduced in the packaged run; they are not resolved
or reclassified here.
