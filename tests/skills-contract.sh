#!/usr/bin/env bash
# Tier 2 — the invariants a skill's behaviour depends on.
#
# Honest about what this tier is: assertions over prose. It catches a rule being
# deleted or silently reworded, and it caught nothing in the 2026-08-11 review,
# where all three serious findings came from probing behaviour instead. So only
# load-bearing text lives here — a line whose loss changes what the agent DOES,
# or reopens a defect that has already cost us once. Wording that is merely nice
# is deliberately not pinned: a suite that fails on rephrasing gets neutered.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tests/lib.sh

CR=plugins/code-review/skills/critical-review/SKILL.md
MM=plugins/orchestration/skills/multi-model/SKILL.md
SP=plugins/orchestration/skills/super-plan/SKILL.md
SH=plugins/orchestration/skills/ship/SKILL.md

section "critical-review: the PR read must be able to answer what it promises"
# REST exposes no thread id and no resolution state, so a REST-based read makes
# thread classification and the whole fix phase impossible.
check "threads are read over GraphQL"          "grep -q 'reviewThreads(first:100, after:\$endCursor)' $CR"
check "the read is paginated"                  "grep -q -- '--paginate' $CR"
check "REST is not invoked for inline threads" "! grep -q 'gh api repos/{owner}/{repo}/pulls/<n>/comments' $CR"
check "per-thread write capability is fetched" "grep -q 'viewerCanReply viewerCanResolve' $CR"
check "node count is reconciled"               "grep -q 'totalCount' $CR"

section "critical-review: rules that stop the fix phase harming a PR"
check "findings carry provenance"              "grep -q 'thread:<threadId>:<rootCommentDatabaseId>' $CR"
check "replies carry the idempotency marker"   "grep -q 'critical-review-fix-reply' $CR"
check "skip on the marker, not on authorship"  "grep -q 'never on bare authorship' $CR"
check "push precedes replies"                  "grep -q 'push\` → replies → resolves' $CR"
check "resolve only on a complete fix"         "grep -q 'closes the comment completely' $CR"
check "cancel is a soft reset"                 "grep -q 'git reset --soft' $CR"
check "reply language follows the thread"      "grep -q 'language of the thread being answered' $CR"

section "multi-model: wave isolation, where a wrong base blocks correct work"
check "per-task worktree"                      "grep -q 'its own git worktree' $MM"
check "branch convention"                      "grep -q 'wave/<task-id>' $MM"
check "base is the fork point, not local HEAD" "grep -q 'not your local' $MM"
check "the fork point is named"                "grep -q 'origin/<default-branch>' $MM"

section "multi-model: the contract a supervisor can actually decide"
for k in files_allowed files_forbidden must_run forbidden_moves report_must_answer; do
  check "contract field $k" "grep -q '$k' $MM"
done
check "evidence is a contract term"            "grep -q 'evidence: required' $MM"
check "a claim without output is a violation"  "grep -q 'violation in its own right' $MM"

section "multi-model: supervision that cannot be skipped or gamed"
check "supervision is a stage, not advice"     "grep -q 'not an instruction to self-check' $MM"
check "artifacts only"                         "grep -q 'artifacts only' $MM"
check "paste reproduction is a fact, not a class" "grep -q 'pasteReproduced' $MM"
check "no class asks the model to judge honesty" "! grep -q 'forged-evidence' $MM"
check "remarks do not block"                   "grep -q 'remarks' $MM"
check "the ladder has a terminal rung"         "grep -q 'already the strongest' $MM"
check "blocking threshold above suspicion"     "grep -q 'Blocking correct work' $MM"
check "supervisor prompt is referenced"        "grep -q 'references/supervisor-prompt.md' $MM"
check "supervisor routing table exists"        "grep -q 'Choosing the supervisor' $MM"
check "the judge is never the executor's own"  "grep -q 'Opus 5 never' $MM"
check "the wave runner ships as a file" \
  "[ -f plugins/orchestration/skills/multi-model/references/wave-runner.workflow.mjs ]"
check "SKILL points at the shipped runner"     "grep -q 'wave-runner.workflow.mjs' $MM"
check "default path is invoking, not writing"  "grep -q 'invoke the shipped runner' $MM"
check "the filesystem constraint is named"     "grep -q 'supervisorPromptText' $MM"
check "no ladder row resurrects the forgery class" "! grep -qi 'forged evidence' $MM"

