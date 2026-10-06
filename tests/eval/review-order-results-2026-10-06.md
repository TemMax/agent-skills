# Quiet lookup and ordered review — 2026-10-06

Candidate: orchestration **4.11.0**, code-review **1.17.0**, Claude Code and Codex.
[Machine-readable results](review-order-results-2026-10-06.json) retain exact
source hashes, final checks, every paid attempt and measured usage.

## Result

| Host | Lookup | Local review |
|---|---|---|
| Claude Code | Correct CI timeout, repository instructions read, quiet messages | Sequential instruction loading before artifact reads; both real defects found |
| Codex | Correct CI timeout, repository instructions read, quiet messages | Sequential instruction loading before artifact reads; both real defects found |

The discovery description now reaches the host before its first tool call.
Lookup communication rules sit near the beginning of the entrypoint. Review
loads its entrypoint, PROFILE, exactly one selected reviewer profile and REVIEW
in order before repository content or diff inspection. Existing identity,
calibration, PR, fix and authorization policies remain reachable and unchanged.

The scorer checks launches and successful full-body results, not just eventual
file presence. README and workflow reads count as artifacts. Parallel starts,
failed or partial reads, incorrect order and extra profiles fail. Instruction-only
discovery and git status remain allowed. Its 12 offline tests include negative
traces and positive sequential reads for both native event formats.

All relevant final plugin files match their tested snapshots. Product files and
HEAD remained unchanged; no children or outward writes ran. The fixture contains
an incorrect timeout and a removed negative-input guard despite **41 green tests**.
Both reviews found both defects. One final sample per case and host establishes
this bounded result, not a reliability rate or token-savings forecast.

## Attempts and cost

**8 native CLI calls**, **837,782 inclusive tokens** (cache included),
**$0.3523566** reported by Claude CLI. These numbers cover benchmark calls only,
not this authoring session, Codex billing or subscription quota consumption.

The initial six-call / 700K-token envelope was extended before new calls to
**eight calls / 900K tokens**, preserving the same ledger and $2 Claude cap.
Per-call timeout remained 150 seconds. There were no paid baseline repeats:
the new scorer rejects both retained postmerge baseline review traces.

Failed attempts remain in `/private/tmp/review-order-4.11.0-v1` through `v4`.
Two Claude lookups were quiet but omitted repository instructions; moving the
mandatory step before the lookup exception corrected that behavior. Codex then
narrated instruction loading before receiving the skill body; its discovery
metadata was clarified and both host lookups retested in `v5`.

The first ordered Claude review was correct, but the scorer treated an
instruction-only brace Glob as content. A regression test and deterministic
replay corrected that false positive. Original outcomes and traces are retained
alongside reconciled results; no model call was repeated for this parser fix.

## Offline checks and deployment

The complete offline suite finished with three failing tiers: release-note
format, the changed discovery description, and a stale verifier wording assertion
from the previous merge. Those checks were corrected and rerun. Final structure,
platform routing, cost discipline, communication, progressive policy-preservation,
12 ordered-evidence, 9 phase-fixture and 7 dialogue tests passed. All eight
entrypoints passed Skill Creator validation.

Final evidence: Claude review in `v3` (reconciled), Codex review in `v4`, both
lookups in `v5`. Raw logs stay under `/private/tmp/review-order-4.11.0-*`.
Installed plugins remain on Git at **4.10.0 / 1.16.0** until an authorized merge.
After merge, update both hosts from Git and check fresh normal installed loading.
