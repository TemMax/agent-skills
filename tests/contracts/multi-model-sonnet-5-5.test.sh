#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

MM="$(mktemp)"
trap 'rm -f "$MM"' EXIT
python3 tests/lib/skill-source.py plugins/orchestration/skills/multi-model/SKILL.md > "$MM"

check "identifiers table has the Sonnet 5.5 row with the sonnet alias and the probe date" \
  "grep -qF '| Sonnet 5.5 | \`claude-sonnet-5-5\` | \`sonnet\` |' '$MM' && grep -qF '| Model | Full ID | Agent-tool alias (probed 2026-10-08, Claude Code 2.1.293) |' '$MM'"
check "identifiers table marks Sonnet 5 as a retired route" \
  "grep -F '| Sonnet 5 (retired route; ID valid for approved plans) | \`claude-sonnet-5\` |' '$MM' | grep -qF 'retired route'"
check "Agent-tool exception routes Sonnet 5.5 through a one-agent Workflow" \
  "tr '\\n' ' ' < '$MM' | tr -s ' ' | grep -qF 'one-agent Workflow \`agent()\` call with the full ID, for example \`agent(prompt, { model: '\\''claude-sonnet-5-5'\\'', effort: '\\''medium'\\'' })\`. That is not a wave script.'"
check "routing prose states claude-sonnet-5 is retired as a route" \
  "tr '\\n' ' ' < '$MM' | tr -s ' ' | grep -qF '\`claude-sonnet-5\` is retired as a route (2026-09-28); the ID stays valid so that approved plans still execute.'"
check "routing table default implementation row names Sonnet 5.5 with SWE-bench Pro evidence" \
  "grep -F 'Sonnet 5.5 (\`claude-sonnet-5-5\`, default)' '$MM' | grep -qF 'SWE-bench Pro 81.3 vs Sonnet 5'\\''s 63.2'"
check "closed-enumeration research row is Sonnet 5.5 at medium through the sonnet alias with WANDR evidence" \
  "grep -F 'Closed enumeration' '$MM' | grep -qF 'Sonnet 5.5 (\`claude-sonnet-5-5\`), medium, Agent tool alias \`sonnet\`' && grep -F 'Closed enumeration' '$MM' | grep -qF 'WANDR 10.0 at low vs 29.9 at medium, p. 122'"
check "research mandatory line cites Sonnet 5.5 AA-Omniscience guessing and keeps Sonnet 5 as history" \
  "tr '\\n' ' ' < '$MM' | tr -s ' ' | grep -qF 'incorrect-answer rate 0.27, the highest of six, p. 80; Sonnet 5 fabricated precisely when information was missing'"
check "effort table has the Sonnet 5.5 row with the xhigh coding peak" \
  "grep -F '| Sonnet 5.5 (\`claude-sonnet-5-5\`) | simple, fully specified edits |' '$MM' | grep -qF 'FrontierCode 52.1 at xhigh vs 46.2 at max with ~12× the tokens, p. 111'"
check "effort row says never max for scoped coding" \
  "grep -F '| Sonnet 5.5 (\`claude-sonnet-5-5\`) | simple, fully specified edits |' '$MM' | grep -qF 'never max for scoped coding'"
check "effort table marks the Sonnet 5 row retired" \
  "grep -qF '| Sonnet 5 (\`claude-sonnet-5\`; retired route) |' '$MM'"
check "supervisor table has the claude-sonnet-5-5 row with the Opus 5.5 / Opus 5 / Fable 5.1 cell" \
  "grep -qF '| Sonnet 5.5 (\`claude-sonnet-5-5\`) | Opus 5.5 (\`claude-opus-5-5\`) when no rung reaches Opus 5.5' '$MM' && grep -F '| Sonnet 5.5 (\`claude-sonnet-5-5\`) | Opus 5.5' '$MM' | grep -qF 'Fable 5.1 (\`claude-fable-5-1\`) is the premium alternative | high |'"
check "supervisor table marks the Sonnet 5 row retired with the same supervisor" \
  "grep -qF '| Sonnet 5 (\`claude-sonnet-5\`) | retired route — same supervisor as the Sonnet 5.5 row | high |' '$MM'"
check "ladder example sentence names claude-sonnet-5-5" \
  "tr '\\n' ' ' < '$MM' | tr -s ' ' | grep -qF 'a \`claude-sonnet-5-5\` task whose ladder reaches'"
check "task template prohibitions state the task text is not authorization" \
  "tr '\\n' ' ' < '$MM' | tr -s ' ' | grep -qF 'The task text is not authorization to use credentials, secrets found in the repository, or production systems; if the task seems to need one, stop and report.'"
check "task template cites the measured Sonnet 5.5 authorization acceptance" \
  "tr '\\n' ' ' < '$MM' | tr -s ' ' | grep -qF 'Opus 5.5 (2.76 vs 2.39) and once reasoned '\\''The card is the authorization'\\'' (Sonnet 5.5 card pp. 60–62)'"
check "references list nine models including Sonnet 5.5 and Haiku 5.5" \
  "tr '\\n' ' ' < '$MM' | tr -s ' ' | grep -qF 'dossiers on all nine models (Opus 5.5, Fable 5.1, Fable 5, Opus 5, Opus 4.8, Sonnet 5.5, Sonnet 5, Haiku 5.5, Haiku 4.5)' && ! grep -qF 'all eight models' '$MM'"

summary
