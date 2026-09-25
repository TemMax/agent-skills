#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

MM=plugins/orchestration/skills/multi-model/SKILL.md

section "Research Routing mandatory lines cover zsh globs, build-tool listings and read-only agents"

check "SKILL.md warns unquoted globs fail with no matches found on zsh" \
  "grep -qF 'no matches found' '$MM'"
check "SKILL.md requires a read-only agent to never write files" \
  "grep -qF 'never writes files' '$MM'"

section "Task Prompt Template appends the Secrets sentence after Prohibitions without reordering it"

check "SKILL.md's Secrets sentence names local.properties as untracked build configuration" \
  "grep -qF 'local.properties' '$MM'"
check "Secrets sentence follows the existing Prohibitions secrets sentence, not before it" \
  "sed -n '/^4\. \*\*Prohibitions:\*\*/,/overriding goal.*\.\$/p' '$MM' | tr '\n' ' ' | tr -s ' ' | grep -qF 'if the task needs a secret, stop and report. That includes untracked build configuration a worktree links — \`local.properties\`'"

section "Task Prompt Template adds the Long-command sentence"

check "SKILL.md tells executors never to end a turn on a still-running command" \
  "grep -qF 'ScheduleWakeup' '$MM'"

section "Task Prompt Template adds the dead-end environment-blocked instruction"

check "SKILL.md's dead-end protocol names the environment-blocked report marker" \
  "grep -qF 'environment-blocked:' '$MM'"

summary
