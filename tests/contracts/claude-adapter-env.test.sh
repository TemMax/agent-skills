#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

CWA="plugins/orchestration/skills/multi-model/references/claude-wave-adapter.md"

one_line() { tr '\n' ' ' < "$1" | tr -s ' '; }

check "the phrase 'Preflight the contracts at the base' survives" \
  "grep -qF 'Preflight the contracts at the base' $CWA"

check "the preflight runs in a fresh worktree, not the main checkout" \
  "one_line '$CWA' | grep -qF 'fresh worktree'"

check "wave-launch.mjs refuses a base not on origin/<default-branch>" \
  "one_line '$CWA' | grep -qF 'origin/<default-branch>'"

check "wave-launch.mjs refuses an unmet depends_on" \
  "one_line '$CWA' | grep -qF 'depends_on'"

check "a task can end environment-blocked, and it is documented" \
  "one_line '$CWA' | grep -qF 'environment-blocked'"

check "the claim that preflight warms the build caches is gone" \
  "! one_line '$CWA' | grep -qF 'warms the build caches'"

summary
