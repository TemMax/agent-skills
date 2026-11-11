# Custom `--out` cleanup — live results, 2026-11-11

Record for orchestration 4.22.1: `wave-cleanup.mjs --records` removes the
record of a runner given an `--out` of its own when the cleanup names it with
`--summary <out>/summary.json`, and multi-model and ship name it in the
`Left behind:` dry run and in the `After the merge:` command.

Candidate: branch `wave-cleanup-summary-records`. The driver snapshots the
committed `HEAD` for every run; each run's snapshot hashes were matched to the
commit named below. Claude Code 2.1.322 loads the snapshot as `--plugin-dir`
with `--setting-sources project`, `--strict-mcp-config` and no MCP servers;
Codex CLI 0.167.0 loads it as workspace skills linked to the snapshot, with
`--ignore-user-config` and `--disable plugins`. No installed plugin,
marketplace or configuration was touched. The fixture's `origin` is a local
bare repository and the sessions run without GitHub tokens or an SSH agent.
Raw outputs are kept outside the repository for the lifetime of the pull
request.

## The scenario

`custom-out-cleanup-live.py`: `fable-seat-live.py`'s approved one-task plan
(Codex models on Codex). Seat `claude-fable-5-2` on Claude Code and
`gpt-6.1-sol` on Codex, both at `medium`, one run per host and round.

- **Turn 1.** The session executes the plan with the runner given
  `--out <repo>/.worktrees/runs/wave-1`, integrates the result into
  `feature/durations`, verifies it and pushes the branch; no pull request.
- **Merge.** The driver fast-forwards `main` on `origin` to the branch.
- **Turn 2.** The same session gets "`feature/durations` is merged into
  `main` on `origin`."

## Frozen expectations

Written to each run's `expected.json` before its first model call.

| Check | Expected |
|---|---|
| `candidate_loaded` | Claude: the init event lists the snapshot's plugin and version; Codex: the workspace skill resolves into the snapshot |
| `instruction_read` | a turn-1 tool output carries the new `--summary` instruction text |
| `turn_1_complete`, `turn_2_complete` | each turn ends successfully |
| `record_under_out` | `.worktrees/runs/wave-1/summary.json` exists after turn 1 |
| `wave_accepted` | the runner's summary is accepted (Claude: `done`; Codex: `merge-ready`) |
| `feature_pushed_and_green` | `feature/durations` on `origin` has the task's files and its tests pass; `main` on `origin` is unchanged |
| `dry_run_lists_record` | a turn-1 `wave-cleanup.mjs` report with `dryRun: true` lists the record as removed |
| `left_behind_names_record` | the `Left behind:` paragraph names `runs/wave-1` |
| `after_merge_names_record` | the `After the merge:` command carries `--records` and `--summary <record>` |
| `cleanup_removed_record` | a turn-2 `wave-cleanup.mjs` report with `dryRun: false` lists the record as removed |
| `record_removed` | `.worktrees/runs/wave-1` is gone after turn 2 |
| `no_wave_worktree_or_branch` | only the main checkout is registered and no `wave/*` branch is left |
| `no_removal_by_hand` | no `rm`, `rmdir`, `rmtree`, `find -delete` or `git worktree remove` of the run's directories under `.worktrees` |

A transport or environment failure is a blocked run, not a result. A
failure is inspected before any retry, and kept.

## Blocked: a Codex session that launches the runner

When the Codex session launches the runner itself it must run outside the
sandbox (`danger-full-access`), because macOS seatbelt cannot nest. The
permission classifier of the agent running these checks refused to start
that session, so it never ran. Every Codex run below uses
`--wave-by driver` instead. The driver runs the shipped Codex runner with
the same `--out` before turn 1. The session runs in `workspace-write`, with
writable roots limited to the repository, its `.git` and `origin`. It
integrates, verifies and pushes the result, writes the handoff and does
turn 2. As a result, a Codex session launching the runner with a custom
`--out` was not checked live. On Claude Code the session launched the
runner itself in every round.

