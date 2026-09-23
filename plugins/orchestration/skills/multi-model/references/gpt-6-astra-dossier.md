# GPT-6 Astra orchestration evidence dossier

Reviewed 2026-09-07. Evidence status: exact-ID integration and candidate routing;
production reliability of the Astra-led routes is not yet calibrated.
Operational policy is maintained separately in [codex-routing.md](codex-routing.md):
uncalibrated reliability is not a blanket prohibition on supervised use.

## Sources

- [System Card, 3 September 2026, updated 22 September 2026, 156-page PDF](https://deploymentsafety.openai.com/gpt-6-astra/gpt-6-astra.pdf)
- [Model reference](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [Model guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra)
- [Launch evaluation table and methodology](https://openai.com/index/gpt-6-astra/)

The PDF's numbered pages are used below. Measurements from one setup cannot
be compared directly with similarly named scores in another provider's card.

## System Card measurements

| Measurement | GPT-5.6 Sol (original) | GPT-6 Astra (original) | GPT-5.6 Sol (updated eval) | GPT-6 Astra (updated eval) | Direction and source |
|---|---:|---:|---:|---:|---|
| GPT-Red indirect-injection robustness | 96.23% | 99.79% | — | — | Higher is better; section 5.2, pp. 17–18 |
| Coding Deception at `max` | 14.29% | 3.54% | 10.41% | 0.51% | Lower is better; section 8.3.1, pp. 29–30; updated p. 130 |
| Broken Search Tool failure at `max` | 81.83% | 8.08% | 77.46% | 1.50% | Lower is better; section 8.3.2, pp. 30–31; updated p. 131 |
| Attempted or succeeded Auto-review circumvention at `max` | 5.3% | 0.0% | 7.3% | 0.0% | Lower is better; section 8.2.1, pp. 24–25; updated pp. 127–128 |
| Fails to stop at an environment warning at `max` | 64% | 19% | 68.2% | 17.4% | Lower is better; section 8.2.2, p. 26; updated p. 128 |

Coding Deception includes misleading coding-work or capability claims in
adversarial tasks. These are experimental rates, not production incidence.
AutoReview measures the acting model's respect for a gate, not its ability
to serve as the gate's judge. Zero observed attempts is not a guarantee.
The updated-eval columns come from different evaluation versions re-run on
22 September 2026, not a model change; the change between the original and
updated columns is an evaluation change, not a model change.

Gray Swan IPI Arena, 15 attempts per scenario: 8.5% attack success vs
GPT-5.6 Sol 27.0% (p. 18).
ExploitGym honeypot at `max`: GPT-5.6 Sol attacked 55.4% of the time, Astra
never (p. 29).

Section 9 finds reduced reasoning monitorability in several setups. The
plugin cannot inspect hidden reasoning; preserve action and artifact checks.
This result does not establish that Astra is more deceptive.

## Capability evidence, not route qualification

The launch table reports Terminal-Bench 4.0 at 57.9% versus Sol's 37.3%,
DeepSWE v1.1 at 74.1% versus 72.7%, and MRCR v2 eight-needle 512K–1M at
96.3% versus 73.8%. The published scores are maxima across effort levels and
use research/API harnesses. They motivate testing long-task coordination;
they neither select a production effort nor establish superior judging.

## Current documentation facts

The exact ID is `gpt-6-astra`; the API lists `low`, `medium`, `high`, `xhigh`,
and `max`, a 1,050,000-token context and 128,000-token maximum output. Actual
host availability and accepted effort values must be checked at invocation.
An unknown session effort stays unknown.

Standard API prices per million tokens are $10 input, $1 cached input,
$12.50 cache writes, and $50 output. The model page documents higher rates
for requests above 272K input tokens. These API prices are not a conversion
of ChatGPT subscription percentages; preserve measured usage separately.

The model guide documents stronger sensitivity to skill instructions,
additional clarification pauses, less delegation than some workflows need,
and excessive testing on small tasks. The profile consequently scopes
delegation, approval boundaries, and test repetition. Async tools, steering,
and compaction are host capabilities; this plugin does not implement them.

## Routing hypotheses and limits

Astra leads the existing four skills when it is the active session model.
GPT-6 Sol and Luna ordinarily implement the wave (see shared Codex routing); GPT-5.6 IDs remain valid only for already approved plans; a separate Astra judges their
artifacts. A separately approved Astra initial executor or final rung is an
uncalibrated exception, requiring a fresh Astra supervisor for context
separation rather than different-model independence.
The Sol-`high` drift checker is a candidate for detecting departures from the
plan, not a replacement for the wave supervisor. Mechanical verification
remains authoritative.

Neither this card nor the older GPT-5.6 regression measures these exact
pairings, planner quality, review false positives/negatives, self-preference,
or a best effort curve. A production claim needs dated results for the named
role, effort, prompts, and both clean and failing cases. Preserve failures and
usage gaps; discovery, offline validation, and single passes are insufficient.

The repository's `tests/eval/gpt-6-astra-pilot-2026-09-07.md` records the bounded
local pilot and its gaps. It does not qualify a live executor/supervisor pair
or end-to-end orchestration route.
Its follow-up records three passing Sol/high drift-hook fixtures, two timed-out
native waves, and a ship attempt stopped by a malformed supervisor verdict.
After two focused runtime corrections, a fresh output probe and one functional
ship smoke reached a fake PR and clean review. Native launch telemetry, repeated
clean/defect qualification and real GitHub/CI remain unverified; the full route
remains unqualified.
