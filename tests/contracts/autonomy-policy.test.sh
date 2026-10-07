#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

MM_CLAUDE="$(contract_source plugins/orchestration/skills/multi-model/SKILL.md)"
MM_CODEX="$(contract_source plugins/orchestration/skills-codex/multi-model/SKILL.md)"
SHIP_CLAUDE="$(contract_source plugins/orchestration/skills/ship/SKILL.md)"
SHIP_CODEX="$(contract_source plugins/orchestration/skills-codex/ship/SKILL.md)"
CR_CLAUDE="$(contract_source plugins/code-review/skills/critical-review/SKILL.md)"
CR_CODEX="$(contract_source plugins/code-review/skills-codex/critical-review/SKILL.md)"

one_line() { tr '\n' ' ' < "$1" | tr -s ' '; }

section "the user's direct instruction wins in every coordinator source"

for pair in "multi-model (Claude):$MM_CLAUDE" "multi-model (Codex):$MM_CODEX" \
            "ship (Claude):$SHIP_CLAUDE" "ship (Codex):$SHIP_CODEX" \
            "critical-review (Claude):$CR_CLAUDE" "critical-review (Codex):$CR_CODEX"; do
  check "${pair%%:*} states that the user's direct instruction wins" \
    "one_line '${pair#*:}' | grep -qF 'The user'\''s direct instruction wins'"
done

section "the coordinator chooses the fix route itself; premium needs the user's word"

for pair in "multi-model (Claude):$MM_CLAUDE" "multi-model (Codex):$MM_CODEX"; do
  check "${pair%%:*} tells the coordinator to choose the fix route itself" \
    "one_line '${pair#*:}' | grep -qF 'Choose the fix route yourself.' && one_line '${pair#*:}' | grep -qF 'Never ask the user to approve a route or a model.'"
  check "${pair%%:*} names the standing authorization in instruction files" \
    "one_line '${pair#*:}' | grep -qF 'a standing authorization written in the user'\''s or the repository'\''s instruction files (\`AGENTS.md\`, \`CLAUDE.md\`)'"
  check "${pair%%:*} never makes a premium model the subject of a question" \
    "one_line '${pair#*:}' | grep -qF 'Premium models are never the subject of a question.'"
done

section "no skill source keeps the retired absolute rules"

SOURCES="plugins/orchestration/skills plugins/orchestration/skills-codex plugins/code-review/skills plugins/code-review/skills-codex"
for phrase in 'does not cover review fixes' 'never fall back to self-implementation' 'at this fix gate'; do
  check "no orchestration or code-review skill source contains '$phrase'" \
    "! grep -rqF '$phrase' $SOURCES"
done

section "the four Codex session-rule files carry the new rule 3"

RULE3='3. Applying a patch a subagent prepared, running `apply_patch`, or editing a tracked file yourself is authoring code, whoever wrote the text. The user'"'"'s direct instruction wins: when the user tells you in this session how to carry out a change — "fix it yourself", "do it and check it yourself", "no agents", "use agents", "use this model" — do exactly that, whatever the change is (a review finding, a supervisor'"'"'s or the final review'"'"'s defect, part of an approved plan), and never answer with a request to approve another route. Without such an instruction choose the route yourself and never ask the user to approve it: author the change yourself when you can state the exact change before making it, it stays inside the task already agreed with the user and inside one module or subsystem, no new public interface, data format or product behavior has to be decided, and checks that cover it exist or are added with it and can be run here; anything else goes to a supervised wave on the standard route. When you author a change, run the covering checks and show the diff.'
RULE3_FILE="$CONTRACT_SOURCE_DIR/rule3.txt"
printf '%s' "$RULE3" > "$RULE3_FILE"

for file in plugins/orchestration/skills-codex/multi-model/SKILL.md \
            plugins/orchestration/skills-codex/super-plan/WORKFLOW.md \
            plugins/orchestration/skills-codex/ship/WORKFLOW.md \
            plugins/code-review/skills-codex/critical-review/PROFILE.md; do
  check "$file carries the new rule 3" \
    "one_line '$file' | grep -qFf '$RULE3_FILE'"
  check "$file no longer forbids the coordinator to author code" \
    "! grep -qF 'The coordinator never authors code.' '$file'"
