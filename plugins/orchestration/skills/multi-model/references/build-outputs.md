# Build outputs and tool caches

A wave builds each task in several checkouts: the executor's worktree, the
verifier's disposable checkout (every attempt), the supervisor's checkout,
and once per wave the preflight's. Built from scratch, each holds a full copy
of the build: measured on a Rust project (`lethe`,
`cargo test --workspace --all-features --no-run`), 15 GB and 204 s per
checkout.

## What the runners do (`build-dirs.mjs`)

A checkout's build outputs are the directories git ignores in it whose name
is a build tool's output directory, at any depth: `target`, `build`, `out`,
`dist`, `obj`, `node_modules`, `.gradle`, `.kotlin`, `.next`, `.turbo`,
`.build`, `DerivedData`, `Pods`, `.dart_tool`, `_build`, `cmake-build-*` and
the others in `OUTPUT_NAMES`. Other ignored directories — logs, data, agent
and editor state — are never touched. Left out as well: linked files
(`worktree.links`), `.git`, `.worktrees`, symlinks, and an output that names
its own checkout by absolute path (it holds `pyvenv.cfg`, `CMakeCache.txt`
or `meson-private`, itself or one level down): a clone of a Python virtual
environment or a CMake build directory would keep running the repository
checkout's code.

The plan's `worktree.share_builds` chooses:

- **default — clone the repository checkout's build.** Every new checkout
  (the executor's worktree, the verifier's disposable checkout, the
  supervisor's checkout, the preflight's) gets a copy-on-write clone (`cp -c`
  on APFS, `cp --reflink=always` on btrfs or XFS) of the build outputs of the
  checkout the runner was given (`--repo`). A clone costs no space until a
  build changes a file; then only that file takes its own space. Verification
  still never sees the executor's own artifacts. One file is cloned first
  with a forced clone: when the two checkouts are on different volumes or the
  file system has no clones, nothing is copied and each checkout builds as
  before (`cp -c` alone would silently copy in full).
- **`"executor"` — also reuse the executor's build.** The verifier's and the
  supervisor's checkouts link to the executor's build-output directories
  instead; they run after the executor and one after the other. Git is told
  to ignore the links (anchored entries such as `/target` in the common
  `info/exclude`, left there). On Codex the supervisor may write to the
  linked directories. This removes their copies of the task's build, but
  verification no longer starts clean: a test that passes only because of a
  stale ignored file in the executor's worktree passes there too. Set it only
  on the user's word.
- **`false`** — neither; every checkout builds from scratch.

**Tool caches outside the repository** are shared by every agent in every
mode. On Codex the runner opens the caches the repository's tools name
(`CARGO_HOME`, `~/.m2`, Kotlin's daemon directory, the npm, pnpm, yarn, Go,
pip, uv, SwiftPM and CocoaPods caches) in the sandbox from the start, under
the rules of `codex-wave-protocol.md`'s "Tool directories opened from a real
denial", recorded as `tool cache` grants. Toolchains (`~/.rustup`,
`~/.konan`) are not opened: their programs run outside the sandbox too. A
`~/.cargo` whose `bin` is on `PATH` is refused for the same reason.

The clone runs synchronously in the runner; while a large one runs, other
tasks' progress lines wait.

## What it saves, and what it does not

Measured on `lethe` (`cargo test --workspace --all-features --no-run`, one run
each, 2026-10-14; a probe edit in the main crate, then a verifier checkout of
that commit):

| Checkout | Space | Time |
|---|---|---|
| Repository checkout, cold | 14.4 GB | 161 s |
| Executor's worktree, cloned, after the edit | 12.4 GB | 96 s |
| Verifier, default (cloned from the repository) | 12.4 GB | 95 s |
| Verifier, `"executor"` (linked) | 4.0 GB | 99 s |
| Executor's next build after that verifier | 1.0 GB | 117 s |

Each checkout without sharing is a full cold build (14.4 GB, 161 s). A clone
saves the dependencies (about 2 GB and 40% of the time here), not the
project's own outputs: every test binary of `lethe` links the whole crate,
and an edit rebuilds them all. `"executor"` saves another 8 GB per verifier
and supervisor checkout but no time: `lethe`'s build script watches
`.git/HEAD`, so the main crate is compiled again in every checkout, into the
shared directory, and the executor's next attempt compiles it once more.

On a small Gradle library (`android-id-reader`) the checkouts' own build
directories were 5 MB and each checkout built in 2 s with or without
sharing: Gradle's build cache and the dependency caches live in `~/.gradle`,
which every agent already shares. Linked `.gradle` and `build` directories
built correctly there.

Not measured: Node in a linked checkout (some Node tools resolve a linked
`node_modules` to the executor's worktree). If one breaks, set `worktree.share_builds: false` for that plan.
