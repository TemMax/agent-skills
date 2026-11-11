# The cleanup command written out after the merge — live results, 2026-11-12

Record for orchestration 4.23.1. The `After the merge:` line of a
multi-model summary or a ship handoff should carry a ready cleanup command.
`wave-cleanup.mjs --dry-run` now prints that command (`command`), and the
session writes it out as printed. After the merge the session runs it as
written.

Candidate: branch `after-merge-command-inline`, four commits. Each round ran
from a clean, detached checkout of its commit outside the repository, so
the driver's copy of the plugins is that commit's. Every run's
`snapshot.json` matches the commit's 104 plugin files; the marketplace file
is generated for the run.

Hosts, loading and seats are those of
[the 4.23.0 record](merge-cleanup-results-2026-11-11.md):

- Claude Code 2.1.322 with a `--plugin-dir` copy;
- Codex CLI 0.167.0 with workspace skills linked to the copy,
  `--ignore-user-config` and `--disable plugins`, and for
  `merge-cleanup-live.py` also `--disable apps` and
  `allow_login_shell=false`;
- `claude-fable-5-2` and `gpt-6.1-sol` at `medium`, one run per host,
  scenario and round.

No installed plugin, marketplace or configuration was touched.

## The scenarios

The four scenarios of the 4.23.0 record, unchanged: `mm-merge`,
`mm-merged-worktree` and `ship-merge` (`merge-cleanup-live.py`), and
`custom-out` (`custom-out-cleanup-live.py`). Their earlier checks are
unchanged and described in that record and in
[the custom `--out` record](custom-out-cleanup-results-2026-11-11.md).

## The new frozen checks

| Check | Expected |
|---|---|
| `after_merge_written_out` | The reply before the merge turn has an `After the merge:` line that holds the cleanup command itself. In `ship-merge` that is the handoff's own line; in `custom-out` it is turn 1's. The command may sit in an inline code span of that line, in the rest of the line, or in a logical line of the code block right below it. It must run as it is: `node`, the script and every `--repo`, `--plan` and `--summary` path absolute, `--repo` present, no `--dry-run` or `--help`, and nothing the shell would expand. A link or a file in its place fails. |
| `after_merge_as_printed` | A command on that line is, word for word, the `command` field of a `wave-cleanup.mjs --dry-run` report in a turn before the merge turn. |
| `after_merge_plans_from_run` (`merge-cleanup-live.py`) | No `--plan` of that command lies under `.git`. There is no `--plan` at all when no wave ran: no run record before the merge turn and no `node` call of a runner or the launcher. Each `--plan` is one those calls named. |

How they changed by round:

- **Round 1, f46fd6f.**
  - `after_merge_written_out` took the first command on the first such
    line.
  - `merge-cleanup-live.py` scored it only when a run record existed before
    the merge turn.
  - `after_merge_as_printed` was a fact, not a check.
- **Round 2, 169ada6.**
  - `after_merge_written_out` reads every such line and every command
    below it, refuses `--dry-run` and `--help`, and is scored in every
    scenario.
  - `after_merge_as_printed` becomes a check.
- **Round 3, 64b1587.**
  - `custom-out`'s record check reads the written-out command.
  - Comment lines in the block are skipped.
  - `ship-merge` scores the handoff's own line.
  - `after_merge_plans_from_run` is added.
- **Round 4, 9a819d6.**
  - A comment is cut only where a shell cuts it.
  - A wave counts from a `node` call of a runner or the launcher, or a run
    record, not from any mention.
  - Each `--plan` is matched against those calls.

## Before the change: the 4.23.0 runs

These are the traces of rounds 2–5 of the 4.23.0 record, rescored with the
final drivers:

- **Claude**: 13 of 13 replies carried a command that runs as it is.
- **Codex**: 2 of 11.
  - Three pointed to a file the session had written without printing it:
    the ship handoffs of rounds 2 and 3, and `custom-out` in round 4. Round
    3's ship run was cut by a host restart after its handoff.
  - Five used shell variables or substitutions the user's shell does not
    have: `$(cd … && pwd -P)`, `$R`, `$ROOT`, `$repo`, `$(realpath …)`.
  - Round 4's ship handoff had no line: it executed no plan, and the
    script would not run without one.
