# Delegated implementation workflow

Load this file only for delegated work, as required by SKILL.md.
Relative paths are based on this skill directory.

## Codex routing

Load `../../skills/multi-model/references/codex-routing.md` once. It governs
executor, research, supervisor and effort choice for every Codex wave. Read
`../../skills/multi-model/references/gpt-calibration-evidence.md` before making
any claim about what the calibration counts establish.

## Overview

The orchestrator researches, plans, routes, integrates, verifies, and publishes;
executors implement. Core principle: **decisions belong to the coordinator,
execution belongs to separately routed agents**. Every child has an explicit
model and supported effort selected from the shared routing rules; never inherit
either from the coordinator or infer identity from labels. Model equality is
allowed when task routing justifies it, not because of coordinator identity.
Effort advice is conditional on an already justified selection.

Always reply to the user in the language the user writes in — this skill being in
English does not mean English replies.

## Process

1. **Research.** Study the codebase to the depth needed for decomposition: files,
   dependencies, conventions. Any read-only fan-out is routed per
   `codex-routing.md` — research agents never inherit your model.
2. **Decisions.** Close the open questions BEFORE decomposing: research an
   incomplete specification further and pin down the interpretation (escalate
   fundamental choices to the user); design cross-cutting architecture yourself
   and hand it out as a set of concrete implementations. Do not delegate
   decisions even to the strongest executor — it silently fills in gaps under
   ambiguity.
3. **Plan.** Tasks: independent within their wave (no file overlap, otherwise —
   next wave or worktree), self-contained (the agent sees neither the conversation
   nor your research), closed (no "decide for yourself what's best"). Batch small
   same-shaped edits into one agent's task: parallelization pays only on hard
   chunks. Group for width by super-plan's **Design for width** rule:
   `files_allowed` cut by file, a contract-first wave before its parallel
   implementers, independent chains side by side. The decomposition covers ALL
   artifacts of the feature, including documentation (README and the like): if
   you froze a file for everyone, assign it to someone explicitly.

### Single-task path

Use it when the whole change is one task: one deliverable, one executor, `files_allowed` inside one module, and no second task in any wave. It changes only planning. Write the same plan file (one wave, one task) and lint it as usual. Skip the seam audit: with one task there are no seams between tasks, and the runner's preflight probes every `must_run` command at the base before any executor starts. The Gate 1 report and the Gate 2 start approval are one message: show the design summary and the lint-clean plan together, then wait for one approval. Execution uses the runner and independent verification, followed by integration by the coordinator. Model supervision remains the default; the explicit mechanical mode follows the shared cost controls. On this path the executor writes the task's code; the coordinator edits it only under rule 3. When the change grows to a second task, return to the full process. A change that rule 3 lets the coordinator make itself needs no plan at all.

4. **Table.** Before launching, show the user: task | model | effort | rationale.
   The table also shows, per wave, the supervisor and whether it is premium.
   When the plan comes from super-plan, the table is part of super-plan's
   start approval (its Gate 2): show it there, and wait on nothing else.
   Never a time or cost estimate — not in the table, a progress update or the
   completion summary (super-plan: "No time or cost estimates"). Premium
   models are never the subject of a question. A premium model (GPT-6 Astra,
   any role) is used only when the user said so: in this session, or
   through a standing authorization written in the user's or the
   repository's instruction files
   (`AGENTS.md`, `CLAUDE.md`), which counts as the user's choice and is
   recorded in `approvals.premium` with its source — never filled in by the
   orchestrator for a choice the user did not make. Without an authorization
   the table shows the standard route.
5. **Write the wave plan file** (see Wave plan artifact) with `status: active`,
   and record the base SHA. You do this, not the user. Once it is lint-clean and
   explicitly approved, preserve its exact provider/model/effort fields through
   execution; profile routes are not a second execution-time planner.
6. **Launch.** Read and follow
   `../../skills/multi-model/references/codex-wave-protocol.md`.
7. **Review** (see the checklist below). Fixes — as one concrete list. Two misses
   in the same place — fix the task spec, don't repeat the prompt.
