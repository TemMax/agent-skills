#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

export PYTHONDONTWRITEBYTECODE=1
CHECK=tests/lib/codex-skill-check.py
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

claude_for() {
  case "$1" in
    critical-review) echo plugins/code-review/skills/critical-review/SKILL.md ;;
    *) echo "plugins/orchestration/skills/$1/SKILL.md" ;;
  esac
}

# Build a synthetic Codex file for <kind> with one <mutation>; print its path.
mk() {
  python3 - "$T" "$1" "$2" "$(claude_for "$1")" "$CHECK" <<'PY'
import importlib.util, json, os, re, sys
root, kind, mut, claude_path, check = sys.argv[1:]
spec = importlib.util.spec_from_file_location("chk", check)
chk = importlib.util.module_from_spec(spec); spec.loader.exec_module(chk)
claude = chk.skill_text(claude_path)
version = chk.fm_version(chk.frontmatter(claude))
d = os.path.join(root, kind, mut, "codex")
os.makedirs(d, exist_ok=True)
open(os.path.join(root, kind, mut, "ref.md"), "w").write("ref\n")

phrases = list(chk.PHRASES[kind])
rules = list(enumerate(chk.RULES[: 4 if kind == "critical-review" else 6], 1))
fm_version = "0.0.1" if mut == "frontmatter" else version
desc = "a: b: c" if mut == "yaml" else "synthetic"
out = ["---", "name: " + kind, "description: " + desc, "metadata:", "  version: " + fm_version, "---", "", "# " + kind, ""]
if mut == "shared-phrase":
    phrases = phrases[1:]
out += [p for p in phrases]
out += ["", "See [ref](../ref.md)."]
if kind in ("multi-model", "super-plan", "ship") and mut != "routing":
    out.append("Routing is in codex-routing.md.")
out += ["", "## Codex session rules", ""]
for n, r in rules:
    if mut == "session-rules" and n == 4:
        continue
    out.append("%d. %s" % (n, r))
if kind in ("multi-model", "super-plan") and mut != "single-task-path":
    out += ["", "### Single-task path", "", "the runner's preflight probes every thing."]
if kind == "super-plan":
    task = {"id": "a", "branch": "wave/a",
            "executor": {"model": "gpt-6-luna", "effort": "medium"}, "ladder": [],
            "contract": {"files_allowed": ["src/**"], "files_forbidden": [],
                         "must_run": [{"cmd": "true", "evidence": "required"}],
                         "forbidden_moves": ["weakening, deleting or skipping an existing test"],
                         "report_must_answer": ["What changed?"]}}
    if mut == "plan-example":
        del task["contract"]["files_allowed"]
    plan = {"waves": [{"wave": 1, "supervisor": {"model": "gpt-6.1-sol", "effort": "high"}, "tasks": [task]}],
            "ci": "none: the repository has no CI at all",
            "e2e": "not-applicable: nothing here transforms data"}
    out += ["", "   ```json wave-plan"] + ["   " + l for l in json.dumps(plan, indent=2).split("\n")] + ["   ```"]
if mut == "forbidden":
    out.append("Use AskUserQuestion here.")
if mut == "links":
    out.append("Broken [x](../missing.md).")
if mut == "banned-words":
    out.append("Respawn it.")
if mut == "smaller":
    out += ["pad"] * (len(claude.splitlines()) + 5)
open(os.path.join(d, "SKILL.md"), "w").write("\n".join(out) + "\n")
print(os.path.join(d, "SKILL.md"))
PY
}

# run_case <name> <expected rc> <expected output substring or ""> <check args...>
run_case() {
  local name="$1" erc="$2" sub="$3"; shift 3
  local out rc
  out="$(python3 "$CHECK" "$@" 2>&1)"; rc=$?
  if [ "$rc" -ne "$erc" ]; then fail "$name" "expected exit $erc, got $rc: ${out:0:300}"; return; fi
  if [ -n "$sub" ]; then
    case "$out" in *"$sub"*) pass "$name" ;; *) fail "$name" "'$sub' not in: ${out:0:300}" ;; esac
  else
    pass "$name"
  fi
}

section "valid synthetic Codex file passes against the real Claude file"
for k in multi-model super-plan ship critical-review; do
  run_case "$k: valid fixture exits 0" 0 "OK $k" "$(claude_for $k)" "$(mk $k valid)" "$k"
done

section "one failing fixture per check (each fails on purpose)"
fail_case() { # <check> <kind> <mutation>
  run_case "$1: $2 fixture fails with FAIL $1" 1 "FAIL $1:" "$(claude_for $2)" "$(mk $2 $3)" "$2"
}
CM="$(claude_for multi-model)"
run_case "same-file: Claude file as its own Codex file" 1 "FAIL same-file:" "$CM" "$CM" multi-model
fail_case frontmatter multi-model frontmatter
fail_case shared-phrase ship shared-phrase
fail_case session-rules multi-model session-rules
fail_case single-task-path multi-model single-task-path
fail_case forbidden ship forbidden
fail_case links ship links
fail_case smaller ship smaller
fail_case routing ship routing
fail_case banned-words ship banned-words
if command -v ruby >/dev/null 2>&1; then
  fail_case yaml ship yaml
else
  printf '  SKIP  yaml fixture (ruby not found)\n'
fi
fail_case plan-example super-plan plan-example

section "usage errors exit 2"
V="$(mk ship valid)"
run_case "no arguments" 2 "" 
run_case "two arguments" 2 "" "$CM" "$V"
run_case "unknown kind" 2 "" "$CM" "$V" bogus
run_case "missing file" 2 "" "$CM" "$T/nope.md" ship

summary
