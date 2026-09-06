# 002 — Supervised waves with artifact-based acceptance

## Status

Accepted. Shared policy is implemented through distinct Claude and Codex adapters.

## Context

An executor report cannot establish its own correctness. Shared working trees
also prevent attributing changed paths to a task and make verification race with
neighboring edits. Rewriting an escalation script for every wave makes control
flow depend on a fresh interpretation of prose.

## Decision

Use narrow, self-contained tasks with no file overlap within a wave. Each task
combines intent with a five-key contract: `files_allowed`, `files_forbidden`,
`must_run`, `forbidden_moves`, and `report_must_answer`. Scope task commands to
their files; the full repository gate belongs at wave integration. Record each
command's expected base status and preflight it before launch. Product forks
remain user decisions. Acceptance references become checkable pins where
possible; unverified references remain explicit manual-QA obligations.

The canonical plan has an unfenced status/base header, one `json wave-plan`
block, and matching task prose. `super-plan` owns design and lint-clean plan
approval; execution owns `draft` → `active` → `done`. The storage contract stays
`docs/superpowers/plans/`: the hook scans Markdown there for an active header.
Completed plan instances are removed, and documentation indexes belong elsewhere.

Each executor commits to `wave/<task-id>` in its own worktree. Record the actual
pushed fork point and verify ancestry; a local-only baseline can make unrelated
files look deleted in every task. Preserve existing user work and conflicting
worktrees instead of forcing a clean state. Rework continues the same branch.

Use the shipped control flow. Claude's Workflow runner assembles prompts from
the same contract object for executor and supervisor, validates input before
spawning, and takes the full shared supervisor prompt as an argument. Codex's
state helper owns validation, prompt assembly, worktree preparation, verification,
and transitions; native subagents perform the model work. Its initialized digest
binds the selected wave and task prose. Reports, facts, and fixed verdicts are
persisted; hidden reasoning and credentials are not.

Verification precedes judgment. Claude's verifier agent gathers branch, path,
command, and evidence-presence facts; deterministic failures get one mechanical
rework per rule, with repeats sent to the judge to assess satisfiability. A dead
Claude verifier falls back to full model supervision. Codex runs its mechanical
verifier in the helper, and a clean verdict cannot override blocking facts.
Merge readiness requires the final clean facts and clean supervisor verdict.

The supervisor is a different exact model from every executor/ladder rung, and
its input omits executor identity. Give executors the full rules and explicit
stop/report boundaries while withholding the supervisor's detection method.
The supervisor checks the diff, prohibited changes, and truth of report answers;
independent verifier output may satisfy command re-execution. Its standalone
command protocol runs `must_run` as an ordered sequence in one fresh workspace
and retries the whole sequence from a fresh checkout. This distinguishes an
honest generate-then-test dependency from a suite that heals or poisons itself.

Only evidenced contract violations block. The classes are `files`, `must_run`,
`forbidden-move`, and `report`; suspicions belong in non-blocking `remarks`.
Record `pasteReproduced` with observed outputs, without judging honesty. Stale
or differently prepared output cannot establish fabrication. Two mismatch
strikes across attempts escalate through code. An unsatisfiable command still
requires `ok:false` and `satisfiable:false` on the violation; it must not be
laundered into a passing verdict's remarks.

The runners bound rework, escalation, and infrastructure retries, retain verdict
history, and cap executor attempts at six. An unsatisfiable contract stops the
task immediately for the orchestrator's one-amendment flow: repairs that cannot
hide a defect are recorded and applied; weakening a required check or prohibition
requires user approval. Exhausted/error branches survive for diagnosis. A
missing repository, base, branch, model, or tool is never silently substituted.

Merge only accepted task branches and perform the shared full-wave review.
The normal publication contract is `publication: push`. Only critical-review's
post-review fix flow may explicitly request `publication: local`: complete
isolation, verification, supervision, and local integration, then return commits
and evidence without pushing. It still starts at the pushed PR head and cannot
create dependent unpushed wave bases to bypass the publication gate.
`ship` composes the existing skills on a feature branch; the final PR merge
remains the user's decision.

## Consequences

Isolation and extra verification cost time, but make scope and acceptance
auditable. Mechanical facts reduce wasted judge calls; judgment is reserved for
questions a script cannot decide. A reproduced failure can block even an honest
executor, while uncertainty alone cannot. Local publication keeps review fixes
concrete before the exact-text publication decision.

## Implementation anchors

- [Planning skill](../../plugins/orchestration/skills/super-plan/SKILL.md) and
  [plan linter](../../plugins/orchestration/skills/super-plan/references/plan-lint.mjs).
- [Wave policy](../../plugins/orchestration/skills/multi-model/SKILL.md),
  [Claude runner](../../plugins/orchestration/skills/multi-model/references/wave-runner.workflow.mjs),
  [Codex protocol](../../plugins/orchestration/skills/multi-model/references/codex-wave-protocol.md),
  [Codex helper](../../plugins/orchestration/skills/multi-model/references/codex-wave-state.mjs), and
  [supervisor prompt](../../plugins/orchestration/skills/multi-model/references/supervisor-prompt.md).
- [Ship composition](../../plugins/orchestration/skills/ship/SKILL.md),
  [runner tests](../../tests/wave-runner.test.sh),
  [state tests](../../tests/codex-wave-state.test.sh), and
  [plan tests](../../tests/plan-lint.test.sh).
