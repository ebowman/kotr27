# Event briefing and preparation companion · kotr27-800.18

Implemented against `epic/kotr27-800` / baseline `77e5008`, 2026-11-25.
Implementation evidence, **not independent acceptance, deployment or organizer
schedule approval**.

## What is delivered

- The existing **Plan / Prepare / Ride week** shell now presents an event
  snapshot with sources/as-of dates and explicit missing fields.
- Prepare offers four start-anytime ideas × two independent goals
  (social/performance) × two cue styles (feel/power). Each has an action,
  recovery, shorter and missed-week option. No medical, individualized
  coaching or performance guarantee; no account, FTP test or power meter.
- `week=1..4`, `goal=social|performance`, `cue=feel|power` are validated
  public UI choices in the shared revisioned selection. Invalid fields
  default visibly; unknown/private query fields are not forwarded.
  Explore's **Practise selected section** maps ascent → week 2,
  descent → week 3, flat/unclassified → week 1. Route/revision/chapter or
  distance survives the link. Week 4 is an explicitly chosen easy/kit option.
  Practice on a familiar local equivalent, not a prescription to ride the
  selected road or match its grade.
- Packing is optional **document memory only**. Area changes retain checks;
  refresh, document switch and closing lose them. Clear packing checks and
  the existing global Forget reset them. No checklist persistence was added.
  Public practice-link choices can be remembered only under the existing
  route/UI consent mechanism, with its unchanged revocation/tombstone rules.
- Prepare/Ride week show a printable **cleared organizer-route** card:
  immutable revision, status, source and observation date, shared processed,
  raw and source-listed metrics, current section, current/next qualifying
  climb and next sourced feature/unknown stop. No private local route,
  recording or Semonzo example is printable through this card. The same
  exclusion applies to browser print from Explore, not only the print button.

## Sources and clearance boundary

