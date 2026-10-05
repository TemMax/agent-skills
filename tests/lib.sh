# Shared helpers. Every tier reports the same way so one runner can aggregate.
CONTRACT_SOURCE_DIR="$(mktemp -d)"

# Prose contracts inspect the complete linked policy, not just the hot entrypoint.
contract_source() {
  local target="$CONTRACT_SOURCE_DIR/$(printf '%s' "$1" | shasum | cut -d ' ' -f 1).md"
  python3 tests/lib/skill-source.py "$1" > "$target" || return
  printf '%s\n' "$target"
}

FAILED=0
PASSED=0

pass() { PASSED=$((PASSED+1)); printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
fail() { FAILED=$((FAILED+1)); printf '  \033[31mFAIL\033[0m  %s\n' "$1"; [ -n "${2:-}" ] && printf '        %s\n' "$2"; }

# check <name> <shell-expression>
check() { if eval "$2" >/dev/null 2>&1; then pass "$1"; else fail "$1"; fi; }

# expect <name> <expected> <actual>
expect() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1" "expected '$2', got '$3'"; fi; }

# contains <name> <needle> <haystack>
contains() { case "$3" in *"$2"*) pass "$1";; *) fail "$1" "'$2' not found in: ${3:0:80}";; esac; }

section() { printf '\n\033[1m%s\033[0m\n' "$1"; }
summary() {
  rm -rf "$CONTRACT_SOURCE_DIR"
  printf '\n  %s passed, %s failed\n' "$PASSED" "$FAILED"
  [ "$FAILED" -eq 0 ]
}
