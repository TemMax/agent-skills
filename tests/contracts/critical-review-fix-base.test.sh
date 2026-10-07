#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

SKILL="$(contract_source plugins/code-review/skills/critical-review/SKILL.md)"

one_line() { tr '\n' ' ' < "$1" | tr -s ' '; }

check "fix wave base is the pushed PR head via git rev-parse origin/<pr-branch>" \
  "one_line '$SKILL' | grep -qF 'git rev-parse origin/<pr-branch>'"

check "fix wave base is never local HEAD" \
  "one_line '$SKILL' | grep -qF 'never local \`HEAD\`'"

check "fix wave base cites the measured 15-agent-call refusal cause" \
  "one_line '$SKILL' | grep -qF 'a fix wave launched on an unpushed local \`HEAD\` spent 15 agent calls before every executor refused'"

check "fix-wave plan tasks are appended as a new plan or via inherits, never by flipping done back to active" \
  "one_line '$SKILL' | grep -qF 'appended as a new plan, or as a plan with \`inherits\` pointing at the shipped plan' && one_line '$SKILL' | grep -qF 'never by flipping the shipped plan'\''s \`done\` status back to \`active\`'"

check "fixes start only after the user saw the findings table of this review" \
  "one_line '$SKILL' | grep -qF 'Review findings are a separate gate every time: the user sees the findings table produced by this review, and only then do fixes start'"

check "the user's direct instruction about how to fix wins" \
  "one_line '$SKILL' | grep -qF 'The user'\''s direct instruction wins. When the user tells the coordinator in this session how to carry out a change' && one_line '$SKILL' | grep -qF 'do exactly that, whatever the change is, and never answer with a request to approve another route'"

check "the direct-instruction sentence is on one line in both hosts" \
  "grep -q \"The user's direct instruction wins\" plugins/code-review/skills/critical-review/FIXES.md && grep -q \"The user's direct instruction wins\" plugins/code-review/skills-codex/critical-review/FIXES.md"

check "the protocol covers only findings of a review the user asked for in this session" \
  "one_line '$SKILL' | grep -qF 'These rules apply only to findings of a review the user asked for in this session. A plain request to change code is implementation work, not a review fix'"

check "no rule tells the coordinator never to fix a finding itself" \
  "! grep -rn 'never fall back to self-implementation' plugins/code-review && ! grep -rn 'the coordinator never authors a fix' plugins/code-review"

check "a missing delegated capability leads to a direct fix, not a stop" \
  "one_line '$SKILL' | grep -qF 'When a required skill, host, model, or effort is unavailable, fix directly with the checks of a direct fix and say so in the report; do not stop'"

check "a later fix plan inherits the plan that carries the premium authorization" \
  "one_line '$SKILL' | grep -qF 'A later fix plan of the same pull request \`inherits\` the plan that already carries the user'\''s premium authorization, so nothing is asked again'"

check "the findings-gate rule cites the measured inline-fix-and-double-push cause" \
  "one_line '$SKILL' | grep -qF 'an orchestrator fixed final-review findings inline and pushed twice without showing findings'"

summary
