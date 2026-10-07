# Codex-native supervised wave protocol

Execution controls are defined in [execution-cost-controls.md](execution-cost-controls.md):
explicit `supervision: "mechanical"` permits a deterministic green verdict;
other tasks retain the selected model supervisor. Artifact-cache opt-in and
per-task limits do not change model routes or premium authorization.

Use this protocol only for a Codex-only wave. The supervisor is the one chosen
at Gate 1 — the premium `gpt-6-astra`, or the standard `gpt-6.1-sol` for an
all-`gpt-6-luna` wave. An Astra executor or rung needs
`astra_executor_reason: "<concrete reason>"` and `approvals.premium`, which
never authorizes it by itself.
This is the host adapter for the
shared wave contract, mechanical verifier, supervisor verdict schema,
escalation ladder, and result review in the host-specific `WORKFLOW.md`; it does not redefine any of
them. Claude-only waves use `wave-runner.workflow.mjs` instead. A mixed or
unknown-provider wave stops before any agent is spawned.

All commands in this reference resolve from the multi-model skill base directory:
the sibling plan linter is `../super-plan/references/plan-lint.mjs`, and the
state helper is `references/codex-wave-state.mjs`. On Codex the entrypoint is
`skills-codex/multi-model/SKILL.md`, and every path in this reference resolves
from the shared directory `skills/multi-model` — from the Codex entrypoint
that is `../../skills/multi-model`. A lint-clean plan that the
user explicitly approved is authoritative for adapter execution: use its exact
provider, model, and effort fields; do not re-route or reject them against seed
profile recommendations. This does not permit mixed/unknown providers or bypass
lint and user approval.

The state helper is the only state machine. Never hand-edit its state, bypass a
helper action, write a fresh runner, force-remove a worktree, or substitute a
missing model with a default or alias. It accepts only the exact GPT model IDs
and effort values already linted in the plan. First use native `--resume-from <summary.json>` with a new `--out` to verify and review a clean pinned candidate without an executor. See `execution-cost-controls.md`. The sanctioned way to deliberately discard a stopped wave is the runner's `--reset`; its own printed `cleanup` lines (see "`summary.json` diagnostics" below) are a fallback only when the installed runner predates `--reset`. When `--reset` refuses (a dirty worktree or a live status), stop and ask the user — never run the printed lines to get past a refusal, since they force-remove. The runner never removes anything on its own when it stops — it preserves every state file, worktree and branch for
inspection — and `--reset` exists only for the orchestrator to run deliberately, after deciding the candidate must be discarded for a newly authorized implementation. `--reset` refuses on a dirty worktree or a live
status, renames the run directory to `<dir>.reset-<k>`, prints each deleted
branch tip with a restore command, and never runs a model; the printed lines
still need a fresh `--out`.

At `init`, the helper stores an initialized plan digest over the canonical
selected wave and each matching task's approved prose. A later status transition
is the only plan mutation excluded from that digest; changing prose, contracts,
models, efforts, or ladder rungs requires a new initialization. Native candidate recovery creates a new bound
state for an amended contract, retaining the earlier run artifacts and spent calls.

Mechanical verification is authoritative. A clean supervisor verdict cannot override blocking mechanical facts such as a failed `must_run`, an out-of-scope path, missing required evidence, an unsafe worktree, or an invalid base. Only a final attempt with clean verifier facts and a clean verdict can become merge-ready.

## Contents

- Default: the deterministic runner
- Toolchain caches, `.git` and linked files
- Commands and action loop

## Default: the deterministic runner

Default to launching a Codex wave with one command instead of driving the
action loop below turn by turn:

```sh
node references/codex-wave-runner.mjs --plan <plan> --wave <N> --repo <abs> \
  --base <pushed sha> [--jobs 3]
```

Run it as a background command and wait for it with long waits — not a
polling loop of short checks; the runner does its own polling of the Codex
children internally, and an orchestrator that also polls just burns turns on
top of it. When it finishes, read only its `summary.json` — never its
internal state files, worktrees, or child transcripts. Merge the `ok`
branches yourself in plan/task order exactly as step 9 below directs. On a
`stop` result, hand the returned verdicts and branch names to the user
exactly as step 8 below directs — do not retry outside the runner and do not
fall back to the native loop just because a task stopped.

