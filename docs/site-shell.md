# Rider companion shell

`kotr27-800.7` · local implementation, not a deployment or full-site parity claim.

## What ships

Both entry pages share `js/site-shell.mjs`, `js/route-state.mjs` and
`assets/site.css`. Plan / Explore / Prepare / Ride week retain the same public
route/revision/chapter selection. The only live catalog remains the cleared
Semonzo example. Official days, variants, dates, logistics and redistribution
are explicitly pending. Trip building, downloads, training weeks, local imports,
weather and offline packs are not implemented by this shell.

Plan is the default entry; Explore starts with a no-map briefing. The existing
bare `explore.html` remains the fictional ride-clock entry. The example's
chapter list and derived profile work with online maps blocked and without FTP.
Optional flyover loads local config/terrain/controller scripts only when chosen;
both ride playback and preview motion start paused. Existing model fractions
and sensitivity's independent 80% default / 70–90% range are unchanged.

## State and links

`readSelection(url, catalog, profiles)` resolves all navigation through the
validated catalog, returning either a complete permitted bundle or an explicit
recovery state. Profiles are keyed by bundle revision, not route name.
`selectionLink(state)` emits only the public navigation allowlist:
`area`, `view`, `day`, `variant`, `route`, `rev`, `chapter`, `at` (metres).
It never copies an existing query, rider fields or local IDs.

Areas: `plan`, `explore`, `prepare`, `ride-week`.
Implemented views: `briefing`, `clock`, `sensitivity`, `flyover`.
The helper chooses the appropriate HTML entry; both pages consume the same
contract. Route/revision changes clear section and distance. Selecting a
chapter uses its revision-bound start distance. Area switches preserve it.
This is active exploration, **not an itinerary or remembered rider profile**.

Area/route/revision/chapter/view actions push history; continuous flyover seeks
replace it. Popstate, fragment changes, refresh and bfcache restoration validate
the selection again and pause playback. Navigation focuses the area heading;
distance scrubbing keeps range focus. The ride clock's scenario time remains
separate from public route-distance selection and animation rate.

`index.html#seek-N` still means metres on the example only.
`explore.html#sensitivity` opens the existing panel. Bad legacy seeks explain
recovery to the example briefing. Unknown routes, withdrawal, unavailable
revisions and mismatched day/variant links never open a substitute. Old permitted
revisions carry a changed-route notice and explicit current-revision action;
revision comparison itself is pending. Invalid chapters open a paused briefing
with a notice. Missing local links explain that local import/library is not yet
available rather than offering a nonfunctional import action.

Catalog values and notices render as text. New runtime assets are explicit
release inputs, with dependency-first content hashes and entry freshness
markers. No documentation, synthetic test catalog, private route input or
recursive source checkout is published.

## Bounded validation

The focused suite uses the existing isolated Chrome/CDP fixture, source and
packaged Pages-style `/kotr27/` paths. Coverage includes 320/375/1280px shell
layout, 200% text enlargement, semantic headings, keyboard focus,
back/forward/reload, blocked maps, reduced motion, legacy links and pure
synthetic multiday/variant/revision/withdrawal cases. Existing 320/1200px
ride-clock, 375/1200px sensitivity, stubbed flyover and strict warm-release
regressions remain assertions, not optional skips. New state-helper and CSS
edits are checked for transitive hash/entry invalidation.

Commands for the final bounded validation:

```sh
node --test --test-concurrency=1 tests/route-state.mjs tests/site-shell.mjs tests/route-catalog.mjs tests/ascent-estimator.mjs tests/ride-clock.mjs tests/climb-sensitivity.mjs tests/flyover.mjs tests/rider-controls.mjs tests/release.mjs tests/climb-sensitivity-browser.mjs
python3 tests/semonzo_chapters.py
git diff --check
```

Also run `node --check` on the changed JS/MJS runtime, builder and test files.
Final execution on 2026-11-24: **52 Node tests passed, zero skipped; 3 Python
tests passed; 12 JS/MJS syntax checks and whitespace validation passed**.
The delayed-profile browser fixture holds the initial GPX response, focuses
navigation, then releases it: profile completion preserves focus. This catches
the loading/render race found and corrected during implementation rather than
relying on a fast local response.

There is no configured lint runner/package manifest. This is not physical-phone,
Safari/Firefox, real-provider 3D or installed-offline qualification. The optional
SDK suite is not run or counted as passing. The historical CDP
`Invalid InterceptionId` risk is not declared fixed; its strict assertion and
failure diagnostics are retained, without retry or suppression.

## Corrective pass 1 · 2026-11-24

Independent review found three gaps not covered by the original 52 tests.
The bounded correction:

- Guards chapter-time rendering when the rider scenario has no valid estimate.
  Invalid FTP remains entered, marked invalid and accompanied by its existing
  error; route chapter selection still finishes and focuses the heading.
- Treats the skip link as focus-only when JavaScript is active, preserving
  legacy fragment selection, URL and history. Its native anchor and focusable
  fallback heading remain usable without JavaScript.
- Serializes an unsafe revision as `rev=` (an explicit blocked-link marker),
  never as an absent revision that resolves current. The unsafe value and
  unrelated personal query data are not copied. Area navigation, history and
  reload remain blocked until explicit valid route/revision selection.

Regressions extend the existing route-state, shell and rider-controls tests;
no existing assertions were removed or weakened. The focused command
`node --test --test-concurrency=1 tests/route-state.mjs tests/site-shell.mjs tests/rider-controls.mjs`
passed **14 tests**. The complete bounded command above then passed **53 tests,
zero failures/skips**, including strict release checks. Python: **3 passed**;
the same **12 syntax checks** and `git diff --check` passed. No provider/SDK
qualification, deployment, staging, commit or Beads write was performed.
