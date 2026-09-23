# agent-skills

A dual Claude Code and Codex plugin marketplace (`temmax`) with two
plugins covering the full development pipeline: plan → supervised execution →
review. Model-specific guidance is scoped to cited first-party Anthropic and
OpenAI sources; shared safety rules stay provider-neutral. Load-bearing logic
ships as tested code, not prose — a Claude wave runner, a Codex state/verifier
helper, a plan linter, and the offline release suite (see `tests/README.md`).

- **`orchestration`** — the full pipeline: `ship` conducts planning
  (`super-plan`) and execution (`multi-model`) into a reviewed PR. The
  orchestrator model researches, plans into contract-carrying waves, and
  launches executor subagents through the selected host adapter. Claude and
  exact GPT-5.6 and GPT-6 Astra profiles plus a conservative generic fallback guide routing;
  each executor is isolated in its own worktree and judged against its contract
  by a different model.
- **`code-review`** — critical, evidence-based review of uncommitted changes or
  a GitHub PR, performed by the session's own model.

Each skill works on **whatever model the session runs on**: it reads its own
model identity and loads the matching profile from `references/`. There is no
`-opus` variant to pick between any more.

| Plugin | Skill | What it does |
|---|---|---|
| `orchestration` | `super-plan` | Wave-native planning: research to decomposition depth, one batched round of user questions, tasks carrying machine-checkable contracts grouped into waves by file-independence, validated by the shipped `plan-lint.mjs` before the plan gate. Planning discipline adapted from Jesse Vincent's superpowers (MIT, attribution shipped). |
| `orchestration` | `ship` | The pipeline conductor: one command from request to reviewed PR — super-plan → supervised waves on a feature branch → critical-review of the PR and its threads. Adds no machinery of its own: one up-front gate, fixes routed by behavior change, and the merge always stays with the user. |
| `orchestration` | `multi-model` | Model routing, effort selection, task-prompt template, review checklist, and supervised waves executed by the shipped `wave-runner.workflow.mjs` — isolated executors judged against a machine-checkable contract by a different model, with the escalation ladder as tested code — plus an orchestrator-drift advisory hook that watches the orchestrator session itself. |
| `code-review` | `critical-review` | Scope detection, PR description+threads protocol, tiered findings table (Blocker → Nit), and a post-review fix phase that answers and resolves the PR threads its findings came from. |

## How the model routing works

