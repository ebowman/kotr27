# Full-site architecture: static core, explicit offline boundary

Architecture decision · `kotr27-800.3` · observed **2026-11-24**

Final [qualification measurements and release boundary](final-qualification.md)
record the actual Chrome runtime, cold/warm resources, sampled accessibility
and differential long-task diagnosis/correction. Proposed device/FPS limits below must
not be mistaken for physical-device certification.

Implementation follow-up: [optional offline day packs](offline-packs.md)
(`kotr27-800.20`) documents the release transaction, conservative coverage,
test commands and Chrome MCP rehearsal. The owner has deferred Safari and
fullscreen qualification; the original broad support table below is not a
claim that those targets have passed.

## Decision and evidence

Recommend an **artifact-first static core**: local route selection, calculations,
uploads and print; optional online maps/weather; explicitly installed offline
packs. Do not introduce accounts or a backend merely to organize the site.
This is a documentation decision, **not implementation, provisioning or release
authorization**. Public-data approval remains a release gate.

The controlling product contract is [full-site experience](full-site-experience.md)
at `d80bdc4`. Preserve Plan / Explore / Prepare / Ride week, revision-pinned
facts and the example/official/local distinction. The seven source route records
do not confer redistribution rights. The listed 20–24 May 2027 event range does
not establish D1–D4 calendar dates. Use cleared synthetic fixtures meanwhile.

Local source inspection, not new runtime validation:

- [Release builder](../tools/build-release.mjs) explicitly allowlists inputs,
  rewrites transitive imports dependency-first, hashes final bytes to 24 hex
  characters and refuses an existing output tree. Keep the private source repo
  separate from public `ebowman/kotr27`; never publish a recursive checkout.
- [Entry check](../tools/entry-check.js) revalidates HTML on `pageshow`, performs
  at most one marker-driven replacement and leaves the page alone on failure.
  It is not a service worker or offline installer.
- [Release tests](../tests/release.mjs) contain deterministic artifact,
  dependency-hash, warm-cache and failure seams. [Release notes](release.md)
  record past Chrome evidence, not full-site/offline certification.
- Current personal scenario state is memory-only. The existing sensitivity
  module bounds its mesh to 21×21; preserve sustained 80% default / 70–90%
  adjustment separately from ride-clock 70/80% scenarios. No new persistence,
  importer, pack or server behavior is claimed shipped here.

## Capability matrix

“No custom backend” still permits internet requests. “Disconnected” means no
network, not merely a blocked map provider.

| Capability | Static/no custom backend | Optional online dependency | Disconnected target after verified pack install |
|---|---|---|---|
| Approved catalog, itinerary, revision/change summary | Versioned artifacts; session selection | Download current manifest to learn updates | Saved revision only; cannot establish currentness |
| Briefing, profile, outline, next sourced feature | Local derivations; no tiles needed | None for packaged inputs | Yes for included complete bundles; missing POIs stay unknown |
| Time/scenario/sensitivity calculations | Local model; estimates, not recordings | None | Yes with saved model and elevation |
| Local GPX/FIT import and replay | Device-local parsing; no upload endpoint | None once parsers are available | Yes within limits; pack must include parsers |
| Print, packing list, approved GPX/FIT export | Local rendering/export; revision labeled | Browser/OS file or print facilities | Included formats only; saving/printing is not guaranteed by the app |
| 3D terrain / basemap | Optional presentation | SDK, tiles, fonts, token and provider access | **Not covered**; outline/profile/text remain |
| Weather | Opt-in approved public locations | Provider availability, terms and quota | No fresh weather; dated last result only if explicitly saved |
| Public organizer announcement | Reviewed static artifact can suffice | Publication pipeline and connectivity | Last included notice, not an alert service |
| Authenticated editing, sync, check-ins | Not a static capability | Separately approved identity, API and durable store | Unavailable; never imply successful delivery |

Online maps/weather expose IP, request timing and requested region to providers.
Show provider disclosure before enabling them; do not send rider values,
recordings, private filenames, private geometry or live position. A private local
track must not silently trigger third-party tile requests that reveal its region.
No-map operation is the default fallback, not an error requiring an account.

## Publishing and access boundary

Default-deny every new route field, geometry, derivative, POI, download, print
template and offline asset until the owner records rights, audience and approved
revision. Access to an export is not redistribution permission. Deriving an
outline or climb profile does not make restricted geometry public.

