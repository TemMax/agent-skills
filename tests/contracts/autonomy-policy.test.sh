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

summary
