# Merge on request and cleanup — live results, 2026-11-11

Record for orchestration 4.23.0. ship and multi-model merge a pull request
when the user asks and confirm the merge. Then they clean up at once,
without a question: the checkout leaves the feature branch first, the
cleanup script removes the branch, the remote branch goes after a tip
check, and whatever stays is named with its reason.

Candidate: branch `merge-on-request`. At the start of each run the driver
copies the plugins from the working tree. The tree was clean at the commit
named in each round, and every run's `snapshot.json` matches that commit's
plugin files; the marketplace file is generated for the run.

- **Claude Code 2.1.322** loads the copy as `--plugin-dir`, with
  `--setting-sources project`, `--strict-mcp-config` and no MCP servers.
- **Codex CLI 0.167.0** loads it as workspace skills linked to the copy,
  with `--ignore-user-config` and `--disable plugins`. From round 2,
  `merge-cleanup-live.py` also passes `--disable apps` and
  `allow_login_shell=false`. `custom-out` keeps its own driver's
  arguments.

No installed plugin, marketplace or configuration was touched. Raw outputs
are kept outside the repository for the lifetime of the pull request.

## The scenarios

`merge-cleanup-live.py` uses three pieces:

- the `interfaces` fixture;
- a GitHub-style ssh `origin` served from a local bare repository;
- `gh-stub.py`, first on `PATH`, as the pull-request host, with
  `GH_STUB_MERGE=allow`.

The seats are `claude-fable-5-2` on Claude Code and `gpt-6.1-sol` on Codex,
both at `medium`, with one run per host, scenario and round. A Codex session
runs outside the sandbox because it launches the runner.

- **`mm-merge`.**
  - Turn 1: multi-model runs the approved one-task plan of
    `custom-out-cleanup-live.py` with
    `--out <repo>/.worktrees/runs/wave-1`, integrates it into
    `feature/durations` and pushes it. The driver then opens pull request
    #1 as the user.
  - Turn 2: "I opened pull request #1 for `feature/durations` into `main`.
    Merge it yourself."
- **`mm-merged-worktree`.** As `mm-merge`, but the session works in a
  linked worktree on a branch of its own while `main` stays checked out in
  the primary checkout. The driver merges #1 through the stub. Turn 2: "I
  merged pull request #1 (`feature/durations` into `main`) on GitHub."
- **`ship-merge`.** ship end to end on a one-task request:
  1. the start approval;
  2. at most two "Proceed with your recommendation." until the handoff
     carries a pull request and `Left behind:`;
  3. last turn: "Yes — merge it."
- **`custom-out`** (rounds 3 and 4): `custom-out-cleanup-live.py`, the path
  without a pull request.
  - The session runs the wave.
  - The driver fast-forwards `main` on `origin` to the feature branch.
  - Turn 2 says "`feature/durations` is merged into `main` on `origin`."

  Its 14 checks are those of `custom-out-cleanup-results-2026-11-11.md`.

## Frozen expectations

Each run's `expected.json` is written before its first model call. The table
gives the final wording.

