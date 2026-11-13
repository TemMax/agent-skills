#!/usr/bin/env bash
# Fable 5.2 (`claude-fable-5-2`) has its own orchestrator and reviewer
# profiles and is the premium Claude model for every child role, used only on
# the user's word; Fable 5.1 is deprecated (ADR 020, which replaced the
# seat-only rule of ADR 019). These checks pin the profile routing, the
# premium rule and the deprecation.
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
ADR20=docs/decisions/020-fable-5-2-premium-fable-5-1-deprecated.md

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

section "Fable 5.2 is premium; Fable 5.1 is deprecated (ADR 020)"
check "the orchestrator profile states the premium rule" \
  "grep -q '^## Your Seat and Your Children$' '$OF' && one_line '$OF' | grep -qF 'Being the seat yourself authorizes nothing: without the user'\''s word every child runs on the standard route.'"
check "the orchestrator profile no longer says it is never a child" \
  "! one_line '$OF' | grep -qF 'never a child of a plan'"
check "the orchestrator profile never asks for a restart at another effort" \
  "one_line '$OF' | grep -qF 'Never ask the user to restart at a different effort.'"
check "the orchestrator profile routes research off-seat" \
  "one_line '$OF' | grep -qF 'routed research agents (Research Routing table, a named model on every spawn)'"
check "the multi-model overview states the premium rule and the deprecation" \
  "one_line '$MM' | grep -qF 'Fable 5.2 (\`claude-fable-5-2\`) is the premium Claude model: an executor, ladder rung, supervisor or research agent only on the user'\''s word' && one_line '$MM' | grep -qF 'Fable 5.1 (\`claude-fable-5-1\`) is deprecated: approved plans still run it, new plans never choose it (ADR 020).'"
check "the alias table maps fable to Fable 5.2, premium" \
  "grep -qF '| Fable 5.2 (premium — only on the user'\''s word) | \`claude-fable-5-2\` | \`fable\` (probed 2026-11-10, Claude Code 2.1.322) |' '$MM'"
check "the alias table marks Fable 5.1 deprecated" \
  "grep -qF '| Fable 5.1 (deprecated route; ID valid for approved plans) | \`claude-fable-5-1\` | none (\`fable\` moved to Fable 5.2 by 2026-11-10) |' '$MM'"
check "Fable 5.1 is spawned only through Workflow agent()" \
  "one_line '$MM' | grep -qF 'A model without an alias (Opus 5, Opus 4.8, Fable 5.1, and the retired Sonnet 5 and Haiku 4.5) is spawned only through Workflow \`agent()\`.'"
check "a spawn through fable is a premium spawn" \
  "one_line '$MM' | grep -qF '\`fable\` resolves to Fable 5.2, a premium model: spawn through it only for a role the user authorized for Fable 5.2 (ADR 020)'"
check "the premium paragraph names Fable 5.2 and GPT-6 Astra" \
  "one_line '$MM' | grep -qF '**Premium models.** Fable 5.2 and GPT-6 Astra are premium'"
check "every supervisor row offers Fable 5.2, not Fable 5.1, as the premium alternative" \
  "[ \"\$(grep -cF 'Fable 5.2 (\`claude-fable-5-2\`) is the premium alternative' '$MM')\" -ge 4 ] && ! grep -qF 'Fable 5.1 (\`claude-fable-5-1\`) is the premium alternative' '$MM'"
check "the high-risk untrusted-content route goes to Opus 5.5, not Fable" \
  "grep -F '| Untrusted content whose compromise would reach secrets' '$MM' | grep -qF 'Opus 5.5 executor (\`claude-opus-5-5\`)' && ! grep -F '| Untrusted content whose compromise would reach secrets' '$MM' | grep -qF 'Fable 5.1 executor'"
check "a Fable 5.2 executor prompt carries a finishing line" \
  "one_line '$MM' | grep -qF 'A Fable 5.2 executor prompt carries a finishing line'"
check "super-plan lists claude-fable-5-2 as premium and claude-fable-5-1 as deprecated" \
  "one_line '$SP' | grep -qF '\`claude-fable-5-2\` is premium: any plan role needs the user'\''s word' && one_line '$SP' | grep -qF '\`claude-fable-5-1\` is deprecated (ADR 020)'"
check "super-plan's allowed Claude models include claude-fable-5-2" \
  "grep -F '| Claude | \`claude-haiku-5-5\`' '$SP' | grep -qF 'claude-fable-5-2'"
check "super-plan's premium example uses claude-fable-5-2" \
  "grep -qF '\"supervisor\": { \"model\": \"claude-fable-5-2\", \"effort\": \"high\" },' '$SP' && grep -qF '\"models\": [\"claude-fable-5-2\"],' '$SP'"
check "the linter accepts claude-fable-5-2 as a premium tier-3 model" \
  "grep -qF \"'claude-fable-5-2',\" '$PL' && grep -qF \"'claude-fable-5-2': 3\" '$PL' && grep -qF \"const PREMIUM_MODELS = ['claude-fable-5-2', 'claude-fable-5-1', 'gpt-6-astra']\" '$PL'"
check "the linter warns that claude-fable-5-1 is deprecated" \
  "grep -qF 'deprecated: claude-fable-5-1 is not chosen for new plans (use claude-fable-5-2, premium); approved plans still run' '$PL'"
check "the runner accepts claude-fable-5-2 at tier 3 and keeps it off the default ladder" \
  "grep -qF \"'claude-fable-5-2',\" '$WR' && grep -qF \"'claude-fable-5-2': 3\" '$WR' && grep -qF \"const LADDER_ORDER = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']\" '$WR'"
check "the Codex wave state knows claude-fable-5-2" \
  "grep -qF \"'claude-fable-5-2'\" plugins/orchestration/skills/multi-model/references/codex-wave-state.mjs"
check "critical-review's premium rule names Fable 5.2" \
  "one_line plugins/code-review/skills/critical-review/FIXES.md | grep -qF 'premium model (Fable 5.2 / GPT-6 Astra) is used only when the user said so'"
check "no shipped text still offers Fable 5.1 as a premium route" \
  "! grep -rqF 'Fable 5.1 / GPT-6 Astra' plugins && ! grep -rqF 'Fable 5.1 (\`claude-fable-5-1\`) is the premium alternative' plugins"
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
check "the multi-model dossier has a Fable 5.2 section with its premium role" \
  "grep -q '^## Fable 5.2 (orchestrator; premium executor, rung and judge' '$DOSSIER'"
check "the multi-model dossier marks Fable 5.1 deprecated" \
  "grep -q '^## Fable 5.1 (deprecated route' '$DOSSIER'"
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
check "ADR 019 records the seat-only decision and points to ADR 020" \
  "[ -f '$ADR' ] && grep -q '^# 019 — ' '$ADR' && grep -qF '020-fable-5-2-premium-fable-5-1-deprecated.md' '$ADR'"
check "ADR 020 records the premium and deprecation decision" \
  "[ -f '$ADR20' ] && grep -q '^# 020 — ' '$ADR20'"

summary
