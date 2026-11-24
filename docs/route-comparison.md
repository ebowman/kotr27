# Linked comparison, skyline and radial · kotr27-800.9

Plan's existing itinerary and downloads precede a secondary comparison workspace.
Explore has Compare variants / Skyline / Radial links alongside Route briefing.
Comparison candidates are **not itinerary choices**. The active route, revision,
chapter and distance use the existing shell URL and single playback session;
opening a briefing preserves the exact occurrence, including arbitrary positions
and a millimetre-safe finish link. No camera, effort or pace model is added.

## 2026 parity and honest scales

| Experience contract row | Equivalent |
|---|---|
| P07 Compare variants | Candidate checkboxes, horizontal distance, derived ascent/descent, elevation ranges, separately labeled raw/source gains, north-up outlines, Long minus Short deltas |
| P08 Skyline | Stacked linear profiles with identical distance and elevation domains; hiding candidates never rescales the remaining panels |
| P09 Radial / POIs / rotation | Clockwise progress and shared-elevation radius, section markers, reviewed-POI markers/list, ±30° buttons, reset and drag-on-release; no inertia |

Equal-distance profiles use a common kilometre domain. Normalized Compare
profiles use 0–100% **per route**, explicitly not equal road distance. Skyline
always uses equal distance. Radial angle is normalized progress, **not geography
or road kilometres**; radius uses the same elevation domain as linear profiles.
Every view states its numeric domains. Domains include all available comparison
routes, even candidates currently hidden. Outline panels are individually fitted
using the briefing's projection and explicitly **not a common map scale**.

Radial labels are spaced to avoid overlapping pointer targets; omitted numbers
do not remove chapters. Every chapter and source-qualified POI remains in the
ordered text alternative. Every plotted elevation endpoint is also available
in a distance/elevation table. The linear profile remains visible in Radial;
text details open by default on small screens and precede the visual forms.
Native buttons/links provide keyboard alternatives to pointer markers/rotation.

Metrics come from the document's shared `createAnalysisStore`, not another
geometry/physics engine. Rows check exact route/revision/geometry identity.
Long minus Short subtracts unrounded metrics from the same supported recipe
and source day group. S is the source Short variant, used as the standard
comparison baseline, not a new organizer classification. Missing, mismatched,
withdrawn or unsupported profiles expose unavailable states, never zeros,
substitute geometry, mixed metric bases or arbitrary difficulty ratings.

The seven current routes have **no verified facility POIs**. Empty lists mean
unknown facilities, not no stops needed. Synthetic reviewed-POI tests exercise
source/confidence and occurrence-bound links without publishing invented POIs.
D1–D4 remain source groups, not calendar departures. D4S source extremes remain
visible and explicitly unverified; no grade correction or numerical difficulty
claim is introduced. Source-listed, raw point and processed gains stay distinct.

## Integration boundary

- New modules: pure presentation helpers `route-comparison.mjs` and
  `route-comparison-view.mjs`. No dependencies, network providers, second
  scheduler, duplicated derivation, or storage are added.
- The new `compare`, `skyline`, `radial` view names are accepted by the existing
  public navigation and preference URL validators. Consent/storage protocol
  and itinerary membership are unchanged.
- Candidate subset, axis choice and rotation are document-memory UI controls,
  not part of shared links or remembered preferences. A reload retains the
  pinned active route/chapter/view, not those comparison-display controls.
- The builder explicitly allowlists and transitively hashes both modules.
  Release mutation tests verify their importers and both entry markers change.
  The source flyover fixture allowlist includes the two new transitive imports.
- Semonzo, its legacy clock/sensitivity, optional flyover, and organizer briefing
  remain separate. Comparison never relabels the example as an event route.

## Validation · 2026-11-24

Node 26.10.0, packaged headless Chrome, no new dependencies.

