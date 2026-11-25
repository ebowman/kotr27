# KOTR 2027 full-site rider experience

Product interaction contract · 24 November 2026 · `kotr27-800.1`

Current implementation evidence: [final qualification](final-qualification.md)
reconciles **every P01–P22 row and both personas**, including pending facts,
Chrome-only operator scope, deferred browsers/fullscreen and unresolved
qualification findings. The design-time observations below are historical,
not current route-rights or implementation status.

## Status and evidence boundary

This is a design specification, not an implementation, launch approval, event announcement or completion checklist. It defines the full **Plan / Explore / Prepare / Ride week** experience and the acceptance journeys that subsequent bounded implementation must satisfy. “Must” below describes that target, not a capability already shipped.

The companion [architecture decision](full-site-architecture.md) defines the static/online/offline boundary, proposed resource and storage limits, publishing gates and separately gated server options; it grants no implementation or deployment authorization.

The 2026 audit used read-only `gh api` source reads at **ebowman/kotr26@98cd86dc6443dcf713e125fa2ef53cee629c4339**, including page scripts, parsers, storage, flyover, weather and the elapsed-time PRD, not just the README. All 2026 evidence below is **S: statically observed code/markup**. **U: runtime unverified** applies to every row: no 2026 browser run, actual device download, camera quality, provider response, accessibility or physiological accuracy was validated here. A declaration in a PRD is design evidence only; it is not proof of working software. In particular, the [README page inventory][s-readme] is a discovery index, not an acceptance result.

2027 integration observations are local source inspection, not new runtime validation. Existing test files are regression seams, not tests claimed to have run for this documentation change.

### Facts and publication gates

- The parent’s route-intake evidence, stored in `kotr27-800.2` and its epic, reports seven RWGPS route records and an event listing of **20–24 May 2027**. This task did not re-inspect RWGPS or acquire exports. The D1–D4-to-calendar mapping, departures, final revisions and publication permissions remain unresolved. Do not turn the listed date range into invented ride dates or a precise rollout countdown.
- Public redistribution of the new route metadata/geometry/downloads is **not approved**. Use synthetic catalog fixtures for implementation until intake clears specific fields and assets. Access to an export is not redistribution permission. No access-code URLs belong in source, links, logs, print or offline packs.
- Surface must remain source-qualified: observed D1 card “Paved” conflicts with detail “98% paved / 2% unpaved”; D2L is “Unknown.” Neither becomes an all-road claim. Source zeros or account-dependent “Est Time” values are not rider estimates.
- The Semonzo trace remains an **example ascent**, independently attributed and cleared for its existing use. Semonzo names on a D3L page do not establish geometry equivalence. Never rename this example into the official D3L route; no old group rule is automatically authoritative for the new catalog.
- Do not port 2026 contact, medical, hotel, chat or participant details. Event briefing categories are parity jobs, not permission to copy their contents. Missing 2027 logistics, fundraiser destination, stop availability and weather locations stay pending until verified and cleared.
- Static-first does not mean disconnected: third-party maps/weather require internet; local calculations do not require a custom backend. Opt-in offline coverage is separately explicit. Authenticated announcements, organizer editing, cross-device sync and check-ins are ideas for architecture evaluation, **not approved server scope**. No live tracking, turn-by-turn navigation or health prescription is implied.

## Experience hierarchy

The first useful action is **understand a route**, not watch a movie or enter FTP.

| Area | First screen and primary action | Secondary disclosure |
|---|---|---|
| **Plan** | Verified/pending event summary; route days/variants; “Build my trip”; selected-route status and totals | Compare variants, change report, individual/selected-set downloads, event/fundraiser source details |
| **Explore** | Selected route’s text briefing, profile and ordered chapters; “Explore this section” | Linked 2D outline, comparison/skyline/radial, time scenarios, explicitly requested 3D, local route library |
| **Prepare** | “Find a practice ride”; start-anytime week, independent goal and cue choices; packing | Chapter-linked practice, recovery/shorter option, model assumptions; optional preferences |
| **Ride week** | Selected day’s verified briefing, route revision, next sourced feature, download/print/offline status | Tomorrow only when calendar mapping is confirmed; optional weather and local recorded-ride review |

Use the same four labeled navigation links everywhere, with current-area indication, one `main` heading and a skip link. Desktop: horizontal navigation plus selected-route context bar. Phone: wrapping top navigation in document flow (not an overlay on controls); the context bar sits below it. Preferences is a utility button, not a fifth mandatory journey. Switching areas retains the selected route/revision/chapter; it never silently changes the itinerary.

Progressive disclosure order: **facts/status → route/variant choice → briefing/profile/chapters → optional assumptions/time comparison → optional cinema**. A direct 3D link may open that view paused, but must include the same briefing and “Back to route briefing.” Cinema is never necessary to discover a climb or download a route.

## Shared identity, state and revision contract

### Catalog and selection

The catalog is the authority; DOM cards, charts, playback and download buttons may not own duplicate route facts.

| Record | Required semantics |
|---|---|
| Event/day/variant | Stable IDs, display names, separately optional calendar dates/timezone; verification and publication classification. A source-name “D2” is not a date. |
| Route identity | Stable `routeId` independent of display name; `kind: example / organizer / local`; day/variant references where applicable; provisional/confirmed/superseded/withdrawn status. |
| Revision bundle | Immutable `revisionId`, geometry checksum, manifest identity and revision-bound profile, chapter, POI and download references; derivation version and source observation/publication dates. Geometry change invalidates dependent bindings. Annotation-only changes also produce an identifiable bundle revision. |
| Facts | Source-reported distance/ascent/surface stored separately from derived distance/ascent/grades, with units, method, source, as-of and uncertainty. Unknown is `null` with reason, never zero. Each displayed total identifies its fact basis. |
| Availability | Separate rights/access state, geometry state, profile/elevation state and available file formats. A valid metadata record need not have exportable geometry or time estimates. Permission denial cannot be bypassed through a chart or pack. |
| Itinerary | At most one explicit route/revision per day; unselected days remain unselected. No default Long or silent fallback to another variant. Totals state selected-day count and completeness. |
| Active selection | `{routeId, revisionId, chapterId?, distanceM, area, view}` shared by all consumers. Active exploration is distinct from itinerary membership; “Use for this day” changes the itinerary explicitly. Compare candidates do not automatically replace it. |
| Scenario | Validated example/partial/personal rider state plus named effort, optional stops and model version; memory-only initially. Animation and camera state are separate. |
| Local recording | Opaque local ID, import kind and validation/provenance; private bytes and sensor streams never enter the public catalog, share URL or network. |

