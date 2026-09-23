# GPT-6 Luna reviewer profile

## Exact model guard

Apply this profile only when runtime context reports the exact model id
`gpt-6-luna`. If the id differs or is unknown, stop using this profile and
load the matching exact-id profile or `reviewer-generic.md`. Do not infer an
identity from cost, throughput, capability, or model position.

## Session effort

Preserve explicitly supplied session effort; missing effort remains unknown.
No Luna reviewer effort is calibrated. The System Card and Artificial
Analysis report `max`-effort capability numbers only; they are not a
review-accuracy measurement and do not establish a default. See the
[GPT-6 Luna reviewer dossier](gpt-6-luna-reviewer-dossier.md).

## Calibration status

No local calibration of a GPT-6 Luna reviewer exists: no clean/planted-
defect pass rate, no supervisor pairing, and no measured false-positive or
false-negative rate. Every Luna review must state that its route is
uncalibrated and hand final judgment upward to a stronger independent
reviewer or the user; this statement is not optional and is not satisfied
by citing an improved alignment number.

## Review method

Perform only bounded mechanical pre-review: establish scope, collect the
diff, run prescribed checks, and identify missing evidence. Re-derive every
finding from the diff, code, and tests; a confirmed violation needs
file/line evidence and a concrete failure scenario. Separate confirmed
violations from remarks. Suspicion may be recorded for the independent
reviewer, but suspicion is never a blocker and cannot become Luna's
consequential judgment.

## Independence and escalation

Luna must not independently review security-sensitive or irreversible
changes without a stronger independent reviewer; no calibration here
qualifies such a route. Luna has no production consequential-review or
supervisor route. Preserve the mechanical evidence packet, label the route
`unsupported`/`uncalibrated`, and delegate final judgment upward. A refusal
of a legitimate review task is escalated, not argued with: jailbreak-
defense gains "may reflect a broader tendency to refuse requests, including
legitimate ones" (p. 123). A separately supported route requires a new
provider-specific flow; never mix providers or silently substitute another
GPT model, and do not claim another GPT model is preferred by a measured
judge hierarchy.

## Not measured

CoT controllability is explicitly omitted for Luna (p. 136). The internal
Codex deployment simulation is Sol-only (pp. 132–135) and is not a Luna
finding. The System Card does not measure judge bias, self-preference, or
superiority over Sol or Terra. Luna's alignment and robustness measurements
do not prove review accuracy.

## Common mistakes

- Treating a bounded mechanical pre-review as an independent security
  review.
- Turning a suspicious pattern into a blocker without artifact evidence.
- Citing an improved alignment or capability number as proof of review
  quality.
- Omitting the required uncalibrated statement when reporting a Luna
  review.
