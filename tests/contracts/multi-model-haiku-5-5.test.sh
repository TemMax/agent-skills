#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

MM="$(mktemp)"
trap 'rm -f "$MM"' EXIT
python3 tests/lib/skill-source.py plugins/orchestration/skills/multi-model/SKILL.md > "$MM"

RES=tests/eval/haiku-5-5-results-2026-10-08.md
OP55=plugins/orchestration/skills/multi-model/references/orchestrator-opus-5-5.md
LANE="$(sed -n 's/^executor-lane: //p' "$RES")"
SUP="$(sed -n 's/^sonnet-supervisor: //p' "$RES")"
LANE_HAIKU="$(sed -n 's/^executor-lane-haiku: //p' "$RES")"
LANE_SONNET="$(sed -n 's/^executor-lane-sonnet: //p' "$RES")"
SUP_FIXTURE="$(sed -n 's/^sonnet-supervisor-fixture: //p' "$RES")"
TIER_HAIKU="$(sed -n 's/^supervisor-tier-haiku-5-5: //p' "$RES")"

check "results file selects the executor lane as widened or unchanged" \
  '[ "$LANE" = widened ] || [ "$LANE" = unchanged ]'
check "results file selects the Sonnet supervisor as adopted or not-adopted" \
  '[ "$SUP" = adopted ] || [ "$SUP" = not-adopted ]'

check "identifiers table has the Haiku 5.5 row with the haiku alias" \
  "grep -qF '| Haiku 5.5 | \`claude-haiku-5-5\` | \`haiku\` |' '$MM'"
check "identifiers table marks Haiku 4.5 as a retired route with no alias" \
  "grep -qF '| Haiku 4.5 (retired route; ID valid for approved plans) | \`claude-haiku-4-5-20251001\` | none (\`haiku\` moved to Haiku 5.5) |' '$MM'"
check "the stale alias wording is gone" \
  "! grep -qF 'still resolves' '$MM'"
check "identifiers prose records that sonnet and haiku moved by 2026-10-08" \
  "tr '\\n' ' ' < '$MM' | tr -s ' ' | grep -qF 'By 2026-10-08 \`sonnet\` had moved from Sonnet 5 to Sonnet 5.5 and \`haiku\` from Haiku 4.5 to Haiku 5.5 the same way.'"
check "Agent-tool exception passes the routed effort through the tool's effort parameter" \
  "tr '\\n' ' ' < '$MM' | tr -s ' ' | grep -qF 'names the alias AND the full ID from this table. It also passes the routed effort through the tool'\\''s effort parameter where the tool has one.'"
check "Agent-tool exception makes an alias spawn state its model ID first" \
  "tr '\\n' ' ' < '$MM' | tr -s ' ' | grep -qF 'states its exact model ID in the first line of its report'"
check "the orchestrator searches a large log first and hands it to a Haiku 5.5 reader only when the search does not settle it" \
  "tr '\\n' ' ' < '$MM' | tr -s ' ' | grep -qF 'search it first: a pattern search for the failure'\\''s markers is one call. When the search does not settle it and the answer has to be read out of the file, hand its path to a Haiku 5.5 reader per the Research Routing table and take back the quoted lines; open the file yourself only at the lines the reader cites.'"
check "research row routes pattern search, closed lookup and fact extraction to Haiku 5.5 at medium" \
  "grep -qF '| Mechanical pattern search, one closed lookup question, or extracting a fact from a large file, log or transcript handed over by path | Haiku 5.5 (\`claude-haiku-5-5\`), medium, Agent tool alias \`haiku\` |' '$MM'"
check "research row makes the Haiku 5.5 reader return verbatim lines" \
  "grep -F '| Mechanical pattern search, one closed lookup question' '$MM' | grep -qF 'returns verbatim lines with line numbers, never a paraphrase'"
check "research mandatory line puts the model ID on the first line of the report" \
  "grep -qF -- '- the first line of the report is \`model: <the exact model ID you run on>\`;' '$MM'"
check "research mandatory line requires verbatim lines with line numbers" \
  "tr '\\n' ' ' < '$MM' | tr -s ' ' | grep -qF -- '- a fact taken from a file, log or transcript comes back as the verbatim line or lines with their line numbers (\`path:line\`), so that one grep checks the quote — never a paraphrase (Haiku 5.5 misreads inputs more often than the larger models: input hallucination 1.88 vs Sonnet 5.5'\\''s 1.44, Haiku 5.5 card p. 66);'"
check "effort table has the Haiku 5.5 row with medium as the default" \
  "grep -F '| Haiku 5.5 (\`claude-haiku-5-5\`) | avoid — in a long agent prompt it skips checks and stops early (prompting guide), and wide search collapses (WANDR 3.5, p. 123) |' '$MM' | grep -qF '| **default** — the knee on scoped coding'"
check "effort table marks the Haiku 4.5 row retired" \
  "grep -qF '| Haiku 4.5 (\`claude-haiku-4-5-20251001\`; retired route) | — does not support effort — | | | |' '$MM'"
check "routing prose states claude-haiku-4-5-20251001 is retired as a route" \
  "tr '\\n' ' ' < '$MM' | tr -s ' ' | grep -qF '\`claude-haiku-4-5-20251001\` is retired as a route (2026-10-08) on the same terms.'"
