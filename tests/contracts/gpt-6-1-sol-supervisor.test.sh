#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

SP="$(contract_source plugins/orchestration/skills/super-plan/SKILL.md)"

section "GPT-6.1 Sol is the standard Codex supervisor in super-plan"

check "Step 2 names gpt-6.1-sol for Luna and Sol waves" \
  "tr '\\n' ' ' < $SP | tr -s ' ' | grep -qF 'Codex: \`gpt-6.1-sol\` for waves whose executors and rungs are \`gpt-6-luna\` or \`gpt-6.1-sol\`'"
check "headless mode uses gpt-6.1-sol for Luna and Sol Codex waves" \
  "tr '\\n' ' ' < $SP | tr -s ' ' | grep -qF '\`gpt-6.1-sol\` for Luna and Sol Codex waves'"
check "the Gate 1 intro names gpt-6.1-sol as the standard supervisor" \
  "tr '\\n' ' ' < $SP | tr -s ' ' | grep -qF 'or standard \`gpt-6.1-sol\` for Luna and Sol waves) without a'"
check "gpt-6-sol is no longer the standard supervisor of all-Luna waves" \
  "! tr '\\n' ' ' < $SP | tr -s ' ' | grep -qF 'standard \`gpt-6-sol\` for all-Luna waves'"

summary
