# Estimates — measured priors for Gate 1 and Gate 2

Read for the Decisions/Gate 1 supervisor-choice estimate and the Gate 2
wall-time and cost range. Every number here is a measured prior from a named
run, not a spec; a plan built from it still says so at Gate 2 — the estimate
is a prior, not a promise.

## Contents

- [Claude waves](#claude-waves-this-repository-2026-09-23-sonnet-5-executors-opus-55-supervisor-workflow-runner)
- [Codex native protocol](#codex-native-protocol-2026-09-22-gpt-56-executors-astrahigh-supervisor-astraxhigh-orchestrator)
- [Codex runner vs native](#codex-runner-vs-native-ship-smoke-2026-09-23-two-small-tasks-gpt-6-lunasol-executors-astrahigh-supervisor-gpt-6-sol-orchestrator)
- [Mid-size Codex pilot](#mid-size-codex-pilot-2026-09-24-gpt-6-sol-orchestrator-runner)
- [How to estimate](#how-to-estimate)
- [Prices](#prices)
- [Sources](#sources)

## Claude waves (this repository, 2026-09-23, Sonnet 5 executors, Opus 5.5 supervisor, Workflow runner)

- Executor attempt: median 2.6 min, p90 9.1 min, ≈ $1.9 per attempt (n=52).
- Verifier: 0.5 min, ≈ $0.4 (n=47).
- Supervisor: median 0.6 min, p90 1.1 min, ≈ $0.5 (n=44).
- The Opus 5.5 orchestrator seat was ≈ $143 of ≈ $293 across stage B and its
  review fixes.

## Codex native protocol (2026-09-22, GPT-5.6 executors, Astra/high supervisor, Astra/xhigh orchestrator)

GPT-5.6 Sol and Terra are retired routes (new plans route to GPT-6 Sol and
Luna); these numbers are kept as the only native-protocol measurement on
record.

- Executor medians: GPT-5.6 Sol/high 24 min (max 58 min), GPT-5.6
  Terra/medium 4.8 min.
- Astra supervisor: 1.4 min.
- The orchestrator was 72% of wall time (830 sequential requests) and ≈ 63%
  of ≈ $298 total.

## Codex runner vs native (ship-smoke, 2026-09-23, two small tasks, GPT-6 Luna/Sol executors, Astra/high supervisor, `gpt-6-sol` orchestrator)

- Wall time: 2.2 min (runner) vs 6.8 min (native).
- Orchestrator cost: $0.17 (runner) vs $0.54 (native).
- Total cost: $0.75 (runner) vs $1.09 (native).
- Astra supervision was ≈ 70% of the runner wave's cost.

## Mid-size Codex pilot (2026-09-24, gpt-6-sol orchestrator, runner)

Two runs of the same 7-point feature (inventory report CLI: parse,
validate, aggregate, report, CLI, fixture + end-to-end test, README),
planned (super-plan, headless, Gate 1 choice given) and executed
(multi-model, `codex-wave-runner.mjs` per wave) by one `gpt-6-sol`/high
Codex orchestrator session, in a disposable repo.

| Run | Tasks / waves | First try | Wall — planning / execution / per wave | Cost split by role | Gate 2 estimate given | Actual |
|---|---|---|---|---|---|---|
| Standard (all `gpt-6-luna` executors, `gpt-6-sol` supervisor) | 7 tasks / 3 waves | 7/7 ok, 32 tests green | 12.2 min — ≈ 4.0 min / ≈ 8.1 min / ≈ 2.7 min | $1.14 = orchestrator $0.70 (62%) + Sol supervisor $0.41 + Luna executors $0.02 | 15–40 min, $1–4 | 12.2 min, $1.14 |
| Premium (`gpt-6-astra` supervisor, executors by routing: 4 Luna, 2 Sol) | 6 tasks / 2 waves | 6/6 ok, one task needed 3 attempts, 25 tests green | 10.2 min — ≈ 3.8 min / ≈ 6.4 min / ≈ 3.2 min | $2.99 = Astra supervisor $2.14 (72%) + orchestrator $0.55 + executors $0.29 (Sol $0.28, Luna $0.01) | 15–45 min, $3–10 | 10.2 min, $2.99 |

Both runs finished below the lower bound of their own Gate 2 range — the
priors that range was built from (derived from GPT-5.6 native runs) were
too pessimistic for GPT-6 with the runner.

The standard run's cost parts are rounded: $0.70 + $0.41 + $0.02 = $1.13 of
the reported $1.14 total, and $0.70/$1.14 ≈ 61% (displayed as 62% above from
unrounded inputs).

## How to estimate

- **Wall time** ≈ Σ over waves of (slowest task's attempts × attempt time +
  supervisor time + verifier time) + orchestrator overhead. Add one rework
  attempt for ~30% of tasks — first-try failure is common enough that a
  plan without rework margin under-estimates.
- **Cost** ≈ Σ tasks × (attempts × per-attempt cost + attempts × supervisor
  cost per attempt + attempts × verifier cost per attempt) + orchestrator
  cost. Apply the same ~30% rework-attempt margin as the wall-time formula —
  the supervisor and the verifier are paid per attempt, not once per task.
- **Codex runner waves with GPT-6 executors**: planning (≈ 4 min) happens
  before Gate 2 and is not part of the Gate 2 execution estimate; use
  ≈ 3 min per wave (2.7–3.2 in the pilot) for execution after Gate 2 as the
  central wall estimate (the Mid-size Codex pilot above), and keep the ~30%
  rework margin of the general wall-time formula on top of it. Both pilot runs
  finished below the lower bound of their own Gate 2 range — priors derived
  from GPT-5.6 native runs were too pessimistic for GPT-6 with the runner;
  the older Codex native-protocol and runner-vs-native sections above stay
  as history. Supervision dominates cost with the Astra supervisor (72%);
  with the standard Sol supervisor, the orchestrator dominates cost instead
  (62%).

The critical path for Gate 2 is the sum over waves of each wave's slowest
task — waves run sequentially, tasks within a wave run in parallel, so only
the slowest task in each wave sets that wave's wall time.

## Prices

Per-1M-token input / cached-input / output, copied from
`tests/eval/telemetry/prices.json` in the agent-skills repository
— that file is the source of truth; re-copy from it if these drift.

| Model | Input | Cached input | Output |
|---|---|---|---|
| `claude-opus-5-5` | 4 | 0.4 | 20 |
| `claude-opus-5` | 5 | 0.5 | 25 |
| `claude-sonnet-5` | 3 | 0.3 | 15 |
| `claude-haiku-4-5-20251001` | 1 | 0.1 | 5 |
| `claude-fable-5-1` | 15 | 1.5 | 75 |
| `gpt-6-astra` | 10 | 1 | 50 |
| `gpt-6-sol` | 2 | 0.2 | 10 |
| `gpt-6-luna` | 0.1 | 0.01 | 0.5 |

## Sources

Claude wave and Codex runner-vs-native numbers: PR #13's description and
`tests/eval/gpt-6-results-2026-09-23.md`. Codex native-protocol numbers
(#485): the #485 transcript analysis summarized in PR #13. Mid-size Codex
pilot numbers (2026-09-24): PR #15's description.