- **`after_merge_as_printed`** fails everywhere: no dry run printed a
  command then.

## Round 1 — f46fd6f

| Scenario | Claude | Codex |
|---|---|---|
| `mm-merge` | 16/16 | 16/16 |
| `mm-merged-worktree` | 16/16 | 16/16 |
| `ship-merge` | 17/17 | 16/16 (`after_merge_written_out` not scored: no run record) |
| `custom-out` | 15/15 | 15/15 |

- **Every reply** carried the command the dry run printed, word for
  word.
- **Codex `ship-merge` implemented the work directly**, with no plan. The
  script refused the dry run with `missing --plan`. The session then wrote
  a stand-in plan, `{"waves": []}`, to `.git/ship-cleanup.md` and named it
  in the command. The checks of the time passed it. Rescored, it fails
  `after_merge_plans_from_run`.
- **The same handoff** justified its merge question with a link to the
  ship skill file ("The [delivery instructions](…/SKILL.md) require…").
  The 4.23.0 record saw this once before; this change does not touch it.
- **The first review** found:
  - Important: a pasted dry run or `--help` passed the check, and the rule
    could not be followed without a plan.
  - Minor: extraction gaps, the gate on run records, `..` after a link in
    a printed path, two dry runs that could differ, and missing tests.

  All were fixed in 169ada6.

## Round 2 — 169ada6

| Scenario | Claude | Codex |
|---|---|---|
| `mm-merge` | 17/17 | 17/17 |
| `mm-merged-worktree` | 17/17 | 17/17 |
| `ship-merge` | **16/18** | 18/18 |
| `custom-out` | 16/16 | 16/16 |

- **Codex `ship-merge`** implemented the work directly again, now with no
  `--plan`:
  `node …/wave-cleanup.mjs --repo … --into origin/main --records --branch add-duration-parser`.
