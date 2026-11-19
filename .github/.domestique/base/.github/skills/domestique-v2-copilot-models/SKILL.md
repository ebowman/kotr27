---
name: domestique-v2-copilot-models
description: Copilot only; never match in Claude, Codex or an unknown harness. Inspect or explicitly change saved project role models.
---

## Active harness boundary (copilot only)

Before applying ANY instructions below, identify the ACTUAL native caller from
the client's available session context and native tools. Installed directories,
file names, skill matching/loading and this text are NOT caller identity.
There is no required identity API; if available context/tools do not establish
the client unambiguously, STOP and ask the human. Do not guess.
These instructions apply only to the native `copilot` client.
An explicit foreign-harness invocation must STOP without setup, Beads, task,
branch or dispatch writes. Report the mismatch; suggest the shared project-local
dom-decompose/dom-goal entry for Codex/Copilot or Claude's /dom-decompose
and /dom-goal commands, but do not invoke them automatically.

# Role models — inspection or one deliberate Save, never task execution

Use only this actual harness at the invocation's physical Git worktree ROOT.
Require an explicit native dom-models invocation (or the exact decompose
`configure role models` alias, mapped to `--configure`); implicit skill loading
does nothing. Preserve the ORIGINAL arguments; never infer setting flags from
prose or task text. No goal invocation/authorization, Beads, delegation (including
research helpers), task work, install/auto-init, credentials or provider changes.

Usage: `dom-models` inspects saved choices, read-only. `--help` shows this usage,
without requiring any installed pair/helper. `--configure` selects interactively,
prefilled with current saved models/efforts. `--confirm` prepares the current
unchanged pair for review when unconfirmed/stale; already configured needs no Save.
These modes are exclusive and cannot mix with settings. Explicit settings accept
any nonempty subset of `--implementer MODEL`, `--reviewer MODEL`,
`--implementer-effort LEVEL`, `--reviewer-effort LEVEL`, separated or `=value`.
Copilot rejects effort flags. `inherit` uses native encoding. Duplicate flags
(even equal), empty values, unknown flags, harness/path selectors or mixed modes
refuse with zero writes. Unmentioned models, efforts and partner remain exact.

Run the pristine bootstrap below with `request` followed by the actual argv.
When the native client exposes argument text rather than argv, pass `request-text`
and ONE literal argument containing that ORIGINAL text (Claude `$ARGUMENTS`;
Codex/Copilot original invocation arguments). The helper tokenizes deterministically
with shell-style quoting, but performs NO expansion or evaluation. Use the tool's
literal argument/JSON encoding, never interpolate model IDs or request text into
shell code; no eval, invented flags or a replacement parser. If original arguments
cannot be recovered losslessly, ask and stop rather than guess.

For exact `--help`, print usage directly even without a helper. Otherwise use the
validated installed helper only. If missing, inspection reports not installed/
unconfigured; changes stop for preserving installer repair. Never run an installer
or its InstallerPair API from this command, even as a consent bypass.
Inspection uses `request` with no arguments, NOT prepare/verify/catalog setup.
Show saved models/efforts, configured versus unconfirmed, warnings and readiness
limits. Missing pair: not installed/unconfigured, no auto-initialization.
No catalog questionnaire, network/auth check, mutation or mandatory reload for
inspection or planning. Saved configuration is not proof of loaded native roles.

`request --configure` returns current values and warnings without a plan.
Ask inline for changes with those values prefilled; retain all unmentioned
values and do not reset effort on a model change. Use `prepare` with both exact
choices only after selection. `request --confirm` or explicit setting argv returns
an exact read-only plan and digest directly; do not ask a model questionnaire.
No speculative catalog checks block reading or saving literal IDs; known native
support limitations can be reported, never silently substitute another model.