check "routing anti-patterns keep judgment, long sessions and secrets away from Haiku 5.5" \
  "tr '\\n' ' ' < '$MM' | tr -s ' ' | grep -qF 'don'\\''t give Haiku 5.5 a task whose acceptance needs judgment, a session that grows past 100,000 prompt tokens, or a secret to handle (it kept a secret out of its reasoning and replies in 3% of pressed conversations, Haiku 5.5 card p. 92);'"

LANE_WIDE_CELL="| A small closed task whose acceptance is fully mechanical — the contract's commands decide it, \`\"supervision\": \"mechanical\"\` — and mechanical work per exact instruction |"
LANE_NARROW_CELL="| Mechanical work per exact instruction, zero decisions |"
LANE_WIDE_ROW="$LANE_WIDE_CELL Haiku 5.5 (\`claude-haiku-5-5\`), medium | Ahead of Sonnet 5.5 at the same effort on scoped coding (FrontierCode Main ≈41.6 vs ≈36.5 at medium, chart read, Haiku 5.5 card p. 113) at a twentieth of the price below 100,000 prompt tokens; measured here on 2026-10-08: $LANE_HAIKU against Sonnet 5.5's $LANE_SONNET (\`tests/eval/haiku-5-5-results-2026-10-08.md\`). Not for a task that needs a judge's reading, a long session or debugging: Terminal-Bench 4.0 39.2 vs Sonnet 5.5's 70.6 (p. 115); its price is five times higher for a request above 100,000 prompt tokens, so its tasks stay small |"
LANE_NARROW_ROW="$LANE_NARROW_CELL Haiku 5.5 (\`claude-haiku-5-5\`), medium | Cheapest and fastest; condition — zero decisions. Its price is five times higher for a request above 100,000 prompt tokens (Haiku 5.5 dossier), so its tasks stay small. A wider lane was measured on 2026-10-08 and not adopted: $LANE_HAIKU against Sonnet 5.5's $LANE_SONNET (\`tests/eval/haiku-5-5-results-2026-10-08.md\`) |"
case "$LANE" in
  widened)
    check "routing table has the widened Haiku 5.5 row with the measured lane values" \
      'grep -qxF "$LANE_WIDE_ROW" "$MM"'
    check "routing table drops the zero-decisions-only row" \
      '! grep -qF "$LANE_NARROW_CELL" "$MM"'
    ;;
  unchanged)
    check "routing table has the unchanged Haiku 5.5 row with the measured lane values" \
      'grep -qxF "$LANE_NARROW_ROW" "$MM"'
    check "routing table has no widened Haiku 5.5 row" \
      '! grep -qF "$LANE_WIDE_CELL" "$MM"'
    ;;
esac

SUP_SONNET_CELL="Sonnet 5.5 (\`claude-sonnet-5-5\`) when every task of the wave is Haiku 5.5"
SUP_OPUS_CELL="Opus 5.5 (\`claude-opus-5-5\`) when no rung reaches Opus 5.5 (\`\"ladder\": []\`; an omitted ladder uses the runner's default ladder, which does) — otherwise Opus 5 (\`claude-opus-5\`); Fable 5.1 (\`claude-fable-5-1\`) is the premium alternative | high |"
SUP_SONNET_ROW="| Haiku 5.5 (\`claude-haiku-5-5\`) | $SUP_SONNET_CELL with \`\"ladder\": []\` (measured 2026-10-08: $SUP_FIXTURE); otherwise $SUP_OPUS_CELL"
SUP_OPUS_ROW="| Haiku 5.5 (\`claude-haiku-5-5\`) | $SUP_OPUS_CELL"
SUP_SONNET_BASIS="The same day Sonnet 5.5 at \`high\` passed it in three runs with \`EVAL_REPEAT=5\` ($SUP_FIXTURE) — the basis of its row for all-Haiku-5.5 waves."
TIER_SENTENCE="On 2026-10-08 the tier ran on Haiku 5.5, the default eval model since then: $TIER_HAIKU (single run)."
check "supervisor table marks the Haiku 4.5 row retired with the same supervisor" \
  "grep -qF '| Haiku 4.5 (\`claude-haiku-4-5-20251001\`) | retired route — same supervisor as the Haiku 5.5 row | high |' '$MM'"
case "$SUP" in
  adopted)
    check "supervisor table gives all-Haiku-5.5 waves a Sonnet 5.5 supervisor with the measured fixture" \
      'grep -qxF "$SUP_SONNET_ROW" "$MM"'
    check "supervisor prose cites the measured Sonnet 5.5 fixture runs" \
      'tr "\n" " " < "$MM" | tr -s " " | grep -qF "$SUP_SONNET_BASIS"'
    ;;
  not-adopted)
    check "supervisor table keeps the Haiku 5.5 row on Opus 5.5" \
      'grep -qxF "$SUP_OPUS_ROW" "$MM"'
    check "supervisor table has no Sonnet 5.5 supervisor for Haiku 5.5 waves" \
      '! grep -qF "$SUP_SONNET_CELL" "$MM"'
    ;;
esac
check "supervisor prose cites the measured Haiku 5.5 tier run" \
  'tr "\n" " " < "$MM" | tr -s " " | grep -qF "$TIER_SENTENCE"'

check "the Opus 5.5 profile names claude-haiku-5-5 for the Haiku lane" \
  "tr '\\n' ' ' < '$OP55' | tr -s ' ' | grep -qF 'the Haiku lane on \`claude-haiku-5-5\` as the Model Routing table says.'"
check "the Opus 5.5 profile no longer names the retired Haiku ID" \
  "! grep -qF 'claude-haiku-4-5-20251001' '$OP55'"

summary
