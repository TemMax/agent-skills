# Seam-audit fixtures baseline, 2026-10-04

Baseline of the seam-audit step measured with `tests/eval/seam-audit-fixtures.sh`
before the third wave of fixture work. It records what the audit agent does on
the eight fixtures under `tests/eval/fixtures/seam-audit/` with no changes to
the audit prompt.

## Setup

- Runner: `tests/eval/seam-audit-fixtures.sh`, one live model call per fixture
  and repetition, scored from the `json seam-verdict` block of the answer.
- Routes, both at effort `medium`:
  - Claude: `--provider claude`, model `claude-sonnet-5-5`, Claude CLI 2.1.289.
  - Codex: `--provider codex`, model `gpt-6.1-sol`, codex-cli 0.160.0.
- Repetitions: 3 per fixture per route, so 24 runs per route and 48 in total.
- Fixtures: 6 `defect` fixtures (each must name its `must_name` string in a
  blocking entry) and 2 `clean` fixtures (`clean-simple`, `clean-decoy`; each
  must report `"blocking": []`, and `clean-decoy` must not name
  `constants.py` or `shop/__init__.py`).
- Prompts and answers were kept with `SEAM_FIXTURES_KEEP_DIR`; the rows were
  collected with `SEAM_FIXTURES_RESULTS`.

## Results

Cells are `p/f/e` (pass / fail / error) out of 3 repetitions.

| Fixture | Check | Claude Sonnet 5.5 | GPT-6.1 Sol |
|---|---|---|---|
| base-status-wrong | base-status | 3/0/0 | 3/0/0 |
| clean-decoy | none (clean) | 3/0/0 | 3/0/0 |
| clean-simple | none (clean) | 3/0/0 | 3/0/0 |
| pinned-doc-phrase | same-task-readers | 3/0/0 | 3/0/0 |
| pinned-output-test | same-task-readers | 3/0/0 | 3/0/0 |
| prose-vs-forbidden | prose-vs-forbidden-moves | 3/0/0 | 3/0/0 |
| sibling-producer | producer-before-consumer | 3/0/0 | 3/0/0 |
| unlisted-fake | implementers-and-fakes | 3/0/0 | 3/0/0 |
| **Total** | | **24/0/0** | **24/0/0** |

Per-route totals from the runner: `pass=24 fail=0 error=0` for each route.

## Notable misses

None. No `must_name` string was missed on any defect fixture, and neither
clean fixture drew a blocking entry on either route. Every verdict block
parsed (no `error`).

The clean answers did carry non-scored `notes`, which are not part of the
score. For example both routes noted that the plan header says `base: pending`
(Claude: "fill the real base SHA (db3dba4) before launch"), and Sol on
`clean-decoy` listed `shop/constants.py` and `shop/__init__.py` as files read,
only in `notes`, not as a blocking entry.

## Conclusions

- Both routes passed all 24 runs, so on these eight fixtures at n=3 neither
  route shows a miss or a false positive.
- The baseline is saturated: with no failures there is no signal to rank the
  routes, and a 24/24 result at n=3 does not bound the true failure rate
  tightly (it is consistent with a failure rate of up to roughly 12%).
- The fixtures do not yet discriminate between these two routes. Harder
  fixtures, or other routes, are needed before the score can show a regression
  or an improvement.
- The result covers the audit prompt as it stands at this commit and one
  repetition setting; it says nothing about other effort levels or models.

## Reproduction

```bash
# offline validation, no model call
tests/eval/seam-audit-fixtures.sh --check

# live runs (real model calls), 3 repetitions per fixture
SEAM_FIXTURES_RESULTS=results.tsv SEAM_FIXTURES_KEEP_DIR=keep \
  tests/eval/seam-audit-fixtures.sh --provider claude --model claude-sonnet-5-5 --effort medium --repeat 3
SEAM_FIXTURES_RESULTS=results.tsv SEAM_FIXTURES_KEEP_DIR=keep \
  tests/eval/seam-audit-fixtures.sh --provider codex --model gpt-6.1-sol --effort medium --repeat 3
```