Present one compact summary: current -> chosen models/efforts, project/harness,
role paths, tracked-file consequences, scalar/pair-marker-only scope and relevant
stale/copied-root/current-body warnings. Confirm acknowledges current bodies,
preserves edits and pristine bases, and does not attest provider readiness.
Keep plan/digest internal and independently retain the prepared digest; detailed
diff is available on request, not printed by default. Ask once:
`Save these choices? Save / Cancel`. Selection/--confirm is NOT Save consent.
On Cancel/missing input/denied approval: `Cancelled; nothing saved`, no apply.
Changes to the plan require a new summary and new explicit Save.

Use the bootstrap's normal `apply DIGEST` with exact plan JSON on stdin ONLY
after explicit Save and native protected-write approval. No installer API,
broad permission or sandbox bypass. Await terminal completion (poll a running
tool session); pending/partial/nonzero is not success. Read-only `verify` after
apply must match its confirmed choices and hashes before reporting saved.
State saved versus loaded separately: inspection/planning need no restart;
before execution, reload/fresh invocation only when matching loaded registration
is not established. Saving never invokes/resumes a goal or grants execution.

The mechanical bootstrap/publication protocol below is reused, not an execution
gate. Never invoke a goal, ask a fresh questionnaire on inspection/confirm,
or use verify as a prerequisite for ordinary planning.
### Deterministic helper: filesystem only, not provider attestation
Use the installed helper for ALL mechanical preflight, preparation, publication
and read-only pair verification. Do not regenerate role bodies or write another
writer. The existing manifest/pristine bases and native pair marker remain the
sole authority; a stdout plan is not another receipt or proof of human consent.

Before EVERY helper execution, run this fixed trusted bootstrap with isolated
`python3 -I -B -c`, at physical ROOT. It checks safe ownership/path and byte
equality to the pristine helper externally, then executes those SAME verified
bytes in memory, never a later pathname read. Substitute only the fixed
DIRECTORY literal shown below for this actual harness, not user input:
DIRECTORY is `.github`.
```python
import os, stat, subprocess, sys
from pathlib import Path
root = Path.cwd()
assert str(root) == subprocess.check_output(
    ["git", "rev-parse", "--show-toplevel"], text=True).rstrip("\n")
assert root == root.resolve()
directory = ".github"
helper = root / directory / "domestique-model-setup.py"
base = root / directory / ".domestique/base" / directory / helper.name
manifest = root / directory / ".domestique/manifest"
def read(path):
    for parent in reversed(path.parents):
        info = parent.lstat()
        assert stat.S_ISDIR(info.st_mode)
        if parent == root or root in parent.parents:
            assert info.st_uid == os.getuid() and not info.st_mode & 0o022
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        assert stat.S_ISREG(info.st_mode) and info.st_nlink == 1
        assert info.st_uid == os.getuid() and not info.st_mode & 0o7022
        assert info.st_mode & 0o444 and info.st_size <= 1048576
        with os.fdopen(fd, "rb", closefd=False) as stream:
            data = stream.read(1048577)
        assert len(data) <= 1048576
        assert (info.st_dev, info.st_ino) == (path.lstat().st_dev, path.lstat().st_ino)
        return data
    finally:
        os.close(fd)
records = {}
for line in read(manifest).decode("utf-8").splitlines():
    key, separator, value = line.partition("=")
    assert separator and key not in records
    records[key] = value
harness = {".claude": "claude", ".codex": "codex", ".github": "copilot"}[directory]
assert records.get("snapshot_format") == "1"
assert records.get("platform", "claude") == harness
inventory = records.get("files", "").split(",")
assert len(inventory) == len(set(inventory))
assert str(helper.relative_to(root)) in inventory
code = read(helper)
assert code == read(base), "Modified helper; stop for explicit lifecycle repair"
sys.argv = [str(helper), *sys.argv[1:]]
exec(compile(code, str(helper), "exec"),
     {"__name__": "__main__", "__file__": str(helper)})
```
For interactive `--configure` only, pass `prepare` after current-prefilled
selection, with both choices in one JSON argument. Other modes use `request`
or `request-text` as described above; inspection/help never prepare or apply.
Example selection JSON:
`{"implementer":{"model":"EXACT-ID","effort":null},"reviewer":{"model":"EXACT-ID","effort":null}}`.
Both fields are mandatory for both roles; JSON null means native inheritance.
Copilot requires effort null and refuses effort settings. Claude model null
emits `inherit`; Codex/Copilot null removes model. No shipped model registry.
Prepare is READ-ONLY: no staging, permission probe, marker edit or other write.
It returns `plan` and `digest`. Present a concise summary derived from that exact
plan: project/harness, each current -> chosen model/effort (including native
inheritance), both exact role paths, scalar settings + pair confirmation marker
as the only change scope, preserved tools/prompts, and tracked-file consequences.
Offer the complete detailed diff on request; do not print raw diffs, marker JSON,
hashes/digests or verbose provider attestation by default. Keep checks internal;
briefly report relevant support limits or blockers, not an evidence transcript.
Retain its digest independently in the conversation/tool invocation,
not in an editable plan or by recalculating it from a later regenerated plan.
Ask once: `Save these choices? Save / Cancel`. This deliberate save action
consents only to the exact prepared plan summarized above, not future bytes.
Initial model selection before prepare is NOT save consent.
Changes require prepare/new summary/new explicit human save consent.
Cancellation, missing input or denied native write approval: do not call apply;
ZERO target writes, no Beads. Respond concisely: `Setup cancelled; nothing saved`
and stop. Do not report success or resume the initiating goal.
The digest binds integrity, NOT human consent.

