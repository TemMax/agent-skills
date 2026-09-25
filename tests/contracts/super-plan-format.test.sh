#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

SP="plugins/orchestration/skills/super-plan/SKILL.md"

one_line() { tr '\n' ' ' < "$1" | tr -s ' '; }

check "the skill exists" \
  "[ -f $SP ]"

check "research names local.properties as an untracked worktree file" \
  "one_line '$SP' | grep -qF 'local.properties'"

check "research routes untracked files and caches through the worktree key" \
  "one_line '$SP' | grep -qF \"These go into the plan's \\\`worktree\\\` key\""

check "research names the cache directories the build writes" \
  "one_line '$SP' | grep -qF '~/.gradle' && one_line '$SP' | grep -qF '~/.android' && one_line '$SP' | grep -qF '~/.cargo'"

check "research cites the measured GitHub-token print" \
  "one_line '$SP' | grep -qF 'at least 4 printed the file, including a GitHub token'"

check "scoped gates still carry the module-scoped form of every ci gate" \
  "one_line '$SP' | grep -qF 'module-scoped form of every gate'"

check "scoped gates name the formatter, linter and tests" \
  "one_line '$SP' | grep -qF 'the formatter' && one_line '$SP' | grep -qF 'the linter or static analysis' && one_line '$SP' | grep -qF 'the tests'"

check "scoped gates give a gofmt example" \
  "one_line '$SP' | grep -qF 'gofmt -l <dirs>'"

check "scoped gates cover multiplatform test-source compilation" \
  "one_line '$SP' | grep -qF \"For a multiplatform module, it also compiles every target's test sources\""

check "plan format documents the worktree key's shape" \
  "one_line '$SP' | grep -qF 'worktree' && one_line '$SP' | grep -qF '\"links\": [...], \"writable\": [...], \"auto\": true'"

check "plan format names the tool that acts on the worktree key" \
  "one_line '$SP' | grep -qF 'resolveWorktreeEnv' && one_line '$SP' | grep -qF 'applyLinks'"

check "plan format documents the depends_on key's shape" \
  "one_line '$SP' | grep -qF 'depends_on' && one_line '$SP' | grep -qF 'git -C <repo> cat-file -e <ref>:<path>'"

check "plan format names the tool that acts on the depends_on key" \
  "one_line '$SP' | grep -qF 'wave-launch.mjs'"

check "plan format documents the inherits key's shape" \
  "one_line '$SP' | grep -qF 'inherits' && one_line '$SP' | grep -qF 'Only one level is followed'"

check "plan format names the tool that acts on the inherits key" \
  "one_line '$SP' | grep -qF 'effectivePlan'"

check "the prose-half bullet states the task heading rule" \
  "one_line '$SP' | grep -qF 'title on the next line' && one_line '$SP' | grep -qF 'lint rejects anything after the id'"

check "the e2e rule requires naming how production wiring is proven" \
  "one_line '$SP' | grep -qF 'production wiring'"

check "the e2e rule names the two accepted proofs" \
  "one_line '$SP' | grep -qF 'either an integration task, or a' && one_line '$SP' | grep -qF 'proving the DI binding and the call site on the real screen or client'"

check "the e2e rule cites the measured unwired-attachments cause" \
  "one_line '$SP' | grep -qF 'an attachments feature passed every contract and was not wired into the production client or the screen'"

summary
