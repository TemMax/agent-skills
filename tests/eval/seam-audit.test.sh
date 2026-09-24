#!/usr/bin/env bash
# Offline self-test for tests/eval/seam-audit.sh's scoring rules — canned
# plan and Gate 2 fixtures exercising every rule both ways. No model is
# called: every check goes through SEAM_AUDIT_SCORE_ONLY=1, which also
# exercises the lint rule against a temp repo built by the script itself.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

SCRIPT=tests/eval/seam-audit.sh
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

score() {  # plan-file gate2-file -> the whole "seam=... lint=... gate2=..." line
  SEAM_AUDIT_SCORE_ONLY=1 bash "$SCRIPT" "$1" "$2"
}
field() {  # line key -> value
  printf '%s\n' "$1" | tr ' ' '\n' | sed -n "s/^$2=//p"
}

# ---------------------------------------------------------------------------
# Shared fixtures

GOOD_GATE2="$W/good-gate2.txt"
cat > "$GOOD_GATE2" <<'TXT'
Critical path: 2 waves (format-and-helpers, then summary). Wave 1 runs 1 task; wave 2 runs 2 tasks in parallel.
TXT

# Lint-clean AND seam-pass (single combined task): doubles as the "lint
# pass" fixture and the "single combined task" seam-pass fixture.
GOOD_PLAN="$W/good-plan.md"
cat > "$GOOD_PLAN" <<'MD'
status: draft
base: pending

# Plan — row format seam

```json wave-plan
{ "waves": [
  { "wave": 1,
    "supervisor": { "model": "claude-opus-5-5", "effort": "high" },
    "tasks": [
      { "id": "combined",
        "branch": "wave/combined",
        "executor": { "model": "claude-sonnet-5", "effort": "medium" },
        "ladder": [],
        "contract": {
          "files_allowed": ["src/report.py", "src/summary.py", "tests/helpers.py", "tests/test_report.py", "tests/test_summary.py"],
          "files_forbidden": [],
          "must_run": [{ "cmd": "python -m unittest discover -s tests -t .", "evidence": "required" }],
          "forbidden_moves": ["weakening, deleting or skipping an existing test"],
          "report_must_answer": ["How does parse_rows stay in sync with format_row?"] } }
    ] }
],
  "ci": { "commands": ["python -m unittest discover -s tests -t ."], "workflows": [".github/workflows/ci.yml"] },
  "e2e": "not-applicable: not a data-transforming pipeline",
  "approvals": {}
}
```

## Task combined

Change format_row's separator to '=' and update tests/helpers.py's
parse_rows to match, so the round trip in tests/test_report.py keeps
passing; add src/summary.py and tests/test_summary.py.
MD

# A lint defect independent of repo content: an alias in place of a full
# model id, guaranteed to fail regardless of which repo --repo points at.
LINT_FAIL_PLAN="$W/lint-fail-plan.md"
cat > "$LINT_FAIL_PLAN" <<'MD'
status: draft
base: pending

```json wave-plan
{ "waves": [
  { "wave": 1,
    "supervisor": { "model": "claude-opus-5-5", "effort": "high" },
    "tasks": [
      { "id": "combined",
        "branch": "wave/combined",
        "executor": { "model": "sonnet", "effort": "medium" },
        "ladder": [],
        "contract": {
          "files_allowed": ["src/report.py", "tests/helpers.py"],
          "files_forbidden": [],
          "must_run": [{ "cmd": "true", "evidence": "required" }],
          "forbidden_moves": [],
          "report_must_answer": ["What changed?"] } }
    ] }
],
  "ci": "none: fixture repository without CI workflows",
  "e2e": "not-applicable: fixture",
  "approvals": {}
}
```

## Task combined

Uses an alias ("sonnet") instead of a full model id — must fail lint.
MD

# ---------------------------------------------------------------------------
section "seam rule — pass cases"

# 1. helper owned by the format task (exact path)
FORMAT_OWNS_HELPER="$W/seam-pass-format-owns-helper.md"
cat > "$FORMAT_OWNS_HELPER" <<'MD'
status: draft
base: pending

