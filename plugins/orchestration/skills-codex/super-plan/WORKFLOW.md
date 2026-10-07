# Planning Waves (super-plan, Codex)

The dialogue and no-placeholders planning discipline here is adapted from
Jesse Vincent's superpowers (MIT — see `../../skills/super-plan/references/LICENSE-superpowers`);
the output format and every contract rule are this plugin's own.

## Codex session rules

1. Load this skill once per session. Its text and every reference you have read stay in your context: do not read them again with `cat`, `sed` or any other tool on a later turn — not on "continue", not on a one-word approval, and not when a newer `PLUGIN_RUNTIME_CONTEXT_V1` line repeats the same model and effort. Re-read one section only when a detail you need is no longer in your context, and read only that range.
2. Select the active-seat profile silently at Step 0. Update it only when newer runtime context changes the model or effort; follow User-facing communication below.
3. Applying a patch a subagent prepared, running `apply_patch`, or editing a tracked file yourself is authoring code, whoever wrote the text. The user's direct instruction wins: when the user tells you in this session how to carry out a change — "fix it yourself", "do it and check it yourself", "no agents", "use agents", "use this model" — do exactly that, whatever the change is (a review finding, a supervisor's or the final review's defect, part of an approved plan), and never answer with a request to approve another route. Without such an instruction choose the route yourself and never ask the user to approve it: author the change yourself when you can state the exact change before making it, it stays inside the task already agreed with the user and inside one module or subsystem, no new public interface, data format or product behavior has to be decided, and checks that cover it exist or are added with it and can be run here; anything else goes to a supervised wave on the standard route. When you author a change, run the covering checks and show the diff.
4. On `environment-blocked`, diagnose before you ask the user for anything. Reproduce the failing step yourself outside the sandbox with a side-effect-free probe — for commit signing, `git commit-tree -S -m probe "HEAD^{tree}"`; for a cache directory, `test -w <dir>`. If the probe passes outside the sandbox, the sandbox cannot reach that resource: fix it in the plan's `worktree` key or on the machine, never by asking the user to restart an app or the session. Ask the user only for an action only they can take, and quote the probe's output.
5. Recover a clean committed candidate with the runner's `--resume-from <summary.json>` and a new `--out` before considering a restart. It verifies and reviews without an executor and preserves call caps. Use the runner's own `--reset` only when intentionally discarding the candidate for a newly authorized implementation; never with hand-written `rm`, `git worktree remove` or `git branch -D` commands.
6. Executor commits are unsigned by design. Integration squashes each task into one commit made outside the sandbox, which the user's git configuration signs (codex-wave-protocol.md, step 9). Never disable commit signing in the user's configuration.

## Step 0 — load exactly one active-seat profile

1. Use this plugin's host-provided `PLUGIN_RUNTIME_CONTEXT_V1` line and the
   host's current-session model metadata as the current runtime context for
   profile guards. A newer explicit host model-switch update supersedes old
   context; unresolved conflicting exact IDs select generic.
2. A known exact ID selects its table entry, or generic if unsupported. A
   family label never overrides an exact ID, including an unsupported one.
3. A family label is not an identity. Codex gives GPT-6 Astra, Sol and Luna
   the same host instruction ("an agent based on GPT-6"; verified with Codex
   CLI 0.155.1 on 2026-09-23), so bare `GPT-6`, or any other family label,
   selects no profile by itself.
4. Otherwise select generic. Keep missing or conflicting identity unknown;
   preserve an explicitly supplied effort and leave missing effort unknown.
5. Effort comes only from the host. The `PLUGIN_RUNTIME_CONTEXT_V1` line
   carries it (`effort=<level>`), read by the hook from this session's own
   turn context; a newer line supersedes an older one. Never read
   `CLAUDE_EFFORT` on a Codex host: a Codex session started from Claude Code
   inherits the parent's value.

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