done

# phrase <text>: store one pinned sentence and print its file, for grep -qFf
phrase() {
  local target="$CONTRACT_SOURCE_DIR/phrase-$(printf '%s' "$1" | shasum | cut -d ' ' -f 1).txt"
  printf '%s' "$1" > "$target"
  printf '%s\n' "$target"
}

section "a missing review capability does not stop ship and is never hidden"

NO_REVIEW="$(phrase 'When the review capability is missing, ship does not stop and does not ask: it opens the pull request with the explicit line `independent review not performed` in the body and in the handoff report, and leaves the review and the merge to the user. It never presents its own check as an independent review.')"
NO_REVIEW_BODY="$(phrase 'When the review capability is missing, the body also carries the line `independent review not performed`.')"
NO_REVIEW_STEP="$(phrase 'When the review capability is missing, do not stop and do not ask: skip this step and steps 5 and 6, put the line `independent review not performed` in the handoff report too, and leave the review and the merge to the user. Step 1 is ship'"'"'s own check; never present it as an independent review.')"
NO_REVIEW_ROW="$(phrase '| The review capability is missing | Do not stop and do not ask: open the PR with the line `independent review not performed` in the body and in the handoff report, and leave the review and the merge to the user. Never present ship'"'"'s own check as an independent review |')"

for pair in "ship (Claude):$SHIP_CLAUDE" "ship (Codex):$SHIP_CODEX"; do
  check "${pair%%:*} no longer stops when the review capability is missing" \
    "! one_line '${pair#*:}' | grep -qF 'Missing required review capability stops the route' && ! one_line '${pair#*:}' | grep -qF 'never authorizes self-review or publication'"
  check "${pair%%:*} opens the pull request with the explicit line and leaves review and merge to the user" \
    "one_line '${pair#*:}' | grep -qFf '$NO_REVIEW'"
  check "${pair%%:*} Stage 3 carries the line in the body and in the handoff report, and skips the review steps" \
    "sed -n '/^## Stage 3 — Review\$/,/^## Stage 4 — Handoff\$/p' '${pair#*:}' | tr '\\n' ' ' | tr -s ' ' | grep -qFf '$NO_REVIEW_BODY' && sed -n '/^## Stage 3 — Review\$/,/^## Stage 4 — Handoff\$/p' '${pair#*:}' | tr '\\n' ' ' | tr -s ' ' | grep -qFf '$NO_REVIEW_STEP'"
  check "${pair%%:*} Failure map has the row for a missing review capability" \
    "sed -n '/^## Failure map\$/,/^## Common Mistakes\$/p' '${pair#*:}' | grep -qFf '$NO_REVIEW_ROW'"
done

section "inside ship the pipeline's own findings are shown and fixed without a request"

SHIP_FIX="$(phrase 'Inside ship the user already asked for a reviewed pull request. Show the findings table in the report, then invoke critical-review'"'"'s shared Post-Review Fix Protocol without waiting for a request, for every finding that produces a fix, including an `own` finding with no PR threads. The findings are always shown before or with the fixes, never hidden.')"
SHIP_ASK="$(phrase 'A finding whose fix needs one of the decisions Stage 0 says to ask the user about is not fixed: list it and ask. A finding that answers a thread started by someone else keeps that protocol'"'"'s gate.')"
SHIP_STAGE0="$(phrase 'Ask the user only for: a contradiction in the feature (the plan, the design, the code or a new instruction disagree and the choice changes what ships); a change of the agreed scope; weakening or removing a test or check; an irreversible action on something this run did not create; an action only the user can take.')"
SHIP_OUTWARD="$(phrase 'It asks once before replies or resolves in threads started by someone else, and before a push to a branch or pull request that is not the user'"'"'s own. The order is always `push → replies → resolves`. The merge into the default branch stays with the user.')"
CR_OWN="$(phrase 'For a review the user asked for on its own, everything in this section applies **only after the user, having seen the findings table, asked for the findings to be fixed.** Until then the review is read-only, as Review Method item 6 requires.')"
CR_SHIP="$(phrase 'When the review runs as a stage of ship on the pipeline'"'"'s own pull request, the user already asked for a reviewed pull request: the findings table is shown and the fixes start without a separate request.')"
CR_SHOWN="$(phrase 'The findings are always shown before or with the fixes, never hidden. For a review the user asked for on its own, the findings are a separate gate every time: the user sees the findings table produced by this review, and only then do fixes start. Measured cause: an orchestrator fixed final-review findings inline and pushed twice without showing findings.')"
CR_ENTRY="$(phrase 'Review is read-only. Only after the user has seen findings and explicitly asks for fixes — or, as a stage of ship on the pipeline'"'"'s own pull request, once the findings are shown — load [FIXES.md](FIXES.md) before fix preflight or any change.')"

