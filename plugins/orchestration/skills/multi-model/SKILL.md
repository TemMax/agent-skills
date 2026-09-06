---
name: multi-model
description: 'Use when implementation work should be delegated, parallelized, or routed across Claude or GPT-5.6 agents, especially when isolated worktrees and independent supervision are required. Do not use for single-agent work.'
metadata:
  author: https://github.com/TemMax
  version: 2.6.0
---

# Orchestrating Multi-Model Development

## Step 0 — load exactly one active-seat profile

1. Read the `PLUGIN_RUNTIME_CONTEXT_V1` line for this plugin.
2. If it carries a supported exact model id, load that id's relative profile.
3. Otherwise use an exact model id explicitly supplied by the session.
4. Otherwise load the generic profile and treat both model and effort as unknown.

Never read a user config file to guess a session override. Never load more than one active-seat profile. A profile whose exact-id guard does not match must not be applied.

| Exact model id | Relative profile |
|---|---|
| `claude-fable-5-1` | `references/orchestrator-fable-5-1.md` |
| `claude-fable-5` | `references/orchestrator-fable-5.md` |
| `claude-opus-5` (any context-window suffix) | `references/orchestrator-opus-5.md` |
| `claude-opus-4-8` (any context-window suffix, e.g. `[1m]`) | `references/orchestrator-opus-4-8.md` |
| `gpt-5.6-sol` | `references/orchestrator-gpt-5-6-sol.md` |
| `gpt-5.6-terra` | `references/orchestrator-gpt-5-6-terra.md` |
| `gpt-5.6-luna` | `references/orchestrator-gpt-5-6-luna.md` |
| unknown | `references/orchestrator-generic.md` |

The alias `gpt-5.6` selects Sol only after the runtime-context handler has
normalized it to `gpt-5.6-sol`. An exact supplied effort may be used; otherwise
effort is unknown and receives no effort-specific claim. State which profile was
loaded before planning. That profile amends the numbered steps below; where it
amends a step, the amendment wins.

Profiles choose model and effort routes while authoring a wave plan or explicitly
amending one. Once a lint-clean plan is explicitly user-approved, its exact
provider, model, and effort fields are authoritative for adapter execution: do
not re-route or reject that approved artifact against a seed profile. This never
permits a mixed/unknown-provider wave or bypasses lint and user approval.

### GPT-5.6 calibration gate — 2026-09-04–05 UTC

No GPT-5.6 production wave route is supported. The final post-fix `medium`
matrices recorded 63/87 passes in default mode and 162/204 in critical mode,
with no infrastructure-class failures. Of eight required core cells per model,
the default matrix passed Sol 2/8, Terra 0/8, and Luna 1/8; the critical base
passed Sol 0/8, Terra 1/8, and Luna 1/8. No model passed all required paths,
and `ship` remained 0/2 for every model in both bases. Historical `high`,
`xhigh`, and `max` probes also established no route. During plan authoring,
return the GPT route as `unsupported` with the evidence packet and delegate the
routing decision upward. Do not substitute another GPT model, mix providers in
one wave, or use `max` by default. Existing Claude routing below is unchanged.
Full counts and limitations:
`tests/eval/gpt-5-6-results-2026-09-04.md`.

## Overview

