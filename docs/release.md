# Publishing the route preview

The local project is **not** the Pages tree. Do not publish this checkout,
its Git history, or a recursive copy of it: it includes private project and
issue tooling. For development, serve the unbuilt checkout on loopback
(`python3 -m http.server --bind 127.0.0.1 8000`) and open `/`. No build or
release check is needed while editing.

## Build and preview

From the local project root, with Node 22+:

```sh
node --test --test-concurrency=1 tests/flyover.mjs tests/rider-controls.mjs tests/release.mjs
stage=$(mktemp -d)
node tools/build-release.mjs "$stage/kotr27"
python3 -m http.server --bind 127.0.0.1 --directory "$stage" 8001
```

Tests need Chrome (`CHROME` can specify its executable). The rider walkthrough
uses the real package with external requests blocked. Open
`http://127.0.0.1:8001/kotr27/` for the packaged preview.
Stop the preview with Ctrl-C. Build into a **new** directory for each release.
Its only files are `index.html`, `explore.html`, `.nojekyll`, the four
fingerprinted flyover inputs (GPX, config, terrain and flyover scripts), and six
fingerprinted rider ES modules. Config is already browser-visible: use only the
intended public, origin-restricted browser configuration there, never private
credentials. The build does not need environment secrets.

## Public distribution gate

The project owner confirmed clearance on 2026-11-21 for the shipped Semonzo
GPX and its elevations on the KOTR 2027 site. See the [provenance
record](semonzo-chapters.md) for the trace identity and attribution. The
companion derives its chapters on the visitor's device and ships no second
elevation dataset. Clearance resolves the data-rights gate; it does not
itself request a deployment.

## After authorization only: publish the artifact, not the source

In the **separate public Pages repository** (`ebowman/kotr27`), use Settings →
Pages → Deploy from a branch, and select the public publication branch and
`/ (root)`. Use a clean, separate clone of that branch. Copy the **contents**
of `"$stage/kotr27"` (including `.nojekyll`), not its enclosing directory,
to the root of that clone. For a branch dedicated exclusively to generated
site files:

```sh
public=/absolute/path/to/separate-public-pages-clone
rsync -ani --delete --exclude='/.git' "$stage/kotr27/" "$public/"
# Inspect the dry run and destination before applying:
rsync -ai --delete --exclude='/.git' "$stage/kotr27/" "$public/"
git -C "$public" status --short
```

Review the changed path list, then commit and push that **public artifact**
as one release on the selected branch. Never point `public` at the local
project; do not copy private files even temporarily into the public repo.
After Pages finishes deploying, revisit the ordinary `/kotr27/` URL.

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
