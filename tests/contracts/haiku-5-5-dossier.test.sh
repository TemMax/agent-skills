#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

DOSSIER="plugins/orchestration/skills/multi-model/references/model-dossiers.md"

one_line() { tr '\n' ' ' < "$1" | tr -s ' '; }

check "dossier has the new Haiku 5.5 cheap-executor heading" \
  "one_line '$DOSSIER' | grep -qF '## Haiku 5.5 (the cheap executor and reader — \`claude-haiku-5-5\`)'"

check "dossier marks Haiku 4.5 as a retired route kept for history" \
  "one_line '$DOSSIER' | grep -qF '## Haiku 4.5 (retired route — history; \`claude-haiku-4-5-20251001\`)'"

check "dossier uses the retired route — history wording" \
  "one_line '$DOSSIER' | grep -qF 'retired route — history'"

check "dossier cites the Haiku 5.5 SWE-bench Pro score" \
  "one_line '$DOSSIER' | grep -qF '64.8'"

check "dossier cites the Haiku 5.5 Terminal-Bench 4.0 score" \
  "one_line '$DOSSIER' | grep -qF '39.2'"

check "dossier cites the Haiku 5.5 long-context ProgramBench score" \
  "one_line '$DOSSIER' | grep -qF '82.0'"

check "dossier cites the 17.3% leaked-answer rate" \
  "one_line '$DOSSIER' | grep -qF '17.3%'"

check "dossier cites the +0.23 self-preference score" \
  "one_line '$DOSSIER' | grep -qF '+0.23'"

check "dossier cites the 1.88 input-hallucination audit score" \
  "one_line '$DOSSIER' | grep -qF '1.88'"

check "dossier cites the 137,137-token runner session baseline" \
  "one_line '$DOSSIER' | grep -qF '137,137'"

check "dossier states the 100,000 prompt tokens price threshold" \
  "one_line '$DOSSIER' | grep -qF '100,000 prompt tokens'"

check "dossier quotes the no-fallback-model safeguard" \
  "one_line '$DOSSIER' | grep -qF 'have no fallback model'"

check "dossier records the 2026-10-08 alias re-probe" \
  "one_line '$DOSSIER' | grep -qF 'Re-probed on 2026-10-08'"

check "dossier puts the Haiku 5.5 section before the Haiku 4.5 section" \
  "[ \$(grep -n '^## Haiku 5.5 ' '$DOSSIER' | head -1 | cut -d: -f1) -lt \$(grep -n '^## Haiku 4.5 ' '$DOSSIER' | head -1 | cut -d: -f1) ]"

summary
