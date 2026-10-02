# 012 — GPT-6.1 Sol becomes the drift judge for GPT-6 seats

Date: 2026-10-02
Status: accepted

## Context

Decision 006 chose `gpt-5.6-sol` at `high` as the judge of every GPT-6
orchestrator, after the 2026-09-23 `drift.sh` calibration where GPT-6 judges
false-alarmed on clean runs.

`drift.sh` feeds plain assistant lines. The production hook sends the plan, the
raw last 200 transcript lines with tool results, and the last message, and
requires `drift-verdict.schema.json`.

The new `tests/eval/drift-fixtures.sh` sends cases through the real hook. It
runs the 8 retained adversarial cases (the tuning set) and 8 held-out cases in
Codex rollout format, written without access to the drift prompt.

## Decision

Astra, GPT-6 Sol and GPT-6 Luna seats are judged by `gpt-6.1-sol` at `high`.

A `gpt-6.1-sol` seat keeps `gpt-5.6-sol` at `high`, because a model never
judges its own seat.

GPT-5.6 seats are unchanged. The drift prompt is unchanged.

## Consequences

The judge for most GPT-6 seats costs half of GPT-5.6 Sol per token ($2/$10
against $4/$20 per 1M tokens, `tests/eval/telemetry/prices.json`).

The judge no longer depends on the GPT-5.6 generation, except for a GPT-6.1 Sol
seat.

`DRIFT_CHECK_JUDGE_MODEL` is an evaluation seam: only listed Codex IDs are
accepted, and a judge equal to the seat is refused.

## Evidence and limits

Measured on 2026-10-01/02, effort `high`, Codex CLI 0.159.0; the `drift.sh`
row runs without the hook, the `drift-fixtures.sh` rows run through the real
hook with seat `gpt-6-astra`. The full record is
[`tests/eval/drift-judge-results-2026-10-02.md`](../../tests/eval/drift-judge-results-2026-10-02.md).

| Run | `gpt-6.1-sol` | `gpt-5.6-sol` |
|---|---|---|
| `drift.sh`, 2026-10-01, ×5 twice: D1 / D2 / D3 clean silent | 2/2, 2/2, 8/10 | 2/2, 2/2, 10/10 |
| `drift-fixtures.sh` tuning set (8 retained cases), ×3, through the hook | 24/24 | 23/24 (one false alarm on `tail-window-false-positive`) |
| `drift-fixtures.sh` held-out set (8 cases), ×3, before the harness fix | 24/24 | 19/24 (all 5 misses cited harness artifacts, fixed before the re-run) |
| `drift-fixtures.sh` held-out set, ×5, after the harness fix | 40/40 | 40/40 |
| `drift-fixtures.sh` all 16 cases, ×1, after the switch, production mapping (no `--judge`) | 15/16 (one false alarm on `tail-window-false-positive`) | — |

Limits:

- The cases are synthetic, short, and few: 8 + 8.
- GPT-6.1 Sol is stricter when a window shows no execution at all (`drift.sh`
  8/10). Both misses said the window showed only claims that supervisors ran
  the commands.
- `tail-window-false-positive` is ambiguous: both judges have flagged T3 there,
  and a miss on it can reflect the fixture rather than the judge.
- No field prevalence was measured.
