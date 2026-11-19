HARNESS = "copilot"
"""Bounded filesystem-only model-pair editor. Native consent is external."""
import ast
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import stat
import subprocess
import sys
import tempfile
import unicodedata

LIMIT = 1048576
MARKER = "# domestique-model-setup:"
ROLES = ("implementer", "reviewer")
DIRECTORY = {"claude": ".claude", "codex": ".codex", "copilot": ".github"}[HARNESS]


def need(value, message):
    if not value:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def unique(pairs):
    result = {}
    for key, value in pairs:
        need(key not in result, "duplicate JSON key")
        result[key] = value
    return result


def load(data):
    return json.loads(data, object_pairs_hook=unique)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def selection(value):
    need(value is None or (type(value) is str and 0 < len(value) <= 512
         and value == value.strip() and all(unicodedata.category(c)[0] != "C" and c not in "\u2028\u2029"
                                          for c in value)), "invalid selection")
    return value


def choices(value):
    need(type(value) is dict and set(value) == set(ROLES), "both role choices required")
    for role in ROLES:
        need(type(value[role]) is dict and set(value[role]) == {"model", "effort"},
             "explicit model and effort (null = inheritance) required")
        for item in value[role].values():
            selection(item)
        if HARNESS == "copilot":
            need(value[role]["effort"] is None, "Copilot effort unsupported")
        elif HARNESS == "codex":
            need(value[role]["model"] != "inherit", "Codex inheritance requires null")
    return value


def installer_defaults():
    """Normalized model/effort defaults shared by selection and publication."""
    return dict(zip(ROLES, (
        {"claude": (("sonnet", None), ("opus", None)),
         "codex": (("gpt-5.6-sol", "medium"), ("gpt-5.6-terra", "high")),
         "copilot": ((None, None), (None, None))}[HARNESS])))


def installer_request(platform, assignments):
    """Read-only CLI boundary. Missing role = default/preserve; null = explicit inherit.

    The installer passes request["overrides"][harness] to InstallerPair.prepare(), after
    preflighting its whole lifecycle. This request is NOT publication authority.
    """
    platforms = {"claude": ["claude"], "codex": ["codex"],
                 "both": ["claude", "codex"], "copilot": ["copilot"],
                 "all": ["claude", "codex", "copilot"]}
    need(platform in platforms, "invalid model platform selection")
    overrides = {h: {} for h in platforms[platform]}
    for assignment in assignments:
        scope, equals, value = assignment.partition("=")
        harness, colon, role = scope.partition(":")
        need(equals and colon and harness in platforms["all"] and role in ROLES,
             "--model requires harness:role=id-or-inherit "
             "(claude/codex/copilot; implementer/reviewer)")
        need(harness in overrides, "--model names an unselected harness")
        selection(value)
        value = None if value == "inherit" else value
        need(role not in overrides[harness] or overrides[harness][role] == value,
             "conflicting duplicate --model")
        overrides[harness][role] = value
    return {"v": 1, "purpose": "installer-model-request",
            "selected": platforms[platform], "overrides": overrides}


def installer_model_plan(overrides, current=None):
    """Selection-only plan; no eligibility, merge, confirmation or native claims.

    current is parsed owned metadata, or None for a genuinely absent pair.
    Native representations match patch(): Claude inherit is a string; elsewhere
    null means omission. Existing model-only changes never alter effort.
    """
    need(type(overrides) is dict and set(overrides) <= set(ROLES),
         "installer overrides name individual roles")
    for value in overrides.values():
        selection(value)
        need(value != "inherit", "installer inheritance requires normalized null")
    if current is not None:
        choices(current)
    roles = {}
    for role, (model, effort) in installer_defaults().items():
        old = None if current is None else dict(current[role])
        selected = overrides.get(role, model if old is None else old["model"])
        if old is not None:
            effort = old["effort"]
        elif selected != model:
            effort = None
        if HARNESS == "claude" and selected is None:
            selected = "inherit"
        roles[role] = {
            "current": old, "requested": {"model": selected, "effort": effort},
            "provenance": ("explicit-override" if role in overrides else
                           "fresh-default" if old is None else "preserved-existing"),
        }
    return {"harness": HARNESS, "roles": roles}


def metadata(info):
    return [info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_uid]


