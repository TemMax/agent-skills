## Post-Review Fix Protocol

For a review the user asked for on its own, everything in this section
applies **only after the user, having seen the findings table, asked for the
findings to be fixed.** Until then the review is read-only, as Review Method
item 6 requires. When the review runs as a stage of ship on the pipeline's
own pull request, the user already asked for a reviewed pull request: the
findings table is shown and the fixes start without a separate request.

The findings are always shown before or with the fixes, never hidden. For a
review the user asked for on its own, the findings are a separate gate
every time: the user sees the findings table produced by this review, and
only then do fixes start. Measured cause: an orchestrator fixed
final-review findings inline and pushed twice without showing findings.
Once the fixes start, the user's direct instruction about how to make them
wins (step 2).

These rules apply only to findings of a review the user asked for in this
session. A plain request to change code is implementation work, not a review
fix, and does not enter this protocol. For those findings step 2 decides who
makes a change; it takes precedence over a general rule that the coordinator
never authors code.

### Order of operations

1. **Record the starting point**: `git rev-parse HEAD`. Note whether the
   working tree already had uncommitted changes before this phase began.
2. **Choose the fix route yourself.** Never ask the user to approve a route or
   a model. Ask the user only for a contradiction in the feature, a change of
   the agreed scope, weakening or removing a test or check, an irreversible
   action on something this run did not create, or an action only the user
   can take; step 6 gates the outward steps that are not the user's own. The
   first rule decides whenever it applies:
   - **Instruction.** The user's direct instruction wins. When the user tells
     the coordinator in this session how to carry out a change — "fix it
     yourself", "do it and check it yourself", "no agents", "use agents", "use
     this model" — do exactly that, whatever the change is, and never answer
     with a request to approve another route.
   - **Direct.** Without such an instruction, the coordinator makes the change
     itself when all of these hold: it can state the exact change before
     making it; the change stays inside the task already agreed with the user
     and inside one module or subsystem; no new public interface, data format
     or product behavior has to be decided; checks that cover the change exist
     or are added with it and can be run here.
   - **Delegated.** Anything else goes to a supervised wave: multi-model with
     `publication: local` on the standard route. Each delegated route names an
     explicit available host, model, supported effort, bounded paths and
     contract, with rationale from multi-model's shared routing rules — never
     severity, coordinator identity, or inherited child defaults. When a
     required skill, host, model, or effort is unavailable, fix directly with
     the checks of a direct fix and say so in the report; do not stop.
   - **Checks of a direct fix.** Run the covering checks. A behavior change,
     including instruction/config text that changes actual behavior, also gets
     one independent check of the diff from a fresh agent on the standard
     review route when the host can spawn one. The report says plainly when no
     independent check ran.
   - **Premium.** Premium models are never the subject of a question. A
     premium model (Fable 5.1 / GPT-6 Astra) is used only when the user said
     so: in this session, or through a standing authorization written in the
     user's or the repository's instruction files (`AGENTS.md`, `CLAUDE.md`),
     which counts as the user's choice and is recorded in `approvals.premium`
     with its source. The request to fix findings is not a premium
     authorization, and premium use is never inferred from it. An
     authorization given for a pull request or task covers its later fix and
     recovery waves while the models and roles stay the same. Without an
     authorization use the standard route; when no standard delegated route
     fits, fix directly with the checks of a direct fix. The report notes in
     one line where a premium route would have applied.
   - **Fix wave.** A fix wave follows the plan format (`ci`, `e2e`). The fix
     wave's base is the pushed PR head, copied from
     `git rev-parse origin/<pr-branch>` — never local `HEAD`, even when the
     local branch looks identical. Measured cause: a fix wave launched on an
     unpushed local `HEAD` spent 15 agent calls before every executor refused.
     The fix-wave plan file itself may stay uncommitted; the launcher reads it
     from disk. Its fix tasks are appended as a new plan, or as a plan with
     `inherits` pointing at the shipped plan — never by flipping the shipped
     plan's `done` status back to `active`. A later fix plan of the same pull
     request `inherits` the plan that already carries the user's premium
     authorization, so nothing is asked again.
   - **Re-run.** Re-running the same approved plan or route after the machine
     or the plan's environment was fixed needs no new approval.
