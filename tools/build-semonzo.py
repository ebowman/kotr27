"""Rebuild the provisional chapter contract from the shipped GPX (stdlib only)."""

import bisect
import hashlib
import json
import math
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "assets/semonzo.gpx"
OUTPUT = ROOT / "assets/semonzo-chapters.v1.json"
WINDOW = 250
CHAPTERS = [
    (0, "long-lift", "Long lift", "The first nine kilometres gain height almost without a break."),
    (9000, "half-step", "Half step", "The road still rises, but gains roughly half as much height per kilometre."),
    (11000, "high-step", "High step", "Over the next two and a half kilometres the average crosses ten percent."),
    (13500, "dip-and-return", "Dip and return", "The first half-kilometre loses height before the climb resumes toward the finish."),
]


def profile():
    data = (ROOT / SOURCE).read_bytes()
    track, = ET.fromstring(data).findall("{*}trk/{*}trkseg")
    distances, heights = [], []
    for point in track.findall("{*}trkpt"):
        lat, lon = (math.radians(float(point.attrib[k])) for k in ("lat", "lon"))
        z = float(point.findtext("{*}ele"))
        if not all(map(math.isfinite, (lat, lon, z))):
            raise ValueError("Missing or non-finite GPX sample")
        distance = 0
        if distances:
            a = (math.sin((lat - prev_lat) / 2) ** 2 + math.cos(prev_lat)
                 * math.cos(lat) * math.sin((lon - prev_lon) / 2) ** 2)
            distance = distances[-1] + 12742000 * math.asin(math.sqrt(a))
            if distance <= distances[-1]:
                raise ValueError("Expected distinct consecutive track positions")
        distances.append(distance)
        heights.append(z)
        prev_lat, prev_lon = lat, lon
    return distances, heights, hashlib.sha256(data).hexdigest()


def build():
    distances, heights, digest = profile()

    def height(x):
        i = bisect.bisect_left(distances, x)
        if x == distances[i]:
            return heights[i]
        fraction = (x - distances[i - 1]) / (distances[i] - distances[i - 1])
        return heights[i - 1] + fraction * (heights[i] - heights[i - 1])

    # Keep the finish; fold the short tail into the last complete window.
    end = distances[-1]
    bounds = [*range(0, int(end - WINDOW) + 1, WINDOW), end]
    segments, chapters = [], []
    for i, (start, key, name, notice) in enumerate(CHAPTERS):
        stop = CHAPTERS[i + 1][0] if i + 1 < len(CHAPTERS) else end
        lo, hi = bounds.index(start), bounds.index(stop)
        for x, y in zip(bounds[lo:hi], bounds[lo + 1:hi + 1]):
            segments.append(dict(chapterId=key, startM=round(x, 3), endM=round(y, 3),
                                 startElevationM=round(height(x), 3),
                                 endElevationM=round(height(y), 3)))
        chapters.append(dict(id=key, name=name, notice=notice, startM=start, endM=round(stop, 3),
                             netRiseM=round(height(stop) - height(start), 3),
                             ascentM=round(sum(max(0, height(y) - height(x)) for x, y
                                               in zip(bounds[lo:hi], bounds[lo + 1:hi + 1])), 3)))
    return dict(schemaVersion=1, source=dict(path=SOURCE, sha256=digest,
                attribution="BRouter using © OpenStreetMap contributors (ODbL)",
                attributionUrl="https://www.openstreetmap.org/copyright"),
                windowM=WINDOW, distanceM=round(end, 3), netRiseM=heights[-1] - heights[0],
                rawAscentM=sum(max(0, b - a) for a, b in zip(heights, heights[1:])),
                ascentM=round(sum(max(0, height(y) - height(x)) for x, y
                                  in zip(bounds, bounds[1:])), 3),
                chapters=chapters, segments=segments)


if __name__ == "__main__":
    OUTPUT.write_text(json.dumps(build(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
