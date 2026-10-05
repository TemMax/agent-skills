# Phase context package (4.9.0 / 1.16.0)

Before paid calls, `phase-context-live.py --prepare --out <fresh-dir>` freezes
both plugin trees, prompts, expected outcomes and disposable repositories. The
baseline is merged `9c90cf1`; the candidate copies current files, including
uncommitted edits. Installed Git marketplaces/caches are untouched.

The same three-turn research → verification → local review dialogue runs once
per host and arm. Both review defects must be found: README says fifteen minutes
but CI uses ten; the negative-input validator guard is removed despite **41 green
tests**. Product files and HEAD must stay unchanged, repository instructions must
be observed, ordinary messages must stay quiet and no children may run. Candidate
research/verification skips full planning/delivery workflows. Local review loads
PROFILE and REVIEW, with no PR or FIXES load.

Four additional candidate cases per host check the phase boundaries:

- Existing draft plan: load the full planning workflow and run the shipped linter.
- Read-only PR review: real host/model with a read-only GitHub service fixture;
  read both thread pages and save complete IDs/permissions before the fixture
  releases the diff. Find both defects; no fix phase or outward writes.
- Authorized fix preflight: delegated execution is unavailable; load FIXES and
  stop before changes, without premium authorization or inline implementation.
- Complete ship request: load the delivery workflow; dirty working tree blocks
  Stage 0 before branch creation or another stage.

By default only candidates are prepared: **14 initial calls** for both hosts,
with four targeted follow-ups at most (18-call, 2,000,000-token, $6 reported
Claude budget). `--cases` selects only affected scenarios on both hosts; preparing
fixtures makes no model calls. `--providers` narrows a host-specific change;
shared instruction changes still require both hosts. `--include-baseline` adds the two old three-turn
dialogues for an explicit A/B experiment: 20 initial calls, four follow-ups,
24-call / 3,000,000-token aggregate limit. Do not repeat baselines on every fix.

No automatic retries, fresh-result overwrites or full-matrix reruns. One shared
`budget.json` persists failures as well as successes. Per-call timeout is 150
seconds. Pending/unknown usage blocks new launches. Each Claude launch receives
its remaining USD allowance. The token limit is a post-call stop guard: one call
can overshoot it; Codex has no server-enforced token ceiling here. Codex totals
require matching owned rollout counters and subtract only earlier counters in
the same session. A known forbidden delegation route can stop before repository
interaction; project instructions are required before any repository use.

The first recorded A/B run started at 22 calls / 2M tokens and was explicitly
extended after observed failures/usage, preserving all spent records. That run's
full chronology and final 24-call usage are in the dated result report.

The blocked fix and ship cases do not prove full positive delivery or fix
execution. Runner/recovery code and moved policy paragraphs must remain intact;
existing first-package execution evidence is historical, not a new result.
Discovery metadata/paths stay the same. Normal installed loading is checked only
from Git after an explicitly authorized merge.

```sh
python3 tests/eval/phase-context-live.py --prepare --cases pr-review --out /private/tmp/phase-context-candidate
python3 tests/eval/phase-context-live.py --out /private/tmp/phase-context-candidate --run claude-new-pr-review
# Run the remaining declared labels individually; inspect any failure first.
```
