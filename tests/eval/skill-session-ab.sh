#!/usr/bin/env bash
# skill-session-ab — runs ONE scripted multi-turn Codex orchestrator session on
# a disposable repo and saves every turn's `codex exec --json` stream for the
# A/B analyzer. It measures how a skill entrypoint behaves, not whether it is
# correct: the task is "remove duplicate unit tests via parallel sub-agents",
# followed by a separate one-line CI edit.
#
# Usage: bash tests/eval/skill-session-ab.sh --arm old|new|real --out DIR
#          [--rep N] [--old-ref REF] [--new-ref REF] [--model ID]
#          [--effort LEVEL] [--turns N] [--turn-timeout SECONDS]
#
# Arms:
#   old   the skill tree of --old-ref (default d118fff, 4.6.0, the last release
#         before Codex entrypoints), read from skills/multi-model/SKILL.md;
#         runs with `--disable plugins`
#   new   the skill tree of --new-ref (default HEAD), read from
#         skills-codex/multi-model/SKILL.md; runs with `--disable plugins`
#   real  the installed plugin, invoked by name; plugins stay enabled
# Skill trees are materialized with `git archive <ref> plugins/orchestration`
# into <out>/skills. Defaults: --rep 1, --model gpt-6.1-sol, --effort high,
# --turns 8, --turn-timeout 1500.
#
# --out is part of the evidence contract: it must be absent or empty, else this
# exits 73 without touching it. Exit codes: 2 usage error (unknown option, bad
# --arm, or a --new-ref without skills-codex/), 69 codex executable
# unavailable, 73 --out not empty. All validation runs before anything is
# created.
#
# Output in <out>: repo/ and repo.origin.git, turn-K.{jsonl,err,prompt,cmd},
# turns.tsv, meta.txt, rollout.jsonl, child-rollouts/, final-state.txt, run.log.
#
# Testing hooks (offline; see skill-session-ab.test.sh):
#   SKILL_SESSION_AB_CODEX_BIN      codex executable (default "codex" on PATH)
#   SKILL_SESSION_AB_SESSIONS_DIR   where rollouts are searched
#                                   (default ${CODEX_HOME:-$HOME/.codex}/sessions)
#
# This calls a live model. It never runs in any automatic tier: tests/run.sh
# excludes it even under --live; only its offline test runs by default.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
ROOT="$(pwd)"

OLD_REF=d118fff1753803aa26f7d0abca400d97a4718dd7
NEW_REF=HEAD
ARM= OUT=
REP=1
MODEL=gpt-6.1-sol
EFFORT=high
TURN_TIMEOUT=1500
MAX_TURNS=8

usage() { sed -n '2,36p' "$0"; }
die() { printf 'skill-session-ab: %s\n' "$2" >&2; exit "$1"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --arm|--rep|--out|--old-ref|--new-ref|--model|--effort|--turns|--turn-timeout)
      [ $# -ge 2 ] || die 2 "$1 needs a value" ;;
  esac
  case "$1" in
    --arm) ARM=$2; shift 2 ;;
    --rep) REP=$2; shift 2 ;;
    --out) OUT=$2; shift 2 ;;
    --old-ref) OLD_REF=$2; shift 2 ;;
    --new-ref) NEW_REF=$2; shift 2 ;;
    --model) MODEL=$2; shift 2 ;;
    --effort) EFFORT=$2; shift 2 ;;
    --turns) MAX_TURNS=$2; shift 2 ;;
    --turn-timeout) TURN_TIMEOUT=$2; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die 2 "unknown argument: $1" ;;
  esac
done

# ---- validation: nothing is created until all of it passes -----------------
case "$ARM" in old|new|real) ;; *) die 2 "--arm must be old, new or real" ;; esac
[[ "$REP" =~ ^[0-9]+$ ]] || die 2 "--rep must be a number"
[[ "$MAX_TURNS" =~ ^[0-9]+$ ]] || die 2 "--turns must be a number"
[[ "$TURN_TIMEOUT" =~ ^[0-9]+$ ]] || die 2 "--turn-timeout must be a number"
[ -n "$OUT" ] || die 2 "--out is required"

REF=
case "$ARM" in
  old) REF=$OLD_REF ;;
  new) REF=$NEW_REF ;;
esac
if [ -n "$REF" ]; then
  git -C "$ROOT" cat-file -e "$REF:plugins/orchestration" 2>/dev/null \
    || die 2 "ref $REF has no plugins/orchestration"
  if [ "$ARM" = new ]; then
    git -C "$ROOT" cat-file -e "$REF:plugins/orchestration/skills-codex" 2>/dev/null \
      || die 2 "--new-ref $REF has no plugins/orchestration/skills-codex; arm new needs the Codex entrypoints"
  fi
