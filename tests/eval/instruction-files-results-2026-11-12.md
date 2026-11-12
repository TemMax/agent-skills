# Instruction files kept out of messages to the user — live results, 2026-11-12

Record for orchestration 4.23.2 and code-review 1.21.1. No message to the
user — an update, a question, an approval request or the final report —
should name, quote or link an instruction file of the skills being run.
ship's handoff should end with its merge question, with nothing after it.

## Outcome

- **ship's handoff is fixed on Codex.** Before the change 1 of 5 Codex
  handoffs linked ship's `SKILL.md` right after the merge question. Since
  the question became the handoff's last line with nothing after it, none
  of 24 Codex handoffs named a file, and each ended with the merge
  question.
- **The start approval of a planned run is not fixed on Codex.** All 12
  Codex start approvals cited an instruction file: the planning skill's in
  11, ship's `SKILL.md` in 1. That held under the rule and under three
  more wordings of that step, which were reverted. Most likely the cause is
  Codex's own system prompt, which ranks above a skill. After any question
  for confirmation, it tells the model to explain in a separate paragraph
  where the requirement came from, with "a SKILL.md" as its example.
- **Claude Code named no instruction file in any run.** multi-model and
  critical-review on their own passed every check on both hosts.
- **The exception holds for critical-review.** Reviewing a change to the
  repository's own critical-review `SKILL.md`, both hosts cited that file
  in their finding and named none of their own loaded instructions.

Candidate: branch `instruction-files-out-of-replies`. Each round ran from a
clean, detached checkout of its commit outside the repository, so the
driver's copy of the plugins is that commit's. Every run's `snapshot.json`
matches its commit's 104 plugin files.

Hosts, loading and seats are those of
[the 4.23.1 record](after-merge-command-results-2026-11-12.md):

- Claude Code 2.1.322 with a `--plugin-dir` copy;
- Codex CLI 0.167.0 with workspace skills linked to the copy,
  `--ignore-user-config`, `--disable plugins`, `--disable apps` and
  `allow_login_shell=false`;
- `claude-fable-5-2` and `gpt-6.1-sol` at `medium`; the critical-review
  runs of `review-content-live.py` use that driver's defaults,
  `claude-sonnet-5-5` and `gpt-6.1-sol`.

No installed plugin, marketplace or configuration was touched.

## The scenarios

`ship-merge` and `mm-merge` of `merge-cleanup-live.py`, described in
[the 4.23.0 record](merge-cleanup-results-2026-11-11.md); their earlier
checks are unchanged. Every citation the earlier records saw was in a Codex
ship run, so most runs here are Codex `ship-merge`, three to six per round.
Claude `ship-merge` and `mm-merge` ran at most once per host and round, to
see that the rule changes nothing else.

Round 5 adds two scenarios, so the paths the earlier rounds missed run too:

- **`ship-wave-merge`**, new in `merge-cleanup-live.py`: `ship-merge` with
  "Use agents for the implementation." added to the request. Every Codex
  `ship-merge` run implements this one-task change directly, so it never
  reaches super-plan's start approval, where the 4.23.0 record saw Codex
  link the planning workflow. With agents asked for, the session plans a
  supervised wave and stops at that approval first.
- **`review-content-live.py`, case `implied`:** a headless critical-review
  of a change that crashes on an empty list, on its own and not as a stage
  of ship.

## The new frozen checks

