#!/usr/bin/env python3
"""Offline, closed-field GPX/FIT course importer. See docs/route-import.md."""
import argparse
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

PRODUCER = "route-import-v1"
RECIPE = "route-raw-profile-v1"
MAX_BYTES = 20 * 1024 * 1024
MAX_POINTS = 100000
RADIUS = 6371000
MAX_GAP_M = 500
WARN_GAP_M = 200
PARSER_SHA = "5199a673dbb19e4efae9208b1c8aaeee13dc53fdf3b8875caba426492dcfcd25"
TOOL_ROOT = Path(__file__).resolve().parent.parent


class Invalid(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise Invalid(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode()


def closed(value, keys, label):
    require(isinstance(value, dict) and set(value) == set(keys), f"{label}: unexpected/missing fields")


def number(value, low, high, label):
    require(type(value) in (float, int) and math.isfinite(value) and low <= value <= high,
            f"{label}: finite number in [{low}, {high}] required")
    return value


def safe_path(root, relative):
    """Reject symlinks in every existing component, including the supplied root."""
    root = Path(os.path.abspath(root))
    for part in [root, *root.parents]:
        require(not part.is_symlink(), "symlink root is not allowed")
    require(isinstance(relative, str) and re.fullmatch(r"[a-zA-Z0-9_./-]+", relative)
            and all(p not in ("", ".", "..") for p in relative.split("/"))
            and not relative.startswith("/"), "unsafe relative asset/input path")
    path = root
    for part in relative.split("/"):
        path /= part
        require(not path.is_symlink(), "symlink path is not allowed")
    return path


def read_bounded(root, relative, limit=MAX_BYTES):
    path = safe_path(root, relative)
    require(path.is_file() and stat.S_ISREG(path.stat().st_mode), "regular input file required")
    require(path.stat().st_size <= limit, "file exceeds byte limit")
    # O_NOFOLLOW protects the final component; parents are checked above.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, "rb") as stream:
        data = stream.read(limit + 1)
    require(len(data) <= limit, "file exceeds byte limit")
    return data


def read_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "duplicate JSON key")
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=pairs,
                      parse_constant=lambda _: (_ for _ in ()).throw(Invalid("non-finite JSON")))


def distance(a, b):
    lat1, lon1, lat2, lon2 = map(math.radians, (*a[:2], *b[:2]))
    h = math.sin((lat2-lat1)/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin((lon2-lon1)/2)**2
    return 2 * RADIUS * math.asin(math.sqrt(min(1, max(0, h))))


def check_times(times):
    require(all(t is None for t in times) or all(t is not None for t in times),
            "partial timestamps unsupported")
    if times and times[0] is not None:
        require(all(a < b for a, b in zip(times, times[1:])), "timestamps must strictly increase in file order")


def validate_points(points, times):
    require(2 <= len(points) <= MAX_POINTS, "expected 2..100000 geometry points")
    check_times(times)
    steps = []
    for i, point in enumerate(points):
        number(point[0], -90, 90, f"point {i} latitude")
        number(point[1], -180, 180, f"point {i} longitude")
        number(point[2], -500, 9000, f"point {i} elevation")
        if i:
            gap = distance(points[i-1], point)
            require(gap > 0, f"point {i}: duplicate consecutive position unsupported")
            require(gap <= MAX_GAP_M, f"point {i}: gap exceeds {MAX_GAP_M} m; split/repair at source, never bridge")
            steps.append(gap)
    return steps


def parse_gpx(data):
    # Decode first so UTF-16 cannot hide entity/DTD declarations from the gate.
    try:
        text = data.decode("utf-8-sig")
    except UnicodeError as error:
        raise Invalid("GPX must be UTF-8") from error
    require(not re.search(r"<!DOCTYPE|<!ENTITY", text, re.I), "GPX DTD/entities unsupported")
    root = ET.fromstring(text)
    ns = "{http://www.topografix.com/GPX/1/1}"
    require(root.tag == ns + "gpx" and root.get("version") == "1.1", "only GPX 1.1 supported")
    require(not any(node.tag.rsplit("}", 1)[-1] in ("rte", "rtept") for node in root.iter()),
            "GPX routepoints unsupported anywhere; supply one track")
    tracks = root.findall(ns + "trk")
    require(len(tracks) == 1 and len(list(root.iter(ns + "trk"))) == 1, "exactly one GPX track required")
    segments = tracks[0].findall(ns + "trkseg")
    require(len(segments) == 1 and len(list(root.iter(ns + "trkseg"))) == 1,
            "multiple/missing GPX segments unsupported; never join interrupted segments")
    nodes = segments[0].findall(ns + "trkpt")
    require(len(nodes) <= MAX_POINTS, "point count exceeds limit")
    require(len(root.findall(ns + "wpt")) <= 2000, "waypoint count exceeds limit")
    # Unknown extension geometry/segments cannot masquerade as an ordinary track.
    for node in root.iter():
        local = node.tag.rsplit("}", 1)[-1]
        if local in ("trk", "trkseg", "trkpt", "ele", "time", "rte", "rtept"):
            require(node.tag == ns + local, "foreign geometry/time namespace unsupported")
    require(len(list(root.iter(ns + "trkpt"))) == len(nodes), "nested/ambiguous GPX geometry")
    points, times = [], []

    def decimal(value):
        require(isinstance(value, str) and
                re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)", value.strip()),
                "GPX coordinate/elevation must be a decimal")
        return float(value)

    for node in nodes:
        elevations = node.findall(ns + "ele")
        require(len(elevations) == 1, "each point needs exactly one elevation; no flattening/DEM")
        points.append((decimal(node.attrib["lat"]), decimal(node.attrib["lon"]), decimal(elevations[0].text)))
        timestamps = node.findall(ns + "time")
        require(len(timestamps) <= 1, "duplicate timestamps")
        time = None
        if timestamps:
            raw = timestamps[0].text or ""
            require(re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)", raw),
                    "timestamp must be ISO8601 with timezone")
            time = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
        times.append(time)
    validate_points(points, times)
    return points, {"fitEncodedDistanceM": None, "sourceCueCount": len(root.findall(ns + "wpt"))}