| Fact | Source / observed | Boundary |
|---|---|---|
| Event range 2027-05-20–2027-05-24 | Existing verified, public approved route-pack event metadata; native parent RWGPS event 512634 observation, 2026-11-24 | Date range only. Existing catalog bytes/revisions are unchanged. Withdrawn/unapproved/missing event or dates cannot acquire a countdown. |
| Bassano del Grappa, Vicenza, Italy; organizer Eat Sleep Cycle | Native parent's recorded inspection of [RWGPS event 512634](https://ridewithgps.com/events/512634), 2026-11-24; explicitly supplied as verified event scope in this dispatch | Public snapshot supplement, not a fresh inspection or live notice. No access code. Provider link may require access; no bypass. |
| Europe/Rome | [IANA tzdb zone1970.tab](https://data.iana.org/time-zones/tzdb/zone1970.tab), fetched successfully 2026-11-25 | Table identifies `IT,SM,VA` with `Europe/Rome`; its header says multiple overlapping zones would have separate country rows. Italy has this row. Combined with the verified Italian location, this establishes geographic civil timezone, **not an organizer departure time**. |
| Route facts | Existing sanitized, hash-verified public route pack and `route-analysis` loader; sources observed 2026-11-24 | Public user clearance already recorded in intake; this task changes no original, geometry, download or route revision. Route/revision rights and withdrawal checks also gate print. |
| Practice/packing ideas | Original bounded editorial prompts in `js/event-guide.mjs` | Not organizer training instructions, medical advice, individualized zones or verified event requirements. |

No page-load external network dependency was added. Sources are ordinary
links activated by the reader. The implementation never fetches RWGPS, IANA,
weather or organizer updates at runtime. It does not publish private originals,
device metadata, participant data, access codes or any old private briefing.

`eventFacts` combines the cleared `kotr-2027` catalog dates with this dated
location/organizer/timezone supplement. A future changed event/location needs
review of that supplement too; it is not automatically inferred from geometry.
This publication implements only the current bounded dispatch's verified
public event fields, not blanket permission for future logistics.

## Countdown, identity and print semantics

`calendarStatus` formats **today in Europe/Rome**, then subtracts civil-date
ordinals. It never uses browser-local calendar dates or subtracts hours to a
fabricated departure. Start/end dates are inclusive. Before: calendar-day
count. Within: date range, not "today's ride." After: ended. Missing/invalid
dates/timezone: pending/unavailable. DST cannot introduce fractional days.
The displayed check date is explicit; a **Refresh calendar check** button
updates an open page. There is no timer, workout scheduler or auto-progression.
Rendering/printing also refreshes this dated check.

Route cards reuse the shell's analysis store and sole playback controller.
Identity must match route/revision/geometry and, for cursor detail, the shared
recipe/annotation identity. No analysis, route geometry fetch, position
accumulator, physiology model or trip total is independently constructed here.
Missing metadata/profile/controller stays unavailable/pending, not zero.
Print uses the same card and clearance gate as the screen.

Processed gain uses the existing 250 m windows; raw gain and source-listed
gain remain separate. Extreme D4S elevations/grades are not repaired or
rebranded as verified road grade. Its shared model remains unavailable.
The card makes no arrival-time promise. Source observations are not provider
revision dates or evidence that a printed copy is current.

**No actual facility POIs have been verified**: water/food/toilets/exits and
next stop remain unknown. Qualifying climbs are derived descriptive features,
not named organizer feed stops or rider-specific difficulty. There is no
turn-by-turn/live-position/emergency-service claim.

Print CSS exposes only the event snapshot and selected organizer card; hides
navigation, controls, private view roots, preparation choices and packing.
Full public source URLs are printed. Browser-generated headers/footers remain
the user's browser setting; users can disable URL headers. Already printed
paper/PDFs are outside the app's deletion/withdrawal control. No offline pack
or disconnected-freshness guarantee is implied.

## Retained 2026 jobs → verified equivalent or explicit pending

Based on P01/P02/P19/P20 in [full-site experience](full-site-experience.md),
not copied 2026 private facts:

| Retained job/category | Current destination and disposition |
|---|---|
| Event identity/location/organizer/date countdown | Plan, Prepare and Ride week: sourced fields above; date-only civil-zone countdown. |
| During-event today/tomorrow briefing | Selected source group/route only. Calendar mapping, departure and meeting points **pending**. No D1–D4 calendar inference. |
| Fundraising / event purpose | Explicit pending beneficiary, 2027 purpose statement and approved URL. No guessed or inherited donation link. |
| Arrival/travel/transfer/accommodation/luggage | Explicit pending cleared 2027 arrangements. No guessed hotel. |
| Organizer contacts/support/communication | Explicit pending public instructions. Private contacts/chat/emergency membership details withheld. |
| Safety/closures/facilities | Explicit pending sourced event guidance/arrangements; facility availability unknown. No private medical data or reused emergency contact. |
| Organizer updates/weather | No live service; pending current instructions. Weather belongs to `.19`; no invented forecast or averages. |
| Preparation phases/training | Four start-anytime choices; not calendar-based prescriptions. Social/performance and feel/power remain independent and usable without FTP. |
| Equipment/packing | Optional local checklist with honest refresh/forget behavior; not a compliance or complete safety list. |
| Ride briefing/print | Revisioned selected-route section/current-next effort and unknown stops; source/as-of/limitations on screen and paper. |

## Legacy backlog proposal — owner decision, no closure

Read-only inspection used the **exact** `kotr27-k9t` and `.2` through `.6`
records on 2026-11-25. All six are **open**. No `kotr27-k9t4` identifier was
used here; no old task was claimed, modified or closed.

| Legacy record | Proposed mapping / remaining owner decision |
|---|---|
| `kotr27-k9t` Field Guide v1 | Consolidate under full-site epic 800 after comparing acceptance, rather than keep a parallel preview-only product. Not completion of the old epic. |
| `.2` attributed example ascent | Existing separate Semonzo provenance/profile plus `.4/.6` analysis contracts are candidates for reuse. Owner must reconcile old `data/ascents` artifact wording with delivered modules before supersession. This task does not relabel Semonzo as official or redo intake. |
| `.3` four-week training content | Propose supersession by reviewed `.18`: four distinct goals and all 16 combinations with action/recovery/shorter/missed-week cues. `js/event-guide.mjs`, not a duplicate `data/training` store. |
| `.4` linked chapter explorer | Existing `.7/.10/.11` shared selection, chapter/profile/no-map work is the proposed equivalent, with revision-aware links. `.18` adds no new map implementation. Owner should compare original map/fallback acceptance. |
| `.5` weekly selector | Propose supersession by reviewed `.18`: independent selectors, stable public practice links, chapter context, refresh/back and phone/keyboard evidence below. No account/storage/map prerequisite. |
| `.6` practice connection + Pages qualification | Split: section→practice navigation in `.18`; broader release/device/live-site qualification remains `.21`. No push, Pages enablement or live URL smoke test is authorized/performed here. Do not mark the entire legacy record complete on this evidence alone. |

## Validation actually run

All commands ran in the named physical project root; Chrome served **only the
allowlisted built artifact** under `/kotr27/`, with external URLs blocked.
Temporary fixture releases, browser profiles and synthetic input files were
removed after their server jobs completed.

1. `node --test tests/event-guide.mjs tests/release.mjs tests/route-state.mjs tests/rider-preferences.mjs`
   — **59 passed**. Includes before/start/end/after, Italy DST boundaries,
   missing/restricted metadata, all 16 choices, strict public preference-link
   validation, all seven real card identities/metrics and mismatches, private/
   example/withdrawn exclusions, deterministic allowlist/transitive fingerprints,
   warm-cache lifecycle and legacy Semonzo/sensitivity.
2. `node --test --test-concurrency=1 tests/event-guide-browser.mjs tests/site-shell.mjs tests/preferences-browser.mjs tests/route-briefing-browser.mjs tests/local-routes-browser.mjs tests/route-pace-browser.mjs tests/trip-planner-browser.mjs tests/route-comparison-browser.mjs`
   — **77 passed**. New guide checks at 375 px exercise actual shell keyboard,
   all choices, chapter context, back/refresh, checklist clearing/global Forget,
   200% font/no overflow, no-map/blocked storage, missing profile/catalog and
   invalid revision. Browser timezone set to Los Angeles while Rome crosses
   event-start midnight: date-only UI correctly says within range.
   Actual Chrome PDFs for all seven routes were piped to `pdftotext -layout - -`;
   source URLs, full wrapped revisions, as-of/uncertainty/facility labels were
   checked, bounded to at most four pages. Both missing-local and **real
   synthetic imported recording** print paths excluded local name/file/
   telemetry and prior official totals. No external page requests or browser
   exceptions. Existing `.16/.17` multi-tab/tombstone/global-Forget tests,
   exact source-time navigation, download completion barriers and isolation
   remain passing.
3. `node --test tests/route-state.mjs tests/rider-preferences.mjs tests/route-analysis.mjs tests/route-briefing.mjs tests/route-playback.mjs tests/route-time.mjs tests/route-pace.mjs tests/recorded-replay.mjs tests/local-routes.mjs tests/ascent-estimator.mjs tests/ride-clock.mjs tests/climb-sensitivity.mjs`
   — **191 passed** (overlaps command 1; counts are not additive).
4. `node --check` on the eleven changed/new JavaScript/test/build modules,
   and `git diff --check` — passed. No configured additional linter was invoked.

Initial guide runs exposed new practice parameters being rejected by the
existing preference-link allowlist and a practice link retaining its initial
week after seeking. Both were fixed and the exact checks rerun successfully.
The initial broad regression also exposed an unnecessary default-parameter
expansion of opaque local links (fixed) and shell assertions for removed
"not yet available" copy (updated to require the delivered guide and explicit
no-calendar-inference text). No exception or failure was suppressed.
These corrective passes made measurable progress; **nonprogress recovery
allowance remains 0/2 used**.

Limits: headless Chrome/PDF plus source/unit evidence only; native Safari,
Firefox, physical devices/printers, PDF viewers and screen readers are not
qualified here. Organizer logistics, beneficiary/fundraising link, facility
POIs, date-to-route mapping and departures remain pending by design.
Fresh independent review is still required. No Beads writes, staging, commit,
closure, delegation, push, merge or deployment performed.

Final preservation check: all **50 foreign** and **11 private** file hashes
match the caller's exact external preservation baseline; all **21 original
tracked public assets** other than the intentionally changed `site.css` match
HEAD byte-for-byte. Private bytes were fingerprinted, not decoded or published.
Branch/HEAD remain `epic/kotr27-800` / `77e5008`; index remains empty.
Unrelated installer/role/config/backup edits and untracked `.DS_Store`,
`.beads/issues.jsonl`, `docs/prd`, `docs/sparc`, `worktrees` were not changed.