CP=plugins/orchestration/skills/multi-model/references/codex-wave-protocol.md
CS=plugins/orchestration/skills/multi-model/references/codex-wave-state.mjs
WR=plugins/orchestration/skills/multi-model/references/wave-runner.workflow.mjs

section "multi-model: Codex-native supervision preserves the shared contract"
check "GPT waves use the Codex adapter"             "grep -qF 'references/codex-wave-protocol.md' $MM"
check "no fresh Codex runner may be written"        "grep -qF 'Never write a fresh runner' $MM"
check "Codex spawn arguments are explicit"          "grep -qF 'model and reasoning_effort' $MM"
check "Codex helper declares exactly seven commands" \
  "sed -n '/^\`\`\`text$/, /^\`\`\`$/p' $CP | grep -qFx 'init  next  record-executor  verify  supervisor-prompt  record-verdict  summary'"
check "Codex supervisor uses a different exact model" "grep -qF 'different exact model' $CP"
check "approved plan outranks profile during execution" \
  "grep -qF 'approved plan is authoritative for adapter execution' $MM"
check "Codex linter uses a sibling-skill path" \
  "grep -qF '../super-plan/references/plan-lint.mjs' $CP"
check "Codex helper path has a declared base" \
  "grep -qF 'multi-model skill base directory' $CP"
check "child reuse requires matching role model effort" \
  "grep -qF 'same role, exact model, and exact effort' $CP"
check "changed retry tuple uses fresh spawn" \
  "grep -qF 'model or effort changes' $CP"
check "missing followup_task falls back to a fresh spawn" \
  "grep -qF 'followup_task is optional' $CP && grep -qF 'unavailable, use a fresh spawn_agent' $CP"
check "native tool-unavailable requires a missing essential tool" \
  "grep -qF 'tool-unavailable only when spawn_agent or wait_agent is unavailable' $CP"
check "spawn identities are valid and collision-free" \
  "grep -qF 'wave_<task_id>_<role>_<spawn_id>' $CP"
check "executor and supervisor examples name model" \
  "[ \$(grep -cF 'model: action.model' $CP) -eq 2 ]"
check "executor and supervisor examples name effort" \
  "[ \$(grep -cF 'reasoning_effort: action.effort' $CP) -eq 2 ]"
check "omitted publication defaults exactly to normal push in its boundary" \
  "sed -n '/^### Invocation publication contract$/,/^- Claude-only wave:/p' $MM | tr '\\n' ' ' | tr -s ' ' | grep -qF '\`publication\` is optional: if omitted, it means exactly \`publication: push\` and preserves all normal behavior.'"
check "local publication is explicit critical-review-only and never inferred" \
  "sed -n '/^### Invocation publication contract$/,/^- Claude-only wave:/p' $MM | tr '\\n' ' ' | tr -s ' ' | grep -qF 'Only \`publication: local\` must be explicit; only the enclosing critical-review post-review fix flow may request it; it is never inferred from host or model.'"
check "Claude local completion integrates reviews and returns without push" \
  "sed -n '/^Claude adapter completion /,/^4[.] Act on the returned statuses/p' $MM | tr '\\n' ' ' | tr -s ' ' | grep -qF 'With \`publication: local\`, merge branches in plan order only into the local feature branch, run the shared full-wave review, return the resulting local feature-branch commit(s), task branches, and verdict evidence, and do no push.'"
check "Claude normal completion still pushes" \
  "sed -n '/^Claude adapter completion /,/^4[.] Act on the returned statuses/p' $MM | tr '\\n' ' ' | tr -s ' ' | grep -qF '\`publication: push\` merges branches in plan order, runs the shared full-wave review, and pushes exactly as normal.'"
check "Codex local completion returns reviewed local artifacts without push" \
  "sed -n '/^9[.] On \`merge-ready\`/,/^The action loop/p' $CP | tr '\\n' ' ' | tr -s ' ' | grep -qF 'In \`publication: local\` mode, merge only into the local feature branch, keep the shared full-wave review, return its resulting local commit(s), task branch names, helper summary, and verdict evidence to the caller, and do no push.'"
check "Codex local completion cannot create an unpushed next base" \
  "sed -n '/^9[.] On \`merge-ready\`/,/^The action loop/p' $CP | tr '\\n' ' ' | tr -s ' ' | grep -qF 'Local mode does not derive or initialize a later wave from that unpushed base.'"
check "Codex local transaction stops instead of publishing unsafe dependent bases" \
  "sed -n '/^9[.] On \`merge-ready\`/,/^The action loop/p' $CP | tr '\\n' ' ' | tr -s ' ' | grep -qF 'If approved fixes need dependent bases that cannot safely fit in this one supervised wave, stop before publication.'"