def crc16(data):
    crc = 0
    for byte in data:
        crc ^= byte
        for _ in range(8):
            crc = (crc >> 1) ^ (0xA001 if crc & 1 else 0)
    return crc


def parse_fit(data):
    import fitparse
    require(fitparse.__version__ == "1.2.0", "requires pinned fitparse==1.2.0")
    require(sha(Path(fitparse.__file__).with_name("base.py").read_bytes()) == PARSER_SHA,
            "FIT parser differs from audited 1.2.0 source")
    require(len(data) >= 14 and data[8:12] == b".FIT" and data[0] in (12, 14), "invalid FIT header")
    header = data[0]
    require(header + struct.unpack_from("<I", data, 4)[0] + 2 == len(data), "FIT length/trailing bytes")
    if header == 14:
        header_crc = struct.unpack_from("<H", data, 12)[0]
        require(header_crc == 0 or crc16(data[:12]) == header_crc, "FIT header CRC mismatch")
    require(crc16(data) == 0, "FIT CRC mismatch")
    messages = []
    for message in fitparse.FitFile(data, check_crc=True).get_messages():
        require(len(messages) < 250000, "FIT message count exceeds limit")
        require(message.name in ("file_id", "course", "lap", "event", "course_point", "record"),
                "unsupported FIT message type (activity/ambiguous course)")
        messages.append(message)
    group = lambda name: [m for m in messages if m.name == name]
    require(len(group("file_id")) == len(group("course")) == len(group("lap")) == 1,
            "FIT requires one course/file/lap; multi-lap segmentation unsupported")
    require(group("file_id")[0].get_value("type") == "course", "FIT activity unsupported")
    events = group("event")
    require(len(events) == 2 and all(m.get_value("event") == "timer" for m in events)
            and events[0].get_value("event_type") == "start"
            and events[1].get_value("event_type") in ("stop", "stop_all", "stop_disable_all"),
            "FIT interrupted/ambiguous timer events unsupported")
    records = group("record")
    points, times, distances = [], [], []

    def position(m):
        lat, lon = m.get_value("position_lat"), m.get_value("position_long")
        require(lat is not None and lon is not None, "FIT record missing coordinate")
        return (number(lat * 180 / 2**31, -90, 90, "FIT latitude"),
                number(lon * 180 / 2**31, -180, 180, "FIT longitude"))

    for m in records:
        ele = m.get_value("altitude")
        enhanced = m.get_value("enhanced_altitude")
        require(enhanced is None or ele == enhanced, "conflicting FIT altitude sources")
        points.append((*position(m), number(ele, -500, 9000, "FIT elevation")))
        times.append(m.get_value("timestamp"))
        distances.append(number(m.get_value("distance"), 0, 10000000, "FIT distance"))
    validate_points(points, times)
    require(all(a <= b for a, b in zip(distances, distances[1:])), "FIT distance ordering")
    require(distances[0] == 0 and abs(group("lap")[0].get_value("total_distance") - distances[-1]) <= 1,
            "ambiguous FIT lap/record distance")
    require(all(m.get_value("timestamp") is not None for m in events), "FIT timer timestamps missing")
    timer_start, timer_stop = (m.get_value("timestamp") for m in events)
    require(timer_start < timer_stop, "FIT timer chronology: stop must follow start")
    if times[0] is not None:
        require(timer_start <= times[0] <= times[-1] <= timer_stop,
                "FIT records outside timer interval")
    cues = group("course_point")
    require(len(cues) <= 2000, "FIT cue count exceeds limit")
    previous_distance = 0
    for cue in cues:
        position(cue)
        d = number(cue.get_value("distance"), 0, distances[-1] + 1, "FIT cue distance")
        require(d >= previous_distance, "FIT cue distance ordering")
        previous_distance = d
    return points, {"fitEncodedDistanceM": distances[-1], "sourceCueCount": len(cues)}


