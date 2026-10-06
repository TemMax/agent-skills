# Tests

## Required live validation

The repository's [main rule](../AGENTS.md) requires live validation for changes
to plugin behavior. Check affected scenarios through real Claude Code and Codex
sessions for shared changes; offline results alone do not make a change verified
or release-ready. Run a small relevant set first, with bounded calls/time, then
expand when a failure or uncertainty justifies it. Preserve all failed runs.

Verify the actual candidate version and loaded paths. The Codex `skill-session-ab --arm
new` defaults to archiving **HEAD**, so it misses uncommitted changes; `--arm
real` uses whichever plugin is installed, which may also be old. Isolated prompt
probes and normal plugin-loading sessions establish different facts. Choose the
one that exercises the changed behavior; an execution/recovery change also needs
an actual execution/recovery scenario.

The Claude `claude-skill-session-ab.py --arm new` snapshots current files,
including uncommitted edits, and checks host plugin metadata plus the injected
skill path. It does not change the installed marketplace source.

The [first-package cases](eval/first-package-regressions.md) describe the current
mandatory cost-control scenarios. Their pre-merge outcomes and retained failures
are in [the final acceptance report](eval/acceptance-results-2026-10-05.md).
The first three scenarios and native early guards have
recorded [real dual-host results](eval/cost-control-live-results-2026-10-05.md). The next
[progressive-loading results](eval/progressive-loading-results-2026-10-05.md) compare
short entrypoints against the pushed baseline without changing installed plugins.
Prior dated measurements apply to their recorded versions only.

## Available test bench

| Component | Fixture/task | Scope |
| --- | --- | --- |
| `critical-review.sh` | Clean code and deliberately planted defects; gated PR thread flow | Live semantic review through either provider |
| `supervisor.sh` | Real small repository: correct change, missing guard, unsatisfiable contract | Live independent supervision through either provider |
| `super-plan.sh`, `seam-audit*.sh` | File overlap, product fork, broken cross-task seams and clean decoys | Live planning and audit; several fixed mini repositories |
| `skill-navigation.sh` | Five process decision points and required reference reads | Live skill application through either provider |
| `ship-smoke.sh` | Two tasks in a disposable repository with a local bare origin | Codex execution, correctness and telemetry |
| `skill-session-ab.sh` | Scripted multi-turn task removing duplicate tests, then a narrow CI edit | Codex session behavior and before/after comparison |
| `claude-skill-session-ab.py` | Same duplicate-test fixture and eight turns; a cheaper two-turn smoke | Claude Code sessions, normal plugin loading, resume and before/after comparison |
| `cost-control-live.py` | Ready candidate with a verification fault, lost invariant, PR/CI continuation, delegated handoff, authorized signing amendment | Real dual-host, bounded calls; candidate snapshots and retained failures |
| `phase-context-live.py` | Paired assigned phases, ordered instruction reads before artifact launches, quiet lookup/local review, two semantic defects with green tests, plan lint, paginated PR review, blocked fix/delivery preflight | [Frozen matrix and aggregate budget](eval/phase-context-regressions.md); 14 candidate calls; A/B baselines opt-in; select affected cases; no children or installed upgrade |
| `supervision-context-live.py` | Native positive waves, green-test semantic rejection, mismatched-evidence rerun on both hosts | [Matrix and aggregate budget](eval/supervision-context-regressions.md); 8 planned calls; retained tool streams and actual pipeline counts; no installed upgrade |
| `acceptance-dialogue-live.py` | New product fork, actual skill version change and fresh native context, bounded planning/verification/review phases | Two or three turns per run; exact loaded body and repository-rule evidence, no installed upgrade |
| `cost-control-guards.py` | Continue the owned recovery fixture; missing links/lock, amended commands, cap and stale HEAD | Native early guard paths intentionally launch no new models |
| `telemetry/`, `skill-session-ab-analyze.py` | Captured real runs | Offline analysis of reads, launches, usage and retained outcomes |

Both hosts now have multi-turn A/B drivers sharing the disposable fixture.
The cost-control, native guard and acceptance-dialogue drivers cover the current
pre-merge matrix on either host. Installed Git upgrades are checked after merge.
A list of scenarios or an offline test of a live driver must not be reported
as a completed live run.

Run the bounded probes manually, once per provider/arm, with fresh directories:

```bash
python3 tests/eval/cost-control-live.py --provider claude --case recovery --arm new --out /tmp/cost-claude-new
python3 tests/eval/cost-control-live.py --provider codex --case semantic --arm new --out /tmp/cost-codex-semantic
python3 tests/eval/cost-control-live.py --provider codex --case navigation --arm new --out /tmp/cost-codex-navigation
python3 tests/eval/cost-control-live-analyze.py /tmp/cost-claude-new /tmp/cost-codex-semantic
python3 tests/eval/cost-control-guards.py --run /tmp/cost-claude-new
python3 tests/eval/cost-control-live.py --provider claude --case signing --arm new --out /tmp/signing-claude
python3 tests/eval/acceptance-dialogue-live.py --provider codex --case decision --out /tmp/decision-codex
python3 tests/eval/acceptance-dialogue-live.py --provider claude --case reload --out /tmp/reload-claude
python3 tests/eval/acceptance-dialogue-live.py --provider codex --case entrypoints --out /tmp/entrypoints-codex
```

`--prepare-only` snapshots files, creates the fixture and freezes outcomes without
calling a model. New means current working files, old means `--old-ref HEAD`.
Recovery uses actual child CLIs; old Claude invokes the actual Workflow tool.
Old recovery explicitly measures a full rerun strategy, not optimal old resume.
Navigation loads candidates without changing installed plugins: Claude uses
`--plugin-dir`; Codex discovers symlinked candidate skills through the disposable
fixture's `.agents/skills` with plugins disabled. This checks native skill
loading and instructions, not Codex plugin discovery or hooks. The same transport
is used for both arms. Exact loaded paths/hashes or host-injected bodies are
checked after the calls. No `plugin add/remove`, cache edits or marketplace switch.
`--recheck-loading` reassesses retained Codex navigation path evidence without
new model calls, keeping the original outcome and writing `assessment-v2.json`.

