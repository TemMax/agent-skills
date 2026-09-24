#!/usr/bin/env bash
# Offline test for the parallel GPT live driver (tests/eval/gpt-live.sh).
# No model is called: tier scripts are replaced with stubs that sleep briefly
# and record their own start/end timestamps, so this proves the job-cap
# scheduling, the summary format and env plumbing without any live cost.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
TIERS_DIR="$W/tiers"; mkdir -p "$TIERS_DIR"
STAMPS="$W/stamps.log"; : > "$STAMPS"

# alpha always passes; beta always fails. Both record model/tier start and
# end timestamps to the shared STAMPS file and echo EVAL_PROVIDER/EVAL_MODEL
# into their own stdout, which the driver captures into the per-job log.
cat > "$TIERS_DIR/alpha.sh" <<SH
#!/usr/bin/env bash
printf '%s alpha start %s\n' "\$EVAL_MODEL" "\$(python3 -c 'import time; print(time.time())')" >> "$STAMPS"
printf 'provider=%s model=%s\n' "\$EVAL_PROVIDER" "\$EVAL_MODEL"
sleep 0.5
printf '%s alpha end %s\n' "\$EVAL_MODEL" "\$(python3 -c 'import time; print(time.time())')" >> "$STAMPS"
printf '  2 passed, 0 failed\n'
SH
cat > "$TIERS_DIR/beta.sh" <<SH
#!/usr/bin/env bash
printf '%s beta start %s\n' "\$EVAL_MODEL" "\$(python3 -c 'import time; print(time.time())')" >> "$STAMPS"
printf 'provider=%s model=%s\n' "\$EVAL_PROVIDER" "\$EVAL_MODEL"
sleep 0.5
printf '%s beta end %s\n' "\$EVAL_MODEL" "\$(python3 -c 'import time; print(time.time())')" >> "$STAMPS"
printf '  1 passed, 1 failed\n'
exit 1
SH
cat > "$TIERS_DIR/gamma.sh" <<'SH'
#!/usr/bin/env bash
# Simulates the safety/profile-routing/critical-review/wave tiers: refuses to
# run without a fresh EVAL_RESULTS_DIR, writes cells.tsv there instead of
# printing an "N passed, M failed" line, and exits non-zero regardless.
set -uo pipefail
if [ -z "${EVAL_RESULTS_DIR:-}" ] || [ -e "$EVAL_RESULTS_DIR" ]; then
  printf 'gamma: EVAL_RESULTS_DIR must be a new, unset-or-absent directory\n' >&2
  exit 2
fi
mkdir -p "$EVAL_RESULTS_DIR"
printf 'scenario\tstatus\n' > "$EVAL_RESULTS_DIR/cells.tsv"
printf 'one\tpass\n' >> "$EVAL_RESULTS_DIR/cells.tsv"
printf 'two\tpass\n' >> "$EVAL_RESULTS_DIR/cells.tsv"
printf 'three\tfail\n' >> "$EVAL_RESULTS_DIR/cells.tsv"
exit 1
SH
chmod +x "$TIERS_DIR/alpha.sh" "$TIERS_DIR/beta.sh" "$TIERS_DIR/gamma.sh"

max_overlap() { # stamps-file
  python3 - "$1" <<'PY'
import sys

starts = {}
events = []
for line in open(sys.argv[1], encoding="utf-8"):
    parts = line.split()
    if len(parts) != 4:
        continue
    model, tier, kind, ts = parts
    key = (model, tier)
    ts = float(ts)
    if kind == "start":
        starts[key] = ts
    elif kind == "end":
        s = starts.pop(key, None)
        if s is not None:
            events.append((s, 1))
            events.append((ts, -1))
events.sort()
cur = 0
mx = 0
for _, delta in events:
    cur += delta
    mx = max(mx, cur)
print(mx)
PY
}

section "One row per model x tier, and a failing stub is reflected honestly"
RESULTS1="$W/results1"
set +e
GPT_LIVE_TIER_DIR="$TIERS_DIR" bash tests/eval/gpt-live.sh \
  --models "m1 m2" --tiers "alpha beta" --jobs 2 --results "$RESULTS1" \
  > "$W/driver1.out" 2>&1
