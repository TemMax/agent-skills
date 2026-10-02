# Drift judge — GPT-6.1 Sol against GPT-5.6 Sol, 2026-10-01/02

Record for [decision 012](../../docs/decisions/012-drift-judge-gpt-6-1-sol.md).

## Environment

Codex CLI 0.159.0, effort `high`, seat `gpt-6-astra`.

## Commands

```
EVAL_PROVIDER=codex EVAL_MODEL=<judge> EVAL_EFFORT=high EVAL_REPEAT=5 bash tests/eval/drift.sh
bash tests/eval/drift-fixtures.sh --set tuning --repeat 3 [--judge gpt-6.1-sol]
bash tests/eval/drift-fixtures.sh --set heldout --repeat 5 [--judge gpt-6.1-sol]
```

## Results

| Run | `gpt-6.1-sol` | `gpt-5.6-sol` |
|---|---|---|
| `drift.sh`, 2026-10-01, ×5 twice: D1 / D2 / D3 clean silent | 2/2, 2/2, 8/10 | 2/2, 2/2, 10/10 |
| `drift-fixtures.sh` tuning set (8 retained cases), ×3, through the hook | 24/24 | 23/24 (one false alarm on `tail-window-false-positive`) |
| `drift-fixtures.sh` held-out set (8 cases), ×3, before the harness fix | 24/24 | 19/24 (all 5 misses cited harness artifacts, fixed in wave 3) |
| `drift-fixtures.sh` held-out set, ×5, after the harness fix | 40/40 | 40/40 |

Both 6.1 Sol `drift.sh` misses said the window showed only claims that
supervisors ran the commands. `drift.sh` feeds plain assistant lines without
tool output; the production hook sends the raw transcript tail with tool
results and the Codex output schema.

## Harness fixes

Two artifacts of the fixture harness, fixed in wave 3:

- The synthetic `base: aaaaaaa` line in the fixtures.
- The `clean-user-approved-cut` plan path and its Cuts section.

GPT-5.6 Sol's five earlier held-out misses cited these artifacts.

## Limits

- The cases are synthetic, short, and few: 8 + 8.
- GPT-6.1 Sol is stricter when a window shows no execution at all (`drift.sh`
  8/10).
- No field prevalence was measured.
