#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

REFS="plugins/code-review/skills/critical-review/references"
f="$REFS/reviewer-gpt-6-1-sol.md"
d="$REFS/gpt-6-1-sol-reviewer-dossier.md"
CR="$(contract_source plugins/code-review/skills/critical-review/SKILL.md)"

check "gpt-6.1-sol reviewer profile exists" "[ -f '$f' ]"
check "gpt-6.1-sol reviewer dossier exists" "[ -f '$d' ]"
check "gpt-6.1-sol reviewer exact guard" "grep -qF 'gpt-6.1-sol' '$f'"
check "gpt-6.1-sol reviewer stops mismatched reader" "grep -qF 'stop using this profile' '$f'"
check "gpt-6.1-sol reviewer has Review method" "grep -q '^## Review method' '$f'"
check "gpt-6.1-sol reviewer has Not measured" "grep -q '^## Not measured' '$f'"
check "gpt-6.1-sol reviewer has Common mistakes" "grep -q '^## Common mistakes' '$f'"
check "gpt-6.1-sol reviewer requires diff code test evidence" \
  "perl -0777 -ne 'exit(/diff.{0,120}?code.{0,120}?tests/is ? 0 : 1)' '$f'"
check "gpt-6.1-sol reviewer does not make suspicion a blocker" \
  "perl -0777 -ne 'exit(/suspicion.{0,120}?blocker/is ? 0 : 1)' '$f'"
check "gpt-6.1-sol reviewer mentions uncalibrated" "grep -qi 'uncalibrated' '$f'"
check "gpt-6.1-sol reviewer dossier cites the PDF" "grep -qF 'oai_GPT_6_1_Sol.pdf' '$d'"
check "critical-review table routes gpt-6.1-sol" \
  "grep -qF '| \`gpt-6.1-sol\` | \`references/reviewer-gpt-6-1-sol.md\` |' '$CR'"
check "critical-review has the GPT-6.1 Sol status section" \
  "grep -qF '### GPT-6.1 Sol — 2026-09-29 and 2026-09-30 UTC' '$CR'"
check "code-review files do not link to orchestration" \
  "! grep -rn 'plugins/orchestration' '$f' '$d'"

check "critical-review records the GPT-6.1 Sol strict-gate counts" \
  "grep -qF 'clean 4/5 and 5/5' '$CR'"
check "critical-review keeps the supervisor route apart from review" \
  "grep -qF 'that is a supervisor route, not a review route' '$CR'"
check "gpt-6.1-sol reviewer verdict uses the word clean" \
  "grep -qF 'the word clean' '$f'"
check "gpt-6.1-sol dossier records the single measurement" \
  "grep -qF 'Measured once, 2026-09-29' '$d'"

check "critical-review declares the GPT-6.1 Sol review route measured-supported" \
  "tr '\\n' ' ' < '$CR' | tr -s ' ' | grep -qF 'The GPT-6.1 Sol review route is now **measured-supported**'"
check "gpt-6.1-sol reviewer profile says measured-supported" \
  "tr '\\n' ' ' < '$f' | tr -s ' ' | grep -qF 'measured-supported'"
check "gpt-6.1-sol dossier records the re-measurement" \
  "tr '\\n' ' ' < '$d' | tr -s ' ' | grep -qF 'Re-measured 2026-09-30'"

summary
