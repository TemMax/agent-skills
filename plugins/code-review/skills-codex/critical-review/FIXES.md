## Post-Review Fix Protocol

Everything in this section applies **only after the user, having seen the
findings table, asked for the findings to be fixed.** Until then the review
is read-only, as Review Method item 6 requires.

An earlier approval to "implement directly", given for execution work
elsewhere in the session, does not extend to review findings. Review
findings are a separate gate every time: the user sees the findings table
produced by this review, and only then do fixes go through this protocol.
Measured cause: an orchestrator fixed final-review findings inline and
pushed twice without showing findings.

### Order of operations

1. **Record the starting point**: `git rev-parse HEAD`. Note whether the
   working tree already had uncommitted changes before this phase began.
2. **Route every approved fix; the coordinator never authors a fix**, including
   prose. Each route names an explicit available host, model, supported effort,
   bounded paths and contract, with rationale from multi-model's shared routing
   rules — never severity, coordinator identity, or inherited child defaults. A
   fix wave follows the plan format (`ci`, `e2e`), and a premium model
   (`gpt-6-astra`) in any role of that wave needs `approvals.premium`
   recorded from the user's choice at this fix gate — the approval to fix is
   not an approval to spend premium, and premium use is never inferred from it.
   If any required skill, host, model, or effort is unavailable, stop and report
   that bounded route; never fall back to self-implementation. Behavior changes,
   including instruction/config text that changes actual behavior, use
   multi-model with `publication: local` and supervised execution. Only genuinely
   non-behavior prose, comments, or docs use one bounded explicitly routed
   subagent instead of a supervised wave.
   The returned evidence is not authority to publish.
   The fix wave's base is the pushed PR head, copied from
   `git rev-parse origin/<pr-branch>` — never local `HEAD`, even when the
   local branch looks identical. Measured cause: a fix wave launched on an
   unpushed local `HEAD` spent 15 agent calls before every executor refused.
   The fix-wave plan file itself may stay uncommitted; the launcher reads it
   from disk. Its fix tasks are appended as a new plan, or as a plan with
   `inherits` pointing at the shipped plan — never by flipping the shipped
   plan's `done` status back to `active`.
3. **Integrate, commit, and verify** returned approved fixes — one logical fix
   per commit, staging only paths the fix touched, so pre-existing uncommitted
   work is never swept into a fix commit. Do not silently push an uncommitted
   standalone base to manufacture a wave base. Commits precede the gate because
   replies cite real SHAs. A verification failure halts before the gate and
   returns its output; no commit has been pushed or posted.
4. **Preflight** write capability (below). `degrade` concerns only PR capability,
   never unavailable delegated execution.
5. **Gate** — present the package once, and wait.
6. **Execute**, only on approval, in strict order:
   `push` → replies → resolves. Replying before the push is forbidden: the
   reply would cite a commit that is not on the remote.
7. **Report** facts: what was pushed, which threads were answered and
   resolved, what failed.

### The gate

One confirmation covers the whole package. It shows:

- the diff of all fixes, the commit messages, and their real SHAs;
- any pre-existing uncommitted work deliberately left out of the commits;
- what was executed and with what result; what was not verified;
- a thread table — thread → finding → commit → **the exact reply text** →
  `resolve` or `leave open`, with the reason;
- threads that will receive nothing, and why;
- any capability degradation found by preflight, stated plainly.

The user approves the package as a whole, amends individual lines, or
cancels. **Cancel is `git reset --soft <starting HEAD>`**: the fix commits
disappear, the fixes themselves stay in the working tree for further work,
and nothing left the machine.

### Preflight

The review phase already proved `gh` can read — the PR Protocol would have
failed otherwise. What breaks here is **write** capability, and repository
permission is the wrong instrument for measuring it. GitHub reports reply and
resolve capability per thread, and the two differ: an account holding only
`READ` on a repository still gets `viewerCanReply: true` on its threads. A
repository-level proxy is wrong in both directions — a pull request author can
act beyond `READ` on their own PR, and a locked conversation blocks action
despite `WRITE`.

```bash
command -v gh                # binary present
gh auth status               # authenticated
gh api user --jq .login      # identity, also needed for the idempotency check
```

Per thread, `viewerCanReply` and `viewerCanResolve` from the ledger decide
individually what that thread gets.

**Degrade, never hard-stop.** Fixes and verification are local and reversible;
they run regardless. Whatever part of the PR flow is impossible is dropped
from the package, and the gate says so explicitly — including the prepared
reply texts, so the user can paste them by hand.