3. **Commit and verify** every fix, direct or returned by a wave — one logical
   fix per commit, staging only paths the fix touched, so pre-existing
   uncommitted work is never swept into a fix commit. Do not silently push an
   uncommitted standalone base to manufacture a wave base. Commits precede
   publication because replies cite real SHAs. A verification failure halts
   before publication and returns its output; no commit has been pushed or
   posted.
4. **Preflight** write capability (below). `degrade` concerns only PR
   capability; step 2 handles a missing delegated capability.
5. **Publish the user's own work without a question.** After verification is
   green, push the fix commits to the feature branch of the user's own pull
   request — its author is the login `gh api user --jq .login` returns — and
   report what was pushed.
6. **Gate only what is not the user's own**: replies and resolves in threads
   started by someone else (the root comment's author is another login), and a
   push to a branch or pull request that is not the user's own. Present those
   items once, and wait for the user's word; a package without such items is
   published without the gate. The order is always
   `push` → replies → resolves. Replying before the push is forbidden: the
   reply would cite a commit that is not on the remote. A merge is never part
   of this protocol; it needs the user's word.
7. **Report** facts: what was pushed, which threads were answered and
   resolved, what failed.

### The gate

The gate is shown only for the items step 6 names. One confirmation covers
the whole package. When no gate is shown, the report carries what the gate
would have stated about dropped steps and their reply texts. The gate shows:

- the diff of all fixes, the commit messages, and their real SHAs;
- any pre-existing uncommitted work deliberately left out of the commits;
- what was executed and with what result; what was not verified;
- a thread table — thread → finding → commit → **the exact reply text** →
  `resolve` or `leave open`, with the reason;
- threads that will receive nothing, and why;
- any capability degradation found by preflight, stated plainly.

The user approves the package as a whole, amends individual lines, or
cancels. **Cancel is `git reset --soft <starting HEAD>`** when no fix commit
was pushed: the fix commits disappear, the fixes themselves stay in the
working tree for further work, and nothing left the machine. When the fix
commits are already on the user's own pull request, cancel posts nothing and
leaves the pushed commits in place.

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
| Verification (build/tests) fails | Halt before publication; report the output; fix commits exist locally, nothing pushed or posted |
| User cancels at the gate | Nothing pushed yet: `git reset --soft <starting HEAD>`; fixes stay in the working tree; nothing left the machine. Fix commits already on the user's own pull request: nothing is posted; the pushed commits stay |
| No `gh`, or not authenticated | Fixes and verification still run; the pull request's author cannot be confirmed, so the push goes through the gate, which carries reply texts for manual use |
| A required delegated skill, host, model, or effort is unavailable | Fix directly with the checks of a direct fix and say so in the report; do not stop |
| `viewerCanResolve: false` on a thread | That thread gets its reply; its resolve is dropped from the package, with the reason stated |
| `viewerCanReply: false` on a thread | Listed in the gate as untouchable, with its prepared text for manual use |
| Node count ≠ `totalCount` after pagination | Stop with an explicit error; never present a partial thread inventory as complete |
| `push` rejected (needs rebase) | Stop before replies; return to the user |
| Thread already `isResolved`, or already carries your marker comment | Skip it, do not touch it |
| Thread has more comments than the 50 fetched | Marker may be outside the window — do not post; list it for manual handling |
| Reply or resolve fails mid-loop | Stop the loop; report exactly which threads landed and which did not |
| Non-PR scope (uncommitted changes) | Same protocol minus every thread step; no pull request of the user's own exists, so the gate covers the fix commits and the push |
