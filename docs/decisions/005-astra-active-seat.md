# 005 — Astra in the active seat, GPT-5.6 in execution waves

Date: 2026-09-07
Status: accepted role boundary; candidate routes await qualification

## Decision

Exact `gpt-6-astra` identity selects Astra's orchestration or review profile.
Without an exact ID, current host instructions identifying the session as bare
`GPT-6` also select it, explicitly as host-family compatibility: the runtime ID
remains unknown. This does not switch the session model. Known exact IDs take
priority; unsupported IDs, unresolved conflicts, and other family variants do
not alias to Astra. A newer explicit host model-switch update supersedes old
context. Unknown effort stays unknown; quotes, catalogs, and child identities
cannot establish parent identity or different-model independence.

This compatibility rule was added on 2026-09-08 because the
[Codex 0.153.4 model catalog](https://github.com/openai/codex/blob/3d2ee51ca2d5db578f328aa75e20aa22c0197c9a/codex-rs/models-manager/models.json)
gives `gpt-6-astra` the instruction “an agent based on GPT-6.” It is a bounded
profile policy, not an API alias or a claim about every GPT-6 deployment.

Astra plans, coordinates, and reviews. Ordinary executors and escalation rungs
remain `gpt-5.6-luna`, `gpt-5.6-terra`, and `gpt-5.6-sol`. A separately approved
exception may place Astra initially or as the final explicit rung with
`astra_executor_reason: "<concrete reason>"`; that metadata never authorizes
the exception. It requires a fresh separate Astra supervisor; no terminal-Sol
promotion, reset, or automatic max applies. Same-model Astra review is fresh
context separation, not different-model independence.

The advisory drift hook uses Sol/high to assess an Astra orchestrator. This is
a candidate distinct-model advisory route, not evidence that Sol is qualified
for consequential review of Astra. A fresh Astra review is a fresh context,
not cross-model independence.

## Evidence and limits

Official model and system-card evidence lives in the plugin-local Astra
dossiers. It motivates bounded delegation and artifact verification, but does
not measure these local role pairs. The previous GPT-5.6 calibration remains
unchanged. Offline acceptance and a bounded live pilot must be reported
separately from production qualification; unsupported pairs require explicit
calibration authorization. Do not upgrade their status from aggregate vendor
benchmarks or a single passing probe.
