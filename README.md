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
  exact GPT-5.6 and GPT-6 Astra/Sol/Luna profiles plus a conservative generic fallback guide routing;
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
Fable 5.1 & Mythos 5.1 system card (212 pp., September 2026). It beat Opus 5
on long-horizon coding (FrontierSWE v2 0.57 vs Opus 5's 0.52, pp. 170–171) at
roughly half Fable 5's cost per task (p. 5), but Opus 5.5 now leads the
lineup on that same metric (FrontierSWE v2 62.3 vs Fable 5.1's 56.3, p. 179),
so Fable 5.1 is no longer the strongest long-horizon coder overall — it is a
premium route, used only with the user's Gate 1 approval recorded in
`approvals.premium`. Three of its measurements still change the rules: as a
judge it is the first model since Opus 4.7 with a measured self-recognition
bias (0.1 points out of 10, lenient when told the author is Claude, p. 124) —
the runner's judge prompt never names the executor and the bias is bounded by
the contract's mechanical half, so Fable 5.1 (`claude-fable-5-1`) still
judges Opus 5, and the prompt rule is now a contract test; on scoped coding
its score peaks at `medium` because higher effort adds unrequested
out-of-scope edits (p. 169), so every Fable 5.1 executor prompt carries a
scope line; and it is the most injection-robust model to date (IPI 0.1% at
k=1, p. 83), the executor for untrusted content whose compromise would reach
secrets or actions — and, like every Fable 5.1 executor route, only used
with `approvals.premium` recorded at Gate 1. Its card also documents an
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
| Codex | `gpt-6-sol` | Exact profiles and dossiers; default Codex executors per shared routing; 2026-09-23 calibration ([`tests/eval/gpt-6-results-2026-09-23.md`](tests/eval/gpt-6-results-2026-09-23.md)) — review unsupported; supervisor only as the standard all-Luna supervisor (policy, uncalibrated). |
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
tool-call round trips. It shells out to `codex exec`, which needs the repository's `.git` writable
and network access to reach the model API — in a sandboxed Codex session,
grant `.git` as a writable root (`--add-dir <repo>/.git`) and network access,
or use full access — and never bypasses the state machine it drives.
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
twice: Gate 1 on the design summary — which names the supervisor choice,
premium or standard — and Gate 2 on the finished plan, shown with its shape
(the waves, the tasks that run in parallel in each, the critical path in
waves), which must pass the shipped linter (same-wave file overlap, contract
completeness) before you ever see it. Neither gate — nor any table or report —
carries a time or cost estimate.

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

## 4.2.0

Non-breaking. A read-through of four 2026-09-24/25 session transcripts
(Android/KMP, a four-repository Go/Rust/Python feature, docs + Android
attachments) found the failures were mostly environmental: waves could not
build in the environment they were given, and the skills blamed the
contract or the executor for it, while plan-lint's own limits stayed silent
and produced false-positive and warning noise instead.

**Worktree environment.** A new shared module,
`worktree-env.mjs`, gives the runners and the linter one definition of a
fresh worktree's environment: the plan's optional `worktree` key —
`{"links": [...], "writable": [...], "auto": true}` — lists repository-relative
untracked files (for example `local.properties`) every fresh worktree and
checkout gets as a symlink to the real path, and cache directories (for
example `~/.gradle`, `~/.android`, `~/.cargo`) a sandboxed Codex child may
write; `auto` (default `true`) adds `gradlew` → Gradle/Android caches and an
untracked `local.properties` link, and `Cargo.toml` → the Cargo cache,
automatically. Linked files are symlinked, never opened, printed or copied.
Measured: fresh worktrees and checkouts lacked the gitignored
`local.properties` and an empty `ANDROID_HOME`; agents improvised the same
`ln -s` symlink 93 times across one session, and at least 4 agents ran `cat
local.properties`, printing a GitHub token twice even after the orchestrator
warned. The existing secrets prohibitions across the prompt and skills gain
one appended sentence: that includes untracked build configuration a
worktree links — `local.properties`, `.env`, `*.keystore`, `gradle.properties`
under `~/.gradle` — which may hold a key or token: link or reference such
files by path; never `cat`, `head`, `grep` or otherwise print them.

**Codex sandbox parity.** Codex children ran `codex exec --sandbox
workspace-write -C <worktree>` with no `--add-dir` and no network flag for
the supervisor. The runner now adds `--add-dir` for the repository's git
common dir (`git rev-parse --git-common-dir`, so a linked worktree can
commit) plus every `worktree.writable` cache directory, and gives the
supervisor the same network parity as the executor. Reproduced without a
model on 2026-09-25 (codex-cli 0.155.1): `codex sandbox -c
'sandbox_mode="workspace-write"' -- touch ~/.gradle/x` fails with `Operation
not permitted` and passes once `writable_roots=["<home>/.gradle"]` is set;
`git add`/`commit` from a linked worktree outside `$TMPDIR` fails with
`Unable to create '<repo>/.git/worktrees/w/index.lock': Operation not
permitted` and passes once `writable_roots=["<repo>/.git"]` is set. Disabling
child MCP servers stays out of scope: `-c
mcp_servers.<name>.enabled=false` made `codex mcp list` fail with `Error:
bootstrap`. Branch names stay `wave/<id>` and task worktrees stay under
`--repo` (`.worktrees/` goes into `info/exclude` automatically) — a
namespace or location change would break the plan format.

**Model-free `--preflight`.** The Codex runner's `--preflight` probes every
distinct `must_run` command in a wave's tasks under the same sandboxed
`codex sandbox` seatbelt used for execution, in a throwaway worktree at the
wave's base, without spawning any model child. A red command the plan does
not expect is fixed in the plan; a blocked command is fixed on the machine.

**`environment-blocked`.** A new terminal stop status, distinct from
`contract-unsatisfiable` and `failed`: a command could not start or run
because of the machine, not the work — permission denied on a cache
directory or `.git` (`Operation not permitted`), `SDK location not found`, a
lock file that cannot be created, or commit signing that needs a prompt. It
ends the task; no retry, escalation or amendment follows (only the typed
child-error path — a spawned agent or tool call that itself failed, with
no report or verdict to charge an attempt against — is never charged as an
attempt at all); an executor that
hits one stops and makes the *first line* of its report
`environment-blocked: <verbatim error line>` — the marker counts only when
it opens the report, so a quoted or mid-report mention of the same text
never trips it. Measured: two 2026-09-25 Codex waves stopped as
`contract-unsatisfiable` over a Gradle lock denied in `~/.gradle` and a
missing Android SDK, and the user approved bypassing supervised execution
both times, even though the contract preflight had run clean in the main
checkout ("13 commands green") two minutes earlier — a main-checkout
preflight cannot see a fresh sandboxed worktree's Gradle lock or missing
SDK.

**`wave-launch` refusals.** The launcher now refuses to start a wave against
a base that is not an ancestor of `origin/<default>` (`git merge-base
--is-ancestor <base> origin/<default>`) — a wave base nobody else can see
yet. It also honors the plan's optional `depends_on` key —
`[{"wave": <n>, "repo": "<path or \".\">", "ref": "<git ref>", "path":
"<repo-relative path>"}]` — refusing to start wave `<n>` until `git -C
<repo> cat-file -e <ref>:<path>` succeeds (`"."` means the plan's own
repository). Measured: an eval wave in a four-repository plan launched
before the other repository's artifact existed. A new `inherits` plan key
(a repository-relative path to a parent plan) lets a child plan omit `ci`,
`e2e`, `worktree`, `approvals` or `review` and take them from the parent,
one level only — for recovery and amendment plans.

**Plan-lint fixes.** `## Task <id>` prose headings are now matched by
`/^## Task ([a-z0-9-]+)[ \t]*\r?$/gm`, with an error for any `## Task` line
that doesn't match exactly — the title goes on the next line. Measured: a
`## Task rename-web — Title` heading passed the old lint and then crashed
the runner's init. `ci.commands` matching now tolerates a workflow line's
trailing `$VAR`/`${VAR}` arguments (`./gradlew spotlessCheck` now matches
`run: ./gradlew spotlessCheck $GRADLE_FLAGS`) and a step's
`working-directory:` (`cd gateway && go test ./...` now matches a step with
`working-directory: gateway` and `run: go test ./...`); both previously
gave "does not appear in any listed ci.workflows file". Legal carve-outs —
`files_allowed ["app/AGENTS.md"]` with `files_forbidden
["app/**/src/**"]`, and `files_allowed ["app/feed/impl/**"]` with
`files_forbidden ["app/feed/impl/src/Dock.kt"]` — no longer trip the
self-overlap check, while `src/**` with `src/**` still does. Missing
`files_allowed` prefixes that a task itself will create are folded into one
warning instead of one line each (a session had printed 33); a prefix whose
top-level directory doesn't exist anywhere in the repo still gets its own
warning. The linter also gained a `--base <sha>` flag reading
`.github/workflows` and file existence from that commit instead of the
working tree, for checking a plan against its pushed base.

**Prompt and skill rules.** super-plan now requires a scoped `must_run` gate
for every `ci.commands` entry that touches a task's files (formatter,
linter/static analysis, tests — every target's test sources for a
multiplatform module), not just the offline suite; a missing CI gate had let
a wave merge green while the repository's own CI failed. Its seam audit now
lists, for every task, the implementers and fakes of any changed public
interface or signature, and any prose instruction that contradicts
`forbidden_moves` — measured: a changed `AppRouter` interface broke fakes in
9 modules for 2 fix waves, and a prose instruction to rewrite an existing
test contradicted a `forbidden_moves` ban on weakening one, costing a
recovery plan. For a UI or dependency-injection feature, `e2e:
"not-applicable: <reason>"` must now name how production wiring is proven —
an integration task, or a `must_run` grep or test proving the DI binding and
the call site on the real screen or client; measured: an attachments feature
passed every contract and was never wired into the production client or
screen. multi-model states plainly that **the coordinator never authors
code**, however small the defect its own review or a final review finds —
it goes to a one-task supervised wave instead, never a coordinator edit;
measured: orchestrators wrote wiring and review fixes themselves and pushed
them unreviewed. An "implement directly" bypass approval is now scoped and
recorded in the plan (which waves) and the PR body; it never extends to
review fixes, and critical-review's findings gate still applies regardless.
Every stop across ship and multi-model — including `environment-blocked` —
now ends with one recommended next action, phrased as a yes/no question,
instead of a bare list of options. ship's Stage 0 gate can also grant a
standing recovery allowance ("up to N one-task recovery or fix waves within
the approved files and contracts, same supervisor tier"), so a within-scope
fix doesn't need its own gate every time; measured: one four-repository run
needed 8 extra recovery gates for exactly this. ship's preflight step now
states plainly that it runs each distinct `must_run` in a fresh sandboxed
worktree at the pushed tip, never in the main checkout.

code-review 1.10.0 → 1.11.0 for critical-review's fix-wave base and findings
gate after a bypass: a fix wave's base is now always the pushed PR head,
copied from `git rev-parse origin/<pr-branch>`, never local `HEAD` — a fix
wave launched on an unpushed local HEAD once spent 15 agent calls before
every executor refused on the merge-base check — and an earlier "implement
directly" approval given during execution does not extend to review
findings: the user sees the findings table every time before fixes go
through the Post-Review Fix Protocol.

## 4.1.0

Non-breaking. `super-plan` names a sibling-dependency planning rule: a
task that documents, tests, or consumes an artifact produced by another
task of the same wave — a file, fixture, function, CLI output, or
behavior that does not exist at the wave's base — goes into a later
wave or into the same task, because file-disjoint tasks are not
dependency-free. The Seam audit now checks this explicitly: for every
task it lists the artifacts that task reads that do not exist at the
wave's base, and fails the plan when a same-wave sibling produces any
of them; "no file-ownership conflicts" is not a pass on its own —
measured: the pilot's audit reported exactly that and missed the
dependency. On the execution side, an executor whose task needs an
artifact that another task of the same wave is producing (a file,
fixture, function, or behavior missing from its worktree) stops and
reports `blocked-on-sibling: <what is missing and which task makes
it>` instead of inventing it or committing a placeholder; when the
supervisor confirms the named artifact is absent at base and outside
`files_allowed`, it records the violation with `"satisfiable": false`
— the contract was not satisfiable by truthful work, and the verdict
still fails, with the executor's innocence carried in that field, never
in `ok:true`. The `tests/eval/ship-smoke.sh` fixture is fixed for the
same class of bug: its `add-doc` task used to describe "the
division-by-zero guard", which only exists once the sibling `add-guard`
task writes it in the same wave, making the two nominally independent
tasks implicitly dependent; it now documents only the expectation in
tests/test_calc.py and is steered away from describing `src/calc.py`'s
implementation.
The mid-size Codex pilot of 2026-09-24 (`gpt-6-sol` orchestrator, runner;
standard: 7 tasks / 3 waves, 12.2 min, $1.14; premium: 6 tasks / 2 waves,
10.2 min, $2.99) finished below the lower bound of both of its own Gate 2
ranges, and a real four-repository plan was quoted at 7–16 hours and
$60–250. So the skills no longer estimate at all: super-plan's Gate 1 names
the supervisor choice without a price, Gate 2 shows the plan's shape — the
waves, the tasks that run in parallel in each, the critical path in waves —
instead of a wall-time and cost range, and multi-model's table, progress
updates and summaries and ship's handoff carry no time or cost prediction.
`super-plan/references/estimates.md` left the skill; its measurements are
kept as history in `tests/eval/wave-cost-measurements-2026-09-24.md`, which
no skill reads. This release also folds in review fixes: the Claude runner
routes a blocked-on-sibling stop to the judge, satisfiable covers report
violations, a blocked-on-sibling contract amendment, e2e placement and the
docs-only lint exception.

**Design for width.** super-plan now plans for parallel waves explicitly:
`files_allowed` cut by file rather than by directory, a contract-first wave
before its parallel implementers, independent chains — including plans for
separate repositories — side by side, and never one wave per step of a
sequential list. A plan of three or more waves whose waves mostly hold a
single task gets a linter warning unless it explains each such wave under
`## Parallelism`. Measured cause: a four-repository plan came out as 14
waves of one task each.

**Effort detection.** The runtime-context hook now reports the Codex
session's effort: it reads `effort` from the session's own `turn_context`
record through the hook payload's `transcript_path` — at SessionStart, and
again at UserPromptSubmit when the model or effort changed — instead of a
fixed `effort=unknown`. Claude Code gives hooks no effort (a hook's
`CLAUDE_EFFORT` is only inherited from the parent process), so Step 0 on a
Claude Code host reads `CLAUDE_EFFORT` once through the shell tool, where
Claude Code sets it to the session's own effort — and never on a Codex
host, where the variable can be inherited from a parent Claude Code
session. `code-review` 1.9.0 → 1.10.0 for its copy of the hook and
critical-review's Step 0.

## 4.0.0

Breaking: plans that lack the new required `ci` and `e2e` keys, or that use
`claude-fable-5-1` or `gpt-6-astra` in any role without a recorded
`approvals.premium`, now fail `plan-lint.mjs`; both launchers lint plans
before running them (`wave-launch.mjs` for Claude waves, and the Codex
runner's derived per-task plans), so a previously approved plan stops
launching until it is migrated. To migrate, add next to `"waves"` in the
plan's `` ```json wave-plan ``` `` block: `"ci"` (`{"commands": [...],
"workflows": [...]}`, copied verbatim from the repository's own CI
entrypoints and `.github/workflows/*.yml`, or `"none: <reason>"`), `"e2e"`
(`{"task": "<id>"}` naming the task that runs the feature's real entrypoints
end to end, or `"not-applicable: <reason>"` for a non-pipeline feature), and,
wherever a premium model is used, `"approvals": {"premium": {"models":
[...], "reason": "...", "approved_by": "...", "date": "YYYY-MM-DD"}}`.

The shipped linter now enforces the plan format's three new required
top-level keys, `ci`, `e2e`, and `approvals.premium` — required whenever
`claude-fable-5-1` or `gpt-6-astra` appears in any role (supervisor,
executor, or ladder rung), recording an explicit Gate 1 choice rather than a
silent default. Planning names the supervisor choice, with its estimated
cost, at Gate 1: the premium `claude-fable-5-1` or `gpt-6-astra` (needs
`approvals.premium`), or a standard alternative — Claude: `claude-opus-5-5`
for a wave whose executors and ladder rungs never reach `claude-opus-5-5`
itself (the default ladder included — a `claude-sonnet-5` task whose ladder
reaches `claude-opus-5-5` is supervised by `claude-fable-5-1` instead), else
`claude-opus-5`; Codex: `gpt-6-sol` only for a wave whose executors and
ladder rungs are all `gpt-6-luna` — measured, not a policy guess: supervisor
fixture 9/9 on 2026-09-23 (twice) and 9/9 on 2026-09-24 (×3); ship-smoke
runner mode outside the Codex sandbox, three runs each, `gpt-6-sol`
supervisor merge-ready first try 3/3 at wall 2.44/2.27/2.14 min and cost
$0.238/$0.252/$0.200, versus `gpt-6-astra` supervisor 3/3 at wall
2.17/2.39/2.62 min and cost $0.753/$0.698/$0.768 — Sol ≈3.2× cheaper at the
same wall time (limits: two-task toy waves with correct work only; defect
detection comes from the fixture, not these waves) — any Sol executor in the
wave loses that standard option and needs the premium `gpt-6-astra`
supervisor instead. The `approvals.premium` rule covers what the plugin
launches, not the session's own model: `ship`'s final-review child is chosen
at Gate 1 and recorded in the plan's `"review"` key — the premium
`gpt-6-astra` with a valid `approvals.premium` entry, or the standard
`gpt-6-sol` — measured: critical-review strict gate clean 10/10 and planted
10/10 combined (two 2026-09-24 runs of 5/5 each), PR support 3/4 (one
withheld-case miss), stated in the PR; a plan missing the `"review"` key
stops `ship` before that review runs. Full counts and limitations:
[`tests/eval/stage-c-verification-2026-09-24.md`](tests/eval/stage-c-verification-2026-09-24.md).
`plan-lint.mjs` now flags retired routes as
warnings, not silently: GPT-5.6 (Sol/Terra/Luna) in any role, Opus 5 as an
executor, and every Opus 4.8 executor or rung (the linter cannot tell
compiled-binary work apart from any other task, so it warns on all of
them). When the repository has real `.github/workflows/*.yml` files,
`plan-lint.mjs --repo <repo>` also checks the plan's own CI keys against
them: every `ci.workflows` path must exist under the repo's
`.github/workflows`, and every `ci.commands` entry must appear verbatim
(whole-command matching, not a partial token) inside a listed workflow file;
`wave-launch.mjs` now runs that `--repo` check at launch too, so these
repo-dependent CI checks are no longer silently skipped when a Claude wave
starts. Three linter/runner defects are fixed: `plan-lint.mjs` no longer
crashes on an impossible calendar date (e.g. `2026-02-30`) in
`approvals.premium.date`, instead rejecting it as invalid; a relative
workflow path with a leading `..` segment (e.g. `..foo.yml`) is now accepted
under `ci.workflows` rather than rejected; and a non-array `ladder` value
now fails the plan closed instead of being silently skipped. The Codex wave
runner (`codex-wave-runner.mjs`) must now be launched as an escalated command
outside the Codex sandbox: macOS seatbelt cannot nest a second sandbox
profile inside the first, so a runner launched inside a Codex
`workspace-write` sandbox has its own `codex exec` children fail (`failed to
initialize in-process app-server client: Operation not permitted`, then,
with `~/.codex` writable, `sandbox-exec: sandbox_apply: Operation not
permitted`); the runner now probes for this nested-sandbox condition at
start and, when blocked, stops before spawning anything with error
`nested-sandbox` (exit code 2) instead of failing task by task. Planning
adds a seam audit between Tasks and Lint — a cheap read-only agent checks
every contract against the code before lint runs, including a same-task
rule requiring a change and the test helper, fixture, or shared file it
breaks to stay in the same task — and Gate 2 now requires an estimated
wall-time range in minutes and a cost range in dollars computed from
`references/estimates.md`'s price table and formula (never a bare word such
as "low" or "cheap"), naming which `references/estimates.md` rows fed the
computation, alongside the lint-clean plan. `critical-review` adds one findings gate: when several reviews run
for one request, it waits for all of them and presents every finding once,
in one table per scope, before any fix is asked for. It also states a hard
secrets prohibition: never open, print, copy, or transmit credentials,
tokens, or configuration files that hold them while reviewing; report their
presence by name only. The executor and supervisor prompts (the Claude and
Codex runners, and multi-model's task template) carry that same secrets
prohibition. The trusted-report research route — a report the orchestrator
will trust without re-verification — moved from Opus 4.8 to Opus 5.5.
`code-review` 1.8.0 → 1.9.0 (non-breaking).

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
orchestration 4.2.0, code-review 1.11.0):

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
          worktree-env.mjs           # shared worktree links, writable caches, environment-block detection
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
