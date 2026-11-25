# Optional offline day packs

Implementation: `kotr27-800.20`. Chrome qualification only; Safari and fullscreen
remain explicitly deferred. Parent Chrome DevTools MCP offline qualification
succeeded as recorded below. The candidate is ready for fresh independent review;
that review remains required before acceptance. No deployment is authorized.

## Rider contract

The shared Plan / Explore / Prepare / Ride week shell has an **Offline day packs**
section. First select **Check online revision / preview**, choose source days and
review the exact release, resource count and bytes. **Download selected days /
replace pack** is explicit consent, not a side effect of visiting or remembering
an itinerary. A day includes its cleared variants, not an invented calendar date.
The selection replaces the saved set as a single transaction; Delete removes
the entire set. Reload once after saving before disconnecting.

Coverage: both HTML entries, first-party modules/styles, local GPX/FIT parsers,
model/briefing code, example, approved catalog and selected public geometry,
profiles and available sanitized GPX. Climbs are derived locally from that
revision, not organizer safety advice. FIT exports are unavailable. No participant
content, raw intake, remembered rider values, recordings or other personal files
enter a pack. Local file remembering remains a separate consent/store.

Mapbox/terrain, weather, live alerts and third-party resources are **not covered**.
First-ever offline entry is unavailable. Denied/evicted storage or missing bytes
invalidate the guarantee. Ordinary HTTP caching is not a pack. No persistent
storage permission is requested.

## Release and transaction design

* The builder emits `offline-release.json`, whose full SHA-256 binds the final
  HTML, rewritten dependency graph, approved catalog and every resource's full
  checksum/size. The route/day inventory is cross-checked against the verified
  public catalog; a rehashed contradictory preview is not trusted. The build
  still uses its explicit public input allowlist and atomic output-directory
  rename. The worker never accepts caller-supplied resource bytes or URLs.
* Registration occurs only on explicit save: `/kotr27/` on HTTPS, or a
  same-directory localhost test scope. No root-scope production registration,
  `skipWaiting`, `clients.claim`, wildcard caching, remote tiles or automatic
  update activation into an existing document.
* Cache names are `kotr27-pack:<scope-path>:<random-generation>`. The exact
  scoped database `kotr27-offline:<scope-path>` holds one state record including
  the active pointer, generation metadata, client pins and deletion epoch.
  Staging is reserved before writes. Every successful response is checked for
  exact size and SHA-256; the full staged set is checked again before one IDB
  transaction changes the active pointer. Cache Storage is **not** claimed to
  be transactional with IDB.
* Interruptions, fetch/hash failures and quota failures leave the old complete
  active pointer untouched. Abandoned staging is ignored and removed when the
  worker restarts/receives a status request. Existing document client IDs retain
  their old complete release; old generations are retired only after those
  clients disappear. A new navigation selects the active generation. Hashed
  dedicated-worker module imports can resolve from a retained complete
  generation: the content-addressed import graph is identical, never mutable
  HTML or route metadata from another release.
* Required bytes are rechecked on navigation/status and hashes checked on use.
  Missing/corrupt cached responses cannot be called complete. Online recovery
  may load a fresh whole document; disconnected incomplete entry explains that
  reconnection is required. No geometry/profile substitute is invented.
* The worker always bypasses caches for `offline-release.json` and the
  `X-KOTR-Freshness: 1` HTML probe. Uncontrolled entries retain the existing
  one-replacement entry check. Controlled entries use the explicit pack
  check/update/reload flow, not HTML-only automatic replacement.
* Saved-at and last network verification are separate. Offline/currentness
  failure never means current. Reconnect checks show changed releases. Updating
  the saved pack does not change an old tab's HTML/modules; reload is explicit.
  Old revision links remain blocked until the rider chooses the available
  revision. Existing itinerary revision acknowledgment remains in force.
* Known withdrawal/removal deletes that route's cached payloads **and the old
  shared catalog containing its metrics/annotations**, blocks those old paths
  (including export requests), clears active models/controls and leaves public
  tombstones. Conservatively, that generation now provides the explanatory
  shell only; reconnect and explicitly replace it for remaining permitted days.
  The shell can explain withdrawal offline; it is not labeled route coverage.
  Tombstones are sticky, including
  across pack deletion: an older release cannot silently resurrect a withdrawn
  route. A disconnected device cannot learn a withdrawal or recall an already
  downloaded file.

