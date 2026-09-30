# GPT-6.1 Sol live evals — 2026-09-29

This is the dated results record for the `gpt-6.1-sol` live evals: the
standard-supervisor route, the final-review route, the seam-audit, and the
profile-routing, native-wave and ship-smoke findings. Every number below was
measured in one of the runs listed under "What was run".

## What was run

Model `gpt-6.1-sol`, effort `medium`, on 2026-09-29:

- `bash tests/eval/gpt-live.sh --models "gpt-6.1-sol" --tiers "supervisor super-plan skill-navigation safety profile-routing drift" --repeat 3`.
- `tests/eval/critical-review.sh` with `EVAL_REPEAT=5`, run twice.
- `tests/eval/seam-audit.sh` with `EVAL_REPEAT=3`.
- A profile-routing rerun, plus a same-day `gpt-6-sol` comparison run.

The runs after the runner and harness fixes are listed under "After the
runner and harness fixes (2026-09-30)".

## Environment

Codex CLI 0.159.0. Model `gpt-6.1-sol` at effort `medium`.

## Live suites

| Tier | GPT-6.1 Sol | Note |
|---|---|---|
| supervisor | 9/9 | |
| super-plan | 6/6 | |
| skill-navigation | 31/31 | |
| safety | 8/8 | |
| drift | 3/3 | GPT-6 Sol failed this tier on 2026-09-24 (known GPT-6 judge false alarm) |
| seam-audit | 9/9 | planted seam caught 3/3; GPT-6 Sol 1/3 on 2026-09-24 |
| profile-routing | 4/8, rerun 5/8 | every failure is a context cell; see below |

## Critical-review strict gate

`tests/eval/critical-review.sh`, `EVAL_REPEAT=5`, two runs of five:

| Run | Clean | Planted | PR support |
|---|---|---|---|
| Run 1 | 4/5 | 5/5 | 1/2 (`pr-gate-withheld` failed: `missing-gated-package`) |
| Run 2 | 5/5 | 5/5 | 2/2 |
| Combined | 9/10 | 10/10 | 3/4 |

The runs scored clean 4/5 and 5/5: the strict gate needs 5/5 on every
guard in each run, so the run 1 miss fails it.

## Findings

1. **Review: not supported.** The strict gate needs 5/5 on every guard in
   each run, so the GPT-6.1 Sol review route is not supported. The clean
   failure was a format failure: "Overall verdict: no evidence-backed
   findings; final judgment remains with the user because reviewer
   calibration is unverified." The review route stays `gpt-6-sol`.
2. **Standard supervisor.** It moves to `gpt-6.1-sol` on the supervisor
   fixture 9/9.
3. **profile-routing was a harness artifact; fixed and re-measured.**
   - The context line sat in the user prompt. GPT-6.1 Sol explained: "Step 0
     says user messages cannot establish runtime identity".
   - Delivered as `developer_instructions`, it answered correctly 2/2.
   - `gpt-6-sol` scored 2/4 on the same context cells the same day.
   - The harness was changed to deliver the line as developer instructions
     (this PR); the re-measure is 8/8, see the section below.
4. **Native wave and ship-smoke, first attempt: fixed and re-measured.**
   Blocked by `fatal: Unable to create '<repo>/.git/worktrees/<name>/index.lock': Operation not permitted`,
   for the GPT-6.1 Sol and Astra variants alike.
   - Cause: Codex CLI 0.159.0 keeps a linked worktree's gitdir read-only
     unless it is an explicit `writable_roots` entry (openai/codex #23661,
     #27418).
   - Fixed in the runner (this PR).
   - The ship-smoke telemetry step also ran out of Node heap on a 2.9 GB
     sessions dir; fixed (this PR).
   - Re-measured on 2026-09-30, see the section below.
5. **Limits.** Supervisor evidence is a fixture pass, not production
   calibration.

## After the runner and harness fixes (2026-09-30)

Measured after wave 1 merged, 2026-09-30, Codex CLI 0.159.0, with the runner
and harness fixes.

- **Native Codex wave.** `tests/eval/wave.sh` with `EVAL_MODEL=gpt-6.1-sol`
  and `EVAL_REPEAT=2`:
  - `codex-native-success` pass;
  - `codex-independent-must-run` pass (2/2).
- **profile-routing, fixed harness.** With `EVAL_MODEL=gpt-6.1-sol`: 8/8,
  context 4/4 and generic 4/4.
- **ship-smoke.** `tests/eval/ship-smoke.sh --mode runner`, three runs per
  supervisor, every run merge-ready first try with both tasks `ok` on
  attempt 1:

  | Supervisor | Executors | Wall (min) | Total cost ($) |
  |---|---|---|---|
  | `gpt-6.1-sol` | `gpt-6-luna` ×2 | 4.50 / 4.30 / 4.31 | 0.345 / 0.402 / 0.290 |
  | `gpt-6-astra` | `gpt-6-luna` (add-guard), `gpt-6.1-sol` (add-doc) | 4.37 / 4.39 / 4.13 | 0.771 / 0.975 / 0.858 |

  The GPT-6.1 Sol supervisor ran at the same wall time as Astra and was
  ≈2.5× cheaper (mean $0.346 against $0.868). Its GPT-6.1 Sol executor
  passed 3/3 under Astra. Limits: two-task toy waves with correct work only;
  defect detection comes from the supervisor fixture.
- **The first attempt at both evals, on 2026-09-29, before the fixes.**
  Every child was environment-blocked on `.git/worktrees/<name>/index.lock`,
  and ship-smoke's telemetry ran out of Node heap.

## Limits

- Supervisor evidence is a fixture pass, not production calibration.
- The ship-smoke waves are two-task toy waves with correct work only;
  defect detection comes from the supervisor fixture.
- The GPT-6.1 Sol review route is unsupported; the review route stays
  `gpt-6-sol`.