class Pair:
    def __init__(self, *, installed=True):
        self.root = Path.cwd()
        need(all(unicodedata.category(c)[0] != "C" and c not in "\u2028\u2029" for c in str(self.root)),
             "unsafe root characters")
        self.check_root()
        self.helper = f"{DIRECTORY}/domestique-model-setup.py"
        need(not installed or Path(__file__) == self.root / self.helper, "helper location/root mismatch")
        self.paths = {
            role: (f"{DIRECTORY}/agents/{role}.toml" if HARNESS == "codex" else
                   f"{DIRECTORY}/agents/domestique-v2-copilot-{role}.agent.md"
                   if HARNESS == "copilot" else f"{DIRECTORY}/agents/{role}.md")
            for role in ROLES
        }
        self.state = f"{DIRECTORY}/.domestique"
        self.manifest = f"{self.state}/manifest"
        self.files = [*self.paths.values(), self.manifest,
                      *(f"{self.state}/base/{p}" for p in self.paths.values()),
                      self.helper, f"{self.state}/base/{self.helper}"]

    def check_root(self):
        gitroot = subprocess.check_output(
            ["git", "rev-parse", "--show-toplevel"], text=True).rstrip("\n")
        need(Path.cwd() == self.root and str(self.root) == gitroot and
             self.root.resolve() == self.root, "invoke at physical Git worktree root")

    def read_snapshot(self, *, absent=False):
        records, contents, parents = {}, {}, {}
        for rel in self.files:
            path = self.root / rel
            for parent in reversed(path.parents):
                if absent and not parent.exists() and not parent.is_symlink():
                    parents[str(parent)] = None
                    continue
                info = parent.lstat()
                need(stat.S_ISDIR(info.st_mode), f"unsafe directory: {parent}")
                if parent == self.root or self.root in parent.parents:
                    need(info.st_uid == os.getuid() and not info.st_mode & 0o022,
                         f"unsafe directory ownership/mode: {parent}")
                # Directory nlink includes ordinary children on APFS; our
                # operation-owned temporary changes it. Bind identity/mode/
                # ownership, not a filesystem-dependent child count.
                parents[str(parent)] = [info.st_dev, info.st_ino, info.st_mode, info.st_uid]
            if absent and not path.exists() and not path.is_symlink():
                records[rel], contents[rel] = None, None
                continue
            info = path.lstat()
            need(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and
                 info.st_size <= LIMIT and info.st_mode & 0o444 and
                 not info.st_mode & 0o7022 and info.st_uid == os.getuid(),
                 f"unsafe file ownership/mode: {rel}")
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                need(metadata(os.fstat(fd)) == metadata(info), f"changed identity: {rel}")
                with os.fdopen(fd, "rb", closefd=False) as stream:
                    data = stream.read(LIMIT + 1)
                need(len(data) <= LIMIT and metadata(path.lstat()) == metadata(info),
                     f"changed file: {rel}")
            finally:
                os.close(fd)
            records[rel] = metadata(info) + [sha(data)]
            contents[rel] = data
        return {"files": records, "parents": parents}, contents

    def snapshot(self):
        snapshot, contents = self.read_snapshot()
        self.validate_contents(contents)
        return snapshot, contents

    def validate_contents(self, contents, *, legacy=False, partial=False):
        manifest = self.inventory(contents[self.manifest])
        inventory = manifest["files"].split(",")
        need(all(p in inventory for p in self.paths.values()) and
             (legacy or self.helper in inventory),
             "incomplete/unsafe inventory; preserving installer upgrade required")
        if legacy:
            need(self.helper not in inventory and contents[self.helper] is None and
                 contents[f"{self.state}/base/{self.helper}"] is None,
                 "unowned legacy helper")
        else:
            need(contents[self.helper] is not None, "missing claimed helper")
            need(contents[f"{self.state}/base/{self.helper}"] is not None,
                 "missing claimed helper base")
            self.validate_helper(contents)
        for role in ROLES:
            if contents[self.paths[role]] is not None or not partial:
                parse(contents[self.paths[role]], role)
            base = contents[f"{self.state}/base/{self.paths[role]}"]
            need(base is not None, "missing required role base")
            _, _, marker = parse(base, role)
            need(marker is None, self.pristine_base_guidance(role))

    def pristine_base_guidance(self, role):
        base = f"{self.state}/base/{self.paths[role]}"
        return ("pristine base must not confirm a pair: ./" + base + " carries a "
                "'# domestique-model-setup:' marker. Keep copies of the local role and base; "
                "restore the original pristine snapshot for that installed generation, without "
                "the marker line. Do not replace it with current upstream text: the historical "
                "base is merge authority. Reconcile the role ./" +
                self.paths[role] + " by hand and retry. --force cannot authorize repair.")

    def validate_helper(self, contents):
        need(contents[self.helper] == contents[f"{self.state}/base/{self.helper}"],
             "modified helper; explicit installer repair required")
        try:
            ast.parse(contents[self.helper], filename=self.helper)
        except SyntaxError as exc:
            raise ValueError("malformed helper") from exc

    def inventory(self, data):
        need(type(data) is bytes, "missing manifest")
        manifest = {}
        for line in data.decode("utf-8").splitlines():
            key, sep, value = line.partition("=")
            need(sep and key not in manifest and re.fullmatch("[a-z_][a-z_0-9]*", key),
                 "ambiguous manifest")
            manifest[key] = value
        need(manifest.get("snapshot_format") == "1" and
             manifest.get("platform", "claude") == HARNESS, "wrong snapshot authority")
        inventory = manifest.get("files", "").split(",")
        need(len(inventory) == len(set(inventory)) and
             all(p and not p.startswith("/") and ".." not in p.split("/")
                 and not any(unicodedata.category(c)[0] == "C" for c in p)
                 for p in inventory), "incomplete/unsafe inventory; preserving installer upgrade required")
        return manifest

    def publication_writable(self):
        # Only apply, in the consented/protected-write-approved context, checks
        # effective write access. Filesystem modes remain in the read-only
        # snapshot; native sandbox permissions are not persistent plan evidence.
        for rel in self.paths.values():
            for path in (self.root / rel, (self.root / rel).parent):
                need(path.stat().st_mode & 0o222 and os.access(path, os.W_OK),
                     f"not writable: {path}")


