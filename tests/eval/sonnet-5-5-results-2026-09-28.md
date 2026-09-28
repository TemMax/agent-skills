# Sonnet 5.5 support measurements — 2026-09-28 UTC

Status: every value below is a **single run**, measured from an orchestrator
session on Opus 5.5 in Claude Code. Each shows what the model can do, not a
rate. **No Codex tiers were run.**

## Alias probe

- `claude -p --model claude-sonnet-5-5` reported model ID `claude-sonnet-5-5`.
- `claude -p --model sonnet` reported `claude-sonnet-5`.
- An Agent-tool spawn with `model: sonnet` reported `claude-sonnet-5`.

So Sonnet 5.5 has no alias.

## Workflow runs

Workflow `agent()` accepted `claude-sonnet-5-5` both as executor and as the
default verifier (`claude-sonnet-5-5`/`low`) in runs `wf_8ce2a0d8-bb0`,
`wf_64c0771b-bdc`, `wf_990acca3-162` and `wf_467044d6-82a`. Each run was
supervised by `claude-opus-5-5`/`high`.

## Executor results on this repository's own tasks

Sonnet 5.5 executor, Opus 5.5 supervisor, 8 tasks:

| Task | Effort | Result |
|---|---|---|
| `six-id-pins` | low | ok on the first try |
| `authorization-line` | high | ok on the first try |
| `eval-defaults-sonnet-5-5` | medium | ok on the first try |
| `dossier-wording` | medium | ok on the first try |
| `profiles-sonnet-5-5` | medium | ok on the second attempt; the first was rejected because the report did not paste a new test file's lines |
| `multi-model-sonnet-5-5` | high | failed after 2 attempts (see below) |
| `multi-model-sonnet-5-5-r2` | high | ok on the first try |
| `release-4-3` | medium | ok on the first try |

In `multi-model-sonnet-5-5` the executor correctly stopped and committed
nothing, because the plan's contract missed an existing pin (a
supervisor-cell count of exactly 2). This was a plan defect, and the recovery
task fixed it.

Totals: 7 of 8 ok, 6 of them on the first try, and 1 failure caused by the
plan.

## Live tiers

Default model `claude-sonnet-5-5`:

| Tier | Result |
|---|---|
| `tests/eval/super-plan.sh` | 6 passed, 0 failed |
| `tests/eval/seam-audit.sh` (EVAL_REPEAT 1) | 3 passed, 0 failed |
| `tests/eval/skill-navigation.sh` with `EVAL_MODEL=claude-sonnet-5-5` | 30 passed, 0 failed (`30/30`) |

## Limits

- Every result is one run; none establishes a rate.
- No Codex tiers were run.
