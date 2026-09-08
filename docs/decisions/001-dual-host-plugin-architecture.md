# 001 — Shared plugin policy with thin host adapters

## Status

Accepted. The shipped artifacts are authoritative; model-route support is
separately gated by recorded calibration.

## Context

Claude Code and Codex expose different packaging, session identity, subagent,
and hook interfaces. Duplicating four skills into host-specific trees would
duplicate every contract and safety fix. Treating skill discovery as proof of
runtime compatibility would hide missing host capabilities.

## Decision

Keep one policy layer: `super-plan` produces plans, `multi-model` executes
supervised waves, `ship` composes the stages, and `critical-review` reviews and
handles approved fixes. Keep model knowledge in role profiles and evidence
dossiers. Adapt packaging, identity, invocation, and hook output at the host
boundary. Each plugin has matching Claude/Codex manifests and its own runtime
context hook so it can be installed independently.

Resolve exactly one active-seat profile from current plugin-scoped runtime
context and host session metadata. Exact identity wins; without an exact ID,
bare host-supplied `GPT-6` may select Astra by compatibility (decision 005).
Missing, unsupported, or conflicting identity otherwise selects generic.
Runtime context normalizes `gpt-5.6` to `gpt-5.6-sol`; that
alias is not a legal plan model. Configuration defaults cannot establish the
active session's identity. Unknown identity or effort stays unknown; a child's
context identifies the child, not its parent.

Claude waves invoke the shipped Workflow runner. Codex waves use native
subagents coordinated by the shipped state helper. The common plan linter
rejects mixed/unknown-provider waves and executor/supervisor collisions before
launch. A missing execution capability is reported with preserved artifacts;
it cannot be replaced with a fabricated result.

Profiles guide plan authoring and explicit amendments. A lint-clean plan
explicitly approved by the user controls execution through its exact provider,
model, and effort fields. An adapter must not re-route that approved artifact
against a seed recommendation. This distinction does not waive plan validation.

Production routing requires measured evidence, not model size or a seed table.
The dated GPT-5.6 calibration currently qualifies no production route; its
counts, thresholds, and limitations remain in the retained result report and
profiles. Unsupported routing decisions go upward. `max` is never an automatic
default. Research agents also receive an explicit model and an evidence-bearing
task; synthesis and decisions remain with the orchestrator.

The Stop drift hook retains the active-plan, branch, and deduplication gates.
Claude receives a transcript window; Codex uses its supported plan/state/branch
and last-message inputs. Codex chooses a different judge from exact identity;
unknown identity does not imply a strongest-model default. Judge failure is
visible as unavailable and fails open for continuation, never as a clean
verdict. Recursion guards prevent nested judges from looping. Surfaces without
lifecycle hooks do not gain hook enforcement merely by loading the skills.

## Consequences

Shared policy avoids duplicate fixes while adapters remain independently
testable. Generic fallback preserves usable safety guidance at reduced routing
precision. Adapter availability and offline correctness do not qualify a model
route; paid calibration remains a separate evidence-producing operation.
Completed implementation history belongs in Git, not in active-plan storage.

## Implementation anchors

- [Orchestration manifests and runtime](../../plugins/orchestration/),
  [code-review plugin](../../plugins/code-review/), and
  [Codex marketplace](../../.agents/plugins/marketplace.json).
- [Multi-model policy and routing](../../plugins/orchestration/skills/multi-model/SKILL.md),
  [runtime context](../../plugins/orchestration/hooks/runtime-context), and
  [drift hook](../../plugins/orchestration/hooks/drift-check).
- [Claude dossiers](../../plugins/orchestration/skills/multi-model/references/model-dossiers.md),
  [GPT orchestration dossier](../../plugins/orchestration/skills/multi-model/references/gpt-5-6-dossier.md),
  [GPT reviewer dossier](../../plugins/code-review/skills/critical-review/references/gpt-5-6-reviewer-dossier.md), and
  [dated calibration](../../tests/eval/gpt-5-6-results-2026-09-04.md).
- [Platform contract checks](../../tests/contracts/platform-routing.test.sh) and
  [runtime-context checks](../../tests/contracts/runtime-context.test.sh).
