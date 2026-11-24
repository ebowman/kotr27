# Linked 2D route briefing · kotr27-800.11

Explore reads the seven-route public pack through Plan's existing checksum and
producer-contract boundary. `createAnalysisStore` shares each pinned analysis
promise; Plan plus Explore read fourteen route payloads, not two sets of seven.
No geometry, public revision, source total or original file is modified.

## What ships

- North-up first-party SVG outline, start/finish coordinates and ordered section
  markers; loops retain distance occurrences, not nearest-coordinate guesses.
- Derived elevation profile with cursor, completed/remaining distance, selected
  coordinates, current/next section and climb, and next sourced POI distance.
- Greatest-gain qualifying continuous climb as an explicitly disclosed proxy
  for “hardest sustained section,” with a direct jump. This is not a physiological
  rating, verified road grade or safety assessment.
- Ordered section buttons with interval, length, gain, average signed grade and
  maximum signed 250 m window grade; geometry-based explanation of each section.
  Raw point gain, source-listed gain and processed gain remain separate.
- Visible phone controls: Play/Pause, previous/next chapter, restart, overview,
  range and numeric distance seek, and separately labeled animation rate.
  Slider arrows move 100 m; Home/End reach endpoints. Profile taps and numbered
  map markers select the same state; list/buttons provide keyboard equivalents.
- No verified facility POIs, provider revision dates or calendar assignments are
  invented. D4S retains extreme processed grades and the shared model's explicit
  unavailable estimate. No clamping or recalibration is applied.

`route-session.mjs` owns the document's single `.10` controller and RAF. Both the
new briefing and legacy Semonzo flyover render its snapshots; the flyover no
longer integrates distance or maintains a separate animation clock. Its existing
camera rail is unchanged. Terrain loading pauses and cannot queue autoplay.
The existing Semonzo clock/sensitivity remain separate time-oriented tools with
unchanged 70/80% and stop semantics. Example profile/track consumers share one
verified GPX document.

Selections are pinned and restored paused. Changing route clears old facts;
late analysis completion cannot select the old route. Continuous seeking
replaces the URL without reconstructing the controls or feeding rounded URL
metres back into the live controller. Finish links are serialized inside the
exact endpoint. Navigation and history still use the existing shell grammar.

The release builder explicitly hashes/rewrites all new transitive modules,
including playback adapters and their existing route-time dependency. No private
originals, device/timing fields, access codes, third-party dependency or map
request is introduced. Organizer 3D/camera choreography remains downstream.
Ordinary browser caching is not an installed offline pack; a first visit still
needs the first-party artifact. Failed verified assets expose unavailable
summaries and leave metadata/route selection usable.

## Validation · 2026-11-24

Node 26.10.0, packaged Chrome, no new dependencies:

```sh
node --test --test-concurrency=1 tests/route-briefing.mjs tests/route-briefing-browser.mjs tests/flyover.mjs tests/climb-sensitivity-browser.mjs tests/release.mjs
# Final focused run: 15 passed, 0 failed/skipped.

node --test --test-concurrency=1 tests/route-analysis.mjs tests/route-pack.mjs tests/route-catalog.mjs tests/route-time.mjs tests/route-playback.mjs tests/route-state.mjs tests/trip-planner.mjs tests/ascent-estimator.mjs tests/ride-clock.mjs tests/climb-sensitivity.mjs tests/rider-controls.mjs
# 138 passed, 0 failed/skipped.

node --test --test-concurrency=1 tests/trip-planner-browser.mjs tests/preferences-browser.mjs tests/rider-preferences.mjs tests/climb-sensitivity-browser.mjs
# Earlier run: 82 passed, 2 failed (duplicate example GPX fetch).
# Fixed by sharing the verified example XML; both sensitivity cases now pass
# in the final 15-test run. All 32 preference browser cases passed, including
# ordered fixture cleanup; all planner/consent cases passed in this run.

node --test --test-concurrency=1 tests/release.mjs tests/release-lifecycle.mjs tests/site-shell.mjs
# 7 passed, 1 failed: existing 375px shell CDP navigation error, detailed below.

python3 tests/semonzo_chapters.py
# 3 passed.
python3 tools/import-routes.py --check
# Seven unchanged revisions; manifest:
# 7f5e6be4133ce03c983e53194e491aa8580638c6f2c8bb5cfb36a768d2709fdc
node --test tests/preload.mjs
# 42 skipped (optional local SDK/terrain inputs absent), NOT passes.
```

New checks cover all seven real routes, synthetic out-and-back/repeated visits,
no POIs, reviewed synthetic POI occurrence/source, missing elevation,
near-finish queries, source uncertainty, camera-independent position, reading
order, one verification per route, stale asynchronous route completions and
failed geometry. Packaged 320/375/1280px journeys exercise actual native
keyboard events, blocked providers, profile/outline/chapter synchronization,
greatest-gain jumps, pinned chapter/finish links, invalid-section recovery,
200% text and no horizontal overflow. No default storage or third-party
requests occur in these journeys.

The legacy VM test now executes the actual shared session scheduler and
flyover against an independent pure controller. The existing camera browser
checks remain: 4×/60 Hz hairpin acceleration 2667.5 → 949.5 m/s², exact marker,
stall handling, terrain clearance, reset/seek/replay, paused fallback and SDK/
GPX failures. Migration exposed a genuine replay camera-anchor ordering bug:
publishing a rate change consumed the reset at the finish. Reset now occurs
after that publication and before replay's zero-distance snapshot.
Terrain tests explicitly require a fresh Play after readiness, rather than
the superseded queued-autoplay behavior. No camera rail/terrain algorithm was
changed. Initial new-test fixture mistakes (reference equality and integer
MouseEvent coordinates) were corrected without changing runtime metrics.

`node --check` passes for all fourteen changed/new JS runtime/test/build files;
`git diff --check` passes. No separate configured lint pipeline exists.
Foreign tracked-diff SHA-256 remains
`2e9888966fe6d6ada8ba0aba143f484d23d2cfa21c62c35df9cbd83540e5c162`;
index remains empty, branch `epic/kotr27-800`, HEAD `1ece2d8`.
No private originals, public geometry, preference authority/storage code,
installer/config/backups or unrelated files were edited.

### Remaining validation blocker / limits

The final broader shell run reproduced **Inspected target navigated or closed**
at `tests/browser.mjs:64`, surfaced by `tests/site-shell.mjs:162` while polling
Prepare navigation from the invalid-revision fixture. Existing diagnostics
captured `Runtime.evaluate`, sent after event 89, followed by
`Page.frameStartedLoading` event 90. The 320/1280px shell cases and both release
lifecycle controls passed; the new 375px official briefing journey also passed.
An earlier combined new-briefing/shell run passed all 11 cases, but is not
evidence that this later error is fixed or unrelated.

This matches the historical error signature tracked separately as `kotr27-ghf`;
causality for this occurrence remains unestablished. It was **not retried,
suppressed or repaired**, and is retained for parent disposition. No overall
independent PASS is claimed. Optional real-engine terrain, live provider,
Safari/physical-device, offline-pack and facility-availability qualification
remain unperformed. The existing optional preload fixture still targets the
old standalone player/queued-terrain behavior; its skips do not qualify the
migrated session.

Fresh independent parent review is required. No discovered bead, Beads write,
staging, commit, close, delegation, push or merge. Nonprogress recovery
allowance remains 0/2; no speculative browser-harness recovery was attempted.
