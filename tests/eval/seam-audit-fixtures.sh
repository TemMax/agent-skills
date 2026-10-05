#!/usr/bin/env bash
# Hands the read-only seam-audit agent a ready plan plus a mini repo and the
# Seam audit step text of the provider's super-plan entrypoint, then scores
# the defects it reports. A calibration tool run by hand, not a per-release
# tier; fails are data, so a completed run exits 0.
#
# Usage: bash tests/eval/seam-audit-fixtures.sh [--provider claude|codex] [--model <id>]
#                                               [--effort <level>] [--repeat N]
#                                               [--only <fixture>] [--check]
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh
. tests/eval/model-cli.sh

usage() {
  echo "usage: bash tests/eval/seam-audit-fixtures.sh [--provider claude|codex] [--model <id>] [--effort <level>] [--repeat N] [--only <fixture>] [--check]" >&2
  exit 2
}

PROVIDER=claude
MODEL=""
EFFORT=medium
REPEAT=1
ONLY=""
CHECK=0
while [ $# -gt 0 ]; do
  case "$1" in
    --provider) [ $# -ge 2 ] || usage; PROVIDER="$2"; shift 2 ;;
    --model) [ $# -ge 2 ] || usage; MODEL="$2"; shift 2 ;;
    --effort) [ $# -ge 2 ] || usage; EFFORT="$2"; shift 2 ;;
    --repeat) [ $# -ge 2 ] || usage; REPEAT="$2"; shift 2 ;;
    --only) [ $# -ge 2 ] || usage; ONLY="$2"; shift 2 ;;
    --check) CHECK=1; shift ;;
    *) usage ;;
  esac
done
case "$PROVIDER" in claude|codex) ;; *) usage ;; esac
case "$REPEAT" in ''|*[!0-9]*) usage ;; esac
[ "$REPEAT" -ge 1 ] || usage
[ -n "$EFFORT" ] || usage
if [ -z "$MODEL" ]; then
  case "$PROVIDER" in
    claude) MODEL=claude-sonnet-5-5 ;;
    codex) MODEL=gpt-6.1-sol ;;
  esac
fi

FIXDIR="${SEAM_FIXTURES_DIR:-tests/eval/fixtures/seam-audit}"
FIXDIR="$(cd "$FIXDIR" 2>/dev/null && pwd)" || { echo "seam-audit-fixtures: no fixtures dir" >&2; exit 2; }
LINT="$PWD/plugins/orchestration/skills/super-plan/references/plan-lint.mjs"

FIXTURES=""
for d in "$FIXDIR"/*/; do
  [ -f "${d}plan.md" ] || continue
  FIXTURES="${FIXTURES}$(basename "$d")
"
done
if [ -n "$ONLY" ]; then
  printf '%s' "$FIXTURES" | grep -qxF -- "$ONLY" || { echo "seam-audit-fixtures: unknown fixture: $ONLY" >&2; exit 2; }
  FIXTURES="$ONLY
"
fi
if [ -z "$FIXTURES" ]; then
  echo "seam-audit-fixtures: no fixtures in $FIXDIR" >&2
  exit 2
fi

VALIDATE_PY='
import json, sys
s = json.load(open(sys.argv[1]))
assert isinstance(s, dict)
assert s.get("expect") in ("defect", "clean"), "expect must be defect or clean"
assert s.get("check") in ("same-task-readers", "producer-before-consumer", "implementers-and-fakes", "prose-vs-forbidden-moves", "base-status", "none"), "bad check"
for key in ("must_name", "must_not_name"):
    v = s.get(key, [])
    assert isinstance(v, list) and all(isinstance(x, str) for x in v), key + " must be a list of strings"
if s["expect"] == "defect":
    assert s.get("must_name"), "defect needs a non-empty must_name"
    assert s["check"] != "none", "defect needs a real check"
else:
    assert s.get("must_name", []) == [], "clean needs an empty must_name"
    assert s["check"] == "none", "clean needs check none"
'

if [ "$CHECK" -eq 1 ]; then
  BAD=0
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    d="$FIXDIR/$name"
    reason=""
    if [ ! -f "$d/score.json" ]; then
      reason="score.json missing"
    elif ! msg="$(python3 -B -c "$VALIDATE_PY" "$d/score.json" 2>&1)"; then
      reason="score.json invalid: $(printf '%s' "$msg" | tail -n 1)"
    elif [ ! -d "$d/repo" ] || [ -z "$(ls -A "$d/repo" 2>/dev/null)" ]; then
      reason="repo/ missing or empty"
    elif ! lint="$(node "$LINT" "$d/plan.md" --repo "$d/repo" 2>&1)" || ! printf '%s' "$lint" | grep -qF 'OK: 0 error(s)'; then
      reason="plan.md not lint-clean: $(printf '%s' "$lint" | tr '\n' ' ' | cut -c1-200)"
    fi
    if [ -n "$reason" ]; then
      printf 'FAIL %s: %s\n' "$name" "$reason"
      BAD=1
    else
      printf 'PASS %s\n' "$name"
    fi
  done <<EOF
$FIXTURES
EOF
  exit "$BAD"
fi

# Skill step text: from the Seam audit line up to (not including) the Lint line.
if [ "$PROVIDER" = codex ]; then
  SKILL=plugins/orchestration/skills-codex/super-plan/SKILL.md
else
  SKILL=plugins/orchestration/skills/super-plan/SKILL.md
fi
STEP="$(python3 tests/lib/skill-source.py "$SKILL" | awk '/^5\. \*\*Seam audit\.\*\*/ {on=1} /^6\. \*\*Lint\.\*\*/ {on=0} on')"
if [ -z "$STEP" ]; then
  echo "seam-audit-fixtures: Seam audit step not found in $SKILL" >&2
  exit 2
