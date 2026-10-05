## Overview

This skill drives a critical, evidence-based review of either uncommitted
working-tree changes or a GitHub PR, produced by this session's own model —
including (especially) when the code under review was written by this very
session. **The review judges the artifact, not the author's memory of writing
it** — authorship grants no leniency and no shortcuts.

Fable 5's system card documents no self-preference bias as a judge, and Opus
4.8's documents the lineage's most honest verifier (0.00 misreported rate on
knowingly broken results) — those models CAN be trusted to judge their own
output, but only if they re-derive every claim from the code instead of
recalling intentions. Opus 5's self-preference bias is measured in the Opus
5.5 card as effectively zero — +0.05 with no system prompt and −0.03 with a
Claude-identity system prompt, both intervals crossing zero (p. 128) — so it
needs no favoritism correction, but it still re-derives every claim or it has
nothing. Fable 5.1's card is the first since Opus 4.7 to measure a clear
self-recognition bias — small, 0.1 points out of 10, lenient when told the
author is Claude (p. 124) — so it reviews its own code only by re-deriving
every claim from the artifact. Opus 5.5's card measures a small,
significant self-preference of its own — +0.07 points out of 10 with a
Claude-identity system prompt (p. 128) — so, like Fable 5.1, it reviews its
own code only by re-deriving every claim from the artifact. Whatever the
model, re-derivation from the artifact is the load-bearing rule.

Always reply to the user in the language the user writes in — this skill being in
English does not mean English replies.

## Critical Stance

Authorship is not evidence. "I wrote this an hour ago and I remember it
working" verifies nothing — memory of intent is not observed behavior.
Re-derive every judgment from the diff and the surrounding code as if the
author were unknown and unavailable for questions.

No positivity quota and no praise section: findings only. A clean review with
zero findings is a legitimate outcome, but it must come from exhausted
checks, not from goodwill. This skill's output format has no "Strengths"
section by design.

| Excuse | Reality |
|---|---|
| "I just wrote this, I know it works" | You know what you MEANT to write. The diff shows what you wrote. |
| "Tests passed while I was developing it" | Passing tests you also wrote test your assumptions, not your blind spots. Read their assertions and validate against independent evidence. |
| "It's a small diff" | Small diffs hide big regressions — a one-line change to a shared helper touches every caller. |
| "The PR description already explains this" | The description is a claim; the review verifies claims against code. |
| "Finding bugs in my own code looks bad" | Shipping them looks worse. The review's job is findings, not image. |
| "The user seems happy with the result" | The user asked for a critical review; leniency is a failed task, not kindness. |

## Review Method

1. Map the diff first: `git diff --stat` or `gh pr diff --stat`; group files
   by subsystem; decide reading order (interfaces and shared helpers before
   leaf code).
2. For every hunk, read the full enclosing function or class and relevant
   callers. Read the whole file when wider state or invariants are needed;
   overlapping hunks share that reading. Changed a signature or contract?
   Find every call site with `rg` and check each.
3. Actively hunt:
   - correctness: logic inversions, off-by-one, wrong variable, missed
     null/empty
   - error paths: what happens when the call fails, times out, returns
     partial data
   - concurrency: shared state, ordering assumptions, races on retries
   - security: injection, secrets in code/logs, authz gaps on new endpoints
   - data: migrations reversible, backward compatibility, silent schema drift
   - tests: do new/changed tests assert real behavior (not mocks of it), do
     they cover the failure paths the diff introduces; did tests that SHOULD
     change stay untouched (a behavior change with zero test delta is itself
     a finding)
   - docs/config: README, config samples, CHANGELOG staleness if the repo
     keeps them
4. Verify claims with the relevant build, tests and linter. Inspect assertions
   and independently produced output; first-pass green evidence for the exact
   artifact, commands and environment need not be rerun. Rerun for changes,
   missing evidence or a concrete unresolved concern; scope diagnostic probes
   to that concern. Required final gates still apply. Checks without reliable
   evidence are unverified — "should pass" never appears in a review.
5. Every finding must carry: file:line, what is wrong, the concrete failure
   scenario (input/state → wrong outcome), and a suggested fix when it is not
   obvious. A finding you cannot back with a line reference and a scenario is
   a hunch — either verify it into a finding or drop it.
6. The review is read-only: do not mutate the working tree, index, HEAD, or
   branch state; no fixes unless the user asks after seeing the review.
7. When several reviews run for one request — several PRs, or several
   reviewers in parallel — wait until every one has finished, then present
   all findings once, in one table per scope, before asking to fix anything.
   Measured cause: in a 2026-09-22 run, findings were shown while a second
   review was still running, which forced a second fix approval and a second
   fix plan.

