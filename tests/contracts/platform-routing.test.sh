#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

MM=plugins/orchestration/skills/multi-model/SKILL.md
CP_ROUTING=plugins/orchestration/skills/multi-model/references/codex-routing.md
CWA=plugins/orchestration/skills/multi-model/references/claude-wave-adapter.md
CAM=plugins/orchestration/skills/multi-model/references/contract-amendment.md
SP=plugins/orchestration/skills/super-plan/SKILL.md
SH=plugins/orchestration/skills/ship/SKILL.md
CR=plugins/code-review/skills/critical-review/SKILL.md
DH=plugins/orchestration/hooks/drift-check
DS=plugins/orchestration/hooks/drift-verdict.schema.json
HJ=plugins/orchestration/hooks/hooks.json

section "skill discovery stays trigger-first and preserves boundaries"

expect "multi-model discovery description" \
  "description: 'Use when implementation work should be delegated, parallelized, or routed across Claude or Codex agents, especially when isolated worktrees and independent supervision are required. Do not use for single-agent work.'" \
  "$(sed -n '3p' "$MM")"
expect "super-plan discovery description" \
  "description: 'Use when a feature or change needs a wave-ready implementation plan for parallel or multi-agent execution. Do not use to implement the plan.'" \
  "$(sed -n '3p' "$SP")"
expect "ship discovery description" \
  "description: 'Use when the user wants the complete delivery pipeline from planning through a reviewed pull request. Do not use for a single planning, implementation, or review stage, and never merge.'" \
  "$(sed -n '3p' "$SH")"
expect "critical-review discovery description" \
  "description: 'Use when the user requests evidence-based review of uncommitted changes or a GitHub pull request, with optional follow-up fixes and thread resolution. Do not use as an orchestration-wave supervisor.'" \
  "$(sed -n '3p' "$CR")"

section "all skills resolve one active-seat profile from runtime context"

check "no universal Claude skill dir" \
  "! rg -q 'CLAUDE_SKILL_DIR' plugins/*/skills/*/SKILL.md"
check "no universal Claude effort variable" \
  "! rg -q 'CLAUDE_EFFORT' plugins/*/skills/*/SKILL.md"
for skill in "$MM" "$SP" "$SH" "$CR"; do
  check "runtime context contract named by $skill" \
    "grep -qF 'PLUGIN_RUNTIME_CONTEXT_V1' '$skill'"
done
check "one-profile rule is named by every skill" \
  "[ \$(rg -l 'Never load more than one active-seat profile' \"$MM\" \"$SP\" \"$SH\" \"$CR\" | wc -l | tr -d ' ') -eq 4 ]"
check "config identity guessing is forbidden by every skill" \
  "[ \$(rg -l 'Never read a user config file to guess a session override' \"$MM\" \"$SP\" \"$SH\" \"$CR\" | wc -l | tr -d ' ') -eq 4 ]"

section "orchestration skills map every supported GPT id and generic fallback"

for skill in "$SP" "$SH"; do
  check "$skill maps Astra" \
    "grep -qF '| \`gpt-6-astra\` | \`../multi-model/references/orchestrator-gpt-6-astra.md\` |' '$skill'"
  check "$skill maps GPT-6 Sol" \
    "grep -qF '| \`gpt-6-sol\` | \`../multi-model/references/orchestrator-gpt-6-sol.md\` |' '$skill'"
  check "$skill maps GPT-6 Luna" \
    "grep -qF '| \`gpt-6-luna\` | \`../multi-model/references/orchestrator-gpt-6-luna.md\` |' '$skill'"
  check "$skill maps Sol" \
    "grep -qF '| \`gpt-5.6-sol\` | \`../multi-model/references/orchestrator-gpt-5-6-sol.md\` |' '$skill'"
  check "$skill maps Terra" \
    "grep -qF '| \`gpt-5.6-terra\` | \`../multi-model/references/orchestrator-gpt-5-6-terra.md\` |' '$skill'"
  check "$skill maps Luna" \
    "grep -qF '| \`gpt-5.6-luna\` | \`../multi-model/references/orchestrator-gpt-5-6-luna.md\` |' '$skill'"
  check "$skill maps unknown identity to generic" \
    "grep -qF '| unknown | \`../multi-model/references/orchestrator-generic.md\` |' '$skill'"
done

check "multi-model maps Sol" \
  "grep -qF '| \`gpt-5.6-sol\` | \`references/orchestrator-gpt-5-6-sol.md\` |' '$MM'"