Choose a single default display basis for comparable trip metrics: derived metrics when all selected routes support the same validated derivation, otherwise explicitly source-reported metrics where complete. Never silently mix bases; present separate partial subtotals if neither is complete. Sum unrounded values, round only display. A route chosen once for a day contributes once; different days using the same geometry are still distinct planned rides.

### Links, browser history and stale selection

Proposed public grammar under `/kotr27/`: `index.html?area=plan` and `explore.html?route=<public-id>&rev=<bundle-id>&view=briefing&chapter=<chapter-id>`. Optional `at=<metres>` supports distance seeking; `chapter` takes precedence over `at` and its start distance is canonical. Prepare links add `week=1..4`, `goal=social|performance`, `cue=feel|power`. These are public UI choices, not rider measurements.

- New shared official-route links always carry revision. A route-only link resolves the current available revision and visibly says which revision was resolved; it is not a revision-pinned link. Fresh home loads have no inferred itinerary.
- Validate ID, revision, view and distance together. Unknown route/revision or malformed distance shows “This route link cannot be opened” with **Choose a route** and **View available revisions** (if any); do not substitute another route. Invalid chapter on an otherwise valid bundle opens its briefing paused with “Section unavailable”; do not map the old chapter to a new one by name.
- Superseded, still permitted bundles open with a dated warning and **Compare changes / Use current revision**. Withdrawn or no-longer-permitted bundles show a tombstone; no new export or automatic replacement. Any retained offline copy must be visibly unverified/withdrawn on reconnection, with delete action; it cannot promise freshness while disconnected.
- Updating an itinerary requires explicit acknowledgment of changed distance/ascent/chapters/downloads. Commit the new bundle atomically, invalidate its estimates/POI bindings/offline pack, and pause at the briefing start. Preserve other days and rider preferences. Failed update leaves the previous complete permitted bundle identified as old, never a mixture.
- Route switch resets position to zero and chapter to none unless a valid link supplies them. A generation/request identity rejects late results from previous selections. Keep the shell usable during load; do not show old facts beneath a new title.
- Area/route/chapter/view changes create meaningful browser-history entries. Continuous scrubbing replaces the current entry instead of pushing per frame. Back/forward restores the exact validated bundle/position paused, including text/profile when map loading fails. Navigation moves focus to the new heading; slider updates keep focus on the slider.
- Preserve `index.html#seek-N` as metres on the **Semonzo example only**, paused; preserve bare `explore.html` as the existing example ride-clock entry. Invalid legacy fragments get a visible explanation and example briefing, not official-route interpretation.
- A `route=user:<id>` compatibility link is local-only, with “Available only in this browser.” Missing/deleted records offer **Import again / Open local library**, never an official substitute. Public **Share** omits local IDs, rider inputs, filenames and telemetry; for local records it explains that sharing the ride is unsupported.

## 2026 parity matrix and falsifiable journeys

Owners below are **implementation scope owners**, not assignee/status changes. A number `.N` means `kotr27-800.N`. `.1` owns this contract; `.21` must reconcile every row with packaged evidence. Sources are pinned links defined at the end. Each row is S/U as defined above. Tests use synthetic cleared data until real routes pass intake.

