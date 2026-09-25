# When the contract is what is broken — the amendment flow

`environment-blocked` is never an amendment. It means the machine, not the
contract, failed — see ADR 009
(`docs/decisions/009-environment-blocked-and-worktree-env.md`) and
`codex-wave-protocol.md`'s "Toolchain caches, `.git`
and linked files". Fix the machine and re-run the wave; do not touch the
contract in response to it.

Read from multi-model SKILL.md when a task returns
`contract-unsatisfiable` (`ok:false` with `satisfiable:false`), before
acting on it.

## Contents

- When the contract is what is broken
- The Codex path

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

Three kinds of amendment, and the line between them is decidable by diffing the
old contract against the new:

- **Widening `files_allowed`, correcting a wrong path, fixing a broken command** —
  make the change and carry on. None of these can hide a defect: the check still
  runs and the work still has to pass it.
- **Removing or weakening a `must_run` entry, or a `forbidden_move` that produced
  a violation** — write the amendment, then ask the user one yes/no question
  naming exactly what stops being checked. This is the only edit that can make an
  inconvenient check disappear, and the agent that benefits from it is the one
  proposing it.
- **`blocked-on-sibling`** — move the task into a wave after its producer
  merges (or merge it into the producer's task); never widen `files_allowed`
  into a sibling's files. No user question is needed: no check is removed.

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

## The Codex path

For a Codex-native wave (`codex-wave-protocol.md`) there is no
`resumeFromRunId`: write a single-task recovery plan instead. It:

- sets top-level `"inherits": "<parent plan path>"` (a repository-relative
  path of the parent plan; see the Plan Format section in
  `super-plan/SKILL.md` and `worktree-env.mjs`'s
  `effectivePlan`/`INHERITED_KEYS`), so `ci`, `e2e`,
  `worktree`, `approvals` and `review` carry over without being retyped;
- gives the recovery task a new id `<id>-r<N>` (`<N>` starting at 1, bumped
  on every further recovery of the same task) rather than reusing the
  original task id;
- carries the amended contract — the one edit this flow exists to make;
- sets the wave's base to the pushed feature tip the failed task's branch
  was rejected against, i.e. the current `origin/<default-branch>`, not the
  original wave's `--base`;
- when the inherited `e2e` names a task id from the parent plan (the
  recovery plan's own single task rarely is it), `effectivePlan` marks it
  `"not-applicable: inherited e2e task <id> is not part of this recovery
  plan"` automatically — the recovery plan does not need to override `e2e`
  itself to avoid a dangling reference.

Lint the recovery plan, then run `codex-wave-runner.mjs` on it exactly as for
any other wave — its own `init`, `--preflight`, and verification apply
unchanged; nothing here bypasses them.
