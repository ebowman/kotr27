# Optional public start-area weather · kotr27-800.19

Implementation on `epic/kotr27-800`, baseline `3c6c295`, **2026-11-25**.
MET Norway Locationforecast adapter + explicit request UI; no backend, account,
API key, proxy, deployment, source publication or persistent weather store.
Fresh independent review remains required; this is not a self-awarded PASS.

## Decision history and current provider gate

The first pass delivered only an unavailable panel. Open-Meteo's `/en/docs`
and `/en/pricing` returned 200 on 2026-11-25 (seven-day default, sixteen-day
maximum; non-commercial free access). Its `/en/terms` had returned 403 in the
2026-11-24 architecture work and was **not retried**. No Open-Meteo transport
was enabled, and the original handoff explicitly left live acceptance unfinished.

The parent subsequently checked MET Norway. Its terms require a human in
authority to accept them, which the implementer could not do. The user then
explicitly replied **“i accept the terms and conditions. continue”**, recorded
in the actual bead's notes on 2026-11-25. The resumed assignment preserved all
original criteria. **That MET approval blocker is now resolved**, not silently
waived; MET is the selected provider. Open-Meteo is not a fallback.

## Official evidence actually checked, 2026-11-25

Official documents were retrieved using normal unauthenticated HTTPS GETs
(`python3` / `urllib.request.urlopen`, 25-second timeout), then read locally:

| URL | Result / observed contract |
|---|---|
| <https://docs.api.met.no/doc/TermsOfService.html> | HTTP 200; revision 5 November 2026. Human acceptance; no SLA; CC BY 4.0 attribution/license/change indication; identifiable low-volume simple browser CORS allowed using automatic Origin; no custom headers/preflight. IP and queried coordinates are logged in Oslo. Truncate coordinates to ≤4 decimals; respect Expires. **20 requests/second is per application globally**, not per browser. High volume requires separate provider arrangement/proxy boundary. |
| <https://docs.api.met.no/doc/FAQ.html> | HTTP 200. Commercial use allowed under CC BY 4.0. Public GitHub repository with issues is an acceptable contact route. Small localhost development traffic is permitted. Moderate direct browser traffic is permitted, although a proxy is recommended for privacy. Recommendation is not a hidden backend requirement for this bounded integration. |
| <https://docs.api.met.no/doc/ForecastJSON.html> | HTTP 200. GeoJSON point coordinates are longitude/latitude/altitude; `meta.updated_at` is provider update time; units in `meta.units`; ordered UTC instants; precipitation belongs to specified 1h/6h/12h periods, not instants. Long-term forecast extends to ten days. Last instant may have no period. |
| <https://docs.api.met.no/doc/locationforecast/FAQ.html> | HTTP 200. Outside the Nordic region updates are every six hours; **wait at least half that interval** before repeating a position request. Italy therefore requires three hours, in addition to Expires. Do not schedule hourly-aligned requests. Altitude parameter is ground height, not an arbitrary height/weather adjustment. |
| <https://api.github.com/repos/ebowman/kotr27> | HTTP 200; `private:false`, `has_issues:true`. Public technical contact: <https://github.com/ebowman/kotr27/issues>. No repository/source write. |

Research correction: guessed `/doc/LocationforecastFAQ.html` returned **404**,
not denial. The actual product FAQ links were resolved from the official FAQ;
both linked `/doc/locationforecast/FAQ.html` and extensionless `/FAQ` returned
200. No denied source was retried or bypassed. No provider support message,
credentials, subscription, API account or infrastructure was created.

### One real browser endpoint/CORS probe

An isolated normal headless Chrome tab loaded a localhost qualification page
with the public repository contact. It performed exactly one simple request:

```
GET https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=45.7508&lon=11.7489
```

`fetch` used `credentials:'omit'`, `referrerPolicy:'origin'`, no custom headers,
no spoofed UA/Origin, no HEAD/preflight or retry. Browser origin identification
is automatic. The coordinate is the truncated first point of the **already
approved public D3L GPX**, not a private track or an invented town coordinate.
This explicit qualification probe was for current data, not a futile attempt
to obtain the far-future event forecast.

Actual result: **HTTP 200**, Fetch response type **`cors`**, readable JSON.
Chrome recorded one API GET. Expires was readable:
`Wed, 25 Nov 2026 09:30:44 GMT`; Last-Modified:
`Wed, 25 Nov 2026 09:00:20 GMT`; provider updated:
`2026-11-25T08:19:45Z`; model elevation **110 m**; **90** instants from
`2026-11-25T09:00:00Z` to `2026-12-04T12:00:00Z`.
No raw response was installed as an event forecast or saved to the repository.
Probe browser/server were stopped. No repeated live API calls were used in tests.
This proves that endpoint's CORS from localhost at that time, **not deployed
production-origin or Safari/Firefox qualification**. No public site was deployed.

