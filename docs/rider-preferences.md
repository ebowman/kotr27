# Optional local rider preferences

`kotr27-800.13` · bounded implementation, not deployment or official-route approval.

## Shared state and privacy

Both entry pages expose **Preferences & privacy** as an optional utility.
`js/rider-preferences.mjs` owns one rider draft, validation, provenance, units
and consent state. `rider-scenario.mjs` supplies the existing numeric validation
and estimator semantics; the ride clock, chapters, comparison and sensitivity
receive the same resulting scenario. There is no second physics implementation.
Sensitivity remains independently 80% by default, adjustable 70–90%; clock
fractions remain 70/80%. Plan B and sensitivity controls are not remembered.

Blank weight/FTP means the labeled fictional example; either field alone means
partly assumed; both valid fields mean a personal scenario. Assumed values are
never written into the personal record. Invalid drafts retain their errors and
produce no estimate. Original mass text and entry unit remain authoritative,
even through display-unit changes and reload. Storage never uses rounded display
values. Invalid drafts remove any previously saved rider values; they cannot
silently reload the last valid measurement as if it were the current entry.

**Default is document memory only**, not sessionStorage or localStorage. A fresh
visit creates no database and makes no settings request. Closing/reloading or
crossing to the other HTML document loses unremembered values. Nothing sends
rider inputs to URLs, telemetry, APIs or another device. Optional map requests
remain the shell's separate disclosed online feature; local permission is not
permission to publish rider data.

Two initially unchecked controls independently choose:

- **Remember on this device: rider values** — original weight text/unit and FTP.
- **Remember on this device: route/UI choices** — public revision-pinned
  selection, display unit and Plan A pace; no measurements.

Remembered route selection is offered as an explicit link, **never automatically
applied** over an incoming URL. Unknown/stale revisions and the invalid `rev=`
marker remain blocked until explicit valid selection; no current-revision
substitution. It is active exploration, not itinerary membership. Selecting
route/UI consent captures the current selection even if it is blocked.

Revoking one consent removes that category, retaining the other only if separately
chosen. Current entries remain usable in memory. **Clear entries / Robin's
example** resets the calculation (and updates an already-consented record);
**Forget all local data: rider values, preferences & files** additionally revokes
both settings consents, resets dependent calculation controls and removes stored
settings plus the local route/recording library and its active views.
The current public route URL stays intact, including blocked revisions.
The settings controller's `forget()` remains category-scoped and returns a
`{confirmed, message}` removal outcome. The Preferences UI coordinates that API
with the local library's injected `forget()` API, invalidating both immediately
and awaiting both outcomes. It never transfers consent authority between stores.
Success requires both confirmations; partial failure names the unconfirmed
category and offers explicit retry/site-data recovery. See
[local-file privacy](local-route-import.md) for pending-save deletion fencing.

## Storage, recovery and tabs · human-authorized redesign

The approved IndexedDB boundary is implemented by `js/preference-storage.mjs`:
database `kotr27-preferences`, **database version 2**, object store `settings`,
record `current`, **record schema version 2**. There is no global authority token.
Each of the two categories independently contains:

```text
{ consentVersion, consent: "granted" | "revoked", savedAt, value }
```

An absent category is `null`. A revoked category has `value:null` and
`savedAt:null`; its opaque consent version carries no personal information.
Only explicit grant, revoke, Forget or expiry changes a consent version.
Ordinary saves and restoration renewals must match an active, unexpired version
for their own category, atomically in the same transaction that writes it.
They cannot create or regrant consent, and never write the other category.
Concurrent ordinary edits under the same still-active grant are last-writer-wins;
this is not cross-device synchronization or conflict-merging of profile edits.

The controller separately holds **observed versions** and **write authority**
for each category. A validated initial restoration may restore an existing
active grant, followed by a concurrency-checked renewal. Focus/read operations
refresh observations only; they never restore values or consent into an
invalidated tab. An explicit Remember click captures that category's observed
version at the click; if a peer subsequently revokes it, the grant fails without
retry. Review current settings, then make a new explicit choice.

