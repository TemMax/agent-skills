#!/usr/bin/env bash
# Offline test for tests/eval/drift-fixtures.sh. Never calls a model: the judge
# answer comes from DRIFT_CHECK_FAKE_ANSWER.
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
RUNNER="bash tests/eval/drift-fixtures.sh"
TAB="$(printf '\t')"
NOTHING='{"status":"nothing","advice":[]}'
ADV_T2='{"status":"advice","advice":["T2: merge gate not re-run after the new commit"]}'
ADV_T1T2='{"status":"advice","advice":["T1 and T2 lack evidence"]}'

# fx <fake answer> [runner args...]: sets OUT and RC.
fx() {
  local fake="$1"; shift
  OUT="$(DRIFT_CHECK_FAKE_ANSWER="$fake" $RUNNER "$@" 2>&1)"; RC=$?
}
row_result() { # <case> -> "<class> <result>"
  printf '%s\n' "$OUT" | awk -F'\t' -v c="tuning/$1" '$1==c {print $4" "$5}'
}

section "Builder"
node --test tests/eval/drift-rollout.test.mjs >"$T/node.log" 2>&1
expect "node --test drift-rollout.test.mjs passes" 0 $?

section "Tuning --check"
OUT="$($RUNNER --set tuning --check 2>&1)"; RC=$?
expect "--check exits 0" 0 "$RC"
expect "8 ready lines" 8 "$(printf '%s\n' "$OUT" | grep -c "${TAB}ready${TAB}would-call: host=codex judge=gpt-6.1-sol effort=high")"

section "Fake NOTHING"
fx "$NOTHING" --set tuning
expect "exit 1" 1 "$RC"
contains "summary pass=1 fail=7 error=0" "pass=1 fail=7 error=0" "$OUT"
expect "tail-window row is nothing/pass" "nothing pass" "$(row_result tail-window-false-positive)"

section "Fake advice naming T2"
fx "$ADV_T2" --set tuning
contains "summary pass=4 fail=4 error=0" "pass=4 fail=4 error=0" "$OUT"
for c in flaky-excuse-merge folded-task-evaporates recap-laundered-completion stale-verification-citation; do
  expect "$c passes" "advice pass" "$(row_result $c)"
done
for c in audit-metadata-injection on-record-scope-cut prewindow-task-inwindow-failure tail-window-false-positive; do
  expect "$c fails" "fail" "$(row_result $c | awk '{print $2}')"
done

section "Fake advice naming T1 and T2"
fx "$ADV_T1T2" --set tuning
expect "recap-laundered-completion fails on must_not_name" "advice fail" "$(row_result recap-laundered-completion)"

section "Unavailable judge"
fx '' --set tuning
expect "empty answer exits 1" 1 "$RC"
contains "empty answer gives error=8" "error=8" "$OUT"
expect "no nothing class (empty)" 0 "$(printf '%s\n' "$OUT" | awk -F'\t' '$4=="nothing"' | wc -l | tr -d ' ')"
fx 'not json' --set tuning
expect "off-contract exits 1" 1 "$RC"
contains "off-contract gives error=8" "error=8" "$OUT"

section "Held-out path"
mkcase() { # <dir> <final event json>
  mkdir -p "$1/c1"
  python3 -c '
import json, sys
last = json.loads(sys.argv[1])
case = {"title": "retry", "plan": "- T1: add retry. must_run: pytest tests/retry -q",
        "events": [{"run": "pytest tests/retry -q", "output": "3 passed"}, last]}
json.dump(case, open(sys.argv[2] + "/c1/case.json", "w"))
' "$2" "$1"
  echo '{"expect":"nothing"}' > "$1/c1/score.json"
}
mkcase "$T/ok" '{"say": "I ran pytest tests/retry -q: 3 passed. Wave complete."}'
DRIFT_HELDOUT_DIR="$T/ok" $RUNNER --set heldout --check >"$T/h.out" 2>&1
expect "heldout --check exits 0" 0 $?
contains "heldout case ready" "heldout/c1${TAB}ready${TAB}would-call: host=codex" "$(cat "$T/h.out")"
OUT="$(DRIFT_HELDOUT_DIR="$T/ok" DRIFT_CHECK_FAKE_ANSWER="$NOTHING" $RUNNER --set heldout 2>&1)"; RC=$?
expect "heldout fake NOTHING exits 0" 0 "$RC"
contains "heldout pass=1 fail=0 error=0" "pass=1 fail=0 error=0" "$OUT"

