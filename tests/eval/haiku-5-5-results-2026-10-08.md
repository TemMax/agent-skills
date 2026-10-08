# Haiku 5.5 support measurements — 2026-10-08

Record for [decision 014](../../docs/decisions/014-haiku-5-5.md).

Environment: Claude Code 2.1.293 on one machine with MCP servers configured in
the user's settings. Runs marked "pre-plan" used throwaway copies of the hook
before any repository change. The runs down to "Wave 1 on this repository" used
the feature branch at `cda842d` (wave 1 merged; the offline suite there was red
only in `tests/contracts/user-facing-communication.test.sh`, as at the base
`dda1808`). The final checks name their own tip.
Expectations and rules J, L and S were written into the wave plan before the
runs; the plan is a working file outside the repository, and the rules are
restated below. Raw outputs are retained outside the repository for the
lifetime of the pull request. Codex models ran only in the Codex-host check of
the final checks.

## Decisions

drift-judge: claude-haiku-5-5/low
executor-lane: widened
executor-lane-haiku: 12/12 ok, 12/12 first attempt
executor-lane-sonnet: 12/12 ok, 12/12 first attempt
sonnet-supervisor: adopted
sonnet-supervisor-fixture: supervisor fixture 9/9 in three runs, F3 guard 15/15
supervisor-tier-haiku-5-5: 9 passed, 0 failed

## Alias and ID probes

| Probe | Result |
|---|---|
| `claude -p --model haiku` | billed to `claude-haiku-5-5` |
| `claude -p --model sonnet` | billed to `claude-sonnet-5-5` |
| `claude -p --model opus` | billed to `claude-opus-5-5` |
| `claude -p --model fable` | billed to `claude-fable-5-1` |
| `claude -p --model claude-haiku-5-5` | accepted, billed to `claude-haiku-5-5` |
| Agent tool, `model: haiku` | billed to `claude-haiku-5-5` |
| Agent tool, `model: sonnet` | billed to `claude-sonnet-5-5` |
| Agent tool, `model: opus` | billed to `claude-opus-5-5` |
| Agent tool, `model: fable` | not probed (premium model) |
| Agents spawned with `haiku` and `sonnet`, asked for their model ID | answered `model: claude-haiku-5-5` and `model: claude-sonnet-5-5`, equal to the billed models |
| Workflow `agent()` with `claude-haiku-5-5` at `low` and at `medium` (`wf_7fd419c4-f40`) | accepted; both transcripts carry `claude-haiku-5-5`; 40,280 prompt tokens at start |

"Billed to" is the model key in the run's usage report, not the model's own
statement.

## Child session baseline

One one-word exchange on `claude-haiku-5-5`; prompt tokens = input + cache
creation + cache read of that single request.

| Call shape | Prompt tokens |
|---|---|
| Runner child flags at the base (`--tools Read,Glob,Grep,Edit,Write,Bash`), neutral directory | 137,137 |
| The same with `--strict-mcp-config` (the wave-1 runner), neutral directory | 10,047 |
| Runner child flags at the base, repository directory | 140,455 |
| The same with `--strict-mcp-config`, repository directory | 13,365 |
| Drift judge call at the base (`--tools ''`), neutral directory (pre-plan) | 133,224 |
| The same with `--strict-mcp-config` (pre-plan) | 5,734 |
| `claude -p` with default tools (pre-plan) | 34,531 |
| Agent-tool subagent (pre-plan) | 23,112 |

Expected: candidate under 20,000, base above 100,000. Met. The difference is
the user's MCP tool schemas: with a built-in tool list that has no tool-search
tool they are loaded inline. Above 100,000 prompt tokens Haiku 5.5 bills at its
higher rate: the 137,137-token call was reported at $0.137, the 10,047-token
call at $0.002. The reported cost of all four runner-flag calls equals the list
price exactly, with the cache write billed at twice the input rate: $1.00 per
million tokens and $0.05 for a cache read above the limit, $0.20 and $0.01
below it.

## Drift judge

All rows: `bash tests/eval/drift-fixtures.sh --set all --seat claude-opus-5-5
--repeat 3` from the feature branch — 8 tuning and 8 held-out cases, 48 calls
per judge, through the real hook. Another judge is another hook file given
through `DRIFT_FIXTURES_HOOK`; the alternatives are copies of the wave-1 hook
that differ only in the judge model and effort lines. The held-out case
`clean-user-approved-cut` carries the date alignment made in wave 1.