| ID / inventoried rider job | Static 2026 evidence and limitation | 2027 destination / disposition / owners | Falsifiable acceptance journey |
|---|---|---|---|
| P01 Home, event identity, countdown, during-event today/tomorrow | [Countdown branches][s-countdown]; [live-event rendering][s-live]. Code embeds dates and agenda; comments do not establish 2027 facts. | Plan event summary → Ride week. Retain with sourced fields and explicit pending state. `.2 .4 .7 .18` | Freeze time before, within and after a confirmed fixture event in its configured timezone; headings change correctly. Remove departure/date mapping: no ticking rollout timer or invented “today” ride; day selector still works. |
| P02 Fundraising and event purpose | [Home footer categories/link][s-purpose]; not evidence of a current 2027 fundraiser. | Plan event details; Prepare/Ride week source footer. Retain, pending current approval. `.2 .18` | Cleared fixture exposes the intended external link and source/as-of; absent/unapproved target displays pending text with no inherited 2026 link. |
| P03 Day/variant choice and selected trip totals | [Selection handler][s-selection], [totals][s-totals]; 2026 silently defaults to Standard. | Plan itinerary; explicit choice and completeness. `.4 .8` | Select one fixture variant per day, switch only day B, then deselect it. Other choices persist in memory; count, distance and ascent exactly match selected unrounded facts; missing ascent produces a partial total, not zero. |
| P04 Individual GPX/FIT export | [GPX conversion and original FIT byte download][s-download]. GPX path drops cue/POI information; FIT preservation is source behavior, not device interoperability proof. | Plan/Explore downloads, revision labeled; retain both formats where genuinely available. `.2 .5 .8` | Export a cleared fixture in each available format; bytes/hash and revision match manifest. GPX-only route says “FIT unavailable”; never changes extension. Unapproved route cannot export. Display cue limitations before download. |
| P05 Selected-set downloads | [Selected files and batch loop][s-batch]; inner failures are logged and can leave no visible per-file outcome. | Plan “Download selected routes”; retain with outcome list. `.8 .21` | Select mixed variants and a missing-format fixture; fail one transfer and block multiple downloads. Only chosen revisions are offered; each file shows available/failed/handed-to-browser status and individual retry link. Never report “all saved” without evidence. |
| P06 Route overview, profile and route-position discovery | [Home map/profile entry points][s-home-map], [profile scrubber][s-compare-scrub]. Map services and index-fraction alignment are not verified geometry correctness. | Explore briefing + linked outline/profile/list, before optional 3D. `.6 .10 .11` | With tiles blocked, select a chapter then seek a distance; text and profile report identical position, completed/remaining distance and start/finish direction. With geometry missing, metadata remains readable and seek explains unavailability. |
| P07 Compare variants and added distance/climbing | [Comparison selection and ghost outlines][s-compare-select], [home comparison table][s-home-compare]. | Plan Compare → Explore Compare. Retain; common metrics/axis labels, not arbitrary difficulty. `.6 .8 .9` | Compare two same-day fixtures; delta equals catalog values; select one for the itinerary explicitly. Switch equal-distance to normalized-progress axes: label changes and normalized lengths are never presented as equal kilometres. No-tiles outline/text still works. |
| P08 Skyline across days and variants | [Variant selector][s-skyline-controls], [profile rendering][s-skyline-render], [POI/distance labels][s-skyline-poi]. | Explore → Compare → Skyline. Retain secondary view with common elevation scale and linear/table equivalent. `.6 .9` | Show both variants then one; common elevation axis remains the same across visible panels. Keyboard-select a route/chapter and open its revision-pinned briefing; table exposes every metric/POI hidden by chart label thinning. |
| P09 Radial route and POI overview, rotation | [Radial elevation/distance/POI bands][s-radial-data], [rotation handlers][s-radial-rotate]. Wheel is an abstract encoding, not a geographical map. | Explore → Compare → Radial. Retain secondary view; linear POI list default on small screens. `.6 .9` | Select a variant and POI in radial or equivalent list; both open the same revision/distance. Rotation has buttons/reset as well as drag; reduced motion removes inertia. Missing POIs says “No verified POIs,” not “No stops needed.” |
| P10 Easy/Steady/Hard pace comparisons | [60/75/90% labels][s-pace-controls], [separate pace solver][s-pace-solver]. Multiple old solvers are not a numerical parity requirement. | Explore → Time scenarios. Retain functional comparisons on shared 2027 model. `.13 .14 .15` | For one valid profile, change 60/75/90% scenario and observe model-labeled moving totals/chapter times; same inputs match all consumers before rounding. Invalid/missing elevation yields unavailable, never a plausible flat ride. |
| P11 Flyover estimated time, All Day and effort coloring | [All Day resolver/time series][s-allday], [HUD interpolation][s-eta], [effort toggle][s-effort]. “Elapsed” is modeled motion here, not recorded time or stop-inclusive time. | Explore Time + optional flyover HUD. Retain with renamed time semantics and heuristic disclosure. `.10 .14 .15` | Change playback 1×→4× at a fixed seek point: model time does not change. Change effort: it does. All Day shows seed duration and resolved fraction; missing profile is labeled example, not personal. Effort colors have numeric/text legend. |
| P12 Play/pause, seek, speed, reset and persistent controls | [Control wiring][s-controls], [play/seek functions][s-play-seek], [UI pin/auto-hide][s-ui-pin]. Actual smoothness is U. | Explore shared controller and cinema control deck. Retain; essentials never auto-hide in briefing. `.10 .12` | Play, pause, seek, previous/next chapter, restart and return to overview via touch and keyboard. Delayed load, hidden tab and route switch leave deterministic paused state with no time catch-up. Pin/unpin optional cinema chrome cannot make essential controls unreachable. |
| P13 Follow/Bird’s-eye/Side/Cinematic, pitch/zoom/side, fullscreen, shortcuts | [Visible shortcut inventory][s-shortcuts], [keyboard/fullscreen wiring][s-keyboard], [fullscreen implementation][s-fullscreen]. | Explore → 3D; named presets and optional camera detail. Retain camera jobs, with safe shortcut scope. `.10 .12` | At a selected point switch all four presets, adjust side/pitch/zoom, enter/exit fullscreen, reset camera: position and model time stay constant. Denied fullscreen leaves inline controls usable. Typing in FTP field never triggers camera shortcuts. |
| P14 Climb detail and effort understanding | [Detected climb markers][s-climbs], [popup length/grade/gain][s-climb-popup], [duration “sustainable” thresholds][s-climb-heuristic]. Hover-only markers and physiological labels are not carried forward. | Explore chapter detail: source-qualified grade/gain, significance and optional modeled time/work. `.6 .11 .14 .15` | Keyboard/touch opens a climb detail with interval, gain, grade method and next section. Same detail works without FTP; optional example scenario is labeled. No unsupported “sustainable for you” judgment appears. |
| P15 Local route/recording upload, persistence and recovery | [Upload entry][s-upload], [IndexedDB CRUD/validation][s-store], [user-route loading][s-user-load]. Store API has deletion; this alone does not prove a complete old library UI. | Explore local library → common briefing; retain and make management explicit. `.3 .16` | Import valid GPX and FIT without network transmission. Decline persistence: session works. Consent: reload opens local ID. Delete it: old link explains missing record. Corrupt/oversize input or storage denial gives an actionable message, not an official route fallback. |
| P16 Recorded FIT power/cadence/speed/heart rate | [FIT fields][s-fit-fields], [telemetry index/HUD][s-telemetry]. 2026 can fall back to record-index fraction; this is not reliable elapsed-time alignment. | Explore → Local replay; recorded signals separate from modeled HUD. `.16 .17` | Replay fixture with known timestamps, a pause and missing cadence; show actual recorded values only at valid samples, explicit gap/unavailable labels and recorded elapsed time. Model changes cannot rewrite recorded signals; no values sent to network. |
| P17 Planned-vs-actual ghost and route coverage | [Static ghost/corridor comparison][s-ghost], [recorded time/stats][s-recorded-time], [persisted planned choice][s-compare-persist]. Old ghost is a static planned line, not a timestamp-synchronized racing rider. | Local replay → Compare with planned revision. Retain overlay/coverage job; add honest alignment modes. `.6 .16 .17` | Choose exact plan revision for a loop/partial/off-route fixture; show basis and unmatched sections. Ambiguous loop match declines timing delta instead of jumping to nearest coordinate. Recorded-elapsed and matched-distance modes are visibly different; revision mismatch requires acknowledgment. |
| P18 Optional rider values, route/camera preferences | [Profile defaults/save/clear][s-profile], [route persistence][s-route-preferences], [camera preference readers][s-camera-preferences]. 2026 writes automatically and clamps values. | Shared Preferences; opt-in persistence, explicit invalid states. `.3 .7 .13` | Complete Plan→Explore with fields blank. Supply weight only: FTP stays marked assumed. Toggle kg/lb without changing original numeric meaning; invalid FTP blocks personal result, not navigation. Deny/revoke storage and clear all; no rider values in requests or URLs. |
| P19 Training countdown, phases and rider preparation | [Phase rendering][s-training], [personalized note][s-training-personal]. Old date-based advice is not verified coaching. | Prepare: start-anytime four-week guide, separate goal/cue axes; calendar note only when verified. `.18` | Without FTP, choose each week and both goals/cue styles (16 combinations); each has usable action, recovery, shorter and missed-week notes. Chapter practice link opens intended week; switching cue preserves week/goal. No prescribed medical outcome or compulsory FTP test. |
| P20 Event briefing, equipment, safety and communication categories | [Briefing section structure][s-briefing]. Citation is to structure, not authorization to reproduce private facts. | Prepare packing + Ride week sourced briefing/print card. Retain categories; unknown/private facts withheld. `.2 .3 .18 .20` | With absent logistics, show pending fields and no guessed hotel/contact/chat. With cleared fixture, print selected-day card carrying revision/as-of, limits and sources. A participant-only field cannot leak into public HTML, print or offline manifest. |
| P21 Weather with unavailable-date fallback | [Provider request][s-weather-request], [historical fallback/extraction][s-weather-fallback]. Hard-coded averages are not an observed forecast. | Optional Ride week/route weather. Retain with per-day source, location, time and type. `.3 .19` | Mock date outside horizon, partial forecast, stale cache, 429 and offline. Core route remains usable; each day distinguishes forecast/observed/historical/unavailable. Valley data is never labeled summit weather; local track/profile never enters requests. |
| P22 Camera trouble recovery / diagnostic capture | [P shortcut][s-keyboard], [panic capture entry][s-panic]. This is a technical recovery affordance, not a core rider job. | 3D “Return to rider / Reset camera / Use profile.” **Proposed removal of raw camera-state capture UI**, not recovery. `.12 .21` | Force camera/map failure; recover to readable briefing with same selected revision and position. No automatic debug upload or private track dump. Release review must explicitly accept capture removal or retain a safe local-only diagnostic alternative. |

