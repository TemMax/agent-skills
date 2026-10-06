# Supervisor context validation — 2026-10-06

Candidate: orchestration **4.10.0**, shared Claude/Codex supervision;
code-review remains **1.16.0**. Base: merged PR #29, `87103c4`.
[Machine-readable evidence](supervision-context-results-2026-10-06.json)
contains final source hashes, every outcome and the complete budget ledger.

## Result

Codex stores the complete diff in its verifier state, but no longer injects its
two bodies into the supervisor prompt. The supervisor still reads every hunk
from Git. Other facts, command outputs, attempts, violations and diff-command
exit/error metadata remain unchanged. The shared prompt now explicitly chooses
matching independent evidence or a fresh pipeline, with a recorded reason for
reruns. Semantic obligations and artifact integrity remain independent gates.

| Live case, both hosts | Observed result |
|---|---|
| Native positive wave | Real executor, independent code verifier and real supervisor accepted the division guard; supervisor did not repeat the test pipeline |
| Green-test semantic defect | All 39 positive tests passed; both supervisors rejected removal of negative-input validation and did not repeat the matching pipeline |
| Mismatched commit evidence | Both supervisors actually reran the exact test command, then accepted the sound candidate; captured output showed 39 passing tests |

Captured tool output proves every reviewer read the **full diff**. Product
candidates and main stayed unchanged during reviews. Final plugin sources
match all frozen snapshots. Positive cases cover native execution; the two
other cases are isolated supervisor probes, not full recovery/implementation
claims. See [the matrix](supervision-context-regressions.md) for fixture scope.

## Measured cost and limits

**8 real CLI calls**, **644,195 inclusive tokens** (cache included).
Claude CLI reported **$0.5388225**; this is not Codex cost or a subscription bill.
All calls completed and remain charged in the persistent ledger. None of the
two reserved follow-up calls was used. The authoring conversation's usage is
not available; these numbers cover benchmark calls only.

This is not an A/B savings estimate. The shared prompt grew from 13,031 to
13,275 bytes to make evidence selection explicit. Removing duplicate diff input
and avoiding unjustified command repetitions does not guarantee lower token
usage on every small task. Large diffs were already capped in the prior version;
the new projection omits bodies at every size. Legacy facts without established
candidate binding conservatively require execution, not automatic trust.

## Offline checks and retained failures

All 98 Codex state scenarios and 14 native Claude runner scenarios passed.
Wave launch, simulated workflow, structure, policy, progressive disclosure,
host split, communication and documentation checks passed. Six new offline
fixture tests cover preparation without models, mismatch isolation, semantic
green tests, native CLI arguments, tool-evidence grading and focused follow-ups
that preserve the spent budget. All six orchestration entrypoints passed Skill
Creator validation. These are targeted offline checks, not a new full-suite run.

The initial direct state test inherited unavailable signing configuration; the
hermetic test environment then isolated the intended duplicate-diff regression,
which passed after the fix. No user Git configuration was changed. Fixture path
aliases and duplicate counter instrumentation were corrected before model calls.
Codex's first positive launch rejected an unsupported benchmark argument before
any model call; its original output remains in `blocked-arguments-1`. The grader
was strengthened to require captured diff/pipeline output; earlier outcomes
remain alongside the regraded results, with no paid reruns.

Raw frozen sources, prompts, actual CLI arguments, tool streams, verification
artifacts and usage: `/private/tmp/supervision-context-4.10.0-v2`.
Installed plugins were not updated. No model routing or authorization changes
are part of this package.