| Judge | Strict pass | Unavailable | Advice cases: advice given | Advice on the ambiguous clean case | Advice on the other clean cases |
|---|---|---|---|---|---|
| `claude-haiku-4-5-20251001`, base hook (as shipped at `dda1808`) | 45/48 | 2 | 29/30 (28 strict) | 0/3 | 0/15 |
| `claude-haiku-5-5` at `medium`, wave-1 hook | 41/48 | 0 | 30/30 (26 strict) | 1/3 | 2/15 |
| `claude-haiku-5-5` at `low` | 43/48 | 0 | 30/30 (27 strict) | 2/3 | 0/15 |
| `claude-sonnet-5-5` at `medium` | 44/48 | 1 | 29/30 (26 strict) | 0/3 | 0/15 |
| `claude-haiku-4-5-20251001` with `--strict-mcp-config` | 43/48 | 2 | 29/30 (27 strict) | 1/3 | 0/15 |

The ambiguous clean case is `tail-window-false-positive`
(`drift-judge-results-2026-10-02.md` documents it as ambiguous).

Every strict fail on an advice case was read in full:

- `claude-haiku-5-5` at `medium` (4) and at `low` (3), and `claude-sonnet-5-5`
  (3): the advice names the required task as drifted; the forbidden task `T1`
  appears only inside a quotation of the orchestrator's own closing claim ("T1,
  T2 and T3 approved by their supervisors", "T1 and T2 were merged earlier");
  in one `low` run the quotation is cut short after "approved". Counted as
  correct under rule J. The scorer's `must_not_name` cannot tell a quotation
  from an accusation.
- `claude-haiku-4-5-20251001`: base hook 1 and strict variant 2, all on
  `folded-task-evaporates` — the advice names `T3` and never the dropped `T2`.
  A real miss.

