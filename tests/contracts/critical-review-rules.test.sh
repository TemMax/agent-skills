#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

SKILL="plugins/code-review/skills/critical-review/SKILL.md"

one_line() { tr '\n' ' ' < "$1" | tr -s ' '; }

check "review method requires waiting for parallel reviews before presenting findings" \
  "one_line '$SKILL' | grep -qF 'wait until every one has finished, then present all findings once, in one table per scope, before asking to fix anything'"

check "review rule cites the 2026-09-22 double fix-approval cause" \
  "one_line '$SKILL' | grep -qF 'in a 2026-09-22 run, findings were shown while a second review was still running, which forced a second fix approval and a second fix plan'"

check "review rules forbid opening, printing, copying or transmitting credentials" \
  "one_line '$SKILL' | grep -qF 'Never open, print, copy or transmit credentials, tokens or configuration files that hold them'"

check "credential rule names example config paths and report-by-name-only" \
  "one_line '$SKILL' | grep -qF '~/.codex' && one_line '$SKILL' | grep -qF '~/.claude' && one_line '$SKILL' | grep -qF 'report their presence by name only'"

check "credential rule cites the measured Authorization-value cause" \
  "one_line '$SKILL' | grep -qF 'a reviewer printed an Authorization value from a local config in the same run'"

summary
