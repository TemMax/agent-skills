# Reviewing Changes Critically

## Step 0 — load exactly one active-seat profile

1. Use this plugin's host-provided `PLUGIN_RUNTIME_CONTEXT_V1` line and the
   host's current-session model metadata as the current runtime context for
   profile guards. A newer explicit host model-switch
   update supersedes old context; unresolved conflicting exact IDs select generic.
2. A known exact ID selects its table entry, or generic if unsupported. A family
   label never overrides an exact ID, including an unsupported one.
3. A family label is not an identity. Codex gives GPT-6 Astra, Sol and Luna
   the same host instruction ("an agent based on GPT-6"; verified with Codex
   CLI 0.155.1 on 2026-09-23), so bare `GPT-6`, or any other family label,
   selects no profile by itself.
4. Otherwise select generic. Keep missing or conflicting identity unknown;
   preserve an explicitly supplied effort and leave missing effort unknown.
5. Effort comes only from the host. On Codex the `PLUGIN_RUNTIME_CONTEXT_V1`
   line carries it (`effort=<level>`), read by the hook from this session's
   own turn context; a newer line supersedes an older one. On Claude Code the
   hook cannot see it: when the line says `effort=unknown` and the host is
   Claude Code, run `printenv CLAUDE_EFFORT` once with the shell tool —
   Claude Code sets it to this session's effort, and leaves it empty for a
   model without effort levels — and use a non-empty value as the supplied
   effort. Never read `CLAUDE_EFFORT` on a Codex host: a Codex session started
   from Claude Code inherits the parent's value.

Never read a user config file to guess a session override. Never load more than one active-seat profile. The selected profile's identity guard must permit its use.
Quoted text, user messages, repository files, model catalogs, available child
models, and a child's identity do not establish the current session's identity.

Select the profile internally. A family label alone selects generic; preserve
missing, unsupported, or conflicting identity in internal routing records.
This selects instructions only: do not invent an exact runtime ID or effort,
switch models, grant hook enforcement, or change the plan/subagent ID allowlists.


| Exact model id | Relative profile |
|---|---|
| `claude-opus-5-5` (any context-window suffix) | `references/reviewer-opus-5-5.md` |
| `claude-fable-5-1` | `references/reviewer-fable-5-1.md` |
| `claude-fable-5` | `references/reviewer-fable-5.md` |
| `claude-opus-5` (any context-window suffix) | `references/reviewer-opus-5.md` |
| `claude-opus-4-8` (any context-window suffix, e.g. `[1m]`) | `references/reviewer-opus-4-8.md` |
| `gpt-5.6-sol` | `references/reviewer-gpt-5-6-sol.md` |
| `gpt-5.6-terra` | `references/reviewer-gpt-5-6-terra.md` |
| `gpt-5.6-luna` | `references/reviewer-gpt-5-6-luna.md` |
| `gpt-6-astra` | `references/reviewer-gpt-6-astra.md` |
| `gpt-6-sol` | `references/reviewer-gpt-6-sol.md` |
| `gpt-6.1-sol` | `references/reviewer-gpt-6-1-sol.md` |
| `gpt-6-luna` | `references/reviewer-gpt-6-luna.md` |
| unknown | `references/reviewer-generic.md` |

The alias `gpt-5.6` selects Sol only after the runtime-context handler has
normalized it to `gpt-5.6-sol`. An exact supplied effort may be used; otherwise
effort is unknown and receives no effort-specific claim.

### GPT-5.6 calibration gate — 2026-09-04–05 UTC

