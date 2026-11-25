# Rider-first preview · kotr27-n00.1 / n00.10 correction

**Owner approval is pending.** This is an isolated design prototype, not a
production redesign, itinerary assignment or deployment. Independent review
assesses readiness to present it; only the human can pass kotr27-n00.2.

## View it

From the physical project root:

```sh
node prototypes/rider-first/serve.mjs 4177
```

Open **http://127.0.0.1:4177/prototypes/rider-first/**.
Stop with Ctrl-C. The helper binds only loopback, uses a finite public dependency
allowlist, rejects symlink substitutions and foreign Host headers, and serves no
repository directories, private intake, production HTML, tests or documentation.
Nothing is published. Validation helpers stop their own server and Chrome.

Review at **1440×900** and **375×812**. Useful deliberate states:

- `?terrain=off`: first-party 2D only, including after Fly.
- `?route=standard-only`: the actual Warm-up route, Standard only.
- `?layout=long-name&terrain=off`: explicitly labelled landing-title stress sample,
  still using actual Monte Grappa geometry and metrics.
- Browser reduced-motion preference: paused initially and on every route change.

## What changed in the experience

Warm limestone, deep green, restrained ochre, large route typography and actual
geometry replace the technical preamble. The normal opening contains **60 desktop
/ 56 phone visible whitespace tokens**, even including attribution and symbols.
Event/place/date, the selected route, both metrics and Fly are above the fold.

Fly replaces the page with the available viewport. Back, route, Play/Pause and
Profile remain visible; camera and demo details live under More. Profile seeking
and route changes work. Focus is retained across entry/back, variant rebuilding
and keyboard navigation. There is no auto-play, including with reduced motion.
My week / Essentials open explicitly preview-only information, not fake planners.

The 2D surface is labelled as an outline, **not 3D**. Playback is an illustrative
90-second traversal of real geometry, not a pacing/ride-time model. Terrain is
real when available, but this is not a full production integration: no saved
preferences, itinerary writes, imports, offline install, fullscreen or publication.
No application storage API or production state/session module is used.

## Sources and intentional provider entry

The current public `assets/route-pack.json` pins the existing approved manifest.
The prototype reuses its hash-verified sanitized geometry and the existing pure
analysis loader. No second route dataset or private originals are copied.
Featured **Monte Grappa / rwgps-57873019: 63.2 km, 1,835 m** uses RWGPS-listed
totals; outline/profile elevations come from the source track and need not equal
listed gain. Standard changes that source group to **Asolo: 57.6 km, 837 m**,
not shortened Monte Grappa geometry. Other groups retain actual names and totals.
Standard maps the source “short” variant (or Warm-up).

Owner-confirmed ride order is now **D0, D1, D2, D3**, displayed in that order
in the chooser and consistently in selected identities/player options. Monte
Grappa stays featured by default. This shifts display labels only: immutable
catalog names/IDs/statistics remain unchanged, and no calendar dates are assigned.

| Source label | Display identity / variant | Canonical route ID |
|---|---|---|
| D1 | D0 Warm-up · Standard only | rwgps-57874121 |
| D2S | D1 Vicentine Hills · Standard | rwgps-57873183 |
| D2L | D1 Vicentine Hills · Long | rwgps-57874024 |
| D3S | D2 Asolo · Standard | rwgps-57873112 |
| D3L | D2 Monte Grappa · Long | rwgps-57873019 |
| D4S | D3 Brentha Valley · Standard | rwgps-57874050 |
| D4L | D3 Brentha Valley · Long | rwgps-57874076 |

No external request occurs before Fly. Its adjacent disclosure names Mapbox and
map-area requests. Explicit entry reuses the existing public configuration,
pinned Mapbox GL 2.15 loader and bounded terrain adapter. The SDK makes provider
imagery/elevation and telemetry requests; no private geometry is available.
Observed SDK storage: `mapbox.eventData.uuid:` on the **loopback preview origin**;
session storage stayed empty. This is provider telemetry, not a production
preference write; “no storage writes” in the deterministic test refers to the
application/2D path, not to the third-party SDK.
Mapbox / OpenStreetMap / Maxar attribution and Mapbox logo are retained on the
live map. The app adds no credentials and changes no provider settings.
Failed or timed-out imagery leaves the real route outline and working profile.
No provider retries run automatically; route changes / a new entry are intentional
new attempts. Network access is needed for terrain, not for rendering the outline
once the local public assets have loaded.

## 2026 browser comparison (provenance matters)

The **parent's actual Chrome MCP walkthrough** visited
https://ebowman.github.io/kotr26/ and played
https://ebowman.github.io/kotr26/flyover.html?route=KOTR_D3_Long.fit.
Parent observations: geographic hero, prominent place/date, readable day cards,
direct flyover entry; terrain fills the player and overlays recede during playback.
This prototype adopts that spatial priority, not the crowded control inventory.
It does not copy 2026 logistics, contacts or charity facts.

Implementer inspected these parent-captured screenshots (not a new live walkthrough):

- `/var/folders/ms/8skj9_fx6zs08v2ydsjcjjhc0000gp/T/chrome-devtools-mcp-1Q8JAA/screenshot.png`
  — **player overview**, with expanded help/profile; not a homepage screenshot.
- `/var/folders/ms/8skj9_fx6zs08v2ydsjcjjhc0000gp/T/chrome-devtools-mcp-ItsJx3/screenshot.png`
  — actual desktop playback, large terrain/rider surface, receded panels.
- `/var/folders/ms/8skj9_fx6zs08v2ydsjcjjhc0000gp/T/chrome-devtools-mcp-xYK35j/screenshot.png`
  — phone title/back collision and crowded narrow profile/telemetry: do not copy.

