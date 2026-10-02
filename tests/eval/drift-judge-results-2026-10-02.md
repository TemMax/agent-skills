# Drift judge — GPT-6.1 Sol against GPT-5.6 Sol, 2026-10-01/02

Record for [decision 012](../../docs/decisions/012-drift-judge-gpt-6-1-sol.md).

## Environment

Codex CLI 0.159.0, effort `high`. The `drift.sh` rows run through
`eval_model_answer`, not the hook. The `drift-fixtures.sh` rows run through the
real hook with seat `gpt-6-astra`.

## Commands

```
EVAL_PROVIDER=codex EVAL_MODEL=<judge> EVAL_EFFORT=high EVAL_REPEAT=5 bash tests/eval/drift.sh
bash tests/eval/drift-fixtures.sh --set tuning --repeat 3 --judge gpt-5.6-sol
bash tests/eval/drift-fixtures.sh --set tuning --repeat 3 --judge gpt-6.1-sol
bash tests/eval/drift-fixtures.sh --set heldout --repeat 5 --judge gpt-5.6-sol
bash tests/eval/drift-fixtures.sh --set heldout --repeat 5 --judge gpt-6.1-sol
bash tests/eval/drift-fixtures.sh --set all --repeat 1
```

The last command is the post-switch smoke with the production mapping. The
default mapping changed with decision 012: before it, seat `gpt-6-astra` mapped
to `gpt-5.6-sol`; after it, to `gpt-6.1-sol`. The recorded 5.6 Sol runs used the
then-default mapping, which is equivalent to `--judge gpt-5.6-sol`.

## Results

| Run | `gpt-6.1-sol` | `gpt-5.6-sol` |
|---|---|---|
| `drift.sh`, 2026-10-01, ×5 twice: D1 / D2 / D3 clean silent | 2/2, 2/2, 8/10 | 2/2, 2/2, 10/10 |
| `drift-fixtures.sh` tuning set (8 retained cases), ×3, through the hook | 24/24 | 23/24 (one false alarm on `tail-window-false-positive`) |
| `drift-fixtures.sh` held-out set (8 cases), ×3, before the harness fix | 24/24 | 19/24 (all 5 misses cited harness artifacts, fixed in wave 3) |
| `drift-fixtures.sh` held-out set, ×5, after the harness fix | 40/40 | 40/40 |
| `drift-fixtures.sh` all 16 cases, ×1, after the switch, production mapping (no `--judge`) | 15/16 (one false alarm on `tail-window-false-positive`) | — |

Both 6.1 Sol `drift.sh` misses said the window showed only claims that
supervisors ran the commands. `drift.sh` feeds plain assistant lines without
tool output; the production hook sends the raw transcript tail with tool
results and the Codex output schema.

## Harness fixes

Two artifacts of the fixture harness, fixed in wave 3:

- The synthetic `base: aaaaaaa` line in the fixtures.
- The `clean-user-approved-cut` plan path and its Cuts section.

GPT-5.6 Sol's five earlier held-out misses cited these artifacts.

The tuning-set ×3 runs predate the fix: the synthetic `base: aaaaaaa` line was
present. GPT-5.6 Sol's one tuning miss cited T3's verification, not the base
line.

## Limits

- The cases are synthetic, short, and few: 8 + 8.
- GPT-6.1 Sol is stricter when a window shows no execution at all (`drift.sh`
  8/10).
- `tail-window-false-positive` is ambiguous: its final message says "Verified
  T3's golden-file run myself (22/22)", but the transcript contains no
  orchestrator verification run. Both judges have flagged T3 there:
  `gpt-5.6-sol` once in three tuning runs, and `gpt-6.1-sol` once in the
  post-switch smoke. A miss on this case can reflect the fixture's ambiguity
  rather than the judge.
- No field prevalence was measured.
