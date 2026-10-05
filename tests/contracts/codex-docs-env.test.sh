#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

PROTOCOL=plugins/orchestration/skills/multi-model/references/codex-wave-protocol.md
AMEND=plugins/orchestration/skills/multi-model/references/contract-amendment.md
VD=plugins/orchestration/skills/multi-model/references/verdicts.md

one_line() { tr '\n' ' ' < "$1" | tr -s ' '; }

section "codex-wave-protocol.md: toolchain caches, .git and linked files"
check "the new section exists" \
  "grep -qF '## Toolchain caches, \`.git\` and linked files' $PROTOCOL"
check "the pinned --add-dir .git line is still there" \
  "one_line '$PROTOCOL' | grep -qF '\`--add-dir <repo>/.git\`'"
check "the model-free --preflight probe is documented" \
  "grep -q -- '--preflight' $PROTOCOL"
check "environment-blocked status is documented" \
  "grep -q 'environment-blocked' $PROTOCOL"
check "depends-on-unmet stop is documented" \
  "grep -q 'depends-on-unmet' $PROTOCOL"
check "summary.json's eventsTail diagnostic is documented" \
  "grep -q 'eventsTail' $PROTOCOL"
check "the worktree gitdir writable root is documented (worktreeGitDir)" \
  "grep -qF 'worktreeGitDir' $PROTOCOL"
check "the upstream Codex issue #23661 is cited" \
  "grep -qF '#23661' $PROTOCOL"

section "contract-amendment.md: the Codex path and the environment-blocked exclusion"
check "environment-blocked is never an amendment" \
  "one_line '$AMEND' | grep -qF 'is never an amendment'"
check "native recovery preserves the candidate" \
  "grep -qF -- '--resume-from' $AMEND"

section "verdicts.md: the environment violation class"
check "environment is listed as a violation class" \
  "one_line '$VD' | grep -qF '\`report\`, \`environment\`'"
check "environment is never charged as an attempt" \
  "one_line '$VD' | grep -qF 'never charged as an executor attempt'"

summary