fi

CODEX_BIN="${SKILL_SESSION_AB_CODEX_BIN:-codex}"
if ! command -v "$CODEX_BIN" >/dev/null 2>&1; then
  die 69 "codex executable unavailable: $CODEX_BIN"
fi
CODEX_BIN="$(command -v "$CODEX_BIN")"

if [ -e "$OUT" ] && [ -n "$(ls -A "$OUT" 2>/dev/null)" ]; then
  die 73 "refusing: $OUT exists and is not empty"
fi

mkdir -p "$OUT" || die 1 "cannot create $OUT"
OUT=$(cd "$OUT" && pwd -P)
REPO="$OUT/repo"
ORIGIN="$OUT/repo.origin.git"
CODEX_SESSIONS="${SKILL_SESSION_AB_SESSIONS_DIR:-${CODEX_HOME:-$HOME/.codex}/sessions}"

log() { printf '[%s] %s\n' "$(date '+%H:%M:%S')" "$*" | tee -a "$OUT/run.log" >&2; }

# Per-turn timeout command.
if command -v timeout >/dev/null 2>&1; then TO=(timeout -k 30 "$TURN_TIMEOUT")
elif command -v gtimeout >/dev/null 2>&1; then TO=(gtimeout -k 30 "$TURN_TIMEOUT")
else TO=(none)
fi
run_with_timeout() {
  if [ "${TO[0]}" != none ]; then "${TO[@]}" "$@"; return $?; fi
  "$@" & local pid=$!
  ( sleep "$TURN_TIMEOUT"; kill -TERM "$pid" 2>/dev/null; sleep 30; kill -KILL "$pid" 2>/dev/null ) & local dog=$!
  wait "$pid"; local rc=$?
  kill "$dog" 2>/dev/null; wait "$dog" 2>/dev/null
  return $rc
}

. "$ROOT/tests/eval/lib/skill-session-fixture.sh"

touch "$OUT/.started"
make_repo "$REPO" >>"$OUT/run.log" 2>&1 || { log "make-repo failed"; exit 1; }

SKILL=
case "$ARM" in
  old|new)
    mkdir -p "$OUT/skills"
    git -C "$ROOT" archive "$REF" plugins/orchestration | tar -x -C "$OUT/skills" || { log "git archive failed"; exit 1; }
    if [ "$ARM" = old ]; then SKILL="$OUT/skills/plugins/orchestration/skills/multi-model/SKILL.md"
    else SKILL="$OUT/skills/plugins/orchestration/skills-codex/multi-model/SKILL.md"; fi
    [ -f "$SKILL" ] || { log "missing $SKILL"; exit 1; }
    ;;
esac

T1_TAIL="В этом репозитории много дублирующихся unit-тестов. Удали тесты, которые дублируют другие и не ловят отдельных багов, распределив аудит по параллельным подагентам. Отвечай на русском. PR не открывай."
if [ "$ARM" = real ]; then
  T1="Используй скилл orchestration:multi-model. $T1_TAIL"
else
  T1="Read and apply the orchestration skill at $SKILL (its reference files are where the skill says). $T1_TAIL"
fi
TURNS=(
  "$T1"
  "да"
  "продолжай"
  "да"
  "продолжай"
  "Теперь отдельная мелкая правка: в .github/workflows/ci.yml поменяй timeout-minutes с 10 на 15."
  "да"
  "продолжай"
)

EXTRA=()
[ "$ARM" = real ] || EXTRA=(--disable plugins)
MODEL_FLAGS=(-m "$MODEL" -c "model_reasoning_effort=\"$EFFORT\"")

{
  echo "arm=$ARM rep=$REP model=$MODEL effort=$EFFORT turn_timeout=$TURN_TIMEOUT"
  echo "skill=${SKILL:-installed plugin}"
  echo "codex=$("$CODEX_BIN" --version 2>/dev/null)"
  [ "$ARM" = real ] && echo "installed_orchestration=$(ls "${CODEX_HOME:-$HOME/.codex}/plugins/cache/temmax/orchestration" 2>/dev/null | tr '\n' ' ')"
  echo "started=$(date -u +%FT%TZ)"
} >"$OUT/meta.txt"