Public output may contain only cleared event facts and route bundles, existing
cleared examples and public browser configuration. Keep participant names,
contacts, hotel/medical details, recordings, access-code URLs and credentials
out of artifacts, repository history, query strings, analytics and logs.
Documentation is not automatically a build input. No telemetry is required.

**Hidden links, hashed filenames, JavaScript passwords, robots rules and CORS are
not access control.** Public Pages assets and public repository history are
retrievable. A private source repository does not make Pages private.

If the audience is participant-only, stop public release of that content.
Retain a cleared public shell if useful, but put *every* protected manifest,
asset and export behind server-enforced authentication/authorization on a
separately approved protected origin/store; do not leave a public backing URL.
Existing public Pages is not that host. GitHub's private Pages option requires
an organization on Enterprise Cloud [G2]; participant eligibility must also be
checked. A protected Worker or Vercel service would need its own access design,
terms review and operating budget, not just a login screen.
Private offline redistribution would require additional rights and explicit
device-storage approval; it is **excluded from the initial pack design**.
No host can recall an already downloaded file or reliably revoke a disconnected
copy. Moving hosting later cannot undo an earlier public disclosure.

## Local data, storage and offline lifecycle

All limits below are **proposed acceptance targets**, not validated support.

| Data | Default/location | Consent, retention and deletion target |
|---|---|---|
| Rider values; route/UI choices; checklist | Tab memory, no account | Separate unchecked “Remember rider values” and “Remember route/UI choices” controls; checklist persistence separately explained. Versioned IndexedDB records on this origin, not URLs or shared browser sync. Expire after 90 days since last use, enforced on next open; visible Clear resets dependent UI. |
| Imported activity/route | Tab memory, local parser | Explicit per-file “Remember on this device”; raw bytes plus necessary derived records in IndexedDB. Per-file/delete-all removes bytes, derivatives, indexes and in-memory views. Same 90-day inactivity policy; no automatic server copy. |
| Offline pack | Absent until requested | Show assets, bytes, revision and exclusions before download; app-managed Cache Storage plus an IndexedDB manifest/pointer. Retained until removed, replaced or browser eviction; show saved-at and last online verification. |
| Weather result | Memory only | Optional saved snapshot belongs to a separately disclosed pack item with retrieved/valid times; expired result is stale, never current. Do not fetch outside provider forecast horizon. |

Explain that ordinary browser HTTP caching may occur without a pack, and is not
reliable offline installation. Device storage is origin-scoped, not encrypted
against another user of the same browser profile. Browser/private-mode policy
may deny or evict it. Expiry is lazy while the app is closed, not guaranteed
wall-clock erasure. Downloaded files/printed PDFs are outside app control.
“Delete all local data” clears this app's named databases/caches, active memory
and pack registration; it must not delete unrelated applications' stores.
Explain how to clear site data/HTTP cache in browser settings as well.

### Pack transaction and service-worker contract

1. Install only on explicit request over HTTPS, scoped to `/kotr27/`. Pack the
   shell, local parsers/model, and explicitly selected **cleared** revision
   bundles, profiles/POIs and available exports. No third-party SDK/tiles,
   authentication responses, user uploads or opportunistic wildcard caching.
2. Resolve a manifest binding shell/model/schema and every dependency to
   immutable checksums. Stage into a new revision namespace; verify successful
   status, expected bytes/hash, completeness and supported schema before marking
   it ready. An entry hash alone is not a whole-pack transaction.
3. Atomically switch a single active manifest pointer only after verification.
   Cache Storage and IndexedDB are not one transaction: recovery must ignore
   uncommitted staging caches. Pin existing tabs to their complete release;
   prompt to reload, never force `skipWaiting`/claim into incompatible open tabs.
   Retire old caches only after their clients release them. Interrupted update
   keeps the previous complete permitted pack, with an explicit old-revision label.
4. Coordinate the current HTML freshness probe with pack activation: use a
   network-only manifest check when connected; do not let an intercepting worker
   serve its own cached “freshness” response or mix new HTML with old dependencies.
   Itinerary revision changes still require explicit user acknowledgment.
5. On quota, failed fetch/hash, unsupported API or storage denial, report
   **Not saved / Incomplete**, clean staging on next open and keep session use.
   Do not silently evict remembered activities to make room. Check storage
   estimates, catch write failures and recheck required assets on reload.
   Request persistence only with explanation; a grant is not a backup guarantee.
