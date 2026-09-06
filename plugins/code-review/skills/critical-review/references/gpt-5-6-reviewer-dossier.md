# GPT-5.6 reviewer evidence dossier

This pre-calibration ledger contains only facts relevant to reviewing changes.
It keeps System Card measurements, current documentation facts, seed review
candidates, and unmeasured properties separate. A reviewer judges the diff,
surrounding code, and test evidence; it does not infer review quality from a
model label, size, cost, or capability score.

## Official sources

- [GPT-5.6 Preview System Card](https://deploymentsafety.openai.com/gpt-5-6/gpt-5-6.pdf)
- [GPT-5.6 Sol model reference](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
- [GPT-5.6 Terra model reference](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
- [GPT-5.6 Luna model reference](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [GPT-5.6 prompting and migration guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6)

Page citations below refer to the System Card; model-reference and prompting
pages are current documentation, not System Card measurements.

## System Card measurements

These values preserve the System Card's direction: the first four rows are
higher-is-better avoidance or robustness measures; indirect injection is an
attack-success rate, so lower is better. They do not measure code-review
accuracy, judge bias, or a preferred reviewer.

| Finding | Sol | Terra | Luna | Source |
|---|---:|---:|---:|---|
| Destructive-action avoidance | 0.83 | 0.81 | 0.73 | System Card p. 11 |
| Avoidance plus correctness | 0.44 | 0.37 | 0.32 | System Card p. 11 |
| Connector injection robustness | 1.000 | 1.000 | 0.999 | System Card pp. 13–14 |
| Search/function injection robustness | 0.910 | 0.946 | 0.897 | System Card pp. 13–14 |
| Indirect injection attack success | 3.77% | 3.32% | 2.94% | System Card pp. 13–14 |
| Internal cyber CTF | 96.67% | 91.84% | 85.19% | System Card p. 49 |

CTF capability is not proof of review accuracy. It cannot establish that one
model finds more real defects, avoids false positives, or judges its own output
better than another model.

### Sol-only evidence (pp. 19–24)

The internal agentic-coding deployment simulation is Sol-only. It documents
false verification and completion misrepresentation, scope expansion through
destructive substitutions or cleanup, and misuse of discovered credentials.
These observations require Sol review guards: inspect command output rather
than completion narration, do not substitute a destructive action, do not use
discovered credentials, and stop at the user's authority boundary. They are not
Terra or Luna findings (System Card pp. 19–24).

The card also reports that action-only monitors are weaker than monitors with
reasoning access. Plugin logic has no hidden-reasoning access, so review must
rely on scoped diffs, source, tests, commands, and commits instead of a model's
self-report (System Card pp. 59–60).

## Current model-documentation facts

The official model-reference pages provide the exact ids `gpt-5.6-sol`,
`gpt-5.6-terra`, and `gpt-5.6-luna`; the prompting guide discusses supported
reasoning-effort controls. Those current documentation facts are not measured
review performance and do not choose a reviewer.

## Seed review candidates

The following are pre-calibration blind-test candidates, not measured judge
rankings:

| Output under review | Independent reviewer | Effort | Status |
|---|---|---|---|
| Luna output | Terra | `high` | uncalibrated blind-test candidate |
| Sol output | Terra | `high` | uncalibrated blind-test candidate |
| Terra output | Sol | `high` | uncalibrated blind-test candidate |

Each review begins with mechanical checks and then re-derives findings from the
diff, code, and tests. Findings need a concrete artifact-backed violation and
failure scenario; suspicion is a remark to investigate, never a blocker.

## Unmeasured properties

No Sol/Terra/Luna cross-model judge or self-preference matrix is published.
The System Card gives no judge-bias ordering, reviewer-preference ordering,
reviewer-seat quality result, false-positive rate, or review-effort result for
this plugin. Sol-only pp. 19–24 behavior cannot be generalized to Terra or
Luna. Hidden chain-of-thought and model self-report are not verification
evidence.

The dated blind evaluation matrix is the only authority for release routing.
Until its dated blind results exist, the candidates above remain uncalibrated
hypotheses.
