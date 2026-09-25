#!/usr/bin/env bash
# Behaviour tier — does the SHIPPED launcher generator turn a lint-clean plan
# into a self-contained Workflow script whose runner text is byte-identical to
# the shipped runner, with the wave input embedded as one WAVE_ARGS line? And
# does every bad input fail with a reason and write nothing?
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tests/lib.sh

REFS=plugins/orchestration/skills/multi-model/references
GEN_TOOL=$REFS/wave-launch.mjs
RUNNER=$REFS/wave-runner.workflow.mjs
CLEAN=tests/fixtures/plans/clean.md
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

if ! command -v node >/dev/null 2>&1; then
  fail "node is required for this tier and was not found on PATH"
  summary; exit 1
fi

# mk_repo <dir> — a real git repo with one committed file (README.md) and a
# bare "origin" remote that already carries that commit on "main". The commit
# is built with fixed identity and dates, so every repo mk_repo builds has the
# exact same HEAD sha: a single $BASE constant is a pushed, ancestor-checkable
# base in every repo this file creates, unless a case deliberately adds an
# unpushed commit on top.
mk_repo() {
  local dir="$1"
  mkdir -p "$dir"
  git -C "$dir" init -q
  git -C "$dir" config user.name "wave-launch-test"
  git -C "$dir" config user.email "wave-launch-test@example.com"
  git -C "$dir" config commit.gpgsign false
  printf 'wave-launch test fixture\n' > "$dir/README.md"
  git -C "$dir" add README.md
  GIT_AUTHOR_NAME="wave-launch-test" GIT_AUTHOR_EMAIL="wave-launch-test@example.com" \
  GIT_AUTHOR_DATE="2020-01-01T00:00:00Z" GIT_COMMITTER_NAME="wave-launch-test" \
  GIT_COMMITTER_EMAIL="wave-launch-test@example.com" GIT_COMMITTER_DATE="2020-01-01T00:00:00Z" \
    git -C "$dir" commit -q -m "wave-launch test fixture"
  git init -q --bare "$dir.origin.git"
  git -C "$dir" remote add origin "$dir.origin.git"
  git -C "$dir" push -q origin HEAD:main
}

section "the generator ships"
check "wave-launch.mjs exists"            "[ -f $GEN_TOOL ]"
check "wave-launch.mjs is executable"     "[ -x $GEN_TOOL ]"
expect "node shebang on line 1" "#!/usr/bin/env node" "$(head -n 1 "$GEN_TOOL" 2>/dev/null)"

section "clean plan, default output path"
REPO="$W/repo"
mk_repo "$REPO"
BASE="$(git -C "$REPO" rev-parse HEAD)"
out="$(node "$GEN_TOOL" "$CLEAN" --wave 1 --base "$BASE" --repo "$REPO" --default-branch main 2>"$W/err")"; rc=$?
expect "exits 0" "0" "$rc"
GEN="$REPO/.worktrees/launch/wave-1.workflow.mjs"
expect "stdout is only the absolute generated path" "$GEN" "$out"
expect "stderr is empty" "" "$(cat "$W/err")"
check "the printed file exists" "[ -f '$GEN' ]"

section "runner text is untouched"
expect "shipped runner has no WAVE_ARGS line" "0" "$(grep -c '^const WAVE_ARGS = ' "$RUNNER")"
expect "exactly one WAVE_ARGS line inserted" "1" "$(grep -c '^const WAVE_ARGS = ' "$GEN" 2>/dev/null)"
meta_end="$(awk '/^export const meta = \{$/ { s = 1; next } s && /^}$/ { print NR; exit }' "$RUNNER")"
args_line="$(grep -n '^const WAVE_ARGS = ' "$GEN" 2>/dev/null | cut -d: -f1)"
expect "WAVE_ARGS sits on the line right after the meta literal" "$((meta_end + 1))" "$args_line"
if [ -n "$args_line" ] && sed "${args_line}d" "$GEN" | cmp -s - "$RUNNER"; then
  pass "generated file minus the WAVE_ARGS line is byte-identical to the shipped runner"
else
  fail "generated file minus the WAVE_ARGS line is byte-identical to the shipped runner"
fi
expect "exactly one export" "1" "$(grep -c '^export ' "$GEN" 2>/dev/null)"
expect "meta is the first line" "export const meta = {" "$(head -n 1 "$GEN" 2>/dev/null)"

