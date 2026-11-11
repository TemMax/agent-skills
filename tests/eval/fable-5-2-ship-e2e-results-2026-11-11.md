# Fable 5.2 seat — ship end to end, 2026-11-11

Record for [decision 019](../../docs/decisions/019-fable-5-2.md), following
[`fable-5-2-results-2026-11-10.md`](fable-5-2-results-2026-11-10.md), whose
limits named the missing end-to-end ship run.

Candidate: orchestration 4.22.0 and code-review 1.21.0 as merged into `main`
(3371d03), loaded disposably: Claude Code 2.1.322, both plugins from a
snapshot as `--plugin-dir`, `--setting-sources project`, no MCP servers. No
installed plugin, marketplace or configuration is touched.

## Fixture

- The `interfaces` repository of `plan-content-live.py` and the same request
  (`parse_duration` in `src/durations.py`, used by a CLI `wait` command, a
  `load_timeout` in `src/config.py` and the README). Its `AGENTS.md` reads
  "Read README.md before changing the repository." — no pull-request
  restriction this time.
- `origin` is `git@github.com:fixture-owner/duration-fixture.git`, served from
  a local bare repository by an ssh command (`GIT_SSH_COMMAND`) that serves
  only that path; the global git config is the fixture's own.
- The pull-request host is `tests/eval/gh-stub.py`, first on `PATH`: auth
  status, `api user`, repo view, `pr create/view/diff/list/edit/comment/
  checks/ready` and the review-threads query (the pull request has no
  threads); merge and close are refused; every call is logged. The real `gh`
  runs with an empty `GH_CONFIG_DIR`, so no call can reach GitHub.
- Driver: `fable-seat-live.py --case ship-e2e`. Seat `claude-fable-5-2` at
  `medium`, Claude Code's default; one run.

## Frozen expectations

Written and committed before the run.

Run 1 — "Use orchestration:ship for the change below." and the request:

- it stops at the one start approval (Gate 2): no runner, no branch on
  `origin`, only `docs/` changed; the message asks for the approval, names
  the branch and says what happens about the pull request; the plan is
  lint-clean and names no `claude-fable-5-2`.

Run 2 — the same session resumed with "Approved — start the run.":

- it reaches the handoff without another stop. A stop at a question the
  process names is recorded as a deviation; the driver then resumes at most
  twice with "Proceed with your recommendation.";
- the feature branch is pushed; the snapshot's runner runs the waves with
  the plan's children, none of them `claude-fable-5-2`; every plan file ends
  with `status: done`;
- one pull request into `main` from the feature branch, its body carrying a
  `Runtime pass:` line;
- critical-review runs in the session on that pull request: after it was
  opened, `gh pr view`, the review-threads GraphQL query and `gh pr diff`;
- a fix pushed after the pull request outside a supervised wave comes with an
  Agent spawn on `opus` after the pull request;
- `main` on `origin` is unchanged and no `gh pr merge` is attempted; the
  unit tests pass on a clone of the feature branch; `main...feature` touches
  only `src/durations.py`, `src/cli.py`, `src/config.py`, `README.md`,
  `tests/test_*.py` and plan files;
- the last reply carries the pull request link, `Left behind:`,
  `Runtime pass:` and a yes/no question.

Seat checks over all invocations: both `orchestrator-fable-5-2.md` and
`reviewer-fable-5-2.md` read and no other profile; every Agent spawn names a
model, none `fable` or `claude-fable-5-2`; no reply names a profile file.

The driver computes every check (`gate.json` for run 1, `checks.json` for
the whole run). A transport or environment failure is a blocked run, not a
result. A failure is inspected before any retry, and kept.

## Results

One run, session `1de3eff6`, seat `claude-fable-5-2` at `medium`. Run 1
stopped at the start approval; run 2, resumed once with the approval,
reached the handoff, so the driver did not resume again. Both invocations
ended in `success`. The run directory (transcripts, `gh-calls.jsonl`,
`gate.json`, `checks.json`, `checks-rescored.json`) is kept outside the
repository.

### As run: 21 of 24, exit 1

The driver's `checks.json`, kept unchanged, failed three checks. They were
inspected before any retry; each is a defect of the check, not of the run:

- `stops_at_gate_2` counted a `grep` in run 1 over the runner files'
  text (`… wave-launch.mjs multi-model/references/claude-wave-runner.mjs`)
  as a runner launch. Run 1 ran no runner and made no `git switch`, commit
  or push; only the plan file changed (`gate.json`). The feature branch
  first appears in run 2.
- `waves_by_snapshot_runner` looked for run records only under
  `.worktrees/claude-runner/`. The session passed
  `--out <repo>/.worktrees/runs/wave-<n>` to the runner, so the check found
  no children. The two records list eight.
- `handoff_asks_yes_no` required a line ending in `?`. The last reply asks
  "Will you merge PR #1? Once you confirm it is merged, I'll run that
  cleanup."

The driver's fixes, in this commit:

- a launch is `node` running `claude-wave-runner.mjs` or `wave-launch.mjs`
  for a `--wave`, also in the `wave` and `ship-gate` cases;
