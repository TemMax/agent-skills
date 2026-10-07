---
name: ship
description: 'Use when the user wants the complete delivery pipeline from planning through a reviewed pull request. Do not use for a single planning, implementation, or review stage, and never merge. Keep skill names and instruction/profile filenames/loading out of updates, including before loading; state the task.'
metadata:
  author: https://github.com/TemMax
  version: 4.15.0
---

# Shipping a Feature (ship)

## Before repository work

Before repository reads or commands, silently locate AGENTS.md and CLAUDE.md and read
files in full unless already in context. Claude Code loading CLAUDE.md
is not evidence that AGENTS.md was loaded. Read-only lookups follow this step too.

Resolve relative resource paths from this SKILL.md's physical directory. Resolve a symlinked skill directory to its target first; repository cwd is not the base for the profile and reference paths below.

### User-facing communication

Do not narrate loading or selecting internal instructions. Say which task or
check you will perform.

Start with the task and next useful action. Progress and completion messages
cover changes, findings, checks, and remaining blockers. Select profiles silently;
keep active-seat model, effort, selection basis, runtime metadata, model names
attached to checks, and calibration counts out of routine messages. This rule
also governs profile-specific communication instructions.

A generic profile is selected silently too. Do not announce its selection,
missing runtime identity, calibration status or internal profile/workflow
filenames in routine messages. Report any concrete check or judgment that
remains unverified.

Keep exact model IDs, effort, routing evidence and calibration limits in internal
records and approval artifacts where the user must choose a route or authorize
premium use. When the user asks a model-selection question or requests routing
diagnostics, answer it with the relevant evidence and limits. When a route cannot
provide a required judgment, explain the practical limit and the next step.
Ordinary review summaries describe task evidence and checks left unverified.

## Process scope and context

Reuse loaded instructions while their content version and the needed context
remain available; recover only the missing section after compaction, or reload
an explicitly changed version. Applying a skill again does not require reading
it again. Required repository instructions still apply.

Keep one owner of the current phase. Inside an approved parent workflow, this
skill performs its assigned phase without starting another design/plan gate.
Reuse confirmed decisions and authorization for the same task, roles, access
and delivery scope. Ask only for a new decision or an actual scope/budget change.
Start with targeted reads and bounded error excerpts; retain full logs by path
and expand reads when needed to establish evidence.

Load applicable repository instructions once if they are not already in context;
a narrow artifact or phase scope does not exclude those instructions.
For an explicitly bounded read-only or verification phase, report related
inconsistencies as findings and finish after its assigned checks. Do not end with
an offer to start another phase or make extra edits, or a question reopening that
agreed scope. Unresolved new product choices still follow the planning rules.

Before any phase, locate applicable AGENTS.md and CLAUDE.md instructions.
Read them if their full content is not already in context; a grep of task facts
does not establish that repository instructions were loaded.

## Load only the assigned phase

For an explicitly assigned verification-only phase inside an approved workflow,
run only the named checks against the identified artifact, retain evidence and
report their results and related inconsistencies. Stop after those checks;
no new planning, branch, execution, review or publication phase is implied.
This bounded phase does not need an active-seat profile.

For the complete delivery pipeline or any transition to planning, execution,
review, recovery, integration or publication, load [WORKFLOW.md](WORKFLOW.md)
once before acting. Its preflight, profile selection, branch authorization,
canonical skill invocations, review routing and failure handling are mandatory.
ship adds no machinery: invoke the named stage skill rather than reproducing it.
The merge stays with the user. Never merge a pull request into the default branch.

## Phase handoff

Keep the handoff compact and evidence-based: identify the skill/content version,
repository and commit or diff range, assigned scope and existing authorization,
completed phase and next owner. List required checks with their actual command,
result and evidence path; retain unresolved requirements and unverified checks.
Do not paste entire logs or instruction files. A handoff locates evidence; it
never replaces reading the artifact, independent review, required final gates,
or proving that reused checks cover the same artifact and environment.
