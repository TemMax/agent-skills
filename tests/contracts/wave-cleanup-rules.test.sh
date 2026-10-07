#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

P=plugins/orchestration
one_line() { tr '\n' ' ' < "$1" | tr -s ' '; }

for s in skills/multi-model skills-codex/multi-model skills/ship skills-codex/ship; do
  SRC="$(contract_source $P/$s/SKILL.md)"
  check "$s names wave-cleanup.mjs" "one_line '$SRC' | grep -qF 'wave-cleanup.mjs'"
  check "$s carries the Left behind: line" "one_line '$SRC' | grep -qF 'Left behind:'"
done

for s in skills/ship skills-codex/ship; do
  SRC="$(contract_source $P/$s/SKILL.md)"
  check "$s passes --records to the cleanup script" "one_line '$SRC' | grep -qF -- '--records'"
  check "$s passes --branch to the cleanup script" "one_line '$SRC' | grep -qF -- '--branch'"
  check "$s deletes the remote branch only on a condition" "one_line '$SRC' | grep -qF 'only if'"
done

for r in claude-wave-adapter codex-wave-protocol; do
  F=$P/skills/multi-model/references/$r.md
  check "$r names afterIntegration" "grep -qF afterIntegration '$F'"
  check "$r names wave-cleanup.mjs" "grep -qF wave-cleanup.mjs '$F'"
done

check "the cleanup script exists" "[ -f $P/skills/multi-model/references/wave-cleanup.mjs ]"
check "codex-wave-runner prints afterIntegration" "grep -qF afterIntegration $P/skills/multi-model/references/codex-wave-runner.mjs"
check "claude-wave-runner prints afterIntegration" "grep -qF afterIntegration $P/skills/multi-model/references/claude-wave-runner.mjs"

summary
