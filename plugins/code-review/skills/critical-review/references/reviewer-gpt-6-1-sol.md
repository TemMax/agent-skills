# GPT-6.1 Sol reviewer profile

## Exact model guard

Apply this profile only when runtime context reports the exact model id
`gpt-6.1-sol`. Codex gives GPT-6.1 Sol the same bare "GPT-6" family phrase
as GPT-6 Astra, Sol and Luna (probed with Codex CLI 0.159.0 on 2026-09-29),
so that phrase is not enough — only the exact ID selects this profile.
`gpt-6-sol` is a different model with its own profile. If the id differs or
is unknown, stop using this profile and load the matching exact-id profile
or `reviewer-generic.md`. Do not infer an identity from an alias,
capability, output quality, or model position.

## Session effort

Preserve explicitly supplied session effort; missing effort remains unknown.
No calibrated GPT-6.1 Sol reviewer effort exists. The model page documents
`low`, `medium` (default), `high`, `xhigh`, and `max`; none has been
evaluated for this checklist, and `max` is never assumed by default.

## Calibration status

2026-09-29 local strict-gate run, `medium` effort, Codex CLI 0.159.0, two
runs of five: clean 4/5 and 5/5, planted 5/5 and 5/5, PR support 3/4 —
below the gate, with one format failure in the verdict line. After the
verdict-wording fix in Review method below, the 2026-09-30 re-run had
clean 5/5 and 5/5, planted 5/5 and 5/5, PR support 3/4 (one
`pr-gate-approved` miss). The route is now **measured-supported**: a
GPT-6.1 Sol model-selection request may return `gpt-6.1-sol`, stating
these counts and the PR-support caveat alongside it. Efforts other than
`medium` remain uncalibrated. GPT-6 Sol's calibration does not transfer
to this model, nor this model's to GPT-6 Sol.

## Review method

Start with the scoped diff, read the affected code and callers, and run or
inspect relevant tests. Re-derive every finding from the diff, code, and
tests rather than from memory or a plan's stated intent. For each
violation, record file/line evidence and a concrete failure scenario;
separate confirmed violations from remarks. Answer every requested
checklist item explicitly. State checks run and checks unavailable — say
so plainly when a tool is broken (GPT-6.1 Sol fails to acknowledge a broken
search tool in 2.08% of the card's cases, p. 18). Suspicion may prompt
further inspection but is never itself a blocker. Keep the route's calibration
status in the internal evidence packet. The `Not verified` field describes
task checks that could not be completed. The `Overall verdict` uses the
checklist's own words: a review with no findings says the word clean.
Measured 2026-09-29: the one failed clean-diff run put the caveat into the
verdict line instead.

## Independence and escalation

Preserve the mechanical evidence packet with
the strict-gate and PR-support counts, and hand final judgment upward
when the PR-support caveat applies. Never mix providers or silently substitute
another GPT model. Do not invent a stronger reviewer from a model label or
from "capabilities comparable to GPT-6 Astra" (card p. 3): the card reports
a Coding Deception rate of 1.50%, above GPT-6 Sol's 1.30% and Astra's 0.51%
(p. 17), and it measures honesty under adversarial pressure, not
defect-detection accuracy.

## Not measured

Beyond the 2026-09-29 and 2026-09-30 strict-gate runs above, no evaluation of GPT-6.1 Sol
as a reviewer exists in this plugin. The card measures no judge bias,
self-preference, false-positive or false-negative rate for this checklist.
Read `gpt-6-1-sol-reviewer-dossier.md` when checking model-selection or
calibration claims; ordinary artifact review uses this profile's guards.

## Common mistakes

- Carrying GPT-6 Sol's measured review route over to GPT-6.1 Sol.
- Calling a review result clean or complete without fresh artifact
  inspection.
- Treating "comparable to Astra" as proof of reviewer accuracy.
- Reporting a check as passed when its tool was unavailable.