`--repo` must be the checkout that holds the pushed feature branch — the one
`--base` is a commit of. Task worktrees nest under it
(`<repo>/.worktrees/wave-<task-id>`, `codex-wave-state.mjs:251`) and `init`
excludes `.worktrees/` (plus any linked paths) from that repo's `git status`
for you, via `excludeFromGit` writing the common dir's `info/exclude`
(called from `codex-wave-state.mjs:1299`) — do not
hand-add `.worktrees/` to `.gitignore` yourself.

The plan linter runs against `--base`, not the working tree: with `--base`
passed through, `plan-lint.mjs` reads `.github/workflows` and checks
`files_allowed`/path existence from that commit instead of disk
(`plan-lint.mjs:700-785`). The runner always passes `--base` to both the
initial lint and every derived per-task plan's lint (`codex-wave-runner.mjs:681-688,810-818`).

Why: measured on the 2026-09-22 ship run, the native action loop below —
driven one tool call at a time by the orchestrator model — was 72% of that
run's wall time and 63% of its cost, spent on the orchestrator's own
round trips rather than on the Codex children it was coordinating. The
runner performs the same helper-governed loop with no model in that loop.

A rework on the same rung — same model and effort as the task's previous executor
child, in the same runner process — runs `codex exec resume <thread>` in the task
worktree and sends only the prior verdict and the report reminder. A failed resume
falls back at once to a fresh launch with the full prompt, without spending an
extra attempt. The first attempt, an escalation, raised effort and a new runner
invocation (`--resume-from`, `--reset`) always start fresh.

