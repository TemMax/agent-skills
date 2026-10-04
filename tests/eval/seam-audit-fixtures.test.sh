#!/usr/bin/env bash
# Offline test for tests/eval/seam-audit-fixtures.sh. Never calls a model: the
# auditor's answer comes from SEAM_FIXTURES_FAKE_ANSWER.
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
RUNNER="bash tests/eval/seam-audit-fixtures.sh"
TAB="$(printf '\t')"

mkplan() { # <dir> <task id>
  mkdir -p "$1"
  cat > "$1/plan.md" <<PLAN
status: draft
base: pending

# Plan

\`\`\`json wave-plan
{
 "ci": "none: fixture repo has no CI",
 "e2e": "not-applicable: tiny fixture repository",
 "waves": [
  {
   "wave": 1,
   "supervisor": { "model": "claude-opus-5", "effort": "high" },
   "tasks": [
    {
     "id": "$2",
     "branch": "wave/$2",
     "executor": { "model": "claude-sonnet-5-5", "effort": "medium" },
     "ladder": [],
     "contract": {
      "files_allowed": ["src/mod.py"],
      "files_forbidden": [],
      "must_run": [{ "cmd": "python3 -B -m unittest tests.test_mod", "evidence": "required" }],
      "forbidden_moves": ["running a live model call"],
      "report_must_answer": ["What changed?"]
     }
    }
   ]
  }
 ]
}
\`\`\`

## Task $2

Change src/mod.py.
PLAN
}
mkfixture() { # <root> <name> <score json>
  local d="$1/$2"
  mkplan "$d" "$2"
  mkdir -p "$d/repo/src" "$d/repo/tests"
  printf 'VALUE = 1\n' > "$d/repo/src/mod.py"
  touch "$d/repo/src/__init__.py" "$d/repo/tests/__init__.py"
  printf 'import unittest\nfrom src.mod import VALUE\n\nclass T(unittest.TestCase):\n    def test_v(self):\n        self.assertEqual(VALUE, 1)\n' > "$d/repo/tests/test_mod.py"
  printf '%s\n' "$3" > "$d/score.json"
}

FX="$T/fx"
mkfixture "$FX" defect-one '{"expect": "defect", "check": "same-task-readers", "must_name": ["test_summary", "FakeStore"], "must_not_name": ["decoy-file"]}'
mkfixture "$FX" clean-one '{"expect": "clean", "check": "none", "must_name": [], "must_not_name": ["decoy-file"]}'

answer() { # <file> <blocking json array>
  printf 'Analysis text.\n\n```json seam-verdict\n{"blocking": %s, "notes": ["n"]}\n```\n' "$2" > "$1"
}
# run <answer file> [runner args...]: sets OUT, RC.
run() {
  local f="$1"; shift
  OUT="$(SEAM_FIXTURES_DIR="$FX" SEAM_FIXTURES_FAKE_ANSWER="$f" $RUNNER "$@" 2>&1)"; RC=$?
}
verdict_of() { # <fixture> -> pass|fail|error
  printf '%s\n' "$OUT" | awk -F'\t' -v c="$1" '$1==c {print $5}'
}
detail_of() { printf '%s\n' "$OUT" | awk -F'\t' -v c="$1" '$1==c {print $6}'; }

section "Defect fixture"
answer "$T/a-both" '[{"check":"same-task-readers","summary":"test_summary breaks","evidence":"FakeStore raises"}]'
run "$T/a-both" --only defect-one
expect "all must_name named -> pass" pass "$(verdict_of defect-one)"
expect "exit 0 after a completed run" 0 "$RC"
contains "totals line" "pass=1 fail=0 error=0" "$OUT"
contains "row carries provider and default model" "defect-one${TAB}claude${TAB}claude-sonnet-5-5${TAB}1${TAB}pass" "$OUT"
answer "$T/a-one" '[{"check":"same-task-readers","summary":"TEST_SUMMARY breaks","evidence":"x"}]'
run "$T/a-one" --only defect-one
expect "one must_name missing -> fail" fail "$(verdict_of defect-one)"
contains "detail names the missing string" "FakeStore" "$(detail_of defect-one)"
expect "a failed fixture still exits 0" 0 "$RC"
answer "$T/a-empty" '[]'
run "$T/a-empty" --only defect-one
expect "empty blocking on a defect -> fail" fail "$(verdict_of defect-one)"
answer "$T/a-decoy" '[{"check":"x","summary":"test_summary FakeStore","evidence":"Decoy-File"}]'
run "$T/a-decoy" --only defect-one
expect "must_not_name hit -> fail" fail "$(verdict_of defect-one)"
contains "detail names the matched decoy" "decoy-file" "$(detail_of defect-one)"

section "Clean fixture"
run "$T/a-empty" --only clean-one
expect "empty blocking on a clean plan -> pass" pass "$(verdict_of clean-one)"
run "$T/a-one" --only clean-one
expect "one blocking entry on a clean plan -> fail" fail "$(verdict_of clean-one)"
contains "detail names the unexpected entry" "unexpected blocking entry" "$(detail_of clean-one)"

section "Missing or broken verdict"
printf 'I found nothing wrong.\n' > "$T/a-none"
run "$T/a-none" --only clean-one
expect "no seam-verdict block -> error" error "$(verdict_of clean-one)"
contains "totals count the error" "pass=0 fail=0 error=1" "$OUT"
printf '```json seam-verdict\n{not json\n```\n' > "$T/a-bad"
run "$T/a-bad" --only clean-one
expect "unparseable block -> error" error "$(verdict_of clean-one)"
printf '```json\n{"blocking": []}\n```\n' > "$T/a-plain"
run "$T/a-plain" --only clean-one
expect "a plain json block is not a verdict -> error" error "$(verdict_of clean-one)"

section "Repeat, results file and kept evidence"
RES="$T/results.tsv"
KEEP="$T/keep"
OUT="$(SEAM_FIXTURES_DIR="$FX" SEAM_FIXTURES_FAKE_ANSWER="$T/a-empty" SEAM_FIXTURES_RESULTS="$RES" SEAM_FIXTURES_KEEP_DIR="$KEEP" $RUNNER --repeat 2 2>&1)"; RC=$?
expect "full run exits 0" 0 "$RC"
contains "2 fixtures x 2 reps: pass=2 fail=2" "pass=2 fail=2 error=0" "$OUT"
expect "results file holds 4 rows" 4 "$(wc -l < "$RES" | tr -d ' ')"
check "kept prompt and answer per run" "test -f '$KEEP/clean-one-2/prompt.md' && test -f '$KEEP/defect-one-1/answer.md'"
contains "prompt names the plan outside the repo" "/plan.md against the repository at " "$(cat "$KEEP/clean-one-1/prompt.md")"
contains "prompt asks for the verdict block" 'json seam-verdict' "$(cat "$KEEP/clean-one-1/prompt.md")"

section "Skill text per provider"
rm -rf "$KEEP"
SEAM_FIXTURES_DIR="$FX" SEAM_FIXTURES_FAKE_ANSWER="$T/a-empty" SEAM_FIXTURES_KEEP_DIR="$KEEP/claude" $RUNNER --only clean-one >/dev/null 2>&1
SEAM_FIXTURES_DIR="$FX" SEAM_FIXTURES_FAKE_ANSWER="$T/a-empty" SEAM_FIXTURES_KEEP_DIR="$KEEP/codex" $RUNNER --provider codex --only clean-one >/dev/null 2>&1
step() { awk '/^5\. \*\*Seam audit\.\*\*/ {on=1} /^6\. \*\*Lint\.\*\*/ {on=0} on' "$1"; }
CL_STEP="$(step plugins/orchestration/skills/super-plan/SKILL.md)"
CX_STEP="$(step plugins/orchestration/skills-codex/super-plan/SKILL.md)"
if [ -n "$CL_STEP" ] && [ "$CL_STEP" != "$CX_STEP" ]; then pass "the two skill steps are non-empty and differ"; else fail "the two skill steps are non-empty and differ"; fi
contains "claude prompt holds the skills step" "$CL_STEP" "$(cat "$KEEP/claude/clean-one-1/prompt.md")"
contains "codex prompt holds the skills-codex step" "$CX_STEP" "$(cat "$KEEP/codex/clean-one-1/prompt.md")"
case "$(cat "$KEEP/claude/clean-one-1/prompt.md")" in *"$CX_STEP"*) fail "claude prompt must not hold the codex step" ;; *) pass "claude prompt lacks the codex step" ;; esac
case "$(cat "$KEEP/codex/clean-one-1/prompt.md")" in *"$CL_STEP"*) fail "codex prompt must not hold the claude step" ;; *) pass "codex prompt lacks the claude step" ;; esac
run "$T/a-empty" --provider codex --only clean-one
contains "codex default model" "clean-one${TAB}codex${TAB}gpt-6.1-sol${TAB}1${TAB}pass" "$OUT"
run "$T/a-empty" --model m-x --only clean-one
contains "--model overrides" "clean-one${TAB}claude${TAB}m-x${TAB}1" "$OUT"

section "--check"
OUT="$(SEAM_FIXTURES_DIR="$FX" $RUNNER --check 2>&1)"; RC=$?
expect "good fixtures: exit 0" 0 "$RC"
contains "PASS defect-one" "PASS defect-one" "$OUT"
contains "PASS clean-one" "PASS clean-one" "$OUT"
BADFX="$T/bad"
mkfixture "$BADFX" bad-score '{"expect": "defect", "check": "same-task-readers", "must_name": [], "must_not_name": []}'
mkfixture "$BADFX" bad-lint '{"expect": "clean", "check": "none", "must_name": [], "must_not_name": []}'
sed -i.bak 's/claude-sonnet-5-5/sonnet/' "$BADFX/bad-lint/plan.md"; rm -f "$BADFX/bad-lint/plan.md.bak"
mkfixture "$BADFX" good '{"expect": "clean", "check": "none", "must_name": [], "must_not_name": []}'
OUT="$(SEAM_FIXTURES_DIR="$BADFX" $RUNNER --check 2>&1)"; RC=$?
expect "bad fixtures: exit 1" 1 "$RC"
contains "invalid score.json fails" "FAIL bad-score: score.json invalid" "$OUT"
contains "lint error fails" "FAIL bad-lint: plan.md not lint-clean" "$OUT"
contains "good fixture still passes" "PASS good" "$OUT"
mkfixture "$T/empty" e1 '{"expect": "clean", "check": "none", "must_name": [], "must_not_name": []}'
rm -rf "$T/empty/e1/repo"; mkdir "$T/empty/e1/repo"
OUT="$(SEAM_FIXTURES_DIR="$T/empty" $RUNNER --check 2>&1)"; RC=$?
expect "empty repo: exit 1" 1 "$RC"
contains "empty repo reported" "FAIL e1: repo/ missing or empty" "$OUT"

section "Usage errors"
for args in "--bogus" "--provider other" "--provider" "--repeat 0" "--repeat x" "--only nope" "--effort"; do
  SEAM_FIXTURES_DIR="$FX" $RUNNER $args >/dev/null 2>&1
  expect "'$args' exits 2" 2 "$?"
done
contains "usage text on stderr" "usage: bash tests/eval/seam-audit-fixtures.sh" "$($RUNNER --bogus 2>&1)"

summary