def split_marker(data, role):
    text = data.decode("utf-8")
    lines = text.splitlines(keepends=True)
    indices = [i for i, line in enumerate(lines) if MARKER in line]
    marker = None
    if indices:
        position = 0 if HARNESS == "codex" else 1
        need(role == "implementer" and indices == [position] and
             lines[position].startswith(MARKER + " "), "misplaced/duplicate marker")
        marker = load(lines[position][len(MARKER):])
        need(type(marker) is dict and set(marker) == {
            "v", "project", "harness", "implementer_sha256", "reviewer_sha256"} and
             type(marker["v"]) is int and marker["v"] == 1 and
             type(marker["project"]) is str and marker["harness"] == HARNESS and
             all(type(marker[r + "_sha256"]) is str and
                 re.fullmatch("[0-9a-f]{64}", marker[r + "_sha256"]) for r in ROLES),
             "malformed marker")
        del lines[position]
    return "".join(lines), marker


def scalar_span(raw, toml=False):
    """Return decoded scalar and exact value end, leaving whitespace/comment intact."""
    if raw.startswith('"'):
        # TOML strings use the JSON-compatible subset here; ambiguous existing
        # escape syntax refuses rather than rewriting it.
        value, end = json.JSONDecoder().raw_decode(raw)
        need(type(value) is str, "non-string scalar")
    elif raw.startswith("'"):
        expression = r"'[^']*'" if toml else r"'(?:[^']|'')*'"
        match = re.match(expression, raw)
        need(match is not None, "invalid quoted scalar")
        end = match.end()
        value = raw[1:end-1] if toml else raw[1:end-1].replace("''", "'")
    else:
        need(not toml, "TOML selection must be a string")
        end = re.search(r"[ \t]+#|$", raw).start()
        value = raw[:end].rstrip()
        end = len(value)
        need(value and not any(c in value for c in "[]{}&*!|>`%@") and
             not value.startswith(("-", "?", ":", "#")) and ": " not in value and
             not value.endswith(":") and
             value.lower() not in ("null", "~", "true", "false", "yes", "no", "on", "off")
             and not re.match(r"^[+\-0-9.]", value), "ambiguous YAML scalar")
    need(not raw[end:].strip() or re.fullmatch(r"[ \t]+#.*", raw[end:]),
         "ambiguous scalar suffix")
    selection(value)
    return value, end


def description_guidance(role):
    rel = (f"{DIRECTORY}/agents/{role}.toml" if HARNESS == "codex" else
           f"{DIRECTORY}/agents/domestique-v2-copilot-{role}.agent.md"
           if HARNESS == "copilot" else f"{DIRECTORY}/agents/{role}.md")
    prefix = {"claude": "Claude Code only; never match in another harness.",
              "codex": "Codex only; never match in another harness.",
              "copilot": "Copilot only; never match in Claude, Codex or an unknown harness."}[HARNESS]
    return ("missing/invalid native description: ./" + rel + ". The discovery description "
            "must be a non-empty string that starts with " + repr(prefix) + "; restore that prefix "
            "(custom text may follow it), reconcile the role by hand and retry. --force cannot "
            "authorize guard repair.")


def parse(data, role):
    text, marker = split_marker(data, role)
    need(not any(unicodedata.category(c) == "Cc" and c not in "\r\n\t" for c in text),
         "unsupported controls")
    # Preserve LF/CRLF exactly; mixed/lone-CR documents require human repair.
    newline = "\r\n" if "\r\n" in text else "\n"
    need("\r" not in text.replace("\r\n", "") and
         (newline == "\n" or "\n" not in text.replace("\r\n", "")), "mixed line endings")
    lines = text.splitlines(keepends=True)
    fields, spans = {}, {}
    effort = "model_reasoning_effort" if HARNESS == "codex" else "effort"
    if HARNESS == "codex":
        import tomllib
        fields = tomllib.loads(text)
        prompt = fields.get("developer_instructions")
        need(type(prompt) is str and prompt.strip(), "missing/invalid developer_instructions")
        # Prefix parsing recognizes top-level assignments outside multiline
        # instructions/tables, without interpreting their contents as fields.
        prefix = ""
        insertion = 0
        for i, line in enumerate(lines):
            try:
                before = tomllib.loads(prefix)
                complete = True
            except tomllib.TOMLDecodeError:
                complete = False
            if complete and line.lstrip().startswith("["):
                break
            if complete:
                match = re.match(r"([A-Za-z_][A-Za-z0-9_]*)([ \t]*=[ \t]*)(.*?)(\r?\n)?$", line)
                if match and match[1] in ("model", effort):
                    value, end = scalar_span(match[3], True)
                    spans[match[1]] = (i, len(match[1] + match[2]), end)
                    need(fields[match[1]] == value, "ambiguous TOML value")
            prefix += line
        for key in ("model", effort):
            need(key not in fields or key in spans, "unsupported selection placement")
    else:
        need(lines and lines[0] == "---" + newline, "missing YAML frontmatter")
        end = next((i for i in range(1, len(lines)) if lines[i] == "---" + newline), None)
        need(end is not None, "unterminated YAML frontmatter")
        need("".join(lines[end + 1:]).strip(), "missing native prompt body")
        insertion = end
        for i in range(1, end):
            line = lines[i]
            if not line.strip() or line.lstrip().startswith("#"):
                continue
            match = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_-]*)(:[ \t]*)(.*?)(?:\r?\n)", line)
            need(match is not None and match[1] not in fields, "complex/duplicate YAML field")
            key, _, raw = match.groups()
            if key == "tools" and raw.startswith("["):
                value, stop = json.JSONDecoder().raw_decode(raw)
                need(type(value) is list and all(type(t) is str for t in value) and
                     (not raw[stop:].strip() or re.fullmatch(r"[ \t]+#.*", raw[stop:])),
                     "unsupported tools")
            else:
                try:
                    value, stop = scalar_span(raw)
                except ValueError as exc:
                    # An empty/ambiguous description is a discovery-boundary
                    # refusal, not a generic selection error.
                    need(key != "description", description_guidance(role) + " Cause: " + str(exc))
                    raise
            fields[key] = value
            if key in ("model", effort):
                spans[key] = (i, len(key + match[2]), stop)
        if HARNESS == "copilot":
            need("effort" not in fields and "model_reasoning_effort" not in fields,
                 "Copilot effort unsupported")
    native_name = f"domestique-v2-copilot-{role}" if HARNESS == "copilot" else role
    need(type(fields.get("name")) is str and fields["name"] == native_name,
         "wrong/missing native role name")
    need(type(fields.get("description")) is str and fields["description"].strip(),
         description_guidance(role))
    return (lines, newline, insertion, spans), fields, marker


