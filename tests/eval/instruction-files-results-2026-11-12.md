# Instruction files kept out of messages to the user — live results, 2026-11-12

Record for orchestration 4.23.2 and code-review 1.21.1. No message to the
user — an update, a question, an approval request or the final report —
should name, quote or link an instruction file of the skills being run.
ship's handoff should end with its merge question, with nothing after it.

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
- `claude-fable-5-2` and `gpt-6.1-sol` at `medium`.

No installed plugin, marketplace or configuration was touched.

## The scenarios

`ship-merge` and `mm-merge` of `merge-cleanup-live.py`, described in
[the 4.23.0 record](merge-cleanup-results-2026-11-11.md); their earlier
checks are unchanged. Every citation the earlier records saw was in a Codex
ship run, so most runs here are Codex `ship-merge`, four to six per round.
Claude `ship-merge` and `mm-merge` ran at most once per host and round, to
see that the rule changes nothing else.

## The new frozen checks

| Check | Expected |
|---|---|
| `no_instruction_file_named` | No message the main session showed the user, in any turn, names or links an instruction file. The messages are Codex agent messages and Claude's text blocks and results. An instruction file is the name of any `.md` file under the plugins' skills (`SKILL.md`, `WORKFLOW.md`, `FIXES.md`, a profile, a reference document…), an orchestrator or reviewer profile name without `.md`, a `references/*.md` path, a path under `.agents/skills/` or a link to a skill directory. Code that names `wave-cleanup.mjs`, the command after the merge, is not read. |
| `instruction_read` | A tool output, or a skill that Claude Code loads, carries the candidate's new sentence "never name, quote or link an instruction file of the skills you are running". |

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

## Before the change — e599253

The plugin files are those of 4.23.1 on `main`. Five Codex `ship-merge`
runs. Every handoff offered the merge, and one justified it with a link:

> Shall I merge PR #1?
> The [ship instructions](.agents/skills/ship/SKILL.md) require merging
> “only when the user asks for it.”

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
  - one handoff linked the instruction file after its question: "Merge PR
    #1 into `main`?" and then "The [delivery
    instructions](.agents/skills/ship/SKILL.md) require “merge only when
    the user asks,” so merging needs your confirmation.";
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
- **One added a line after it:** "The [ship
  skill](.agents/skills/ship/SKILL.md) requires merging “only when the
  user asks for it,” so this step needs your approval." It failed
  `no_instruction_file_named`.
- **Claude `mm-merge` was stopped.** Its candidate checkout was removed
  while it ran. It ran again on the final commit.

## Round 4 — 1ccd805, the final commit

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

## Rescored with the final driver

Codex `ship-merge` runs in order.

| Round | Commit | Claude | Codex `ship-merge` | Codex `mm-merge` |
|---|---|---|---|---|
| before | e599253 | — | **18/20**, **19/20**, **19/20**, **19/20**, **19/20** | — |
| 2 | dbb5d4f | 20/20, 19/19 | **19/20**, **19/20**, 20/20, **19/20** | 19/19 |
| 3 | 731105d | 20/20 | 20/20, **19/20**, 20/20, 20/20, 20/20, 20/20 | 19/19 |
| 4 | 1ccd805 | 20/20, 19/19 | 20/20, 20/20, 20/20, 20/20, 20/20, 20/20 | — |

Claude's scores are `ship-merge` and then `mm-merge`. The failures:

- **Before the change**, every run fails `instruction_read`: the marker is
  the new rule's sentence, which 4.23.1 does not have. The first run also
  fails `no_instruction_file_named`.
- **Round 2:** the link after the question and the two handoffs without
  a merge offer.
- **Round 3:** the line after the question.

## Messages that named an instruction file

| Round | Commit | Codex handoffs naming a file | Codex handoffs offering the merge |
|---|---|---|---|
| before | e599253 | 1 of 5 | 5 of 5 |
| 2 | dbb5d4f | 1 of 4 | 2 of 4 |
| 3 | 731105d | 1 of 6 | 6 of 6 |
| 4 | 1ccd805 | 0 of 6 | 6 of 6 |

No Claude message named one, in 5 runs here or in the earlier records.
Each Codex citation was a link to ship's `SKILL.md`, on the line right
after the merge question, giving the rule as the question's reason. A scan
of every message for words such as "instructions", "skill" or "require"
found no instruction cited in words alone, without a link.

## Usage

Seat sessions only; the runners' children are not counted. Claude: the
cost the session reports, per turn. Codex: a resumed thread reports a
running total, so a run's figure is its last turn's.

| Round | Commit | Claude | Codex input (cached) | Codex output |
|---|---|---|---|---|
| before | e599253 | — | 7,134,223 (6,838,912) | 24,172 |
| 2 | dbb5d4f | $6.90 | 6,074,660 (5,812,096) | 21,220 |
| 3 | 731105d | $4.76 | 8,761,155 (8,426,496) | 30,820 |
| 4 | 1ccd805 | $6.73 | 8,149,135 (7,852,544) | 27,399 |
| **Total** | | **$18.38** | **30,119,173 (28,930,048)** | **103,611** |

Round 1's runs and round 3's Claude `mm-merge` were stopped before the host
reported usage, so they are not counted. A Claude `ship-merge` run cost
$4.8–5.0 and a `mm-merge` run $1.9; a Codex `ship-merge` run used 1.0–1.7M
input tokens.

## Observations

- **Where the link appeared.** Every handoff citation, here and in the
  4.23.0 and 4.23.1 records, followed the merge question. The general rule
  alone did not stop it: 1 of 4 handoffs in round 2 and 1 of 6 in round 3.
  With the question as the last line and nothing after it, 0 of 6.
- **Six clean runs do not prove the rate is zero.** Before the final text,
  3 of 15 Codex handoffs cited a file. At that rate, six clean runs in a
  row happen by chance about one time in four (0.8⁶ ≈ 0.26). The final
  text removes the place where every citation appeared.
- **The merge offer came back.** Round 2's two handoffs without it did not
  recur: rounds 3 and 4 offered the merge in 12 of 12 Codex handoffs, 10
  of them in the template's exact words.

## Limits

- **super-plan's start approval** ran live on Claude Code only. Every
  Codex `ship-merge` run, 21 in all, implemented the change directly and
  reached its handoff in the first turn. The start-approval citations in
  the 4.23.0 record were not retested.
- **critical-review's sentence** did not run on its own: no run reviewed
  changes or a pull request for the user directly.
- **`mm-merged-worktree` and `custom-out` did not run.** They use the same
  multi-model entry text as `mm-merge`.
- **The detector reads names and links.** A file described only in words
  passes; the scan above found none.