6. On reconnect, display revision/withdrawal changes. A known withdrawn pack
   must stop serving route details/exports and offer deletion; retain at most a
   tombstone, not an old “permitted” fallback. While disconnected, display
   **Offline: saved revision; changes/withdrawals cannot be checked**.

The conditional offline guarantee is limited to declared complete local assets
remaining present in a supported browser. First-ever offline visits, eviction,
cleared stores, third-party maps, live weather/alerts and remote auth never have
an offline guarantee. Third-party HTTP caches are not packs; do not bulk cache
tiles or proxy around restrictions. Mapbox's inspected offline guide concerns
native Android/iOS SDKs [M1], not permission for web tile downloads.

### Concrete resource/support targets

| Boundary | Proposed limit and behavior |
|---|---|
| Local import | GPX/FIT only, one file at a time; ≤20 MiB/file, ≤100,000 geometry points, ≤250,000 FIT records, ≤1,000 segments and ≤2,000 POIs. Reject archives, XML entities/external resources, malformed/non-finite fields and any exceeded decoded limit; no silent truncation. Parse off main thread with cancel and 15 s timeout; derived allocations budget ≤64 MiB per import. Byte/extension checks alone are insufficient. |
| Remembered library | ≤10 files and ≤100 MiB total raw + derived; whichever limit comes first. Display measured usage; memory-only or explicit delete/export recovery on denial. |
| Packs | ≤25 MiB/route pack; ≤50 MiB active packs including shell; ≤100 MiB including staged replacement/old active generation. Total app-managed persistent data ≤200 MiB including the library; reserve another 20% quota headroom before starting. Browser quota may be lower. Do not promise the whole event fits. |
| Rendering/calculation | One active 3D canvas, lazy/user-requested; ≤5,000 display vertices/route, ≤2,000 profile samples, ≤100 visible POI markers; list/table retains all accepted facts with paging. Simplification is display-only, never export/stat input. Keep sensitivity ≤21×21, debounce changes and cancel stale work, never compute on playback frames. Target <50 ms main-thread slices, ≤3 s briefing on a mid-range phone, ≥30 fps optional 3D; degrade to 2D/text if missed. |
| Supported browser target | Current and previous major stable Chrome/Edge/Firefox desktop; current and previous Safari macOS/iOS; current Chrome Android. Test 320 CSS px, 200% zoom, touch, keyboard and reduced motion on an iPhone and mid-range Android (4 GB RAM class). Require WebGL2 only for optional 3D, not briefing. No baseline promise for embedded/in-app browsers. |
| Validation boundary | Existing recorded headless Chrome checks do not certify these limits, Safari, physical phones, service-worker upgrades or GPX/FIT replay. Future qualification must exercise boundary-sized fixtures, denied/evicted storage, multi-tab update, interrupted/hash-failed install, withdrawal and truly disconnected reload. Unsupported storage leaves session/text use, not a false “offline ready” badge. |

## Optional server decision: defer unless the job requires it

Prefer reviewed static notices and versioned artifacts while the owner can
publish updates at the required cadence. Justification for a backend must name
a real need: restricted audience, organizer edits without a release operator,
cross-device state explicitly requested by riders, or voluntary shared status.
Neither animated maps nor local calculations justify it.

| Candidate, priority | Benefit beyond static core | Cost/failure mode and separate gate |
|---|---|---|
| 1. Authenticated announcements | Authorized organizer posts with expiry/audit trail; public or participant-only audience explicit | Identity/admin recovery, moderation, revocation and stale delivery. Show last received time; never safety-critical delivery. Gate: audience, operator and update latency approved; static publication insufficient. |
| 2. Organizer updates | Validated content editing without editing source | Draft/review/publish workflow and rollback; conflicting edits or partial publish can mix route facts. Geometry changes still go through rights/revision/artifact validation, not arbitrary uploads to production. Gate: editor roles and independent release approval. |
| 3. Cross-device sync | Transfer chosen itinerary/preferences | Accounts, deletion/export, conflict versions and breach exposure. Start with route choices/checklist only; exclude FTP/weight, files and telemetry. Offline changes remain visibly unsynced and require conflict resolution. Gate: explicit rider demand, consent and store choice. |
| 4. Voluntary group check-ins | Rider-selected “at named stop / done / need organizer contact” status | Attendance/location inference, stale/missing reports and false reassurance. No GPS/background tracking; no emergency-service promise. Gate: opt-in audience, safeguarding/contact process, short retention and a human operator. |

No row authorizes implementation. **Live tracking, navigation, shared rider data
and backend deployment each require separate explicit authorization.**

