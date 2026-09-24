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
  "sed -n '/^\*\*Premium models\.\*\*/,/for Luna-only waves\.\$/p' '$MM' | tr '\n' ' ' | tr -s ' ' | grep -qF 'Fable 5.1 and GPT-6 Astra are premium; they are used — as supervisor, executor or ladder rung — only when the user chose them at Gate 1 and the plan records \`approvals.premium\`; the linter enforces it. Standard alternatives: Opus 5.5 (Sonnet/Haiku waves), Opus 5 (for Opus 5.5 executors), Codex \`gpt-6-sol\` for Luna-only waves.'"
check "the supervisor table default-ladder sentence counts an omitted ladder" \
  "grep -qF 'The rung rule counts the default ladder' '$MM' && grep -qF 'inherits the runner'\''s default ladder' '$MM'"
check "Haiku and Sonnet supervisor rows route to Opus 5.5 or Opus 5 by rung, with Fable 5.1 as premium" \
  "[ \$(grep -cF 'Opus 5.5 (\`claude-opus-5-5\`) when no rung reaches Opus 5.5 (\`\"ladder\": []\`; an omitted ladder uses the runner'\''s default ladder, which does) — otherwise Opus 5 (\`claude-opus-5\`); Fable 5.1 (\`claude-fable-5-1\`) is the premium alternative' '$MM') -eq 2 ]"
check "Opus 4.8 supervisor row offers standard Opus 5.5 or premium Fable 5.1" \
  "grep -qF '| Opus 4.8 (\`claude-opus-4-8\`) | Opus 5.5 (\`claude-opus-5-5\`, standard) or Fable 5.1 (\`claude-fable-5-1\`, premium — \`approvals.premium\`) | high |' '$MM'"
check "Fable 5.1 executor row requires approvals.premium at Gate 1" \
  "grep -qF 'Fable 5.1 executor (\`claude-fable-5-1\`)' '$MM' && grep -qF 'only with \`approvals.premium\` recorded at Gate 1' '$MM'"
check "Opus 4.8 compiled-binary executor row stays" \
  "grep -qF '| Reverse-engineering / vulnerability discovery in compiled binaries | Opus 4.8 executor (\`claude-opus-4-8\`) |' '$MM'"
check "Opus 5 executor row is marked a retired route" \
  "grep -qF '| Opus 5 executor (\`claude-opus-5\`; retired route, kept for approved older plans) |' '$MM'"

section "trusted-report research routing moved from Opus 4.8 to Opus 5.5"

check "trusted-report research routes to Opus 5.5 medium/high" \
  "grep -qF '| A report the orchestrator will trust without re-verification | Opus 5.5 (\`claude-opus-5-5\`), medium/high |' '$MM'"
check "near-1M-token reasoning research routes to Opus 4.8" \
  "grep -qF '| Reasoning over a near-1M-token surface | Opus 4.8 (\`claude-opus-4-8\`) | The only measured long-context reasoning result in the comparison set (GraphWalks 1M 68.1) |' '$MM'"
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

section "codex-routing and ship choose the wave supervisor at Gate 1, premium or standard"

check "codex-routing no longer names an available Astra supervisor as the default authoring choice" \
  "! grep -qF 'with an available independent \`gpt-6-astra\` supervisor' '$CP_ROUTING'"
check "codex-routing's Authoring decision paragraph names the Gate 1 choice" \
  "grep -qF 'chosen at Gate 1' '$CP_ROUTING'"
check "codex-routing states the Luna->Sol rung is Astra-only" \
  "grep -qF 'The Luna→Sol rung is available only under an Astra supervisor; a wave with' '$CP_ROUTING' && grep -qF 'the standard \`gpt-6-sol\` supervisor has no ladder.' '$CP_ROUTING'"
check "ship no longer names a fresh Astra/high supervisor as the default GPT-5.6 route" \
  "! grep -qF 'Available GPT-5.6 executors with a fresh Astra/high supervisor' '$SH'"
check "ship names the Gate 1 supervisor choice, premium or standard, for GPT-6 executors" \
  "tr '\\n' ' ' < '$SH' | tr -s ' ' | grep -qF 'Available GPT-6 executors under the supervisor chosen at Gate 1 — premium \`gpt-6-astra\`/high with \`approvals.premium\`, or the standard \`gpt-6-sol\`/high for Luna-only waves — form an operational route through super-plan and multi-model without a separate calibration gate.'"

