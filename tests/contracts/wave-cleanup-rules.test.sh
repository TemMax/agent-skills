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
  check "$s deletes the remote branch only on the full condition" "tr '\\n' ' ' < '$P/$s/WORKFLOW.md' | tr -s ' ' | grep -qF 'Delete the remote feature branch only if the script reported the local feature branch removed and the remote branch tip equals the'"
done

for s in skills/multi-model skills-codex/multi-model skills/ship skills-codex/ship; do
  W=$P/$s/WORKFLOW.md
  check "$s carries the After the merge: line" "one_line $W | grep -qF 'After the merge:'"
done
for s in skills/multi-model skills-codex/multi-model; do
  check "$s passes --records to the cleanup script" "one_line $P/$s/WORKFLOW.md | grep -qF -- '--records'"
done
check "claude-wave-adapter says the hint is printed when a task ended ok" \
  "one_line $P/skills/multi-model/references/claude-wave-adapter.md | grep -qF 'whenever at least one task ended'"
check "README names Left behind:" "grep -qF 'Left behind:' README.md"
check "README names wave-cleanup.mjs" "grep -qF wave-cleanup.mjs README.md"

for r in claude-wave-adapter codex-wave-protocol; do
  F=$P/skills/multi-model/references/$r.md
  check "$r names afterIntegration" "grep -qF afterIntegration '$F'"
  check "$r names wave-cleanup.mjs" "grep -qF wave-cleanup.mjs '$F'"
  check "$r carries the Left behind: line" "one_line '$F' | grep -qF 'Left behind:'"
  check "$r carries the After the merge: line" "one_line '$F' | grep -qF 'After the merge:'"
done

check "the cleanup script exists" "[ -f $P/skills/multi-model/references/wave-cleanup.mjs ]"

# A record a runner kept under --out outside the two default directories is
# found and removed only through --summary, after each wave and after the merge.
for s in skills/multi-model skills-codex/multi-model skills/ship skills-codex/ship; do
  W=$P/$s/WORKFLOW.md
  check "$s names --summary for records outside the default directories" "one_line $W | grep -qF 'per run record kept outside'"
  check "$s passes the same --summary options after the merge" "one_line $W | grep -qF 'the same \`--summary\` options'"
done
for r in claude-wave-adapter codex-wave-protocol; do
  F=$P/skills/multi-model/references/$r.md
  check "$r names --summary for records outside the default directories" "one_line '$F' | grep -qF 'per run record kept outside'"
  check "$r passes the same --summary options after the merge" "one_line '$F' | grep -qF 'the same \`--summary\` options'"
done
check "execution-cost-controls: a record outside the default directories needs --summary" \
  "one_line $P/skills/multi-model/references/execution-cost-controls.md | grep -qF 'only through \`--summary <summary.json>\`'"
check "the cleanup script removes the directory of a --summary under .worktrees" \
  "grep -qF 'the directory of each --summary file that' $P/skills/multi-model/references/wave-cleanup.mjs"
check "codex-wave-runner prints afterIntegration" "grep -qF afterIntegration $P/skills/multi-model/references/codex-wave-runner.mjs"
check "claude-wave-runner prints afterIntegration" "grep -qF afterIntegration $P/skills/multi-model/references/claude-wave-runner.mjs"

summary