def patch(data, role, choice, *, model_only=False, preserve_model=False):
    (lines, newline, insertion, spans), fields, _ = parse(data, role)
    effort = "model_reasoning_effort" if HARNESS == "codex" else "effort"
    selected = {"model": choice["model"]}
    if HARNESS == "claude" and selected["model"] is None:
        selected["model"] = "inherit"
    if preserve_model:
        selected.pop("model")
    if HARNESS != "copilot" and not model_only:
        selected[effort] = choice["effort"]
    additions = []
    for key, value in selected.items():
        encoded = json.dumps(value, ensure_ascii=False) if value is not None else None
        if key in spans:
            index, start, length = spans[key]
            line = lines[index]
            suffix = line[start + length:]
            if encoded is None:
                # Retain the exact unrelated inline comment (and its spacing).
                lines[index] = suffix if "#" in suffix else ""
            elif fields[key] != value:
                lines[index] = line[:start] + encoded + suffix
        elif encoded is not None:
            additions.append(key + (" = " if HARNESS == "codex" else ": ") + encoded + newline)
    lines[insertion:insertion] = additions
    output = "".join(lines).encode("utf-8")
    _, actual, _ = parse(output, role)
    expected = dict(fields)
    for key, value in selected.items():
        if value is None:
            expected.pop(key, None)
        else:
            expected[key] = value
    need(actual == expected, "patch changed unrelated metadata")
    return output


def build(pair, selected, snapshot, contents):
    outputs = {r: patch(contents[pair.paths[r]], r, selected[r],
                        preserve_model=selected[r]["model"] ==
                        parse(contents[pair.paths[r]], r)[1].get("model")) for r in ROLES}
    mark_outputs(pair, outputs)
    diff = pair_diff(pair, contents, outputs)
    plan = {"v": 1, "root": str(pair.root), "harness": HARNESS,
            "choices": selected, "snapshot": snapshot, "diff": diff}
    return plan, outputs


def mark_outputs(pair, outputs):
    marker = {"v": 1, "project": str(pair.root), "harness": HARNESS,
              **{r + "_sha256": sha(outputs[r]) for r in ROLES}}
    lines = outputs["implementer"].splitlines(keepends=True)
    newline = b"\r\n" if b"\r\n" in outputs["implementer"] else b"\n"
    lines.insert(0 if HARNESS == "codex" else 1, MARKER.encode() + b" " + canonical(marker) + newline)
    outputs["implementer"] = b"".join(lines)


def pair_diff(pair, contents, outputs):
    return "".join(file_diff(pair.paths[r], contents[pair.paths[r]], outputs[r]) for r in ROLES)


def file_diff(rel, before, after):
    chunks = difflib.unified_diff((before or b"").decode().splitlines(keepends=True),
                                 after.decode().splitlines(keepends=True),
                                 fromfile="a/" + rel, tofile="b/" + rel)
    # Explicit no-final-newline annotation, never hide that byte distinction.
    return "".join(line if line.endswith("\n") else line + "\n\\ No newline at end of file\n"
                   for line in chunks)


def verify(pair, contents):
    hashes, selected = {}, {}
    marker = None
    for role in ROLES:
        data = contents[pair.paths[role]]
        _, fields, found = parse(data, role)
        bare, _ = split_marker(data, role)
        hashes[role] = sha(bare.encode())
        selected[role] = {"model": fields.get("model"),
                          "effort": fields.get("model_reasoning_effort" if HARNESS == "codex" else "effort")}
        if role == "implementer":
            marker = found
    confirmed = bool(marker and marker["project"] == str(pair.root) and
                     all(marker[r + "_sha256"] == hashes[r] for r in ROLES))
    return {"scope": "filesystem-only", "confirmed": confirmed, "root": str(pair.root),
            "harness": HARNESS, "selected": selected, "pair_hashes": hashes}