## Public-location and event contract

- Event facts reuse `eventFacts` and [event-guide evidence](event-guide.md):
  **20–24 May 2027**, **Bassano del Grappa, Vicenza, Italy**, **Europe/Rome**.
  Event observation is dated 2026-11-24. Civil timezone is not a departure time.
  D1–D4 remain source groups; no calendar assignment or summit weather is inferred.
- Seven immutable reviewed route/revision/geometry-hash pins map to **three**
  request coordinates. Source is each approved public GPX's first point:
  D2L/D2S/D3L/D3S → `45.7508,11.7489` (source elevation 115.8 m);
  D4L/D4S → `45.7508,11.7487` (115.6 m);
  D1 → `45.7509,11.7491` (116 m).
  Tests independently compare pins against all seven actual public GPX files.
- These are truncated start-area references, not surveyed weather stations,
  whole-route coverage, verified start/departure arrangements or summit data.
  Source elevation accuracy is unknown. The returned model elevation is labeled
  separately (unknown if absent). **No altitude override** is sent.
- Local imports/recordings, examples, missing/withdrawn/unapproved records,
  changed revisions/hashes and absent event facts fail closed. Local geometry
  is never inspected for weather or mapped to a nearest public location.
- The transport constructs its own fixed HTTPS URL from the immutable pin,
  ignoring arbitrary caller coordinates/URLs/extra fields. No route identifier,
  revision, name, date, rider settings, telemetry, private token or filename is
  included. Referrer policy sends origin only, not route/private URL parameters.

## UI, forecast semantics and freshness

The native **Check weather / request public forecast** button is the only
transport trigger. Privacy/logging disclosure, MET attribution, CC BY 4.0 link,
change indication and public technical contact are visible before it.
No persistence of consent or automatic future enablement.

At the supplied current clock `2026-11-25T08:59:05.804Z`, all event dates are
out of range: page load, clicks, navigation and local imports send **zero**
weather requests. The request gate conservatively allows today plus nine
**Rome civil dates**, not a promised rolling 240-hour forecast. A rolling
ten-day provider horizon can overlap an eleventh civil date; that edge is
deliberately not requested. Actual returned timestamps always determine coverage.

In-range requests render selected **forecast samples**, not daily min/max,
averages, observations or historical climate. Each instant has UTC and Rome
time, temperature °C and wind m/s; rainfall is separately labeled with its
actual 1h or 6h valid interval. Overlapping periods are never summed. Missing
fields, absent event days and the last instant's missing rain stay unavailable.
Past dates explicitly say no observations/historical climate data loaded.
There is no historical API or fabricated historical context.

Source, coordinate, source/model elevation, receipt time, provider update,
Expires and response valid range are visible. Receipt time means received by
this tab (possibly from ordinary HTTP cache), not provider generation time.
Unknown expiry, passed expiry, provider update age ≥6 hours or backwards clock
means **stale forecast**, never “current observations.” A single local expiry
timer and online/offline/visible-again events update labels only, **never fetch**.
Offline snapshots remain dated, and missing snapshots say so.

Explicit failures (including 503/network/CORS/invalid bodies/timeout), no
remaining samples and 203 deprecation are visible without blocking core views.
429 and 403 stop further requests for the document with operator-review wording,
even after Clear/Forget. Private/rights/date explanations take precedence over
unrelated provider-stop notices. Late responses after selection change or
Forget cannot install another route's result.

## Resource/cache limits and operational boundary

- Memory-only: ≤3 coordinate snapshots, ≤350 ordered samples/response,
  streamed response ≤256 KiB; expire retained data after 24h, checked on use/
  open-page expiry. No raw response, local track or personal cache.
- One in-flight request; ten-second fetch/body deadline; abort on route switch/
  Forget. No automatic retry. Manual repeats wait until **both three hours
  since the previous attempt and Expires**, including error-response Expires.
  Also ≤3 attempts/hour/document and ≥10 seconds between distinct locations.
  Clear/Forget removes snapshots, not cooldowns or provider-denial stops.
- The first explicit read per coordinate/document uses Fetch `force-cache`:
  reuse even an expired ordinary browser-cache entry instead of blindly repeating
  the previous document's request. After the three-hour/Expires barrier a later
  explicit read uses native `default` caching/revalidation. A stale first read
  can therefore mean waiting three hours for a new forecast; disclosed in UI.
  No cache-busting, forced network refresh or hand-set conditional/authentication headers. That avoids
  unsupported JS preflights. Ordinary HTTP cache is outside the app's memory
  deletion guarantee and can be removed in browser settings.