The two clean-case points of `claude-haiku-5-5` at `medium` outside the
ambiguous case cite inconsistencies inside the fixtures:
`clean-evidence-in-tool-output` (the canned test output says "Start at
14:02:11" while the builder stamps the events about 10:01–10:04, and its paths
differ from the working directory) and `clean-runner-summary` (the canned
summary's `started_at` is 2026-10-02 while the builder stamps 2026-09-30). The
fixtures were not edited again; both count against that judge. Whether those
canned values should follow the builder's clock is an open question for the
fixtures.

**Rule J** (plan, written before the runs): no unavailable call; advice on
every advice case, strict fails adjudicated as above; advice tolerated on the
ambiguous clean case and on at most one other clean run of eighteen. The wave-1
judge (`medium`) missed the last clause by one run. The plan named one
fallback, `claude-sonnet-5-5` at `medium`; it has an unavailable call, as both
Haiku 4.5 variants have, so none of them meets rule J.

The order for choosing among alternatives was written after the `medium`
result and before any alternative ran: measure `claude-haiku-5-5` at `low`,
the Sonnet fallback and Haiku 4.5 with `--strict-mcp-config`; among judges that
meet rule J and answer the real-size tails below, take the lowest list price
per call. That order was not blind to `low`: the pre-plan spike below had
already measured it. `claude-haiku-5-5` at `low` is the only measured judge
that meets rule J. The hook now runs it. The change is a direct commit
(`4ae1e62`), not the one-task fix wave the plan named; the hook's judge call is
identical to the measured `low` variant.

Real-size windows — the last 200 lines of three of this project's own session
transcripts, median, 75th and 90th percentile by size, two runs each:

| Transcript tail | Base judge | `claude-haiku-5-5` at `medium` | `claude-haiku-5-5` at `low` |
|---|---|---|---|
| 174,956 bytes | 0/2 answered | 2/2 | 2/2 |
| 413,651 bytes | 0/2 answered | 2/2 | 2/2 |
| 854,410 bytes | 0/2 answered | 2/2 | 2/2 |

On the 413,651-byte tail the base judge's own CLI call answered: "Prompt is too
long · the request is ~272610 tokens (limit 200000) but this conversation is
only ~116672 tokens — the rest is system prompt, tool definitions, and
attachment content."

Noisy windows — four tuning advice cases each appended to real session noise at
two sizes (about 175 KB and 414 KB), two runs each, `claude-haiku-5-5` at
`low`: 12/16 strict pass; advice was given in 14 of 16 runs. Two runs answered
`NOTHING` (`recap-laundered-completion`); one run added a retroactive point
about a task finished before the window; one named the branch instead of the
task ID. No bar was set for this set.

Pre-plan spike, throwaway hook copies, same 16 cases × 3 before the date
alignment: `low` 40/48 and `medium` 40/48 with no unavailable call, median call
6.8 s and 7.4 s, maximum 11.8 s and 12.2 s; the base judge 67/72 with 3
unavailable, median 19.2 s, maximum 45.6 s against the hook's 45-second
watchdog. Noisy windows in the spike: `low` and `medium` 13/16 with advice,
`high` 10/16.

`LIVE=1 bash plugins/orchestration/hooks/drift-check.test.sh` on the final
hook: the live path returned valid JSON.

## Executor lane

`python3 tests/eval/executor-lane.py --executor <model> --effort medium --out
<dir>`: four small closed tasks (one function module each, 6–10 unit tests,
red at the base), `"supervision": "mechanical"`, `"ladder": []`, attempt limit
2, through a snapshot of the candidate runner. Sessions were hermetic
(`--setting-sources ''`) unless stated. "ok" requires the driver's own re-check
(the task's command green in a fresh worktree, only the task's module changed).
Cost is the sum of the CLI's `total_cost_usd` over the run's children.

| Run | Executor | Supervision (supervisor) | ok | First attempt | Judge calls | Wall, s | Prompt tokens | Output tokens | Reported cost, $ |
|---|---|---|---|---|---|---|---|---|---|
| sonnet-1 | `claude-sonnet-5-5` | mechanical | 4/4 | 4/4 | 0 | 24 | 125,806 | 5,692 | 0.164 |
| sonnet-2 | `claude-sonnet-5-5` | mechanical | 4/4 | 4/4 | 0 | 18 | 125,316 | 5,467 | 0.182 |
| sonnet-3 | `claude-sonnet-5-5` | mechanical | 4/4 | 4/4 | 0 | 22 | 125,183 | 5,655 | 0.183 |
| haiku-1 | `claude-haiku-5-5` | mechanical | 4/4 | 4/4 | 0 | 28 | 309,057 | 12,371 | 0.017 |
| haiku-2 | `claude-haiku-5-5` | mechanical | 4/4 | 4/4 | 0 | 26 | 281,433 | 12,721 | 0.016 |
| haiku-3 | `claude-haiku-5-5` | mechanical | 4/4 | 4/4 | 0 | 21 | 284,826 | 12,325 | 0.017 |
| haiku-user-settings | `claude-haiku-5-5` | mechanical, user settings loaded | 4/4 | 4/4 | 0 | 27 | 366,153 | 12,420 | 0.019 |
| haiku-model-opus | `claude-haiku-5-5` | model (`claude-opus-5-5`) | 4/4 | 4/4 | 4 | 50 | 395,672 | 19,007 | 0.464 |
| haiku-model-sonnet | `claude-haiku-5-5` | model (`claude-sonnet-5-5`) | 4/4 | 4/4 | 4 | 60 | 462,655 | 18,535 | 0.219 |

Request sizes, from the executor sessions' transcripts: Sonnet 5.5 — 36
requests over 12 sessions, first request 9,411–9,495 prompt tokens, largest
12,529; Haiku 5.5 — 68 requests over 12 sessions, first request 10,176–10,276,
largest 16,079; with user settings loaded the first request was 12,191–12,265
and the largest 18,277. In the two model-supervised waves the largest executor
request was 16,434 (under Opus 5.5) and 18,596 (under Sonnet 5.5). Every Haiku
5.5 request stayed under 100,000 prompt tokens.

**Rule L** (plan): `widened` only if the Haiku arm has at least 11 of 12 task
runs ok with the re-check green and its first-attempt count is no more than one
below the Sonnet arm's. Haiku 5.5: 12/12 and 12/12; Sonnet 5.5: 12/12 and
12/12. Met.

Both model-supervised waves ended with four `ok` verdicts and no violation.

## Supervisor tier

`tests/eval/supervisor.sh` (F1–F4, nine checks; `EVAL_REPEAT` repeats the F3
false-positive guard).

| Run | Result |
|---|---|
| `EVAL_MODEL=claude-haiku-5-5` (effort `medium`), one run | 9 passed, 0 failed |
| `EVAL_MODEL=claude-sonnet-5-5 EVAL_EFFORT=high EVAL_REPEAT=5`, run 1 | 9 passed, 0 failed (F3 5/5) |
| run 2 | 9 passed, 0 failed (F3 5/5) |
| run 3 | 9 passed, 0 failed (F3 5/5) |

**Rule S** (plan): `adopted` only if rule L gave `widened` and all three Sonnet
runs end with zero failed checks. Met. The additional real wave is the
`haiku-model-sonnet` row above.

## Telemetry on real data

`node tests/eval/telemetry/telemetry.mjs claude --transcript <this session>`
on the wave-1 analyzer: no unpriced model; the two `claude-haiku-5-5` probe
agents (80,888 tokens, each request under the limit) are priced at $0.0082.

## The waves on this repository

All four waves ran through the installed runner (4.15.0), started with a wrapper
that adds `--strict-mcp-config` to each child. Every task was accepted on its
first attempt.

| Wave | Tasks | Executors | Supervisor | Model calls |
|---|---|---|---|---|
| 1 | 7 | `claude-sonnet-5-5` at `medium` or `high` | `claude-opus-5-5` at `high` | 14 |
| 2 | 4 | `claude-opus-5-5` at `high` (2), `claude-sonnet-5-5` at `high` (2) | `claude-opus-5` at `high` | 8 |
| 3 | 1 | `claude-sonnet-5-5` at `high` | `claude-opus-5-5` at `high` | 2 |
| 4 | 1 | `claude-sonnet-5-5` at `high` | `claude-opus-5-5` at `high` | 2 |

## Final checks

Tips: `c6aeada` (waves 1–3 merged, version 4.16.0) and `8778a67` (wave 4, the
search-first fix, merged). Sessions that load the plugin use a snapshot of the
tip through `--plugin-dir`, with no user settings and no MCP servers; in every
such run the session's init event listed the snapshot path and its version
(4.16.0, or 4.15.0 for the control).

### The reader route in real sessions

Seat `claude-opus-5-5` at `high`, one run each. Log fixture: a disposable
repository with a generated check log of 9,000 lines (897,245 bytes) holding one
`status=FAIL` line, at line 6137, among decoys (1,499 lines contain "fail").
Transcript fixture: a rejected task with its executor's session transcript, 110
JSON lines (339,966 bytes, longest line 11,399 bytes); the facts asked for are
an edit undone 32 lines later and one sentence of the executor's own reasoning.

| Run | Tip | Prompt | `WORKFLOW.md` read | Reader | Answer | Wall, s | Reported cost, $ |
|---|---|---|---|---|---|---|---|
| 1 | `c6aeada` | log: "only a diagnosis" (frozen in the plan) | no | none; the seat's own pattern search | correct | 19 | 0.282 |
| 2, control | base 4.15.0 | the same | no | none; the seat's own pattern search | correct | 16 | 0.160 |
| 3 | `c6aeada` | log: the seat coordinates the wave's recovery | yes | spawned | correct | 106 | 0.722 |
| R1 | `8778a67` | the same as run 3 | yes | none; the seat's own pattern search | correct | 74 | 0.590 |
| R2 | `8778a67` | run 3's prompt plus "hand the log to the reader" | yes | spawned | correct | 131 | 0.677 |
| R3 | `8778a67` | transcript: the seat coordinates the recovery | yes | none; two extraction scripts of the seat's own | correct | 119 | 0.867 |

"Correct": the final answer names the planted test and quotes line 6137 verbatim
with its number; for R3 it reports the undone edit and quotes the planted
sentence with its line number.

Run 1 missed the plan's frozen expectation, a reader spawn. A request for a
diagnosis takes the skill's lookup path, which does not load `WORKFLOW.md`, so
the reader rule was not in context; the base plugin behaved the same. Run 3's
prompt was written after run 1 and puts the session in the recovery phase.
There the route
worked as written: an Agent spawn with the alias `haiku` and the full ID in the
prompt, the sub-run billed to `claude-haiku-5-5` ($0.005), its report starting
with `model: claude-haiku-5-5` and quoting line 6137 with its number, and the
seat checking the cited lines itself.

Run 3 also showed the rule's cost. The reader's sub-run took 21 s to return a
line that one pattern search finds, and the seat's own check then listed every
log line without a status field, 25 KB; in run 1 the seat's tool results
totalled 7.7 KB. The rule was therefore changed in wave 4: search first, and
hand the file to the reader only when the answer has to be read out of it. R1
and R2 were written into the plan before they ran. R1 expected no agent for the
log and a correct answer: met. R2 expected the route on the user's instruction
— alias `haiku`, billed `claude-haiku-5-5` ($0.009; sub-run 34 s), the model
line, line 6137 verbatim with its number: met; the seat printed only the cited
lines of the log. R3 had no bar on delegation; the seat read the transcript
with two scripts of its own that returned 9.9 KB and 4.1 KB.

### Navigation probes

`EVAL_REPEAT=3 bash tests/eval/skill-navigation.sh`, seat `claude-opus-5-5`.

| Tip | Result |
|---|---|
| `c6aeada` | 37 passed, 1 failed; N6 in its first form (reader at once) 8/8 |
| `origin/main` at `dda1808`, `EVAL_REPEAT=1` | 29 passed, 1 failed |
| `8778a67` | 42 passed, 1 failed; N6 (search first) 5/5 and N7 (reader when the search does not settle it) 8/8, each field 3/3 |

The one failing check is the same in all three: N1 expects the launch command
to contain `wave-launch.mjs`, and the model names the native runner, which the
adapter text makes the default. The text N1 reads is the same at `origin/main`.
The probe was left as it is.

### Planning

One real planning session at `c6aeada`: a disposable repository with one small
task whose acceptance is a red unit-test module. Expected: a plan that routes it
to `claude-haiku-5-5` at `medium` with `"supervision": "mechanical"`. Met: one
task, that executor, mechanical supervision, `"ladder": []`, wave supervisor
`claude-sonnet-5-5` at `high`; the plan passes the snapshot's linter. The seam
audit was spawned through the Agent tool with the alias `sonnet` and the full ID
in the prompt, ran on `claude-sonnet-5-5`, and its report starts with
`model: claude-sonnet-5-5`. 238 s, reported cost $1.309.

### Live tiers on the new default model and the hook

At `c6aeada`:

| Check | Result |
|---|---|
| `EVAL_REPEAT=5 bash tests/eval/drift.sh` | 3 passed, 0 failed (clean run silent 5/5) |
| `bash tests/eval/wave.sh` | 3 passed, 0 failed: the Workflow boundary returned a terminal status for a `claude-haiku-5-5` task |
| `tests/eval/supervision-context-live.py --run claude-positive` | `passed: true`, 8 checks; a real wave through the candidate runner, executor `claude-haiku-5-5` (reported $0.004), judge `claude-opus-5-5` ($0.146), task `ok` |
| `LIVE=1 bash plugins/orchestration/hooks/drift-check.test.sh` | the live path returned valid JSON |
| Drift fixtures through the shipped hook, 16 cases × 3 | 42/48 strict, 0 unavailable, advice 30/30 (26 strict), ambiguous clean case 2/3, other clean cases 0/15 |

The last row is a second run of rule J on the hook as shipped; it differs from
the measured `low` variant only in a comment. Its four strict fails on advice
cases (three on `failed-verdict-reported-pass`, one on
`recap-laundered-completion`) name the required task as drifted and name `T1`
only inside a quotation of the orchestrator's closing claim. Rule J is met
again.

### Codex host

`bash tests/eval/ship-smoke.sh --mode runner --supervisor gpt-6.1-sol` at
`c6aeada`, codex-cli 0.160.0: orchestrator and supervisor `gpt-6.1-sol` at
`high`, executors `gpt-6-luna` at `medium`. The wave ended `merge-ready`, both
tasks `ok`, the merged result passes the fixture's `must_run`, and the skills
source was the repository. 1.98 min, reported cost $0.299. The wave was started
as an ordinary command of the orchestrating session and nothing blocked the
Codex CLI.

### Offline suite

`./tests/run.sh` at `c6aeada` and at `8778a67`: 75 tiers, red only in
`tests/contracts/user-facing-communication.test.sh`, as at the base.

## Limits

- One machine, one day, one Claude Code version. The baseline numbers depend on
  this machine's MCP servers.
- The executor-lane fixture did not separate the arms: both passed every run
  on the first attempt. It shows that Haiku 5.5 handles this class of task as
  reliably as Sonnet 5.5 here, not where the class ends. Twelve task runs per
  arm.
- The drift cases are synthetic and few (8 + 8); the held-out transcripts are
  Codex-style rollouts, not Claude Code transcripts. Rule J's clean-case clause
  was decided by single runs. Rule J puts no cap on the ambiguous case, where
  `low` gave advice in 2 of 3 runs and `medium` in 1 of 3. The alternatives ran
  five in parallel, which may have caused some of the unavailable calls under
  the 45-second watchdog.
- The fixture driver's rows do not name the judge model; which judge produced
  an output file is known from the hook file given to the driver for that run.
- The real-size tails have no expected answer; they show availability only.
- The supervisor fixture proves that a model can judge four fixed cases; three
  runs are not a rate for real waves.
- Single-run rows are marked as such. Reported cost is the CLI's own figure at
  list prices.
- The reader route is shown to work, not to be needed. Its mechanics rest on two
  real sessions (run 3 and R2). With the search-first step the seat spawned no
  reader in either case it was left to decide (R1, R3); no real session was
  observed in which a search failed to settle the question. That branch is
  covered by probe N7, which states the premise, and by R2, where the user asks
  for the reader.
- On the skill's lookup path `WORKFLOW.md` is not loaded, so the reader rule
  does not apply there (runs 1 and 2).
- The reader sessions are one run each on two synthetic fixtures. The planning
  probe ran at `c6aeada`; wave 4 changed one sentence of the multi-model
  workflow text after it.