| Check | Expected |
|---|---|
| `no_instruction_file_named` | No message the main session showed the user, in any turn, names or links an instruction file. The messages are Codex agent messages and Claude's text blocks and results. An instruction file is, in any letter case, the name of any `.md` file under the plugins' skills (`SKILL.md`, `WORKFLOW.md`, `FIXES.md`, a profile, a reference document…), an orchestrator or reviewer profile name without `.md`, a `references/*.md` path, a path under `.agents/skills/` or a link to a skill directory, an anchor included. Code lines that name `wave-cleanup.mjs`, the command after the merge, are not read, nor their backslash continuations. |
| `instruction_read` | A tool output, or a skill that Claude Code loads, carries the candidate's new sentence "never name, quote or link an instruction file of the skills you are running". |
| `handoff_question_last` (ship scenarios, from round 5) | The handoff's last non-empty line offers the session's own merge, by `handoff_offers_merge`'s rule applied to that line alone, and ends with the question mark; only closing markup may follow it on the line. |
| `start_approval_before_wave` (`ship-wave-merge`) | Turn 1 stops before the handoff with a question (the start approval) and runs no wave runner or launcher and no `gh pr create`; then a wave runs before the merge turn: a later turn starts a runner or the launcher with `node`, or a run record exists before the merge turn. |

What a ship run's first turn says after its last question, when it stops
before the handoff, is kept as the fact `start_approval_tail`.

How they changed:

- **e599253** adds `no_instruction_file_named` for `SKILL.md`,
  `WORKFLOW.md`, `orchestrator-*.md` profiles, `references/*.md` documents
  and paths under `.agents/skills/`. `instruction_read` still looks for
  the 4.23.1 text.
- **7a4a3d4** and **dbb5d4f** point `instruction_read` at the new rule.
- **731105d**, from the review:
  - the detector knows every instruction file name the plugins ship,
    profile and reviewer names without `.md`, and links to a skill
    directory;
  - `instruction_read` also reads a skill that Claude Code loads, which
    arrives as a user text block, not a tool output.
- **361482b**, from the second review:
  - the detector moves to `instruction_files.py`, shared with
    `review-content-live.py`, which scores `no_instruction_file_named` for
    the candidate;
  - it matches names in any letter case and a link to a skill directory
    with an anchor, and in a code block it skips only the lines that name
    `wave-cleanup.mjs` and their backslash continuations, not the whole
    block;
  - `handoff_question_last` and `ship-wave-merge` with
    `start_approval_before_wave` are added.
- **19f2ddf** adds `start_question_last`, the start approval's question as
  its last line, for that commit's text; **cb0686f** drops it with that
  text, since Codex's host asks for a paragraph after the question.
- **2a120c6**, **2e45f50**, **34fc3d8** and **be6a3b3** make the driver see
  every wave a live run started: a quoted path with a substitution inside,
  one that ends inside a substitution, a variable set to the runner's path,
  and, for `start_approval_before_wave`, a run record when the runner ran
  from a Python script.
- **662e09f**, from the third review:
  - `review-content-live.py` gains the case `skill-file`;
  - `start_approval_before_wave` also reads what turn 1 left, kept in
    `meta.json` as `after_turn_1`: no run record and no pull request
    created in the stub's log;
  - `start_approval_tail` keeps text after the question on its own line;
  - the detector pairs code spans left to right and skips any printed
    command (`node`, `python3`, `git`, `gh`…), not only the cleanup.

  No retained run's score changes.

## Before the change — e599253

The plugin files are those of 4.23.1 on `main`. Five Codex `ship-merge`
runs. Every handoff offered the merge, and one justified it with a link:

```text
Shall I merge PR #1?
The [ship instructions](.agents/skills/ship/SKILL.md) require merging “only when the user asks for it.”
```

As scored at the time, that run failed `no_instruction_file_named` and the
other four passed every check.

## Round 1 — 7a4a3d4, stopped

The first text forbade naming "an instruction file of a skill". A user's
task can be about a skill's own files, such as editing a `SKILL.md` in this
repository, so dbb5d4f limited it to the skills being run. Four Codex
`ship-merge` runs and one Claude run were stopped within a minute, before
any handoff. They are not scored, and their usage was not recorded.

## Round 2 — dbb5d4f

The rule in all six orchestration entry points, with an example reason,
"merging changes `main`".

| Scenario | Claude | Codex |
|---|---|---|
| `ship-merge` | 19/20 | **19/20**, **19/20**, 20/20, **19/20** |
| `mm-merge` | 18/19 | 19/19 |