```json wave-plan
{ "waves": [
  { "wave": 1,
    "supervisor": { "model": "claude-opus-5-5", "effort": "high" },
    "tasks": [
      { "id": "format-row",
        "branch": "wave/format-row",
        "executor": { "model": "claude-sonnet-5", "effort": "medium" },
        "ladder": [],
        "contract": {
          "files_allowed": ["src/report.py", "tests/helpers.py", "tests/test_report.py"],
          "files_forbidden": [],
          "must_run": [{ "cmd": "true", "evidence": "required" }],
          "forbidden_moves": [],
          "report_must_answer": ["What changed?"] } },
      { "id": "add-summary",
        "branch": "wave/add-summary",
        "executor": { "model": "claude-sonnet-5", "effort": "medium" },
        "ladder": [],
        "contract": {
          "files_allowed": ["src/summary.py", "tests/test_summary.py"],
          "files_forbidden": [],
          "must_run": [{ "cmd": "true", "evidence": "required" }],
          "forbidden_moves": [],
          "report_must_answer": ["What changed?"] } }
    ] }
],
  "ci": "none: fixture",
  "e2e": "not-applicable: fixture",
  "approvals": {}
}
```

## Task format-row

format_row's separator changes to '='; tests/helpers.py's parse_rows is
updated in the same task so the round trip stays intact.

## Task add-summary

Adds src/summary.py and tests/test_summary.py.
MD
line="$(score "$FORMAT_OWNS_HELPER" "$GOOD_GATE2")"
expect "helper owned by the format task" "pass" "$(field "$line" seam)"

# 2. tests/** glob covers tests/helpers.py
GLOB_COVERS="$W/seam-pass-glob.md"
cat > "$GLOB_COVERS" <<'MD'
status: draft
base: pending

```json wave-plan
{ "waves": [
  { "wave": 1,
    "supervisor": { "model": "claude-opus-5-5", "effort": "high" },
    "tasks": [
      { "id": "format-row",
        "branch": "wave/format-row",
        "executor": { "model": "claude-sonnet-5", "effort": "medium" },
        "ladder": [],
        "contract": {
          "files_allowed": ["src/report.py", "tests/**"],
          "files_forbidden": [],
          "must_run": [{ "cmd": "true", "evidence": "required" }],
          "forbidden_moves": [],
          "report_must_answer": ["What changed?"] } },
      { "id": "add-summary",
        "branch": "wave/add-summary",
        "executor": { "model": "claude-sonnet-5", "effort": "medium" },
        "ladder": [],
        "contract": {
          "files_allowed": ["src/summary.py"],
          "files_forbidden": [],
          "must_run": [{ "cmd": "true", "evidence": "required" }],
          "forbidden_moves": [],
          "report_must_answer": ["What changed?"] } }
    ] }
],
  "ci": "none: fixture",
  "e2e": "not-applicable: fixture",
  "approvals": {}
}
```

## Task format-row

format_row's separator changes to '='; the glob tests/** covers
tests/helpers.py, which is updated in the same task.

## Task add-summary

Adds src/summary.py.
MD
line="$(score "$GLOB_COVERS" "$GOOD_GATE2")"
expect "tests/** glob covers tests/helpers.py" "pass" "$(field "$line" seam)"

# 3. single combined task covers all three paths (GOOD_PLAN)
line="$(score "$GOOD_PLAN" "$GOOD_GATE2")"
expect "single combined task covers report+summary+helpers" "pass" "$(field "$line" seam)"

section "seam rule — fail cases"

# 4. helper owned by nobody
ORPHAN_HELPER="$W/seam-fail-orphan.md"
cat > "$ORPHAN_HELPER" <<'MD'
status: draft
base: pending

