# 006 — GPT-6 Sol and Luna, and the withdrawal of the bare GPT-6 rule

Date: 2026-09-23
Status: accepted role boundary; candidate routes await qualification. The
"fixed Astra/high supervisor" rule below (also at the "none of it authorizes
skipping the fixed Astra/high supervisor" line) is superseded, as of
2026-09-24, by [007](007-premium-models-and-standard-supervisors.md): a wave
whose executors and ladder rungs are all `gpt-6-luna` may use the standard
`gpt-6-sol` supervisor instead of the premium, fixed `gpt-6-astra` one.

## Decision

Exact `gpt-6-sol` and exact `gpt-6-luna` identity each select that model's own
orchestration or review profile, per their exact-ID guards in
`orchestrator-gpt-6-sol.md`, `orchestrator-gpt-6-luna.md`,
`reviewer-gpt-6-sol.md`, and `reviewer-gpt-6-luna.md`. The bare `GPT-6`
compatibility rule that [005](005-astra-active-seat.md) added for Astra is
withdrawn: Codex CLI 0.155.1 gives Astra, Sol, and Luna the identical host
instruction "You are Codex, an agent based on GPT-6" (verified 2026-09-23),
so that phrase cannot distinguish among the three and no longer selects any
one of them by compatibility. Without an exact ID, sessions load the generic
profile. Known exact IDs still take priority; unsupported IDs, unresolved
conflicts, and other family variants do not alias to any GPT-6 profile.

Codex routing for new plans moves from the GPT-5.6 executor tiers to
`gpt-6-sol` and `gpt-6-luna` executors, keeping the fixed, separate
`gpt-6-astra` supervisor at explicit `high` effort from shared Codex routing.
GPT-5.6 IDs are no longer chosen for new plans; an already-approved plan
carrying GPT-5.6 provider/model/effort fields still runs to completion under
the existing rule that approval governs execution.

Drift-hook judge pairing does not move with the same family: every GPT-6
orchestrator — Astra, Sol, and Luna — is judged by `gpt-5.6-sol` at `high`.
The 2026-09-23 calibration (Codex CLI 0.155.1, `tests/eval/drift.sh`) showed
every GPT-6 model raising false drift alarms on a clean run, while
`gpt-5.6-sol` at `high` stayed silent 5/5 (and 7/7 on 2026-09-04). Staying
silent on a clean run: `gpt-6-sol` high 0/5; `gpt-6-astra` high 1/3;
`gpt-6-luna` high 3/5 and medium 5/8 across two runs; `gpt-5.6-sol` high 5/5.
All judges caught the real drift cases. This is an internal advisory role
only; it does not return GPT-5.6 to executor routing, and none of it
authorizes skipping the fixed Astra/high supervisor.

## Evidence and limits

Official evidence lives in the plugin-local Sol and Luna dossiers
(`gpt-6-sol-dossier.md`, `gpt-6-luna-dossier.md`,
`gpt-6-sol-reviewer-dossier.md`, `gpt-6-luna-reviewer-dossier.md`), sourced
from the GPT-6 Astra System Card's Appendix A, "GPT-6 Sol, GPT-6 Luna" (pp.
119–155), and each model's own reference and model page. This evidence
motivates bounded delegation and artifact verification; it does not measure
this plugin's orchestrator, executor, supervisor, drift-judge, or reviewer
role pairings for Sol or Luna. No local calibration run exists yet for either
model in any of these roles: no wave, no supervisor pairing, no drift-hook
verdict, and no consequential-review role have been tested. Do not upgrade
their status from System Card or third-party capability benchmarks, or from a
single passing probe.