## Round 1 — the first text, before the reviews

The plugin files were identical to commit 5698a8c. Claude: the session ran
the wave. Codex: the driver ran the wave.

- **Both hosts** passed `--summary <out>/summary.json` to the `Left behind:`
  dry run and to the `After the merge:` command, and listed
  `.worktrees/runs/wave-1` under `Left behind:`. After "merged", both
  removed the record through the script.
  - Claude's turn 2 switched to `main` and ran the cleanup again, which
    removed the feature branch.
  - Codex's turn 2 ran the cleanup and then deleted the remote feature
    branch with `--force-with-lease` at the tip the script printed, as its
    instructions allow.
- **As scored at the time,** Claude failed one check and Codex four. Each
  failure was a defect in the driver, not in a session:
  - its checks parsed the commands the sessions ran, so they missed paths
    given through shell variables and a cleanup run from Python;
  - its Codex candidate check followed a path the session never printed.

  The driver now reads the script's own JSON report and resolves the
  workspace skill's link (c998b46, 025c671). Rescored with the final
  driver, every check passes except `instruction_read`. That check fails
  because the instruction text changed after this round.
- **Usage:**

  | | Turn 1 | Turn 2 |
  |---|---|---|
  | Claude seat | $1.64 | $0.32 |
  | Codex input / cached / output tokens | 620,821 / 580,608 / 3,733 | 837,609 / 795,520 / 4,156 |

## Round 2 — after the first review

The plugin files were identical to commit 025c671. Claude: the session ran
the wave. Codex: the driver ran the wave. Both hosts passed 14 of 14 checks.

- **Claude's turn 2** ran the cleanup with `feature/durations` still
  checked out. The script removed the record and kept the branch
  ("checked out in …"). The session then left the remote branch alone and
  asked before switching to `main`.
- **Codex's turn 2** switched to `main`, fast-forwarded it, ran the
  handoff's command and deleted the remote branch at the printed tip.
- **Usage:**

  | | Turn 1 | Turn 2 |
  |---|---|---|
  | Claude seat | $1.73 | $0.11 |
  | Codex input / cached / output tokens | 531,989 / 495,616 / 2,580 | 731,334 / 692,864 / 2,946 |

## Round 3 — the final commit

The plugin files were identical to commit cbe029f, after the second review
and its recheck. Claude: the session ran the wave. Codex: the driver ran
the wave. Both hosts passed 14 of 14 checks.

- **Claude** behaved as in round 2. The record was removed through the
  script and the branch was kept because it was checked out. The session
  asked before switching to `main`.
- **Codex's turn 2** did not run the handoff's line as written:
  1. It first ran `undefined --into origin/main --records --branch
     feature/durations`, which exited 127 and changed nothing.
  2. It then read the summary's `afterIntegration` and ran that command,
     which carries `--summary <out>/summary.json`, with
     `--into origin/main --records --branch feature/durations` added.
  3. The script removed the record, the state file, the verification logs
     and the local feature branch.
  4. The session deleted the remote branch at the printed tip.
- **Usage:**

  | | Turn 1 | Turn 2 |
  |---|---|---|
  | Claude seat | $1.52 | $0.12 |
  | Codex input / cached / output tokens | 327,791 / 293,888 / 1,525 | 562,547 / 525,952 / 1,936 |

## Totals

- **Claude:** $5.45 for the Fable 5.2 seat sessions over the three rounds.
  The runner's executor and judge calls are billed separately and are not
  counted here.
- **Codex:** the token counts in the tables above.

## Observations

- In multi-model, a session that is told "merged" runs the cleanup on
  whatever is checked out. With the feature branch checked out, the script
  keeps that branch and the session has to ask. Ship's after-the-merge step
  switches to the default branch first. Multi-model has no such step. This
  change leaves that as it was.
- A Codex session may rebuild the after-the-merge command from the
  summary's `afterIntegration` instead of copying the handoff's line. That
  command still names the record through `--summary`, so the outcome was
  the same.
