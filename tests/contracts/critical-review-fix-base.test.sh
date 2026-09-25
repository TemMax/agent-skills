#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

SKILL="plugins/code-review/skills/critical-review/SKILL.md"

one_line() { tr '\n' ' ' < "$1" | tr -s ' '; }

check "fix wave base is the pushed PR head via git rev-parse origin/<pr-branch>" \
  "one_line '$SKILL' | grep -qF 'git rev-parse origin/<pr-branch>'"

check "fix wave base is never local HEAD" \
  "one_line '$SKILL' | grep -qF 'never local \`HEAD\`'"

check "fix wave base cites the measured 15-agent-call refusal cause" \
  "one_line '$SKILL' | grep -qF 'a fix wave launched on an unpushed local \`HEAD\` spent 15 agent calls before every executor refused'"

check "fix-wave plan tasks are appended as a new plan or via inherits, never by flipping done back to active" \
  "one_line '$SKILL' | grep -qF 'appended as a new plan, or as a plan with \`inherits\` pointing at the shipped plan' && one_line '$SKILL' | grep -qF 'never by flipping the shipped plan'\''s \`done\` status back to \`active\`'"

check "an earlier approval to implement directly does not extend to review findings" \
  "one_line '$SKILL' | grep -qF 'does not extend to review findings'"

check "the findings-gate rule cites the measured inline-fix-and-double-push cause" \
  "one_line '$SKILL' | grep -qF 'an orchestrator fixed final-review findings inline and pushed twice without showing findings'"

summary
