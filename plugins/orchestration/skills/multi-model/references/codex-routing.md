# Codex route selection

Read for Codex authoring in multi-model, super-plan and ship. This shared policy
governs child routing for Astra, GPT-5.6 and generic seats; it does not change
active-seat identity guards or Claude routing. Unknown coordinator identity or
effort stays unknown; available exact child IDs can still establish a route.

## Authoring decision

Choose from the host's actually available children and supported efforts.
For a new Codex wave with an available independent `gpt-6-astra` supervisor at
`high`, use the task table below. Availability is a capability check, not a
reliability claim. Missing historical reports or uncalibrated pairings do not
require separate calibration permission. Normal scope, design and lint-clean
plan approvals still apply; existing authorization remains valid.

| Task class | Initial executor | Effort | Optional ladder, in order |
|---|---|---|---|
| mechanical | `gpt-5.6-luna` | `medium` | `gpt-5.6-terra`, `gpt-5.6-sol` |
| ordinary | `gpt-5.6-terra` | `medium` | `gpt-5.6-sol` |
| difficult | `gpt-5.6-sol` | `high` | none |

Mechanical means a narrow edit with complete instructions and checkable output;
ordinary means a closed implementation across call sites; difficult means a
bounded bug or implementation requiring substantial reasoning. Resolve product
ambiguity before dispatch. Select the initial tier by task needs, not by the
coordinator's model. If it is unavailable, choose an available higher tier before
plan approval and record why; use that model's initial effort from the table
(Terra/medium or Sol/high), since this is initial selection, not runtime
escalation. Omit unavailable optional rungs. If no suitable
executor exists, report that capability gap. Every rung is an exact model ID;
escalated rungs use `high`. Never default to `max`.

Read-only research uses Luna/medium for exact enumeration, Terra/medium for
closed codebase questions, or Sol/high for difficult investigation. Preserve the
mandatory evidence, missing-data and source-reading instructions in multi-model.
Research never replaces independent supervision or the coordinator's decisions.

## Verification and stops

Every wave's fixed supervisor is a fresh separate `gpt-6-astra` child at explicit
`high`, absent from the executor ladder. Give it the contract and actual artifacts
in a fresh context, without the executor's model identity or the coordinator's
preferred conclusion. An Astra main seat is not a substitute for that child.
Use isolated executor worktrees from the recorded base, mechanical verification,
fresh command evidence, scoped diffs and committed-work proof, then the supervisor
verdict and integrated review. Do not skip the supervisor for a mechanical Codex
task. Historical [calibration evidence](gpt-calibration-evidence.md) motivates
these checks; it does not certify this pairing or disqualify a whole model family.

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
Astra supervisor; it is not an automatic fallback.

This route grants no additional authority for out-of-task edits, discovered
credentials, destructive actions, publication, merge or deploy. Keep ship's
branch/publication approval and feature-branch discipline, super-plan's gates,
and critical-review's fix/publication gates. A failed integration suite stops
publication. Ship never merges the PR or deploys. For ship's independent final
critical-review, invoke that skill in a fresh Astra/high child so a GPT-5.6 main
seat does not accidentally select a GPT-5.6 consequential-reviewer profile.
Its findings and fix gates remain owned by critical-review; the coordinator
retains its own integrated review and handoff responsibilities.