8. **The final end-to-end review is the orchestrator's own.** **Choose
   the fix route yourself.** This holds for every change the coordinator has
   to make — a review finding, a supervisor's or the final review's defect,
   part of an approved plan. Never ask the user to approve a route or a model.
   The first rule decides whenever it applies:
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
   - **Delegated.** Anything else goes to a supervised wave on the standard
     route — a one-task supervised wave for a single defect. A supervised wave
     is the default for anything beyond a direct fix. Measured: in the
     2026-09-24/25 sessions, orchestrators wrote wiring and review fixes
     themselves and pushed them unreviewed.
   - **Checks of a direct fix.** Run the covering checks. A behavior change,
     including instruction/config text that changes actual behavior, also gets
     one independent check of the diff from a fresh agent on the standard
     review route when the host can spawn one. The report says plainly when no
     independent check ran. One logical fix per commit.
9. **Completion.** Codex uses the native helper's bounded attempts from shared
   Codex routing. Integrate each `ok` task with `git merge --squash` per
   `../../skills/multi-model/references/codex-wave-protocol.md` step 9 — never a
   plain merge or fast-forward of executor commits. Run the plan's
   `ci.commands` exactly (in addition to the offline suite) before the final
   wave's push, not after — with `ci: "none: <reason>"` there is nothing extra
   to run. A red `ci.commands` entry stops completion exactly like a red
   offline suite: fix it, don't push through it. The only push while red is
   the one to the feature branch as the base of a one-task supervised fix
   wave (ship's failure map), made without asking and reported — never to
   the default branch, never a PR. At the end a summary: done / verified /
   remaining.
   **Set the wave plan's `status: done`** in the same breath — an open plan
   keeps the drift hook paying for a wave that ended.

**Clean up what the run created.** After each wave's `ok` branches are
integrated, run the runner's printed `afterIntegration` command (the cleanup
script, `../../skills/multi-model/references/wave-cleanup.mjs`). It removes only the worktrees and `wave/<id>`
branches of tasks a finished run accepted, clean and already integrated, and
lists what it kept with the reason; a running, stopped or rejected task always
stays. Run records (`summary.json`, verdicts, state files) stay until the pull
request is merged, because review and `--resume-from` read them. The
completion summary carries a `Left behind:` line: every branch, worktree, run
record and temporary directory this run created that still exists — taken from
`wave-cleanup.mjs --dry-run --records` plus any scratch directory the
orchestrator itself created outside the repository — or `Left behind: nothing`.
Whenever something is left behind, the summary also carries one line starting
`After the merge:` with the ready command — `wave-cleanup.mjs` with absolute
paths, `--repo <repo>`, one `--plan` per plan this run executed (fix plans
included), `--into origin/<default branch>`, `--records` and `--branch <feature
branch>` (without `--branch` when the wave was not integrated into a feature
branch of its own). When the user confirms the integration branch is merged,
run that command at once and report: delete the remote feature branch only if
the script reported the local feature branch removed and the remote branch tip
equals the `tip` it printed; everything the script kept is named and asked
about. Remove only what this run created, clean and already integrated; anything
else is named and asked about, never deleted.

**Scope of a bypass.** The user's instruction to implement directly covers
exactly what the user named, review fixes included. Record that scope in the
plan and state the same scope in the PR body. Outside that scope the
coordinator chooses the route by step 8. Critical-review's findings gate still
applies regardless of the bypass: the user sees the findings before any fix
starts. Set the plan's `status: done` with a note recording the bypass and its
scope, not a free-text status in place of `done`.

**Stop handling.** A stop is `failed`, `error`, `contract-unsatisfiable`, or
**`environment-blocked`** — the environment itself is broken, not the
contract or the task's work: name the failing command and its exact error
line, fix the machine, and re-run, rather than treating a broken environment
as a contract defect (diagnose first — Codex session rules, rule 4). For a wave run by the Codex runner, `environment-blocked` means a machine
block: a sandbox-only block — a `must_run` command blocked inside the sandbox
and clean outside it — is handled by that runner and never reaches the
coordinator as a stop.
A stop
the coordinator can resolve itself is resolved and reported without a
question: an environment fix and a relaunch of the same approved plan or
route, and recovery inside the approved plan, need no new approval. A stop
that needs the user ends with one recommended next action, phrased as a
yes/no question for the user to approve or decline.

