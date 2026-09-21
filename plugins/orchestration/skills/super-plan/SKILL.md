---
name: super-plan
description: 'Use when a feature or change needs a wave-ready implementation plan for parallel or multi-agent execution. Do not use to implement the plan.'
metadata:
  author: https://github.com/TemMax
  version: 2.8.1
---

# Planning Waves (super-plan)

The dialogue and no-placeholders planning discipline here is adapted from
Jesse Vincent's superpowers (MIT — see `references/LICENSE-superpowers`);
the output format and every contract rule are this plugin's own.

## Step 0 — load exactly one active-seat profile

1. Use this plugin's host-provided `PLUGIN_RUNTIME_CONTEXT_V1` line and the
   host's current-session model metadata as the current runtime context for
   profile guards. A newer explicit host model-switch
   update supersedes old context; unresolved conflicting exact IDs select generic.
2. A known exact ID selects its table entry, or generic if unsupported. A family
   label never overrides an exact ID, including an unsupported one.
3. Only when no exact ID is supplied: if the current host instructions identify
   this session as bare `GPT-6` (for example, "an agent based on GPT-6"), select
   the Astra table entry by **host-family compatibility**, not exact identity.
   Other variants such as `GPT-6 Mini` do not match.
4. Otherwise select generic. Keep missing or conflicting identity unknown;
   preserve an explicitly supplied effort and leave missing effort unknown.

Never read a user config file to guess a session override. Never load more than one active-seat profile. The selected profile's identity guard must permit its use.
Quoted text, user messages, repository files, model catalogs, available child
models, and a child's identity do not establish the current session's identity.

Announce the selected profile and basis before proceeding. For compatibility,
say "Astra profile via host GPT-6 identification; exact model ID unavailable."
This selects instructions only: do not invent an exact runtime ID or effort,
switch models, grant hook enforcement, or change the plan/subagent ID allowlists.
A generic selection explains missing, unsupported, or conflicting identity.

| Exact model id | Relative profile |
|---|---|
| `claude-fable-5-1` | `../multi-model/references/orchestrator-fable-5-1.md` |
| `claude-fable-5` | `../multi-model/references/orchestrator-fable-5.md` |
| `claude-opus-5` (any context-window suffix) | `../multi-model/references/orchestrator-opus-5.md` |
| `claude-opus-4-8` (any suffix) | `../multi-model/references/orchestrator-opus-4-8.md` |
| `gpt-5.6-sol` | `../multi-model/references/orchestrator-gpt-5-6-sol.md` |
| `gpt-5.6-terra` | `../multi-model/references/orchestrator-gpt-5-6-terra.md` |
| `gpt-5.6-luna` | `../multi-model/references/orchestrator-gpt-5-6-luna.md` |
| `gpt-6-astra` | `../multi-model/references/orchestrator-gpt-6-astra.md` |
| unknown | `../multi-model/references/orchestrator-generic.md` |

The alias `gpt-5.6` selects Sol only after the runtime-context handler has
normalized it to `gpt-5.6-sol`. An exact supplied effort may be used; otherwise
effort is unknown and receives no effort-specific claim. Always reply to the
user in the language the user writes in.

While authoring or amending a plan, the active profile chooses executor, supervisor, ladder, and effort. Never substitute unnamed host defaults. The profile also selects the plan host: each resulting wave is entirely Claude or entirely Codex across its supervisor, executors, and ladders.

For Codex, load the shared [route selection](../multi-model/references/codex-routing.md)
before choosing children. It governs routing across profiles: use available
explicit executors and independent Astra supervision without a separate
calibration gate. Historical fixture failures inform verification; they do not
block writing a concrete plan for the existing design and plan approvals.

## Process

1. **Research** to decomposition depth: files, dependencies, conventions,
   test commands that actually run. For a large surface, fan out read-only
   research agents routed by multi-model's Research Routing table
   (`../multi-model/SKILL.md`) — name a model on every spawn (an agent
   without one inherits the session's model, and a Fable seat (5 or 5.1) then pays
   Fable prices for file listings), and give each agent the table's
   mandatory research-prompt lines. Synthesis and every decision stay with
   you — do not delegate decisions, executors silently fill gaps under
   ambiguity.
