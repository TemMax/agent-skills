#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

REPORT="tests/eval/gpt-5-6-results-2026-09-04.md"
ORCHESTRATION="plugins/orchestration/skills/multi-model/SKILL.md"
REVIEW="plugins/code-review/skills/critical-review/SKILL.md"
ORCHESTRATION_REFS="plugins/orchestration/skills/multi-model/references"
REVIEW_REFS="plugins/code-review/skills/critical-review/references"

one_line() { tr '\n' ' ' < "$1"; }

check "report records the post-fix regression" \
  "grep -qF '## Final post-fix live regression — 2026-09-05 UTC' '$REPORT'"
check "report binds the regression to the tested commit" \
  "grep -qF 'b3bbc8f76bb40bba10a1fb32203fceea171988e8' '$REPORT'"
check "report records final matrix totals" \
  "grep -qF '| Default | 87 | 63 | 24 |' '$REPORT' && grep -qF '| Critical | 204 | 162 | 42 |' '$REPORT'"
check "report records default required core scores" \
  "grep -qF '| Default | 2/8 | 0/8 | 1/8 |' '$REPORT'"
check "report records critical required core scores" \
  "grep -qF '| Critical base | 0/8 | 1/8 | 1/8 |' '$REPORT'"
check "report records final repeated review scores" \
  "grep -qF '| Sol | 5/5 | 1/5 | 2/2 | 2/2 |' '$REPORT' && grep -qF '| Terra | 1/5 | 2/5 | 2/2 | 2/2 |' '$REPORT' && grep -qF '| Luna | 2/5 | 1/5 | 2/2 | 2/2 |' '$REPORT'"
check "report records clean final infrastructure classification" \
  "one_line '$REPORT' | grep -qF 'No final row was classified as an authentication, rate-limit, model-exit, tool-unavailable, or diagnostic-publication failure.'"

check "orchestration gate uses final matrix totals" \
  "grep -qF '63/87' '$ORCHESTRATION' && grep -qF '162/204' '$ORCHESTRATION'"
check "orchestration gate keeps every GPT route unsupported" \
  "sed -n '/^### GPT-5.6 calibration gate/,/^## Overview/p' '$ORCHESTRATION' | grep -qF 'unsupported'"
check "orchestration profiles retain model-specific final core scores" \
  "one_line '$ORCHESTRATION_REFS/orchestrator-gpt-5-6-sol.md' | grep -qF '2/8 in the default matrix and 0/8 in the critical base' && one_line '$ORCHESTRATION_REFS/orchestrator-gpt-5-6-terra.md' | grep -qF '0/8 in the default matrix and 1/8 in the critical base' && one_line '$ORCHESTRATION_REFS/orchestrator-gpt-5-6-luna.md' | grep -qF '1/8 in the default matrix and 1/8 in the critical base'"

check "review gate records final repeated review scores" \
  "one_line '$REVIEW' | grep -qF 'Sol passed clean 5/5 and planted defect 1/5, Terra passed 1/5 and 2/5, and Luna passed 2/5 and 1/5'"
check "review profiles retain model-specific repeated scores" \
  "one_line '$REVIEW_REFS/reviewer-gpt-5-6-sol.md' | grep -qF 'clean 5/5 and planted defect 1/5' && one_line '$REVIEW_REFS/reviewer-gpt-5-6-terra.md' | grep -qF 'clean 1/5 and planted defect 2/5' && one_line '$REVIEW_REFS/reviewer-gpt-5-6-luna.md' | grep -qF 'clean 2/5 and planted defect 1/5'"
check "review gate remains unsupported" \
  "sed -n '/^### GPT-5.6 calibration gate/,/^## Overview/p' '$REVIEW' | grep -qF 'unsupported'"

summary
