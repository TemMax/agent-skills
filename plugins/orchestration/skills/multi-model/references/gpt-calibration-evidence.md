# GPT calibration: scope and limitations

The September 4–5, 2026 report evaluated workflow protocols, with two core
success/failure cells each for super-plan, native wave, critical-review and ship.
The final post-fix run used commit `b3bbc8f76bb40bba10a1fb32203fceea171988e8`.
At `medium`, default passed 63/87 and critical passed 162/204. Core scores were
Sol 2/8, Terra 0/8, Luna 1/8 (default), and 0/8, 1/8, 1/8 (critical base).
Ship was 0/2 for each model in both bases. The report classified no final row as
an infrastructure failure; the remaining semantic/fixture-contract failures
must not be relabelled as passes.

The tested responsibilities included planning artifacts, native action proof,
commits, exact command evidence, review output structure, integration and
publication order, safety boundaries and supervisor false positives. The ship
fixture used a division guard, a disposable bare origin and fake gh, with an
explicit integration → fixture review → push → PR event contract. It was not a
measurement of general coding aptitude or a full production GitHub delivery.
Failure classes included missing local commits, unverified native actions,
missing fresh command evidence and invalid finding rows. Some earlier defect
answers identified the defect but failed the evidence contract.

Critical repeated review clean/defect scores were Sol 5/5 and 1/5, Terra 1/5
and 2/5, Luna 2/5 and 1/5. Each model passed supervisor support 8/8 and the
destructive-scope and unavailable-verifier guards 5/5 each. These observations
inform role choice and verification; they neither certify a route nor prove
that those models cannot implement a bounded task under an Astra reviewer.
Historical higher-effort probes were sparse and not rerun in the final matrices.
No Astra-led executor/supervisor pairing was tested by these GPT-5.6 matrices.

## Why the blanket gate appeared

The report's release criterion required every applicable core path to pass.
Commit `45a4dea` converted failure to meet that criterion into an unsupported
production-route instruction; `07131e0` retained it after the final rerun.
The final-calibration contract test explicitly required every GPT route to stay
unsupported. This conflated workflow release qualification with permission to
assign a narrower executor role. Astra's later candidate profile did not clearly
override that shared authoring veto. The current [routing policy](codex-routing.md)
replaces the veto while preserving the historical scores and safety controls.

## Evidence availability

Repository source: `tests/eval/gpt-5-6-results-2026-09-04.md`, with fixture code
in `tests/eval/gpt-5-6-matrix.sh`, `super-plan.sh`, `wave.sh`, `critical-review.sh`
and `ship.sh`. This repository-relative report is not included in the installed
2.8.0 plugin (which contains skills and hooks). This packaged summary makes the
scope and limitations available without depending on the repository checkout.

At the September 21 audit, the report's ignored `.superpowers/sdd/...` raw roots
were absent from the checkout. Counts above are report claims checked against
the retained report and fixture definitions, not a fresh audit of raw answers.
The later Astra pilot report (`tests/eval/gpt-6-astra-pilot-2026-09-07.md`) also
does not establish repeated production reliability. Missing evidence must be
reported as unavailable, never replaced with invented results or a family ban.