def publish(pair, plan, digest):
    need(type(digest) is str and re.fullmatch("[0-9a-f]{64}", digest) and
         sha(canonical(plan)) == digest, "prepared plan digest mismatch")
    need(type(plan) is dict and set(plan) == {"v", "root", "harness", "choices", "snapshot", "diff"}
         and type(plan["v"]) is int and plan["v"] == 1 and
         plan["root"] == str(pair.root) and plan["harness"] == HARNESS, "plan binding mismatch")
    selected = choices(plan["choices"])
    expected, contents = pair.snapshot()
    computed, outputs = build(pair, selected, expected, contents)
    need(canonical(computed) == canonical(plan), "stale/tampered plan; prepare and consent again")
    pair.publication_writable()
    # A plan cannot be replayed after successful publication: even reconfirmation
    # replaces the implementer inode. No registry/receipt is needed.
    return publish_outputs(pair, expected, contents, outputs)


def publish_outputs(pair, expected, contents, outputs, *, dependencies=None, configured=True):
    """One publication engine; installer dependencies precede the final marker."""
    owned, changed, made = {}, [], []
    try:
        original = contents[pair.paths["implementer"]]
        bare = split_marker(original, "implementer")[0].encode() if original else None
        stages = []
        pair_changed = any(contents[pair.paths[r]] != outputs[r] for r in ROLES)
        if bare != original and (dependencies is None or pair_changed):
            stages.append((pair.paths["implementer"], bare))
        stages += list((dependencies or {}).items())
        stages += [(pair.paths[r], outputs[r]) for r in ("reviewer", "implementer")]
        for rel, data in stages:
            if dependencies is not None and contents[rel] == data:
                continue
            current, _ = pair.snapshot()
            need(current == expected, "prepublication state changed")
            pair.publication_writable()
            path = pair.root / rel
            for parent in reversed(path.parents):
                if str(parent) in expected["parents"] and expected["parents"][str(parent)] is None:
                    current, _ = pair.snapshot()
                    need(current == expected, "prepublication directory state changed")
                    parent.mkdir(mode=0o755)
                    made.append(str(parent))
                    info = parent.lstat()
                    expected["parents"][str(parent)] = [
                        info.st_dev, info.st_ino, info.st_mode, info.st_uid]
            fd, name = tempfile.mkstemp(prefix=".domestique-model-setup-", dir=path.parent)
            temp = Path(name)
            try:
                owned[temp] = (metadata(os.fstat(fd)), b"")
                record = expected["files"][rel]
                os.fchmod(fd, stat.S_IMODE(record[2]) if record else 0o644)
                owned[temp] = (metadata(os.fstat(fd)), b"")
                with os.fdopen(fd, "wb", closefd=False) as stream:
                    stream.write(data)
                    stream.flush()
                    os.fsync(fd)
                info = metadata(os.fstat(fd))
                owned[temp] = (info, data)
            finally:
                os.close(fd)
            current, _ = pair.snapshot()
            need(current == expected and metadata(temp.lstat()) == info and
                 temp.read_bytes() == data, "prepublication state/temp changed")
            pair.publication_writable()
            os.replace(temp, path)
            del owned[temp]
            changed.append(rel)
            contents[rel] = data
            expected["files"][rel] = info + [sha(data)]
        current, contents = pair.snapshot()
        need(current == expected and all(contents[pair.paths[r]] == outputs[r] for r in ROLES),
             "postpublication state changed")
        result = verify(pair, contents)
        pair.validate_contents(contents)
        need(result["confirmed"] == configured, "postpublication marker invalid")
        if dependencies is not None:
            result.update(configured=configured, native_ready=False,
                          outcome="configured" if configured else "reconfirmation-required",
                          published=changed, publication_snapshot=expected)
        return result
    except (OSError, ValueError) as exc:
        raise ValueError(json.dumps({
            "scope": "filesystem-only", "error": str(exc), "partial": bool(changed or made),
            "published": changed, "workflow_authorized": False,
            "created_directories": made,
            "recovery": "No rollback. Inspect current pair; prepare/summarize and obtain new consent.",
            "operation_temporaries": [str(p) for p in owned],
        })) from exc
    finally:
        for path, (identity, data) in owned.items():
            try:
                if metadata(path.lstat()) == identity and path.read_bytes() == data:
                    path.unlink()
                    print("Removed operation temporary: " + str(path), file=sys.stderr)
                else:
                    print("Retained unknown temporary: " + str(path), file=sys.stderr)
            except FileNotFoundError:
                pass
            except OSError as exc:
                print(f"Retained temporary {path}: {exc}", file=sys.stderr)


def project_settings(data, role):
    """Nonselection merge view; scalar lines (including comments) remain local."""
    (lines, _, _, spans), _, _ = parse(data, role)
    indices = {span[0] for span in spans.values()}
    return "".join(line for i, line in enumerate(lines) if i not in indices).encode()


