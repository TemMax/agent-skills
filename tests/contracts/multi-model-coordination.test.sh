#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

MM=plugins/orchestration/skills/multi-model/SKILL.md

section "coordinator never authors code — review fixes always route to a supervised wave"

check "SKILL.md requires review defects, however small, to go to a one-task supervised wave" \
  "grep -qF 'one-task supervised wave' '$MM'"

section "stop handling names environment-blocked and a recommended next action"

check "SKILL.md adds environment-blocked next to failed/error/contract-unsatisfiable" \
  "grep -qF 'environment-blocked' '$MM'"
check "SKILL.md requires every stop to end with a recommended next action" \
  "grep -qF 'recommended next action' '$MM'"

section "an implement-directly bypass is scoped to its recorded waves, never to review fixes"

check "SKILL.md states the bypass does not cover review fixes" \
  "grep -qF 'does not cover review fixes' '$MM'"

summary
