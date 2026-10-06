# Quiet local review follow-up — 2026-10-06

The final frozen candidate passed the local-review case in both real hosts:
Claude Code 2.1.291 and Codex with native candidate plugin loading. Each found
both semantic defects (README/CI timeout and removed negative-input guard,
despite 41 green tests), completed the required ordered profile/phase reads,
and retained read-only scope. Every user-facing message passed the stricter
communication check. Final plugin/skill bytes still match the frozen native
candidate. [Machine evidence and accounting](quiet-native-memory-results-2026-10-06.json).

## Final behavior

The critical-review entrypoint now defines a positive message structure: opening
names the review comparison, required instruction/profile reads form internal
preparation, the next update reports a code observation/check/blocker, and the
final result reports findings/evidence. Routing, identity and calibration guards
remain. Both host entrypoints receive this same contract.

Claude's packaged mod also supplies ancestor AGENTS.md files through the native
memory loader (`prompt.context` and `$.fs.ancestors`). It preserves existing
instructions, permission handling, imports and root-first order, and deduplicates
paths across both plugins. Unknown provenance or unavailable/denied reads retain
manual discovery fallback. Flattened imports supply no direct importer, so no
parent metadata is invented. Codex keeps its existing classic-only hooks.

The native fixture now enables only its owned project settings instead of
`--setting-sources ''`. Empty sources disabled project memory: the diagnostic
log explicitly said `project memory is off`. That first expensive semantic run
could have been avoided by checking transport delivery first. Claude's actual
owned transcript is retained; the evaluator recognizes its native instruction
attachment only with the exact file path and complete body before the first
assistant. An assistant claim, partial body, wrong path or late attachment fails.

## Paid attempts retained

| Attempt | Tokens including cache | Reported Claude USD | Result |
| --- | ---: | ---: | --- |
| Initial memory adapter, project memory disabled | 231,819 | 0.1399104 | Fail; narrated loading review methodology |
| Short native delivery diagnostic | 7,096 | 0.014887 | MISSING; isolated disabled project memory |
| Native memory + user-context policy | 267,452 | 0.1555496 | AGENTS delivered; narration still failed |
| Native memory + system policy | 266,097 | 0.1492454 | System policy delivered once; narration still failed |
| Final positive contract, Claude | 219,949 | 0.142436 | All checks passed |
| Final positive contract, Codex | 195,477 | — | All checks passed |

Aggregate: **6 native invocations, 1,187,890 tokens including cache,
$0.6020284 reported Claude cost**. Limits were extended explicitly after
investigation; every new ledger copied all prior attempts, with no reset. Final
cap: 6 invocations / 1,300,000 tokens / $0.80 Claude / 150 seconds per invocation.
These figures exclude editing/reviewer sessions; no Codex dollar cost is inferred.

The initial communication scorer incorrectly accepted “Загружаю методику ревью”.
Three regressions reproduced the hole and tightened scoring; original results
and corrected replay are both retained. User-context and system-policy prototypes
were rejected and are absent from the product. Answers were never filtered.

Local sources/traces/expectations and ledgers:

- `/private/tmp/quiet-native-memory-20261006`
- `/private/tmp/quiet-native-memory-v2-20261006`
- `/private/tmp/quiet-native-memory-v3-20261006`
- `/private/tmp/quiet-native-memory-v4-20261006`

## Free validation and limits

Full offline suite completed successfully during the investigation. Later final
changes receive focused reruns: Node runtime/context behavior, native plugin kit,
acceptance/phase evidence, disclosure, routing, runtime contracts and structure.
Final focused results: Node 14/14, native kit 12/12, acceptance 18/18, phase 12/12,
routing 143/143, runtime contracts 64/64, structure 125/125 and disclosure passed.
Independent bounded rechecks found no remaining product issues after correcting
import provenance. The native evidence and style changes have failing-first tests.

The disclosure baseline intentionally replaces one amended communication
paragraph fingerprint per host; every other policy fingerprint is retained.
The entrypoint size cap moves from 7 KB to 7.5 KB to fit the live-tested positive
contract (7,120 / 7,325 bytes), rather than changing tested instruction bytes
again. It remains bounded; semantic and communication gates are not relaxed.

There is one final sample per host, not a reliability estimate across arbitrary
models/prompts. This proves the named case, not unchanged overall quality or
measured token savings. Exact child identity/per-request effort remain outside
this adapter; lifecycle context stays conservatively unknown for them. Normal
installed loading must still be verified after an authorized merge and Git-only
updates. Installed user plugin files have not been changed.
