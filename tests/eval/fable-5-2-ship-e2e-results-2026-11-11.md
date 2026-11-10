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