While authoring or amending a plan, the active profile chooses executor,
supervisor, ladder, and effort. Never substitute unnamed host defaults. Every
wave this skill writes is entirely Codex across its supervisor, executors, and
ladders.

Load the shared [route selection](../../skills/multi-model/references/codex-routing.md)
once, before choosing children. It governs routing across profiles: use
available explicit executors and the supervisor chosen at Gate 1 (premium
Astra with `approvals.premium`, or standard `gpt-6.1-sol` for all-Luna waves)
without a separate calibration gate. Historical fixture failures inform
verification; they do not block writing a concrete plan for the existing
design and plan approvals.

## Process

1. **Research** to decomposition depth: files, dependencies, conventions,
   test commands that actually run. Read the repository's CI workflow files
   (e.g. `.github/workflows/*.yml`) and record their exact test entrypoints
   verbatim for the plan's `ci` key — a plan that only approximates what CI
   actually runs (measured: a plan that assumed `pytest -q` ran with
   `PYTHONPATH` set, when the repository's own CI entrypoint ran it without,
   surfaced the gap only at final review and cost a fix round) is a research
   gap, not a detail to fill in later. For a large surface, fan out read-only
   research agents routed by codex-routing.md's research line — name an
   exact model ID and effort on every spawn (`gpt-6-luna` at `medium` for
   exact enumeration, `gpt-6.1-sol` at `medium` for closed codebase
   questions, `gpt-6.1-sol` at `high` for difficult investigation), and give
   each agent multi-model's mandatory research-prompt lines. Synthesis and
   every decision stay with you — do not delegate decisions, executors
   silently fill gaps under ambiguity. Research also records the untracked
   files the build needs in a fresh worktree, for example `local.properties`,
   `.env` or keystores, and the cache directories the build writes, for
   example `~/.gradle`, `~/.android` or `~/.cargo`. These go into the plan's
   `worktree` key: the runner auto-detects Gradle/Cargo and an untracked
   `local.properties`, so the key lists only what auto-detection misses, or
   sets `"auto": false`. Measured: in 2026-09-24/25 sessions, every fresh
   worktree lacked `local.properties`. Agents improvised the symlink 93
   times, and at least 4 printed the file, including a GitHub token.
2. **Decisions.** Everything derivable from the codebase you decide and
   record. A new explicit planning request authorizes its stated planning scope;
   do not ask the user to authorize that scope again because the preceding task
   was different. Clarify unresolved requirements or work beyond the new request.
   Collect genuine product forks in one batch. Use the host-native
   structured input tool when it is available; otherwise ask one concise
   direct question and wait. In headless mode, record the unresolved choices
   under `Assumptions (would ask)` without silently deciding them. Resolve those
   product forks before choosing executor tiers or asking about supervisor and
   review routes. While a product fork remains unresolved (including headless
   assumptions), ask or record only the product questions; defer route choices
   and model names until the scope supports a concrete wave sketch. Then fix each
   wave's executor tiers and ladder shape at Gate 1 — the supervisor choice
   depends on them — then decide and present the supervisor choice, named
   and never priced:
   - standard: `gpt-6.1-sol` for waves whose executors and rungs are only
     `gpt-6-luna` — supervisor fixture 9/9 on 2026-09-29; its predecessor
     `gpt-6-sol` held the seat with fixture 9/9 on 2026-09-23 and
     2026-09-24 and three real small waves merge-ready first try — toy
     waves, correct work only;
   - premium: `gpt-6-astra`, recorded in `approvals.premium`;
   - a wave with a `gpt-6.1-sol` or `gpt-6-sol` executor has no standard
     supervisor — it needs `gpt-6-astra`.

   Record the model for ship's Stage 3 critical-review child in the plan's
   `review` key here too, and disclose it at Gate 1:
   - `gpt-6-astra` as the recommended option, recorded in `approvals.premium` only when the user picks it;
   - `gpt-6.1-sol` when the user picks it to save that cost — strict review
     gate clean 10/10, planted 10/10; PR support 3/4 on 2026-09-30.
     Only the user's choice is recorded; ship never picks one.

   A premium model is used only when the user picks it; record the approval
   in `approvals.premium`. If the Tasks step later changes a wave so the
   chosen supervisor no longer fits (for example the wave gains a
   `gpt-6.1-sol` executor), re-ask the user before Gate 2 rather than carry
   the stale supervisor forward.

