#!/usr/bin/env bash
# Tier — does an agent APPLYING the multi-model skill take the right action at
# five decision points, and did it open the reference file that holds the rule?
# Costs 5 x EVAL_REPEAT model calls.
#
# Built to run before and after the skill is split into reference files, so it
# works against any layout: SKILL_DIR points at the skill (default: this
# checkout's multi-model skill); a read-check whose reference file does not
# exist in that layout prints "SKIP read-check (X absent)" and passes.
#
#   SKILL_DIR=/path/to/older/checkout/plugins/orchestration/skills/multi-model \
#     bash tests/eval/skill-navigation.sh
#
# Sourcing this file defines the helpers only (tests/eval/skill-navigation.test.sh
# does, to test the parser and the read-check offline); executing it runs the
# probes.
set -uo pipefail

# nav_parse <events.jsonl>
# Reads a `claude -p --output-format stream-json --verbose` event stream and
# prints one "read<TAB><file_path>" line per Read tool_use block in assistant
# messages, in order, then one "json<TAB><object>" line holding the last
# top-level {...} JSON object of the final `result` text (empty when none).
nav_parse() {
  python3 - "$1" <<'PY'
import json, sys

reads, result = [], ""
with open(sys.argv[1], encoding="utf-8", errors="replace") as fh:
    for line in fh:
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if not isinstance(ev, dict):
            continue
        if ev.get("type") == "assistant":
            content = (ev.get("message") or {}).get("content") or []
            for b in content if isinstance(content, list) else []:
                if isinstance(b, dict) and b.get("type") == "tool_use" and b.get("name") == "Read":
                    p = (b.get("input") or {}).get("file_path")
                    if isinstance(p, str) and "\n" not in p:
                        reads.append(p)
        elif ev.get("type") == "result" and isinstance(ev.get("result"), str):
            result = ev["result"]


def last_object(text):
    dec, i, last = json.JSONDecoder(), 0, None
    while True:
        i = text.find("{", i)
        if i < 0:
            return last
        try:
            obj, end = dec.raw_decode(text, i)
        except ValueError:
            i += 1
            continue
        last, i = obj, end


obj = last_object(result)
for p in reads:
    print("read\t" + p)
print("json\t" + (json.dumps(obj, separators=(",", ":")) if obj is not None else ""))
PY
}

# nav_reads <parsed>  /  nav_answer <parsed> — split nav_parse's output.
nav_reads()  { printf '%s\n' "$1" | awk -F'\t' '$1 == "read" { print substr($0, 6) }'; }
nav_answer() { printf '%s\n' "$1" | awk -F'\t' '$1 == "json" { print substr($0, 6) }'; }

# nav_field <json> <key> — the field's value: booleans as true/false, strings
# as-is, anything else as compact JSON; "<missing>" when absent or unparseable.
nav_field() {
  python3 - "$1" "$2" <<'PY'
import json, sys
try:
    d = json.loads(sys.argv[1])
except ValueError:
    d = None
if not isinstance(d, dict) or sys.argv[2] not in d:
    print("<missing>")
else:
    v = d[sys.argv[2]]
    if isinstance(v, bool):
        print("true" if v else "false")
    elif isinstance(v, str):
        print(v)
    else:
        print(json.dumps(v))
PY
}

# nav_read_status <skill_dir> <relpath> <reads-file> [<cwd for relative reads>]
# Prints "skip" when <skill_dir>/<relpath> does not exist, else "yes" when one
# of the paths listed in <reads-file> resolves to it, else "no".
nav_read_status() {
  python3 - "$1" "$2" "$3" "${4:-$PWD}" <<'PY'
import os, sys
skill_dir, rel, reads_file, cwd = sys.argv[1:5]
target = os.path.join(skill_dir, rel)
if not os.path.exists(target):
    print("skip")
    sys.exit(0)
target = os.path.realpath(target)
with open(reads_file, encoding="utf-8", errors="replace") as fh:
    for p in fh.read().splitlines():
        if p and os.path.realpath(os.path.join(cwd, os.path.expanduser(p))) == target:
            print("yes")
            sys.exit(0)
print("no")
PY
}

# nav_report_read <skill_dir> <relpath> <k> <n> — the read-check verdict over
# n repetitions (k of which read the file). Needs tests/lib.sh. <relpath> may
# be prefixed `optional:` (e.g. `optional:references/foo.md`): the read is
# still counted, but it is reported as a pass that never fails — an agent is
# not required to open the file, only measured on whether it did.
nav_report_read() {
  local skill_dir="$1" relpath="$2" k="$3" n="$4" optional=false
  case "$relpath" in
    optional:*) optional=true; relpath="${relpath#optional:}" ;;
  esac
  if [ ! -e "$skill_dir/$relpath" ]; then
    pass "SKIP read-check ($relpath absent)"
  elif [ "$optional" = true ]; then
    pass "INFO read $relpath ($k/$n, optional)"
  else
    expect "read $relpath ($k/$n)" "$n" "$k"
  fi
}