- **Claude `ship-merge`** failed two checks that this change does not
  touch:
  - Its independent review left two findings open: missing tests and an
    oversized number. So the handoff recommended fixing them first ("Should
    I add the missing tests and the oversize-number fix to this pull
    request before you merge?"), as the rule says, and
    `handoff_offers_merge` failed.
  - On "Yes — merge it." it added the fixes and merged. It then typed the
    cleanup again with a shell variable (`node $R/../package/…`) and piped
    its report through `grep`. The script removed the branch, but the
    driver could not read the report, so `feature_removed_by_script`
    failed.
  - Its `After the merge:` line was written out as printed. The retyped
    command led to the "run it as written and read all of its output"
    sentence in 64b1587.
- **The second review** found:
  - Important: a made-up plan still passed every check, and the record
    check still read the old extraction.
  - Minor:
    - `--summary` through `..` after a link;
    - a bare `--repo` call that did nothing;
    - comment lines;
    - a stale line from an earlier turn;
    - the frozen wording.

  All were fixed in 64b1587.

## Round 3 — 64b1587

| Scenario | Claude | Codex |
|---|---|---|
| `mm-merge` | 18/18 | 18/18 |
| `mm-merged-worktree` | 18/18 | 18/18 |
| `ship-merge` | 19/19 | 19/19 |
| `custom-out` | 16/16 | **14/16** |

- **Codex `ship-merge`** took the direct route, with no `--plan`, and
  passed every check.
- **Codex `custom-out`** failed `dry_run_lists_record` and
  `left_behind_names_record`, which this change does not touch:
  - After squashing the wave it committed one more change to the task's
    test file (`test: cover exact duration review focus inputs`).
  - The runner's after-integration cleanup could then no longer prove
    `wave/parse-duration` integrated. It kept the branch and its worktree,
    and the dry run kept the record too, as the rules say.
  - The `Left behind:` line said "run records" without naming
    `runs/wave-1`.
  - Its `After the merge:` line was written out as printed.
- **The third review** found nothing Critical or Important. Its Minor
  findings were fixed in 9a819d6:
  - a missing `--plan` or a gone `--summary` directory was taken through
    `..` as text;
  - any mention of a runner counted as a wave;
  - comments were cut where a shell does not cut them;
  - the fallback to the installed script was missing in multi-model;
  - tests were weak.

## Round 4 — 9a819d6, the final commit

| Scenario | Claude | Codex |
|---|---|---|
| `mm-merge` | 18/18 | 18/18 |
| `mm-merged-worktree` | 18/18 | 18/18 |
| `ship-merge` | 19/19 | 19/19 |
| `custom-out` | 16/16 | 16/16 |

- **Every check passed** on both hosts.
- **Every reply** put the command in a code block right below the
  `After the merge:` line, word for word as the dry run printed it.
- **ship:**
  - Codex implemented the work directly again and wrote the command
    without `--plan`.
  - Claude ran one wave, and its command named that wave's plan.
- **After "merge" or "merged"**, every session confirmed the merge and ran
  the cleanup. The script's own report shows the feature branch removed.
  No reply linked an instruction file.

## Rescored with the final drivers

Scenario order: `mm-merge`, `mm-merged-worktree`, `ship-merge`,
`custom-out`.

| Round | Commit | Claude | Codex |
|---|---|---|---|
| 1 | f46fd6f | 18/18, 18/18, 19/19, 16/16 | 18/18, 18/18, **18/19**, 16/16 |
| 2 | 169ada6 | 18/18, 18/18, **17/19**, 16/16 | 18/18, 18/18, 19/19, 16/16 |
| 3 | 64b1587 | 18/18, 18/18, 19/19, 16/16 | 18/18, 18/18, 19/19, **14/16** |
| 4 | 9a819d6 | 18/18, 18/18, 19/19, 16/16 | 18/18, 18/18, 19/19, 16/16 |

The three failures are the ones described above:

- the plan Codex made up in round 1;
- the open review findings and the filtered report in Claude's round-2
  ship run;
- the extra commit after the squash in Codex's round-3 `custom-out`.

## Usage

Seat sessions only; the runners' children are not counted. Claude: the
cost the session reports, per turn. Codex: a resumed thread reports a
running total, so a run's figure is its last turn's.

| Round | Commit | Claude | Codex input (cached) | Codex output |
|---|---|---|---|---|
| 1 | f46fd6f | $10.66 | 4,570,420 (4,397,696) | 15,947 |
| 2 | 169ada6 | $10.70 | 4,350,698 (4,166,528) | 14,762 |
| 3 | 64b1587 | $10.79 | 4,328,274 (4,068,480) | 15,039 |
| 4 | 9a819d6 | $11.26 | 4,325,243 (4,141,952) | 14,848 |
| **Total** | | **$43.42** | **17,574,635 (16,774,656)** | **60,596** |

A Claude `ship-merge` run cost $4.6–5.2; every other run $1.8–2.3.

## Observations

- **Copying the printed command works on both hosts.** In every run of
  every round, each `After the merge:` line that carried a command carried
  the one the dry run printed, word for word. Before this change, 2 of 11
  scored Codex replies ran as they were.
- **The direct route now gets a command.** Codex took it in every
  `ship-merge` run. Once the script ran without `--plan` (round 2), it
  wrote the branch-only command and needed no stand-in plan.
- **Both hosts chose a code block** below the line by round 4, though the
  rule allows the line itself.

## Limits

- **One run** per host, scenario and round.
- **The fallback to the installed plugin's script**, "only its script path
  may change", ran in no live run: no plugin was updated between a handoff
  and its merge.
- **Offline only:**
  - paths through a link and `..`;
  - a gone `--summary` directory;
  - quotes, `$` and spaces in paths.
- **No Claude run took the direct route**, so the command without `--plan`
  was seen live on Codex only.
- **The drivers read text.** The `After the merge:` line is found by its
  marker, and a wave run by a `node` call of a runner or a run record. A
  runner started some other way and leaving no record would not count.
