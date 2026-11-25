# Publishing the public companion artifact

Current full-companion evidence and explicit publish/rollback handoff:
[kotr27-800.21 qualification](final-qualification.md). The historical preview
results later in this file are not full-site qualification. Chrome-only scope,
deferred browsers/fullscreen and outstanding review/performance disposition
are explicit in that report. No publication is authorized by these instructions.

The source and full Git history live in `ebowman/kotr27`, as requested by the
project owner on 2026-11-25. Pushes to `main` run
`.github/workflows/pages.yml`, which builds and deploys the website to GitHub
Pages. This replaces the earlier separate, artifact-only repository workflow.
Ignored private route originals and local issue data remain local; do not add
them to Git. Pages serves the generated site, not a recursive copy of the
source checkout. For development, serve the unbuilt checkout on loopback
(`python3 -m http.server --bind 127.0.0.1 8000`) and open `/`. No build or
release check is needed while editing.

## Build and preview

From the local project root, with Node 22+:

```sh
stage=$(mktemp -d)
node tools/build-release.mjs "$stage/kotr27"
mkdir "$stage/shots"
RIDE_PACKAGE="$stage/kotr27" RIDE_SHOTS="$stage/shots" \
  node --test --test-concurrency=1 tests/ride-clock.mjs tests/rider-controls.mjs tests/release.mjs
python3 -m http.server --bind 127.0.0.1 --directory "$stage" 8001
```

Tests need Chrome (`CHROME` can specify its executable). The rider walkthrough
uses the real package with external requests blocked. Open
`http://127.0.0.1:8001/kotr27/` for the packaged preview.
Follow **Try the ride clock** to `/kotr27/explore.html`. Scrub without inputs,
compare the two markers at the same minute, tap a chapter for grade and moving
time, or select **Use my FTP**. Under **Pace & stop**, add a café stop to Plan B
at 9 km. The chapter links seek the flyover only when followed.
Stop the preview with Ctrl-C. Build into a **new** directory for each release.
The current normal candidate contains **76 files**, including both entries,
`.nojekyll`, the fingerprinted first-party module/data graph, seven cleared
route bundles and offline manifest/worker. Use the validated manifest rather
than this count as the release authority. No fixture B/withdrawal revisions
are part of a normal build. Keep screenshots
outside that directory. Config is already browser-visible: use only the
intended public, origin-restricted browser configuration there, never private
credentials. The build does not need environment secrets.

## Public distribution gate

The project owner confirmed clearance on 2026-11-21 for the shipped Semonzo
GPX and its elevations on the KOTR 2027 site. See the [provenance
record](semonzo-chapters.md) for the trace identity and attribution. The
companion derives its chapters on the visitor's device and ships no second
elevation dataset. Clearance resolves the data-rights gate; it does not
itself request a deployment.

The user's 2026-11-24 clearance also covers the seven route names, geometry
and sanitized downloads; see [intake](route-intake.md) and
[import/revision contract](route-import.md). Raw FIT originals remain private,
public FIT export unavailable, and GPX cue-limited. Event logistics, day/calendar
mapping, departures and fundraiser remain pending. This does not clear any
2026 participant information or authorize deployment.

For the bounded artifact-only MCP server (20 minutes, no source/fixtures):

```sh
node tools/qualification-preview.mjs /tmp/kotr27-new-review-artifact 48129
```

Use a new external destination. The command prints the actual release and URL;
it refuses to replace an existing output and never takes over another listener.

## After authorization only: push main and deploy

The Git remote is `https://github.com/ebowman/kotr27.git`. GitHub Pages uses
GitHub Actions as its build source. After merging reviewed work into `main`:

```sh
git push origin main
gh run list --repo ebowman/kotr27 --workflow pages.yml --limit 5
```

The workflow uses Node 22 and `tools/build-release.mjs`, including the
fingerprinted assets and offline manifest/worker. Only that generated output
is uploaded as the Pages artifact; source history stays in the Git repository.
After the workflow succeeds, revisit `https://ebowman.github.io/kotr27/`.
Future pushes to `main` automatically repeat this build and deployment.

## What returning visitors see

Every packaged page revalidates the ordinary HTML on `pageshow`, including a
back/forward-cache restore. A successful response updates the ordinary HTTP
cache. A different build marker triggers one replacement navigation with the
new marker in the query; matching HTML restores the original address without
another load. An unexpected response on that navigation cannot cause a loop.
Unchanged HTML, missing markers and failed probes leave the current page and
controls alone. This is not an offline installer: uncached assets still need
the network. Visitors with **pre-fix HTML** have no check yet and can see the
old page for its remaining Pages cache lifetime (normally up to 600 seconds).

Local URLs depend only on content. GPX is named first; the flyover script and
profile module are hashed **after** embedding that GPX name. Module imports
are rewritten dependency-first before hashing each importer. Each entry marker covers its final
asset references, markup and check code. Identical inputs produce identical
output; no timestamp or hand-edited version is required. Vendor URLs are not
rewritten.

## Local qualification · kotr27-2r7.6

