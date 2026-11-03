# T3 Code background wait — live result (2026-11-03)

Candidate: orchestration 4.18.1 (`t3-background-wait`), files read from the
candidate checkout. Host: a fresh T3 Code Claude thread, `claude-opus-5-5`
coordinator. Fixture: `cost-control-live.py` `fixture(out, 'recovery', 'claude')`,
one task, Haiku 5.5 executor, Opus 5.5 supervisor.

The prompt told the coordinator to launch the runner as `claude-wave-adapter.md`
says and did not mention `t3_background_wait`.

Expected before the run, and observed:

| Expected | Observed |
| --- | --- |
| The runner starts as a background command | Started as task `bzxhpqb53` |
| `t3_background_wait` is called right after the launch | Called with `["bzxhpqb53"]`; matched |
| The thread's roster holds the task as awaited while it runs | `{"taskId":"bzxhpqb53","awaited":true,"kind":"command"}` |
| The roster is empty after the runner ends | Empty; the wake turn reported verdict `ok` |

The wave took 34 s and two model calls. One run; not repeated.

Rebased onto orchestration 4.20.0 and released as 4.20.1: `claude-wave-adapter.md`
and `codex-wave-protocol.md` are byte-identical to the tested candidate, so this
run covers the released text. The Codex-wave launch point was not run live.
