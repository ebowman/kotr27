# Official-route flyover — kotr27-800.12

Implementation evidence, 2026-11-25. **Ready for fresh independent review under
the current operator scope; not an independent PASS. No commit or bead closure.**

**Current operator scope:** Chrome qualification using Chrome DevTools MCP,
supported by the existing native Chrome regression suite. The user explicitly
directed: “yes let’s just focus on chrome and using chrome dev-tools mcp to
test”. **Safari and native fullscreen qualification are DEFERRED / UNVERIFIED
for this delivery**, not passed and no longer acceptance blockers. All other
camera, progress, revision, privacy and fallback criteria remain unchanged.
The parent completed the MCP journeys below through its working connector;
the child's lack of MCP tools is not an outstanding task blocker.

The Safari-specific 2/2 nonprogress allowance is historical and retired with
that explicit deferral, not reset into permission for more Safari attempts or
unbounded recovery elsewhere. No further Safari/fullscreen work is requested.
The time-stamped investigations later in this document retain their actual
failures and former scope; they do not override this current disposition.

## Fresh-review correction — same-preset selection after manual exploration

Fresh independent review identified one concrete mandatory blocker: after
Follow → native drag → Follow again, the UI claimed Follow but the renderer
retained the dragged camera and Manual status. Return to rider worked, but
selecting the already-active preset did not. This violated usable camera jobs
and honest manual-versus-follow state; it was not a deferred browser issue.

The added packaged native Chrome regression reproduced the failure **before**
the production correction: expected camera longitude `11.803196993340293`,
actual dragged longitude `11.808592421790479`. This was an actual camera-state
assertion, not merely a label check.

`js/route-flyover-view.mjs` now carries an explicit reframe intent through the
shared snapshot draw for every preset selection, even if its mode enum is
unchanged. That draw clears UI manual state and replaces stale Manual status
with “Preparing selected camera…” before using the renderer's existing forced
update, which also exits manual mode and applies the pose. No second clock or
model/geometry change was introduced. Return, reset, pitch/zoom refinements
and side swap use the same path instead of separate redundant forced updates.
Other forced seek/mode draws likewise align the UI with the renderer.

The focused native regression now covers all four jobs:
trusted native drag → native click on the **same** preset → verify restored
camera center/pitch/bearing/zoom, ready frame, selected-button state and
non-Manual orientation/status. Shared distance, position, `estimatedRide` and
`recordedClock` are compared **exactly**. It additionally checks pitch, zoom,
side swap, Return to rider and reset when already at start/Follow after a drag.
The existing native gesture helper is shared with the representative-route
test; it still requires a hit-tested canvas and trusted mouse input.

The first post-fix run restored Follow, then exposed an overly exact test
comparison for terrain-adjusted Overview `fitBounds`: zoom differed by
`0.000002888542963`. Camera zoom comparison now allows `0.0001` (less than
0.06 pixel across the 800px viewport); camera centers remain within `0.000001`
degrees and shared route/model/source projections remain exact. This is
subpixel camera-fit tolerance, not clamping route data or weakening progress
invariants. The original failing camera offset remains far outside it.

Actual corrective commands/results:

```
node --test --test-name-pattern='native same-preset' tests/route-flyover-browser.mjs
```

Before correction: **1 failed**, reproducing the review blocker. Final
corrected run: **1/1 passed**, including all coupled refinement checks.

```
node --test tests/route-flyover-browser.mjs tests/route-flyover.mjs tests/route-playback.mjs tests/route-time.mjs tests/recorded-replay.mjs tests/route-briefing.mjs
node --test tests/release.mjs
node --test --test-name-pattern='quota abort|recorded replay: native upload' tests/local-routes-browser.mjs
node --check js/route-flyover-view.mjs
node --check tests/route-flyover-browser.mjs
git --no-pager diff --check
```

Final results: **53 passed, 0 failed, 1 operator-deferred fullscreen check**;
**3/3 release tests passed**; **2/2 selected native privacy/replay tests
passed**; syntax and whitespace checks passed. The native correction uses
the real Mapbox 2.15 WebGL engine and synthetic rasters with actual D1 geometry.
The parent MCP live-provider evidence below predates this correction and is
retained for its actual observed journeys; it is **not** claimed as a new
live-provider same-preset/drag check.

