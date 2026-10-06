# Retained communication replay — 2026-10-06

The multi-turn scorer keyed assistant text by native message ID. Codex resumes
reuse IDs such as `item_0`, so a later turn could erase an earlier technical
announcement and produce a false `quiet` pass. The same overwrite was possible
with repeated Claude message IDs.

The corrected scorer retains completed root assistant text in trace order and
saves text plus verdicts per turn in `communication.json`. A run is quiet only
when every turn is quiet. Failed native turns retain text already observed.
Acceptance and phase-context drivers use the same helper. The communication
regex, plugin instructions, versions and installed files are unchanged.

## Offline replay of real traces

Replayed **30 retained native runs / 44 turns**, with **zero new model calls**.
The [machine-readable evidence](turn-message-results-2026-10-06.json) records all
input hashes, scorer hashes and before/after communication verdicts. Raw traces
and original `outcomes.json` files were preserved. New per-turn output is in
`/private/tmp/eval-turn-messages-replay-cli-20261006`.

Comparing ID-based aggregation from commit
`17019eaa11de31d2b1e78ef82df9ca4e7981101e` against the corrected aggregation,
with the **same current regex**, exposed four false passes. The other 26
aggregation verdicts stayed unchanged.

| Retained run under `/private/tmp` | Turns | Lost first-turn text | Quiet before → after |
| --- | ---: | --- | --- |
| `agent-skills-installed-972e393/codex` | 2 | «Прочитаю скилл orchestration:multi-model…» | true → false |
| `agent-skills-installed-17019ea/codex` | 2 | «Прочитаю инструкции скилла orchestration:multi-model…» | true → false |
| `phase-context-4.9.0-1.16.0/codex-new-assigned` | 3 | «Использую навык super-plan… прочитаю его инструкции…» | true → false |
| `phase-context-4.9.0-1.16.0/codex-old-assigned` | 3 | «Прочитаю инструкции super-plan…» | true → false |

The replay CLI also compares against each stored original outcome. That reports
**10 differences**: the four aggregation failures above plus six historical
scoring differences. Those six remain even when replaying the previous
aggregation with today's regex; they are not attributed to this aggregation
fix. Original runs used their own scoring versions. All ten change from true
to false.

## Checks and limits

Regression tests cover repeated IDs in both provider formats, exclusion of tool
and child text, failed-turn retention, both drivers' saved per-turn results,
and replay preservation of input files and earlier outputs. No host CLI runs
are needed for these harness tests.

The affected offline suites passed: acceptance dialogue (12 tests), phase context
(10), retained replay (2), and review-order evidence (12). `git diff --check`
passed. The full repository suite was not rerun for this harness-only change.

Replay checks communication only. It does not rerun semantic review, execution,
instruction loading or other live gates. The Codex initial technical narration
and Claude repository-instruction loading findings remain separate follow-ups.
This change makes the bench detect the first issue; it does not fix plugin
behavior or establish token savings.