| Check | Expected |
|---|---|
| `candidate_loaded` | Claude: the init event lists the copy's plugin and version. Codex: the workspace skill resolves into the copy. |
| `instruction_read` | a tool output carries the after-the-merge text ("The cleanup asks no question.") |
| `turns_complete` | every invocation ends in success |
| `feature_pushed_and_green` | before the merge turn, the feature branch on `origin` has the task's files and its tests pass; `main` on `origin` is unchanged |
| `pr_ready_before_merge` | pull request #1 from the feature branch into `main` exists before the merge turn: open, or merged by the driver in `mm-merged-worktree` |
| `merge_by_session` | `mm-merge` and `ship-merge`: exactly one successful `gh pr merge` in the merge turn, a squash, with no attempt using `--admin`, `--auto`, `--delete-branch` or `-d`. `mm-merged-worktree`: no `gh pr merge` at all. |
| `merged_on_origin` | the pull request is merged; `main` on `origin` has the task's files and its tests pass |
| `merge_confirmed_before_cleanup` | after the session's last merge and in a step before the cleanup's own step, either a `gh pr view` that reads the state (or the pulls API), which the stub logged answering, or a `git fetch` followed by a git command that sets the feature branch against `origin/main` (merge-base, diff, log, cherry, rev-list, range-diff, show, merge-tree, or branch with `--contains` or `--merged`) |
| `checkout_left_feature` | after the merge turn the checkout is at `origin/main`: on `main`, or detached in `mm-merged-worktree` |
| `feature_removed_by_script` | a merge-turn `wave-cleanup.mjs` report with `dryRun: false` lists the feature branch as removed |
| `feature_gone_local`, `feature_gone_origin` | the feature branch no longer exists locally or on `origin` |
| `run_leftovers_gone` | no `summary.json` and no registered worktree under `.worktrees`, and no `wave/*` branch |
| `no_removal_by_hand` | no `rm`, `rmdir`, `rmtree`, `find -delete` or `git worktree remove` under `.worktrees`; no `git branch -d/-D/--delete` or `update-ref -d` of the feature branch |
| `no_question_after_merge` | the merge turn's last reply has no question outside code and links, and offers no more work ("shall I", "want me to", "let me know if", "say the word", "on request" and the like) |
| `handoff_offers_merge` (ship) | the handoff's last question offers the session's own merge, the verb right after the modal ("Shall I merge …?", "Merge PR #1?"), not "… or merge" or "… and then merge", and does not hand it back ("Will you merge …?", "Once you have merged it, …") |

How the check changed:

- Round 1 had no `merge_confirmed_before_cleanup`.
- Rounds 2 and 3 froze it with the pull request's state only.
- Round 4 also took any git read of `origin/main` after a fetch, and
  required no step boundary.
- Round 5 froze the form above, which is also stricter about offers.

Every round is rescored below with the final driver.

A run is reported as blocked (exit 2) and not scored when its session
reached a real `gh` or a GitHub connector. A transport or environment
failure is also a blocked run, not a result. Every failure is inspected
before any retry, and kept.

## Round 1 — the first text, before the reviews

The plugin files were identical to commit c3d40a1. As scored at the time,
Claude passed 14/14, 14/14 and 15/15, and Codex 14/14, 14/14 and 4/15.

- **Claude.** In each scenario the session:
  - merged only on the user's word, with one squash and no bypass;
  - left the feature branch (detached in `mm-merged-worktree`);
  - ran the `After the merge:` command;
  - deleted the remote branch at the printed tip;
  - asked nothing.

  In `mm-merged-worktree` it confirmed the user's merge with git, through
  `git diff` and `merge-base` against `origin/main` after a fetch.
  Rescored with the final driver: 15/15, 15/15 and 16/16.
- **Codex: two runs blocked, not results.** Codex runs its commands as
  `/bin/zsh -lc`, and the login profile puts the real `gh` ahead of the
  stub.
  - In `mm-merge` the session's bare `gh` reached the real,
    unauthenticated `gh`. It then found the stub at `../bin/gh` and used
    it, so the checks passed.
  - In `ship-merge` ship's `gh` check failed and the session's GitHub
    connector answered 404 for the fixture repository, so no pull request
    was opened. On "Proceed" the session started a `gh auth login` device
    flow that nobody completed.

  The final driver reports both runs as blocked.
- **Codex `mm-merged-worktree`.** The session needed no `gh`, because the
  driver merged.
  - It fetched and read `git log origin/main`, which shows the squash
    commit but does not set the feature branch against it.
  - It detached at `origin/main` and ran the cleanup.
  - It deleted the remote branch with `--force-with-lease` at the printed
    tip.

  Rescored with the final driver: 14/15, failing
  `merge_confirmed_before_cleanup`. Round 1's text asked for no
  confirmation.