The concrete review blocker decreased from **one reproduced failure to zero
in implementer validation**. Fresh independent review remains required; no
reviewer PASS is claimed. No Safari/fullscreen work or recovery cycle was
performed, and no arbitrary review-pass limit is introduced.

Only these paths changed in this corrective pass:
`js/route-flyover-view.mjs`, `tests/route-flyover-browser.mjs`,
`docs/route-flyover.md`. All 50 foreign/11 private hashes, HEAD `7f227ca`,
branch `epic/kotr27-800` and the empty index were reverified unchanged.
No Beads writes, staging, commit, closure or discovered task.

## Current Chrome DevTools MCP evidence — parent, approximately 12:00 UTC

**Provenance:** the native parent performed these operations through the actual
Chrome DevTools MCP connector and supplied this bounded evidence handoff on
2026-11-25. This child records that evidence; it did not execute or reconstruct
the MCP session and does not claim an independent review.

### Packaged artifact, ownership and readiness

- Parent built the release with `build('.', temp/kotr27)` and served it using
  Python's standard-library HTTP server on `127.0.0.1:48127`. The initial
  readiness curl raced startup and returned exit 7; the next returned HTTP 200.
  The initial connection failure is not represented as a successful check.
- MCP `new_page` used isolated context `kotr27-800-12-mcp`. Owned page IDs were
  **2, 3 and 4**; initial page 1 was not owned or closed. Reported Chrome UA:
  **158.0.0.0 on macOS**.
- Navigated the approved actual **D3L, D1 and D4L current-revision URLs** in the
  packaged release. Shared session module:
  `route-session.fd7e86c3fc1ae6dc69ef976a.mjs`.
- Before Enable, the measured remote-resource count was **zero for each route**.
  Existing automated local-import/replay checks separately cover private tracks;
  this public-route MCP observation is not substituted for those privacy tests.

### Actual operations and outcomes

**D3L — steep/bendy representative route**

1. At approximately **31,578.896 m**, MCP `evaluate_script` invoked the four
   camera buttons through DOM clicks. Follow, Overview/Bird's-eye, Side and
   Cinematic preserved shared distance and `estimatedRide`.
2. Native MCP `press_key` ArrowRight advanced the seek by exactly **100 m**, to
   approximately **31,678.896 m**. Native MCP `click` on Follow selected
   `follow`, paused, without changing that selected position.
3. MCP `emulate` selected **375×850 mobile/touch**. It caused navigation/reload:
   old snapshot UIDs and page globals became invalid. The parent refreshed
   the MCP snapshot and imported the current session module before continuing.
   This context replacement was handled as harness lifecycle, not called a
   product failure.
4. Native MCP `click` on Enable loaded the **real Mapbox GL 2.15 SDK and real
   satellite/DEM tiles**, with successful tile HTTP 200 responses and observed
   Mapbox session/events requests. The provider IP/region disclosure was
   already visible before opt-in. These were not synthetic raster responses.
5. At actual document width **375 px**, terrain reached `ready`, with exactly
   **one canvas** and rider opacity **1**. All four presets remained `ready`
   at **31,678.896 m**, with unchanged shared position.
6. An inline MCP screenshot visibly showed textured mountain terrain, the
   orange winding route, centered white-ring rider and north compass. No
   screenshot file was saved: a requested session-folder snapshot destination
   was rejected by the connector's workspace policy, and was not retried or
   bypassed. The parent used inline snapshots.
7. Cinematic playback at animation rate **2×** advanced shared distance from
   **31,678.896 m to 32,703.637076 m**, then paused, retaining Cinematic and a
   ready terrain state.
8. A subsequent native map ArrowLeft check encountered the safety fallback:
   **“Imagery, elevation or an unobstructed rider view could not be verified.”**
   Status became `unavailable`, canvas count became **0**, and exact distance
   **32,703.637076 m** was preserved. The linked briefing seek remained enabled
   and its fallback link present. No automatic retry followed.