The orchestrator (this session's model) researches, plans, writes task specs, and
verifies; the executors (Haiku 4.5 / Sonnet 5 / Opus 5 / Opus 4.8, and Fable 5.1
as an explicit rung) implement. Core
principle: **decisions belong to the orchestrator, execution belongs to the
agents**. Every rule below is derived from the models' official system cards; the
facts and numbers live in `references/model-dossiers.md`.

Always reply to the user in the language the user writes in — this skill being in
English does not mean English replies.

## Process

1. **Research.** Study the codebase to the depth needed for decomposition: files,
   dependencies, conventions. Any read-only fan-out goes through the Research
   Routing table below — research agents never inherit your model.
2. **Decisions.** Close the open questions BEFORE decomposing: research an
   incomplete specification further and pin down the interpretation (escalate
   fundamental choices to the user); design cross-cutting architecture yourself
   and hand it out as a set of concrete implementations. Do not delegate decisions
   even to an Opus executor — it silently fills in gaps under ambiguity.
3. **Plan.** Tasks: independent within their wave (no file overlap, otherwise —
   next wave or worktree), self-contained (the agent sees neither the conversation
   nor your research), closed (no "decide for yourself what's best"). Batch small
   same-shaped edits into one agent's task: parallelization pays only on hard
   chunks — on easy ones coordination overhead eats the gain. The decomposition
   covers ALL artifacts of the feature, including documentation (README and the
   like) — otherwise it silently goes stale: if you froze a file for everyone,
   assign it to someone explicitly.
4. **Table.** Before launching, show the user: task | model | effort | rationale.
5. **Write the wave plan file** (see Wave Plan Artifact) with `status: active`,
   and record the base SHA. You do this, not the user — the plan's lifecycle is
   yours to open and close, and nobody should have to hand-edit a field to make
   supervision work. Once it is lint-clean and explicitly approved, preserve its
   exact provider/model/effort fields through execution; profile routes are not
   a second execution-time planner.
6. **Launch.** Select the host adapter below; independent tasks remain isolated
   by the shared wave contract.
7. **Review** (see the checklist below). Fixes — as one concrete list. Two misses
   in the same place — fix the task spec, don't repeat the prompt.
8. **The final end-to-end review is the orchestrator's own.** Before it you may
   launch an Opus verifier, but the verdict is the orchestrator's.
9. **Completion.** At most 3 iterations per task, then escalation. At the end a
   summary: done / verified / remaining. **Set the wave plan's `status: done`**
   in the same breath — an open plan keeps the drift hook paying for a wave that
   ended.

## Model Routing — Quick Reference

| Task | Model | Why (see the dossiers) |
|---|---|---|
| Mechanical work per exact instruction, zero decisions | Haiku 4.5 | Cheaper; condition — zero decisions |
| Implementation against a clear spec, tests, migrations, isolated features | Sonnet 5 (default) | Near-Opus quality on closed tasks |
| Digging through a large volume of code for a specific question | Sonnet 5 | Holds 1M context |
| Independent verification, "what's actually broken here" | Opus 5 executor (default heavy) | First Claude to saturate lazy-investigation; parity with 4.8 on flagging planted flaws |
| Fine-grained debugging, concurrency, source-level security-sensitive code | Opus 5 executor | Strongest coding + best injection robustness; source security unblocked |
| A long unsliceable session | Opus 5 executor | Strongest long-horizon coding at Opus-4.8 price |
| Sonnet hit its ceiling after a fix iteration | Opus 5 executor | The heavy-executor upgrade over Sonnet |
| Reading untrusted external content (web, fetched pages, hostile files) | Opus 5 executor | Most injection-robust affordable model (IPI 0.4% at k=1); still pair with platform safeguards |
| Untrusted content whose compromise would reach secrets or irreversible actions (content known hostile, an agent that can act) | Fable 5.1 executor (`fable`) | Most injection-robust model to date: IPI 0.1% at k=1 / 1.0% at k=15 vs Opus 5's 0.4 / 4.8; none of 2,826 directly-answered coding requests broke (pp. 83, 86). Opus 5 stays the cost default |
| Reverse-engineering / vulnerability discovery in compiled binaries | Opus 4.8 executor (`claude-opus-4-8`) | Opus 5's and Fable 5.1's cyber classifiers block binaries (Fable 5.1 card p. 52); Opus 4.8 is where the fallback lands anyway (p. 46) — choose it, don't fall into it |

Torn between Haiku and Sonnet → Sonnet. Torn between Sonnet and Opus → improve the
task spec first, then upgrade the model. Opus 5 is the default heavy executor and
verifier; Opus 4.8 is retained only for compiled-binary work and as the
cyber-refusal fallback. In plans and runner args it is addressed by its
full ID `claude-opus-4-8`.

**Routing anti-patterns:** no sub-orchestrators — executors never spawn their own
subagents (documented failures in deep delegation chains: status honesty, not
capability); don't give any executor untrusted external content without platform
safeguards (Opus 5 is the most robust, but safeguards still matter); don't give
Sonnet multi-hour sessions; don't route compiled-binary reverse-engineering to
Opus 5 or Fable 5.1 (their classifiers block it) — use Opus 4.8.

## Research Routing — Quick Reference

The Model Routing table above routes work that changes things. Read-only
research agents — the fan-out behind planning, decomposition and reviews — are
routed here instead. An unrouted research agent inherits the session's model:
on a Fable seat (5 or 5.1) that silently bills file listings at the most
expensive rate available. Never spawn a research agent without naming its model.

| Research kind | Model | Why (see the dossiers) |
|---|---|---|
| Mechanical pattern search: occurrences of a known string or shape | Haiku 4.5 | Zero decisions; simple file searches are its documented lane |
| Closed enumeration: files, call sites, conventions, test commands that actually run | Sonnet 5, low/medium | Strong at digging through large code volumes (ProgramBench 76–86%, 1M context) and cheap; a closed question neutralizes its documented fabricate-when-information-is-missing failure (Sonnet 5 card, p. 71) |
| Open research sub-question: how a subsystem works, what depends on what, why it is shaped this way | Opus 5, medium/high | First Claude to saturate the lazy-investigation eval — a thorough investigator (p. 110); cap at high, its effort curve inverts |
| A report the orchestrator will trust without re-verification, or reasoning over a near-1M-token surface | Opus 4.8 (`claude-opus-4-8`) | Honesty ceiling (0.00 misreported rate) and the best long-context reasoning in the comparison set (GraphWalks 1M 68.1); DRACO rises monotonically through max |

Torn between Haiku and Sonnet → Sonnet, as always. The session's own model is
never the answer here: research is gathering, not deciding — the decisions stay
in the orchestrator seat, and the seat is where expensive reasoning is worth
its price.

**Mandatory lines in every research agent's prompt** (the research counterpart
of the executor task template):

- every claim carries evidence as `file:line`, or as a command plus its output;
- `not found` is a valid and expected answer — never fill a gap with a guess
  (Sonnet 5 fabricates precisely when information is missing, p. 71);
