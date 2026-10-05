#!/usr/bin/env python3
"""Validate a Codex skill entrypoint against its Claude counterpart.

Usage: codex-skill-check.py <claude SKILL.md> <codex SKILL.md> <kind>
Exit: 0 all checks pass, 1 any check failed, 2 usage error.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from importlib.util import spec_from_file_location, module_from_spec

_spec = spec_from_file_location("skill_source", os.path.join(os.path.dirname(__file__), "skill-source.py"))
_source = module_from_spec(_spec); _spec.loader.exec_module(_source)
skill_text = _source.skill_text

KINDS = ("multi-model", "super-plan", "ship", "critical-review")

RULES = [
    '''Load this skill once per session. Its text and every reference you have read stay in your context: do not read them again with `cat`, `sed` or any other tool on a later turn — not on "continue", not on a one-word approval, and not when a newer `PLUGIN_RUNTIME_CONTEXT_V1` line repeats the same model and effort. Re-read one section only when a detail you need is no longer in your context, and read only that range.''',
    '''Select the active-seat profile silently at Step 0. Update it only when newer runtime context changes the model or effort; follow User-facing communication below.''',
    '''The coordinator never authors code. Applying a patch a subagent prepared, running `apply_patch`, or editing a tracked file yourself is authoring code, whoever wrote the text. Changes reach the repository only through a supervised wave; your own git work is integrating approved wave branches and publishing. Exception: a small standalone edit the user asks for directly, outside any active wave plan — one file, a few lines, nothing beyond what the user named (a config value, a typo, a version string) — you may make yourself and show the diff. The exception never covers a fix for a defect that a review, a supervisor or the final review found, nor any part of an approved plan's tasks.''',
    '''On `environment-blocked`, diagnose before you ask the user for anything. Reproduce the failing step yourself outside the sandbox with a side-effect-free probe — for commit signing, `git commit-tree -S -m probe "HEAD^{tree}"`; for a cache directory, `test -w <dir>`. If the probe passes outside the sandbox, the sandbox cannot reach that resource: fix it in the plan's `worktree` key or on the machine, never by asking the user to restart an app or the session. Ask the user only for an action only they can take, and quote the probe's output.''',
    '''Recover a clean committed candidate with the runner's `--resume-from <summary.json>` and a new `--out` before considering a restart. It verifies and reviews without an executor and preserves call caps. Use the runner's own `--reset` only when intentionally discarding the candidate for a newly authorized implementation; never with hand-written `rm`, `git worktree remove` or `git branch -D` commands.''',
    '''Executor commits are unsigned by design. Integration squashes each task into one commit made outside the sandbox, which the user's git configuration signs (codex-wave-protocol.md, step 9). Never disable commit signing in the user's configuration.''',
]

PHRASES = {
    "multi-model": [
        "Never load more than one active-seat profile",
        "Never read a user config file to guess a session override",
        "decisions belong to the coordinator, execution belongs to separately routed agents",
        "coordinator never authors code.",
        "Never a time or cost estimate",
        "status: done",
        "name the failing command and its exact error line, fix the machine, and re-run",
        "phrased as a yes/no question",
        "not an instruction to self-check",
        "The approval covers those waves only",
        "is a valid and expected answer",
        "its own git worktree",
        "Always reply to the user in the language the user writes in",
        "Never write a fresh runner",
        "long waits, not frequent polls",
        "Every child has an explicit",
        "executors never spawn their own",
        "never the executor's own model",
        "only `violations` decide",
        "Mixed or unknown-provider wave",
    ],
    "super-plan": [
        "Never load more than one active-seat profile",
        "## No time or cost estimates",
        "Never predict how long a plan, a wave or a task will take",
        "Never a duration or a cost",
        "Assumptions (would ask)",
        "**Design for width.**",
        "**Order consumers after producers.**",
        "**Keep a change with what it breaks.**",
        "A plan that fails lint is not presented to the user.",
        "stays `draft` here",
        "Jesse Vincent",
        "Collect genuine product forks in one batch",
        "A mixed-provider wave is a planning defect to fix before Gate 2",
        "never the full-repo gate",
        "Fix what it finds before lint.",
    ],
    "ship": [
        "Never load more than one active-seat profile",
        "merge stays with the user",
        "ship adds no machinery",
        "the only one ship adds",
        "shared Post-Review Fix Protocol",
        "push → replies → resolves",
        "Not verified — manual QA needed",
        "Never a time or cost estimate",
        "never fix inline",
    ],
    "critical-review": [
        "Never load more than one active-seat profile",
        "reviewThreads(first:100, after:$endCursor)",
        "critical-review-fix-reply",
        "→ replies → resolve",
        "git reset --soft",
        "viewerCanReply viewerCanResolve",
        "--paginate",
        "## Critical Stance",
        "## Post-Review Fix Protocol",
    ],
}

FORBIDDEN = [
    r"printenv CLAUDE_EFFORT",
    r"AskUserQuestion",
    r"\bagent\(\)",
    r"Agent tool",
    r"claude-(haiku|sonnet|opus|fable)",
    r"wave-launch\.mjs",
    r"claude-wave-adapter\.md",
    r"ScheduleWakeup",
    r"resumeFromRunId",
]

FM_VERSION = re.compile(r"^metadata:[ \t]*\n(?:[ \t]+.*\n)*?  version: *(\S+)[ \t]*$", re.M)


def norm(text):
    return re.sub(r"\s+", " ", text).strip()


def frontmatter(text):
    """Return the text between the first two '---' lines, or None."""
    lines = text.split("\n")
    if not lines or lines[0].rstrip() != "---":
        return None
    for i in range(1, len(lines)):
        if lines[i].rstrip() == "---":
            return "\n".join(lines[1:i]) + "\n"
    return None


def fm_version(fm):
    m = FM_VERSION.search(fm or "")
    return m.group(1) if m else None


def line_of(text, pos):
    return text.count("\n", 0, pos) + 1


def check_frontmatter(kind, claude, codex, fails):
    cfm = frontmatter(codex)
    if cfm is None:
        fails.append(("frontmatter", "Codex file has no leading --- frontmatter block"))
        return
    if not re.search(r"^name: *%s[ \t]*$" % re.escape(kind), cfm, re.M):
        fails.append(("frontmatter", "missing `name: %s`" % kind))
    cv = fm_version(cfm)
    if cv is None or not re.match(r"^\d+\.\d+\.\d+$", cv):
        fails.append(("frontmatter", "missing `  version: X.Y.Z` under metadata:"))
        return
    lv = fm_version(frontmatter(claude))
    if lv != cv:
        fails.append(("frontmatter", "version %s differs from Claude file version %s" % (cv, lv)))


def check_phrases(kind, claude, codex, fails):
    nc, nx = norm(claude), norm(codex)
    for phrase in PHRASES[kind]:
        if phrase not in nc:
            fails.append(("shared-phrase", "missing %r in Claude file" % phrase))
        if phrase not in nx:
            fails.append(("shared-phrase", "missing %r in Codex file" % phrase))


def check_rules(kind, codex, fails):
    if not re.search(r"^## Codex session rules[ \t]*$", codex, re.M):
        fails.append(("session-rules", "missing line `## Codex session rules`"))
    nx = norm(codex)
    count = 4 if kind == "critical-review" else 6
    for n in range(1, count + 1):
        if ("%d. %s" % (n, RULES[n - 1])) not in nx:
            fails.append(("session-rules", "rule %d missing or altered" % n))


def check_single_task(kind, codex, fails):
    if kind not in ("multi-model", "super-plan"):
        return
    if not re.search(r"^### Single-task path[ \t]*$", codex, re.M):
        fails.append(("single-task-path", "missing line `### Single-task path`"))
    if "the runner's preflight probes every" not in norm(codex):
        fails.append(("single-task-path", "missing phrase `the runner's preflight probes every`"))


def check_forbidden(codex, fails):
    for pat in FORBIDDEN:
        for m in re.finditer(pat, codex):
            fails.append(("forbidden", "pattern %r matches at line %d" % (pat, line_of(codex, m.start()))))


def link_targets(codex):
    out = []
    for m in re.finditer(r"\]\(([^)]*)\)", codex):
        t = m.group(1).strip()
        if t.startswith(("http", "#", "mailto:")):
            continue
        out.append((t, line_of(codex, m.start())))
    for m in re.finditer(r"(?<!`)`([^`\n]+)`(?!`)", codex):
        t = m.group(1)
        if re.search(r"\s", t):
            continue
        if t.startswith("../") or t.startswith("references/"):
            out.append((t, line_of(codex, m.start())))
    return out


def check_links(codex_path, codex, fails):
    base = os.path.dirname(os.path.abspath(codex_path))
    for target, line in link_targets(codex):
        if any(c in target for c in "<>*$"):
            continue
        t = target.split("#", 1)[0]
        t = re.sub(r":\d+(-\d+)?$", "", t)
        if not t:
            continue
        if not os.path.exists(os.path.join(base, t)):
            fails.append(("links", "%r (line %d) does not resolve" % (target, line)))


def check_yaml(codex, fails):
    fm = frontmatter(codex)
    if fm is None:
        return
    if not shutil.which("ruby"):
        print("SKIP yaml: ruby not found")
        return
    r = subprocess.run(["ruby", "-ryaml", "-e", "YAML.safe_load(STDIN.read)"],
                       input=fm, capture_output=True, text=True)
    if r.returncode != 0:
        fails.append(("yaml", "frontmatter does not load: %s" % (r.stderr.strip().splitlines() or ["error"])[0]))


def check_plan_example(codex, fails):
    starts = len(re.findall(r"^   ```json wave-plan[ \t]*\r?$", codex, re.M))
    blocks = list(re.finditer(r"^   ```json wave-plan\r?\n(.*?)^   ```\r?$", codex, re.M | re.S))
    if starts != 1 or len(blocks) != 1:
        fails.append(("plan-example", "expected exactly one `json wave-plan` example block, found %d start(s) and %d block(s)" % (starts, len(blocks))))
        return
    body = re.sub(r"^   ", "", blocks[0].group(1), flags=re.M).rstrip()
    try:
        plan = json.loads(body)
        tasks = [t for w in plan["waves"] for t in w["tasks"]]
        prose = "\n".join("## Task %s\n\nExample task context.\n" % t["id"] for t in tasks)
    except (ValueError, KeyError, TypeError) as e:
        fails.append(("plan-example", "example block is not a readable plan: %s" % e))
        return
    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    lint = os.path.join(repo, "plugins/orchestration/skills/super-plan/references/plan-lint.mjs")
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "plan.md")
        with open(p, "w") as f:
            f.write("status: draft\nbase: pending\n\n```json wave-plan\n"
                    + json.dumps(plan, indent=2) + "\n```\n\n" + prose)
        r = subprocess.run(["node", lint, p], capture_output=True, text=True)
    out = r.stdout + r.stderr
    if "OK: 0 error(s)" not in out:
        fails.append(("plan-example", "plan-lint did not report OK: 0 error(s):\n" + out.rstrip()))


def main(argv):
    if len(argv) != 4 or argv[3] not in KINDS:
        sys.stderr.write("usage: codex-skill-check.py <claude SKILL.md> <codex SKILL.md> <%s>\n" % "|".join(KINDS))
        return 2
    claude_path, codex_path, kind = argv[1:]
    for p in (claude_path, codex_path):
        if not os.path.isfile(p):
            sys.stderr.write("missing file: %s\n" % p)
            return 2
    claude = skill_text(claude_path)
    codex = skill_text(codex_path)

    fails = []
    if os.path.realpath(claude_path) == os.path.realpath(codex_path):
        fails.append(("same-file", "both paths resolve to %s" % os.path.realpath(codex_path)))
    check_frontmatter(kind, claude, codex, fails)
    check_phrases(kind, claude, codex, fails)
    check_rules(kind, codex, fails)
    check_single_task(kind, codex, fails)
    check_forbidden(codex, fails)
    check_links(codex_path, codex, fails)
    if not len(codex.splitlines()) < len(claude.splitlines()):
        fails.append(("smaller", "Codex file has %d lines, Claude file has %d" % (len(codex.splitlines()), len(claude.splitlines()))))
    if kind != "critical-review" and "codex-routing.md" not in codex:
        fails.append(("routing", "Codex file does not contain `codex-routing.md`"))
    if re.search(r"kent|respawn", codex, re.I):
        fails.append(("banned-words", "Codex file matches kent|respawn"))
    check_yaml(codex, fails)
    if kind == "super-plan":
        check_plan_example(codex, fails)

    for check, detail in fails:
        print("FAIL %s: %s" % (check, detail))
    if not fails:
        print("OK %s" % kind)
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