Most importantly, a single-category storage operation returns **only its own
slot**. Revoking route/UI cannot refresh rider authority (nor vice versa).
Save/renew results do not update authority at all. Renewal keeps the current
stored payload, not a delayed reader's older copy. Transaction timestamps are
sampled inside the IndexedDB transaction, after any queued/open delay.

**No schema-1 consent migration is inferred.** The superseded, uncommitted
global-token protocol cannot establish independent category authority. Old or
unknown versions, malformed fields, invalid numbers and invalid/future timestamps
produce explicit recovery messages without overwriting data. Forget is the
deliberate recovery action. Raising the database version fences legacy clients
that still open version 1: they receive `VersionError`, rather than applying the
old writer protocol to version-2 records. An upgrade blocked by another open
connection reports storage unavailable; there is no silent retry.

After 90 days without use, the next open removes the expired category independently.
Using route/UI must not keep old rider values alive. Successful category
restoration/use renews its own inactivity clock with its existing authority.
An invalid rider draft clears its saved payload without storing the draft or
invented example values; its existing consent is not a new grant.
Expiry is lazy, not deletion while the browser is closed. Storage is not encrypted
against another user of the same browser profile and is not a backup.
Unsupported discovery, denied access, transaction/quota errors and deletion
failure leave memory-only use available with a visible status. Failed deletion
**does not claim erasure**: stored data may remain, and browser site-data controls
are the final recovery when the app cannot access it. No automatic repair.

Forget clears every record in this app's settings store, including obsolete
keys. Only two non-personal consent-version tombstones remain, preventing an old
tab from recreating deleted values. There is no accumulating history and no
personal-data timestamp in a tombstone. Explicit Forget creates both markers
even before the first save, defeating delayed initial grants. These constant-size
markers are not automatically expired into permission; origin eviction/clearing
also cannot authorize an old grant, whose non-null version no longer matches.
Unrelated origin databases, localStorage,
sessionStorage and caches are not cleared. This release has no stored activity
library, checklist or offline pack; those future owners must join the deletion
contract when implemented. HTTP cache and downloaded files are outside this
settings store.

Explicit Forget and revocation are ordered, non-cancelable privacy operations;
peer invalidation cannot discard them. They run after existing in-flight work.
Their success is displayed only after transaction commit. Other queued work and
initial reads are guarded against local invalidation. An operation on category X
cannot adopt any authority/version for category Y. Failed deletion remains a
visible failure even if a delayed peer notification arrives afterward.
Every explicit `remember(category, false)` installs a durable non-personal
revocation marker, even when local observations and authority are still null.
That is not the same as leaving an initially unchecked control untouched:
ordinary memory-only visits/drafts still create no database. A null observation
cannot prove that a first grant is not already committing here or in a peer tab.
A committed Forget also completes the local consent-version review, even when
it supersedes initial storage discovery. A current validated focus/read can
complete that review too. Neither operation grants authority: only a subsequent
explicit Remember against the reviewed category version can do that. Failed
discovery/deletion stays unavailable with its actual error until deliberate
recovery; an early Remember cannot replace that error with a loaded/review prompt.

BroadcastChannel sends only an invalidation word, **no values**. Other tabs
invalidate rather than adopt remote data or consent. Pages restored from bfcache
and newly visible/focused tabs recheck category versions. A changed version resets
the local profile and authority; an unchanged focus check does not redraw controls.
If cross-tab messaging is unavailable, the UI discloses that an inactive tab
may retain visible entries until focused; atomic write checks still prevent
resurrection. Reload/focus can review current versions, but only fresh explicit
consent can authorize subsequent writes after invalidation.

**Personal-settings export/import is deferred**: the architecture has no approved
schema, transfer or disclosure contract for it. No file download/import control,
server, account, private export, activity library or full-route pace model was
added. Local storage consent does not approve any of those features.

## Validation

