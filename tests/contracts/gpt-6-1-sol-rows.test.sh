#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

MM="$(mktemp)"
trap 'rm -f "$MM"' EXIT
python3 tests/lib/skill-source.py plugins/orchestration/skills/multi-model/SKILL.md > "$MM"
SH="$(contract_source plugins/orchestration/skills/ship/SKILL.md)"
REF=plugins/orchestration/skills/multi-model/references/orchestrator-gpt-6-1-sol.md

section "GPT-6.1 Sol rows"

check "multi-model exact-model row" \
  "grep -qF '| \`gpt-6.1-sol\` | \`references/orchestrator-gpt-6-1-sol.md\` |' '$MM'"
check "ship exact-model row" \
  "grep -qF '| \`gpt-6.1-sol\` | \`../multi-model/references/orchestrator-gpt-6-1-sol.md\` |' '$SH'"
check "orchestrator profile exists" "test -f '$REF'"

summary