Two builds of the actual checkout compared byte-for-byte equal (13 files).
All ten asset names matched the first 24 hex digits of SHA-256 of their final
bytes. The allowlist test also changes the GPX in an isolated fixture: the
flyover, profile loader and rider entry module acquire new names; both ordinary
HTML routes pick up the change on a warm visit under `/kotr27/`. Both work
from a primed cache when offline. This is not a promise of cold offline use.
The JSON reference, docs, tests, private project files and tools are absent.
The packaged browser-derived distance, four chapter records and all 75 window
records matched the private reference exactly.

| Packaged walkthrough (Chrome, 320 and 1200 CSS px, Mapbox blocked) | Observed result |
|---|---|
| Follow the flyover’s example link; leave both fields empty; guess High step. | The route is explicitly unconfirmed. The distance axis spans 18.89 km; Robin’s moving-time axis spans about 163 min. Long lift takes 80 min (49%): 9 km at 8.6% consumes more time than the steeper 2.5 km High step (28 min, 17%). The ordered text gives the same answer as the graph. |
| Enter only FTP, 250 W. Compare 70% and 80%; add a 15-minute café stop to B. | Both plans retain the assumed 75 kg rider and 12 kg kit. Moving time falls from 144 to 127 min; Long lift accounts for the largest difference (9 min). B’s elapsed time becomes 142 min; neither its moving time nor pedal work changes with the stop. Gravity work is unchanged between paces; drag need not be. |
| Supply weight, convert kg/lb, enter invalid FTP, then clear FTP and finally reset. | The conversion preserves the estimate. Invalid FTP is marked invalid with an associated explanation; stale graph and plans disappear. Weight alone uses the labeled example FTP. Clear returns the fictional example. |
| Use Tab, Enter and native select keys under reduced motion. | Reveal and axis switching preserve reading order with no active animation. Chrome’s accessibility tree exposes the page, question, chapter readout and comparison headings in order, and the FTP field by label. Body contrast 11.23:1; white chapter numbers 6.62–7.17:1. At 320 px the 10/15 km labels have a 28 px gap; no horizontal overflow. These are browser checks, not a human screen-reader or physical-device audit. |
| Watch browser requests and inspect the address and origin stores after scenario changes. | No request during edits, reveals or comparisons; no rider query or fragment. Cookies, local/session storage, IndexedDB, Cache Storage and service worker registrations were empty. The deliberate chapter link carried only `#seek-9000`; the offline flyover selected 9 km, focused seek and did not play. |

The opt-in `tests/live-overview.mjs` also exercised the **real** provisioned
package at 375 px with satellite access. Cold opening, Play → reset and
5200 m seek → reset retained textured imagery and the orange route (190–198
colour bins and 2,608–2,625 orange pixels in the measured viewport).
At 1200 px `tests/live-ride.mjs` reached the visible summit on both cold and
warm runs (152 s and 151 s). All 102 sampled ridge frames in each run showed
the 3D rider, and replay, pause, seek and reset remained usable.
No SDK substitution was used for either live check. These results qualify the local
artifact, not a deployment.

## Ride clock qualification · kotr27-bbl.3

The two fresh builds matched byte for byte. All 11 final asset names matched
their SHA-256 prefixes. Entry markers: flyover `08a906cdcb7ef0b0eb6d7d41`,
explorer `ab109c3143a612280d383c44`. In a separate warm-cache fixture, a GPX
change reached both ordinary Pages routes; a clock-only edit changed the clock,
its importer and the explorer marker, but not the flyover HTML.

| Chrome viewport check (320×568 and 1200×800, external requests blocked, reduced motion) | On the packaged site |
|---|---|
| Follow the ride-clock link without entering anything. | At 60 min, A was 6.8 km up Long lift and B was 7.7 km up. Both labeled markers and the scrubber fit on the first screen. At equal pace both read 6.8 km: the circle above and square below pointed to the same spot. |
| Select the café, step the clock and select chapter 03. | A advanced while B held at 9.0 km; B moved again after 15 min. High step averages 10.9% but takes only 28 min in A; the gentler Long lift takes 80 min. |
| Enter just 250 W. | At 60 min, A reached 7.7 km and B 8.7 km. With the assumed 75 kg rider, 70% versus 80% FTP gave 144 versus 127 moving minutes. The café raised B to 142 elapsed minutes without changing pedal work. |
| Use the keyboard and follow a chapter link. | Home/End reached start/summit, and Enter stepped the clock. No requests during edits, rider URL parameters or origin-store entries. Only deliberate navigation sent the browser to `/kotr27/index.html#seek-9000`: seek focused at 9 km, no playback. |

The reviewed candidate was `/tmp/kotr27-bbl.3.oKR5Zk/kotr27`; sibling `shots/`
contains the viewport PNGs. These are local headless Chrome results, not a
physical-device certification or deployment approval.

The complete Node test set ran in two groups (24 core; 44 pinned-SDK/live),
with the real DEM fixture and all opt-ins enabled. First runs: 66 passed,
2 failed, 0 skipped. Both failures were 15 s Chrome `Target.createTarget`
timeouts before the checks began (warm release and pending DEM seek/reset).
Both passed on individual reruns. All 3 Python reference tests passed. The
live runs reached the visible summit in 153 s cold and 152 s warm, with the
rider visible in 103/103 ridge samples each time. The sibling TAP files
`qualification.tap`, `terrain-live.tap`, `warm.tap` and `dem-retry.tap` retain
both the initial results and the reruns.
