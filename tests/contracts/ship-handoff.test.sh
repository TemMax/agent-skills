#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

SKILL="plugins/orchestration/skills/ship/SKILL.md"

one_line() { tr '\n' ' ' < "$1" | tr -s ' '; }

check "Runtime pass line is documented" \
  "one_line '$SKILL' | grep -qF 'Runtime pass:'"

check "standing recovery allowance is documented at ship's gate" \
  "one_line '$SKILL' | grep -qF 'recovery allowance'"

check "the PR body states which waves ran supervised" \
  "one_line '$SKILL' | grep -qF 'ran supervised'"

check "the 'Not verified — manual QA needed' section is preserved" \
  "one_line '$SKILL' | grep -qF 'Not verified — manual QA needed'"

summary