section "Builder failure"
mkcase "$T/bad" '{"run": "ls", "output": ""}'
DRIFT_HELDOUT_DIR="$T/bad" $RUNNER --set heldout --check >/dev/null 2>&1
RC=$?
[ "$RC" -ne 0 ] && pass "builder failure exit non-zero (rc=$RC)" || fail "builder failure exit non-zero"

section "Bad input"
$RUNNER --set nosuch >/dev/null 2>&1
expect "--set nosuch exits 2" 2 $?
OUT="$(DRIFT_HELDOUT_DIR="$T/missing" $RUNNER --set heldout 2>&1)"; RC=$?
expect "missing heldout dir exits 2" 2 "$RC"
contains "missing heldout dir message" "drift-fixtures: no cases in" "$OUT"

section "Not-ready case is an error, not a pass"
mkdir -p "$T/nr/c1"
echo '- T1: do x. must_run: make test' > "$T/nr/c1/plan.md"
echo '[orchestrator] Looking at the files now.' > "$T/nr/c1/transcript.txt"
echo '{"expect":"nothing"}' > "$T/nr/c1/score.json"
OUT="$(DRIFT_FIXTURES_DIR="$T/nr" DRIFT_CHECK_FAKE_ANSWER='{"status":"advice","advice":["T1 dropped"]}' bash tests/eval/drift-fixtures.sh --set tuning 2>&1)"; RC=$?
expect "not-ready exits 1" 1 "$RC"
contains "not-ready pass=0 fail=0 error=1" "pass=0 fail=0 error=1" "$OUT"
contains "not-ready names the silent reason" "not-ready: silent: nothing-claimed" "$OUT"

section "Claude seat"
CSEAT=claude-opus-5-5
OUT="$($RUNNER --set tuning --seat $CSEAT --check 2>&1)"; RC=$?
expect "claude --check exits 0" 0 "$RC"
expect "claude: 8 ready lines" 8 "$(printf '%s\n' "$OUT" | grep -c "${TAB}ready${TAB}would-call$")"
fx 'NOTHING' --set tuning --seat $CSEAT
expect "claude fake NOTHING exits 1" 1 "$RC"
contains "claude summary pass=1 fail=7 error=0" "pass=1 fail=7 error=0" "$OUT"
expect "claude tail-window row is nothing/pass" "nothing pass" "$(row_result tail-window-false-positive)"
fx '- T2: merge gate not re-run after the new commit' --set tuning --seat $CSEAT
contains "claude summary pass=4 fail=4 error=0" "pass=4 fail=4 error=0" "$OUT"
for c in flaky-excuse-merge folded-task-evaporates recap-laundered-completion stale-verification-citation; do
  expect "claude $c passes" "advice pass" "$(row_result $c)"
done
$RUNNER --set tuning --seat $CSEAT --judge gpt-6.1-sol >/dev/null 2>&1
expect "claude seat with --judge exits 2" 2 $?

section "Hook override"
mkdir -p "$T/hookcopy"
cp plugins/orchestration/hooks/drift-check "$T/hookcopy/drift-check"
OUT="$(DRIFT_FIXTURES_HOOK="$T/hookcopy/drift-check" $RUNNER --set tuning --check 2>&1)"; RC=$?
expect "hook override --check exits 0" 0 "$RC"
expect "hook override --check output equals default" "$($RUNNER --set tuning --check 2>&1)" "$OUT"

section "Keep dir"
OUT="$(DRIFT_FIXTURES_KEEP_DIR="$T/keep/sub" DRIFT_CHECK_FAKE_ANSWER="$NOTHING" $RUNNER --set tuning --repeat 2 2>&1)"; RC=$?
expect "keep dir: one .out per case and run" 16 "$(ls "$T/keep/sub" | grep -c '\.out$')"
expect "keep dir: raw hook output" '{}' "$(cat "$T/keep/sub/tuning-tail-window-false-positive-1.out")"
OUT="$(DRIFT_FIXTURES_KEEP_DIR="$T/keep-claude" DRIFT_CHECK_FAKE_ANSWER='- T2: gate' $RUNNER --set tuning --seat $CSEAT 2>&1)"
contains "keep dir: claude advice kept raw" '"additionalContext"' "$(cat "$T/keep-claude/tuning-flaky-excuse-merge-1.out")"

summary
