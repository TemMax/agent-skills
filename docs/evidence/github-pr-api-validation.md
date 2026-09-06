# GitHub PR API validation evidence

Recorded 2026-08-11 with `gh` 2.83.2 (2025-12-10), against PR #1 in the
private throwaway repository `TemMax/claude-skills-scratch-prvalidation`.
The repository was deleted after validation. This is retained evidence of
executed operations, not a fresh service or permission check.

| Operation | Executed form | Observed result |
|---|---|---|
| Create inline comment | `gh api repos/O/R/pulls/N/comments` with body, commit_id, path, `-F line=2`, `-f side=RIGHT` | Comment `3758842768`, line 2, `probe.txt` |
| Read threads | `gh api graphql --paginate`, `reviewThreads(first:100, after:$endCursor)`, root `comments(first:1)` and latest `comments(last:10)` aliases | One thread, `hasNextPage:false`; node `PRRT_kwDOT1Wy4c6YQr4W`; root `databaseId:3758842768` matched REST |
| Reply | `gh api repos/O/R/pulls/N/comments/3758842768/replies -f body='...'` | Reply `3758845467`, `in_reply_to_id:3758842768` |
| Resolve | `gh api graphql` with `resolveReviewThread(input:{threadId:$id})` and `-f id=PRRT_kwDOT1Wy4c6YQr4W` | Returned `thread.isResolved:true` |

The resolve query declared `$id:ID!`; `-f id=` bound that non-null GraphQL
variable without special JSON encoding. Schema introspection also confirmed
`ResolveReviewThreadInput.threadId: ID!`. Re-reading exposed resolution state,
latest author/body, and `gh api user --jq .login` returned the acting login.
The single-thread run validated the paginated query form and aliases; it did
not exercise a multi-page result set.

The current skill uses the same identifiers and operations with the latest 50
comments plus `totalComments.totalCount`. Its marker rule was exercised in a
separate disposable PR #2 in `TemMax/claude-skills-rehearsal`: one fully fixed
thread was replied to and resolved; one partial fix was replied to and left
open; an injected instruction was ignored. Cited fixes were ancestors of the
remote branch before replies. Repeating the marker-based pass added no comments;
cancelling a later package retained local changes and made no PR changes.
That run used the skill's author as executor, establishing mechanical
executability without proving a fresh reader would interpret it identically.

Bare latest-author matching is not the current idempotency rule: it incorrectly
skips an earlier “will fix” comment. The shipped lifecycle checks this login's
`<!-- critical-review-fix-reply -->` marker or `isResolved`, and leaves threads
with more than 50 comments for manual handling.

## Capability limit that remains unresolved

On `cli/cli#9000`, the read probe observed `viewerCanReply:true` and
`viewerCanResolve:false` with repository permission `READ`. The scratch write
probe observed `viewerCanResolve:true` while its account held `ADMIN`.
Neither establishes whether an author with only `READ` can resolve threads on
their own fork PR. The skill reads each thread's actual `viewerCanReply` and
`viewerCanResolve` instead of inferring them from repository permission.

Current policy and command templates live in the
[critical-review skill](../../plugins/code-review/skills/critical-review/SKILL.md);
the durable rationale is in [decision 003](../decisions/003-critical-review-pr-lifecycle.md).