**Decide, act, report.** Ask the user only for: a contradiction in the
feature (the plan, the design, the code or a new instruction disagree and the
choice changes what ships); a change of the agreed scope; weakening or
removing a test or check; an irreversible action on something this run did
not create; an action only the user can take. Everything else: decide, act,
report. Publication of the user's own work needs no question: after
verification is green, push to the feature branch of the user's own pull
request and report what was pushed. Ask once before replies or resolves in
threads started by someone else, and before pushing to a branch or pull
request that is not the user's own. The merge into the default branch stays
with the user unless the user says otherwise.

The orchestrator reads targeted ranges itself when a focused lookup answers
its question; use `git diff --stat` to locate the scope. Delegate substantial,
self-contained research, not a trivial file lookup. Do not load whole files,
diffs or transcripts into the coordinator just to relay them to a child. Do not
keep a journal that duplicates state a helper or runner already holds — the
wave plan, the state files, and `summary.json` are the record. And it waits
on a running agent or runner with long waits, not frequent polls — a
polling loop burns turns on the orchestrator's own round trips instead of on
the work it is waiting for.

## Routing anti-patterns

No sub-orchestrators — executors never spawn their own subagents (documented
failures in deep delegation chains: status honesty, not capability). Don't give
any executor untrusted external content without platform safeguards.

## Research agents

Research children are spawned with the route from `codex-routing.md` and always
name model and effort. Research is gathering, not deciding — the decisions stay
in the orchestrator seat. Every research agent's prompt carries these lines:

- every claim carries evidence as `file:line`, or as a command plus its output;
- `not found` is a valid and expected answer — never fill a gap with a guess;
- read the sources: answering from memory about library or system behavior is
  forbidden;
- never open, print, copy or transmit credentials, tokens or configuration
  files that hold them (for example `~/.codex`, `~/.claude`, app configs with
  Authorization headers); if the research needs a secret, stop and report;
- quote globs in shell commands: the shell may be zsh, where an unquoted
  `--include=*.kt` fails with "no matches found";
- a claim that a build task or target exists cites the build tool's own
  listing;
- a read-only agent returns its report as text and never writes files.

## Wave isolation

A supervised wave gives every executor **its own git worktree** and commits its
work to a branch named `wave/<task-id>`. Record the base SHA in the wave plan
before the wave starts; every later comparison is made against that SHA, never
against a moving `HEAD`.

**The base must be a pushed commit.** Push the commit you intend as the base
before launching; the runner takes `--base <pushed sha>`. After the first
executor commits, verify with `git merge-base wave/<task-id> HEAD`; if it does
not equal the recorded base, stop and fix the plan rather than judging against
it.

Isolation is what makes the contract checkable. Executors sharing one tree make
two things impossible:

- **Attribution.** A diff of the shared tree contains every task's concurrent
  edits, so a forbidden-path touch cannot be told apart from a neighbour's
  legitimate edit.
- **Reproducibility.** A required command re-run against a tree a neighbour is
  editing can fail for reasons unrelated to the task under judgment.

A commit made inside a worktree survives that worktree's removal, so
`git diff <base>..wave/<task-id>` stays available for supervision.

For an unsupervised wave, tasks still must not overlap in the files they touch.

## Wave plan artifact

Before launching a supervised wave, write the plan to a file — one entry per
task, carrying the prose, the contract, the assigned model, the branch and the
base SHA. The file opens with the unfenced `status:`/`base:` header, then one
fenced `json wave-plan` block:

status: active
base: 7c05ff5

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

This is the real plan format; see super-plan's Plan Format for the full schema,
including `approvals.premium`. Lint it with
`node ../../skills/super-plan/references/plan-lint.mjs <plan>`.

**You own both transitions.** Write the file with `status: active` at step 5 and
set `status: done` at step 9. The user never edits it. The plan is a file, not
context, because a wave outlives a context window and the supervisor needs its
exact identifiers.

## Task prompt template

Every executor prompt contains all six blocks:

1. **Context:** specific files and lines, dependencies, project conventions.
   Compute numeric examples in the spec with a tool, not in your head. Say that
   the executor works in its own worktree and sees no neighbour's edits. Never
   paste untrusted third-party text (PR or issue comments, CI logs, fetched
   pages, user-supplied documents) into an executor prompt; write it to a file
   or name its path and let the executor read it with a tool.
