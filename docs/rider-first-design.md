# Rider-first preview · kotr27-n00.1

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
geometry replace the technical preamble. The normal opening contains **59 desktop
/ 55 phone visible whitespace tokens**, even including attribution and symbols.
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
Standard maps the source “short” variant (or Warm-up); D1–D4 are not dates.

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

Parent's fresh MCP connection subsequently failed at `Target.setDiscoverTargets`
(`Target closed`). No connector bypass/settings change was attempted. The checks
below use the repository's existing **native installed Chrome/CDP** test helper,
as separately authorized, not MCP and not a substitute claim of owner approval.

## Validation and evidence

```sh
node --test prototypes/rider-first/check.mjs
node --test prototypes/rider-first/terrain-check.mjs
node --check prototypes/rider-first/app.mjs
node --check prototypes/rider-first/serve.mjs
```

2026-11-25: deterministic Chrome checks pass for both target sizes, copy budget,
no horizontal overflow, opening CTA visibility, actual route totals, all seven
route selections, Standard/Long distinction, Standard-only, long-title layout,
entry/back, play/pause, seeking, keyboard focus, profile/header separation,
reduced motion, denied provider, no application storage writes and server isolation.
No dependencies installed. Node syntax checks pass for all four `.mjs` files;
this is not a project-wide lint or regression-suite claim.

Live provider observation also succeeded: HTTP 200 imagery/SDK, telemetry 204;
existing adapter reported framed/aligned/elevation/clear/road/imagery **all true**.
Seek to halfway, play, pause advanced to 32.6 km with a valid terrain frame at
desktop and phone sizes. These are bounded observations, not availability or
whole-route guarantees. Initial height and phone provider-credit collisions were
found during rendering, corrected, and rechecked.

Review correction: the playback test previously sampled after a fixed 350 ms,
but playback advances on animation frames, with its first frame initializing
the clock and the distance label rounded to 0.1 km. A natural diagnostic advanced
normally; a controlled 450 ms first-frame deferral reproduced `0.0 km` at the
old deadline, then `0.1 km` at about 540 ms without any application change.
This confirms the test's scheduling assumption; it does not reconstruct the
reviewer's exact host scheduling. The test now waits at most five seconds for
**distance, profile position and rider marker** all to advance, while requiring
the running control state, visible page and no browser exceptions. A stalled
player still fails; pause stability and the remaining interaction checks remain.
Correction validation: normal combined checks passed 2/2 and standalone
`check.mjs` passed 1/1, with capture unset; the delayed-first-frame diagnostic
also passed the corrected assertions. All 12 existing PNG SHA-256 hashes stayed
identical. In this combined run, live terrain entry had all proof flags true,
but later seek/play/pause samples had `clear:false` / `ok:false`. The observational
helper passed its assertions; those later samples are **not** a fresh terrain
readiness qualification and do not replace the earlier captured evidence.

`prototypes/rider-first/evidence/` contains actual Chrome captures:

- `desktop-landing.png`, `phone-landing.png`: normal first views.
- `desktop-live-provider.png`: real terrain immediately after entry.
- `desktop-live-summit.png`, `phone-live-summit.png`: actual terrain after seeking
  and playback near the high section (filename is descriptive, not a summit POI).
- `desktop-player-unavailable.png`, `phone-player-unavailable.png`: intentionally
  blocked provider, honest 2D fallback.
- `desktop-profile.png`, `phone-profile.png`: working profile/seek in fallback.
- `phone-standard-only.png`, `phone-long-name.png`,
  `phone-reduced-motion-2d.png`: deliberate edge layouts.

Normal checks do not create directories or write screenshots; existing evidence
stays unchanged. Capture is explicitly opt-in (paths are relative to the shell's
working directory):

```sh
RIDER_FIRST_EVIDENCE_DIR=prototypes/rider-first/captures node --test prototypes/rider-first/check.mjs
RIDER_FIRST_EVIDENCE_DIR=prototypes/rider-first/captures node --test prototypes/rider-first/terrain-check.mjs
```

These commands write to a separate capture directory, leaving the reviewed
`evidence/` PNGs intact. Existing filenames in the explicitly selected destination
are overwritten. Unset `RIDER_FIRST_EVIDENCE_DIR` for independent read-only review.
Review images as well as assertions. Screenshots are evidence, never runtime
backgrounds. Fresh independent review and human pixel approval remain outstanding;
production changes stay blocked by kotr27-n00.2.
