# Codex-native supervised wave protocol

Use this protocol only for a Codex-only wave. The supervisor is the one chosen
at Gate 1 — the premium `gpt-6-astra`, or the standard `gpt-6-sol` for an
all-`gpt-6-luna` wave. An Astra executor or rung needs
`astra_executor_reason: "<concrete reason>"` and `approvals.premium`, which
never authorizes it by itself.
This is the host adapter for the
shared wave contract, mechanical verifier, supervisor verdict schema,
escalation ladder, and result review in `SKILL.md`; it does not redefine any of
them. Claude-only waves use `wave-runner.workflow.mjs` instead. A mixed or
unknown-provider wave stops before any agent is spawned.

All commands in this reference resolve from the multi-model skill base directory:
the sibling plan linter is `../super-plan/references/plan-lint.mjs`, and the
state helper is `references/codex-wave-state.mjs`. A lint-clean plan that the
user explicitly approved is authoritative for adapter execution: use its exact
provider, model, and effort fields; do not re-route or reject them against seed
profile recommendations. This does not permit mixed/unknown providers or bypass
lint and user approval.

The state helper is the only state machine. Never hand-edit its state, bypass a
helper action, write a fresh runner, force-remove a worktree, or substitute a
missing model with a default or alias. It accepts only the exact GPT model IDs
and effort values already linted in the plan.

At `init`, the helper stores an initialized plan digest over the canonical
selected wave and each matching task's approved prose. A later status transition
is the only plan mutation excluded from that digest; changing prose, contracts,
models, efforts, or ladder rungs requires a new initialization.

Mechanical verification is authoritative. A clean supervisor verdict cannot override blocking mechanical facts such as a failed `must_run`, an out-of-scope path, missing required evidence, an unsafe worktree, or an invalid base. Only a final attempt with clean verifier facts and a clean verdict can become merge-ready.

## Contents

- Default: the deterministic runner
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
(`worktree-env.mjs:144-154`, called from `codex-wave-state.mjs:1257`) — do not
hand-add `.worktrees/` to `.gitignore` yourself.

The plan linter runs against `--base`, not the working tree: with `--base`
passed through, `plan-lint.mjs` reads `.github/workflows` and checks
`files_allowed`/path existence from that commit instead of disk
(`plan-lint.mjs:700-785`). The runner always passes `--base` to both the
initial lint and every derived per-task plan's lint (`codex-wave-runner.mjs:513-521,613-621`).

Why: measured on the 2026-09-22 ship run, the native action loop below —
driven one tool call at a time by the orchestrator model — was 72% of that
run's wall time and 63% of its cost, spent on the orchestrator's own
round trips rather than on the Codex children it was coordinating. The
runner performs the same helper-governed loop with no model in that loop.

The runner shells out to `codex exec` for every executor and supervisor
child, and each child sets up its own sandbox — so the runner process itself
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

The runner resolves the wave plan's `worktree` key (see "Shared definitions"
in the friction plan) once, via `resolveWorktreeEnv`, and reuses the result
for every child it spawns (`codex-wave-runner.mjs:551-552`). Every executor
and supervisor `codex exec` gets `--add-dir` for:

- the repository's git common dir (`git rev-parse --git-common-dir`,
  `worktree-env.mjs:80-85`), so a child can commit from a linked worktree —
  `codex-wave-runner.mjs:689` (executor), `:777` (supervisor);
- every directory in `worktree.writable` plus the auto-detected ones
  (`$GRADLE_USER_HOME`/`~/.gradle` and `~/.android` when `gradlew` exists at
  the repo root, `$CARGO_HOME`/`~/.cargo` when `Cargo.toml` does;
  `worktree-env.mjs:99-122`) — `codex-wave-runner.mjs:690` (executor), `:778`
  (supervisor). A writable directory that does not exist is dropped, not
  passed (`worktree-env.mjs:118-119`), and the runner warns to stderr about
  every one it skipped (`codex-wave-runner.mjs:554-557`).

**Supervisor network parity.** The supervisor gets
`sandbox_workspace_write.network_access=true` under the exact same
`--executor-network` flag as the executor — `codex-wave-runner.mjs:691` and
`:779` both gate on `config.executorNetworkOn`; there is no separate
supervisor-network option.