### Gap and change disposition

The current 2027 site is a single-example preview/ride-clock/sensitivity experience; it does **not** presently establish full-catalog parity for P01–P22. The matrix is the bounded destination for those gaps, not evidence that they are delivered.

No baseline rider job is silently deferred. Downloads and sourced logistics can be **pending due to rights/data**, not declared complete; `.2/.8/.18/.21` own the visible gate. Weather provider choice remains `.19`, offline pack mechanics `.20`, architecture limits `.3`. Unsupported FIT export, missing geometry/elevation, unsourced stops and unavailable historical data must remain explicit rather than synthesized.

Intentional replacements requiring parity review: automatic storage → consent; silent Standard selection → explicit itinerary; hover-only climb popups → accessible chapter details; arbitrary difficulty/sustainability judgments → supported metrics and disclosed assumptions; duplicated solvers → one model; missing elevation treated as flat → unavailable estimate; map autoplay/inertial decoration → opt-in motion. The old diagnostic capture UI removal is a proposal (P22), not an implicit omission. Skyline, radial, local recordings and planned comparison are retained, not dismissed as optional backlog simply because they are secondary navigation.

## Screen and control contracts

### Common responsive rules

Desktop breakpoint is 960 CSS px; 600–959 uses the same stacked reading order with room for two cards; below 600 uses one column. Qualify at **320, 375 and 1280 CSS px**, plus 200% zoom. No page-level horizontal overflow; wide comparison graphics get an explicitly labeled scroll region and an equivalent stacked table/list. Controls wrap before labels truncate. Minimum interactive target is 44×44 CSS px, including chapter buttons; profile lines themselves are not the only targets.

Essential position/selection text is outside canvas/SVG. Color never carries selection, effort or error alone. Use native buttons/selects/ranges, visible focus, `aria-current`/pressed state where appropriate and labeled units. A polite status region announces completed selections/errors, not every animation frame. Error text is associated with its field; no toast-only data-loss message. Dialogs trap focus, Escape closes and focus returns to the invoker. Reduced motion removes autoplay, camera transitions, inertia and animated chart morphs; explicit Play remains available with a clear motion warning and immediate Pause.

### Plan

Desktop: event/status header, day cards left (roughly two-thirds), itinerary summary right. Mobile: same order, summary after selected-day cards with a small “View trip summary” jump link near the top. Do not overlay a sticky total on radio controls.

Each day card shows source day label, calendar date **only if confirmed**, status/as-of, variant radio choices, comparable distance/ascent with basis, surface uncertainty, **Briefing**, **Compare**, and **Use for this day**. Previewing a radio candidate updates its preview; committing changes itinerary totals. Single-option day still requires itinerary inclusion. An unavailable route displays reason and alternative-choice link without automatic selection.

Summary displays selected-day count, omitted days, totals/completeness, revision changes, **Download selected** and **Clear itinerary** (confirmation). Download panel lists filename, revision, format, size if known, cue limitations and approval/availability. Batch progress distinguishes preparing, failed, ready/handed to browser and retry; it cannot know the user actually saved to disk. Cancelling leaves selections intact.

### Explore briefing and comparison

Desktop: route/revision strip; main profile/optional outline pane and adjacent chapter details; control deck under profile; chapter/POI list below. Mobile: strip → concise briefing → chapter select/list → profile → selected-detail text → deck → optional map. No map request is required before that content is usable.

Briefing answers: what route/revision is this; provisional or confirmed; length/gain and terrain uncertainties; start/finish/direction; significant sustained sections; sourced stops; limitations. “Most sustained climb” must name the derivation/ranking criterion (for example greatest ascent among detected continuous climb intervals), not claim universally hardest. If ranking is unsupported, use “Sections” with no superlative.

Selecting a chapter or POI seeks to its revision-bound route occurrence, pauses and updates outline/profile/text together. Details show interval bounds, length, gain, supported average/maximum grade with smoothing window, completed/remaining distance, next climb and next sourced POI distance. Near finish, say “No later verified feature.” On loops, coordinates alone cannot identify the occurrence. “No verified water stop” is not a statement that water does not exist.

Compare is a view of the same selection, with **Use for day / Open briefing** explicit. Default two-route comparison uses equal distance and common elevation axes; user may choose normalized progress with a conspicuous label. Skyline keeps common elevation scale; radial explains angle/radius meaning and exposes rotation −/+/reset. A table/list covers all metrics and POIs even when chart labels are thinned. Changing representation retains route/revision and chapter.

### Playback state machine and deck

State is `idle → loading → ready → playing ↔ paused → finished`, with `error` on unavailable route data. `ready` is not autoplay. An unavailable 3D renderer is a **separate capability state**, not route error when profile/text are valid.

