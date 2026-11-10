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
| Claude, default (clone) | 7/7 checks, task `ok`, 2 model calls, 31 s |
| Codex, default (clone) | 7/7, task `ok`, 2 calls, 36 s |
| Claude, `share_builds: "executor"` | 7/7, task `ok`, 2 calls, 22 s; only `/build` linked |
| Codex, `share_builds: "executor"` | 7/7, task `ok`, 2 calls, 36 s; only `/build` linked |
| Control: Claude, default, 4.21.0 | Task `budget-exhausted`, as expected |

The seven checks: the wave exits 0; the task is accepted; the executor's
`.gradle` is a clone (a marker file planted in the repository checkout's
`.gradle` is there); the check passes when run again in the executor's
worktree; the repository checkout's configuration cache, `build` and
`greet` are unchanged.

In the control the executor's change was correct (`+ "!"`), but every
run of the check in the wave's checkouts printed "Reusing configuration
cache." and `expected Hello, Ann! but got Hello, Ann` (9 times): the
repository checkout's entry built its old sources. In the candidate runs
the check never got the old `greet`; where "Reusing configuration cache"
appears, it is a second run in the same checkout and the check reports the
new one. With `"executor"` the common `info/exclude` holds `/build` and no
`/.gradle`: the build directory was linked, `.gradle` was not.

The same five cells gave the same outcomes in an earlier run of the driver
before it was committed.

## Kotlin and Android, by hand

Two-module projects, `lib` with an inline `greet` and `app` calling it,
so a change in `lib` must recompile `app` (Kotlin's incremental
compilation, its caches in the cloned `build`); configuration cache on. The repository checkout was built
once; a new checkout of the same commit got `Hi` in `greet`, was seeded
with `seedBuildDirs` (`.gradle`, `.kotlin`, `build`, `lib/build`,
`app/build`) and built, then got `Hey` and was built again.

| Project | 4.21.0 | 4.21.1 |
|---|---|---|
| Kotlin/JVM 2.4.21, `:app:run` | "Reusing configuration cache.", `Hello, Ann` twice | `Hi, Ann`, then `Hey, Ann` |
| Android, AGP 8.13.2, Kotlin 2.4.21, `:app:assembleDebug` | `Hello` in `app`'s class and the APK, twice | `Hi`, then `Hey`, in `app`'s compiled class and the APK's dex |

In every case the repository checkout's `.gradle/configuration-cache`,
`.kotlin` and build directories had the same digest afterwards, and it
still built `Hello`. Kotlin's incremental caches cloned with `build` did
not bring back the repository checkout's code.

Not run: Linux (`cp --reflink`), AGP 9, KSP, kapt or Compose, a large
project, a `.gradle` inside another build directory (cloned whole with
its configuration cache).
