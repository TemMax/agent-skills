#!/usr/bin/env bash
# Behaviour tier — deterministic Codex wave state, real disposable Git repos,
# and no model or network calls.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tests/lib.sh
. tests/test-env.sh

section "Codex native per-wave state and verifier"
if ! command -v node >/dev/null 2>&1; then
  fail "node is required for this tier and was not found on PATH"
elif out="$(node tests/lib/codex-wave-state.test.mjs 2>&1)"; then
  printf '%s\n' "$out" | sed 's/^/    /'
  pass "C1-C17 state-machine scenarios"
else
  printf '%s\n' "$out" | sed 's/^/    /'
  fail "C1-C17 state-machine scenarios (output above)"
fi

summary