section "the generated script runs from WAVE_ARGS alone (simulated, args undefined)"
if sim="$(node tests/lib/wave-launch.test.mjs "$GEN" "$CLEAN" "$BASE" "$REPO" 2>&1)"; then
  printf '%s\n' "$sim" | sed 's/^/    /'
  pass "simulated launch scenarios"
else
  printf '%s\n' "$sim" | sed 's/^/    /'
  fail "simulated launch scenarios (output above)"
fi

section "--out and --verifier"
OUT="$W/custom/launch.workflow.mjs"
out="$(node "$GEN_TOOL" "$CLEAN" --wave 1 --base "$BASE" --repo "$REPO" --default-branch main \
  --verifier claude-sonnet-5:low --out "$OUT" 2>/dev/null)"; rc=$?
expect "exits 0 with --out" "0" "$rc"
expect "prints the --out path" "$OUT" "$out"
contains "verifier is embedded" '"supervisor":{"model":"claude-fable-5-1","effort":"high"},"verifier":{"model":"claude-sonnet-5","effort":"low"},"worktree":{"links":[]},"tasks":' "$(grep '^const WAVE_ARGS = ' "$OUT" 2>/dev/null)"

section "each failure exits non-zero, explains itself on one line, writes nothing"
# $1 = name, $2 = expected stderr fragment, rest = generator arguments.
# All refuse() cases share one real, pushed repo (its base is $BASE) so the
# new pushed-base check passes for cases that are testing something else;
# --out still points at a fresh path each time.
REFUSE_REPO="$W/refuse-repo"
mk_repo "$REFUSE_REPO"
n=0
refuse() {
  local name="$1" frag="$2"; shift 2
  n=$((n + 1))
  local o="$W/fail-$n/out.workflow.mjs"
  local so rc_ se
  so="$(node "$GEN_TOOL" "$@" --repo "$REFUSE_REPO" --default-branch main 2>"$W/err")"; rc_=$?
  se="$(cat "$W/err")"
  check "$name: exits non-zero" "[ $rc_ -ne 0 ]"
  expect "$name: stdout empty" "" "$so"
  expect "$name: one-line reason on stderr" "1" "$(printf '%s\n' "$se" | grep -c .)"
  contains "$name: reason names the cause" "$frag" "$se"
  check "$name: nothing written under --repo" "[ ! -e '$REFUSE_REPO/.worktrees' ]"
  so="$(node "$GEN_TOOL" "$@" --repo "$REFUSE_REPO" --default-branch main --out "$o" 2>/dev/null)"; rc_=$?
  check "$name: exits non-zero with --out" "[ $rc_ -ne 0 ]"
  check "$name: nothing written at --out" "[ ! -e '$o' ]"
}

refuse "wave 9" "wave 9 not found" "$CLEAN" --wave 9 --base "$BASE"
refuse "short base sha" "--base must be a 40-char" "$CLEAN" --wave 1 --base abc1234
refuse "uppercase base sha" "--base must be a 40-char" "$CLEAN" --wave 1 --base "$(printf %s "$BASE" | tr a-f A-F)"

python3 - "$CLEAN" "$W/alias.md" <<'PY'
import sys
src, dst = sys.argv[1:3]
s = open(src).read()
old = '"executor": { "model": "claude-sonnet-5"'
assert old in s, 'mutation target missing'
open(dst, 'w').write(s.replace(old, '"executor": { "model": "sonnet"', 1))
PY
refuse "alias model (lint fails)" "plan is not lint-clean" "$W/alias.md" --wave 1 --base "$BASE"

python3 - "$CLEAN" "$W/depends-unmet.md" <<'PY'
import sys
src, dst = sys.argv[1:3]
s = open(src).read()
old = '"ci": "none: fixture repository without CI workflows",'
new = '"depends_on": [ { "wave": 1, "repo": ".", "ref": "origin/main", "path": "does-not-exist.txt" } ],\n  ' + old
assert old in s, 'mutation target missing'
open(dst, 'w').write(s.replace(old, new, 1))
PY
refuse "unmet depends_on" "does-not-exist.txt is not present at origin/main" "$W/depends-unmet.md" --wave 1 --base "$BASE"

