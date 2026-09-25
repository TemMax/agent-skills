# Claude wave adapter — invoke the shipped runner

Read from multi-model SKILL.md (Host adapter) when a wave's plan host is
Claude. The shared contract, verifier, supervisor, ladder and result review
stay in SKILL.md.

## Contents

- Claude-only wave — invoke the shipped runner

## Claude-only wave — invoke the shipped runner

For a Claude-only wave, the ladder in multi-model SKILL.md (Escalation ladder) is implemented once, in
`references/wave-runner.workflow.mjs`, and covered by the deterministic
simulator tier in `tests/`. Your job is to assemble its inputs, not to
re-implement its rules — every hand-written wave script is a fresh chance to
get "two strikes escalate" subtly wrong, and the one hand-written run on
record was rejected at launch four times before it worked.

Its `opts.model` accepts exactly the full IDs in Model identifiers in multi-model SKILL.md and
rejects aliases by name.

1. **Preflight the contracts at the base.** Before the first wave forks, run
   each distinct `must_run` command once against the recorded base — route
   it to a cheap agent per the Research Routing table, or run it yourself.
   Run it in a fresh worktree set up like an executor's, and never in the
   main checkout: `git -C <repo> worktree add --detach
   <repo>/.worktrees/preflight <base>`, then the same `ln -s` links
   `wave-launch.mjs` resolves (the plan's `worktree.links` plus
   auto-detected entries such as `local.properties`). Remove the worktree
   afterwards. Compare each command's outcome against the plan's recorded
   expectation: green at base, or expected-red (the task itself creates
   what the command checks). An unexpected red is a contract defect to fix
   now, before any executor is spawned — transcript mining found ~13% of
   all supervisor verdicts were `satisfiable:false`, every one tracing to a
   contract already broken at base (fmt drift at BASE, a command targeting
   a nonexistent build target), each costing an executor attempt plus an
   Opus verdict. A command that fails at this stage because the machine,
   not the contract, blocked it is an environment error: fix it on the
   machine before any executor is spawned, the same as an
   `environment-blocked` task result (see Results below).
2. **Generate the launch script** from the lint-clean plan:

   ```
   node <this skill's base directory>/references/wave-launch.mjs <plan> --wave <n> \
     --base <pushed sha> --repo <abs repo> --default-branch <branch>
   ```

   Optional: `--verifier <model>:<effort>`, `--out <path>`. It refuses a plan
   that is not lint-clean, writes nothing on any failure, and on success
   prints one absolute path (default
   `<repo>/.worktrees/launch/wave-<n>.workflow.mjs`).

   `wave-launch.mjs` also refuses to launch when:
   - `--base` is not on `origin/<default-branch>` — it fetches, then checks
     `git -C <repo> merge-base --is-ancestor <base> origin/<default-branch>`;
     a fix wave whose base only exists locally takes `git rev-parse
     origin/<branch>` for `--base` instead of a local sha;
   - the wave's `depends_on` is unmet — the same check the plan's
     `depends_on` key describes: `git -C <repo> cat-file -e <ref>:<path>`
     must succeed first.

   It also resolves the plan's `worktree` key (`links` plus the
   auto-detected entries) and embeds it in `WAVE_ARGS` as `worktree.links`,
   which the runner turns into the same `ln -s` lines in both the
   executor's prompt and the verifier's prompt.