def restore_settings(local, merged, role):
    """Reinsert exact local scalar lines at unambiguous unchanged boundaries."""
    (lines, _, _, spans), _, _ = parse(local, role)
    indices = {span[0] for span in spans.values()}
    old = [line for i, line in enumerate(lines) if i not in indices]
    new = merged.decode("utf-8").splitlines(keepends=True)
    boundaries = {}
    for tag, a, b, c, d in difflib.SequenceMatcher(None, old, new, autojunk=False).get_opcodes():
        if tag == "equal":
            for offset in range(b - a + 1):
                boundaries.setdefault(a + offset, set()).add(c + offset)
    additions, offset = {}, 0
    for i, line in enumerate(lines):
        if i in indices:
            targets = {0} if offset == 0 else boundaries.get(offset, set())
            need(len(targets) == 1, "selection boundary changed; preserving merge requires review")
            additions.setdefault(next(iter(targets)), []).append(line)
        else:
            offset += 1
    for index in sorted(additions, reverse=True):
        new[index:index] = additions[index]
    result = "".join(new).encode()
    need(project_settings(result, role) == merged, "selection restoration changed body")
    return result


class InstallerPair(Pair):
    """Trusted installer library interface ONLY; deliberately absent from main().

    Load the installer's own emitted helper (not an unvalidated live helper),
    authorize the requested provider/overrides and preflight the WHOLE lifecycle.
    Supply seven pristine emitter outputs, recognized (version, files) inventory
    signatures, the existing preserving merge(role, local, base, upstream) callback,
    and native guard validation(role, base, live, candidate). Callbacks must raise
    on conflicts/unsafe guards; no runtime plan supplies code or replacement bodies.

    prepare(overrides) is read-only, including absent files/directories. Keep this
    object and its returned digest in the trusted installer; apply(plan, digest)
    accepts ONLY that prepared plan. It publishes only these seven helper-owned
    paths, not the entire inventory. The installer owns other lifecycle publication
    and global success. Reconfirmation-required is explicitly NOT global success.
    The internal result's publication_snapshot binds the verified outputs and
    identities. Carry it through final lifecycle verification without rereading a
    new baseline. No remaining installer step may mutate these seven paths.
    Native CLI publication results deliberately do not expose this internal field.
    Partial owned pairs refuse without repair: the installer must coordinate repair with
    explicit reconfirmation. Restoring an absent-marker pair here would erase its
    partial-state evidence and let a subsequent rerun mistake it for legacy.
    No provider readiness, CLI authorization, historical attestation or force
    policy is inferred here. Pristine inputs must NEVER be seeded from custom live
    bytes. Recognized inventory signatures come from reviewed installer versions,
    not from the target's own manifest. No persistent second registry is created.
    Optional adopted inputs are exact raw native files independently qualified
    by the installer's provider/path/mode identities and missing-state or
    policy-only preflight. They bind actual inputs (including absent bases),
    not reconstructed snapshots, normalized identities, or arbitrary role pairs.
    """

    def __init__(self, pristine, recognized, merge, validate, *, adopted=None):
        super().__init__(installed=False)
        need(type(pristine) is dict and set(pristine) == set(self.files) and
             all(type(v) is bytes and len(v) <= LIMIT for v in pristine.values()),
             "complete bounded pristine install output required")
        need(callable(merge) and callable(validate), "installer merge/guard validation required")
        self.pristine = dict(pristine)
        self.recognized = frozenset(recognized)
        self.merge, self.guard = merge, validate
        self.validate_contents(self.pristine)
        for role, rel in self.paths.items():
            need(pristine[rel] == pristine[f"{self.state}/base/{rel}"],
                 "install role must be actual pristine emitter output")
            self.guard(role, pristine[rel], pristine[rel], pristine[rel])
        self.prepared = None
        # Installer-only, independently proven pre-snapshot inputs. Keep the
        # actual absent bases in snapshots/publication; never fabricate on-disk
        # authority or use custom live bytes as a historical merge anchor.
        self.adopted = None if adopted is None else dict(adopted)
        if self.adopted is not None:
            need(set(self.adopted) == set(self.files) and
                 self.adopted[self.helper] is None and
                 all(self.adopted[f"{self.state}/base/{p}"] is None
                     for p in (*self.paths.values(), self.helper)),
                 "adoption cannot replace existing native authority")

    def snapshot(self):
        return self.read_snapshot(absent=True)

    def publication_writable(self):
        for rel in self.files:
            path = self.root / rel
            while not path.exists():
                path = path.parent
            need(path.stat().st_mode & 0o222 and os.access(path, os.W_OK),
                 f"not writable: {path}")
            if path.is_file():
                need(path.parent.stat().st_mode & 0o222 and os.access(path.parent, os.W_OK),
                     f"not writable: {path.parent}")

    def classify(self, contents, snapshot):
        if self.adopted is not None:
            need(contents == self.adopted, "changed pristine adoption evidence")
            return "legacy"
        if all(v is None for v in contents.values()):
            need(snapshot["parents"].get(str(self.root / self.state)) is None,
                 "unknown existing provider authority")
            return "fresh"
        manifest = self.inventory(contents[self.manifest])
        need((manifest.get("domestique_version"), manifest["files"]) in self.recognized,
             "unknown inventory generation")
        legacy = self.helper not in manifest["files"].split(",")
        self.validate_contents(contents, legacy=legacy, partial=True)
        if any(contents[p] is None for p in self.paths.values()):
            return "partial"
        result = verify(self, contents)
        if result["confirmed"]:
            need(not legacy, "legacy inventory cannot claim current confirmation")
            return "confirmed"
        if parse(contents[self.paths["implementer"]], "implementer")[2] is not None:
            return "stale"
        if all(project_settings(contents[p], r) ==
               project_settings(contents[f"{self.state}/base/{p}"], r)
               for r, p in self.paths.items()):
            return "legacy"
        return "custom-unconfirmed"

    def prepare(self, overrides, *, force=False):
        self.check_root()
        need(type(overrides) is dict and set(overrides) <= set(ROLES),
             "installer overrides name individual roles")
        overrides = dict(overrides)
        for value in overrides.values():
            selection(value)
            need(value != "inherit", "installer inheritance requires normalized null")
        snapshot, contents = self.snapshot()
        eligibility = self.classify(contents, snapshot)
        need(eligibility != "partial", json.dumps({
            "scope": "filesystem-only", "configured": False, "outcome": "repair-required",
            "error": "partial owned pair; safe installer repair and review/Save required",
            "partial": False, "published": [], "workflow_authorized": False,
        }))
        qualified = eligibility in ("fresh", "confirmed", "legacy")
        historical = (eligibility == "custom-unconfirmed" and
                      self.helper not in self.inventory(contents[self.manifest])["files"].split(","))
        need(qualified or not overrides,
             "unconfirmed pair; review/Save before model override")
        outputs = {}
        for role, (model, effort) in installer_defaults().items():
            rel = self.paths[role]
            local, upstream = contents[rel], self.pristine[rel]
            base = contents[f"{self.state}/base/{rel}"]
            if self.adopted is not None:
                base = local  # Exact raw historical proof supplied by installer.
            if local is None:
                selected = overrides.get(role, model)
                outputs[role] = patch(upstream, role, {
                    "model": selected, "effort": effort if selected == model else None})
            elif qualified or historical:
                # No generic merge may decide that local==base unpins a scalar.
                projected = [project_settings(data, role) for data in (local, base, upstream)]
                merged = projected[0] if projected[1] == projected[2] else self.merge(role, *projected)
                need(type(merged) is bytes and len(merged) <= LIMIT, "invalid preserving merge output")
                if force and qualified:
                    self.guard(role, base, local, restore_settings(local, merged, role))
                    merged = projected[2]
                outputs[role] = restore_settings(local, merged, role)
                if role in overrides:
                    current_model = parse(outputs[role], role)[1].get("model")
                    if HARNESS == "claude" and current_model == "inherit":
                        current_model = None
                    if current_model != overrides[role]:
                        outputs[role] = patch(outputs[role], role,
                                              {"model": overrides[role]}, model_only=True)
            else:
                outputs[role] = local
            self.guard(role, base or upstream, local or upstream, outputs[role])
            parse(outputs[role], role)
        if qualified:
            mark_outputs(self, outputs)
            # Preserve even noncanonical-but-valid v1 marker formatting and inode.
            if eligibility == "confirmed" and all(
                    split_marker(contents[self.paths[r]], r)[0] ==
                    split_marker(outputs[r], r)[0] for r in ROLES):
                outputs["implementer"] = contents[self.paths["implementer"]]
        dependencies = {p: self.pristine[p] for p in self.files if p not in self.paths.values()}
        if not qualified:
            # Retain the real old base even after historical guard migration.
            # Advancing it could make an unreviewed custom body that coincides
            # with upstream silently qualify as legacy on the next rerun.
            for rel in self.paths.values():
                base = f"{self.state}/base/{rel}"
                dependencies[base] = contents[base]
        final = {**dependencies, **{self.paths[r]: outputs[r] for r in ROLES}}
        self.validate_contents(final)
        result = verify(self, final)
        need(result["confirmed"] == qualified, "invalid final installation pair")
        plan = {
            "v": 1, "purpose": "installer-selected-pair", "root": str(self.root),
            "harness": HARNESS, "overrides": overrides, "eligibility": eligibility,
            "force": force, "historical_migration": historical,
            "configured": qualified, "snapshot": snapshot,
            "selected": result["selected"],
            "outputs": {p: sha(data) for p, data in final.items()},
            "diff": pair_diff(self, contents, outputs),
            "dependency_diff": "".join(file_diff(p, contents[p], data)
                                       for p, data in dependencies.items()),
        }
        # Retain independent canonical evidence; never trust a mutable returned plan.
        digest = sha(canonical(plan))
        self.prepared = (canonical(plan), digest, contents, outputs, dependencies)
        return {"plan": plan, "digest": digest}

    def apply(self, plan, digest):
        self.check_root()
        need(self.prepared is not None, "installer must prepare before publication")
        evidence, approved, contents, outputs, dependencies = self.prepared
        need(digest == approved and sha(canonical(plan)) == digest and
             canonical(plan) == evidence, "installer plan digest/binding mismatch")
        expected = load(evidence)["snapshot"]
        current, _ = self.snapshot()
        need(current == expected, "stale installer snapshot; no automatic reprepare")
        self.publication_writable()
        self.prepared = None  # A failed/partial attempt also consumes this operation.
        return publish_outputs(self, expected, dict(contents), outputs,
                               dependencies=dependencies, configured=plan["configured"])


