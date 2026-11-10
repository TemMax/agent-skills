# Fable 5.2 seat — live results, 2026-11-10

Record for [decision 019](../../docs/decisions/019-fable-5-2.md).

Candidate: orchestration 4.22.0 and code-review 1.21.0, the working tree of
branch `adapt-skills-fable-5-2` before commit. Every run loads it
disposably: Claude Code 2.1.322 with the snapshot as `--plugin-dir`,
`--setting-sources project`, `--strict-mcp-config` and no MCP servers. No
installed plugin, marketplace or configuration was touched. Raw outputs are
kept outside the repository for the lifetime of the pull request.

## Alias probes (before any skill change)

| Probe | Result |
|---|---|
| `claude -p --model fable` | billed `claude-fable-5-2` only ($0.142) |
| Agent-tool spawn with `model: fable` | `resolvedModel` `claude-fable-5-2` |

The alias table still said `fable` → Fable 5.1, so a spawn written for Fable
5.1 through the alias would have started Fable 5.2 as a child.

## Round 1 — frozen expectations

Written before any run below. Seat `claude-fable-5-2` at `medium` (Claude
Code's default effort), one run per case.

Seat checks, every run, read from the run's stream-json trace:

- **C1** the session reads its own profile — `orchestrator-fable-5-2.md` for
  super-plan, multi-model and ship, `reviewer-fable-5-2.md` for
  critical-review — and no other orchestrator or reviewer profile;
- **C2** every Agent spawn names a model, none names `fable` or
  `claude-fable-5-2`, and no plan or runner call gives a role to
  `claude-fable-5-2`;
- **C3** the final reply names no profile file.

| Run | Driver | Expected |
|---|---|---|
| plan-interfaces | `plan-content-live.py --case interfaces` | the driver's frozen checks: lint-clean plan, Review Focus above the first task, one producer and every user under Consumes, task code share ≤ 0.5, no other file changed |
| plan-platform | `plan-content-live.py --case platform` | lint-clean plan; the platform question under `## Assumptions (would ask)`, not decided |
| review-implied | `review-content-live.py --case implied` | an Important or Blocker finding at `src/ratings.py` for the empty input; a `Set aside` line; no file changed |
| review-plan | `review-content-live.py --case plan` | the empty-input row labeled `plan-mandated`, Important or Blocker; a `Set aside` line; no file changed |
| wave | `fable-seat-live.py --case wave` | the snapshot's Claude runner runs the approved one-task wave; `main` on `origin` gets the task's files and its tests pass there; files outside the contract unchanged; no pull request; the final reply neither lists owed work nor offers to continue |
| ship-gate | `fable-seat-live.py --case ship` | ship plans, lints and stops at its one start approval (Gate 2): no runner, no wave branch, no product file changed; the Gate 2 message asks for the approval and names the branch and the pull request; the plan names no `claude-fable-5-2` |

A transport or environment failure is recorded as a blocked run, not a
result. A failure is inspected before any retry, and kept.

## Round 1 — results

Five runs met their frozen expectations as written. Ship-gate met all but
one: its Gate 2 message said why no pull request would be opened instead of
naming one (see the deviation below). None was retried. The planning, wave
and ship runs loaded orchestration 4.22.0 from their snapshots and the
review runs code-review 1.21.0; each snapshot's plugin files were identical
to the candidate's at the time of its run — the round-1 text, before the
independent review. C1–C3 were first scored by hand from the traces, then
recomputed from the kept traces with `fable-seat-live.py --score`: the same
result for all six runs.

| Run | Outcome | Seat checks C1–C3 | Session cost, time |
|---|---|---|---|
| plan-interfaces | pass, 11/11 driver checks: four tasks, lint-clean, Review Focus (five items) above the first task, one producer and three consumers, no code in the task prose; Sonnet 5.5 executors under Opus 5.5 supervisors | pass: profile read with `cat` in a shell call, no other profile; one spawn, the seam audit, through `sonnet` at `medium` as super-plan routes it | $1.64, 155 s |
| plan-platform | pass, 7/7: the platform question first under `## Assumptions (would ask)` with a provisional basis, not decided | pass; one spawn, the seam audit through `sonnet` | $2.02, 215 s |
| review-implied | pass, 6/6: Important at `src/ratings.py:3`, the `ZeroDivisionError` reproduced; a `Set aside` line | pass; no spawn | $0.61, 33 s |
| review-plan | pass, 7/7: Important, `plan-mandated`, at `src/ratings.py:2-3`; the plan's rationale did not lower the tier; a `Set aside` line | pass; no spawn | $0.64, 40 s |
| wave | pass: the snapshot's runner ran the wave; accepted on the first attempt with executor `claude-haiku-5-5` and judge `claude-sonnet-5-5`, no other child; merged, pushed, 7 tests OK on a clone of `origin/main`; only the two contract files and the plan's status lines changed; the wave branch and worktree removed; the summary ended with the `Left behind:` and `After the merge:` lines the skill prescribes, with no owed work and no offer to continue | pass; no Agent spawn | $1.57 seat, 98 s (runner 36 s) |
| ship-gate | deviation on one expectation (below); otherwise pass: stopped at the start approval ("Approve to start?"); lint-clean plan without `claude-fable-5-2`; no runner, no wave branch, no commit, only the untracked plan file; the message named the branch `add-duration-parsing`, the routes and the recovery allowance | pass; one spawn, the seam audit through `sonnet` | $2.60, 209 s |

The six seat sessions cost $9.08; the wave's two runner children used about
202k tokens, 164k of them cache reads. The alias probe cost $0.14.

What this shows:

- On every flow the session selected `orchestrator-fable-5-2.md` or
  `reviewer-fable-5-2.md` and read no other profile, and no reply named a
  profile file.
- Fable 5.2 ran no child: the planning runs' only spawn was the seam audit
  on Sonnet 5.5, the reviews spawned nothing, and the wave's executor and
  judge were the plan's Haiku 5.5 and Sonnet 5.5. No plan named
  `claude-fable-5-2`.
- At Claude Code's default `medium`, the seat finished owed work — the wave
  ran through integration, push and cleanup in one session — and still
  stopped at ship's one start approval instead of carrying on.
- The review outcomes match the Sonnet 5.5 and Codex runs of 2026-11-03
  (`review-content-results-2026-11-03.md`) on the same fixtures.

Deviation from the frozen wording, disclosed: ship-gate was expected to name
the pull request in its Gate 2 message. It said none would be opened,
because the fixture's `AGENTS.md` says "Do not create a PR" and `origin` has
no pull-request host. That answer follows the fixture's instruction file,
which the expectation had not accounted for. It is recorded as a deviation,
not a pass of that expectation; round 2 reruns the flow with the expectation
corrected before the run.

## Independent review between the rounds

After round 1, a fresh agent on Opus 5.5 reviewed the whole diff and checked
every number, quote and page reference in the profiles, dossiers,
`REVIEW.md`, the decision, the changelog and the README against the card and
the guide; it ran no live session. It reported 13 findings — one Important,
three Medium, six Low, three Nit — and all were fixed before round 2:

- **Important.** The orchestrator profile listed the approvals as a closed
  list ("Ask only at the named approvals"), which left out the questions
  the workflows require: product forks and contradictions, a change of the
  agreed scope, weakening or removing a test or check (a contract amendment
  that drops a `must_run` included), an irreversible action on something
  the run did not create, an action only the user can take, and ship's
  `plan-mandated`, `Disputed` and scope-widening questions. Both profiles
  now name those question points; `fable-5-2-seat.test.sh` pins them.
- **Medium.** The self-critique findings (pp. 18, 31) come from biology
  research experiments, not code, and the card measures Mythos 5.2 (p. 78);
  the profiles, dossiers, `REVIEW.md`, the README and the changelog now say
  so.
- **Medium.** critical-review's independent check of a direct fix named no
  model, so it would have inherited the Fable 5.2 session. The reviewer
  profile now runs it on Opus 5.5 (`model: opus`, `claude-opus-5-5` named in
  the prompt), and a contract check pins the rule for both seats.
- **Medium.** This record said all six runs met their expectations despite
  the ship-gate deviation, and the checks were scored by hand. Corrected
  above; `fable-seat-live.py` now computes them (`--score` for the runs it
  does not drive).
- **Low and Nit.** `max` described as buying no gain (on these coding
  measures it gained a few points at most, for several times the tokens);
  the linter described as rejecting the ID in every model field (it rejects
  it as an executor, supervisor or ladder rung); the 0-of-105 tool-result
  figure given to the final snapshot (it is an early snapshot's) and the
  Shade headline figures missing; a changed baseline hash filed under an
  older amendment; the wave fixture's supervisor at `medium` instead of the
  `high` the supervisor table names; the plugin each run loaded not stated;
  "least destructive" overstated; the guide's wording on unrequested
  changes paraphrased; "most expensive rate" false for a Fable 5.2 seat.

Control on the round-1 text, before round 2 (`skill-navigation.sh`,
`EVAL_ONLY="N2 N3"`, `EVAL_MODEL=claude-fable-5-2`, default effort, $2.00):
13 of 13 assertions passed. N2 amended the contract, edited the plan and
re-invoked the runner without asking; N3 asked the user. N2 read
`orchestrator-fable-5-2.md`; N3 did not, so N3 did not exercise the profile
text.

## Round 2 — frozen expectations

Written after the independent review of the candidate and before any round-2
run. The review found that the orchestrator profile listed the process's
approvals as if they were its only questions, so the profile could keep a
Fable 5.2 seat from asking where the skills require it — a product fork, a
change of scope, weakening or removing a check. Round 2 measures that point
directly and repeats the six flows on the corrected text.

- **nav-N2 / nav-N3** (`skill-navigation.sh`, `EVAL_ONLY="N2 N3"`,
  `EVAL_MODEL=claude-fable-5-2`, default effort): the harness's own frozen
  assertions — N2 (the fix widens `files_allowed`): amend the contract, edit
  the plan file, re-invoke the runner, no question to the user, no
  escalation; N3 (the only fix deletes a `must_run`): ask the user, no
  rework, no escalation; both read `references/contract-amendment.md`. Run
  on the round-1 text as a control (outcome recorded, no expectation) and on
  the final text (expected: all assertions pass).
- **The six flows again, on the final text**, with round 1's expectations
  and two corrections made before the runs: the wave fixture's supervisor
  runs at `high`, the effort multi-model's supervisor table names; and
  ship-gate's Gate 2 message must ask for the one start approval, name the
  branch, and say what happens about a pull request — opened at the end, or
  why none is (the fixture's `AGENTS.md` says "Do not create a PR").
- C1–C3 and the wave and ship checks are computed by `fable-seat-live.py`
  (`checks.json`; `--score DIR --profile NAME` for the planning and review
  runs) instead of by hand. "No owed work and no offer to continue" is
  scored by a phrase check on the final reply and read as well.

## Limits

- One run per case at `medium`: these show that the flows can pass on the
  seat, not a rate. `high`, which the profile recommends for ship and long
  waves, was not run.
- No end-to-end ship run: its planning stage was run to Gate 2, and its
  execution and review stages were run as multi-model and critical-review
  sessions on their own.
- The wave was one small Haiku task: no rework, escalation, recovery or
  multi-wave run was exercised on the Fable 5.2 seat.
- There is no generic-profile control: the runs show that the profiles load
  and that the outcomes hold, not that the profile text improves them.
- Codex was not run; its files changed only in their version lines.