Keep review context scoped to the artifact: diff range or PR head, acceptance
requirements, evidence paths and unresolved findings. Load full logs only for a
specific evidence question. On continuation, retain the reviewed baseline and
read changes since it; unrelated edits require wider inspection where they
invalidate prior conclusions. Batch related approved fixes; optional remarks
alone never start another review or fix cycle. Initial PR discussion coverage
and independent code inspection remain required.

Review the files the diff's scope actually touches, including a config file
the diff adds or changes — but never reproduce a secret value found there:
cite `file:line` and the key name only. Never open credential stores or
configuration files outside the review's scope (for example `~/.codex`,
`~/.claude`) even when they might hold context, and never print, copy or
transmit a credential or token value from any file, in or out of scope.
Measured cause: a reviewer printed an Authorization value from a local
config in the same run.

## Output Format

Summary first (3-6 sentences): what was reviewed (scope and how many
files/lines), overall verdict (e.g. "not mergeable: 2 blockers" / "mergeable
after Important fixes" / "clean"), what was executed (tests/build/linter),
and what was not verified.

Then one table, hardest tier first:

```
| Tier | Finding | Location | Why / failure scenario | Suggested fix |
|---|---|---|---|---|
```

Tier definitions:
- **Blocker** — merge/ship would break something: broken build or tests,
  data loss, security hole, corrupted core behavior.
- **Important** — a real bug or an unmet requirement from the task/PR
  description; will bite users or teammates soon; fix before merge.
- **Medium** — edge-case bugs, missing error handling, maintainability
  traps; fix in this PR if cheap, otherwise track explicitly.
- **Low** — minor improvements, non-urgent cleanups.
- **Nit** — style, naming, typos; take or leave.

Every finding also carries a **provenance** marker:
`thread:<threadId>:<rootCommentDatabaseId>` when it answers an existing PR
thread, or `own` when the session found it independently. Provenance comes
from the ledger, and it is what the fix phase replies against — a finding
without it never produces a PR reply.

Empty tiers are omitted from the table. If the table is empty, say explicitly
that N checks were performed and found nothing, and list what was checked.
Tier inflation and deflation are both calibration failures — a nit marked
Important erodes trust exactly like a blocker marked Low.

PR review additionally: findings that answer an existing PR thread reference
that thread.

## Common Mistakes

| Mistake | Consequence | Correct |
|---|---|---|
| Reviewing before loading your reviewer profile | You inherit another model's effort advice and failure modes | Step 0 first, exactly one profile |
| Reviewing only the hunks in the diff | Misses broken callers and context | Read the enclosing function/class and call sites |
| Trusting the PR description over the code | Claims pass review while code diverges | Verify each promised behavior against the diff |
| Skipping PR comment threads | Re-raises settled points, misses promised-but-unlanded fixes | Read all threads and replies first, classify each |
| "Should pass" instead of running | Unverified claims ship | Run what is cheap; list the rest as unverified |
| Leniency toward own code | The one reader who could catch the bug waves it through | Judge the artifact as if the author were unknown |
| Findings without file:line and scenario | Unactionable review theater | Every finding: location + failure scenario + fix |
| Tier inflation/deflation | The table stops being a prioritization tool | Calibrate against the tier definitions |
| Fixing code during the review | Review mutates into unrequested changes | Read-only; fixes only on explicit request afterwards |
| Reading PR threads over REST | No thread id and no resolution state — threads cannot be classified and the fix phase has nothing to reply to | Read threads with the GraphQL query in PR Protocol step 2 |
| Inferring write capability from repository permission | `READ` on the repo still permits replies; `WRITE` does not guarantee a locked thread can be touched | Read `viewerCanReply`/`viewerCanResolve` per thread |
| Replying before the push | The reply cites a commit that is not on the remote yet | `push` → replies → resolves, in that order |
| Resolving a partially addressed thread | Closes a conversation the reviewer never agreed was finished | Resolve only on a complete fix; otherwise reply and leave it open |
| Answering a thread that merely resembles the finding | A reviewer is told their comment was fixed when it was not | Reply only to the thread recorded in that finding's provenance |
| Treating "the last comment is mine" as "already answered" | A thread the author had commented in gets silently skipped and never answered | Skip only on the `<!-- critical-review-fix-reply -->` marker |

## References

- `references/reviewer-opus-5-5.md`,
  `references/reviewer-fable-5-1.md`, `references/reviewer-fable-5.md`,
  `references/reviewer-opus-5.md`,
  `references/reviewer-opus-4-8.md` — the reviewer profiles. Load exactly one,
  per Step 0.
- `references/reviewer-dossier.md` — the review-relevant excerpts from the
  official system cards, with page references: judge properties, honesty
  rates, documented reviewer failure modes. Load it to justify a contested
  severity call or why the session may review its own code.