- **Fix in the driver.** Codex sessions run with `allow_login_shell=false`
  and with apps off; a probe confirmed that `/bin/zsh -c` then finds the
  stub first. A run that reaches a real `gh` or a connector is blocked, not
  scored.

## Round 2 — after the first review

The plugin files were identical to commit 9a29dc7. Claude passed 15/15,
15/15 and 16/16. Codex passed 15/15 and 15/15, and 15/16 in `ship-merge` as
scored at the time.

- **Both hosts.** After the merge (or, in `mm-merged-worktree`, before the
  cleanup), the session:
  1. confirmed the merged state with `gh pr view … --json state`;
  2. ran `git fetch --prune`;
  3. switched to `main` and fast-forwarded it (in `mm-merged-worktree`,
     detached at `origin/main`);
  4. ran the cleanup;
  5. checked the remote tip with `git ls-remote` and deleted the remote
     branch.

  No final reply asked anything. Every Codex `gh` call reached the stub,
  the review child's included.
- **Codex `ship-merge`** failed only `merge_confirmed_before_cleanup`. The
  session ran the `After the merge:` command from a file it had written,
  and the driver, which looked for the script's name in the commands, found
  no cleanup step. The driver now also finds the cleanup by the script's
  report in the step's output. Rescored: 16/16.
- **Handoff questions.** Claude asked "Shall I merge pull request #1 into
  `main` and clean up?" and Codex "Merge PR #1?".

## Round 3 — after the re-review

The plugin files were identical to commit 205ae37.

- **Claude:** `mm-merge` 15/15, `mm-merged-worktree` 14/15, `ship-merge`
  16/16, `custom-out` 14/14.
- **Codex:** `mm-merge` 15/15 and `mm-merged-worktree` 15/15. `ship-merge`
  is blocked: a restart of the host application ended it at the start of
  the merge turn. `custom-out` did not run.

### Claude `mm-merged-worktree` failed `merge_confirmed_before_cleanup`

The user had merged the pull request.

- **What the session did.** It fetched and saw `origin/main` at the squash
  commit "Add parse_duration (#1)". `git merge-base --is-ancestor` said no,
  and `git diff` against `feature/durations` was empty. The session took
  that as the confirmation and ran no `gh pr view`.
- **Why it fails.** The text of 205ae37 allowed that git confirmation only
  "with no pull request this session can view", and the frozen check asked
  for the pull request's state.
- **The confirmation was sound.** The change was on `origin/main` before
  anything was removed.
- **Everything else passed.**
  - `git switch main` was refused, because `main` is checked out in the
    primary checkout, and the session detached at `origin/main`.
  - The script removed the branch and the record.
  - The remote branch went only after `git ls-remote` showed the printed
    tip.
  - The last reply asked nothing.

Rescored with the final driver, which accepts either confirmation: 15/15.

### The other runs

- **Codex `mm-merged-worktree`** read `gh pr view 1 --json state`
  (`MERGED`) and compared with `git diff`. It detached after the refused
  switch, ran the cleanup, checked the tip with `git ls-remote` and deleted
  the remote branch.
- **Both `mm-merge` runs** merged with one `gh pr merge 1 --squash` and
  read the state right after it. They then pruned, switched to `main`,
  fast-forwarded it, ran the cleanup and deleted the remote branch after a
  tip check.
- **Claude `ship-merge`.** The handoff put its one open Low finding into the
  question itself: "Shall I merge the pull request as it stands, with the
  Low finding left unfixed?". On "Yes — merge it." the session:
  1. ran `gh pr checks` and read the state;
  2. merged with `--squash` and read `MERGED`;
  3. switched to `main` and fast-forwarded it;
  4. ran the cleanup;
  5. checked the tip and deleted the remote branch.

  It also removed the review ledger it had written to its own scratchpad,
  and named the untracked plan file as left, with the reason.