That last observation is an explicit fallback outcome, **not an MCP manual
drag/Return-to-rider PASS**. Native manual gesture/Return evidence remains the
separate automated Chrome check, which targets the actual unobstructed canvas.
The provider-view failure was not hidden, converted into a continuously
successful terrain claim, or used to infer a new route position.

**D1 and D4L — additional route/long-route coverage**

| Actual route | Shared selected distance | Real-provider outcome after opt-in |
| --- | ---: | --- |
| D1 | 9,839.602946 m | Follow, Overview, Side and Cinematic each `ready`; exact distance unchanged |
| D4L | 42,610.680486 m | Follow, Overview, Side and Cinematic each `ready`; exact distance unchanged |

Together these are **12 real-provider MCP camera-state checks** across three
approved current routes, complementing—not relabeling—the earlier **12
synthetic-raster real-WebGL frame probes**. They do not certify every geographic
location, every provider failure, or physical-device performance.

Reduced-motion evidence remains the existing native Chrome automated test;
no MCP reduced-motion emulation capability or journey is claimed. Source/model
distinctions, D4S solver-unavailable behavior and private replay/gap invariants
remain supported by the existing focused/native regression evidence below.
Safari and fullscreen remain expressly deferred/unverified.

### Cleanup and review handoff

The parent closed only owned MCP pages **2/3/4**, leaving page 1, and stopped
the owned temporary server. Temporary-artifact removal remains parent-owned;
completion of that removal was not included in this handoff. The parent made
no source edits for these MCP checks. No connector-policy bypass, publication,
settings change, Beads write, staging, commit or closure is claimed.

Under the current explicit Chrome-only scope, there is **no remaining
implementer-identified mandatory blocker**. The actual live-provider fallback
and historical browser failures remain visible evidence for the fresh
independent reviewer, who must assess the diff and acceptance evidence rather
than treating this handoff as PASS.

Automated commands/results at the preceding MCP documentation handoff
(superseded by the corrective results above):

```
node --test tests/route-flyover-browser.mjs tests/route-flyover.mjs tests/route-playback.mjs
node --test tests/release.mjs
node --test --test-name-pattern='quota abort|recorded replay: native upload' tests/local-routes-browser.mjs
```

Respectively: **23 passed, 0 failed, 1 explicitly deferred fullscreen check**;
**3/3 passed**; **2/2 passed**. Earlier broader packaged regressions were
**39/39 passed**, and the camera/model/briefing/replay/time unit group was
**50/50 passed**. Those remain their actual latest runs, not new runs or
cross-browser certification. That documentation-only handoff edited this
evidence document and ran `git --no-pager diff --check`.

## Integration and behavior

The approved organizer route's pinned analysis drives the optional flyover in
Explore. Follow, Overview/Bird's-eye, Side and Cinematic consume the existing
document-wide playback snapshots. There is no second distance/time integrator.
Camera changes pause without seeking or recomputing model/recording projections.
`play({preserveCamera:true})` retains an explicitly chosen job; the default
preserves legacy behavior. D4S's solver-unavailable state remains unavailable.

The panel explains online Mapbox disclosure before Enable, all four jobs,
fullscreen, speed, reset, distance seeking, scoped shortcuts and optional
pitch/zoom/side controls. Native map manipulation pauses playback and labels
manual exploration; Return to rider restores Follow. North compass, view
bearing, source start/finish and rider markers distinguish orientation from
route progress. Local/private or unsupported analyses cannot enable this view.

Necessary architecture adaptation: the example's authored Semonzo coordinates,
ridge choreography and retry/promotion machinery cannot describe arbitrary
revision-bound routes. The new modules use generic route-distance chords and
bounded camera poses, retaining the existing pinned SDK's actual raster-cover
check and the legacy mesh-pick/marker-registration approach. The example player
is otherwise retained. A shared disposer prevents overlapping official/example
maps; leaving the example stops its map, with explicit Retry on return.

The map is lazy, with no route-wide prefetch. Limits per activation:

- 2,048 rendered route vertices; exact shared rider position is not decimated.
- 5 Hz moving camera updates, immediate paused commands.
- Four parallel SDK image requests; previous concurrency restored on disposal.
- 32 cached tiles per source, 240 tile requests, zoom at most 13, pitch at most 55°.
- Four-million-pixel frame-size gate, 12-second startup deadline, 2.5-second
  continuous coverage-loss deadline.
- One map/canvas; hidden tabs dispose it and require explicit re-enabling.

A coarse cover from the **same** imagery source preserves oblique texture
coverage; no second provider or canvas. Actual drawn imagery, local rendered
route, GPX/DEM agreement, mesh picking, rider opacity, registration and frame
margin gate reveal. Unverified frames are hidden and end in an explicit linked
2D/profile fallback, not a blank frame or automatic retry loop. SDK failure can
be retried only through another explicit Enable.

## Earlier automated validation — historical commands and outcomes

Combined focused command at that stage:

```
node --test tests/route-flyover.mjs tests/route-flyover-browser.mjs tests/route-playback.mjs tests/route-briefing.mjs tests/recorded-replay.mjs tests/route-time.mjs
```

**51 passed, 1 failed (native fullscreen; details below), 52 total.**

- All seven actual approved analyses: camera/state invariants at start,
  steepest window, quarter/middle/90%/finish; exact model/source projections;
  explicit unsupported/private/revision mismatch gates.
- Native installed Chrome **158.0.8127.88**, macOS, existing headless CDP
  harness, packaged `/kotr27/` artifact, fresh isolated profiles.
- 375px, reduced motion, rapid camera controls, native keyboard and touch
  camera selection; no provider requests before opt-in; denied SDK produces
  linked fallback without changing distance.
- Real pinned Mapbox GL 2.15 WebGL, with **synthetic local provider rasters**,
  not real geographic DEM/satellite qualification. Actual D1, D3L and D4L
  geometry at mid-route, four jobs each: all 12 frame/registration/road/imagery
  checks succeeded. Independent GL pixel sampling found over 96% fixture
  imagery and visible orange route pixels in the targeted frames.
- Native mouse drag was observed after the SDK's gesture frame, then Return
  to rider retained position. Injected missing DEM and mesh occlusion ended
  in explicit fallback. The corrective diagnostic run described below also
  completed native cinematic motion, background disposal/no automatic resume,
  explicit re-enable and context-loss fallback, independently of fullscreen.

Final regression command:

```
node --test tests/release.mjs tests/route-briefing-browser.mjs tests/local-routes.mjs tests/local-routes-browser.mjs
```

**39/39 passed.** Includes allowlisted deterministic builds and transitive
fingerprints, release lifecycle, 320/375/1280px linked briefings, all seven
routes, native private GPX/FIT imports, timestamp/spatial gaps, recording
navigation, source-time preservation, no external private centers, storage
denials and cross-tab deletion. Build tests write disposable artifacts outside
the source root and preserve private intake.

`node --check` on both changed classic scripts, three new modules, site shell
and build tool passed. `git diff --check` passed.

Earlier failures were retained as failures until corrected: an oblique
imagery-cover gap led to the same-source coarse-cover correction; release
expectations were updated for the actual new dependency graph; native gesture
assertions now wait for the SDK gesture frame rather than asserting before it.
No acceptance criteria were weakened.

## Historical browser blockers — superseded by the current explicit deferrals

1. **Safari execution unavailable, not a product PASS.**
   `/usr/bin/safaridriver --version` returned
   `Included with Safari 27.2 (21625.2.8.18.4)`.
   Started `/usr/bin/safaridriver --port 48112`, then requested
   `POST /session` with Safari capabilities using curl's 20-second deadline.
   It timed out with zero response bytes and no session ID. A read-only
   `GET /status` returned `ready:true`; `GET /sessions` was unsupported.
   Neither proved a usable session or the outcome of the original creation.
   The owned driver process was stopped; no blind second creation, settings
   change or permission bypass occurred. The caller/operator must reconcile
   Safari's automation availability. The caller subsequently authorized the
   longer diagnostic attempt below; that attempt returned a definitive session
   creation failure. Safari task journeys remain unverified.
