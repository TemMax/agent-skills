# A checkout builds its own Gradle sources — results, 2026-11-10

Orchestration 4.21.1 candidate (PR #45, `a274743`): a cloned `.gradle`
leaves its `configuration-cache` behind, and with `share_builds:
"executor"` a `.gradle` is not linked (`CHECKOUT_BOUND` in
`build-dirs.mjs`). Control: `main` at 4.21.0 (`b0680d2`). One run per
cell; the outcome is decided by the files a checkout is given, not by the
models.

## Live waves

Driver `tests/eval/gradle-live.py`, the real runners and host CLIs:
Claude Code 2.1.322 (executor `claude-haiku-5-5`, supervisor
`claude-sonnet-5-5`), Codex CLI 0.167.0 (executor `gpt-6-luna`,
supervisor `gpt-6.1-sol`), all at `medium`; Gradle 8.14.2, JDK 21. The
fixture is a Java project with the configuration cache on. Before the
wave the repository checkout runs the task's check,
`./gradlew --offline checkGreeting`: it fails on the old `greet` and
stores a configuration cache entry. The task adds the exclamation mark;
the check passes only in a checkout that builds its own sources.
Expectations were frozen in `expected.json` before each run; the
snapshot's `build-dirs.mjs` matched the PR head (4.21.1) or `main`
(4.21.0) by hash.

| Run | Result |
|---|---|
| Claude, default (clone) | 8/8 frozen checks, task `ok`, 2 model calls, 44 s |
| Codex, default (clone) | 8/8, task `ok`, 2 calls, 40 s |
| Claude, `share_builds: "executor"` | 9/9, task `ok`, 2 calls, 28 s |
| Codex, `share_builds: "executor"` | 9/9, task `ok`, 2 calls, 38 s |
| Control: Claude, default, 4.21.0 (`b0680d2`) | 3/3: task `budget-exhausted`, change made, check fails |
| Control: Codex, default, 4.21.0 (`b0680d2`) | 3/3: task `failed`, change made, check fails |

The candidate's checks: the wave exits 0; the task is accepted; the
executor's `.gradle` is a clone (a marker file planted in the repository
checkout's `.gradle` is there); the executor changed `greet`; the check
passes when run again in the executor's worktree; the repository
checkout's configuration cache, `build` and `greet` are unchanged; with
`"executor"`, the common `info/exclude`, where the runner records each
link, holds `/build` and not `/.gradle`. The control's: the task is not
accepted, the executor changed `greet`, and the check still fails in its
worktree.

In both controls the executor's change was correct (`+ "!"`), yet the
check, in the wave and again afterwards in the executor's worktree,
reported `expected Hello, Ann! but got Hello, Ann` after "Reusing
configuration cache.": the repository checkout's entry built its old
sources (9 and 15 mentions of that failure in the wave's records, which
repeat tool output). In the candidate runs the check never got the old
`greet`.

Not exercised: the repository checkout's `build` being overwritten. In
this fixture the reused entry finds the repository checkout's
compilation up to date, so that check could not fail here. The control
covers the default mode only: on 4.21.0 the executor's own worktree
already carries the repository checkout's entry, so the wave fails before
the link matters; `only_build_linked` is what checks the executor-mode
half.

Earlier runs of the driver, before its control and executor-mode checks
were added, gave the same outcomes: four candidate cells passed and a
Claude control failed the same way.

## Kotlin and Android, by hand

Two-module projects, `lib` with an inline `greet` and `app` calling it,
so a change in `lib` must recompile `app` (Kotlin's incremental
compilation, its caches in the cloned `build`); configuration cache on.
The repository checkout was built once; a new checkout of the same commit
got `Hi` in `greet`, was seeded with `seedBuildDirs` (`.gradle`,
`.kotlin`, `build`, `lib/build`, `app/build`) and built, then got `Hey`
and was built again.

| Project | 4.21.0 | 4.21.1 |
|---|---|---|
| Kotlin/JVM 2.4.21, `:app:run` | "Reusing configuration cache.", `Hello, Ann` twice | `Hi, Ann`, then `Hey, Ann` |
| Android, AGP 8.13.2, Kotlin 2.4.21, `:app:assembleDebug` | `Hello` in `app`'s class and the APK, twice | `Hi`, then `Hey`, in `app`'s class and the APK |

In every case the repository checkout's `.gradle/configuration-cache`,
`.kotlin` and build directories had the same digest afterwards, and it
still built `Hello`. Kotlin's incremental caches cloned with `build` did
not bring back the repository checkout's code.

Not run: Linux (`cp --reflink`), AGP 9, KSP, kapt or Compose, a large
project, a `.gradle` inside another build directory (cloned whole with
its configuration cache).
