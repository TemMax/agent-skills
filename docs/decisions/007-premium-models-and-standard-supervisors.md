# 007 — Premium models and standard supervisors

Date: 2026-09-24
Status: accepted role boundary; the standard `gpt-6-sol` supervisor is a
policy route, uncalibrated as production

## Context

Issue #485 measured Astra supervision at roughly 70% of a runner wave's cost
on an all-Luna wave, and found premium models (`claude-fable-5-1`,
`gpt-6-astra`) used — as supervisor or executor — without the user ever
having made that choice: a plan could route to either model by default, with
no recorded approval and no cheaper alternative offered. Both problems trace
to the same gap: nothing in the plan format or the linter required a Gate 1
decision before a premium model was used, and nothing offered a standard
route in the cases that did not need one.

## Decision

Fable 5.1 (`claude-fable-5-1`) and GPT-6 Astra (`gpt-6-astra`) are premium:
they are used, in any role — supervisor, executor, or ladder rung — only
when the user chose them at Gate 1 and the plan records `approvals.premium`
(`models`, `reason`, `approved_by`, `date`); `plan-lint.mjs` enforces this and
rejects a plan that omits it.

Standard, non-premium supervisor alternatives cover the cases that do not
need a premium model:

- Claude: `claude-opus-5-5` supervises a wave whose executors and ladder
  rungs never reach `claude-opus-5-5` itself — the default ladder is
  included in that check, so a `claude-sonnet-5` task whose ladder reaches
  `claude-opus-5-5` is supervised by `claude-fable-5-1` instead, never by
  Opus 5.5 (a supervisor may not also appear as an executor or rung).
  `claude-opus-5` supervises otherwise, including every wave with a
  `claude-opus-5-5` executor or rung.
- Codex: `gpt-6-sol` supervises only a wave whose executors and every ladder
  rung are `gpt-6-luna`, at `high`, with no Luna→Sol ladder in that wave
  (Sol already holds the supervisor seat). Any `gpt-6-sol` executor in the
  wave — the `ordinary` or `difficult` task classes route their initial
  executor to Sol — loses the standard option: that wave needs the premium,
  fixed, separate `gpt-6-astra` supervisor at explicit `high`, the same as
  before this decision.

Gate 1 presents the supervisor choice, premium or standard, with its
estimated cost from `references/estimates.md`, before the user approves the
design.

**Ship's final-review child.** The `approvals.premium` rule governs what a
plan launches — supervisor, executor, or ladder rung — not the session's own
model running `ship` itself. Codex `ship`'s independent final-review
child — a `critical-review` invocation separate from the main seat, so a
GPT-5.6 seat never reviews its own consequential work — is chosen at Gate 1
like any other plan role and recorded in the plan's `"review"` key: the
premium `gpt-6-astra` with a valid `approvals.premium` entry, or the
standard `gpt-6-sol` (uncalibrated as a production reviewer, and labelled as
such in the PR). A plan missing the `"review"` key stops `ship` before that
review step runs.

**Headless rule.** In headless mode, the supervisor choice and its cost
still get presented; an unresolved premium-vs-standard choice is recorded
under `Assumptions (would ask)` rather than silently defaulting to either
alternative, per the existing headless-mode rule for unresolved forks.

None of this changes active-seat identity guards (Astra remains in the
active seat when a skill starts on it, per
[005](005-astra-active-seat.md)/[006](006-gpt-6-family.md)), the escalation
ladder, or the mechanical verifier.

## Consequences

Breaking: `plan-lint.mjs` now fails a plan that uses `claude-fable-5-1` or
`gpt-6-astra` in any role without a recorded, valid `approvals.premium`; a
previously approved plan that used a premium model without recording it
stops launching until migrated (see the README's `## 4.0.0` entry). The
standard `gpt-6-sol` supervisor route is a policy decision grounded in a
repeated fixture pass (9/9 on the supervisor fixture, twice, on
2026-09-23) — it is not production calibration, and `gpt-6-sol` remains
uncalibrated as a production supervisor outside this narrow all-Luna case.

## Evidence and limits

Cost evidence is issue #485's measured Astra-supervision overhead
(≈70% of a runner wave's cost on an all-Luna wave) and the supervisor
fixture's repeated 9/9 pass, both referenced above; neither measures the
standard route's production reliability. The standard-supervisor option
does not certify `gpt-6-sol` as a general-purpose supervisor, does not
apply to any wave containing a `gpt-6-sol` executor or rung, and does not
change premium-model gating for any role this decision does not name. Do
not upgrade the standard route's status from this fixture repetition or
from a single passing probe.