check "multi-model maps Astra" \
  "grep -qF '| \`gpt-6-astra\` | \`references/orchestrator-gpt-6-astra.md\` |' '$MM'"
check "multi-model maps GPT-6 Sol" \
  "grep -qF '| \`gpt-6-sol\` | \`references/orchestrator-gpt-6-sol.md\` |' '$MM'"
check "multi-model maps GPT-6 Luna" \
  "grep -qF '| \`gpt-6-luna\` | \`references/orchestrator-gpt-6-luna.md\` |' '$MM'"
check "multi-model maps Terra" \
  "grep -qF '| \`gpt-5.6-terra\` | \`references/orchestrator-gpt-5-6-terra.md\` |' '$MM'"
check "multi-model maps Luna" \
  "grep -qF '| \`gpt-5.6-luna\` | \`references/orchestrator-gpt-5-6-luna.md\` |' '$MM'"
check "multi-model maps unknown identity to generic" \
  "grep -qF '| unknown | \`references/orchestrator-generic.md\` |' '$MM'"

section "critical-review maps every supported GPT id and generic fallback"

check "critical-review maps Sol" \
  "grep -qF '| \`gpt-5.6-sol\` | \`references/reviewer-gpt-5-6-sol.md\` |' '$CR'"
check "critical-review maps Astra" \
  "grep -qF '| \`gpt-6-astra\` | \`references/reviewer-gpt-6-astra.md\` |' '$CR'"
check "critical-review maps GPT-6 Sol" \
  "grep -qF '| \`gpt-6-sol\` | \`references/reviewer-gpt-6-sol.md\` |' '$CR'"
check "critical-review maps GPT-6 Luna" \
  "grep -qF '| \`gpt-6-luna\` | \`references/reviewer-gpt-6-luna.md\` |' '$CR'"
check "Astra review fixes use the shared routing protocol" \
  "grep -qF 'shared Post-Review Fix Protocol' plugins/code-review/skills/critical-review/references/reviewer-gpt-6-astra.md"
check "critical-review maps Terra" \
  "grep -qF '| \`gpt-5.6-terra\` | \`references/reviewer-gpt-5-6-terra.md\` |' '$CR'"
check "critical-review maps Luna" \
  "grep -qF '| \`gpt-5.6-luna\` | \`references/reviewer-gpt-5-6-luna.md\` |' '$CR'"
check "critical-review maps unknown identity to generic" \
  "grep -qF '| unknown | \`references/reviewer-generic.md\` |' '$CR'"

section "super-plan asks questions through host-neutral behavior"

check "super-plan has host-neutral questions" \
  "grep -qF 'host-native structured input tool' '$SP'"
check "super-plan keeps exact headless heading" \
  "grep -qF 'Assumptions (would ask)' '$SP'"
check "super-plan no longer pins a Claude-only question tool" \
  "! grep -q 'AskUserQuestion' '$SP'"

section "the retired bare-GPT-6 compatibility sentence is gone everywhere"

for skill in "$MM" "$SP" "$SH" "$CR"; do
  check "$skill no longer carries the old Astra-via-host-GPT-6 sentence" \
    "! grep -qF 'Astra profile via host GPT-6 identification' '$skill'"
done

section "super-plan emits provider-pure wave plans from the active profile"

check "plan-format table names every full Claude plan identifier" \
  "sed -n '/^## Plan Format$/,/^## Acceptance References$/p' '$SP' | grep -qF '| Claude | \`claude-haiku-4-5-20251001\`, \`claude-sonnet-5\`, \`claude-opus-5-5\`, \`claude-opus-5\`, \`claude-opus-4-8\`, \`claude-fable-5-1\` |'"
check "example wave-plan block uses a full Claude supervisor id" \
  "sed -n '/^   \`\`\`json wave-plan$/,/^   \`\`\`$/p' '$SP' | grep -qF '\"model\": \"claude-fable-5-1\"'"
check "plan-format table names every exact Codex plan identifier" \
  "sed -n '/^## Plan Format$/,/^## Acceptance References$/p' '$SP' | grep -qF '| Codex | \`gpt-6-sol\`, \`gpt-6-luna\`, \`gpt-5.6-sol\`, \`gpt-5.6-terra\`, \`gpt-5.6-luna\` |'"
check "the bare GPT alias is never a plan identifier" \
  "sed -n '/^## Plan Format$/,/^## Acceptance References$/p' '$SP' | grep -qF '\`gpt-5.6\` is never a plan id'"
check "the active profile owns all planning routes" \
  "grep -qF 'active profile chooses executor, supervisor, ladder, and effort' '$SP'"
