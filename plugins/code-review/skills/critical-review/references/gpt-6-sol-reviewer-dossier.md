# GPT-6 Sol reviewer evidence dossier

Reviewed 2026-09-23; local review counts re-measured 2026-09-24. Exact-ID
appendix evidence is card evidence only — not review-accuracy evidence — and
effort guidance beyond `medium` remains uncalibrated. This plugin installs
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

A 2026-09-24 local re-measure cleared the strict review gate twice at
`medium` effort (clean 10/10, planted 10/10 combined) with PR support 3/4,
one withheld-case miss; see `reviewer-gpt-6-sol.md` for the dated counts
and the PR-support caveat. `high` and other efforts remain untested and
uncalibrated. Neither this local measurement nor a capability benchmark
alone qualifies an unconditional consequential reviewer — the PR-support
caveat still applies. GPT-5.6-only calibration cannot be inherited by Sol,
and the System Card does not measure self-preference or a
false-positive/negative rate for this plugin's checklist.