def geometry(points):
    # Stable round-trip decimal normalization; no source names/text/timestamps.
    rows = ['<?xml version="1.0" encoding="UTF-8"?>',
            '<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="KOTR route-import-v1">',
            '<trk><trkseg>']
    for lat, lon, ele in points:
        rows.append(f'<trkpt lat="{lat:.8f}" lon="{lon:.8f}"><ele>{ele:.3f}</ele></trkpt>')
    return ("\n".join([*rows, "</trkseg></trk></gpx>", ""])).encode()


def profile(points, binding):
    steps = validate_points(points, [None] * len(points))
    cumulative = 0
    samples = [[0, points[0][2]]]
    for step, point in zip(steps, points[1:]):
        cumulative += step
        samples.append([round(cumulative, 6), point[2]])
    deltas = [b[2] - a[2] for a, b in zip(points, points[1:])]
    totals = {"horizontalDistanceM": round(cumulative, 6),
              "rawGainM": round(sum(max(0, d) for d in deltas), 3),
              "rawLossM": round(sum(max(0, -d) for d in deltas), 3)}
    return {"schemaVersion": 1, "recipe": RECIPE, **binding,
            "distanceSemantics": "horizontal-haversine-6371000m", "samples": samples,
            "totals": totals,
            "gaps": {"maxM": round(max(steps), 6), "over200m": sum(d > WARN_GAP_M for d in steps)}}


def validate_config(config):
    closed(config, ["schemaVersion", "observedOn", "approval", "routes"], "config")
    require(config["schemaVersion"] == 1, "unsupported config schema")
    require(dt.date.fromisoformat(config["observedOn"]).isoformat() == config["observedOn"], "invalid observedOn")
    require(isinstance(config["approval"], str) and config["approval"].strip(), "explicit approval required")
    require(isinstance(config["routes"], list) and len(config["routes"]) <= 100, "route count limit")
    seen = set()
    for route in config["routes"]:
        closed(route, ["id", "name", "day", "variant", "status", "publicApproved", "listed", "input"], "route")
        for key in ("id", "day", "variant"):
            require(isinstance(route[key], str) and re.fullmatch(r"[a-z][a-z0-9-]*", route[key]), "invalid stable ID")
        require(route["id"] not in seen, "duplicate stable route ID")
        seen.add(route["id"])
        require(route["publicApproved"] is True, f'{route["id"]}: public rights unresolved')
        require(route["status"] in ("provisional", "withdrawn"), "unsupported route status")
        closed(route["listed"], ["distanceM", "gainM"], "listed")
        number(route["listed"]["distanceM"], 0, 10000000, "source distance")
        number(route["listed"]["gainM"], 0, 100000, "source gain")
        source = route["input"]
        if source is not None:
            require(route["status"] != "withdrawn", "withdrawn route must remove input")
            closed(source, ["file", "format", "sha256", "origin", "observedOn"], "input")
            require(dt.date.fromisoformat(source["observedOn"]).isoformat() == source["observedOn"],
                    "invalid input observedOn")
            require(source["format"] in ("gpx", "fit"), "unsupported input format")
            require(source["origin"] in ("user-supplied-original", "replacement-export", "derived-rehearsal"),
                    "input origin must distinguish original, replacement export, derived rehearsal")
            require(re.fullmatch(r"[a-f0-9]{64}", source["sha256"]) is not None, "input checksum required")
            require(source["file"].lower().endswith("." + source["format"]), "extension/format mismatch")


