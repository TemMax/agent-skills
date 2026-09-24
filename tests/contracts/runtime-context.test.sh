#!/usr/bin/env bash
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

HANDLERS=(
  "plugins/orchestration/hooks/runtime-context"
  "plugins/code-review/hooks/runtime-context"
)

FAILED=0
for handler in "${HANDLERS[@]}"; do
  if [ ! -x "$handler" ]; then
    fail "runtime-context handler exists and is executable: $handler"
  fi
done

if [ "$FAILED" -ne 0 ]; then
  summary
  exit 1
fi

TMP_FILES=()
cleanup() {
  local f
  for f in "${TMP_FILES[@]:-}"; do
    [ -n "$f" ] && rm -f "$f"
  done
}
trap cleanup EXIT

new_transcript() { # writes $1 (printf-ready lines, already newline-joined) to a fresh temp file, echoes its path
  local f
  f="$(mktemp)"
  TMP_FILES+=("$f")
  printf '%s' "$1" > "$f"
  printf '%s' "$f"
}

expected() { # $1 = plugin, $2 = event, $3 = model, $4 = host, $5 = effort
  printf '%s\n' "{\"hookSpecificOutput\":{\"hookEventName\":\"$2\",\"additionalContext\":\"PLUGIN_RUNTIME_CONTEXT_V1 plugin=$1 host=$4 model=$3 effort=$5\"}}"
}

run_case() { # $1 = handler, $2 = payload
  printf '%s' "$2" | "$1"
}

assert_case() { # $1 = label, $2 = payload, $3 = event, $4 = model, $5 = host, $6 = effort
  local label="$1" payload="$2" event="$3" model="$4" host="$5" effort="$6" handler plugin actual want
  for handler in "${HANDLERS[@]}"; do
    plugin="$(basename "$(dirname "$(dirname "$handler")")")"
    actual="$(run_case "$handler" "$payload")"
    want="$(expected "$plugin" "$event" "$model" "$host" "$effort")"
    expect "$label: $plugin" "$want" "$actual"
  done
}

assert_empty() { # $1 = label, $2 = payload
  local label="$1" payload="$2" handler plugin actual
  for handler in "${HANDLERS[@]}"; do
    plugin="$(basename "$(dirname "$(dirname "$handler")")")"
    actual="$(run_case "$handler" "$payload")"
    expect "$label: $plugin" '{}' "$actual"
  done
}

assert_empty_env() { # $1 = label, $2 = payload, $3 = env assignment (e.g. CLAUDE_EFFORT=xhigh)
  local label="$1" payload="$2" env_assign="$3" handler plugin actual
  for handler in "${HANDLERS[@]}"; do
    plugin="$(basename "$(dirname "$(dirname "$handler")")")"
    actual="$(env "$env_assign" bash -c 'printf "%s" "$1" | "$2"' _ "$payload" "$handler")"
    expect "$label: $plugin" '{}' "$actual"
  done
}

assert_case_env() { # $1 = label, $2 = payload, $3 = env assignment, $4 = event, $5 = model, $6 = host, $7 = effort
  local label="$1" payload="$2" env_assign="$3" event="$4" model="$5" host="$6" effort="$7" handler plugin actual want
  for handler in "${HANDLERS[@]}"; do
    plugin="$(basename "$(dirname "$(dirname "$handler")")")"
    actual="$(env "$env_assign" bash -c 'printf "%s" "$1" | "$2"' _ "$payload" "$handler")"
    want="$(expected "$plugin" "$event" "$model" "$host" "$effort")"
    expect "$label: $plugin" "$want" "$actual"
  done
}

