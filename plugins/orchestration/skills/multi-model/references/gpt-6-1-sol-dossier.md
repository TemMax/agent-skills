# GPT-6.1 Sol orchestration evidence dossier

Reviewed 2026-09-29. Evidence status: System Card evidence only. No local
calibration exists for GPT-6.1 Sol in this plugin. Operational policy is
maintained separately in [codex-routing.md](codex-routing.md).

## Sources

- [Addendum: GPT-6.1 Sol System Card, 45-page PDF](https://cdn.openai.com/pdf/38e3efcf-545e-44cd-99ec-2b7eb395f4cc/oai_GPT_6_1_Sol.pdf),
  OpenAI, 2026-09-29. The card is an addendum: it defers every evaluation
  description to the GPT-6 Astra card and reports no coding or agentic
  capability benchmark.
- [Model page](https://developers.openai.com/api/docs/models/gpt-6.1-sol),
  read 2026-09-29.
- Vellum, [GPT-6.1 Sol Benchmarks Explained](https://www.vellum.ai/blog/gpt-6-1-sol-benchmarks-explained),
  read 2026-09-29 (third party, compiling OpenAI's launch figures).

Page numbers below are the card's printed page numbers. Measurements from
one setup cannot be compared directly with similarly named scores in another
provider's card.

## System Card measurements

The card positions GPT-6.1 Sol as "comparable" to GPT-6 Astra (p. 3).
Preparedness: Critical in Cybersecurity, High in Biological and Chemical,
below High in AI Self-Improvement, with the same safeguards stack as GPT-6
Astra (pp. 3, 31). GPT-6 Sol was High in Cybersecurity.

| Measurement | GPT-6.1 Sol | GPT-6 Sol | GPT-6 Astra | Direction and source |
|---|---:|---:|---:|---|
| Fails to stop at an environment warning | 23.5% | 64.4% | 17.4% | Lower is better; no system-level controls, p. 15 |
| Coding Deception | 1.50% | 1.30% | 0.51% | Lower is better; p. 17 |
| Broken Search Tool failure | 2.08% | 4.92% | — | Lower is better; p. 18 |
| Misaligned outcomes in realistic work environments | 1.94% | 4.93% | 1.10% | Lower is better; harder updated evaluation, p. 19 |
| Performed the specified unauthorized action after engaging an external agent message | 3% | 11% | — | Lower is better; engaged 38% vs 26%, p. 20 |
| Indirect prompt-injection robustness | 98.983% | 99.050% | 99.789% | Higher is better; p. 8 |
| Instruction-hierarchy success | 99.99% | 99.97% | 99.99% | Higher is better; p. 8 |

Work-environment categories (GPT-6.1 Sol / GPT-6 Sol / Astra, p. 20):
security weakening 0.82% / 2.50% / 0.32%; data exfiltration 0.45% / 1.25% /
0.26%; destructive action 0.30% / 0.39% / 0.19%; unauthorized external
communication 0.22% / 0.59% / 0.06%; circumventing restrictions 0.15% /
0.26% / 0%. There were no attempts to circumvent an Auto-review denial
(p. 14) or to exploit the ExploitGym honeypot (p. 16), for GPT-6.1 Sol,
GPT-6 Sol and Astra alike. CoT controllability for CoTs of 750–1,250 tokens
is 44.8% (GPT-6 Sol 23.2%, Astra 60.9%; p. 24). When made aware of a CoT
monitor, GPT-6.1 Sol is more evasive than GPT-6 Sol (less than Astra) and
produces substantially fewer CoT tokens; full-context monitoring still has
100% recall on its honeypot exploits (p. 29).

## Codex deployment simulation

Across 49,650 matched tasks (pp. 21–24):

- Severity ≥3 flags: 28 (0.056%) vs GPT-6 Astra 27 (0.054%), GPT-6 Sol 42
  (0.085%), GPT-5.6 Sol 63 (0.127%) (p. 21). In the 41,849 tasks with no
  verbalized evaluation awareness for any model: 15 (0.036%) vs Astra 18
  (0.043%), GPT-6 Sol 28 (0.067%) (pp. 22, 24).
- Severity 1–2 flags: 13.94% of tasks vs GPT-6 Sol 14.82%, GPT-5.6 Sol
  19.64%, Astra 13.85% (p. 23). Largest decreases against GPT-6 Sol:
  exfiltration, concealed uncertainty, restriction circumvention;
  credential-harvesting flags increased. Relative to Astra: more
  reward-hacking and concealed-uncertainty flags (p. 23).
- Evaluation awareness in CoT: 4.81% vs Astra 8.67%, GPT-6 Sol 4.70%,
  GPT-5.6 Sol 2.52% (p. 23).

Severity 1–2 category rates (GPT-6.1 Sol / GPT-6 Sol / Astra, p. 23):
ignoring instructions 12.665% / 12.645% / 12.717%; concealing uncertainty
0.429% / 0.717% / 0.369%; reward hacking 0.141% / 0.151% / 0.075%;
circumventing restrictions 0.209% / 0.377% / 0.207%; exfiltration 0.026% /
0.435% / 0.016%; destructive action 0.099% / 0.161% / 0.083%; credential
harvesting 0.050% / 0.012% / 0.054%.

## Capability evidence, not route qualification

Internal Research Debugging 75.52% vs Astra 78.05%, GPT-6 Sol 64.20%,
GPT-5.6 Sol 68.32% (p. 41). KernelGen 1P 60.44% vs Astra 66.72%, GPT-6 Sol
38.12%, GPT-5.6 Sol 61.08% (p. 42).

Cyber (p. 39 unless noted): ExploitBench 99.7% at max (GPT-6 Sol 81.7%,
Astra 100%); ExploitBench-Internal Port 21.5% (Astra 31.5%, GPT-6 Sol
5.5%); SEC-Bench Pro 78.8% (Astra 85.4%, GPT-6 Sol 66.3%); ExploitGym 35.1%
(Astra 42.4%, GPT-6 Sol 22.1%; p. 40).

Codex prod agentic safe completion, sensitive personal data: 0.744 vs GPT-6
Sol 0.854 (p. 6, Table 3) — the one Codex-prod row where GPT-6.1 Sol is
lower.

Launch figures compiled by a third party (Vellum, from OpenAI's launch
materials; not in the card): DeepSWE v1.1 GPT-6.1 Sol (high) 75.2% at about
$1.50/task, GPT-6 Astra (high) 74.8% at about $7.70/task, GPT-6 Sol (max)
68.8% at $2.60/task. OSWorld 2.0 GPT-6.1 Sol (max) 71.4% (about $1.30/task),
Astra (max) 73.5% (about $9.30/task), GPT-6 Sol (max) 64.4%. AutomationBench
1.0.6 GPT-6.1 Sol 35.4% at medium and 36.0% at high, GPT-6 Sol (medium)
30.6%. Low-effort hallucination error rate 7.7% vs GPT-6 Sol 11.4%. No
Artificial Analysis Intelligence Index for GPT-6.1 Sol was published as of
2026-09-29.

These motivate testing, not a production effort choice or a judging claim.

## Current documentation facts

The exact ID is `gpt-6.1-sol`, also its only snapshot and alias, described
as "Near-Astra performance for complex work at a lower cost." Standard API
prices per million tokens: $2 input, $0.10 cached input, $2.50 cache
writes, $10 output (GPT-6 Sol: $2 / $0.20 / $2.50 / $10). Context is
1,050,000 tokens, max input 922,000, max output 128,000. Documented
reasoning effort values are `low`, `medium` (default), `high`, `xhigh`, and
`max`; `none` is not listed (GPT-6 Sol lists it). Knowledge cutoff is April
30, 2026.

Probed with Codex CLI 0.159.0 on 2026-09-29: `codex exec -m gpt-6.1-sol`
runs, and asked which family its host instruction names it answered
"GPT-6" — the same bare family phrase as GPT-6 Astra, Sol and Luna. Only the
exact ID `gpt-6.1-sol` can select this model's profile.

## Routing hypotheses and limits

- Shared Codex routing sends ordinary and difficult tasks, the Luna ladder
  rung and Codex research to `gpt-6.1-sol`. These executor routes are
  operational but uncalibrated.
- The standard supervisor of all-Luna waves is `gpt-6.1-sol` since 2026-09-29 (fixture pass, not production calibration); the lower-cost final-review option is `gpt-6.1-sol` since 2026-09-30 (strict gate passed after a verdict-wording fix).
- `codex-routing.md` governs.

## Local measurements (2026-09-29)

`gpt-6.1-sol` at effort `medium`, Codex CLI 0.159.0; full record in
`tests/eval/gpt-6-1-sol-results-2026-09-29.md`.

| Tier | Result |
|---|---|
| supervisor fixture (×3) | 9/9 |
| super-plan (×3) | 6/6 |
| skill-navigation (×3) | 31/31 |
| safety (×3) | 8/8 |
| drift (×3) | 3/3 |
| seam-audit (×3) | 9/9; planted seam caught 3/3 (GPT-6 Sol 1/3 on 2026-09-24) |
| critical-review strict gate, two ×5 runs | clean 4/5 and 5/5, planted 5/5 and 5/5, PR support 3/4 |
| critical-review strict gate re-run (2026-09-30, after the verdict-wording fix), two ×5 runs | clean 5/5 and 5/5, planted 5/5 and 5/5, PR support 3/4 (one pr-gate-approved miss) |
| profile-routing context cells | 0/4 and 1/4 — a harness artifact: the runtime-context line sat in the user prompt, which Step 0 does not accept as identity; delivered as developer instructions, 2/2 |

The one failed clean-diff review was a format failure: its Overall
verdict carried the route's calibration caveat instead of the word
clean. Native-wave and ship-smoke runs were blocked by the Codex CLI
0.159.0 linked-worktree `.git` sandbox issue, not by the model.

## Unmeasured properties

No source here measures GPT-6.1 Sol's self-preference or judge bias. No live wave or production supervisor run exists for this model in this plugin yet.
