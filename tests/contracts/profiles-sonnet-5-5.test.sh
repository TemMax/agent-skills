#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

R="plugins/orchestration/skills/multi-model/references"

check "opus-5-5 profile keeps closed implementation on claude-sonnet-5-5" \
  "grep -qF 'implementation on \`claude-sonnet-5-5\` and' '$R/orchestrator-opus-5-5.md'"
check "opus-5-5 profile no longer names claude-sonnet-5 there" \
  "! grep -qF 'implementation on \`claude-sonnet-5\` and' '$R/orchestrator-opus-5-5.md'"

check "fable-5-1 browser row routes to Sonnet 5.5 with card evidence" \
  "grep -F 'Live browser content without additional safeguards | Sonnet 5.5 |' '$R/orchestrator-fable-5-1.md' | grep -qF 'injection 0% (0/110) in the Cowork harness vs Sonnet 5 0.37% (Sonnet 5.5 card p. 54)'"
check "fable-5-1 browser row keeps the Fable-card citation as history" \
  "grep -F 'Live browser content without additional safeguards' '$R/orchestrator-fable-5-1.md' | grep -qF '0.28% against the documented Fable raw rate (p. 89)'"
check "fable-5-1 browser row no longer routes to Sonnet 5" \
  "! grep -qF 'Live browser content without additional safeguards | Sonnet 5 |' '$R/orchestrator-fable-5-1.md'"
check "fable-5-1 Fable-card mention of Sonnet 5 (p. 55) is untouched" \
  "grep -qF \"more often than Opus 5's or Sonnet 5's (p. 55)\" '$R/orchestrator-fable-5-1.md'"

check "opus-5 untrusted-content row routes to Sonnet 5.5 with Shade evidence" \
  "grep -F 'Anything reading untrusted external content' '$R/orchestrator-opus-5.md' | grep -qF 'route to yourself or Sonnet 5.5 |'"
check "opus-5 untrusted-content row cites Sonnet 5.5 card p. 51 and path advice" \
  "grep -F 'Anything reading untrusted external content' '$R/orchestrator-opus-5.md' | grep -qF 'Shade adaptive coding attacks 3.01% vs Sonnet 5 19.47% (Sonnet 5.5 card p. 51); no pasted-text test in that card, so pass untrusted text by path'"
check "opus-5 untrusted-content row no longer routes to Sonnet 5" \
  "! grep -qF 'route to yourself or Sonnet 5 |' '$R/orchestrator-opus-5.md'"

check "wave adapter verifier default is claude-sonnet-5-5" \
  "grep -F 'verifier: {' '$R/claude-wave-adapter.md' | grep -F 'this is the default' | grep -qF 'model: \"claude-sonnet-5-5\", effort: \"low\"'"
check "wave adapter executor example is claude-sonnet-5-5" \
  "grep -qF 'executor: { model: \"claude-sonnet-5-5\", effort: \"medium\" }' '$R/claude-wave-adapter.md'"
check "wave adapter has no bare claude-sonnet-5 in the runner example" \
  "! grep -qF 'model: \"claude-sonnet-5\"' '$R/claude-wave-adapter.md'"

check "verdicts default verifier is claude-sonnet-5-5/low" \
  "grep -qF 'default \`claude-sonnet-5-5\`/\`low\`' '$R/verdicts.md'"
check "verdicts no longer names claude-sonnet-5/low" \
  "! grep -qF 'default \`claude-sonnet-5\`/\`low\`' '$R/verdicts.md'"

summary