def make_pack(config, input_root, previous=None, previous_hash=None):
    validate_config(config)
    rights = {"access": "public", "redistribution": "approved", "approval": config["approval"]}
    provenance = {"source": "Ride with GPS event 512634; user-supplied exports; provider revision unknown",
                  "observedOn": config["observedOn"]}

    def record(id_, name, status="provisional"):
        return {"id": id_, "name": name, "status": status, "provenance": provenance, "rights": rights}

    event_id = "kotr-2027"
    event = {**record(event_id, "KOTR Bassano del Grappa"), "kind": "organizer",
             "metadata": {key: {"value": value, "provenance": provenance, "rights": rights}
                          for key, value in (("startDate", "2027-05-20"), ("endDate", "2027-05-24"))}}
    catalog = {"schemaVersion": 1, "events": [event], "days": [], "variants": [], "routes": [], "annotations": []}
    files, summaries, days, variants = {}, [], set(), set()
    for row in sorted(config["routes"], key=lambda r: r["id"]):
        rid, source = row["id"], row["input"]
        day_id, variant_id = f'kotr-{row["day"]}', f'kotr-{row["day"]}-{row["variant"]}'
        if day_id not in days:
            catalog["days"].append({**record(day_id, row["day"].upper() + " (source label; calendar unverified)"), "eventId": event_id})
            days.add(day_id)
        if variant_id not in variants:
            catalog["variants"].append({**record(variant_id, row["variant"]), "dayId": day_id})
            variants.add(variant_id)
        route = {**record(rid, row["name"], row["status"]), "kind": "organizer", "eventId": event_id,
                 "variantId": variant_id, "currentRevisionId": None, "revisions": []}
        summary = {"routeId": rid, "revisionId": None, "listed": row["listed"], "source": None,
                   "computed": None, "pointCount": 0, "sourceCueCount": 0, "fitEncodedDistanceM": None,
                   "availability": {"geometry": "unavailable-original-not-supplied",
                                    "gpx": "unavailable-original-not-supplied",
                                    "fit": "unavailable-no-sanitized-fit-writer",
                                    "cues": "unavailable-not-reviewed",
                                    "climbs": "unavailable-analysis-not-produced"}}
        if row["status"] == "withdrawn":
            summary["availability"] = {key: "withdrawn" for key in summary["availability"]}
        if source:
            try:
                data = read_bounded(input_root, source["file"])
                require(sha(data) == source["sha256"], "input checksum mismatch; review replacement and update config")
                points, info = (parse_fit if source["format"] == "fit" else parse_gpx)(data)
                gpx = geometry(points)
                # All measurements use exactly the published normalized geometry.
                normalized, _ = parse_gpx(gpx)
                geometry_hash = sha(gpx)
                public_source = {key: source[key] for key in ("format", "sha256", "origin")}
                revision_provenance = {**provenance, "observedOn": source["observedOn"]}
                identity = {"producer": PRODUCER, "recipe": RECIPE, "routeId": rid,
                            "geometrySha256": geometry_hash, "source": public_source,
                            "provenance": revision_provenance, "rights": rights}
                revision_id = rid + "-v-" + sha(encoded(identity))
                binding = {"revisionId": revision_id, "geometrySha256": geometry_hash}
                raw_profile = profile(normalized, binding)
                profile_bytes = encoded(raw_profile)
                gpx_path = "assets/route-" + geometry_hash + ".gpx"
                profile_path = "assets/route-profile-" + sha(profile_bytes) + ".json"
                files[gpx_path], files[profile_path] = gpx, profile_bytes
                ref = lambda path, fmt: {**binding, "path": path, "format": fmt, "sha256": sha(files[path])}
                revision = {"id": revision_id, "status": "provisional", "provenance": revision_provenance,
                            "rights": rights, "geometrySha256": geometry_hash,
                            "geometry": ref(gpx_path, "gpx"), "profile": ref(profile_path, "json"),
                            "downloads": [ref(gpx_path, "gpx")],
                            "units": {"distance": "m", "elevation": "m", "grade": "percent"},
                            "distanceSemantics": "horizontal-haversine-6371000m"}
                route.update(currentRevisionId=revision_id, revisions=[revision])
                summary.update(revisionId=revision_id, source=public_source, computed=raw_profile["totals"],
                               pointCount=len(normalized), **info)
                summary["availability"].update(geometry="available", gpx="sanitized-derived-track-no-cues")
            except Exception as error:
                # No parser exception containing private paths, raw text or device data reaches logs.
                if isinstance(error, Invalid):
                    raise Invalid(f"{rid}: {error}") from None
                raise Invalid(f"{rid}: invalid {source['format']} input ({type(error).__name__}); no output written") from None
        catalog["routes"].append(route)
        summaries.append(summary)
    for key in ("days", "variants"):
        catalog[key].sort(key=lambda r: r["id"])
    old_catalog = previous["catalog"] if previous else None
    if previous:
        current = {r["id"]: r["currentRevisionId"] for r in catalog["routes"]}
        catalog["annotations"] = [a for a in old_catalog["annotations"]
                                  if current.get(a["routeId"]) == a["revisionId"]]
        if catalog == old_catalog and summaries == previous["routes"]:
            return previous, files
    old_routes = {r["id"]: r for r in old_catalog["routes"]} if previous else {}
    old_summaries = {r["routeId"]: r for r in previous["routes"]} if previous else {}
    new_routes = {r["id"]: r for r in catalog["routes"]}
    new_summaries = {r["routeId"]: r for r in summaries}
    changes = []
    for rid in sorted(old_routes.keys() | new_routes.keys()):
        before, after = old_routes.get(rid), new_routes.get(rid)
        old_revision = before["currentRevisionId"] if before else None
        new_revision = after["currentRevisionId"] if after else None
        old_summary, new_summary = old_summaries.get(rid), new_summaries.get(rid)
        kind = ("removed" if after is None else "added" if before is None else
                "withdrawn" if after["status"] == "withdrawn" and before != after else
                "revised" if old_revision != new_revision else
                "metadata" if before != after or old_summary != new_summary else "unchanged")
        old_geometry = before["revisions"][0]["geometrySha256"] if old_revision else None
        new_geometry = after["revisions"][0]["geometrySha256"] if new_revision else None
        invalidated = old_revision is not None and (new_revision != old_revision or after is None)
        changes.append({"routeId": rid, "kind": kind, "beforeRevisionId": old_revision,
                        "afterRevisionId": new_revision, "pathChanged": old_geometry != new_geometry,
                        "beforeTotals": old_summary["computed"] if old_summary else None,
                        "afterTotals": new_summary["computed"] if new_summary else None,
                        "annotationsNeedReview": invalidated,
                        "annotationIds": [a["id"] for a in old_catalog["annotations"] if a["routeId"] == rid] if invalidated else [],
                        "invalidated": ["saved-plans", "offline-packs", "profile", "climbs", "pois", "cues"] if invalidated else []})
    return {"schemaVersion": 1, "producer": PRODUCER, "catalog": catalog, "routes": summaries,
            "changeReport": {"previousManifestSha256": previous_hash, "changes": changes}}, files