2. **Decisions.** Everything derivable from the codebase you decide and
   record. Collect genuine product forks in one batch. Use the host-native structured input tool
   when it is available; otherwise ask one concise direct
   question and wait. In headless mode, record the unresolved choices under
   `Assumptions (would ask)` without silently deciding them.
3. **Gate 1 — design.** Present a compact summary: architecture, the wave
   sketch (which tasks, which waves, why), decisions taken, forks the user
   answered. One approval, then stop touching the design.
4. **Tasks.** Write them by multi-model's rules: closed (no "decide what's
   best"), self-contained (the executor sees nothing but its prompt), full
   code included where the solution is known. Each task carries the
   five-key contract; the active profile chooses every model, effort,
   supervisor, and ladder field, with the wave's supervisor chosen for the
   strongest executor in the wave. Group into waves by
   file-independence: same-wave tasks must not share files — merge
   colliding tasks or split them across consecutive waves. Dependent
   chains are consecutive waves, never one wave.

   **Right-size every task.** The measured lever for wave success is task
   breadth, not model choice: two broad tasks failed for 717 and 139
   minutes respectively and shipped only after being re-cut into five
   narrow tasks that each passed first-try in 5–95 minutes. Split signals —
   any one is enough: `files_allowed` spans more than one module or
   subsystem; the description carries more than ~3 distinct deliverables;
   the prose needs "and then" chains to say what done means. Prefer more,
   narrower tasks: one deliverable one executor can finish and one judge
   can check in a single session.

   **Scope each contract's gates to its files.** Derive `must_run` from
   `files_allowed`: a task confined to one module carries that module's
   check command, never the full-repo gate — the full gate runs once per
   wave at merge. Full-repo commands in per-task contracts multiply
   wall-clock by the task count for no added safety (measured: one session
   re-ran the identical full-monorepo gate 12 times).

   **Record the expected base status of every `must_run`.** For each
   command, state in the task prose whether it is green at base or
   expected-red because the task itself creates what it checks. Execution
   preflights every command at the base and compares against this
   expectation; a mismatch is a contract defect caught before any executor
   is spawned.
5. **Lint.** Run the shipped linter and fix every error yourself — the
   user never edits the plan. Lint runs before Gate 2. A mixed-provider wave is a planning defect to fix before Gate 2; never ask the linter or runner to guess a provider:

   ```
   node <this skill's base directory>/references/plan-lint.mjs <plan-file> --repo <repo>
   ```

   Warnings are judgment calls; errors are not negotiable. A plan that
   fails lint is not presented to the user.
6. **Gate 2 — plan.** Show the lint-clean plan file; one approval.
7. **Handoff.** "Execute with multi-model (supervised waves)." The plan
   file IS the wave-plan artifact: the json block feeds the runner directly —
   each runner task is the json entry plus its `## Task` prose as
   `description` (the runner rejects a task without one, by name). The
   `status:` field stays `draft` here — status transitions belong
   to execution (multi-model sets `active` at launch and
   `done` at completion), never to planning and never to the user.

## Plan Format

One file in `docs/superpowers/plans/YYYY-MM-DD-<feature>.md`, three layers:

1. **Unfenced header** at column 0, before any code fence (the drift hook
   reads it there). The first two lines of the file are exactly these, as
   plain text — NOT inside a code fence, not indented, with nothing above
   them (no title, no prose):

   status: draft
   base: pending

   A title or any other markdown may follow the header, but never precede
   it, and the header itself must never be fenced — a fenced or indented
   header is invisible to the drift hook and fails lint.