- **Codex `ship-merge`, four runs:**
  - one handoff linked the instruction file after its question, "Merge PR
    #1 into `main`?":

    ```text
    The [delivery instructions](.agents/skills/ship/SKILL.md) require “merge only when the user asks,” so merging needs your confirmation.
    ```

  - two did not offer the merge and failed `handoff_offers_merge`. One
    ended with the cleanup command and asked nothing; the other asked
    "Shall I check hosted CI before merging?";
  - one passed every check.

  A likely cause of the two is the example reason, which is about merging.
  731105d drops it and gives the handoff the question's form.
- **Claude** failed only `instruction_read` in both runs. Claude Code
  delivers a skill as a user text block, which the driver did not read
  then. Rescored, both pass every check.

## Round 3 — 731105d

The rule loses its example, covers a file the user asks about and says a
printed command is not an instruction file. ship's handoff asks the merge
"as that question alone", with no reason or rule added. critical-review
gets the rule in one sentence.

| Scenario | Claude | Codex |
|---|---|---|
| `ship-merge` | 20/20 | 20/20, **19/20**, 20/20, 20/20, 20/20, 20/20 |
| `mm-merge` | stopped | 19/19 |

- **Every Codex handoff offered the merge**, each in the template's words:
  "Merge pull request #1 into `main` and clean up?".
- **One added a line after it**, and failed `no_instruction_file_named`:

  ```text
  The [ship skill](.agents/skills/ship/SKILL.md) requires merging “only when the user asks for it,” so this step needs your approval.
  ```
- **Claude `mm-merge` was stopped.** Its candidate checkout was removed
  while it ran. It ran again on the final commit.

## Round 4 — 1ccd805

The merge question is the handoff's last line, after every other line:
"nothing follows it — no reason, no rule and no reference to these
instructions."

| Scenario | Claude | Codex |
|---|---|---|
| `ship-merge` | 20/20 | 20/20, 20/20, 20/20, 20/20, 20/20, 20/20 |
| `mm-merge` | 19/19 | not run |

- **Every run passed every frozen check.**
- **Each Codex handoff** ended with the cleanup command block and then the
  question: "Merge pull request #1 into `main` and clean up?" four times,
  "Merge PR #1 into `main` and clean up?" twice. Nothing followed it.
- **Claude** stopped at super-plan's start approval, which ended "Approve
  the plan and start?" and named no file. Its handoff ended with the same
  merge question.
- **Codex `mm-merge`** did not run here. multi-model's files are those of
  731105d, where it passed: this commit changes only ship's workflow.

## The second review

A fresh agent reviewed 638a535, the branch with rounds 1–4 recorded. Every
number of the record and of the changelog reproduced from the retained
runs. It found:

- **Important:** the changelog claimed more than the live checks covered:
  no Codex run reached super-plan's start approval, where the 4.23.0
  record saw the citation, and critical-review never ran on its own.
- **Important:** critical-review's sentence had no exception for a task
  about its own files, which matters when it reviews a change to them.
- **Minor:**
  - the Stage 4 sentence read the example as one of the other lines, and
    the example copied the fixture's PR and branch;
  - no frozen check held "nothing after the question";
  - detector gaps: letter case, a skill-directory link with an anchor, and
    a citation inside the block that holds the command;
  - "the rule alone" misdescribed round 3, which also had "ask it alone";
  - "the instruction that asks for it" could cover the user's own
    `AGENTS.md`;
  - the contract did not pin "A command you print is not an instruction
    file.";
  - quoted links rendered as broken links.

361482b fixes all of them; rounds 5–8 cover the two paths.

## Round 5 — 361482b, the final plugin files

- critical-review may name its files when the user's request is about
  them.
- ship asks the merge question last, such as
  `Merge pull request #<n> into <default branch> and clean up?`.
- A reason is never "the skill instruction that asks for it".