def validate_pack(pack, files, previous):
    payload = {"pack": pack, "files": {p: b.decode("utf-8") for p, b in files.items()}, "previous": previous}
    result = subprocess.run(["node", str(TOOL_ROOT / "tools/route-pack.mjs")],
                            input=encoded(payload), capture_output=True)
    require(result.returncode == 0, "public pack/catalog validation failed: " + result.stderr.decode()[:1500])


def load_previous(output):
    pointer_path = safe_path(output, "assets/route-pack.json")
    if not pointer_path.exists():
        return None, None
    pointer = read_json(read_bounded(output, "assets/route-pack.json"))
    closed(pointer, ["schemaVersion", "path", "sha256"], "pointer")
    require(pointer["schemaVersion"] == 1 and
            re.fullmatch(r"assets/route-manifest-[a-f0-9]{64}\.json", pointer["path"])
            and pointer["path"] == "assets/route-manifest-" + pointer["sha256"] + ".json",
            "invalid previous pointer")
    data = read_bounded(output, pointer["path"])
    require(sha(data) == pointer["sha256"], "previous manifest checksum mismatch")
    pack = read_json(data)
    files = {}
    for route in pack["catalog"]["routes"]:
        for rev in route["revisions"]:
            for ref in [rev["geometry"], rev.get("profile"), rev.get("climbs"), rev.get("pois"), *rev.get("downloads", [])]:
                if ref and "path" in ref:
                    require(re.fullmatch(r"assets/route-(?:[a-f0-9]{64}\.gpx|profile-[a-f0-9]{64}\.json)",
                                         ref["path"]), "previous asset outside approved root/format")
                    files[ref["path"]] = read_bounded(output, ref["path"])
    validate_pack(pack, files, None)
    return pack, pointer["sha256"]


