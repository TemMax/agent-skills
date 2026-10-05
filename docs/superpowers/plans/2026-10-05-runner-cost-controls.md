# Runner cost controls implementation plan

> Execute inline with superpowers:executing-plans. The user approved implementation
> after the session2 analysis; no per-task delegation or repeated approval gates.

**Goal:** Remove Claude's verifier-model calls, safely reuse unchanged deterministic
pipelines, and enforce explicit per-task limits without changing existing routes.

**Architecture:** Keep the shipped Workflow as the Claude escalation policy. A
Node adapter supplies fresh CLI children and a deterministic verification callback.
Share an artifact-bound pipeline verifier with the Codex helper. Existing Workflow
hosts retain their agent-based verification fallback.

**Spec:** `docs/analysis/2026-10-05-session2-cost.md`, next-stage items 1–5.

**Constraints:** No production model calls in tests. Preserve ordered whole-pipeline
retries in fresh checkouts, environment-block and unsatisfiable precedence, supported
model pairings and old plan compatibility. No credential-file reads. Reuse is opt-in:
every command declares `cache: "artifact"`; red results never enter the cache.
Changing head, branch, base, contract, environment or linked-file metadata invalidates
the entire pipeline. Commands depending on time/network/external mutable state are
not cacheable. Default attempt caps remain unchanged; plans may lower them.

**Review focus:** Cache poisoning/mismatched artifacts; generated prerequisites and
tests that heal on the second run; failed/malformed CLI children; timeout process
cleanup; budget exhaustion after a rejection or transport failure.

## Task 1: deterministic pipeline and cache binding

- [x] Add real disposable-repository tests for ordered retries, same-artifact reuse,
  invalidation, red-result non-reuse and opt-in enforcement; observe failures.
- [x] Create `references/mechanical-verify.mjs` exporting `verifyPipeline(options)`
  and `verifyBranch(options)`; output bounded facts and store full logs by path.
- [x] Integrate pipeline reuse into `codex-wave-state.mjs`, preserving legacy facts
  validation and adding optional binding metadata. Run focused helper tests.

## Task 2: Claude CLI runner and configurable limits

- [x] Add simulator tests for deterministic callback/fallback and budget bounds;
  add native-runner tests using a fake CLI and actual Git worktrees.
- [x] Create `references/claude-wave-runner.mjs`, reusing the shipped workflow policy
  and launcher's linted input. Default three concurrent children, fresh CLI sessions,
  limited built-in tools, no inherited parent conversation, timeout and usage logs.
- [x] Support optional wave `limits.max_attempts` (1–6) and
  `limits.max_model_calls` (1–24), counted per task including failed CLI calls.
  Enforce the same launch limits in the Codex driver; malformed limits fail before
  worktrees or children. Preserve legacy defaults.

## Task 3: routing, compatibility and verification

- [x] Update Claude adapter to use the native runner by default; document Workflow
  fallback, cache opt-in/invalidations, bounded summaries and per-task limits.
- [x] Register tests; run structure, contracts and affected behavior suites with
  hermetic disposable Git configuration. Complete the full offline suite if runnable.
- [x] Run one focused final review, fix evidenced defects, and record results here.

Ruling: implement whole-pipeline reuse for an identical artifact, not speculative
per-command dependency inference. Arbitrary shell commands cannot safely declare
their dependency graph implicitly. No merge, push or release in this task.

Ruling: include explicit mechanical supervision from spec item 1. It is opt-in,
requires substantive nonempty machine checks and prohibits semantic contract
obligations; existing plans retain model supervision and their route validation.
Legacy Workflow hosts reject mechanical mode rather than substituting executor
claims. Native red mechanical evidence remains authoritative.

Review findings fixed: verification workers no longer have an outer timer that
could bypass detached build cleanup; judges must retain the verified checkout HEAD.
Focused real-Git/fake-CLI tests passed, including descendant timeout, committed
judge mutation, malformed contracts, green reuse and per-task caps. No paid model
calls or subscription savings claims.

Validation: the complete offline suite ran. Its only failing tier was the older
Codex driver tests probing nested macOS sandboxing despite using a fake CLI.
The test helper now defaults that probe to `skip`; dedicated probe tests retain
explicit `fail`/`skip` cases, and production probing is unchanged. Rerunning the
entire affected driver tier passed 40/40. All other full-suite tiers passed.
After final fixes, native Claude passed 8/8, mechanical verification passed 7/7,
structure passed 110/110, skills contracts passed 285/285, and the cost contract
and whitespace check passed. No unaffected full-suite rerun was needed.
