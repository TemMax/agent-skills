#!/usr/bin/env bash
# The merge into the default branch stays the user's decision, but a session
# merges when the user asks, and after any merge it cleans up at once without a
# question: the checkout leaves the feature branch first, so the cleanup script
# can remove it, and whatever stays is named with its reason.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

P=plugins/orchestration
one_line() { tr '\n' ' ' < "$1" | tr -s ' '; }

for s in skills/multi-model skills-codex/multi-model skills/ship skills-codex/ship; do
  W=$P/$s/WORKFLOW.md
  check "$s merges only on the user's word" "one_line $W | grep -qF \"The merge happens only on the user's word. When the user asks for it, merge the pull\""
  check "$s squashes when the repository allows it" "one_line $W | grep -qF 'squash when the repository allows it, otherwise a method it allows'"
  check "$s never bypasses required checks or reviews" "one_line $W | grep -qF 'never with \`--admin\` or another bypass of the repository'\"'\"'s required checks or reviews'"
  check "$s stops on a failed check or a refused merge" "one_line $W | grep -qF 'on a failed check or a refused merge report it and stop'"
  check "$s cleans up at once after its own merge or the user's" "one_line $W | grep -qF 'Then clean up at once; when the user says'"
  check "$s cleanup asks no question" "one_line $W | grep -qF 'The cleanup asks no question.'"
  check "$s moves the main checkout off the feature branch first" "one_line $W | grep -qF 'switch the main checkout to the default branch and fast-forward it'"
  check "$s detaches when the default branch is checked out elsewhere" "one_line $W | grep -qF 'when that branch is checked out in another worktree, detach the main checkout at \`origin/<default branch>\` instead'"
  check "$s keeps a refused switch and says why" "one_line $W | grep -qF 'when the switch is refused, leave the checkout as it is and say why'"
  check "$s names what stayed without a question" "one_line $W | grep -qF 'never deleted, and never turned into a question'"
  check "$s no longer asks about kept entries after the merge" "! one_line $W | grep -qF 'asked about'"
done

for s in skills/multi-model skills-codex/multi-model; do
  W=$P/$s/WORKFLOW.md
  check "$s keeps the merge with the user" "one_line $W | grep -qF 'The merge into the default branch stays with the user: merge only when the user asks, then clean up at once'"
  check "$s no longer says 'unless the user says otherwise'" "! one_line $W | grep -qF 'unless the user says otherwise'"
done

for s in skills/ship skills-codex/ship; do
  S=$P/$s/SKILL.md
  W=$P/$s/WORKFLOW.md
  check "$s description merges only on request" "sed -n '3p' $S | grep -qF 'merge only when the user asks.'"
  check "$s entry merges only on request" "one_line $S | grep -qF 'merge a pull request into the default branch only when the user asks for it, then clean up at once without a question'"
  check "$s entry no longer forbids every merge" "! grep -qF 'Never merge a pull request into the default branch' $S"
  check "$s intro: ship merges when the user asks" "one_line $W | grep -qF 'happens only when the user asks for it; then ship merges and cleans up at once'"
  check "$s handoff recommends the merge when nothing is open" "one_line $W | grep -qF \"When nothing is left open, that action is the merge, and a yes is the user's word to merge\""
  check "$s pipeline never merges on its own" "one_line $W | grep -qF 'the one decision this pipeline never makes on its own'"
  check "$s mistakes table: merging before the user asks" "grep -qF '| Merging the PR before the user asks |' $W"
  check "$s mistakes table: asking about leftovers" "grep -qF '| Asking about leftovers after the merge |' $W"
done

check "codex-routing: ship merges only when the user asks" \
  "one_line $P/skills/multi-model/references/codex-routing.md | grep -qF 'Ship merges the PR only when the user asks and never deploys.'"
check "README: the agent merges only when asked" "one_line README.md | grep -qF 'the agent merges only when you ask, then cleans up'"
check "README: the cleanup asks nothing" "one_line README.md | grep -qF 'and asks nothing; whatever stays is listed with the reason'"

summary