### Hosting alternatives and verified provider facts

Official pages were fetched on **2026-11-24** without accounts/credentials.
These are observed published allowances, not account entitlements or guarantees
of zero cost, unrestricted use or availability. Recheck before any approved launch.

| Choice | Fit and responsibility | Observed allowance / constraint |
|---|---|---|
| Existing GitHub Pages only | Lowest operational burden; release owner publishes cleared artifacts. No protected writes or participant-only protection in the current setup. | Published site ≤1 GB; soft bandwidth 100 GB/month, soft 10 builds/hour (custom Actions exception), rate limiting possible [G1]. Pages is not a free host for commercial transactions/SaaS or sensitive transactions. Confirm event use fits terms. |
| Pages + optional Worker | Retains static release boundary; small API on separate origin. Operator also owns auth, durable store, CORS, monitoring and deletion. Functions are not storage. | Workers Free: 100,000 requests/day, 10 ms CPU/invocation. KV Free: 100,000 reads/day, 1,000 writes/day, 1,000 deletes/day, 1,000 lists/day, 1 GB stored [C1]. Other bindings have independent quotas. Token verification plus storage must fit CPU; measure, do not assume. |
| Vercel static artifact + Functions (or API alongside Pages) | Same artifact-only discipline; cohosting can remove cross-origin complexity but does not confer privacy. External durable DB/identity/mail may cost separately; no durable function-local filesystem assumption. | Hobby: 1 million function invocations, 4 CPU-hours, 360 GB-hours provisioned memory; 100 GB fast data transfer, 10 GB fast origin transfer, 1 million CDN requests in published included usage [V1,V3]. Exceeding most Hobby limits can suspend the feature until 30 days pass; no auto-paid capacity assumed. |

Vercel's legal terms restrict Hobby to **personal or non-commercial use** and
allow disabling deployments without notice [V2]. Organizer-operated or
commercial event use cannot be assumed eligible, even at low traffic; Hobby
also lacks the Pro team-collaboration feature [V1]. The inspected terms describe
Hobby/trial content use for model training and an opt-out [V2]: review the
actual terms, data processing and settings before considering any private data.
No settings were queried or changed here.

**Research gaps:** official Cloudflare KV limits/consistency pages [C2,C3],
Cloudflare terms [C4] and Open-Meteo terms [W1] returned **HTTP 403**. These
were not successfully verified, and no retry/bypass or fallback pricing claim
was used. KV quotas above came from the successfully retrieved Workers pricing
page, not the failed pages. Do not choose KV for atomic updates/rate counters
without verifying consistency and contention behavior. Cloudflare contractual
eligibility/privacy and weather free-use eligibility/quotas remain gates.
No map/weather quota or free-use entitlement is asserted; approved provider
terms, attribution, request caps and browser-origin restrictions are required
before enabling either. No authenticated account allowances were inspected.

### Operator/security contract for any separately approved API

The project owner must accept responsibility or name an operator and backup
before provisioning; no provider is the event moderator. Operator duties:
identity enrollment/revocation/recovery, organizer MFA, scoped role checks on
every request, content approval, region/DPA/terms review, quota alerts, incident
response, tested restore/deletion, dependency updates and end-of-event shutdown.
Use an approved identity provider, not passwords handled by static Pages.

Allow only exact production and approved preview origins; never credentialed
wildcard CORS. Validate token issuer/audience/expiry and object-level audience;
CORS does not stop non-browser requests. For cookie auth require secure,
HttpOnly cookies plus CSRF protection. Do not embed private tokens in artifacts
or persist bearer tokens in local storage. Private responses are `no-store`
and bypass shared/service-worker caches. Minimize logs: no bodies, credentials,
route access codes or precise positions; review unavoidable provider metadata.

Proposed API controls: ≤16 KiB request body, ≤8 KiB normal response; per-user
read cap 12/minute, write cap 2/minute and 6/hour, organizer cap 30 writes/day;
login cap 5 attempts/15 minutes per identity/IP with abuse review. Use an atomic
rate-limit facility, not unverified eventually consistent read-modify-write.
Set a global 20,000 requests/day and 100,000/month application budget with
alerts at 50/80%; count auth, preflights, errors and retries too. These are
targets requiring enforceability tests, not protection from all billed abuse.
429/timeout/5xx pauses writes with visible failure, exponential backoff and no
background retry storm. A check-in is sent only after server acknowledgment;
never automatically replay an old “I am here” message after reconnection.