### Single-task path

Use it when the whole change is one task: one deliverable, one executor, `files_allowed` inside one module, and no second task in any wave. It changes only planning. Write the same plan file (one wave, one task) and lint it as usual. Skip the seam audit: with one task there are no seams between tasks, and the runner's preflight probes every `must_run` command at the base before any executor starts. Ask one gate instead of two: show the design summary and the lint-clean plan together; one approval counts as Gate 1 and Gate 2. Execution uses the runner and independent verification, followed by integration by the coordinator. Model supervision remains the default; the explicit mechanical mode follows the shared cost controls. On this path the executor writes the task's code; the coordinator edits it only under rule 3. When the change grows to a second task, return to the full process. A change that rule 3 lets the coordinator make itself needs no plan at all.

3. **Gate 1 — design.** Present a compact summary: architecture, the wave
   sketch (which tasks, which waves, why), decisions taken, forks the user
   answered, and the supervisor choice (premium or standard, named, never
   priced). One approval, then stop touching the design.
4. **Tasks.** Write them by multi-model's rules: closed (no "decide what's
   best"), self-contained (the executor sees nothing but its prompt), full
   code included where the solution is known. Each task carries the
   five-key contract; the active profile chooses every model, effort,
   supervisor, and ladder field, with the wave's supervisor chosen for the
   strongest model any task in the wave can run — every executor AND every
   ladder rung — from multi-model's supervisor table; a supervisor that also
   appears as an executor or rung is a lint error. Give every rung an exact
   ID; a `gpt-6-luna` task under a `gpt-6.1-sol` supervisor takes
   `"ladder": []`, since a `gpt-6.1-sol` rung would collide with the
   supervisor. Group into waves by file-independence: same-wave tasks must
   not share files — merge colliding tasks or split them across consecutive
   waves. Dependent chains are consecutive waves, never one wave.

   **Execution cost controls.** Before authoring the contract, read
   `../../skills/multi-model/references/execution-cost-controls.md`. Optional wave limits,
   artifact-cache declarations and task `supervision` belong in the approved
   plan. Default to model supervision; choose mechanical mode only for substantive
   acceptance obligations fully established by independent commands.

   **Design for width.** Waves exist to run tasks side by side; a plan
   whose waves each hold one task is a serial script that pays wave
   overhead for nothing. Measured: a four-repository plan came out as 14
   waves of one task each — every task in a repository listed the same
   `internal/web/**` directory, and a sequential step list had been
   copied into waves one step per wave. So: cut `files_allowed` by file,
   not by directory, so tasks that edit different files of one package
   can share a wave; when several tasks need a new interface, type or
   wire format, put that contract alone in an early wave, written out in
   full in the plan, and fan its implementers and their tests out in the
   next wave; run independent chains — including plans for separate
   repositories — side by side, never one after another; never turn a
   step list into one wave per step — regroup by what each step reads
   and writes. The same-task and producer-before-consumer rules below
   still hold; width comes from these cuts, not from breaking them. A
   single-task wave is fine when the dependency is real: name it in the
   plan's `## Parallelism` section, one line per single-task wave naming
   the artifact it waits for. The linter warns when most waves of a plan
   of three or more waves hold a single task and the plan has no
   `## Parallelism` section.

   **Keep a change with what it breaks.** A change and the test helper,
   fixture or shared file it breaks belong to the same task. Splitting
   them across tasks — even in one wave — leaves each task's own checks
   red; across waves it leaves a wave's merge red. Measured: a
   sibling-task helper anchored on fixture text broke when an eval
   planner moved the helper change to a later wave. A reader of a
   changed format, signature, fixture or shared file stays in the same
   task — never a later wave.

   **Order consumers after producers.** A task that documents, tests, or
   consumes an artifact produced by another task of the same wave — a
   file, fixture, function, CLI output or behavior that does not exist
   at the wave's base — goes into a later wave or into the same task.
   File-disjoint tasks are not dependency-free: an executor that cannot
   find its input stops and reports `blocked-on-sibling`, and every such
   attempt is wasted. Measured: a README task documenting a same-wave
   CLI's output on a same-wave fixture, and ship-smoke's doc task
   describing a same-wave guard, both hit this.

   **Name the end-to-end task, or say there is none.** A feature that
   transforms data through a pipeline (CLI, collector, report, …) gets one
   task that runs the shipped fixtures through the real entrypoints end to
   end offline; name that task's id in the plan's `e2e` key. A feature that
   is not a pipeline gets `"not-applicable: <reason>"` instead — never a
   silent omission. The e2e task sits in a wave after every task whose
   entrypoints or fixtures it runs. Documentation of its fixtures or output
   goes into the e2e task or a later documentation-only wave. For a UI or
   dependency-injection feature, `not-applicable` must name how production
   wiring is proven: either an integration task, or a `must_run` grep or
   test proving the DI binding and the call site on the real screen or
   client. Measured: an attachments feature passed every contract and was
   not wired into the production client or the screen.

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

   Scoped does not mean fewer gates. Each task's `must_run` carries the
   module-scoped form of every gate in `ci.commands` that touches its
   files:
   - the formatter;
   - the linter or static analysis (e.g. `./gradlew detekt` →
     `./gradlew :module:detekt`, `gofmt -l <dirs>`);
   - the tests.

   For a multiplatform module, it also compiles every target's test
   sources. Measured: two fix waves (a `detekt` gate no task carried;
   Kotlin/Native rejecting test names that JVM accepted) and one gofmt
   recovery wave.

   **Record the expected base status of every `must_run`.** For each
   command, state in the task prose whether it is green at base or
   expected-red because the task itself creates what it checks. Execution
   preflights every command at the base and compares against this
   expectation; a mismatch is a contract defect caught before any executor
   is spawned.
