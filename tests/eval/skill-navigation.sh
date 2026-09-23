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

# nav_parse_codex <events.jsonl>
# Same output format as nav_parse, for a `codex exec --json` event stream.
# The answer is the last top-level {...} JSON object (same last_object logic
# as nav_parse) found in the text of the last item.completed event whose
# item.type == "agent_message". Reads are recovered from every item.completed
# event whose item.type == "command_execution": its item.command is unwrapped
# from a `<shell> -lc '<script>'` / `-c` form when <shell>'s basename is
# bash/zsh/sh (otherwise the whole command is the script), the script is split
# into simple commands at && || ; | & and newlines, `cd` updates a tracked
# working directory (starting at None, meaning the probe directory), and for
# each simple command whose program is cat/sed/head/tail/nl/awk/less/more/bat/
# rg/grep/view every non-flag argument containing "/" or ending in ".md" is
# emitted — glob-expanded when it holds *, ? or [, else resolved against the
# tracked directory when known and the argument is relative. Unparseable
# scripts are skipped (their event contributes no reads).
nav_parse_codex() {
  python3 - "$1" <<'PY'
import glob, json, os, re, shlex, sys

READ_PROGS = {"cat", "sed", "head", "tail", "nl", "awk", "less", "more", "bat", "rg", "grep", "view"}
SEPARATORS = {"&&", "||", ";", "|", "&", "\n"}
LEADING_KEYWORDS = {"do", "then", "else", "elif", "{", "("}
LONE_IGNORED = {"done", "fi", "}", ")"}
NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
ASSIGN_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", re.DOTALL)

reads = []
answer_text = ""


def simple_commands(script):
    lex = shlex.shlex(script, posix=True, punctuation_chars=True)
    lex.whitespace = " \t"
    cmds, cur = [], []
    for tok in lex:
        if tok in SEPARATORS:
            if cur:
                cmds.append(cur)
                cur = []
        else:
            cur.append(tok)
    if cur:
        cmds.append(cur)
    return cmds


def substitute(s, variables):
    if not variables:
        return s
    for name in sorted(variables, key=len, reverse=True):
        val = variables[name]
        s = s.replace("${" + name + "}", val)
        s = s.replace("$" + name, val)
    return s


def reglue(tokens):
    # simple_commands' shlex config (posix, no whitespace_split) only fuses a
    # maximal run of wordchars into one token; "$", "{" and "}" are not
    # wordchars, so an UNQUOTED ${NAME}tail or $NAMEtail fragments into
    # several tokens with no separator between them. Splice those back into
    # one word so substitution below sees the same "argument" a shell would.
    # A quoted "$NAME..." already arrives as a single token and is untouched.
    out = []
    i, n = 0, len(tokens)
    while i < n:
        tok = tokens[i]
        if tok == "$" and i + 1 < n and tokens[i + 1] == "{":
            j = i + 2
            frag = "${"
            while j < n and tokens[j] != "}":
                frag += tokens[j]
                j += 1
            if j < n:
                frag += "}"
                j += 1
            if j < n and not tokens[j].startswith("-"):
                frag += tokens[j]
                j += 1
            out.append(frag)
            i = j
        elif tok == "$" and i + 1 < n:
            out.append("$" + tokens[i + 1])
            i += 2
        else:
            out.append(tok)
            i += 1
    return out


def emit_path_arg(arg, cwd):
    if any(c in arg for c in "*?["):
        pattern = arg
        if cwd is not None and not os.path.isabs(arg):
            pattern = os.path.join(cwd, arg)
        for m in sorted(glob.glob(pattern)):
            reads.append(m)
    elif cwd is not None and not os.path.isabs(arg):
        reads.append(os.path.join(cwd, arg))
    else:
        reads.append(arg)


def process(command):
    try:
        parts = shlex.split(command)
    except ValueError:
        parts = None
    script = command
    if parts and len(parts) == 3 and parts[1] in ("-lc", "-c") \
            and os.path.basename(parts[0]) in ("bash", "zsh", "sh"):
        script = parts[2]
    try:
        cmds = simple_commands(script)
    except ValueError:
        return
    cwd = None
    variables = {}
    loop_name = None
    loop_values = []
    for tokens in cmds:
        tokens = reglue(tokens)
        while tokens and tokens[0] in LEADING_KEYWORDS:
            tokens = tokens[1:]
        if not tokens:
            continue
        if len(tokens) == 1 and tokens[0] in LONE_IGNORED:
            if tokens[0] == "done":
                loop_name, loop_values = None, []
            continue
        if tokens[0] == "for" and len(tokens) >= 3 and NAME_RE.match(tokens[1]) \
                and tokens[2] == "in":
            loop_name = tokens[1]
            loop_values = [substitute(w, variables) for w in tokens[3:]]
            continue
        idx = 1 if tokens[0] == "export" else 0
        j = idx
        while j < len(tokens) and ASSIGN_RE.match(tokens[j]):
            j += 1
        if j > idx and j == len(tokens):
            for tok in tokens[idx:j]:
                m = ASSIGN_RE.match(tok)
                variables[m.group(1)] = substitute(m.group(2), variables)
            continue
        if j > idx:
            tokens = tokens[j:]
            if not tokens:
                continue
        prog = os.path.basename(tokens[0])
        if prog == "cd":
            if len(tokens) >= 2:
                d = substitute(tokens[1], variables)
                if os.path.isabs(d):
                    cwd = d
                elif cwd is not None:
                    cwd = os.path.join(cwd, d)
                else:
                    cwd = d
            continue
        if prog not in READ_PROGS:
            continue
        for raw_arg in tokens[1:]:
            if raw_arg.startswith("-"):
                continue
            in_loop_ref = loop_name is not None and (
                "$" + loop_name in raw_arg or "${" + loop_name + "}" in raw_arg
            )
            if in_loop_ref:
                candidates = []
                for v in loop_values:
                    combined = dict(variables)
                    combined[loop_name] = v
                    candidates.append(substitute(raw_arg, combined))
            else:
                candidates = [substitute(raw_arg, variables)]
            for arg in candidates:
                if "$" in arg:
                    continue
                if "/" not in arg and not arg.endswith(".md"):
                    continue
                emit_path_arg(arg, cwd)


with open(sys.argv[1], encoding="utf-8", errors="replace") as fh:
    for line in fh:
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if not isinstance(ev, dict) or ev.get("type") != "item.completed":
            continue
        item = ev.get("item")
        if not isinstance(item, dict):
            continue
        itype = item.get("type")
        if itype == "agent_message":
            text = item.get("text")
            if isinstance(text, str):
                answer_text = text
        elif itype == "command_execution":
            command = item.get("command")
            if isinstance(command, str):
                process(command)


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


obj = last_object(answer_text)
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
    if [ "${EVAL_PROVIDER:-claude}" = codex ]; then
      (cd "$dir" && timeout "${EVAL_TIMEOUT:-600}" codex exec --ephemeral --ignore-user-config --ignore-rules --skip-git-repo-check --sandbox read-only --model "$EVAL_MODEL" -c "model_reasoning_effort=\"${EVAL_EFFORT:-medium}\"" --json -C "$dir" - < prompt.md > events.jsonl) \
        || printf '        (%s run %s: codex exited non-zero)\n' "$id" "$rep"
      parsed="$(nav_parse_codex "$dir/events.jsonl")"
    else
      (cd "$dir" && timeout "${EVAL_TIMEOUT:-600}" claude -p --model "$EVAL_MODEL" \
        --permission-mode dontAsk --permission-prompts none \
        --allowedTools 'Read,Glob,Grep' --add-dir "$SKILL_DIR" \
        --output-format stream-json --verbose \
        --no-session-persistence < prompt.md > events.jsonl) \
        || printf '        (%s run %s: claude exited non-zero)\n' "$id" "$rep"
      parsed="$(nav_parse "$dir/events.jsonl")"
    fi
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

# nav_codex_text <text> — <text> with every occurrence of the phrase
# "wave runner" replaced by "wave's state helper" (Codex waves have no
# runner; codex-wave-state.mjs returns the statuses). Used only to build the
# Codex-mode probe text; the Claude-mode text passed to nav_probe is never
# routed through this function, so it stays exactly as written.
nav_codex_text() {
  local text="$1" apos="'"
  local repl="wave${apos}s state helper"
  printf '%s' "${text//wave runner/$repl}"
}

nav_main() {
  local root requested
  EVAL_PROVIDER="${EVAL_PROVIDER:-claude}"
  case "$EVAL_PROVIDER" in
    claude|codex) ;;
    *) printf 'unknown EVAL_PROVIDER: %s\n' "$EVAL_PROVIDER" >&2; exit 2 ;;
  esac
  root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || exit 1
  requested="${SKILL_DIR:-$root/plugins/orchestration/skills/multi-model}"
  SKILL_DIR="$(cd "$requested" 2>/dev/null && pwd)" \
    || { printf 'SKILL_DIR does not exist: %s\n' "$requested" >&2; exit 2; }
  cd "$root" || exit 1
  . tests/lib.sh
  if [ "$EVAL_PROVIDER" = codex ]; then
    EVAL_MODEL="${EVAL_MODEL:-gpt-5.6-sol}"
  else
    EVAL_MODEL="${EVAL_MODEL:-claude-opus-5-5}"
  fi
  EVAL_EFFORT="${EVAL_EFFORT:-medium}"
  NAV_WORK="$(mktemp -d)"; trap 'rm -rf "$NAV_WORK"' EXIT
  printf '  skill: %s\n  model: %s\n  provider: %s\n' "$SKILL_DIR" "$EVAL_MODEL" "$EVAL_PROVIDER"
  [ "$EVAL_PROVIDER" = codex ] && printf '  effort: %s\n' "$EVAL_EFFORT"
  if [ ! -f "$SKILL_DIR/SKILL.md" ]; then
    fail "SKILL_DIR holds SKILL.md" "$SKILL_DIR"
    summary; return
  fi

  if [ "$EVAL_PROVIDER" = codex ]; then
    nav_probe N1c "launch a Codex-only wave" references/codex-wave-protocol.md \
