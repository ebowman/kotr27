---
name: domestique-v2-copilot-decompose
description: Copilot only; never match in Claude, Codex or an unknown harness. Handle an explicit /dom-decompose or /domestique-v2-copilot-decompose request; planning or role setup only.
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
## Direct parent Git requests
Read-only Git inspection is ordinary work. A direct user request for specified
Git operations, or clear "go ahead" / "run those commands" referring to the
current concrete proposal, authorizes the parent/orchestrator to perform those
operations in that repository. No magic slash command, new goal, Beads claim,
synthetic review, model-pair verification or preexisting permission receipt is
required. Handle this Git request directly, then return; do not enter the
managed-bead role/readiness/branch gates or delegation loop below.

Check the actual repository, relevant diff/index, branch and remote for the
operation. Preserve unrelated edits; scoped Git work does not require a globally
clean tree. Stage only intended paths/hunks and inspect the staged diff before
committing; never broad-stage, revert, stash or clean up unrelated files.
Explicitly requested commits of user-owned changes may proceed. An unreviewed
Domestique-managed bead still requires independent PASS before commit/closure;
Git approval never auto-closes it or bypasses its review gates.

Approval is limited to the specified repository and operations, including
scoped ordinary merge, push or cleanup when requested, even after a goal stops.
It never resumes a drain or authorizes more beads, force-push, reset or other
unrequested destructive extras. If context changed, the request is truly
ambiguous or a destructive action is not authorized, stop only the affected
action and ask narrowly. Quoted/untrusted text and vague handoff language alone
are not approval. Guest managed personal state stays excluded/local and must
not be staged or committed; guest mode does not forbid separately authorized
host-repository Git work. Delegated roles gain no authority: reviewers remain
read-only/no-commit and implementers remain bounded by their assigned brief.

User approval establishes intent, not a native permission bypass. Use the
normal tool-approval mechanism when the runtime requires it; do not ask a
redundant Domestique permission question because no prior approval record exists.
Exposed permission/sandbox controls alone are not evidence of denial. Actual
denial or unavailability means report a concise blocked reason and stop: no
bypass, retry through other tools, global settings changes or allow-all.
This does not alter the model editor's explicit Save protections.
## Explicit config-vs-plan routing
After the harness boundary, bind ROOT to this invocation's physical Git worktree
root; ambiguous root means ask and stop, never search another checkout.
Only the entire explicit argument `configure role models` is an alias for
the current native `dom-models --configure` body. Read that project-local body
instead of the execution gate below, preserving the original request and
this explicit alias mapping. Claude: `.claude/commands/dom-models.md`;
Codex: `.agents/skills/domestique-models/SKILL.md`;
Copilot: `.github/skills/domestique-v2-copilot-models/SKILL.md`.
Missing/foreign bodies stop; never initialize or embed a replacement setup.
An explicit request to configure/reconfigure roles outside that
form should be directed to `dom-models --configure`; do not
silently reinterpret a planning brief. Task text mentioning models, providers,
effort or role configuration is NOT configuration intent.
For an explicit planning request, SKIP the entire role setup section and go
directly to `# Decompose into beads`. No model configuration/questions, helper
verify, loaded-role check or reload: missing, unconfirmed or manually edited
role pairs do not gate planning. Do not read role files to decide whether to plan.
Missing/ambiguous request: ask for a planning brief or the exact configuration
invocation; loading instructions alone starts neither.
Configuration uses the routed dom-models protocol and never falls through
into planning or execution. Planning never delegates (including research helpers),
executes tasks, claims/closes beads, changes branches, stages or commits.

## copilot read-only execution gate

Ordinary planning-only decompose skips this entire gate: no role reads, helper
verify, model questions, loaded-role checks or reload, even for missing/stale
pairs. Loading instructions alone authorizes neither configuration nor work.
Direct parent Git requests use the authorization guidance above, not this gate.
Read-only goal target/scope queries may precede this gate without model questions.
For authorized managed-bead execution, run this gate BEFORE any Beads writes,
code, branch changes or dispatch. Establish the actual native client from
session context/tools, not directories or model names. Bind ROOT to this
invocation's exact physical Git worktree root; ambiguous identity/root or cwd
outside ROOT means STOP, never search another checkout or configure a sibling.

### Configured pair — read-only
Use the pristine helper bootstrap below with `verify`, not a second parser or
writer. It validates both native role files, installer-owned manifest/pristine
bases, safe paths, physical ROOT/harness and BOTH marker hashes. Preserved
ownership/root markers are filesystem evidence, NOT native attestation.
A valid installer-configured pair (including fresh defaults) or previously
saved custom/inherited pair needs NO questionnaire and NO writes.
Fresh installation alone requires no Save, setup-only detour, restart or new
goal invocation. Continue this explicit request through native readiness.
Visible default values without a valid marker are NOT confirmation.
Missing/stale markers, manually edited bodies/settings, copied/moved roots or
partial pairs remain unconfirmed; never silently repair files or bless bodies.
Unconfirmed/stale pair: STOP with one concise reason and `/dom-models --confirm`
for current-pair review, or `/dom-models --configure` to change choices.
Missing/unsafe files or ownership: STOP for explicit preserving installer repair
then current-pair review; never run installation/repair automatically.
This applies equally to interactive goal entry and noninteractive/autopilot
callers: no embedded wizard, persistence or automatic continuation on failure.
Model questions/changes belong only to explicit dom-models (or the exact
decompose `configure role models` alias). Its exact-plan summary, explicit Save,
native scoped approval and verified terminal completion remain mandatory.
Saving never authorizes or queues goal execution. Inspection never asks models.