5. **Seam audit.** Between Tasks and Lint, spawn one read-only audit agent
   on `gpt-6.1-sol` at `medium`. It checks every contract against the code:
   each `must_run` command exists and runs the way CI runs it, every
   referenced path or API exists, the interfaces passed between tasks
   agree, and every recorded base expectation is plausible. It also checks
   the same-task rule explicitly: for every changed format, signature or
   fixture, find every reader of it and require that reader be in the same
   task as the change. For every task, it lists the artifacts that task
   reads that do not exist at the wave's base, and fails the plan when a
   same-wave sibling produces any of them. "No file-ownership conflicts" is
   not a pass on its own — measured: the pilot's audit reported exactly
   that and missed the dependency.

   The audit also runs four further checks:
   - **Implementers and fakes.** For every public interface, type or
     function signature a task changes, list all implementers, fakes and
     test doubles repo-wide (e.g. `grep -rn ': AppRouter'`). Require each
     one in the same task's `files_allowed`, or require the dependents'
     test compilation in `must_run`. Measured: an abstract member added to
     `AppRouter` broke fakes in 9 modules, costing 2 fix waves.
   - **Prose versus forbidden_moves.** Every instruction in a task's prose
     that changes, renames or deletes an existing test is either
     pre-authorized by name in that task's `forbidden_moves` exception, or
     removed. No `forbidden_moves` entry may forbid what the prose
     requires. Measured: one such contradiction cost a wave, a recovery
     plan and a user gate.
   - **Build-target claims.** A claim that a build task or target exists
     cites the build tool's own listing (e.g. `./gradlew :m:tasks --all`).
     Measured: a research agent asserted a nonexistent
     `:core-mobile:jvmTest`.
   - **depends_on producers.** Every `depends_on` entry names a real
     producer (repo, ref, path), and every consumer of another plan's
     artifact has one. Measured: an eval wave launched before the other
     repository's broker existed.

   Give it the same secrets prohibition every executor gets: never open,
   print, copy or transmit credentials, tokens or configuration files that
   hold them (for example `~/.codex`, `~/.claude`, app configs with
   Authorization headers); if it needs a secret to audit a seam, stop and
   report. This is where seams between tasks — discovered mid-execution
   otherwise — surface while they are still cheap to fix. Fix what it finds
   before lint.