2. **Historical headless Chrome fullscreen rejection — now operator-deferred.**
   The native mouse click hit `flyover-fullscreen`, focused that button, and
   the API reported `document.fullscreenEnabled === true`, but no fullscreen
   element appeared and the UI reported “Fullscreen unavailable in this
   browser. All controls remain available here.” The targeted rerun retained
   the failure with those diagnostics. The corrective run below captured the
   actual rejection, `TypeError: not granted`, with trusted input, active user
   activation and a connected, correct element. No activation/connectivity
   defect was found. The caller/operator must disposition this native denial
   before fullscreen qualification; no settings or alternative browser harness
   were substituted. Moving/background/context-loss checks are now complete.

At that stage no live geographic provider, physical-device, Safari, or
production-origin qualification was claimed. The parent-supplied live-provider
MCP observations above are later evidence, not retroactive passes for these
earlier runs. The independent reviewer still owns acceptance.
No discovered beads were created (Beads writes were explicitly forbidden).
Nonprogress recovery allowance remains **0/2**: corrections above produced
specific progress; the outstanding availability failures were diagnosed and
suspended, not bypassed.

## Historical differential diagnostic pass (09:42–09:44 UTC)

Only `tests/route-flyover-browser.mjs` and this evidence document changed in
this pass. Production code was not changed to evade an availability failure.
The test records the trusted click in capture phase, activation/connectivity
immediately before invoking the actual native API, and the rejected exception.
It retains the native fullscreen assertion at the end, allowing independent
motion/background/context-loss assertions to run even if fullscreen fails.

### Chrome command and result

```
node --test --test-name-pattern='real WebGL' tests/route-flyover-browser.mjs
```

**1 test failed; no overall PASS.** All 12 representative-route camera/frame
checks passed again. Native fullscreen evidence:

```
click: isTrusted=true; target=currentTarget=flyover-fullscreen;
       connected=true; userActivation.isActive=true; hasBeenActive=true
invocation: id=route-flyover; tag=SECTION; connected=true; sameRoot=true;
            activeDocument=true; document.hidden=false; fullscreenEnabled=true;
            userActivation.isActive=true; hasBeenActive=true
rejection: name=TypeError; message="not granted"; fullscreenElement=null
```

This rules out the proposed lost-activation and detached/incorrect-target
hypotheses for the observed failure. It establishes an actual browser refusal,
not its underlying OS/harness policy reason. No further fullscreen attempt or
permission bypass was made after capturing this denial.

Independently completed in that same native run:

- Cinematic playback advanced the shared distance by more than ten metres
  while retaining Cinematic; pause/seek restored the exact selected distance.
- Activating a fresh `about:blank` target made the route tab genuinely hidden.
  Its sole canvas was disposed and route distance stayed unchanged.
- Closing only that owned target restored visibility without automatic 3D
  resume. Explicit Enable produced a ready frame again.
- Injected WebGL context loss disposed the canvas, retained distance and
  produced the explicit linked fallback.

### Safari commands and result

Before the fresh attempt, `curl --silent --show-error --max-time 5
http://127.0.0.1:48112/status` failed with connection refused (curl exit 7).
Read-only `ps` inspection confirmed no old safaridriver process; a transient
`--help` process was separately rechecked and was gone. No live old endpoint
or owned session remained. The 50 foreign and 11 private hashes matched.

Exactly one fresh driver and session request were made:

```
/usr/bin/safaridriver --port 48112 --diagnose
curl --silent --show-error --max-time 120 \
  -H 'Content-Type: application/json' \
  -d '{"capabilities":{"alwaysMatch":{"browserName":"safari"}}}' \
  -w '\nHTTP %{http_code}; elapsed %{time_total}s\n' \
  http://127.0.0.1:48112/session
```

Response at **30.009091 seconds: HTTP 500**, not the client's 120-second
timeout. Curl exited 0 because it successfully received the HTTP response;
**session creation failed**:

```
error: "session not created"
message: "Could not create a session: The session timed out while connecting
to a Safari instance. The following asynchronous operation timed out:
Request creation of a new automation session"
```