check "mixed-provider waves are returned to planning" \
  "grep -qF 'mixed-provider wave is a planning defect to fix before Gate 2' '$SP'"
check "Codex effort rework is not duplicated in its model ladder" \
  "grep -qF 'same-model raised-effort rework is state-machine behavior' '$SP' && grep -qF 'ladder lists model transitions only' '$SP'"
check "Codex plans require explicit executor and supervisor efforts" \
  "grep -qF 'Every Codex supervisor and executor names an explicit effort' '$SP'"
check "plan ladders require distinct model transitions" \
  "grep -qF 'executor and every ladder rung are distinct model transitions' '$SP'"

CP=plugins/orchestration/skills/multi-model/references/codex-wave-protocol.md
WR=plugins/orchestration/skills/multi-model/references/wave-runner.workflow.mjs
CS=plugins/orchestration/skills/multi-model/references/codex-wave-state.mjs

section "multi-model selects the native host adapter"

check "Claude adapter remains the shipped Workflow runner" \
  "grep -qF 'references/wave-runner.workflow.mjs' '$CWA'"
check "GPT adapter names the Codex protocol" \
  "grep -qF 'references/codex-wave-protocol.md' '$MM'"
check "Codex spawns name exact model and effort" \
  "grep -qF 'model and reasoning_effort' '$MM'"
check "Codex protocol ships" \
  "[ -f '$CP' ]"
check "approved plan controls adapter execution" \
  "grep -qF 'approved plan is authoritative for adapter execution' '$MM'"
check "Codex protocol resolves sibling plan linter" \
  "grep -qF '../super-plan/references/plan-lint.mjs' '$CP'"
check "Codex protocol resolves state helper from its skill base" \
  "grep -qF 'multi-model skill base directory' '$CP'"
check "Codex helper declaration is exactly seven commands" \
  "sed -n '/^\`\`\`text$/, /^\`\`\`$/p' '$CP' | grep -qFx 'init  next  record-executor  verify  supervisor-prompt  record-verdict  summary'"
check "Codex follow-up reuse pins the complete child tuple" \
  "grep -qF 'same role, exact model, and exact effort' '$CP'"
check "Codex retry spawns fresh on model or effort change" \
  "grep -qF 'model or effort changes' '$CP'"
check "Codex treats followup_task as an optional optimization" \
  "grep -qF 'followup_task is optional' '$CP' && grep -qF 'unavailable, use a fresh spawn_agent' '$CP'"
check "Codex native unavailability requires spawn or wait to be missing" \
  "grep -qF 'tool-unavailable only when spawn_agent or wait_agent is unavailable' '$CP'"
check "Codex spawn identity is valid and collision-free" \
  "grep -qF 'wave_<task_id>_<role>_<spawn_id>' '$CP'"
check "both Codex spawn examples name exact model" \
  "[ \$(grep -cF 'model: action.model' '$CP') -eq 2 ]"
check "both Codex spawn examples name exact effort" \
  "[ \$(grep -cF 'reasoning_effort: action.effort' '$CP') -eq 2 ]"
check "Codex state binds the approved plan except mutable status" \
  "grep -qF 'initialized plan digest' '$CP' && grep -qF 'status transition' '$CP'"
check "Codex mechanics remain authoritative over a clean model verdict" \
  "grep -qF 'clean supervisor verdict cannot override blocking mechanical facts' '$CP'"
check "Codex protocol defaults to the deterministic runner" \
  "grep -qF 'codex-wave-runner.mjs' '$CP' && grep -qF '## Default: the deterministic runner' '$CP'"
check "Codex protocol keeps the native action loop as the fallback heading" \
  "grep -qF '## Commands and action loop' '$CP'"
check "multi-model Host adapter names the deterministic runner" \
  "grep -qF 'codex-wave-runner.mjs' '$MM'"

section "multi-model holds reviewed fix waves locally only by explicit invocation"

check "omitted publication defaults exactly to normal push in its boundary" \
  "sed -n '/^### Invocation publication contract$/,/^- Claude-only wave:/p' '$MM' | tr '\\n' ' ' | tr -s ' ' | grep -qF '\`publication\` is optional: if omitted, it means exactly \`publication: push\` and preserves all normal behavior.'"
check "local publication is explicit critical-review-only and never inferred" \
  "sed -n '/^### Invocation publication contract$/,/^- Claude-only wave:/p' '$MM' | tr '\\n' ' ' | tr -s ' ' | grep -qF 'Only \`publication: local\` must be explicit; only the enclosing critical-review post-review fix flow may request it; it is never inferred from host or model.'"