6. **Lint.** Run the shipped linter and fix every error yourself — the
   user never edits the plan. Lint runs before Gate 2. A mixed-provider wave is a planning defect to fix before Gate 2; never ask the linter or runner to guess a provider:

   ```
   node ../../skills/super-plan/references/plan-lint.mjs <plan-file> --repo <repo>
   ```

   The linter path is relative to this file's directory; resolve it to an
   absolute path before you run it. Warnings are judgment calls; errors are
   not negotiable. A plan that fails lint is not presented to the user.
7. **Gate 2 — plan.** Show the lint-clean plan file and its shape: the
   number of waves, which tasks run in parallel in each wave, and the
   critical path as a chain of waves with the tasks on it. Never a
   duration or a cost — see "No time or cost estimates" below. One
   approval.
8. **Handoff.** "Execute with multi-model (supervised waves)." The plan
   file IS the wave-plan artifact: the json block feeds the runner directly —
   each runner task is the json entry plus its `## Task` prose as
   `description` (the runner rejects a task without one, by name). The
   `status:` field stays `draft` here — status transitions belong
   to execution (multi-model sets `active` at launch and
   `done` at completion), never to planning and never to the user.

Worktree access: `links` are required repository-relative inputs;
`optional_links` lists optional inputs. Explicit `writable` roots must be existing
stable directories, never a transient lock path. Lint the real repository before
approval; signing and integration obligations must match the selected adapter.

## No time or cost estimates

