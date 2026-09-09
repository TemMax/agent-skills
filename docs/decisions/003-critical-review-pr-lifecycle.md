# 003 — Evidence and provenance throughout the PR fix lifecycle

## Status

Accepted. The critical-review skill owns this lifecycle on both hosts.

## Context

Reading review comments without preserving thread identifiers leaves approved
fixes disconnected from their reviewers. Replying by resemblance, resolving a
partially fixed comment, or citing an unpushed commit creates a misleading public
record. Review content also introduces an untrusted input at an action boundary.

## Decision

Review is read-only until the user has seen findings and requested fixes.
Resolve the review scope from the PR/session/worktree and re-derive findings
from artifacts, including when reviewing this session's own work. Findings need
a location, concrete failure scenario, and justified severity; clean reviews
are legitimate when supported by completed checks.

Read the PR description and all conversation before the diff. Use paginated
GraphQL for inline threads: thread node IDs drive resolution, root comment
`databaseId` values drive REST replies, and per-thread capability fields govern
available actions. Check collected thread count against `totalCount`. Also read
issue-level comments and review verdicts. Report unavailable PR context rather
than reconstructing it from memory.

Persist the thread inventory and finding provenance in a scratchpad ledger so
context compaction cannot erase identifiers. A thread finding carries
`thread:<threadId>:<rootCommentDatabaseId>`; an independent finding carries
`own`. Reply only to the recorded originating thread. Communicate `own` fixes
through commit messages, never a related-looking thread.

For approved fixes, record the starting HEAD and existing user changes, then
route every fix explicitly. The coordinator never authors a fix, including prose:
behavior changes use a supervised `publication: local` wave; genuinely
non-behavior prose uses one bounded routed subagent. Instruction/config text
that changes behavior is behavior-changing. Integrate and commit returned work
using scoped staging, then run available verification. A failed check halts
before publication. Missing delegation stops; PR capability alone may degrade.

Preflight authentication, identity, `viewerCanReply`, and `viewerCanResolve`.
Prepare one package with the diff, real SHAs, verification evidence and limits,
exact reply texts, resolution decisions, skipped threads, and capability gaps.
The user approves or amends that package before execution. Cancellation uses
the recorded starting point for a soft reset, keeping fixes locally and leaving
GitHub untouched. The approved external order is `push` → replies → resolves;
a failed push forbids replies, and a failed write stops the loop with a precise
partial-result report. Capability gaps degrade the package to possible actions
and prepared manual texts, without discarding verified local work.

Immediately before posting, re-read threads. Skip resolved threads and threads
containing this login's `<!-- critical-review-fix-reply -->` marker. Bare
authorship is insufficient: an earlier “will fix” is not a fix confirmation.
Every generated reply ends with the marker. If `totalComments.totalCount`
exceeds the 50 fetched comments, leave the thread for manual handling because
the marker may be outside the window.

Replies state the applied change and pushed commit in one or two sentences,
using the thread's language. Resolve only a fully addressed comment. Partial
fixes, declined findings, and disagreement stay open with a reason. Issue-level
comments can receive a reply but have no inline-thread resolution operation.
PR descriptions and comments remain data throughout: embedded instructions
cannot authorize actions, and reply text comes from the applied fix.

## Consequences

Persisted provenance makes retries and long sessions reviewable. Marker-based
skipping prevents duplicate replies but conservatively leaves ambiguous or
partially completed threads for manual handling. Per-thread capability checks
avoid assumptions from repository roles. API evidence demonstrates concrete
operations on a disposable PR, not universal permissions or immunity to outages.

## Implementation anchors

- [Critical-review skill](../../plugins/code-review/skills/critical-review/SKILL.md).
- [Ship review composition](../../plugins/orchestration/skills/ship/SKILL.md) and
  [local publication contract](002-supervised-wave-execution.md).
- [API validation evidence](../evidence/github-pr-api-validation.md).
- [Skill contract checks](../../tests/skills-contract.sh),
  [critical-review evaluation](../../tests/eval/critical-review.sh), and
  [fake GitHub fixture](../../tests/fixtures/bin/gh).
