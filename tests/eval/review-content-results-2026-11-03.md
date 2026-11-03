# critical-review grading rules — live results, 2026-11-03

Code-review 1.20.0 candidate (working tree) adapts superpowers 6.4.1 into
critical-review: behavior the requirements do not name is judged by what a
reasonable user expects, a defect the plan requires is still a finding
(`plan-mandated`), and a `Set aside` list follows the table. Driver:
`tests/eval/review-content-live.py`; expectations were frozen in each run's
`expected.json` before the host started. Baseline: code-review 1.19.0
(`git archive HEAD`, 9d4326b).

Loading: Claude Code 2.1.316 with the snapshot as `--plugin-dir` and
`--setting-sources project`; Codex CLI 0.166.0 with `--ignore-user-config
--disable plugins` and the snapshot's skill linked under `.agents/skills`.
Each trace shows the arm's own `critical-review/REVIEW.md` read with its
marker phrase. No installed plugin was touched. Models: Claude
`claude-sonnet-5-5`, Codex `gpt-6.1-sol`, both at `medium`. One run per cell.

Round 1 ran the first candidate text; round 2 ran the final text (after the
independent review: plan-mandated covers "behavior a reasonable user would
call wrong", disputed threads are checked after the code is read, ship asks
before a set-aside fix widens the scope).

| Case | Host | 1.19.0 | Candidate round 1 | Candidate round 2 (final) |
|---|---|---|---|---|
| implied (crash on no reviews) | Claude | Important, no Set aside | Important, Set aside | pass: Important, Set aside |
| implied | Codex | Important, no Set aside | Important, `Set aside: none` | pass: Important, Set aside |
| plan (plan mandates 0.0 for no reviews) | Claude | Important, unlabeled, no Set aside | pass: Important `plan-mandated`, Set aside | pass: same |
| plan | Codex | clean, no finding | **fail**: clean, the 0.0 called "planned behavior" | pass: Important `plan-mandated`, Set aside |

What this shows:

- The new rule changed one outcome: Codex accepted a plan-mandated wrong
  result as "planned" under 1.19.0 and under the first candidate text, and
  reported it Important `plan-mandated` once the rule said that matching the
  plan does not prove the plan right and named user-facing behavior.
- The implied-input crash was already graded Important by both hosts under
  1.19.0 on this fixture, so the tier rule shows no measured difference here;
  upstream's Minor grading did not reproduce.
- The `Set aside` line appears only with the candidate (4/4 final runs, 0/4
  baseline runs).
- No run changed a file or moved HEAD. Each review cost about $0.12 on
  Claude (23–31 s) and 200–265k input tokens on Codex (43–92 s); the
  candidate added no measurable cost.

Driver corrections, disclosed: round 1's analyzer matched `ratings.py`
inside `tests/test_ratings.py` and failed Claude implied on a test-file row;
the analyzer now reads only the findings table, the Tier cell and the module
path, and round 1 was re-scored with it (the table shows re-scored values).
The round-2 Codex implied run read REVIEW.md by its snapshot path rather
than the workspace link, which the load check first rejected; the check now
accepts either, and the run was re-scored (marker present).

Existing tier `tests/eval/critical-review.sh` on Codex `gpt-6.1-sol` at
`medium`, round-1 text (the clean, planted-defect and PR-gate prompts carry
SKILL.md and the profile, so they test regressions, not the new rules):
clean-diff, planted-logic-defect, pr-gate-withheld and pr-gate-approved all
pass.

Not run live: the PR disputed-thread flow (no fixture with a real PR and a
wrong reviewer request), ship's Set aside routing, and the test-output-noise
rule. One run per cell — the counts are not rates.
