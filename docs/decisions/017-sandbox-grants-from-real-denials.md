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

The runner opens a denied directory itself, from the real output of a
contract command it runs in the sandbox, never from a model's words:

1. **Preflight.** A `must_run` command denied in the sandbox gets the denied
   directory and runs again, up to three times, before it is classified as a
   sandbox-only or a machine block.
2. **Executor.** When an executor's report opens with `environment-blocked:`,
   the runner runs that task's `must_run` commands in the executor's worktree
   and sandbox. When one is denied, the runner opens the directory and the
   same thread continues within the same attempt (`followUp:
   "sandbox-grant"`), at most twice per attempt, only while two model calls
   are left.
3. **What may be opened.** Only a tool's own directory under the home
   directory: a top-level dot-directory, or the next directory under
   `~/Library/Caches`, `~/Library/Application Support`, `~/Library/Logs`,
   `~/.cache`, `~/.config`, `~/.local/share` or `~/.local/state`. Never the
   directories of keys, tokens or agent configuration, nothing inside or
   containing the repository, no git repository. A missing directory is
   created under its existing parent.
4. **Record.** An opened directory stays writable for the rest of the wave,
   is listed in `summary.json` under `sandboxGrants` and on stderr, and the
   coordinator adds it to the plan's `worktree.writable`.

The Claude runner is unchanged: its executors run without an operating-system
sandbox.

## Evidence and limits

Live, 2026-10-14, real Codex sandbox, one run each: a `must_run` command that
keeps a cache in `~/.agent-skills-sandbox-probe` was opened by the preflight
and the wave was accepted; with the preflight off, an executor that needed the
command reported `environment-blocked`, the runner opened the directory, the
same thread finished the task and the wave was accepted with one attempt. A
first executor-time run was inconclusive: the executor committed without
reporting the block. Record:
[`tests/eval/same-model-supervision-results-2026-10-13.md`](../../tests/eval/same-model-supervision-results-2026-10-13.md).

A denial from a command outside the contract is not reproduced, so it is not
opened. Opening a directory lets every later child of the wave write there; a
tool directory is the boundary, not a proof that the directory holds nothing
of value.
