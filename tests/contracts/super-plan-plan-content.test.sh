#!/usr/bin/env bash
# super-plan's plan-content rules synced from superpowers v7.0.1: a plan
# records decisions, not code; tasks name their interfaces; a review focus
# pins the inputs the request implies; technical defaults are asked or named.
# Both the Claude and the Codex workflow must carry each rule.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

one_line() { tr '\n' ' ' < "$1" | tr -s ' '; }

for tree in skills skills-codex; do
  SP="$(contract_source plugins/orchestration/$tree/super-plan/SKILL.md)"
  section "super-plan plan content ($tree)"

  check "$tree: the sync point with superpowers is named" \
    "one_line '$SP' | grep -qF 'last synced with v7.0.1'"
  check "$tree: no task prose carries full code by default" \
    "! one_line '$SP' | grep -qiF 'full code'"
  check "$tree: a task section is unambiguous, not complete" \
    "one_line '$SP' | grep -qF 'unambiguous, not complete'"
  check "$tree: a body appears only for an undetermined algorithm or fixed text" \
    "one_line '$SP' | grep -qF 'A body appears only for an algorithm the signature and tests do not determine'"
  check "$tree: lines that decide nothing are named as the opposite failure" \
    "one_line '$SP' | grep -qF '\"handle edge cases\"'"
  check "$tree: the upstream measurement is labelled as upstream" \
    "one_line '$SP' | grep -qF 'Measured upstream (superpowers 6.4.2)'"
  check "$tree: project-wide constraints are copied into every task they bind" \
    "one_line '$SP' | grep -qF 'copied verbatim into every task they bind'"
  check "$tree: tasks carry Consumes and Produces interfaces" \
    "one_line '$SP' | grep -qF '\`Consumes:\` with the exact signatures'"
  check "$tree: the seam audit checks interfaces across waves" \
    "one_line '$SP' | grep -qF 'Every \`Consumes:\` line matches a \`Produces:\` line'"
  check "$tree: the seam audit runs five further checks" \
    "one_line '$SP' | grep -qF 'The audit also runs five further checks'"
  check "$tree: the review focus pins each line with a test in the owning task" \
    "one_line '$SP' | grep -qF 'pin each line with a test in the task that owns the code'"
  check "$tree: an empty review focus says none found" \
    "one_line '$SP' | grep -qF '\`none found\`'"
  check "$tree: plan-level sections sit above the first task" \
    "one_line '$SP' | grep -qF 'sits above the first \`## Task\` section'"
  check "$tree: task parts never use a level-2 heading" \
    "one_line '$SP' | grep -qF 'never with a \`## \` heading, which ends the section'"
  check "$tree: a contract-first wave writes signatures, not the implementation" \
    "one_line '$SP' | grep -qF 'its signatures and formats written out in full in the plan (not its implementation)'"
  check "$tree: proportion is checked against the spec" \
    "one_line '$SP' | grep -qF 'A plan several times longer than its spec'"
  check "$tree: an unsettled platform or language is a product fork" \
    "one_line '$SP' | grep -qF 'is a product fork when the request leaves it open and the repository does not settle it'"
  check "$tree: a settled technical default is named at Gate 1" \
    "one_line '$SP' | grep -qF 'decide it and name it among the decisions taken at Gate 1'"
  check "$tree: never ask what research already answers" \
    "one_line '$SP' | grep -qF 'never ask what they already answer'"
  check "$tree: superpowers drafts keep their interfaces and review focus" \
    "one_line '$SP' | grep -qF 'put each Interfaces block in its task'\''s prose'"
done

check "the attribution notice names the sync point" \
  "grep -qF 'last synced with v7.0.1' plugins/orchestration/skills/super-plan/references/LICENSE-superpowers"

summary
