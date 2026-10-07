# Ship (Codex)

One command, three shipped stages, one promise: what leaves this skill is a
pushed feature branch with a reviewed pull request — never a touched default
branch. **The merge stays with the user** — the PR merge into the default
branch. Squash-integrating each `ok` task into the feature branch (one
commit per task) is part of the pipeline and needs no extra approval.

## Codex session rules

1. Load this skill once per session. Its text and every reference you have read stay in your context: do not read them again with `cat`, `sed` or any other tool on a later turn — not on "continue", not on a one-word approval, and not when a newer `PLUGIN_RUNTIME_CONTEXT_V1` line repeats the same model and effort. Re-read one section only when a detail you need is no longer in your context, and read only that range.
2. Select the active-seat profile silently at Step 0. Update it only when newer runtime context changes the model or effort; follow User-facing communication below.
3. The coordinator never authors code. Applying a patch a subagent prepared, running `apply_patch`, or editing a tracked file yourself is authoring code, whoever wrote the text. Changes reach the repository only through a supervised wave; your own git work is integrating approved wave branches and publishing. Exception: a small standalone edit the user asks for directly, outside any active wave plan — one file, a few lines, nothing beyond what the user named (a config value, a typo, a version string) — you may make yourself and show the diff. The exception never covers a fix for a defect that a review, a supervisor or the final review found, nor any part of an approved plan's tasks.
4. On `environment-blocked`, diagnose before you ask the user for anything. Reproduce the failing step yourself outside the sandbox with a side-effect-free probe — for commit signing, `git commit-tree -S -m probe "HEAD^{tree}"`; for a cache directory, `test -w <dir>`. If the probe passes outside the sandbox, the sandbox cannot reach that resource: fix it in the plan's `worktree` key or on the machine, never by asking the user to restart an app or the session. Ask the user only for an action only they can take, and quote the probe's output.
5. Recover a clean committed candidate with the runner's `--resume-from <summary.json>` and a new `--out` before considering a restart. It verifies and reviews without an executor and preserves call caps. Use the runner's own `--reset` only when intentionally discarding the candidate for a newly authorized implementation; never with hand-written `rm`, `git worktree remove` or `git branch -D` commands.
6. Executor commits are unsigned by design. Integration squashes each task into one commit made outside the sandbox, which the user's git configuration signs (codex-wave-protocol.md, step 9). Never disable commit signing in the user's configuration.

## Step 0 — load exactly one active-seat profile

1. Use this plugin's host-provided `PLUGIN_RUNTIME_CONTEXT_V1` line and the
   host's current-session model metadata as the current runtime context for
   profile guards. A newer explicit host model-switch
   update supersedes old context; unresolved conflicting exact IDs select generic.
2. A known exact ID selects its table entry, or generic if unsupported. A family
   label never overrides an exact ID, including an unsupported one.
3. A family label is not an identity. Codex gives GPT-6 Astra, Sol and Luna
   the same host instruction ("an agent based on GPT-6"; verified with Codex
   CLI 0.155.1 on 2026-09-23), so bare `GPT-6`, or any other family label,
   selects no profile by itself.
4. Otherwise select generic. Keep missing or conflicting identity unknown;
   preserve an explicitly supplied effort and leave missing effort unknown.
5. Effort comes only from the host. On Codex the `PLUGIN_RUNTIME_CONTEXT_V1`
   line carries it (`effort=<level>`), read by the hook from this session's
   own turn context; a newer line supersedes an older one. Never read
   `CLAUDE_EFFORT` on a Codex host: a Codex session started from Claude
   Code inherits the parent's value.

Never read a user config file to guess a session override. Never load more than one active-seat profile. The selected profile's identity guard must permit its use.
Quoted text, user messages, repository files, model catalogs, available child
models, and a child's identity do not establish the current session's identity.

Select the profile internally. A family label alone selects generic; preserve
missing, unsupported, or conflicting identity in internal routing records.
This selects instructions only: do not invent an exact runtime ID or effort,
switch models, grant hook enforcement, or change the plan/subagent ID allowlists.