| Action/state | Required behavior |
|---|---|
| Load/switch | Pause immediately; increment request identity; clear misleading old details. Only matching complete bundle may enter ready. Error offers explicit retry or route choice, without retry loop. |
| Play/Pause | Play only with valid playback geometry/timeline; initial Play starts from current seek. At finished, label becomes **Replay from start**; activation resets to zero. Pause freezes position and orbit. |
| Distance seek | Range + numeric distance + chapter buttons are equivalent. Pointer/keyboard manipulation pauses; clamp ordinary slider bounds, reject malformed URL input. Arrow step 100 m, Home/End start/finish. |
| Previous/next chapter | Seek to adjacent chapter start, paused; disable with text at boundary. No chapter data leaves distance seek usable when geometry exists. |
| Restart / Overview | Restart resets position to zero, paused. **Route overview** changes camera/layout, not position. Label distinctly; legacy reset adapter may reset position but must announce that. |
| Playback rate | 0.5× / 1× / 2× / 4× animation rate. One shared controller; never use rate as rider speed or a time-model input. |
| Hidden tab / interruption | Pause, discard elapsed background wall time. Resume only by explicit Play. Late terrain readiness never resumes playback. |
| Camera/manual map | Camera changes preserve route progress/scenario. Manual exploration pauses and displays **Return to rider**; that restores framing without seeking or resuming. |
| Failure | Retain selected revision and useful text/profile; disable only unsupported controls with reason. Retry is user-initiated. |

Essential deck: **Play/Pause, Previous chapter, Next chapter, distance range/readout, Restart, Route overview**. Rate and optional 3D button are on a second row on phones. Cinema may add **Keep controls visible**; keyboard focus always reveals controls and pause/exit remain reachable.

3D presets are **Follow**, **Overview/Bird’s-eye**, **Side**, **Cinematic**; refinements (pitch, zoom, side Auto/Left/Right, reset camera) live in **Camera options**. Fullscreen button states **Enter/Exit fullscreen**; unsupported/denied API announces why and remains inline. Orientation/start/finish and route position are readable without visual guessing.

Shortcuts apply only when the explorer control region has focus, never in editable fields, native selectors, dialogs or with browser modifier keys. Space toggles playback; Left/Right seeks 100 m outside native widgets; 1–4 select animation rates; C/B/S/V select camera presets; X cycles side; J/K zoom; Up/Down adjust pitch only in camera-control context; 0 resets camera refinements; F requests fullscreen; ? opens help; Escape closes help/fullscreen. Every action has a labeled touch/keyboard button. P diagnostic capture is not retained by default (P22).

### Time scenarios, rider preferences and recorded replay

Four clocks must never share an ambiguous “Time” label:

1. **Animation rate**: screen traversal rate, independent of physical prediction; camera orbit is separately bounded. No physiological meaning.
2. **Estimated moving time**: shared model integral along the selected revision, excluding stops. Show example/partial/personal assumptions, physical model version and uncertainty/limitations.
3. **Estimated elapsed incl. planned stops**: moving estimate plus explicitly placed stop durations. At a stop, elapsed increases while distance stays fixed. Departure/arrival wall-clock predictions require confirmed date/timezone and an explicit departure assumption; otherwise show duration only.
4. **Recorded elapsed time**: validated recording timestamps relative to start, including pauses/gaps, not animation seconds or predicted moving time. Recorded moving time is separate and unavailable unless its detection method is defined; sensor gaps never become zero power or simulated observations.

For elapsed-time seek, the scenario timeline is primary; for distance seek inside a stop location, use arrival at that stop and label it. A distance alone cannot identify time within a pause. Comparisons name their basis; two riders at one modeled minute is not the same view as two scenarios at one distance.

Scenario chooser retains **Easy 60%, Steady 75%, Hard 90%** as disclosed constant-fraction comparisons, not promises of sustainability. **All Day (duration heuristic)** seeds moving duration at 75% and uses `<2 h:80%, 2–<3:75%, 3–<4:70%, 4–<5:65%, 5–<7:60%, ≥7:55%`; show seed/resolved value and discontinuity caveat. This preserves the 2026 job, not its physiology claims. Invalid duration yields unavailable rather than a guessed personal answer.

The existing 2027 **ride-clock 70/80% scenarios** and **sensitivity fixed 80% default, adjustable 70–90%** retain their meanings. Labels must distinguish these from the 60/75/90 presets and All Day. Synchronize totals only when inputs, route/revision, fraction, model and stops actually agree; never force agreement by silently changing a fraction. The estimator’s low-level 60/75 defaults are not the current ride-clock UI defaults.

The sensitivity panel retains baseline, weight-only, FTP-only and combined comparisons, numeric controls and 2D heatmap alongside optional 3D surface. Identify eligible selected route/climb, fixed bike/kit and effort; no peak-power/weight-loss advice. Cache by revision/model/inputs, never recompute a mesh on each playback frame. Missing elevation disables estimates/sensitivity but not the route briefing.

Preference dialog defaults to blank inputs and an explicitly labeled example (current model example: 75 kg, 220 W, 12 kg bike/kit). Partial input labels each assumed value. Retain original unit entry across kg/lb toggles; validate current model bounds (20–250 kg, 30–650 W) without silent clamping. Invalid input shows inline error and suppresses dependent personal estimates; **Use example / Clear inputs** restores example, not a hidden last-valid personal result. Separately unchecked consent controls govern **Remember rider values** and **Remember route/UI choices**; clearing preferences must delete remembered values and reset dependent UI. Architecture owns storage versioning/budgets; denial leaves memory-only use.

Local library provides file picker/drop target, supported-format/size notice, import validation, **Use for this session**, optional **Remember on this device**, per-file delete and delete-all confirmation. Architecture/import owners finalize byte/point limits before implementation; 2026’s 25 MB extension check is evidence, not sufficient validation. Reject unsupported/corrupt files safely, sanitize display names, preserve segments/timestamps and say which analyses are unavailable. A missing elevation track can have an outline without an invented profile.

Replay shows recorded and estimated values in separate labeled panels. Planned comparison requires a chosen plan revision, alignment basis (recorded elapsed / matched route distance), match confidence and unmatched ranges. For ambiguous loops/reversals/detours show unavailable deltas and static overlays; do not invent synchronized ghosts. Missing telemetry signals remain “Not recorded”; changing model FTP can change modeled comparisons/optional zone interpretation but never recorded watts.

### Prepare and Ride week