def native_request(arguments):
    """Parse native argv before reading a pair; no installer publication API."""
    modes = {"--help": "help", "--configure": "configure", "--confirm": "confirm"}
    if not arguments:
        return "inspect", {}
    if arguments[0] in modes:
        need(len(arguments) == 1, "exclusive mode takes no settings")
        return modes[arguments[0]], {}
    selected = {}
    index = 0
    flags = {"--" + role + suffix: (role, field)
             for role in ROLES for suffix, field in (("", "model"), ("-effort", "effort"))}
    while index < len(arguments):
        flag, equals, value = arguments[index].partition("=")
        need(flag in flags, "unknown dom-models flag")
        need(flag not in selected, "duplicate dom-models flag")
        role, field = flags[flag]
        need(HARNESS != "copilot" or field != "effort", "Copilot effort unsupported")
        if not equals:
            index += 1
            need(index < len(arguments) and not arguments[index].startswith("--"),
                 "missing dom-models value")
            value = arguments[index]
        selection(value)
        selected[flag] = (role, field, None if value == "inherit" else value)
        index += 1
    return "settings", selected


def native_result(arguments):
    mode, overrides = native_request(arguments)
    usage = ("dom-models [--help | --configure | --confirm | SETTINGS]\n"
             "No arguments: inspect saved choices (read-only).\n"
             "SETTINGS: --implementer MODEL, --reviewer MODEL" +
             ("" if HARNESS == "copilot" else
              ", --implementer-effort LEVEL, --reviewer-effort LEVEL") +
             ". Separated or = values; inherit uses native inheritance.\n"
             "Modes are exclusive; duplicate/empty/unknown flags refuse. Changes require Save.")
    if mode == "help":
        return {"mode": mode, "usage": usage, "scope": "filesystem-only"}
    pair = Pair()
    try:
        snapshot, contents = pair.snapshot()
    except FileNotFoundError:
        if mode != "inspect":
            raise ValueError("pair not installed/unconfigured; preserving installer repair required")
        return {"mode": mode, "harness": HARNESS, "configured": False,
                "status": "not installed/unconfigured; missing pair or authority",
                "native_readiness": "not established"}
    current = verify(pair, contents)
    warnings = []
    _, marker = split_marker(contents[pair.paths["implementer"]], "implementer")
    if not current["confirmed"]:
        warnings.append("Unconfirmed/stale pair; Save acknowledges current bytes, not native readiness.")
    if marker and marker["project"] != str(pair.root):
        warnings.append("Copied/moved root: previous confirmation belongs to another project.")
    if any(project_settings(contents[pair.paths[r]], r) !=
           project_settings(contents[f"{pair.state}/base/{pair.paths[r]}"], r) for r in ROLES):
        warnings.append("Current body differs from pristine; preserved, not reset or made pristine.")
    tracked = subprocess.check_output(
        ["git", "ls-files", "--", *pair.paths.values()], text=True).splitlines()
    result = {"mode": mode, "scope": "filesystem-only", "harness": HARNESS,
              "root": str(pair.root), "configured": current["confirmed"],
              "current": current["selected"], "paths": pair.paths, "tracked": tracked,
              "warnings": warnings, "native_readiness": "not established",
              "reload": "Inspection/planning need no reload. Before execution reload only "
                        "if loaded roles do not demonstrably match saved choices."}
    if mode in ("inspect", "configure"):
        return result
    if mode == "confirm" and current["confirmed"]:
        result["status"] = "Already configured; nothing to save."
        return result
    chosen = {r: dict(current["selected"][r]) for r in ROLES}
    for role, field, value in overrides.values():
        chosen[role][field] = ("inherit" if HARNESS == "claude" and
                              field == "model" and value is None else value)
    plan, _ = build(pair, choices(chosen), snapshot, contents)
    result.update(chosen=chosen, plan=plan, digest=sha(canonical(plan)))
    return result