check "Codex normal completion still pushes before next base" \
  "sed -n '/^9[.] On \`merge-ready\`/,/^The action loop/p' $CP | tr '\\n' ' ' | tr -s ' ' | grep -qF 'In normal \`publication: push\` mode, multi-model pushes and then derives the next wave'"
check "publication remains outside Workflow and the state helper" \
  "! grep -q 'publication' $WR && ! grep -q 'publication' $CS"

section "multi-model: research fan-out is routed, never inherited"
check "the research routing table exists"      "grep -q 'Research Routing' $MM"
check "inheritance is named as the bug"        "grep -q 'spawn a research agent without naming its model' $MM"
check "not-found is a valid answer"            "grep -q 'is a valid and expected answer' $MM"
check "answering from memory is forbidden"     "grep -q 'answering from memory' $MM"
check "super-plan routes research through it"  "grep -q 'Research Routing' $SP"
check "the fable profile routes research off-seat" \
  "grep -q 'Research Routing' plugins/orchestration/skills/multi-model/references/orchestrator-fable-5.md"

WR=plugins/orchestration/skills/multi-model/references/wave-runner.workflow.mjs
SUPP=plugins/orchestration/skills/multi-model/references/supervisor-prompt.md

section "multi-model: mechanical verification pays no judge for script-decidable facts"
check "the runner has a verify stage"           "grep -q 'Mechanical verification' $WR"
check "the verifier stage fails open"           "grep -q 'Fail-open' $WR"
check "mechanical repeat goes to the judge"     "grep -q 'Once per rule' $WR"
check "commit discipline is in the executor prompt" "grep -q 'git log --oneline' $WR"
check "long commands classified by kind in the runner" "grep -q 'in the background' $WR"
check "the supervisor may lean on verifier facts" "grep -q 'VERIFIER FACTS' $SUPP"
check "the supervisor backgrounds long commands"  "grep -q 'never by predicted duration' $SUPP"
check "the skill documents the verify stage"    "grep -q 'Mechanical verification before the judge' $MM"
check "contracts are preflighted at the base"   "grep -q 'Preflight the contracts at the base' $MM"
check "amendments propagate only mechanically"  "grep -q 'An amendment exists only when the plan file is edited' $MM"
check "single-task invocations are allowed"     "grep -q 'parallel single-task runner invocations' $MM"

section "super-plan and ship: sizing, scoped gates, acceptance references"
check "task right-sizing is a rule"             "grep -q 'Right-size every task' $SP"
check "gates are scoped to the task's files"    "grep -q 'gates to its files' $SP"
check "base expectations are recorded"          "grep -q 'expected base status' $SP"
check "acceptance references exist"             "grep -q 'Acceptance References' $SP"
check "ship preflights before the first wave"   "grep -q 'contract preflight at the pushed tip' $SH"
check "unverified references reach the PR body" "grep -q 'Not verified — manual QA needed' $SH"
check "the runtime pass probes capability, not names" "grep -q 'described capability' $SH"

section "multi-model: the lifecycle belongs to the orchestrator, not the user"
check "plan is opened at launch"               "grep -q 'Write the wave plan file' $MM"
check "plan is closed at completion"           "grep -q 'Set the wave plan.*status: done' $MM"
check "the user never hand-edits it"           "grep -q 'You own both transitions' $MM"
check "status gate fails closed"               "grep -q 'first code fence' $MM"
check "branch gate reads declared branches"    "grep -q 'declared branches only' $MM"

section "multi-model: the evidence base for every anti-deception rule"
# Losing a citation turns a measured rule into an opinion. Each of these points
# at a specific page in references/model-dossiers.md.
for c in "161–163" "109–110" "171–181" "p. 81" "37–39" "170–171" "33–35" "122–124" "202–203"; do
  check "citation $c survives" "grep -qF '$c' $MM"
done

section "Both skills: rules must be findable by the model that needs them"
check "critical-review names the fix-phase triggers" \
  "sed -n '3p' $CR | grep -qF 'optional follow-up fixes and thread resolution'"
check "multi-model names Claude and GPT executors" \
  "sed -n '3p' $MM | grep -qF 'routed across Claude or GPT-5.6 agents'"