The owned native diagnostic file
`~/Library/Logs/com.apple.WebDriver/safaridriver.28735.sgojay.txt`
records the POST at `09:42:37.477` and the HTTP 500 at `09:43:07.485`.
`GET /status` subsequently returned HTTP 200 / `ready:true`; that is a driver
status, not a Safari session. No session ID, disabled-automation error or
interactive prompt was reported in the diagnostics.

`ps -p 28735 -o pid=,ppid=,etime=,command=` and
`lsof -nP -a -p 28735 -iTCP:48112 -sTCP:LISTEN` identified the owned
WebDriver HTTPService XPC PID matching the diagnostic log and loopback port.
The driver tool session `safari12long` was stopped normally. Afterwards the
endpoint again refused connections and PID 28735 no longer existed. No Safari
application, other driver's session, or shared process was killed.

Required disposition is now concrete: resolve Safari's automation-session
startup/connection failure and Chrome's fullscreen refusal in the existing
native environment. If Safari displays an authorization prompt, the operator
must handle it directly. The evidence does **not** establish a particular
disabled setting, so no setting change is prescribed or applied. Original
task testing remains authorized; this is an observed environment blocker, not
a new request for testing consent.

Nonprogress allowance remains **0/2**: the authorized diagnostic approach
produced a precise Chrome rejection, completed three previously unreached
native checks, and replaced Safari's unknown HTTP outcome with a definitive
internal startup timeout. Availability criteria remain unmet; no PASS,
commit, closure, model/tool fallback or blind retry is claimed.

Final checks after the diagnostic-only edit:

```
node --test tests/route-flyover.mjs tests/route-playback.mjs tests/route-briefing.mjs tests/recorded-replay.mjs tests/route-time.mjs
node --test --test-name-pattern='native Chrome packaged controls' tests/route-flyover-browser.mjs
node --check tests/route-flyover-browser.mjs
git --no-pager diff --check
git --no-pager diff --cached --exit-code
git --no-pager log -1 --format='%h'
git branch --show-current
```

Results respectively: **50/50 passed; 1/1 passed; syntax passed; whitespace
passed; empty index unchanged; `7f227ca`; `epic/kotr27-800`.** These commands
did not repeat the rejected fullscreen call. All 50 protected foreign and
11 private SHA-256 hashes still match the supplied baseline. The earlier
39/39 packaged regressions remain the latest run of those unchanged production
paths; they were not redundantly rerun for this test/documentation-only edit.

## Historical bounded follow-up and fullscreen deferral (after 11:42 UTC)

The operator confirmed Safari's **Allow Remote Automation is already enabled**.
It was not toggled, questioned again, or treated as a new consent prerequisite.
During this follow-up the operator separately deferred native fullscreen
qualification, explicitly permitting later bugfixing. Fullscreen remains
implemented with its error fallback, **UNVERIFIED / DEFERRED**, not a PASS.
No further fullscreen request or visible Chrome launch was made after that
disposition.

### Accurate test separation

`tests/browser.mjs` now has a narrowly scoped `{headless = true}` option.
Default callers receive the identical existing startup flags and isolated
profile/owned-process cleanup. The opt-in qualification test selects
`headless:false`: a normal visible installed Chrome, no permission overrides
or CDP grants. It records real click activation/connectivity, API rejection,
browser version and native window bounds/state, and retains the assertion that
`document.fullscreenElement.id` must actually equal `route-flyover`.

Future optional command (**not run in this pass**):

```
KOTR_FLYOVER_FULLSCREEN=1 node --test --test-name-pattern='native visible Chrome fullscreen' tests/route-flyover-browser.mjs
```

Without that opt-in, the separate check is explicitly skipped with
`DEFERRED / UNVERIFIED by operator; not a product PASS`. The mandatory camera,
progress, manual, privacy and fallback checks do not invoke fullscreen.
The prior `TypeError: not granted` is evidence about the **headless** harness,
not proof that visible native Chrome cannot provide fullscreen.