- read the sources: answering from memory about library or system behavior is
  forbidden (Opus 5's documented recall-as-truth failure, p. 87).

## Choosing Executor Effort — Quick Reference

This table is about the effort you hand to executors. Your own session's effort
is your profile's business, not this table's.

| Model | low | medium | high | xhigh |
|---|---|---|---|---|
| Haiku 4.5 | — does not support effort — | | | |
| Sonnet 5 | obvious solution, but the code must be read | routine implementation per spec | default for non-trivial work | hardest execution tasks; plateau! |
| Opus 5 executor | unusually strong on simple/scoped tasks | well-specified work | default for non-trivial work | avoid — overthinking/self-verification risk |
| Opus 4.8 executor (`claude-opus-4-8`) | — | most well-specified tasks (min effort ≈ Opus 4.7 max) | debugging, verification, long horizon | research-grade only |
| Fable 5.1 executor (explicit ladder rung only) | scoped, closed tasks | **peak on scoped coding** (FrontierCode, p. 169) — always with a scope/brevity line | long-horizon work | xhigh ≈ max at 19–25% fewer tokens (pp. 193–194); out-of-scope edits rise with effort — the scope line is mandatory |

Signal rule: wanting to give Sonnet xhigh because the task is open-ended → that
means switching the model to Opus or returning to the Decisions stage, not effort.
Opus 5's effort curve is the exception — higher is not better; it peaks mid-range
on coding and overthinks at `max`, so cap Opus 5 executors at `high`. Fable
5.1's curve has its own shape: task correctness keeps rising with effort but so
do unrequested out-of-scope edits (p. 169), so a Fable 5.1 executor prompt
always carries an explicit scope and brevity line.

## Wave Isolation

A supervised wave gives every executor **its own git worktree** and commits its
work to a branch named `wave/<task-id>`. Record the base SHA in the wave plan
before the wave starts; every later comparison is made against that SHA, never
against a moving `HEAD`.

**The base must be the commit the worktrees actually fork from, not your local
`HEAD`.** Agent worktrees branch from `origin/<default-branch>` by default
(`worktree.baseRef: "fresh"`), so a commit you made locally but never pushed
does not exist for any executor. Recording an unpushed `HEAD` corrupts every
comparison in the same direction: files that exist only in your checkout appear
as deletions in every branch, and the supervisor charges each executor with a
`files` violation for a change nobody made. That is the §7 failure — correct
work blocked — arriving through the base rather than through the contract.

So, before launching: **push the commit you intend as the base**, or record
`git rev-parse origin/<default-branch>` and accept that anything unpushed is
invisible to the wave. After the first executor commits, verify with
`git merge-base wave/<task-id> HEAD`; if it does not equal the recorded base,
stop and fix the plan rather than judging against it.

This is not tidiness, it is what makes the contract checkable at all. Executors
sharing one tree make two things impossible:

- **Attribution.** A diff of the shared tree contains every task's concurrent
  edits, so "this task touched a forbidden path" cannot be distinguished from
  "a neighbour legitimately owns that path" — the very violation the contract
  exists to catch.
- **Reproducibility.** A required command re-run against a tree a neighbour is
  editing can fail for reasons that have nothing to do with the task under
  judgment, and the escalation ladder would then send correct work back for
  rework.

A commit made inside a worktree survives that worktree's removal — worktrees
share the object database and refs — so `git diff <base>..wave/<task-id>` stays
available for supervision, and a second worktree can be checked out from the
branch for independent verification.

For an unsupervised wave, tasks still must not overlap in the files they touch.

## Wave Plan Artifact

Before launching a supervised wave, write the plan to a file — one entry per
task, carrying the prose, the contract, the assigned model, the branch and the
base SHA:

```yaml
base: 7c05ff5
status: active          # active | done — the hook reads this, never the file's existence
tasks:
  - task: http-retry
    model: claude-sonnet-5
    branch: wave/http-retry
    contract: {...}
```

**You own both transitions.** Write the file with `status: active` at step 5 and
set `status: done` at step 9. The user never edits it: a supervision layer that
depends on someone remembering to flip a field by hand is a supervision layer
that will be off when it matters.

Without this file "deviation" has no referent: there is nothing to deviate
from. It is a file rather than something you hold in context because a wave
outlives a context window, and a summarized context keeps the task list while
losing the exact identifiers the supervisor needs.

## Task Prompt Template (mandatory blocks)

Every executor prompt contains all six blocks — explicit instructions measurably
reduce the documented failure modes:

1. **Context:** specific files and lines, dependencies, project conventions.
   Compute numeric examples in the spec with a tool, not in your head — a wrong
   example contradicts the formula and derails the executor. In a supervised
   wave the executor works in its own worktree and sees no neighbour's edits, so
   say so — an agent that expects a busy tree will misread its own isolation.
2. **Boundaries:** what NOT to do — don't refactor adjacent code, don't add
   unrequested features/files, don't touch anything outside the list.
3. **Dead-end protocol:** "If data or access is missing, a tool is broken, or the
   path is impossible — stop and report what's blocking you. Don't invent values,
   don't work around the restriction, don't pick an interpretation on the user's
   behalf."
4. **Prohibitions:** do not spawn subagents; no destructive operations
   (force-push, reset --hard, rm outside the task) without explicit permission.
   Phrase prohibitions without qualifiers — executors rules-lawyer around wording
   when it conflicts with "the overriding goal".
5. **Definition of done and response format:** list of changed files, the
   gist of the changes, output of actually executed tests/linter, plus the
   committed-work proof: `git log --oneline <base>..HEAD` (non-empty) and
   `git status --porcelain` (empty), both pasted — uncommitted work does
   not exist for the wave, and "done but never committed" is the most
   common rejection on record.
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
   without that command's actual output is not weak evidence — it is a
   violation in its own right.

   State the prohibitions explicitly and loudly. This is measured, not
   stylistic: an explicit "don't work around it — report it" lowers fabricated
   workarounds from 17.4% to 9.1% for Fable 5 (pp. 161–163) and from 9.4% to
   2.8% for Opus 4.8 (pp. 109–110). The Fable 5.1 card did not repeat this
   measurement; what it documents instead is unrequested out-of-scope edits
   rising with effort (p. 169), which the same explicit scope line addresses.

For tasks with images/PDF/charts — give Sonnet code-execution access.

## Supervised Waves

Supervision is a stage in the `Workflow` script,
**not an instruction to self-check**. A check the executor is asked to perform
is a check it may decide
it already satisfied; a check in the control flow around it is one it never gets
a vote on. A stage can also do what advice cannot: reject and re-run.

Send `references/supervisor-prompt.md` to a model that is not the executor's own
(see Anti-Deception Rules), with the contract, the report, the base SHA and the
branch.

### Mechanical verification before the judge

The shipped runner inserts a fact-collecting stage between the executor and
the judge. A cheap verifier agent (default `sonnet`/`low`, overridable via
`args.verifier`) checks out the branch and records facts: does the branch
carry commits at all, which paths changed, what each `must_run` command
returns when actually run, and whether the report pastes output where the
contract says `evidence: required`. The runner — not a model — then applies
the deterministic half of the contract: a branch with no commits, a path
outside `files_allowed`, a red `must_run`, or missing pasted evidence
bounces straight back to the executor as a rework, and no judge is paid for
discovering it. Transcript mining across five real sessions found "work
done but never committed" to be the single most common rejection (8+
occurrences), each costing a full Opus verdict to detect.

