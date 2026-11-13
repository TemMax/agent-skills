# Fable 5.2 premium, Fable 5.1 deprecated — live results, 2026-11-13

Decision 020. Orchestration 4.24.0, code-review 1.22.0. Each run loaded the
candidate from a disposable snapshot of a detached checkout of the commit
named below (Claude: `--plugin-dir`, `--setting-sources project`; Codex:
workspace skills with user config and plugins disabled). No installed plugin
was changed. Expectations were frozen in each run's `expected.json` before
the host started. Claude Code 2.1.323; codex-cli 0.167.0.

## Runs

| Run | Commit | Driver and case | Seat | Result | Cost |
|---|---|---|---|---|---|
| r1-claude-asked | `92dc0a8` | `premium-plan-live.py --provider claude --case asked` | `claude-fable-5-2` / medium | 12/12 checks | $2.15, 184 s |
| r1-claude-unasked | `92dc0a8` | `premium-plan-live.py --provider claude --case unasked` | `claude-fable-5-2` / medium | 10/10 | $1.86, 189 s |
| r1-claude-wave | `92dc0a8` | `fable-seat-live.py --case wave --supervisor claude-fable-5-2` | `claude-fable-5-2` / medium | 13/13 after rescoring (see below) | $1.74 seat only |
| r1-codex-unasked | `92dc0a8` | `premium-plan-live.py --provider codex --case unasked` | `gpt-6.1-sol` / medium | 7/7 | 513,359 input (477,184 cached), 4,732 output tokens |
| r2-claude-asked | `e30d12a` | as r1-claude-asked | `claude-fable-5-2` / medium | 12/12 | $1.73, 207 s |
| r2-claude-unasked | `e30d12a` | as r1-claude-unasked | `claude-fable-5-2` / medium | 10/10 | $1.81, 226 s |

`e30d12a` changed super-plan's headless mode (a premium model the request
names is the user's word) after the independent review, so both Claude
planning cases were run again on it. It changed no Codex entry point or file
the Codex run loads, so the Codex case was not repeated.

## What the runs showed

- **Asked.** The request ended with the user's sentence "Надзор за каждой
  волной давай fable 5.2 medium." Both runs gave every wave's supervisor
  `claude-fable-5-2` at `medium` — the effort the user named, not the table's
  `high` — and recorded `approvals.premium` with `models:
  ["claude-fable-5-2"]`, `approved_by: "user"` and the sentence quoted as the
  source. Executors stayed on Sonnet 5.5; no Fable executor or rung and no
  `claude-fable-5-1` anywhere. Lint clean.
- **Unasked.** No premium model in any role and no `approvals.premium`; the
  supervisors were Opus 5.5. In r1 they were at `high`; in r2 at `medium`,
  below the supervisor table's `high` — no check covers the effort, so this
  is recorded, not scored.
- **Wave.** The approved plan named a Haiku 5.5 executor under a Fable 5.2
  supervisor with `approvals.premium`. The seat launched the snapshot's
  `claude-wave-runner.mjs`; its progress lines show `executor call 1 started
  (claude-haiku-5-5 medium)` and `review 1 started (claude-fable-5-2 high)
  … accepted`. The task reached `main` on `origin`, the unit tests passed
  there (8 tests), out-of-contract files were unchanged, no pull request was
  opened. The runner's children are separate CLI processes, so their cost is
  not in the seat's $1.74.
- **Codex.** All roles `gpt-6.1-sol`, no premium model, no
  `approvals.premium`, lint clean.
- Every Claude seat read `orchestrator-fable-5-2.md` and no other profile;
  every spawn named a model (one research spawn each, through `sonnet`).

## Driver defect found and fixed

The first scoring of r1-claude-wave failed `runner_launched_from_snapshot`
and `supervisor_on_claude_fable_5_2`: the driver read the runner's
`summary.json`, which the runner's own cleanup after integration removes, so
its child list was empty. The same gap made the older
`no_role_on_claude_fable_5_2` check pass vacuously. `fable-seat-live.py` now
falls back to the runner's progress lines in the session trace; the retained
r1 trace rescored to 13/13 (`checks-rescored.json`). The product run itself
is unchanged.

## Limits

- One run per case and round.
- `claude-fable-5-2` was run as a supervisor through the CLI runner only; it
  has not been probed through Workflow `agent()`, and no run used it as an
  executor or ladder rung.
- `tests/lib/codex-wave-runner.test.mjs` hangs in the agent sandbox on the
  unchanged `main` as well, so it was not run for this change; the rest of the
  offline suite passed.
