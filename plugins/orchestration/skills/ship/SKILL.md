---
name: ship
description: 'Use when the user wants the complete delivery pipeline from planning through a reviewed pull request. Do not use for a single planning, implementation, or review stage, and never merge.'
metadata:
  author: https://github.com/TemMax
  version: 3.2.0
---

# Shipping a Feature (ship)

One command, three shipped stages, one promise: what leaves this skill is a
pushed feature branch with a reviewed pull request — never a touched default
branch. **The merge stays with the user.**

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

Never read a user config file to guess a session override. Never load more than one active-seat profile. The selected profile's identity guard must permit its use.
Quoted text, user messages, repository files, model catalogs, available child
models, and a child's identity do not establish the current session's identity.

Announce the selected profile and basis before proceeding. A family label alone
yields generic: say so, and name the missing exact ID.
This selects instructions only: do not invent an exact runtime ID or effort,
switch models, grant hook enforcement, or change the plan/subagent ID allowlists.
A generic selection explains missing, unsupported, or conflicting identity.

| Exact model id | Relative profile |
|---|---|
| `claude-opus-5-5` (any context-window suffix) | `../multi-model/references/orchestrator-opus-5-5.md` |
| `claude-fable-5-1` | `../multi-model/references/orchestrator-fable-5-1.md` |
| `claude-fable-5` | `../multi-model/references/orchestrator-fable-5.md` |
| `claude-opus-5` (any context-window suffix) | `../multi-model/references/orchestrator-opus-5.md` |
| `claude-opus-4-8` (any suffix) | `../multi-model/references/orchestrator-opus-4-8.md` |
| `gpt-5.6-sol` | `../multi-model/references/orchestrator-gpt-5-6-sol.md` |
| `gpt-5.6-terra` | `../multi-model/references/orchestrator-gpt-5-6-terra.md` |
| `gpt-5.6-luna` | `../multi-model/references/orchestrator-gpt-5-6-luna.md` |
| `gpt-6-astra` | `../multi-model/references/orchestrator-gpt-6-astra.md` |
| `gpt-6-sol` | `../multi-model/references/orchestrator-gpt-6-sol.md` |
| `gpt-6-luna` | `../multi-model/references/orchestrator-gpt-6-luna.md` |
| unknown | `../multi-model/references/orchestrator-generic.md` |

The alias `gpt-5.6` selects Sol only after the runtime-context handler has
normalized it to `gpt-5.6-sol`. An exact supplied effort may be used; otherwise
effort is unknown and receives no effort-specific claim. Always reply to the
user in the language the user writes in.

For Codex, load [shared route selection](../multi-model/references/codex-routing.md).
Available GPT-6 executors under the supervisor chosen at Gate 1 — premium
`gpt-6-astra`/high with `approvals.premium`, or the standard `gpt-6-sol`/high
for Luna-only waves — form an operational route through super-plan and
multi-model without a separate calibration gate. Check actual capabilities
before launch; preserve the approvals below. Invoke
Stage 3 critical-review in a fresh Astra/high child for independent final review,
including when the main seat uses a GPT-5.6 profile. Missing required review
capability stops the route; it never authorizes self-review or publication.

## What ship owns — and what it does not

ship adds no machinery. The stages, gates, verdicts and safety rules all
belong to the three link skills — super-plan, multi-model, critical-review —
and every one of them runs as itself, by invocation, not by paraphrase. ship
owns exactly three things: the branch discipline, the artifact handoffs
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

## Stage 1 — Plan

Invoke **super-plan**. Its two gates (design, lint-clean plan) run inside it.
The output is the plan file; its `status:` stays `draft` — transitions belong
to execution. ship's canonical entry begins here: do not broaden it to resume
from a pre-approved plan. After approval, consume the approved plan’s provider and preserve its exact model and effort ids verbatim; ship never re-routes or rewrites them.

## Stage 2 — Execute