section "super-plan: planning that lands wave-ready"
check "the skill exists"                        "[ -f $SP ]"
check "the lint script ships"                   "[ -f plugins/orchestration/skills/super-plan/references/plan-lint.mjs ]"
check "lint is mandatory before the plan gate"  "grep -q 'plan-lint.mjs' $SP"
check "same-wave file overlap is forbidden"     "grep -q 'must not share files' $SP"
check "questions are batched, not dripped"      "grep -q 'Collect genuine product forks in one batch' $SP"
check "questions use host-neutral interaction"  "grep -q 'host-native structured input tool' $SP"
check "status transitions stay with execution"  "grep -q 'status transitions belong' $SP"
check "headless mode records assumptions"       "grep -q 'Assumptions (would ask)' $SP"
check "superpowers attribution survives"        "grep -q 'Jesse Vincent' $SP"
check "the MIT notice ships"                    "[ -f plugins/orchestration/skills/super-plan/references/LICENSE-superpowers ]"
check "plan model fields are provider-specific" \
  "sed -n '/^## Plan Format$/,/^## Acceptance References$/p' $SP | grep -qF '| Codex | \`gpt-5.6-sol\`, \`gpt-5.6-terra\`, \`gpt-5.6-luna\` |'"
check "bare GPT alias is excluded from plan fields" \
  "sed -n '/^## Plan Format$/,/^## Acceptance References$/p' $SP | grep -qF '\`gpt-5.6\` is never a plan id'"
check "profile rather than host defaults routes every plan role" \
  "grep -qF 'active profile chooses executor, supervisor, ladder, and effort' $SP"
check "planning rejects a mixed-provider wave before Gate 2" \
  "grep -qF 'mixed-provider wave is a planning defect to fix before Gate 2' $SP"
check "Codex rework stays outside the model-transition ladder" \
  "grep -qF 'same-model raised-effort rework is state-machine behavior' $SP && grep -qF 'ladder lists model transitions only' $SP"

section "ship: the conductor that adds no machinery"
check "the skill exists"                        "[ -f $SH ]"
check "ship adds no machinery"                  "grep -q 'ship adds no machinery' $SH"
check "exactly one ship-level gate"             "grep -q 'the only one ship adds' $SH"
check "fixes route on behavior, not size"       "grep -q 'what the change can break' $SH"
check "the merge stays with the user"           "grep -q 'merge stays with the user' $SH"
check "wave bases are copied, never typed"      "grep -q 'rev-parse' $SH"
check "thread phase keeps critical-review's gate" "grep -q 'push → replies → resolves' $SH"
check "ship preserves the plan provider and exact model effort ids" \
  "grep -qF 'consume the approved plan’s provider and preserve its exact model and effort ids verbatim' $SH"
check "ship routes provider protocol selection through multi-model" \
  "grep -qF 'native Codex protocol for Codex plan waves and the Claude Workflow adapter for Claude plan waves' $SH"
check "ship does not take over provider execution" \
  "grep -qF 'Only multi-model selects that adapter and owns all subagent execution' $SH && grep -qF 'ship never invokes provider CLIs, adapter workflows, or state helpers itself' $SH"
check "post-review fixes include own findings without threads" \
  "grep -qF 'every approved finding that produces a fix, including an \`own\` finding with no PR threads' $SH"
check "review fix commits remain unpublished until critical-review approval" \
  "grep -qF 'Keep every resulting fix commit local through apply, commit, and verification' $SH && grep -qF 'Only after that approval does publication run \`push → replies → resolves\`' $SH"
check "post-review behavior fixes are not pushed like ordinary waves" \
  "! sed -n '/^## Stage 3 — Review$/,/^## Stage 4 — Handoff$/p' $SH | grep -qF 'pushed like any wave'"
check "ship explicitly invokes review behavior fixes locally" \
  "sed -n '/^## Stage 3 — Review$/,/^## Stage 4 — Handoff$/p' $SH | grep -qF 'multi-model with \`publication: local\`'"

section "Fable 5.1: every skill routes the new model ID to its own profile"
OF=plugins/orchestration/skills/multi-model/references/orchestrator-fable-5-1.md
RF=plugins/code-review/skills/critical-review/references/reviewer-fable-5-1.md

check "Step 0: multi-model routes fable-5-1 to its profile" \
  "grep -qF '| \`claude-fable-5-1\` | \`references/orchestrator-fable-5-1.md\` |' $MM"
check "Step 0: super-plan routes fable-5-1 to its profile" \
  "grep -qF '| \`claude-fable-5-1\` | \`../multi-model/references/orchestrator-fable-5-1.md\` |' $SP"