out="$(node "$GEN_TOOL" "$CLEAN" --wave 1 --base "$BASE" --repo relative/repo --default-branch main 2>&1)"; rc=$?
check "relative --repo: exits non-zero" "[ $rc -ne 0 ]"
contains "relative --repo: reason named" "--repo must be an absolute path" "$out"
check "relative --repo: nothing written" "[ ! -e relative ]"

section "pushed-base guard: a real but unpushed commit is refused"
UNPUSHED_REPO="$W/unpushed-repo"
mk_repo "$UNPUSHED_REPO"
printf 'a local-only change\n' >> "$UNPUSHED_REPO/README.md"
GIT_AUTHOR_NAME="wave-launch-test" GIT_AUTHOR_EMAIL="wave-launch-test@example.com" \
GIT_AUTHOR_DATE="2020-01-01T00:00:01Z" GIT_COMMITTER_NAME="wave-launch-test" \
GIT_COMMITTER_EMAIL="wave-launch-test@example.com" GIT_COMMITTER_DATE="2020-01-01T00:00:01Z" \
  git -C "$UNPUSHED_REPO" commit -q -am "local-only change"
UNPUSHED_BASE="$(git -C "$UNPUSHED_REPO" rev-parse HEAD)"
out="$(node "$GEN_TOOL" "$CLEAN" --wave 1 --base "$UNPUSHED_BASE" --repo "$UNPUSHED_REPO" --default-branch main 2>&1)"; rc=$?
check "unpushed base: exits non-zero" "[ $rc -ne 0 ]"
contains "unpushed base: reason names the cause" "base $UNPUSHED_BASE is not on origin/main — push it first; a fix wave takes git rev-parse origin/main" "$out"
check "unpushed base: nothing written" "[ ! -e '$UNPUSHED_REPO/.worktrees' ]"

section "depends_on guard: a met dependency launches"
python3 - "$CLEAN" "$W/depends-met.md" <<'PY'
import sys
src, dst = sys.argv[1:3]
s = open(src).read()
old = '"ci": "none: fixture repository without CI workflows",'
new = '"depends_on": [ { "wave": 1, "repo": ".", "ref": "origin/main", "path": "README.md" } ],\n  ' + old
assert old in s, 'mutation target missing'
open(dst, 'w').write(s.replace(old, new, 1))
PY
out="$(node "$GEN_TOOL" "$W/depends-met.md" --wave 1 --base "$BASE" --repo "$REPO" --default-branch main 2>"$W/dep-met-err")"; rc=$?
expect "met depends_on: exits 0" "0" "$rc"
expect "met depends_on: stderr empty" "" "$(cat "$W/dep-met-err")"
check "met depends_on: launches" "[ -f '$REPO/.worktrees/launch/wave-1.workflow.mjs' ]"

section "worktree links: an untracked, gitignored local.properties is linked"
WT_REPO="$W/wt-repo"
mk_repo "$WT_REPO"
: > "$WT_REPO/gradlew"
printf 'local.properties\n' > "$WT_REPO/.gitignore"
git -C "$WT_REPO" add gradlew .gitignore
GIT_AUTHOR_NAME="wave-launch-test" GIT_AUTHOR_EMAIL="wave-launch-test@example.com" \
GIT_AUTHOR_DATE="2020-01-01T00:00:02Z" GIT_COMMITTER_NAME="wave-launch-test" \
GIT_COMMITTER_EMAIL="wave-launch-test@example.com" GIT_COMMITTER_DATE="2020-01-01T00:00:02Z" \
  git -C "$WT_REPO" commit -q -m "add gradlew"
git -C "$WT_REPO" push -q origin HEAD:main
printf 'sdk.dir=/tmp/fake-sdk\n' > "$WT_REPO/local.properties"
WT_BASE="$(git -C "$WT_REPO" rev-parse HEAD)"
out="$(node "$GEN_TOOL" "$CLEAN" --wave 1 --base "$WT_BASE" --repo "$WT_REPO" --default-branch main 2>"$W/wt-err")"; rc=$?
expect "worktree links: exits 0" "0" "$rc"
expect "worktree links: stderr empty" "" "$(cat "$W/wt-err")"
GEN_WT="$WT_REPO/.worktrees/launch/wave-1.workflow.mjs"
contains "worktree links: links carries local.properties" '"worktree":{"links":["local.properties"]}' "$(grep '^const WAVE_ARGS = ' "$GEN_WT" 2>/dev/null)"