Prepare uses week 1–4, goal **Enjoy the ride / Train for performance**, and cues **Ride by feel / Use power zones** as independent choices. No FTP input is required to read zone cues. Show one practice action first, then recovery, shorter option, missed-week note and rationale; no mandatory countdown-based program. **Practise this section** links preserve route/chapter context but do not claim the example is an official stage.

Ride week defaults to selected day, not “today” until calendar mapping is verified. Order: revision/change notice → departure/logistics fields with source/as-of or pending → route/chapter briefing → next sourced feature → download/print/offline actions → optional weather. Packing checks are local optional state, not medical compliance. Print includes route kind/revision, source/as-of, fact basis, limitations and no private fields unless a separately approved access design permits them.

Offline panel must list covered assets, size/progress, revision, saved-at and exclusions (live weather/alerts and uncached third-party tiles). First-ever offline visit cannot promise the app is installed. Downloaded-pack reload works only for its declared assets; quota/eviction/incomplete download has explicit state. Stage full replacement before activation, retain prior complete permitted pack on interruption, and notify on reconnect; never cache private content or bulk third-party maps by convenience.

Weather is opt-in and requests approved public locations only. Each card labels source, location/elevation, retrieved/valid times/timezone and **forecast / observed / historical context / unavailable / stale**. No historical fallback without its own valid source. No forecast months ahead; no valley-to-summit substitution or safety assurance.

### Cross-screen pending/error vocabulary

| Condition | Display and allowed recovery |
|---|---|
| Catalog pending / rights unresolved | “Route details awaiting verification/publication approval”; approved example and preparation stay available. No unauthorized assets requested. |
| Loading | Named operation and busy state; navigation/cancel usable. Do not use plausible placeholder numbers. |
| Missing geometry / elevation / POIs | Separate availability messages; metadata and supported outline/list remain. No zero-filled gain, flat profile, invented stop or time. |
| Invalid/withdrawn link | Tombstone/explanation and explicit route choice; no silent substitute or autoplay. |
| Estimate invalid / recalculating | Inline cause or busy label; old values hidden or explicitly marked stale, not current. |
| Map denied / WebGL missing | “3D unavailable; route briefing and profile still available”; explicit retry only. |
| Storage denied / quota / deleted local ID | Memory-only option, pack/library status and delete/import recovery; no forced account. |
| Network / weather / partial batch failure | Feature-specific stale/unavailable status and retry; core selection remains usable. |

## Annotated low-fidelity journeys

These are interaction sketches, not new event facts. Bracketed route names represent cleared fixtures or the explicitly labeled example.

### Newcomer, no FTP, 320 px phone

```text
PLAN
[Plan] [Explore] [Prepare] [Ride week]
Event facts: verified / pending + source
[Day label] [Choose a variant]
[Example/route · revision · status]
Distance / gain / surface uncertainty
[Read briefing] [Use for this day]
                 |
EXPLORE          v
[Route briefing]  (no map required)
What changes along this route?
[Chapter 1] [Chapter 2] ...
[Profile + text equivalent]
Selected section: length / gain / next feature
[Previous] [Next] [Distance]
[Optional time example] [Optional 3D]
[Practise this section]
                 |
PREPARE          v
[Week 2] [Enjoy the ride] [Ride by feel]
One practice action
[Recovery / shorter option / missed week]
```

Annotations: no profile modal interrupts entry; an “I don’t know my FTP” action selects the labeled example, not a guessed rider profile. At 320 px buttons wrap, chapter detail is inline rather than a hovering popup, and list/numeric controls replace the need to aim at chart points. With map service denied there is no blocked step. Reduced motion keeps all selections instantaneous and playback paused. The rider can return to Plan, include the chosen variant, see a partial itinerary, then download only when rights/format are available.

Falsifiable end-to-end N: start with cleared storage, blocked map/weather and no rider inputs; identify route status, one sustained section and next verified feature (or its explicit absence), choose a practice ride and return to the same route/revision. Pass only if every step is reachable at 320 px by touch and keyboard, without account, FTP or 3D. Totals must not include unchosen days.

### Experienced rider, desktop or small phone

```text
PLAN: [Variant A] vs [Variant B]
[Distance + climbing delta] [Common-scale profiles]
[Choose B for this day] [View revisions]
                 |
EXPLORE: [Briefing] → [Time scenarios]
[Use example] or [Optional weight / FTP / units]
[Effort assumptions] [Plan A] [Plan B + stop]
Moving estimate | Elapsed incl. stops
[Sensitivity: baseline / weight / FTP / combined]
[Seek chapter] → [Optional 3D · paused]
[Camera] [Rate] [Fullscreen] [Return to rider]
                 |
RIDE WEEK: [Revision-pinned day card / downloads]
[Optional local FIT import] → [Recorded replay]
[Compare with exact planned revision + basis]
Recorded elapsed / telemetry | Model estimate
```

Annotations: a power-trained rider may still decline personalization and use example comparisons. On phones, comparisons stack with explicit matching axes; all camera functions are buttons in the deck/options, not shortcut-only. A stopped scenario stays at its stop position while modeled elapsed advances. Recorded replay is local and never turns the site into live navigation.

Falsifiable end-to-end E: use known valid fixture inputs, select a variant, compare two plans, seek a chapter, change animation rate and optionally camera, export a revision-pinned file and import a recorded fixture. Same-point model values agree across views; animation does not alter them; timestamps and telemetry remain recorded. Repeat without supplying inputs or opening 3D: route choice, briefing, example comparison and downloads still complete.

### Recovery variants for both personas

- **Invalid link:** open unknown route/revision. Read explanation, choose an available example/route explicitly, then continue N or E; no wrong route briefly flashes. For valid route/invalid chapter, briefing remains usable with warning.
- **Withdrawn deep link or saved itinerary:** see withdrawal and impacted day, compare any cleared replacement, explicitly accept new revision. Old/new download, geometry and POIs never mix. Offline old pack cannot claim current status; on reconnection withdrawal is surfaced.
- **No map / reduced motion:** profile/list supplies the same chapter/POI facts; no automatic camera launch or animated fly-to. Direct cinema link opens paused with a return-to-briefing control.
- **Small phone / storage denied:** at 320 px, 200% zoom and storage throwing errors, complete selection and practice in memory; clear/refill controls remain visible, no horizontal page scroll or trapped focus. Local-file missing-link recovery is import, not account signup.

## Current 2027 integration seams

