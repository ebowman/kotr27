# Route intake · kotr27-800.2

Observed **2026-11-24**. Intake evidence only: no new public geometry,
downloads, route catalog entries, or ingestion pipeline are shipped here.

## Source and publication decision

The native parent inspected Ride with GPS event **512634**, “KOTR Bassano
del Grappa”, organizer **Eat Sleep Cycle**. Its displayed dates are
**20–24 May 2027**. The parent’s observations and explicit user disposition
are recorded in the bead. This intake did not access the browser.

On **2026-11-24 the user explicitly approved publication of route names,
geometry, and GPX/FIT downloads**, excluding access codes and participant
information, and approved Git-ignored private local originals. This supersedes
older “permission not given” notes. It is the user's publication disposition,
not a provider license statement or verified organizer schedule. Access alone
would not have established permission. No deployment is authorized here.

Four FIT files were separately supplied by the user through their document
manager. Only the four exact handed-off files were read; their database and
originals were not modified. This is independent of the still-blocked browser
connector export write, not a workaround for it.

## Inventory

Names and listed statistics below are the parent-observed event values, not
recomputed or final organizer-approved figures. Preserve **Brentha**.

| Stable RWGPS ID | Source name | Listed km / gain m | Private original |
|---|---|---:|---|
| 57874121 | D1_Warm-up | 19.7 / 100 | FIT validated |
| 57873183 | D2S_Vicentine Hills | 67 / 1089 | Unavailable |
| 57874024 | D2L_Vicentine Hills | 86.7 / 1929 | FIT validated |
| 57873112 | D3S_Asolo | 57.6 / 837 | Unavailable |
| 57873019 | D3L_Monte_Grappa | 63.2 / 1835 | FIT validated |
| 57874050 | D4S_Brentha_Valley | 53.5 / 666 | Unavailable |
| 57874076 | D4L_Brentha_Valley | 85.3 / 1753 | FIT validated |

The parent's targeted searches found no supplied short-variant files. None
was substituted or reconstructed. **No GPX original is locally available.**
The prior D1 browser-only GPX observation is not a saved or locally validated
file, nor proof that it is the same revision as this FIT.

Private evidence resides in `.private/route-intake/`: four `<routeId>.fit`
originals, `inventory.json`, and the bounded `validate_intake.py` evidence
operation. The inventory retains full SHA-256 hashes, exact byte sizes,
source attribution, source-record provenance, validation results, and
uncertainties. Source paths and record identifiers remain private.

The parent explicitly associated filenames with stable RWGPS IDs. The FIT
files do **not** embed those IDs. D1's embedded course name matches; D3L and
D4L contain 15-character name prefixes. D2L contains `D2L_Vicentine-H`,
which differs in separator and is truncated. These are visible naming
ambiguities, not independent identity/revision proof. Supplied filenames
use underscores where the UI sometimes uses spaces.

## File validation

Used the already-installed **fitparse 1.2.0**, with CRC checking enabled and
complete message iteration. Header/CRC/message handling was inspected.
The existing 2026 JavaScript reader was inspected but not used because it
skips CRC validation; no parser code was copied or dependency installed.
The private evidence operation also independently computes FIT CRC-16,
checks the exact declared payload length, and verifies that the reader
rejects truncated files and corrupted CRCs.

All four were regular, non-symlink files of the expected sizes, with `.FIT`
signatures, valid file CRCs, no trailing bytes, and successful complete parses.
Their optional header CRCs are omitted (zero), not independently supplied
header checksums. Copies are byte-identical to their sources. Each is a
**course**, not an activity, with one course message, one lap, and two event
messages.

| ID | Bytes | Records / valid positions / elevations | Course points | Haversine km | FIT encoded km | Raw gain m |
|---|---:|---:|---:|---:|---:|---:|
| 57874121 | 29,501 | 1,205 / 1,205 / 1,205 | 43 | 19.679235 | 19.70109 | 147.4 |
| 57874024 | 196,341 | 8,365 / 8,365 / 8,365 | 103 | 86.647535 | 86.74400 | 2,731.4 |
| 57873019 | 156,940 | 6,738 / 6,738 / 6,738 | 48 | 63.157884 | 63.22820 | 2,766.2 |
| 57874076 | 189,471 | 8,107 / 8,107 / 8,107 | 77 | 85.221485 | 85.31640 | 3,613.2 |

Haversine distances sum adjacent decoded record positions with Earth radius
6,371,008.8 m. FIT encoded distances are source values (last record and lap
agree), not independent measurements. Raw gain sums positive successive
altitude deltas **without smoothing**. It differs materially from displayed
gain, especially D4L; the cause/provider elevation algorithm is unresolved.
Do not silently replace the source gain, claim agreement, or use these raw
gains as verified rider-facing totals.

All record coordinates/elevations are finite and in valid geographic/plausible
elevation ranges; all record distances are nonnegative and monotonic.
Maximum consecutive point gaps are respectively 211.450, 311.258, 211.450,
and 207.367 m. There are no consecutive duplicate positions. These checks
do not establish road connectivity, surface safety, or navigation accuracy.
One FIT lap is not a GPX track-segment validation.

The supplied FITs contain **navigation cues**, unlike the earlier start/end-only
UI observations: respectively 41, 101, 46, and 75 directional course points,
plus two generic points labeled start/end in each file. All course-point
coordinates and distances validate, with monotonic in-range distances.
Cue completeness and correctness are not field-verified. No water, food,
safety or other facility POIs were established; invent none.

