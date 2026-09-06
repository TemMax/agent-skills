# 004 — Blind fixture adjudication and bounded evaluation claims

## Status

Accepted. Stable fixture contracts live beside fixtures; dated calibration
remains a separate evidence record.

## Context

A prompt author's fixtures test imagined failures and can miss the author's
blind spots. An author adjudicating disagreements can then protect the prompt
by moving the expected answer. Green plumbing tests cannot show that a model
detects drift or rejects a bad implementation.

## Decision

Fix scenario inputs, expected outcomes, and scoring before exposing them to the
prompt under test. Use adversarial authors without prompt-authoring context and
ask for likely failures. Keep model judgments blind to executor identity; a
different judge and concealed identity reduce bias but do not prove neutrality.

Adjudicate disagreements under these rules:

1. Count disagreement as a finding against the prompt by default.
2. Reject an adversary's expectation only by citing the prompt text that
   explicitly prescribes the other behavior; plausibility is insufficient.
3. Keep ambiguous cases as open questions rather than scoring coin flips.
4. Record failed fixtures even if the defect will not be fixed.
5. Never soften a fixture to make the prompt pass. Explain any replacement or
   rejection, and retain the first failure before rerunning.

After a prompt change, rerun the whole relevant adversarial set. In particular,
a false-positive fix must face every true-positive case: a window rule must
allow legitimate prior completion without accepting injected or contradictory
completion claims. A recorded cancellation must respect the plan's authority
rule. For supervision, reproducibility and satisfiability are evidence fields
with deterministic consequences, not accusations or consequence-free remarks.

Keep three kinds of evidence distinct:

- Deterministic offline checks cover structure, contract pins, hook behavior,
  state transitions, simulator fidelity, and fixture/harness boundaries. Prose
  assertions catch missing rules, not every incorrect interpretation. Simulated
  agents test shipped control flow, not live model behavior.
- Live evaluations measure named model/effort behavior on fixed cases. Include
  both true positives and clean guards: an always-quiet drift checker or an
  always-accepting supervisor must fail. A single success establishes that a
  case can pass, not its reliability. Repetition and all required guard results
  are necessary for production-route claims.
- Dated calibration records preserve exact runs, limitations, usage/cost where
  observed, and unsupported routes. Supporting rows do not inflate core skill
  coverage or qualify an otherwise failing route. The GPT-5.6 result report and
  model dossiers remain the evidence ledger; do not copy their counts into ADRs.

The default test command stays offline. Live matrix runs use explicitly selected
provider/model/effort settings and fresh result directories; a nonempty result
directory is rejected so failures are not overwritten. Evidence includes exact
prompts, answers, classifications, process status, and available action artifacts.
Score authoritative captured actions and verifier/state evidence, not the model's
assertion that it spawned, tested, pushed, or abstained. Harness self-tests and
immutable input capture are part of the trust boundary. Missing native tools,
malformed evidence, and infrastructure failures cannot become successful cells.

## Consequences

A failing adversarial run can be useful evidence rather than a release narrative
to erase. Fixtures remain bounded: simulated GitHub writes do not establish live
permissions, native-host acceptance needs a real host probe, and safety fixtures
do not test real destructive infrastructure. Live calls can be costly and remain
separate from routine offline verification. Fixture provenance and dated results
must make these limits clear.

## Implementation anchors

- [Test tiers and invocation](../../tests/README.md) and [offline entry point](../../tests/run.sh).
- [Drift expectations](../../tests/eval/fixtures/drift/EXPECTATIONS.md) and
  [supervisor expectations](../../tests/eval/fixtures/supervisor/EXPECTATIONS.md).
- [Live provider adapter](../../tests/eval/model-cli.sh),
  [GPT matrix](../../tests/eval/gpt-5-6-matrix.sh), and
  [dated calibration](../../tests/eval/gpt-5-6-results-2026-09-04.md).
- [Workflow simulator](../../tests/lib/workflow-sim.mjs),
  [live wave boundary](../../tests/eval/wave.sh), and
  [in-session wave record](../../tests/eval/wave-insession.md).