# nav_probe <id> <title> <read-relpath or ""> <scenario> <json-shape> <assertion>...
# An assertion is "eq:<field>:<value>" or "has:<field>:<needle>". Runs the
# probe EVAL_REPEAT times, each in a fresh temp directory, and reports k/n per
# assertion; any failed repetition fails the assertion.
nav_probe() {
  local id="$1" title="$2" ref="$3" scenario="$4" shape="$5"
  shift 5
  local n="${EVAL_REPEAT:-1}" rep dir parsed answer a kind rest field want got i
  local skill_k=0 ref_k=0
  local counts=()
  for i in $(seq 0 $(($# - 1))); do counts[$i]=0; done

  section "$id — $title (x$n)"
  for rep in $(seq 1 "$n"); do
    dir="$(mktemp -d "$NAV_WORK/$id.XXXXXX")"
    cat > "$dir/prompt.md" <<EOF
EVAL MODE: Read and apply the multi-model skill at $SKILL_DIR/SKILL.md, following its instructions about which reference files to read. Do not run or change anything; answer with ONLY one JSON object in the shape given below.

SCENARIO:
$scenario

JSON SHAPE:
$shape
EOF
    (cd "$dir" && timeout "${EVAL_TIMEOUT:-600}" claude -p --model "$EVAL_MODEL" \
      --permission-mode dontAsk --permission-prompts none \
      --allowedTools 'Read,Glob,Grep' --add-dir "$SKILL_DIR" \
      --output-format stream-json --verbose \
      --no-session-persistence < prompt.md > events.jsonl) \
      || printf '        (%s run %s: claude exited non-zero)\n' "$id" "$rep"
    parsed="$(nav_parse "$dir/events.jsonl")"
    nav_reads "$parsed" > "$dir/reads.txt"
    answer="$(nav_answer "$parsed")"
    printf '        run %s: %s\n' "$rep" "${answer:-<no JSON object in result>}"

    [ "$(nav_read_status "$SKILL_DIR" SKILL.md "$dir/reads.txt" "$dir")" = yes ] && skill_k=$((skill_k+1))
    if [ -n "$ref" ] && [ "$(nav_read_status "$SKILL_DIR" "${ref#optional:}" "$dir/reads.txt" "$dir")" = yes ]; then
      ref_k=$((ref_k+1))
    fi

    i=0
    for a in "$@"; do
      kind="${a%%:*}"; rest="${a#*:}"; field="${rest%%:*}"; want="${rest#*:}"
      got="$(nav_field "$answer" "$field")"
      case "$kind" in
        eq)  [ "$got" = "$want" ] && counts[$i]=$((counts[$i]+1)) ;;
        has) case "$got" in "<missing>") ;; *"$want"*) counts[$i]=$((counts[$i]+1)) ;; esac ;;
      esac
      i=$((i+1))
    done
  done

  expect "read SKILL.md ($skill_k/$n)" "$n" "$skill_k"
  [ -n "$ref" ] && nav_report_read "$SKILL_DIR" "$ref" "$ref_k" "$n"
  i=0
  for a in "$@"; do
    kind="${a%%:*}"; rest="${a#*:}"; field="${rest%%:*}"; want="${rest#*:}"
    case "$kind" in
      eq)  expect "$field = $want (${counts[$i]}/$n)" "$n" "${counts[$i]}" ;;
      has) expect "$field contains '$want' (${counts[$i]}/$n)" "$n" "${counts[$i]}" ;;
    esac
    i=$((i+1))
  done
}

AMEND_SHAPE='{"rework_same_executor": bool, "escalate": bool, "ask_user": bool, "amend_contract": bool, "edit_plan_file": bool, "reinvoke_runner": bool}
- rework_same_executor: you send the task back to the same executor under the unchanged contract
- escalate: you move the task to the next model on its escalation ladder
- ask_user: you stop and ask the user before going further with this task
- amend_contract: you change the task'"'"'s contract
- edit_plan_file: you write that contract change into the plan file
- reinvoke_runner: you invoke the wave runner again for this task after that change'

