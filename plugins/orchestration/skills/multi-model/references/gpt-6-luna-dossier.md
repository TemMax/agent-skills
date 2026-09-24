# GPT-6 Luna orchestration evidence dossier

Reviewed 2026-09-23. Evidence status: exact-ID integration and capability
comparison against GPT-5.6 Luna; no production reliability or route
calibration exists for any GPT-6 Luna orchestration role.
Operational policy is maintained separately in [codex-routing.md](codex-routing.md):
uncalibrated reliability is not a blanket prohibition on supervised use.

## Sources

- [GPT-6 Astra System Card PDF, 156 pages](https://deploymentsafety.openai.com/gpt-6-astra/gpt-6-astra.pdf);
  Appendix A "GPT-6 Sol, GPT-6 Luna" added 2026-09-22 (pp. 5, 119–155)
- [Model reference](https://developers.openai.com/api/docs/models/gpt-6-luna), read 2026-09-23
- [Artificial Analysis, "GPT-6 Sol and Luna push the cost-efficiency frontier", 2026-09-22](https://artificialanalysis.ai/articles/gpt-6-sol-and-luna-push-the-cost-efficiency-frontier)

The PDF's printed pages are used below. Measurements from one setup cannot
be compared directly with similarly named scores in another provider's card,
and independent benchmark scores are not the System Card's own evaluations.

## System Card measurements

| Measurement | GPT-6 Luna | GPT-5.6 Luna | Direction and source |
|---|---:|---:|---|
| Coding Deception at `max`, updated evaluation | 2.81% | 9.54% | Lower is better; p. 130 |
| Broken Search Tool failure at `max` | 28.67% | 78.25% | Lower is better; updated evaluation, p. 131 |
| Auto-review bypass attempt (never succeeded, either model) | 0.3% | 4.3% | Lower is better; pp. 127–128 |
| Fails to stop at an environment warning | 42.4% | 76.5% | Lower is better; p. 128 |

Preparedness is High in Cybersecurity and Biological/Chemical, below High in
AI Self-Improvement (pp. 119, 143). ExploitGym honeypot: no attempt observed
for GPT-6 Luna, against GPT-5.6 Luna attempting 19.7% and succeeding 9.9%
(p. 129). Indirect prompt-injection defender success is 98.605% against
96.227% for GPT-5.6, and instruction hierarchy holds at 99.97% (p. 124);
jailbreak defense improved, but "some of its higher scores may reflect a
broader tendency to refuse requests, including legitimate ones" (p. 123).
External agent messages: no engagement and no unauthorized action, but board
discovery landed at 76% against 96% or higher for other models (pp. 131–132).
Hallucination: fewer factual errors than GPT-5.6 Luna, with HealthBench
answers about 35% shorter on average (pp. 125–126).

These are experimental rates, not production incidence. Auto-review measures
the acting model's respect for a gate, not its ability to serve as the
gate's judge. Zero observed successes is not a guarantee.

## Capability evidence, not route qualification

The System Card records Internal Research Debugging at 46.62% against
GPT-5.6 Luna's 50.8% (p. 151), KernelGen 1P at 21.83% against 22.4%
(p. 152), ExploitBench at 43.4% at `max` (p. 146), ExploitBench-Internal
Port at 0% (p. 146), SEC-Bench Pro at 34.2% (p. 147), and ExploitGym at
11.6% (p. 148).

Artificial Analysis (2026-09-22) reports an Intelligence Index of 37 at
`max`, identical to GPT-5.6 Luna, at $0.07 per index task against GPT-5.6
Luna's $0.18; a Coding Agent Index of 41, two points below GPT-5.6 Luna;
Terminal-Bench 4.0 at 13% against 12%; SWE-Atlas-QnA at 44% against 49%;
DeepSWE v1.1 at 64% against 66%; an AA-Omniscience hallucination rate of 77%
against 93%; output tokens averaging 51k against 41k; and GDPval-AA about 75
Elo lower and AA-Briefcase about 45 Elo lower than GPT-5.6 Luna.

These scores are maxima across effort levels and use research/benchmark
harnesses, not this plugin's roles. They motivate scoping Luna to narrow,
low-stakes tasks; they establish neither a production effort nor superior
judgment or coding-agent capability.

## Current documentation facts

The exact ID is `gpt-6-luna`; the model page describes it as "our most
efficient model for focused, high-volume tasks." The API lists effort
values `none`, `low`, `medium` (default), `high`, `xhigh`, and `max`, a
1,050,000-token context, a 922,000-token maximum input, and a 128,000-token
maximum output. Knowledge cutoff is May 18, 2026. Actual host availability
and accepted effort values must be checked at invocation. An unknown session
effort stays unknown.

Standard API prices per million tokens are $0.10 input, $0.01 cached input,
$0.125 cache writes, and $0.50 output. These API prices are not a conversion
of ChatGPT subscription percentages; preserve measured usage separately.

Codex CLI 0.155.1's host instruction reads "You are Codex, an agent based on
GPT-6." — identical to the Astra and Sol instructions (verified 2026-09-23).
The host instruction does not itself establish role suitability.

## Routing hypotheses and limits

No production Luna orchestration, executor, or supervisor route is
calibrated. The mechanical starting point is `gpt-6-luna` at `medium`, with
an optional ladder up to `gpt-6-sol` for tasks the initial tier cannot
close; see [codex-routing.md](codex-routing.md) for the governing selection
policy. This dossier does not itself authorize a route: it records
capability and alignment evidence, not a tested pairing.

Coding Deception, Broken Search Tool failure, auto-review bypass attempts,
and the environment-warning stop rate all improved over GPT-5.6 Luna, but
improvement on these evaluations is not evidence of production reliability
for any consequential role. Neither this card nor the GPT-5.6 regression
measures Luna in this plugin's exact pairings, planner quality, review false
positives/negatives, self-preference, or a best effort curve. A production
claim needs dated results for the named role, effort, prompts, and both
clean and failing cases. Preserve failures and usage gaps; discovery,
offline validation, and single passes are insufficient.

## Unmeasured properties

CoT controllability is explicitly omitted for Luna (p. 136). The internal
Codex deployment simulation is a Sol-only evaluation (pp. 132–135) and is
not a Luna finding. Judge bias, self-preference, and a qualified
orchestrator or reviewer role for Luna are not established by any source in
this dossier.
