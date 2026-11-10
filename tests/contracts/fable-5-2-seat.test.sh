#!/usr/bin/env bash
# Fable 5.2 (`claude-fable-5-2`) runs only as the user's session — the
# orchestrator seat and the reviewer seat — and never as a child of a plan
# (ADR 019). These checks pin the profile routing, the seat-only rule and the
# places that keep the model out of plans.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

MM="$(mktemp)"
trap 'rm -f "$MM"' EXIT
python3 tests/lib/skill-source.py plugins/orchestration/skills/multi-model/SKILL.md > "$MM"
SP="$(contract_source plugins/orchestration/skills/super-plan/SKILL.md)"
SH="$(contract_source plugins/orchestration/skills/ship/SKILL.md)"
CR="$(contract_source plugins/code-review/skills/critical-review/SKILL.md)"
OF=plugins/orchestration/skills/multi-model/references/orchestrator-fable-5-2.md
RF=plugins/code-review/skills/critical-review/references/reviewer-fable-5-2.md
PL=plugins/orchestration/skills/super-plan/references/plan-lint.mjs
WR=plugins/orchestration/skills/multi-model/references/wave-runner.workflow.mjs
DOSSIER=plugins/orchestration/skills/multi-model/references/model-dossiers.md
RDOSSIER=plugins/code-review/skills/critical-review/references/reviewer-dossier.md
ADR=docs/decisions/019-fable-5-2.md

one_line() { tr '\n' ' ' < "$1" | tr -s ' '; }

section "Step 0 routes claude-fable-5-2 to its own profiles"
check "multi-model routes fable-5-2 to its profile" \
  "grep -qF '| \`claude-fable-5-2\` | \`references/orchestrator-fable-5-2.md\` |' '$MM'"
check "super-plan routes fable-5-2 to its profile" \
  "grep -qF '| \`claude-fable-5-2\` | \`../multi-model/references/orchestrator-fable-5-2.md\` |' '$SP'"
check "ship routes fable-5-2 to its profile" \
  "grep -qF '| \`claude-fable-5-2\` | \`../multi-model/references/orchestrator-fable-5-2.md\` |' '$SH'"
check "critical-review routes fable-5-2 to its profile" \
  "grep -qF '| \`claude-fable-5-2\` | \`references/reviewer-fable-5-2.md\` |' '$CR'"
check "the Fable 5.1 rows stay" \
  "grep -qF '| \`claude-fable-5-1\` | \`references/orchestrator-fable-5-1.md\` |' '$MM' && grep -qF '| \`claude-fable-5-1\` | \`references/reviewer-fable-5-1.md\` |' '$CR'"

section "the profiles gate on their model ID"
for f in "$OF" "$RF"; do
  check "$(basename "$f") ships" "[ -f '$f' ]"
  check "$(basename "$f") gates on claude-fable-5-2" "grep -qF 'claude-fable-5-2' '$f'"
  check "$(basename "$f") tells a mismatched model to stop" "grep -qF 'stop reading it' '$f'"
  check "$(basename "$f") names Fable 5.1 and Fable 5 as different models" \
    "one_line '$f' | grep -qF '\`claude-fable-5-1\` and \`claude-fable-5\` are different models'"
  check "$(basename "$f") cites its system card" \
    "one_line '$f' | grep -qF 'Claude Fable 5.2 & Mythos 5.2 system card (264 pp., 2026-11-09)'"
  check "$(basename "$f") has an effort self-check" "grep -qF '**Effort self-check.**' '$f'"
done

section "Fable 5.2 runs only as the seat"
check "the orchestrator profile states the seat-only rule" \
  "grep -q '^## Your Seat Only$' '$OF' && one_line '$OF' | grep -qF 'never a child of a plan'"
check "the orchestrator profile never asks for a restart at another effort" \
  "one_line '$OF' | grep -qF 'Never ask the user to restart at a different effort.'"
check "the orchestrator profile routes research off-seat" \
  "one_line '$OF' | grep -qF 'routed research agents (Research Routing table, a named model on every spawn)'"
check "the multi-model overview states the seat-only rule" \
  "one_line '$MM' | grep -qF 'Fable 5.2 (\`claude-fable-5-2\`) runs only as the coordinator'\\''s own seat — never a child of any kind: executor, research agent, ladder rung or supervisor (ADR 019).'"
check "the alias table maps fable to Fable 5.2 and forbids spawning through it" \
  "grep -qF '| Fable 5.2 (the coordinator'\\''s own seat only — never a plan model) | \`claude-fable-5-2\` | \`fable\` (probed 2026-11-10, Claude Code 2.1.322) — never spawn through it |' '$MM'"
check "the alias table no longer maps fable to Fable 5.1" \
  "grep -qF '| Fable 5.1 | \`claude-fable-5-1\` | none (\`fable\` moved to Fable 5.2 by 2026-11-10) |' '$MM'"