| Scenario | Claude | Codex |
|---|---|---|
| `ship-merge` | 21/21 | 21/21, 21/21, 21/21 |
| `ship-wave-merge` | — | **21/22**, **21/22**, **21/22** |
| `mm-merge` | 19/19 | 19/19 (round 8) |
| critical-review, `implied` | 7/7 | 7/7 (round 8) |

As rescored with the final driver. Scored at the time, one Codex
`ship-wave-merge` run also failed `start_approval_before_wave`: the driver
did not see how it started the runner.

- **Every Codex handoff** ended with the merge question and named no file,
  in both scenarios, with the PR number and branch filled in.
- **Every Codex start approval cited the planning instructions**, each
  after its question:

  ```text
  Start execution?

  The [planning workflow](.agents/skills/super-plan/WORKFLOW.md) requires: “wait for the user's approval to start.” This is its single start approval.
  ```
- **Claude's start approval** ended "Approve the plan and start?" and named
  nothing.
- **Codex `mm-merge` and the Codex review** ran in round 8, on cb0686f.
  Its multi-model and critical-review files are these, and neither run
  read super-plan's workflow, the only file that differed.

## Rounds 6–8 — the start approval

Each round changed only super-plan's Gate 2, on both hosts.

| Round | Commit | Gate 2 adds | Codex start approvals naming a file | Claude |
|---|---|---|---|---|
| 6 | 19f2ddf | ask the start question last, nothing after it | 3 of 3 (2 above the question, 1 below) | ends with the question |
| 7 | 669ed2b | and nowhere cite the instructions as the reason; say "Nothing is created until you approve" | 3 of 3 (1 above, 2 below) | ends with the question |
| 8 | cb0686f | a host may ask for an explanation after the question: one plain sentence, such as "The run you asked for stops once here, before it creates anything", never citing the instructions | 3 of 3 (1 above, 2 below) | uses the plain sentence |

In each round one Codex `ship-merge` run and one Claude `ship-merge` run
passed every check, and every Codex handoff was clean. Rescored, each Codex
`ship-wave-merge` run fails only `no_instruction_file_named`, from its
start approval. Scored at the time, some also failed
`start_approval_before_wave`, where the driver missed how the runner was
started, or `start_question_last`, which rounds 6 and 7 carried.

After round 7, the Codex session logs showed the most likely cause.
Codex's base instructions in these sessions say:

> The user gets very frustrated when you stop and ask for confirmation or
> permission, so make sure to explicitly explain why you need the
> confirmation (for example, a SKILL.md, AGENTS.md, memory, or approval
> auto-review block) and where it came from. […] Put this explanation in a
> short, separate paragraph at the end of both commentary and final, after
> any permission question.

These are the host's own developer instructions, and a skill's text ranks
below them, so the skill cannot reliably turn that paragraph off. Codex
fills "where it came from" with the file, as in round 6:
`The requested [workflow](…/WORKFLOW.md) requires: “Then wait for the user's approval to start.”`

It does not explain everything. The handoff's merge question is a
permission question too, yet none of the 24 Codex handoffs since 1ccd805
added such a paragraph, where 3 of 15 had before. And 4 of the 9 start
approvals of rounds 6–8 put the citation above the question, not after it
as the prompt says.

5075302 returns Gate 2, its contract and the phase-policy baseline to
their text on `main`, so the final plugin files are 361482b's.

## The third review

A fresh agent reviewed c8e1b3a, the branch with rounds 5–8 recorded. Every
number reproduced again, from all 61 retained runs. It found:

- **Important:** the highlights, the only part announced on merge, did not
  say that the start approval on Codex still cites a file.
- **Important:** neither exception, a task about a skill's own files, had
  run live, though reviewing changes to skill files is this repository's
  daily use.
- **Minor:**
  - `start_approval_before_wave` could pass a run that started its wave
    before the approval in a way the driver does not see;
  - `start_approval_tail` dropped text after the question on its line;
  - the detector failed printed commands other than the cleanup, and a code
    span could reach into the next one;
  - "about once in 200" took 3 of 15 as the true rate;
  - wording: the models behind the cost, the uncounted runner children,
    the cause stated as settled, `#<n>` rendered as a tag.

