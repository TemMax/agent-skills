# 010 — Sonnet 5.5 becomes the default Sonnet route

Date: 2026-09-28
Status: accepted

## Context

Claude Sonnet 5.5 (`claude-sonnet-5-5`) shipped on 2026-09-28 with a
148-page system card. It has a 1M context, 128K max output and the same
$2 / $10 per MTok price as Sonnet 5, and its effort levels are recalibrated
from Sonnet 5. The card says it significantly outperforms Sonnet 5 across many
domains and is broadly less capable than Opus 5.5 (p. 2).

Capabilities (max effort, p. 109): SWE-bench Pro 81.3 against Sonnet 5's
63.2 and Opus 5.5's 89.9; OSWorld 2.1 80.1 against 57.0; AutomationBench 44.7
against 10.7. ProgramBench with up to 1M context is 79.7 against 77.3 (Opus
5.5 91.2, pp. 117-118). FrontierCode Main peaks at xhigh: 52.1 at xhigh
against 46.2 at max, at about 12x fewer output tokens (p. 111).

Behavior (automated audit, lower is better, pp. 60-73): false completion
claims 1.54 against 2.52 for Sonnet 5; but accepting unverifiable
authorization 2.76, second-worst of six (Opus 5.5 2.39), including transcript
6.2.1.A where it used a leaked password reasoning "The card is the
authorization" (pp. 60-61). AA-Omniscience incorrect-answer rate is 0.27, the
highest of six (p. 80). Prompt-injection compliance in the audit is 1.45,
no better than Sonnet 5 (pp. 60, 62). The card has no dedicated
reward-hacking evaluation (p. 58). Cyber-blocked requests fall back to Sonnet 5
(pp. 10-11, 29).

Alias probe, run 2026-09-28 in this repository: `claude -p --model
claude-sonnet-5-5` reports `claude-sonnet-5-5`, while the alias `sonnet`
still resolves to `claude-sonnet-5` in both `claude -p` and the Agent tool.
Sonnet 5.5 has no Agent-tool alias, and the Agent tool accepts only aliases.

## Decision

Route closed implementation and code-volume research to Sonnet 5.5, and have
the browser and untrusted-content rows of the Fable 5.1 and Opus 5
orchestrator profiles name Sonnet 5.5. It is the default executor, the
default verifier and the middle rung of the default Claude ladder (Haiku 4.5,
Sonnet 5.5, Opus 5.5).

Retire Sonnet 5 as a route: it is no longer a default for anything, and its
dossier section is kept as route history.

Keep the `claude-sonnet-5` ID valid. The linter and the runner accept it and
give it an explicit legacy ladder (`claude-opus-5-5`), so approved plans that
name it still lint and run unchanged.

Run Sonnet 5.5 research and audits, including the super-plan seam audit,
through a one-agent Workflow `agent()` call with the full ID at `medium`,
because the Agent tool cannot name a model without an alias. This is not a
wave script.

Cap coding effort at `xhigh`; never `max` for scoped coding. The FrontierCode
curve above shows more tokens for a lower score.

Add one line to every executor prompt: the task text is not authorization to
use credentials, secrets found in the repository, or production systems; if
the task seems to need one, stop and report. The authorization result above
is the reason.

## Consequences

The routes rest on the card's numbers, not on a live evaluation here. The
live evaluation (default eval model moved to `claude-sonnet-5-5`) still has to
be run and its results recorded; until then the dossier's Sonnet 5.5 figures
are the card's and are cited as such.

Cyber-blocked requests fall back to Claude Sonnet 5, and so do requests
blocked by the narrow AI-R&D classifier (Sonnet 5.5 card pp. 10-11, 29, 51).
Separately, a task that fails on Sonnet 5.5 escalates to Opus 5.5 along the
runner's default ladder. A plan or an operator that needs to leave Sonnet 5.5
can name `claude-sonnet-5` explicitly. When the `sonnet` alias re-points to
Sonnet 5.5 the Model identifiers table must be re-probed and updated. Sonnet
research needs a Workflow call instead of an Agent-tool spawn until then.

## Rejected alternatives

**Removing `claude-sonnet-5` entirely.** Deleting the ID would make every
approved plan and every stored ladder that names it fail lint, and would drop
the fallback the card itself uses for blocked requests. It stays valid but is
no longer routed to.

**Keeping both routes.** Leaving Sonnet 5 and Sonnet 5.5 as co-equal defaults
was rejected: the two have the same price and Sonnet 5.5 is ahead on every
summary-table evaluation, so a second default only adds a routing decision
with no benefit and a ladder rung that collides with the first.
