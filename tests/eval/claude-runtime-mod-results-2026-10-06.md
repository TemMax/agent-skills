# Claude lifecycle runtime adapter — 2026-10-06

Candidate: orchestration 4.11.1 / code-review 1.17.1, adapter based on
`878757f`. Installed Git versions were not upgraded. Native checks used frozen
disposable copies, including candidate changes. Claude Code 2.1.291 generated
the API types used for implementation; mods require 2.1.287+.

## Behavior and boundaries

The mod obtains the **main session** model from `$.session.model()` and supplies
the existing V1 protocol through `classic.SessionStart.additionalContext`.
It replaces its own shell-hook output instead of adding a duplicate. The first
prompt does not repeat startup context; `prompt.submit` adds a new line only when
the main model changes. Startup, resume, clear, compact and fork use the lifecycle
handler. It preserves other hook context/decisions and the user's prompt text.

Lifecycle events do not supply reliable effort, so effort remains `unknown` and
existing skill guards/fallback remain. SubagentStart explicitly supplies
`model=unknown`: the main model API must never establish a child's identity.
This is not a per-request fallback-model or exact child-model adapter.

There are no UI handlers, filesystem operations or additional model calls in the
product mod. Both plugins can load independently. Codex manifests point at a
classic-only `hooks-codex.json`, equal to the existing shell event configuration;
Codex is not asked to load Claude modules. If the model API is unavailable or
unresolved, the handler retains classic-hook output without guessing identity.

## Native observations

| Check | Outcome |
| --- | --- |
| Headless startup, Fable 5.1 | Each plugin's exact model line attached once before the first assistant; diagnostic answer matched |
| Resume with Haiku 4.5 after Fable | New model line attached once per plugin before the new assistant; diagnostic answer matched |
| One Haiku child of Sonnet 5.5 | Child transcript received each plugin's explicit unknown line before first assistant; answer matched; no parent identity borrowed |
| Interactive Sonnet 5.5 terminal | Exact model lines arrived before first assistant; answer matched; no own mod UI |
| Same-process model switch, blocked prompt, clear/API outage | New identity delivered once on the next allowed prompt; blocked prompt made no model call; after clear with controlled API denial, next prompt restored both lines before first assistant |
| Claude real local critical review | Both semantic defects found despite 41 green tests; instruction order, read-only and source checks passed; **quiet failed** |
| Codex normal plugin loading and real local review | All checks passed, including both defects, startup context, instructions, quiet and unchanged fixture |

The Claude semantic case used Sonnet 5.5, whose review table selects generic.
It proves that review behavior remains functional on that case, not that every
named profile or every model route is calibrated or unchanged in quality.
Explicit compaction, aliases and module-disable/older-host paths have no separate
live run here. Those lifecycle and malformed-identity paths have free tests;
those are not live proof. The clear/API outage scenario used an owned controller
mod to deny the real model API twice and remove classic fallback context, and an
ordinary hook to block one prompt. Product handlers and the two allowed model
answers were real.

Independent review found two delivery-state defects: downstream prompt drops
were incorrectly recorded as delivered, and failed lifecycle lookups retained
old state after clear. Four regressions failed before the fixes and passed after
them. The bounded independent recheck found no remaining issues; the final-source
interactive fault scenario confirmed both fixes in the actual host.

## Retained failed approach

The first candidate used `prompt.compose` to append a request-specific system
section and removed legacy hook context. Startup succeeded, but resumed Haiku
reported MISSING, and the child had no runtime line. Its audit callback had
returned newly composed sections, which was insufficient proof that the engine
sent them. That approach was rejected. All three calls remain retained and
charged; the final lifecycle adapter used three fresh targeted checks.

Claude review still narrated instruction discovery: “Сначала нужно найти
AGENTS.md и CLAUDE.md.” The candidate remains a draft; this adapter does not
resolve the broader quiet-bootstrap gate. No message filtering or weakened
scoring was used.

## Evidence and accounting

Local evidence directories, containing frozen expectations/source hashes,
commands, native traces, transcripts, results and budget ledgers:

- `/private/tmp/claude-runtime-mod-live-20261006`: rejected approach, three calls.
- `/private/tmp/claude-runtime-mod-live-v2-20261006`: final startup/resume/child;
  `interactive/` contains the owned terminal session transcript and usage.
- `/private/tmp/runtime-mod-review-v2-20261006`: actual dual-host semantic cases,
  native temporary Codex installation and observed instruction order.
- `/private/tmp/runtime-mod-state-live-20261006`: final-source interactive
  model switch, blocked prompt and clear/API outage; both native transcripts,
  frozen source and machine assertions retained.

Resume `modelUsage` and `total_cost_usd` were cumulative. The startup counters
were subtracted and the original ledger retained alongside the correction.
Child calls use inclusive per-model counters; root-only usage is not the total.
Interactive `/cost` also includes host helper work: its rounded usage buckets
give an inclusive upper bound of 36,535 tokens and $0.02875; exact root usage is
17,483 tokens. That one turn exceeded its 15,000-token post-call guard, and no
further model turn was sent.

Across the first nine native invocations, including rejected runs and host helpers:
**at most 541,272 tokens including cache** and **$0.4253061 reported Claude cost
upper bound**. Codex subscription usage is counted in tokens; no dollar cost is
inferred. The tenth invocation (state faults) adds exactly 35,664 root tokens
across two answers. Its post-clear native UI reports at most 37,098 inclusive
tokens and $0.01865, but resets on clear: pre-clear helper usage was not captured.
A complete ten-invocation cost/token upper bound is therefore unavailable. These
figures exclude this editing session and the independent review agent, and are
validation costs, not evidence of token savings.

The native interactive `/model` command persisted a default even with
`--setting-sources ''`. Future fixtures that change it must isolate the complete
Claude configuration, or snapshot and restore the specific preference. Temporary
plugin loading alone does not isolate that setting.

Free checks: ten Node behavior tests and eight Claude plugin-runtime tests passed;
both plugin validations passed. The first full offline suite found four structure
failures because it treated `.mjs` modules as shell executables. Structure now
checks JavaScript syntax and parses the separate Codex hook files; its targeted
rerun passed 125 checks. The full offline suite rerun passed all tiers. The two
subsequent state fixes received focused Node, native runtime-kit and structure
reruns; the expensive unrelated runner tests were not repeated.

API references: [mods overview](https://code.claude.com/docs/en/plugins/mods/overview),
[events](https://code.claude.com/docs/en/plugins/mods/events),
[reference](https://code.claude.com/docs/en/plugins/mods/reference),
[free runtime test kit](https://code.claude.com/docs/en/plugins/mods/test).
