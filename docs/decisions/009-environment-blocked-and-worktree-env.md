# 009 — `environment-blocked` and a shared worktree environment

Date: 2026-09-25
Status: accepted

## Context

A read-through of four 2026-09-24/25 session transcripts found the
failures were mostly environmental: the waves could not build in the
environment they were given, and the skills blamed the contract or the
executor for it. Plan-lint limits never fired; the lint problems were
false positives and warning noise.

Codex children run `codex exec --sandbox workspace-write -C <worktree>`
(`codex-wave-runner.mjs` executor 498–505, supervisor 576–583). They pass
no `--add-dir`, and the supervisor gets no network flag. Reproduced without
a model on 2026-09-25 (codex-cli 0.155.1): `codex sandbox -c
'sandbox_mode="workspace-write"' -- touch ~/.gradle/x` fails with
`Operation not permitted`, and passes once `-c
'sandbox_workspace_write.writable_roots=["<home>/.gradle"]'` is set. `git
add`/`commit` from a linked worktree of a repo outside `$TMPDIR` fails with
`Unable to create '<repo>/.git/worktrees/w/index.lock': Operation not
permitted`, and passes once `writable_roots=["<repo>/.git"]` is set.
`codex exec --help` lists `--add-dir <DIR>` ("Additional directories that
should be writable alongside the primary workspace"), and `codex sandbox
[COMMAND]...` runs a command under the same seatbelt with no model.
`-c mcp_servers.<name>.enabled=false` made `codex mcp list` fail with
`Error: bootstrap`, so disabling child MCP servers is out of scope.

Session A (Codex, Android): two runner invocations stopped all tasks as
`contract-unsatisfiable` — "Gradle lock-file denied in `~/.gradle`; no
Android SDK in the verification checkout". Fresh worktrees and checkouts
lack the gitignored `local.properties`, and `ANDROID_HOME` is empty. Both
times the user approved bypassing supervised execution. The contract
preflight had run in the main checkout: "13 commands green" — a
main-checkout preflight cannot see a fresh sandboxed worktree's Gradle lock
or missing SDK.

Session B (Codex, four repositories): executors repeatedly produced empty
branches ("both attempts ended without a commit"); the Codex verifier
charged `worktree must be clean` + `branch must contain at least one
commit` to the executor. `## Task <id> — Title` passed plan-lint
(`/^## Task ([a-z0-9-]+)/gm`, no end anchor) but crashed runner init
(`codex-wave-state.mjs:106` anchors `[ \t]*\r?$`). A plan's prose told the
executor to rewrite an existing test while `forbidden_moves` banned
weakening an existing test — the verdict was `failed`, not
`contract-unsatisfiable`, and it took ~5 runner runs plus 7 ad-hoc recovery
plans. An eval wave launched before the other repository's artifact
existed. Two 45-minute supervisor timeouts left no cause in `summary.json`.
A one-line gofmt drift from wave 1 was caught only at the merged gate and
cost a recovery wave.

Session C (Claude Workflow, Android attachments, 4.0.0): "SDK location not
found" appeared 9 times. Agents improvised `ln -s ../../local.properties`
93 times. At least 4 agents ran `cat local.properties`, which printed a
GitHub token — twice after the orchestrator had already warned. Two fix
waves were needed because `detekt` and Kotlin/Native test compilation were
not in any task's `must_run`. A changed `AppRouter` interface broke fakes
in 9 modules, costing 2 fix waves. The feature was built but not wired into
the production DI graph or the screen. A fix wave launched on an unpushed
local HEAD: 15 agent calls were spent before every executor refused on the
merge-base check. An executor ended its turn on `Monitor` ("Waiting for
spotlessApply to finish"). Icons were imported with baked-in backgrounds.

plan-lint experiments on 2026-09-25 (`$TMPDIR`, against HEAD `20f7a1a`):
`./gradlew spotlessCheck` against a workflow line `run: ./gradlew
spotlessCheck $GRADLE_FLAGS` gave "does not appear in any listed
ci.workflows file"; `cd gateway && go test ./...` against a step with
`working-directory: gateway` + `run: go test ./...` gave the same error.
`files_allowed ["app/AGENTS.md"]` + `files_forbidden ["app/**/src/**"]`
gave a false "overlaps its own files_forbidden" error, as did
`files_allowed ["app/feed/impl/**"]` + `files_forbidden
["app/feed/impl/src/Dock.kt"]` — both are carve-outs, not overlaps. One
session printed 33 "files_allowed prefix … does not exist" warnings, all
for paths the tasks themselves create.

## Decision

**`environment-blocked`.** A new terminal stop status, distinct from
`contract-unsatisfiable` and `failed`: a command could not start or run
because of the machine, not the work — permission denied on a cache
directory or `.git`, a missing SDK, a lock file that cannot be created, or
commit signing that needs a prompt. It ends the task; no retry, escalation
or amendment follows (only the typed child-error path — a spawned agent or
tool call that itself failed, with no report or verdict to charge an attempt
against — is never charged as an attempt at all). An executor that hits one stops and makes the
*first line* of its report `environment-blocked: <verbatim error line>`;
the marker counts only when it is that first line — a quoted example, a
mid-report mention, or any occurrence after line one never trips it, so a
report that merely discusses or quotes the marker cannot be mistaken for a
stop. The orchestrator fixes the machine (the `worktree` key, `--add-dir`,
symlinks), then re-runs the wave.

**A shared worktree environment.** `worktree-env.mjs` gives the runners and
the linter one definition, driven by a plan's optional `worktree` key
(`{"links": [...], "writable": [...], "auto": true}`): `links` are
repository-relative untracked paths every fresh worktree and checkout gets
symlinked from `<repo>/<path>`, never opened, printed or copied; `writable`
lists cache directories a sandboxed Codex child may write; `auto` (default
`true`) adds `gradlew` → Gradle/Android caches plus an untracked
`local.properties` link, and `Cargo.toml` → the Cargo cache. On Codex the
executor also always gets the repository's git common dir as writable, so
it can commit from a linked worktree. The Codex runner adds the matching
`--add-dir` flags and gives the supervisor the same network parity as the
executor, and gained a model-free `--preflight` that probes every distinct
`must_run` command under the same sandbox, in a throwaway worktree at the
wave's base, before any executor runs. `wave-launch.mjs` refuses to start a
wave whose base is not an ancestor of `origin/<default>`, and honors an
optional `depends_on` key that gates a wave on another ref/path existing in
a (possibly different) repository. An optional `inherits` key lets a child
plan take `ci`, `e2e`, `worktree`, `approvals` or `review` from a named
parent plan, one level only.

**Plan-lint fixes.** The task-heading regex is anchored
(`/^## Task ([a-z0-9-]+)[ \t]*\r?$/gm`) with an explicit error for any
`## Task` line that doesn't match. `ci.commands` matching tolerates a
workflow line's trailing `$VAR`/`${VAR}` arguments and a step's
`working-directory:` prefix. The self-overlap check now recognizes a legal
carve-out (forbidden narrows allowed) instead of flagging it as an overlap.
Missing `files_allowed` prefixes that a task itself will create are folded
into one warning instead of one per path. A `--base <sha>` flag reads
`.github/workflows` and file existence from that commit instead of the
working tree.

**Secrets sentence.** Every existing secrets prohibition a task touches
gains one appended sentence: that includes untracked build configuration a
worktree links — `local.properties`, `.env`, `*.keystore`,
`gradle.properties` under `~/.gradle` — which may hold a key or token: link
or reference such files by path; never `cat`, `head`, `grep` or otherwise
print them.

## Consequences

One extra `git rev-parse --git-common-dir` call and up to several extra
`--add-dir` flags per Codex child. One extra throwaway worktree checkout
and teardown per wave when `--preflight` runs, before any executor starts.
A plan author who wants a linked file or a non-auto-detected writable
directory must now name it in the `worktree` key; auto-detection covers
only Gradle/Android and Cargo. A `depends_on` or an unpushed base now stops
a launch outright instead of racing ahead into empty branches or a Codex
verifier misattributing an environment failure to the executor. Because the
marker counts only on the report's first line, an executor that discovers
the block partway through its work must restate the report so the marker
opens it, rather than appending it wherever the discovery happened.

## Rejected alternatives

**Namespaced branches.** Changing `wave/<id>` to a per-worktree or
per-attempt namespace was considered to reduce collisions, but it breaks
the plan format every existing tool and test parses branch names against.
The runner prints a cleanup command for a stale branch instead.

**Moving task worktrees out of `--repo`.** Placing `.worktrees/` outside
the repository was considered to avoid teaching `git status` and lint
about them, but it would separate the worktree from the git common dir the
sandboxed Codex child already needs writable for commits, and from the
repo-relative paths the `worktree.links` key resolves against. `.worktrees/`
goes into `info/exclude` automatically instead, so it never appears in
`git status`.

**Disabling child MCP servers.** Turning off MCP servers for sandboxed
Codex children was considered to shrink their attack surface and reduce
sandbox friction, but `-c mcp_servers.<name>.enabled=false` made `codex mcp
list` fail outright (`Error: bootstrap`) in the 2026-09-25 reproduction, so
the override itself is broken on the measured Codex CLI version. This stays
out of scope until that is fixed upstream.