Never predict how long a plan, a wave or a task will take, or what it will
cost — not at Gate 1, not at Gate 2, not in a table, a progress update or a
report; not as a range, a ratio, or a word such as "quick" or "cheap". Model
estimates of agent work are not reliable, and the user acts on the number.
Measured: both runs of a 2026-09-24 pilot finished below the lower bound of
their own Gate 2 range, and a real four-repository plan was quoted at 7–16
hours and $60–250. What the user gets instead is the plan's shape — waves,
parallel tasks, the critical path in waves — and, after execution, what
happened: waves run, verdicts and reworks.

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
       "supervisor": { "model": "gpt-6.1-sol", "effort": "high" },
       "tasks": [
         { "id": "http-retry",
           "branch": "wave/http-retry",
           "executor": { "model": "gpt-6-luna", "effort": "medium" },
           "ladder": [],
           "contract": {
             "files_allowed": ["src/http/**"],
             "files_forbidden": [],
             "must_run": [{ "cmd": "pytest tests/http -q", "evidence": "required" }],
             "forbidden_moves": ["weakening, deleting or skipping an existing test"],
             "report_must_answer": ["Which call sites now retry?"] } } ] }
   ],
   "ci": { "commands": ["pytest -q"], "workflows": [".github/workflows/ci.yml"] },
   "e2e": "not-applicable: http-retry touches one call path, not a data-transforming pipeline" }
   ```

   More top-level keys sit beside `waves`, siblings of it in the same
   object, never nested inside a wave or task:

   - `ci`: `{"commands": [...], "workflows": [...]}` naming the exact test
     entrypoints and workflow files the Research step found in the
     repository's own CI config, or `"none: <reason>"` when the repository
     has no CI. When CI workflow files exist in the repo, `commands` must be
     their exact entrypoints, copied verbatim — never an approximation of
     what CI runs. A workflow counts as CI when it runs on `pull_request`,
     `pull_request_target` or `merge_group`; release, deploy or
     announcement workflows that run only on push, tags, schedules or by
     hand do not.
   - `e2e`: `{"task": "<id>"}` naming the task that runs the shipped
     fixtures through the real entrypoints end to end, or
     `"not-applicable: <reason>"` when the feature is not a data-transforming
     pipeline.
   - `approvals.premium`: `{"models": [...], "reason": "...", "approved_by":
     "...", "date": "..."}`, required whenever `gpt-6-astra` appears in any
     role — supervisor, executor, ladder rung, or `review`. The example
     above has none: its standard `gpt-6.1-sol` supervisor needs no
     approval.
   - `review`: required for a Codex plan that goes through ship (ship stops and asks without it), optional otherwise. Names the model
     and effort for ship's Stage 3 critical-review child, as an object,
     e.g.: `"review": {"model": "gpt-6-astra", "effort": "high"}` (premium,
     recorded in `approvals.premium`) or
     `"review": {"model": "gpt-6.1-sol", "effort": "high"}` (measured:
     strict review gate clean 10/10, planted 10/10; PR support 3/4 on
     2026-09-30; `gpt-6-sol` stays valid for approved plans).

   The linter enforces these: a plan missing `ci`, missing `e2e`, or
   missing a required `approvals.premium` fails lint. It also checks the
   optional `review` key's value and its `approvals.premium` pairing when
   present.

   Three more optional top-level keys also sit beside `waves`, read by the
   runner and validated by the linter (shape errors fail lint):

   - `worktree`: `{"links": [...], "writable": [...], "auto": true}` —
     `links` are repository-relative paths (never absolute, never
     containing a `..` segment) of untracked files that every fresh
     worktree and checkout gets as a symlink to `<repo>/<path>`; linked
     files are never opened, printed or copied. `writable` lists cache
     directories, absolute or `~/`-prefixed, a sandboxed Codex child may
     write. `auto` (default `true`) has the runner add auto-detected
     entries: `gradlew` at the repo root adds `$GRADLE_USER_HOME` or
     `~/.gradle` plus `~/.android` as writable, and `local.properties` as a
     link when it exists and is untracked; `Cargo.toml` adds `$CARGO_HOME`
     or `~/.cargo` as writable; writable directories that do not exist are
     dropped. `worktree-env.mjs`'s `resolveWorktreeEnv` and `applyLinks`
     act on this key when the runner sets up an executor's or the
     preflight's checkout.
   - `depends_on`: a list of `{"wave": <n>, "repo": "<path or \".\">",
     "ref": "<git ref>", "path": "<repo-relative path>"}`. The runner
     refuses to start wave `<n>` until
     `git -C <repo> cat-file -e <ref>:<path>` succeeds; `"."` means the
     plan's own repository.
   - `inherits`: a repository-relative path of a parent plan. When the
     child plan omits `ci`, `e2e`, `worktree`, `approvals` or `review`,
     `effectivePlan` (`worktree-env.mjs`) takes them from the parent for
     the runner and the linter. Only one level is followed; this key is
     for recovery and amendment plans.

   The model fields use this exact table:

   | Plan host | Allowed model fields |
   |---|---|
   | Codex | `gpt-6.1-sol`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` |

   New Codex plans route executors to `gpt-6.1-sol` and `gpt-6-luna` per
   shared Codex routing. `gpt-6-sol` remains valid so that already approved
   plans still execute, and it stays a valid review model for approved
   plans; the lower-cost final-review option is `gpt-6.1-sol` since
   2026-09-30. The GPT-5.6 IDs remain valid only so that already approved
   plans still execute.

   Codex also permits `gpt-6-astra` as supervisor and, only when separately
   approved with `astra_executor_reason: "<concrete reason>"`, as the initial
   executor or final explicit ladder rung. That metadata records a reason; it
   never establishes authorization. An Astra executor needs both
   `astra_executor_reason` and `approvals.premium` — the reason alone is not
   approval. A selected Astra executor requires a fresh separate Astra
   supervisor. Shared Codex routing defines operational choices and evidence
   limits; the Astra executor exception still needs approval.

   `gpt-5.6` is never a plan id. It is only an active-session alias after
   runtime-context normalization, not a model field. Every Codex supervisor
   and executor names an explicit effort; the runner never invents one.
   Every supervisor, executor, and ladder entry in one wave uses the same
   row. A mixed-provider wave is a planning defect to fix before Gate 2, not
   a request for the linter or runner to guess a provider. `branch` is
   always `wave/<id>`. The supervisor sits on the wave because execution is
   one runner invocation per wave.

   The ladder lists model transitions only. The executor and every ladder
   rung are distinct model transitions: never repeat the executor or a
   later rung. Same-model raised-effort rework is state-machine behavior,
   so do not invent duplicate same-model ladder entries.