## Privacy boundary

Decoded fields and raw bytes were screened for URL, email, access-code,
token, password, cookie and session-ID markers: none matched. No unexpected
message types or participant identity/activity messages were observed.
Heart-rate, cadence and power fields exist but contain **no populated values**;
serial numbers are zero. Timestamp and file/device metadata are present:
do not treat them as participant telemetry, a source revision, event schedule
or reliable effort estimate.

Marker screening cannot prove that arbitrary free text contains no secret.
**Original files remain private, not automatically approved as-is for release.**
Future public derivatives/downloads must allowlist intended route fields,
review cue text, and omit timestamps, elapsed times, file/device identifiers,
telemetry and any access/participant information. No raw fields or geometry
were added to versioned/public artifacts by this intake.

The scoped `/.private/route-intake/` ignore rule covers originals and evidence.
The public builder retains its explicit, non-recursive allowlist; neither
private intake nor these four FITs were added. Never publish the checkout
or serve it as a public artifact.

## Still unresolved / downstream contract

- D1–D4 and S/L are source naming conventions. Actual day/calendar mapping,
  departure times and short/long geometry relationships are unverified.
- Provider revision/last-edit dates and export options are unknown. Hashes
  identify exact supplied bytes, not a provider revision date. Document-manager
  creation on the observation date is not a route revision.
- D1 detail says 98% paved / 2% unpaved despite its Paved card. D2L's card
  says Unknown; other surface details remain unverified.
- Provider estimated time is account-dependent, not a general rider estimate.
  FIT course timing is not a verified activity or forecast.
- D3L's Semonzo labels do not prove equivalence with the existing cleared
  example route.
- Tasks **kotr27-800.5 / kotr27-800.21 cannot claim all seven geometries
  verified**: the three short originals and all GPX originals remain unavailable.
  Preserve unavailable states explicitly.
- Future changed-GPX intake/replacement must still support stable route IDs,
  hash-bound revisions, provenance, coordinated geometry/profile/cue/download
  replacement and stale-data rejection. Current FIT evidence does not remove
  that requirement. No such pipeline is implemented in this bead.

## Focused checks

- `python3 .private/route-intake/validate_intake.py`: four originals pass;
  seven inventory entries; CRC/truncation negatives pass; source-copy equality.
- `node --test --test-name-pattern='release rejects restricted catalogs' tests/release.mjs`:
  one test passed; no browser suite invoked.
- All six private evidence files pass Git exclusion; none is tracked. The
  private validator passes Python syntax parsing and the inventory passes JSON
  parsing with seven entries / four originals. Source paths and record UUIDs
  are absent from this document.
- A fresh **24-file** release built successfully in a temporary directory.
  Inspection found no private intake paths, source-record identifiers, new
  route IDs, FITs or JSON; its sole GPX remains the existing Semonzo example.
  Temporary build output was removed. The builder is unchanged.
- `git diff --check` passes. No browser, full regression suite, staging,
  commit, deployment, Beads mutation or source-database write was performed.

## Availability supplement · 2026-11-24, after the earlier intake

The report above remains the historical `.2` four-file evidence. During `.5`,
before its first independent review, the user supplied the three standard/short
FITs through the same private handoff. The exact files were read-only validated
and copied unchanged into the already ignored intake directory. No source
database, earlier original or `inventory.json` was modified.

| Stable RWGPS ID | Source name | Bytes | Records / finite positions / elevations | Cues | Haversine km | Raw gain m |
|---|---|---:|---:|---:|---:|---:|
| 57873183 | D2S_Vicentine Hills | 134,561 | 5,729 / 5,729 / 5,729 | 71 | 66.899994 | 1,618.0 |
| 57873112 | D3S_Asolo | 119,098 | 5,016 / 5,016 / 5,016 | 97 | 57.495637 | 1,165.2 |
| 57874050 | D4S_Brentha_Valley | 86,416 | 3,606 / 3,606 / 3,606 | 90 | 53.419859 | 1,261.6 |

These are supplemental intake calculations using the earlier 6,371,008.8 m
radius, not silently substituted source-listed statistics. Maximum adjacent
gaps are respectively 311.258, 223.226 and 207.367 m. File/header checks,
independent CRC and complete fitparse iteration pass; corruption/truncation
negatives pass. Coordinates/elevations, monotonic encoded distances and cue
positions/distances pass. The production importer also accepts all three under
its existing bounds, timer/order/segment and gap policy without modification.
No privacy markers or populated participant telemetry were detected; arbitrary
text is still not presumed safe. Raw files/timing/device metadata remain private.

Private `short-handoff-2026-11-24.json` supplements (does not rewrite) the
original inventory, retaining source checksums, attribution and private source
record provenance. Its bounded `validate_short_handoff.py` operation verifies
exact source/copy equality and all four earlier original checksums. Handoff
creation around 18:11 is not a provider revision date.

**Current availability is now seven validated FIT originals. All GPX originals
remain unavailable.** The [current import report](route-import.md) documents
the actual four-to-seven addition through the production pipeline, unchanged
earlier bundles, seven sanitized derived GPX tracks, continued FIT-download/cue
limitations and unchanged calendar/surface/raw-gain uncertainties.
