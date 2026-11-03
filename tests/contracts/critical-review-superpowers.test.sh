#!/usr/bin/env bash
# critical-review rules adapted from superpowers 6.4.1 (requesting- and
# receiving-code-review): behavior the requirements do not name is judged by a
# reasonable user's expectation; a Set aside list; disputed PR threads; a
# rationale or a plan never lowers a tier. Both hosts carry each rule, and
# ship rules on every Set aside line.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

one_line() { tr '\n' ' ' < "$1" | tr -s ' '; }

for tree in skills skills-codex; do
  CR="$(contract_source plugins/code-review/$tree/critical-review/SKILL.md)"
  section "critical-review ($tree)"
  check "$tree: unnamed behavior is judged by a reasonable user's expectation" \
    "one_line '$CR' | grep -qF 'Judge behavior they are silent on by what a reasonable person using this software would expect'"
  check "$tree: a crash on an implied input is Important, not Medium" \
    "one_line '$CR' | grep -qF 'a crash on an input the request implies is Important, not Medium'"
  check "$tree: Important covers unnamed behavior a user expects" \
    "one_line '$CR' | grep -qF 'including behavior a reasonable user expects that the requirements do not name'"
  check "$tree: Medium is limited to rare inputs" \
    "one_line '$CR' | grep -qF 'edge-case bugs on inputs a user would rarely meet'"
  check "$tree: the review lists what it set aside" \
    "one_line '$CR' | grep -qF 'list every behavior you considered and set aside'"
  check "$tree: an empty Set aside list is explicit" \
    "one_line '$CR' | grep -qF 'Write \`Set aside: none\`'"
  check "$tree: a stated rationale never lowers a tier" \
    "one_line '$CR' | grep -qF 'a rationale never lowers a tier'"
  check "$tree: a plan-required defect is labeled plan-mandated" \
    "one_line '$CR' | grep -qF 'labeled \`plan-mandated\`'"
  check "$tree: added warnings in test or build output are a finding" \
    "one_line '$CR' | grep -qF 'warnings or other noise the diff adds to test or build output are a finding'"
  check "$tree: a disputed thread is marked before the code is read" \
    "one_line '$CR' | grep -qF 'mark it in the ledger and check it once the code is read (step 4)'"
  check "$tree: a disputed thread is checked against the code after reading it" \
    "one_line '$CR' | grep -qF 'read the code itself. Check each disputed thread against the code before carrying its request as a finding'"
  check "$tree: a disputed thread is listed outside the findings table" \
    "one_line '$CR' | grep -qF 'list it after the table under \`Disputed\`'"
  check "$tree: a plan-mandated finding covers behavior a user would call wrong" \
    "one_line '$CR' | grep -qF 'behavior a reasonable user would call wrong — it is still a finding at its tier'"
  check "$tree: a not-changed reply carries its evidence" \
    "one_line '$CR' | grep -qF 'for a disputed thread the user chose not to change, why not, with the evidence'"
  check "$tree: a reviewer's request is never adopted on authority" \
    "one_line '$CR' | grep -qF 'never adopt a request because a reviewer made it'"
  check "$tree: a disputed thread gets a not-changed reply and stays open" \
    "one_line '$CR' | grep -qF '> Not changed —'"

  SHIP="$(contract_source plugins/orchestration/$tree/ship/SKILL.md)"
  check "$tree: ship rules on every Set aside line" \
    "one_line '$SHIP' | grep -qF 'Rule on each line of the review'\''s Set aside list'"
  check "$tree: ship asks before a set-aside fix widens the scope" \
    "one_line '$SHIP' | grep -qF 'widening the scope is a Stage 0 decision and is asked'"
  check "$tree: ship sends plan-mandated and disputed items to the user" \
    "one_line '$SHIP' | grep -qF 'go to the user with their evidence, not to a fix'"
done

summary