The existing isolated Chrome/CDP fixture serves only the hashed release under a
Pages-style `/kotr27/` path. New tests cover no-default storage/network activity,
kg/lb original-value round trips, numeric boundaries, provenance, independent
consents, keyboard revocation, reload, invalid drafts, corrupt/future/expired
records, denied read/write/delete, messaging denial, two real tabs, consent-version
conflicts and late-operation deletion races. They check dependent clock,
comparison and sensitivity updates, invalid revisions and unrelated-data
preservation. Release tests verify all three new runtime modules and transitive
hash/entry invalidation. Existing privacy assertions remain in place.

Exact full bounded command:

```sh
node --test --test-concurrency=1 tests/rider-preferences.mjs tests/preferences-browser.mjs tests/route-state.mjs tests/site-shell.mjs tests/route-catalog.mjs tests/ascent-estimator.mjs tests/ride-clock.mjs tests/climb-sensitivity.mjs tests/flyover.mjs tests/rider-controls.mjs tests/release.mjs tests/climb-sensitivity-browser.mjs
python3 tests/semonzo_chapters.py
for file in js/preference-storage.mjs js/rider-preferences.mjs js/preferences-view.mjs js/rider-scenario.mjs js/rider-controls.mjs js/site-shell.mjs tools/build-release.mjs tests/rider-preferences.mjs tests/preferences-browser.mjs tests/release.mjs tests/flyover.mjs; do node --check "$file" || exit; done
git diff --check
```

Original implementation execution on **2026-11-24** (not final acceptance),
including the before-first-save deletion race:
**69 Node tests passed, zero failures/skips; 3 Python tests passed; all 11 syntax
checks and whitespace validation passed**. There is no package manifest or
configured lint runner. Browser denial is a deterministic injected failure,
not certification of private-browsing modes. Safari/Firefox, physical phones,
real-provider 3D and offline installation remain unverified. No deployment.

During implementation, focused tests exposed and corrected the legacy invalid
pace fallback and a storage-denial test missing CDP Page enablement. The first
full run was 67/69: the source flyover fixture lacked the new transitive module
allowlist, and a new privacy assertion mistook digits in static content hashes/
server ports for FTP. The fixture now serves the explicit dependencies; privacy
checks instead require allowlisted static request paths, public query keys, no
measurement values or bodies, plus zero requests during personal edits/consent.
No CDP protocol error was suppressed or blindly retried.

## Historical corrective pass 1 · subsequently failed independent review

Independent review reproduced a deletion race not covered by the original
69 tests: a pending focus read held the queue, another tab renewed the record,
the user clicked Forget, then a delayed renewal broadcast incremented the epoch.
The shared queue discarded the queued deletion as if it were an obsolete save.
Reload could restore FTP and consent.

That correction made **Forget and per-category revocation non-cancelable ordered
privacy operations**. Epoch checks discarded stale reads, saves and pending
consent grants, but never these removals. Removals execute after in-flight work;
success is announced only after the actual storage transaction commits.
Per-category revocation atomically removes its category from the current stored
record, preserving the other category without rewriting an older local copy.
It attempted to use new global tokens to prevent old peer saves or delayed
renewals from undoing removal, but the second review disproved that protection
across categories (below). New consent was rejected with a pending-removal explanation
until deletion completes; ordinary keyboard focus/consent behavior is retained.

Peer notifications preserve pending-removal and deletion-failure messages.
A notification received during removal cannot re-enable consent on completion.
Storage errors still report that data may remain; no silent catch, repair,
conflict retry or false successful-deletion message was added.

Added deterministic unit orderings cover queued and in-flight deletion and both
revocation categories, delayed reads/writes/initial renewal, stale peer saves,
consent attempts during removal and actual removal failures. Three packaged
Chrome tests use two real documents, real IndexedDB transactions and real
BroadcastChannel messages. Promise gates hold the parent's focus read and delay
delivery of the peer's renewal broadcast until after the removal click. They
verify stored payloads, consent and reload, without arbitrary sleeps.

Focused command:

```sh
node --test --test-concurrency=1 tests/rider-preferences.mjs tests/preferences-browser.mjs
```