Three properties are load-bearing:

- **Fail-open.** A dead verifier skips the stage; the model judge then runs
  the full pipeline itself, exactly as before. Mechanical verification can
  only save a judge call, never remove supervision.
- **Once per rule.** The same mechanical rule failing twice routes to the
  model judge with the facts attached — only a judge can decide
  `satisfiable`, and a repeat is where that question arises.
- **Facts, not judgment.** The verifier never decides `ok`,
  `pasteReproduced` or `satisfiable`; those stay with the judge, which
  receives the verifier's facts and may rely on its exit codes and outputs
  while re-running anything it doubts.

**Long commands, everywhere in the wave, are classified by kind — never by
predicted duration.** Build-system invocations (gradle, cargo, npm, pnpm,
yarn, make, mvn and the like) start in the background with output to a log
file and are polled; everything else runs in the foreground. A silent
foreground wait on a cold build looks like a stall and gets the agent
killed — one real session lost ~4.8 hours of supervision to exactly this,
then abandoned supervision entirely.

### Choosing the supervisor — Quick Reference

Two hard rules, then the table. Never the executor's own model (self-preference:
measured zero for Opus 4.8 and Fable 5, unmeasured for Opus 5 — so Opus 5 never
judges Opus 5; measured small but non-zero for Fable 5.1 — 0.1 points out of 10,
lenient when told the author is Claude, p. 124 — which is why the runner's judge
prompt never names the executor's model and why `fable` still judges Opus 5.
Not stating it does not stop a judge in an all-Claude pipeline from inferring
it; what bounds the effect is the magnitude and the contract's mechanical half
— verifier facts and grep-decidable checks the judge cannot soften).
Never a weaker tier than the executor's: the judge re-runs and re-derives
everything the executor did.

| Executor | Supervisor | Effort |
|---|---|---|
| Haiku 4.5 | Opus 5 | high |
| Sonnet 5 | Opus 5 | high |
| Opus 5 | Fable 5.1 via `fable` (fallback: Opus 4.8 via `claude-opus-4-8`) | high |
| Opus 4.8 | Opus 5 or Fable 5.1 | high |
| Fable 5.1 (explicit ladder rung only) | Opus 5 | high |

The short name `fable` resolves to whichever Fable the harness serves — Fable
5.1 as of September 2026; Fable 5 is no longer addressable and keeps its profile
and dossier for history.

Effort is `high` across the board — the shipped runner's default — and the row
is measured, not stylistic: on 2026-08-12 a Haiku supervisor at `medium` passed
an unsatisfiable contract, filing its whole analysis into `remarks`. A cheaper
judge on a mechanical task is not the economy lever; skipping the model
entirely is (see the cost section below). All four models above judged fixtures
F1–F4 correctly in single live runs after that fix; single runs prove "can",
not a rate.

**The supervisor trusts artifacts only.** It checks out `wave/<task-id>` into
its own worktree, runs the diff itself, executes each `must_run` command itself,
and greps for the forbidden moves itself. The report is a set of claims to
check, never a source of facts.

