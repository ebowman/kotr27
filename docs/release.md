# Publishing the route preview

The local project is **not** the Pages tree. Do not publish this checkout,
its Git history, or a recursive copy of it: it includes private project and
issue tooling. For development, serve the unbuilt checkout on loopback
(`python3 -m http.server --bind 127.0.0.1 8000`) and open `/`. No build or
release check is needed while editing.

## Build and preview

From the local project root, with Node 22+:

```sh
node --test --test-concurrency=1 tests/flyover.mjs tests/release.mjs
stage=$(mktemp -d)
node tools/build-release.mjs "$stage/kotr27"
python3 -m http.server --bind 127.0.0.1 --directory "$stage" 8001
```

Tests need Chrome (`CHROME` can specify its executable) and substitute a
dummy config. Open `http://127.0.0.1:8001/kotr27/` for the packaged preview.
Stop the preview with Ctrl-C. Build into a **new** directory for each release.
Its only files are `index.html`, `.nojekyll`, and four fingerprinted files from
`assets/` and `js/config.js`. Config is already browser-visible: use only the
intended public, origin-restricted browser configuration there, never private
credentials. The build does not need environment secrets.

## Publish the artifact, not the source

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

Local URLs depend only on content. GPX is named first; the flyover script is
hashed **after** embedding that GPX name. The entry marker covers the final
asset references, markup and check code. Identical inputs produce identical
output; no timestamp or hand-edited version is required. Vendor URLs are not
rewritten.