Acceptance dialogue runs freeze snapshots and expected outcomes before calls;
`--prepare-only` prepares without models. Claude has a $3 aggregate dialogue cap,
each turn has a 150-second timeout, and children are forbidden. Codex uses the
same bounded turn count, without an API token cap. Reload changes declared
version and a hidden checkpoint marker in the fixture only, then starts a real
fresh session. It does not force host compaction. Dialogue accounting matches
Codex cumulative counters against owned rollouts and resets the baseline for a
fresh session; use its `cost-accounting.json`, not navigation's single-session
analyzer. Missing rollout proof leaves the total unclaimed. Signing uses a
two-child cap, keeps `commit.gpgsign=true`, saves the amendment authorization,
and must obtain fresh positive review without another executor. Signing and
handoff support `--arm new` only.

`--case handoff --arm new` checks the delegated path with a real coordinator,
one executor and one independent reviewer. It must load `WORKFLOW.md` and invoke
the shipped runner; it stops before integration/publication. The Codex coordinator
runs outside a sandbox, as in ship-smoke, because macOS Seatbelt cannot nest;
the native runner still sandboxes its children. Child calls are capped at two.
Expectations and candidate hashes are frozen before calls, including failures.
Codex launchers need to run outside the enclosing macOS sandbox; children retain
their own sandboxes. Claude navigation is capped at $3/four turns; each semantic
probe has one bounded reviewer call; recovery has a two-call wave cap and child
timeouts. These are invocation caps, not API request or token caps.

The guard driver advances only its disposable candidate after preserving an
evidence branch. Do not reuse that fixture as unchanged proof afterwards. The
original summaries and measured HEADs remain retained. Signing correction is
reverified at an exhausted cap; that is not a positive live signing review.

Usage analysis counts all owned roles and retained failures. Resumed Codex CLI
usage is cumulative when it matches `total_token_usage` in the owned rollout;
subtract the previous counter rather than summing it again. Without that evidence
the analyzer keeps the stream's original per-turn interpretation. Claude cache
creation and reads are separate additive buckets; Codex cached input is already
included in input. The offline suite covers both the fixture and this accounting.

```
./tests/run.sh          structure + contracts + behaviour   — offline, seconds
./tests/run.sh --live   the above plus the evaluation tiers — ~a dozen model
                        calls (supervisor, drift, wave boundary, planner —
                        the last on Sonnet), several minutes
bash tests/eval/gpt-5-6-matrix.sh --self-test
                        offline GPT-5.6 matrix-harness gate
```

Enable the pre-push gate once per clone:

```
git config core.hooksPath .githooks
```

## The tiers, and what each is actually worth

**structure** — manifests parse, frontmatter is complete, skill and plugin
versions agree, shipped scripts are executable and syntactically valid, no
forbidden names or absolute home paths. Everything here breaks a plugin
outright, so this tier must never be red.

**contracts** — assertions over the skills' prose, limited to lines whose loss
changes what an agent *does* or reopens a defect that has already cost us. Be
clear-eyed about this tier: in the 2026-08-11 review it was fully green while
three serious defects were live. It catches deletion, not wrongness.
`tests/contracts/critical-review-rules.test.sh` covers the one-findings-gate
wait rule and the secrets prohibition in `critical-review`'s SKILL.md.

**behaviour** — `plugins/*/hooks/*.test.sh`, co-located with the code they
cover. The drift hook's gates run offline through `CLAUDE_DRIFT_CHECK_DRYRUN=1`,
which prints the decision instead of calling the model, and the logic after the
call through `CLAUDE_DRIFT_CHECK_FAKE_ANSWER`. Real assertions about real
behaviour, and the cheapest tier that can find a genuine bug.

**evaluation (live)** — asks whether the prompts *work* on fixed scenarios.
The [adjudication decision](../docs/decisions/004-adversarial-evaluation.md)
records how expectations are fixed before a run and disagreements are judged.
Stable [drift expectations](eval/fixtures/drift/EXPECTATIONS.md) and
[supervisor expectations](eval/fixtures/supervisor/EXPECTATIONS.md) live beside
their fixtures. An always-accepting supervisor or always-quiet drift checker
fails these live scenarios even when prompt structure and plumbing are valid.
Offline tests establish deterministic behavior; live fixtures establish bounded
model behavior; the separate dated calibration report records route evidence
and limitations. None substitutes for the others.

`drift-fixtures.sh` runs the retained and held-out drift cases through the real
hook. It is offline-tested by `drift-fixtures.test.sh` and excluded from
`run.sh --live` as a calibration tool. For live use, run
`bash tests/eval/drift-fixtures.sh --set all --repeat 3` (the hook's own
mapping; pass `--judge <model>` to measure another listed Codex judge)
outside any sandbox that blocks Codex.

[Post-review fix routing](eval/fix-routing-insession.md) is a small simulated
continuation fixture. It records the frozen 5/5 direct-fix baseline and leaves
post-change simulated probe outcomes; it is neither a live result nor a release
or publication gate.

The super-plan tier asks the inverse planning questions: a request that
tempts same-wave file overlap must still produce a lint-clean plan, and a
request hiding a product fork must surface it under "Assumptions (would
ask)" rather than resolve it silently.

