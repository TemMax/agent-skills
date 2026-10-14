# 018 — A wave's checkouts start from a clone of the repository's build

Date: 2026-10-14
Status: accepted

## Context

A wave builds each task in several checkouts: the executor's worktree, the
verifier's disposable checkout (every attempt), the supervisor's checkout and,
once per wave, the preflight's. Each built from scratch. The user reported
that `ship` on a large Rust workspace filled the disk within seconds, every
agent building its own copy, and asked for an answer that works for any
ecosystem, not only Rust. Measured on that workspace: a cold build of
`cargo test --workspace --all-features --no-run` takes 14.4 GB and 161 s.

## Decision

1. **Build outputs** are the git-ignored directories of a checkout whose name
   is a build tool's output directory (`target`, `build`, `node_modules`,
   `.gradle`, `.build`, `cmake-build-*` and the others in `build-dirs.mjs`).
   Other ignored directories, symlinks, linked files and an output that
   records its own checkout's absolute path (`pyvenv.cfg`, `CMakeCache.txt`,
   `meson-private`) are left alone.
2. **Default.** Every new checkout gets a copy-on-write clone of the
   repository checkout's build outputs — on Claude and Codex, in the
   executor's worktree (the Claude runner now creates it before the first
   executor call), the verifier's, the supervisor's and the preflight's
   checkouts. A clone runs only on the same volume and on a file system with
   clones (APFS, btrfs, XFS, ZFS); otherwise nothing is copied, because
   `cp -c` on macOS silently copies in full when it cannot clone.
   Verification never sees the executor's artifacts.
3. **`worktree.share_builds: "executor"`**, on the user's word: the
   verifier's and the supervisor's checkouts link to the executor's build
   directories instead. Less disk, but verification no longer starts clean.
   **`false`** turns sharing off.
4. **Tool caches** the repository's tools name are opened in the Codex
   sandbox from the start, under ADR 017's rules; toolchains are not.

Linking by default was rejected: an existing test guards that verification
runs in a fresh checkout without the executor's artifacts, and a stale
ignored file could make a test pass there.

## Evidence and limits

Measured on the same workspace, one run each: after an edit in the main crate
a cloned checkout took 12.4 GB and 95 s, a linked verifier 4.0 GB and 99 s,
and the executor's next build after it 1.0 GB and 117 s. The workspace's
build script watches `.git/HEAD`, so its main crate is compiled again in
every checkout and every test binary links it; sharing cannot remove that.
On a small Gradle library sharing made no difference: its caches live in
`~/.gradle`, already shared. A live wave on each host with a prebuilt ignored
directory was accepted, with the executor's and the verifier's checkouts
started from the clone.

An independent review of the first version found that `cp -c` copied in full
across volumes and on HFS+, that a cloned `.venv` or CMake build directory
kept running the repository checkout's code, that every ignored directory
(logs, data, `.claude`) was cloned or linked and its exclude entry left in
the repository, that a Codex supervisor could not write to linked
directories, and that `~/.rustup` was opened. The decision above is the fixed
version, with tests. Remaining: exclude entries for linked output names
(`/target`) stay in the common `info/exclude`; a large clone runs
synchronously and delays other tasks' progress lines.
