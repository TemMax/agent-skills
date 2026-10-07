#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

SP_CLAUDE="$(contract_source plugins/orchestration/skills/super-plan/SKILL.md)"
SP_CODEX="$(contract_source plugins/orchestration/skills-codex/super-plan/SKILL.md)"
SHIP_CLAUDE="$(contract_source plugins/orchestration/skills/ship/SKILL.md)"
SHIP_CODEX="$(contract_source plugins/orchestration/skills-codex/ship/SKILL.md)"
MM_CLAUDE="$(contract_source plugins/orchestration/skills/multi-model/SKILL.md)"
MM_CODEX="$(contract_source plugins/orchestration/skills-codex/multi-model/SKILL.md)"
ROUTING=plugins/orchestration/skills/multi-model/references/codex-routing.md

one_line() { tr '\n' ' ' < "$1" | tr -s ' '; }

# phrase <text>: store one pinned sentence and print its file, for grep -qFf
phrase() {
  local target="$CONTRACT_SOURCE_DIR/phrase-$(printf '%s' "$1" | shasum | cut -d ' ' -f 1).txt"
  printf '%s' "$1" > "$target"
  printf '%s\n' "$target"
}

# step <file> <start regex> <end regex>: one process step on one line
step() { sed -n "/$2/,/$3/p" "$1" | tr '\n' ' ' | tr -s ' '; }

section "ship asks no question of its own about the branch"

SHIP_NO_GATE="$(phrase 'ship adds no gate of its own and asks nothing before planning: never ask the user to approve the branch, the pull request or the recovery allowance as a question of its own.')"
SHIP_STATED="$(phrase 'super-plan'"'"'s one start approval (its Gate 2) states them: that branch `<name>` will be created and pushed to origin, that the waves will fork from it, and that a PR into the default branch will be opened at the end. After that approval the run goes to the pull request without another approval.')"
SHIP_ALLOWANCE="$(phrase 'In that same start approval, state the standing recovery allowance; do not ask for it:')"
SHIP_STAGE1="$(phrase 'Its design report (Gate 1) and its one start approval (Gate 2) run inside it, and that approval also states the branch, the pull request and the recovery allowance.')"
SHIP_DECLINE="$(phrase '| The user declines super-plan'"'"'s start approval | Stop; nothing was created yet |')"
SHIP_MISTAKE="$(phrase '| Adding a ship-level gate anywhere in the flow | The pipeline stops being automatic | ship adds no gate: super-plan'"'"'s one start approval, then on to the pull request |')"

for pair in "ship (Claude):$SHIP_CLAUDE" "ship (Codex):$SHIP_CODEX"; do
  check "${pair%%:*} Stage 0 adds no gate and asks nothing before planning" \
    "step '${pair#*:}' '^## Stage 0 ' '^## Stage 1 ' | grep -qFf '$SHIP_NO_GATE'"
  check "${pair%%:*} Stage 0 puts the branch and the pull request into super-plan's start approval" \
    "step '${pair#*:}' '^## Stage 0 ' '^## Stage 1 ' | grep -qFf '$SHIP_STATED'"
  check "${pair%%:*} Stage 0 states the recovery allowance in that approval without asking" \
    "step '${pair#*:}' '^## Stage 0 ' '^## Stage 1 ' | grep -qFf '$SHIP_ALLOWANCE'"
  check "${pair%%:*} Stage 0 no longer asks a yes/no about the branch" \
    "! step '${pair#*:}' '^## Stage 0 ' '^## Stage 1 ' | grep -qF 'the only one ship adds' && ! step '${pair#*:}' '^## Stage 0 ' '^## Stage 1 ' | grep -qF 'After yes'"
  check "${pair%%:*} Stage 1 runs the design report and the one start approval inside super-plan" \
    "step '${pair#*:}' '^## Stage 1 ' '^## Stage 2 ' | grep -qFf '$SHIP_STAGE1' && ! one_line '${pair#*:}' | grep -qF 'Its two gates'"
  check "${pair%%:*} Failure map has the row for a declined start approval" \
    "sed -n '/^## Failure map\$/,/^## Common Mistakes\$/p' '${pair#*:}' | grep -qFf '$SHIP_DECLINE'"
  check "${pair%%:*} Common Mistakes forbids a ship-level gate anywhere" \
    "sed -n '/^## Common Mistakes\$/,\$p' '${pair#*:}' | grep -qFf '$SHIP_MISTAKE'"
