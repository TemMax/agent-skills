#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

REFS="plugins/code-review/skills/critical-review/references"
DOSSIER="$REFS/gpt-5-6-reviewer-dossier.md"
SOL="$REFS/reviewer-gpt-5-6-sol.md"
TERRA="$REFS/reviewer-gpt-5-6-terra.md"
LUNA="$REFS/reviewer-gpt-5-6-luna.md"
GENERIC="$REFS/reviewer-generic.md"

check "dossier exists" "[ -f '$DOSSIER' ]"
check "generic profile exists" "[ -f '$GENERIC' ]"

for id in sol terra luna; do
  f="$REFS/reviewer-gpt-5-6-$id.md"
  check "$id profile exists" "[ -f '$f' ]"
  check "$id exact guard" "grep -qF 'gpt-5.6-$id' '$f'"
  check "$id stops mismatched reader" "grep -qF 'stop using this profile' '$f'"
  check "$id has Review method" "grep -q '^## Review method' '$f'"
  check "$id has Not measured" "grep -q '^## Not measured' '$f'"
  check "$id has Common mistakes" "grep -q '^## Common mistakes' '$f'"
  check "$id requires diff code test evidence" "grep -qi 'diff.*code.*tests' '$f'"
  check "$id does not make suspicion a blocker" "grep -qi 'suspicion.*blocker' '$f'"
done

check "dossier cites the System Card PDF" "grep -qF 'gpt-5-6.pdf' '$DOSSIER'"
check "no judge hierarchy warning retained" \
  "grep -qF 'No Sol/Terra/Luna cross-model judge or self-preference matrix is published.' '$DOSSIER'"
check "dossier says CTF is not review proof" \
  "grep -qF 'CTF capability is not proof of review accuracy.' '$DOSSIER'"
check "dossier keeps Sol pages Sol-only" "grep -qF 'Sol-only evidence (pp. 19–24)' '$DOSSIER'"
check "Terra high reviews Luna output" \
  "grep -qF '| Luna output | Terra | \`high\` | uncalibrated blind-test candidate |' '$DOSSIER'"
check "Terra high reviews Sol output" \
  "grep -qF '| Sol output | Terra | \`high\` | uncalibrated blind-test candidate |' '$DOSSIER'"
check "Sol high reviews Terra output" \
  "grep -qF '| Terra output | Sol | \`high\` | uncalibrated blind-test candidate |' '$DOSSIER'"
check "dossier routes release policy to dated blind matrix" \
  "grep -qF 'The dated blind evaluation matrix is the only authority for release routing.' '$DOSSIER'"
check "Luna requires stronger independent reviewer" \
  "grep -qF 'must not independently review security-sensitive or irreversible changes without a stronger independent reviewer' '$LUNA'"
check "generic profile has no identity guess" "grep -qF 'Do not infer a model identity' '$GENERIC'"
check "generic profile has no effort guess" "grep -qF 'Do not infer effort' '$GENERIC'"
check "generic reviewer requires file or line evidence" "grep -qF 'file/line evidence' '$GENERIC'"
check "generic reviewer requires a concrete failure scenario" "grep -qF 'concrete failure scenario' '$GENERIC'"
check "generic reviewer keeps suspicion non-blocking" "grep -qF 'Suspicion is never a blocker' '$GENERIC'"

summary
