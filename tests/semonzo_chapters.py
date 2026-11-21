"""Offline contract and independent GPX reconciliation checks."""

import hashlib
import json
import math
from pathlib import Path
import runpy
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "assets/semonzo-chapters.v1.json").read_text())
SEGMENTS = DATA["segments"]


class Semonzo(unittest.TestCase):
    def test_reproducible(self):
        self.assertEqual(runpy.run_path(str(ROOT / "tools/build-semonzo.py"))["build"](), DATA)
        self.assertEqual(DATA["schemaVersion"], 1)
        self.assertEqual(DATA["source"]["path"], "assets/semonzo.gpx")
        self.assertEqual(hashlib.sha256((ROOT / DATA["source"]["path"]).read_bytes()).hexdigest(),
                         DATA["source"]["sha256"])

    def test_windows_against_gpx(self):
        # Independent axis: central angle from chord between unit-sphere vectors.
        xyz, distances, elevations = [], [0], []
        for p in ET.parse(ROOT / "assets/semonzo.gpx").iterfind(".//{*}trkpt"):
            lat, lon = (math.radians(float(p.get(k))) for k in ("lat", "lon"))
            pos = math.cos(lat)*math.cos(lon), math.cos(lat)*math.sin(lon), math.sin(lat)
            if xyz:
                distances.append(distances[-1] + 12742000 * math.asin(math.dist(xyz[-1], pos)/2))
            xyz.append(pos)
            elevations.append(float(p.findtext("{*}ele")))
        window = DATA["windowM"]
        self.assertEqual(window, 250)
        self.assertAlmostEqual(DATA["distanceM"], distances[-1], delta=.0005)
        self.assertEqual(SEGMENTS[0]["startElevationM"], elevations[0])
        self.assertEqual(SEGMENTS[-1]["endElevationM"], elevations[-1])
        self.assertEqual(DATA["netRiseM"], elevations[-1] - elevations[0])
        self.assertEqual(DATA["rawAscentM"], sum(max(0, b-a) for a, b in zip(elevations, elevations[1:])))
        j = 0
        for i, s in enumerate(SEGMENTS):
            self.assertEqual(s["startM"], i * window)
            if i < len(SEGMENTS)-1:
                self.assertEqual(s["endM"], (i+1)*window)
                self.assertEqual(s["endElevationM"], SEGMENTS[i+1]["startElevationM"])
            else:
                self.assertEqual(s["endM"], DATA["distanceM"])
                self.assertTrue(window <= s["endM"] - s["startM"] < 2*window)
            while distances[j+1] < s["startM"]:
                j += 1
            t = (s["startM"] - distances[j]) / (distances[j+1] - distances[j])
            z = (1-t)*elevations[j] + t*elevations[j+1]
            self.assertAlmostEqual(s["startElevationM"], z, delta=.0005)

    def test_chapter_partition_and_metrics(self):
        chapters = DATA["chapters"]
        self.assertEqual([c["id"] for c in chapters],
                         ["long-lift", "half-step", "high-step", "dip-and-return"])
        consumed = []
        for c in chapters:
            self.assertTrue(c["name"].strip() and c["notice"].strip())
            parts = [s for s in SEGMENTS if s["chapterId"] == c["id"]]
            consumed.extend(parts)
            self.assertEqual((c["startM"], c["endM"]), (parts[0]["startM"], parts[-1]["endM"]))
            dz = [s["endElevationM"] - s["startElevationM"] for s in parts]
            self.assertAlmostEqual(c["netRiseM"], sum(dz), delta=.0015)
            self.assertAlmostEqual(c["ascentM"], sum(max(0, z) for z in dz),
                                   delta=.001*len(parts) + .0005)
        self.assertEqual(consumed, SEGMENTS)
        for field in ("ascentM", "netRiseM"):
            self.assertAlmostEqual(DATA[field], sum(c[field] for c in chapters),
                                   delta=.0005*(len(chapters)+1))
        self.assertGreater(DATA["rawAscentM"], DATA["ascentM"])
        self.assertGreater(DATA["ascentM"], DATA["netRiseM"])


if __name__ == "__main__":
    unittest.main()
