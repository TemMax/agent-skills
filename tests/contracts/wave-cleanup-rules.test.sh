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
done
for s in skills/multi-model skills-codex/multi-model skills/ship skills-codex/ship; do
  check "$s deletes the remote branch only on the full condition" "one_line '$P/$s/WORKFLOW.md' | grep -qF 'Delete the remote feature branch only if the script reported the local feature branch removed and \`git ls-remote --heads origin <feature branch>\` shows the \`tip\` it printed.'"
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

# A record a runner kept under an --out elsewhere in .worktrees is found and
# removed only through --summary, after each wave and after the merge; an --out
# outside .worktrees is listed, never named.
for s in skills/multi-model skills-codex/multi-model skills/ship skills-codex/ship; do
  W=$P/$s/WORKFLOW.md
  check "$s names --summary for records outside the default directories" "one_line $W | grep -qF 'for each runner given an \`--out\` under \`.worktrees/\` other than'"
  check "$s lists a runner --out outside .worktrees" "one_line $W | grep -qF 'plus any runner \`--out\` outside \`.worktrees/\`'"
  check "$s passes the same --summary options after the merge" "one_line $W | grep -qF 'the same \`--summary\` options'"
done
for r in claude-wave-adapter codex-wave-protocol; do
  F=$P/skills/multi-model/references/$r.md
  check "$r names --summary for records outside the default directories" "one_line '$F' | grep -qF 'for each runner given an \`--out\` under \`.worktrees/\` other than'"
  check "$r lists a runner --out outside .worktrees" "one_line '$F' | grep -qF 'plus any runner \`--out\` outside \`.worktrees/\`'"
  check "$r passes the same --summary options after the merge" "one_line '$F' | grep -qF 'the same \`--summary\` options'"
done
check "execution-cost-controls: a record outside the default directories needs --summary" \
  "one_line $P/skills/multi-model/references/execution-cost-controls.md | grep -qF 'only through \`--summary <out>/summary.json\`'"
check "execution-cost-controls: the script never removes an --out outside .worktrees" \
  "one_line $P/skills/multi-model/references/execution-cost-controls.md | grep -qF 'never removes an \`--out\` outside \`.worktrees/\`'"
check "the cleanup script removes the directory of a --summary under .worktrees" \
  "grep -qF 'the directory of each --summary file that' $P/skills/multi-model/references/wave-cleanup.mjs"
# The After the merge: command is the one a dry run printed, written out in
# the reply itself: a model that builds it by hand links a file it wrote or
# leaves shell variables in it.
for f in skills/multi-model/WORKFLOW.md skills-codex/multi-model/WORKFLOW.md skills/ship/WORKFLOW.md \
  skills-codex/ship/WORKFLOW.md skills/multi-model/references/claude-wave-adapter.md \
  skills/multi-model/references/codex-wave-protocol.md; do
  F=$P/$f
  check "$f takes the After the merge: command from the dry run's command field" \
    "one_line '$F' | grep -qF 'Take that command from the \`command\` field that'"
  check "$f writes the command out as printed, on the line or in a code block below it" \
    "one_line '$F' | grep -qF 'as printed, on that line or in a code block right below it'"
  check "$f allows no link, file, shell variable or relative path for it" \
    "one_line '$F' | grep -qF 'never a link, a file to open, a shell variable or a path relative to the current directory'"
done
check "README says the cleanup command is written out ready to run" \
  "one_line README.md | grep -qF 'written out in the report as the cleanup script printed it, ready to run'"
check "the cleanup script prints the ready command in a dry run" \
  "grep -qF 'command: these options without --dry-run' $P/skills/multi-model/references/wave-cleanup.mjs"
check "codex-wave-runner prints afterIntegration" "grep -qF afterIntegration $P/skills/multi-model/references/codex-wave-runner.mjs"
check "claude-wave-runner prints afterIntegration" "grep -qF afterIntegration $P/skills/multi-model/references/claude-wave-runner.mjs"

summary