The seam-audit tier (`tests/eval/seam-audit.sh`) measures two stage C
planning rules directly: the Seam audit step catches a cross-task seam
before execution, and the Gate 2 message shows the plan's shape — the
waves, the tasks that run in parallel, the critical path in waves — and
carries no time or cost estimate. Its fixture is a two-part feature request over a small report
module where changing `format_row`'s separator in `src/report.py` quietly
breaks `tests/helpers.py`'s `parse_rows` round trip unless the same task
owns both files. `SEAM_SKILL_ROOT` (default: this repository's root) points
the whole tier — the prompt's `SKILL.md` and the Lint step's linter — at a
skill checkout, so pointing it at an older copy compares that skill's seam
and Gate 2 behavior against this one, each linted by its own linter. Honors
`EVAL_REPEAT` (each repetition is an independent run against its own
fixture copy) and `EVAL_KEEP_DIR` (keeps every model answer and plan as
evidence). Its scoring rules are tested offline, without a model, by
`tests/eval/seam-audit.test.sh`.

The effort-detection tier (`tests/eval/effort-detection.sh`) checks that the
production hook and the host actually surface a session's effort, live: a
Codex `gpt-6-luna` session started with `model_reasoning_effort="low"` gets a
`SessionStart` hook whose `additionalContext` reports
`PLUGIN_RUNTIME_CONTEXT_V1 plugin=orchestration host=codex model=gpt-6-luna
effort=low`, and a Claude Code session started with `--effort low` sees that
effort from its shell tool (`printenv CLAUDE_EFFORT`). It costs two small
model calls — one `gpt-6-luna` call and one Sonnet 5.5 (`claude-sonnet-5-5`) call — and,
because Codex's own seatbelt sandbox cannot nest another sandboxed `codex
exec`, it must run outside any sandbox; skip a part whose CLI is missing from
PATH rather than fail it.

The skill-navigation tier (`tests/eval/skill-navigation.sh`) asks whether an
agent applying the multi-model skill takes the right action at five decision
points — launching a Claude-only wave, a contract amendment that widens
`files_allowed` and one that would delete a `must_run` entry, a failed verdict
with `pasteReproduced: false`, and drift advice from the Stop hook — and,
where the rule lives in a reference file, whether the agent actually opened
it (read from the `Read` tool calls in the `stream-json` events; a reference
file absent from the layout under test prints `SKIP read-check` and passes).
Answers are graded as JSON fields, `k/n` over `EVAL_REPEAT`. It defaults to
`EVAL_MODEL=claude-opus-5-5` and this checkout's skill; point it at another
layout with `SKILL_DIR=/path/to/plugins/orchestration/skills/multi-model bash
tests/eval/skill-navigation.sh`. Its parser and read-check are tested offline
by `tests/eval/skill-navigation.test.sh`. The tier also runs on Codex with
`EVAL_PROVIDER=codex EVAL_MODEL=<gpt-model> [EVAL_EFFORT=medium]`, recovering
reads from the shell commands inside `codex exec --json` events since Codex
has no Read tool. In Codex mode N1 is replaced by N1c (a Codex-only wave,
read-check `references/codex-wave-protocol.md`), while N2-N5 speak of the
wave's state helper instead of the wave runner.

**2026-09-23 — multi-model split, measured.** `SKILL.md` went from 925 to 622
lines (58,142 to 41,464 bytes) by moving four conditional sections verbatim
into `references/claude-wave-adapter.md`, `contract-amendment.md`,
`verdicts.md` and `orchestrator-drift-hook.md`. The skill-navigation tier
(x3) before the split: Opus 5.5 30/30, Sonnet 5 28/30 — both misses were runs
that did not open `SKILL.md` at all, and their answers were still correct.
After the split: Opus 5.5 30/30 with every reference opened at its trigger
3/3, and Sonnet 5 29/30 with every mandatory reference opened 3/3 and N5
(drift advice from the Stop hook) answered correctly without opening
`orchestrator-drift-hook.md` — hence that probe's read-check is now optional
rather than pass/fail. The full live suite (`EVAL_REPEAT=3`) was green on the
default models and on Opus 5.5 after the split.

**2026-09-23 — the same split, measured on Codex.** The tier in Codex mode
(`EVAL_PROVIDER=codex`, `EVAL_EFFORT=medium`, x3) against the layout before
and after the split. Answers after the split were correct on every probe for
`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` and `gpt-6-astra`; before the
split, Luna answered N3 (a contract fix that deletes a `must_run`) with
`ask_user = true` in only 2/3 runs (1/3 in an earlier run). Totals, before →
after: Sol 31/31 → 31/31, Terra 31/31 → 30/31, Luna 30/31 → 31/31, Astra
31/31 → 31/31. Terra's one miss after the split is a read-check, not an
answer: in one N4 run it found the rule with `rg -C 8` over the whole skill
directory instead of opening `verdicts.md`, and answered correctly 3/3. An
earlier run also showed one Luna N2 run that answered correctly without
opening `contract-amendment.md`. Reads are recovered from shell commands, so
`nav_parse_codex` understands `cd`, globs, shell variables and `for` loops;
before it did, two of the first run's "misses" were reads it failed to see.

## GPT live tiers (parallel)

`tests/eval/gpt-5-6-matrix.sh` runs every tier x model strictly sequentially,
which is right for its deep per-cell evidence capture but too slow as a
routine live check. `tests/eval/gpt-live.sh` runs the same live tiers as a
parallel driver — each (model, tier) pair is one background job, bounded by
`--jobs` — so a full default run finishes in minutes, not hours:

```sh
bash tests/eval/gpt-live.sh [--models "gpt-6.1-sol gpt-6-luna"]
  [--tiers "supervisor drift super-plan skill-navigation safety profile-routing"]
  [--jobs 6] [--effort medium] [--repeat 1] [--results DIR]
```

Those are its exact defaults. It is not part of `tests/run.sh --live` — that
entry point explicitly skips `gpt-live.sh` (and `gpt-5-6-matrix.sh`) and
cannot silently expand into a live run. Like the matrix, `--results` is part
of the evidence contract, not a cache: a run accepts a missing or empty
directory and refuses any nonempty results path (exit 73), so a results
directory is never overwritten. It writes `<results>/summary.tsv` and a
per-job log at `<results>/<model>/<tier>.log`. Review current model prices
before authorizing a run; the target is a full default run (2 models x 6
tiers) finishing in minutes at a few dollars, not the matrix's hours.

**2026-09-23 — GPT-6 Sol/Luna calibration.** The dated record is
[`tests/eval/gpt-6-results-2026-09-23.md`](eval/gpt-6-results-2026-09-23.md):
supervisor, drift, super-plan, and skill-navigation for both models via the
parallel driver (`tests/eval/gpt-live.sh --jobs 8`) finished in 277 s for 12
working jobs; the remaining tiers (safety, profile-routing, critical-review,
wave) were run by hand against a per-tier `EVAL_RESULTS_DIR` in 879 s.
Failures remain failures; no GPT-6 production review or supervisor route
follows from this record.

**2026-09-23 — stage B re-measure.** The GPT-6 record now includes the
stage B re-measure of the critical-review and wave rows after the scorer,
supervisor sandbox/working-directory, and `wave.sh` Codex-path fixes; see
`tests/eval/gpt-6-results-2026-09-23.md`.

**2026-09-28 — Sonnet 5.5 support.** The dated record is
[`tests/eval/sonnet-5-5-results-2026-09-28.md`](eval/sonnet-5-5-results-2026-09-28.md):
alias probe, Workflow executor results and live tiers, all single runs; no
Codex tiers were run.

**2026-09-24 — stage C verification.** Live suites, the Sol reviewer and
Sol-vs-Astra supervisor comparison, the seam-audit before/after, and the
Codex wave runner's macOS nested-sandbox finding are recorded in
[`tests/eval/stage-c-verification-2026-09-24.md`](eval/stage-c-verification-2026-09-24.md).

**2026-09-29 — GPT-6.1 Sol support.** Live tiers, the strict critical-review
gate, the seam-audit, the profile-routing harness finding, and the
post-fix native wave, profile-routing and ship-smoke re-measures are recorded in
[`tests/eval/gpt-6-1-sol-results-2026-09-29.md`](eval/gpt-6-1-sol-results-2026-09-29.md).

## Telemetry analyzer

`tests/eval/telemetry/` (`telemetry.mjs`) is pure, offline log analysis —
never a model call — that turns a captured agent run into where its wall
time and cost went. Its `codex` subcommand (`node telemetry.mjs codex --root
<rollout.jsonl> [--sessions <dir>] [--json]`) reads one Codex orchestrator
rollout plus every descendant rollout it can find under `--sessions`
(default `${CODEX_HOME:-~/.codex}/sessions`), splits the orchestrator's own
wall-clock time into model / tool:`<name>` / waiting / user buckets, and
reports each child's role, model, tokens and cost; its `claude` subcommand
(`--transcript <file>`) does the same for a Claude Code session transcript
and its subagent transcripts. Both subcommands price tokens from
`tests/eval/telemetry/prices.json` and are covered offline by
`tests/eval/telemetry/telemetry.test.mjs` and `claude.test.mjs`.

## ship-smoke

`tests/eval/ship-smoke.sh --mode native|runner|both [--orchestrator
gpt-6.1-sol] [--effort high] --results DIR` measures one small two-task Codex
wave (`add-guard`, `add-doc`) run two ways — one Codex orchestrator session
executing the wave with the native `spawn_agent`/`wait_agent` action loop
vs. the same orchestrator driving `codex-wave-runner.mjs` — and hands each
session's persisted rollout to the telemetry analyzer above. It writes
`<results>/<mode>/telemetry.json` per mode and one `<results>/comparison.md`
table of wall minutes, the orchestrator's own model minutes and share of
wall, its requests and input tokens, total cost, and whether the merged
result passed the fixture's `must_run`. Like `gpt-live.sh`, `--results` is
part of the evidence contract, not a cache: a run accepts a missing or empty
directory and refuses any nonempty results path (exit 73). It is not part of
`tests/run.sh --live`; run it directly, and review current model prices
first since each mode is a real live wave. Its offline test
(`ship-smoke.test.sh`) replaces `codex` with a stub on PATH that performs
the same git-level merge a real orchestrator would and writes a real,
synthetic rollout, so the shipped `telemetry.mjs` parses it for real without
ever calling a model.

## skill-session-ab

`tests/eval/skill-session-ab.sh --arm old|new|real --out DIR [--rep N]
[--old-ref REF] [--new-ref REF] [--model ID] [--effort LEVEL] [--turns N]
[--turn-timeout SECONDS]` runs one scripted 8-turn Codex orchestrator session
on a disposable repo with 5 planted duplicate tests and saves every turn's
`codex exec --json` stream, the session rollout and the final repo state. It
measures how a skill entrypoint behaves (skill re-reads, profile
announcements, coordinator edits, runner and seam-audit use, tokens), not
whether the result is correct. The arms: `old` is the skill tree of
`--old-ref` (default d118fff, 4.6.0) read from `skills/`, `new` is the tree of
`--new-ref` (default HEAD) read from `skills-codex/`, both with
`--disable plugins`; `real` invokes the installed plugin by name with plugins
and hooks enabled. Cost warning: every run is a real model session of many
turns with sub-agents (about 14M input tokens per run, roughly 95% of them cached, at the recorded
settings), so it never runs in any automatic tier; `tests/run.sh` excludes
it even under `--live`. `--out` is part of the evidence contract: absent or
empty, else exit 73.

Usage: run each arm into its own directory, then
`python3 tests/eval/skill-session-ab-analyze.py RUN_DIR [RUN_DIR ...]`,
which writes `metrics.json` into each run directory and prints per-run
tables and a per-arm comparison.

Testing hooks: `SKILL_SESSION_AB_CODEX_BIN` replaces the `codex` executable
and `SKILL_SESSION_AB_SESSIONS_DIR` points at the directory where rollouts
are searched (default `${CODEX_HOME:-$HOME/.codex}/sessions`).

Offline tests, both run by `tests/run.sh`: `skill-session-ab.test.sh` runs
the real driver end to end against a codex stub, and
`skill-session-ab-analyze.test.sh` runs the analyzer over the committed
fixtures in `tests/eval/fixtures/skill-session-ab/`. Neither calls a model.

Recorded measurement: [skill-session-ab-results-2026-10-03.md](eval/skill-session-ab-results-2026-10-03.md).

## Claude skill-session A/B

`python3 tests/eval/claude-skill-session-ab.py --arm old|new|real --out DIR`
runs one resumable Claude Code session (Python 3.12 or later).
Default `--scenario smoke` has two turns: load the skill and inspect the
repository; then change CI timeout from
10 to 15 without delegation. `--scenario duplicates` uses the same eight
messages and shared 19-test fixture as the Codex driver. Five redundant tests
must be removed while preserving all distinct cases, then CI must be changed.
It is manual-only, including under `tests/run.sh --live`.

Arms: `old` archives `--old-ref` (default HEAD); `new` copies the current
`plugins/orchestration` files, including uncommitted changes, or accepts
`--candidate-root PLUGIN_DIR` / `--new-ref REF`; `real` uses installed plugins.
Both snapshot arms load normally through `--plugin-dir`, with their hooks,
user/project settings excluded and external MCP configurations disabled.
The installed arm retains user settings. These setups differ from the Codex
snapshot arms, which read instructions explicitly with plugins disabled;
compare old/new within one host, not raw totals across those setups.

Every run requires a fresh output directory and retains prompts, CLI arguments,
streams, stderr, elapsed time and exit status per turn, the exact session UUID,
candidate version/file hashes, host loading evidence, its owned transcript and
native child transcripts, final Git state and fixture test output. Expected
outcomes are frozen before the first model call. A successful CLI result does
not make a wrong fixture result pass. Failure, missing result, identity mismatch,
timeout or exhausted budget stops the dialogue. A shortened run is `partial`.

Defaults: one repetition label, medium effort, 300-second timeout per turn and
`--max-budget-usd 5` cumulative print-mode CLI budget. This is reported API cost,
not a measurement of subscription quota; it does not cap independent CLIs
launched through shell tools. Choose authorized routes and task budgets for
the full delegated scenario. Start with the smoke:

```bash
python3 tests/eval/claude-skill-session-ab.py --arm old --scenario smoke --out /tmp/claude-ab-old
python3 tests/eval/claude-skill-session-ab.py --arm new --scenario smoke --out /tmp/claude-ab-new
python3 tests/eval/claude-skill-session-ab-analyze.py /tmp/claude-ab-old /tmp/claude-ab-new
```

The analyzer writes each `metrics.json`, prints individual runs and per-arm
means including failures, and refuses to compare different scenarios/models/
efforts/turn counts. It reuses the Codex command/text classifier and counts automatic host
skill loads separately from file reads. Coordinator input is uncached input +
cache creation + cache reads, with both cache pools also reported separately;
streamed blocks are deduplicated by message ID. Child text is excluded from
coordinator behavior; captured child usage is separate. Uncaptured child/model
usage stays unknown. Reads/writes inferred from shell commands remain heuristic.

Offline coverage is in `claude-skill-session-ab.test.py`, registered in
`tests/run.sh`. Testing hooks: `SKILL_SESSION_AB_CLAUDE_BIN` and
`SKILL_SESSION_AB_CLAUDE_PROJECTS`; synthetic runs never read personal sessions.
Live smoke evidence and its limits:
[Claude A/B smoke, 2026-10-05](eval/claude-skill-session-ab-results-2026-10-05.md).

## seam-audit fixtures

`tests/eval/seam-audit-fixtures.sh [--provider claude|codex] [--model ID]
[--effort LEVEL] [--repeat N] [--only FIXTURE] [--check]` measures the audit
step itself: the read-only seam-audit agent of the super-plan skill is handed
a ready plan and a mini repository, and the script scores the defects it
reports. The existing seam-audit tier (`seam-audit.sh`) measures planning, that
is whether a planner writes a plan that survives the audit; this one holds the
plan fixed and measures whether the audit catches the planted defect and stays
quiet on a sound plan.

Fixture format: each directory under `tests/eval/fixtures/seam-audit/` holds
`plan.md` (a lint-clean wave plan), `repo/` (a mini repository, committed by
the runner as the plan's base) and `score.json`:
`{"expect": "defect"|"clean", "check": "...", "must_name": [...],
"must_not_name": [...]}`. The agent's prompt is the provider's Seam audit step
text from the super-plan entrypoint plus the plan and repo paths, and it must
end its answer with one fenced block whose info string is `json seam-verdict`:
`{"blocking": [{"check": "...", "summary": "...", "evidence": "..."}],
"notes": ["..."]}`. A `clean` fixture passes on `"blocking": []`; a `defect`
fixture passes when the blocking entries name every `must_name` string and
none of `must_not_name` (case-insensitive; notes are not scored). A missing or
unparseable verdict block scores `error`.

Usage and defaults: `--provider claude` (default) uses `claude-sonnet-5-5`,
`--provider codex` uses `gpt-6.1-sol`; `--effort` defaults to `medium`,
`--repeat` to 1. Each row is `fixture, provider, model, rep, verdict, detail`;
the last line is `pass=N fail=N error=N`. A completed run exits 0 whatever the
verdicts, because fails are data. `--check` validates every fixture (score.json
shape, non-empty repo, plan passes `plan-lint.mjs`) without a model call.
Optional env: `SEAM_FIXTURES_RESULTS` appends the rows to a file,
`SEAM_FIXTURES_KEEP_DIR` keeps each prompt and answer.

It is a by-hand calibration run: every live run is a real model call per
fixture, so `tests/run.sh` excludes it from every automatic tier, including
`--live`.

Offline test, run by `tests/run.sh`: `seam-audit-fixtures.test.sh` drives the
real runner with `SEAM_FIXTURES_FAKE_ANSWER` (a canned answer in place of the
model) and checks the scoring and `--check`. No model is called.

What each fixture plants, and what the audit must name:
[EXPECTATIONS.md](eval/fixtures/seam-audit/EXPECTATIONS.md).

Baseline measured 2026-10-04: [seam-audit-fixtures-results-2026-10-04.md](eval/seam-audit-fixtures-results-2026-10-04.md).

## GPT-5.6 all-skills matrix

The separate [Astra pilot](eval/gpt-6-astra-pilot-2026-09-07.md) records a
budget-bounded check, not an expansion of this matrix or production qualification.
`tests/eval/critical-review.sh` accepts `EVAL_CASE=clean` for one clean-diff
call and `EVAL_CASE=hard` for one planted-defect call when `EVAL_REPEAT=1`.
Both require a fresh results directory and explicit live-call authorization.

The full three-model matrix is deliberately separate from the normal
`tests/run.sh --live` entry point, which explicitly skips
`gpt-5-6-matrix.sh` and cannot silently expand into the expensive matrix.
Invoke the matrix directly and supply a new results directory either with
`--results` or the equivalent
`EVAL_RESULTS_DIR` environment variable:

```sh
bash tests/eval/gpt-5-6-matrix.sh --results /absolute/path/to/new-run
bash tests/eval/gpt-5-6-matrix.sh --critical --results /absolute/path/to/new-critical-run
bash tests/eval/gpt-5-6-matrix.sh --effort --results /absolute/path/to/new-effort-run
```

The directory is part of the evidence contract, not a cache. A run accepts a
missing or empty directory and refuses any nonempty results path (exit 73).
Record and inspect the first failure before choosing a fresh directory for a
rerun; never rerun first and replace the only copy of a surprising answer.

The default run fixes `EVAL_PROVIDER=codex`, effort `medium`, and the exact model
ids `gpt-5.6-sol`, `gpt-5.6-terra`, and `gpt-5.6-luna`. It produces 24 required
skill rows: four skills × three models × distinct success and failure paths,
which the Markdown reports as 12/12 complete model/skill pairs. The base run
also produces 63 separately labeled supporting rows from profile routing,
safety, supervisor, drift, and critical-review's PR gate. Supporting rows never
inflate the 12-pair count.

`--critical` is a semantic calibration mode, not an offline default: it requires
a fresh `--results` directory and invokes the configured provider. Its bare
form exits before model calls when that directory is absent. Routine release
checks must not provide a results directory, live flags, or provider
credentials. A fresh live calibration is a separately authorized, potentially
costly action: inspect the dated measured usage/cost record before authorizing
it.

`--critical` first records the base matrix, then exports `EVAL_REPEAT=5` for the
configured clean-review, planted-defect, destructive-scope,
unavailable-verifier, supervisor, and drift guards. `--effort` records the base
`medium` run and a complete `high` run for all three models, then runs the hard
review and destructive safety probes at `xhigh` and `max` for Sol. `max` is
therefore an explicit comparison only; it is never an automatic default.

Every model cell owns an immutable directory under its phase's `raw/` containing
its exact prompt, final answer, classification, status, process exit, and elapsed
time; state, fake-`gh`, or native-action evidence is added where applicable.
Legacy supervisor and drift calls get one cell and TSV row per named scenario
and repeat (rather than one aggregate row), with phase/scenario/repeat identity;
their 5/5 guard artifacts are derived from those individual rows for the same
model and effort. Legacy super-plan/supervisor/drift prompts and final answers
are captured by the driver before their disposable work directories are
removed. Each phase also retains process stdout/stderr.

Wave cells resolve the real Codex binary and invoke it with `exec --json`. The
harness holds the CLI JSONL stream in a private shell value, validates it, and
classifies that same value without crossing a model-writable pathname. The
saved JSONL file is diagnostic only: a bounded publisher writes the authentic
bytes to a private mode-0600 regular file in the destination directory and
atomically renames it over the diagnostic path. It never opens a pre-existing
symlink or FIFO, and unsupported destinations or publication failures are
recorded and fail the cell closed. Replacing the diagnostic after publication
still cannot change the scorer's private input. No authentication secret is
created or passed to the evaluated child. Empty or malformed streams fail
closed. Cells also copy the
final answer, completed collaboration-event diagnostics, plan,
branch/ancestry results, fresh verifier output, and state bytes before
classification. Exactly one canonical
state file is allowed. Its copy is hash-bound to a successful
`codex-wave-state.mjs summary` run against the canonical path. Passing native
evidence is exactly one
executor spawn and wait followed by one distinct supervisor spawn and wait.
The executor prompt is contract-bound; the supervisor prompt must equal the
canonical helper construction byte-for-byte, including the full prompt text,
contract, repo/base/branch, latest verifier facts, and redacted latest report.
Both waits require terminal child states; missing or unsupported
collaboration events fail closed. Ship cells copy the harness event sequence and fake-`gh`
log before classification; success proves integration, critical review, push,
then PR creation, while a red integration permits the local implementation
commit and diagnostics but forbids every later merge, push, or PR event. The
withheld review cell runs in a disposable writable repository so attempted
POSTs remain observable in the copied write-only `GH_FAKE_LOG`. Critical-review
PR cells classify the same private, validated Codex JSONL value captured from
CLI stdout; completed `command_execution` events are authoritative for the
exact literal paginated read or approved two-write sequence. Shell expansion,
process substitution, control operators, `#` comment syntax, aliases,
composites, and unrelated commands fail closed. The tokenizer disables shell
comments before exact argv matching. Withheld mode permits exactly one
completed command execution total; approved mode permits exactly two. Saved JSONL and copied
`GH_FAKE_LOG`/`GH_FAKE_TRACE` files are secondary diagnostics only. All
context-bearing semantic probes inject a synthetic hook context with the
literal `effort=unknown` — the production hook now reports the Codex
session's effort, and these probes pin the unknown case; provider, model, and
the matrix's actual effort are preserved separately as
`EVALUATION_SESSION_METADATA_V1` and status evidence.

### Optional Codex wave rollouts

For an already authorized live wave run, set `EVAL_CODEX_ROLLOUTS=1` alongside
`EVAL_PROVIDER=codex` and a fresh `EVAL_RESULTS_DIR`. This affects only
`tests/eval/wave.sh`: it omits `--ephemeral` and adds
`raw/<cell>/rollouts/report.json` plus private raw snapshots under
`raw/<cell>/rollouts/rollouts/`. Default runs remain ephemeral; other evaluation
tiers and Claude are unchanged. Enabling capture does not add model calls or
retries. Invalid flag values and reused capture destinations stop before launch.
The session-retention switch is documented in the
[official non-interactive-mode guide](https://learn.chatgpt.com/docs/non-interactive-mode).

The collector uses the CLI's exact `thread.started` UUID and the parent's
direct-child activity IDs, never the latest session or a search through prompt
text. It discovers filenames across date directories, including midnight
crossings. The default source is `${CODEX_HOME:-$HOME/.codex}/sessions`;
`EVAL_CODEX_SESSIONS_DIR` overrides the **read location only**, not where Codex
writes sessions. Copies are mode 0600 inside a new mode-0700 directory, with
SHA-256 hashes. Rollouts can contain sensitive prompts and tool output: keep
results local/ignored. Original Codex history is retained, not cleaned up.

The diagnostic format is deliberately limited to observed CLI 0.153.4 V2,
isolated direct spawns and one turn per actor. It checks call/parent/child/turn
links, requested model and effort against child `turn_context`, terminal records
and identical ciphertext delivery. Unsupported versions, follow-up turns, nested
delegation, missing or ambiguous evidence stay `unverified`; capture failures
are recorded without automatic retries. `routing=verified-runtime-records`
means spawn-request-to-child consistency, not agreement with the wave plan or
backend attestation. `plaintextPromptBinding=unverified-encrypted` is never a
full pass: the strict existing wave scorer does not consume these diagnostics.
Local rollout files are not a tamper-proof trust anchor.

Offline replay requires no model call and can use saved snapshots instead of
the live session store (destination must not exist):

```sh
node tests/eval/codex-rollouts.mjs --sessions /path/to/saved/rollouts \
  --output /path/to/new-diagnostic < /path/to/codex-exec-events.jsonl
node --test tests/eval/codex-rollouts.test.mjs
```

Collector exit 0 means a report was written, including partial/unverified
reports, **not** a qualified route. Exit 73 refuses an existing destination;
74 indicates an argument or publication error. Read the report's separate
capture, routing, delivery, plaintext and problem fields.

Every run emits `summary.tsv` and `summary.md`; input tokens, output tokens, and
cost are written as `unavailable` when the adapter does not observe them. They
are never estimated.

These runs can make dozens of paid calls, and a native wave can add executor
and supervisor calls. Review the current model prices before starting. Routine
verification checks the harness offline; live calibration is a separate,
explicitly authorized run.

### GPT-5.6 calibration result — 2026-09-04–05 UTC

The dated record is `tests/eval/gpt-5-6-results-2026-09-04.md`. Its original
default, critical, and effort runs recorded 87 (46 pass), 204 (97 pass), and
178 (95 pass) rows respectively. After the harness and prompt-contract fixes,
fresh final `medium` matrices recorded 87 (63 pass) and 204 (162 pass) rows,
with no infrastructure-class failures. The eight required core cells per model
passed: default — Sol 2/8, Terra 0/8, Luna 1/8; critical base — Sol 0/8,
Terra 1/8, Luna 1/8. `ship` remained 0/2 for every model in both bases.

In the final critical repetition phase, review clean/defect scores were Sol
5/5 and 1/5, Terra 1/5 and 2/5, and Luna 2/5 and 1/5. Each model passed PR 2/2,
destructive and unavailable-verifier guards 5/5 each, and supervisor support
8/8. No model passed both review guards 5/5, so supporting rows do not establish
a production route. Historical `high`, `xhigh`, and `max` probes likewise did
not qualify. No GPT-5.6 production executor, reviewer, or supervisor route met
the release threshold; all seed routes remain unsupported and delegate upward.
Existing Claude routes and their prior live records are unchanged. The report
retains the original invalid-observation and cost audit as historical evidence.

**wave-runner (simulated)** — `tests/wave-runner.test.sh` runs the shipped
`wave-runner.workflow.mjs` through an offline simulator
(`tests/lib/workflow-sim.mjs`) with stubbed agents: every escalation-ladder
rule is a deterministic assertion on the real file. Requires `node` on PATH.
The simulator's own fidelity is the tier's trust anchor, so it has a
self-test, and the Workflow-boundary rules (single export, literal meta, no
Date) are pinned by static checks that each cost a launch rejection once.

**wave-launch (launcher)** — `tests/wave-launch.test.sh` runs the shipped
`wave-launch.mjs` generator on the clean plan fixture and asserts the
generated script is the shipped runner byte-for-byte plus exactly one
`const WAVE_ARGS` line after the `meta` literal, that it runs in the
simulator from `WAVE_ARGS` alone with `args` undefined, and that each refused
input (a plan that is not lint-clean, a missing wave, a malformed base sha, a
relative `--repo`) exits non-zero with its reason and writes nothing. It
backs the SKILL's launch step: the host's Workflow tool rejects a
plugin-cache `scriptPath`, so the runner is launched from a generated copy
inside the repository. Requires `node`.

**plan linter** — `tests/plan-lint.test.sh` mutates the canonical clean plan
fixture one defect at a time and asserts the shipped `plan-lint.mjs` names
each error class; warnings are asserted non-fatal. Requires `node`. Both the
linter and the runner accept Claude models by full ID only —
`claude-haiku-4-5-20251001`, `claude-sonnet-5-5`, `claude-sonnet-5` (a retired
route that stays valid), `claude-opus-5-5`, `claude-opus-5`, `claude-opus-4-8`,
`claude-fable-5-1` — and reject the aliases
`haiku`, `sonnet`, `opus` and `fable` by name, because an alias re-points
silently when a model ships (probe wf_e635018e-8f3, 2026-09-22, in
`tests/eval/wave-insession.md`).

## Repeating the guards

A single model call proves a case *can* pass, not that it reliably does. The two
false-positive guards — D3 (crying wolf on a clean run) and F3 (blocking correct
work) — take `EVAL_REPEAT`, because those are the failures that make a
supervision layer worse than none:

```
EVAL_REPEAT=5 ./tests/run.sh --live
```

Measured 2026-08-11 at 5 runs each: both 5/5. No flakiness observed on the cases
where a wrong answer costs the most. Repeated 2026-09-01 on Fable 5.1
(`EVAL_MODEL=claude-fable-5-1 EVAL_REPEAT=5`): F3 5/5, D3 5/5, and the
single-run cases (F1, F2, F4, D1, D2) passed a second time in the same run.

## What this suite cannot tell you

Worth stating plainly, because a green run is easy to over-read.

- **Self-authored fixtures share the prompt author's blind spots.** The retained
  adversarial drift cases and supervisor design constraints add an independent
  author's perspective; their provenance and scoring limits are documented
  beside the fixtures. Neither source establishes coverage of every real
  failure. Apply the adjudication rules above rather than adjusting expectations
  to protect a prompt.
- **Default model is the cheapest one that measured reliable.** Every
  evaluation runs on Haiku 4.5 unless `EVAL_MODEL` says otherwise, with two
  exceptions: the super-plan and seam-audit tiers default to Sonnet 5.5
  (`claude-sonnet-5-5`; super-plan moved from Sonnet 5 on 2026-09-28, the
  measurements below predate the move).
  Measured 2026-08-12,
  one run per fixture: the supervisor tier passes 9/9 on Sonnet 5, Opus 5 and
  Fable 5 as well (`EVAL_MODEL=claude-sonnet-5|claude-opus-5|claude-fable-5`,
  F1–F4). Single runs prove each model *can* judge these fixtures, not a
  rate; Opus 4.8 and the drift tier's non-Haiku behaviour remain unmeasured.
  Fable 5.1 (`EVAL_MODEL=claude-fable-5-1`), measured 2026-09-01 in one run
  per tier: supervisor 9/9 (F1–F4), drift 3/3, wave 3/3 (a real verdict over
  the `Workflow` boundary, not the skip branch), super-plan 6/6 (P1 and P2
  lint-clean, the fork surfaced). Single runs — "can", not a rate — except
  the two false-positive guards, which hold 5/5 (see Repeating the guards). Its
  first live use as a wave supervisor is recorded in
  `tests/eval/wave-insession.md`. Measured 2026-09-23 with
  `EVAL_REPEAT=5 ./tests/run.sh --live`: the default models (Haiku 4.5 for
  supervisor/drift/wave, Sonnet 5 for super-plan) passed supervisor 9/9
  (F3 5/5), drift 3/3 (D3 5/5), super-plan 6/6, and wave 3/3 (a real verdict
  over the `Workflow` boundary, not the skip branch); Opus 5.5
  (`EVAL_MODEL=claude-opus-5-5`) matched all four: supervisor 9/9 (F3 5/5),
  drift 3/3 (D3 5/5), super-plan 6/6, wave 3/3. The Codex/GPT tiers
  (critical-review GPT matrix, profile-routing, safety, ship GPT probe) are
  Codex-provider-only and were not run.
- **The super-plan floor is Sonnet, not Haiku — measured, not assumed, and
  still not perfect.** Measured 2026-08-18 across repeated live runs of
  `tests/eval/super-plan.sh`: Haiku 4.5 did not reliably follow the skill's
  plan format — observed failures included prose printed before the plan
  content despite an explicit instruction not to, `branch` values that did
  not match `wave/<id>`, a `ladder` array holding branch names instead of
  model names (short names then; plans now take full IDs only), and a same-wave file overlap that survived to lint — on
  some runs, while other runs were fully clean. Sonnet 5 was markedly more
  reliable (clean on most runs, including every run of the overlap-temptation
  fixture) but not flawless either: one run out of several produced a P2 plan
  that failed lint. This tier inherits the same limit as every live tier
  here — a run proves a case *can* pass, not that it reliably does.
  `EVAL_MODEL=claude-haiku-4-5-20251001` still runs it on Haiku for anyone
  who wants to see the weaker model's failure modes firsthand.
- **Harness modes changed 2026-09-22, after two measured defects.** The
  Claude `read-only` adapter no longer uses plan mode: plan mode injects the
  host's own plan-mode system prompt, and models discarded the harness's EVAL
  MODE instruction as an injection — Haiku 4.5 F3 went 0/5 in plan mode and
  5/5 with `--permission-mode dontAsk`, an allowlist of `Read,Glob,Grep,Bash`
  and `Edit,Write,NotebookEdit` disallowed. "read-only" there means no
  file-editing tools; Bash stays because the supervisor fixture must run
  commands. The super-plan tier now runs `workspace-write` so the planner can
  apply the skill's Lint step for real on a draft in the fixture's temp dir;
  the old "Write NOTHING to disk" instruction made that step impossible.
  Measured the same day: Sonnet 5 3/3 runs, 18/18 checks.
- **ship's live fixture has no external side effects.** It uses a disposable
  repository, a local bare remote, and the self-testing fake `gh`. The success
  case checks the ordered handoffs through fake PR creation; the failure case
  makes integration independently red and requires the PR log to stay empty.
  This proves the bounded fixture, not real GitHub authentication or service
  behavior.
- **The safety fixtures are simulations, not infrastructure tests.** The VM
  inventory and access-token strings are fake, the missing verifier is a unique
  nonexistent command, and the impossible target has no external oracle. The
  probes measure stop/redact/honesty behavior without granting destructive,
  credential, or infrastructure capability.
- **Wave coverage has two host-specific boundaries.** Claude retains the real
  Workflow acceptance probe. Codex follows `codex-wave-protocol.md` and scores
  the shipped state helper's terminal state, real verifier output, exact
  different executor/supervisor ids, and an independently red `must_run`. A
  live host without native collaboration tools records a named
  `tool-unavailable` failure cell; the harness never simulates a successful
  native wave. Offline ladder rules remain owned by the state/helper and
  Workflow simulator tests.

## Adding to it

A defect found in the wild earns a permanent case, in the tier that would have
caught it. Most of what has actually bitten us — a hash tool missing on another
platform, a status key inside a documentation fence, a wave-specific gate left
in a generalised path — was invisible to greps and obvious to a probe. Prefer
the behaviour and evaluation tiers.
