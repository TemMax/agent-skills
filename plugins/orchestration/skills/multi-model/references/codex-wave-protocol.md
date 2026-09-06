# Codex-native supervised wave protocol

Use this protocol only for a GPT-5.6-only wave. It is the host adapter for the
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

6. For `spawn-supervisor`, use the returned `model` and `effort`. It is the
   different exact model selected by `next`; never choose an alternative based
   on a label, availability guess, or default. The same tuple rule applies to
   supervisor retries: use `followup_task` only for the same role, exact model,
   and exact effort on an available supervisor child. On a changed model or
   effort, or no suitable live child, spawn a fresh supervisor. Pass the
   helper-returned supervisor prompt as its only task text, require its fixed
   verdict JSON, and pass that JSON unchanged to the recorder:

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
