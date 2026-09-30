#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

SP=plugins/orchestration/skills/super-plan/SKILL.md

section "GPT-6.1 Sol is the standard Codex supervisor in super-plan"

check "Step 2 names gpt-6.1-sol for all-Luna waves" \
  "tr '\\n' ' ' < $SP | tr -s ' ' | grep -qF 'Codex: \`gpt-6.1-sol\` for waves whose executors and rungs are only \`gpt-6-luna\`'"
check "headless mode uses gpt-6.1-sol for all-Luna Codex waves" \
  "tr '\\n' ' ' < $SP | tr -s ' ' | grep -qF '\`gpt-6.1-sol\` for all-Luna Codex waves'"
check "the Gate 1 intro names gpt-6.1-sol as the standard supervisor" \
  "tr '\\n' ' ' < $SP | tr -s ' ' | grep -qF 'or standard \`gpt-6.1-sol\` for all-Luna waves) without a'"
check "gpt-6-sol is no longer the standard supervisor of all-Luna waves" \
  "! tr '\\n' ' ' < $SP | tr -s ' ' | grep -qF 'standard \`gpt-6-sol\` for all-Luna waves'"

summary
