# GPT-6 Luna reviewer evidence dossier

Reviewed 2026-09-23. Exact-ID identification only; no reviewer-role
calibration exists for GPT-6 Luna. This plugin installs independently of
orchestration, so its review evidence is retained here.

## Sources and their limits

- [GPT-6 Astra System Card PDF, 156 pages](https://deploymentsafety.openai.com/gpt-6-astra/gpt-6-astra.pdf);
  Appendix A "GPT-6 Sol, GPT-6 Luna" added 2026-09-22 (pp. 5, 119–155).
  Coding Deception (p. 130) and auto-review bypass attempts (pp. 127–128)
  measure the acting model's own honesty and respect for a gate, not its
  ability to judge someone else's work. Reduced HealthBench answer length
  (p. 125) and fewer factual errors (p. 126) are quality signals for Luna's
  own output, not for review accuracy.
- [Model reference](https://developers.openai.com/api/docs/models/gpt-6-luna),
  read 2026-09-23: establishes the exact ID, effort values, and pricing, not
  reviewer quality.
- [Artificial Analysis, 2026-09-22](https://artificialanalysis.ai/articles/gpt-6-sol-and-luna-push-the-cost-efficiency-frontier):
  coding-agent and capability indices, not review-task evaluations.

## Review-relevant measurements

Coding Deception at `max` fell to 2.81% (GPT-5.6 Luna 9.54%, p. 130).
Auto-review bypass attempts fell to 0.3%, never succeeding (GPT-5.6 Luna
4.3%, also never succeeding, pp. 127–128). Failing to stop at an
environment warning fell to 42.4% (GPT-5.6 Luna 76.5%, p. 128). Indirect
prompt-injection defender success is 98.605% against 96.227% for GPT-5.6,
with instruction hierarchy at 99.97% (p. 124); jailbreak defense improved,
but "some of its higher scores may reflect a broader tendency to refuse
requests, including legitimate ones" (p. 123), which bears directly on a
reviewer's willingness to engage with a legitimate change.

None of these figures measures defect detection, false-positive or
false-negative rate, or self-preference against another model's work.

## Review hypothesis

Luna is not a consequential reviewer candidate on this evidence. At most,
it can run a bounded, mechanical pre-check: collecting the diff, running
prescribed commands, and flagging missing evidence for a stronger reviewer.
Any such pre-check route is uncalibrated: no clean/planted-defect pass
rate, no supervisor pairing, and no best effort has been measured for Luna
in this plugin. Neither a capability benchmark nor an improved alignment
number qualifies Luna to render final review judgment.