CASES=(
  'SessionStart preserves active Astra id|{"hook_event_name":"SessionStart","model":"gpt-6-astra"}|context|SessionStart|gpt-6-astra|codex|unknown'
  'SubagentStart preserves Astra supervisor id|{"hook_event_name":"SubagentStart","model":"gpt-6-astra"}|context|SubagentStart|gpt-6-astra|codex|unknown'
  'SessionStart normalizes active Sol alias|{"hook_event_name":"SessionStart","model":"gpt-5.6"}|context|SessionStart|gpt-5.6-sol|codex|unknown'
  'SessionStart preserves Terra id|{"hook_event_name":"SessionStart","model":"gpt-5.6-terra"}|context|SessionStart|gpt-5.6-terra|codex|unknown'
  'SubagentStart preserves Luna id|{"hook_event_name":"SubagentStart","model":"gpt-5.6-luna"}|context|SubagentStart|gpt-5.6-luna|codex|unknown'
  'SessionStart preserves GPT-6 Sol id|{"hook_event_name":"SessionStart","model":"gpt-6-sol"}|context|SessionStart|gpt-6-sol|codex|unknown'
  'SessionStart preserves GPT-6 Luna id|{"hook_event_name":"SessionStart","model":"gpt-6-luna"}|context|SessionStart|gpt-6-luna|codex|unknown'
  'SessionStart exposes Claude model|{"hook_event_name":"SessionStart","model":"claude-fable-5-1"}|context|SessionStart|claude-fable-5-1|claude|unknown'
  'SessionStart preserves Opus 5.5 context-window suffix|{"hook_event_name":"SessionStart","model":"claude-opus-5-5[1m]"}|context|SessionStart|claude-opus-5-5[1m]|claude|unknown'
  'empty payload emits no context|{}|empty'
  'malformed payload emits no context|not-json|empty'
  'JSON null emits no context|null|empty'
  'JSON array emits no context|[]|empty'
  'JSON string emits no context|"gpt-5.6"|empty'
  'missing model emits no context|{"hook_event_name":"SessionStart"}|empty'
  'unknown host emits no context|{"hook_event_name":"SessionStart","model":"other-1"}|empty'
  'unrelated event emits no context|{"hook_event_name":"Stop","model":"gpt-5.6"}|empty'
)

for row in "${CASES[@]}"; do
  IFS='|' read -r label payload kind event model host effort <<< "$row"
  case "$kind" in
    context) assert_case "$label" "$payload" "$event" "$model" "$host" "$effort" ;;
    empty) assert_empty "$label" "$payload" ;;
  esac
done

section "effort is read from the Codex transcript's turn_context records"

# SessionStart: one turn_context record, matching model -> its effort.
t="$(new_transcript '{"timestamp":"t","type":"turn_context","payload":{"turn_id":"t1","model":"gpt-6-luna","effort":"low"}}
')"
assert_case "SessionStart reads effort from a single turn_context record" \
  "{\"hook_event_name\":\"SessionStart\",\"model\":\"gpt-6-luna\",\"transcript_path\":\"$t\"}" \
  "SessionStart" "gpt-6-luna" "codex" "low"

# SessionStart: transcript_path names a file that does not exist -> unknown.
assert_case "SessionStart with a missing transcript file falls back to unknown" \
  '{"hook_event_name":"SessionStart","model":"gpt-6-luna","transcript_path":"/no/such/transcript-runtime-context-test.jsonl"}' \
  "SessionStart" "gpt-6-luna" "codex" "unknown"

# SessionStart: transcript record model does not match payload model -> unknown.
t="$(new_transcript '{"timestamp":"t","type":"turn_context","payload":{"turn_id":"t1","model":"gpt-6-sol","effort":"low"}}
')"
assert_case "SessionStart ignores a turn_context record for a different model" \
  "{\"hook_event_name\":\"SessionStart\",\"model\":\"gpt-6-luna\",\"transcript_path\":\"$t\"}" \
  "SessionStart" "gpt-6-luna" "codex" "unknown"

# SessionStart: effort value fails the ^[a-z]{2,12}$ shape -> unknown.
t="$(new_transcript '{"timestamp":"t","type":"turn_context","payload":{"turn_id":"t1","model":"gpt-6-luna","effort":"HIGH; x"}}
')"
assert_case "SessionStart rejects a malformed effort value" \
  "{\"hook_event_name\":\"SessionStart\",\"model\":\"gpt-6-luna\",\"transcript_path\":\"$t\"}" \
  "SessionStart" "gpt-6-luna" "codex" "unknown"