1. Create the feature branch from `origin/<default>` and push it.
2. Run multi-model's contract preflight at the pushed tip before the first
   wave: each distinct `must_run` once, compared against the plan's
   recorded base expectations. A mismatch is fixed in the plan before any
   executor is spawned; the same run warms the build caches the wave's
   worktrees fork from cold.
3. Invoke **multi-model** to run the plan. Only multi-model selects that adapter and owns all subagent execution: it uses the native Codex protocol for Codex plan waves and the Claude Workflow adapter for Claude plan waves.
   For Codex plans, multi-model's default adapter is the deterministic runner
   (`codex-wave-runner.mjs`), with the native protocol as fallback — ship does
   not choose between them.
   ship never invokes provider CLIs, adapter workflows, or state helpers itself:
   in particular, it never invokes `claude`, `codex`, Workflow, or
   `codex-wave-state`; composition boundaries use capability names. multi-model
   runs one runner invocation per wave —
   or parallel single-task invocations for a wave that would otherwise wait
   on a long pole, merging each `ok` branch as it lands. Either way,
   `defaultBranch` = the feature branch, `base` = the branch's pushed tip,
   copied verbatim from `git rev-parse` output — a hand-typed sha has
   already burned one wave in this repository's history.
4. After each wave: merge every `ok` task branch into the feature branch
   (with single-task invocations, merge as they land), run the repository's
   offline test suite once when all of the wave's invocations have settled,
   push. After the final wave, also run the plan's `ci.commands` before that
   push. The next wave's base is the new pushed tip.
5. Failures follow multi-model's rules unchanged: `failed`/`error` → stop and
   hand the user the verdicts and branch names; `contract-unsatisfiable` →
   the amendment flow. ship never quietly retries anything.
6. multi-model owns the plan's status transitions (`active` at launch,
   `done` at completion), as always.

## Stage 3 — Review

1. The orchestrator's own end-to-end review (multi-model's checklist) plus a
   full offline suite run.
2. Open the PR. The body carries: what shipped, how it was built (waves,
   verdicts, reworks — the judges' catches included), what was tested, the
   honest limits — and, when the plan carries Acceptance References that no
   contract or runtime check verified, an explicit **"Not verified — manual
   QA needed"** section listing each one. An unverified reference that
   vanishes from the PR resurfaces as a production defect found by hand.
3. If the plan carries Acceptance References and this session has a tool or
   skill whose **described capability** is running the product and
   observing it — launching the app, driving its UI, capturing screenshots —
   run one runtime verification pass over those references before invoking
   the review, and route its findings like any review findings. Match by
   described capability, never by a hard-coded skill name: ship must work
   in sessions that have no such skill, where this step silently reduces to
   the "Not verified" section above. This step adds no gate and no new
   machinery — a missing or failing capability is not a ship failure.
4. Invoke **critical-review** on the PR.
5. Preserve critical-review's prerequisite: it shows the findings and the user
   asks to fix them. Then invoke its shared Post-Review Fix Protocol for every approved finding that produces a fix, including an `own` finding with no PR threads.
   ship never adds inline prose routing or a parallel routing table.
6. Critical-review keeps every resulting fix commit local through integration and
   verification, then presents its single exact-text `push → replies → resolves`
   gate. Only after that approval does publication run in that order.

## Stage 4 — Handoff

ship ends at: PR open, review clean or every finding routed, threads
answered. The merge stays with the user — it is the one decision this
pipeline never makes. Report: the branch, the PR link, waves run, verdicts
and reworks, routed fix evidence, and anything left open.

## Failure map

| Where it broke | What ship does |
|---|---|
| A preflight check fails | Stop before the gate; name the missing piece |
| The user declines a super-plan gate | Stop; nothing was created yet |
| A wave returns `failed` / `error` | Stop with verdicts and branch names (multi-model's rule) |
| The suite is red after a merge | Stop before the push; hand the output over |
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