- Limits/cooldowns are **document-local**, not a durable cross-tab ledger or a
  guarantee of global traffic. Closing/reloading loses app memory; normal browser
  cache may survive and is deliberately reused even when expired on first read.
  Cache eviction/clearing is outside app control. No approved persistent weather pack or shared rate service
  exists, and no new storage/backend is silently introduced to claim otherwise.
  Do not reload repeatedly to bypass cooldowns. This is a low-volume optional
  site: no background polls, initial-load weather traffic or automatic requests
  synchronized across users. The accepted operator remains responsible for
  aggregate traffic; approaching MET's global 20 req/s requires disabling or
  separately authorizing the provider's higher-volume arrangement/proxy.
- No “go/no-go” safety assessment or delivery guarantee. The seven-route core,
  downloads, `.18` guide/print and `.16/.17` private imports/replay stay usable.
  Print CSS still excludes weather and private data from organizer cards.

## Validation actually run

All commands used `/Users/eric.bowman/Projects/src/kotr27`. Browser suites serve
only the allowlisted packaged artifact; external URLs blocked. Provider
fixtures are synthetic and **not** used as provider/CORS proof.

1. `node --test tests/route-weather.mjs tests/event-guide.mjs tests/release.mjs`
   — **18 passed**: horizon/timezone/DST, seven real public pins, schema/units/
   elevation/time-order/size, missing days/periods, 429/403/503/rejection/timeout,
   stale/unknown-expiry, Expires + three-hour bounds, single-flight/cancel/late
   response, no private requests, cache/Forget/retention; artifact allowlist,
   deterministic hashes, both new modules' transitive invalidation and warm cache.
2. `node --test --test-concurrency=1 tests/event-guide-browser.mjs tests/site-shell.mjs`
   — **9 passed** on the corrected implementation. Actual keyboard buttons and
   sample disclosure; injected clock with Los Angeles browser timezone; no
   far-future calls; opt-in MET-shaped fetch, cache hit, local stale transition,
   429 stop, 503 UI and late response after a real synthetic private recording
   import; global Forget; core seek still works with provider failure. Existing
   seven public-route PDFs and 320/375/1280 px shell journeys remain passing.
3. `node --test --test-concurrency=1 tests/local-routes-browser.mjs tests/preferences-browser.mjs`
   — **54 passed**: privacy, replay, stale-tab consent, tombstones, uncertain
   storage results, global Forget, denied storage, legacy local links.
4. `node --test tests/route-state.mjs tests/rider-preferences.mjs tests/route-analysis.mjs tests/route-briefing.mjs tests/route-playback.mjs tests/route-time.mjs tests/route-pace.mjs tests/recorded-replay.mjs tests/local-routes.mjs tests/ascent-estimator.mjs tests/ride-clock.mjs tests/climb-sensitivity.mjs`
   — **191 passed**.
5. `node --check` on all changed/new JS/test/build modules and
   `git diff --check` — passed. No configured additional linter invoked.

One initial browser test failed because a 429 stop message masked the private
route explanation. Corrected precedence, added unit regression, reran browser
checks successfully. Local label expiry was also added without network polling.
This was measurable corrective progress, **0/2 nonprogress recovery used**.
Tests' temporary artifacts, Chrome profiles and servers were cleaned up.

## Handoff

No known implementation acceptance blocker remains; independent review is
still mandatory. Advisory/release limits: headless Chrome only, no physical
devices/Safari/Firefox or production-origin API qualification; no distributed
quota enforcement, persistence/offline-pack or historical-data service. No SLA,
field-verified elevation, event departures, summit or route-wide forecast.

Eleven scoped files relative to original HEAD: `assets/site.css`,
`docs/route-weather.md`, `js/route-weather.mjs`, `js/route-weather-view.mjs`,
`js/site-shell.mjs`, `js/event-guide.mjs` (obsolete weather copy only),
`tests/route-weather.mjs`, `tests/route-weather-fixtures.mjs`,
`tests/event-guide-browser.mjs`, `tests/release.mjs`, `tools/build-release.mjs`.
No discovered bead created; Beads writes prohibited. No claim, stage, commit,
closure, delegation, push, merge, credential or access-control changes.

Final preservation checks against the caller's absolute
`800-19-blocked-baseline.json`: all **50 foreign** and **11 private** SHA-256
fingerprints unchanged; private data only fingerprinted, not decoded/output.
All **21** tracked public assets other than intentionally edited `site.css`
match HEAD bytes. Index hash matches the empty baseline; branch/HEAD remain
`epic/kotr27-800` / `3c6c295`; no Git operation is in progress. Final read-only
bead output remains `in_progress`, `Eric Bowman`, original mandatory criteria.
Unrelated role/config/backup files, `.DS_Store`, `.beads/issues.jsonl`,
`docs/prd`, `docs/sparc` and `worktrees` were not changed.