Proposed server retention: announcements expire explicitly, retain audit record
30 days; sync choices delete on request or 30 days after the event; check-ins
expire/delete within 24 hours; minimal security logs ≤7 days. Set backup expiry
≤30 days and explain that deletion reaches backups on that schedule. Export
and account deletion need tested paths; provider-imposed longer retention must
be disclosed and approved, not silently called immediate erasure.

### Illustrative capacity envelope, not a forecast

Assume **100 riders, five event days, ten active hours/day**, not verified
attendance. Foreground-only notice polling at five-minute intervals produces
100 × 120 = **12,000 reads/day**. Add 400 sync writes, 200 check-ins, 100 admin
requests and 600 auth/preflight/error requests: **13,300/day, 66,500/event**.
100,000/month leaves 33,500 for preparation/retries; hidden tabs stop polling.
A one-minute poll would make 60,000 reads/day before overhead and is rejected.
Alert and reduce polling/disable optional services before exhausting capacity;
core approved artifacts remain usable during API outage.

At 100,000 requests/month, assumed 5 ms CPU averages **500 CPU-seconds
(0.14 hours)**; at 100 ms billed duration and 2 GB provisioned memory,
approximately **5.6 GB-hours** on Vercel. These assumptions require measurement;
Workers' **per-request** 10 ms ceiling can fail despite a small monthly total.
100,000 × 8 KiB responses is about **0.76 GiB** before protocol overhead.
100 riders installing a 50 MiB pack twice is about **9.8 GiB** static transfer,
before other visitors, map requests or repeated downloads.

100 × 16 KiB preference records (~1.6 MiB), 200 × 1 KiB active daily check-ins
(~0.2 MiB), 100 × 4 KiB announcements (~0.4 MiB), plus bounded indexes/audit
should target **≤20 MiB live storage**, hard application ceiling **50 MiB**.
No GPX/FIT/media in that store. Roughly 700 content writes/day fits below the
published KV write allowance, but auth sessions, rate counters, retries and
cleanup are **additional**; this is not approval of a KV-only design.
Budget identity/email/DB/monitoring separately. Operator must approve either
a bounded paid fallback or an explicit optional-service shutdown; never promise
free tiers will cover launch or emergency traffic.

## Static-core priorities

1. **Route-change summaries:** highest value while routes evolve; compare exact
   cleared revisions, provenance, distance/ascent/chapter/download changes and
   affected itinerary. Unknown geometry means “comparison unavailable,” not
   “unchanged.” No backend required.
2. **Printable day cards:** useful during outages; revision, saved/as-of,
   uncertainty, sourced stops/logistics and export limitations. No unapproved
   geometry/private contacts; do not invent cue sheets.
3. **Packing checklist:** low cost, route-independent, session-first with
   optional local persistence. Not a medical/compliance score.
4. **Next-climb/next-stop insights:** valuable but dependent on verified
   chapter/POI data; relative to a user-selected distance, not live position.
   No invented food/water availability, navigation or safety assurance.

## Official sources and observation record

All observations/failed requests below are dated **2026-11-24**.

- **G1** — HTTP 200: [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).
- **G2** — HTTP 200: [Pages visibility](https://docs.github.com/en/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site).
- **C1** — successful curl retrieval: [Workers pricing, including KV](https://developers.cloudflare.com/workers/platform/pricing/).
- **C2** — HTTP 403, unverified: [KV limits](https://developers.cloudflare.com/kv/platform/limits/).
- **C3** — HTTP 403, unverified: [How KV works](https://developers.cloudflare.com/kv/concepts/how-kv-works/).
- **C4** — HTTP 403, unverified: [Cloudflare terms](https://www.cloudflare.com/terms/).
- **V1** — HTTP 200: [Vercel Hobby](https://vercel.com/docs/plans/hobby), [fair-use guidelines](https://vercel.com/docs/limits/fair-use-guidelines).
- **V2** — HTTP 200: [Vercel terms](https://vercel.com/legal/terms), particularly Your Content and Hobby Plan.
- **V3** — HTTP 200: [Functions usage/pricing](https://vercel.com/docs/functions/usage-and-pricing).
- **M1** — HTTP 200: [Mapbox offline maps](https://docs.mapbox.com/help/dive-deeper/mobile-offline/); native SDK scope only.
- **W1** — HTTP 403, unverified: [Open-Meteo terms](https://open-meteo.com/en/terms).
