#!/usr/bin/env bash
# Parallel driver for the GPT/Codex live evaluation tiers.
#
# tests/eval/gpt-5-6-matrix.sh runs every tier x model strictly sequentially,
# which is fine for its deep per-cell evidence capture but too slow as a
# routine live check. This driver runs each (model, tier) pair as one
# background job, bounded by --jobs, so a full default run finishes in
# minutes instead of hours. It never calls a model itself: it only launches
# the existing tier scripts, which make the model calls.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

usage() {
  cat <<'USAGE'
Usage: bash tests/eval/gpt-live.sh [--models "gpt-6-sol gpt-6-luna"]
         [--tiers "supervisor drift super-plan skill-navigation safety profile-routing"]
         [--jobs 6] [--effort medium] [--repeat 1] [--results DIR]

Runs every (model, tier) pair as one background job, at most --jobs
concurrently. Each job is:
  EVAL_PROVIDER=codex EVAL_MODEL=<model> EVAL_EFFORT=<effort> \
  EVAL_REPEAT=<repeat> bash "$GPT_LIVE_TIER_DIR/<tier>.sh"
with combined stdout+stderr written to <results>/<model>/<tier>.log.

GPT_LIVE_TIER_DIR (default tests/eval) selects where tier scripts live.
--results defaults to a fresh mktemp -d directory; if given, it must be
absent or empty, else the driver exits 73 without touching it.

Writes <results>/summary.tsv (model, tier, exit, seconds, passed, failed)
and prints a readable table plus the total wall time. Exits 0 only when
every job exited 0.
USAGE
}

MODELS="gpt-6-sol gpt-6-luna"
TIERS="supervisor drift super-plan skill-navigation safety profile-routing"
JOBS=6
EFFORT=medium
REPEAT=1
RESULTS=""
TIER_DIR="${GPT_LIVE_TIER_DIR:-tests/eval}"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --models) MODELS="$2"; shift 2 ;;
    --tiers) TIERS="$2"; shift 2 ;;
    --jobs) JOBS="$2"; shift 2 ;;
    --effort) EFFORT="$2"; shift 2 ;;
    --repeat) REPEAT="$2"; shift 2 ;;
    --results) RESULTS="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'gpt-live: unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$JOBS" in ''|*[!0-9]*) printf 'gpt-live: --jobs must be a positive integer: %s\n' "$JOBS" >&2; exit 2 ;; esac
[ "$JOBS" -ge 1 ] || JOBS=1

results_dir_is_fresh() {
  local directory="$1"
  [ ! -e "$directory" ] || {
    [ -d "$directory" ] && [ -z "$(find "$directory" -mindepth 1 -print -quit)" ]
  }
}

if [ -z "$RESULTS" ]; then
  RESULTS="$(mktemp -d)"
elif ! results_dir_is_fresh "$RESULTS"; then
  printf 'gpt-live: --results must be an absent or empty directory: %s\n' "$RESULTS" >&2
  exit 73
fi
mkdir -p "$RESULTS"

now_ms() { python3 -c 'import time; print(time.monotonic_ns() // 1000000)'; }

# Bash 3.2 (macOS's shipped /bin/bash) has no `wait -n`; fall back to polling
# `jobs -r` once a second when it is unavailable.
WAIT_N_OK=0
if [ "${BASH_VERSINFO[0]:-0}" -gt 4 ] || { [ "${BASH_VERSINFO[0]:-0}" -eq 4 ] && [ "${BASH_VERSINFO[1]:-0}" -ge 3 ]; }; then
  WAIT_N_OK=1
fi

wait_for_slot() {
  if [ "$WAIT_N_OK" = 1 ]; then
    while [ "$(jobs -r | wc -l | tr -d ' ')" -ge "$JOBS" ]; do
      wait -n
    done
  else
    while [ "$(jobs -r | wc -l | tr -d ' ')" -ge "$JOBS" ]; do
      sleep 1
    done
  fi
}

run_job() { # model tier
  local model="$1" tier="$2"
  local outdir="$RESULTS/$model"
  mkdir -p "$outdir"
  local log="$outdir/$tier.log" statusfile="$outdir/$tier.status"
  (
    start_ms="$(now_ms)"
    EVAL_PROVIDER=codex EVAL_MODEL="$model" EVAL_EFFORT="$EFFORT" EVAL_REPEAT="$REPEAT" \
      bash "$TIER_DIR/$tier.sh" > "$log" 2>&1
    rc=$?
    end_ms="$(now_ms)"
    seconds="$(awk -v ms="$((end_ms - start_ms))" 'BEGIN { printf "%.3f", ms / 1000 }')"
    printf '%s\n%s\n' "$rc" "$seconds" > "$statusfile"
  ) &
}

# passed/failed from the tier's last "N passed, M failed" line, ANSI stripped.
parse_counts() { # log-file
  python3 - "$1" <<'PY'
import re
import sys

path = sys.argv[1]
try:
    text = open(path, encoding="utf-8", errors="replace").read()
except OSError:
    text = ""
text = re.sub(r"\x1b\[[0-9;]*m", "", text)
last = None
for line in text.splitlines():
    m = re.search(r"(\d+) passed, (\d+) failed", line)
    if m:
        last = m
if last:
    print(last.group(1))
    print(last.group(2))
else:
    print("-")
    print("-")
PY
}

print_table() { # tsv-file
  awk -F'\t' '
    {
      for (i = 1; i <= NF; i++) {
        f[NR, i] = $i
        if (length($i) > w[i]) w[i] = length($i)
      }
      if (NF > cols) cols = NF
      rows = NR
    }
    END {
      for (r = 1; r <= rows; r++) {
        line = ""
        for (i = 1; i <= cols; i++) {
          cell = f[r, i]
          pad = w[i] - length(cell)
          line = line cell
          for (p = 0; p < pad; p++) line = line " "
          if (i < cols) line = line "  "
        }
        print line
      }
    }
  ' "$1"
}

TOTAL_START_MS="$(now_ms)"

for model in $MODELS; do
  for tier in $TIERS; do
    wait_for_slot
    run_job "$model" "$tier"
  done
done
wait

TOTAL_END_MS="$(now_ms)"
TOTAL_SECONDS="$(awk -v ms="$((TOTAL_END_MS - TOTAL_START_MS))" 'BEGIN { printf "%.3f", ms / 1000 }')"

SUMMARY="$RESULTS/summary.tsv"
printf 'model\ttier\texit\tseconds\tpassed\tfailed\n' > "$SUMMARY"

overall_rc=0
for model in $MODELS; do
  for tier in $TIERS; do
    statusfile="$RESULTS/$model/$tier.status"
    log="$RESULTS/$model/$tier.log"
    if [ -f "$statusfile" ]; then
      exit_code="$(sed -n '1p' "$statusfile")"
      seconds="$(sed -n '2p' "$statusfile")"
    else
      exit_code="-"
      seconds="-"
    fi
    [ "$exit_code" = "0" ] || overall_rc=1
    counts="$(parse_counts "$log")"
    passed="$(printf '%s\n' "$counts" | sed -n '1p')"
    failed="$(printf '%s\n' "$counts" | sed -n '2p')"
    printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$model" "$tier" "$exit_code" "$seconds" "$passed" "$failed" >> "$SUMMARY"
  done
done

printf '\nresults: %s\n\n' "$RESULTS"
print_table "$SUMMARY"
printf '\ntotal wall time: %ss\n' "$TOTAL_SECONDS"

exit "$overall_rc"