3. **Invoke it** with `Workflow({ scriptPath: "<printed path>" })` and no
   `args`. Resume with the same `scriptPath` and `resumeFromRunId`.

   Why a generated file and not the runner's own path: the host's Workflow
   tool accepts `scriptPath` only inside the working directory or an added
   directory. Verified 2026-09-22: a plugin-cache path is rejected ("scriptPath
   must be a script path this tool returned, or a file you can already read").
   And workflow scripts cannot read files, so the full wave input — including
   `supervisorPromptText`, the text of `references/supervisor-prompt.md` —
   must travel inside the script; hand-copying tens of KB of args into a tool
   call invites transcription errors.

   The generated file is the shipped `references/wave-runner.workflow.mjs`
   byte-for-byte plus one `const WAVE_ARGS = {...}` line after its `meta`
   literal; the runner reads `typeof WAVE_ARGS !== 'undefined' ? WAVE_ARGS :
   args`. It is therefore not a custom wave script, and the "Never write a custom wave script" rule still
   holds.

   For reference, the runner input the generator builds and embeds as
   `WAVE_ARGS` (you do not write this by hand):

```
{
  base: "<pushed fork-point sha>",          // see Wave Isolation in multi-model SKILL.md
  defaultBranch: "main",
  repoPath: "/abs/path/to/repo",
  supervisorPromptText: "<text of supervisor-prompt.md>",
  supervisor: { model: "claude-opus-5-5", effort: "high" },   // the wave's plan entry
  verifier: { model: "claude-sonnet-5", effort: "low" },     // only with --verifier; this is the default
  tasks: [{                                                  // the wave's plan tasks, minus `branch`
    id: "auth-fix",
    description: "<the task's `## Task auth-fix` prose section>",
    context: "<files, lines, conventions>",   // optional; copied if the plan task has it
    contract: { files_allowed: [...], files_forbidden: [...],
                must_run: [{ cmd: "...", evidence: "required" }],
                forbidden_moves: [...], report_must_answer: [...] },
    executor: { model: "claude-sonnet-5", effort: "medium" },
    ladder: []      // rungs AFTER the first; omit for the routing default (Sonnet/Haiku then escalate to Opus 5.5, so the supervisor must not be Opus 5.5)
  }]
}
```

The runner assembles each executor's prompt from the task object — the six
mandatory blocks of the Task Prompt Template in multi-model SKILL.md, plus a workspace section
carrying the isolation instructions — so the contract the executor reads and
the contract the supervisor enforces are the same object and cannot diverge.
Escalated rungs run at `high` effort.

Claude adapter completion reads the multi-model publication contract after
every task is `ok`. `publication: push` merges branches in plan order, runs the
shared full-wave review, and pushes exactly as normal. With `publication: local`, merge branches in plan
order only into the local feature branch, run the shared full-wave review,
return the resulting local feature-branch commit(s), task branches, and verdict
evidence, and do no push. The Claude adapter keeps the shipped Workflow
implementation unchanged; publication stays at this composition boundary, not
in the Workflow arguments or script.

4. Act on the returned statuses, task by task:
   - `ok` — merge `wave/<id>` per the wave plan.
   - `contract-unsatisfiable` — run the amendment flow (multi-model SKILL.md → Escalation ladder → `references/contract-amendment.md`) (one amendment
     per task; removing or weakening a check goes to the user as a yes/no),
     regenerate the launch script from the edited plan with the same command,
     then re-invoke with `resumeFromRunId`: the runner is deterministic, so
     every unchanged task replays from cache and only the amended one runs.
   - `environment-blocked` — the machine, not the work, stopped the task: name
     the command that hit it and the verbatim error line the task attempt
     recorded, fix that on the machine, then re-run the same wave. It is
     never routed to the contract-amendment flow — Stop handling in
     multi-model SKILL.md covers this status in full.
   - `failed` / `error` — hand the user the task, every verdict in order, and
     the branch name. Do not quietly retry.

   A wave may also be launched as parallel single-task runner invocations —
   same-wave tasks are file-disjoint by construction, so each `ok` branch
   can merge as its result lands instead of waiting for the wave's slowest
   task (measured: three finished tasks once waited ~47 minutes on a
   sibling's third attempt). The wave's full suite still runs once, after
   all of the wave's invocations settle, before the push.

Never write a custom wave script. If the shipped runner cannot express the
wave, stop before spawning and return the unsupported requirement for a plan or
adapter change.
