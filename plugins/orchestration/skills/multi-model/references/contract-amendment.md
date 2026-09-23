# When the contract is what is broken — the amendment flow

Read from multi-model SKILL.md when a task returns
`contract-unsatisfiable` (`ok:false` with `satisfiable:false`), before
acting on it.

## Contents

- When the contract is what is broken

## When the contract is what is broken

Every other rung assumes the executor was at fault, because that is the only
hypothesis the ladder had. Verified on 2026-08-12: given a contract no compliant
change could satisfy, the ladder reworked, escalated to a stronger model, and
stopped — punishing an innocent executor three times and burning the heavy tier
to do it. All three supervisors said so unprompted, in `remarks`, which by design
change nothing.

So the verdict carries a fact, not a class: **`satisfiable`** — could any change
`files_allowed` permits have altered the outcome of the failing command? — with
the evidence for it. Deciding this is the supervisor's job; deciding what happens
next is not. A class would be another label to argue with; a fact the ladder
reads in code is not.

`ok:false` with `satisfiable:false` stops the wave for that task at once. Do not
rework, do not escalate: a second attempt reproduces the result exactly, and the
supervisors in that run said as much before it happened.

**Amending the contract is your job, not the user's.** You wrote it; you fix it.
Record the amendment in the wave plan with its reason — before and after — so the
change is on the record rather than in your head.

Two kinds of amendment, and the line between them is decidable by diffing the old
contract against the new:

- **Widening `files_allowed`, correcting a wrong path, fixing a broken command** —
  make the change and carry on. None of these can hide a defect: the check still
  runs and the work still has to pass it.
- **Removing or weakening a `must_run` entry, or a `forbidden_move` that produced
  a violation** — write the amendment, then ask the user one yes/no question
  naming exactly what stops being checked. This is the only edit that can make an
  inconvenient check disappear, and the agent that benefits from it is the one
  proposing it.

The user edits nothing. You detect, you draft, you apply. What goes to them is a
decision — whether they accept losing that check — not a file to open. Asking
someone to hand-edit a config is how a safeguard ends up switched off.

**An amendment exists only when the plan file is edited and the runner is
re-invoked with `resumeFromRunId` carrying the amended task.** A mid-wave
"I authorize X" in conversation reaches nobody: the runner rebuilds every
rework prompt from the task object it was given, so an amendment that never
re-enters the runner never reaches an executor. Measured 2026-08: a
verbally pre-authorized dependency never propagated; the rework executor
fell back to a worse design, which passed supervision and shipped, and the
regression was fixed by a later wave at full price.

One amendment per task. A second `satisfiable:false` on the same task goes to the
user whatever kind it is: each loosening looks reasonable alone, and the loop
that ends in a contract checking nothing is built out of reasonable steps.
