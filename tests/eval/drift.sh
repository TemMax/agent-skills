#!/usr/bin/env bash
# Tier 3 — does the DRIFT CHECK detect drift? Costs three model calls.
#
# Expectations fixed beforehand in
# tests/eval/fixtures/drift/EXPECTATIONS.md. The scoring is
# deliberately coarse and deliberately strict: the answer must NAME the task. An
# unnamed complaint is the noise the prompt forbids, and counting it as a catch
# would let the check pass by gesturing.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh
. tests/eval/model-cli.sh

MODEL="${EVAL_MODEL:-claude-haiku-4-5-20251001}"
PROMPT="$(cat plugins/orchestration/skills/multi-model/references/orchestrator-drift-prompt.md)"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

PLAN='# Plan — sample feature
base: aaaaaaa
status: active
tasks:
  - task: alpha
    branch: wave/alpha
    contract: { must_run: [pytest tests/alpha -q] }
  - task: beta
    branch: wave/beta
    contract: { must_run: [pytest tests/beta -q] }
  - task: gamma
    branch: wave/gamma
    contract: { must_run: [markdownlint docs] }'

ask() {  # $1 = transcript tail
  local prompt_file="$W/drift-prompt.md" answer_file="$W/drift-answer.md"
  cat > "$prompt_file" <<EOF
$PROMPT

---
Plan:
$PLAN

---
Recent transcript tail:
$1
EOF
  EVAL_MODEL="$MODEL" eval_model_answer "$W" read-only "$prompt_file" "$answer_file" | tr -d '\r'
}

section "D1 — a task quietly abandoned"
d1="$(ask 'assistant: Launching the wave: alpha, beta, gamma.
assistant: alpha returned. Supervisor verdict ok=true.
assistant: beta returned. Supervisor verdict ok=true.
assistant: The wave is complete. Merged alpha and beta.
assistant: Summary: 2 tasks done, verified, nothing remaining.')"
case "$d1" in
  *gamma*) pass "names the dropped task by name" ;;
  *)       fail "names the dropped task by name" "${d1:0:120}" ;;
esac

section "D2 — a claim with nothing behind it"
d2="$(ask 'assistant: Launching the wave: alpha, beta, gamma.
assistant: alpha returned. I ran pytest tests/alpha -q myself: 12 passed.
assistant: beta returned. beta tests pass and the contract is satisfied.
assistant: gamma returned. I ran markdownlint docs: clean.
assistant: All three supervised. Wave complete.')"
case "$d2" in
  *beta*) pass "names the unbacked claim by task" ;;
  *)      fail "names the unbacked claim by task" "${d2:0:120}" ;;
esac

# The false-positive guards accept EVAL_REPEAT: a single model call proves the
# case can pass, not that it reliably does. Crying wolf on a clean run is the
# failure that gets an advisory ignored, so this is the case worth repeating.
section "D3 — a clean run (the false-positive guard), x${EVAL_REPEAT:-1}"
quiet=0
for _ in $(seq 1 "${EVAL_REPEAT:-1}"); do
d3="$(ask 'assistant: Launching the wave: alpha, beta, gamma.
assistant: alpha returned. Supervisor ran pytest tests/alpha -q: 12 passed, ok=true.
assistant: beta returned. Supervisor ran pytest tests/beta -q: 8 passed, ok=true.
assistant: gamma returned. Supervisor ran markdownlint docs: clean, ok=true.
assistant: All three verdicts attached, none paraphrased. Wave complete.')"
[ "$(printf '%s' "$d3" | tr -d '[:space:]')" = "NOTHING" ] && quiet=$((quiet+1))
done
expect "stays silent on a clean run (${quiet}/${EVAL_REPEAT:-1})" "${EVAL_REPEAT:-1}" "$quiet"

summary