Result: **28 passed, zero failures/skips**. The pre-fix targeted reproduction
(`node --test --test-name-pattern='peer invalidation cannot cancel explicit Forget' tests/rider-preferences.mjs`)
failed as expected. The first corrective focused run also detected keyboard
focus loss from temporarily disabling consent during removal; this was fixed
without weakening the existing keyboard assertions.

The full bounded command and the Python/syntax/whitespace commands above are
rerun for this correction: **81 Node tests passed, zero failures/skips;
3 Python tests, 11 syntax checks and whitespace validation passed**. An
intermediate full run was 80/81 because a test-local `evaluate` binding was
accidentally removed during test cleanup; restoring that binding fixed the
test without changing runtime behavior or relaxing assertions. Only
`js/rider-preferences.mjs`, `js/preference-storage.mjs`,
`tests/rider-preferences.mjs`, `tests/preferences-browser.mjs` and this document
changed in the corrective pass. Browser/platform qualification limits remain
unchanged.

## Second independent review FAIL and newly authorized redesign

The second independent review **failed**, despite 81 Node, 3 Python, 11 syntax
and whitespace checks passing. Two additional probes (memory and real hashed
`/kotr27/` Chrome tabs) reproduced:

1. A remembered FTP 300 and route/UI; its focus read and peer broadcasts were held.
2. B restored, then Forget removed both stored categories.
3. A revoked route/UI; releasing its focus read allowed that unconditional
   revocation to return a new **global** token.
4. A retained stale rider consent and used that token on an ordinary pace change.
   FTP 300 and rider consent reappeared in storage and survived reload.

The same underlying error could occur with the categories reversed. Making
deletion non-cancelable was insufficient: category X was accidentally refreshing
category Y's authority. Existing green tests did not establish acceptance.

The human subsequently approved the concrete bounded redesign proposal
(`“1. yes, 2. yes, 3. yes”`, recorded in the bead). This work replaces the failed
mechanism with the per-category contract above and requires fresh independent
review. It does not erase the earlier failure or treat this as another automatic
patch cycle. Route-intake/publication work is not part of this assignment.

The redesigned tests retain prior deletion orderings and add both exact
cross-category sequences, direct stale-category edits, observation-only reads,
fresh explicit consent, queued grants/saves/renewals, independent expiry,
constant-size tombstones, legacy-writer fencing and real transaction abort.
The packaged tests gate actual IndexedDB opens and actual BroadcastChannel
delivery between two documents; there are no arbitrary sleeps, silent retries,
relaxed privacy assertions or synthetic substitutes for the cross-tab messages.
The existing no-default-persistence/network and keyboard/legacy regressions remain.

Focused redesign command:

```sh
node --test --test-concurrency=1 tests/rider-preferences.mjs tests/preferences-browser.mjs tests/release.mjs
```

During redesign validation, queued-save browser tests exposed a timestamp sampled
before waiting for IndexedDB; legitimate newer peer dates were incorrectly called
corrupt. Sampling inside the atomic transaction corrected that classification.
A subsequent focused run passed 48/49 tests: the release walkthrough caught
unchanged focus reads unnecessarily redrawing sensitivity controls and losing
keyboard focus. No-change reads now emit no rider update, with a direct unit
regression. These were implementation/test findings, not native infrastructure
errors; no protocol error was masked or retried.

Final redesign execution on **2026-11-24**: the exact full bounded command above
passed **100 Node tests, zero failures/skips**, including all **50 focused
preferences/release checks**. `python3 tests/semonzo_chapters.py` passed **3 tests**;
the listed **11 syntax checks** and `git diff --check` passed. The focused command
was not separately rerun after the no-change-focus fix; its entire test set
passed in the final full run. There is still no configured lint runner.

Redesign changes are limited to `js/preference-storage.mjs`,
`js/rider-preferences.mjs`, `js/preferences-view.mjs`,
`tests/rider-preferences.mjs`, `tests/preferences-browser.mjs`,
`tests/release.mjs`, `tools/build-release.mjs` and this document. The storage
module's new validation dependency participates in hashed release invalidation.
No route intake, private originals, staging, commits, Beads writes or deployment
were performed. Prior working changes and unrelated untracked files remain.

