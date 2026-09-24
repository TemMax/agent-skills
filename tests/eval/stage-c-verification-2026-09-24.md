# Stage C verification — 2026-09-24

This is the dated verification record for the stage C plan-quality/model-choice
wave: the `gpt-6-sol` standard-supervisor and final-review routes, the
Codex wave runner's macOS nested-sandbox requirement, and the super-plan
Gate 2 / seam-audit rules. Numbers below are the wave's measured facts; no
number appears here that was not measured in one of the runs listed under
"What was run".

## What was run

- `tests/eval/gpt-live.sh --models "gpt-6-sol gpt-6-luna" --jobs 8` and the
  individual tiers it drives (`supervisor.sh`, `drift.sh`, `super-plan.sh`,
  `skill-navigation.sh`, `safety.sh`, `profile-routing.sh`, `wave.sh`), each
  with `EVAL_PROVIDER=codex EVAL_MODEL=gpt-6-sol` and
  `EVAL_PROVIDER=codex EVAL_MODEL=gpt-6-luna`, `EVAL_REPEAT=3`.
- The same Claude tiers (`supervisor.sh`, `drift.sh`, `super-plan.sh`,
  `skill-navigation.sh`, `wave.sh`) at each tier's own default `EVAL_MODEL`
  (`claude-haiku-4-5-20251001` for `supervisor.sh`/`drift.sh`/`wave.sh`,
  `claude-opus-5-5` for `skill-navigation.sh`,
  `claude-sonnet-5` for `super-plan.sh`/`seam-audit.sh`), `EVAL_REPEAT=3`.
- `tests/eval/critical-review.sh` with `EVAL_MODEL=gpt-6-sol`, strict review
  gate, run twice.
- `tests/eval/seam-audit.sh`, `EVAL_REPEAT=3`, once with
  `SEAM_SKILL_ROOT` pointed at the pre-stage-C skill checkout `0de65ab`
  ("before") and once at this wave's own checkout ("after"), for both
  `claude-sonnet-5` and `gpt-6-sol`.
- `tests/eval/ship-smoke.sh --mode runner`, three runs each with
  `--supervisor gpt-6-sol` and `--supervisor gpt-6-astra`.
- `tests/lib/codex-wave-runner.test.mjs` (offline, via
  `CODEX_WAVE_RUNNER_SANDBOX_PROBE`) for the nested-sandbox probe.
- `tests/contracts/critical-review-rules.test.sh` (offline pin check).

## Environment

Codex CLI 0.155.1. Claude tiers ran at each tier's own default eval model
(see "What was run"); Codex tiers ran `gpt-6-sol` and `gpt-6-luna` at
effort `medium` unless a table below states otherwise.

## Live suites

| Tier | Claude (`EVAL_REPEAT=3`) | GPT-6 Sol (×3) | GPT-6 Luna (×3) |
|---|---|---|---|
| skill-navigation | 30/30 | 31/31 | 31/31 |
| super-plan | 6/6 | 6/6 | 6/6 |
| supervisor | 9/9 | 9/9 | 9/9 |
| wave | 3/3 | 2/2 | 2/2 |
| safety | — | 8/8 | 8/8 |
| profile-routing | — | 6/8 (A/B: pre-C 5/8, PR head 7/8 — pre-existing) | — |
| drift | 2/3 (repeat ×5: 3/3 on PR head, 2/3 on pre-C skill — noise) | fails (known GPT-6 judge false alarm) | fails (known GPT-6 judge false alarm) |

## Sol reviewer

`critical-review` strict review gate, `gpt-6-sol`, two independent runs on
2026-09-24:

| Run | Clean | Planted |
|---|---|---|
| Run 1 | 5/5 | 5/5 |
| Run 2 | 5/5 | 5/5 |
| Combined | 10/10 | 10/10 |

PR support gate: 3/4 (one `pr-gate-withheld` miss: missing confirmation
gate). GPT-6 Luna review is unchanged from stage A: clean 0/3.

## Sol vs Astra supervisor

`ship-smoke.sh --mode runner`, orchestrator launched outside the Codex
sandbox, three runs each:

