# Estimates — measured priors for Gate 1 and Gate 2

Read for the Decisions/Gate 1 supervisor-choice estimate and the Gate 2
wall-time and cost range. Every number here is a measured prior from a named
run, not a spec; a plan built from it still says so at Gate 2 — the estimate
is a prior, not a promise.

## Contents

- [Claude waves](#claude-waves-this-repository-2026-09-23-sonnet-5-executors-opus-55-supervisor-workflow-runner)
- [Codex native protocol](#codex-native-protocol-2026-09-22-gpt-56-executors-astrahigh-supervisor-astraxhigh-orchestrator)
- [Codex runner vs native](#codex-runner-vs-native-ship-smoke-2026-09-23-two-small-tasks-gpt-6-lunasol-executors-astrahigh-supervisor-gpt-6-sol-orchestrator)
- [How to estimate](#how-to-estimate)
- [Prices](#prices)

## Claude waves (this repository, 2026-09-23, Sonnet 5 executors, Opus 5.5 supervisor, Workflow runner)

- Executor attempt: median 2.6 min, p90 9.1 min, ≈ $1.9 per attempt (n=52).
- Verifier: 0.5 min, ≈ $0.4 (n=47).
- Supervisor: median 0.6 min, p90 1.1 min, ≈ $0.5 (n=44).
- The Opus 5.5 orchestrator seat was ≈ $143 of ≈ $293 across stage B and its
  review fixes.

## Codex native protocol (2026-09-22, GPT-5.6 executors, Astra/high supervisor, Astra/xhigh orchestrator)

- Executor medians: Sol/high 24 min (max 58 min), Terra/medium 4.8 min.
- Astra supervisor: 1.4 min.
- The orchestrator was 72% of wall time (830 sequential requests) and ≈ 63%
  of ≈ $298 total.

## Codex runner vs native (ship-smoke, 2026-09-23, two small tasks, GPT-6 Luna/Sol executors, Astra/high supervisor, `gpt-6-sol` orchestrator)

- Wall time: 2.2 min (runner) vs 6.8 min (native).
- Orchestrator cost: $0.17 (runner) vs $0.54 (native).
- Total cost: $0.75 (runner) vs $1.09 (native).
- Astra supervision was ≈ 70% of the runner wave's cost.

## How to estimate

- **Wall time** ≈ Σ over waves of (slowest task's attempts × attempt time +
  supervisor time + verifier time) + orchestrator overhead. Add one rework
  attempt for ~30% of tasks — first-try failure is common enough that a
  plan without rework margin under-estimates.
- **Cost** ≈ Σ tasks × per-attempt cost + supervisor cost × tasks +
  orchestrator cost.

The critical path for Gate 2 is waves × each wave's slowest task — waves run
sequentially, tasks within a wave run in parallel, so only the slowest task
in each wave sets that wave's wall time.

## Prices

Per-1M-token input / cached-input / output, copied from
`tests/eval/telemetry/prices.json` in the agent-skills repository
— that file is the source of truth; re-copy from it if these drift.

| Model | Input | Cached input | Output |
|---|---|---|---|
| `claude-opus-5-5` | 4 | 0.4 | 20 |
| `claude-sonnet-5` | 3 | 0.3 | 15 |
| `claude-fable-5-1` | 15 | 1.5 | 75 |
| `gpt-6-astra` | 10 | 1 | 50 |
| `gpt-6-sol` | 2 | 0.2 | 10 |
| `gpt-6-luna` | 0.1 | 0.01 | 0.5 |
