# 005 — Astra in the active seat, GPT-5.6 in execution waves

Date: 2026-09-07
Status: accepted role boundary; candidate routes await qualification

## Decision

Keep the existing exact active-model profile selection. Starting any of the
four skills on `gpt-6-astra` loads its matching orchestration or review profile;
it does not create a new mode or switch the session model. Unknown effort stays
unknown. Other active-model profiles keep their existing behavior.

Astra plans, coordinates, and reviews. Wave executors and escalation rungs are
restricted to `gpt-5.6-luna`, `gpt-5.6-terra`, and `gpt-5.6-sol`. A separate Astra
agent supervises their artifacts. The linter and state machine distinguish the
supervisor allowlist from the executor allowlist, including persisted state.
Exhausting Sol stops the task rather than promoting Astra to executor.

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