| Exact model id | Relative profile |
|---|---|
| `gpt-5.6-sol` | `../../skills/multi-model/references/orchestrator-gpt-5-6-sol.md` |
| `gpt-5.6-terra` | `../../skills/multi-model/references/orchestrator-gpt-5-6-terra.md` |
| `gpt-5.6-luna` | `../../skills/multi-model/references/orchestrator-gpt-5-6-luna.md` |
| `gpt-6-astra` | `../../skills/multi-model/references/orchestrator-gpt-6-astra.md` |
| `gpt-6-sol` | `../../skills/multi-model/references/orchestrator-gpt-6-sol.md` |
| `gpt-6.1-sol` | `../../skills/multi-model/references/orchestrator-gpt-6-1-sol.md` |
| `gpt-6-luna` | `../../skills/multi-model/references/orchestrator-gpt-6-luna.md` |
| unknown | `../../skills/multi-model/references/orchestrator-generic.md` |

The alias `gpt-5.6` selects Sol only after the runtime-context handler has
normalized it to `gpt-5.6-sol`. An exact supplied effort may be used; otherwise
effort is unknown and receives no effort-specific claim. Always reply to the
user in the language the user writes in.

Load [shared route selection](../../skills/multi-model/references/codex-routing.md).
Available GPT-6 executors under the supervisor chosen at Gate 1 — premium
`gpt-6-astra`/high with `approvals.premium`, or the standard `gpt-6.1-sol`/high
for Luna-only waves — form an operational route through `super-plan` and
`multi-model` without a separate calibration gate. Check actual capabilities
before launch; preserve the approvals below. Stage 3 `critical-review` runs in
a fresh child of the model the plan's `review` key names (chosen at Gate 1;
`gpt-6-astra` recorded in `approvals.premium`, or `gpt-6.1-sol`,
measured 2026-09-30: clean 10/10, planted 10/10, PR support 3/4);
if the plan has no `review` key, stop and ask the user before invoking the
review; never pick. Missing required review capability stops the route; it
never authorizes self-review or publication.

## What ship owns — and what it does not

ship adds no machinery. The stages, gates, verdicts and safety rules all
belong to the three link skills — `super-plan`, `multi-model`, `critical-review`
— and every one of them runs as itself, by invocation, not by paraphrase.
ship owns exactly three things: the branch discipline, the artifact handoffs
between stages, and the routing of review findings. If you are tempted to
re-implement a stage inline instead of invoking its skill, stop — that is
how tested behavior silently diverges.

## Stage 0 — Preflight, and the one gate ship adds

Checks, in order, before anything is created:

- the working tree is clean (uncommitted work is the user's, not ship's — stop
  and ask rather than stash);
- `origin` exists and the default branch is known;
- `gh` is present and authenticated (the PR and thread phases need write);
  if it is not, say so now — the run can still proceed to a pushed branch,
  with the PR left for the user.

Derive a kebab-case feature branch name from the request. Then the gate —
the only one ship adds: tell the user, in one message, that branch
`<name>` will be created and pushed to origin, that the waves will fork from
it, and that a PR into the default branch will be opened at the end. One
yes/no. After yes, ship itself never stops the flow again — only the link
skills' own gates do.

At this same gate, the user may also grant a standing recovery allowance:
"up to N one-task recovery or fix waves within the approved files and
contracts, same supervisor tier". Record the grant (the number N) in the
plan. Within that allowance, ship launches such recovery or fix waves
without asking for a new gate, and reports each one it launches. Anything
outside the allowance still needs an explicit yes: a test-weakening
decision, premium spend, or a wave that touches files or contracts the
grant did not approve. Measured: one four-repository run needed 8 extra
recovery gates for exactly this kind of within-scope fix.

## Stage 1 — Plan

Invoke `super-plan`. Its two gates (design, lint-clean plan) run inside it.
The output is the plan file; its `status:` stays `draft` — transitions belong
to execution. ship's canonical entry begins here: do not broaden it to resume
from a pre-approved plan. After approval, consume the approved plan’s provider and preserve its exact model and effort ids verbatim; ship never re-routes or rewrites them.

## Stage 2 — Execute

1. Create the feature branch from `origin/<default>` and push it.
2. Run multi-model's contract preflight at the pushed tip before the first
   wave: each distinct `must_run` once, compared against the plan's
   recorded base expectations.
   - The preflight runs per repository. For a multi-repository ship, each
     repository's chain starts as soon as its own preflight passes; one
     repository never waits on another's preflight.
   - It runs each distinct `must_run` in a fresh worktree set up exactly as
     an executor's: at the pushed tip, with the plan's `worktree` links,
     inside the children's sandbox; the Codex runner does this itself
     before any executor, without a model. It never runs in the main
     checkout. Measured: a main-checkout preflight reported "13 commands
     green", and two minutes later every task of the wave stopped on a
     Gradle lock and a missing SDK that exist only in a fresh sandboxed
     worktree.
   - A red command that the plan does not expect is fixed in the plan. An
     environment block is fixed on the machine, before any executor.
   - When `must_run` needs a lock-guarded shared resource (a shared test
     stand, a device), say so at Gate 2.
