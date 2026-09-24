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
BASE=0123456789abcdef0123456789abcdef01234567
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

if ! command -v node >/dev/null 2>&1; then
  fail "node is required for this tier and was not found on PATH"
  summary; exit 1
fi

section "the generator ships"
check "wave-launch.mjs exists"            "[ -f $GEN_TOOL ]"
check "wave-launch.mjs is executable"     "[ -x $GEN_TOOL ]"
expect "node shebang on line 1" "#!/usr/bin/env node" "$(head -n 1 "$GEN_TOOL" 2>/dev/null)"

section "clean plan, default output path"
REPO="$W/repo"
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
contains "verifier is embedded" '"supervisor":{"model":"claude-fable-5-1","effort":"high"},"verifier":{"model":"claude-sonnet-5","effort":"low"},"tasks":' "$(grep '^const WAVE_ARGS = ' "$OUT" 2>/dev/null)"

section "each failure exits non-zero, explains itself on one line, writes nothing"
# $1 = name, $2 = expected stderr fragment, rest = generator arguments.
# Each run points both --repo and --out at fresh paths that must stay absent.
n=0
refuse() {
  local name="$1" frag="$2"; shift 2
  n=$((n + 1))
  local r="$W/fail-$n/repo" o="$W/fail-$n/out.workflow.mjs"
  local so rc_ se
  so="$(node "$GEN_TOOL" "$@" --repo "$r" --default-branch main 2>"$W/err")"; rc_=$?
  se="$(cat "$W/err")"
  check "$name: exits non-zero" "[ $rc_ -ne 0 ]"
  expect "$name: stdout empty" "" "$so"
  expect "$name: one-line reason on stderr" "1" "$(printf '%s\n' "$se" | grep -c .)"
  contains "$name: reason names the cause" "$frag" "$se"
  check "$name: nothing written under --repo" "[ ! -e '$W/fail-$n' ]"
  so="$(node "$GEN_TOOL" "$@" --repo "$r" --default-branch main --out "$o" 2>/dev/null)"; rc_=$?
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

out="$(node "$GEN_TOOL" "$CLEAN" --wave 1 --base "$BASE" --repo relative/repo --default-branch main 2>&1)"; rc=$?
check "relative --repo: exits non-zero" "[ $rc -ne 0 ]"
contains "relative --repo: reason named" "--repo must be an absolute path" "$out"
check "relative --repo: nothing written" "[ ! -e relative ]"

summary