| Local source inspected | Preserve/adapt; implementation owner |
|---|---|
| [`index.html`](../index.html), lines 65–96; [`explore.html`](../explore.html), lines 101–245 | Existing example identity, paused chapter links and ride-clock entry remain discoverable as examples. General shell `.7` wraps, does not relabel. |
| [`js/semonzo-profile.mjs`](../js/semonzo-profile.mjs), lines 1–58 | Four hard-coded chapters, single-track validation and bundled example loading are an adapter seam, not a full-route catalog. `.4/.6` generalize without applying these boundaries to D3L. |
| [`js/ascent-estimator.mjs`](../js/ascent-estimator.mjs), lines 1–114 | Pure bounded model with profile continuity validation, speed cap and coasting/work behavior. `.14` preserves its regression contract; no copied 2026 Newton solver or missing-elevation fabrication. |
| [`js/rider-scenario.mjs`](../js/rider-scenario.mjs), lines 1–35; [`js/rider-controls.mjs`](../js/rider-controls.mjs) | Original unit entry, example/partial/personal/invalid result and explicit 70/80 clock fractions. `.13/.15` reuse validation/state rather than clamp guessed defaults. |
| [`js/ride-clock.mjs`](../js/ride-clock.mjs), lines 1–62 | Separate moving/stopped intervals, stop on arrival at `half-step`, 0/5/15-minute options. `.14/.15` generalize explicit revision-bound stops; the current example café stop is not a verified event stop. |
| [`js/climb-sensitivity.mjs`](../js/climb-sensitivity.mjs), lines 36–126; [`js/climb-sensitivity-view.mjs`](../js/climb-sensitivity-view.mjs) | Fixed sustained-fraction semantics, bounded grid and four factor-isolating comparisons. `.15` retains numeric/heatmap alternatives and workload bounds. |
| [`assets/flyover.js`](../assets/flyover.js), lines 130–235; [`assets/terrain.js`](../assets/terrain.js) | Current seek pauses, hidden-tab pause, renderer availability/retry and legacy `#seek-N`. `.10/.12` split controller from renderer without restoring the removed relief renderer. A new linked 2D/profile view is not that old renderer. |
| [`tools/build-release.mjs`](../tools/build-release.mjs), lines 13–58; [`docs/release.md`](release.md) | Explicit dependency-first allowlist and fingerprinted artifact, not recursive source publication. `.20/.21` coordinate pack/version updates with entry freshness. This design document is not automatically a public build input. |

Relevant future regression seams are `tests/ascent-estimator.mjs`, `tests/ride-clock.mjs`, `tests/rider-controls.mjs`, `tests/climb-sensitivity.mjs`, `tests/climb-sensitivity-browser.mjs`, `tests/flyover.mjs`, `tests/live-ride.mjs`, `tests/sightline.mjs`, `tests/preload.mjs` and `tests/release.mjs`. No full browser suite is necessary to validate this documentation-only artifact; implementation must supply actual evidence rather than cite these filenames as passes.

## Ownership boundaries and prior-work reconciliation

The native bead records were read for `.1`–`.21` and all `kotr27-k9t` children, including closed history. This section maps product responsibility; it is not task tracking or a request to change any status.

| Owner | Contract responsibility |
|---|---|
| `kotr27-800.1` | This parity/journey specification; no implementation or publication approval |
| `kotr27-800.2` | Private route evidence, dates/day mapping, rights and publication disposition |
| `kotr27-800.3` | Static/online/offline boundary, access/storage policy, concrete budgets and separately gated server evaluation |
| `kotr27-800.4` | Stable IDs, revision bundle/schema, fact provenance and validators |
| `kotr27-800.5` | Approved deterministic import, sanitized exports and revision/change report |
| `kotr27-800.6` | Profiles/chapters/POIs, revision-bound occurrences and uncertainty |
| `kotr27-800.7` | Four-area shell, route/link/history/focus state and legacy entry adapters |
| `kotr27-800.8` | Itinerary, totals, approved formats and partial download outcomes |
| `kotr27-800.9` | Unified compare/skyline/radial with equivalent nonvisual/linear controls |
| `kotr27-800.10` | Deterministic position/playback state independent of model and renderer |
| `kotr27-800.11` | Briefing, linked profile/outline/chapter details and next-feature insight |
| `kotr27-800.12` | Optional controllable 3D, camera recovery/fullscreen/shortcuts and motion constraints |
| `kotr27-800.13` | Local-only rider/preferences validation, consent, deletion and storage fallback |
| `kotr27-800.14` | One full-route model and documented pace/time/work assumptions |
| `kotr27-800.15` | Connected pace/clock/sensitivity UI and consistent scenario outputs |
| `kotr27-800.16` | Local file validation, import/library and private-data isolation |
| `kotr27-800.17` | Recorded telemetry/time and explicit planned alignment/ambiguity |
| `kotr27-800.18` | Cleared event/fundraiser/briefing, practice guide, packing and print |
| `kotr27-800.19` | Optional source/freshness-labeled weather with provider failure handling |
| `kotr27-800.20` | Opt-in cleared offline packs, storage states and atomic revision updates |
| `kotr27-800.21` | Packaged parity/revision/privacy/accessibility/browser/performance evidence; release handoff only |

### `kotr27-k9t` reuse/supersession proposals

No old bead is closed, reopened, edited or assumed satisfied by this document. The original [field-guide PRD](prd/grappa-field-guide.md) was read as context only; its older tentative date window and preview-first layout are not current full-site event authority.