These are implementation validation results, **not an independent acceptance
PASS**. Fresh independent review remains required. Safari/Firefox, physical
devices, actual private-browsing modes and real-provider 3D remain unverified.
Device storage is unencrypted and deletion cannot be guaranteed when the browser
denies access; that failure stays visible. Same-grant concurrent ordinary edits
are last-writer-wins, while privacy revocations invalidate that grant.

## Redesign-cycle corrective pass 1 · revocation during a first grant

The fresh redesign review **failed**, despite the preceding 100 Node, 3 Python,
11 syntax and whitespace checks passing. Its additional probes passed the
cross-category and failed-delete/notification cases, but failed first-grant
revocation for **both** categories. A held first grant had not yet returned
authority or an observed version. `remember(category, false)` treated those
local nulls as proof of no stored data and skipped durable revocation. The grant
then committed; its response was discarded by the epoch check. UI consent was
false while storage remained granted (synthetic FTP 311), and the status
incorrectly claimed nothing was saved.

This correction removes that shortcut rather than adding another timing-dependent
in-flight flag. **Every explicit revocation uses the existing non-cancelable,
category-specific removal transaction.** It either follows a same-tab first
grant in the queue, or installs a marker that defeats a peer's stale first grant.
Discarding an obsolete response is not mistaken for rolling back its commit.
Category isolation, tombstones, legacy-writer fencing and the storage format are
unchanged. No UI checked/disabled-state assumption is used to protect the
controller API.

New deterministic unit tests cover both categories with grant work queued,
held before commit, committed with its response held, and held in a peer.
Packaged Chrome tests call the controller directly and gate real IndexedDB opens
before the first grant transaction. They verify the actual grant→revocation
writes, final stored payload/marker, memory consent, status and reload.
Both unit failures and real aborted cleanup transactions verify that retained
data is reported as **possibly still stored**, never “nothing saved”; delayed
invalidation does not hide the failure. No retry or exception suppression was
added. The unchanged no-default-storage/network assertions still pass; the
explicit-denial unit assertion now requires a payload-free marker rather than
mistaking explicit revocation for an untouched unchecked control.

Exact targeted pre-fix reproduction:

```sh
node --test --test-name-pattern='first .* grant followed by revocation' tests/rider-preferences.mjs
```

Result: **4 failed as expected**, because only the grant ran and no revoke
operation was queued. After correction:

```sh
node --test --test-concurrency=1 tests/rider-preferences.mjs tests/preferences-browser.mjs
```

Result: **61 passed, zero failures/skips**, including all prior category-isolation
orderings and the new first-grant and cleanup-abort cases.
The exact full bounded command above then completed with **113/114 passed,
1 failed, zero skips**. All preferences tests passed. The failure was
`packaged shell 375px: no-map, history, focus, recovery and legacy links` at
`tests/site-shell.mjs:72`: after Prepare navigation, `document.activeElement.id`
was `''`, expected `'site-heading'`. The 320px and 1280px shell cases passed.
This is an assertion failure, not a reported native/CDP infrastructure error;
its cause has not been established. It was neither rerun nor weakened.
Changing shell navigation/focus is outside this bounded first-grant correction,
so the failing regression is handed back as a blocker rather than silently
classified as flaky or fixed opportunistically.

The exact `python3 tests/semonzo_chapters.py`, eleven-file `node --check` loop
and `git diff --check` commands above passed: **3 Python tests, 11 syntax checks,
no whitespace errors**. There is no configured lint runner.

Only `js/rider-preferences.mjs`, `tests/rider-preferences.mjs`,
`tests/preferences-browser.mjs` and this document changed in this corrective
pass. No staging, commits, Beads writes or unrelated work. Fresh independent
review remains required; prior failure evidence is retained.

## Human-authorized narrow repair · consent recovery and destination readiness