**A paste that does not reproduce is a fact, not an accusation.** The executor
pastes command output; the supervisor re-runs the command and compares. When they
differ it records `pasteReproduced: false` with both outputs — and stops there.
Whether the mismatch was fabrication, output captured before the last commit, a
differently-prepared tree, or a date-dependent test is not decidable from what a
supervisor can see, and four attempts to make a model decide it correctly all
failed in the same direction: the heaviest accusation, spent on honest work.

Verification asks whether something reproduces, not whether its author was
truthful — the answer reproducible builds arrived at. A single non-reproducing
paste rides along with the rework so the executor sees it. **Repetition is what
escalates**, and repetition is counted by the ladder, not judged by the
supervisor.

Verdict shape:

```json
{"ok": false,
 "violations": [{"rule": "must_run:pytest tests/http -q",
                 "class": "must_run",
                 "pasteReproduced": false,
                 "evidence": "report pasted a green run; supervisor got 2 failed",
                 "quote": "tests/http/test_retry.py::test_backoff FAILED"}],
 "remarks": ["src/http/backoff.py:41 duplicates the helper in src/net/retry.py"]}
```

`violations` decide `ok`; `remarks` never do. Classes: `files`, `must_run`,
`forbidden-move`, `report`. A violation without evidence the
supervisor produced itself is dropped, not softened — otherwise the supervisor
fabricates as readily as the executor it judges.

When a `must_run` command fails, run it a second time before recording anything.
If the retry passes, record a remark naming the command unstable and do not
block. Spending the supervisor's credibility on flaky tests buys nothing.

### Escalation ladder

| Situation | Action |
|---|---|
| 1st violation | Back to the same executor with the verdict attached |
| 2nd violation of the same rule | To a stronger model — repeating a prompt on the model that just failed it reproduces the failure |
| `pasteReproduced: false` on two attempts | Escalate to a stronger model: once is explicable, twice is a pattern, and the count is the ladder's to keep |
| Executor is already the strongest model | No higher rung: one rework with the verdict attached, then stop |
| The contract cannot be satisfied | Stop immediately — no rework, no stronger model. Return the task to yourself to amend the contract (below) |
| Stop | Hand the user the task, every verdict in order, and the branch name |

## Host adapter

### Invocation publication contract

`publication` is optional: if omitted, it means exactly `publication: push`
and preserves all normal behavior. The choice belongs at this composition
boundary, not in a host adapter, runner, helper, plan, or profile. Only
`publication: local` must be explicit; only the enclosing critical-review
post-review fix flow may request it; it is never inferred from host or model.

Local mode never weakens lint, the pushed-base requirement, contracts,
mechanical verification, supervision, verdicts, plan-order integration, or the
full-wave review. Both adapters complete all of that work and return the
resulting local feature-branch commit(s), task branch names, and state/verdict
evidence to their caller, but local mode performs no push. The wave still forks
from the current pushed PR head. Local mode is one publication transaction: if
approved fixes need dependent bases that cannot safely fit in that one
supervised wave, stop before publication rather than push around the gate.

- Claude-only wave: invoke `references/wave-runner.workflow.mjs` exactly as
  documented below.
- GPT-5.6-only wave: read and follow
  `references/codex-wave-protocol.md`; do not invoke Claude Workflow.
- Mixed or unknown-provider wave: stop before spawning and return the linter or
  identity error.

Every Codex spawn names model and reasoning_effort from the exact returned
action. Never write a fresh runner, hand-edit state, or replace a
missing model with a default or alias. The shared contract, verifier,
supervisor schema, escalation ladder, and result review remain single-sourced
in this skill; the adapter selects only the host invocation.

For a lint-clean, explicitly user-approved plan, the approved plan is authoritative for adapter execution.
The adapter uses its exact provider, model,
and effort fields without re-routing or rejecting them against seed-profile
recommendations; lint and the mixed/unknown-provider stop still apply.

### Claude-only wave — invoke the shipped runner

For a Claude-only wave, the ladder above is implemented once, in
`references/wave-runner.workflow.mjs`, and covered by the deterministic
simulator tier in `tests/`. Your job is to assemble its inputs, not to
re-implement its rules — every hand-written wave script is a fresh chance to
get "two strikes escalate" subtly wrong, and the one hand-written run on
record was rejected at launch four times before it worked.

Its `opts.model` accepts the documented Claude short names and the one pinned full ID
`claude-opus-4-8`; do not replace that identifier with an alias.

1. **Preflight the contracts at the base.** Before the first wave forks, run
   each distinct `must_run` command once against the recorded base — route
   it to a cheap agent per the Research Routing table, or run it yourself.
   Compare against the plan's recorded expectation for each command: green
   at base, or expected-red (the task itself creates what the command
   checks). An unexpected red is a contract defect to fix now, before any
   executor is spawned — transcript mining found ~13% of all supervisor
   verdicts were `satisfiable:false`, every one tracing to a contract
   already broken at base (fmt drift at BASE, a command targeting a
   nonexistent build target), each costing an executor attempt plus an
   Opus verdict. The same run warms the build caches every worktree in the
   wave will fork from cold.
2. Read `references/supervisor-prompt.md`. Workflow scripts cannot read files,
   so its full text travels inside `args.supervisorPromptText`.
