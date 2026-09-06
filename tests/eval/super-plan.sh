#!/usr/bin/env bash
# Tier 3 — does the PLANNER prompt produce a lint-clean, wave-grouped plan?
# Two fixtures with expectations fixed before any run:
#   P1 — a request that TEMPTS two tasks into the same file (the №1 defect
#        observed in real sessions); expectation: the plan passes lint, i.e.
#        the planner merged the colliding work or split the waves.
#   P2 — a request carrying a genuine product fork; expectation: the fork is
#        NAMED under "## Assumptions (would ask)", not silently resolved.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh
. tests/eval/model-cli.sh

# Default is Sonnet 5, not Haiku: measured 2026-08-18, Haiku 4.5 did not
# reliably follow this skill (prose printed before the plan content, `branch`
# values not matching `wave/<id>`, a `ladder` array holding branch names
# instead of short model names, and a same-wave file overlap that survived
# to lint) across repeated runs of this same script, while Sonnet 5 was
# markedly more reliable — clean on most runs, though one run out of several
# still produced a P2 plan that failed lint. See tests/README.md, which is
# the authoritative honest statement of what this tier proves.
if [ "${EVAL_PROVIDER:-claude}" = codex ]; then
  MODEL="${EVAL_MODEL:-gpt-5.6-sol}"
else
  MODEL="${EVAL_MODEL:-claude-sonnet-5}"
fi
SKILL=plugins/orchestration/skills/super-plan/SKILL.md
LINT=plugins/orchestration/skills/super-plan/references/plan-lint.mjs
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

R="$W/repo"; mkdir -p "$R/src" "$R/tests" "$R/docs"
cat > "$R/src/app.py" <<'PY'
def greet(name):
    return "hello " + name
PY
cat > "$R/tests/test_app.py" <<'PY'
import unittest

from src.app import greet


class TestGreet(unittest.TestCase):
    def test_greet(self):
        self.assertEqual(greet("ann"), "hello ann")
PY
touch "$R/src/__init__.py" "$R/tests/__init__.py"
printf '# demo\n\ngreet(name) says hello.\n' > "$R/docs/README.md"

plan() {  # $1 = feature request  → prints the model's plan file content
  # The prompt is piped over stdin, not passed as a positional argument: the
  # skill file's own text opens with the `---` frontmatter delimiter, and a
  # leading-dash positional argument gets parsed as an unknown CLI option.
  local prompt_file="$W/plan-prompt.md" answer_file="$W/plan-answer.md"
  printf '%s' "$(cat "$SKILL")

EVAL MODE: you are running headless under an evaluation harness — apply the
skill's headless evaluation mode. The repository to plan against is at $R
(explore it with your tools). Write NOTHING to disk. Print ONLY the complete
plan file content (markdown, all three layers), no prose before or after it.
Do not wrap the output in an outer code fence.

Feature request:
$1" > "$prompt_file"
  EVAL_MODEL="$MODEL" eval_model_answer "$R" read-only "$prompt_file" "$answer_file"
}

section "P1 — overlap temptation (both changes land in src/app.py)"
plan "Two improvements to greet(): (a) raise ValueError when name is empty; (b) add an optional excited=True flag that appends an exclamation mark. Also update docs/README.md to describe both." > "$W/p1.md"
out="$(node "$LINT" "$W/p1.md" --repo "$R" 2>&1)"; rc=$?
expect "P1 plan passes lint (no same-wave overlap survived)" "0" "$rc"
contains "P1 lint summary" "OK:" "$out"
# Merging the colliding work into one task is a legitimate resolution too
# (the header comment above says so, and the skill's own rule is "merge the
# colliding tasks OR split the waves") — so this only guards against a
# degenerate, empty task list, not against a single well-reasoned merge.
n="$(grep -c '"id":' "$W/p1.md" || true)"
check "P1 has at least 1 task (got $n)" "[ \"$n\" -ge 1 ]"
# A real command against this fixture names its one test file — "unittest"
# itself is too brittle: pytest legitimately runs unittest.TestCase tests
# without ever spelling the module name.
contains "P1 contracts reference the fixture's real test command" "test_app" "$(cat "$W/p1.md")"

section "P2 — a product fork must surface, not be silently resolved"
plan "Add a delete_user(name) function to src/app.py with tests. Decide nothing about edge-case behaviour on your own." > "$W/p2.md"
contains "P2 names its assumptions" "Assumptions (would ask)" "$(cat "$W/p2.md")"
out="$(node "$LINT" "$W/p2.md" --repo "$R" 2>&1)"; rc=$?
expect "P2 plan still passes lint" "0" "$rc"

summary
