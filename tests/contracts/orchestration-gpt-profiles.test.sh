#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

REFS="plugins/orchestration/skills/multi-model/references"
DOSSIER="$REFS/gpt-5-6-dossier.md"
SOL="$REFS/orchestrator-gpt-5-6-sol.md"
TERRA="$REFS/orchestrator-gpt-5-6-terra.md"
LUNA="$REFS/orchestrator-gpt-5-6-luna.md"
GENERIC="$REFS/orchestrator-generic.md"

check "dossier exists" "[ -f '$DOSSIER' ]"
check "generic profile exists" "[ -f '$GENERIC' ]"

for id in sol terra luna; do
  f="$REFS/orchestrator-gpt-5-6-$id.md"
  check "$id profile exists" "[ -f '$f' ]"
  check "$id exact guard" "grep -qF 'gpt-5.6-$id' '$f'"
  check "$id has Not measured" "grep -q '^## Not measured' '$f'"
  check "$id has Common mistakes" "grep -q '^## Common mistakes' '$f'"
  check "$id requires artifacts" "grep -qi 'artifact' '$f'"
done

check "dossier cites the PDF" "grep -qF 'gpt-5-6.pdf' '$DOSSIER'"
check "Sol persistence pages retained" "grep -qF 'pp. 19–24' '$DOSSIER'"
check "max is not default" "grep -qF 'never the default' '$SOL'"
check "generic profile makes no identity guess" "grep -qF 'Do not infer a model identity' '$GENERIC'"

check "destructive-action values retained" \
  "grep -qF '| Destructive-action avoidance | 0.83 | 0.81 | 0.73 |' '$DOSSIER'"
check "avoidance-plus-correctness values retained" \
  "grep -qF '| Avoidance plus correctness | 0.44 | 0.37 | 0.32 |' '$DOSSIER'"
check "connector-injection values retained" \
  "grep -qF '| Connector injection robustness | 1.000 | 1.000 | 0.999 |' '$DOSSIER'"
check "search/function-injection values retained" \
  "grep -qF '| Search/function injection robustness | 0.910 | 0.946 | 0.897 |' '$DOSSIER'"
check "indirect-injection values retained" \
  "grep -qF '| Indirect injection attack success | 3.77% | 3.32% | 2.94% |' '$DOSSIER'"
check "cyber CTF values retained" \
  "grep -qF '| Internal cyber CTF | 96.67% | 91.84% | 85.19% |' '$DOSSIER'"

check "dossier labels seed hypotheses" "grep -q '^## Seed routing hypotheses' '$DOSSIER'"
check "dossier labels current docs facts" "grep -q '^## Current model-documentation facts' '$DOSSIER'"
check "dossier labels unmeasured properties" "grep -q '^## Unmeasured properties' '$DOSSIER'"
check "dossier forbids cross-family self-preference claims" \
  "grep -qF 'does not measure cross-model self-preference among Sol, Terra, and Luna' '$DOSSIER'"
check "dossier states judge bias is not measured" \
  "grep -qF 'The System Card publishes no measurement of judge bias or reviewer preference among Sol, Terra, and Luna.' '$DOSSIER'"
check "reasoning self-report is not evidence" \
  "grep -qF 'Hidden chain-of-thought and model self-report are not verification evidence.' '$DOSSIER'"

check "Luna ladder skips Terra" \
  "grep -qF 'only to Sol' '$LUNA' && ! grep -qF 'escalate to Terra' '$LUNA'"
check "Terra ladder is terminal" \
  "grep -qF 'terminal after one raised-effort rework' '$TERRA'"
check "Sol ladder is terminal" \
  "grep -qF 'terminal after one raised-effort rework' '$SOL'"
check "generic profile makes no effort guess" "grep -qF 'Do not infer effort' '$GENERIC'"

summary