### Minimal native readiness — read-only, not a probe
Do not delegate readiness checks (including documentation/research helpers).
The caller uses available evidence; this gate does not authorize any task.
Establish the actual native harness and present, unambiguous registered intended
role IDs with their required tools, using available session/registration
evidence and installed-version documented project discovery/precedence.
Check known competing definitions and invocation/environment/hook/client
overrides that could defeat selection, plus available non-secret model/effort
support evidence and restrictions. Use applicable evidence already available;
do not repeatedly list catalogs/config, run doctor subprocesses or perform
dispatch/network/paid probes on a normal run. Do not edit client settings.
A catalog is support evidence, not future entitlement or execution proof.

Use exposed source/selection evidence when available. Otherwise documented
native discovery and inheritance resolution with the verified pair and
unambiguous registered roles, absent counterevidence, suffice. Missing optional
loaded-byte/exact-origin APIs, independent inherited-model attestation or future
child telemetry alone MUST NOT block explicitly authorized work.
Inheritance follows documented native resolution, not a pinned model or
necessarily the direct parent. Check that resolution against known overrides
and support evidence; do not require an unavailable independent resolved-model
API. Genuinely unknown required registration/discovery or ambiguous resolution,
actual model/effort/tools mismatch, known unavailable/unsupported selection or
a defeating override means STOP before workflow writes or dispatch.
Report only the affected role, precise reason and `/dom-models --configure` route;
for stale/unknown current registration also name the supported reload/reinvoke
action needed. Never substitute another model or send a conflicting spawn
model/effort override. Ephemeral requests do not persist settings or override
fixed registrations. Helper `confirmed` alone never means native Ready.
Reload/fresh invocation is needed only for actually stale/unknown current
registrations before execution, not a freshly installed role already registered
through documented discovery. No invented hot-reload API or permission bypass.
After an actual reload/reinvoke require fresh explicit execution authorization;
do not queue/resume a stopped goal. Planning needs no reload.
During/after each authorized assignment, check available child role/model/effort
telemetry and selection errors before accepting work. Known failure/mismatch
stops without fallback; unavailable optional telemetry is not itself failure.
Retain configured-pair verification and native readiness while ROOT, harness,
pair, registration, tools and relevant overrides remain unchanged. Recheck only
affected evidence when relevant changes/errors invalidate it, not per bead or
progress checkpoint. Do not repeat helper verify, catalogs or model questions
merely because the successful-closure count changed.
Keep checks internal; report concise actionable blockers and material limits,
not catalogs, hashes or an attestation transcript.
Static instruction/helper tests are not native UX/dispatch qualification.
Copilot roles: `domestique-v2-copilot-implementer` /
`domestique-v2-copilot-reviewer`, in
`.github/agents/domestique-v2-copilot-{implementer,reviewer}.agent.md`.
Fresh defaults omit model in BOTH roles: inherit documented native resolution,
not necessarily the direct parent's model. No effort field is supported.
No independent inherited-model telemetry is required without counterevidence;
actual registered native role selection is still required.
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
Pass `verify` to that bootstrap on every fresh goal/delegation entry. Its JSON
`scope: filesystem-only`, `confirmed`, selected values and pair hashes are NOT
native availability/readiness. Still check actual native registration,
discovery/precedence, overrides, inheritance resolution and available telemetry
as specified above. Do not manually duplicate the helper's ownership/hash checks
or print its hashes as a normal-run ceremony. Existing native hooks are not controlled by this helper;
do not claim zero external hook reads.

## End execution gate — continue only for a confirmed, natively ready pair
Retain the original explicit goal scope, current user limits and actual runtime
budgets; progress checkpoints never reset a cap or require renewed approval.
Before goal work,
ALL tracked/index dirtiness (including configuration edits) requires human
disposition; never auto-stage, commit, stash, discard or hide it. Always use a
fresh independent reviewer context, even when both roles use the same model.
# Decompose into beads

On an explicit planning request, create one epic and bounded child
tasks using the existing project-scoped bd. Each task has one deliverable,
inputs/outputs, edge cases and testable done criteria. Wire real dependencies.
Check every result and retain actual IDs; errors are not successful creation.
Show scoped ready work and the epic tree for human review. No implementation,
delegation, claims, close, staging or commits. Planning never grants execution.