Limits are 25 MiB per route, 50 MiB selected payload including shell, and
100 MiB of generation payload including staging and retained old clients.
Origin quota must have 20% headroom; native quota errors are also caught.
Public metadata/response overhead is additional and covered by that headroom.
The existing personal library has its own more conservative 20 MiB limit;
packs never evict it. Close old tabs or delete packs explicitly if retention
prevents another stage.

Delete/global Forget increments a durable epoch **before** asynchronous work.
Installations carry the epoch observed at preview; delayed registration, another
tab and terminated workers cannot bypass it. Live worker downloads are aborted
and drained before unregistering. Reads never create caches. Global Forget
awaits independent confirmations for preferences, private files and offline
packs, and reports partial failure without claiming success. Only exact scoped
app cache names/registration are removed; unrelated origin stores survive.
Public lifecycle/withdrawal tombstones contain no personal values.

## Validation and parent MCP rehearsal

Relevant commands (Node and installed Chrome; no dependency installation):

```sh
node --test --test-concurrency=1 tests/offline-packs.mjs tests/release.mjs tests/release-lifecycle.mjs tests/preferences-browser.mjs tests/local-routes-browser.mjs tests/trip-planner-browser.mjs
node --test tests/route-pack.mjs tests/trip-planner.mjs tests/route-catalog.mjs tests/rider-preferences.mjs tests/route-analysis.mjs tests/route-state.mjs
git diff --check
```

Implementer run, 2026-11-25: **71/71** ordered browser/release checks and
**122/122** model/catalog checks passed; changed-JavaScript syntax and whitespace
checks passed. The bounded server's A → B → withdrawal HTTP smoke check passed.
Measured D1 generation payload: **780,678 bytes** for this candidate. These are
implementer observations, not independent review or MCP sign-off.

New tests use actual Chrome SW/CacheStorage/IDB, socket-level disconnection plus
Chrome offline emulation, native completed downloads before hashing, native file
input for disconnected parser imports, real worker termination mid-stage, real
quota override, hash/fetch failure, storage/worker denial, cache eviction,
two-document release pinning, changed revision links, verified withdrawal
artifacts and global Forget of remembered local files plus packs. Teardown:
Chrome, server connections, in-flight handlers, then artifact removal.

`tests/site-shell.mjs` has three **pre-existing failures** at line 81:
the broad `mapbox|terrain|flyover|config` request-name assertion also fails at
committed HEAD `e0c57d9`, in an isolated temporary source snapshot at all three
widths. It was not changed or relabeled passing. An initial overloaded parallel
browser run also had a Chrome startup timeout; sequential execution is used.
The parent will handle these tightly coupled prior `.12` regressions during
`.21` final qualification; this evidence update does not modify those tests.

### Recorded parent Chrome DevTools MCP evidence

Parent-reported observations, **2026-11-25, approximately 12:50–12:53 UTC**,
against the unchanged implementation candidate:

```sh
node tools/offline-review.mjs /tmp/kotr27-offline-review-20-parent 48128
```

The parent used isolated context `kotr27-offline20`, owned pages **5 and 6**,
MCP `evaluate_script` for UI button actions and state assertions, and MCP
`navigate_page`, `new_page` and offline emulation for navigation/disconnection.

* Initially there was no registration or cache. Check preview → select D1 →
  Save produced **Saved complete**, **780,678 bytes**, release prefix
  `a05cc651…`, one cache and one registration.
* After a controlled reload, the parent enabled **both MCP offline emulation
  and `POST /__fixture/offline` socket dropping**. Reload still loaded the app
  and ready trip planner; D1 briefing showed two SVGs and source facts.
  No external resources were observed. Currentness was explicitly unverified,
  the online check failed, and the exclusions copy was correct.
  `navigator.onLine` happened to remain **true** despite MCP emulation; the
  socket-level outage, not that flag, established disconnection.