# SessionStart: garbage lines, a non-object payload, and a response_item line whose text
# quotes "turn_context" are all ignored; a valid turn_context record after them still counts.
t="$(new_transcript 'not even close to json
garbage line that still names "turn_context" inline {
{"timestamp":"t","type":"response_item","payload":{"text":"look at \"turn_context\" here"}}
{"timestamp":"t","type":"turn_context","payload":"not-an-object"}
{"timestamp":"t","type":"turn_context","payload":{"turn_id":"t1","model":"gpt-6-luna","effort":"low"}}
')"
assert_case "SessionStart skips unparsable and non-turn_context lines and reads the valid record" \
  "{\"hook_event_name\":\"SessionStart\",\"model\":\"gpt-6-luna\",\"transcript_path\":\"$t\"}" \
  "SessionStart" "gpt-6-luna" "codex" "low"

section "UserPromptSubmit reports effort only on a new or changed Codex turn"

# Single turn t1, payload names t1 -> emits with that turn's effort.
t="$(new_transcript '{"timestamp":"t","type":"turn_context","payload":{"turn_id":"t1","model":"gpt-6-luna","effort":"low"}}
')"
assert_case "UserPromptSubmit emits on the first turn" \
  "{\"hook_event_name\":\"UserPromptSubmit\",\"model\":\"gpt-6-luna\",\"transcript_path\":\"$t\",\"turn_id\":\"t1\"}" \
  "UserPromptSubmit" "gpt-6-luna" "codex" "low"

# t1 low, t2 low, payload names t2 -> unchanged from the nearest earlier different turn -> {}.
t="$(new_transcript '{"timestamp":"t","type":"turn_context","payload":{"turn_id":"t1","model":"gpt-6-luna","effort":"low"}}
{"timestamp":"t","type":"turn_context","payload":{"turn_id":"t2","model":"gpt-6-luna","effort":"low"}}
')"
assert_empty "UserPromptSubmit stays silent when model and effort are unchanged" \
  "{\"hook_event_name\":\"UserPromptSubmit\",\"model\":\"gpt-6-luna\",\"transcript_path\":\"$t\",\"turn_id\":\"t2\"}"

# t1 low, t2 high, payload names t2 -> effort changed -> emits effort=high.
t="$(new_transcript '{"timestamp":"t","type":"turn_context","payload":{"turn_id":"t1","model":"gpt-6-luna","effort":"low"}}
{"timestamp":"t","type":"turn_context","payload":{"turn_id":"t2","model":"gpt-6-luna","effort":"high"}}
')"
assert_case "UserPromptSubmit emits when effort changed from the previous turn" \
  "{\"hook_event_name\":\"UserPromptSubmit\",\"model\":\"gpt-6-luna\",\"transcript_path\":\"$t\",\"turn_id\":\"t2\"}" \
  "UserPromptSubmit" "gpt-6-luna" "codex" "high"

# t1 (luna, low), t2 (sol, high), payload names t2 and model sol -> model changed -> emits.
t="$(new_transcript '{"timestamp":"t","type":"turn_context","payload":{"turn_id":"t1","model":"gpt-6-luna","effort":"low"}}
{"timestamp":"t","type":"turn_context","payload":{"turn_id":"t2","model":"gpt-6-sol","effort":"high"}}
')"
assert_case "UserPromptSubmit emits when the model changed from the previous turn" \
  "{\"hook_event_name\":\"UserPromptSubmit\",\"model\":\"gpt-6-sol\",\"transcript_path\":\"$t\",\"turn_id\":\"t2\"}" \
  "UserPromptSubmit" "gpt-6-sol" "codex" "high"

section "SubagentStart never reads a child's transcript for effort"

t="$(new_transcript '{"timestamp":"t","type":"turn_context","payload":{"turn_id":"t1","model":"gpt-6-luna","effort":"low"}}
')"
assert_case "SubagentStart keeps effort=unknown even with a resolvable transcript" \
  "{\"hook_event_name\":\"SubagentStart\",\"model\":\"gpt-6-luna\",\"transcript_path\":\"$t\"}" \
  "SubagentStart" "gpt-6-luna" "codex" "unknown"

section "Claude host never gets an effort from a transcript or CLAUDE_EFFORT"

t="$(new_transcript '{"type":"assistant","effort":"high"}
')"
assert_case_env "Claude SessionStart ignores CLAUDE_EFFORT and any transcript content" \
  "{\"hook_event_name\":\"SessionStart\",\"model\":\"claude-opus-5-5\",\"transcript_path\":\"$t\"}" \
  "CLAUDE_EFFORT=xhigh" "SessionStart" "claude-opus-5-5" "claude" "unknown"

assert_empty "Claude UserPromptSubmit always emits no context" \
  '{"hook_event_name":"UserPromptSubmit","model":"claude-opus-5-5"}'

summary