section "ship runs the plan's ci.commands after the final wave"

check "ship Stage 2 step 4 runs ci.commands after the final wave, before push" \
  "grep -qF 'push. After the final wave, also run the plan'\''s \`ci.commands\` before that' '$SH'"
check "multi-model Completion step runs ci.commands before the final wave's push" \
  "sed -n '/^9\. \*\*Completion\.\*\*/,/^   ended\.\$/p' '$MM' | tr '\n' ' ' | tr -s ' ' | grep -qF 'Run the plan'\''s \`ci.commands\` exactly (in addition to the offline suite) before the final wave'\''s push, not after'"
check "multi-model Completion step exempts a none-CI plan and reds like the offline suite" \
  "grep -qF 'with \`ci: \"none: <reason>\"\` there is nothing' '$MM' && grep -qF 'stops completion exactly like a red' '$MM'"

section "GPT-6 Sol/Luna calibration states the measured Sol routes, Luna review still unsupported"

check "multi-model no longer carries the blanket no-review-or-supervisor sentence" \
  "! grep -qF 'no GPT-6 Sol or Luna review or supervisor' '$MM'"
check "multi-model states GPT-6 Luna review stays unsupported" \
  "grep -qF 'GPT-6 Luna review stays unsupported' '$MM' && grep -qF '(clean 0/3)' '$MM'"
check "multi-model names the two Sol routes as measured with numbers and limits" \
  "grep -qF 'The two Sol routes are now measured, replacing the earlier' '$MM' && grep -qF 'standard \`gpt-6-sol\` supervisor of' '$MM' && grep -qF '9/9 on 2026-09-23' '$MM' && grep -qF '9/9 on 2026-09-24 (×3)' '$MM' && grep -qF '≈3.2× cheaper than a \`gpt-6-astra\` supervisor' '$MM' && grep -qF 'two-task toy waves with correct work only' '$MM'"
check "multi-model names the measured gpt-6-sol review route" \
  "sed -n '/^### GPT calibration evidence/,/^## Overview/p' '$MM' | tr '\n' ' ' | tr -s ' ' | grep -qF 'The \`gpt-6-sol\` review route recorded the critical-review strict gate clean 5/5 and planted 5/5 in each of two 2026-09-24 runs (10/10 and 10/10) and PR support 3/4 (one \`pr-gate-withheld\` miss)'"
check "multi-model no longer calls any Sol route uncalibrated" \
  "! grep -qi 'uncalibrated' '$MM'"

section "the Codex wave runner requires an escalated launch outside the sandbox (nested-sandbox)"

check "codex-wave-protocol quotes both measured nested-sandbox failure strings" \
  "sed -n '/^The runner shells out to/,/^## Commands and action loop/p' '$CP' | tr '\n' ' ' | tr -s ' ' | grep -qF 'failed to initialize in-process app-server client: Operation not permitted' && sed -n '/^The runner shells out to/,/^## Commands and action loop/p' '$CP' | tr '\n' ' ' | tr -s ' ' | grep -qF 'sandbox-exec: sandbox_apply: Operation not permitted'"
check "codex-wave-protocol names the nested-sandbox stop and its exit code" \
  "grep -qF 'nested-sandbox' '$CP' && grep -qF 'exit code 2' '$CP'"
check "codex-wave-protocol states the escalated-command requirement" \
  "grep -qF 'Run the runner command as an escalated command outside' '$CP' && grep -qF 'seatbelt sandboxes' '$CP' && grep -qF 'cannot nest' '$CP'"
check "multi-model Codex adapter selection launches the runner as an escalated command" \
  "sed -n '/^- Codex-only wave/,/^- Mixed or unknown-provider/p' '$MM' | tr '\n' ' ' | tr -s ' ' | grep -qF 'Launch \`codex-wave-runner.mjs\` as an escalated command outside the Codex sandbox, never inside a sandboxed Codex session'"

section "the Table step shows the supervisor, premium status, and cost, with premium only on explicit user choice"

