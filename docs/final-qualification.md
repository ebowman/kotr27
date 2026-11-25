# Full companion qualification · kotr27-800.21

Observed 2026-11-25, physical checkout `kotr27`, branch `epic/kotr27-800`,
baseline `f633dc9460b28ff7f97ea03edf0a6788cf5d966d`.
**Implementer evidence, not independent PASS, epic acceptance or publication.**
The parent still owns fresh review and root acceptance. Parent MCP persona
evidence is now recorded below, including its refused local-upload boundary.
Independent review **88fba30b explicitly accepted P22's safe-recovery
replacement and the bounded application-performance disposition**. That review
was NEEDS-WORK on one native-drag qualification intermittence; its diagnosis
and correction are recorded below. Fresh review of the correction remains due.

The current operator scope is **Chrome using Chrome DevTools MCP**, complemented
by independent installed-Chrome tests. Safari/other browsers and native
fullscreen are **DEFERRED / UNVERIFIED**, not failed or passed. No attempt to
restore Safari, change browser/OS settings, deploy, push, merge, claim, stage,
commit or change Beads was made.

## Candidate identity and public boundary

Two independent normal builds of the corrected checkout produced identical bytes:
**76 files, 4,229,012 bytes**, including `.nojekyll`, both entries, fingerprinted
first-party dependencies, seven cleared route bundles, example and offline
manifest/worker. Release SHA-256:
`09e5d352490cc889f3f2857cd2e20eecb24be79e46122d687a956865ab7d4073`.
The initial candidate was 4,228,328 bytes, release
`a05cc651c7b78db7f512b2cefc51cf6967fef2d968f5a40746985ce59c45cad3`.
The bounded performance correction below changes only formatter reuse and
route-analysis task scheduling plus their transitive module hashes. Seven route
pins/GPXs, factual content and terrain/offline transaction code are unchanged.
Parent MCP evidence names the **initial** artifact; targeted calendar, route,
offline/update and native camera regressions rechecked the corrected artifact.

[`final-qualification.mjs`](../tests/final-qualification.mjs) actually compares
every byte, checks filenames against final-byte hashes, local static/dynamic/
worker import closure, all seven current revisions and sanitized GPX hashes.
[`release.mjs`](../tests/release.mjs) additionally tests dependency propagation,
unmanifested edits, rights denial and warm ordinary-URL freshness.
[`route-pack.mjs`](../tests/route-pack.mjs) exercises denied permissions,
symlinks, stale/tampered/rehashed graphs and nonallowlisted inputs **before**
output. This is a closed public graph, not a recursive source scan/copy.

No source tree/history, private originals, intake inventory, source-document
identifiers, participant facts, access-code URLs, personal recordings, tests,
docs, tooling, fixture B or withdrawal artifacts ship. Public GPX is
coordinate/elevation-only: no names, timestamps, metadata, extensions or cues.
Marker checks supplement structural field allowlists; they are not a claim
that regular expressions can prove arbitrary text secret-free. The only
provider configuration is the existing browser-public configuration, never
printed in this report; no private credentials are required by the build.

### Verified route inventory

All seven were selected, analyzed, compared and printed at their actual
packaged revisions in the browser suites. D1–D4 are source day labels only.
Revision suffixes below abbreviate full 64-hex pins, not replacement IDs.

| Day/variant | Stable ID | Revision suffix | Geometry points |
|---|---|---|---:|
| D1 Warm-up | rwgps-57874121 | eaac1b60720e… | 1,205 |
| D2 Short | rwgps-57873183 | 3361fbb7f97f… | 5,729 |
| D2 Long | rwgps-57874024 | b826857646e1… | 8,365 |
| D3 Short | rwgps-57873112 | 8f41a27bfcfa… | 5,016 |
| D3 Long | rwgps-57873019 | 34d3d7bbc568… | 6,738 |
| D4 Short | rwgps-57874050 | 4d9c0ac2fe37… | 3,606 |
| D4 Long | rwgps-57874076 | 35a93faf0abb… | 8,107 |

User clearance covers public route names/geometry/download derivatives, not
publication of raw FIT metadata. **FIT export remains unavailable** and GPX
is explicitly cue-limited, not device/navigation certification. All originals
remain private. Seven supplied FIT courses are not seven recorded activities.
The Semonzo example is still separately attributed, never renamed official D3L.
Source versus derived distance/gain and D1 surface/D2L unknown discrepancies
remain visible. In particular D4S's out-of-model-domain grade is not clamped:
whole-route time/sensitivity explicitly declines while briefing/export works.

