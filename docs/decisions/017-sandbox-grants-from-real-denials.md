# 017 — The Codex runner opens a tool directory the sandbox denied

Date: 2026-10-14
Status: accepted

## Context

Every Codex child of a wave runs in `codex exec --sandbox workspace-write`:
on macOS a seatbelt policy lets it write only to its worktree, its git
directories and the writable roots the runner passes. For a repository with
`gradlew` the runner adds `~/.gradle` and `~/.android`; anything else had to
be named in the plan's `worktree.writable`.

In a user's series of 18 runner invocations one task stopped as
`environment-blocked` after its executor had worked for three minutes: a
Gradle `must_run` command was denied writing to a cache directory in the home
directory. The preflight had run the same command in the sandbox at the base
commit and it had passed — most likely a cached build did no work there. The
coordinator added the directory to `worktree.writable` and ran the wave again.

The user asked for a general answer rather than a longer list of directories.
Of three options — open denied directories from real output, run executors
without the sandbox (as the Claude runner already does), or give executors a
separate writable home directory — the user chose the first.

## Decision

The runner opens a denied directory itself, from the output of a command it
runs in the sandbox:

1. **Preflight.** A `must_run` command denied in the sandbox gets the denied
   directory and runs again, up to three times, before it is classified as a
   sandbox-only or a machine block. The preflight runs the base commit, so a
   missing tool directory may be created here.
2. **Executor.** When an executor's report opens with `environment-blocked:`,
   the runner runs that task's `must_run` commands in the executor's worktree
   and sandbox, then the command the executor names on a `blocked-command:`
   line — asynchronously, for at most ten minutes each, without secret-named
   environment variables, with the output kept in the run directory. When one
   is denied, the runner opens the directory and the same thread continues
   within the same attempt (`followUp: "sandbox-grant"`), at most twice per
   attempt, only while two model calls are left. Both outputs can come from
   code or a command the executor chose, so nothing is created at this point.
3. **What may be opened** is decided on the path alone, ignoring letter case:
   a tool's own directory under the home directory — a top-level
   dot-directory, or the next directory under `~/Library/Caches`,
   `~/Library/Application Support`, `~/Library/Logs`, `~/.cache`,
   `~/.config`, `~/.local/share` or `~/.local/state`. Never one that contains
   a directory on `PATH` or the runner's own programs, a git repository (bare,
   or nested two levels down), the repository or the run directory, or the
   directories of keys, tokens, agent configuration and shell start-up.
4. **Record.** An opened directory stays writable for the rest of the wave and
   is listed in `summary.json` under `sandboxGrants` and on stderr. A preflight
   grant belongs in the plan's `worktree.writable`; one found through the
   executor's code or command is checked before it is added.

The Claude runner is unchanged: its executors run without an operating-system
sandbox.

**What the sandbox is for.** It limits accidental damage by an executor. It
is not a boundary against a hostile executor: the mechanical verifier runs the
candidate's own contract commands outside the sandbox. The rules above keep a
grant from reaching beyond a tool's own cache.

## Evidence and limits

Live, 2026-10-14, real Codex sandbox, one run each: a `must_run` command that
keeps a cache in `~/.agent-skills-sandbox-probe` was opened by the preflight
and the wave was accepted; with the preflight off, an executor that needed the
command reported `environment-blocked`, the runner opened the directory, the
same thread finished the task and the wave was accepted with one attempt. A
first executor-time run was inconclusive: the executor committed without
reporting the block. With the denied command outside the contract, the
executor named it, the runner ran it, probed the denial and opened the
existing directory, and the wave was accepted with one attempt; the run
before it had failed because the runner misread a command given in backticks,
fixed with a test. Record:
[`tests/eval/same-model-supervision-results-2026-10-13.md`](../../tests/eval/same-model-supervision-results-2026-10-13.md).

An independent review of the first version found that letter case got past
the protected list and the repository check (`~/.SSH`, `~/.CODEX` on a
case-insensitive file system), that a version manager's directory with shims
on `PATH` could be opened — programs the runner then starts outside the
sandbox —, that contract-command output at executor time comes from the
executor's code, that a write probe could not tell a printed denial from a
real one, that the reproduction blocked the runner, and that npm and Go
wording was missed. The decision above is the fixed version; the probe was
removed. A model can still print a denial it did not meet and so get an
existing tool directory opened. Opening a directory lets every later child of the wave write there;
a tool directory is the boundary, not a proof that the directory holds nothing
of value. macOS does not record the denials of the Codex sandbox in its
unified log (checked on this machine), so that log cannot replace the
reproduction.
