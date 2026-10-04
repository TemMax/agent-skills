# Seam-audit fixture expectations

One entry per fixture directory. Each fixture is a ready, lint-clean wave plan
(`plan.md`), a mini repository at the plan's base (`repo/`) and a `score.json`
with the expected verdict. `expect` is `defect` (the audit must report a
blocking entry naming every `must_name` string) or `clean` (the audit must
report `"blocking": []`). Matching is case-insensitive over the blocking
entries only; notes are not scored. `must_not_name` strings must not appear in
any blocking entry.

## base-status-wrong

- expect: `defect`
- audit check: `base-status`
- Planted defect: the plan claims the `must_run` `unittest tests.test_parse`
  is green at base, but `tests/test_parse.py` already imports and tests
  `parse_line`, which does not exist yet, so the command fails at base.
- must_name: `test_parse`
- must_not_name: none

## clean-decoy

- expect: `clean`
- audit check: `none`
- Why it is sound: the two tasks touch disjoint files, neither uses what the
  other adds, and both only read `shop/constants.py` and `shop/__init__.py`,
  which the plan lists as forbidden and nobody changes. The shared import of
  `constants.py` is a decoy, not a seam.
- must_name: none
- must_not_name: `constants.py`, `shop/__init__.py`

## clean-simple

- expect: `clean`
- audit check: `none`
- Why it is sound: one task adds a function and its tests to a module whose
  only reader is the test file in `files_allowed`; the base status (green) is
  true and nothing else depends on the change.
- must_name: none
- must_not_name: none

## pinned-doc-phrase

- expect: `defect`
- audit check: `same-task-readers`
- Planted defect: the task rewrites a sentence in `docs/setup.md`, but
  `tests/test_setup_doc.py` asserts that exact old sentence and is neither in
  `files_allowed` nor run, so the rewrite breaks a test the task cannot touch.
- must_name: `test_setup_doc`
- must_not_name: none

## pinned-output-test

- expect: `defect`
- audit check: `same-task-readers`
- Planted defect: the plan calls the new `owner` key "purely additive", but
  `tests/test_summary.py` compares `status_summary`'s whole return dict for
  equality, so adding a key breaks it; the test is not in `files_allowed` and
  the `must_run` runs a different test module.
- must_name: `test_summary`
- must_not_name: none

## prose-vs-forbidden

- expect: `defect`
- audit check: `prose-vs-forbidden-moves`
- Planted defect: the task prose tells the executor to edit
  `test_limit_value` in the existing test file, while `forbidden_moves`
  forbids "changing or deleting an existing test", so the prose and the
  contract contradict each other.
- must_name: `test_ratelimit`
- must_not_name: none

## sibling-producer

- expect: `defect`
- audit check: `producer-before-consumer`
- Planted defect: `docs-json-flag` must paste the real output of
  `python3 -B -m src.wc --json`, which exists only after `cli-json-flag`
  lands, yet both tasks sit in the same wave, so the consumer runs before its
  producer is merged.
- must_name: `docs-json-flag`
- must_not_name: none

## unlisted-fake

- expect: `defect`
- audit check: `implementers-and-fakes`
- Planted defect: the task adds an abstract method `delete` to `Store`, but
  `tests/fakes.py` defines `FakeStore(Store)` without it and is not in
  `files_allowed`, so `FakeStore` can no longer be instantiated and the tests
  that use it break.
- must_name: `FakeStore`
- must_not_name: none
