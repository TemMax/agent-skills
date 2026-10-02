#!/usr/bin/env bash
# Sends drift cases through the real drift hook (plugins/orchestration/hooks/drift-check).
# A calibration tool run by hand, not a per-release live tier.
# In normal mode a case the hook would not send to a judge (dry-run not `would-call`) scores error, never a silent pass.
#
# Usage: bash tests/eval/drift-fixtures.sh [--set tuning|heldout|all] [--seat <model>]
#                                          [--judge <model>] [--repeat N] [--check]
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

usage() {
  echo "usage: bash tests/eval/drift-fixtures.sh [--set tuning|heldout|all] [--seat <model>] [--judge <model>] [--repeat N] [--check]" >&2
  exit 2
}

SET=tuning
SEAT=gpt-6-astra
JUDGE=""
REPEAT=1
CHECK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --set) [ $# -ge 2 ] || usage; SET="$2"; shift 2 ;;
    --seat) [ $# -ge 2 ] || usage; SEAT="$2"; shift 2 ;;
    --judge) [ $# -ge 2 ] || usage; JUDGE="$2"; shift 2 ;;
    --repeat) [ $# -ge 2 ] || usage; REPEAT="$2"; shift 2 ;;
    --check) CHECK=1; shift ;;
    *) usage ;;
  esac
done
case "$SET" in tuning|heldout|all) ;; *) usage ;; esac
case "$REPEAT" in ''|*[!0-9]*) usage ;; esac
[ "$REPEAT" -ge 1 ] || usage

TUNING_DIR="${DRIFT_FIXTURES_DIR:-tests/eval/fixtures/drift}"
HELDOUT_DIR="${DRIFT_HELDOUT_DIR:-tests/eval/fixtures/drift-heldout}"