An initial non-fullscreen rerun returned 22 passed, 1 failed, 1 deferred:
the D4L native drag did not enter Manual before the assertion deadline.
The old gesture aimed at the rider's DOM marker in the canvas center. The
harness now waits for scrolled layout to settle, selects empty map space,
asserts the actual hit-tested element is the canvas, and records native/SDK
gesture events on failure. The unchanged Manual and return-to-rider assertions
then passed. This changes the input target/readiness, not product behavior or
an acceptance threshold; the earlier failure is not labeled a pass.

Actual final commands:

```
node --test tests/route-flyover-browser.mjs tests/route-flyover.mjs tests/route-playback.mjs
node --test tests/release.mjs
node --test --test-name-pattern='quota abort|recorded replay: native upload' tests/local-routes-browser.mjs
node --check tests/browser.mjs
node --check tests/route-flyover-browser.mjs
git --no-pager diff --check
```

Results: **23 passed, 0 failed, 1 explicitly deferred fullscreen check**;
**3/3 release tests passed**; **2/2 selected native privacy/replay tests passed**;
syntax and whitespace checks passed. All 12 actual-route/synthetic-raster frame
checks, native drag/Return, cinematic advancement, hidden-tab disposal,
explicit re-enable and context-loss fallback completed. No real geographic
DEM/satellite or physical-device qualification is implied.

### Safari differential diagnosis: no unchanged session retry

Read only the known owned log:
`~/Library/Logs/com.apple.WebDriver/safaridriver.28735.sgojay.txt`.
It contains the same 30-second automation-session handoff timeout, with no
additional application error or permission denial. The old loopback endpoint
still refused connections:

```
curl --silent --show-error --max-time 5 http://127.0.0.1:48112/status
/usr/bin/safaridriver --version
sw_vers
launchctl managername
launchctl manageruid
stat -f '%Su' /dev/console
```

Results: curl exit 7 / connection refused; Safari driver
`27.2 (21625.2.8.18.4)`; macOS `26.7.3 (25G342)`; `Aqua`; UID `502`;
console user `eric.bowman`. Targeted read-only `ps` process names/start times
and application `Info.plist` fields showed Safari PID **19168**, started
2026-11-24 22:02:53, using the same cryptex Safari **27.2 / 21625.2.8.18.4**.
No driver/service from the prior attempt remained.

The following AppKit query reads launch-state metadata, not Safari Apple
Events, tabs, history or page contents:

```
osascript -l JavaScript -e 'ObjC.import("AppKit"); var apps=$.NSWorkspace.sharedWorkspace.runningApplications; var result=[]; for (var i=0;i<apps.count;i++){var a=apps.objectAtIndex(i); if(ObjC.unwrap(a.bundleIdentifier)==="com.apple.Safari") result.push({pid:Number(a.processIdentifier),finishedLaunching:Boolean(a.isFinishedLaunching),active:Boolean(a.active),hidden:Boolean(a.hidden),terminated:Boolean(a.terminated),bundleURL:ObjC.unwrap(a.bundleURL.path)});} JSON.stringify(result);'
```

It returned PID 19168, `finishedLaunching:true`, `active:false`,
`hidden:false`, `terminated:false`, with the expected installed Safari path.
Thus this is not an absent/unlaunched app, a driver/app version mismatch, or
an obvious non-Aqua execution context. The precise remaining Safari handshake
cause is **not established** by these non-private observations. No
operator-free changed-context hypothesis was established; consequently no
new driver or identical session POST was started.

**Narrow prerequisite:** bring the already-running Safari to the foreground,
finish/dismiss any visible blocking startup/modal dialog if present, and leave
it foreground for the next bounded handoff test. Report whether a dialog was
present. This tests the remaining foreground/modal handoff hypothesis against
the observed background-but-launched app and the driver's timed-out request;
it is not a claim that a dialog exists or foregrounding is a proven fix.
Do not toggle the already-enabled setting, close user tabs, or restart Safari.
That operator-supplied context change would justify a differential retry;
without it, repeating the unchanged request would not add evidence.

