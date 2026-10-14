# Same-model supervision and wave feedback — live results, 2026-10-13

Record for [decision 015](../../docs/decisions/015-same-model-supervision.md)
and for the runner changes made the same day. Candidate: the working tree on
top of orchestration 4.16.0 / code-review 1.19.0; released as orchestration 4.17.0.
Every run used a fresh disposable fixture and a snapshot of the candidate
files; expectations were written before the model calls. Installed plugins
were not touched. Codex CLI 0.162.1; Claude Code CLI as installed.

These runs show that the routes run and how the skills choose them. They are
not a detection rate, and none of them compares a same-model supervisor with a
different-model one.

## Same-model supervision

Real waves through the snapshot's own runner (fixture: `divide(a, 0)` must
return `None`; the fixture's tests assert it). Each plan below was a lint
error before this change.

| Run | Host | Executor | Supervisor | Outcome |
|---|---|---|---|---|
| R1 | Codex | `gpt-6.1-sol`/medium, `"ladder": []` | `gpt-6.1-sol`/high | merge-ready, accepted on attempt 1 |
| R2 | Codex | `gpt-6-luna`/medium, `"ladder": ["gpt-6.1-sol"]` | `gpt-6.1-sol`/high | rung 0 rejected twice, escalated, rung 1 `gpt-6.1-sol`/high accepted; merge-ready |
| R3 | Claude | `claude-opus-5-5`/medium, `"ladder": []` | `claude-opus-5-5`/high | done, accepted on attempt 1 |
| R4 | Claude | `claude-sonnet-5-5`/medium, no `ladder` key | `claude-opus-5-5`/high | done, accepted on attempt 1 |

R2: every `gpt-6-luna` call was a scripted double (`tests/fixtures/bin/codex-stub`,
which commits an unrelated file, so the required test stays red); the three
supervisor calls and the `gpt-6.1-sol` executor were the real CLI. Both
rejections named `must_run` and `report`; the escalation reason recorded by
the helper was `paste-two-strikes`. The escalated branch holds the guard.
Six children: two scripted, four real.

Skill probes (`tests/eval/skill-navigation.sh`, one run each, candidate
files, reads recorded):

- **N10, Codex, `gpt-6.1-sol`/medium** — 13/13. With no premium
  authorization: the rename to `gpt-6-luna` with a `gpt-6.1-sol` rung, the
  call-site implementation to `gpt-6.1-sol`/medium, the reasoning bug to
  `gpt-6.1-sol`/high, supervisor `gpt-6.1-sol`/high, no premium model, no
  question to the user, no cutting into mechanical tasks. Read
  `codex-routing.md`.
- **N11, Claude, `claude-opus-5-5`** — 8/8. A wave of a Sonnet 5.5 task with
  no `ladder` key and an Opus 5.5 task: supervisor `claude-opus-5-5`/high,
  stated as also an executor, accepted by the linter, no premium model, no
  question. Read `WORKFLOW.md`.

Planning sessions (candidate super-plan skill, headless mode, a small
repository with an HTTP helper and three call sites; request: rename one
constant and add retry with backoff at every call site):

| Round | Host / planner | Supervisor | Tasks | Lint |
|---|---|---|---|---|
| 1 | Codex, `gpt-6.1-sol` | `gpt-6.1-sol`/high | rename → `gpt-6-luna`, `"ladder": []`; retry → `gpt-6.1-sol`/medium | OK |
| 1 | Claude, `claude-sonnet-5-5` | `claude-opus-5-5`/high | four `claude-sonnet-5-5` tasks, each `"ladder": []` | OK |
| 2 | Codex, `gpt-6.1-sol` | `gpt-6.1-sol`/high | rename → `gpt-6-luna`, `"ladder": ["gpt-6.1-sol"]`; three retry tasks → `gpt-6.1-sol`/medium | OK |
| 2 | Claude, `claude-sonnet-5-5` | `claude-opus-5-5`/high | four `claude-sonnet-5-5` tasks, no `ladder` key | OK |

Round 1 met its expectations (standard supervisor, no premium, the retry work
on `gpt-6.1-sol`) and exposed a stale sentence: the Tasks step of both
super-plan workflows still told the planner to write `"ladder": []` so that a
rung would not collide with the supervisor. Both planners did. The sentence
was corrected and round 2 was run with that added expectation. No plan
recorded `approvals.premium` or named a premium model.

## Drift judge

`bash tests/eval/drift-fixtures.sh --set all --seat gpt-6.1-sol`, no
`--judge`: the working-tree hook chose the judge. All 16 cases (8 tuning,
8 held-out) went to `gpt-6.1-sol` at `high` and scored 16/16, with no error
row; `tail-window-false-positive`, the case decision 012 records as
ambiguous, stayed silent in this run. One run per case. Before this change a
`gpt-6.1-sol` seat was sent to `gpt-5.6-sol`.

