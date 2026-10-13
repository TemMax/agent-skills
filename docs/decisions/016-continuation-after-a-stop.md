# 016 — A stopped task gets one continuation on the same code

Date: 2026-10-14
Status: accepted

## Context

A task rejected on its last rung stops as `failed`. The skill then handed the
task to the user and forbade resetting its counters, but offered no way to go
on with the candidate: `--resume-from` verifies and reviews a candidate
without ever calling an executor, and `--reset` discards it.

A user's series of 18 runner invocations on one feature (2026-10-12 and
2026-10-13, process metadata only) shows what filled the gap. Four times after
a stop the coordinator wrote a new plan with a renamed task for the same work
and the executor started again from the base; `--resume-from` was used in none
of the 18. The stops themselves were mostly correct: 16 of the 19 rejections
named a defect in the code or a missing commit.

Working on this, the Codex recovery path was found to crash, with no
`summary.json`, whenever it accepted a candidate that had taken two or more
executor attempts: the helper compared the recovery state's own verifier
facts and verdicts with the report count padded from earlier runs.

## Decision

1. **One continuation per stopped task is the coordinator's decision.** For a
   task stopped as `failed` the coordinator reads the verdicts and the
   candidate, writes a note saying what is wrong and where, and runs the
   native runner with `--resume-from <summary.json> --continue-note <file>`
   and a new `--out`. It does not ask first; it reports the continuation in
   one line.
2. **What a continuation is.** One executor attempt on the existing branch:
   the highest tier of the task's ladder at `high` at least, a fresh session,
   the full task prompt, the note and the last two rejections; then
   verification and a fresh review. A rejection ends the task again. In a
   wave of several stopped tasks each one continues on its own
   `## Task <id>` section of the note.
3. **Bounds.** Each rejected task is decided on its own: one at its attempt
   cap, one with fewer than two model calls left, one that already had a
   continuation while `--user-approved` is absent, or one without a note
   section is skipped and reviewed again as in plain recovery. The run is
   refused, launching nothing and leaving the previous receipt unclaimed, only
   when no task can continue. The caps count every earlier call and are not
   raised. The receipt counts a continuation per task once its executor has
   reported, and the summary records who approved each.
4. **What it is not.** The note carries diagnosis, never a new requirement or
   a relaxed check: a contract defect still goes through the amendment flow.
   The coordinator does not patch a stopped candidate itself, and does not
   write a new plan or a renamed task for work a stopped task holds.
5. **Recovery fix.** A recovery state's merge-ready check compares its own
   verifier facts and verdicts with each other, so a candidate of two or more
   attempts can be accepted by `--resume-from`.

Both native drivers implement this. The legacy Claude Workflow fallback does
not.

## Evidence and limits

An independent review of the change before release found that the first
version refused the whole run when one task could not continue, did not check
the call cap when planning, mislabelled a dead executor and, on Claude, turned
a verdict blaming the contract into a rejection. These are fixed and covered
offline; the bounds above describe the fixed behaviour.

Recorded in
[`tests/eval/same-model-supervision-results-2026-10-13.md`](../../tests/eval/same-model-supervision-results-2026-10-13.md):
a real continuation on each host accepted on a fixture where the first two
attempts were scripted to miss the task, and a skill probe on each host chose
the continuation without a question. One run each. The fixture is a two-line
change; nothing here measures how often a continuation succeeds on real work,
or how good a coordinator's note is.