check "process step 4 table adds supervisor, premium status and estimated cost per wave" \
  "sed -n '/^4\. \*\*Table\.\*\*/,/^5\. \*\*Write the wave plan file\*\*/p' '$MM' | tr '\n' ' ' | tr -s ' ' | grep -qF 'The table also shows, per wave, the supervisor and whether it is premium, with an estimated cost.'"
check "process step 4 table gates premium on the user's Gate 1 choice and approvals.premium" \
  "sed -n '/^4\. \*\*Table\.\*\*/,/^5\. \*\*Write the wave plan file\*\*/p' '$MM' | tr '\n' ' ' | tr -s ' ' | grep -qF 'A premium model (Fable 5.1 / GPT-6 Astra, any role) is used only when the user picks it here and the plan records \`approvals.premium\` with that choice — never filled in by the orchestrator for a choice the user did not make.'"

section "the Wave Plan Artifact example matches the real status/base header plus json wave-plan format"

check "wave plan artifact opens with the unfenced status/base header" \
  "sed -n '/^## Wave Plan Artifact\$/,/^## Task Prompt Template/p' '$MM' | grep -qF 'status: active' && sed -n '/^## Wave Plan Artifact\$/,/^## Task Prompt Template/p' '$MM' | grep -qF 'base: 7c05ff5'"
check "wave plan artifact uses one fenced json wave-plan block with ci, e2e and waves" \
  "sed -n '/^## Wave Plan Artifact\$/,/^## Task Prompt Template/p' '$MM' | grep -qF '\`\`\`json wave-plan' && sed -n '/^## Wave Plan Artifact\$/,/^## Task Prompt Template/p' '$MM' | grep -qF '\"waves\":' && sed -n '/^## Wave Plan Artifact\$/,/^## Task Prompt Template/p' '$MM' | grep -qF '\"ci\":' && sed -n '/^## Wave Plan Artifact\$/,/^## Task Prompt Template/p' '$MM' | grep -qF '\"e2e\":'"
check "wave plan artifact example nests a Sonnet task with an empty ladder under a claude-opus-5-5 supervisor" \
  "sed -n '/^## Wave Plan Artifact\$/,/^## Task Prompt Template/p' '$MM' | grep -qF '\"model\": \"claude-opus-5-5\"' && sed -n '/^## Wave Plan Artifact\$/,/^## Task Prompt Template/p' '$MM' | grep -qF '\"executor\": { \"model\": \"claude-sonnet-5\"' && sed -n '/^## Wave Plan Artifact\$/,/^## Task Prompt Template/p' '$MM' | grep -qF '\"ladder\": []'"
check "wave plan artifact points to super-plan's Plan Format for the full schema" \
  "sed -n '/^## Wave Plan Artifact\$/,/^## Task Prompt Template/p' '$MM' | grep -qF 'super-plan'\''s Plan Format'"

section "contract amendment recognizes blocked-on-sibling as a third, no-question kind"

check "contract-amendment names three kinds of amendment" \
  "grep -qF 'Three kinds of amendment' '$CAM'"
check "contract-amendment states the blocked-on-sibling amendment kind" \
  "tr '\n' ' ' < '$CAM' | tr -s ' ' | grep -qF 'move the task into a wave after its producer merges (or merge it into the producer'\''s task); never widen \`files_allowed\` into a sibling'\''s files. No user question is needed: no check is removed.'"

section "multi-model Task Prompt Template carries blocked-on-sibling and its done-definition exception"

check "Task Prompt Template dead-end protocol names blocked-on-sibling with the executor-prompt wording" \
  "sed -n '/^3\. \*\*Dead-end protocol:\*\*/,/^4\. \*\*Prohibitions:\*\*/p' '$MM' | tr '\n' ' ' | tr -s ' ' | grep -qF 'If your task needs an artifact that another task of this wave is producing (a file, fixture, function or behavior missing from your worktree), stop and report \`blocked-on-sibling: <what is missing and which task makes it>\`; do not invent it and do not commit a placeholder.'"
check "Task Prompt Template definition of done exempts a dead-end-protocol stop" \
  "sed -n '/^5\. \*\*Definition of done/,/^6\. \*\*Contract:\*\*/p' '$MM' | tr '\n' ' ' | tr -s ' ' | grep -qF 'unless the executor stopped under the dead-end protocol'"

summary
