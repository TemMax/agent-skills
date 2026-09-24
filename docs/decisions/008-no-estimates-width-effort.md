# 008 — No time or cost estimates, design for width, host-sourced effort

Date: 2026-09-24
Status: accepted

## Context

The 2026-09-24 mid-size Codex pilot ran the same feature twice, planned and
executed by one Codex orchestrator session in a disposable repo, and both
runs finished below the lower bound of their own Gate 2 range: the standard
run and the premium run each undershot the estimate Gate 2 had shown for it.
Separately, a real four-repository plan was quoted at 7–16 hours and
$60–250, a range too wide for the user to act on. That same four-repository
plan came out as 14 waves of one task each, because `files_allowed` was cut
by directory rather than by file and a step list was copied one step per
wave — a plan with no width at all.

Codex hook payloads carry `model` and `transcript_path` but no effort field;
the session's own rollout carries a `turn_context` record with `effort`,
and that record is already written by the time SessionStart runs (verified
with Codex CLI 0.155.1 and `gpt-6-luna` at `low`). Claude Code hook payloads
carry no effort at all, and a hook's `CLAUDE_EFFORT` environment variable is
only inherited from the parent process — a `--effort low` child launched
with `CLAUDE_EFFORT=xhigh` inherited from its parent saw `xhigh`, not `low`.
The shell tool's `CLAUDE_EFFORT`, by contrast, is the session's own: verified
`low`, `medium`, and a subagent's own `medium`, empty for Haiku 4.5.

## Decision

**No estimates.** No skill predicts time or cost anywhere. super-plan's
Gate 1 names the supervisor choice, premium or standard, without a price.
Gate 2 shows the plan's shape — the waves, the tasks that run in parallel in
each, and the critical path in waves — instead of a wall-time and cost
range. multi-model's table, progress updates and summaries, and ship's
handoff carry no time or cost prediction. The pilot's measurements are kept
as history in `tests/eval/wave-cost-measurements-2026-09-24.md`, which no
skill reads.

**Design for width.** super-plan plans for parallel waves explicitly:
`files_allowed` is cut by file rather than by directory, a contract-first
wave precedes its parallel implementers, independent chains — including
plans that span separate repositories — sit side by side, and a plan never
puts one wave per step of a sequential list. A plan of three or more waves
whose waves mostly hold a single task gets a linter warning unless it
explains each such wave under a `## Parallelism` heading.

**Effort detection.** The runtime-context hook reads Codex effort from the
session's own `turn_context` record, reached through the hook payload's
`transcript_path`, at SessionStart and again at UserPromptSubmit when the
model or effort changed. On a Claude Code host, where hooks receive no
effort and cannot reliably inherit `CLAUDE_EFFORT`, Step 0 instead reads
`CLAUDE_EFFORT` once through the shell tool, where Claude Code sets it to
the session's own effort; Step 0 never reads it this way on a Codex host,
where the variable can be inherited from a parent Claude Code session
instead of reflecting the current one.

## Consequences

One extra shell call in Step 0 on a Claude Code host. One extra context line
emitted on a Codex host when the model or effort changes mid-session.
