"""Offline importer regression, real four-to-seven addition and GPX replacement."""
import copy
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("route_import", ROOT / "tools/import-routes.py")
imp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imp)


def track(points=None):
    return imp.geometry(points or [(45, 11, 100), (45.0001, 11.0001, 101), (45.0002, 11.0002, 100)])


def snapshot(root):
    return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*") if p.is_file()}


def untimed_fit_course(start, stop):
    """Test-only minimal course bytes; no record timestamp fields or FIT export API."""
    def definition(local, global_id, fields):
        return (bytes([0x40 | local, 0, 0]) + struct.pack("<H", global_id) +
                bytes([len(fields)]) + b"".join(bytes(field) for field in fields))

    payload = bytearray()
    payload += definition(0, 0, [(0, 1, 0x00)])  # file_id.type: enum course
    payload += bytes([0, 6])
    payload += definition(1, 31, [(5, 16, 0x07)])  # course.name: string
    payload += bytes([1]) + b"Synthetic".ljust(16, b"\0")
    payload += definition(2, 19, [(9, 4, 0x86)])  # lap.total_distance: uint32, /100 m
    payload += bytes([2]) + struct.pack("<I", 2000)
    payload += definition(3, 21, [(253, 4, 0x86), (0, 1, 0x00), (1, 1, 0x00)])
    payload += bytes([3]) + struct.pack("<IBB", start, 0, 0)  # timer/start
    payload += definition(4, 20, [(0, 4, 0x85), (1, 4, 0x85), (2, 2, 0x84), (5, 4, 0x86)])
    for i in range(3):
        lat, lon = (round(value * 2**31 / 180) for value in (45 + i * 0.0001, 11 + i * 0.0001))
        payload += bytes([4]) + struct.pack("<iiHI", lat, lon, 3000 + i, 1000 * i)
    payload += bytes([3]) + struct.pack("<IBB", stop, 0, 1)  # timer/stop
    header = struct.pack("<BBHI4s", 12, 0x10, 100, len(payload), b".FIT")
    data = header + payload
    return data + struct.pack("<H", imp.crc16(data))


class ImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="kotr-import-")
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name).resolve()
        self.inputs = self.base / "inputs"
        self.inputs.mkdir()
        self.out = self.base / "out"
        self.data = track()
        (self.inputs / "route.gpx").write_bytes(self.data)
        self.config = {
            "schemaVersion": 1, "observedOn": "2026-11-24", "approval": "Synthetic test approval",
            "routes": [{"id": "test-route", "name": "Synthetic test route", "day": "d1", "variant": "short",
                        "status": "provisional", "publicApproved": True,
                        "listed": {"distanceM": 100, "gainM": 1},
                        "input": {"file": "route.gpx", "format": "gpx", "origin": "derived-rehearsal",
                                  "observedOn": "2026-11-24", "sha256": imp.sha(self.data)}}]}

    def update(self, data):
        (self.inputs / "route.gpx").write_bytes(data)
        self.config["routes"][0]["input"]["sha256"] = imp.sha(data)

    def run_import(self, **kw):
        return imp.run(self.config, self.inputs, self.out, **kw)

    def test_determinism_noop_mtime_and_filename_rename(self):
        first = self.run_import()
        before = snapshot(self.out)
        os.utime(self.inputs / "route.gpx", (100, 100))
        self.assertEqual(self.run_import(), first)
        self.assertEqual(snapshot(self.out), before)
        shutil.copyfile(self.inputs / "route.gpx", self.inputs / "renamed.gpx")
        self.config["routes"][0]["input"]["file"] = "renamed.gpx"
        self.assertEqual(self.run_import(), first)
        other = self.base / "repeat"
        imp.run(self.config, self.inputs, other)
        self.assertEqual(snapshot(other), before)
        self.config["routes"][0]["name"] = "Renamed display only"
        renamed = self.run_import()
        self.assertEqual(first["catalog"]["routes"][0]["currentRevisionId"],
                         renamed["catalog"]["routes"][0]["currentRevisionId"])
        self.assertEqual(renamed["changeReport"]["changes"][0]["kind"], "metadata")

    def test_gpx_malformed_and_unsupported(self):
        data = self.data
        cases = [
            data[:-12],
            data.replace(b'<ele>101.000</ele>', b''),
            data.replace(b'101.000', b'nan'),
            data.replace(b'101.000', b'1_01.000'),
            data.replace(b'45.00010000', b'91.00010000'),
            data.replace(b'45.00010000', b'46.00010000'),
            data.replace(b'<trk><trkseg>', b'<trk><trkseg></trkseg><trkseg>'),
            data.replace(b'<trk><trkseg>', b'<trk><extensions><trkseg/></extensions><trkseg>'),
            data.replace(b'</gpx>', b'<trk><trkseg/></trk></gpx>'),
            data.replace(b'</gpx>', b'<rte/></gpx>'),
            data.replace(b'<trk>', b'<!DOCTYPE gpx [<!ENTITY x "x">]><trk>'),
            data.decode().encode("utf-16"),
            data.replace(b'<ele>101.000</ele>', b'<ele>101.000</ele><ele>101.000</ele>'),
            data.replace(b'<ele>101.000</ele>', b'<ele>101.000</ele><time>2026-01-01T10:00:00Z</time>'),
            data.replace(b'<ele>101.000</ele>', b'<ele>101.000</ele><time>nonsense</time>'),
            track([(45,11,100),(45,11,101)]),
        ]
        for data in cases:
            with self.subTest(case=cases.index(data)):
                self.update(data)
                with self.assertRaises(imp.Invalid):
                    self.run_import()
                self.assertFalse(self.out.exists(), "failed validation must not create output")

    def test_timestamp_order_and_gaps(self):
        text = self.data.decode()
        times = ["2026-01-01T10:00:00Z", "2026-01-01T10:01:00Z", "2026-01-01T10:02:00Z"]
        def dated(values):
            i = iter(values)
            return re.sub(
                "</trkpt>", lambda _: "<time>" + next(i) + "</time></trkpt>", text).encode()
        points, _ = imp.parse_gpx(dated(times))
        self.assertEqual(len(points), 3)
        for values in [times[::-1], [times[0]]*3]:
            with self.assertRaisesRegex(imp.Invalid, "strictly increase"):
                imp.parse_gpx(dated(values))
        points = [(45,11,100),(45.0028,11,101)]
        imp.validate_points(points,[None,None])  # ~311m is allowed, but visible as coarse sampling.
        prof = imp.profile(points, {"revisionId":"test", "geometrySha256":"a"*64})
        self.assertEqual(prof["gaps"]["over200m"], 1)

    def test_untimed_fit_timer_chronology_publication(self):
        from fitparse import FitFile
        valid = untimed_fit_course(100, 200)
        records = list(FitFile(valid, check_crc=True).get_messages("record"))
        self.assertEqual(len(records), 3)
        self.assertTrue(all(record.get_value("timestamp") is None for record in records))
        source = self.config["routes"][0]["input"]
        source.update(file="untimed.fit", format="fit", sha256=imp.sha(valid))
        path = self.inputs / source["file"]
        path.write_bytes(valid)
        accepted = self.run_import()
        self.assertEqual(accepted["routes"][0]["pointCount"], 3)
        before = snapshot(self.out)
        self.assertEqual(self.run_import(), accepted)
        for start, stop in [(200, 100), (100, 100)]:
            with self.subTest(start=start, stop=stop):
                bad = untimed_fit_course(start, stop)
                self.assertEqual(imp.crc16(bad), 0)
                # Both CRC validators/parser accept the fixture: chronology must reject it.
                self.assertEqual(len(list(FitFile(bad, check_crc=True).get_messages("record"))), 3)
                path.write_bytes(bad)
                source["sha256"] = imp.sha(bad)
                with self.assertRaisesRegex(imp.Invalid, "FIT timer chronology"):
                    self.run_import()
                self.assertEqual(snapshot(self.out), before, "invalid timer altered the existing public graph")
                fresh = self.base / f"rejected-fit-{start}-{stop}"
                with self.assertRaisesRegex(imp.Invalid, "FIT timer chronology"):
                    imp.run(self.config, self.inputs, fresh)
                self.assertFalse(fresh.exists(), "invalid timer created a valid-looking initial output")
                self.assertEqual(path.read_bytes(), bad, "importer modified the source fixture")
        path.write_bytes(valid)
        source["sha256"] = imp.sha(valid)
        self.assertEqual(self.run_import(), accepted, "valid untimed courses must remain supported")
        self.assertEqual(snapshot(self.out), before)

    def test_nested_gpx_route_geometry_publication(self):
        accepted = self.run_import()
        before = snapshot(self.out)
        point = b'<rtept lat="46" lon="12"><ele>100</ele></rtept>'
        cases = []
        for fragment in (point, b"<rte>" + point + b"</rte>", b"<rte/>"):
            cases.extend([
                self.data.replace(b"<trkseg>", b"<trkseg>" + fragment),
                self.data.replace(b"</gpx>", fragment + b"</gpx>"),
                self.data.replace(b"<trk>", b"<trk><extensions>" + fragment + b"</extensions>"),
                self.data.replace(b"</trkpt>", b"<extensions>" + fragment + b"</extensions></trkpt>", 1),
            ])
        cases.append(self.data.replace(b"<trkseg>",
            b'<trkseg><x:rtept xmlns:x="urn:fixture" lat="46" lon="12"><ele>100</ele></x:rtept>'))
        for i, data in enumerate(cases):
            with self.subTest(case=i):
                self.update(data)
                with self.assertRaisesRegex(imp.Invalid, "GPX routepoints unsupported"):
                    self.run_import()
                self.assertEqual(snapshot(self.out), before, "nested geometry altered the existing public graph")
                fresh = self.base / f"rejected-gpx-{i}"
                with self.assertRaisesRegex(imp.Invalid, "GPX routepoints unsupported"):
                    imp.run(self.config, self.inputs, fresh)
                self.assertFalse(fresh.exists(), "nested geometry created a valid-looking initial output")
                self.assertEqual((self.inputs / "route.gpx").read_bytes(), data)
        # Ordinary non-geometry extensions stay supported, but never leak into derivatives.
        extension = b'<extensions xmlns:x="urn:fixture"><x:note>EXTENSION-CANARY</x:note></extensions>'
        self.update(self.data.replace(b"</trkpt>", extension + b"</trkpt>", 1))
        with_extension = self.run_import()
        old_revision = accepted["catalog"]["routes"][0]["revisions"][0]
        new_revision = with_extension["catalog"]["routes"][0]["revisions"][0]
        self.assertEqual(with_extension["routes"][0]["pointCount"], 3)
        self.assertEqual(old_revision["geometrySha256"], new_revision["geometrySha256"])
        self.assertEqual(accepted["routes"][0]["computed"], with_extension["routes"][0]["computed"])
        self.assertNotIn(b"EXTENSION-CANARY", b"\n".join(snapshot(self.out).values()))

    def test_privacy_allowlist_not_marker_filter(self):
        secret = "PRIVATE-CANARY-name-device-token-participant"
        data = self.data.replace(b"<trk>", (
            '<metadata><name>'+secret+'</name><link href="https://invalid/?privacy_code=secret"/></metadata>'
            '<wpt lat="45" lon="11"><name>'+secret+'</name></wpt>'
            '<trk><name>'+secret+'</name><extensions><device>'+secret+'</device></extensions>').encode())
        self.update(data)
        pack = self.run_import()
        public = b"\n".join(snapshot(self.out).values())
        self.assertNotIn(secret.encode(), public)
        for forbidden in [b"privacy_code", b"device", b"participant", b"https://invalid", b"<time>", b"<wpt", b"<name"]:
            self.assertNotIn(forbidden, public)
        self.assertEqual(pack["routes"][0]["sourceCueCount"], 1)
        self.assertEqual(pack["routes"][0]["availability"]["gpx"], "sanitized-derived-track-no-cues")

    def test_rights_checksum_unknown_fields_and_limits_fail_closed(self):
        first = self.run_import()
        before = snapshot(self.out)
        for edit in [
            lambda c: c["routes"][0].update(publicApproved=False),
            lambda c: c["routes"][0]["input"].update(sha256="0"*64),
            lambda c: c["routes"][0].update(unreviewed="private"),
            lambda c: c.update(approval=""),
        ]:
            config = copy.deepcopy(self.config)
            edit(config)
            with self.assertRaises(imp.Invalid):
                imp.run(config, self.inputs, self.out)
            self.assertEqual(snapshot(self.out), before)
        with self.assertRaises(imp.Invalid):
            imp.validate_points([(45,11,100)]*(imp.MAX_POINTS+1), [])
        with self.assertRaises(imp.Invalid):
            imp.read_bounded(self.inputs, "route.gpx", limit=1)
        self.assertEqual(imp.load_previous(self.out)[0], first)

    def test_traversal_and_symlinks_no_writes(self):
        for name in ["../route.gpx", "/route.gpx", "sub/../route.gpx", "sub//route.gpx"]:
            self.config["routes"][0]["input"]["file"] = name
            with self.assertRaises(imp.Invalid):
                self.run_import()
        self.config["routes"][0]["input"]["file"] = "link.gpx"
        (self.inputs / "link.gpx").symlink_to(self.inputs / "route.gpx")
        with self.assertRaisesRegex(imp.Invalid, "symlink"):
            self.run_import()
        self.config["routes"][0]["input"]["file"] = "route.gpx"
        self.out.mkdir()
        (self.out / "assets").symlink_to(self.inputs, target_is_directory=True)
        with self.assertRaisesRegex(imp.Invalid, "symlink"):
            self.run_import()
        self.assertEqual((self.inputs / "route.gpx").read_bytes(), self.data)

    def test_atomic_failure_preserves_previous_and_no_orphan_public_assets(self):
        self.run_import()
        before = snapshot(self.out)
        self.update(track([(45,11,100),(45.00012,11.0001,101.5),(45.0002,11.0002,100)]))
        for seam in ["staged", "before-pointer"]:
            def failure(at):
                if at == seam:
                    raise OSError("injected bounded filesystem failure")
            with self.assertRaises(OSError):
                self.run_import(fail_at=failure)
            self.assertEqual(snapshot(self.out), before)
            self.assertFalse(any(p.name.startswith(".route-") for p in self.out.rglob("*")))
        # Refuse concurrent writer rather than retrying or repairing.
        (self.out / "assets/.route-import-lock").mkdir()
        with self.assertRaisesRegex(imp.Invalid, "lock exists"):
            self.run_import()
        self.assertEqual(snapshot(self.out), before)

    def test_add_remove_withdraw_and_no_current_fallback(self):
        first = self.run_import()
        self.config["routes"].append({**copy.deepcopy(self.config["routes"][0]), "id":"test-added"})
        added = self.run_import()
        self.assertEqual(len(added["catalog"]["routes"]), 2)
        # A later observation belongs to this input, not every unrelated route.
        self.config["routes"][0]["input"]["observedOn"] = "2026-11-25"
        dated = self.run_import()
        untouched = lambda pack: next(r for r in pack["catalog"]["routes"] if r["id"] == "test-added")
        self.assertEqual(untouched(dated), untouched(added))
        self.config["routes"][0].update(status="withdrawn", input=None)
        self.config["routes"].pop()
        changed = self.run_import()
        report = {r["routeId"]:r for r in changed["changeReport"]["changes"]}
        self.assertEqual(report["test-route"]["kind"], "withdrawn")
        self.assertEqual(report["test-added"]["kind"], "removed")
        self.assertTrue(report["test-route"]["annotationsNeedReview"])
        self.assertEqual(changed["catalog"]["routes"][0]["revisions"], [])
        self.assertIsNone(changed["catalog"]["routes"][0]["currentRevisionId"])
        self.assertIsNotNone(first["catalog"]["routes"][0]["currentRevisionId"])
        self.resolve_rejects(changed, "test-route", first["catalog"]["routes"][0]["currentRevisionId"])

    def resolve_rejects(self, pack, route_id, revision):
        script = """
          import {createCatalog} from './js/route-catalog.mjs';
          import assert from 'node:assert/strict';
          let s=''; for await (const chunk of process.stdin) s+=chunk;
          const [data,id,rev]=JSON.parse(s);
          assert.throws(()=>createCatalog(data).resolve(id,rev), /withdrawn|revision unavailable/);
        """
        result = subprocess.run(["node","--input-type=module","-e",script], cwd=ROOT,
                                input=json.dumps([pack["catalog"],route_id,revision]), text=True, capture_output=True)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_real_fit_intake_crc_and_replacement_rehearsal(self):
        """Mandatory local evidence: fail, not skip, if any approved original is absent."""
        self.config = json.loads((ROOT / "tools/route-import.json").read_text())
        inventory = json.loads((ROOT / ".private/route-intake/inventory.json").read_text())
        supplement = json.loads((ROOT / ".private/route-intake/short-handoff-2026-11-24.json").read_text())
        self.assertEqual(supplement["historicalInventorySHA256"],
                         imp.sha((ROOT / ".private/route-intake/inventory.json").read_bytes()))
        entries = {r["routeId"]:r for r in inventory["routes"]}
        entries.update({r["routeId"]:r for r in supplement["routes"]})
        additions = {"rwgps-"+r["routeId"] for r in supplement["routes"]}
        self.assertEqual(additions, {"rwgps-57873183", "rwgps-57873112", "rwgps-57874050"})
        original_hashes = {}
        for row in self.config["routes"]:
            if row["input"]:
                path = ROOT / ".private/route-intake" / row["input"]["file"]
                data = imp.read_bounded(path.parent,path.name)
                original_hashes[path] = imp.sha(data)
                entry = entries[row["id"].removeprefix("rwgps-")]
                self.assertEqual(imp.sha(data),entry["fit"]["sha256"])
                self.assertEqual(len(data),entry["fit"]["bytes"])
                shutil.copyfile(path,self.inputs / path.name)
        self.assertEqual(len(original_hashes),7)
        # Reproduce the actual earlier four-file catalog before adding new inputs.
        historical_config = copy.deepcopy(self.config)
        for row in historical_config["routes"]:
            if row["id"] in additions:
                row["input"] = None
        historical = imp.run(historical_config,self.inputs,self.out)
        historical_hash = "9fa47d767f0d1c6c925c135c69afcbe97697e62ef71683cd11f87b65f6af726d"
        self.assertEqual(imp.sha(imp.encoded(historical)),historical_hash)
        historical_bytes = snapshot(self.out)
        first = self.run_import()
        addition_report = {r["routeId"]:r for r in first["changeReport"]["changes"]}
        self.assertEqual(first["changeReport"]["previousManifestSha256"],historical_hash)
        for old,new in zip(historical["catalog"]["routes"],first["catalog"]["routes"]):
            change = addition_report[old["id"]]
            if old["id"] in additions:
                self.assertIsNone(change["beforeRevisionId"])
                self.assertEqual(change["afterRevisionId"],new["currentRevisionId"])
                self.assertIsNotNone(new["currentRevisionId"])
                self.assertTrue(change["pathChanged"])
                self.assertFalse(change["annotationsNeedReview"],"first geometry must not invent a stale prior geometry")
            else:
                self.assertEqual(new,old,"adding shorts changed an existing route")
                self.assertEqual(change["kind"],"unchanged")
        for name,data in historical_bytes.items():
            if name != "assets/route-pack.json":
                self.assertEqual((self.out/name).read_bytes(),data)
        # The shipped source pointer represents this exact real addition transition.
        self.assertEqual(imp.load_previous(ROOT)[0],first)
        summaries = {r["routeId"]:r for r in first["routes"]}
        self.assertEqual({k:v["pointCount"] for k,v in summaries.items() if v["pointCount"]},
                         {"rwgps-57874121":1205,"rwgps-57874024":8365,"rwgps-57873019":6738,"rwgps-57874076":8107,
                          "rwgps-57873183":5729,"rwgps-57873112":5016,"rwgps-57874050":3606})
        self.assertEqual(len(first["routes"]),7)
        before = snapshot(self.out)
        public = b"\n".join(before.values())
        for entry in entries.values():
            for key in ("sourcePath","recordUUID"):
                self.assertNotIn(entry["fit"]["provenance"][key].encode(),public)
        for path in self.inputs.glob("*.fit"):
            os.utime(path, (123456,123456))
        self.assertEqual(self.run_import(),first)
        self.assertEqual(snapshot(self.out),before)
        # Replaying the same prior state + addition is byte-identical despite mtime changes.
        repeat = self.base / "real-repeat"
        imp.run(historical_config,self.inputs,repeat)
        imp.run(self.config,self.inputs,repeat)
        self.assertEqual(snapshot(repeat),before)
        # Initial seven-route imports are independently deterministic too.
        fresh_a, fresh_b = self.base / "fresh-seven-a", self.base / "fresh-seven-b"
        imp.run(self.config,self.inputs,fresh_a)
        imp.run(self.config,self.inputs,fresh_b)
        self.assertEqual(snapshot(fresh_a),snapshot(fresh_b))
        fit = (self.inputs / "57874121.fit").read_bytes()
        for bad in [fit[:-1],fit+b"extra",fit[:-1]+bytes([fit[-1]^1])]:
            with self.assertRaises(imp.Invalid):
                imp.parse_fit(bad)
        route = next(r for r in first["catalog"]["routes"] if r["id"] == "rwgps-57874121")
        revision = route["revisions"][0]
        original = (self.out / revision["geometry"]["path"]).read_bytes()
        points, _ = imp.parse_gpx(original)
        lat,lon,ele = points[600]
        points[600] = (lat+0.00002,lon,ele+0.25)
        changed_gpx = imp.geometry(points)
        (self.inputs / "changed-derived.gpx").write_bytes(changed_gpx)
        row = next(r for r in self.config["routes"] if r["id"] == route["id"])
        row["input"] = {"file":"changed-derived.gpx","format":"gpx","origin":"derived-rehearsal",
                        "observedOn":"2026-11-24","sha256":imp.sha(changed_gpx)}
        row["name"] = "D1_Warm-up replacement rehearsal only"
        changed = self.run_import()
        self.assertEqual(len([s for s in changed["routes"] if s["pointCount"]]),7)
        report = {r["routeId"]:r for r in changed["changeReport"]["changes"]}
        change = report[route["id"]]
        self.assertEqual(change["kind"],"revised")
        self.assertTrue(change["pathChanged"])
        self.assertTrue(change["annotationsNeedReview"])
        self.assertNotEqual(change["beforeTotals"],change["afterTotals"])
        self.assertIn("saved-plans",change["invalidated"])
        self.assertIn("climbs",change["invalidated"])
        old_revision = revision["id"]
        self.assertNotEqual(change["afterRevisionId"],old_revision)
        self.resolve_rejects(changed,route["id"],old_revision)
        for old,new in zip(first["catalog"]["routes"],changed["catalog"]["routes"]):
            if old["id"] != route["id"]:
                self.assertEqual(new,old)
                self.assertEqual(report[old["id"]]["kind"],"unchanged")
        for name,data in before.items():
            if name != "assets/route-pack.json":
                self.assertEqual((self.out/name).read_bytes(),data)
        # Rehearsal itself is repeatable and cannot degenerate into initial-only import.
        updated_bytes = snapshot(self.out)
        self.assertEqual(self.run_import(),changed)
        self.assertEqual(snapshot(self.out),updated_bytes)
        # A previous annotation is explicitly invalidated, never silently rebound.
        annotated = copy.deepcopy(first)
        annotated["catalog"]["annotations"].append({
            **{k:route[k] for k in ("name","status","provenance","rights")},
            "id":"test-annotation","routeId":route["id"],"revisionId":old_revision,"text":"Synthetic annotation"})
        with_annotation,files = imp.make_pack(self.config,self.inputs,annotated,imp.sha(imp.encoded(annotated)))
        imp.validate_pack(with_annotation,files,annotated)
        self.assertEqual(with_annotation["catalog"]["annotations"],[])
        annotation_change = next(c for c in with_annotation["changeReport"]["changes"] if c["routeId"] == route["id"])
        self.assertEqual(annotation_change["annotationIds"],["test-annotation"])
        for path,digest in original_hashes.items():
            self.assertEqual(imp.sha(path.read_bytes()),digest,"private original changed")
        print("Real addition PASS: four -> seven; prior four bundles byte-identical.")
        print("Real replacement rehearsal PASS: seven routes, only D1 revised; " +
              old_revision.rsplit("-v-",1)[1][:12] + " -> " + change["afterRevisionId"].rsplit("-v-",1)[1][:12])


if __name__ == "__main__":
    unittest.main()