Preflight does not guarantee success: capability can be fine and the network
can fail on the fourth thread of seven. So:

- post one at a time;
- stop the loop on the first failure — do not continue hoping the next
  succeeds;
- name every thread in the report: answered, resolved, skipped, failed;
- **idempotency** — immediately before posting, re-run the thread query from
  PR Protocol step 2 and skip a thread when it is already `isResolved`, or
  when it already contains a comment authored by your own
  `gh api user --jq .login` **whose body contains the marker**
  `<!-- critical-review-fix-reply -->`. Without this check, a retry after a
  partial failure double-posts into a reviewer's thread.

  Skip on the marker, never on bare authorship. GitHub has no "answered"
  flag, and "the last comment is mine" is not the same claim: a PR author who
  answered a reviewer with "will fix" before running this phase would have
  their thread silently skipped, the reviewer would never get the fix
  confirmation, and the report would call it "already answered". The marker
  identifies this phase's own replies and nothing else.

  If `totalComments.totalCount` exceeds the 50 comments fetched, the marker
  may lie outside the window: do not post to that thread. List it in the
  report for manual handling. Failing to post is recoverable; double-posting
  into someone's review thread is not.

### What may be answered

A reply may only be posted to the thread recorded in that finding's
provenance. Never search for a related-looking thread to answer. Findings with
`own` provenance are communicated through the commit message, never through PR
threads.

This is the load-bearing rule of the whole phase: telling a reviewer their
comment was addressed, when the fix was actually for something else, is worse
than saying nothing.

### Reply content

One or two sentences: what changed, and the commit. No preamble, no thanks.

Fully addressed:

> Fixed in a3f91c2 — `parseTimeout` now falls back to the default when the
> header is absent.

Partially addressed:

> Partially addressed in a3f91c2 — the null path is handled (client.kt:142),
> but the retry-ordering part is left as-is: it needs a lock refactor beyond
> this PR. Leaving this thread open.

Include a `file:line` reference only when the fix landed somewhere other than
the line the thread is already anchored to, as in the partial example above.
Repeating the thread's own anchor is noise.

Write the reply in the **language of the thread being answered**, not the
language of this chat session. An English-speaking reviewer does not get a
Russian reply.

Every reply ends with the marker line `<!-- critical-review-fix-reply -->`.
GitHub renders HTML comments as nothing, so it is invisible to readers, and it
is what the idempotency check looks for on a retry. A reply without it will be
posted twice if the run is interrupted and restarted.

### Resolve policy

Resolve only when the applied fix closes the comment completely.

Everything else — a partial fix, a finding the user declined, a comment you
disagree with — gets a reply stating the reason, and the thread **stays
open**. Closing it is the reviewer's decision, not yours.

Issue-level PR comments are not anchored to a line and have nothing to
resolve; answer them with `gh pr comment` when they produced a finding.

### Mechanics

```bash
# reply in a thread (root comment databaseId from the ledger)
gh api repos/OWNER/REPO/pulls/NUMBER/comments/<databaseId>/replies -f body='...'

# resolve a thread (node id from the ledger)
gh api graphql \
  -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{isResolved}}}' \
  -f id=PRRT_...
```

### Failure cases

| Case | Behavior |
|---|---|
| Verification (build/tests) fails | Halt before the gate; report the output; fix commits exist locally, nothing pushed or posted |
| User cancels at the gate | `git reset --soft <starting HEAD>`; fixes stay in the working tree; nothing left the machine |
| No `gh`, or not authenticated | Delegated fixes and verification still run; the gate degrades to the push only, and carries reply texts for manual use |
| `viewerCanResolve: false` on a thread | That thread gets its reply; its resolve is dropped from the package, with the reason stated |
| `viewerCanReply: false` on a thread | Listed in the gate as untouchable, with its prepared text for manual use |
| Node count ≠ `totalCount` after pagination | Stop with an explicit error; never present a partial thread inventory as complete |
| `push` rejected (needs rebase) | Stop before replies; return to the user |
| Thread already `isResolved`, or already carries your marker comment | Skip it, do not touch it |
| Thread has more comments than the 50 fetched | Marker may be outside the window — do not post; list it for manual handling |
| Reply or resolve fails mid-loop | Stop the loop; report exactly which threads landed and which did not |
| Non-PR scope (uncommitted changes) | Same protocol minus every thread step; the gate covers the fix commits and the push |
