#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

MM=plugins/orchestration/skills/multi-model/SKILL.md
SH=plugins/orchestration/skills/ship/SKILL.md
REF=plugins/orchestration/skills/multi-model/references/orchestrator-gpt-6-1-sol.md

section "GPT-6.1 Sol rows"

check "multi-model exact-model row" \
  "grep -qF '| \`gpt-6.1-sol\` | \`references/orchestrator-gpt-6-1-sol.md\` |' '$MM'"
check "ship exact-model row" \
  "grep -qF '| \`gpt-6.1-sol\` | \`../multi-model/references/orchestrator-gpt-6-1-sol.md\` |' '$SH'"
check "orchestrator profile exists" "test -f '$REF'"

summary
