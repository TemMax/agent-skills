# Changelog

Release notes for the orchestration and code-review plugins, newest
first. Each release is one `## X.Y.Z` section named after the
orchestration version; a code-review bump is stated inside it.

## 4.2.0

### Highlights

**multi-model**
- Stops on a broken environment, not on the task
- Codex workers can build and commit in the sandbox
- Model-free preflight before any agent starts

**super-plan**
- Every CI gate goes into each task's checks
- plan-lint: fewer false errors, less noise

**ship**
- Each stop ends with one recommended next step
- Preflight runs in a fresh worktree

**critical-review**
- Fix waves start from the pushed PR head

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

Release notes moved from README to `CHANGELOG.md`, and a new release section
reaching `main` is announced on Telegram (`.github/workflows/announce.yml`,
`scripts/announce-changelog.sh`, `scripts/telegram-notify.sh`).

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

## 3.0.0

Breaking.

Claude aliases (`opus`, `sonnet`, `fable`, `haiku`) are no longer accepted in
plans or runner args — name the full Claude ID instead (see Full model IDs
above). The linter and the runner reject an alias by name rather than
resolving it, because an alias can re-point to a different model silently.