```json wave-plan
{ "waves": [
  { "wave": 1,
    "supervisor": { "model": "claude-opus-5-5", "effort": "high" },
    "tasks": [
      { "id": "format-row",
        "branch": "wave/format-row",
        "executor": { "model": "claude-sonnet-5", "effort": "medium" },
        "ladder": [],
        "contract": {
          "files_allowed": ["src/report.py", "tests/test_report.py"],
          "files_forbidden": [],
          "must_run": [{ "cmd": "true", "evidence": "required" }],
          "forbidden_moves": [],
          "report_must_answer": ["What changed?"] } },
      { "id": "add-summary",
        "branch": "wave/add-summary",
        "executor": { "model": "claude-sonnet-5", "effort": "medium" },
        "ladder": [],
        "contract": {
          "files_allowed": ["src/summary.py", "tests/test_summary.py"],
          "files_forbidden": [],
          "must_run": [{ "cmd": "true", "evidence": "required" }],
          "forbidden_moves": [],
          "report_must_answer": ["What changed?"] } }
    ] }
],
  "ci": "none: fixture",
  "e2e": "not-applicable: fixture",
  "approvals": {}
}
```

## Task format-row

format_row's separator changes to '='. Mentions parse_rows so only the
structural coverage is exercised: neither task's files_allowed reaches
tests/helpers.py.

## Task add-summary

Adds src/summary.py and tests/test_summary.py.
MD
line="$(score "$ORPHAN_HELPER" "$GOOD_GATE2")"
expect "helper owned by nobody" "fail" "$(field "$line" seam)"

# 5. helper owned by the summary task only (not paired with report.py, and
#    not the single-combined-task shape either)
WRONG_OWNER="$W/seam-fail-wrong-owner.md"
cat > "$WRONG_OWNER" <<'MD'
status: draft
base: pending

```json wave-plan
{ "waves": [
  { "wave": 1,
    "supervisor": { "model": "claude-opus-5-5", "effort": "high" },
    "tasks": [
      { "id": "format-row",
        "branch": "wave/format-row",
        "executor": { "model": "claude-sonnet-5", "effort": "medium" },
        "ladder": [],
        "contract": {
          "files_allowed": ["src/report.py", "tests/test_report.py"],
          "files_forbidden": [],
          "must_run": [{ "cmd": "true", "evidence": "required" }],
          "forbidden_moves": [],
          "report_must_answer": ["What changed?"] } },
      { "id": "add-summary",
        "branch": "wave/add-summary",
        "executor": { "model": "claude-sonnet-5", "effort": "medium" },
        "ladder": [],
        "contract": {
          "files_allowed": ["src/summary.py", "tests/test_summary.py", "tests/helpers.py"],
          "files_forbidden": [],
          "must_run": [{ "cmd": "true", "evidence": "required" }],
          "forbidden_moves": [],
          "report_must_answer": ["What changed?"] } }
    ] }
],
  "ci": "none: fixture",
  "e2e": "not-applicable: fixture",
  "approvals": {}
}
```

## Task format-row

format_row's separator changes to '='.

## Task add-summary

Adds src/summary.py and tests/test_summary.py, and also owns
tests/helpers.py — but it never touches src/report.py, so the format task's
round trip still breaks.
MD
line="$(score "$WRONG_OWNER" "$GOOD_GATE2")"
expect "helper owned by the summary task only" "fail" "$(field "$line" seam)"

# 6. structural coverage holds (via a glob, so the json block itself never
#    spells "helpers.py"), but the plan text never says parse_rows or
#    helpers.py either
NO_MENTION="$W/seam-fail-no-mention.md"
cat > "$NO_MENTION" <<'MD'
status: draft
base: pending