The sourced event range is **20–24 May 2027**. Calendar mapping, departures,
fundraiser destination, participant/logistics details and verified facility
POIs remain pending. No inherited 2026 hotel/contact/chat/medical facts, guessed
stops, countdown departure or “today/tomorrow” ride has been published.
Earlier intake/architecture design notes about absent rights/short files are
historical; see the [intake supplement](route-intake.md#availability-supplement--2026-11-24-after-the-earlier-intake)
and [import contract](route-import.md), not those obsolete assumptions.

## Every retained 2026 parity job

This reconciles **every P01–P22 row** of the
[approved experience matrix](full-site-experience.md#2026-parity-matrix-and-falsifiable-journeys).
“Observed” below means executed assertions/actions in the listed suite, not
merely the existence of a test. Fixture-only facts are not event facts.

| Row | Actual packaged evidence and disposition |
|---|---|
| P01 Identity/countdown/event week | `event-guide-browser`: date-only Rome boundary, injected clock and seven revision-pinned cards; `event-guide`: before/during/after inclusive civil dates. Real event shows sourced range, no invented departure/day mapping. |
| P02 Fundraising/purpose | `event-guide` rejects absent/unapproved/withdrawn fields; packaged event/print checks show pending fundraiser and no inherited target. An approved synthetic target exercises the link path, not a newly approved 2027 fundraiser. |
| P03 Day choice/trip totals | `trip-planner-browser` at 320/1280 chooses all seven, switches/deselects one day, retains others and starts at 0/4; `trip-planner` checks unrounded consistent/partial totals. Preview remains separate from itinerary. |
| P04 GPX/FIT export | Native completed-download barriers and file SHA-256 in `trip-planner-browser`, `route-comparison-browser`, `offline-packs`; final artifact verifies all seven GPXs. FIT unavailable; GPX cue limitation stated. No promise of head-unit interoperability. |
| P05 Selected-set downloads | Mixed selected revisions, corrupt member, healthy native completion, per-file retry and unavailable FIT in `trip-planner-browser`; `trip-planner` tests denied handoff. UI says handed-to-browser, not saved. Browser/OS may block saving; no universal multi-download permission claim. |
| P06 Overview/profile/position | `route-briefing-browser` at 320/375/1280 seeks all seven with provider blocked and no FTP; exact common position, start/finish and profiles; missing/stale geometry cannot substitute old facts. |
| P07 Compare variants | `route-comparison-browser` at 375/1280 selects shared revision, equal-distance versus normalized axes and explicit itinerary choice; pure comparison checks reconcile deltas to the same analysis. |
| P08 Skyline | Same packaged comparison suite switches skyline, retains selection/scale and opens revision-pinned chapter from the keyboard-accessible list. No map required; table retains metrics not dependent on thinned labels. |
| P09 Radial/POI | Same suite rotates +30°/reset, reduced-motion and list/linear alternatives, shared chapter selection. Real routes have no verified facility POIs; explicit absence is not “no stops needed.” Synthetic annotation tests validate approved occurrence/revision binding. |
| P10 Pace comparisons | `route-pace-browser` uses example then native FTP entry, Easy/Steady/Hard/All Day, exact shared moving/elapsed values, invalid/cleared input and all seven routes. `route-time` tests missing data/domain rejection. D4S remains honestly unavailable. |
| P11 Modeled flyover time/All Day | Shared HUD/briefing/clock exact datasets, fixed-point animation 1×→4× leaves model time unchanged; effort changes it. Seed/resolved heuristic and numeric effort labels; model time is not recorded elapsed. `route-pace-browser`, `route-time`, `route-playback`, official flyover suite. |
| P12 Playback/reset/control access | All-seven official controller check; native keyboard seek, reduced motion, hidden-tab pause, stale load rejection; corrected packaged legacy flyover test exercises play/pause/reset/fallback. Native same-preset and context-loss checks preserve exact position. |
| P13 Camera jobs/fullscreen/shortcuts | Real WebGL with synthetic rasters checks four presets, refinements and native gestures. Parent MCP separately observed **12 real-provider states across D1/D3L/D4L**; provenance and observed safety fallback in [flyover evidence](route-flyover.md#current-chrome-devtools-mcp-evidence--parent-approximately-1200-utc). Fullscreen native verification deferred; denied API leaves inline controls. Visible shortcut vocabulary differs from old keys; actions remain labeled controls, inputs excluded. |
| P14 Climb insight | `route-briefing-browser`: greatest-ascent section, deep link/next section and finish; all-seven pure analysis proves signed metrics, method and source discrepancies. `route-pace-browser` links eligible chapter model/sensitivity; no FTP or personal sustainability assertion required. |
| P15 Local import/storage/recovery | `local-routes-browser`: native GPX/FIT file input, memory default, explicit remembering/reload/delete, stale tabs, corrupt input, denied/quota/uncertain storage, cancellation and private missing-link recovery. Worker/parser limit and CRC/XML negatives in `local-routes`. No personal bytes or map centers leave the browser. |
| P16 Recorded signals | Native synthetic activity fixture has timestamped telemetry/pauses and missing signals; elapsed seek and same-recording navigation preserve exact source samples; gap outlines do not bridge. `local-routes-browser`, `recorded-replay`. Never relabels model watts as measured power. |
| P17 Plan versus actual | Exact planned revision and acknowledgment, recorded-elapsed/matched-distance basis, partial/off-route/loop ambiguity and declined deltas in `recorded-replay` and native local replay tests. Private comparison stays local; no live tracking/ranking. |
| P18 Optional preferences | `preferences-browser`, `rider-controls`, `route-pace-browser`: blank example, partial inputs/units, invalid suppression, consent/revoke/Forget, denied stores and cross-tab deletion fences. No default app persistence, rider URL fields or request on edits. |
| P19 Preparation | `event-guide-browser` actually visits all **16 week × goal × cue** combinations via shared navigation at 375px; recovery/shorter/missed-week notes, keyboard checklist, history and Forget. Chapter practice preserves context; no compulsory FTP test or dated training prescription. |
| P20 Logistics/packing/print | Seven real revisioned cards printed through Chrome `Page.printToPDF` and parsed with installed `pdftotext`; source/as-of, pending logistics, limitations and selected-day facts. Private local fixture cannot enter public print. Checklist memory/consent/deletion tested. |
| P21 Weather | Native button with injected dates; mock MET forecast/cache/partial/error/429/stale/offline/late response and local privacy tests. Owner accepted provider terms in `.19`. At current real date forecast unavailable, no fabricated history or summit forecast; production-origin live response/aggregate traffic not certified. |
| P22 Recovery/diagnostic capture | Failed/blocked SDK and native context loss dispose canvas while linked briefing retains exact revision/position; Return/reset/same-preset gestures checked. No automatic capture/upload. **Independent release reviewer 88fba30b explicitly ACCEPTED removal of raw private-state capture in favor of safe Return/Reset/Profile recovery and privacy.** |

## Root journeys and criteria

**Newcomer N:** new packaged test at 320/375/1280 opens actual D3L with empty
rider inputs and blocked HTTPS; selects the greatest-ascent section with
native Enter, follows practice, returns to the identical route/revision/chapter,
and retains 0/4 itinerary. Native focus-visible and 44px targets are asserted
on these actions. The all-seven briefing and planner tests separately exercise
every route, explicit inclusion and completed GPX export. No account/map/FTP.

**Experienced E:** `route-comparison-browser` → `route-pace-browser` coverage
exercises variant deltas, explicit choice, optional 260 W then clear to example,
unit invariance, stop-inclusive clock, four factor-isolating sensitivity
comparisons, chapter seek and unchanged model time on rate change. Packaged
local replay tests then import fixture activity through the native file picker,
acknowledge exact plan revision, change alignment basis and verify source
telemetry and deletion. These are independently isolated packaged browser
segments, **not a claim of one uninterrupted MCP E session**. The parent
completed the N and E public flows below; MCP refused synthetic replay upload.
Native automated replay remains distinct evidence. No retry/bypass or repeat
MCP/terrain/offline rehearsal is requested.

| Root acceptance | Evidence / remaining boundary |
|---|---|
| Every verified day/variant selected/understood/compared/exported | All seven browser/data tests above; FIT unavailable explicitly, GPX sanitized. |
| Every retained parity job | P01–P22 table; P22 replacement explicitly accepted by independent review 88fba30b. Pending facts remain pending, not fabricated completions. |
| Changed GPX revision safety | Python real D1 alteration `eaac1b60720e…`→`94a77cb2a85a…`, only D1 changes; other six byte-stable; four→seven addition preserves prior four. Annotation review flags/profile/download hashes tested. Old saved choices require ACK; stale estimates/chapters rejected. |
| Disconnected/revision/withdrawal | Eight real Chrome worker tests include socket-level disconnection, native export/import, killed worker, quota/hash/fetch failure, eviction/deletion and durable withdrawal. Parent [MCP A→B→withdraw/delete](offline-packs.md#recorded-parent-chrome-devtools-mcp-evidence) retains its actual prior-artifact provenance; all eight automated worker cases rechecked the corrected graph. Ordinary HTTP cache alone is not this proof. |
| No mixed private/public state | Allowlisted build/negative gates plus native local/prefs/Forget tests; raw sources and all 50 foreign/11 private hashes preserved. No private intake validator executed. |
| Phone/keyboard/no-map personas | Actual native Chrome CSS viewports and reduced-motion checks above; parent MCP N/E public flows and refused replay-upload boundary below. No physical-device or human screen-reader certification. |
| Browser/performance/accessibility | Current Chrome only; original outlier preserved alongside bounded differential traces, corrected app batch and measured limits below. Deferred browsers/fullscreen never counted passed. |
| Server/publication boundary | No new backend/account/analytics; static artifact only. Publication/rollback requires separate operator authorization. No remote configured in this source checkout. |

## Resource and accessibility observations

Runtime: **Chrome 158.0.8127.88**, Node **26.10.0**, Python **3.14.7**,
Darwin/macOS **26.7.3 arm64**. Headless installed Chrome, loopback HTTP,
unthrottled native desktop CPU/network, fresh isolated profile then cached reload.
CSS widths are not an iPhone or 4GB Android. `PerformanceObserver` long-task
support is asserted. “Ready” means actual selected briefing text **and** the
seven-route planner are ready, not just DOM load.

| Width | Cold / warm ready (ms), initial full qualification run | Cold / warm resource transfer bytes |
|---|---:|---:|
| 320 | 791 / 326.2 | 4,071,659 / 9,695 |
| 375 | 414.9 / 471 | 4,071,659 / 9,695 |
| 1280 | 416.8 / 397.9 | 4,071,659 / 9,695 |

65 resource entries; decoded resource bytes 4,085,171. Transfer figures are
Resource Timing, not whole-session TCP accounting; HTML navigation overhead
is separate. An earlier independent focused pass measured 507–529.5ms cold,
329.3–1412.6ms warm, and no observed ≥50ms tasks.

**Original performance observation, retained:** the full run recorded one **356ms
main-thread task**, starting at 178.2ms, on the 320px cold visit. The other five
cold/warm measurements had none. This exceeds the architecture's proposed
<50ms slice target. Functional assertions pass, but this is **not a performance
PASS**. That historical sample had no timeline/V8 capture, so its exact cause
cannot be retrospectively proved. The bounded differential diagnosis and
correction below replace the earlier “trace needed” blocker with actual
source/event evidence and limits—not a claim that the original sample vanished.
The
≤3s physical mid-range phone and ≥30fps optional 3D targets remain **unverified**.

No remote requests or canvas before opt-in in all measured journeys; no app
stores/cookies/worker registration without consent. Display mesh limits remain
5,000 map vertices/2,000 profile samples/100 markers; sensitivity tests measured
one initial mesh, **zero additional meshes over 120 seeks + 180 ticks**,
one section mesh, cached return and one mesh for 20 coalesced edits. These
are workload counts, not a universal FPS or heap certificate. Import/library/
pack limits have malformed/oversize/quota/storage-denial tests, but no new
physical-device heap ≤64MiB certification is claimed.

Actual contrast: body **11.23:1**, selected navigation **12.14:1**; legacy
chapter-number labels **6.62–7.17:1**. Native accessibility-tree heading order
and optional FTP label, visible ≥3px focus outline, sampled ≥44×44px journey
controls, no page overflow at 320/375/1280, 200% text enlargement and reduced
motion are tested. This is not exhaustive WCAG conformance, browser 200% zoom,
every control's contrast, or a human assistive-technology audit.

## Commands, failures and correction provenance

Commands were run from the physical root, browser files sequentially:

```sh
node --test --test-concurrency=1 tests/site-shell.mjs
node --test --test-concurrency=1 tests/*.mjs
python3 tests/route_import.py
python3 tests/semonzo_chapters.py
python3 tools/import-routes.py --check
node --test --test-concurrency=1 tests/flyover.mjs tests/final-qualification.mjs
node --test --test-concurrency=1 tests/final-qualification.mjs tests/rider-controls.mjs
node --test --test-name-pattern='cold steep/bendy/long' tests/route-flyover-browser.mjs
node --test --test-concurrency=1 tests/*.mjs
```

* Initial shell: **0 passed / 3 failed**, all at the inherited broad request
  regex. Actual eager requests are `route-flyover-view` controls and
  `route-flyover` pure camera math. The corrected assertion inventories the
  **four exact deferred assets** (renderer, terrain, legacy flyover, config),
  rejects **every external request including blocked attempts**, and checks
  **zero canvases** at entry and after area navigation. No blanket name filter.
* First full run: **390 tests, 341 passed, 4 failed, 45 skipped** (740.6s).
  All three corrected shell widths passed. No production file had changed.
  Legacy `flyover.mjs`'s hand-maintained source server omitted newly required
  modules, so the shell/deck could never load. It now serves **only an actual
  built artifact**, checks required dependencies and drains teardown; all
  existing mocked-SDK behavior assertions remain.
* Two inherited `rider-controls` failures expected a pre-weather/offline AX
  heading list. The exact list now includes those two headings. The next run
  reached another obsolete exact-URL assertion: shared Prepare defaults now
  add `week=1&goal=social&cue=feel`. Those precise public fields are expected;
  the no-private-URL/no-network/no-storage assertions are retained.
* One native real-WebGL representative-route check initially timed out waiting
  for Manual after a trusted drag. Its unchanged isolated rerun **passed**
  all 12 camera/frame probes, manual/context-loss and background handling.
  Initial failure is retained; one passing retry is not a clean first run
  or proof of cause. Parent live-provider MCP observations remain separate.
* New qualification test development first exposed a directory base URL
  incorrectly classified as a file import and missing native keyboard modality
  before `:focus-visible`. After correcting those test mechanisms the
  artifact and three persona checks **4/4 passed**; assertions were not removed.
* Python importer **11/11 passed**, reference physics **3/3 passed**;
  read-only import check succeeded on all seven routes, manifest
  `7f5e6be4133ce03c983e53194e491aa8580638c6f2c8bb5cfb36a768d2709fdc`.
  Installed fitparse emitted Python `utcfromtimestamp` deprecation warnings;
  not errors, no dependency changes. No mutating private validators.
* The 45 optional skips are **42 preload scenarios**, two opt-in legacy live
  provider runs and one operator-deferred native fullscreen test. None is
  terrain qualification. Official real-WebGL tests and inherited parent
  real-provider MCP evidence supply the distinct terrain observations.

Final sequential rerun totals and final preservation checks are recorded at
handoff below. No recovery allowance was consumed by repeating unchanged work
without a changed hypothesis: the stale-test corrections advanced execution;
the single native gesture rerun is reported explicitly. Nonprogress allowance
was **0/2** at the initial handoff; see the corrective-pass accounting below.

### Initial qualification command results (before performance/drag corrections)

* Initial final `node --test --test-concurrency=1 tests/*.mjs`: **394 tests,
  349 passed, 0 failed, 45 skipped**, 575.85s. Includes the corrected three
  shell widths, both legacy AX/URL journeys, packaged legacy flyover,
  all 12 native representative-route camera/frame probes and new artifact/
  newcomer measurements. Three fixture/helper-only files are counted by Node
  as file subtests, not additional rider scenarios.
* That run's 356ms long task was a **separate performance acceptance blocker**
  despite passing functional tests. Subsequent differential work below addresses
  the reproducible application batch and documents browser/host limits.
  Independent review 88fba30b subsequently accepted the bounded disposition
  and P22; parent public MCP persona checks have now been completed.
* `node --check` passed for `tests/site-shell.mjs`, `tests/rider-controls.mjs`,
  `tests/flyover.mjs`, `tests/final-qualification.mjs` and
  `tools/qualification-preview.mjs`. `git --no-pager diff --check` passed.
  There is no additional project lint/package manifest or new dependency.
* Bounded preview smoke: actual normal artifact HTML **200** and exact
  manifest release; source, private inventory, test fixture and fixture-switch
  paths **404**; POST **405**. Owned smoke server stopped after checking.
* Recomputed **50/50 foreign installer hashes and 11/11 private hashes** match
  the parent's baseline; index empty. HEAD and dedicated branch unchanged.
  `.20`'s former owned files are committed baseline, not adopted dirty work.
  Unrelated untracked paths remain untouched. No Beads writes/discovered IDs.
* An early shell inspection used unavailable `python` (exit 127); it was
  corrected to installed `python3` for reading root JSON. No failed Beads write
  or dependent action was inferred successful from that pipeline.

## Bounded performance differential and correction

Executed after the parent's continuation brief, with **no other child test
jobs** running. The parent could use its independent MCP browser concurrently;
the host was not claimed idle. Same installed Chrome, 320×850 CSS px,
reduced motion, fresh isolated process/profile, real packaged D3L, no remote
requests. Each experiment was fixed at **two independent Chrome processes,
one cold navigation and one warm reload apiece**. Not a loop until green.

```sh
KOTR_TRACE=1 node --test --test-concurrency=1 \
  --test-name-pattern='bounded 320px' tests/final-qualification.mjs
```

The opt-in diagnostic enables `toplevel`, `devtools.timeline`, `v8`,
`blink.user_timing` and timeline/stack detail, plus native `Profiler` samples
at a requested 1ms interval. It records renderer-main `RunTask` wall/thread
time, nested module/layout/GC/timer events and sampled public function/source
lines. Nested `ThreadControllerImpl` wrappers are not counted as extra tasks;
sample weights are clipped to their task interval. A fixed 250ms tail drains
observer/layout delivery. Raw trace/profile stays in memory, no uploads; tool
output contains bounded event/source summaries, not source code or rider data.
Profiling has overhead and incomplete native attribution; it is not an
unthrottled physical-phone certification.

### Before correction: a real application batch, not merely startup noise

First pair cold/warm briefing readiness: **409.2 / 317.5ms**.
Independent pair: **416.9 / 262.3ms**.

* First cold module/layout task: **57.442ms wall / 40.700ms thread**.
  `v8.evaluateModule` on the packaged `site-shell` took **34.017 / 29.584ms**;
  Layout **17.839 / 5.820ms**. V8 samples identified
  `installRoutePace` (`route-pace-view.mjs:10`, 12.702ms sampled),
  shell module initialization and render. This mixes real app initialization/
  layout with wall time not spent executing on that thread; it is not a
  57ms pure-JavaScript computation or a demonstrated 356ms compilation event.
* A separate application `BlinkScheduler_PerformMicrotaskCheckpoint` was
  **52.786ms wall / 51.571ms thread**. Samples included
  `calendarStatus` (`event-guide.mjs:15`, **10.217ms**), sanitized GPX parsing
  (`route-pack-contract.mjs:40`), profile validation and event DOM construction.
  Minor GC events were below 1ms individually, not a 356ms GC pause.
* Warm and independent cold largest app checkpoints were **32.007ms** and
  **36.356ms**; independent cold module/layout **40.680ms**.
  Variance does not erase the observed over-target app batch.

A read-only `git show HEAD:js/event-guide.mjs` import probe demonstrated that
20 same-zone calls constructed **20** identical Intl formatters. The first
surgical change retains **one formatter only**, keyed by timezone, and never
caches date/results. New pure regression checks repeated renders, midnight,
timezone changes, invalid timezone recovery and bounded replacement; existing
DST/event boundaries remain covered.

The formatter-only experiment did **not** resolve the batch: first cold
checkpoint **54.583ms wall / 52.843ms thread**, including **13.452ms** sampled
in the first calendar initialization. Cold/warm pairs were **528.9/287.8ms**
and **370.4/229.8ms**; startup module/layout **63.676/39.250ms** on first cold.
Those results are retained, not presented as optimization success.

**Changed recovery hypothesis/action:** fully verified route promises were
continuing through analysis, model and view subscribers in one microtask
batch. `route-analysis-loader.mjs` now yields **one task boundary after
validation, before each derivation**. Callers still await the exact same
verified route/revision, numerical recipe and immutable analysis; no validation,
privacy gate or stale-response fence is skipped. This is a five-line scheduling
change, not a new worker framework, cached analysis substitution or large rewrite.

### After both surgical changes

| Independent process / visit | Ready ms | Document ≥50ms long tasks | Largest app module/derivation task |
|---|---:|---:|---|
| 1 cold | 424.5 | 0 | module/layout **47.596ms**; timer-derived analysis/render **29.336ms** |
| 1 warm | 381.6 | 0 | derivation/render **22.261ms** |
| 2 cold | 444.7 | 0 | module/layout **40.141ms**; derivation/render **34.740ms** |
| 2 warm | 868.9 | 0 | derivation/render **21.188ms**; verification checkpoint **22.111ms** |

The post-change trace explicitly shows `TimerFire` / `v8.callFunction` for the
analysis/render phase instead of the former >50ms combined verification
checkpoint. Source samples still identify the unchanged `analyzeRoute`,
`outlineProjection`, schema parser and `render`; the work was not removed.

**Important counterexample, not a hidden pass:** process 2 warm also contained
a renderer `RunTask` of **332.015ms wall / 5.440ms thread**, under
`SimpleWatcher::OnHandleReady` → `Receive mojo message`. Its nested Layout was
**1.690ms**, UpdateLayoutTree **0.538ms**, and microtask checkpoint **0.005ms**.
No V8 samples overlapped that task; absence of samples alone is not proof of
zero work, since profiling does not cover every startup/native interval.
The actual timeline plus low thread time attributes the observed delay to a
browser IPC/native wait or scheduling interval, **not a 332ms JS/GC computation**.
It was not reported as a document Long Task. Exact OS wait cause was not
traced and is not invented. Host load averages were **34.8–51.0 (1 minute)**
on **16 logical CPUs**, not an idle hardware benchmark. One unrelated
34.740ms task's thread counter was 37.672ms: these trace counters are
measurements with noise, not exact additive CPU accounting.

Thus: the reproducible >50ms **application microtask batch is corrected in
these measurements**. A universal “all renderer tasks <50ms” claim would be
false, as the 332ms IPC task demonstrates. The original untraced 356ms sample
remains historically unattributed; we do not assert that it had the same
cause as the traced 332ms delay. Independent reviewer **88fba30b accepted this
bounded application-performance disposition**, with four independently traced
visits: **zero document long tasks**, maximum captured task **46.996ms**,
derivation **26.3–27.7ms**. This acceptance neither claims physical-device/FPS
certification nor erases the historical outliers. No further performance work
was requested or performed.

Without tracing, the focused regression run measured:

| CSS width | Cold / warm ready ms | Document ≥50ms tasks |
|---|---:|---:|
| 320 | 471.8 / 612.9 | 0 / 0 |
| 375 | 452.8 / 628.6 | 0 / 0 |
| 1280 | 388.8 / 438.3 | 0 / 0 |

Current decoded resource bytes: **4,085,855** when all 65 entries are present;
cold transfer **4,072,343**, warm **9,695** (1280 cold sampled 64 entries before
the independent freshness request finished). No map/provider/canvas/persistence.
This is measured local Chrome coverage, not all-hardware performance PASS.

### Focused validation after the scheduling change

```sh
node --test --test-concurrency=1 tests/event-guide.mjs tests/event-guide-browser.mjs tests/final-qualification.mjs tests/route-analysis.mjs tests/route-pack.mjs tests/trip-planner.mjs tests/route-state.mjs tests/route-briefing-browser.mjs tests/route-pace-browser.mjs tests/site-shell.mjs tests/offline-packs.mjs tests/release.mjs tests/route-weather.mjs tests/route-flyover-browser.mjs
node --test --test-name-pattern='recorded replay: native upload|timestamp gap excludes' tests/local-routes-browser.mjs
node --test --test-name-pattern='native same-preset' tests/route-flyover-browser.mjs
```

First focused group: **120 passed, 1 failed, 1 deferred fullscreen skip**
(251.54s). Failure: the existing native same-preset helper did not receive any
trusted mouse events at its canvas; the prior hit test passed, but the canvas
was hidden when the failure diagnostic ran. Exact delivery-loss timing/cause
was not proved. It timed out waiting for Manual. Diagnostics showed only SDK
`movestart` events with `originalEvent:false`, not an actual rejected rider drag.
An analogous pre-change native delivery failure is already retained above.
The unchanged isolated same-preset rerun **1/1 passed**, including all four
presets, refinements and exact shared projections. No input/assertion bypass,
gesture test patch or false clean first-pass claim.

The native exact-plan replay and timestamp-gap targets **2/2 passed**.
All seven numerical/rights/revision cases, calendar/print/weather, stale loads,
same-point pace, shell legacy links, all eight offline lifecycle tests,
release reproducibility and representative native terrain frames passed in
the focused group. Four changed-JavaScript syntax checks and whitespace passed.
Pure calendar group separately **5/5 passed**. Each of the three fixed trace
experiments completed **1/1 diagnostic test**; the first accidentally nested
registration invocation ran **no matching trace** and is not evidence.

**Recovery accounting:** the formatter-only result did not reduce the concrete
batch blocker. The materially different task-boundary recovery restored
measurable progress; **1/2 nonprogress recovery attempts consumed** cumulatively.
No more trace repetitions are scheduled, no arbitrary review cap introduced.

## Independent review 88fba30b: native-drag qualification correction

The fresh review explicitly accepted P22 and the bounded performance
disposition, but its full candidate run had **349 passed, 1 failed, 45 skipped**.
The sole blocker was the native helper's `elementFromPoint(...) === canvas`
assertion after D1's four valid camera frames. An unchanged isolated rerun passed
all 12 frame probes/gestures/recovery; that alone did **not** establish cause.
`tests/route-flyover-browser.mjs` was then explicitly added to `.21`'s scope.

### Actual cause evidence, not a presumed scroll race

The original helper scrolled, waited exactly two RAFs, obtained coordinates
and hit-tested in separate evaluations, then sent native hover/press/drag.
Bounded probes recorded canvas/container visibility, actual hit element,
geometry, scroll, visual viewport, layout shifts, frame proof/status, map
movement, native events and camera-update call stacks. An instrumented affected
run passed **3 tests / 1 deferred fullscreen skip**, but captured native hover
landing on `#flyover-viewport` after the preceding canvas hit had passed.
An attribution-only representative-route run passed **1/1**, with this actual
D1 sequence (document-relative milliseconds):

* **921.9ms:** canvas hit, visible, ready, proof OK; rect
  `x=49, y=202.15625, width=702, height=495`, scroll Y **4587**.
* **925.0ms:** `local-routes-view.sync → reconcile → changed →
  site-shell.render → route-flyover-view.show/draw →
  route-terrain-view.update → map.jumpTo`.
* **928.5ms:** the same point hit **DIV `#flyover-viewport`**, canvas hidden.
  Geometry/scroll were unchanged; there were **no layout shifts**. The ready
  label and prior frame proof still said ready/OK.
* **938.3ms:** actual trusted native hover reached that DIV while hidden.
* **945.0ms:** a newly verified render made the canvas visible; **948.4ms**
  trusted mousedown then reached the canvas in this passing diagnostic run.

Thus a focus-triggered local-library reconciliation rerenders the shell and
correctly gates terrain until a verified frame. Fixed frames **before** the
first native hover cannot guarantee readiness **after** it. This is not an
overlay product bug or evidence that scrolling changed the coordinates.
The later corrected run directly recorded the triggering **trusted window
focus at 911.2ms**, reconciliation/update at **912.4ms**, hidden hover at
**927.3ms**, then stable ready **959.9ms** and one trusted canvas press
**960.9ms**. Earlier historical failures did not have these probes; their exact
individual timing is not retroactively claimed proven.

### Deterministic control and bounded correction

The added negative control uses a deliberately synthetic **focus notification**
(not a synthetic gesture) to invoke the actual async library reconciliation.
A mutation observer samples the actual renderer-hidden interval: a previously
valid hit now hits `#flyover-viewport`, with identical rect/scroll and a stale
ready label. The stack must include both library and renderer modules, and
**zero mouse events** may have occurred. The same real Mapbox scene then
receives exactly one trusted native press/drag and preserves all shared
position/model/recording fields.

The helper now checks actual visible canvas hit, current verified frame,
ready state, non-moving map and identical geometry/scroll/viewport over
consecutive animation frames. It does this **again after native hover**,
obtaining coordinates and hit evidence in one evaluation before pressing.
It additionally asserts the **delivered** trusted left-button mousedown reached
the visible canvas. Readiness is bounded at five seconds; unavailable terrain
fails immediately. There are no gesture retries, forced visibility, skipped
assertions, synthetic drag events or arbitrary delay increase. Press cleanup
releases the native button even if a subsequent assertion fails. Probe
listeners are removed after each drag rather than accumulated.

All four camera presets, camera restoration/refinements, exact projections,
12 representative real-WebGL frames, native playback/background disposal,
Return and forced fallback assertions remain. Production code/artifact bytes
did **not** change in this corrective pass, so existing MCP evidence is not
invalidated and no MCP repetition was requested.

Affected command:

```sh
node --test --test-concurrency=1 tests/route-flyover-browser.mjs
```

Result: **5 tests, 4 passed, 0 failed, 1 operator-deferred fullscreen skip**
in **31.14s**, including the negative control and trusted focus/press timing
above. This is measurable progress on the concrete blocker, not another
nonprogress recovery attempt; cumulative allowance remains **1/2 consumed**.

### Current full-candidate validation after the correction

```sh
node --test --test-concurrency=1 tests/*.mjs
node --check tests/route-flyover-browser.mjs
git --no-pager diff --check
```

Full sequential run: **396 tests, 351 passed, 0 failed, 45 skipped**, **400.73s**.
The 45 skips remain **42 preload scenarios, 2 opt-in legacy live-provider
tests, 1 operator-deferred native fullscreen test**; none is a terrain pass.
Syntax and whitespace checks passed. This supersedes the earlier current-
candidate functional totals without erasing any historical failure.

The full run repeated the deterministic negative control: valid hit at
**707.8ms**, actual hidden DIV hit at **715.0ms**, unchanged rect/scroll.
Subsequent native window focus **741.5ms** → reconciliation **742.8ms** →
hidden hover **758.3ms** → stable ready **790.9ms** → one trusted visible-
canvas press **792.3ms**. All four same-preset restorations, 12 representative
camera/frame probes, native playback/background disposal and forced fallback
passed. The corrected helper did not retry any press or gesture.

The same suite independently rebuilt identical **76-file / 4,229,012-byte**
artifacts with release **09e5d352490cc889f3f2857cd2e20eecb24be79e46122d687a956865ab7d4073**,
and rechecked all seven pins, import closure, hash/rights/publication-denial
boundaries, both automated personas, native local replay/privacy, batch
downloads and all offline/revision/withdrawal scenarios.
Its ordinary newcomer measurements (not additional profiling cycles) were:

| CSS width | Cold / warm ready ms | Document ≥50ms tasks |
|---|---:|---:|
| 320 | 629.2 / 902.8 | 0 / 0 |
| 375 | 441.0 / 438.9 | 0 / 0 |
| 1280 | 345.2 / 194.5 | 0 / 0 |

These are unthrottled local Chrome observations, not physical-phone or
universal task-bound certification. They do not replace the independent
review's accepted bounded performance evidence or remove historical outliers.
The earlier Python importer **11/11**, physics reference **3/3** and safe
all-seven importer `--check` evidence remain applicable; no Python/importer/
data changes occurred in this harness-only pass and no mutating private
validators were run.

## Recorded parent Chrome DevTools MCP personas

Native parent handoff on **2026-11-25**, actual normal release **a05cc651…**,
`tools/qualification-preview.mjs /tmp/kotr27-800-21-public-parent 48129`.
Owned page **7**, isolated context **kotr27-final21**. These observations were
performed by the parent using its real MCP connector, not reconstructed or
independently executed by this child.

**N, 320px touch:** ready Plan began **0 of 4**, no overflow, external requests,
canvas, Cache Storage, service worker or IndexedDB. Actual D3L briefing →
hardest jump selected **chapter 22 at 10,750m**. Practice opened week 2; choosing
week 3/social/feel then Explore preserved exact route/revision/chapter/distance.
Plan explicitly choosing D3L gave **1 of 4, 63.2km / 1,756m derived**. GPX
outcome was **handed-to-browser**, explicitly not OS saved; FIT unavailable
and source/raw-gain labels were visible. Native Tab reached a summary with
`focus-visible:true` and a solid outline. Persistence remained absent.

**E, 375px touch:** D2S/D2L comparison used normalized progress; derived delta
**+19.7km / +792m**. Explicit D2L itinerary/briefing retained blank mass/FTP
and fictional example. Hard 90% plus 5-minute stop showed **241.9 moving /
246.9 elapsed minutes**. Native ArrowRight moved seek to **100m**;
modeled clock **312.391970562111s** remained **exactly unchanged** on animation
rate 4. Opening the actual sensitivity details summary exposed X FTP /
Y weight / Z moving minutes and all four numeric comparisons. No provider,
Mapbox or canvas requests; width fit and persistence still absent.

**Parent MCP Lighthouse mobile SNAPSHOT**, not a performance audit:
Accessibility **100**, Best Practices **100**, SEO **100**, Agentic **100**,
**38 passed / 0 failed**. The reported **3518ms is audit duration**, not app
readiness/performance. Tool-local reports:
`/var/folders/ms/8skj9_fx6zs08v2ydsjcjjhc0000gp/T/chrome-devtools-mcp-RL6Y1d/report.json`
and `chrome-devtools-mcp-CY44mb/report.html` under the same temporary parent.
Not exhaustive WCAG, human assistive-technology or physical-device certification.

**Refused upload, not hidden:** parent generated only a synthetic GPX using the
existing fixture in `tests/.mcp21-synthetic.gpx`. Native MCP `upload_file`
refused the repository path as **not within configured workspace roots**.
Parent stopped the affected upload. **No alternate path/tool/JS File bypass**;
local file count remained **0**. The MCP E replay segment was **not performed**.
Native Chrome automated GPX/FIT/ACK replay remains separate packaged evidence;
reviewers adjudicate that coverage, not a new permission wizard. Do not retry
or bypass this connector restriction or represent it as a product defect.

Parent closed only page 7, left initial page 1, stopped its helper and removed
only its synthetic fixture/temp artifact. No source edits or protected-file
changes. These MCP facts predate the two performance-only code changes;
targeted native calendar/route/offline/replay regressions above qualify the
changed graph. No repeat MCP is requested.

### Parent MCP targeted recheck of corrected release

Parent handoff **2026-11-25, approximately 13:50 UTC**: actual corrected release
`09e5d352490cc889f3f2857cd2e20eecb24be79e46122d687a956865ab7d4073`,
preview helper destination `/tmp/kotr27-800-21-perf-parent`, port **48129**.
Owned page **8**, isolated MCP context **kotr27-final21-perf**, **320×850
mobile/touch**. These are parent-performed native MCP observations, not a
child-reconstructed browser run.

MCP `navigate_page` injected a Long Task `PerformanceObserver` and readiness
`MutationObserver` **before application code**. Readiness required the actual
D3L briefing heading **and** ready trip planner:

| Navigation | Ready ms | Document long-task entries ≥50ms |
|---|---:|---:|
| Cold | 370.899999976 | 0 (`longTasks: []`) |
| Warm reload | 306.799999952 | 0 (`longTasks: []`) |

Cold external requests were **0**, at actual width **320**. Hardest jump
selected **chapter 22 at 10,750m** → Practise selected section opened **week 2**
→ Explore preserved the exact route/revision/chapter/distance. Long-task
entries remained empty throughout these interactions. Warm reload preserved
the same position and was **not service-worker controlled**.

This directly rechecks the corrected loader/calendar journey through MCP.
It is not physical-device certification or a universal <50ms guarantee for
all browser tasks; the original 356ms observation and traced 332ms native IPC
interval remain recorded above. Earlier full N/E and Lighthouse accessibility
100 observations retain their **a05cc651…** provenance; they are not silently
relabeled as runs against the new release.

The parent closed only owned page 8, stopped its helper and deleted its
temporary artifact, with no source edits. Native MCP upload remains refused/
not performed; separate native Chrome replay tests remain the evidence for
that segment. Independent review 88fba30b subsequently explicitly accepted
the P22 safe-recovery replacement and bounded performance disposition.

### Final owned changes and review handoff

Exactly these **13 paths** belong to `.21`; foreign installer edits and unrelated
untracked paths are excluded:

* `js/event-guide.mjs`
* `js/route-analysis-loader.mjs`
* `tests/event-guide.mjs`
* `tests/final-qualification.mjs`
* `tests/flyover.mjs`
* `tests/rider-controls.mjs`
* `tests/route-flyover-browser.mjs`
* `tests/site-shell.mjs`
* `tools/qualification-preview.mjs`
* `docs/final-qualification.md`
* `docs/full-site-architecture.md`
* `docs/full-site-experience.md`
* `docs/release.md`

The parent-evidence update itself was documentation-only. The subsequent
native-drag corrective pass changes only its test and this report; no further
performance diagnosis or production changes. Final verification preserved
**50/50 foreign and 11/11 private hashes**, empty index,
HEAD `f633dc9460b28ff7f97ea03edf0a6788cf5d966d`, branch `epic/kotr27-800` and
bead `.21` in_progress assigned to Eric Bowman. No Beads write, claim, staging,
commit, closure, push, merge or deployment. Nonprogress recovery remains
**1/2 consumed**.

**Ready for fresh independent review**, not implementer-declared PASS or root
completion. P22 and the bounded performance disposition have explicit review
acceptance; the remaining correction requires fresh independent review.
The parent retains finalization and independent root acceptance.

## Simple parent Chrome DevTools MCP handoff (retained reproduction steps)

Use a **new external destination**; this builds the normal artifact, not
fixture B/withdrawal, serves only its allowlisted paths on loopback, prints the
release and URL, and stops after **20 minutes** or Ctrl-C:

```sh
node tools/qualification-preview.mjs /tmp/kotr27-800-21-public 48129
```

No pre-existing destination/listener is replaced. Parent owns its process and
artifact cleanup. For a build without a server:

```sh
node tools/build-release.mjs /tmp/kotr27-800-21-artifact
```

Use a fresh owned MCP context; never clear someone else's browser stores.
Open `http://127.0.0.1:48129/kotr27/index.html?area=plan`. Wait for
`#site-shell[data-ready=true]` and `#trip-planner[data-ready=true]`.
Keep external providers blocked and do not click Enable online 3D or weather.
Snapshot after emulation/navigation because old MCP element UIDs expire.

**N — 320px, no FTP/map:** inspect date/status and `#trip-summary` (0 of 4).
Open D3L's `.trip-route` briefing link (route `rwgps-57873019`), click
`#briefing-hardest-jump`, read section/next-feature absence and
`#briefing-position`. Activate “Practise selected section” in `#site-content`,
choose `#prepare-week` / `#prepare-goal` / `#prepare-cue`; return via Explore.
Check same route/revision/chapter and visible keyboard focus. Back to Plan,
select D3L in `#trip-choice-kotr-d3`; totals must say 1 of 4. Click
`#trip-gpx-rwgps-57873019`; inspect cue/FIT limits and per-file outcome.
Count external requests, canvases and app persistence: all zero before consent.

**E — 375px (recorded steps, not a request for another MCP run):**
compare D2 Short/Long via `#route-comparison` links and `#comparison-axis`,
read the exact delta, choose explicitly with `#trip-choice-kotr-d2`.
Open the chosen briefing, leave rider fields empty, change `#pace-scenario`,
set `#pace-stop` to 5, and compare moving versus elapsed totals. Seek with
`#briefing-seek` ArrowRight and change `#briefing-rate` to 4: same-point
modeled time must not change with animation rate. Open `#pace-sensitivity`;
inspect numeric four-factor comparisons and heatmap without a map.
Download through `#trip-download-gpx`; outcome is browser handoff, not saved.
For local replay use **only the existing native automated synthetic fixture
tests**, never real participant data:
the existing `tests/local-routes-browser.mjs` native upload/replay targets
generate the GPX/FIT, exact-revision ACK and missing-signal cases automatically.
MCP's actual upload refusal is recorded above; **do not retry or work around it**.
The automated tests inspect `#replay-seek`, `#replay-signals`, `#replay-plan`,
`#replay-basis`, `#replay-ack`, `#replay-apply`, alignment, forgetting and privacy.
They remain separate evidence, not retrospectively relabeled MCP actions.

For remaining browser targets use named tests, not guessed routes or provider
repeat work: `tests/final-qualification.mjs` (N/metrics/accessibility),
`tests/route-pace-browser.mjs` (E/model), `tests/local-routes-browser.mjs`
(native synthetic replay), `tests/trip-planner-browser.mjs` (batch errors).
Existing parent terrain/offline MCP evidence **need not be repeated**. It keeps
its prior release provenance; focused automated tests rechecked the modified
calendar/analysis scheduling and resulting release graph.

## Artifact-only publication and rollback, after authorization

1. Retain review 88fba30b's explicit performance/P22 acceptance, obtain fresh
   independent review of the native-drag correction and current qualification,
   then independent root acceptance using the recorded parent MCP persona
   evidence. This document alone grants none of those review/acceptance decisions.
2. Build to a new external directory, verify the release hash, byte equality
   and allowed inventory, and run the selected packaged checks. Keep reports,
   screenshots, fixture files and private source outside that directory.
3. Only after explicit publication approval, use a **separate clean clone of
   the public `ebowman/kotr27` artifact branch**. Verify destination, branch,
   Pages settings and previous known-good artifact/commit. Copy only the
   contents of the reviewed artifact including `.nojekyll`; never configure a
   source remote or push/merge this private source checkout/history.
4. Inspect the deletion/copy dry run and public staged diff against the exact
   manifest; preserve the previous artifact for rollback. Public commit/push
   and Pages deployment remain operator actions. See [release steps](release.md).
5. After publishing, verify ordinary `/kotr27/` and `/kotr27/explore.html`,
   entry/manifest hashes, seven current pins, one GPX, no private paths, fresh
   and warm visitor behavior. For installed packs prompt check/explicit
   replacement/reload; existing tabs retain complete old release.
6. Roll back **artifact bytes only** to the reviewed previous public release
   through the same independent authorization/review boundary. Do not rewrite
   source history or mix assets across manifests. A known withdrawn route
   must **not** be resurrected by rollback: publish an amended cleared artifact
   with its tombstone or use a previous version only if all its routes remain
   permitted. Sticky client tombstones cannot be undone by shipping old bytes.
   Offline devices cannot learn a new withdrawal until reconnection; downloaded
   files cannot be recalled. Never claim rollback revokes private copies.
