#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

CP_ROUTING=plugins/orchestration/skills/multi-model/references/codex-routing.md
CP_PROTOCOL=plugins/orchestration/skills/multi-model/references/codex-wave-protocol.md
SH=plugins/orchestration/skills/ship/SKILL.md

section "codex-routing: ordinary/difficult waves have no standard supervisor"

check "codex-routing states ordinary and difficult tasks route to Sol" \
  "grep -qF '\`ordinary\` and \`difficult\` tasks route their initial executor to \`gpt-6-sol\`' '$CP_ROUTING'"
check "codex-routing states such a wave has no standard supervisor" \
  "grep -qF 'so a wave containing either task class has no standard supervisor' '$CP_ROUTING'"
check "codex-routing states such a wave needs the premium gpt-6-astra supervisor" \
  "grep -qF 'Such a wave' '$CP_ROUTING' && grep -qF 'needs the premium \`gpt-6-astra\` supervisor.' '$CP_ROUTING'"

section "codex-routing: Astra execution needs astra_executor_reason and approvals.premium"

check "codex-routing states Astra execution needs astra_executor_reason and approvals.premium" \
  "tr '\\n' ' ' < '$CP_ROUTING' | tr -s ' ' | grep -qF 'Astra execution needs its \`astra_executor_reason\` and \`approvals.premium\`.'"

section "codex-routing: ship's final review child is chosen by the plan's review key"

check "codex-routing runs Stage 3 in a fresh child of the plan's review-key model" \
  "tr '\\n' ' ' < '$CP_ROUTING' | tr -s ' ' | grep -qF 'runs in a fresh child of the model the plan' && tr '\\n' ' ' < '$CP_ROUTING' | tr -s ' ' | grep -qF 'If the plan has no \`review\` key, stop and ask the user before invoking the review; never pick.'"
check "codex-routing states the review child is chosen by the user at Gate 1 with its estimated cost" \
  "tr '\\n' ' ' < '$CP_ROUTING' | tr -s ' ' | grep -qF 'chosen by the user at Gate 1 with its estimated cost'"
check "codex-routing never-pick sentence is present for the review child" \
  "tr '\\n' ' ' < '$CP_ROUTING' | tr -s ' ' | grep -qF 'never pick.'"

section "codex-wave-protocol: the supervisor is the one chosen at Gate 1"

check "codex-wave-protocol names the Gate 1 supervisor choice, premium or standard" \
  "grep -qF 'The supervisor is the one chosen' '$CP_PROTOCOL' && grep -qF 'at Gate 1 — the premium \`gpt-6-astra\`, or the standard \`gpt-6-sol\` for an' '$CP_PROTOCOL' && grep -qF 'all-\`gpt-6-luna\` wave.' '$CP_PROTOCOL'"
check "codex-wave-protocol requires astra_executor_reason and approvals.premium for an Astra executor or rung" \
  "grep -qF 'An Astra executor or rung needs' '$CP_PROTOCOL' && grep -qF '\`astra_executor_reason: \"<concrete reason>\"\` and \`approvals.premium\`' '$CP_PROTOCOL'"

section "ship: Stage 3 critical-review child is chosen by the plan's review key"

check "ship runs Stage 3 in a fresh child of the plan's review-key model" \
  "tr '\\n' ' ' < '$SH' | tr -s ' ' | grep -qF 'runs in a fresh child of the model the plan' && tr '\\n' ' ' < '$SH' | tr -s ' ' | grep -qF 'if the plan has no \`review\` key, stop and ask the user before invoking the review; never pick.'"

section "ship: Stage 2 step 4 still runs ci.commands before the final push"

check "ship Stage 2 step 4 runs ci.commands after the final wave, before push" \
  "grep -qF 'push. After the final wave, also run the plan'\''s \`ci.commands\` before that' '$SH'"

section "ship: Failure map covers a red ci.commands command after the final wave"

check "ship Failure map stops before the push when a plan ci.commands command is red" \
  "grep -qF '| A plan \`ci.commands\` command is red after the final wave | Stop before the push; hand the output over |' '$SH'"

summary