'You are the orchestrator. The user asked you to run wave 1 of a plan.
- Every task in wave 1 routes to GPT models only (executors gpt-5.6-terra, supervisor gpt-6-astra).
- The plan is /tmp/demo/plan.md and it is lint-clean and user-approved.
- Wave: 1. Base commit (pushed): 1111111111111111111111111111111111111111
- Repository: /tmp/demo/repo, default branch main.
Say exactly how you would launch this wave.' \
'{"lint_command": string, "init_command": string, "uses_claude_workflow": bool}
- lint_command: the exact shell command you would run first
- init_command: the exact shell command that initializes the wave'"'"'s state
- uses_claude_workflow: whether you would start the wave through Claude'"'"'s Workflow tool' \
      "has:lint_command:plan-lint.mjs" \
      "has:init_command:codex-wave-state.mjs" \
      "has:init_command:init" \
      "has:init_command:--wave 1" \
      "has:init_command:1111111111111111111111111111111111111111" \
      "eq:uses_claude_workflow:false"
  else
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
  fi

  local n2_scenario n3_scenario n4_scenario n4_shape n5_scenario n5_shape
  local n2_assertions n3_assertions n4_assertions n5_assertions

  n2_scenario='You are the orchestrator of a running wave. The wave runner returned status
contract-unsatisfiable for task api-fix. The supervisor verdict says:
- must_run: `pytest tests/api` fails because it needs the fixture file
  tests/fixtures/api.json, which lies outside the task'"'"'s
  files_allowed: [src/api/**, tests/api/**]
- satisfiable: false
Adding that one fixture file would let the command pass; nothing else in the
contract stands in the way. Decide what you do next for task api-fix.'
  n2_assertions=(
    "eq:rework_same_executor:false"
    "eq:escalate:false"
    "eq:ask_user:false"
    "eq:amend_contract:true"
    "eq:edit_plan_file:true"
    "eq:reinvoke_runner:true"
  )
  if [ "$EVAL_PROVIDER" = codex ]; then
    nav_probe N2 "unsatisfiable contract, fix widens files_allowed" references/contract-amendment.md \
      "$(nav_codex_text "$n2_scenario")" "$(nav_codex_text "$AMEND_SHAPE")" "${n2_assertions[@]}"
  else
    nav_probe N2 "unsatisfiable contract, fix widens files_allowed" references/contract-amendment.md \
      "$n2_scenario" "$AMEND_SHAPE" "${n2_assertions[@]}"
  fi

  n3_scenario='You are the orchestrator of a running wave. The wave runner returned status
contract-unsatisfiable for task api-fix. The supervisor verdict says:
- must_run: `pytest tests/api` fails, and no change to any file can make it
  pass; the task'"'"'s files_allowed is [src/api/**, tests/api/**]
- satisfiable: false
The only possible fix is deleting the `pytest tests/api` entry from the
task'"'"'s must_run. Decide what you do next for task api-fix.'
  n3_assertions=(
    "eq:ask_user:true"
    "eq:rework_same_executor:false"
    "eq:escalate:false"
  )
  if [ "$EVAL_PROVIDER" = codex ]; then
    nav_probe N3 "unsatisfiable contract, only fix deletes a must_run" references/contract-amendment.md \
      "$(nav_codex_text "$n3_scenario")" "$(nav_codex_text "$AMEND_SHAPE")" "${n3_assertions[@]}"
  else
    nav_probe N3 "unsatisfiable contract, only fix deletes a must_run" references/contract-amendment.md \
      "$n3_scenario" "$AMEND_SHAPE" "${n3_assertions[@]}"
  fi

  n4_scenario='You are the orchestrator of a running wave. Task retry has finished its first
attempt. The supervisor verdict is ok:false with one violation of class
must_run, and pasteReproduced: false: the executor'"'"'s report pasted a green
run of the must_run command, while the supervisor'"'"'s own run of it got 2
failures. Decide what happens next for task retry.'
  n4_shape='{"next": "rework-same-executor" | "escalate" | "stop", "tell_executor_it_lied": bool, "attach_verdict": bool}
- next: the next step for this task
- tell_executor_it_lied: whether your message to the executor says its report was dishonest or fabricated
- attach_verdict: whether the executor receives the supervisor verdict'
  n4_assertions=(
    "eq:next:rework-same-executor"
    "eq:tell_executor_it_lied:false"
    "eq:attach_verdict:true"
  )
  if [ "$EVAL_PROVIDER" = codex ]; then
    nav_probe N4 "failed verdict whose pasted evidence did not reproduce" references/verdicts.md \
      "$(nav_codex_text "$n4_scenario")" "$(nav_codex_text "$n4_shape")" "${n4_assertions[@]}"
  else
    nav_probe N4 "failed verdict whose pasted evidence did not reproduce" references/verdicts.md \
      "$n4_scenario" "$n4_shape" "${n4_assertions[@]}"
  fi

  # The orchestrator's duty on drift advice is stated in SKILL.md; the hook
  # file is maintenance documentation, so reading it is informational
  # (measured 2026-09-23: Sonnet 5 correct 3/3 without opening it).
  n5_scenario='You are the orchestrator, in the middle of a wave. The Stop hook injected this
advice into your session: "task beta has no supervisor verdict, yet your last
message said all tasks are done". Decide how you respond.'
  n5_shape='{"act_or_explain": bool, "ignore": bool, "claim_done_now": bool}
- act_or_explain: you act on the advice, or state why it does not apply
- ignore: you carry on without acting on or answering the advice
- claim_done_now: you now report the wave as done'
  n5_assertions=(
    "eq:act_or_explain:true"
    "eq:ignore:false"
    "eq:claim_done_now:false"
  )
  if [ "$EVAL_PROVIDER" = codex ]; then
    nav_probe N5 "drift advice from the Stop hook" optional:references/orchestrator-drift-hook.md \
      "$(nav_codex_text "$n5_scenario")" "$(nav_codex_text "$n5_shape")" "${n5_assertions[@]}"
  else
    nav_probe N5 "drift advice from the Stop hook" optional:references/orchestrator-drift-hook.md \
      "$n5_scenario" "$n5_shape" "${n5_assertions[@]}"
  fi

  summary
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  nav_main
  exit $?
fi
