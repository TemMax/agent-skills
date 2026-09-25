#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

PROMPT="plugins/orchestration/skills/multi-model/references/supervisor-prompt.md"

one_line() { tr '\n' ' ' < "$1" | tr -s ' '; }

check "violation classes include the environment class for machine-caused stops" \
  "one_line '$PROMPT' | grep -qF '\`environment\` — a command cannot start or run because of the machine, not'"

check "satisfiability section covers a forbidden-move violation and quotes both lines" \
  "one_line '$PROMPT' | grep -qF 'record the \`forbidden-move\` violation with' && one_line '$PROMPT' | grep -qF '\"satisfiable\": false'"

check "opening instruction and Output section both name the forbidden-move violation class" \
  "one_line '$PROMPT' | grep -qF 'When you record a \`must_run\`, \`report\` or \`forbidden-move\` violation' && one_line '$PROMPT' | grep -qF 'A \`must_run\`, \`report\` or \`forbidden-move\` violation also carries'"

check "What to do covers symlinking WORKTREE LINKS into a fresh checkout" \
  "one_line '$PROMPT' | grep -qF 'When WORKTREE LINKS are attached and you create your own checkout, symlink'"

check "Long commands section carries the Long-command sentence" \
  "one_line '$PROMPT' | grep -qF 'Never end your turn while a command you started is still running — no Monitor, no ScheduleWakeup'"

check "verdict rules carry the Secrets sentence naming local.properties" \
  "one_line '$PROMPT' | grep -qF 'That includes untracked build configuration a worktree links —' && one_line '$PROMPT' | grep -qF 'local.properties'"

summary
