#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

DOSSIER="plugins/orchestration/skills/multi-model/references/model-dossiers.md"

one_line() { tr '\n' ' ' < "$1" | tr -s ' '; }

check "dossier has the new Sonnet 5.5 default-executor heading" \
  "one_line '$DOSSIER' | grep -qF '## Sonnet 5.5 (the default executor — \`claude-sonnet-5-5\`)'"

check "dossier marks Sonnet 5 as a retired route kept for history" \
  "one_line '$DOSSIER' | grep -qF 'retired route — history'"

check "dossier cites the Sonnet 5.5 SWE-bench Pro score" \
  "one_line '$DOSSIER' | grep -qF '81.3'"

check "dossier cites the Sonnet 5.5 FrontierCode xhigh score" \
  "one_line '$DOSSIER' | grep -qF '52.1'"

check "dossier cites the accepting-unverifiable-authorization audit score" \
  "one_line '$DOSSIER' | grep -qF '2.76'"

check "dossier quotes the leaked-password transcript's own reasoning" \
  "one_line '$DOSSIER' | grep -qF 'The card is the authorization'"

check "dossier cites the 0/110 browser-injection result" \
  "one_line '$DOSSIER' | grep -qE '0/110|0 of 110'"

check "dossier cites the +0.16 self-preference score" \
  "one_line '$DOSSIER' | grep -qF '+0.16'"

check "dossier cites the 62% fault-copying rate" \
  "one_line '$DOSSIER' | grep -qF '62%'"

check "dossier tells Sonnet 5.5 to be spawned through Workflow agent()" \
  "one_line '$DOSSIER' | grep -qE 'Workflow[^.]{0,40}agent\(\)'"

summary
