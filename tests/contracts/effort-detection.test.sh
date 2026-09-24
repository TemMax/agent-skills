#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

SHIP="plugins/orchestration/skills/ship/SKILL.md"
CR="plugins/code-review/skills/critical-review/SKILL.md"

step0() { sed -n '/^## Step 0/,/^| Exact model id/p' "$1"; }

section "ship Step 0 — host-only effort detection"

check "ship Step 0 tells the model to run printenv CLAUDE_EFFORT once with the shell tool" \
  "step0 '$SHIP' | grep -qF 'run \`printenv CLAUDE_EFFORT\` once with the shell tool'"

check "ship Step 0 forbids reading CLAUDE_EFFORT on a Codex host" \
  "step0 '$SHIP' | grep -qF 'Never read \`CLAUDE_EFFORT\` on a Codex host'"

check "ship Step 0 has the new item 5 opening line" \
  "step0 '$SHIP' | grep -qF '5. Effort comes only from the host.'"

section "critical-review Step 0 — host-only effort detection"

check "critical-review Step 0 tells the model to run printenv CLAUDE_EFFORT once with the shell tool" \
  "step0 '$CR' | grep -qF 'run \`printenv CLAUDE_EFFORT\` once with the shell tool'"

check "critical-review Step 0 forbids reading CLAUDE_EFFORT on a Codex host" \
  "step0 '$CR' | grep -qF 'Never read \`CLAUDE_EFFORT\` on a Codex host'"

check "critical-review Step 0 has the new item 5 opening line" \
  "step0 '$CR' | grep -qF '5. Effort comes only from the host.'"

section "ship Handoff — never a time or cost estimate"

check "ship Handoff forbids time or cost estimates" \
  "grep -qF 'Never a time or cost estimate' '$SHIP'"

summary
