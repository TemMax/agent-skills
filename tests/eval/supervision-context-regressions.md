# Supervisor context regressions

Candidate: orchestration 4.10.0 on both hosts; code-review remains 1.16.0.

The Codex prompt projection removes both stored diff bodies at every size. The
state retains them in full, and the supervisor still reads every hunk from Git.
All other verifier facts, including command outputs, attempts, violations,
candidate binding and diff-command failure metadata, remain available.
The shared prompt chooses between matching independent evidence and a fresh
ordered pipeline. Green evidence never substitutes for semantic review.

| Case on each host | Required observation |
|---|---|
| Positive native wave | Real executor, independent code verifier and real supervisor accept the guard; supervisor does not repeat the test pipeline |
| Semantic candidate | All 39 positive tests are green, but removal of the BASE negative-input guard is rejected; matching pipeline is not repeated |
| Mismatched evidence | Facts carry a wrong commit; supervisor actually reruns the test pipeline, preserves the candidate and accepts the sound work |

Positive cases exercise the complete native wave path. The other two are isolated
supervisor probes with frozen, coordinator-created candidates and independently
executed facts, not full execution/recovery claims. Claude's isolated probes use
facts from the shipped independent code verifier through the Codex state helper;
the positive Claude case exercises its own native verifier/transport. The mismatch
exists only in the prompt fixture; it does not corrupt the stored native receipt.
No changes to plugin discovery, installed plugins, model routing or execution
authorization are part of this package.

Preparation freezes source hashes, versions, plans, candidate commits, prompts
and expected outcomes before any model launch:

```bash
python3 tests/eval/supervision-context-live.py --out /private/tmp/supervision-4.10.0 --prepare-only
python3 tests/eval/supervision-context-live.py --out /private/tmp/supervision-4.10.0 --run claude-positive
```

Run the other named host/cases sequentially. There are eight planned model calls:
two per positive wave, one per isolated probe. The persistent aggregate ledger
allows at most ten calls (two focused follow-ups), 1.2M inclusive tokens and $4
of Claude CLI-reported cost. Pending or unknown usage blocks continuation; failed
calls consume the budget. Token usage is measured after a call and stops later
calls, not the current server-side request. Each real CLI is limited to 150
seconds; the native parent gets 360 seconds for its two children and cleanup.
Source amendments require a fresh affected fixture, never editing a tested
snapshot. Keep earlier failures and the original ledger when following up.
Use `--cases codex-semantic` to prepare just an affected case. For a fresh
follow-up directory, pass `--budget-file <original budget.json>`; preparation
requires that ledger to exist and leaves its spent/failed records unchanged.

The transparent adapter retains actual CLI arguments, stdin, tool streams,
completion state and usage. Claude streaming is converted back to the native
runner's JSON envelope after capture. Codex JSONL is forwarded unchanged.
Tests record actual pipeline executions outside product files. No stub models,
executor-provided evidence or assistant narration establish the live pass.
This matrix is not an A/B token-savings estimate.