3. Invoke the runner (`args` should be a real JSON object; the tool-call layer often delivers it
   as a JSON-encoded string, which the runner parses and validates — only
   unparseable or invalid input is rejected, by name):

```
Workflow({
  scriptPath: "<this skill's base directory>/references/wave-runner.workflow.mjs",
  args: {
    base: "<pushed fork-point sha>",          // see Wave Isolation above
    defaultBranch: "main",
    repoPath: "/abs/path/to/repo",
    supervisorPromptText: "<text of supervisor-prompt.md>",
    supervisor: { model: "opus", effort: "high" },
    verifier: { model: "sonnet", effort: "low" },   // optional; this is the default
    tasks: [{
      id: "auth-fix",
      description: "<the substantive ask>",
      context: "<files, lines, conventions>",
      contract: { files_allowed: [...], files_forbidden: [...],
                  must_run: [{ cmd: "...", evidence: "required" }],
                  forbidden_moves: [...], report_must_answer: [...] },
      executor: { model: "sonnet", effort: "medium" },
      ladder: ["opus"]      // rungs AFTER the first; omit for the routing default
    }]
  }
})
```

The runner assembles each executor's prompt from the task object — the six
mandatory blocks of the Task Prompt Template above, plus a workspace section
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
   - `contract-unsatisfiable` — run the amendment flow below (one amendment
     per task; removing or weakening a check goes to the user as a yes/no),
     then re-invoke with `resumeFromRunId`: the runner is deterministic, so
     every unchanged task replays from cache and only the amended one runs.
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

### When the contract is what is broken

Every other rung assumes the executor was at fault, because that is the only
hypothesis the ladder had. Verified on 2026-08-12: given a contract no compliant
change could satisfy, the ladder reworked, escalated to a stronger model, and
stopped — punishing an innocent executor three times and burning the heavy tier
to do it. All three supervisors said so unprompted, in `remarks`, which by design
change nothing.

So the verdict carries a fact, not a class: **`satisfiable`** — could any change
`files_allowed` permits have altered the outcome of the failing command? — with
the evidence for it. Deciding this is the supervisor's job; deciding what happens
next is not. A class would be another label to argue with; a fact the ladder
reads in code is not.

`ok:false` with `satisfiable:false` stops the wave for that task at once. Do not
rework, do not escalate: a second attempt reproduces the result exactly, and the
supervisors in that run said as much before it happened.

**Amending the contract is your job, not the user's.** You wrote it; you fix it.
Record the amendment in the wave plan with its reason — before and after — so the
change is on the record rather than in your head.

Two kinds of amendment, and the line between them is decidable by diffing the old
contract against the new:

- **Widening `files_allowed`, correcting a wrong path, fixing a broken command** —
  make the change and carry on. None of these can hide a defect: the check still
  runs and the work still has to pass it.
- **Removing or weakening a `must_run` entry, or a `forbidden_move` that produced
  a violation** — write the amendment, then ask the user one yes/no question
  naming exactly what stops being checked. This is the only edit that can make an
  inconvenient check disappear, and the agent that benefits from it is the one
  proposing it.

The user edits nothing. You detect, you draft, you apply. What goes to them is a
decision — whether they accept losing that check — not a file to open. Asking
someone to hand-edit a config is how a safeguard ends up switched off.

**An amendment exists only when the plan file is edited and the runner is
re-invoked with `resumeFromRunId` carrying the amended task.** A mid-wave
"I authorize X" in conversation reaches nobody: the runner rebuilds every
rework prompt from the task object it was given, so an amendment that never
re-enters the runner never reaches an executor. Measured 2026-08: a
verbally pre-authorized dependency never propagated; the rework executor
fell back to a worse design, which passed supervision and shipped, and the
regression was fixed by a later wave at full price.

One amendment per task. A second `satisfiable:false` on the same task goes to the
user whatever kind it is: each loosening looks reasonable alone, and the loop
that ends in a contract checking nothing is built out of reasonable steps.

### The blocking threshold sits above the suspicion threshold

Rework is triggered only by contract violations. Anything the supervisor merely
finds doubtful goes to `remarks` and reaches the user through the wave report.
**Blocking correct work is a worse failure than missing a nitpick** — a
supervisor that stops legitimate work does not just waste a wave, it
manufactures confidence in the waves it lets through.

### Cost, and when to skip the model

A supervisor invocation is an agent with tools — a diff, the commands, the
greps — so it is not one model request. The tiers also invert: a Haiku 4.5 task
is supervised by Opus 5 (see the supervisor table above), making the supervisor
the expensive half.

Run full agentic supervision for tasks whose contract has `must_run` commands or
`files_forbidden` entries that matter: migrations, shared helpers,
security-adjacent code. For a small mechanical task, check the predicates
(paths touched, commands run, evidence present) in plain script logic and
skip the supervisor model. Supervision that costs more than the work it guards
gets switched off, and then it guards nothing.

The shipped runner now performs the predicate half mechanically before
every judge call (see Mechanical verification above); what remains yours is
scoping each contract's gates to its files and choosing the judge's effort.

## Orchestrator Drift

Supervised waves guard the executors. This layer guards the orchestrator
session itself — the loop that reads verdicts, decides rungs, and reports back
to the user is not exempt from the same drift it polices in others.