```json wave-plan
{ "waves": [
  { "wave": 1,
    "supervisor": { "model": "claude-opus-5-5", "effort": "high" },
    "tasks": [
      { "id": "format-row",
        "branch": "wave/format-row",
        "executor": { "model": "claude-sonnet-5", "effort": "medium" },
        "ladder": [],
        "contract": {
          "files_allowed": ["src/report.py", "tests/**"],
          "files_forbidden": [],
          "must_run": [{ "cmd": "true", "evidence": "required" }],
          "forbidden_moves": [],
          "report_must_answer": ["What changed?"] } },
      { "id": "add-summary",
        "branch": "wave/add-summary",
        "executor": { "model": "claude-sonnet-5", "effort": "medium" },
        "ladder": [],
        "contract": {
          "files_allowed": ["src/summary.py", "tests/test_summary.py"],
          "files_forbidden": [],
          "must_run": [{ "cmd": "true", "evidence": "required" }],
          "forbidden_moves": [],
          "report_must_answer": ["What changed?"] } }
    ] }
],
  "ci": "none: fixture",
  "e2e": "not-applicable: fixture",
  "approvals": {}
}
```

## Task format-row

Updates the row separator and keeps the reader in sync.

## Task add-summary

Adds the new summary module and its own test file.
MD
line="$(score "$NO_MENTION" "$GOOD_GATE2")"
expect "structural coverage without any parse_rows/helpers.py mention" "fail" "$(field "$line" seam)"

# ---------------------------------------------------------------------------
section "lint rule"

line="$(score "$GOOD_PLAN" "$GOOD_GATE2")"
expect "lint-clean plan against the temp repo" "pass" "$(field "$line" lint)"

line="$(score "$LINT_FAIL_PLAN" "$GOOD_GATE2")"
expect "plan with a model alias fails lint" "fail" "$(field "$line" lint)"

# ---------------------------------------------------------------------------
section "Gate 2 rule"

line="$(score "$GOOD_PLAN" "$GOOD_GATE2")"
expect "wave shape present, no time or cost estimate" "pass" "$(field "$line" gate2)"

HAS_MINUTES="$W/gate2-has-minutes.txt"
{ cat "$GOOD_GATE2"; printf '%s\n' "Estimated wall time ~25 minutes."; } > "$HAS_MINUTES"
line="$(score "$GOOD_PLAN" "$HAS_MINUTES")"
expect "duration in minutes present" "fail" "$(field "$line" gate2)"

HAS_HOURS="$W/gate2-has-hours.txt"
{ cat "$GOOD_GATE2"; printf '%s\n' "about 2 hours."; } > "$HAS_HOURS"
line="$(score "$GOOD_PLAN" "$HAS_HOURS")"
expect "duration in hours present" "fail" "$(field "$line" gate2)"

HAS_DOLLAR_COST="$W/gate2-has-dollar-cost.txt"
{ cat "$GOOD_GATE2"; printf '%s\n' "cost about \$3."; } > "$HAS_DOLLAR_COST"
line="$(score "$GOOD_PLAN" "$HAS_DOLLAR_COST")"
expect "dollar cost present" "fail" "$(field "$line" gate2)"

HAS_USD_COST="$W/gate2-has-usd-cost.txt"
{ cat "$GOOD_GATE2"; printf '%s\n' "12 USD."; } > "$HAS_USD_COST"
line="$(score "$GOOD_PLAN" "$HAS_USD_COST")"
expect "USD cost present" "fail" "$(field "$line" gate2)"

HAS_RU_DURATION="$W/gate2-has-ru-duration.txt"
{ cat "$GOOD_GATE2"; printf '%s\n' "оценка 7–16 часов."; } > "$HAS_RU_DURATION"
line="$(score "$GOOD_PLAN" "$HAS_RU_DURATION")"
expect "Russian duration present" "fail" "$(field "$line" gate2)"

NO_WAVES="$W/gate2-no-waves.txt"
cat > "$NO_WAVES" <<'TXT'
Critical path: format-and-helpers, then summary; two tasks run in parallel.
TXT
line="$(score "$GOOD_PLAN" "$NO_WAVES")"
expect "missing the word wave/waves" "fail" "$(field "$line" gate2)"

NO_PARALLEL="$W/gate2-no-parallel.txt"
cat > "$NO_PARALLEL" <<'TXT'
Critical path: 2 waves.
TXT
line="$(score "$GOOD_PLAN" "$NO_PARALLEL")"
expect "missing the word parallel" "fail" "$(field "$line" gate2)"

summary