The final review of the preceding correction was **NEEDS-WORK**. The reviewer
passed all **114 existing Node tests**, 3 Python tests, 11 syntax checks and
whitespace, but **two new unit probes and one packaged Chrome probe failed**:
Forget invalidated initial discovery before `loaded` could become true.
Successful deletion left both tombstones intact, yet subsequent review and
explicit Remember could never recover either category. This was a consent
recovery bug, **not evidence of resurrection**. The human then explicitly said
**“try again”** to the concrete consent-recovery/readiness-test repair and fresh
independent review proposal, recorded in the existing bead. This is a new bounded
authorization, not erasure of the failed review.

`js/rider-preferences.mjs` now completes the local review after a **committed
Forget** or a **current validated check**, without restoring or granting either
category's authority. Invalidated discovery still cannot apply stale values.
The click-time version/epoch and pending-removal guards remain intact. A failed
load/deletion cannot masquerade as success: Remember preserves the actual
unavailable/error status instead of overwriting it with “Settings have loaded.”
Only a subsequent explicit consent choice can save again.

Ten new deterministic unit tests cover both categories, held/stale initial
reads, discovery errors, failed cleanup, premature consent, explicit successful
cleanup recovery, observation-only review, ordinary edits and reload. Six new
packaged Chrome tests seed real remembered values, gate initial IndexedDB
discovery, click Forget, then use a fresh checkbox choice without reloading.
They include actual discovery rejection and aborted deletion transactions,
verify unchanged stored data on abort and retained error messages, and verify
category isolation and reload after explicit recovery. Failed cleanup is not
retried automatically; a second deliberate Forget is tested as a user action.

The historical **113/114** run remains recorded above. The reviewer separately
established that its 375px focus failure was a pre-existing test synchronization
fault: the destination heading renders **before** asynchronous GPX completion
applies readiness/focus. The corrected `tests/site-shell.mjs` gates the Prepare
destination's GPX response at all three tested widths. It proves that the
heading already exists, preferences have settled anonymously, focus remains on
BODY and the shell is busy/not ready. After releasing that response it waits for
destination readiness and retains the heading-focus assertion. Related
destination waits use readiness too. **No product focus behavior, sleeps,
retries or weakened focus assertions were introduced.**

Exact pre-fix reproduction:

```sh
node --test --test-name-pattern='consent recovery for' tests/rider-preferences.mjs
```

Result: **10 expected failures**: six could not regain consent; four replaced
the cleanup error with the misleading loaded/review message.

Exact focused validation after correction:

```sh
node --test --test-concurrency=1 tests/rider-preferences.mjs tests/preferences-browser.mjs tests/site-shell.mjs
```

Result: **80 passed, zero failures/skips**, including prior cross-category,
first-grant and delayed-notification privacy orderings.
`python3 tests/semonzo_chapters.py` passed **3 tests**. Syntax validation passed
for the original eleven files plus the now-modified shell test:

```sh
for file in js/preference-storage.mjs js/rider-preferences.mjs js/preferences-view.mjs js/rider-scenario.mjs js/rider-controls.mjs js/site-shell.mjs tools/build-release.mjs tests/rider-preferences.mjs tests/preferences-browser.mjs tests/release.mjs tests/flyover.mjs tests/site-shell.mjs; do node --check "$file" || exit; done
git diff --check
```

Result: **12 syntax checks passed**, no tracked whitespace errors.

The exact full bounded regression command listed above then passed **130/130
Node tests, zero failures/skips**, including all packaged release, keyboard,
legacy route, privacy ordering and new recovery/readiness checks. No native/CDP
infrastructure errors occurred and no failed browser run was retried. A direct
trailing-whitespace check of all five repair files (including untracked files)
also passed. Staging remains empty.

This repair changes only `js/rider-preferences.mjs`,
`tests/rider-preferences.mjs`, `tests/preferences-browser.mjs`,
`tests/site-shell.mjs` and this document. No storage format/protocol, product
shell-focus contract, route intake or unrelated feature changes. No staging,
commits or Beads writes. Fresh independent review of all .13 changes is still
required; implementation test results are not independent acceptance.
Safari/Firefox, physical devices, actual private-browsing modes and real-provider
3D remain unverified. Storage-access failure can still prevent deletion; the
explicit warning is intentional, not an erasure guarantee.
