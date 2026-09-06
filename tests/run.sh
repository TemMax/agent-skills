#!/usr/bin/env bash
# One entry point. Default is offline and free; --live adds the tiers that call
# a model and therefore cost money and minutes.
#
#   ./tests/run.sh          structure + contracts + behaviour   (seconds)
#   ./tests/run.sh --live   the above, plus the evaluation tiers (~1 min, ~7 calls)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tests/test-env.sh

LIVE=""
[ "${1:-}" = "--live" ] && LIVE=1

rc=0
run() {
  printf '\n\033[1;34m▸ %s\033[0m\n' "$1"
  shift
  if "$@"; then :; else rc=1; fi
}

run "structure — manifests, frontmatter, versions, prohibitions" bash tests/structure.sh
run "contracts — the invariants behaviour depends on"            bash tests/skills-contract.sh
run "behaviour — hermetic test environment" bash tests/test-env.test.sh
export LC_COLLATE=C
for t in tests/contracts/*.test.sh; do
  [ -e "$t" ] || continue
  run "contracts — $(basename "$t" .test.sh)" bash "$t"
done
run "behaviour — wave-runner reference implementation (simulated)" bash tests/wave-runner.test.sh
run "behaviour — plan linter on fixture mutants"                   bash tests/plan-lint.test.sh
run "behaviour — Codex native wave state" bash tests/codex-wave-state.test.sh
run "behaviour — model CLI adapter" bash tests/eval/model-cli.test.sh
run "behaviour — deterministic supervisor fixture" bash tests/eval/supervisor-fixture.test.sh

for t in plugins/*/hooks/*.test.sh; do
  [ -e "$t" ] || continue
  run "behaviour — $(basename "$(dirname "$(dirname "$t")")")/$(basename "$t")" bash "$t"
done

if [ -n "$LIVE" ]; then
  for e in tests/eval/*.sh; do
    [ -e "$e" ] || continue
    case "$(basename "$e")" in
      model-cli.sh|gpt-5-6-matrix.sh|*.test.sh) continue ;;
    esac
    run "evaluation (live model) — $(basename "$e" .sh)" bash "$e"
  done
else
  printf '\n\033[33m▸ evaluation tiers skipped — run with --live to include them\033[0m\n'
  printf '  they are the only tiers that ask whether the prompts actually work\n'
fi

printf '\n'
if [ "$rc" -eq 0 ]; then printf '\033[32mall tiers passed\033[0m\n'; else printf '\033[31mSOME TIERS FAILED\033[0m\n'; fi
exit $rc