done

section "super-plan asks only product forks and contradictions"

SP_ASK="$(phrase 'Ask the user only genuine product forks — a requirement the request leaves open whose answer changes what ships — and contradictions in the feature (the plan, the design, the code or a new instruction disagree and the choice changes what ships). With none, ask nothing. Never decide a product fork silently.')"
SP_BATCH="$(phrase 'Collect genuine product forks in one batch.')"
SP_SILENT="$(phrase '| Deciding a product fork silently | The most expensive wrong turn there is | Batch it to the user; in headless mode, record it |')"

for pair in "super-plan (Claude):$SP_CLAUDE" "super-plan (Codex):$SP_CODEX"; do
  check "${pair%%:*} Decisions asks only product forks and contradictions, and nothing with none" \
    "step '${pair#*:}' '^2\. \*\*Decisions\.\*\*' '^3\. \*\*Gate 1 ' | grep -qFf '$SP_ASK'"
  check "${pair%%:*} Decisions still collects product forks in one batch" \
    "step '${pair#*:}' '^2\. \*\*Decisions\.\*\*' '^3\. \*\*Gate 1 ' | grep -qFf '$SP_BATCH'"
  check "${pair%%:*} Common Mistakes keeps the silently decided product fork" \
    "grep -qFf '$SP_SILENT' '${pair#*:}'"
done

section "routes are the coordinator's decision; a premium-or-standard choice is never presented"

SP_ROUTES_CLAUDE="$(phrase 'Routes are your decision: executor tiers, the supervisor and, on Codex, the review model. Never present a premium-or-standard choice to the user, and never ask the user to approve a route or a model. Use the standard route by default')"
SP_ROUTES_CODEX="$(phrase 'Routes are your decision: executor tiers, the supervisor and the review model. Never present a premium-or-standard choice to the user, and never ask the user to approve a route or a model. The supervisor is:')"
SP_PREMIUM_CLAUDE="$(phrase 'A premium model (Fable 5.1 / GPT-6 Astra, any role) is used only when the user said so in this session, or through a standing authorization written in the user'"'"'s or the repository'"'"'s instruction files (`AGENTS.md`, `CLAUDE.md`); record it in `approvals.premium` with the source in `reason`. Without an authorization, use the standard route.')"
SP_PREMIUM_CODEX="$(phrase '- premium: `gpt-6-astra`, used only when the user said so in this session, or through a standing authorization written in the user'"'"'s or the repository'"'"'s instruction files (`AGENTS.md`, `CLAUDE.md`); record it in `approvals.premium` with the source in `reason`. Without an authorization, use the standard route;')"
SP_NO_ROUTE="$(phrase 'When a task has no standard delegated route and there is no premium authorization, cut it into tasks that have one, or mark it for the coordinator'"'"'s own implementation under multi-model'"'"'s step 8 — when that step'"'"'s conditions hold — with one independent check of the diff on the standard review route, and name it with the routes in the Gate 2 message. Only when neither is possible, ask the user once, and name the standing authorization as the way to avoid the question.')"
SP_REFIT="$(phrase 'pick the fitting standard supervisor and say so in the Gate 2 message; when no standard supervisor fits and there is no premium authorization, apply the rule above for a task with no standard delegated route. Never carry the stale supervisor forward.')"
ROUTING_SUPERVISOR="$(phrase 'The wave'"'"'s supervisor is chosen at Gate 1 by the coordinator, and is never put to the user as a premium-or-standard choice: by default the standard `gpt-6.1-sol` at `high`, for a wave whose executors and rungs are all `gpt-6-luna` (see Verification and stops); the premium `gpt-6-astra` at `high` only with authorization — the user'"'"'s word in this session or a standing authorization in instruction files (`AGENTS.md`, `CLAUDE.md`), recorded in `approvals.premium` with the source in `reason`.')"
ROUTING_NO_ROUTE="$(phrase 'Without the user'"'"'s premium authorization the coordinator presents no premium-or-standard choice: it cuts the work into mechanical tasks for the standard route, or makes such a change directly when the direct-fix conditions of multi-model'"'"'s step 8 hold, with one independent check of the diff on the standard review route. Only when neither is possible, it asks the user once and names the standing authorization as the way to avoid the question.')"
ROUTING_REVIEW="$(phrase 'chosen by the coordinator at Gate 1, never by a question to the user: `gpt-6-astra` (premium, only with authorization, recorded in `approvals.premium`) or `gpt-6.1-sol` (measured 2026-09-30: clean 10/10, planted 10/10, PR support 3/4; the PR says so), the standard route and the default.')"
ROUTING_APPROVAL="$(phrase 'The one start approval, given after the design and the lint-clean plan are written, still applies; existing authorization remains valid.')"
ROUTING_KEEP="$(phrase 'Keep super-plan'"'"'s one start approval (its Gate 2; ship asks no branch approval of its own), ship'"'"'s feature-branch discipline, and critical-review'"'"'s fix/publication gates.')"