The runner shells out to `codex exec` for every executor and supervisor
child (only supervisors run `--ephemeral`; executor threads persist), and each
child sets up its own sandbox — so the runner process itself
must run with no sandbox wrapped around it. On macOS, seatbelt sandboxes
cannot nest: launched from inside a Codex `workspace-write` sandbox, the
runner's `codex exec` children fail to start with `failed to initialize
in-process app-server client: Operation not permitted`, and once `~/.codex`
is granted as a writable root their shell commands instead fail with
`sandbox-exec: sandbox_apply: Operation not permitted` (measured 2026-09-24,
Codex CLI 0.155.1). Granting the outer sandbox more writable roots or
network access does not fix this — the failure is the nesting itself, not a
missing permission. Run the runner command as an escalated command outside
the Codex sandbox — one the user approves, with the host's normal filesystem
and network access — so the runner's `codex exec` children can set up their
own sandboxes uncontested. The runner checks this at start and, when it
cannot confirm it is running outside a sandbox, stops before spawning
anything with error `nested-sandbox` and exit code 2. If `codex exec` is
unavailable, or an escalated launch cannot be obtained, fall back to the
native loop below, which is unchanged and remains the protocol of record (it
needs the same `.git` write access for its helper `init` — grant `.git` as a
writable root with `--add-dir <repo>/.git`, or
`sandbox_workspace_write.writable_roots`, in the orchestrator's own sandboxed
session).

## Toolchain caches, `.git` and linked files

The runner resolves the wave plan's `worktree` key (see the Plan Format
section in `super-plan/SKILL.md`) once, via `resolveWorktreeEnv`, and reuses
the result for every child it spawns (`codex-wave-runner.mjs:719-720`). Every
executor and supervisor `codex exec` gets `--add-dir` for:

- the repository's git common dir (`gitCommonDir`, wrapping
  `git rev-parse --git-common-dir`), so a child can commit from a linked
  worktree — `codex-wave-runner.mjs:861` (executor), `:952` (supervisor);
- every directory in `worktree.writable` plus the auto-detected ones
  (`$GRADLE_USER_HOME`/`~/.gradle` and `~/.android` when `gradlew` exists at
  the repo root, `$CARGO_HOME`/`~/.cargo` when `Cargo.toml` does;
  `resolveWorktreeEnv`) — `codex-wave-runner.mjs:862` (executor), `:953`
  (supervisor). A writable directory that does not exist is dropped, not
  passed (`resolveWorktreeEnv`), and the runner warns to stderr about
  every one it skipped (`codex-wave-runner.mjs:721-724`).

Each child also gets `-c sandbox_workspace_write.writable_roots=[<its
worktree gitdir>, <git common dir>, <writable dirs>]`, and the preflight
the same with its own worktree gitdir (`worktreeGitDir`, wrapping `git
rev-parse --absolute-git-dir`). Codex CLI 0.159.0 keeps a linked
worktree's gitdir (`<repo>/.git/worktrees/<name>`) read-only even when the
common dir is `--add-dir`'d, so `git add` failed with `Unable to create
'.../index.lock': Operation not permitted` until the gitdir became an
explicit writable root (measured 2026-09-29; openai/codex #23661, #27418).

**Supervisor network parity.** The supervisor gets
`sandbox_workspace_write.network_access=true` under the exact same
`--executor-network` flag as the executor — `codex-wave-runner.mjs:864` and
`:955` both gate on `config.executorNetworkOn`; there is no separate
supervisor-network option.

**Links into four different checkouts.** `worktree.links` (untracked files
symlinked in, never opened) reaches every checkout a Codex child or the
verifier ever runs in, via the shared `applyLinks`:
the executor worktree, at `init` (`codex-wave-state.mjs:1297`); the
supervisor's own detached checkout (`codex-wave-runner.mjs:947`); the
mechanical verifier's disposable verification checkout
(`codex-wave-state.mjs:789`, inside `runContractSequence`); and the
preflight's detached worktree at the base commit
(`codex-wave-runner.mjs:507`).

**`--preflight` (default `on`).** Before any model child starts, the runner
probes every distinct `must_run` command from the wave's tasks against a
detached worktree at `--base`, sandboxed the same way an executor is but
with no model and no prompt: it runs `codex sandbox ... -- bash -c <cmd>`,
never `codex exec` (`preflightSandboxArgs`, `codex-wave-runner.mjs:478-486`,
called from `runPreflight`, `:495-532`). A command whose output matches a
known machine-failure signature (`detectEnvironmentBlock`,
e.g. a git lock, a read-only filesystem, a missing
Android SDK) stops the whole run right there, before any executor or
supervisor is spawned (`codex-wave-runner.mjs:754-770`). A red command with
no matching signature is only recorded, in case it is expected-red
(`codex-wave-runner.mjs:424-425,517`).

**`environment-blocked` status.** This is the terminal stop the machine, not
the work, produced — see ADR 009 (`docs/decisions/009-environment-blocked-and-worktree-env.md`).
It is set when: the preflight above matches a
signature (`codex-wave-runner.mjs:754-770`); an executor's report itself
has, as its first non-empty line (optionally backtick-wrapped, text after
the colon non-empty and not a `<placeholder>`), `environment-blocked:`
(`reportEnvironmentBlock`, `codex-wave-state.mjs:834-857`) — a marker
quoted anywhere else in the report does not count; a `must_run` command's own final verification
attempt matches a signature (`codex-wave-state.mjs:946-971`); an executor or
supervisor child times out, exits non-zero, or returns nothing, and its
captured stderr or event tail matches a signature
(`checkEnvironmentBlock`, `codex-wave-runner.mjs:445-449`, feeding
`appendAgentFailure`'s `kind === 'environment'` branch,
`codex-wave-state.mjs:705-712`); or a supervisor verdict itself carries a
violation of `class: 'environment'` (`codex-wave-state.mjs:1086-1088`). In
every case the task ends there: no retry, escalation or amendment follows.
Only the first of those paths — an executor or supervisor child that itself
errored (timeout, non-zero exit, empty result), classified `environment` by
`appendAgentFailure` — is never charged as an attempt at all; the
report-marker, must_run-signature and supervisor-verdict paths reach
`environment-blocked` after that attempt was already counted, but none of
the three ever retries, escalates, or reaches a supervisor for a verdict it
hasn't already reached. The orchestrator's job is to
fix the machine — the `worktree` key, `--add-dir`, symlinks — and re-run the
wave; it never amends the contract in response.

Commit signing is not a setting to change in the user's configuration: a
sandboxed executor cannot reach the SSH signing agent, so executors commit
unsigned (`git -c commit.gpgsign=false commit …`, stated in the executor
prompt) and integration re-commits each task signed (step 9). A
`signing-agent` or `commit-signing` stop therefore means the plugin is older
than this behaviour or the executor ignored the prompt: the task's
`tasks[].environment` carries a `hint` saying so (a marker-path stop,
`id: reported`, also carries the matched `signature`). Update the plugin and
re-run; never disable signing in the user's configuration. Diagnose first:
reproduce the failing step outside the sandbox with a side-effect-free probe
(for commit signing `git commit-tree -S -m probe "HEAD^{tree}"`, which exercises the signing program itself — `ssh-add -l` only lists the agent's keys; otherwise the failing command's dry-run form) before
asking the user to change anything.

Where to read the blocked line: in `summary.json`, a task's own record under
`tasks[].environment` (written by the state helper's `summarize`,
`codex-wave-state.mjs:1145-1216`) names the signature id and, when known, the
`must_run` command; `stopped[].environment` (written by the runner itself,
`codex-wave-runner.mjs:880-883,1020-1023`) carries the same for a child-error
classification the state helper only ever receives as
`{error:{kind:'environment'}}`. For the two pre-init stops below
(`depends-on-unmet`, and a `--preflight` match before any task worktree
exists), the runner writes no `--out` directory and no `summary.json` at
all — that run's summary JSON (with a `preflight.blocked` object naming the
command, signature id and line for the preflight case) goes to stdout only,
so read it there, not from a file.

**`depends-on-unmet` stop.** Before any worktree exists, the runner checks
the plan's `depends_on` entries for the selected wave against the live repo
(`checkDependsOn`, called from
`codex-wave-runner.mjs:730`). If any are unmet, the runner prints to stdout
(no `--out`, no `summary.json` file) the same shape,
`stopped: [{"task": "*", "reason": "depends-on-unmet"}]`,
and exits 1 without creating a single task worktree or state file
(`codex-wave-runner.mjs:731-741`).

A merge-ready summary also carries `afterIntegration`, the ready-to-run
`wave-cleanup.mjs` command for the integrated wave (step 9).

**`summary.json` diagnostics.** Every recorded child (executor or
supervisor) carries `stderrFile`, the path to its captured stderr
(`codex-wave-runner.mjs:876`, `:968`); `timedOut: true` plus `eventsTail`,
the last 10 truncated lines of its events file, when the per-child timeout
killed it (`codex-wave-runner.mjs:877`, `:969`, via `tailLines`,
`:436-437`); and, on a post-init `stop` (a task loop that reached `stop`
after `init` had already created its worktree, branch and state file), a
`cleanup` array of the exact
`git worktree remove --force ... && git branch -D wave/<task-id> && rm -f
<state-path>` commands to tear down every stopped task's worktree, branch
and state file (`buildCleanup`/`cleanupLine`, `codex-wave-runner.mjs:407-416`,
surfaced at `:1032` and `:1036`). The runner itself never runs these lines —
it preserves every state file, worktree and branch when it stops, exactly as
step 8 below says. The printed cleanup is the fallback for a runner older than `--reset`; run it only to re-run after fixing the machine: once every line has been run, the next invocation needs a fresh
`--out` (the old one is now stale). For deliberate candidate disposal the route is `--reset`, which
does the same teardown, refuses on a dirty worktree or a live status, and
moves the old run directory aside itself; a stop prints its exact `--reset`
command to stderr (`codex-wave-runner.mjs:1041-1043`). The two pre-init stops above
(`depends-on-unmet`, and a `--preflight` match) print no cleanup — nothing
was created yet, so fixing the machine and re-running is enough.

## Commands and action loop

The helper has exactly these seven commands:

```text
init  next  record-executor  verify  supervisor-prompt  record-verdict  summary
```

1. Run the canonical plan linter first. Stop on every linter error; do not
   repair a plan by hand during a live wave.

   ```sh
   node ../super-plan/references/plan-lint.mjs <plan-file> --repo <repo>
   ```

2. Resolve the exact fork point from the pushed default-branch tip and push it
   before spawning. Copy the full SHA from `git rev-parse origin/<default-branch>`;
   never use a local-only `HEAD`. Initialize one wave state and retain the
   returned state path:

   ```sh
   node references/codex-wave-state.mjs init \
     --plan <plan-file> --wave <N> --repo <absolute-repo> --base <pushed-full-sha>
   ```

   `init` creates the exact returned worktrees and `wave/<task-id>` branches.
   A conflict is a stop: preserve the existing worktree, branch, and state.
   After a deliberate decision to re-run, `--reset` clears the conflict.

3. Call `next --state <state-path>`. Perform exactly its one returned action.
   Do not infer a next action, synthesize a prompt, or advance a task yourself.
   Native coordination uses `spawn_agent`, `followup_task`, and `wait_agent`.
   Track every child handle with its role, exact model, and exact effort, plus
   whether that exact child remains available. Wait for a child’s final response
   with `wait_agent`. `followup_task` is allowed only when the new helper action
   has the same role, exact model, and exact effort and that exact child remains
   available; its message is the helper-returned prompt only. If no such child
   exists, or the model or effort changes, use a fresh `spawn_agent`. Never
   follow up an old child under a changed tuple.

   followup_task is optional, not an essential native capability. If
   followup_task is unavailable, use a fresh spawn_agent for the
   helper-returned action even when the tuple is unchanged. Report
   tool-unavailable only when spawn_agent or wait_agent is unavailable;
   missing followup_task never stops a wave.

   Every fresh spawn gets a collision-free `task_name` matching `[a-z0-9_]+`.
   Replace every hyphen in the helper's kebab-case task id with `_`, retain a
   monotonically increasing `spawn_id`, and form the name as
   `wave_<task_id>_<role>_<spawn_id>`.

4. For `spawn-executor`, use a matching available executor child only under the
   tuple rule above; otherwise spawn a new executor. The executor receives only
   the helper-returned `prompt` and works only in the exact returned `worktree`.
   Every new `spawn_agent` call explicitly passes the returned exact `model`
   and exact `effort` as `reasoning_effort`; a missing value stops the wave.

   ```js
   const task_id = action.task.replaceAll("-", "_")
   const spawn_id = ++spawnCounter
   await spawn_agent({
     task_name: `wave_${task_id}_executor_${spawn_id}`,
     fork_turns: "none",
     model: action.model,
     reasoning_effort: action.effort,
     message: action.prompt,
   })
   ```

   Record only the child’s final report, never hidden reasoning, tool traces,
   or an orchestrator paraphrase:

   ```sh
   printf '%s' '{"report":"<final report only>"}' | \
     node references/codex-wave-state.mjs record-executor \
       --state <state-path> --task <task-id>
   ```

5. For `verify`, run the helper’s mechanical verifier — do not ask a model to
   replace it:

   ```sh
   node references/codex-wave-state.mjs verify --state <state-path> --task <task-id>
   ```

   Then obtain the sole supervisor input from the helper:

   ```sh
   node references/codex-wave-state.mjs supervisor-prompt \
     --state <state-path> --task <task-id>
   ```

   The helper supplies the shared contract, verifier facts, redacted report,
   and existing supervisor prompt. Do not name or reveal executor identity in
   the supervisor prompt.

6. For `spawn-supervisor`, use the returned `model` and `effort`; never choose
   an alternative based on a label, availability guess, or default. The same
   tuple rule applies to
   supervisor retries: use `followup_task` only for the same role, exact model,
   and exact effort on an available supervisor child. Supervisor handles remain
   distinct from executor handles and never fork executor conversations,
   including an approved Astra same-model exception. On a changed model or
   effort, or no suitable live child, spawn a fresh supervisor. Pass the
   helper-returned supervisor prompt as its only task text, require its fixed
   verdict JSON, and pass that JSON unchanged to the recorder. A supervisor
   action after actual Astra execution carries helper evidence `sameModelReview:true` and
   `reviewContext:"fresh"`; an unused approved rung proves neither fact:

   ```js
   const task_id = action.task.replaceAll("-", "_")
   const spawn_id = ++spawnCounter
   await spawn_agent({
     task_name: `wave_${task_id}_supervisor_${spawn_id}`,
     fork_turns: "none",
     model: action.model,
     reasoning_effort: action.effort,
     message: supervisorPrompt.prompt,
   })
   ```

   ```sh
   printf '%s' '<fixed verdict JSON>' | node references/codex-wave-state.mjs \
     record-verdict --state <state-path> --task <task-id>
   ```

7. If a native agent or tool returns no result, has a transport failure, or is
   unavailable, record exactly one fixed payload at the applicable point:

   ```json
   {"error":{"kind":"null-result"}}
   ```

   ```json
   {"error":{"kind":"transport"}}
   ```

   ```json
   {"error":{"kind":"tool-unavailable"}}
   ```

   Send a fixed error to `record-executor` for an executor failure or
   `record-verdict` for a supervisor failure. Do not persist free-form
   transport output, request hidden reasoning, fabricate a report/verdict, or
   reinterpret an infrastructure failure as success.

8. After every recorder response, call `next` again and repeat exactly the
   returned action. `stop` preserves every state file and branch; return the
   helper summary, verdict history, and branch names to the user without retrying
   outside the helper.

9. On `merge-ready`, wait until the final wave result is merge-ready, then call
   `summary --state <state-path>`. Confirm every task is `ok`, then integrate
   each `ok` task branch in plan/task order with `git merge --squash
   wave/<id>` followed by one `git commit` per task, run outside the sandbox
   so the user's git configuration signs it, with the message `<task-id>:
   <first line of the executor's last commit subject>`. Never fast-forward or
   merge executor commits as-is: they are unsigned. Then run the shared
   full-wave review. After the wave's task branches are integrated, run the
   `afterIntegration` command from the runner's summary
   (`wave-cleanup.mjs`, same directory): it removes a task's worktree and
   `wave/<id>` branch only when a finished run accepted the task, the worktree
   is clean and the branch is already contained in the checked-out branch, and
   prints what it kept and why. Report every kept entry; never remove a kept
   entry yourself — name it and ask.
   End the completion summary with a `Left behind:` line: every branch,
   worktree, run record and temporary directory this run created that still
   exists, taken from `wave-cleanup.mjs --dry-run --records` plus any scratch
   directory you created outside the repository, or `Left behind: nothing`.
   Whenever something is left behind, also add an `After the merge:` line with
   the ready command: `wave-cleanup.mjs` with absolute paths, `--repo <repo>`,
   one `--plan` per plan this run executed, `--into origin/<default branch>`,
   `--records`, and `--branch <feature branch>` when the wave was integrated
   into a feature branch of its own. These two lines are required even when the
   request asks for a short final message or a fixed last line: put them before
   that line.
   Branch
   final integration on multi-model's publication contract, never on host or
   model. In normal `publication: push` mode, multi-model pushes and then
   derives the next wave’s exact base from the pushed branch and initializes its
   state with `init`, as before. In `publication: local` mode, merge only into
   the local feature branch, keep the shared full-wave review, return its
   resulting local commit(s), task branch names, helper summary, and verdict
   evidence to the caller, and do no push. Local mode does not derive or
   initialize a later wave from that unpushed base. If approved fixes need
   dependent bases that cannot safely fit in this one supervised wave, stop
   before publication. Do not merge early in a multi-task wave.

The action loop is intentionally narrow: helper state records reports, verifier
facts, and fixed verdicts only. It never stores credentials or hidden reasoning.
