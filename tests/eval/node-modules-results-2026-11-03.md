# Build clones in clonefile subtrees on APFS — results, 2026-11-03

Orchestration 4.21.0 candidate (working tree): on macOS `seedBuildDirs`
clones each build directory with clonefile(2) calls on subtrees of at most
2,000 entries, or a directory holding 500 or more files of its own and
fewer than 20,000 entries, made from one JavaScript for Automation process;
a split directory is made writable and gets its mode after its entries; a tree with a socket, FIFO or
device, or a failed call, goes to `cp -cR` (`build-dirs.mjs`). One run per
cell unless stated, on an M4 Pro Mac mini busy with other work (load
average 3–7, 31 at the end): treat the times as rough.

## Why subtrees

Raw calls on a real `node_modules` (`t3code` worktree t3-3a697f89, 206,528
entries), with a probe renaming a file back and forth every 5 ms in an
unrelated directory on the same volume:

| Method | Wall | System | Probe rename, p99 / max |
|---|---|---|---|
| `cp -cR` (4.20.1) | 35.2 s | 30.7 s | 5.7 ms / 24 ms |
| one clonefile call for the whole tree | 2.1 s | 1.6 s | 2.0 ms / **2,035 ms** |
| subtrees of 2,000 entries | 13.3 s | 8.6 s | 22.5 ms / 62 ms |
| subtrees, and a directory with ≥ 500 own files whole (shipped) | 3.1 s, 3.0 s | 2.4 s | 14–19 ms / 188–191 ms |

All four trees matched: every file's time, mode and size, every link's
target, every directory's mode. One call holds every rename on the volume
for its whole run (found by the independent review; reproduced on a
synthetic 203,000-entry tree: max 1,591 ms against 15–16 ms for `cp -cR`
and `copyfile(3)`'s recursive clone, which took as long as `cp -cR`).
Plain subtrees made 52,000 single-file calls in flat icon directories of up
to 12,000 files; cloning such a directory whole brings the calls down to
2,735.

An earlier probe that wrote, fsynced, statted and removed a file saw no
stall during one call (max 8.7 ms): those operations do not wait, renames
do.

## Measured on a real pnpm monorepo

`t3code` worktree t3-3a697f89 at ff75409, 40 build directories, 248,468
files, links and directories. Two disposable `git clone --shared` checkouts
under `~/Library/Caches` on the same APFS volume, seeded from that
worktree, which was only read: 4.20.1's `seedBuildDirs` (`git show HEAD`)
against the candidate's.

| | 4.20.1 `cp -cR` | 4.21.0 subtrees |
|---|---|---|
| Prepare a checkout (wall) | 28.9 s | 4.9 s |
| Prepare a checkout (system time) | 27.4 s | 2.9 s |
| Probe rename during it, p99 / max | 3.1 ms / 8 ms | 13.4 ms / 170 ms |
| Entries in the checkout | 248,468 | 248,468 |
| `packages/shared` tests (candidate checkout) | — | 1,090 passed, 3 skipped |
| `packages/shared` `tsc --noEmit` (candidate checkout) | — | exit 0 |

The two checkouts' build directories had the same digest of every file's
time, mode and size, every link's target and every directory's mode.

After the second review (read-only split directories made writable until
filled; the 500-file rule capped at 20,000 entries; a partial clone's
removal opens read-only directories), the final code was measured again
under heavier load (average 13): 4.20.1 took 93.8 s (35.3 s system, probe
rename max 688 ms), the candidate 8.6 s (4.0 s system, max 268 ms), the
same three digests as above.

Removing a clone of the root `node_modules`: 11.2–15.5 s for a `cp -cR`
clone, 11.1–19.5 s for a subtree clone, the order of removal mattering more
than the kind (reversed order: 11.9 and 11.1 s against 11.2 and 12.2 s).
Removal is unchanged. Under `taskpolicy -b` (background priority) removing
a clone took 44–50 s and more system time, so background priority was not
adopted.

An earlier run of the one-call version on worktree t3-d324238c (f9b4fd0,
269,404 entries) gave 34.0 s against 4.1 s; three directories whose mode
is 777 there kept 777 in the clone, where `cp -cR` applied the umask. A
subtree cloned whole keeps modes the same way.

## Live wave on a pnpm workspace

Driver `tests/eval/node-modules-live.py`, candidate snapshot (subtree
version), the real runners and host CLIs: Claude Code 2.1.317 (executor
`claude-haiku-5-5`, supervisor `claude-sonnet-5-5`), Codex CLI 0.166.0
(executor `gpt-6-luna`, supervisor `gpt-6.1-sol`), all at `medium`. The
fixture's `apps/cli` test expects the task's new `greet` and imports
`@ws/core` through its `node_modules`; a Cargo-style `target` sits beside
it. Every link in the repository checkout's three build directories was
given a 2001 time before the run: clonefile keeps it, `cp -cR` does not.

| Check (frozen) | Claude | Codex |
|---|---|---|
| Wave exits 0, task `ok` on the first attempt | pass (2 model calls, 26 s) | pass (2 model calls, 34 s) |
| Executor worktree's `node_modules`, `apps/cli/node_modules` and `target` cloned with clonefile | pass | pass |
| Worktree's `@ws/core` link resolves to the worktree's `packages/core` | pass | pass |
| Repository checkout's build directories unchanged (every link and file) | pass | pass |
| Repository checkout's `packages/core` unchanged | pass | pass |

The verifier's checkout is removed after the run. On Claude its record
shows `node --test apps/cli/test.mjs` exit 0; on Codex the supervisor's
verdict cites the verifier's passing run. These are the runs on the final
code (`claude-3`, `codex-3`); the same checks passed on the one-call version
(`claude-1`, `codex-1`) and the first subtree version (`claude-2`,
`codex-2`).

The fixture's trees are small, so each was one call; subtree splitting and
the `cp -cR` fallbacks are covered offline (`tests/lib/build-dirs.test.mjs`).
The review ran clonefile inside `codex sandbox` (workspace-write): it
succeeded; under read-only it failed fast, and the code then falls back.

Not run: Linux (unchanged code path), a large Rust or Gradle project, a
volume without clones live, verifier and supervisor checkouts inspected
directly, the preflight.