check "super-plan (Claude) makes routes the coordinator's decision, standard by default" \
  "step '$SP_CLAUDE' '^2\. \*\*Decisions\.\*\*' '^3\. \*\*Gate 1 ' | grep -qFf '$SP_ROUTES_CLAUDE'"
check "super-plan (Codex) makes routes the coordinator's decision, standard by default" \
  "step '$SP_CODEX' '^2\. \*\*Decisions\.\*\*' '^3\. \*\*Gate 1 ' | grep -qFf '$SP_ROUTES_CODEX' && step '$SP_CODEX' '^2\. \*\*Decisions\.\*\*' '^3\. \*\*Gate 1 ' | grep -qF -- '- standard, the default: \`gpt-6.1-sol\`'"
check "super-plan (Claude) uses premium only on the user's word or a standing authorization, recorded with its source" \
  "step '$SP_CLAUDE' '^2\. \*\*Decisions\.\*\*' '^3\. \*\*Gate 1 ' | grep -qFf '$SP_PREMIUM_CLAUDE'"
check "super-plan (Codex) uses premium only on the user's word or a standing authorization, recorded with its source" \
  "step '$SP_CODEX' '^2\. \*\*Decisions\.\*\*' '^3\. \*\*Gate 1 ' | grep -qFf '$SP_PREMIUM_CODEX'"

for pair in "super-plan (Claude):$SP_CLAUDE" "super-plan (Codex):$SP_CODEX"; do
  check "${pair%%:*} handles a task with no standard delegated route without a premium question" \
    "step '${pair#*:}' '^2\. \*\*Decisions\.\*\*' '^3\. \*\*Gate 1 ' | grep -qFf '$SP_NO_ROUTE'"
  check "${pair%%:*} refits the supervisor itself when the Tasks step changes a wave" \
    "step '${pair#*:}' '^2\. \*\*Decisions\.\*\*' '^3\. \*\*Gate 1 ' | grep -qFf '$SP_REFIT'"
  for retired in 'premium or standard, named' 'as the recommended option' 'only when the user picks it' \
                 'Only the user'"'"'s choice is recorded' 're-ask the user before Gate 2' \
                 'chooses the cheaper option' 'picks it to save that cost' 'user chose the premium supervisor'; do
    check "${pair%%:*} no longer says '$retired'" \
      "! one_line '${pair#*:}' | grep -qF \"$retired\""
  done
done

check "codex-routing has the coordinator choose the supervisor, standard by default, premium only with authorization" \
  "one_line '$ROUTING' | grep -qFf '$ROUTING_SUPERVISOR'"