for pair in "ship (Claude):$SHIP_CLAUDE" "ship (Codex):$SHIP_CODEX"; do
  check "${pair%%:*} no longer waits for a request to fix its own review's findings" \
    "! one_line '${pair#*:}' | grep -qF 'Preserve critical-review'\''s prerequisite' && ! one_line '${pair#*:}' | grep -qF 'every approved finding'"
  check "${pair%%:*} shows the findings table and fixes through the Post-Review Fix Protocol without a request" \
    "one_line '${pair#*:}' | grep -qFf '$SHIP_FIX'"
  check "${pair%%:*} lists and asks about a finding that needs the user's decision, and keeps the gate of someone else's thread" \
    "one_line '${pair#*:}' | grep -qFf '$SHIP_ASK' && one_line '${pair#*:}' | grep -qFf '$SHIP_STAGE0'"
  check "${pair%%:*} still asks before outward steps that are not the user's own and leaves the merge to the user" \
    "one_line '${pair#*:}' | grep -qFf '$SHIP_OUTWARD'"
done

for pair in "critical-review (Claude):$CR_CLAUDE" "critical-review (Codex):$CR_CODEX"; do
  check "${pair%%:*} keeps the request gate for a review the user asked for on its own" \
    "one_line '${pair#*:}' | grep -qFf '$CR_OWN'"
  check "${pair%%:*} starts the fixes without a separate request as a stage of ship" \
    "one_line '${pair#*:}' | grep -qFf '$CR_SHIP'"
  check "${pair%%:*} always shows the findings before or with the fixes and keeps the measured cause" \
    "one_line '${pair#*:}' | grep -qFf '$CR_SHOWN'"
done

for file in plugins/code-review/skills/critical-review/SKILL.md \
            plugins/code-review/skills-codex/critical-review/SKILL.md; do
  check "$file entrypoint names the ship case and keeps 'explicitly asks'" \
    "one_line '$file' | grep -qFf '$CR_ENTRY'"
done

section "critical-review states what the agent may ask about"

CR_ASK="$(phrase '2. **Choose the fix route yourself.** Never ask the user to approve a route or a model. Ask the user only for a contradiction in the feature, a change of the agreed scope, weakening or removing a test or check, an irreversible action on something this run did not create, or an action only the user can take; step 6 gates the outward steps that are not the user'"'"'s own. The first rule decides whenever it applies:')"
CR_GATE="$(phrase '6. **Gate only what is not the user'"'"'s own**: replies and resolves in threads started by someone else (the root comment'"'"'s author is another login), and a push to a branch or pull request that is not the user'"'"'s own.')"
CR_MERGE="$(phrase 'A merge is never part of this protocol; it needs the user'"'"'s word.')"

for pair in "critical-review (Claude):$CR_CLAUDE" "critical-review (Codex):$CR_CODEX"; do
  check "${pair%%:*} lists the only decisions the user is asked for" \
    "one_line '${pair#*:}' | grep -qFf '$CR_ASK'"
  check "${pair%%:*} still gates the outward steps that are not the user's own, and the merge" \
    "one_line '${pair#*:}' | grep -qFf '$CR_GATE' && one_line '${pair#*:}' | grep -qFf '$CR_MERGE'"
done

summary