check "Claude local completion integrates reviews and returns without push" \
  "sed -n '/^Claude adapter completion /,/^4[.] Act on the returned statuses/p' '$CWA' | tr '\\n' ' ' | tr -s ' ' | grep -qF 'With \`publication: local\`, merge branches in plan order only into the local feature branch, run the shared full-wave review, return the resulting local feature-branch commit(s), task branches, and verdict evidence, and do no push.'"
check "Claude normal completion still pushes" \
  "sed -n '/^Claude adapter completion /,/^4[.] Act on the returned statuses/p' '$CWA' | tr '\\n' ' ' | tr -s ' ' | grep -qF '\`publication: push\` merges branches in plan order, runs the shared full-wave review, and pushes exactly as normal.'"
check "Codex local completion returns reviewed local artifacts without push" \
  "sed -n '/^9[.] On \`merge-ready\`/,/^The action loop/p' '$CP' | tr '\\n' ' ' | tr -s ' ' | grep -qF 'In \`publication: local\` mode, merge only into the local feature branch, keep the shared full-wave review, return its resulting local commit(s), task branch names, helper summary, and verdict evidence to the caller, and do no push.'"
check "Codex local completion never advances from an unpushed base" \
  "sed -n '/^9[.] On \`merge-ready\`/,/^The action loop/p' '$CP' | tr '\\n' ' ' | tr -s ' ' | grep -qF 'Local mode does not derive or initialize a later wave from that unpushed base.'"
check "Codex local transaction stops instead of publishing unsafe dependent bases" \
  "sed -n '/^9[.] On \`merge-ready\`/,/^The action loop/p' '$CP' | tr '\\n' ' ' | tr -s ' ' | grep -qF 'If approved fixes need dependent bases that cannot safely fit in this one supervised wave, stop before publication.'"
check "normal Codex completion still pushes and derives the next base" \
  "sed -n '/^9[.] On \`merge-ready\`/,/^The action loop/p' '$CP' | tr '\\n' ' ' | tr -s ' ' | grep -qF 'In normal \`publication: push\` mode, multi-model pushes and then derives the next wave'"
check "local publication does not alter either deterministic executor" \
  "! grep -q 'publication' '$WR' && ! grep -q 'publication' '$CS'"

section "ship composes the approved provider adapter without owning it"

check "ship preserves the approved plan provider and exact ids" \
  "grep -qF 'consume the approved plan’s provider and preserve its exact model and effort ids verbatim' '$SH'"
check "ship assigns both native adapters to multi-model" \
  "grep -qF 'native Codex protocol for Codex plan waves and the Claude Workflow adapter for Claude plan waves' '$SH'"
check "ship leaves adapter selection and subagent execution to multi-model" \
  "grep -qF 'Only multi-model selects that adapter and owns all subagent execution' '$SH'"
check "ship does not own provider invocation machinery" \
  "grep -qF 'ship never invokes provider CLIs, adapter workflows, or state helpers itself' '$SH'"
check "ship fixes own findings even without review threads" \
  "grep -qF 'every approved finding that produces a fix, including an \`own\` finding with no PR threads' '$SH'"
check "ship defers fix routing to critical-review" \
  "grep -qF 'shared Post-Review Fix Protocol' '$SH' && grep -qF 'ship never adds inline prose routing or a parallel routing table' '$SH'"
check "critical-review gate is the first review-fix publication point" \
  "grep -qF 'Only after that approval does publication run in that order' '$SH' && ! sed -n '/^## Stage 3 — Review$/,/^## Stage 4 — Handoff$/p' '$SH' | grep -qF 'pushed like any wave'"
check "ship keeps delegated review fixes local" \
  "grep -qF 'Critical-review keeps every resulting fix commit local' '$SH'"

section "provider-aware Stop drift registration is strict and complete"

check "Codex drift verdict schema is exact draft 2020-12 JSON" \
  "python3 -c 'import json; d=json.load(open(\"$DS\")); expected={\"\$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"type\":\"object\",\"additionalProperties\":False,\"properties\":{\"status\":{\"enum\":[\"nothing\",\"advice\"]},\"advice\":{\"type\":\"array\",\"items\":{\"type\":\"string\",\"minLength\":1}}},\"required\":[\"status\",\"advice\"]}; raise SystemExit(0 if d == expected else 1)'"
check "orchestration hook registration preserves both starts and Stop" \
  "python3 -c 'import json; d=json.load(open(\"$HJ\"))[\"hooks\"]; raise SystemExit(0 if list(d) == [\"SessionStart\",\"SubagentStart\",\"Stop\"] else 1)'"