It ships as a plugin hook on `Stop`, fires once per turn, and **advises — it
never blocks.** The advice arrives as `additionalContext`, and the orchestrator
is expected to act on it or say why not; nothing in the mechanism can halt the
turn or force a rework.

It needs the wave plan artifact to compare the orchestrator's actual behavior
against. With no plan file present, it stays silent — there is nothing to
check drift against, so it produces no advice rather than guessing at one.

Installing the plugin turns it on; removing the plugin turns it off. The user
edits no settings file to enable or disable it — the hook's presence is the
only switch.

### When the hook runs, and what it costs

The plan is a permanent artifact — it is the record of what each executor was
contracted to do, and the thing a supervisor compares against. So the plan is
never deleted to quiet the hook. Its lifecycle lives in a field instead:

```yaml
status: active   # active | done — only 'active' runs the hook
```

It watches **any** plan under `docs/superpowers/plans/`, not only a wave plan: an
orchestrator drifts from an implementation plan the same way — a task quietly
dropped, a step reported done that nothing ran.

Five gates decide whether the model is called at all, cheapest first: a nested
run of the hook inside its own `claude -p` call; a turn that our own advice
caused; **no plan says `status: active`**; no branch named by the plan still
the plan **declares** with a `branch:` key still exists; and a turn where the
orchestrator claimed nothing.

The branch gate reads declared branches only. Matching `wave/...` anywhere in the
text silenced any generalised plan that merely mentioned an old branch in prose —
a wave-specific gate left in the path of a trigger that is no longer
wave-specific.

Two of those come from running it rather than reading it. **The gate reads the
hook payload, never the transcript file** — the Stop hook fires before the
harness finishes writing the turn, measured at 67 seconds ahead in one live
session, so a file-based gate would silently never fire. The payload carries
`last_assistant_message` directly. And advice injected at Stop makes the model
continue, which fires Stop again: without the `stop_hook_active` gate one piece
of advice cost three deliveries and about a minute.

The status gate **fails closed**, and reads only the plan's header — it stops at
the first code fence and requires the key at column 0. Only an explicit
`status: active` runs the hook; a missing or unrecognised status keeps it off. A
page that documents the feature by showing the key inside a fenced yaml block
would otherwise switch the hook on: the activate-by-omission failure in a
different hat. Closing on `status: done`
instead would have reproduced the original defect for every plan whose author
never wrote a status — the file outlives the work and the hook fires forever. A
hook must not be able to switch itself on by omission.

Delivered advice is appended to `$TMPDIR/claude-drift-log/<session>.jsonl` with
the plan and what the orchestrator had just said. The hook never reads it back;
it exists so the question that matters about any advisory layer — does anyone
act on it — can be answered from evidence instead of impression.

The fourth gate is the one that matters for cost. Branches disappear when their
work is merged, so it reads the state of the work rather than anyone's
discipline: forget to flip `status` and the hook still goes quiet once the wave
lands. Forgetting degrades to silence instead of to a permanent per-turn tax.

The fifth gate is a keyword heuristic and is labelled as one in the script. It
filters cost, not correctness — a missed check in an advisory mechanism is a
missed suggestion. That trade would not be acceptable if the hook could block.

**The latency cannot be delegated away.** Setting `async: true` on the hook was
measured on 2026-08-11: the hook does not appear in the session log at all and
its `additionalContext` is never delivered. Advice and asynchrony are mutually
exclusive here, so the ~8s model call is paid inside the turn or not at all.
Gate it; do not shorten it — the cost *is* the model call, and cutting it short
only buys worse advice at the same price.

**The check does not repeat itself.** Each invocation is stateless, so during a
live wave it would hand the orchestrator the identical note on every
claim-shaped turn. A per-session memo holds a digest of the last advice actually
delivered and suppresses an exact repeat; different advice still gets through.
The prompt cannot enforce this — a stateless call has no way to know what it
said last time.

`plugins/orchestration/hooks/drift-check.test.sh` covers every gate offline via
`CLAUDE_DRIFT_CHECK_DRYRUN=1`, which prints the decision instead of calling the
model, and the post-call logic via `CLAUDE_DRIFT_CHECK_FAKE_ANSWER`, which
substitutes the reply. `LIVE=1` adds the real end-to-end path.

## Anti-Deception Rules

Each of these comes from a measured failure, not from general caution.

| Rule | Evidence |
|---|---|
| State the prohibitions to the executor loudly and explicitly | Explicit "don't work around — report" lowers fabrication: Fable 17.4% → 9.1% (pp. 161–163), Opus 4.8 9.4% → 2.8% (pp. 109–110) |
| Do NOT disclose the supervisor's specific checks to the executor | Grader awareness reaches 24–30% and changes behavior at the surface level (Fable pp. 171–181) |
| The supervisor is never the executor's own model | Opus 5's self-preference bias as a judge is unmeasured; Opus 4.8 (pp. 122–124) and Fable 5 (pp. 202–203) have measured zero; Fable 5.1 has a measured 0.1/10 (p. 124) |
| A claim without command output is a violation | Caveat laundering: "I verified this myself" while spot-checking only ancillary facts (pp. 37–39) |
| Attach verdicts; never paraphrase an executor report in their place | Opus 5 relays subagent claims unverified (p. 81) |
| Stopping early with open plan items is a violation | Fable stops on spurious token-budget concerns, 2.43M tokens unspent (pp. 170–171) |
| Claims of monitoring or watching get their own check | Dead watchers: recap lines said "monitoring" while nothing polled (pp. 33–35) |
| Never name the executor's model in the judge prompt | Fable 5.1 grades more leniently when told the author is Claude — 0.1/10, small but measured (p. 124) |