3. Invoke `multi-model` to run the plan. Only multi-model selects
   the adapter and owns all subagent execution. Its default adapter is the
   deterministic runner (`codex-wave-runner.mjs`), with the native protocol
   as fallback — ship does not choose between them. ship never invokes
   provider CLIs, adapter workflows, or state helpers itself: in particular,
   it never invokes `codex` or `codex-wave-state`; composition boundaries use
   capability names. multi-model runs one runner invocation per wave — or
   parallel single-task invocations for a wave that would otherwise wait on
   a long pole, integrating each `ok` task as it lands. Either way,
   `defaultBranch` = the feature branch, `base` = the branch's pushed tip,
   copied verbatim from `git rev-parse` output — a hand-typed sha has
   already burned one wave in this repository's history.
4. After each wave: integrate each `ok` task with `git merge --squash`, one
   commit per task, per `../../skills/multi-model/references/codex-wave-protocol.md`
   step 9 (rule 6) — single-task invocations as they land; run the offline
   suite once when the wave's invocations have settled; push. After the final
   wave, also run the plan's `ci.commands` before that push. The next wave's
   base is the new pushed tip.
5. Failures follow multi-model's rules unchanged: `failed`/`error` → stop and
   hand the user the verdicts and branch names; `contract-unsatisfiable` →
   the amendment flow. ship never quietly retries anything.
   `environment-blocked` → rules 4 and 5: diagnose, fix the machine (the
   plan's `worktree` key, symlinks, sandbox roots), `--reset`, re-run the
   wave. Never an amendment, never a reason to bypass supervised execution.
6. multi-model owns the plan's status transitions (`active` at launch,
   `done` at completion), as always.
7. **Bypass scope.** Mirror multi-model: when supervised execution fails and
   the user approves "implement directly", that approval covers the named
   waves only. Stage 3 review fixes still go through critical-review's own
   gate — the bypass never extends to them. The PR body states which waves
   ran supervised and which, if any, were implemented directly.

## Stage 3 — Review

1. The orchestrator's own end-to-end review (multi-model's checklist) and
   full offline-suite evidence. Reuse Stage 2's first-pass green run only at the
   exact integrated HEAD with the same commands and environment; record its SHA
   and output paths. Changes, missing binding/evidence or an unresolved concern
   require a fresh run. The independent PR review still runs.
