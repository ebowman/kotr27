# Semonzo chapter contract · v1

`assets/semonzo-chapters.v1.json` is the private regression reference for the
estimator and graphic. The browser derives the consumed fields in memory using
`js/semonzo-profile.mjs`; the Pages build excludes the JSON and generator.
It describes one provisional approach, not the confirmed event course.
Regenerate with `python3 tools/build-semonzo.py`; check with
`python3 tests/semonzo_chapters.py`. Neither step needs the network or a map.

**Distance axis.** Walk `assets/semonzo.gpx` in track order. Sum horizontal
haversine distances on a sphere of radius 6,371,000 m (not 3-D road lengths).
Linearly interpolate elevation against this distance at 250 m boundaries
anchored at the start. Include both original endpoints; merge any final
partial window with the preceding full one so a short finish cannot create
a grade spike. Represent each window by the straight line between its ends.
Thus grades smooth over at least 250 m, not a fixed number of unevenly spaced
GPX points. There is no instantaneous maximum grade.

**Reading the JSON.** Require `schemaVersion: 1`. `chapters` and `segments`
are in riding order. Join `segment.chapterId` to the stable `chapter.id`,
not the display `name`. `notice` describes what to look for in the profile.
All `M` numbers are metres. Treat `[startM, endM)` as half-open except that
the final segment/chapter owns the finish. Adjacent segments share an
elevation sample, not an interval. For each segment:

- horizontal run = `endM - startM`
- signed rise = `endElevationM - startElevationM`
- window grade (%) = `100 × signed rise / horizontal run` (keep descents)

For either a chapter or the route, `netRiseM` is last minus first elevation;
`ascentM` sums only positive window rises. `rawAscentM` is route-wide ascent
before smoothing, summing positive rises between consecutive GPX points. It
includes small undulations that the window profile deliberately omits.
`distanceM` is the last segment's end. Grade across multiple windows is
100 × net rise / total run, **not** the arithmetic mean of their grades.

| Chapter | km from start | Why the break is here |
|---|---|---|
| Long lift | 0–9 | A sustained 8.6% average; this stretch alone gains 773 m. |
| Half step | 9–11 | The next two kilometres ease to 4.0%. |
| High step | 11–13.5 | Height gain accelerates to 10.9% across five half-kilometres. |
| Dip and return | 13.5–18.887 | Net loss over the next 500 m, then a return to sustained climbing. |

**Reconciliation.** The 1,034 points run from 212.25 to 1,746.00 m. Across
18,887.190 m the net rise is 1,533.75 m; raw accumulated ascent is 1,675.50 m,
versus 1,549.950 m over the 75 windows. The GPX header's 18,930 m and 1,563 m
filtered ascent are BRouter summaries, not calibration targets. The raw track
points, not those summaries, define this axis. Compute before rounding;
JSON distances/elevations/aggregates are rounded to 0.001 m. Allow 0.001 m
per reconstructed window rise (two rounded endpoints) plus 0.0005 m for a
rounded aggregate. This is a numerical tolerance, not surveyed accuracy.

**Provenance and rights.** The sole measurement input is the shipped GPX,
identified by `source.sha256`. Its creator is [BRouter](https://brouter.de/)
1.7.11-beta. Retain the site's attribution: © [OpenStreetMap
contributors](https://www.openstreetmap.org/copyright), ODbL, for underlying
road data. The GPX does not identify a separate elevation provider or grant
an elevation redistribution licence; do not infer one from OSM or from
the flyover's separate terrain imagery. Confirm any additional rights needed
before redistribution. Chapter names, breaks and notices were composed for this
trace.

Further reading: [Monte Grappa from Semonzo del Grappa
(Climbfinder)](https://climbfinder.com/en/climbs/monte-grappa-semonzo).
The public summary describes the same village-to-mountain approach, but
reports 19.1 km and a 1,726 m top, versus 18.89 km and a 1,746 m finish here.
This checks the approach and scale, not identical start/finish pins or an
elevation correction. No Climbfinder data enters the generator; the link is
not permission to redistribute its profiles, gradients, imagery or reviews.
