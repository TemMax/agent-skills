# GPT-6 Astra reviewer evidence dossier

Reviewed 2026-09-07. Exact-ID profile available; production review accuracy
and effort guidance remain uncalibrated. This plugin installs independently
of orchestration, so its review evidence is retained here.

## Sources and their limits

- [System Card PDF](https://deploymentsafety.openai.com/gpt-6-astra/gpt-6-astra.pdf),
  published 3 September 2026: Coding Deception (section 8.3.1, pp. 26–27)
  improves over Sol, but does not measure defect detection. AutoReview
  (section 8.2.1) measures respect for denials, not judging competence.
  Reasoning monitorability limitations in section 9 reinforce artifact checks.
- [Model guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra):
  sensitivity to skills, clarification pauses, and over-testing motivate
  explicit review scope and a proportionate stopping condition.
- [Model reference](https://developers.openai.com/api/docs/models/gpt-6-astra):
  establishes the exact ID and supported API efforts, not reviewer quality.

## Review hypothesis

Test Astra as the active critical-review seat on clean and planted-defect
changes, retaining precise findings, unavailable checks, and approval gates.
Keep `medium` and `high` separate in results. Neither a capability benchmark
nor one successful review qualifies a consequential reviewer.

No measured self-preference, false-positive/negative rate, or best effort for
this plugin was found in these sources. GPT-5.6-only calibration cannot be
inherited by Astra. Preserve raw failures and manually adjudicate scorer
disagreements; formatting compliance and finding a real bug are separate facts.

The repository's `tests/eval/gpt-6-astra-pilot-2026-09-07.md` records one clean
pass and one correctly identified planted defect rejected by the frozen scorer's
wording match. The raw fail is retained; this pilot does not qualify the reviewer.