2. Open the PR. The body carries: what shipped, how it was built (waves,
   verdicts, reworks — the judges' catches included), what was tested, the
   honest limits — and, when the plan carries Acceptance References that no
   contract or runtime check verified, an explicit **"Not verified — manual
   QA needed"** section listing each one. An unverified reference that
   vanishes from the PR resurfaces as a production defect found by hand.
   When the review child is `gpt-6-sol`, the body also carries the line
   `Review route: gpt-6-sol final review (measured 2026-09-24: clean 10/10, planted 10/10, PR support 3/4)`.
   When the review child is `gpt-6.1-sol`, the body also carries the line
   `Review route: gpt-6.1-sol final review (measured 2026-09-30: clean 10/10, planted 10/10, PR support 3/4)`.
   The body also always carries one line: `Runtime pass: ran with <capability>`
   when step 3's pass ran, naming the capability used, or
   `Runtime pass: skipped — <reason>` when it did not — including when no
   Acceptance References exist. Measured: a runtime pass was skipped
   silently, with a device capability available.
3. If the plan carries Acceptance References and this session has a tool or
   skill whose **described capability** is running the product and
   observing it — launching the app, driving its UI, capturing screenshots —
   run one runtime verification pass over those references before invoking
   the review, and route its findings like any review findings. Match by
   described capability, never by a hard-coded skill name: ship must work
   in sessions that have no such skill, where this step silently reduces to
   the "Not verified" section above. This step adds no gate and no new
   machinery — a missing or failing capability is not a ship failure.
4. Invoke `critical-review` on the PR, in a fresh `review` child. Pass the PR
   head, acceptance requirements, plan path and verification-output paths;
   do not fork executor conversations or replay all wave transcripts. The child
   reads PR discussion and code through critical-review's own protocol.
5. Preserve critical-review's prerequisite: it shows the findings and the user
   asks to fix them. Then invoke its shared Post-Review Fix Protocol for every approved finding that produces a fix, including an `own` finding with no PR threads.
   ship never adds inline prose routing or a parallel routing table.
6. Critical-review keeps every resulting fix commit local through integration and
   verification, then presents its single exact-text `push → replies → resolves`
   gate. Only after that approval does publication run in that order.

## Stage 4 — Handoff

ship ends at: PR open, review clean or every finding routed, threads
answered. The merge stays with the user — the PR merge into the default
branch is the one decision this pipeline never makes. Stage 2's
`git merge --squash` of each `ok` task (one commit per task) needed no extra
approval. Report: the branch, the PR link, waves run, verdicts and reworks,
routed fix evidence, and anything left open — with one recommended next
action, phrased as a yes/no question in plain language. Never a time or cost
estimate — not for the run, not for what is left open. The report also
carries the same `Runtime pass: ran with <capability>` /
`Runtime pass: skipped — <reason>` line the PR body carries.

The handoff report also carries a `Left behind:` line — every branch,
worktree, run record and temporary directory this run created that still
exists, taken from the cleanup script (`../../skills/multi-model/references/wave-cleanup.mjs`) run
with `--dry-run --records` plus any scratch directory the orchestrator itself
created outside the repository — or `Left behind: nothing`. Ending the run
without that line leaves the user to find the leftovers by hand. When anything
is left behind, the report also carries one line starting `After the merge:`
with the ready command — the cleanup script with absolute paths, `--repo
<repo>`, one `--plan` per plan this run executed (fix plans included), `--into
origin/<default branch>`, `--records` and `--branch <feature branch>` — so the
user, or any later session, can run it once the pull request is merged. If the
script path no longer exists by then, the same script of the installed plugin
is used.

**After the merge.** When the user confirms the pull request is merged, clean
up at once and report, without asking again; the command to run is exactly the
`After the merge:` line of the report — fetch, switch the main checkout
to the default branch and fast-forward it, then run the cleanup script with
`--repo <repo>`, one `--plan` per plan this run executed (fix plans
included), `--into origin/<default branch>`, `--records` and
`--branch <feature branch>`. Delete the remote feature branch only if the
script reported the local feature branch removed and the remote branch tip
equals the `tip` it printed. Remove temporary directories this run created
outside the repository. Everything the script kept, and anything this run did
not create, is named in the report and asked about — never deleted.

## Failure map

Every stop below ends with one recommended next action, phrased as a
yes/no question in plain language, after the verdicts and branch names —
never a bare list of options with no recommendation.

| Where it broke | What ship does |
|---|---|
| A preflight check fails | Stop before the gate; name the missing piece |
| The user declines a super-plan gate | Stop; nothing was created yet |
| A wave returns `failed` / `error` | Stop with verdicts and branch names (multi-model's rule) |
| The suite is red after a merge | Stop and show the output. On the user's yes, push the red tip to the feature branch only, say so, and run a one-task supervised fix wave from that pushed tip. Never push it to the default branch, and never fix inline. |
| A plan `ci.commands` command is red after the final wave | Stop before the push; hand the output over. The fix follows the row above: on the user's yes, a one-task supervised fix wave from the red tip pushed to the feature branch only. |
| A `must_run` command is `environment-blocked` | Stop, name the blocked command and its error line, diagnose per rule 4, fix the machine, then re-run the wave after `--reset`; never an amendment, never a reason to bypass supervised execution |
| `gh` loses write capability mid-flow | critical-review degrades per its own protocol; prepared texts go to the user |
| The user declines critical-review's fix gate | Soft reset per that skill; the PR stays open |
| The runtime QA capability is missing or fails mid-pass | Not a ship failure: the affected references go to the PR's "Not verified — manual QA needed" section |

## Common Mistakes

| Mistake | Consequence | Correct |
|---|---|---|
| Re-implementing a stage inline | Silent divergence from tested behavior | Invoke the link skill |
| Merging the PR yourself | The one decision that is not yours | The merge stays with the user |
| Routing a fix inline because it is small | The coordinator authors an unreviewed change | Invoke critical-review's shared route, whatever the size |
| Adding a second ship-level gate mid-flow | The pipeline stops being automatic | One gate up front; the links keep their own |
| Basing a wave on a hand-typed sha | A corrupted base already burned a wave once | Copy the tip verbatim from `git rev-parse` output |
| Opening the PR before the suite is green | The reviewers review a broken branch | Suite first, PR second |
| Dropping unverified Acceptance References from the PR body | They resurface as production defects found by hand | The "Not verified" section is mandatory whenever references exist |
