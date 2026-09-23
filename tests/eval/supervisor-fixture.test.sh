#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
R="$W/repo"; mkdir -p "$R/src" "$R/tests"
command cp tests/eval/fixtures/supervisor/contract-check.py "$R/contract-check.py"
printf 'def value():\n    return 1\n' > "$R/src/sample.py"
touch "$R/src/__init__.py" "$R/tests/__init__.py"
cat > "$R/tests/test_sample.py" <<'PY'
import unittest

from src.sample import value


class TestSample(unittest.TestCase):
    def test_first(self):
        self.assertEqual(value(), 1)

    def test_second(self):
        self.assertGreater(value(), 0)
PY

section "Deterministic supervisor verifier"
set +e
success_output="$(cd "$R" && python3 -B contract-check.py 2> "$W/success.stderr")"
success_rc=$?
set -e
expect "successful verifier exits zero" "0" "$success_rc"
expect "successful verifier emits stable evidence" "PASS 2" "$success_output"
expect "successful verifier emits no variable stderr" "" "$(cat "$W/success.stderr")"

printf 'def value():\n    return 0\n' > "$R/src/sample.py"
set +e
failure_output="$(cd "$R" && python3 -B contract-check.py 2> "$W/failure.stderr")"
failure_rc=$?
set -e
expect "failing verifier exits nonzero" "1" "$failure_rc"
expect "failing verifier emits stable evidence" "FAIL 2" "$failure_output"
expect "failing verifier emits no variable stderr" "" "$(cat "$W/failure.stderr")"

section "Supervisor sandbox + repo-integrity helpers (offline, no model)"
SUPERVISOR_LIB_ONLY=1 . tests/eval/supervisor.sh

expect "claude path selects read-only" "read-only" "$(EVAL_PROVIDER=claude judge_sandbox)"
expect "unset provider defaults to claude's read-only" "read-only" "$(judge_sandbox)"
expect "codex path selects workspace-write" "workspace-write" "$(EVAL_PROVIDER=codex judge_sandbox)"

HW="$(mktemp -d)"
HR="$HW/repo"; mkdir -p "$HR"
printf 'value\n' > "$HR/tracked.txt"
git -C "$HR" init -q .
git -C "$HR" add -A
git -C "$HR" -c user.email=t@t -c user.name=t commit -q -m base
BASE="$(git -C "$HR" rev-parse HEAD)"
git -C "$HR" checkout -q -b wave/f1 "$BASE"
git -C "$HR" checkout -q -b wave/f2 "$BASE"
printf 'other\n' > "$HR/tracked.txt"
git -C "$HR" add -A
git -C "$HR" -c user.email=t@t -c user.name=t commit -q -m other
git -C "$HR" checkout -q "$BASE"

before="$(judge_snapshot "$HR")"
check "unmodified repo is not flagged" "! judge_repo_modified \"\$HR\" \"\$before\""

printf 'edited\n' > "$HR/tracked.txt"
check "a stub answer step editing a tracked file fires the modification check" "judge_repo_modified \"\$HR\" \"\$before\""
git -C "$HR" checkout -q -- tracked.txt

before2="$(judge_snapshot "$HR")"
git -C "$HR" branch -f wave/f1 wave/f2
check "a moved wave/f* ref fires the modification check" "judge_repo_modified \"\$HR\" \"\$before2\""

before3="$(judge_snapshot "$HR")"
git -C "$HR" checkout -q -b wave/new-branch "$BASE"
printf 'new\n' > "$HR/tracked.txt"
git -C "$HR" add -A
git -C "$HR" -c user.email=t@t -c user.name=t commit -q -m "new branch commit"
check "a commit on a newly created branch fires the modification check" "judge_repo_modified \"\$HR\" \"\$before3\""
git -C "$HR" checkout -q "$BASE"
git -C "$HR" branch -D wave/new-branch >/dev/null 2>&1

before4="$(judge_snapshot "$HR")"
check "an untouched repo is not flagged" "! judge_repo_modified \"\$HR\" \"\$before4\""

# judge_cleanup_worktrees: an extra worktree registered next to $HR (its
# normal "fresh checkout" location) is removed, and $HR's own worktree is
# kept — on a macOS /var temp path, where the porcelain listing's canonical
# form differs from a plain `pwd` of $HR/...
EXTRA="$HW/extra-worktree"
git -C "$HR" worktree add -q -b wave/extra "$EXTRA" "$BASE"
check "extra worktree exists before cleanup" "[ -d \"\$EXTRA\" ]"
judge_cleanup_worktrees "$HR"
check "extra worktree next to the repo is removed" "[ ! -d \"\$EXTRA\" ]"
check "the repo's own worktree is kept" "[ -d \"\$HR\" ] && git -C \"\$HR\" rev-parse HEAD >/dev/null 2>&1"
git -C "$HR" branch -D wave/extra >/dev/null 2>&1

rm -rf "$HW"

summary
