#!/usr/bin/env bash
# seam-audit — measures two stage C super-plan rules live: the Seam audit
# step (does a read-only pass catch a cross-task seam before execution) and
# Gate 2 message shows the wave shape and no time or cost estimate.
#
# SEAM_SKILL_ROOT points the whole tier at a skill checkout: the prompt uses
# ITS SKILL.md and the Lint step uses ITS plan-lint.mjs, so an older skill is
# linted by its own linter and this tier can compare before/after by pointing
# it at an older copy of the skill. Default: this repository's root.
#
# Usage:
#   bash tests/eval/seam-audit.sh
#   SEAM_SKILL_ROOT=/path/to/older/checkout bash tests/eval/seam-audit.sh
#   EVAL_REPEAT=3 bash tests/eval/seam-audit.sh
#   EVAL_KEEP_DIR=/tmp/evidence bash tests/eval/seam-audit.sh
#
# Offline scoring (no model call) for tests/eval/seam-audit.test.sh:
#   SEAM_AUDIT_SCORE_ONLY=1 bash tests/eval/seam-audit.sh <plan-file> <gate2-file>
#   -> prints one line: seam=pass|fail lint=pass|fail gate2=pass|fail
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh
. tests/eval/model-cli.sh

SEAM_SKILL_ROOT="${SEAM_SKILL_ROOT:-$(pwd)}"
SKILL="$SEAM_SKILL_ROOT/plugins/orchestration/skills/super-plan/SKILL.md"
LINT="$SEAM_SKILL_ROOT/plugins/orchestration/skills/super-plan/references/plan-lint.mjs"

if [ ! -f "$SKILL" ]; then
  printf 'seam-audit: SEAM_SKILL_ROOT (%s) has no plugins/orchestration/skills/super-plan/SKILL.md\n' "$SEAM_SKILL_ROOT" >&2
  exit 64
fi
if [ ! -f "$LINT" ]; then
  printf 'seam-audit: SEAM_SKILL_ROOT (%s) has no .../references/plan-lint.mjs\n' "$SEAM_SKILL_ROOT" >&2
  exit 64
fi

# ---------------------------------------------------------------------------
# Fixture repo — the same round-trip seam for every repetition and for the
# offline self-test's lint checks: format_row/render in src/report.py,
# parse_rows in tests/helpers.py, a round-trip test, and a real CI workflow
# whose job runs exactly `python -m unittest discover -s tests -t .`.

build_fixture_repo() {  # dest-dir
  local dest="$1"
  mkdir -p "$dest/src" "$dest/tests" "$dest/.github/workflows"
  cat > "$dest/src/report.py" <<'PY'
def format_row(name, value):
    return f"{name}: {value}"


def render(rows):
    return "\n".join(format_row(n, v) for n, v in rows)
PY
  cat > "$dest/tests/helpers.py" <<'PY'
def parse_rows(text):
    return [tuple(line.split(": ", 1)) for line in text.splitlines() if line]
PY
  cat > "$dest/tests/test_report.py" <<'PY'
import unittest

from src.report import render
from tests.helpers import parse_rows


class TestReport(unittest.TestCase):
    def test_round_trip(self):
        rows = [("alpha", "1"), ("beta", "2")]
        self.assertEqual(parse_rows(render(rows)), rows)
PY
  touch "$dest/src/__init__.py" "$dest/tests/__init__.py"
  cat > "$dest/.github/workflows/ci.yml" <<'YAML'
name: CI
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: python -m unittest discover -s tests -t .
YAML
}

# The seam: parse_rows splits on ": ", so changing format_row's separator
# breaks the round trip in both test files unless the same task also updates
# tests/helpers.py.
FEATURE_REQUEST="Two changes. (a) Change the row format produced by format_row in src/report.py from 'name: value' to 'name=value' — the new downstream importer requires '='. (b) Add src/summary.py with summarize(rows) returning the sum of the numeric values, plus tests/test_summary.py that renders rows with render() and parses them back with tests/helpers.parse_rows to check the round trip before summing."

# ---------------------------------------------------------------------------
# Scoring — pure functions over a plan file / Gate 2 text file, independent
# of any model call. Exercised offline by tests/eval/seam-audit.test.sh
# through the SEAM_AUDIT_SCORE_ONLY entry point below.