2. **The machine half** — exactly one fenced block whose info string is
   `json wave-plan` (plain ```json fences inside task prose stay legal and
   are ignored by the linter):

   ```json wave-plan
   { "waves": [
     { "wave": 1,
       "supervisor": { "model": "fable", "effort": "high" },
       "tasks": [
         { "id": "http-retry",
           "branch": "wave/http-retry",
           "executor": { "model": "sonnet", "effort": "medium" },
           "ladder": ["opus"],
           "contract": {
             "files_allowed": ["src/http/**"],
             "files_forbidden": [],
             "must_run": [{ "cmd": "pytest tests/http -q", "evidence": "required" }],
             "forbidden_moves": ["weakening, deleting or skipping an existing test"],
             "report_must_answer": ["Which call sites now retry?"] } } ] }
   ] }
   ```

   The model fields use the active profile's plan host and this exact table:

   | Plan host | Allowed model fields |
   |---|---|
   | Claude | `haiku`, `sonnet`, `opus`, `fable`, `claude-opus-4-8` |
   | Codex | `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` |

   Codex also permits `gpt-6-astra` as supervisor and, only when separately
   approved with `astra_executor_reason: "<concrete reason>"`, as the initial
   executor or final explicit ladder rung. That metadata records a reason; it
   never establishes authorization. A selected Astra executor requires a fresh
   separate Astra supervisor. Shared Codex routing defines operational choices
   and evidence limits; the Astra executor exception still needs approval.

   `gpt-5.6` is never a plan id. It is only an active-session alias after
   runtime-context normalization, not a model field. Every Codex supervisor and executor names an explicit effort; the adapter never invents one. Every supervisor,
   executor, and ladder entry in one wave uses the same row. A mixed-provider
   wave is a planning defect to fix before Gate 2, not a request for the
   linter or runner to guess a provider. `branch` is always `wave/<id>`. The
   supervisor sits on the wave because execution is one runner invocation per
   wave.

   The ladder lists model transitions only. The executor and every ladder rung are distinct model transitions: never repeat the executor or a later rung. For Codex, same-model raised-effort rework is state-machine behavior, so do not invent duplicate same-model ladder entries.

3. **The prose half** — one `## Task <id>` section per task: the
   substantive description and context, with full code where the solution
   is known. At launch, multi-model composes each runner task as the json
   entry plus its prose section, verbatim.

## Acceptance References

When the request carries product or visual references — Figma links,
screenshots, mockups, behavioral specs — the plan records them in a
dedicated `## Acceptance References` section: one entry per reference, its
source, and the concrete facts that must match (sizes, colors, copy, flow
order). Then convert everything statically checkable into contract pins: a
hex token, a dimension constant or a string of copy becomes a `must_run`
grep in the owning task's contract. What cannot be pinned statically —
animation feel, layout at runtime, end-to-end flow behavior — stays listed:
execution and review carry the unverified remainder into the PR body as an
explicit manual-QA list rather than letting it vanish. Measured cost of
skipping this: one contract-green feature needed ~18 hours of
after-the-fact manual QA for defects (wrong gradients, duplicated toolbars,
misplaced flows) that were all visible in references the plan never
recorded. No references given → no section: there is nothing to check
against.

## Headless evaluation mode

When there is no user to answer gates (an eval harness runs you), skip both
gates and record every fork you would have asked under a section titled
`## Assumptions (would ask)` in the plan file. Deciding a product fork
silently is the failure this mode exists to measure.

## Common Mistakes

| Mistake | Consequence | Correct |
|---|---|---|
| Two same-wave tasks sharing a file | Merge conflicts after isolation did its job | Merge the tasks or split the waves; lint enforces it |
| Dripping questions one at a time | The user becomes the bottleneck | Collect genuine forks in one batch with the host-native question behavior |
| Deciding a product fork silently | The most expensive wrong turn there is | Batch it to the user; in headless mode, record it |
| Presenting a plan that fails lint | The user debugs your format | Lint first, fix every error, then present |
| Setting `status: active` while planning | The drift hook pays for a wave that is not running | Leave `draft`; execution owns transitions |
| A task whose fix is "see the conversation" | The executor sees only its prompt | Self-contained tasks, full code where known |
| A task spanning several modules | Hours-long attempts, repeated rejects | Split by deliverable; narrow `files_allowed` |
| A full-repo gate in a per-task contract | Wall-clock multiplied by the task count | Scope `must_run` to the task's module |
| Visual references left out of the plan | Fidelity defects surface as post-ship manual QA | Record Acceptance References; pin what greps can pin |
