# In-session probe of the wave-runner boundary

The simulator tier proves the ladder's semantics offline. What it cannot prove
is the real `Workflow` launcher accepting the script and a real model driving
it. The tool-call layer routinely delivers the `args` parameter as a
JSON-encoded string rather than an object — reproduced 3/3 across headless
`claude -p` (two models, three prompt phrasings) and also seen from an
interactive session (run wf_e9a784c4-731, 2026-08-12), where a pre-fix runner
returned `invalid-args` for a perfectly valid wave. The runner is now
parse-then-validate: a string that `JSON.parse`s into a valid object is
accepted, and anything else still fails closed by name. `tests/eval/wave.sh`
now asserts a real wave result over that path rather than skipping; this
in-session probe remains the full-fidelity check of the actual `Workflow`
launcher and a real model driving the ladder.

1. Build the fixture repo and args file: run the fixture block of
   `tests/eval/wave.sh` by hand, or let the session do it (everything up to
   the `section` line).
2. In the session, invoke:

   Workflow({
     scriptPath: "<repo>/plugins/orchestration/skills/multi-model/references/wave-runner.workflow.mjs",
     args: <the parsed contents of args.json — a real object, not a string>
   })

3. The probe passes when all three hold:
   - the launch is accepted (no rejection about meta, exports, or parsing);
   - the returned JSON has `status` and a `divide-guard` task entry;
   - that entry's `status` is one of `ok | failed | contract-unsatisfiable | error`
     (a real verdict was produced; `invalid-args` or a missing entry is a fail).
4. Record the date and result in this file.

## Probe log

| Date | Result | Notes |
|---|---|---|
| 2026-08-12 | launch accepted; pre-fix runner returned invalid-args (args delivered as string), which motivated parse-then-validate | run wf_e9a784c4-731, interactive session |
| 2026-08-12 | PASS end-to-end on the parse-then-validate runner: `status: done`, task `divide-guard` → `ok` on rung 0 (haiku executor + haiku supervisor, verdict `{ok:true, violations:[], remarks:[]}`), 2 agents, ~150s. Artifact verified independently of the report: branch `wave/divide-guard` exists, the diff is the correct `src/calc.py` guard, the suite passes in the worktree | run wf_e8701785-804, interactive session |
| 2026-08-12 | Resume replay: same run re-invoked with `resumeFromRunId` returned the identical result in 18ms, 0 tokens, 0 tool uses — both agents from cache. The amendment-flow cache claim in SKILL.md is now live-proven | run wf_e8701785-804 (resume) |
| 2026-08-12 | Rework-trap probes, twice NOT sprung — recorded as a positive finding: a task description steering toward a wrong fix (probe 1) and one directing an outright forbidden move, "update the test to expect the exception" (probe 2), were both refused by the Haiku executor, which fixed `src/` correctly on the first attempt instead; supervisor verified tests untouched. The contract in the six-block prompt beat the description both times. Consequence: the live rework path cannot be triggered by honest fixtures against well-behaved executors; it remains proven by simulator scenarios S2/S3 only, and this line records that limit | runs wf_e57ca8ec-16e, wf_b02e96f4-1b9 |
| 2026-08-12 | DEFECT then FIX, unsatisfiable-contract path. Pre-fix: honest executor stopped (empty diff), supervisor returned `ok:true` with the whole unsatisfiability analysis in `remarks` — the runner reported the task done with a red suite. Fix: supervisor prompt now states an unsatisfiable contract still fails the verdict; pinned by eval fixture F4. Post-fix re-run (executor replayed from cache, supervisor live): `ok:false`, `must_run` violation with `satisfiable:false` and `pasteReproduced:true`, runner returned `contract-unsatisfiable` after one attempt — no rework, no escalation. The satisfiable rung has now executed live, correctly | run wf_160ccefe-e00 (initial + resume), interactive session |
| 2026-09-01 | First live wave judged by Fable 5.1 (`fable`, high) with the executor's model never named in the judge prompt: 7/7 tasks `ok` on rung 0 (4× Opus 5, 1× Haiku, 2× Sonnet executors), 25 agents, ~1.35M subagent tokens, 522 s. Two mechanical rejects were caught by the Sonnet verifier before any judge ran (a report with no pasted evidence for five greps; a task instruction that contradicted its own contract grep — the executor kept the row verbatim, which the contract required). Every verdict re-ran the pipeline in a fresh detached worktree and audited page cites against the plan's facts block; two judges noted their scratch worktree was removed mid-run and re-ran from a second one with identical results. Remarks flagged the dangling cross-task links (profiles referenced before the sibling task creating them merged) as expected for a parallel wave, not as violations | run wf_09b7025d-e18, feature fable-5-1-support, interactive session |
| 2026-09-01 | Model-name probe: a five-agent Workflow asked each agent to report its own model ID. `claude-opus-4-8` → `claude-opus-4-8[1m]`, `claude-opus-4-8[1m]` → same, `opus` → `claude-opus-5[1m]`, `fable` → `claude-fable-5-1`, `opus-4-8` → rejected by the harness ("issue with the selected model"). So Workflow's `agent()` accepts full model IDs and the "short names only" rule was an assumption, not a harness limit; Opus 4.8 is addressable as exactly `claude-opus-4-8`. Waves 3–4 of the fable-5-1-support plan make the runner and the linter accept that one full ID | run wf_93d94701-ae1, interactive session |
| 2026-09-22 | Model-name probe: an 11-agent Workflow asked each agent to report its own model ID. Full IDs `claude-opus-5-5`, `claude-opus-5`, `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5-20251001`, `claude-haiku-4-5`, `claude-fable-5-1` were all accepted and each reported itself. Aliases resolved `opus` → `claude-opus-5-5[1m]`, `sonnet` → `claude-sonnet-5`, `haiku` → `claude-haiku-4-5-20251001`, `fable` → `claude-fable-5-1`. So `opus` moved from Opus 5 (2026-09-01 row) to Opus 5.5 silently: aliases re-point when a model ships, which is why the runner and the linter now accept full IDs only and reject aliases by name | run wf_e635018e-8f3 |