check "codex-routing handles a wave with no standard supervisor without a premium-or-standard choice" \
  "one_line '$ROUTING' | grep -qFf '$ROUTING_NO_ROUTE'"
check "codex-routing has the coordinator choose the review model, standard by default" \
  "one_line '$ROUTING' | grep -qFf '$ROUTING_REVIEW'"
check "codex-routing keeps one start approval and no branch approval" \
  "one_line '$ROUTING' | grep -qFf '$ROUTING_APPROVAL' && one_line '$ROUTING' | grep -qFf '$ROUTING_KEEP'"
for retired in 'chosen by the user at Gate 1' 'branch/publication approval' 'design and lint-clean plan approvals' \
               'does not ask for one'; do
  check "codex-routing no longer says '$retired'" \
    "! one_line '$ROUTING' | grep -qF '$retired'"
done

section "Gate 1 is a report point and does not wait"

GATE1_CLAUDE="$(phrase '3. **Gate 1 — design.** A report point, not an approval. Report a compact summary: architecture, the wave sketch (which tasks, which waves, why), decisions taken, forks the user answered, and the routes (the supervisor and, on Codex, the review model — named, never priced). Do not wait for an answer: go on to the tasks. Stop here only while a product fork or a contradiction is still open.')"
GATE1_CODEX="$(phrase '3. **Gate 1 — design.** A report point, not an approval. Report a compact summary: architecture, the wave sketch (which tasks, which waves, why), decisions taken, forks the user answered, and the routes (the supervisor and the review model — named, never priced). Do not wait for an answer: go on to the tasks. Stop here only while a product fork or a contradiction is still open.')"

check "super-plan (Claude) Gate 1 reports and goes on to the tasks" \
  "step '$SP_CLAUDE' '^3\. \*\*Gate 1 ' '^4\. \*\*Tasks\.\*\*' | grep -qFf '$GATE1_CLAUDE'"
check "super-plan (Codex) Gate 1 reports and goes on to the tasks" \
  "step '$SP_CODEX' '^3\. \*\*Gate 1 ' '^4\. \*\*Tasks\.\*\*' | grep -qFf '$GATE1_CODEX'"
for pair in "super-plan (Claude):$SP_CLAUDE" "super-plan (Codex):$SP_CODEX"; do
  check "${pair%%:*} Gate 1 carries no approval" \
    "! step '${pair#*:}' '^3\. \*\*Gate 1 ' '^4\. \*\*Tasks\.\*\*' | grep -qF 'One approval'"
done
check "super-plan (Codex) single-task path sends the report and the start approval as one message" \
  "one_line '$SP_CODEX' | grep -qF 'The Gate 1 report and the Gate 2 start approval are one message: show the design summary and the lint-clean plan together, then wait for one approval.' && ! one_line '$SP_CODEX' | grep -qF 'Ask one gate instead of two'"
check "multi-model (Codex) single-task path sends the report and the start approval as one message" \
  "one_line '$MM_CODEX' | grep -qF 'The Gate 1 report and the Gate 2 start approval are one message: show the design summary and the lint-clean plan together, then wait for one approval.' && ! one_line '$MM_CODEX' | grep -qF 'Ask one gate instead of two'"

section "Gate 2 is the one start approval"

