#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

MM=plugins/orchestration/skills/multi-model/SKILL.md
SH=plugins/orchestration/skills/ship/SKILL.md
REF=plugins/orchestration/skills/multi-model/references/orchestrator-gpt-6-1-sol.md
SENT='GPT-6.1 Sol names the same bare family (probed with Codex CLI 0.159.0 on 2026-09-29).'

section "GPT-6.1 Sol rows"

check "multi-model exact-model row" \
  "grep -qF '| \`gpt-6.1-sol\` | \`references/orchestrator-gpt-6-1-sol.md\` |' '$MM'"
check "ship exact-model row" \
  "grep -qF '| \`gpt-6.1-sol\` | \`../multi-model/references/orchestrator-gpt-6-1-sol.md\` |' '$SH'"
check "multi-model Step 0 sentence" \
  "tr '\n' ' ' < '$MM' | tr -s ' ' | grep -qF '$SENT'"
check "ship Step 0 sentence" \
  "tr '\n' ' ' < '$SH' | tr -s ' ' | grep -qF '$SENT'"
check "orchestrator profile exists" "test -f '$REF'"

summary