printf 'turn\texit\tcompleted\tseconds\n' >"$OUT/turns.tsv"
TID=
for ((k = 1; k <= MAX_TURNS && k <= ${#TURNS[@]}; k++)); do
  MSG=${TURNS[$((k - 1))]}
  printf '%s' "$MSG" >"$OUT/turn-$k.prompt"
  t0=$(date +%s)
  if [ "$k" -eq 1 ]; then
    CMD=("$CODEX_BIN" exec --json --skip-git-repo-check -C "$REPO" --sandbox danger-full-access ${EXTRA[@]+"${EXTRA[@]}"} "${MODEL_FLAGS[@]}" "$MSG")
  else
    CMD=("$CODEX_BIN" exec resume --json --skip-git-repo-check ${EXTRA[@]+"${EXTRA[@]}"} "${MODEL_FLAGS[@]}" -c 'sandbox_mode="danger-full-access"' "$TID" "$MSG")
  fi
  printf '%q ' "${CMD[@]}" >"$OUT/turn-$k.cmd"; echo >>"$OUT/turn-$k.cmd"
  log "turn $k start"
  (cd "$REPO" && run_with_timeout "${CMD[@]}" </dev/null >"$OUT/turn-$k.jsonl" 2>"$OUT/turn-$k.err")
  rc=$?
  secs=$(( $(date +%s) - t0 ))
  if grep -q '"type":"turn.completed"' "$OUT/turn-$k.jsonl"; then done_=1; else done_=0; fi
  printf '%s\t%s\t%s\t%s\n' "$k" "$rc" "$done_" "$secs" >>"$OUT/turns.tsv"
  log "turn $k exit=$rc completed=$done_ ${secs}s"
  if [ "$k" -eq 1 ]; then
    TID=$(python3 -c '
import json, sys
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    try: o = json.loads(line)
    except ValueError: continue
    if o.get("type") == "thread.started" and o.get("thread_id"):
        print(o["thread_id"]); break
' "$OUT/turn-1.jsonl")
    if [ -z "$TID" ]; then log "no thread_id in turn 1; stopping"; echo "thread_id=" >>"$OUT/meta.txt"; break; fi
    echo "thread_id=$TID" >>"$OUT/meta.txt"
  fi
done
echo "finished=$(date -u +%FT%TZ)" >>"$OUT/meta.txt"

# Copy the session rollouts this run produced (main thread + any child sessions whose cwd is inside $OUT).
if [ -n "$TID" ] && [ -d "$CODEX_SESSIONS" ]; then
  MAIN=$(find "$CODEX_SESSIONS" -type f -name "rollout-*-$TID.jsonl" 2>/dev/null | head -1)
  [ -n "$MAIN" ] && cp "$MAIN" "$OUT/rollout.jsonl"
  mkdir -p "$OUT/child-rollouts"
  find "$CODEX_SESSIONS" -type f -name 'rollout-*.jsonl' -newer "$OUT/.started" 2>/dev/null | while read -r f; do
    [ "$f" = "$MAIN" ] && continue
    if python3 - "$f" "$OUT" <<'PY'
import json, os, sys
try:
    o = json.loads(open(sys.argv[1], encoding="utf-8").readline())
except Exception:
    sys.exit(1)
cwd = os.path.realpath((o.get("payload") or {}).get("cwd") or "")
out = os.path.realpath(sys.argv[2])
sys.exit(0 if cwd == out or cwd.startswith(out + os.sep) else 1)
PY
    then cp "$f" "$OUT/child-rollouts/"; fi
  done
fi

# Final repository state.
{
  echo "## git log --oneline --all"; git -C "$REPO" log --oneline --all
  echo; echo "## git status --porcelain"; git -C "$REPO" status --porcelain
  echo; echo "## git worktree list"; git -C "$REPO" worktree list
  echo; echo "## origin main log"; git -C "$ORIGIN" log --oneline main
  echo; echo "## test functions on origin/main"; git -C "$ORIGIN" grep -oE 'def test_[A-Za-z0-9_]+' main -- tests | sort
  echo; echo "## test functions on local main"; git -C "$REPO" grep -oE 'def test_[A-Za-z0-9_]+' main -- tests | sort
  echo; echo "## test functions in main working tree"; git -C "$REPO" grep --untracked -oE 'def test_[A-Za-z0-9_]+' -- tests | sort
  echo; echo "## ci.yml timeout on origin/main / local main / working tree"
  git -C "$ORIGIN" show main:.github/workflows/ci.yml 2>/dev/null | grep -n 'timeout-minutes'
  git -C "$REPO" show main:.github/workflows/ci.yml 2>/dev/null | grep -n 'timeout-minutes'
  grep -n 'timeout-minutes' "$REPO/.github/workflows/ci.yml"
  echo; echo "## child rollouts copied"; ls "$OUT/child-rollouts" 2>/dev/null | wc -l | tr -d ' '
} >"$OUT/final-state.txt" 2>&1
log "done: $OUT"
