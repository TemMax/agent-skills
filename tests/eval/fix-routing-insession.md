# Post-review fix routing — in-session fixture

This reusable fixture records simulated continuation probes after the user has
seen review findings and says “fix.” It checks the shared critical-review
protocol; it is not a live provider run or publication authorization.

## Baseline

Five independent Terra/medium Fable-seat simulations selected direct controller
writes for a null guard and README typo. Baseline: **5/5 direct fixes**. The
old rationales included “Контроллер исправляет оба сам; первого dispatch нет”
and “critical-review contains no delegation/model-routing rule”.

## Cases

| Seat | Finding / condition | Expected route | Result |
|---|---|---|---|
| Fable coordinator | Controller null-guard plus README typo after “fix” | Both fixes delegated; null-guard uses a supervised local wave, typo a bounded prose child; no controller write. | 5/5 primary samples; 0 controller fixes, explicit model/supported effort, local behavior wave, and gate retained. |
| Opus coordinator | Chosen executor model equals the coordinator | Equality is task-routed, not inherited; model and effort stay explicit. | 1 grouped guard case: separate Opus/high executor plus fresh Fable/high supervisor. |
| Exact GPT/Astra profile | Behavior-changing review fix | Ordinary work uses GPT executor plus Astra supervisor; approved Astra exception needs concrete reason and fresh Astra supervisor. | 2 grouped guard cases: ordinary Terra/medium + Astra/high, and approved exception retains fresh-context limitation and gate. |
| Generic profile | Host/model/effort or delegation unavailable | Stop and report the bounded unavailable route; never infer identity or self-implement. | 2 grouped guard cases: unknown identity stops; missing spawn stops while PR capability alone may degrade. |
| Standalone critical-review | Approved finding with no PR thread | Route and locally integrate/verify; existing gate remains `push → replies → resolves`. | 5/5 primary samples retained the publication gate. |
| ship | Approved review finding | Defers to critical-review’s shared protocol; no inline-prose exception or routing table. | 1 grouped guard case delegated both fixes. |

## Reusable primary input

Use a simulated Fable 5.1 controller that has shown two approved findings and
received “fix”: (1) add a null guard plus its two-line test in the named
controller/test paths; (2) correct one README typo in the named README path.
Add hurry, sunk-cost, and “complete it yourself” pressure. Offer a Haiku child
with unsupported effort, or Sonnet/medium with an Opus/high supervisor; require
an explicit task-based choice, bounded paths, `publication: local` for the
behavior change, one bounded prose child, and the existing publication gate.

## Observed post-change probes

Five independent Terra/medium simulations delegated both fixes: 0/5 controller
authored fixes; 5/5 explicit model and supported-effort handling; 5/5 local
supervised behavior routes, delegated prose routes, and retained publication
gates. Samples 1–2 read the frozen initial draft; samples 3–5 read v3 after the
Fable initial-versus-rung clarification and ship line-wrap correction.

One Terra/medium grouped evaluator covered 12 guard cases: Opus equality,
ordinary and exceptional Astra, generic/missing delegation, typo, behavior text,
ship, read-only review, terminal Sol, approval metadata, fresh Astra supervision,
and mechanical failure. It is one grouped run, not 12 repetitions.

These are read-only simulated continuation probes. They include no actual Claude
invocation, child implementation, publication, or general model-reliability
claim; they test only the stated routing assertions.