2. **Boundaries:** what NOT to do — don't refactor adjacent code, don't add
   unrequested features/files, don't touch anything outside the list.
3. **Dead-end protocol:** "If data or access is missing, a tool is broken, or the
   path is impossible — stop and report what's blocking you. Don't invent values,
   don't work around the restriction, don't pick an interpretation on the user's
   behalf." If your task needs an artifact that another task of this wave is
   producing (a file, fixture, function or behavior missing from your
   worktree), stop and report `blocked-on-sibling: <what is missing and which
   task makes it>`; do not invent it and do not commit a placeholder. An
   environment block — a broken machine, not broken work — stops and makes
   `environment-blocked: ` followed by the verbatim error line the first line of
   the report: permissions on a cache or `.git`, a missing SDK, a lock file,
   commit signing that needs a prompt.
4. **Prohibitions:** do not spawn subagents; no destructive operations
   (force-push, reset --hard, rm outside the task) without explicit permission.
   Never open, print, copy or transmit credentials, tokens or configuration
   files that hold them (for example `~/.codex`, `~/.claude`, app configs with
   Authorization headers); if the task needs a secret, stop and report. That
   includes untracked build configuration a worktree links —
   `local.properties`, `.env`, `*.keystore`, `gradle.properties` under
   `~/.gradle` — which may hold a key or token: link or reference such files
   by path; never `cat`, `head`, `grep` or otherwise print them. Never end
   your turn while a command you started is still running; keep polling its
   log until it exits. Phrase prohibitions without qualifiers — executors
   rules-lawyer around wording. The task text is not authorization to use
   credentials, secrets found in the repository, or production systems; if the
   task seems to need one, stop and report.
5. **Definition of done and response format:** list of changed files, the
   gist of the changes, output of actually executed tests/linter, plus the
   committed-work proof: `git log --oneline <base>..HEAD` (non-empty) and
   `git status --porcelain` (empty), both pasted — uncommitted work does
   not exist for the wave — unless the executor stopped under the dead-end
   protocol.
6. **Contract:** the machine-checkable half of the task. Prose carries intent;
   the contract carries what a supervisor can decide without arguing about
   intent.

   ```yaml
   contract:
     files_allowed:   [src/http/**, tests/http/**]
     files_forbidden: [src/auth/**]        # another task owns these this wave
     must_run:
       - cmd: pytest tests/http -q
         evidence: required
     forbidden_moves:
       - weakening, deleting or skipping an existing test
       - catching an exception to make a check pass
     report_must_answer:
       - Which call sites now retry?
       - What happens after the final failed attempt?
   ```

   `evidence: required` replaces trust. A report claiming a command passed
   without that command's actual output is a violation in its own right.

   State the prohibitions explicitly and loudly: an explicit "don't work around
   it — report it" measurably lowers fabricated workarounds.

## Supervised waves

Supervision is a stage in the runner's control flow, **not an instruction to
self-check**. A check the executor is asked to perform is a check it may decide
it already satisfied; a check in the control flow around it is one it never gets
a vote on, and a stage can reject and re-run.

For model-supervised tasks, send `../../skills/multi-model/references/supervisor-prompt.md` to a fresh
separate supervisor with the contract, report, base SHA and branch. It never
reuses an executor child or forks its conversation, even when model and effort
match.

### Mechanical verification before the judge

The runner runs a cheap fact-collecting verifier before the judge: a branch
with no commits, a path outside `files_allowed`, a red `must_run` or missing
pasted evidence bounces straight back as rework without a judge. The verifier
does not decide semantic obligations. An explicitly mechanical task with green
independent facts receives the runner's deterministic verdict; other tasks retain
the model judge. A clean verdict never overrides a blocking mechanical fact.
Details: `../../skills/multi-model/references/execution-cost-controls.md`.

### Choosing the supervisor

- Pick the supervisor per `codex-routing.md`, at effort `high`.
- Use a fresh separate supervisor, never the executor's own model — except
  Astra's separately approved executor exception, which uses a fresh Astra
  supervisor (fresh-context separation, not different-model independence).