- **Codex `ship-merge`, blocked.**
  - Its first two turns completed. The handoff ended "Merge PR #1? [ship](…/SKILL.md)
    requires: “merge only when the user asks.”": it offers the merge, but
    it names the skill and links its instruction file, which the
    instructions forbid in a reply.
  - The merge turn had started (`thread.started`) when the restart ended
    it. No merge call reached the stub.
- **Claude `custom-out`.** Turn 2 fetched and ran
  `git merge-base --is-ancestor`, which reported the branch contained. The
  session switched to `main`, fast-forwarded it and ran the cleanup. It
  deleted the remote branch after `git ls-remote` showed the printed tip,
  and asked nothing.

### What changed after round 3

The text now accepts either confirmation: the pull request's `MERGED`
state, or `origin/<default branch>` after a fetch containing the feature
branch or its squashed change. Both prove the same thing before anything is
removed, and the condition on the second one was ambiguous. The driver's
check accepts either too.

## Round 4 — either confirmation

The plugin files were identical to commit 993b568.

- **Claude:** `mm-merge` 15/15, `mm-merged-worktree` 15/15, `ship-merge`
  16/16, `custom-out` 14/14.
- **Codex:** `mm-merge` 15/15 and `ship-merge` 16/16. As scored at the
  time, `mm-merged-worktree` 14/15 and `custom-out` 13/14.

### The two Codex failures

- **`mm-merged-worktree` failed the driver, not the text.**
  - The session fetched and ran `git diff origin/main feature/durations`,
    which was empty. That is a valid confirmation under 993b568, and it
    used no `gh`.
  - It wrote its commands as one script with indented lines. The driver
    took only an unindented line as a command, so it saw no confirmation.
  - The driver now accepts indented lines. Rescored: 15/15.
- **`custom-out` failed `after_merge_names_record`.**
  - Turn 1's summary read "After the merge: [ready cleanup command](…/.worktrees/runs/wave-1/after-merge.sh)":
    a link to a script it had written, not the command. The text asks for
    the ready command on that line, and this change does not touch that
    rule.
  - Turn 2 was correct. It fetched and ran `git merge-base --is-ancestor`,
    chained with `&&` to the switch to `main`, the fast-forward and that
    script. The script removed the record and the branch, and the session
    deleted the remote branch after a tip check.
  - It reached no `gh` and no connector.
  - Kept as a failure.

### The other runs

- **Claude `mm-merged-worktree`** confirmed the merge both ways: git
  (`merge-base` and an empty `diff`) and `gh pr view` (`MERGED`).
- **Codex `mm-merge`** merged with
  `gh pr merge 1 --squash --match-head-commit <tip>`.
- **Handoffs.**
  - Claude: "Nothing is left open. Shall I merge the pull request and clean
    up?"
  - Codex: "Merge the PR and clean up afterward?". Codex reached it in turn
    1, and that handoff had no `After the merge:` line.

### The third review, of 205ae37 and 993b568

All findings of the second review were fixed or partly fixed. New findings:

- **Important, in the driver.** The git route counted any read of
  `origin/main` after any fetch: the cleanup's own `git fetch --prune`, and
  reads chained into the cleanup's command line, which cannot gate it.
- **Minor, in the text.** It did not say which confirmation wins when gh and
  git disagree. Suppose the change reached `main` by hand while the pull
  request stayed open. Then the git route would let the cleanup delete the
  branch of an open pull request, which closes it.
- **Minor, in the Fable 5.2 profile.** It still listed the cleanup "once
  the pull request is merged", although a merge without a pull request is
  now confirmed too.
- **Minor, in the driver's reply heuristics.**
  - `OWN_MERGE` took "Should I fix the nit, or merge as is?" and "Should I
    merge `main` into the feature branch first?" for merge offers.
  - `HANDS_BACK` rejected "Shall I squash-merge PR #1 and, once it is
    merged, remove …?".
  - `OFFER` missed "Let me know if it should go too.".
  - Some command forms were not seen as commands (`if`, `VAR=value`,
    `--no-pager`, `merge-tree`).