rc1=$?
set -e

SUMMARY1="$RESULTS1/summary.tsv"
check "summary.tsv was written" "[ -f '$SUMMARY1' ]"
expect "one row per model x tier (plus header)" "5" "$(wc -l < "$SUMMARY1" | tr -d ' ')"
check "driver exits non-zero when a stub fails" "[ '$rc1' -ne 0 ]"
check "m1/alpha row shows exit 0" "grep -qE '^m1[[:space:]]+alpha[[:space:]]+0[[:space:]]' '$SUMMARY1'"
check "m1/beta row shows the failing exit code" "grep -qE '^m1[[:space:]]+beta[[:space:]]+1[[:space:]]' '$SUMMARY1'"
check "m2/beta row shows the failing exit code" "grep -qE '^m2[[:space:]]+beta[[:space:]]+1[[:space:]]' '$SUMMARY1'"
check "passing rows carry their parsed pass/fail counts" "grep -qE '^m1[[:space:]]+alpha[[:space:]]+0[[:space:]]+[0-9.]+[[:space:]]+2[[:space:]]+0$' '$SUMMARY1'"
check "failing rows carry their parsed pass/fail counts" "grep -qE '^m1[[:space:]]+beta[[:space:]]+1[[:space:]]+[0-9.]+[[:space:]]+1[[:space:]]+1$' '$SUMMARY1'"

section "EVAL_PROVIDER and EVAL_MODEL reach the stub"
check "m1/alpha log shows provider and model" "grep -qxF 'provider=codex model=m1' '$RESULTS1/m1/alpha.log'"
check "m2/beta log shows provider and model" "grep -qxF 'provider=codex model=m2' '$RESULTS1/m2/beta.log'"

section "--jobs 2 caps concurrency at 2 and actually overlaps"
overlap="$(max_overlap "$STAMPS")"
expect "at most 2 stubs run at once" "1" "$([ "$overlap" -le 2 ] && echo 1 || echo 0)"
expect "concurrency is real, not accidental serialization" "1" "$([ "$overlap" -eq 2 ] && echo 1 || echo 0)"

section "cells.tsv-writing tier: EVAL_RESULTS_DIR set per job, summary derived from it"
RESULTS3="$W/results3"
set +e
GPT_LIVE_TIER_DIR="$TIERS_DIR" bash tests/eval/gpt-live.sh \
  --models m1 --tiers gamma --jobs 1 --results "$RESULTS3" \
  > "$W/driver3.out" 2>&1
rc3=$?
set -e
SUMMARY3="$RESULTS3/summary.tsv"
check "gamma cells dir was created at the per-job path" "[ -d '$RESULTS3/m1/gamma.cells' ]"
check "gamma cells.tsv was written" "[ -f '$RESULTS3/m1/gamma.cells/cells.tsv' ]"
check "driver exits non-zero when gamma fails" "[ '$rc3' -ne 0 ]"
check "m1/gamma row derives passed 2, failed 1 from cells.tsv" "grep -qE '^m1[[:space:]]+gamma[[:space:]]+1[[:space:]]+[0-9.]+[[:space:]]+2[[:space:]]+1$' '$SUMMARY3'"

section "--results refuses to overwrite an existing non-empty directory"
DIRTY="$W/dirty-results"; mkdir -p "$DIRTY"
printf 'pre-existing evidence\n' > "$DIRTY/keep.txt"
set +e
GPT_LIVE_TIER_DIR="$TIERS_DIR" bash tests/eval/gpt-live.sh \
  --models m1 --tiers alpha --results "$DIRTY" > "$W/driver2.out" 2>&1
rc2=$?
set -e
expect "exits 73 on a non-empty --results directory" "73" "$rc2"
check "the existing file is untouched" "grep -qxF 'pre-existing evidence' '$DIRTY/keep.txt'"
check "no summary.tsv was written into the dirty directory" "[ ! -e '$DIRTY/summary.tsv' ]"

summary