nav_main() {
  local root requested
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || exit 1
  requested="${SKILL_DIR:-$root/plugins/orchestration/skills/multi-model}"
  SKILL_DIR="$(cd "$requested" 2>/dev/null && pwd)" \
    || { printf 'SKILL_DIR does not exist: %s\n' "$requested" >&2; exit 2; }
  cd "$root" || exit 1
  . tests/lib.sh
  EVAL_MODEL="${EVAL_MODEL:-claude-opus-5-5}"
  NAV_WORK="$(mktemp -d)"; trap 'rm -rf "$NAV_WORK"' EXIT
  printf '  skill: %s\n  model: %s\n' "$SKILL_DIR" "$EVAL_MODEL"
  if [ ! -f "$SKILL_DIR/SKILL.md" ]; then
    fail "SKILL_DIR holds SKILL.md" "$SKILL_DIR"
    summary; return
  fi

  nav_probe N1 "launch a Claude-only wave" references/claude-wave-adapter.md \
'You are the orchestrator. The user asked you to run wave 1 of a plan.
- Every task in wave 1 routes to Claude models only (executors and supervisors).
- The plan is /tmp/demo/plan.md and it is lint-clean.
- Wave: 1. Base commit (pushed): 1111111111111111111111111111111111111111
- Repository: /tmp/demo/repo, default branch main.
Say exactly how you would launch this wave.' \
'{"generator_command": string, "workflow_call": string, "passes_args_inline": bool}
- generator_command: the exact shell command you would run to prepare the launch
- workflow_call: the exact tool call you would then make to start the wave
- passes_args_inline: whether that tool call passes the wave arguments inline in the call' \
    "has:generator_command:wave-launch.mjs" \
    "has:generator_command:--wave 1" \
    "has:generator_command:1111111111111111111111111111111111111111" \
    "has:workflow_call:scriptPath" \
    "eq:passes_args_inline:false"

  nav_probe N2 "unsatisfiable contract, fix widens files_allowed" references/contract-amendment.md \
'You are the orchestrator of a running wave. The wave runner returned status
contract-unsatisfiable for task api-fix. The supervisor verdict says:
- must_run: `pytest tests/api` fails because it needs the fixture file
  tests/fixtures/api.json, which lies outside the task'"'"'s
  files_allowed: [src/api/**, tests/api/**]
- satisfiable: false
Adding that one fixture file would let the command pass; nothing else in the
contract stands in the way. Decide what you do next for task api-fix.' \
"$AMEND_SHAPE" \
    "eq:rework_same_executor:false" \
    "eq:escalate:false" \
    "eq:ask_user:false" \
    "eq:amend_contract:true" \
    "eq:edit_plan_file:true" \
    "eq:reinvoke_runner:true"

  nav_probe N3 "unsatisfiable contract, only fix deletes a must_run" references/contract-amendment.md \
'You are the orchestrator of a running wave. The wave runner returned status
contract-unsatisfiable for task api-fix. The supervisor verdict says:
- must_run: `pytest tests/api` fails, and no change to any file can make it
  pass; the task'"'"'s files_allowed is [src/api/**, tests/api/**]
- satisfiable: false
The only possible fix is deleting the `pytest tests/api` entry from the
task'"'"'s must_run. Decide what you do next for task api-fix.' \
"$AMEND_SHAPE" \
    "eq:ask_user:true" \
    "eq:rework_same_executor:false" \
    "eq:escalate:false"

  nav_probe N4 "failed verdict whose pasted evidence did not reproduce" references/verdicts.md \
'You are the orchestrator of a running wave. Task retry has finished its first
attempt. The supervisor verdict is ok:false with one violation of class
must_run, and pasteReproduced: false: the executor'"'"'s report pasted a green
run of the must_run command, while the supervisor'"'"'s own run of it got 2
failures. Decide what happens next for task retry.' \
'{"next": "rework-same-executor" | "escalate" | "stop", "tell_executor_it_lied": bool, "attach_verdict": bool}
- next: the next step for this task
- tell_executor_it_lied: whether your message to the executor says its report was dishonest or fabricated
- attach_verdict: whether the executor receives the supervisor verdict' \
    "eq:next:rework-same-executor" \
    "eq:tell_executor_it_lied:false" \
    "eq:attach_verdict:true"

  # The orchestrator's duty on drift advice is stated in SKILL.md; the hook
  # file is maintenance documentation, so reading it is informational
  # (measured 2026-09-23: Sonnet 5 correct 3/3 without opening it).
  nav_probe N5 "drift advice from the Stop hook" optional:references/orchestrator-drift-hook.md \
'You are the orchestrator, in the middle of a wave. The Stop hook injected this
advice into your session: "task beta has no supervisor verdict, yet your last
message said all tasks are done". Decide how you respond.' \
'{"act_or_explain": bool, "ignore": bool, "claim_done_now": bool}
- act_or_explain: you act on the advice, or state why it does not apply
- ignore: you carry on without acting on or answering the advice
- claim_done_now: you now report the wave as done' \
    "eq:act_or_explain:true" \
    "eq:ignore:false" \
    "eq:claim_done_now:false"

  summary
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  nav_main
  exit $?
fi