- **Minor, kept as limits.** The stub-log cross-check is not bounded by the
  cleanup, and Claude's parallel tool calls in one message count as steps
  in order.

### What changed after round 4

- When gh and git disagree, gh's state wins.
- The Fable 5.2 profile lists the cleanup after a confirmed merge.
- The driver counts a confirmation only in a step before the cleanup's own
  step, and a git confirmation only when it sets the feature branch against
  `origin/main`. Its reply heuristics are fixed as above, with offline
  cases for each.

## Round 5 — the final commit

The plugin files were identical to commit 1bdff5d. This round reran only the
scenarios the last change can affect. The other scenarios last ran on
993b568. Its plugin files differ from 1bdff5d in two places only: the
sentence "When gh and git disagree, gh's state wins." in the four
workflows, and the Fable 5.2 profile's no-approval item. Neither applies
after a merge the session made itself, where gh shows `MERGED`.

| Scenario | Claude | Codex |
|---|---|---|
| `mm-merged-worktree` | 15/15 | 15/15 |
| `custom-out` | 14/14 | not run: the profile change is Claude's only, and gh's precedence does not apply without a pull request |

- **Claude `mm-merged-worktree`.**
  1. Ran `gh pr view 1 --json state` (`MERGED`), then fetched and ran
     `git merge-base` and `git diff` against `origin/main`.
  2. `git switch main` was refused, so the session detached at
     `origin/main` and ran the cleanup.
  3. Checked the tip with `git ls-remote` and deleted the remote branch.
  4. Asked nothing.
- **Codex `mm-merged-worktree`.**
  1. Ran `gh pr view 1 --json state` (`MERGED`).
  2. Detached after the refused switch.
  3. Ran the cleanup from a Python step that rebuilt the command from the
     summary's `afterIntegration`.
  4. In the same step, deleted the remote branch only after
     `git ls-remote` showed the tip the script printed.
- **Claude `custom-out`.**
  1. Confirmed with git: a fetch, then `git merge-base --is-ancestor`.
  2. Switched to `main` and fast-forwarded it.
  3. Ran the cleanup.
  4. Deleted the remote branch inside a shell test on the printed tip.
  5. Asked nothing.

## Usage

Claude: the seat's cost per run, as the session reported it. Codex: input /
cached / output tokens per run. Codex reports the thread's running total at
the end of each turn, so a run's figure is the one from its last turn.

Child processes are billed separately and are not counted: the wave
runner's executors and judges, and an independent reviewer.

| Round | Scenario | Claude seat | Codex tokens |
|---|---|---|---|
| 1 | `mm-merge` | $2.06 | 1,093,974 / 1,012,352 / 3,236 |
| 1 | `mm-merged-worktree` | $1.90 | 871,775 / 793,344 / 3,034 |
| 1 | `ship-merge` | $4.90 | 1,332,989 / 1,281,536 / 4,712 |
| 2 | `mm-merge` | $1.90 | 855,658 / 796,928 / 3,004 |
| 2 | `mm-merged-worktree` | $2.04 | 1,214,296 / 1,162,880 / 4,460 |
| 2 | `ship-merge` | $4.37 | 3,961,025 / 3,886,464 / 8,660 |
| 3 | `mm-merge` | $1.93 | 1,023,145 / 940,672 / 3,463 |
| 3 | `mm-merged-worktree` | $1.96 | 1,084,349 / 1,043,712 / 3,232 |
| 3 | `ship-merge` | $4.09 | 2,492,303 / 2,422,528 / 7,692 (ended after the handoff) |
| 3 | `custom-out` | $1.77 | not run |
| 4 | `mm-merge` | $2.01 | 904,786 / 855,552 / 3,269 |
| 4 | `mm-merged-worktree` | $2.04 | 966,471 / 922,880 / 3,307 |
| 4 | `ship-merge` | $4.89 | 1,290,881 / 1,248,896 / 4,648 |
| 4 | `custom-out` | $1.81 | 823,462 / 781,568 / 2,968 |
| 5 | `mm-merged-worktree` | $1.91 | 1,328,083 / 1,284,736 / 4,490 |
| 5 | `custom-out` | $1.90 | not run |

