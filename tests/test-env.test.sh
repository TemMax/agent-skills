#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tests/lib.sh

section "disposable Git repositories ignore developer signing configuration"
. tests/test-env.sh
expect "commit signing disabled only in test process" "false" "$(git config --get commit.gpgsign)"
expect "default branch pinned" "master" "$(git config --get init.defaultBranch)"

section "contract directory is part of the default runner"
check "contract test loop exists" "grep -q 'tests/contracts/\\*.test.sh' tests/run.sh"

section "contract discovery uses deterministic collation"
contract_order="$(
  fixture="$(mktemp -d)" || exit 1
  trap 'rm -rf "$fixture"' EXIT
  touch "$fixture/a.test.sh" "$fixture/B.test.sh"
  LC_COLLATE=C bash -c 'for t in "$1"/*.test.sh; do basename "$t"; done' bash "$fixture" | paste -sd ' ' -
)"
expect "C collation orders contract fixtures by byte" "B.test.sh a.test.sh" "$contract_order"
check "runner pins C collation before contract discovery" "grep -B1 'for t in tests/contracts/\\*.test.sh' tests/run.sh | grep -q 'LC_COLLATE=C'"
summary