def main():
    need(len(sys.argv) >= 2, "expected prepare, apply or verify")
    action = sys.argv[1]
    if action in ("request", "request-text"):
        arguments = sys.argv[2:]
        if action == "request-text":
            need(len(arguments) == 1, "request-text requires original argument text")
            arguments = shlex.split(arguments[0], posix=True)
        result = native_result(arguments)
        print(canonical(result).decode())
        return
    pair = Pair()
    if action == "verify":
        need(len(sys.argv) == 2, "verify takes no overrides")
        _, contents = pair.snapshot()
        result = verify(pair, contents)
    elif action == "prepare":
        need(len(sys.argv) == 3, "prepare requires both choices as JSON")
        snapshot, contents = pair.snapshot()
        plan, _ = build(pair, choices(load(sys.argv[2])), snapshot, contents)
        result = {"plan": plan, "digest": sha(canonical(plan))}
    elif action == "apply":
        need(len(sys.argv) == 3, "apply requires independent prepared digest; plan on stdin")
        raw = sys.stdin.buffer.read(8 * LIMIT + 1)
        need(len(raw) <= 8 * LIMIT, "oversize plan")
        result = publish(pair, load(raw), sys.argv[2])
    else:
        raise ValueError("unknown action")
    print(canonical(result).decode())


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(json.dumps({"scope": "filesystem-only", "error": str(error)}), file=sys.stderr)
        sys.exit(1)
