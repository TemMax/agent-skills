#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

PR=tests/eval/profile-routing.sh
SP=tests/eval/super-plan.sh
SH=tests/eval/ship.sh
CR=tests/eval/critical-review.sh
WV=tests/eval/wave.sh

section "profile-routing.sh (Codex-only) names the skills-codex entrypoints"

for p in plugins/orchestration/skills-codex/super-plan/SKILL.md \
         plugins/orchestration/skills-codex/multi-model/SKILL.md \
         plugins/orchestration/skills-codex/ship/SKILL.md \
         plugins/code-review/skills-codex/critical-review/SKILL.md; do
  check "profile-routing.sh names $p" "grep -qF '$p' '$PR'"
done
for p in plugins/orchestration/skills/super-plan/SKILL.md \
         plugins/orchestration/skills/multi-model/SKILL.md \
         plugins/orchestration/skills/ship/SKILL.md \
         plugins/code-review/skills/critical-review/SKILL.md; do
  check "profile-routing.sh does not name Claude path $p" "! grep -qF '$p' '$PR'"
done

section "super-plan.sh picks the entrypoint per provider"

check "super-plan.sh has the codex SKILL assignment" \
  "grep -qF 'SKILL=plugins/orchestration/skills-codex/super-plan/SKILL.md' '$SP'"
check "super-plan.sh has the claude SKILL assignment" \
  "grep -qF 'SKILL=plugins/orchestration/skills/super-plan/SKILL.md' '$SP'"
check "codex assignment sits inside the codex branch" \
  "awk '/^if \[ \"\\\${EVAL_PROVIDER:-claude}\" = codex \]; then\$/{i=1;next} /^else\$/{i=0} i' '$SP' | grep -qF 'SKILL=plugins/orchestration/skills-codex/super-plan/SKILL.md'"

section "ship.sh and critical-review.sh (Codex-only) use skills-codex"

check "ship.sh uses the skills-codex entrypoint" \
  "grep -qF 'SKILL=plugins/orchestration/skills-codex/ship/SKILL.md' '$SH'"
check "ship.sh does not use the Claude entrypoint" \
  "! grep -qF 'SKILL=plugins/orchestration/skills/ship/SKILL.md' '$SH'"
check "critical-review.sh uses the skills-codex entrypoint" \
  "grep -qF 'SKILL=plugins/code-review/skills-codex/critical-review/SKILL.md' '$CR'"
check "critical-review.sh does not use the Claude entrypoint" \
  "! grep -qF 'SKILL=plugins/code-review/skills/critical-review/SKILL.md' '$CR'"

section "wave.sh has no unused MULTI_SKILL"

check "wave.sh no longer contains MULTI_SKILL" "! grep -qF 'MULTI_SKILL' '$WV'"

section "every skills-codex SKILL.md named in these scripts exists"

for p in $(grep -ohE 'plugins/[a-z-]+/skills-codex/[a-z-]+/SKILL\.md' $PR $SP $SH $CR $WV | sort -u); do
  check "$p exists" "test -f '$p'"
done

summary
