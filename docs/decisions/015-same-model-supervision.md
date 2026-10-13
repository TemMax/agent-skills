# 015 — A supervisor may be the executor's own model; it is never a weaker tier

Date: 2026-10-13
Status: accepted as a decision of the user; not a measured result

## Context

ADR 002 and ADR 007 required a different model in the supervisor seat than in
any executor or ladder rung of the wave, except the separately approved Astra
executor. Two things made the rule expensive.

- On Codex without a premium authorization the only wave left was all
  `gpt-6-luna` under a `gpt-6.1-sol` supervisor, with no ladder: `ordinary`
  and `difficult` tasks route to `gpt-6.1-sol`, and a Sol executor needed the
  premium `gpt-6-astra` supervisor. `codex-routing.md` told the coordinator to
  cut the work into mechanical tasks for that route. A user's series of 18
  runner invocations on one feature (2026-10-12 and 2026-10-13, process
  metadata only) shows the result: tasks of 6–8 files with 4–6 questions about
  behaviour were given to Luna at `medium`; 5 of 18 first attempts were
  accepted; 8 were rejected for a defect in the code; 8 invocations stopped,
  and four times the coordinator wrote a new plan for the same work.
- On Claude the work of `claude-opus-5-5` was supervised by the older
  `claude-opus-5` or by the premium `claude-fable-5-1`, and a Sonnet task with
  the default ladder lost Opus 5.5 as its supervisor because the ladder
  reaches it.

The rule was justified by self-preference. The cards measure it at or near
zero for the Claude models, with the judge told that the author is Claude
(Opus 5 ≈0, Opus 5.5 +0.07 of 10, Fable 5.1 0.1 of 10); no source measures it
for a GPT model. The supervisor prompt has never named the executor's model,
and the helper redacts the model's name from the executor's report.

## Decision

1. **The same model may supervise.** The supervisor is a fresh separate
   session: never an executor's handle or conversation, never told which model
   wrote the work. That is fresh-context separation, not different-model
   independence.
2. **Never a weaker tier.** The supervisor's tier is at least the tier of
   every executor and ladder rung of its wave, the default ladder included.
   Tiers are product classes: Haiku, Sonnet, then Opus and Fable together;
   Luna, Sol and Terra, then Astra. The plan linter, the Codex state helper
   and the Claude wave policy reject a weaker supervisor; the linter warns
   about a supervisor of the lowest tier.
3. **Codex standard route.** `gpt-6.1-sol` at `high` supervises every wave of
   `gpt-6-luna` and `gpt-6.1-sol` executors and rungs. Mechanical tasks go to
   Luna with a `gpt-6.1-sol` rung; ordinary and difficult tasks go to
   `gpt-6.1-sol`. The coordinator routes a task by what it needs and no longer
   cuts reasoning work into mechanical tasks. `gpt-6-astra` stays premium and
   is required as the supervisor only when Astra executes.
4. **Claude standard route.** `claude-opus-5-5` supervises every wave,
   its own executors and rungs included; `claude-sonnet-5-5` keeps the wave
   whose tasks are all `claude-haiku-5-5` with `"ladder": []`.
   `claude-opus-5` is no longer chosen as a supervisor; the ID stays valid so
   that approved plans run.
5. **The drift judge.** On Codex a `gpt-6.1-sol` orchestrator is judged by
   `gpt-6.1-sol` at `high` in a separate session, like every other GPT-6
   seat, instead of `gpt-5.6-sol`; the hook no longer refuses a judge equal
   to the seat. This removes the last dependency of a GPT-6 seat on the
   GPT-5.6 generation. The pairing of the retired GPT-5.6 seats is unchanged.
   On Claude the judge was already `claude-haiku-5-5` for every seat.

## What is not established

No measurement compares how well a model catches the kind of mistake it makes
itself with how well another model catches it. The user chose to remove the
rule without that measurement. What bounds the risk is the contract written
by a third party, the mechanical verification a judge cannot soften, and the
final review of the whole branch.

The drift judge reads the orchestrator's own account of its actions, not
artifacts, so agreement with a familiar line of reasoning would show there
first. The drift fixtures are synthetic and were not written by
`gpt-6.1-sol`; a pass on them shows that the judge still works under the new
mapping, not that it is free of that bias. The hook only advises.

The live runs of 2026-10-13 are recorded in
[`tests/eval/same-model-supervision-results-2026-10-13.md`](../../tests/eval/same-model-supervision-results-2026-10-13.md).
They show that the routes run and how the skills choose them; they are not a
detection rate.

## Supersedes

The different-model requirement of ADR 002, the all-Luna condition of the
standard Codex supervisor in ADR 007, and the own-seat rule of ADR 012. The
premium-approval rule of ADR 007 is unchanged.
