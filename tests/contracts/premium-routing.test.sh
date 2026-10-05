#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

CP_ROUTING=plugins/orchestration/skills/multi-model/references/codex-routing.md
CP_PROTOCOL=plugins/orchestration/skills/multi-model/references/codex-wave-protocol.md
SH=plugins/orchestration/skills/ship/SKILL.md
MMS="$(mktemp)"
trap 'rm -f "$MMS"' EXIT
python3 tests/lib/skill-source.py plugins/orchestration/skills/multi-model/SKILL.md > "$MMS"

section "codex-routing: ordinary/difficult waves have no standard supervisor"

check "codex-routing states ordinary and difficult tasks route to Sol" \
  "grep -qF '\`ordinary\` and \`difficult\` tasks route their initial executor to \`gpt-6.1-sol\`' '$CP_ROUTING'"
check "codex-routing states GPT-6 Sol is no longer chosen for new executor routes" \
  "grep -qF 'GPT-6 Sol is no longer chosen for new executor routes' '$CP_ROUTING'"
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
check "codex-routing states the review child is chosen by the user at Gate 1, never priced" \
  "tr '\\n' ' ' < '$CP_ROUTING' | tr -s ' ' | grep -qF 'chosen by the user at Gate 1:' && ! grep -qF 'estimated cost' '$CP_ROUTING'"
check "codex-routing never-pick sentence is present for the review child" \
  "tr '\\n' ' ' < '$CP_ROUTING' | tr -s ' ' | grep -qF 'never pick.'"

section "codex-wave-protocol: the supervisor is the one chosen at Gate 1"

check "codex-wave-protocol names the Gate 1 supervisor choice, premium or standard" \
  "grep -qF 'The supervisor is the one chosen' '$CP_PROTOCOL' && grep -qF 'at Gate 1 — the premium \`gpt-6-astra\`, or the standard \`gpt-6.1-sol\` for an' '$CP_PROTOCOL' && grep -qF 'all-\`gpt-6-luna\` wave.' '$CP_PROTOCOL'"
check "codex-wave-protocol requires astra_executor_reason and approvals.premium for an Astra executor or rung" \
  "grep -qF 'An Astra executor or rung needs' '$CP_PROTOCOL' && grep -qF '\`astra_executor_reason: \"<concrete reason>\"\` and \`approvals.premium\`' '$CP_PROTOCOL'"

section "ship: Stage 3 critical-review child is chosen by the plan's review key"

check "ship runs Stage 3 in a fresh child of the plan's review-key model" \
  "tr '\\n' ' ' < '$SH' | tr -s ' ' | grep -qF 'runs in a fresh child of the model the plan' && tr '\\n' ' ' < '$SH' | tr -s ' ' | grep -qF 'if the plan has no \`review\` key, stop and ask the user before invoking the review; never pick.'"
check "ship's PR body line for a gpt-6-sol review child reads Review route: gpt-6-sol" \
  "grep -qF 'Review route: gpt-6-sol' '$SH' && ! grep -qi 'uncalibrated' '$SH'"

section "ship: Stage 2 step 4 still runs ci.commands before the final push"

check "ship Stage 2 step 4 runs ci.commands after the final wave, before push" \
  "grep -qF 'push. After the final wave, also run the plan'\''s \`ci.commands\` before that' '$SH'"

section "ship: Failure map covers a red ci.commands command after the final wave"

check "ship Failure map stops before the push when a plan ci.commands command is red" \
  "grep -qF '| A plan \`ci.commands\` command is red after the final wave | Stop before the push; hand the output over. The fix follows the row above: on the user'\''s yes, a one-task supervised fix wave from the red tip pushed to the feature branch only. |' '$SH'"

section "Sol 6.1 standard supervisor: review route is gpt-6.1-sol"

check "codex-routing names gpt-6.1-sol as the lower-cost final-review option" \
  "tr '\\n' ' ' < '$CP_ROUTING' | tr -s ' ' | grep -qF 'The lower-cost final-review option is \`gpt-6.1-sol\`'"
check "multi-model records the 2026-09-30 review route move to gpt-6.1-sol" \
  "tr '\\n' ' ' < '$MMS' | tr -s ' ' | grep -qF 'On 2026-09-30 the review route moved to \`gpt-6.1-sol\` too: after a verdict-wording fix it passed the strict review gate (clean 10/10, planted 10/10, PR support 3/4; its first run on 2026-09-29 had clean 4/5 and 5/5).'"
check "ship's PR body line for a gpt-6.1-sol review child carries the 2026-09-30 counts" \
  "grep -qF 'Review route: gpt-6.1-sol final review (measured 2026-09-30: clean 10/10, planted 10/10, PR support 3/4)' '$SH' && ! grep -qi 'uncalibrated' '$SH' '$MMS'"
check "codex-routing Verification and stops names gpt-6.1-sol measured 2026-09-30" \
  "tr '\\n' ' ' < '$CP_ROUTING' | tr -s ' ' | grep -qF 'or \`gpt-6.1-sol\` (measured 2026-09-30'"
check "multi-model records the 2026-09-29 supervisor move to gpt-6.1-sol" \
  "tr '\\n' ' ' < '$MMS' | tr -s ' ' | grep -qF 'On 2026-09-29 the standard supervisor of all-\`gpt-6-luna\` waves moved to \`gpt-6.1-sol\`'"
check "multi-model names Codex gpt-6.1-sol for Luna-only waves" \
  "tr '\\n' ' ' < '$MMS' | tr -s ' ' | grep -qF 'Codex \`gpt-6.1-sol\` for Luna-only waves.'"
check "multi-model no longer names standard gpt-6-sol for all-Luna waves" \
  "! tr '\\n' ' ' < '$MMS' | tr -s ' ' | grep -qF 'standard \`gpt-6-sol\` for all-Luna waves'"

summary
