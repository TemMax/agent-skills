# GPT-6.1 Sol reviewer evidence dossier

Reviewed 2026-09-29. Card evidence only — not review-accuracy evidence. This
plugin installs independently of orchestration, so its review evidence is
retained here.

## Sources and their limits

- [Addendum: GPT-6.1 Sol System Card, 45-page PDF](https://cdn.openai.com/pdf/38e3efcf-545e-44cd-99ec-2b7eb395f4cc/oai_GPT_6_1_Sol.pdf),
  OpenAI, 2026-09-29. Coding Deception (p. 17) and Broken Search Tool
  (p. 18) measure honesty about coding work and tool-failure handling on
  adversarial tasks, not defect-detection accuracy. The Codex deployment
  simulation (pp. 21–24) is production telemetry, not a review benchmark.
  The card is an addendum: it refers to the GPT-6 Astra card for every
  evaluation description and reports no coding or agentic capability
  benchmark (no SWE-bench, Terminal-Bench, OSWorld).
- [Model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol),
  read 2026-09-29: establishes the exact ID `gpt-6.1-sol` and the
  documented effort values. A local Codex CLI 0.159.0 probe on 2026-09-29
  showed the host instruction gives the same bare "GPT-6" family phrase as
  Astra, Sol and Luna. None of this measures reviewer quality.

## Review-relevant measurements

- Coding Deception: 1.50% (GPT-6 Sol 1.30%, GPT-6 Astra 0.51%, p. 17).
  Higher than both; a rate of misleading claims, not bug-finding accuracy.
- Broken Search Tool failure to acknowledge: 2.08% (GPT-6 Sol 4.92%,
  p. 18). Relevant to whether it reports an unavailable check instead of
  fabricating a result.
- Codex deployment simulation, severity 1–2 flags (p. 23): concealed
  uncertainty 0.429% (GPT-6 Sol 0.717%, Astra 0.369%); reward hacking
  0.141% (GPT-6 Sol 0.151%, Astra 0.075%).
- Longer answers than GPT-6 Sol, e.g. HealthBench 1,701 vs 977 characters
  (p. 10) — a reviewer must still answer every checklist item.

## Review hypothesis

Unmeasured. No dated local strict-gate run exists for GPT-6.1 Sol. A dated
strict-gate run — clean and planted guards at 5/5 in repeated runs, plus PR
support — is required before any supported claim. GPT-6 Sol's calibration
cannot be inherited, and the card does not measure self-preference or a
false-positive/negative rate for this plugin's checklist.