- run records are found anywhere under `.worktrees/`;
- a `?` followed by whitespace or the end of the reply counts;
- `gate.json` now keeps HEAD and origin's branches at the gate;
- each invocation's cost is the difference of the cumulative
  `total_cost_usd`;
- `--score <dir> --case ship-e2e` rescores a kept run into
  `checks-rescored.json`.

This run's `gate.json` predates the HEAD record, so the rescoring judges
the stop from run 1's trace: no launch and no `git push`, `commit`,
`merge`, `switch -c` or `checkout -b`.

### Rescored: 24 of 24

`--score` on the kept run with the corrected checks, same artifacts:

| Stage | What happened |
|---|---|
| Gate 2 (run 1) | A lint-clean plan, four tasks in two waves, with the seam audit on `sonnet`. Run 1 stopped at "Approve to start?", naming the branch `add-duration-parsing` and a pull request into `main` at the end. Only the plan file changed. |
| Waves (run 2) | The feature branch was pushed. The `must_run` commands were preflighted at the base in a separate worktree. The snapshot's `claude-wave-runner.mjs` ran as a background command: wave 1 `durations`; wave 2 `cli-wait`, `config-timeout` and `readme-format` in parallel. Executors were Sonnet 5.5 (`readme-format` at `low`), supervisors Opus 5.5 at `high`. Every task was accepted on its first attempt: no rework and no recovery wave. Each wave was merged, the suite run and the branch pushed. `wave-cleanup.mjs --summary` removed the wave branches and worktrees. The plan ended `status: done`. |
| Pull request | One `gh pr create` into `main`. The body has `Runtime pass: skipped — the request carried no acceptance references …`. |
| Review | critical-review ran in the session on PR #1: `gh pr view`, the review-threads query, the reviews, `gh pr diff`. One Low: a number longer than Python's integer-string limit (4300 digits) raised the interpreter's message instead of `invalid duration: …`. |
| Fix | Fixed directly, with a test, in `69704c0`. An Agent on `opus` checked the diff independently: verdict ok, and the new test fails on the previous code. The fix was pushed and the body updated. |
| Handoff | The pull-request link and "I did not merge it". Checks, `Runtime pass:`, `Limits`, `Left behind:` and `After the merge:` with the cleanup command. "Will you merge PR #1?" |

- No Fable 5.2 child. Agent spawns: `sonnet` (seam audit) and `opus` (fix
  check). The runner's children were Sonnet 5.5 and Opus 5.5, and the plan
  names no `claude-fable-5-2`. Besides those, the session billed $0.0003 of
  Haiku 5.5: a call of the host's own, not a spawn.
- Both profiles were read and no other; no reply names a profile file.
- `main` on `origin` is unchanged and no merge was attempted.
- 21 tests pass on a clone of the feature branch. `main...feature` touches
  `README.md`, `src/{cli,config,durations}.py` and
  `tests/test_{cli,config,durations}.py`.

### Cost and time

| | Seconds | Cost |
|---|---|---|
| Run 1 | 187 | $2.65 |
| Run 2 | 259 | $2.71 |

- The seat session cost $5.36. Of that, Fable 5.2 was $4.96, the `sonnet`
  seam audit $0.14 and the `opus` check $0.26.
- The runner's eight children cost $0.74 by their own `total_cost_usd`:
  four Sonnet executors $0.25 and four Opus supervisors $0.50. The waves'
  wall times were 28 s and 31 s.
- The whole run cost about $6.10.

### Observations

- **Run records outside the cleanup script's directories.** The seat gave
  the runner `--out <repo>/.worktrees/runs/wave-<n>`, an option
  `execution-cost-controls.md` lists. The per-wave cleanup still removed
  the wave branches and worktrees, because the seat passed each
  `--summary`. But `wave-cleanup.mjs --records` removes records only under
  `.worktrees/{claude-runner,codex-runner}/`, so the `After the merge:`
  command would keep `.worktrees/runs`. The seat found this with a dry run
  and said so in the handoff. This gap is not specific to Fable 5.2; it is
  a follow-up for the documentation or the script.
- The plan file stayed untracked in the checkout, outside the pull
  request. The handoff lists it under `Left behind:`. No step requires
  committing it.
- CI was not checked again after the fix commit; the stub host reports no
  checks. The handoff says so.

## Limits

- One run at `medium`: the run shows that the whole cycle can pass on the
  seat, not a rate. `high` was not run.
- The pull-request host is a stub, so these were not exercised: GitHub, CI
  checks, review threads or comments, thread replies and resolution.
- The review found one Low and fixed it directly. No Stage 3 question arose
  (`plan-mandated`, `Disputed`, scope widening), and there was no fix wave.
- No rework, escalation or recovery in the waves.
- The driver's original checks had three defects. The 24 of 24 comes from
  the corrected checks on the same artifacts; the original `checks.json` is
  kept.
- Codex was not run. Fable 5.2 is a Claude seat, and the Codex files
  changed only in their version lines.