662e09f and the changelog answer all of them. The case-insensitive match
of short generic names (`pr.md`, `REVIEW.md`) stays; see the limits.

## The exception — 662e09f, `skill-file`

`review-content-live.py`'s new case: the change under review adds a link to
the repository's own `plugins/code-review/skills/critical-review/SKILL.md`,
whose target is misspelled (`REVEIW.md`). The file shares its name and
skill with the reviewer's loaded instructions, and the request is about it.
The plugin files are 361482b's.

| Host | Model | Checks | Finding |
|---|---|---|---|
| Claude Code | `claude-sonnet-5-5` | 6/6 | Blocker at `plugins/code-review/skills/critical-review/SKILL.md:9`: "`REVEIW.md` does not exist" |
| Codex | `gpt-6.1-sol` | 6/6 | Important at `[SKILL.md:9](plugins/code-review/skills/critical-review/SKILL.md#L9)`: "The destination is `REVEIW.md`, which does not exist" |

Both named `SKILL.md`, `REVIEW.md` and `PROFILE.md` of the repository as
the request needed, and neither named its own loaded instructions by path.

## Rescored with the final driver

Runs of a scenario in order; Claude's are `ship-merge`, then `mm-merge`.

| Round | Commit | Claude | Codex `ship-merge` | Codex `ship-wave-merge` | Codex `mm-merge` |
|---|---|---|---|---|---|
| before | e599253 | — | **18/21**, **20/21**, **20/21**, **20/21**, **20/21** | — | — |
| 2 | dbb5d4f | 21/21, 19/19 | **19/21**, **19/21**, 21/21, **19/21** | — | 19/19 |
| 3 | 731105d | 21/21, stopped | 21/21, **19/21**, 21/21, 21/21, 21/21, 21/21 | — | 19/19 |
| 4 | 1ccd805 | 21/21, 19/19 | 21/21 ×6 | — | — |
| 5 | 361482b | 21/21, 19/19 | 21/21 ×3 | **21/22** ×3 | — |
| 6 | 19f2ddf | 21/21 | 21/21 | **21/22** ×3 | — |
| 7 | 669ed2b | 21/21 | 21/21 | **21/22** ×3 | — |
| 8 | cb0686f | 21/21 | 21/21 | **21/22** ×3 | 19/19 |

critical-review on its own (`review-content-live.py`, `implied`): Claude
7/7 in round 5 and Codex 7/7 in round 8.

The failures:

- **Before the change**, every run fails `instruction_read`: the marker is
  the new rule's sentence, which 4.23.1 does not have. The first run also
  fails `no_instruction_file_named` and `handoff_question_last`.
- **Round 2:** two handoffs without a merge offer (`handoff_offers_merge`
  and `handoff_question_last`) and the link after the question
  (`no_instruction_file_named` and `handoff_question_last`).
- **Round 3:** the line after the question, the same two checks.
- **Rounds 5–8:** every `ship-wave-merge` run fails
  `no_instruction_file_named`, from its start approval and nothing else.

## Messages that named an instruction file

| Round | Commit | Codex handoffs naming a file | offering the merge | ending with that question | Codex start approvals naming a file |
|---|---|---|---|---|---|
| before | e599253 | 1 of 5 | 5 of 5 | 4 of 5 | — |
| 2 | dbb5d4f | 1 of 4 | 2 of 4 | 1 of 4 | — |
| 3 | 731105d | 1 of 6 | 6 of 6 | 5 of 6 | — |
| 4 | 1ccd805 | 0 of 6 | 6 of 6 | 6 of 6 | — |
| 5 | 361482b | 0 of 6 | 6 of 6 | 6 of 6 | 3 of 3 |
| 6 | 19f2ddf | 0 of 4 | 4 of 4 | 4 of 4 | 3 of 3 |
| 7 | 669ed2b | 0 of 4 | 4 of 4 | 4 of 4 | 3 of 3 |
| 8 | cb0686f | 0 of 4 | 4 of 4 | 4 of 4 | 3 of 3 |