**Links into four different checkouts.** `worktree.links` (untracked files
symlinked in, never opened) reaches every checkout a Codex child or the
verifier ever runs in, via the shared `applyLinks` (`worktree-env.mjs:124-139`):
the executor worktree, at `init` (`codex-wave-state.mjs:1255`); the
supervisor's own detached checkout (`codex-wave-runner.mjs:772`); the
mechanical verifier's disposable verification checkout
(`codex-wave-state.mjs:787`, inside `runContractSequence`); and the
preflight's detached worktree at the base commit
(`codex-wave-runner.mjs:472`).

**`--preflight` (default `on`).** Before any model child starts, the runner
probes every distinct `must_run` command from the wave's tasks against a
detached worktree at `--base`, sandboxed the same way an executor is but
with no model and no prompt: it runs `codex sandbox ... -- bash -c <cmd>`,
never `codex exec` (`preflightSandboxArgs`, `codex-wave-runner.mjs:448-456`,
called from `runPreflight`, `:462-497`). A command whose output matches a
known machine-failure signature (`detectEnvironmentBlock`,
`worktree-env.mjs:24-42`, e.g. a git lock, a read-only filesystem, a missing
Android SDK) stops the whole run right there, before any executor or
supervisor is spawned (`codex-wave-runner.mjs:658-671`). A red command with
no matching signature is only recorded, in case it is expected-red
(`codex-wave-runner.mjs:406-407,482-487`).

**`environment-blocked` status.** This is the terminal stop the machine, not
the work, produced — see "Status `environment-blocked`" in the friction
plan's shared definitions. It is set when: the preflight above matches a
signature (`codex-wave-runner.mjs:658-671`); an executor's report itself
starts a line with `environment-blocked:` (`reportEnvironmentBlock`,
`codex-wave-state.mjs:832-856`); a `must_run` command's own final verification
attempt matches a signature (`codex-wave-state.mjs:944-969`); an executor or
supervisor child times out, exits non-zero, or returns nothing, and its
captured stderr or event tail matches a signature
(`checkEnvironmentBlock`, `codex-wave-runner.mjs:427-432`, feeding
`appendAgentFailure`'s `kind === 'environment'` branch,
`codex-wave-state.mjs:703-711`); or a supervisor verdict itself carries a
violation of `class: 'environment'` (`codex-wave-state.mjs:1084-1086`). In
every case the task stops immediately: it is never charged as an executor
attempt, never sent to a supervisor for a verdict it hasn't already reached,
and never routed to the contract-amendment flow. The orchestrator's job is to
fix the machine — the `worktree` key, `--add-dir`, symlinks — and re-run the
wave; it never amends the contract in response.

**`depends-on-unmet` stop.** Before any worktree exists, the runner checks
the plan's `depends_on` entries for the selected wave against the live repo
(`checkDependsOn`, `worktree-env.mjs:156-165`, called from
`codex-wave-runner.mjs:561`). If any are unmet, the runner writes
`summary.json` with `stopped: [{"task": "*", "reason": "depends-on-unmet"}]`
and exits 1 without creating a single task worktree or state file
(`codex-wave-runner.mjs:562-574`).

**`summary.json` diagnostics.** Every recorded child (executor or
supervisor) carries `stderrFile`, the path to its captured stderr
(`codex-wave-runner.mjs:703`, `:792`); `timedOut: true` plus `eventsTail`,
the last 10 truncated lines of its events file, when the per-child timeout
killed it (`codex-wave-runner.mjs:704`, `:793`, via `tailLines`,
`:418-420`); and, on any `stop`, a `cleanup` array of the exact
`git worktree remove --force ... && git branch -D wave/<task-id>` commands to
tear down every stopped task's worktree and branch
(`buildCleanup`/`cleanupLine`, `codex-wave-runner.mjs:390-398`, surfaced at
`:664` and `:850`).

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
   `summary --state <state-path>`. Confirm every task is `ok`, merge all `ok`
   branches in plan/task order, and run the shared full-wave review. Branch
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