3. **The prose half** — one `## Task <id>` section per task: the
   substantive description and context, with full code where the solution
   is known. At launch, multi-model composes each runner task as the json
   entry plus its prose section, verbatim. The heading rule is exactly
   `## Task <id>`, with the title on the next line, not on the heading
   line itself; lint rejects anything after the id.

## Converting an existing plan

When the plan starts from an existing draft (for example a superpowers
writing-plans file), rewrite each task's prose for the contract: no `git
commit` steps, no checkbox step lists copied as waves, and no instruction to
edit existing tests unless the contract pre-authorizes it by name. Measured:
string-patching a superpowers draft seeded a heading crash and a
contradictory test instruction.

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

Visual assets imported from design (icons, rasters) get an owner checkpoint
before their wave merges: a contact sheet shown to the user at the wave's
end, not first seen in the PR diff. Measured: icons exported with
baked-in backgrounds reached the PR.

Interaction triggers — what starts or stops an animation, what collapses on
scroll versus on keyboard — are product forks for Gate 1. Measured: a
collapse-on-scroll the user did not want shipped silently.

## Headless evaluation mode

When there is no user to answer gates (an eval harness runs you), skip both
gates and record every fork you would have asked under a section titled
`## Assumptions (would ask)` in the plan file. Deciding a product fork
silently is the failure this mode exists to measure. A headless run uses
standard supervisors only — `gpt-6.1-sol` for all-Luna waves; a wave that
would need `gpt-6-astra`, and any premium choice it would have asked the
user for, goes under `Assumptions (would ask)` instead, and the plan
carries no `approvals.premium` invented by the model. It also leaves the `review` key unset and records the review choice under `## Assumptions (would ask)`.

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
| Quoting a time or cost for the plan | The user plans around a number no model can predict — a real plan was quoted 7–16 hours and $60–250 | Show the plan's shape; never a duration or a price |
| One task per wave by default | A serial script paying wave overhead — one measured plan had 14 waves of one task each | Cut `files_allowed` by file, contract-first waves, independent chains side by side; explain real single-task waves under `## Parallelism` |
| A missing CI gate in `must_run` | The wave merges green while the repository's own CI fails | Derive `must_run` from `ci.commands`, scoped to the task's files |
| An unlisted fake of a changed interface | Dependents fail to compile after merge — measured: 9 modules, 2 fix waves | Seam audit lists every implementer and fake; add it to `files_allowed` or its test compilation to `must_run` |
| Prose contradicting `forbidden_moves` | The executor cannot satisfy both, so it picks on the user's behalf | Pre-authorize the exact edit by name in `forbidden_moves`, or drop the prose instruction |
| A titled `## Task` heading | Lint rejects anything after the id | `## Task <id>` alone; the title goes on the next line |
| A main-checkout-only preflight | The preflight passes on main but the task's own worktree lacks the same links or caches | Preflight the worktree each task actually runs in, not just the main checkout |