def publish(output, pack, files, expected_previous, fail_at=None):
    """Immutable assets first, atomic pointer last. Serial writer, rollback on failure."""
    output = Path(output)
    assets = safe_path(output, "assets")
    assets.mkdir(parents=True, exist_ok=True)
    lock = safe_path(output, "assets/.route-import-lock")
    try:
        lock.mkdir()
    except FileExistsError:
        raise Invalid("import lock exists; inspect interrupted/concurrent writer, no automatic repair") from None
    created, stage = [], None
    try:
        current, current_hash = load_previous(output)
        require(current_hash == expected_previous, "catalog changed during import; no overwrite")
        pack_bytes = encoded(pack)
        manifest_path = "assets/route-manifest-" + sha(pack_bytes) + ".json"
        all_files = {**files, manifest_path: pack_bytes}
        pointer = encoded({"schemaVersion": 1, "path": manifest_path, "sha256": sha(pack_bytes)})
        if current == pack:
            return sha(pack_bytes)
        stage = Path(tempfile.mkdtemp(prefix=".route-stage-", dir=assets))
        for i, (path, data) in enumerate(sorted(all_files.items())):
            target = safe_path(output, path)
            if target.exists():
                require(read_bounded(output, path) == data, "immutable asset collision")
                continue
            pending = stage / str(i)
            with pending.open("xb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
        if fail_at:
            fail_at("staged")
        for i, (path, data) in enumerate(sorted(all_files.items())):
            pending = stage / str(i)
            if pending.exists():
                target = safe_path(output, path)
                # Hard link is exclusive, same filesystem, and never overwrites an asset.
                os.link(pending, target)
                created.append(target)
        if fail_at:
            fail_at("before-pointer")
        pending = stage / "pointer"
        with pending.open("xb") as stream:
            stream.write(pointer)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(pending, safe_path(output, "assets/route-pack.json"))
        return sha(pack_bytes)
    except BaseException:
        for path in created:
            path.unlink()
        raise
    finally:
        if stage:
            shutil.rmtree(stage)
        lock.rmdir()


def run(config, input_root, output, check=False, fail_at=None):
    # Input evidence must never be an output/asset directory.
    inp, out = Path(input_root).resolve(), Path(output).resolve()
    require(inp != out and inp not in out.parents, "output cannot be inside private input root")
    asset_root = out / "assets"
    require(inp != asset_root and asset_root not in inp.parents,
            "private input root cannot be inside public assets")
    safe_path(input_root, "root-check")
    safe_path(output, "assets")
    previous, previous_hash = load_previous(output)
    pack, files = make_pack(config, input_root, previous, previous_hash)
    validate_pack(pack, files, previous)
    if not check:
        publish(output, pack, files, previous_hash, fail_at)
    return pack


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=TOOL_ROOT / "tools/route-import.json")
    parser.add_argument("--input-root", type=Path, default=TOOL_ROOT / ".private/route-intake")
    parser.add_argument("--output-root", type=Path, default=TOOL_ROOT)
    parser.add_argument("--check", action="store_true", help="validate and report without writes")
    args = parser.parse_args()
    try:
        config = read_json(read_bounded(args.config.parent, args.config.name))
        pack = run(config, args.input_root, args.output_root, args.check)
        print(json.dumps({"manifestSha256": sha(encoded(pack)), "checkOnly": args.check,
                          "routes": [{"id": r["routeId"], "points": r["pointCount"], "revision": r["revisionId"]}
                                     for r in pack["routes"]], "changeReport": pack["changeReport"]}, indent=2))
    except Exception as error:
        print("ERROR: " + (str(error) if isinstance(error, Invalid) else type(error).__name__) +
              "; previous public pointer preserved", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