Claude Code states the session model in the system prompt ("You are powered by
the model named X. The exact model ID is Y"). Step 0 of each skill maps that ID
to exactly one profile file and forbids reading the others:

| Model ID | orchestration profile | code-review profile |
|---|---|---|
| `claude-opus-5-5` (any context suffix) | `references/orchestrator-opus-5-5.md` | `references/reviewer-opus-5-5.md` |
| `claude-fable-5-1` | `references/orchestrator-fable-5-1.md` | `references/reviewer-fable-5-1.md` |
| `claude-fable-5` | `references/orchestrator-fable-5.md` | `references/reviewer-fable-5.md` |
| `claude-opus-5` (any context suffix) | `references/orchestrator-opus-5.md` | `references/reviewer-opus-5.md` |
| `claude-opus-4-8` (any context suffix, e.g. `[1m]`) | `references/orchestrator-opus-4-8.md` | `references/reviewer-opus-4-8.md` |
| anything else | none — model-agnostic rules only, and the skill says so | same |

Opus 5.5 (`claude-opus-5-5`) is the **default heavy executor, verifier, and
open-research route**: an upgrade to Opus 5 on every evaluation in its summary
table at a lower list price ($4 / $20 per million input/output tokens vs Opus
5's $5 / $25), and it matches Fable 5.1 as the most injection-robust route
through tool results (IPI 0.1% at k=1). Untrusted text must still be handed to
it by path, not pasted: compliance with instructions planted in pasted text
rises from 2.1% at default effort to 7.4% at max. Grounded in the Claude Opus
5.5 system card (230 pp., September 2026).

Opus 5 (`claude-opus-5`) is the **previous default heavy executor and
verifier**, retained as the supervisor fallback; Opus 4.8 is retained only for
compiled-binary reverse-engineering (Opus 5's Fable-class cyber classifier
blocks it) and as the cyber-refusal fallback. Opus 5's effort rule **inverts**
Opus 4.8's — higher effort makes it *worse* on long-horizon work (documented
overthinking / self-verification loops), so its profile runs at `high`, not
`xhigh`, and its effort self-check flags too-*high*, not too-low. Its card also
names an unverified-subagent-relay failure mode, so the Opus 5 orchestrator
profile doubles down on verifying subagent claims. Grounded in the Claude Opus 5
system card (193 pp., July 2026).

Fable 5.1 (`claude-fable-5-1`) has its own profiles, grounded in the Claude
Fable 5.1 & Mythos 5.1 system card (212 pp., September 2026). It is the
strongest long-horizon coder in the lineup (FrontierSWE v2 0.57 vs Opus 5's
0.52, pp. 170–171) at roughly half Fable 5's cost per task (p. 5), and three
of its measurements change the rules: as a judge it is the first model since
Opus 4.7 with a measured self-recognition bias (0.1 points out of 10, lenient
when told the author is Claude, p. 124) — the runner's judge prompt never
names the executor and the bias is bounded by the contract's mechanical
half, so Fable 5.1 (`claude-fable-5-1`) still judges Opus 5, and the prompt rule is now a contract
test; on scoped coding its score peaks at `medium` because higher
effort adds unrequested out-of-scope edits (p. 169), so every Fable 5.1
executor prompt carries a scope line; and it is the most injection-robust
model to date (IPI 0.1% at k=1, p. 83), the executor for untrusted content
whose compromise would reach secrets or actions. Its card also documents an
orchestrator failure the profile guards against: distorting user intent to
subagents, including a fabricated user authorization and a
`bypassPermissions` launch (pp. 95–96). Plans address it as `claude-fable-5-1`
(`fable` is only its Agent-tool alias); Fable 5's profiles and dossier sections
stay for history.

The profile carries everything that is genuinely model-specific: the session's
reasoning-effort guidance, amendments to the numbered process steps, and the
model's own documented failure modes. The shared body carries everything else.

**Why the split matters.** Merging the variants naively — leaving an
unconditional "run this session at xhigh reasoning effort" in the shared
overview — made a Fable 5 orchestrator adopt Opus 4.8's effort directive in 3 of
3 test runs, reasoning that "the imperative is phrased generically", and import
Opus-specific process amendments along with it. A model with no profile at all
hedged instead of falling back cleanly. With the effort directive scoped inside
the profile, a model-ID gate on each profile, and an explicit fallback row, 14
of 14 runs across Fable 5, Opus 4.8 and Sonnet 5 loaded the right profile,
refused the wrong one, and applied the right effort. Repeated for Fable 5.1 on
2026-09-01 with headless `claude -p --plugin-dir` runs: 6 of 6 on
`claude-fable-5-1` (four multi-model, two critical-review) loaded exactly
`orchestrator-fable-5-1.md` / `reviewer-fable-5-1.md` — one run captured with
`--output-format stream-json` shows a single profile read and nothing else —
and a Sonnet 5 control reported no matching profile.

The Opus profile also **self-checks the session effort**: Step 0 surfaces the
live value via the `${CLAUDE_EFFORT}` substitution, and the profile halts an
orchestration started at `medium` or below with a request to restart higher
(review notes the shortfall rather than halting). If the substitution ever fails
to expand, the skill treats effort as unknown and proceeds — verified across 10
runs (medium halts, high notes the floor, xhigh proceeds silently, an unexpanded
placeholder degrades gracefully, Fable never false-warns).

**Recommendation for Opus 4.8 sessions:** run the orchestrator at `xhigh`
reasoning effort; `high` is the floor when latency-bound. Grounding from the
Opus 4.8 system card: SWE-bench Pro peaks at xhigh (69.8, p. 196), deep-research
agentic scores rise monotonically through max (DRACO 80.4, p. 208), Anthropic's
own multi-agent harnesses ran the orchestrator at max effort (p. 214), and
higher effort roughly halves prompt-injection susceptibility (p. 80). Low/medium
effort on Opus 4.8 is executor territory (its minimum effort already matches
Opus 4.7's maximum). No equivalent level is pinned for Fable 5 — that
measurement does not exist for it, and the Fable profile says so explicitly.
The same holds for Fable 5.1, whose profile names xhigh as the documented
long-horizon sweet spot (xhigh matches max at 19–25% fewer tokens,
pp. 193–194) without pinning it.

Both skills also ship a dossier (`references/model-dossiers.md`,
`references/reviewer-dossier.md`) with benchmark numbers, documented failure
modes, and page references to the system cards — loaded on demand for contested
calls.

**Full model IDs.** Plans and runner args name full Claude IDs, never
aliases: `claude-haiku-4-5-20251001`, `claude-sonnet-5`, `claude-opus-5-5`,
`claude-opus-5`, `claude-opus-4-8`, `claude-fable-5-1`. Aliases are rejected
by name because they re-point silently — on 2026-09-22 `opus` moved from
Opus 5 to Opus 5.5, so every route still written as `opus` would have changed
model without an edit. The one alias-only surface is the Claude Code Agent
tool, whose schema accepts only aliases; that exception is covered by the
probe-dated alias mapping in `multi-model`'s Model identifiers table, which is
re-verified whenever a new Claude model ships.

All skills always reply to the user in the language the user writes in.

## Hosts, models, and lifecycle limits

Both marketplaces expose the same plugin folders and `./skills/` paths. Claude
Code and Codex discover the three orchestration skills (`super-plan`, `ship`,
and `multi-model`) plus the `critical-review` skill. The exact-profile roster
is deliberately narrower than a claim that every profile is a production route:

| Host | Exact model IDs with a profile | Role / effort conclusion |
|---|---|---|
| Claude Code | `claude-opus-5-5`, `claude-fable-5-1`, `claude-fable-5`, `claude-opus-5`, `claude-opus-4-8` | Existing Claude routes retain each profile's documented role and effort guidance. |
| Codex | `gpt-5.6-sol` | Exact profile exists; no executor, orchestrator, reviewer, or supervisor role/effort is production-supported by the 2026-09-04–05 UTC calibration. |
| Codex | `gpt-5.6-terra` | Exact profile exists; no executor, orchestrator, reviewer, or supervisor role/effort is production-supported by the 2026-09-04–05 UTC calibration. |
| Codex | `gpt-5.6-luna` | Exact profile exists; no executor, orchestrator, reviewer, or supervisor role/effort is production-supported by the 2026-09-04–05 UTC calibration. |
| Codex | `gpt-6-astra` | Active-session orchestration and review profiles; GPT-5.6 executors with a separate Astra supervisor are calibration candidates, not production-qualified routes. A separately approved Astra initial executor or final rung is uncalibrated and requires a fresh Astra supervisor. |
| Codex | `gpt-6-sol` | Exact profiles and dossiers; default Codex executors per shared routing; 2026-09-23 calibration ([`tests/eval/gpt-6-results-2026-09-23.md`](tests/eval/gpt-6-results-2026-09-23.md)) — review and supervisor routes unsupported. |
| Codex | `gpt-6-luna` | Exact profiles and dossiers; default Codex executors per shared routing; 2026-09-23 calibration ([`tests/eval/gpt-6-results-2026-09-23.md`](tests/eval/gpt-6-results-2026-09-23.md)) — review and supervisor routes unsupported. |
| Either | any other model ID | The generic profile applies; missing identity/effort stay unknown, and no model-specific reliability claim follows. |

A bare family label such as **GPT-6** does not select any exact profile by
itself: Codex CLI 0.155.1 gives Astra, Sol, and Luna the identical host
instruction "You are Codex, an agent based on GPT-6" (verified 2026-09-23), so
that phrase cannot distinguish between them and the skills load the generic
profile instead. An exact ID takes priority; unsupported IDs or unresolved
conflicts select generic. Quotes and available child-model lists are not
session identity.

The `gpt-5.6` alias normalizes only to `gpt-5.6-sol`; it is not a plan model
ID. The dated record is
[`tests/eval/gpt-5-6-results-2026-09-04.md`](tests/eval/gpt-5-6-results-2026-09-04.md):
the final post-fix regression recorded 87 default rows (63 pass, 24 fail) with
3/24 required skill cells passing; its critical run recorded 204 rows
(162 pass, 42 fail).
Therefore every GPT-5.6 seed route is **unsupported** and must delegate the
routing decision upward to a separately supported provider route or an
authorized calibration. The result does not turn invalid or failed cells into
support.

When a skill starts on **Astra**, Astra remains in the active seat: it plans,
coordinates, and reviews. A supervised implementation wave ordinarily uses only
Luna, Terra, or Sol, with a separate Astra supervisor. A separately approved
Astra initial executor or final rung requires `astra_executor_reason` and a
fresh Astra supervisor; Sol exhaustion never promotes, resets, or raises effort
automatically. A fresh Astra reviewer provides context separation, not a
different-model check. The drift hook judges every GPT-6 orchestrator with
`gpt-5.6-sol` at `high`, chosen by the 2026-09-23 calibration. Other profiles retain their
existing rules. See [the role decision](docs/decisions/005-astra-active-seat.md)
and the [Astra dossier](plugins/orchestration/skills/multi-model/references/gpt-6-astra-dossier.md).
The [bounded Astra pilot](tests/eval/gpt-6-astra-pilot-2026-09-07.md) records
offline checks, bounded live cases, preserved failures and scorer disagreement,
and the remaining end-to-end calibration gaps. Per
[decision 006](docs/decisions/006-gpt-6-family.md), Codex routing for new
plans moves to `gpt-6-sol`/`gpt-6-luna` executors with the fixed
`gpt-6-astra`/`high` supervisor: GPT-5.6 IDs are no longer chosen for new
plans, but an already-approved plan carrying GPT-5.6 fields still runs to
completion.

Both Codex manifests intentionally retain their `hooks` fields, including the
orchestration advisory drift hook. Lifecycle behavior is host-dependent;
**ChatGPT surfaces do not run Codex lifecycle hooks**. Treat hooks as advisory
where supported, never as a substitute for the plan, worktree, contract, and
independent-supervisor safety model. The generic plugin validator bundled with
some tooling is not authoritative for these manifests because it rejects the
approved `hooks` field when PyYAML is unavailable; repository contracts and a
real disposable Codex install rehearsal are the release checks.

Codex waves default to `codex-wave-runner.mjs`, a deterministic, model-free
driver that runs the native protocol's own state machine
(`codex-wave-state.mjs`) one task per worktree under a shared `--jobs` limit,
so an orchestrator model no longer spends its wall time on the protocol's
tool-call round trips. It shells out to `codex exec` with network access so
executors can sign commits, and never bypasses the state machine it drives.
The native `codex-wave-protocol.md` action loop — the orchestrator model
driving `codex-wave-state.mjs` directly, one tool call at a time — remains the
fallback for a host or session that cannot run the runner script.

## Installation

### Claude Code installation

```
/plugin marketplace add TemMax/agent-skills
/plugin install orchestration@temmax
/plugin install code-review@temmax
```

### Codex installation

Clone this repository, then register that checkout as the repository/team
marketplace (replace the path, but keep the selector name):

```bash
codex plugin marketplace add /absolute/path/to/agent-skills
codex plugin list --marketplace temmax --available --json
codex plugin add orchestration@temmax --json
codex plugin add code-review@temmax --json
codex plugin list --marketplace temmax --json
```

Do not use a personal marketplace for this repository.

### Migrating from the old names

The repository was `TemMax/claude-skills` and the marketplace `temmax-skills`.
GitHub redirects the old repository URL, but the marketplace rename is not
redirected: `...@temmax-skills` selectors stop resolving, so re-register once.

Claude Code:

```
/plugin marketplace remove temmax-skills
/plugin marketplace add TemMax/agent-skills
/plugin install orchestration@temmax
/plugin install code-review@temmax
```

Codex (after `git pull` in your checkout, or a fresh clone):

```bash
codex plugin remove orchestration@temmax-skills --json
codex plugin remove code-review@temmax-skills --json
codex plugin marketplace remove temmax-skills --json
codex plugin marketplace add /absolute/path/to/agent-skills
codex plugin add orchestration@temmax --json
codex plugin add code-review@temmax --json
```

## Usage

There are two ways to invoke the skills.

**Automatic (primary).** The skills trigger on their own: each skill's
description is always in Claude's context, and a matching request loads the
skill automatically — just ask in plain text:

```
Decompose this into agents and run in parallel: <task>
Orchestrate this task across subagents: <task>
Разбей на агентов и запусти параллельно: <задача>
Review my uncommitted changes critically
Сделай критическое ревью ПР #42
```

**Explicit slash command.** Guarantees the skill loads. Everything after the
skill name is passed as the task description:

```
/orchestration:ship Add multi-currency support to the pricing module
/orchestration:super-plan Plan multi-currency support for the pricing module
/orchestration:multi-model Add multi-currency support to the pricing module
/code-review:critical-review <PR number optional>
```

`ship` runs the whole chain as one command: `super-plan` produces the plan
file whose machine half feeds the wave-runner directly (each task: json entry
+ its prose section as the description), `multi-model` executes it in
supervised waves on a pushed feature branch, `critical-review` closes the
loop on the PR — and the merge stays with the user. Each link also runs
standalone.

Type `/orch` or `/code` and let autocomplete fill in the namespaced name.

**What to expect from planning.** `super-plan` researches the codebase, asks
you ONE batched round of questions for what code cannot answer, and gates
twice: once on the design summary, once on the finished plan — which must pass
the shipped linter (same-wave file overlap, contract completeness) before you
ever see it.

**What to expect from orchestration.** The orchestrator loads its profile,
shows you a table (task | model | effort | rationale), then launches the waves
through the shipped runner: every executor works in its own worktree, and an
independent judge model checks out the branch, re-runs the contract's commands
itself and issues a verdict — executor self-reports are never trusted. Rework,
model escalation and the unsatisfiable-contract stop are code, not judgment
calls.

**What to expect from ship.** One confirmation up front — the feature branch
will be pushed and a PR opened — then only the link skills' own gates stop the
flow. ship ends at a reviewed PR with its threads answered; the merge always
stays with you.

**What to expect from review.** The reviewer loads its profile, detects the
scope (a named PR, a PR opened this session, uncommitted changes, or the
session's own commits), reads the PR description and every comment thread first
when reviewing a PR, verifies findings by running what is cheap, and delivers a
short summary plus one findings table tiered Blocker / Important / Medium / Low
/ Nit. The review is read-only — fixes happen only when you ask afterwards.

To verify the plugins are installed, run `/plugin` and look for
`orchestration` and `code-review` with their skills listed.

## 3.1.0

Non-breaking. `codex-wave-runner.mjs` is now the default Codex wave adapter
(the native `codex-wave-protocol.md` action loop is the fallback — see Hosts,
models, and lifecycle limits above). `codex-wave-state.mjs` only treats a
missing pasted must_run paste as a violation when that final verifier attempt
was red — a green reproduction needs no rework — and caps the VERIFIER FACTS
JSON handed to the supervisor prompt at 60,000 characters, omitting the diff
(with a `git diff` pointer to read it directly) rather than blowing up the
supervisor's context window. `tests/eval/telemetry/telemetry.mjs` is a new
offline analyzer that reads a Codex or Claude wave run's logs and reports
wall-clock time by model / tool / waiting and per-child tokens and cost;
it calls no model itself. `tests/eval/ship-smoke.sh` is a new benchmark that
runs one small Codex wave both natively and through the runner and compares
wall time, orchestrator cost, and correctness using that telemetry analyzer.

## Breaking in 3.0.0

Claude aliases (`opus`, `sonnet`, `fable`, `haiku`) are no longer accepted in
plans or runner args — name the full Claude ID instead (see Full model IDs
above). The linter and the runner reject an alias by name rather than
resolving it, because an alias can re-point to a different model silently.

## Migration from 1.x

The orchestration 1.4.0 / code-review 1.1.0 releases collapsed the per-model
skill variants and dropped the sonnet-only experiment (current versions:
orchestration 2.7.1, code-review 1.6.1):

| Before | After |
|---|---|
| `multi-model`, `multi-model-opus` | `multi-model` (loads its own profile) |
| `critical-review`, `critical-review-opus` | `critical-review` (loads its own profile) |
| `sonnet-only`, `sonnet-only-opus` | removed |

The `-opus` slash commands no longer exist. Use the base name on any model.

## Local development

```bash
claude --plugin-dir /path/to/agent-skills/plugins/orchestration
claude --plugin-dir /path/to/agent-skills/plugins/code-review
```

Run the offline release suite before changing a plugin:

```bash
./tests/run.sh
bash tests/eval/gpt-5-6-matrix.sh --self-test
```

The semantic matrix requires a fresh caller-owned result directory and calls
the provider it configures; for example,
`bash tests/eval/gpt-5-6-matrix.sh --critical --results /absolute/path/to/new-critical-run`.
The bare `--critical` command intentionally exits before calls when no results
directory is supplied. Do not supply a results directory, live flags, or
provider credentials for routine release checks. Model calls, when expressly
authorized for a fresh calibration, can be expensive: inspect the dated
results' measured usage and cost caveats first.
The final merge and any real PR/push remain user-authorized boundaries.

## Repository layout

```
.claude-plugin/
  marketplace.json     # lets this repo act as its own marketplace
.agents/plugins/
  marketplace.json     # repository/team Codex marketplace
plugins/
  orchestration/
    .claude-plugin/plugin.json
    .codex-plugin/plugin.json
    hooks/                       # orchestration lifecycle context and Stop gate
      hooks.json                 # runtime identity plus orchestrator-drift Stop registration
      runtime-context            # plugin-scoped Claude/Codex model context
      drift-check                # provider-aware advisory Stop judge adapter
      drift-check.test.sh        # offline drift behavior contract
    skills/
      ship/
        SKILL.md               # the pipeline conductor (no references of its own)
      super-plan/
        SKILL.md
        references/
          plan-lint.mjs          # the plan rules as code
          LICENSE-superpowers    # MIT attribution (Jesse Vincent)
      multi-model/
        SKILL.md
        references/
          wave-runner.workflow.mjs   # the escalation ladder as code
          wave-launch.mjs            # generates the Claude wave launch script
          claude-wave-adapter.md     # Claude host adapter: invoke the shipped runner
          contract-amendment.md      # the contract amendment flow
          verdicts.md                # verifier facts and supervisor verdicts
          orchestrator-drift-hook.md # how the drift hook works and what it costs
          codex-wave-protocol.md     # native Codex action loop
          codex-wave-state.mjs       # deterministic Codex state and verifier
          codex-wave-runner.mjs      # default Codex wave adapter: drives codex-wave-state.mjs per task
          supervisor-prompt.md
          orchestrator-{fable-5-1,fable-5,opus-5,opus-4-8}.md
          orchestrator-gpt-5-6-{sol,terra,luna}.md
          orchestrator-gpt-6-astra.md
          orchestrator-gpt-6-sol.md
          orchestrator-gpt-6-luna.md
          orchestrator-generic.md
          model-dossiers.md
          gpt-5-6-dossier.md
          gpt-6-astra-dossier.md
          gpt-6-sol-dossier.md
          gpt-6-luna-dossier.md
  code-review/
    .claude-plugin/plugin.json
    .codex-plugin/plugin.json
    hooks/                       # code-review/hooks/ lifecycle context
      hooks.json                 # independently installable runtime-context registration
      runtime-context            # plugin-scoped Claude/Codex model context
    skills/
      critical-review/
        SKILL.md
        references/
          reviewer-{fable-5-1,fable-5,opus-5,opus-4-8}.md
          reviewer-gpt-5-6-{sol,terra,luna}.md
          reviewer-gpt-6-astra.md
          reviewer-gpt-6-sol.md
          reviewer-gpt-6-luna.md
          reviewer-generic.md
          reviewer-dossier.md
          gpt-5-6-reviewer-dossier.md
          gpt-6-astra-reviewer-dossier.md
          gpt-6-sol-reviewer-dossier.md
          gpt-6-luna-reviewer-dossier.md
tests/                           # structure / contracts / behaviour / live eval
  run.sh                         # ./tests/run.sh [--live]
```