Safari qualification remains the concrete mandatory blocker; fullscreen no
longer blocks acceptance under the explicit disposition. Count this unresolved
Safari differential investigation as **1/2 cumulative nonprogress recovery
attempts**, conservatively: the native Safari acceptance gap did not decrease.
The successful Chrome suite does not reset that count. No further recovery
cycle was spent on fullscreen.

This pass changes only `tests/browser.mjs`,
`tests/route-flyover-browser.mjs`, and this document. All original production
edits remain unchanged from the parent's blocked baseline; 50 foreign and
11 private hashes, HEAD `7f227ca`, branch `epic/kotr27-800` and the empty index
are preserved. No Beads writes, commit, closure or discovered task.

## Historical final owned Safari attempt after routine focus (11:51–11:53 UTC)

The caller focused the existing Safari using normal `open -a Safari`.
The initial app-state read no longer showed it active, so this implementer also
used the same ordinary focus command—no human ceremony, permission change,
restart, tab inspection or shared-process termination was necessary.
AppKit then reported `frontmostBundle: com.apple.Safari`, PID 19168,
`isActive:true`, `finishedLaunching:true`, `isHidden:false`,
`isTerminated:false`.

The previous driver PID/service and endpoint were absent. Started exactly one
owned driver:

```
/usr/bin/safaridriver --port 48112 --diagnose
```

The first curl invocation raced listener startup and failed to connect:
curl exit 7, HTTP 000, elapsed 0.000378 seconds. It delivered no HTTP request.
A read-only `GET /status` then returned HTTP 200 / `ready:true`, identifying
owned launcher PID **62004** and HTTPService PID **62080**. Only after that
reconciliation was the sole delivered session POST sent:

```
curl --silent --show-error --max-time 120 \
  -H 'Content-Type: application/json' \
  -d '{"capabilities":{"alwaysMatch":{"browserName":"safari"}}}' \
  -w '\nHTTP %{http_code}; elapsed %{time_total}s\n' \
  http://127.0.0.1:48112/session
```

**Evidence limitation:** the non-private foreground metadata query immediately
before this POST reported another application (`com.p5sys.jump.mac.viewer`),
not Safari. Safari had been focused successfully but did not retain foreground.
This attempt therefore does **not** establish the result of a sustained-
foreground experiment. The request was delivered once; there was no additional
refocus-and-create loop after this observation.

Actual response: **HTTP 500 at 30.189771 seconds**, error `session not created`:

```
Could not create a session: The session timed out while connecting to a
Safari instance. The following asynchronous operation timed out:
Request creation of a new automation session
```

The owned native log
`~/Library/Logs/com.apple.WebDriver/safaridriver.62080.srthjp.txt`
records exactly **one** POST at `11:52:33.724`, then HTTP 500 at
`11:53:03.908`. There was no session ID, explicit permission denial or reported
dialog. No native Safari route/camera/control/fallback journey could run.
This is not a product PASS, nor evidence that the already-enabled Remote
Automation setting should be toggled.

Stopped tool session `safari12foreground`. Afterwards:

```
ps -p 62004,62080 -o pid=,command=
curl --silent --show-error --max-time 5 http://127.0.0.1:48112/status
```

returned no owned processes and connection refused, respectively. Shared Safari
and every user window/tab were untouched. No Safari driver remains from this
attempt.

**Scoped STOP: cumulative nonprogress recovery 2/2 exhausted.** The same internal
timeout remains and Safari qualification is still mandatory. Do not repeat
session creation or request another routine focus action as though it were a
permission prerequisite. The parent must retain this concrete unfinished
criterion when deciding subsequent scope; no acceptance deferral for Safari
has been granted. Fullscreen alone remains expressly deferred/unverified.

This final attempt changes only this evidence document. The latest mandatory
Chrome/model run remains 23 passed, 0 failed, 1 operator-deferred fullscreen
check; release 3/3 and targeted privacy/replay 2/2 results remain unchanged.
All original production edits, 50 foreign and 11 private hashes, HEAD
`7f227ca`, branch `epic/kotr27-800`, and empty index were reverified unchanged.
No Beads writes, staging, commit, closure or discovered task.