- Never a weaker tier than the executor's: the judge re-runs and re-derives
  everything the executor did.
- A wave has one supervisor: pick it by the strongest model any task in the
  wave can run, ladder rungs included. A supervisor that is also a rung is
  rejected.
- **Premium models.** `gpt-6-astra` is premium, in any role. Premium models are
  never the subject of a question. It is used only when the user said so: in
  this session, or through a standing authorization written in the user's or
  the repository's
  instruction files (`AGENTS.md`, `CLAUDE.md`), which counts as the user's
  choice. The plan records it in `approvals.premium`; the linter enforces it. `approvals.premium` keeps its
  four fields — `models`, `reason`, `approved_by`, `date`: the source of the
  authorization goes into `reason` (for example "standing authorization in
  AGENTS.md" or "user's instruction in this session"), and `approved_by` stays
  `"user"`. An authorization given for a pull request or task covers its later
  fix and recovery waves while the models and roles stay the same. Without an
  authorization use the standard route; when no standard delegated route fits,
  fix directly per step 8. The report notes in one line where a premium route
  would have applied. The standard supervisor `gpt-6.1-sol` covers waves
  whose executors and rungs are all `gpt-6-luna`.
- Never name the executor's model in the judge prompt.

**The supervisor trusts artifacts only.** A verdict is `{"ok", "violations",
"remarks"}`, and only `violations` decide `ok` — doubts go to `remarks`.
`pasteReproduced: false` is a recorded fact, never an accusation; repetition is
what escalates. Before judging or acting on a verdict, read
`../../skills/multi-model/references/verdicts.md`.

### Escalation ladder

| Situation | Action |
|---|---|
| 1st violation | Back to the same executor with the verdict attached |
| 2nd violation of the same rule | To a stronger model — repeating a prompt on the model that just failed it reproduces the failure |
| `pasteReproduced: false` on two attempts | Escalate to a stronger model: once is explicable, twice is a pattern |
| Executor is already the strongest model, or the wave has no ladder | No higher rung: one rework with the verdict attached, then stop |
| The contract cannot be satisfied | Stop immediately — no rework, no stronger model; see When the contract is what is broken |
| Stop | Hand the user the task, every verdict in order, and the branch name |

The native runners continue the same executor session for that rework and send only the verdict, not the full prompt again. An escalation to a stronger model, raised effort, a new runner invocation (`--resume-from`, `--reset`) or a failed resume starts a fresh executor with the full prompt; a failed resume costs no extra attempt. Supervisors are always fresh.

Never reset attempt counters to obtain more attempts.

## Host adapter (Codex)

### Invocation publication contract

`publication` is optional: if omitted, it means exactly `publication: push`
and preserves all normal behavior. Only `publication: local` must be explicit;
only the enclosing critical-review post-review fix flow may request it; it is
never inferred from host or model.

Local mode never weakens lint, the pushed-base requirement, contracts,
mechanical verification, supervision, verdicts, plan-order integration, or the
full-wave review. It returns the resulting local feature-branch commit(s), task
branch names, and state/verdict evidence to the caller, and performs no push.
The wave still forks from the current pushed PR head. If approved fixes need
dependent bases that cannot safely fit in that one supervised wave, stop before
publication rather than push around the gate.

### Launching a Codex wave

Read and follow `../../skills/multi-model/references/codex-wave-protocol.md`.
Its default adapter is the shipped runner:

```sh
node ../../skills/multi-model/references/codex-wave-runner.mjs --plan <plan> --wave <n> --repo <abs> --base <sha>
```

- Launch it as an escalated command outside the Codex sandbox, never inside a
  sandboxed Codex session — nested sandboxes fail (see the protocol). Wait on
  it with long waits; when it finishes, read only its `summary.json`.
- First continue a clean committed candidate with `--resume-from <summary.json>`
  and a new `--out`, per `execution-cost-controls.md`. Reset only to deliberately
  discard it for a newly authorized implementation:
  `node ../../skills/multi-model/references/codex-wave-runner.mjs --reset --plan <plan> --wave <n> --repo <abs> --base <sha>`.
- Integrate each `ok` task with `git merge --squash` in plan/task order per
  `../../skills/multi-model/references/codex-wave-protocol.md` step 9 — never a
  plain merge or fast-forward of executor commits.
- An Astra executor needs both `astra_executor_reason` and
  `approvals.premium` — one records the reason, the other is the approval.
- Mixed or unknown-provider wave: stop before spawning and return the linter or
  identity error.

Every Codex spawn names model and reasoning_effort from the exact returned
action. Never write a fresh runner, hand-edit state, or replace a missing model
with a default or alias. If `codex exec` is unavailable or an escalated launch
cannot be obtained, fall back to the native action loop in the protocol.

For a lint-clean, explicitly user-approved plan, the approved plan is
authoritative for adapter execution: use its exact provider, model, and effort
fields without re-routing; lint and the mixed/unknown-provider stop still apply.

## When the contract is what is broken

`ok:false` with `satisfiable:false` stops the task at once — no rework, no
stronger model. Read and follow
`../../skills/multi-model/references/contract-amendment.md` (amending is your
job; removing or weakening a check is a yes/no question to the user).

### Cost discipline

Read `../../skills/multi-model/references/execution-cost-controls.md` before
adding mechanical-only contracts, cache opt-in or per-task limits.

- Scope contracts to the deliverable and affected checks. A small diff can change
  behavior: choose supervision by the contract's risk, not its line count.
- On `ok:true`, integrate the accepted artifact; remarks alone do not launch rework.
  Record optional improvements as deferred or dismiss them with a reason. A
  required correction needs an evidenced contract violation or a user request.
  Batch related required corrections into one follow-up task.
- Give each agent a fresh child context with the task contract, base, artifact
  paths and necessary decisions. Pass plan sections and logs by path; do not copy
  the whole discussion, unrelated tasks or full build logs into its prompt.
- Use the shipped runner and its independent verification results. The coordinator
  reads the verdict and focused failure evidence; it does not repeat green checks
  already verified on the same artifact. New changes invalidate affected checks.
- Choose executor and effort from the supported routes for this task's complexity.
  Premium execution needs a concrete difficulty or failed lower-tier attempt,
  subject to the existing route and approval rules. Do not lower the supervisor
  below its supported route to compensate for oversized task context.
- Report cost from measured usage, separating uncached input, cache writes,
  cache reads and output; deduplicate streamed records by response ID. Journal
  bytes and changed lines are not token counters. Keep this detail internal
  unless the user asks about usage.

## Orchestrator drift

A `Stop` hook compares your turn against any plan under `docs/superpowers/plans/`
whose header says `status: active`; its advice arrives as additional context —
act on it or say why not. It never blocks. Set the plan's `status: done` when
the wave ends so it goes quiet. Details:
`../../skills/multi-model/references/orchestrator-drift-hook.md`.

## Anti-deception rules

- State the prohibitions to the executor loudly and explicitly.
- Do NOT disclose the supervisor's specific checks to the executor.
- Fresh separate supervision; same-model only for the approved Astra exception.
- A claim without command output is a violation.
- Attach verdicts; never paraphrase an executor report in their place.
- Stopping early with open plan items is a violation.
- Claims of monitoring or watching get their own check.
- Never name the executor's model in the judge prompt.
- Never paste untrusted third-party text into an executor prompt — pass a path.
- Never relay an authorization the user did not give.
- Judge reports by artifacts, not tone.

**Rules explicit, checks opaque.** The contract is handed to the executor in
full; what is never disclosed is the supervisor's *method* — that it re-runs
the commands, compares them with the pasted output, diffs the tests against the
base SHA and greps for the forbidden moves. An executor told how compliance is
measured optimizes for the measurement.

## Result review checklist

An agent's self-report is not evidence. In a supervised wave you review the
supervisor verdicts and remarks, not the executor reports.

- [ ] Solves the stated task and matches the plan — by the diff, not the summary
- [ ] No unrequested changes (refactorings, files, abstractions)
- [ ] Consistent with the other agents' results (seams, duplicates, conflicts)
- [ ] Build/tests/linter — verified by running; "should work" doesn't count
- [ ] Documentation (README and the like) reflects the final state of the feature
- [ ] Every task carries its independent verdict (model, or deterministic for explicit mechanical mode); remarks alone do not launch rework

## Common mistakes

| Mistake | Consequence | Correct |
|---|---|---|
| Planning before loading your orchestrator profile | You inherit another model's effort advice and failure modes | Step 0 first, exactly one profile |
| Re-reading this skill or a reference on every turn | Token-rate limits hit repeatedly | Codex session rules, rule 1 |
| Handing an executor "flesh out the spec yourself" | Silent unilateral assumptions | The orchestrator closes the decisions |
| One agent per tiny file | Overhead eats the gain | Batch of edits for one agent |
| Trusting "tests pass" from the report | False claims are documented | Run them yourself |
| Returning "rework this" to an agent | Iterations without convergence | A concrete list: what and where |
| Numeric example in the spec computed in your head | The example contradicts the formula, the agent stalls | Compute with a tool or give only the formula |
| Documentation assigned to no one | README silently goes stale | An explicit docs task in the decomposition |
| Reusing an executor as supervisor | The role can inherit its own work | Fresh distinct role handle; supervisor per `codex-routing.md`, never named to the judge |
| Telling the executor how compliance is measured | Grader awareness turns compliance performative | Rules explicit, method undisclosed |
| Accepting a claim with no command output | The cheapest fabrication passes untouched | `evidence: required`, and compare it with your own re-run |
| Asking a supervisor to judge whether a mismatch was dishonest | It reaches for the heaviest label | Record `pasteReproduced` as a fact; let repetition carry the consequence |
| Blocking on suspicion rather than on a contract violation | Correct work is stopped | Doubts go to `remarks`; only violations block |
| Recording an unpushed local `HEAD` as the wave base | Every comparison is made against a commit the wave cannot rely on | Push the base commit; verify with `git merge-base` after the first commit |
| Amending a contract in conversation only | The amendment reaches nobody | Edit and lint the plan per `contract-amendment.md`; recover its pinned candidate |
| A full-repo gate in a per-task contract | Wall-clock multiplied by the task count | Scope `must_run` to the task's module; the full gate runs once per wave at merge |
| Reading an environment block as a contract defect | An amendment or escalation is spent on a broken machine | Stop as `environment-blocked`: probe, fix the machine, re-run |
| Re-running a stopped wave with hand-written cleanup | State and branches drift from the runner's record | The runner's `--reset`, then re-run |
| Applying a subagent's patch yourself without the checks of a direct fix | Unchecked code reaches the branch | It is authoring code (rule 3): run the covering checks and show the diff; a behavior change also gets one independent check |
| Refusing or re-asking after the user's direct instruction ("fix it yourself", "no agents", "use this model") | The work waits on a question nobody needed | Do exactly what the user said, whatever the change is; record the scope in the plan |
| Asking the user to approve a fix route or a premium model | The run stops on a decision the coordinator owns | Choose the route by step 8; premium only on the user's word or a standing authorization in instruction files, otherwise the standard route |
| Leaving worktrees and `wave/*` branches after integration | Clutter accumulates across runs (measured 2026-10-07: five worktrees, five branches and three run-record directories were left after a merged pull request) | Run the printed `afterIntegration` command after each wave and list the rest under `Left behind:` |

## References

- `../../skills/multi-model/references/codex-routing.md` — executor, research,
  supervisor and effort routing for Codex waves. Load once.
- `../../skills/multi-model/references/gpt-calibration-evidence.md` — what the
  GPT calibration counts establish and their limits.
- `../../skills/multi-model/references/codex-wave-protocol.md` — the Codex wave
  protocol: runner, toolchain caches and `.git`, native action loop, step 9
  integration.
- `../../skills/multi-model/references/codex-wave-runner.mjs` — the shipped
  runner, including `--reset`.
- `../../skills/multi-model/references/supervisor-prompt.md` — the supervisor
  prompt.
- `../../skills/multi-model/references/verdicts.md` — the verifier stage, the
  verdict shape and the blocking threshold.
- `../../skills/multi-model/references/contract-amendment.md` — the contract
  amendment flow.
- `../../skills/multi-model/references/orchestrator-drift-hook.md` — the `Stop`
  drift hook.
- `../../skills/super-plan/references/plan-lint.mjs` — the plan linter.
- The GPT orchestrator profiles listed in Step 0 — load exactly one.