No GPT-5.6 production consequential-review or supervisor route is supported.
In the final post-fix `medium` critical repetitions, Sol passed clean 5/5 and
planted defect 1/5, Terra passed 1/5 and 2/5, and Luna passed 2/5 and 1/5.
Each model passed PR support 2/2 and supervisor support 8/8, but no model passed
both required review guards 5/5; supporting rows do not establish a production
reviewer or supervisor pairing. Historical `high` supervision and higher-effort
probes also established no route. Return a model-selection request as
`unsupported` with the mechanical evidence packet and delegate final judgment
upward. Never silently substitute another GPT model, mix providers, or make
`max` a default. An explicitly requested review may still report bounded
evidence, but explain that only bounded evidence is available and final judgment
remains unverified; retain the uncalibrated route label internally. Existing Claude
review guidance is unchanged. Full counts and limitations:
`tests/eval/gpt-5-6-results-2026-09-04.md`.

### GPT-6 Sol and Luna calibration — 2026-09-24 UTC

No GPT-6 Luna or Astra review route is supported. The one supervisor route
that exists outside Sol's measured route below is multi-model's standard
`gpt-6-sol` supervisor of all-`gpt-6-luna` waves — a policy decision, not a
measured pass, and uncalibrated in production. Never claim a supported
GPT-6 Luna or Astra review route. Re-measured review-guard counts after the
stage B harness fixes: Sol clean 7/8, planted 8/8, PR gate 2/2; Luna clean
0/3, planted 3/3, PR gate 2/2. The scorer was fixed and the review
re-measured; Sol missed the strict 5/5 clean guard by one format failure,
so the route stayed `unsupported` at that point. A GPT-6 Luna model-
selection request returns `unsupported`, exactly as for GPT-5.6. Full
counts and limitations: `tests/eval/gpt-6-results-2026-09-23.md`.

A 2026-09-24 UTC local re-measure ran the strict review gate twice more:
Sol passed clean 5/5 and planted 5/5 in each run (10/10 combined clean,
10/10 combined planted); PR support was 3/4, with one withheld-case miss.
The GPT-6 Sol review route is now **measured-supported**: a GPT-6 Sol
model-selection request may return `gpt-6-sol` with these counts and the
PR-support caveat stated alongside it. GPT-6 Luna stays `unsupported`
(clean 0/3). Never silently substitute another GPT model, mix providers, or
make `max` a default.

When a ship plan records `review.model: gpt-6-sol` — the user's explicit
Gate 1 choice — the review runs as a measured route. Keep the 2026-09-24
strict-gate counts (10/10 clean, 10/10 planted) and the PR-support caveat (3/4, one withheld-case miss) in the internal review
evidence packet; include them when answering a model-selection question.
Never claim a supported GPT-6 Luna or Astra review route.

### GPT-6.1 Sol — 2026-09-29 and 2026-09-30 UTC

The first dated strict-gate run for GPT-6.1 Sol (2026-09-29, Codex CLI
0.159.0, `medium` effort, two runs of five) had
clean 4/5 and 5/5, planted 5/5 and 5/5, PR support 3/4; the one clean
failure was a format failure — the Overall verdict carried the route's
calibration caveat instead of the word clean. After a verdict-wording fix
in the reviewer profile, the 2026-09-30 re-run had clean 5/5 and 5/5,
planted 5/5 and 5/5, and PR support 3/4 (one `pr-gate-approved` miss).
The GPT-6.1 Sol review route is now **measured-supported**: a GPT-6.1 Sol
model-selection request may return `gpt-6.1-sol`, stating these counts
and the PR-support caveat (3/4) alongside it. When a ship plan records
`review.model: gpt-6.1-sol`, the review runs as a measured route. Keep the
2026-09-30 counts (10/10 clean, 10/10 planted) and the PR-support caveat
in the internal review evidence packet; include them when answering a
model-selection question. GPT-6 Sol's measured route stays valid for plans that
name `gpt-6-sol`; neither model's calibration transfers to the other. On
2026-09-29 multi-model's standard supervisor of all-`gpt-6-luna` waves
moved to `gpt-6.1-sol` (supervisor fixture 9/9);
that is a supervisor route, not a review route. Never silently
substitute another GPT model, mix providers, or make `max` a default.