section "excludeFromGit: local.properties merely untracked (not gitignored) still stays out of git status"
UG_REPO="$W/ug-repo"
mk_repo "$UG_REPO"
: > "$UG_REPO/gradlew"
git -C "$UG_REPO" add gradlew
GIT_AUTHOR_NAME="wave-launch-test" GIT_AUTHOR_EMAIL="wave-launch-test@example.com" \
GIT_AUTHOR_DATE="2020-01-01T00:00:03Z" GIT_COMMITTER_NAME="wave-launch-test" \
GIT_COMMITTER_EMAIL="wave-launch-test@example.com" GIT_COMMITTER_DATE="2020-01-01T00:00:03Z" \
  git -C "$UG_REPO" commit -q -m "add gradlew"
git -C "$UG_REPO" push -q origin HEAD:main
printf 'sdk.dir=/tmp/fake-sdk\n' > "$UG_REPO/local.properties"
UG_BASE="$(git -C "$UG_REPO" rev-parse HEAD)"
out="$(node "$GEN_TOOL" "$CLEAN" --wave 1 --base "$UG_BASE" --repo "$UG_REPO" --default-branch main 2>"$W/ug-err")"; rc=$?
expect "ungitignored local.properties: exits 0" "0" "$rc"
expect "ungitignored local.properties: stderr empty" "" "$(cat "$W/ug-err")"

EXCLUDE="$(git -C "$UG_REPO" rev-parse --path-format=absolute --git-common-dir)/info/exclude"
check "info/exclude contains /local.properties" "grep -qx '/local.properties' '$EXCLUDE'"
check "info/exclude contains .worktrees/" "grep -qx '.worktrees/' '$EXCLUDE'"

before_lines="$(wc -l < "$EXCLUDE")"
node "$GEN_TOOL" "$CLEAN" --wave 1 --base "$UG_BASE" --repo "$UG_REPO" --default-branch main \
  --out "$W/ug-second/out.workflow.mjs" >/dev/null 2>"$W/ug-err2"
after_lines="$(wc -l < "$EXCLUDE")"
expect "second run: stderr empty" "" "$(cat "$W/ug-err2")"
expect "second run adds nothing to info/exclude" "$before_lines" "$after_lines"

FRESH_WT="$W/ug-fresh-worktree"
git -C "$UG_REPO" worktree add -q "$FRESH_WT" -b ug-fresh-branch "$UG_BASE"
ln -s "$UG_REPO/local.properties" "$FRESH_WT/local.properties"
mkdir -p "$FRESH_WT/.worktrees"
status="$(git -C "$FRESH_WT" status --porcelain)"
expect "fresh worktree with the symlink: git status --porcelain is empty" "" "$status"

section "the lint call is repo-aware: a repo's CI workflows are checked at launch"
CI_REPO="$W/ci-repo"
mkdir -p "$CI_REPO/.github/workflows"
cat > "$CI_REPO/.github/workflows/ci.yml" <<'YML'
name: ci
on: pull_request
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: true
YML
python3 - "$CLEAN" "$W/ci-none.md" <<'PY'
import sys
src, dst = sys.argv[1:3]
s = open(src).read()
old = '"ci": "none: fixture repository without CI workflows",'
assert old in s, 'mutation target missing'
open(dst, 'w').write(s.replace(old, '"ci": "none: no ci here at all",', 1))
PY
out="$(node "$GEN_TOOL" "$W/ci-none.md" --wave 1 --base "$BASE" --repo "$CI_REPO" --default-branch main 2>&1)"; rc=$?
check "ci none plan against repo with workflows: exits non-zero" "[ $rc -ne 0 ]"
contains "ci none plan against repo with workflows: reason names the cause" "the repository has CI workflows" "$out"
check "ci none plan against repo with workflows: nothing written" "[ ! -e '$CI_REPO/.worktrees' ]"

NO_CI_REPO="$W/no-ci-repo"
mk_repo "$NO_CI_REPO"
out="$(node "$GEN_TOOL" "$W/ci-none.md" --wave 1 --base "$BASE" --repo "$NO_CI_REPO" --default-branch main 2>"$W/ci-err")"; rc=$?
expect "ci none plan against repo without workflows: exits 0" "0" "$rc"
check "ci none plan against repo without workflows: launches" "[ -f '$NO_CI_REPO/.worktrees/launch/wave-1.workflow.mjs' ]"

summary