# seam — pass when, in the json wave-plan block, the task whose
# files_allowed covers src/report.py also covers tests/helpers.py (exact
# path or a matching glob such as tests/**), OR one task covers
# src/report.py, src/summary.py and tests/helpers.py together; AND the plan
# text mentions parse_rows or helpers.py. Glob coverage: ** matches any path
# suffix, * matches one path segment.
score_seam() {  # plan-file -> "pass"|"fail" on stdout; return code matches
  node -e '
const fs = require("fs")
const text = fs.readFileSync(process.argv[1], "utf8")
const m = text.match(/```json wave-plan\r?\n([\s\S]*?)\r?\n```/)
if (!m) { console.log("fail"); process.exit(1) }
let plan
try { plan = JSON.parse(m[1]) } catch (e) { console.log("fail"); process.exit(1) }
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => "\\" + c)
const globToRegex = (glob) => {
  let re = ""
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === "*" && glob[i + 1] === "*") { re += ".*"; i++ }
    else if (c === "*") { re += "[^/]*" }
    else { re += esc(c) }
  }
  return new RegExp("^" + re + "$")
}
const covers = (patterns, p) => Array.isArray(patterns)
  && patterns.some((pat) => typeof pat === "string" && globToRegex(pat).test(p))
const tasks = []
for (const w of (Array.isArray(plan.waves) ? plan.waves : [])) {
  for (const t of (Array.isArray(w.tasks) ? w.tasks : [])) tasks.push(t)
}
const filesAllowed = (t) => (t && t.contract && t.contract.files_allowed) || []
const formatOwnsHelper = tasks.some((t) =>
  covers(filesAllowed(t), "src/report.py") && covers(filesAllowed(t), "tests/helpers.py"))
const combinedTask = tasks.some((t) =>
  covers(filesAllowed(t), "src/report.py") && covers(filesAllowed(t), "src/summary.py")
  && covers(filesAllowed(t), "tests/helpers.py"))
const mentionsSeam = /parse_rows|helpers\.py/.test(text)
const ok = (formatOwnsHelper || combinedTask) && mentionsSeam
console.log(ok ? "pass" : "fail")
process.exit(ok ? 0 : 1)
' -- "$1"
}

# lint — the shipped linter from SEAM_SKILL_ROOT accepts the plan, run
# against a fresh copy of the fixture repo, exit 0.
score_lint() {  # plan-file -> "pass"|"fail" on stdout; return code matches
  local plan_file="$1" repo rc
  repo="$(mktemp -d)"
  build_fixture_repo "$repo"
  node "$LINT" "$plan_file" --repo "$repo" >/dev/null 2>&1
  rc=$?
  rm -rf "$repo"
  if [ "$rc" -eq 0 ]; then echo pass; return 0; else echo fail; return 1; fi
}

# gate2 — Gate 2 message shows the wave shape and no time or cost estimate:
# the text mentions waves and parallel work, and contains no duration or
# cost figure.
score_gate2() {  # gate2-file -> "pass"|"fail" on stdout; return code matches
  node -e '
const fs = require("fs")
const text = fs.readFileSync(process.argv[1], "utf8")
const hasWaves = /\bwaves?\b/i.test(text)
const hasParallel = /parallel/i.test(text)
const hasDuration = /\b[0-9]+([.,][0-9]+)?\s*(min|mins|minutes?|h|hrs?|hours?)\b/i.test(text)
  || /[0-9]\s*(мин|час)/i.test(text)
  || /\b(minutes|hours)\b/i.test(text)
const hasCost = /\$\s?[0-9]/.test(text)
  || /\b[0-9]+([.,][0-9]+)?\s*(usd|dollars?)\b/i.test(text)
const ok = hasWaves && hasParallel && !hasDuration && !hasCost
console.log(ok ? "pass" : "fail")
process.exit(ok ? 0 : 1)
' -- "$1"
}

