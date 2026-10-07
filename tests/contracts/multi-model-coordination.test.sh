#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

MM="$(mktemp)"
trap 'rm -f "$MM"' EXIT
python3 tests/lib/skill-source.py plugins/orchestration/skills/multi-model/SKILL.md > "$MM"

section "the coordinator chooses the fix route — a single delegated defect goes to a one-task supervised wave"

check "SKILL.md routes a single delegated defect to a one-task supervised wave" \
  "grep -qF 'one-task supervised wave' '$MM'"

section "stop handling names environment-blocked and a recommended next action"

check "SKILL.md adds environment-blocked next to failed/error/contract-unsatisfiable" \
  "grep -qF 'environment-blocked' '$MM'"
check "SKILL.md requires every stop to end with a recommended next action" \
  "grep -qF 'recommended next action' '$MM'"

section "an implement-directly instruction covers exactly what the user named, review fixes included"

check "SKILL.md states the instruction covers what the user named, review fixes included" \
  "grep -qF 'exactly what the user named, review fixes included' '$MM'"

summary
