# GPT-6 Sol reviewer profile

## Exact model guard

Apply this profile only when runtime context reports the exact model id
`gpt-6-sol`. Codex CLI 0.155.1 gives Sol, Astra, and Luna the identical host
instruction "You are Codex, an agent based on GPT-6" (verified 2026-09-23),
so the bare "GPT-6" host phrase is not enough — only the exact ID selects
this profile. If the id differs or is unknown, stop using this profile and
load the matching exact-id profile or `reviewer-generic.md`. Do not infer an
identity from an alias, capability, output quality, or model position.

## Session effort

Preserve explicitly supplied session effort; missing effort remains unknown.
No calibrated Sol reviewer effort exists. The model page documents `none`,
`low`, `medium` (default), `high`, `xhigh`, and `max` as reasoning-effort
values; none of them has been evaluated for this checklist, and `max` is
never assumed by default.

## Calibration status

2026-09-23 UTC local calibration, re-measured after the stage B harness
fixes: clean-diff 7/8, planted-defect 8/8, PR gate 2/2
(`tests/eval/gpt-6-results-2026-09-23.md`). The one remaining clean-diff
failure wrote "Overall verdict: No findings" instead of the required word
"clean" — a real format failure. The strict review gate requires every guard
at 5/5 in repeated runs; the clean-diff guard is 4/5 in the x5 run, so the
route stays `unsupported`. Exactly as the GPT-5.6 Sol gate in
`reviewer-gpt-5-6-sol.md` states its route `unsupported` and defers, a GPT-6
Sol review must state plainly that its route is uncalibrated and hand final
judgment upward. System Card capability or alignment scores are not a
substitute for a dated local evaluation.

## Review method

Start with the scoped diff, read the affected code and callers, and run or
inspect relevant tests. Re-derive every finding from the diff, code, and
tests rather than from memory or a plan's stated intent. For each
violation, record file/line evidence and a concrete failure scenario;
separate confirmed violations from remarks. Answer every requested
checklist item explicitly — Sol's final answers are measurably shorter
than GPT-5.6 Sol's (for example a ~45% HealthBench answer-length drop,
p. 125), and brevity is not a substitute for completeness. State checks
run and checks unavailable; suspicion may prompt further inspection but is
never itself a blocker.

## Independence and escalation

Sol has no production consequential-review or supervisor route. Preserve
the mechanical evidence packet, label the route `unsupported`, and delegate
final judgment upward. A separately supported Claude review requires a new
provider-specific flow; never mix providers or silently substitute another
GPT model. Do not invent a stronger reviewer from a model label or from the
System Card's lower Coding Deception rate (1.30% at `max` vs GPT-5.6 Sol's
10.41%, p. 130): that measures honesty under adversarial pressure, not
defect-detection accuracy, and deception is not zero.

## Not measured

No clean or planted-defect evaluation of GPT-6 Sol as a reviewer exists in
this plugin. The System Card does not measure judge bias, self-preference,
or superiority over GPT-5.6 Sol or GPT-6 Astra as a reviewer; its Sol-only
alignment and deployment-simulation findings are guards for the review, not
routing evidence. Read `gpt-6-sol-reviewer-dossier.md` for sources and
their limits.

## Common mistakes

- Calling a review result clean or complete without fresh artifact
  inspection.
- Treating a lower Coding Deception rate as proof of reviewer accuracy.
- Skipping a checklist item because the model's answers run shorter.
- Promoting Sol to a production reviewer role from capability numbers
  alone.