fi

W=$(mktemp -d)
trap 'rm -rf "$W"' EXIT

# Reads the answer and score.json; prints "<pass|fail|error>\t<detail>".
SCORE_PY='
import json, re, sys
ans = open(sys.argv[1], errors="replace").read()
score = json.load(open(sys.argv[2]))
blocks = re.findall(r"^```json seam-verdict[ \t]*\n(.*?)^```[ \t]*$", ans, re.S | re.M)
if not blocks:
    print("error\tno json seam-verdict block"); sys.exit()
try:
    v = json.loads(blocks[-1])
    blocking = v["blocking"]
    assert isinstance(blocking, list)
except Exception as e:
    print("error\tunparseable verdict: " + str(e).replace("\n", " ")[:120]); sys.exit()
text = json.dumps(blocking).lower()
if score["expect"] == "clean":
    if blocking:
        print("fail\tunexpected blocking entry: " + re.sub(r"\s+", " ", json.dumps(blocking[0]))[:200])
    else:
        print("pass\t")
    sys.exit()
if not blocking:
    print("fail\tno blocking entry; missing: " + ", ".join(score["must_name"])); sys.exit()
missing = [m for m in score.get("must_name", []) if m.lower() not in text]
hit = [m for m in score.get("must_not_name", []) if m.lower() in text]
if missing:
    print("fail\tmissing must_name: " + ", ".join(missing))
elif hit:
    print("fail\tmatched must_not_name: " + ", ".join(hit))
else:
    print("pass\t")
'

P=0; F=0; E=0
while IFS= read -r name; do
  [ -n "$name" ] || continue
  d="$FIXDIR/$name"
  rep=1
  while [ "$rep" -le "$REPEAT" ]; do
    run="$W/$name-$rep"
    mkdir -p "$run"
    repo="$run/repo"
    plan="$run/plan.md"
    prompt="$run/prompt.md"
    answer="$run/answer.md"
    verdict=error; detail=""
    if ! cp -R "$d/repo" "$repo" 2>/dev/null; then
      detail="cannot copy repo"
    elif ! { git -C "$repo" init -q && git -C "$repo" add -A \
        && git -C "$repo" -c user.name=seam -c user.email=seam@example.invalid -c commit.gpgsign=false commit -q -m base; } >/dev/null 2>&1; then
      detail="cannot init fixture repo"
    else
      cp "$d/plan.md" "$plan"
      {
        printf '%s\n' 'You are the read-only seam-audit agent of the super-plan skill. Your'
        printf '%s\n' 'instructions are this step of the skill (you are the audit agent it'
        printf '%s\n\n' 'describes: do not spawn agents and do not fix anything — report):'
        printf '%s\n\n' "$STEP"
        printf 'Audit the wave plan at %s against the repository at %s\n' "$plan" "$repo"
        printf '%s\n' '(a git repository whose HEAD is the plan'"'"'s base). Read-only:'
        printf '%s\n' 'never create, edit or delete files. You may run commands; run Python'
        printf '%s\n' 'with `python3 -B` so nothing is written. Report only real seam defects'
        printf '%s\n' 'as blocking; put doubts and minor points in notes. End your answer with'
        printf '%s\n' 'exactly one fenced block whose info string is `json seam-verdict`,'
        printf '%s\n' 'containing {"blocking": [{"check": "...", "summary": "...",'
        printf '%s\n' '"evidence": "..."}], "notes": ["..."]} — "blocking": [] when the plan'
        printf '%s\n' 'is sound.'
      } > "$prompt"
      if [ -n "${SEAM_FIXTURES_FAKE_ANSWER:-}" ]; then
        cp "$SEAM_FIXTURES_FAKE_ANSWER" "$answer" 2>/dev/null || detail="cannot read fake answer"
      elif ! EVAL_PROVIDER="$PROVIDER" EVAL_MODEL="$MODEL" EVAL_EFFORT="$EFFORT" \
          eval_model_answer "$repo" read-only "$prompt" "$answer" >/dev/null 2>"$run/stderr"; then
        detail="model call failed: $(tr '\n\t' '  ' < "$run/stderr" | cut -c1-160)"
      fi
      if [ -z "$detail" ]; then
        res="$(python3 -B -c "$SCORE_PY" "$answer" "$d/score.json" 2>&1)"
        verdict="${res%%	*}"
        detail="${res#*	}"
        case "$verdict" in pass|fail|error) ;; *) verdict=error; detail="scorer failed: $(printf '%s' "$res" | tr '\n\t' '  ' | cut -c1-160)" ;; esac
      fi
    fi
    if [ -n "${SEAM_FIXTURES_KEEP_DIR:-}" ]; then
      mkdir -p "$SEAM_FIXTURES_KEEP_DIR/$name-$rep"
      cp "$prompt" "$SEAM_FIXTURES_KEEP_DIR/$name-$rep/prompt.md" 2>/dev/null
      cp "$answer" "$SEAM_FIXTURES_KEEP_DIR/$name-$rep/answer.md" 2>/dev/null
    fi
    row="$name	$PROVIDER	$MODEL	$rep	$verdict	$detail"
    printf '%s\n' "$row"
    [ -n "${SEAM_FIXTURES_RESULTS:-}" ] && printf '%s\n' "$row" >> "$SEAM_FIXTURES_RESULTS"
    case "$verdict" in pass) P=$((P+1)) ;; fail) F=$((F+1)) ;; *) E=$((E+1)) ;; esac
    rep=$((rep+1))
  done
done <<EOF
$FIXTURES
EOF

printf 'pass=%s fail=%s error=%s\n' "$P" "$F" "$E"
exit 0
