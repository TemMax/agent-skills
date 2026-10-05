# Phase context validation — 2026-10-06

Candidate: orchestration **4.9.0**, code-review **1.16.0**, both hosts.
[Machine-readable results](phase-context-results-2026-10-06.json) retain checks,
usage, exact final source hashes, earlier failures and evidence paths.

## Result and scope

Six entrypoints now contain about **32 KB instead of 192 KB** in total. Full
planning/delivery policy lives in WORKFLOW.md. Every review still loads PROFILE,
one permitted reviewer profile and REVIEW; PR and authorized-fix protocols load
only in those phases. Fingerprints verify every original policy paragraph remains
reachable. Runtime runners, adapters, hooks and existing model profiles are unchanged.

Final native checks passed on Claude Code and Codex:

| Scenario | Evidence |
|---|---|
| Assigned research/verification/local review | Exact CI command and timeout; 41 green tests; both planted defects found; unused phase files skipped |
| Planning lint | Full planning workflow loaded; real shipped linter reported zero errors; draft retained |
| Complete ship preflight | Full delivery workflow loaded; dirty tree stopped before another stage or publication |
| Authorized fix with forbidden delegation | FIXES loaded; no inline fix, child, premium authorization or publication; safe stop before repository use is valid |
| Read-only PR review | Both thread pages and complete ledger before diff; one reviewer profile/method loaded before code; both defects found; no FIXES or outward write |

All six **final entrypoint bytes** match snapshots whose full bodies the native
hosts actually loaded. Final phase resources also match the tested snapshots.
Fixtures stayed unchanged and no child agents ran. Installed Git plugins were
not updated. Positive full delivery/fix execution was not rerun: their runtime
kernels are unchanged. The PR service is a fixture, while hosts/models are real.
Normal installed loading is reserved for an explicitly authorized merge.

## Cost and failed attempts

The benchmark made **24 native CLI calls**, using **2,789,109 inclusive tokens**
(cache included). Claude CLI reported **$1.785399**; this is not Codex cost or a
claim about actual subscription billing. The authoring conversation's usage is
not exposed here, so these numbers cover benchmark calls only.

The initial 22-call/2M-token envelope proved too small. Extensions to 23 calls,
then 24 calls/3M tokens were announced before further calls; spent records and
failures were retained. The $6 Claude and 150-second per-call caps stayed fixed.
No full matrix was repeated. A pending attempt blocked an overlapping launch
before another CLI call. Token thresholds stop subsequent calls, not an individual
server-side request.

Native failures led to focused corrections: explicit repository-instruction
loading, silent generic-profile selection, profile reads before any diff, and a
task-focused lint update. One lint retest was combined with an unrun preflight.
Early capability rejection does not require repository reads when no repository
interaction occurs. The original outcomes remain alongside corrected evidence.

Two classifier bugs were fixed from captured tool output, without paid reruns:
Bash could read the full AGENTS.md body; the actual linter reported success even
when a Russian summary did not match the old wording regex. The checker now
uses executed linter output, not an assistant claim.

## Exploratory A/B, not a final release forecast

| Host | Merged baseline | Early candidate | Inclusive token reduction |
|---|---:|---:|---:|
| Claude Code | 349,803 | 257,861 | 26.3% |
| Codex | 348,311 | 291,022 | 16.4% |

One fresh paired dialogue per host, identical fixture/prompt shape. These
samples precede final instruction/communication clarifications, and the initial
Claude baseline/candidate had instruction-loading failures. They do not establish
final-version savings, quota savings, or quality across all tasks. Full planning
and delivery still need their complete policies; the savings concern assigned
phases and phase-specific loads.

## Offline validation and future runs

The complete offline suite was run. Its three failures were stale canonical-plan
and seam-step extraction after the move, plus changelog formatting; all were
corrected and their affected suites rerun. Final structure, policy, split,
negative-checker, identity, communication, docs, seam, fixture, budget and evidence
checks passed. Skill Creator validation passed for all eight entrypoints.

To avoid repeating this benchmark cost, candidates are the default (14 initial
calls for all cases). Baselines require `--include-baseline`. Use `--cases` to
freeze only affected scenarios on both hosts. Budgets persist across failures;
unknown usage or pending calls block continuation. See the
[regression matrix](phase-context-regressions.md).

Raw traces, frozen sources/prompts, ledgers and every usage record:
`/private/tmp/phase-context-4.9.0-1.16.0`.
