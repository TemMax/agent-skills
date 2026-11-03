# super-plan plan content — live results, 2026-11-02/03

Orchestration 4.19.0 candidate (working tree) syncs super-plan's planning
rules with superpowers v7.0.1: a plan records decisions, not code; tasks carry
`Consumes:`/`Produces:` interfaces; a `## Review Focus` pins inputs the
request implies; an open platform or language is asked. Driver:
`tests/eval/plan-content-live.py`. Expectations were frozen in each run's
`expected.json` before the host started.

Loading: Claude Code 2.1.316 with the snapshot as `--plugin-dir` and
`--setting-sources project` (installed plugins off); Codex CLI 0.166.0 with
`--ignore-user-config --disable plugins` and the snapshot's skills linked
under `.agents/skills`. Each run's trace shows the snapshot's own
`super-plan/WORKFLOW.md` read, with the arm's marker phrase
(`unambiguous, not complete` for the candidate, `with full code where the
solution` for 4.18.0). No installed plugin was touched.

Models: Claude `claude-opus-5-5` at `medium`; Codex `gpt-6.1-sol` at
`medium`. One run per cell; the interfaces case ran twice per host because
the first runs predate a one-phrase edit (a contract-first wave writes
signatures, not its implementation). Runs `-2` and Codex platform load that
text; Claude platform and both `-1` runs load the earlier candidate. All
recorded runs predate the review-driven wording on fenced `## ` lines and
section placement, which changes no rule these runs exercise.

| Run | Version | Checks | Tasks | Plan lines | Code share of task prose | Review Focus items | Produces / Consumes tasks | Seconds | Cost / tokens |
|---|---|---|---|---|---|---|---|---|---|
| Claude interfaces 1 | 4.19.0 early | pass | 4 | 290 | 1.9% | 5 | 1 / 3 | 124 | $0.76 |
| Claude interfaces 2 | 4.19.0 | pass | 4 | 271 | 0% | 5 | 1 / 3 | 125 | $0.76 |
| Claude interfaces, baseline | 4.18.0 (HEAD) | lint only | 4 | 296 | 19.6% | none | 0 / 0 | 127 | $0.71 |
| Claude platform | 4.19.0 early | pass | 3 | 315 | 9.3% | 5 | — | 173 | $0.85 |
| Codex interfaces 1 | 4.19.0 early | pass | 5 | 185 | 0% | 5 | 1 / 4 | 483 | 459k tokens |
| Codex interfaces 2 | 4.19.0 | pass | 4 | 158 | 0% | 5 | 1 / 3 | 132 | 582k tokens |
| Codex platform | 4.19.0 | pass | 1 | 112 | 0% | 5 | — | 125 | 260k tokens |

What the checks establish:

- Every candidate plan is lint-clean, with no `review-focus`, `proportion` or
  `section-order` warning, and `## Review Focus` sits above the first task.
- Interfaces case: `parse_duration` is given by signature only; exactly one
  task names it under `Produces:` and every other task that names it does so
  under `Consumes:`. The first scoring (`checks.json` in each run) passed
  vacuously when no consumer was detected and counted a producer's own
  `Consumes: str` line; after review the analyzer reads each label up to the
  next label or blank line, and the saved plans were re-scored with it —
  every candidate run still passes; the table shows the re-scored counts.
  Each Review Focus line names the test that pins it in the owning task
  (read by hand).
- The 4.18.0 baseline on the same fixture wrote the full `parse_duration`
  body twice (in its `## Design` section and in the task), had no Review
  Focus and no interface blocks.
- Platform case: both hosts put the platform question first under
  `## Assumptions (would ask)`, saying what the answer changes, and planned
  on a stated provisional answer (order and wording read by hand; the
  automated check only finds a platform word in that section).

Execution from decision-only prose:

- Codex: wave 1 of the `Codex interfaces 2` plan (the parser task), after
  replacing the headless "confirm before execution" note with the confirmed
  grammar as a user would, ran through `codex-wave-runner.mjs`: executor
  `gpt-6.1-sol` at `medium`, supervisor `gpt-6.1-sol` at `high`; merge-ready
  on the first attempt, 2 model calls, 63 s. The supervisor independently
  re-ran the contract (7 tests passed) and found no violation.
- Claude: the Workflow-based Claude runner was not run (it needs an
  in-session Workflow). Instead the `Claude interfaces 2` parser task, as
  the launcher composes it (contract JSON plus the task prose), went to a
  `claude -p` Sonnet 5.5 executor at `medium`: $0.06, 6 turns; it wrote
  exactly the four tests the plan named, and the task's `must_run` and the
  full suite passed when re-run afterwards. This is an executor probe, not a
  supervised Claude wave.

Seam audit (the new fifth check), `tests/eval/seam-audit-fixtures.sh`, one
run per cell, final candidate text; the audit routes Claude
`claude-sonnet-5-5` and Codex `gpt-6.1-sol`, both at `medium`:

| Fixture | Expect | Claude | Codex |
|---|---|---|---|
| `interfaces-mismatch` (new) | blocking entry naming `parse_seconds`, not `load_name` | pass | pass |
| `interfaces-clean` (new) | no blocking entry | pass | pass |
| `clean-decoy` | no blocking entry | pass | pass |
| `clean-simple` | no blocking entry | pass | pass |

Both hosts named the mismatch under the interfaces check, citing the
`Consumes:` and `Produces:` lines; neither flagged the `Consumes:` line that
names a function already present at the base.

Existing planning tier `tests/eval/super-plan.sh` (same-file overlap,
product fork) on the final text: Claude `claude-sonnet-5-5` 6/6, Codex
`gpt-6.1-sol` 6/6.

Not shown: a saving in planning time or tokens. On this small fixture the
candidate and the baseline cost the same within noise ($0.76 vs $0.71, about
125 s each); superpowers' upstream saving (a quarter of the time, a third of
the tokens) was measured on larger plans and is not reproduced here. One run
per cell — the counts are not rates. Execution covered one producer task per host; consumer waves were not run.
