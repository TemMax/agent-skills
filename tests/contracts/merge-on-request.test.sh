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
  check "$s never bypasses, queues or deletes branches through the merge" "one_line $W | grep -qF 'never with \`--admin\`, \`--auto\`, \`--delete-branch\` or another bypass of the repository'\"'\"'s required checks or reviews'"
  check "$s never pushes to the default branch; no PR is opened or reported" "one_line $W | grep -qF 'and never by a push to the default branch; with no pull request, open one first or report why not.'"
  check "$s stops on a failed check or a refused merge" "one_line $W | grep -qF 'on a failed check or a refused merge, report it and stop'"
  check "$s confirms MERGED before any cleanup, on both paths" "one_line $W | grep -qF 'Before any cleanup — after this merge, or when the user says' && one_line $W | grep -qF 'confirm the merge: \`gh pr view <number> --json state\` shows \`MERGED\`'"
  check "$s confirms through gh or through git, either one" "one_line $W | grep -qF 'shows \`MERGED\`, or \`origin/<default branch>\` after a fetch contains the feature branch or its squashed change.'"
  check "$s puts no condition on the git confirmation" "! one_line $W | grep -qF 'this session can view'"
  check "$s lets gh's state win when gh and git disagree" "one_line $W | grep -qF \"its squashed change. When gh and git disagree, gh's state wins. Anything else\""
  check "$s stops on anything else, a queued or auto-merge pull request included" "one_line $W | grep -qF 'Anything else — a queued or auto-merge pull request included — is reported as not merged yet, and the run stops there.'"
  check "$s cleans up at once" "one_line $W | grep -qF 'Then clean up at once. The cleanup asks no question.'"
  check "$s prunes before the switch" "one_line $W | grep -qF 'Run \`git fetch --prune\`;'"
  check "$s moves the run's checkout off the feature branch first" "one_line $W | grep -qF 'when the checkout this run works in (the \`--repo\` of \`After the merge:\`) is on the feature branch, switch it to the default branch and fast-forward it'"
  check "$s detaches when the default branch is checked out elsewhere" "one_line $W | grep -qF 'When the switch is refused because that branch is checked out in another worktree, detach the checkout at \`origin/<default branch>\` instead'"
  check "$s keeps a switch refused otherwise or a refused fast-forward, never stashes" "one_line $W | grep -qF 'when the switch is refused for another reason, or the fast-forward is refused, leave the checkout as it is, never stash, and say why'"
  check "$s removes local branches only through the script" "one_line $W | grep -qF 'Local branches go only through that script.'"
  check "$s checks the remote tip before deleting" "one_line $W | grep -qF 'and \`git ls-remote --heads origin <feature branch>\` shows the \`tip\` it printed'"
  check "$s names what stayed without a question" "one_line $W | grep -qF 'never deleted, and never turned into a question'"
  check "$s no longer asks about kept entries after the merge" "! one_line $W | grep -qF 'asked about'"
  check "$s no longer switches 'the main checkout'" "! one_line $W | grep -qE '(switch|detach) the main checkout'"
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
  check "$s intro: the default branch changes only through the merge the user asks for" "one_line $W | grep -qF 'the default branch changes only through that pull request'\"'\"'s merge, and only when the user asks for it; then ship merges and cleans up at once'"
  check "$s intro no longer promises an untouched default branch" "! one_line $W | grep -qF 'never a touched default branch'"
  check "$s handoff recommends the merge when nothing is open" "one_line $W | grep -qF \"When nothing is left open — a missing independent review counts as open — that action is the merge, and a yes is the user's word to merge\""
  check "$s pipeline never merges on its own" "one_line $W | grep -qF 'the one decision this pipeline never makes on its own'"
  check "$s mistakes table: merging before the user asks" "grep -qF '| Merging the PR before the user asks |' $W"
  check "$s mistakes table: asking about leftovers" "grep -qF '| Asking about leftovers after the merge |' $W"
done

F=$P/skills/multi-model/references/orchestrator-fable-5-2.md
check "Fable 5.2 profile keeps the merge-on-the-user's-word rule" "one_line $F | grep -qF \"and not the rule that a merge into the default branch happens only on the user's word\""
check "Fable 5.2 profile asks the handoff's one yes/no next action, the merge" "one_line $F | grep -qF \"and its handoff's one yes/no next action — the merge, when nothing is left open\""
check "Fable 5.2 profile needs no approval for the cleanup after the merge" "one_line $F | grep -qF 'once the merge is confirmed, the cleanup after the merge — leaving the feature branch, the \`After the merge:\` command and the remote feature branch deletion it allows'"
check "no profile or skill keeps the never-merge rule" "! grep -rqiF 'never-merge' plugins/"

check "codex-routing: ship merges only when the user asks" \
  "one_line $P/skills/multi-model/references/codex-routing.md | grep -qF 'Ship merges the PR only when the user asks and never deploys.'"
check "README: the agent merges only when asked" "one_line README.md | grep -qF 'the agent merges only when you ask, then cleans up'"
check "README: the cleanup asks nothing" "one_line README.md | grep -qF 'and asks nothing; whatever stays is listed with the reason'"

summary
