#!/usr/bin/env bash
# Tier 2.5 — does the SHIPPED wave-runner behave as the prose promises? The
# simulator runs the real file with stubbed agents, so every ladder rule is a
# deterministic offline assertion, not a live-model probe. The static checks
# pin the Workflow-boundary rules; each one cost a launch rejection once.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tests/lib.sh

W=plugins/orchestration/skills/multi-model/references/wave-runner.workflow.mjs

section "Workflow-boundary rules (violations are launch rejections)"
check "the runner ships"                    "[ -f $W ]"
expect "exactly one export" "1" "$(grep -c '^export ' "$W")"
check "meta is a pure literal"              "! sed -n '/^export const meta/,/^}/p' $W | grep -qE '\\\$\\{|\\\`| \\+ '"
check "no Date or random (breaks resume)"   "! grep -qE 'Date\\.|new Date|Math\\.random' $W"
check "every full model id is one of the six accepted IDs" "! grep -o 'claude-[a-z0-9.-]*' $W | grep -vxE 'claude-(haiku-4-5-20251001|sonnet-5|opus-5-5|opus-5|opus-4-8|fable-5-1)' | grep -q ."
check "the MODELS array holds no alias" "sed -n '/^const MODELS = \\[/,/^\\]/p' $W | grep -qF \"'claude-sonnet-5'\" && ! sed -n '/^const MODELS = \\[/,/^\\]/p' $W | grep -qE \"'(haiku|sonnet|opus|fable)'\""
check "result leaves via top-level return"  "grep -qE '^return ' $W"

section "Ladder semantics, simulated on the shipped file"
if command -v node >/dev/null 2>&1; then
  if out="$(node tests/lib/workflow-sim.test.mjs 2>&1 && node tests/lib/wave-runner.test.mjs 2>&1)"; then
    printf '%s\n' "$out" | sed 's/^/    /'
    pass "all simulator scenarios"
  else
    printf '%s\n' "$out" | sed 's/^/    /'
    fail "simulator scenarios (output above)"
  fi
else
  fail "node is required for this tier and was not found on PATH"
fi

summary
