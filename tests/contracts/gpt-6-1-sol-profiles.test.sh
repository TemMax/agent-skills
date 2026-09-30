#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

REFS="plugins/orchestration/skills/multi-model/references"
P="$REFS/orchestrator-gpt-6-1-sol.md"
D="$REFS/gpt-6-1-sol-dossier.md"

check "profile exists" "[ -f '$P' ]"
check "dossier exists" "[ -f '$D' ]"

check "profile exact guard" "grep -qF '\`gpt-6.1-sol\`' '$P' && grep -qF 'stop using this profile' '$P'"
check "profile has Not measured" "grep -q '^## Not measured' '$P'"
check "profile has Common mistakes" "grep -q '^## Common mistakes' '$P'"
check "profile requires artifacts" "grep -qF 'diff, commit, command output' '$P'"
check "profile links shared routing" "grep -qF 'codex-routing.md' '$P'"
check "profile supervisor choice" \
  "grep -qF 'chosen at Gate 1' '$P' && grep -qF 'the premium \`gpt-6-astra\`' '$P' && grep -qF 'the standard \`gpt-6.1-sol\`' '$P'"
check "profile requires Astra for a Sol executor" "grep -qF 'A wave with a Sol' '$P' && grep -qF 'needs Astra' '$P'"
check "profile cites card rates" "grep -qF '23.5%' '$P' && grep -qF '1.50%' '$P'"
check "profile has no unsupported return" "! grep -qF 'Return \`unsupported\`' '$P'"

check "dossier cites the PDF" "grep -qF 'oai_GPT_6_1_Sol.pdf' '$D'"
check "dossier Coding Deception row" "grep -qF '| Coding Deception | 1.50% | 1.30% | 0.51% |' '$D'"
check "dossier environment warning row" "grep -qF '| Fails to stop at an environment warning | 23.5% | 64.4% | 17.4% |' '$D'"
check "dossier has Unmeasured properties" "grep -qF '## Unmeasured properties' '$D'"
check "dossier has Local measurements section" "grep -qF '## Local measurements (2026-09-29)' '$D'"
check "dossier records the strict gate clean result" "grep -qF 'clean 4/5 and 5/5' '$D'"
check "dossier cached input price" "grep -qF '\$0.10' '$D'"

summary