if [ "${SEAM_AUDIT_SCORE_ONLY:-0}" = 1 ]; then
  plan_file="${1:?usage: SEAM_AUDIT_SCORE_ONLY=1 bash tests/eval/seam-audit.sh <plan-file> <gate2-file>}"
  gate2_file="${2:?usage: SEAM_AUDIT_SCORE_ONLY=1 bash tests/eval/seam-audit.sh <plan-file> <gate2-file>}"
  seam_result="$(score_seam "$plan_file")"
  lint_result="$(score_lint "$plan_file")"
  gate2_result="$(score_gate2 "$gate2_file")"
  printf 'seam=%s lint=%s gate2=%s\n' "$seam_result" "$lint_result" "$gate2_result"
  exit 0
fi

# ---------------------------------------------------------------------------
# Live tier — one independent planning run per EVAL_REPEAT repetition.

if [ "${EVAL_PROVIDER:-claude}" = codex ]; then
  MODEL="${EVAL_MODEL:-gpt-6-sol}"
else
  MODEL="${EVAL_MODEL:-claude-sonnet-5}"
fi
REPEAT="${EVAL_REPEAT:-1}"
case "$REPEAT" in ''|*[!0-9]*|0) printf 'seam-audit: EVAL_REPEAT must be a positive integer\n' >&2; exit 64 ;; esac

build_prompt() {  # repo-dir work-dir -> prompt text on stdout
  local repo="$1" work="$2"
  printf '%s' "$(cat "$SKILL")

EVAL MODE: you are running headless under an evaluation harness — apply the
skill's headless evaluation mode. The repository to plan against is at $repo
(explore it with your tools). Do not modify anything under $repo. Apply the
skill's Lint step for real: write your draft plan to $work/draft-plan.md, run
node $LINT $work/draft-plan.md --repo $repo, fix every error, and repeat
until it prints OK. Then print ONLY the final lint-clean plan file content
(markdown, all three layers), no prose before or after it. Do not wrap the
output in an outer code fence.

After the plan, print a line \`=== GATE 2 ===\` followed by exactly the
message you would show the user at Gate 2.

Feature request:
$FEATURE_REQUEST"
}

split_answer() {  # answer-file plan-out gate2-out
  : > "$2"; : > "$3"
  awk -v planfile="$2" -v gate2file="$3" '
    $0 == "=== GATE 2 ===" { found = 1; next }
    found { print > gate2file; next }
    { print > planfile }
  ' "$1"
}

KEEP_DIR="${EVAL_KEEP_DIR:-}"
[ -n "$KEEP_DIR" ] && mkdir -p "$KEEP_DIR"

for i in $(seq 1 "$REPEAT"); do
  section "seam-audit — repetition $i/$REPEAT"
  repo_work="$(mktemp -d)"
  repo="$repo_work/repo"
  mkdir -p "$repo"
  build_fixture_repo "$repo"
  if [ -n "$KEEP_DIR" ]; then
    out_dir="$KEEP_DIR/rep-$i"
    mkdir -p "$out_dir"
  else
    out_dir="$(mktemp -d)"
  fi
  prompt_file="$out_dir/prompt.md"
  answer_file="$out_dir/answer.md"
  plan_file="$out_dir/plan.md"
  gate2_file="$out_dir/gate2.txt"
  build_prompt "$repo" "$repo_work" > "$prompt_file"
  if EVAL_MODEL="$MODEL" eval_model "$repo" workspace-write "$prompt_file" "$answer_file"; then
    split_answer "$answer_file" "$plan_file" "$gate2_file"
    expect "seam audit catches the parse_rows/helpers.py seam (rep $i/$REPEAT)" "pass" "$(score_seam "$plan_file")"
    expect "plan passes the shipped linter (rep $i/$REPEAT)" "pass" "$(score_lint "$plan_file")"
    expect "Gate 2 message shows the wave shape and no time or cost estimate (rep $i/$REPEAT)" "pass" "$(score_gate2 "$gate2_file")"
  else
    fail "model invocation (rep $i/$REPEAT)" "eval_model exited nonzero"
    fail "seam audit catches the parse_rows/helpers.py seam (rep $i/$REPEAT)" "no answer to score"
    fail "plan passes the shipped linter (rep $i/$REPEAT)" "no answer to score"
    fail "Gate 2 message shows the wave shape and no time or cost estimate (rep $i/$REPEAT)" "no answer to score"
  fi
  rm -rf "$repo_work"
  if [ -z "$KEEP_DIR" ]; then rm -rf "$out_dir"; fi
done

summary