check "Step 0: ship routes fable-5-1 to its profile" \
  "grep -qF '| \`claude-fable-5-1\` | \`../multi-model/references/orchestrator-fable-5-1.md\` |' $SH"
check "Step 0: critical-review routes fable-5-1 to its profile" \
  "grep -qF '| \`claude-fable-5-1\` | \`references/reviewer-fable-5-1.md\` |' $CR"

check "the fable-5 row survives in multi-model"     "grep -qF '| \`claude-fable-5\` ' $MM"
check "the fable-5 row survives in super-plan"      "grep -qF '| \`claude-fable-5\` ' $SP"
check "the fable-5 row survives in ship"            "grep -qF '| \`claude-fable-5\` ' $SH"
check "the fable-5 row survives in critical-review" "grep -qF '| \`claude-fable-5\` ' $CR"

check "the orchestrator fable-5.1 profile ships"    "[ -f $OF ]"
check "the orchestrator profile gates on its model id" "grep -qF 'claude-fable-5-1' $OF"
check "the orchestrator profile tells a mismatched model to stop" \
  "grep -qF 'stop reading it' $OF"
check "the reviewer fable-5.1 profile ships"        "[ -f $RF ]"
check "the reviewer profile gates on its model id"  "grep -qF 'claude-fable-5-1' $RF"
check "the reviewer profile tells a mismatched model to stop" \
  "grep -qF 'stop reading it' $RF"

check "the 5.1 orchestrator profile routes research off-seat" \
  "grep -q 'Research Routing' $OF"
check "the 5.1 profile pins no fixed effort level" \
  "grep -qF 'No fixed level is pinned' $OF"
check "the 5.1 profile records its medium peak"    "grep -qF 'peaks at medium' $OF"

check "the judge-bias rule survives"                "grep -qF 'told the author is Claude' $MM"
check "the judge-bias citation survives"            "grep -qF 'p. 124' $MM"
check "the judge prompt rule names the omission"    "grep -qF 'never names the executor' $MM"
check "the shipped judge prompt never names the executor's model" \
  "! sed -n '/^function supervisorPrompt/,/^}/p' $WR | grep -q 'executor'"

check "the supervisor table names Fable 5.1 as Opus 5's judge" \
  "grep -qF '| Opus 5 | Fable 5.1 via \`fable\`' $MM"

check "the multi-model dossier has a Fable 5.1 section" \
  "grep -q '^## Fable 5.1' plugins/orchestration/skills/multi-model/references/model-dossiers.md"
check "the reviewer dossier has a Fable 5.1 section" \
  "grep -q '^## Fable 5.1 as a reviewer of its own code' plugins/code-review/skills/critical-review/references/reviewer-dossier.md"

check "README carries the fable-5.1 row"            "grep -qF '| \`claude-fable-5-1\` |' README.md"
check "multi-model still routes Fable 5.1"         "grep -qF '| \`claude-fable-5-1\` | \`references/orchestrator-fable-5-1.md\` |' $MM"

section "Opus 4.8 is addressable by its full model ID"

PL=plugins/orchestration/skills/super-plan/references/plan-lint.mjs
OP5=plugins/orchestration/skills/multi-model/references/orchestrator-opus-5.md

check "the runner accepts the pinned ID"            "grep -qF \"'claude-opus-4-8'\" $WR"
check "the linter accepts the pinned ID"            "grep -qF \"'claude-opus-4-8'\" $PL"
check "the runner carries no other full model ID" \
  "! grep -o 'claude-[a-z0-9.-]*' $WR | grep -v '^claude-opus-4-8\$' | grep -q ."
check "the simulator tier guards the single-ID rule" \
  "grep -qF \"grep -v '^claude-opus-4-8\$'\" tests/wave-runner.test.sh"
check "the linter tier rejects the bare short form" \
  "grep -qF '\"model\": \"opus-4-8\"' tests/plan-lint.test.sh"
check "the skill names the ID in the supervisor row" \
  "grep -qF 'fallback: Opus 4.8 via \`claude-opus-4-8\`' $MM"
check "the skill's opts.model rule names the pin"   "grep -qF 'pinned full ID' $MM"
check "the old not-addressable wording is gone"     "! grep -q 'not addressable' $MM"
check "the fable-5.1 profile names the pinned ID"   "grep -qF 'claude-opus-4-8' $OF"
check "the opus-5 profile names the pinned ID"      "grep -qF 'claude-opus-4-8' $OP5"

summary
