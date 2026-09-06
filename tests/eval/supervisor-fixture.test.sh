#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
R="$W/repo"; mkdir -p "$R/src" "$R/tests"
command cp tests/eval/fixtures/supervisor/contract-check.py "$R/contract-check.py"
printf 'def value():\n    return 1\n' > "$R/src/sample.py"
touch "$R/src/__init__.py" "$R/tests/__init__.py"
cat > "$R/tests/test_sample.py" <<'PY'
import unittest

from src.sample import value


class TestSample(unittest.TestCase):
    def test_first(self):
        self.assertEqual(value(), 1)

    def test_second(self):
        self.assertGreater(value(), 0)
PY

section "Deterministic supervisor verifier"
set +e
success_output="$(cd "$R" && python3 -B contract-check.py 2> "$W/success.stderr")"
success_rc=$?
set -e
expect "successful verifier exits zero" "0" "$success_rc"
expect "successful verifier emits stable evidence" "PASS 2" "$success_output"
expect "successful verifier emits no variable stderr" "" "$(cat "$W/success.stderr")"

printf 'def value():\n    return 0\n' > "$R/src/sample.py"
set +e
failure_output="$(cd "$R" && python3 -B contract-check.py 2> "$W/failure.stderr")"
failure_rc=$?
set -e
expect "failing verifier exits nonzero" "1" "$failure_rc"
expect "failing verifier emits stable evidence" "FAIL 2" "$failure_output"
expect "failing verifier emits no variable stderr" "" "$(cat "$W/failure.stderr")"

summary