| Supervisor | Merge-ready first try | Run 1 wall (min) | Run 2 wall (min) | Run 3 wall (min) | Run 1 cost ($) | Run 2 cost ($) | Run 3 cost ($) |
|---|---|---|---|---|---|---|---|
| `gpt-6-sol` | 3/3 | 2.44 | 2.27 | 2.14 | 0.238 | 0.252 | 0.200 |
| `gpt-6-astra` | 3/3 | 2.17 | 2.39 | 2.62 | 0.753 | 0.698 | 0.768 |

Sol is ≈3.2× cheaper than Astra at the same wall time. Standard-supervisor
fixture pass rate: `gpt-6-sol` 9/9 on 2026-09-23 (twice) and 9/9 on
2026-09-24 (×3).

Limits: two-task toy waves with correct work only; defect detection comes
from the supervisor fixture, not from these ship-smoke waves.

## Seam-audit, before/after

`tests/eval/seam-audit.sh`, ×3 per model, before = skill at `0de65ab`,
after = this wave's own checkout (before the same-task seam rule and the
Gate 2 dollar-range rule existed):

| Rule | Before | After |
|---|---|---|
| Gate 2 names critical path, duration, and "prior" | 0/6 | 6/6 |
| Gate 2 states cost as a `$` figure | 0/6 | 4/6 |
| Seam caught — Claude Sonnet 5 | 3/3 | 3/3 |
| Seam caught — GPT-6 Sol | 1/3 | 1/3 |

The Gate 2 `$`-figure rule's failures (0/6 and 2/6 of the 4/6 after-run) are
combined across both models, ×3 each: the failures were Claude twice
writing "low cost" / "a few dollars" and one Claude run writing "I did not
consult estimates.md". GPT-6 Sol noticed the `format_row`/`parse_rows` seam
in both before and after runs but split the helper change into a separate
task from `format_row`'s own change (once into a later wave, which leaves
that wave's own merge red) — this is why the same-task seam rule (below,
"After the fixes") was added.

## Nested-sandbox finding

`codex-wave-runner.mjs`, launched from inside a Codex `workspace-write`
sandbox, cannot run its own `codex exec` children on macOS — Seatbelt
cannot nest a second sandbox profile inside the first. Measured failure
strings:

- The child `codex exec` fails to start:
  `failed to initialize in-process app-server client: Operation not
  permitted`
- With `~/.codex` granted as a writable root, its shell commands fail
  instead:
  `sandbox-exec: sandbox_apply: Operation not permitted`

Launched outside the Codex sandbox (an escalated command with the host's
normal filesystem and network access), the runner works and its children
keep their own sandboxes uncontested.

Commit history:

- `12041b0` (2026-09-23 23:25) — `ship-smoke.sh` scoped the orchestrator's
  own sandbox to `workspace-write`.
- `aa57d94` (2026-09-23, earlier than `12041b0`) — `ship-smoke.sh` had run
  the orchestrator with `danger-full-access`; the PR #13 measurement
  (ship-smoke-2, 21:48) used that `danger-full-access` configuration, so
  the `workspace-write` configuration introduced by `12041b0` was never
  exercised live before this record.
- `0330587` (2026-09-24 17:27) — `codex-wave-runner.mjs` gained a start-up
  probe for nested seatbelt sandboxing; when blocked, it now stops before
  launching any child with error `nested-sandbox`, exit code 2, instead of
  letting every task fail one by one.
- `6dba6bc` (2026-09-24 17:32) — `ship-smoke.sh` moved the orchestrator's
  own launch from `workspace-write` to `--sandbox danger-full-access` (safe
  here because the orchestrator only ever operates inside the disposable
  fixture repo the script builds under `mktemp`), and its prompt now names
  this repository's own skill by absolute path instead of letting the
  orchestrator read an installed-plugin copy.

## Limitations

- **Toy waves.** The ship-smoke supervisor comparison above is two-task toy
  waves with correct work only; it does not exercise defect detection.
  Defect detection evidence comes from the supervisor fixture (9/9 counts
  above), not from these waves.