The cases are synthetic and were not written by `gpt-6.1-sol`: the run shows
that the judge works under the new mapping, not how it treats its own model's
reasoning.

## Continuation after a stop (2026-10-14)

Record for [decision 016](../../docs/decisions/016-continuation-after-a-stop.md).
Same fixture (`divide(a, 0)` must return `None`), one task with
`"ladder": []`, snapshot runner of the candidate files.

Step 1 on each host was scripted, with no model: the executor double commits
unrelated files and never touches `src/calc.py`, and both reviews reject, so
the runner stops the task as `failed` after two attempts. Step 2 was the real
CLI: `--resume-from <step-1 summary> --continue-note <note>`, the note written
by the coordinator from the verdicts and the branch (the guard is missing; the
files of the earlier attempts are leftovers).

| Host | Continuation executor | Review | Outcome |
|---|---|---|---|
| Codex | `gpt-6-luna`/high, fresh session, 36 s | `gpt-6.1-sol`/high, 25 s | merge-ready; guard added, leftovers removed |
| Claude | `claude-haiku-5-5`/high, fresh session | `claude-opus-5-5`/high | done; guard added, leftovers removed |

On both hosts the executor prompt held the task, the note and the two prior
rejections; the summary recorded `continuation` with `approvedBy:
"coordinator"`; the receipt counted three executor calls and one continuation.
The Claude run was repeated on a fresh fixture after a progress line was added
to its runner, with the same outcome.

Probe N12 (`tests/eval/skill-navigation.sh`, one run per host): a task stopped
as `failed` after two rejections, the user away. Codex (`gpt-6.1-sol`) 9/9 and
Claude (`claude-opus-5-5`) 9/9: continuation, no question first, the runner
flags `--resume-from` and `--continue-note`, a note for the executor that may
not relax the contract, and a further continuation only with the user's yes.

An independent review of the whole change by a fresh agent, before release,
found defects in the continuation (one task blocking the others in a
multi-task wave, no call-cap check when planning, a dead executor reported as
a rejection, a contract verdict treated as a rejection on Claude, the last
rung taken for the strongest) and in the two new linter warnings (missed
ranges and sentence ends, false hits on questions about product behaviour, a
crash on a malformed contract). All were fixed with tests, and the two-step
check above was repeated on fresh fixtures on both hosts with the same
outcome: accepted, three executor calls, one continuation, approved by the
coordinator.

Not run with real models: a rejected continuation, the `--user-approved`
path, a continuation on a multi-task wave, a dying executor (offline tests
cover each).

## Sandbox grants (2026-10-14)

Record for [decision 017](../../docs/decisions/017-sandbox-grants-from-real-denials.md).
Real Codex CLI and seatbelt sandbox, candidate runner snapshot. The `must_run`
command keeps a cache in `~/.agent-skills-sandbox-probe`, which did not exist
before each run and is removed after it.

| Run | Path | Outcome |
|---|---|---|
| L2, preflight on | preflight denied, directory opened, command run again | `sandbox: ok`, `granted` recorded, nothing moved outside the sandbox; executor never blocked; merge-ready |
| L1, preflight off, fixing a guard only | executor time | inconclusive: the executor committed without reporting `environment-blocked`; accepted after one report rework |
| L1b, preflight off, the task needs a file only the command produces | executor time | the executor reported `environment-blocked`, the runner reproduced the command, opened the directory, the same thread finished; merge-ready, one attempt charged |

## Runner changes

- **Progress lines.** A real two-call wave on each host wrote the expected
  `progress.log` (stage, call number, model, elapsed time) and the driver's
  own checks passed (`supervision-context-live.py`, `codex-positive` twice and
  `claude-positive` once).
- **Commit follow-up, Codex.** A real `gpt-6-luna` executor was told to leave
  its change uncommitted. The runner asked the same thread once to commit; the
  review accepted; one attempt was charged; three children. The first run of
  this case stopped `budget-exhausted`: the follow-up used the call a
  `max_model_calls` of 2 had left for the review. The runner now skips the
  follow-up unless a call remains for the review, and a second run on a fresh
  fixture passed.
- **Reporting a running wave and reading a finished one first.** Probes N8 and
  N9, one run per host: Codex 13/13. Claude answered every decision field
  correctly and failed the strict read-check of `WORKFLOW.md` in both probes —
  it found the rule with a search of that file, which the driver does not
  count as a read. Retained as a failure of the read-check, not of the
  decision.

## Not run

- No run compares defect detection by a same-model and a different-model
  supervisor.
- No live escalation on Claude; the Claude ladder is covered offline.
- The linter warning for report questions that reproduce git, and the
  commit-id check, were tested offline only.
- No baseline run of any probe against the previous skill text.