* The actual offline GPX response returned **200**, **84,340 bytes**. Browser
  WebCrypto SHA-256 was
  `2b6de16bdd4c4f7cece67d24b0998456984bf7a38fadf4c4d454c5609c58d925`,
  matching the artifact manifest. This proves **served export bytes**, not
  OS download completion. Automated native completed-download tests provide
  the separate completion evidence.
* After reconnecting MCP and selecting fixture `online`, then `b`, the online
  check reported new release prefix `4acf1333…`. Saving D1 produced
  **780,622 bytes**. Existing page 5 retained revision A while two cache
  generations remained. New page 6 in the same context opened the old
  A-revision link with explicit **revision unavailable** and hidden briefing.
  Selecting B through `#site-revision` revealed B's **OFFLINE REHEARSAL**
  provenance, rather than silently replacing the old link.
* Switching to the withdrawal fixture and checking online hid route details,
  made GPX fetch return **410**, and displayed **saved shell only**.
  With socket dropping and MCP offline emulation restored, reload still
  loaded the shell, showed the D1 withdrawal warning, kept briefing hidden
  and returned **410** for GPX: no resurrection.
* Offline Delete left `caches: []`, no registration, and **Not saved / pending
  saves revoked**. A subsequent disconnected reload reached Chrome's error
  page rather than claiming an installed pack.

The parent closed only owned pages 5/6 and stopped the helper; the parent owns
artifact-directory removal. No implementation source was edited during this
qualification. MCP did **not** repeat private upload/global Forget, quota or
first-ever-offline tests; those retain their explicitly separate automated
evidence. These MCP observations complement the automated coverage, including
its native OS-download completion checks; they are not a claim that every
automated scenario was repeated through MCP. Fresh independent review is pending.

### Simple MCP artifact server

Run from the physical source root, using a **new** external directory:

```sh
node tools/offline-review.mjs /tmp/kotr27-offline-review-20
```

This builds validated A, changed-D1-revision B and D1-withdrawal rehearsal
artifacts, removes its temporary source snapshot, and serves only artifacts on
an automatically assigned `127.0.0.1` port printed at startup. An optional final
port argument selects a fixed port; it never stops another listener.
It stops after 20 minutes (or Ctrl-C). **Do not publish these
rehearsal revisions.** No real calendar/provenance update is asserted.

Substitute the printed port for `PORT` below.

1. MCP open the printed `http://127.0.0.1:PORT/kotr27/index.html?area=plan`.
   Wait for `#site-shell[data-ready=true]` and `#trip-planner[data-ready=true]`.
   Click `#offline-check`, check `#offline-days input[value=kotr-d1]`,
   then `#offline-save`. Wait for **Saved complete** in `#offline-status`;
   inspect bytes, saved revision and exclusions. Click `#offline-reload`.
2. Disconnect using MCP network emulation and/or
   `curl -X POST http://127.0.0.1:PORT/__fixture/offline` (drops app sockets).
   Reload. Open D1 via its Plan preview link, inspect the linked profile/text,
   return to Plan and click `#trip-gpx-rwgps-57874121`. Await the browser's
   completed download; compare its SHA-256 with the artifact manifest. Check
   offline/currentness copy and FIT/terrain/weather exclusions.
3. Reconnect MCP and `curl -X POST http://127.0.0.1:PORT/__fixture/online`.
   Preserve an old tab/link. Switch fixture with
   `curl -X POST http://127.0.0.1:PORT/__fixture/b`. Click `#offline-check`,
   review changed revision, reselect D1 and save. The old tab remains pinned;
   reload enters B. An A-revision link must not silently select B; explicitly
   choose B with `#site-revision`. Remembered itinerary changes require ACK.
4. `curl -X POST http://127.0.0.1:PORT/__fixture/withdrawn`, then
   `#offline-check`. D1 details/export must disappear; an old GPX fetch returns
   410. Disconnect/reload to confirm the tombstone, not a permitted rollback.
5. Click `#offline-delete`: verify deletion, then disconnected reload cannot
   claim an installed pack. For global Forget, also import/remember a harmless
   test file and use `#preference-forget`; verify all three confirmations and
   no remaining local file view. Leave unrelated origin storage untouched.

The recorded MCP evidence complements these automated checks, never being
replaced by a headless pass. The recipe above includes optional repetitions
beyond the recorded MCP run; independent review remains required.