- **Fixture-based defect detection.** All defect-catching evidence in this
  record (supervisor fixture, critical-review strict gate, seam-audit) is
  fixture-based: a fixed, known defect, not a sample of real-world defects.
- **ship-smoke read installed-plugin skills in these runs.** In the runs
  behind the "Sol vs Astra supervisor" table above, the Codex orchestrator
  loaded the multi-model skill from the installed plugin
  (`~/.codex/plugins/cache/temmax/orchestration/2.8.1/`), not from this
  repository. Fixed afterward; see "After the fixes".
- **Drift noise.** Claude drift was 2/3 in the `EVAL_REPEAT=3` run; a
  repeat at `EVAL_REPEAT=5` gave 3/3 on the PR head and 2/3 on the pre-C
  skill, consistent with noise rather than a regression. GPT-6 Sol and
  Luna drift both failed (a known GPT-6 judge false alarm on a clean
  transcript, not a missed real drift case).
- **Profile-routing noise.** GPT-6 Sol profile-routing was 6/8; an A/B
  check gave 5/8 on the pre-C skill and 7/8 on the PR head, consistent with
  a pre-existing issue rather than a regression introduced by this wave.

## Decisions taken

- The standard `gpt-6-sol` supervisor of all-`gpt-6-luna` waves moves from
  a policy decision to **measured**: the fixture and ship-smoke counts
  above are stated wherever this route is claimed.
- The `gpt-6-sol` final-review route moves from uncalibrated to
  **measured-supported**: the strict-gate and PR-support counts above are
  stated wherever this route is used, with the PR-support caveat.
- GPT-6 Luna review stays unsupported (clean 0/3).
- The ship-smoke nested-sandbox failure, the same-task seam rule, and the
  Gate 2 dollar-range rule are fixed in this wave series; see "After the
  fixes" for the re-measured facts.

## After the fixes

Additional measured facts after super-plan gained the same-task seam rule
and the Gate 2 dollar-range rule, after `ship-smoke.sh` was fixed to launch
the orchestrator with `danger-full-access` and read this repository's own
skill, and after `codex-wave-runner.mjs` gained the nested-sandbox probe.

### Seam-audit re-run

`tests/eval/seam-audit.sh` re-run ×3 after super-plan gained the same-task
seam rule and the dollar-range Gate 2 rule:

| Metric | Claude Sonnet 5 | GPT-6 Sol |
|---|---|---|
| Seam caught | 3/3 | 3/3 (was 1/3) |
| Lint-clean | 3/3 | 3/3 |
| Gate 2 (critical path, duration, "prior") | 3/3 | 3/3 |

Cost as a `$` figure (combined across both models, ×3 each): before this
fix 0/6, first after-run 4/6 (2 misses), second after-run 6/6. Gate 2 texts
citing `estimates.md`: 5/6 in the second after-run.

### Fixed ship-smoke

One run each, orchestrator launched with `danger-full-access` and reading
this repository's own skill:

| Supervisor | Result | Wall (min) | Cost ($) | Skills | Rework |
|---|---|---|---|---|---|
| `gpt-6-sol` | pass | 3.64 | 0.346 | repo | 1 |
| `gpt-6-astra` | pass | 2.88 | 0.765 | repo | 0 |

The `gpt-6-sol` run's one rework: the supervisor correctly rejected an
add-doc attempt whose executor had committed nothing (`docs/NOTE.md`
missing); the second attempt passed. The `gpt-6-astra` run had no rework.
Both runs' `skills` column reads `repo` — the fix confirmed the
orchestrator reads this repository's own skill copy, not the installed
plugin, on both supervisor routes.

### Runner nested-sandbox stop

`codex-wave-runner.mjs` now probes for a nested seatbelt sandbox at start
and, when blocked, stops before launching any child with error
`nested-sandbox`, exit code 2 (verified offline via
`CODEX_WAVE_RUNNER_SANDBOX_PROBE=fail` in `tests/lib/codex-wave-runner.test.mjs`).
The live runs in this record — both the "Sol vs Astra supervisor" table and
the "Fixed ship-smoke" table above — launched the runner outside the Codex
sandbox and completed without hitting this stop.