Parent's fresh MCP connection initially failed at `Target.setDiscoverTargets`
(`Target closed`). After the user quit Chrome and requested retry, the parent
reported MCP reconnected and independently observed continuous terrain followed
by one terminal fallback. That is parent evidence, not this implementer's browser
run. The checks below use the repository's existing **native installed Chrome/CDP**
helper, as separately authorized, not MCP or a claim of owner approval.

## Playback correction and remaining limitation

The original adapter hid its container on **every camera update**, then revealed
it on valid render proof; transient failed coverage/clearance also hid it. The
outline underneath therefore flashed even during successful playback. A new
deterministic adapter test failed on the original code at the first successful
motion update (`hidden`, expected `visible`).

The minimal shared-adapter correction separates presentation from verification:
initial terrain still requires valid proof; subsequently it stays visible during
the existing bounded verification interval, explicitly labelled “verifying view.”
Motion invalidates old frame evidence; invalid proofs remain false. Persistent
failure still disposes the map once, with honest stable 2D fallback. No camera,
proof threshold, tile budget, timeout or automatic-retry policy was relaxed.

**Whole-route terrain is not qualified.** In an isolated live-provider comparison,
the exact baseline adapter from `d26a263` was supplied only to the owned test
browser's local module request (no file/provider substitution). Baseline produced
74 hides before terminal fallback at **12.9 km / 18.3 s**; corrected code produced
zero hides before the same terminal location/time, then one stable fallback.
The corrected failed frame had `clear:false`, marker opacity 1 and a **34.8 m**
mesh-pick discrepancy against the unchanged **8 m** clearance rule; other proof
flags were true. Thus early clearance fallback predates this correction, but is
not proven unavoidable. Follow-up **kotr27-7k3** records this limitation, open and
unclaimed; camera/mesh-clearance remediation is not folded into the visibility fix.
Parent MCP independently reported the same pattern near
12.8 km. The user's preview listener on 4177 was not restarted or stopped.

## Validation and evidence

```sh
node --test prototypes/rider-first/check.mjs prototypes/rider-first/terrain-check.mjs tests/route-flyover.mjs tests/route-flyover-browser.mjs
node --check prototypes/rider-first/app.mjs
node --check js/route-terrain-view.mjs
git diff --check
```

2026-11-25 correction: combined focused run **10 passed, 0 failed, 1 explicitly
deferred fullscreen check**. Syntax checks pass for all six changed `.mjs` files;
`git diff --check` passes. This is not a project-wide lint/regression claim.
Deterministic Chrome checks pass for both target sizes, copy budget,
no horizontal overflow, opening CTA visibility, actual route totals, all seven
route selections, Standard/Long distinction, Standard-only, long-title layout,
entry/back, play/pause, seeking, keyboard focus, profile/header separation,
reduced motion, denied provider, no application storage writes and server isolation.
All seven route labels/order, variants and totals pass at both sizes. Phone
spacing retains the opening CTA **and full provider disclosure**. No dependencies
were installed. Deterministic adapter checks cover transient imagery/clearance/
road/elevation failure, seek, fixed outage/load deadlines, tile-budget exhaustion,
provider/context failure, disposal and rejection of late events.

Live provider: HTTP 200 imagery/SDK, telemetry 204. At each size, eight seconds
from start advanced **0→5.6 km** with zero hides; the halfway seek at **31.6 km**
had all proof flags true. A further eight-second post-seek observation advanced
to **37.2 km**, including a persistent `clear:false` and exactly one stable terminal
fallback. Continuous RAF + style-mutation observation found no hidden-online
frames or repeated surface switching. Route change/back/re-entry cleanup passed.
This proves bounded continuity and honest fallback, not uninterrupted terrain
through the route. No new services were left running.

Existing native adapter tests initially assumed visible meant verified; those
assertions now require current proof/status while confirming focus refresh keeps
terrain visible. A separate fixture race sought a null controller position
before terrain was enabled; navigation now waits for the exact shared route/
revision position. Native input, real WebGL pixel/proof and terminal-fallback
checks all pass, with synthetic provider rasters explicitly distinct from live
geographic imagery. The final normal run with capture unset preserved all 12
capture SHA-256 hashes exactly.

`prototypes/rider-first/evidence/` contains actual Chrome captures:

- `desktop-landing.png`, `phone-landing.png`: normal first views.
- `desktop-live-provider.png`: real terrain immediately after entry.
- `desktop-live-summit.png`, `phone-live-summit.png`: actual verified terrain paused
  at halfway after start playback, before the longer post-seek observation
  (filename is descriptive, not a summit POI or whole-route qualification).
- `desktop-player-unavailable.png`, `phone-player-unavailable.png`: intentionally
  blocked provider, honest 2D fallback.
- `desktop-profile.png`, `phone-profile.png`: working profile/seek in fallback.
- `phone-standard-only.png`, `phone-long-name.png`,
  `phone-reduced-motion-2d.png`: deliberate edge layouts.

All 12 captures displayed changed route labels, so they were regenerated and
visually inspected. Normal checks do not create directories or write screenshots.
The actual opt-in refresh commands were:

```sh
RIDER_FIRST_EVIDENCE_DIR=prototypes/rider-first/evidence node --test prototypes/rider-first/check.mjs
RIDER_FIRST_EVIDENCE_DIR=prototypes/rider-first/evidence node --test prototypes/rider-first/terrain-check.mjs
```

Existing filenames in that explicitly selected destination are overwritten.
Unset `RIDER_FIRST_EVIDENCE_DIR` for independent read-only review.
Review images as well as assertions. Screenshots are evidence, never runtime
backgrounds. Fresh independent review and human pixel approval remain outstanding;
production changes stay blocked by kotr27-n00.2.