GATE2_HEAD="$(phrase '7. **Gate 2 — plan.** The start approval, and the only approval. In one message give: the compact design summary (architecture, the wave sketch, decisions taken, forks the user answered); the lint-clean plan file'"'"'s path and its shape — the number of waves, which tasks run in parallel in each wave, and the critical path as a chain of waves with the tasks on it; and the routes (executor tiers, each wave'"'"'s supervisor and')"
GATE2_BRANCH="$(phrase 'review model — named, never priced). When ship runs this skill, the same message also states the branch that will be created and pushed, the pull request that will be opened at the end, and the recovery allowance.')"
GATE2_WAIT="$(phrase 'Never a duration or a cost — see "No time or cost estimates" below. Then wait for the user'"'"'s approval to start. One approval. After it the run goes on — inside ship, to the pull request — without another approval. A new instruction from the user that contradicts the plan is a contradiction: ask.')"
HANDOFF="$(phrase '8. **Handoff.** After the start approval: "Execute with multi-model (supervised waves)."')"
MM_TABLE="$(phrase 'When the plan comes from super-plan, the table is part of super-plan'"'"'s start approval (its Gate 2): show it there, and wait on nothing else.')"

for pair in "super-plan (Claude):$SP_CLAUDE" "super-plan (Codex):$SP_CODEX"; do
  check "${pair%%:*} Gate 2 message names the design summary, the plan's shape and the routes" \
    "step '${pair#*:}' '^7\. \*\*Gate 2 ' '^8\. \*\*Handoff\.\*\*' | grep -qFf '$GATE2_HEAD'"
  check "${pair%%:*} Gate 2 message names the branch, the pull request and the recovery allowance" \
    "step '${pair#*:}' '^7\. \*\*Gate 2 ' '^8\. \*\*Handoff\.\*\*' | grep -qFf '$GATE2_BRANCH'"
  check "${pair%%:*} Gate 2 waits for one approval, then runs on without another; a contradicting instruction is asked" \
    "step '${pair#*:}' '^7\. \*\*Gate 2 ' '^8\. \*\*Handoff\.\*\*' | grep -qFf '$GATE2_WAIT'"
  check "${pair%%:*} has exactly one step that waits for an approval" \
    "[ \$(one_line '${pair#*:}' | grep -oF 'One approval.' | wc -l) -eq 1 ]"
  check "${pair%%:*} Handoff follows the start approval" \
    "one_line '${pair#*:}' | grep -qFf '$HANDOFF'"
done

for pair in "multi-model (Claude):$MM_CLAUDE" "multi-model (Codex):$MM_CODEX"; do
  check "${pair%%:*} table is part of super-plan's start approval and waits on nothing else" \
    "step '${pair#*:}' '^4\. \*\*Table\.\*\*' '^5\. \*\*Write the wave plan file\*\*' | grep -qFf '$MM_TABLE'"
  check "${pair%%:*} no longer ties premium use to super-plan's Gate 1" \
    "! one_line '${pair#*:}' | grep -qF 'for a new feature plan'"
  check "${pair%%:*} still uses premium only on the user's word or a standing authorization" \
    "[ \$(one_line '${pair#*:}' | grep -oF 'only when the user said so: in this session, or through a standing authorization written in the user'\''s or the repository'\''s instruction files (\`AGENTS.md\`, \`CLAUDE.md\`)' | wc -l) -eq 2 ]"
done

section "headless evaluation mode is unchanged"

for pair in "super-plan (Claude):$SP_CLAUDE" "super-plan (Codex):$SP_CODEX"; do
  check "${pair%%:*} headless mode still skips both gates and records the forks" \
    "one_line '${pair#*:}' | grep -qF 'When there is no user to answer gates (an eval harness runs you), skip both gates and record every fork you would have asked under a section titled \`## Assumptions (would ask)\` in the plan file.'"
done

section "no orchestration skill source keeps the retired planning questions"

SOURCES="plugins/orchestration/skills plugins/orchestration/skills-codex"
for retired in 'decide and present the supervisor choice' 'then stop touching the design' 'One yes/no'; do
  check "no orchestration skill source contains '$retired'" \
    "! grep -rqF '$retired' $SOURCES"
  for pair in "super-plan (Claude):$SP_CLAUDE" "super-plan (Codex):$SP_CODEX" \
              "ship (Claude):$SHIP_CLAUDE" "ship (Codex):$SHIP_CODEX" \
              "multi-model (Claude):$MM_CLAUDE" "multi-model (Codex):$MM_CODEX"; do
    check "${pair%%:*} does not say '$retired' across a line break" \
      "! one_line '${pair#*:}' | grep -qF '$retired'"
  done
done

summary