**Rules explicit, checks opaque.** The two halves come from opposite findings
and must not be collapsed. The contract is handed to the executor in full —
that is the explicit-prohibition half, and withholding it raises fabrication.
What is never disclosed is the supervisor's *method*: that a second model
re-runs the commands instead of reading the pasted output, that it compares the
two, that it diffs the tests against the recorded base SHA, that it greps for
the forbidden moves. An executor told the rules complies with the rules; an
executor told how compliance is measured optimizes for the measurement.

**Choosing the supervisor's model.** Never the executor's own. Prefer a judge
with measured zero self-preference — Opus 4.8 (pp. 122–124); `fable` (Fable 5.1)
carries a measured 0.1/10 lenience when told the author is Claude (p. 124);
the judge prompt never states the executor's model, inference remains possible
in an all-Claude pipeline, and the bound is the magnitude plus the contract's
mechanical half — so it judges Opus 5, and Opus 5 judges it. Opus 5 may execute under supervision but
does not supervise: the property that would justify it is unmeasured, and an
unmeasured property is not a permission.

## Result Review Checklist

An agent's self-report is not evidence (every executor has documented false
success claims and omissions about corners cut). In a supervised wave you review
the supervisor verdicts and remarks, not the executor reports — paraphrasing a
report where a verdict belongs is itself a failure, and the documented one:
Opus 5 relays subagent claims unverified (p. 81).

- [ ] Solves the stated task and matches the plan — by the diff, not the summary
- [ ] No unrequested changes (refactorings, files, abstractions)
- [ ] Consistent with the other agents' results (seams, duplicates, conflicts)
- [ ] Build/tests/linter — verified by running; "should work" doesn't count
- [ ] Documentation (README and the like) reflects the final state of the feature
- [ ] Every task carries a supervisor verdict; remarks are read and either acted on or dismissed on the record

## Common Mistakes

| Mistake | Consequence | Correct |
|---|---|---|
| Planning before loading your orchestrator profile | You inherit another model's effort advice and failure modes | Step 0 first, exactly one profile |
| Handing an executor "flesh out the spec yourself" | Silent unilateral assumptions | The orchestrator closes the decisions |
| Compensating an open-ended task with Sonnet xhigh | Plateau: money without quality | Switch the model or pin the task down |
| One agent per tiny file | Overhead eats the gain | Batch of edits for one agent |
| Trusting "tests pass" from the report | False claims are documented | Run them yourself |
| One long Sonnet session | 3× steps, early stops | Short waves with review in between |
| Returning "rework this" to an agent | Iterations without convergence | A concrete list: what and where |
| Numeric example in the spec computed in your head | The example contradicts the formula, the agent stalls | Compute with a tool or give only the formula |
| Not warning about parallel file changes | The agent treats the wave as an anomaly, wastes steps | List the files its neighbors modify |
| Documentation assigned to no one | README silently goes stale | An explicit docs task in the decomposition |
| Supervising with the executor's own model | A judge with unmeasured self-preference grants its own work a discount for free | Opus 4.8 or Fable 5.1, never the executor's model; never name the executor to the judge |
| Telling the executor how compliance is measured | Grader awareness turns compliance performative at the surface | Rules explicit, method undisclosed |
| Accepting a claim with no command output | The cheapest fabrication passes untouched | `evidence: required`, and compare it with your own re-run |
| Asking a supervisor to judge whether a mismatch was dishonest | It cannot know, and it reaches for the heaviest label — four fixes failed the same way | Record `pasteReproduced` as a fact; let repetition across attempts carry the consequence |
| Blocking on suspicion rather than on a contract violation | Correct work is stopped and the wave gains false confidence | Doubts go to `remarks`; only violations block |
| Recording an unpushed local `HEAD` as the wave base | Worktrees fork from `origin/<default-branch>`, so every branch shows your local-only files as deletions and every executor gets a phantom `files` violation | Push the base commit, or record `origin/<default-branch>`; verify with `git merge-base` after the first commit |
| Amending a contract in conversation only | The rework prompt is rebuilt from the old task object; the amendment reaches nobody | Edit the plan, re-invoke with `resumeFromRunId` |
| A full-repo gate in a per-task contract | Wall-clock multiplied by the task count; stall watchdogs kill the wait | Scope `must_run` to the task's module; the full gate runs once per wave at merge |

## References

- `references/orchestrator-fable-5-1.md`,
  `references/orchestrator-fable-5.md`, `references/orchestrator-opus-5.md`,
  `references/orchestrator-opus-4-8.md` — the orchestrator profiles. Load exactly
  one, per Step 0.
- `references/model-dossiers.md` — dossiers on all five models with numbers and
  page references to the system cards: benchmarks, documented failure modes,
  effort curves, multi-agent harness data, orchestration takeaways. Load it for
  contested routing calls or to justify a choice.
