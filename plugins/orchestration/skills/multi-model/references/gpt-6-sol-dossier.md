# GPT-6 Sol orchestration evidence dossier

Reviewed 2026-09-23. Evidence status: exact-ID Appendix A evidence in the
GPT-6 Astra System Card; production reliability of Sol-led routes is not yet
calibrated. Operational policy is maintained separately in
[codex-routing.md](codex-routing.md): uncalibrated reliability is not a
blanket prohibition on supervised use.

## Sources

- [GPT-6 Astra System Card, 156-page PDF](https://deploymentsafety.openai.com/gpt-6-astra/gpt-6-astra.pdf).
  Its changelog records that Appendix A, "GPT-6 Sol, GPT-6 Luna", was added
  2026-09-22 (pp. 5, 119–155).
- [Model reference](https://developers.openai.com/api/docs/models/gpt-6-sol),
  read 2026-09-23.
- Artificial Analysis, 2026-09-22:
  [article](https://artificialanalysis.ai/articles/gpt-6-sol-and-luna-push-the-cost-efficiency-frontier)
  and [model page](https://artificialanalysis.ai/models/releases/gpt-6-sol).

The PDF's numbered pages are used below. Measurements from one setup cannot
be compared directly with similarly named scores in another provider's card.

## System Card measurements

Preparedness classifies GPT-6 Sol High in Cybersecurity and Biological/
Chemical, below High in AI Self-Improvement, with the same safeguards as
GPT-5.6 Sol (pp. 119, 143). All alignment rows below are measured at `max`
effort on OpenAI's 2026-09-22 updated evaluation versions (pp. 127–131);
the GPT-5.6 Sol and GPT-6 Astra columns are the card's own comparison
figures, not independently rerun here.

| Measurement | GPT-6 Sol | GPT-5.6 Sol | GPT-6 Astra | Direction and source |
|---|---:|---:|---:|---|
| Coding Deception at `max` | 1.30% | 10.41% | 0.51% | Lower is better; updated evaluation, p. 130 |
| Broken Search Tool failure at `max` | 4.92% | 77.46% | 1.50% | Lower is better; updated evaluation, p. 131 |
| Circumventing an Auto-review denial at `max` | 0.0% | 7.3% | 0.0% | Lower is better; updated evaluation, pp. 127–128 |
| Fails to stop at an environment warning at `max` | 64.4% | 68.2% | 17.4% | Lower is better; "a modest reduction," low-stakes with no system-level controls, p. 128 |
| Performed the specified unauthorized action after engaging an external agent message | 11.25% | 51.90% | 0% | Lower is better; among samples that found the board, engaged 26.25% (GPT-5.6 Sol 83.54%, Astra 26.92%), pp. 131–132 |
| Indirect prompt-injection defender success | 99.050% | 96.227% | 99.789% | Higher is better; p. 124 |
| Instruction-hierarchy success | 99.97% | — | 99.99% | Higher is better; p. 124 |

GPT-6 Sol made no attempt at the ExploitGym honeypot (p. 129). It also shows
substantially higher static and multiturn jailbreak defense than GPT-5.6 Sol
(pp. 122–123), substantially fewer factual errors than GPT-5.6 Sol especially
at low latency/reasoning settings (p. 126), and roughly a 45% drop in mean
HealthBench answer length (p. 125). CoT controllability is 23.2% for CoTs of
750–1,250 tokens, versus GPT-5.6 Sol's 16.1% and Astra's 60.9% (p. 136); Sol
is worse than Astra at evading CoT-only monitors, and monitors with the full
trajectory reach near-zero successful evasion (pp. 139–141). These are
experimental rates, not production incidence, and the plugin cannot inspect
hidden reasoning; preserve action and artifact checks regardless.

## Sol-only deployment simulation

The card's Codex internal-traffic deployment simulation covers Sol only,
across 50,319 matched tasks (pp. 132–135):

- Severity ≥3 flags: 42 (0.083%) vs GPT-5.6 Sol 66 (0.131%) vs Astra 29
  (0.058%); no severity-4 flag.
- Severity 1–2 flags: 14.80% of tasks vs GPT-5.6 Sol 19.67%; largest
  decreases in ignoring instructions, concealed uncertainty, and deception,
  while exfiltration flags increased (severity 1–2: 0.433% vs 0.064%).
- Evaluation awareness in CoT: 4.76% vs GPT-5.6 Sol 2.56% (Astra 8.83%).

Not run for Astra or Luna at this scale; do not generalize its deltas.

## Capability evidence, not route qualification

Regressions versus GPT-5.6 Sol: Internal Research Debugging 64.20% vs
68.32% (Astra 78.05%, p. 151); KernelGen 1P 38.12% vs 61.08% (p. 152).
Cyber: ExploitBench 81.7% at `max` (p. 146), ExploitBench-Internal Port
5.5% vs Astra 31.5% (p. 146), SEC-Bench Pro 66.3% (p. 147), ExploitGym
22.1% (p. 148), SandboxBench 1/22 (p. 150). Benign biology over-refusal
avoidance 0.964 vs GPT-5.6 Sol 0.989 (p. 153).

Independent measurement (Artificial Analysis, 2026-09-22): Intelligence
Index 48 at `max`, level with GPT-5.6 Sol; by effort max/xhigh/high/medium/
low/none = 48/44/43/40/34/28, at $1.06/$0.53/$0.37/$0.25/$0.13/$0.33 per
index task (GPT-5.6 Sol $1.99 at its measured effort). Coding Agent Index
57 (+2). Terminal-Bench 4.0 43% (GPT-5.6 Sol 37%). SWE-Atlas-QnA 58% (54%).
AA-Omniscience hallucination rate 60% (92%). GDPval-AA about 100 Elo lower.

These are capability and cost benchmarks, maxima or effort curves from
third-party or research harnesses. They motivate testing, not a production
effort choice or a judging claim, and the debugging/kernel regressions above
mean higher capability elsewhere is not a blanket improvement.

## Current documentation facts

The exact ID is `gpt-6-sol`, described as "built for complex coding and
agentic workflows." Standard API prices per million tokens: $2 input, $0.20
cached input, $2.50 cache writes, $10 output. Context is 1,050,000 tokens,
max input 922,000, max output 128,000. Documented reasoning effort values are
`none`, `low`, `medium` (default), `high`, `xhigh`, and `max`. Knowledge
cutoff is April 20, 2026.

Codex CLI 0.155.1 gives this model the host instruction "You are Codex, an
agent based on GPT-6," identical to the instruction given to Astra and Luna
(verified 2026-09-23). The bare host phrase "GPT-6" therefore cannot select
this profile; only the exact ID `gpt-6-sol` can.

## Routing hypotheses and limits

`codex-routing.md`'s task table does not yet name Sol. A candidate route,
following the same shape as its existing Terra/Sol tiers, would run ordinary
tasks on `gpt-6-sol`/`medium`, difficult tasks on `gpt-6-sol`/`high`, and use
`gpt-6-sol` as an optional ladder target for a `gpt-6-luna` initial executor.
This is a hypothesis for future routing policy, not an active route; adopting
it requires updating `codex-routing.md` itself under its own review, and
until then the shared table governs.

## Unmeasured properties

No source here measures GPT-6 Sol's self-preference as a reviewer or judge.
No local calibration run exists for this model in this plugin: no wave, no
supervisor pairing, no drift-hook role, and no consequential-review role
have been tested. System Card and Artificial Analysis scores describe the
model in isolation, not any of this plugin's roles for it.
