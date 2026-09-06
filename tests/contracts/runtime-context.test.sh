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

expected() { # $1 = plugin, $2 = event, $3 = model, $4 = host
  printf '%s\n' "{\"hookSpecificOutput\":{\"hookEventName\":\"$2\",\"additionalContext\":\"PLUGIN_RUNTIME_CONTEXT_V1 plugin=$1 host=$4 model=$3 effort=unknown\"}}"
}

run_case() { # $1 = handler, $2 = payload
  printf '%s' "$2" | "$1"
}

assert_case() { # $1 = label, $2 = payload, $3 = event, $4 = model, $5 = host
  local label="$1" payload="$2" event="$3" model="$4" host="$5" handler plugin actual want
  for handler in "${HANDLERS[@]}"; do
    plugin="$(basename "$(dirname "$(dirname "$handler")")")"
    actual="$(run_case "$handler" "$payload")"
    want="$(expected "$plugin" "$event" "$model" "$host")"
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

CASES=(
  'SessionStart normalizes active Sol alias|{"hook_event_name":"SessionStart","model":"gpt-5.6"}|context|SessionStart|gpt-5.6-sol|codex'
  'SessionStart preserves Terra id|{"hook_event_name":"SessionStart","model":"gpt-5.6-terra"}|context|SessionStart|gpt-5.6-terra|codex'
  'SubagentStart preserves Luna id|{"hook_event_name":"SubagentStart","model":"gpt-5.6-luna"}|context|SubagentStart|gpt-5.6-luna|codex'
  'SessionStart exposes Claude model|{"hook_event_name":"SessionStart","model":"claude-fable-5-1"}|context|SessionStart|claude-fable-5-1|claude'
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
  IFS='|' read -r label payload kind event model host <<< "$row"
  case "$kind" in
    context) assert_case "$label" "$payload" "$event" "$model" "$host" ;;
    empty) assert_empty "$label" "$payload" ;;
  esac
done

summary