expect "Stop hook timeout accommodates the bounded Codex judge" "360" \
  "$(python3 -c 'import json; print(json.load(open("'$HJ'"))["hooks"]["Stop"][0]["hooks"][0]["timeout"])')"
check "drift hook remains executable" "[ -x '$DH' ]"

section "premium models gate Fable 5.1 and GPT-6 Astra behind approvals.premium"

check "multi-model states the premium-approval paragraph" \
  "sed -n '/^\*\*Premium models\.\*\*/,/for Luna-only waves\.\$/p' '$MM' | tr '\n' ' ' | tr -s ' ' | grep -qF 'Fable 5.1 and GPT-6 Astra are premium; they are used — as supervisor or executor — only when the user chose them at Gate 1 and the plan records \`approvals.premium\`; the linter enforces it. Standard alternatives: Opus 5.5 (Sonnet/Haiku waves), Opus 5 (for Opus 5.5 executors), Codex \`gpt-6-sol\` for Luna-only waves.'"
check "Fable 5.1 executor row requires approvals.premium at Gate 1" \
  "grep -qF 'Fable 5.1 executor (\`claude-fable-5-1\`)' '$MM' && grep -qF 'only with \`approvals.premium\` recorded at Gate 1' '$MM'"
check "Opus 4.8 compiled-binary executor row stays" \
  "grep -qF '| Reverse-engineering / vulnerability discovery in compiled binaries | Opus 4.8 executor (\`claude-opus-4-8\`) |' '$MM'"
check "Opus 5 executor row is marked a retired route" \
  "grep -qF '| Opus 5 executor (\`claude-opus-5\`; retired route, kept for approved older plans) |' '$MM'"

section "trusted-report research routing moved from Opus 4.8 to Opus 5.5"

check "near-1M-token trusted-report research now routes to Opus 5.5 medium/high" \
  "grep -qF '| A report the orchestrator will trust without re-verification, or reasoning over a near-1M-token surface | Opus 5.5 (\`claude-opus-5-5\`), medium/high |' '$MM'"
check "Opus 4.8 orchestrator profile is still kept" \
  "grep -qF 'references/orchestrator-opus-4-8.md' '$MM'"

section "executor prompts prohibit touching credential files"

check "Task Prompt Template forbids opening, printing, copying or transmitting credentials" \
  "sed -n '/^4\. \*\*Prohibitions:\*\*/,/overriding goal.*\.\$/p' '$MM' | tr '\n' ' ' | tr -s ' ' | grep -qF 'Never open, print, copy or transmit credentials, tokens or configuration files that hold them (for example \`~/.codex\`, \`~/.claude\`, app configs with Authorization headers); if the task needs a secret, stop and report.'"

section "Codex routing offers a standard gpt-6-sol supervisor for all-Luna waves"

check "codex-routing names gpt-6-astra as the premium supervisor needing approvals.premium" \
  "grep -qF '\`gpt-6-astra\` remains the premium supervisor and needs \`approvals.premium\`' '$CP_ROUTING'"
check "codex-routing states the standard supervisor option" \
  "sed -n '/The \*\*standard supervisor\*\* option covers/,/premium and the standard supervisor\.\$/p' '$CP_ROUTING' | tr '\n' ' ' | tr -s ' ' | grep -qF 'The **standard supervisor** option covers a narrower case: a wave whose executors and ladder rungs are all \`gpt-6-luna\` may use a fresh \`gpt-6-sol\` supervisor at \`high\` instead of Astra — there is no Luna→Sol ladder in such a wave, since Sol already holds the supervisor seat. The supervisor fixture recorded Sol 9/9 twice on 2026-09-23; that is a repeated fixture pass, not production calibration, so Sol remains uncalibrated as a production supervisor outside this narrow all-Luna case. Every stop rule below still applies unchanged to both the premium and the standard supervisor.'"
check "codex-routing keeps the mandatory-stop rule for missing capabilities" \
  "grep -qF 'stop before launching and name the missing capability' '$CP_ROUTING'"

section "ship runs the plan's ci.commands after the final wave"

check "ship Stage 2 step 4 runs ci.commands after the final wave, before push" \
  "grep -qF 'push. After the final wave, also run the plan'\''s \`ci.commands\` before that' '$SH'"
check "multi-model Completion step runs ci.commands after the final wave" \
  "grep -qF 'final wave, run the plan'\''s \`ci.commands\` exactly (in addition to the offline' '$MM'"

summary
