---
name: multi-model
description: 'Use when implementation work should be delegated, parallelized, or routed across Claude or Codex agents, especially when isolated worktrees and independent supervision are required. Do not use for single-agent work. Keep skill names and instruction/profile filenames/loading out of updates, including before loading; state the task.'
metadata:
  author: https://github.com/TemMax
  version: 4.12.0
---

# Orchestrating Multi-Model Development

## Before repository work

Before repository reads or commands, silently locate AGENTS.md and CLAUDE.md and read
files in full unless already in context. Claude Code loading CLAUDE.md
is not evidence that AGENTS.md was loaded. Read-only lookups follow this step too.

### User-facing communication

For a lookup, state the fact you will check and then the result. Keep instruction
loading, skipped internal steps and profile selection silent.

Start with the task and next useful action. Progress and completion messages
cover changes, findings, checks, and remaining blockers. Select profiles silently;
keep active-seat model, effort, selection basis, runtime metadata, model names
attached to checks, and calibration counts out of routine messages. This rule
also governs profile-specific communication instructions.

Keep exact model IDs, effort, routing evidence and calibration limits in internal
records and approval artifacts where the user must choose a route or authorize
premium use. When the user asks a model-selection question or requests routing
diagnostics, answer it with the relevant evidence and limits. When a route cannot
provide a required judgment, explain the practical limit and the next step.
Ordinary review summaries describe task evidence and checks left unverified.

For a single edit the user explicitly asks you to do yourself outside an active
wave, apply and verify only that edit, then finish. Skip the delegation process
below. A related documentation inconsistency is a finding, not another task;
"continue in the same scope" does not authorize changing additional files.

## Process scope and context

Reuse loaded instructions while their content version and the needed context
remain available; recover only the missing section after compaction, or reload
an explicitly changed version. Applying a skill again does not require reading
it again. Required repository instructions still apply.

Keep one owner of the current phase. Inside an approved parent workflow, this
skill performs its assigned phase without starting another design/plan gate.
Reuse confirmed decisions and authorization for the same task, roles, access
and delivery scope. Ask only for a new decision or an actual scope/budget change.
For a directly requested standalone edit, finish within the named files and
stop when the requested change is verified. Report related inconsistencies as
findings, without proposing extra edits or ending with "shall I update it?".
"Continue in the same scope" keeps the same file boundary; it does not approve
a suggested follow-up. The planning/decomposition process in WORKFLOW.md applies
to delegated work, including its documentation, not to expanding a bounded edit.
Start with targeted reads and bounded error excerpts; retain full logs by path
and expand reads when needed to establish evidence.

## Choose the current task path

For a read-only explanation, lookup, or the directly requested small standalone
edit allowed above, keep the named scope and verify that result. Skip Step 0,
profiles, routing, calibration evidence, and WORKFLOW.md: no agents are needed.
This exception does not cover review fixes or any task in an approved wave.

Before researching for decomposition, authoring or amending a wave plan, launching
agents, supervising, recovering, integrating or publishing a delegated task,
load [WORKFLOW.md](WORKFLOW.md) once. Its contracts, routing, independent review,
approval, recovery and integration rules are mandatory. Then select the one
active-seat profile at Step 0 and load only the references needed for this phase.
An approved plan keeps its exact roles; reuse its authorization. Missing context
requires only the missing section, not a restart or another planning gate.

When the user explicitly asks about routing or model selection, load the relevant
profile/routing or calibration section for that question. Reuse loaded content.
Always reply in the user's language.

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
| `claude-opus-5-5` (any context-window suffix) | `references/orchestrator-opus-5-5.md` |
| `claude-fable-5-1` | `references/orchestrator-fable-5-1.md` |
| `claude-fable-5` | `references/orchestrator-fable-5.md` |
| `claude-opus-5` (any context-window suffix) | `references/orchestrator-opus-5.md` |
| `claude-opus-4-8` (any context-window suffix, e.g. `[1m]`) | `references/orchestrator-opus-4-8.md` |
| `gpt-5.6-sol` | `references/orchestrator-gpt-5-6-sol.md` |
| `gpt-5.6-terra` | `references/orchestrator-gpt-5-6-terra.md` |
| `gpt-5.6-luna` | `references/orchestrator-gpt-5-6-luna.md` |
| `gpt-6-astra` | `references/orchestrator-gpt-6-astra.md` |
| `gpt-6-sol` | `references/orchestrator-gpt-6-sol.md` |
| `gpt-6.1-sol` | `references/orchestrator-gpt-6-1-sol.md` |
| `gpt-6-luna` | `references/orchestrator-gpt-6-luna.md` |
| unknown | `references/orchestrator-generic.md` |

The alias `gpt-5.6` selects Sol only after the runtime-context handler has
normalized it to `gpt-5.6-sol`. An exact supplied effort may be used; otherwise
effort is unknown and receives no effort-specific claim. Load the selected profile silently before planning. That profile amends the numbered steps in WORKFLOW.md; where it
amends a step, the amendment wins.

Profiles choose model and effort routes while authoring a wave plan or explicitly
amending one. Once a lint-clean plan is explicitly user-approved, its exact
provider, model, and effort fields are authoritative for adapter execution: do
not re-route or reject that approved artifact against a seed profile. This never
permits a mixed/unknown-provider wave or bypasses lint and user approval.
