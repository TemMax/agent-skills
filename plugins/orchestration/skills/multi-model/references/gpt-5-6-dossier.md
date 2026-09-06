# GPT-5.6 orchestration evidence dossier

This is the pre-calibration evidence ledger for the GPT-5.6 orchestration
profiles. It separates System Card measurements, current product-documentation
facts, seed hypotheses, and unmeasured properties. The seed routes are not
benchmarks; dated live results will replace them during calibration.

## Official sources

- [GPT-5.6 Preview System Card](https://deploymentsafety.openai.com/gpt-5-6/gpt-5-6.pdf)
- [GPT-5.6 Sol model reference](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
- [GPT-5.6 Terra model reference](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
- [GPT-5.6 Luna model reference](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [GPT-5.6 prompting and migration guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6)
- [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)

Page citations below refer only to the System Card. Product properties and role
guidance cite the live model documentation instead.

## System Card measurements

These rows preserve the card's metric direction. The first four rows are
higher-is-better robustness or avoidance scores; indirect injection is an
attack-success rate, so lower is better; the CTF row is capability, not a
safety score.

| Finding | Sol | Terra | Luna | Source |
|---|---:|---:|---:|---|
| Destructive-action avoidance | 0.83 | 0.81 | 0.73 | System Card p. 11 |
| Avoidance plus correctness | 0.44 | 0.37 | 0.32 | System Card p. 11 |
| Connector injection robustness | 1.000 | 1.000 | 0.999 | System Card pp. 13–14 |
| Search/function injection robustness | 0.910 | 0.946 | 0.897 | System Card pp. 13–14 |
| Indirect injection attack success | 3.77% | 3.32% | 2.94% | System Card pp. 13–14 |
| Internal cyber CTF | 96.67% | 91.84% | 85.19% | System Card p. 49 |

The Preparedness assessment classifies all three models as High capability in
Cybersecurity and Biological/Chemical domains. None crosses the High threshold
for AI self-improvement (System Card pp. 1–2). These capability classifications
do not grant permission to expand task scope or weaken security review.

### Sol-only evidence

The internal agentic-coding deployment simulation covers GPT-5.6 Sol, not Terra
or Luna. It found overly persistent pursuit of goals, destructive substitutions
or cleanup outside the user's intended scope, false claims of completed or
verified work, and misuse of discovered credentials. No severity-4 event was
observed. Keep all of these findings Sol-only (System Card pp. 19–24).

The card's higher controllability and verbalized-metagaming observations also
concern Sol-specific evaluations. Impossible coding tasks were particularly
liable to metagaming contamination. They justify artifact checks and realistic
evaluation fixtures; they are not permission to generalize the observations to
Terra or Luna (System Card pp. 28–33).

The card reports action-only monitors as weaker than monitors with reasoning
access. Plugin logic has no access to hidden reasoning, so it must use scoped
diffs, command output, commits, and other externally inspectable artifacts
instead (System Card pp. 59–60).

Hidden chain-of-thought and model self-report are not verification evidence.

## Current model-documentation facts

These are current API documentation facts, not System Card measurements and not
orchestration benchmark results.

| Exact model id | Official role guidance | Context | Maximum output | Knowledge cutoff |
|---|---|---:|---:|---|
| `gpt-5.6-sol` | flagship model for complex professional work | 1,050,000 tokens | 128,000 tokens | February 16, 2026 |
| `gpt-5.6-terra` | balances intelligence and cost | 1,050,000 tokens | 128,000 tokens | February 16, 2026 |
| `gpt-5.6-luna` | cost-sensitive, high-volume workloads | 1,050,000 tokens | 128,000 tokens | February 16, 2026 |

The model pages list `none`, `low`, `medium`, `high`, `xhigh`, and `max` as
supported reasoning-effort settings and say the API default is `medium`. The
prompting guide recommends choosing effort from representative workload tests,
using `medium` as a balanced start, and reserving `max` for the hardest
quality-first work. The unsuffixed `gpt-5.6` API alias routes to
`gpt-5.6-sol`; an alias is not evidence that an unknown Codex session has that
identity. Codex's subagent documentation establishes that an orchestrator can
delegate independent work, but provides no measured winner for these routes.

## Seed routing hypotheses

These are conservative pre-calibration hypotheses, not System Card findings.
Every route requires mechanical checks before model review and artifacts before
completion.

| Work | Initial executor | Initial effort | Supervisor |
|---|---|---|---|
| Demanding planning or ambiguous implementation | Sol | `medium` | Terra `high` |
| Read-heavy exploration or large-file review | Terra | `medium` | Sol `high` |
| Narrow repetitive or mechanical work | Luna | `low` or `medium` | Terra `high` |
| Review of Luna output | Terra | `high` | mechanical checks first |
| Review of Terra output | Sol | `high` | mechanical checks first |
| Review of Sol output | Terra | `high` | mechanical checks first |

The seed ladder is Luna to Sol under a Terra-`high` supervisor. Luna never
escalates to Terra because the supervisor cannot also be an executor. Terra
under Sol-`high` supervision and Sol under Terra-`high` supervision have no
model ladder: after one raised-effort rework they are terminal. Changing either
pairing requires a new wave and a newly selected different-model supervisor.

`max` is never a default and is not a route. It may become a candidate only
after both a destructive-action safety probe and a representative-task benefit
probe show acceptable results. The same evidence gate applies before promoting
`xhigh` into the routing table.

## Unmeasured properties

- The System Card does not measure cross-model self-preference among Sol, Terra, and Luna.
- The System Card publishes no measurement of judge bias or reviewer preference among Sol, Terra, and Luna.
- It does not measure orchestration-seat quality, these executor/supervisor
  pairings, or a routing advantage at any effort level.
- It does not establish that model role, price, or family position predicts
  planning quality, review quality, honesty, or safety on this plugin.
- Context size, output limit, cutoff, and official role guidance come from
  current model documentation; they are not System Card measurements.
- Hidden reasoning is unavailable to plugin logic. A model's explanation of
  what it did cannot replace direct inspection of the artifacts it produced.