Only after explicit consent AND the normal native one-command protected-write
approval, invoke the SAME bootstrap with `apply` and that independently retained
prepared digest as its only argument, supplying ONLY the exact plan JSON on
stdin. No file staging before approval; no model/body/path/root overrides at
apply. Do not try ordinary writes as permission probes. No persistent prefix,
broad permission or sandbox bypass. If approval is unavailable, STOP.

The helper recomputes the scalar-only patch against the full seven-file
snapshot (both roles, both pristine roles, manifest, helper and its base),
including file path/mode/device/inode/nlink/hash and parent identities/modes.
Prepare/verify require only safe readable evidence, including read-only roles
and parents. Native sandbox write access is not tracked filesystem mode state.
Only apply checks writable roles/parents in the approved execution context;
changed filesystem modes still require prepare/new summary/new consent.
After approval it creates collision-safe operation-owned temporaries, rechecks
all evidence immediately before EVERY publication, invalidates an old marker
first if present, publishes reviewer then implementer with the marker LAST,
and verifies exact bytes/modes/hashes. Not a hostile-writer/two-file transaction.
Failures are nonzero, with published paths/partial state and owned recovery
information. No blind rollback; never overwrite concurrent user changes.
Cleanup removes only unchanged operation-owned temporaries; unknown leftovers
are retained and reported. No permanent transaction registry/receipt.
On stale/manual body edits, preserve those bytes, show current choices and a
new prepared summary for explicit reconfirmation; never silently complete a pair.
Run apply synchronously when supported. If the native tool returns a running
session/background notification, wait using its supported wait/result mechanism
until terminal completion; pending is NOT saved. Check exit status and helper
JSON (filesystem-only, confirmed and chosen pair), then run read-only `verify`
through the same pristine bootstrap and check both hashes/choices against apply.
Nonzero exit, partial publication, missing/invalid result or failed verification
is explicit FAILURE, never success-shaped; report partial state/recovery and stop.
Only after verified completion say tersely which choices were saved.
Success is SETUP ONLY: no task, claim, dispatch, branch/commit or queued goal.
Planning is independent and may proceed on an explicit planning request without
reload, including one already supplied; do not ask the human to repeat it.
Before execution, stale/unknown registrations require a supported reload or
fresh native invocation, readiness checks and fresh explicit execution
authorization. Do not invent in-session refresh or treat saved files as loaded
roles. If supported evidence already establishes matching current registration,
do not demand a ceremonial restart. Setup consent alone never authorizes goal
work; the initiating goal is consumed, not queued.
