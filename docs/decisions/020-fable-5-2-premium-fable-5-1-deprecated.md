# 020 — Fable 5.2 is the premium Claude model; Fable 5.1 is deprecated

Date: 2026-11-13
Status: accepted; replaces decision 019's points 1 and 4

## Context

- Decision 019 (2026-11-10) made Fable 5.2 (`claude-fable-5-2`) a seat only:
  the user's own orchestrator or reviewer session, never an executor, ladder
  rung, supervisor or research agent. Fable 5.1 (`claude-fable-5-1`) kept
  its premium routes.
- On 2026-11-13 a Fable 5.2 session planning a wave was asked for "надзор за
  каждой волной — Fable 5.2 medium". It refused correctly under decision 019:
  the linter rejected the ID and the runner did not know it. It offered
  Fable 5.1 instead.
- The user then decided: "fable 5.1 вообще надо пометить в нашем плагине как
  deprecated — везде заменить на fable 5.2. Надо чтобы по дефолту не
  выбирались премиум модели, но чтобы я мог попросить сам где надо
  использовать премиум модели."
- The second half already held before this change: a premium model is used
  only on the user's word (in the session or in their instruction files),
  recorded in `approvals.premium`, and the linter enforces it (decision 007).

## Decision

1. **Fable 5.2 is the premium Claude model.** It may be an executor, ladder
   rung, supervisor or research agent, always premium: only on the user's
   word, recorded in `approvals.premium`. The plan linter and the wave
   runner accept `claude-fable-5-2` at tier 3, beside Opus; the Codex wave
   state knows the ID as a Claude model, so a Codex wave that names it is
   rejected as a host mismatch rather than an unknown model.
   No default route, default ladder or standard supervisor names it, so
   without the user's word nothing changes.
2. **Fable 5.1 is deprecated.** `claude-fable-5-1` stays a valid premium ID
   so that already approved plans still execute; the linter warns on every
   use, and no routing table offers it for new plans. Its orchestrator and
   reviewer profiles stay for a session that runs on it.
3. **Fable 5.1's premium routes move to Fable 5.2,** with one exception: the
   route for untrusted content whose compromise would reach secrets or
   irreversible actions goes to Opus 5.5 (standard). On prompt injection
   Fable 5.2 is weaker than Opus 5.5 — Gray Swan IPI 0.30% / 4.09% at k=1 /
   15 against 0.07% / 0.96%, because 53% of the attacks against it were
   served by the Opus 4.8 fallback, and 89.82% of adaptive coding attacks
   succeeded against 54.61% (Fable 5.2 card pp. 85, 87).
4. **The `fable` alias may be used** for an authorized Fable 5.2 spawn
   through the Agent tool, with the usual model line in the report; Fable
   5.1 is spawned only through Workflow `agent()` with its full ID.
5. **The seat rules of decision 019 stay:** Step 0 still selects
   `orchestrator-fable-5-2.md` / `reviewer-fable-5-2.md`; every spawn from a
   Fable 5.2 seat names its model, since an unnamed spawn inherits the seat
   and would be a premium child the user did not choose; the independent
   check of a fix still runs on Opus 5.5.

## Consequences

- A plan may name `claude-fable-5-2` as a supervisor, executor or rung when
  the user asked for it; a plan that names it without `approvals.premium`
  fails lint, as Fable 5.1 did.
- Fable 5.2 executor and supervisor guidance comes from its card: `high` by
  default (early stops more likely at `low` and `medium`, the guide; requested
  work left undone in 6–13% of sessions at `medium` to `xhigh`, p. 34; FrontierCode 37.6 at
  `medium` against 45.3 at `high`, p. 209), a finishing line in every
  prompt, bounded tasks (out of context on 68% of ProgramBench tasks without
  a remaining-context count, p. 216), never telling it the code is its own.
- Price: $8 / $40 per million tokens — below Fable 5.1's $10 / $50, above
  Opus 5.5's $4 / $20 (`tests/eval/telemetry/prices.json`); the user pays it
  only where they asked.
- An authorization recorded for the deprecated Fable 5.1 covers Fable 5.2 in
  the same roles, so a pull request's later fix waves need no new word.

## Evidence and limits

- The card measures Fable 5.2 as a single agent and in teams of itself; it
  does not measure it judging another model's work as a wave supervisor or
  executing a contract under one. The live checks of this change are in
  [`tests/eval/fable-5-2-premium-results-2026-11-13.md`](../../tests/eval/fable-5-2-premium-results-2026-11-13.md).
- A headless planning run now uses a premium model the request itself names
  (super-plan's headless mode); on Codex that mode's text is unchanged.
- The tier rule (Opus and Fable are one tier) is unchanged.

## Rejected alternatives

- **Removing `claude-fable-5-1` from the linter and the runner.** Approved
  plans that name it would stop running; retired IDs have always stayed valid.
- **Moving the high-risk untrusted-content route to Fable 5.2.** Its
  injection numbers are worse than Opus 5.5's (point 3).
- **Making Fable 5.2 a default supervisor or ladder rung.** The user asked
  that premium models never be chosen by default.