No Claude message named one, in 11 runs here or in the earlier records.
Every Codex citation linked a `SKILL.md` or `WORKFLOW.md` under
`.agents/skills/`, as the reason for the question next to it. A scan of
every message for words such as "instructions", "skill" or "requires"
found no instruction cited in words alone. One update said "I'll read the
delivery instructions": it names no file, but it narrates reading
instructions, which an older rule asks the session not to do.

## Usage

Seat sessions only; the runners' children, which the `ship-wave-merge`
waves start, are not counted. Claude: the cost the session reports, per
turn. Codex: a resumed thread reports a running total, so a run's figure is
its last turn's. Rounds 5 and 8 include the critical-review runs; the
Claude ones, there and in the exception's row, ran on `claude-sonnet-5-5`.

| Round | Commit | Claude | Codex input (cached) | Codex output |
|---|---|---|---|---|
| before | e599253 | — | 7,134,223 (6,838,912) | 24,172 |
| 2 | dbb5d4f | $6.90 | 6,074,660 (5,812,096) | 21,220 |
| 3 | 731105d | $4.76 | 8,761,155 (8,426,496) | 30,820 |
| 4 | 1ccd805 | $6.73 | 8,149,135 (7,852,544) | 27,399 |
| 5 | 361482b | $6.08 | 11,804,745 (11,442,304) | 34,494 |
| 6 | 19f2ddf | $4.97 | 9,309,278 (9,017,984) | 22,728 |
| 7 | 669ed2b | $5.14 | 11,179,424 (10,880,512) | 28,073 |
| 8 | cb0686f | $4.17 | 12,040,201 (11,645,952) | 31,308 |
| exception | 662e09f | $0.13 | 303,531 (259,328) | 1,179 |
| **Total** | | **$38.88** | **74,756,352 (72,176,128)** | **221,393** |

Round 1's runs and round 3's Claude `mm-merge` were stopped before the host
reported usage, so they are not counted. A Claude `ship-merge` run cost
$3.9–5.1 and a `mm-merge` run $1.9–2.0. A Codex `ship-merge` run used
1.0–1.7M input tokens, and a `ship-wave-merge` run 2.4–4.6M.

## Observations

- **The handoff.** Every handoff citation, here and in the 4.23.0 and
  4.23.1 records, followed the merge question. The rule alone left 1 of 4;
  with the question asked alone, 1 of 6. Since the question is the last
  line with nothing after it, 24 of 24 Codex handoffs named no file and
  ended with the question: 3 of 15 before against 0 of 24 after
  (one-sided Fisher's exact test, p ≈ 0.05).
- **The start approval.** Codex's host asks for a paragraph that says where
  a confirmation requirement came from. Whatever the skill said, Codex
  answered with the instruction file and moved the citation above or below
  the question. Claude Code follows the rule, and in round 8 used the plain
  sentence it was given.
- **The merge offer came back.** Round 2's two handoffs without it did not
  recur: from round 3 every Codex handoff offered the merge.
- **The driver missed waves.** Codex started the runner four ways the
  driver did not recognize at first. Each is now a test case, and a run
  record counts as the wave after the start approval.

## Limits

- **The start approval on Codex is not fixed.** The most likely cause is
  the host's own instructions, seen here in `codex exec`; other Codex
  surfaces did not run.
- **The orchestration exception did not run live:** a ship or multi-model
  task about a skill's own files. critical-review's did (`skill-file`).
- **`mm-merged-worktree` and `custom-out` did not run.** They use the same
  multi-model entry text as `mm-merge`.
- **Codex `mm-merge` and the Codex review ran on cb0686f**, whose files
  they read are the final ones.
- **The detector reads names and links.** A file described only in words
  passes; the scan above found none. Short generic names match in any
  letter case, so a user's own `pr.md` or `REVIEW.md` would count.
- **critical-review's Codex entry point** is 7491 bytes against the 7500
  limit.
