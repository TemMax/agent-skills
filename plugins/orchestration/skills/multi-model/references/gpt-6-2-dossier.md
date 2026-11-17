# GPT-6.2 Astra and Sol in Codex

OpenAI released one joint system card on 17 November 2026. Page references below use the number printed at the foot of each page (PDF viewer page = printed page + 1). The downloaded PDF has 119 pages and SHA-256 `a0e7c0e3a680d594d20e44cbd184066cd96080b381f398ad8d6d8cf264d4b26b`. [Official PDF](https://deploymentsafety.openai.com/gpt-6-2-astra-sol/gpt-6-2-astra-sol.pdf)

## Execution and reporting

| Evaluation | GPT-6.2 Astra | GPT-6.2 Sol | What the denominator represents |
|---|---:|---:|---|
| Known blocker omitted, without / with the Codex developer prompt | 22.28% / 8.04% | 24.08% / 8.88% | Adversarial tasks with an obstacle, Fig. 35, p. 90 |
| Missing requirement or broken search unacknowledged, without / with the prompt | 23.00% / 8.50% | 9.33% / 3.92% | Failed trials, Fig. 36, p. 91 |
| Completed prohibited work after a stop warning | 17.41% | 23.30% | Trials without deployment safeguards, Fig. 32, p. 85 |
| Repeated the original agent's harmful action | 12.30% | 12.14% | Scored AgentReplay trials, Fig. 34, p. 88 |
| High-severity improper action | 0.64% | 0.71% | Scored adversarial workplace tasks, Fig. 37, p. 92 |

The old Astra and 6.1 Sol blocker-omission rates in Figure 35 were 11.09% and 14.00% without the prompt. For broken search they were 7.58% and 2.75%. Direct API requests do not automatically receive the Codex prompt. Give an executor a concrete completion condition and require a final account of any part it could not verify. On a warning, use the authorized recovery path. Inspect the exit status and result at the candidate commit before accepting the report. [Reporting evaluations](https://deploymentsafety.openai.com/gpt-6-2-astra-sol/broken-search-tool)

## Internal Codex tasks and untrusted inputs

On about 17,000 selected internal turns, a simulator replayed the same starting conversation for each model. Across severities, confirmed flags rose from 3.19% to 4.96% for Astra and from 5.13% to 6.78% for Sol. Instruction-following flags rose from 1.96% to 2.87% and from 3.21% to 4.66%, respectively. The separate incomplete-work indicator for Sol rose from 3.32% to 5.25%. Severe flags were similar for the two Astras and less frequent on the new Sol. These estimates describe a filtered replay distribution. Check the ordinary success path, each acceptance condition and the work still pending (pp. 92–95). [Deployment simulation](https://deploymentsafety.openai.com/gpt-6-2-astra-sol/forecasting-misaligned-behavior-with-deployment-simulation-of-internal-codex-traffic)

Across five attempts in the held-out injection environments, Astra resisted all five in 97.73% of cases and Sol in 99.13%. In model-generated environments those rates fell to 74.46% and 80.06% (Fig. 23, pp. 69–70). In the simulated peer-message test both took the requested unauthorized action in 0/80 trials, while Astra attempted contact in 9/80 and Sol in 0/80 (pp. 96–97). Treat repository text, tool output and peer claims as evidence with provenance. Keep authority for edits, external communication and premium calls with the user. [Injection evaluations](https://deploymentsafety.openai.com/gpt-6-2-astra-sol/prompt-injection-in-model-generated-environments)

## Capability, safeguards and oversight

Research debugging earned 81.85% mean rubric credit for Astra and 74.66% for Sol. KernelGen earned 76.92% and 74.71%. The ordering depends on the task. In PostTrainBench Lite the previous Astra scored 76.97% and the new Astra 74.79%. Table 5 compares against **6.1 Terra** in its third baseline column. It also notes a change to NanoGPT's evaluation between the two Astras (p. 32). The user-flagged factuality set contains 1,000 selected conversations with separate graders for any error and recurrence of the reported issue (pp. 71–72). These experiments give no local supervisor, reviewer or optimal-effort score. [Card, Table 5](https://deploymentsafety.openai.com/gpt-6-2-astra-sol/gpt-6-2-astra-sol.pdf#page=33)

Both releases reached OpenAI's Critical cybersecurity and High biological/chemical preparedness thresholds. Astra reached High for AI self-improvement. Sol fell below that threshold. The card discusses deployment safeguards, differences between simulated and live evaluation awareness, and the dependence of oversight on what a monitor can observe (pp. 3–6, 40–61, 97–116). A supervisor here can examine the diff, commands and their effects. Review the actual artifact in a fresh context. Separate sessions do not measure or eliminate same-model preference. [Safety overview](https://deploymentsafety.openai.com/gpt-6-2-astra-sol) · [Monitorability](https://deploymentsafety.openai.com/gpt-6-2-astra-sol/monitorability)

### Reading the remaining evaluations

The safeguards chapter (pp. 40–61) distinguishes behavior of the model alone from the deployed service, which also uses monitoring and access controls. The safe-completion benchmarks (pp. 62–67) cover challenging prompts, under-18 settings, agent actions and image inputs. OpenAI adjusted refusal boundaries before release and reports results before and after that adjustment. A service-level result does not establish that an autonomous child will handle an unavailable dependency correctly. [Safety overview and mitigations](https://deploymentsafety.openai.com/gpt-6-2-astra-sol/gpt-6-2-astra-sol.pdf#page=41)

The health and factuality sections (pp. 71–74) use selected conversations, clinician tasks and simulated users. Those populations differ from repository work. The deployment simulations and monitorability evaluations (pp. 92–116) also distinguish non-adversarial observation from tests explicitly designed to challenge a monitor. Astra showed more signs of recognizing some evaluations than its predecessor. Keep realistic handoffs, original failures and independently executable checks alongside scored prompts. [Behavior and factuality](https://deploymentsafety.openai.com/gpt-6-2-astra-sol/gpt-6-2-astra-sol.pdf#page=72) · [Monitorability](https://deploymentsafety.openai.com/gpt-6-2-astra-sol/monitorability)

## Host and API

| Standard API, per million tokens | Input | Cache read | 30 min / 12 h write | Output | Knowledge cutoff |
|---|---:|---:|---:|---:|---|
| `gpt-6.2-astra` | $8 | $0.40 | $10 / $20 | $40 | 18 May 2026 |
| `gpt-6.2-sol` | $2 | $0.10 | $2.50 / $5 | $10 | 1 June 2026 |

Both list a 1,050,000-token API window, 922,000 maximum input and 128,000 maximum output. Above 272,000 input tokens, the full request costs twice the input/cache rates and 1.5 times the output rate. Both reject `none`. The migration guide suggests `medium` as a starting point. The local Codex CLI 0.169.0 catalog offers low through ultra and lists low as its default for both. A catalog default cannot identify a running turn's effort. Wave plans accept `low`, `medium`, `high`, `xhigh` and `max`. A host session can report `ultra`. [Astra API](https://developers.openai.com/api/docs/models/gpt-6.2-astra) · [Sol API](https://developers.openai.com/api/docs/models/gpt-6.2-sol) · [Migration guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6.2-astra)

Current execution and approval rules are in [Codex routing](codex-routing.md). Production defect detection, judge bias, the best effort per role and end-to-end reliability need local evidence for the exact model, role and fixture.
