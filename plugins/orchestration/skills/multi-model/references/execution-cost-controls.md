# Execution cost controls

These controls belong in the approved wave plan. Existing plans keep model
supervision and the six-attempt maximum. Never relax a contract to save calls.

## Native Claude execution

Run `node references/claude-wave-runner.mjs --plan <file> --wave <n> --repo <abs>
--base <pushed sha> --default-branch <branch>`. Options: `--claude <executable>`,
`--jobs 3`, `--timeout-min 45`, `--out <new directory>`, `--preflight on|off`.
The launcher still lints and checks the pushed base and dependencies. The runner
uses the shipped Workflow escalation policy.

Each supervisor, and each executor's first attempt, starts a new CLI session with a
small built-in tool list, no MCP servers (`--strict-mcp-config`) and its task
prompt, without the coordinator's conversation. A rework on the same rung (same
model and effort, same runner process) instead resumes that executor's persisted
session and sends only the prior verdict and the report reminder; a failed resume
falls back to a fresh session with the full prompt. Authentication and repository
instructions use normal CLI configuration; `--bare` is not used. Supervisors get
detached checkouts and read tools plus Bash; modifying their checkout, changing its
HEAD or moving the task branch invalidates the result. Verdicts remain bound to the
verified task commit.

Verification runs in code, so a standard green task uses two model invocations
rather than three. Internal model turns still cost tokens. Full output, verdicts
and usage stay in the run directory. Stdout returns a small status and the
`summary.json` path; read full logs only to resolve an evidence question.

The old Workflow tool is a fallback when the local CLI is unavailable. It retains
the verifier-agent stage and its resume semantics. Mechanical-only tasks are
unavailable on that fallback. Never substitute executor-supplied verification.

## Mechanical contracts

A task may explicitly set `"supervision": "mechanical"` when all acceptance
obligations are machine-checkable. It requires nonempty `must_run`, empty
`forbidden_moves`, and empty `report_must_answer`. Commands must establish the
substantive result; `true` alone does not establish a deliverable. Semantic review,
security, migrations and behavioral claims stay model-supervised.

Native Claude and Codex independently check committed work, allowed/forbidden
paths and the ordered pipeline. Completely green mechanical tasks receive a
deterministic verdict without a judge model. Red tasks use the normal judge path
to decide satisfiability and rework; a positive model verdict cannot override red
mechanical evidence. Do not describe a deterministic verdict as a model review.

## Reusing verification

Opt in by setting `"cache": "artifact"` on **every** `must_run` entry:

```json
{"cmd":"python3 -m unittest tests.test_parser","evidence":"required","cache":"artifact"}
```

This declares that the pipeline depends only on committed files and the local
environment. Do not opt in for network, time, mutable databases, absolute paths
into other worktrees or undeclared untracked inputs. Environment changes not
represented by process environment or linked-file metadata require a fresh run or
disabling reuse. No automatic dependency inference is attempted.

Reuse is scoped to one task and run. It requires the same repository, branch,
base, exact commit, full contract including command order, hashed process
environment, runtime and linked-file metadata. Linked files are stat'ed, never
opened. Changes invalidate the whole pipeline. Only first-pass green results are
reused; failures, timeouts and unstable second-pass results are rerun. Full logs
and the artifact binding remain inspectable. Model verdicts are never cached.

## Limits

A wave may set per-task bounds:

```json
"limits": {"max_attempts": 2, "max_model_calls": 6}
```

`max_attempts`: integer 1–6. `max_model_calls`: integer 1–24. Unknown keys and
invalid values fail before execution. Transport/format failure retries count as
calls. These bounds constrain invocations, not internal turns, tokens or dollars.
Both native drivers retain their per-model-child timeout. Claude applies
`--timeout-min` separately to each verification command, allowing the worker to
finish descendant cleanup and remove its disposable checkout. A whole pipeline
may take longer than that limit; its worker has no shorter outer deadline.

A cap stops further launches and preserves branches and evidence. Claude reports
`budget-exhausted`; Codex uses that driver stop reason for a call cap and ordinary
`failed` task status for an attempt cap. Examine the last evidence and change the
contract or strategy; do not automatically start another run to reset the cap.
Completing successfully at the limit is accepted. Remarks alone never cause rework.


## Continuing a committed candidate

Both native drivers accept `--resume-from <previous summary.json>` with the
current lint-clean plan and a **new** `--out`. This resumes verification and
review only; it never calls an executor, even when the candidate is rejected.
Use it after an environment repair or an explicitly approved contract correction.
Do not use `--reset` merely to recover a ready candidate.

A receipt binds the repository, base, task ids, product prose, roles/effort,
approvals, delivery obligations and limits. These cannot change on recovery.
The candidate must still have its recorded HEAD, descend from base and have a
clean attached worktree. A changed contract is verified and reviewed afresh;
old verifier facts and verdicts are retained in the earlier artifacts, not reused
as current evidence. This first recovery mode deliberately reruns verification:
it does not infer toolchain identity across runs.

All prior child launches, including failed calls, count against the same call
cap (recovery uses a maximum of 24 calls when the plan omitted it). The previous receipt can be continued once; use the latest summary for
further recovery. Recovery summaries link to earlier evidence. A cap cannot be
increased through this route. A genuinely changed product requirement or role
needs a new authorized plan, with the prior task's costs recorded rather than
hidden by renaming it. Receipts are local runner state, not authorization supplied
by an executor. Old summaries without a receipt are not automatically adopted.

## Known preflight blockers

`worktree.links` are mandatory. Use `worktree.optional_links` for genuinely
optional paths. Missing mandatory links fail before model launches; disappearance
between preflight and checkout also fails. Linked configuration is never opened
or printed. Explicit writable roots must be existing stable directories, not
transient lock files; prepare the necessary directory before launch and verify
sandbox access with the real command. Automatic cache detection still reports
missing directories without creating or granting broad access.

The native driver checks that its CLI executable is available before starting;
this is not a claim that remote authentication or a model endpoint is reachable.
Codex semantic lint catches common rules that forbid its required unsigned
executor commits or squash integration. Preserve the prohibition on changing
persistent signing configuration; phase-specific flags and signed integration
are different operations. Arbitrary prose is not fully validated by this lint.
Merge ancestry that cannot survive squash requires a separate supported workflow.