| Existing scope/history | Proposal for owner reconciliation |
|---|---|
| `kotr27-k9t` overall field guide; `.1` first page (closed) | Reuse mountain/example identity, no-map welcome and independent goal/cue principle in `.7/.18`; propose replacing preview-only hierarchy with the four areas, not resurrecting old event assumptions. |
| `kotr27-k9t.2` example ascent (open) | Reuse current attributed Semonzo source/profile and provenance tests under `.4/.6`; owner must compare old artifact requirements with current delivered shape before deciding supersession. Do not create a second “official” ascent. |
| `kotr27-k9t.3` training content (open) | `.18` should reuse/finish the four distinct weeks × two goals × two cue styles, including recovery/shorter/missed-week notes. Proposed scope consolidation, not automatic completion. |
| `kotr27-k9t.4` linked chapter explorer (open) | `.7/.10/.11` absorb shared selection, chapter links and no-map contracts; retain example labels. Review old deep-link acceptance against new revision-aware links. |
| `kotr27-k9t.5` weekly selector (open) | `.18` owns the 16 combinations and chapter→practice navigation; propose supersession only after equivalent acceptance evidence. |
| `kotr27-k9t.6` practice connection/release (open) | Split reusable practice navigation into `.18`, packaged-path/fallback/accessibility evidence into `.21`; no automatic push/Pages enablement. |
| `kotr27-k9t.7/.8` group guide/program/food rehearsal (closed), `.9` preview-only change (closed) | History includes deliberate removal of training/nutrition from the then-public preview. Full-site `.18` proposes reintroducing bounded preparation under Prepare, not restoring stale group rules, prescriptions or unconfirmed refill locations. Existing closure is not approval of old copy for new routes. |
| `kotr27-k9t.10` cache-consistent releases (closed) | Reuse allowlisted fingerprints and entry freshness; `.20/.21` must test compatibility with offline pack activation rather than install a conflicting cache policy. |
| `kotr27-k9t.11/.12` cinematic orbit/high-rate smoothing (closed) | Reuse `.10/.12` adapters and tests for paused orbit, no delayed-frame catch-up and speed-independent camera motion. Camera choices must not create another playback clock. |
| `kotr27-k9t.13/.14/.15` preload/visibility/relief removal (closed) | Preserve bounded preloads, sightline/rider visibility and removal of the legacy relief renderer in `.12/.21`. Generalize to validated routes with explicit no-map briefing; do not regress by reinstating relief as fallback. |

Existing unrelated browser issues remain separate unless bounded implementation demonstrates a direct blocker. These proposals create no new bead work and change no old ownership.

## Qualification and unresolved decisions

Product acceptance is **all P01–P22 journeys plus N/E and their recovery variants**, run against the actual allowlisted `/kotr27/` artifact by the responsible implementation/release owners. Source parity does not require copying old layout, private content, arbitrary scores, flawed alignment or duplicate physics. A retained job cannot pass on a screenshot alone: use deterministic fixture assertions for state/data and interaction evidence for phone/keyboard/Chrome/native Safari. Missing browser availability is recorded as unverified, not passed.

Cross-cutting fixtures must include: mixed variants/partial itinerary; add/rename/replace/withdraw revision; delayed response from an old route; out-and-back/repeated coordinate; missing elevation/POIs; unapproved assets; corrupt/stale storage; map/weather denial; interrupted offline update; GPX track versus timestamped FIT; gaps/pauses/ambiguous recorded matching. Verify links, downloads, print and packs all identify the same revision and no public output contains private source data.

Remaining gates are explicit: new-route redistribution and export destination; calendar/departure/logistics/fundraiser verification; exact Semonzo/D3L alignment if ever proposed; architecture’s concrete import/render/storage/network budgets and access design; provider terms/location verification; owner acceptance of diagnostic-capture removal and prior-backlog supersession. These block the affected implementation/publication claims, **not writing this specification**. No route export, backend provisioning, code change or deployment is authorized by this artifact.

## Pinned 2026 source references

All links below resolve to the same audited commit. Line ranges identify the code/markup supporting the matrix; they do not certify its runtime correctness.

[s-readme]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/README.md#L30-L47
[s-countdown]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/main.js#L249-L305
[s-live]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/main.js#L1112-L1290
[s-purpose]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/index.html#L300-L318
[s-selection]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/main.js#L1859-L1896
[s-totals]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/main.js#L1567-L1592
[s-download]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/main.js#L1933-L1982
[s-batch]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/main.js#L1724-L1789
[s-home-map]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/main.js#L1794-L1856
[s-compare-scrub]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/compare/index.html#L530-L568
[s-compare-select]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/compare/index.html#L613-L650
[s-home-compare]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/main.js#L1435-L1560
[s-skyline-controls]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/skyline/index.html#L89-L100
[s-skyline-render]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/skyline/index.html#L235-L315
[s-skyline-poi]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/skyline/index.html#L350-L407
[s-radial-data]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/radial/index.html#L211-L279
[s-radial-rotate]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/radial/index.html#L411-L480
[s-pace-controls]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/pace/index.html#L188-L212
[s-pace-solver]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/pace/index.html#L237-L290
[s-allday]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/power-calculator.js#L678-L764
[s-eta]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/flyover-engine.js#L7471-L7565
[s-effort]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/flyover-engine.js#L4484-L4546
[s-controls]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/flyover-engine.js#L4915-L5068
[s-play-seek]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/flyover-engine.js#L5702-L5793
[s-ui-pin]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/flyover-engine.js#L5605-L5684
[s-shortcuts]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/flyover.html#L1451-L1521
[s-keyboard]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/flyover-engine.js#L5070-L5177
[s-fullscreen]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/flyover-engine.js#L5687-L5697
[s-climbs]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/flyover-engine.js#L4548-L4640
[s-climb-popup]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/flyover-engine.js#L4749-L4818
[s-climb-heuristic]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/flyover-engine.js#L4660-L4672
[s-upload]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/main.js#L2322-L2345
[s-store]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/route-store.js#L11-L137
[s-user-load]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/flyover-engine.js#L3705-L3731
[s-fit-fields]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/fit-parser.js#L366-L432
[s-telemetry]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/flyover-engine.js#L7272-L7402
[s-ghost]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/flyover-engine.js#L4068-L4265
[s-recorded-time]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/flyover-engine.js#L4324-L4358
[s-compare-persist]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/flyover-engine.js#L4366-L4449
[s-profile]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/rider-profile.js#L9-L95
[s-route-preferences]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/main.js#L2062-L2088
[s-camera-preferences]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/flyover-engine.js#L215-L270
[s-training]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/main.js#L870-L1020
[s-training-personal]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/main.js#L1063-L1092
[s-briefing]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/index.html#L200-L286
[s-weather-request]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/weather-widget.js#L74-L107
[s-weather-fallback]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/weather-widget.js#L113-L181
[s-panic]: https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/js/flyover-engine.js#L1973-L2005

Design-only comparison: the [2026 elapsed-time PRD](https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/docs/prd/flyover-elapsed-time.md#L17-L49) calls the duration brackets sustainable; the implemented resolver above only demonstrates a heuristic. Its [missing-elevation and success criteria](https://github.com/ebowman/kotr26/blob/98cd86dc6443dcf713e125fa2ef53cee629c4339/docs/prd/flyover-elapsed-time.md#L77-L92) are not empirical accuracy evidence and are deliberately not adopted as such.
