#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

SKILL="plugins/orchestration/skills/ship/SKILL.md"

one_line() { tr '\n' ' ' < "$1" | tr -s ' '; }

check "preflight keeps the 'contract preflight at the pushed tip' phrase" \
  "one_line '$SKILL' | grep -qF 'contract preflight at the pushed tip'"

check "preflight runs each must_run in a fresh worktree" \
  "one_line '$SKILL' | grep -qF 'fresh worktree'"

check "preflight never runs in the main checkout" \
  "one_line '$SKILL' | grep -qF 'never runs in the main checkout'"

check "failure map and Stage 2 step 5 cover environment-blocked" \
  "one_line '$SKILL' | grep -qF 'environment-blocked'"

check "red-suite-after-merge row allows pushing the red tip to the feature branch only" \
  "one_line '$SKILL' | grep -qF 'feature branch only'"

check "every stop ends with one recommended next action" \
  "one_line '$SKILL' | grep -qF 'recommended next action'"

check "local merges of task branches into the feature branch need no extra approval" \
  "one_line '$SKILL' | grep -qF 'Local merges'"

check "the preflight no longer claims to warm the build caches" \
  "! grep -qF 'warms the build caches' '$SKILL'"

check "'merge stays with the user' is preserved" \
  "one_line '$SKILL' | grep -qF 'merge stays with the user'"

summary
