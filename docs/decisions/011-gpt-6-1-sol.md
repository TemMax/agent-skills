# 011 — GPT-6.1 Sol becomes the default Codex executor and all-Luna supervisor

Date: 2026-09-30
Status: accepted

## Context

GPT-6.1 Sol (`gpt-6.1-sol`) shipped on 2026-09-29 with a 45-page addendum
system card. The model page lists $2 input and $10 output per 1M tokens, the
same as GPT-6 Sol, with a 1,050,000 context and 128,000 max output; effort
levels are `low`, `medium` (default), `high`, `xhigh` and `max`. The card
positions it as capabilities comparable to GPT-6 Astra at lower cost (p. 3).
It is an addendum and reports no coding or agentic capability benchmark, so
capability for this repository has to come from live runs.

Behavior (card, lower is better): fails to stop at an environment warning
23.5% against 64.4% for GPT-6 Sol and 17.4% for Astra (p. 15); misaligned
outcomes in realistic work environments 1.94% against 4.93% and 1.10%
(p. 19); Codex deployment simulation severity 3 or higher flags 28 against 42
for GPT-6 Sol and 27 for Astra (p. 21). Coding deception misrepresentation is
1.50% against 1.30% for GPT-6 Sol (p. 17). Codex prod safe completion for
sensitive personal data is 0.744 against 0.854 for GPT-6 Sol, the one Codex
prod row where it is lower (p. 6).

Identity probe, 2026-09-29, Codex CLI 0.159.0: the host instruction gives only
the bare family phrase "GPT-6", the same as Astra, Sol and Luna, so only the
exact ID can select a profile.

Live results, 2026-09-29, all at `gpt-6.1-sol`/`medium` on Codex CLI 0.159.0:
supervisor fixture 9/9, super-plan 6/6, skill-navigation 31/31, safety 8/8,
drift 3/3. Seam-audit 9/9, with the planted seam caught 3/3 (GPT-6 Sol 1/3 on
2026-09-24). Strict critical-review gate: clean 4/5 and 5/5, planted 10/10, PR
support 3/4. The profile-routing context cells failed only because the harness
put the runtime line in the user prompt; as developer instructions, 2/2. The
full record is
[`tests/eval/gpt-6-1-sol-results-2026-09-29.md`](../../tests/eval/gpt-6-1-sol-results-2026-09-29.md).

Live results measured 2026-09-30 after the runner and harness fixes, Codex CLI
0.159.0:

- Native Codex wave, `tests/eval/wave.sh` with `EVAL_MODEL=gpt-6.1-sol` and
  `EVAL_REPEAT=2`: `codex-native-success` pass and
  `codex-independent-must-run` pass (2/2).
- profile-routing with the fixed harness and `EVAL_MODEL=gpt-6.1-sol`: 8/8,
  context 4/4 and generic 4/4.
- ship-smoke, `tests/eval/ship-smoke.sh --mode runner`, three runs per
  supervisor, every run merge-ready first try with both tasks `ok` on
  attempt 1:

| Supervisor | Executors | Wall (min) | Total cost ($) |
|---|---|---|---|
| `gpt-6.1-sol` | `gpt-6-luna` x2 | 4.50 / 4.30 / 4.31 | 0.345 / 0.402 / 0.290 |
| `gpt-6-astra` | `gpt-6-luna` (add-guard), `gpt-6.1-sol` (add-doc) | 4.37 / 4.39 / 4.13 | 0.771 / 0.975 / 0.858 |

The GPT-6.1 Sol supervisor ran at the same wall time as Astra and was about
2.5x cheaper (mean $0.346 against $0.868). Its GPT-6.1 Sol executor passed 3/3
under Astra. Limits: two-task toy waves with correct work only; defect
detection comes from the supervisor fixture.

## Decision

Route the ordinary and difficult Codex executor, the Luna ladder rung, and
research and seam audit to `gpt-6.1-sol`. The seam audit caught the planted
seam 3/3 where GPT-6 Sol caught it 1/3, at the same price.

Make `gpt-6.1-sol` the standard supervisor of all-Luna waves. The evidence is
the supervisor fixture (9/9) plus the ship-smoke runs above, where it matched
Astra's wall time at about 2.5x lower cost. The fixture, not the toy waves,
is the evidence for defect detection.

Keep review on GPT-6 Sol. The strict gate missed on 2026-09-29 (clean 4/5 and
5/5, planted 10/10, PR support 3/4), so the review route for `gpt-6.1-sol` is
not supported, even though it ships a reviewer profile and dossier so the ID
is recognised. The context-cell failures were a harness fault and are not
counted against it.

Keep `gpt-6-sol` valid. It is retired as an executor route, but approved plans
that name it still lint and run, with lint warnings, and it remains the
lower-cost review option.

## Consequences

The routes rest on the live runs above, not on card capability numbers, which
the addendum does not provide. Review on `gpt-6.1-sol` needs a new strict-gate
run before it can be promoted. The card's weaker rows stay visible: the
sensitive-personal-data safe-completion figure above, credential-harvesting
flags that increased against GPT-6 Sol (p. 23), and longer final answers than
GPT-6 Sol (p. 10).

### The runner `.git` finding

The first attempt at the native-wave and ship-smoke evals, on 2026-09-29,
before the fixes, left every child environment-blocked on
`.git/worktrees/<name>/index.lock`, and ship-smoke's telemetry ran out of Node
heap. This was an environment fault in the runner and harness, not a model
result, and no model number was taken from that attempt. After the runner and
harness fixes, the 2026-09-30 runs above pass and Codex waves commit from
worktrees again on CLI 0.159.0.

## Rejected alternatives

**Removing `gpt-6-sol`.** Deleting the ID would make every approved plan that
names it fail lint, and it is still the review route. It stays valid with lint
warnings.

**Routing review to `gpt-6.1-sol`.** The strict gate missed; a shipped profile
is not a supported route.
