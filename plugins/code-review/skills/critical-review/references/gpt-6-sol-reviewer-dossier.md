# GPT-6 Sol reviewer evidence dossier

Reviewed 2026-09-23. Exact-ID appendix evidence only; production review
accuracy and effort guidance remain uncalibrated. This plugin installs
independently of orchestration, so its review evidence is retained here.

## Sources and their limits

- [GPT-6 Astra System Card, 156-page PDF](https://deploymentsafety.openai.com/gpt-6-astra/gpt-6-astra.pdf).
  Appendix A, "GPT-6 Sol, GPT-6 Luna," was added 2026-09-22 (pp. 5,
  119–155). Coding Deception (p. 130) and Broken Search Tool (p. 131)
  measure honesty about coding work and tool-failure handling on
  adversarial tasks, not defect-detection accuracy. The Codex deployment
  simulation (pp. 132–135) covers Sol only and is production telemetry,
  not a review benchmark.
- [Model reference](https://developers.openai.com/api/docs/models/gpt-6-sol),
  read 2026-09-23: establishes the exact ID, documented effort values, and
  that the Codex CLI host instruction does not distinguish Sol from Astra
  or Luna — none of this measures reviewer quality.

## Review-relevant measurements

- Coding Deception at `max`: 1.30% (GPT-5.6 Sol 10.41%, GPT-6 Astra 0.51%,
  p. 130). Lower misleading-claim behavior, not higher bug-finding
  accuracy.
- Broken Search Tool failure at `max`: 4.92% (GPT-5.6 Sol 77.46%, Astra
  1.50%, p. 131). Relevant to whether Sol reports an unavailable check
  instead of fabricating a result.
- Codex deployment simulation, Sol only, 50,319 matched tasks (pp.
  132–135): severity ≥3 flags 0.083% vs GPT-5.6 Sol 0.131% (Astra
  0.058%); severity 1–2 flags 14.80% of tasks vs 19.67%, with decreases in
  ignoring instructions, concealed uncertainty, and deception, but an
  increase in exfiltration flags (0.433% vs 0.064%).
- Hallucination: substantially fewer factual errors than GPT-5.6 Sol,
  especially at low latency/reasoning settings (p. 126).
- Shorter answers: mean HealthBench answer length fell ~45% versus GPT-5.6
  Sol (p. 125) — a reviewer must still answer every checklist item.

## Review hypothesis

Sol is a candidate for a bounded reviewer role, comparing `medium` and
`high` results separately, the same way GPT-5.6 Sol was tested before its
route existed. No clean/planted-defect evaluation has been run for this
model in this plugin: no local calibration exists. Neither a capability
benchmark nor a single successful review qualifies a consequential
reviewer. GPT-5.6-only calibration cannot be inherited by Sol, and this
card does not measure self-preference or a false-positive/negative rate
for this plugin's checklist.