## Totals

- **Claude:** $41.48 for the Fable 5.2 seat sessions over the five rounds.
- **Codex:** 19,243,197 input, 18,434,048 cached and 60,175 output tokens.
  This includes the round-3 `ship-merge` run that the restart ended.

## Observations

- **Confirming a user's merge.** When the user said they had merged, each
  session confirmed it one of three ways:
  - with git alone: a fetch, then `git diff`, `merge-base` or `git log`
    against `origin/main`;
  - with `gh pr view` alone;
  - with both.

  When a session had just merged itself, it read the state with
  `gh pr view` right after `gh pr merge`, on both hosts in every round. A
  confirmation gates the run records, which the script removes whether or
  not the branch is integrated. Branches are gated anyway: the script
  removes only what is already integrated into `--into origin/main`.
- **Deleting the remote branch.** Every passing run checked the remote tip
  against the one the script printed before deleting the branch.
  - Claude ran `git ls-remote`, once inside a shell test that gated the
    push.
  - Codex often wrote a Python step that read `git ls-remote` and pushed
    the deletion with `--force-with-lease` at that tip.
- **What stays.** Runs named what stayed with the reason and asked nothing.
  - Claude in `mm-merged-worktree`: the primary checkout's `main` behind
    `origin/main`, and the driver's `thread/merge-check` branch, both
    created outside the run.
  - Claude in `ship-merge`: the untracked plan file.
  - Codex in round 2's `ship-merge`: its `.worktrees/duration-delivery/`
    directory with the plan, the pull request body and the ledgers.
- **Instruction files cited in a reply.** Codex justified two questions by
  linking the instruction file that asks for them. The instructions forbid
  naming them in a reply.
  - In ship's start approval in rounds 2 and 3, it linked the planning
    workflow file. That question and its text are unchanged here.
  - In round 3's handoff it wrote "Merge PR #1? [ship](…/SKILL.md)
    requires: “merge only when the user asks.”".

  No Claude reply did this, and neither did Codex in rounds 1 and 4.
- **Codex and the `After the merge:` command.** Codex's multi-model
  summaries printed the command. Its ship handoffs did not:
  - in rounds 2 and 3 they pointed to a file holding the command;
  - in round 4 the line was missing.

  Its round-4 `custom-out` summary linked a script. In every case the merge
  turn still ran the cleanup through the script.

## Limits

- **One run** per host, scenario and round.
- **States the stub never has.** It has no pending checks, `BLOCKED` merge
  state, merge queue or auto-merge in progress. The rules "wait for running
  checks" and "a queued or auto-merge pull request is not merged yet" have
  no live coverage. The stub does merge a clean pull request at once on
  `--auto`, as gh does, and the frozen check fails any `--auto`.
- **The path without a pull request** is covered by `custom-out` only: a
  one-task wave, with `main` fast-forwarded by the driver.
- **The final commit's coverage.** On the final commit only
  `mm-merged-worktree` (both hosts) and `custom-out` (Claude) ran.
  `mm-merge` and `ship-merge` last ran on 993b568 (see round 5).
- **No live run had gh and git disagree.** In every fixture, the pull
  request's state and `origin/main` agree, so the precedence of gh's state
  is checked by the contract only.
- **The confirmation is scored by command, not by conclusion.**
  - A fetch followed by a git command that sets the feature branch against
    `origin/main` counts, whatever the session read from it.
  - The stub's log must show a state view answering after the last merge,
    but that view is not tied to a point before the cleanup.
  - Claude's parallel tool calls in one message count as steps in order.
- **The Codex review child's commands** do not appear in the parent's
  trace. Its `gh` calls are seen only in the stub's log.
