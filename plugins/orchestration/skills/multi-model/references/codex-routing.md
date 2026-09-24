# Codex route selection

Read for Codex authoring in multi-model, super-plan and ship. This shared policy
governs child routing for Astra, GPT-5.6 and generic seats; it does not change
active-seat identity guards or Claude routing. Unknown coordinator identity or
effort stays unknown; available exact child IDs can still establish a route.

## Authoring decision

Choose from the host's actually available children and supported efforts.
The wave's supervisor is chosen at Gate 1 — the premium `gpt-6-astra` at
`high` (requires `approvals.premium`) or, for a wave whose executors and
rungs are all `gpt-6-luna`, the standard `gpt-6-sol` at `high` (see
Verification and stops); then use the task table below. Availability is a
capability check, not a reliability claim. Missing historical reports or
pairings with no dated local measurement do not
require separate calibration permission. Normal scope, design and lint-clean
plan approvals still apply; existing authorization remains valid.

| Task class | Initial executor | Effort | Optional ladder, in order |
|---|---|---|---|
| mechanical | `gpt-6-luna` | `medium` | `gpt-6-sol` |
| ordinary | `gpt-6-sol` | `medium` | none |
| difficult | `gpt-6-sol` | `high` | none |

The Luna→Sol rung is available only under an Astra supervisor; a wave with
the standard `gpt-6-sol` supervisor has no ladder.

`ordinary` and `difficult` tasks route their initial executor to `gpt-6-sol`,
so a wave containing either task class has no standard supervisor: the
standard-supervisor option is available only when every executor and rung is
`gpt-6-luna`, and a Sol executor already breaks that condition. Such a wave
needs the premium `gpt-6-astra` supervisor.

Mechanical means a narrow edit with complete instructions and checkable output;
ordinary means a closed implementation across call sites; difficult means a
bounded bug or implementation requiring substantial reasoning. Resolve product
ambiguity before dispatch. Select the initial tier by task needs, not by the
coordinator's model. If it is unavailable, choose an available higher tier before
plan approval and record why; use that model's initial effort from the table
(Sol/medium or Sol/high), since this is initial selection, not runtime
escalation. Omit unavailable optional rungs. If no suitable
executor exists, report that capability gap. Every rung is an exact model ID;
escalated rungs use `high`. Never default to `max`.

Read-only research uses Luna/medium for exact enumeration, Sol/medium for
closed codebase questions, or Sol/high for difficult investigation. Preserve the
mandatory evidence, missing-data and source-reading instructions in multi-model.
Research never replaces independent supervision or the coordinator's decisions.

GPT-5.6 Sol, Terra and Luna are no longer chosen for new plans: GPT-6 Sol and
Luna cost half as much per token and measure far lower on coding deception and
on inventing results when a tool is broken (dossiers `gpt-6-sol-dossier.md`,
`gpt-6-luna-dossier.md`). Already approved plans that name GPT-5.6 IDs still
execute unchanged.

## Verification and stops

Every wave's fixed supervisor is a fresh separate `gpt-6-astra` child at explicit
`high`, absent from the executor ladder, except the standard-supervisor option
below. Give it the contract and actual artifacts
in a fresh context, without the executor's model identity or the coordinator's
preferred conclusion. An Astra main seat is not a substitute for that child.
Use isolated executor worktrees from the recorded base, mechanical verification,
fresh command evidence, scoped diffs and committed-work proof, then the supervisor
verdict and integrated review. Do not skip the supervisor for a mechanical Codex
task. Historical [calibration evidence](gpt-calibration-evidence.md) motivates
these checks; it does not certify this pairing or disqualify a whole model family.

`gpt-6-astra` remains the premium supervisor and needs `approvals.premium`
recorded at Gate 1, the same gate multi-model applies to Fable 5.1, enforced by
the linter. The **standard supervisor** option covers a narrower case: a wave
whose executors and ladder rungs are all `gpt-6-luna` may use a fresh
`gpt-6-sol` supervisor at `high` instead of Astra — there is no Luna→Sol ladder
in such a wave, since Sol already holds the supervisor seat. The supervisor
fixture recorded Sol 9/9 twice on 2026-09-23; that is a repeated fixture pass,
not production calibration, so Sol remains uncalibrated as a production
supervisor outside this narrow all-Luna case. Every stop rule below still
applies unchanged to both the premium and the standard supervisor.

If the required independent supervisor, native dispatch, isolation, or required
check cannot be provided, stop before launching and name the missing capability.
Do not silently substitute a supervisor, inherit defaults, use a mixed-provider
wave or waive checks. Prepare any viable alternative plan for the existing
approval flow. Claude availability is not a prerequisite for this Codex route.

After approval, the lint-clean plan's exact provider/model/effort fields govern
execution, including older valid pairings. A profile update or absent calibration
report cannot reroute or veto it. Actual unavailable capabilities still stop it.
Use the native state helper unchanged: at most two attempts per rung and six
executor attempts per task; terminal failure stops with verdicts. Unsatisfiable
contracts use the existing amendment flow. Never reset counters to obtain more
attempts. Astra execution still needs its separately approved reason and fresh
Astra supervisor; it is not an automatic fallback. Astra execution needs its
`astra_executor_reason` and `approvals.premium`.

This route grants no additional authority for out-of-task edits, discovered
credentials, destructive actions, publication, merge or deploy. Keep ship's
branch/publication approval and feature-branch discipline, super-plan's gates,
and critical-review's fix/publication gates. A failed integration suite stops
publication. Ship never merges the PR or deploys. Ship's final critical-review
runs in a fresh child of the model the plan's `review` key names — chosen by
the user at Gate 1 with its estimated cost: `gpt-6-astra` (premium, recorded
in `approvals.premium`) or `gpt-6-sol` (measured 2026-09-24: clean 10/10,
planted 10/10, PR support 3/4; the PR says so). If the plan has no `review`
key, stop and ask the user before invoking the review; never pick. The fresh
child keeps a GPT-5.6 main seat
from selecting a GPT-5.6 consequential-reviewer profile and keeps the review
independent from the coordinator's context.
Its findings and fix gates remain owned by critical-review; the coordinator
retains its own integrated review and handoff responsibilities.
