# Quiet repository bootstrap — 2026-10-06

**Draft: the Claude review communication gate remains failed.** Both scoped
changes have positive evidence: Codex startup context suppresses pre-load skill
announcements; Claude reads AGENTS.md before repository artifacts. This does not
establish that all Claude communication is quiet or that quality is unchanged.

Candidate versions: orchestration 4.11.1 and code-review 1.17.1. The
[machine-readable report](quiet-bootstrap-results-2026-10-06.json) retains source
and evidence hashes, every paid attempt, original checks and current-scorer
communication results. Original traces/results remain unchanged under `/private/tmp`.

## Initial-round live checks

| Host / case | Evidence | Repository instructions | Semantic checks | Quiet |
| --- | --- | --- | --- | --- |
| Codex lookup | v8, attempt 8 | Pass | Actual CI timeout | Pass |
| Codex local review | v6, attempt 5 | Pass | Both defects found; ordered review reads | Pass |
| Claude lookup | v6, attempt 6 | Pass | Actual CI timeout | Pass |
| Claude local review | v8, attempt 9 | Pass | Both defects found; ordered review reads | **Fail** |

Each case has one sample, not a reliability estimate. v6 instruction bodies
match the final candidate; its hooks precede the policy-only startup fallback
added for missing identity. Final hook bytes ran in v8 on both hosts. The
Codex known-identity policy output is unchanged; offline contracts cover both
hooks, missing identities and known-identity/model-change behavior.

Codex uses native candidate plugin loading in owned temporary homes. Trusted
startup hook context was observed before its first message; untrusted hooks
in v5 were skipped and that paid failure remains recorded. The disposable
automation uses the documented invocation-only hook-trust option after freezing
sources; the workspace sandbox stays enabled and user trust is unchanged.

Both final Claude SessionStart hooks returned the communication policy with
exit 0, without inventing model metadata. Nevertheless its first review message
was «Сначала нужно найти AGENTS.md и CLAUDE.md.» The failed quiet verdict remains
failed. A legitimate finding citing an AGENTS.md invariant is allowed by the
scorer; discovery/loading announcements are rejected.

The final Claude review reused frozen, current fixture evidence for 41 unit
tests and `git diff --check` instead of repeating those commands. The reviewer
still read instructions and diff, and independently found both semantic defects.

## All paid attempts

| Attempt | Run | Case | Inclusive tokens | Claude USD | Quiet with initial-round scorer |
| --- | --- | --- | ---: | ---: | --- |
| 1 | v1 | claude-new-lookup | 85,674 | 0.065253 | Fail |
| 2 | v3 | codex-new-lookup | 67,317 | — | Fail |
| 3 | v5 | codex-new-lookup | 69,723 | — | Fail |
| 4 | v6 | codex-new-lookup | 70,674 | — | Pass |
| 5 | v6 | codex-new-local-review | 220,238 | — | Pass |
| 6 | v6 | claude-new-lookup | 107,754 | 0.069126 | Pass |
| 7 | v6 | claude-new-local-review | 214,157 | 0.136857 | Fail |
| 8 | v8 | codex-new-lookup | 71,149 | — | Pass |
| 9 | v8 | claude-new-local-review | 269,646 | 0.167378 | Fail |

Total: **9 model calls, 1,176,332 inclusive tokens, $0.438615 Claude usage**.
The 1,100,000-token post-call guard was exceeded by 76,332
tokens in the final call. No further calls were launched. Limits also included
10 calls, $2 Claude usage and 150 seconds per call. Cache/input counts are
included; these are not unique tokens or a dollar estimate for Codex. Authoring
session, setup and approval-review costs are outside these measurements.

v2/v4/v7 were preparation-only; v4 failed temporary marketplace setup, and v7
caught a helper-name collision offline before any model call. A separate
disposable interactive Codex trust attempt stopped on account/workspace
initialization before any model prompt. None is reported as a product pass.

## Offline checks and release status

Before the follow-up grader fixes, the complete `bash tests/run.sh` suite passed
with exit 0. This includes
64 runtime-context contracts, 12 phase-context tests and 14 communication tests.
The machine-readable report records the retained full log hash.
`git diff --check` passed. All 26 preexisting untracked user documents and eight
installed skill bodies retain their prior hashes. Installed plugins were not
updated from the candidate.

Do not call this release-ready: correct the remaining Claude announcement and
check it through a fresh native Claude session under a new bounded test plan.
These probes do not establish token savings, reliable suppression across
repeated samples, full authoring/recovery behavior, or normal installed loading
after merge. The latter is required when an authorized merge occurs.

## Follow-up verification

A separately bounded round tested one bootstrap-wording change in both native
hosts: **two calls / 600,000 inclusive-token guard / $1 Claude / 150 seconds per
call**. Existing attempt accounting was copied into the second prepared run,
not reset. The earlier nine paid attempts remain in this report.

| Host | Trace | Review order with corrected scorer | Both defects | Quiet |
| --- | --- | --- | --- | --- |
| Claude | v9, attempt 10 | Pass | Pass | **Fail** |
| Codex | v11, attempt 11 | Pass | Pass | Pass |

Claude's first message was «Сначала читаю инструкции репозитория.» Its native
session history contains a rendered `hook_additional_context` system reminder
with the startup policy, before the first assistant response. This proves
context delivery; it does not prove obedience. See the
[documented hook context mechanism](https://code.claude.com/docs/en/hooks#add-context-for-claude).

The wording experiment was **reverted** after its Claude failure. The plugin
candidate matches the original PR snapshot; only evidence/grader corrections
are retained from this follow-up. Codex v11 tests that discarded wording
experiment, not a newly shipped instruction body. Original Codex candidate
checks remain the v6/v8 cases above. Installed plugins remain unchanged.

Two scorer defects were corrected using failing-then-passing regression tests:
`{AGENTS.md,CLAUDE.md}` discovery no longer counts as artifact reading (mixed
patterns including README still fail), and English `read` no longer matches
README while Russian «читаю инструкции» is now rejected. English past-tense
loading announcements also retain their rejection. Claude's original
outcomes are preserved. A separate corrected replay removes the false order
failure while retaining its genuine quiet failure. A final replay of both follow-up traces uses the final scorer, including the
past-tense refinement made after live runs; native freezes and original outputs
remain unchanged. Original-round quiet verdicts remain unchanged too.

Final affected tests passed: communication (15) and review-order evidence (13).
The phase driver suite (12) also passed after the discovery-parser correction;
the final regex refinement has its own communication tests. Disclosure, routing
(143) and runtime-context (64) contracts passed. The complete unrelated offline
suite was not repeated. v10 was preparation-only before the final regex fix;
it incurred no model call.

Follow-up usage: **465,097 inclusive tokens, $0.146743 Claude**,
with no limit overshoot. Cumulative native validation: **11 calls /
1,641,429 inclusive tokens / $0.585358 Claude**.
The accounting exclusions described above still apply.

The PR remains a draft. A next architectural experiment can test automatic,
bounded repository-instruction delivery so discovery is not a separate model
action. That approach is not implemented or verified here. Further wording
retries are not justified by this round; no additional live calls were made.
