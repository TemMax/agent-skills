# Shared disposable fixture for both host session benchmarks.
# make_repo <dir> — disposable git repo with a local bare origin (<dir>.origin.git).
make_repo() {
  local DIR=$1 ORIGIN HAVE_PYTEST TEST_CMD
  ORIGIN="${DIR%/}.origin.git"
  [ -e "$DIR" ] && { echo "refusing: $DIR exists" >&2; return 1; }
  [ -e "$ORIGIN" ] && { echo "refusing: $ORIGIN exists" >&2; return 1; }
  mkdir -p "$DIR"
  DIR=$(cd "$DIR" && pwd -P)
  ORIGIN="${DIR}.origin.git"

  # pytest is not installed on this machine -> unittest-style tests; CI runs unittest discovery.
  if python3 -m pytest --version >/dev/null 2>&1; then HAVE_PYTEST=1; else HAVE_PYTEST=0; fi
  TEST_CMD="python -m unittest discover -s tests"

mkdir -p "$DIR/calc" "$DIR/tests" "$DIR/.github/workflows"
cat > "$DIR/calc/__init__.py" <<'PY'
from .add import add
from .mul import mul
from .fmt import fmt

__all__ = ["add", "mul", "fmt"]
PY
cat > "$DIR/calc/add.py" <<'PY'
def add(a, b):
    return a + b
PY
cat > "$DIR/calc/mul.py" <<'PY'
def mul(a, b):
    return a * b
PY
cat > "$DIR/calc/fmt.py" <<'PY'
def fmt(x):
    return f"{x:.2f}"
PY
: > "$DIR/tests/__init__.py"
cat > "$DIR/tests/test_add.py" <<'PY'
import unittest

from calc.add import add


class TestAdd(unittest.TestCase):
    def test_add_two(self):
        self.assertEqual(add(2, 2), 4)

    def test_add_two_again(self):
        self.assertEqual(add(2, 2), 4)

    def test_add_small_ints(self):
        self.assertEqual(add(1, 3), 4)

    def test_add_negative(self):
        self.assertEqual(add(-5, 3), -2)

    def test_add_zero_identity(self):
        self.assertEqual(add(0, 7), 7)

    def test_add_floats(self):
        self.assertAlmostEqual(add(0.1, 0.2), 0.3)

    def test_add_strings_concatenate(self):
        self.assertEqual(add("a", "b"), "ab")


if __name__ == "__main__":
    unittest.main()
PY
cat > "$DIR/tests/test_mul.py" <<'PY'
import unittest

from calc.add import add
from calc.mul import mul


class TestMul(unittest.TestCase):
    def test_mul_basic(self):
        self.assertEqual(mul(2, 3), 6)

    def test_mul_basic_duplicate(self):
        self.assertTrue(mul(2, 3) == 6)

    def test_mul_by_zero(self):
        self.assertEqual(mul(9, 0), 0)

    def test_mul_negative(self):
        self.assertEqual(mul(-4, 2), -8)

    def test_mul_rechecks_add(self):
        self.assertEqual(add(2, 2), 4)

    def test_mul_string_repeat(self):
        self.assertEqual(mul("ab", 2), "abab")


if __name__ == "__main__":
    unittest.main()
PY
cat > "$DIR/tests/test_fmt.py" <<'PY'
import unittest

from calc.fmt import fmt


class TestFmt(unittest.TestCase):
    def test_fmt_two_decimals(self):
        self.assertEqual(fmt(3.14159), "3.14")

    def test_fmt_two_decimals_copy(self):
        self.assertEqual(fmt(3.14159), "3.14")

    def test_fmt_pi_again(self):
        result = fmt(3.14159)
        self.assertEqual(result, "3.14")

    def test_fmt_rounding_up(self):
        self.assertEqual(fmt(2.675 + 0.001), "2.68")

    def test_fmt_integer_input(self):
        self.assertEqual(fmt(5), "5.00")

    def test_fmt_negative(self):
        self.assertEqual(fmt(-1.5), "-1.50")


if __name__ == "__main__":
    unittest.main()
PY
cat > "$DIR/.github/workflows/ci.yml" <<YML
name: ci

on:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Run tests
        run: ${TEST_CMD}
YML
cat > "$DIR/README.md" <<MD
# calc

Tiny arithmetic helpers: \`add\`, \`mul\`, \`fmt\`.

Run the tests:

\`\`\`
${TEST_CMD}
\`\`\`
MD
cat > "$DIR/.gitignore" <<'GI'
__pycache__/
*.pyc
GI

git init -q -b main "$DIR"
git -C "$DIR" config commit.gpgsign false
git -C "$DIR" config tag.gpgsign false
git -C "$DIR" config user.name "AB Harness"
git -C "$DIR" config user.email "ab-harness@example.invalid"
git -C "$DIR" add -A
git -C "$DIR" commit -q -m "Initial calc package with tests and CI"
git init -q --bare -b main "$ORIGIN"
git -C "$DIR" remote add origin "$ORIGIN"
git -C "$DIR" push -q -u origin main
echo "repo=$DIR origin=$ORIGIN pytest=$HAVE_PYTEST"
}
