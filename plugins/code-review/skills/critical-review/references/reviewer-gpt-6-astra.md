# GPT-6 Astra reviewer profile

## Identity guard

Apply when Step 0 selects this profile from exact `gpt-6-astra` identity or
host-family compatibility with bare `GPT-6`. Compatibility leaves the exact
runtime ID unknown; it does not establish model-specific measured reliability.
Otherwise stop
using this profile and load the matching profile or `reviewer-generic.md`.
The skill runs on the current session model; it does not switch models.
Preserve an explicit session effort and leave an unknown effort unknown.

## Review method

Use the shared critical-review procedure: inspect the scoped diff, affected
code and callers, and tests. Each confirmed finding needs file/line evidence
and a concrete failure scenario. A concern without a demonstrated violation
is a question or remark, not a blocker. Report checks run and checks unavailable.

Astra performs the review itself. Do not delegate the final judgment to a
GPT-5.6 executor. Keep the inspection proportional to the changed behavior;
run required checks and repeat or expand them only when changes, failures,
or unresolved evidence justify it. Stay read-only until fixes are approved.

## Independence and approved fixes

Use fresh artifact inspection even if this session planned the work. A fresh
Astra agent reduces inherited context, but is not a different-model check of
Astra's own work. Neither self-preference nor reviewer neutrality is measured.

For an approved behavior-changing fix wave, invoke multi-model with `publication: local`:
GPT-5.6 executors, a separate Astra supervisor, and the exact approved plan.
Astra is not an executor or escalation rung. Keep returned commits local for
critical-review's verification and final publication gate; only its approval
permits push, then replies, then resolves. Small prose-only fixes still follow the
shared inline-fix rule; they do not justify a new behavior-changing wave.

This skill is not the wave supervisor. That role uses multi-model's separate
supervisor prompt and mechanical verifier, not a critical-review invocation.

## Calibration and evidence

The profile is available; production reviewer reliability is uncalibrated.
An explicitly requested review can report bounded findings with that limit.
`medium` and `high` are comparison candidates, not measured optimal settings;
do not require a restart solely because the active effort is unknown or
silently raise it to `max`.

Read `gpt-6-astra-reviewer-dossier.md` for sources and measurement limits.
Only dated clean/defect evaluations can qualify this reviewer. Lower coding
deception or stronger injection robustness cannot substitute for those tests.