```sh
node --test --test-concurrency=1 tests/route-comparison.mjs tests/route-comparison-browser.mjs
# First run: 6 passed, 2 failed (desktop native-select test input; empty
# preferences itinerary was null, not an object).
# Corrected native type-ahead / empty-state assertions, added POI test:
# 9 passed, 0 failed.

node --test --test-concurrency=1 tests/route-analysis.mjs tests/route-pack.mjs tests/route-catalog.mjs tests/route-state.mjs tests/trip-planner.mjs tests/trip-planner-browser.mjs tests/route-briefing.mjs tests/route-briefing-browser.mjs tests/route-playback.mjs tests/route-time.mjs tests/rider-preferences.mjs tests/preferences-browser.mjs tests/release.mjs tests/release-lifecycle.mjs tests/site-shell.mjs tests/climb-sensitivity-browser.mjs tests/flyover.mjs
# 206 passed, 3 failed; details below. No skipped checks.

node --test tests/flyover.mjs
# After adding missing transitive imports to its source-server allowlist:
# 1 passed. Existing camera acceleration 2667.5 → 949.5 m/s² unchanged.

node --test --test-concurrency=1 tests/route-comparison.mjs tests/route-comparison-browser.mjs tests/flyover.mjs tests/release.mjs
# First strengthened run: 12 passed, 2 failed. Actual pointer hit-testing
# exposed overlapping radial labels that synthetic clicks had missed.
# Labels now spaced; current-position dot cannot intercept marker clicks.

node --test tests/route-comparison-browser.mjs
# After radial correction: 4 passed, including actual pointer hit-testing,
# keyboard at 375/1280px, exact-position/finish links and completed downloads.

node --test --test-concurrency=1 tests/route-comparison.mjs tests/route-comparison-browser.mjs tests/flyover.mjs tests/release.mjs
# Final, including accessibility-tree assertions: 14 passed, 0 failed/skipped.

for f in js/route-comparison.mjs js/route-comparison-view.mjs js/site-shell.mjs js/route-briefing-view.mjs js/route-state.mjs js/preference-storage.mjs tests/route-comparison.mjs tests/route-comparison-browser.mjs tests/release.mjs tests/flyover.mjs tools/build-release.mjs; do node --check "$f" || exit; done
git --no-pager diff --check
# Syntax and whitespace passed; no separate configured lint runner.

python3 tests/semonzo_chapters.py
# 3 passed.
python3 tools/import-routes.py --check
# Seven unchanged revisions; manifest:
# 7f5e6be4133ce03c983e53194e491aa8580638c6f2c8bb5cfb36a768d2709fdc
```

The new fixture waits for the intended destination frame and its fresh default
execution context before polling readiness. Cleanup awaits browser shutdown,
server closure and every tracked request handler before deleting its artifact;
unexpected errors are not suppressed. Tests cover native keyboard selection,
reading order, accessibility-tree names, 200% text/no overflow, shared state,
missing/withdrawn data, no external map requests or default storage, source
metrics, scale invariance, and revision-pinned chapter/position restoration.

### Remaining regression evidence / limitations

The broad run's three failures were:

1. Source flyover fixture did not serve the new imports. Corrected in scope;
   the unchanged legacy assertions pass.
2. `tests/site-shell.mjs:162`, 320px: **Inspected target navigated or closed**.
   The existing diagnostic reports the same Prepare-navigation polling step
   and frame-start transition described in the caller's historical `kotr27-ghf`
   advisory. The 375/1280px shell cases passed. No suppression, retry-until-green
   or unrelated navigation-harness repair was made; this run still failed.
3. `tests/trip-planner-browser.mjs:138`, 1280px: expected GPX SHA-256 but read
   SHA-256 of an **empty file** after observing its filename. An isolated
   unchanged-HEAD (`a4e423e`) source snapshot ran
   `node --test --test-name-pattern=1280px tests/trip-planner-browser.mjs`:
   **1 passed**. That is not proof the current failure is unrelated.
   The new comparison fixture separately waits for actual
   `Browser.downloadProgress: completed`, then verifies all seven GPX hashes:
   **passed**. The original planner test remains unchanged. This establishes
   successful completed downloads, not the cause of the earlier empty read;
   retain that uncertainty for independent review.

No whole-regression-suite PASS is claimed. No live provider/real-engine terrain,
Safari, physical device, actual screen-reader software, installed offline pack
or live facility availability qualification is claimed. Accessibility checks
are native controls, DOM reading order and Chrome's accessibility tree.

No Beads writes, staging, commits, closure, delegation, push or merge. No
discovered bead was created under the explicit no-writes restriction.
Final read-only verification retains `in_progress`, Eric Bowman, branch
`epic/kotr27-800` and HEAD `a4e423e17ec128eea3ba6938df085079ccc9b090`.
The index is empty. All 47 pre-existing tracked installer/config changes retain
the initial diff SHA-256
`2e9888966fe6d6ada8ba0aba143f484d23d2cfa21c62c35df9cbd83540e5c162`.
No private originals, unrelated untracked files, geometry or revision assets
were edited. No unavailable external baseline file is claimed to have been
independently revalidated.
Nonprogress recovery allowance remains **0/2**: corrections addressed distinct
concrete findings; no unchanged-finding retry loop was used. Fresh independent
parent review is required.