check "Fable 5.1 is spawned only through Workflow agent()" \
  "one_line '$MM' | grep -qF 'A model without an alias (Opus 5, Opus 4.8, Fable 5.1, and the retired Sonnet 5 and Haiku 4.5) is spawned only through Workflow \`agent()\`.'"
check "no spawn goes through the fable alias" \
  "one_line '$MM' | grep -qF 'Never spawn through \`fable\`: it resolves to Fable 5.2'"
check "the supervisor rule keeps Fable 5.2 out" \
  "one_line '$MM' | grep -qF 'Fable 5.2 (\`claude-fable-5-2\`) is never a supervisor, executor or rung'"
check "super-plan says claude-fable-5-2 is not a plan model" \
  "one_line '$SP' | grep -qF '\`claude-fable-5-2\` is not a plan model'"
check "super-plan's allowed Claude models leave out claude-fable-5-2" \
  "grep -F '| Claude | \`claude-haiku-5-5\`' '$SP' | grep -qvF 'claude-fable-5-2'"
check "the linter's Claude models leave out claude-fable-5-2" \
  "! grep -qF \"'claude-fable-5-2'\" '$PL'"
check "the runner never names claude-fable-5-2" \
  "! grep -qF 'claude-fable-5-2' '$WR'"
check "research on a Fable seat never inherits the seat (multi-model)" \
  "one_line '$MM' | grep -qF 'on a Fable seat (5, 5.1 or 5.2) that silently bills file listings'"
check "research on a Fable seat never inherits the seat (super-plan)" \
  "one_line '$SP' | grep -qF 'a Fable seat (5, 5.1 or 5.2) then pays Fable prices for file listings'"

section "the seat asks where the process asks and spawns nothing on itself"
check "the orchestrator profile takes its questions from the process" \
  "one_line '$OF' | grep -qF 'Ask where the process asks, and nowhere else.'"
for q in 'product forks and contradictions' 'a change of the agreed scope' \
  'weakening or removing a test or check' \
  'a contract amendment that drops or weakens a \`must_run\` is one yes/no question' \
  'an irreversible action on something this run did not create' 'an action only the user can take' \
  '\`plan-mandated\` findings, \`Disputed\` threads and scope-widening Set aside lines'; do
  check "the orchestrator profile keeps the question: $q" "one_line '$OF' | grep -qF \"$q\""
done
check "no closed list of approvals in the orchestrator profile" \
  "! one_line '$OF' | grep -qE 'Ask only at the named approvals|The approvals here are'"
check "the orchestrator profile's mistakes table says to ask where the process asks" \
  "grep -qF '| Ask exactly where the process says to ask |' '$OF'"
check "the reviewer profile takes its questions from critical-review" \
  "one_line '$RF' | grep -qF 'ask where critical-review asks, and nowhere else.' && one_line '$RF' | grep -qF 'weakening or removing a test or check'"
check "every spawn from the orchestrator seat names its model" \
  "one_line '$OF' | grep -qF 'every spawn names its model: an unnamed spawn inherits you'"
check "every spawn from the reviewer seat names a routed model" \
  "one_line '$RF' | grep -qF 'every spawn names a routed model. An unnamed spawn inherits you'"
for f in "$OF" "$RF"; do
  check "$(basename "$f") runs the independent check on Opus 5.5" \
    "one_line '$f' | grep -qF '\`model: opus\` and \`claude-opus-5-5\` named in the prompt'"
done
check "no claim that the linter checks every model field" \
  "! one_line '$OF' | grep -qF 'in every model field' && ! one_line '$ADR' | grep -qF 'in every model field'"

section "dossiers, README, prices and the decision record"
check "the multi-model dossier has a Fable 5.2 section" \
  "grep -q '^## Fable 5.2 (orchestrator seat only' '$DOSSIER'"
check "the reviewer dossier has a Fable 5.2 section" \
  "grep -q '^## Fable 5.2 as a reviewer of its own code' '$RDOSSIER'"
check "the multi-model references list the Fable 5.2 profile" \
  "one_line '$MM' | grep -qF '\`references/orchestrator-fable-5-2.md\`'"
check "critical-review's references list the Fable 5.2 profile" \
  "one_line '$CR' | grep -qF '\`references/reviewer-fable-5-2.md\`'"
check "README routes claude-fable-5-2 to both profiles" \
  "grep -qF '| \`claude-fable-5-2\` | \`references/orchestrator-fable-5-2.md\` | \`references/reviewer-fable-5-2.md\` |' README.md"
check "telemetry prices claude-fable-5-2 at the launch-page rates" \
  "python3 -c \"import json,sys; sys.exit(0 if json.load(open('tests/eval/telemetry/prices.json'))['claude-fable-5-2'] == [8, 0.2, 40] else 1)\""
check "ADR 019 records the seat-only decision" \
  "[ -f '$ADR' ] && grep -q '^# 019 — ' '$ADR'"

summary