# Case list: "<set>|<absolute dir>" lines.
CASES=""
collect() { # <set> <dir> <marker file>
  local set="$1" dir="$2" marker="$3" abs d found=0
  abs="$(cd "$dir" 2>/dev/null && pwd)"
  if [ -n "$abs" ]; then
    for d in "$abs"/*/; do
      [ -f "${d}${marker}" ] || continue
      CASES="${CASES}${set}|${d%/}
"
      found=1
    done
  fi
  if [ "$found" -eq 0 ]; then
    echo "drift-fixtures: no cases in $dir" >&2
    exit 2
  fi
}
case "$SET" in
  tuning) collect tuning "$TUNING_DIR" plan.md ;;
  heldout) collect heldout "$HELDOUT_DIR" case.json ;;
  all) collect tuning "$TUNING_DIR" plan.md; collect heldout "$HELDOUT_DIR" case.json ;;
esac

W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT
mkdir -p "$W/tmp"
export TMPDIR="$W/tmp"
. tests/test-env.sh

HOOK="$PWD/plugins/orchestration/hooks/drift-check"
PLUGIN_ROOT="$PWD/plugins/orchestration"
BUILDER="$PWD/tests/eval/drift-rollout.mjs"

# Reads score.json and the hook output; prints "<class>\t<result>\t<advice>".
SCORE_PY='
import json, re, sys
out, logfile, scorefile = sys.argv[1], sys.argv[2], sys.argv[3]
score = json.load(open(scorefile))
unavailable = False
try:
    with open(logfile) as f:
        unavailable = any("\"status\": \"unavailable\"" in line for line in f)
except OSError:
    pass
advice = ""
if out.startswith("{\"decision\":\"block\""):
    cls = "advice"
    try:
        advice = json.loads(out).get("reason", "")
    except Exception:
        cls = "error"
elif out.strip() == "{}" and not unavailable:
    cls = "nothing"
else:
    cls = "error"
    advice = out
if cls == "error":
    res = "error"
elif score["expect"] == "nothing":
    res = "pass" if cls == "nothing" else "fail"
else:
    ok = cls == "advice"
    for rx in score.get("must_name", []):
        ok = ok and re.search(rx, advice, re.IGNORECASE) is not None
    for rx in score.get("must_not_name", []):
        ok = ok and re.search(rx, advice, re.IGNORECASE) is None
    res = "pass" if ok else "fail"
flat = re.sub(r"[\n\t\r]", " ", advice)[:300]
print(cls + "\t" + res + "\t" + flat)
'

VALIDATE_PY='
import json, re, sys
s = json.load(open(sys.argv[1]))
assert isinstance(s, dict) and s.get("expect") in ("nothing", "advice")
for key in ("must_name", "must_not_name"):
    v = s.get(key, [])
    assert isinstance(v, list) and all(isinstance(x, str) for x in v)
    for x in v:
        re.compile(x)
if s["expect"] == "advice":
    assert s.get("must_name")
'

PAYLOAD_PY='
import json, sys
print(json.dumps({"hook_event_name": "Stop", "model": sys.argv[1], "stop_hook_active": False,
                  "last_assistant_message": sys.argv[2], "session_id": sys.argv[3],
                  "transcript_path": sys.argv[4]}))
'

P=0; F=0; E=0
ROWS=""
NOTREADY=0
PERCASE=""

while IFS='|' read -r set dir; do
  [ -n "$set" ] || continue
  name="$(basename "$dir")"
  id="$set/$name"
  err=""
  plan_text=""; transcript=""; last_msg=""

  if [ "$set" = tuning ]; then
    plan_text="$(cat "$dir/plan.md" 2>/dev/null)" || err="cannot read plan.md"
    transcript="$dir/transcript.txt"
    if [ -f "$dir/last_message.txt" ]; then
      last_msg="$(cat "$dir/last_message.txt")"
    else
      last_msg="$(grep '^\[orchestrator' "$dir/transcript.txt" 2>/dev/null | tail -n 1 | sed 's/^\[orchestrator[^]]*\] *//')"
    fi
  else
    plan_text="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["plan"], end="")' "$dir/case.json" 2>/dev/null)" || err="cannot read plan from case.json"
    transcript="$W/$name.jsonl"
    if [ -z "$err" ]; then
      last_msg="$(node "$BUILDER" "$dir/case.json" "$transcript" 2>"$W/$name.builder.err")" \
        || err="builder failed: $(tr '\n' ' ' < "$W/$name.builder.err")"
    fi
  fi
  if [ -z "$err" ] && ! python3 -c "$VALIDATE_PY" "$dir/score.json" 2>/dev/null; then
    err="score.json missing or malformed"
  fi

  if [ -n "$err" ]; then
    if [ "$CHECK" -eq 1 ]; then
      printf '%s\tnot-ready\t%s\n' "$id" "$err"
      NOTREADY=1
    else
      ROWS="${ROWS}${id}	-	-	-	error	${err}
"
      printf '%s\t-\t-\t-\terror\t%s\n' "$id" "$err"
      E=$((E+1))
      PERCASE="${PERCASE}${id}: 0/0
"
    fi
    continue
  fi

  repo="$W/repo-$set-$name"
  git init -q "$repo"
  git -C "$repo" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
  mkdir -p "$repo/docs/superpowers/plans"
  planfile="$repo/docs/superpowers/plans/2026-01-01-case.md"
  { printf 'status: active\n\n'; printf '%s\n' "$plan_text"; } > "$planfile"
  for b in $(sed -n 's/^[[:space:]-]*"\{0,1\}branch"\{0,1\}:[[:space:]]*"\{0,1\}\([A-Za-z0-9._\/-]*\)"\{0,1\}.*/\1/p' "$planfile" | sort -u); do
    git -C "$repo" branch "$b"
  done

  hook_call() { # <session_id> [extra env assignments...]
    local sid="$1"; shift
    local payload
    payload="$(python3 -c "$PAYLOAD_PY" "$SEAT" "$last_msg" "$sid" "$transcript")"
    if [ -n "$JUDGE" ]; then
      ( cd "$repo" && printf '%s' "$payload" | env "$@" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" DRIFT_CHECK_JUDGE_MODEL="$JUDGE" "$HOOK" )
    else
      ( cd "$repo" && printf '%s' "$payload" | env "$@" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" "$HOOK" )
    fi
  }

  if [ "$CHECK" -eq 1 ]; then
    out="$(hook_call "drift-$name-check-$$" DRIFT_CHECK_DRYRUN=1 2>&1)"
    case "$out" in
      "would-call: host=codex judge="*) printf '%s\tready\t%s\n' "$id" "$out" ;;
      *) printf '%s\tnot-ready\t%s\n' "$id" "not-ready: $out"; NOTREADY=1 ;;
    esac
    continue
  fi

  expect="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["expect"])' "$dir/score.json")"
  ready="$(hook_call "drift-$name-check-$$" DRIFT_CHECK_DRYRUN=1 2>&1)"
  case "$ready" in
    "would-call: host=codex judge="*) ;;
    *)
      row="$id	-	$expect	error	error	not-ready: $ready"
      printf '%s\n' "$row"
      ROWS="${ROWS}${row}
"
      E=$((E+1))
      PERCASE="${PERCASE}${id}: 0/${REPEAT}
"
      continue
      ;;
  esac
  passes=0
  run=1
  while [ "$run" -le "$REPEAT" ]; do
    sid="drift-$name-$run-$$"
    out="$(hook_call "$sid" 2>/dev/null)"
    res="$(python3 -c "$SCORE_PY" "$out" "$TMPDIR/claude-drift-log/$sid.jsonl" "$dir/score.json")"
    cls="${res%%	*}"; rest="${res#*	}"
    verdict="${rest%%	*}"; advice="${rest#*	}"
    row="$id	$run	$expect	$cls	$verdict	$advice"
    printf '%s\n' "$row"
    ROWS="${ROWS}${row}
"
    case "$verdict" in
      pass) P=$((P+1)); passes=$((passes+1)) ;;
      fail) F=$((F+1)) ;;
      *) E=$((E+1)) ;;
    esac
    run=$((run+1))
  done
  PERCASE="${PERCASE}${id}: ${passes}/${REPEAT}
"
done <<EOF
$CASES
EOF

if [ "$CHECK" -eq 1 ]; then
  [ "$NOTREADY" -eq 0 ]
  exit $?
fi

printf '%s' "$PERCASE"
printf 'drift-fixtures: judge=%s seat=%s pass=%s fail=%s error=%s\n' "${JUDGE:-mapped}" "$SEAT" "$P" "$F" "$E"
if [ -n "${DRIFT_FIXTURES_RESULTS:-}" ]; then
  printf '%s' "$ROWS" >> "$DRIFT_FIXTURES_RESULTS"
fi
[ "$F" -eq 0 ] && [ "$E" -eq 0 ]
