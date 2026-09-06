#!/usr/bin/env bash
# Live semantic probe for exact runtime-profile routing. Every call retains its
# prompt, final answer, classification, process status, and elapsed time.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/test-env.sh
. tests/eval/model-cli.sh

classify_profile() { # answer expected
  local answer
  answer="$(printf '%s' "$1" | tr -d '\r\n')"
  if [ "$answer" = "$2" ]; then
    printf 'pass'
  elif [ "$2" = 'profile=generic effort=unknown' ] \
    && printf '%s' "$answer" | grep -q 'profile=gpt-5.6-sol'; then
    printf 'fail:inferred-sol-without-context'
  else
    printf 'fail:unexpected-profile-output'
  fi
}

profile_path() { # family exact-id-or-generic
  local token="${2//./-}"
  case "$1" in
    orchestration:orchestrator)
      printf 'plugins/orchestration/skills/multi-model/references/orchestrator-%s.md' "$token"
      ;;
    code-review:reviewer)
      printf 'plugins/code-review/skills/critical-review/references/reviewer-%s.md' "$token"
      ;;
    *) return 64 ;;
  esac
}

runtime_context() { # plugin exact-model
  printf 'PLUGIN_RUNTIME_CONTEXT_V1 plugin=%s host=codex model=%s effort=unknown' "$1" "$2"
}

if [ "${1:-}" = --self-test ]; then
  set -e
  [ "$(runtime_context orchestration gpt-5.6-terra)" = 'PLUGIN_RUNTIME_CONTEXT_V1 plugin=orchestration host=codex model=gpt-5.6-terra effort=unknown' ]
  [ "$(classify_profile 'profile=gpt-5.6-terra effort=unknown' 'profile=gpt-5.6-terra effort=unknown')" = pass ]
  [ "$(classify_profile 'profile=gpt-5.6-sol effort=known' 'profile=generic effort=unknown')" = 'fail:inferred-sol-without-context' ]
  [ "$(classify_profile 'profile=generic effort=unknown' 'profile=generic effort=unknown')" = pass ]
  [ "$(profile_path orchestration:orchestrator gpt-5.6-terra)" = 'plugins/orchestration/skills/multi-model/references/orchestrator-gpt-5-6-terra.md' ]
  printf 'profile-routing self-test: PASS\n'
  exit
fi

if [ "${EVAL_PROVIDER:-claude}" != codex ]; then
  printf 'profile-routing: SKIPPED (GPT-5.6/Codex probe)\n'
  exit
fi

: "${EVAL_RESULTS_DIR:?set EVAL_RESULTS_DIR to a new caller-owned results directory}"
MODEL="${EVAL_MODEL:-gpt-5.6-sol}"
EFFORT="${EVAL_EFFORT:-medium}"
PROVIDER="${EVAL_PROVIDER:-codex}"
ROWS="$EVAL_RESULTS_DIR/cells.tsv"
mkdir -p "$EVAL_RESULTS_DIR"
if [ ! -e "$ROWS" ]; then
  printf 'script\tscenario\tsemantic_path\tprovider\tmodel\teffort\tblocking\tstatus\tclassification\texit\telapsed_ms\tprompt\tfinal_answer\tclassification_evidence\tstatus_evidence\tinput_tokens\toutput_tokens\tcost\n' > "$ROWS"
fi

now_ms() { python3 -c 'import time; print(time.monotonic_ns() // 1000000)' ; }

record_cell() { # skill-name skill-file plugin profile-family mode
  local skill_name="$1" skill_file="$2" plugin="$3" family="$4" mode="$5"
  local slug cell prompt answer class_file status_file profile_file expected context start end elapsed rc classification status
  slug="${MODEL}-profile-routing-${skill_name}-${mode}"
  cell="$EVAL_RESULTS_DIR/raw/$slug"
  if [ -e "$cell" ]; then
    printf 'profile-routing: refusing to overwrite recorded cell %s\n' "$cell" >&2
    return 73
  fi
  mkdir -p "$cell"
  prompt="$cell/prompt.md"
  answer="$cell/final-answer.txt"
  class_file="$cell/classification.txt"
  status_file="$cell/status.txt"

  if [ "$mode" = context ]; then
    context="$(runtime_context "$plugin" "$MODEL")"
    expected="profile=$MODEL effort=unknown"
    profile_file="$(profile_path "$family" "$MODEL")"
  else
    context='PLUGIN_RUNTIME_CONTEXT_V1 is absent. No exact model id or effort is explicitly supplied by the session; do not infer either from the host, an alias, capabilities, prose, or defaults.'
    expected='profile=generic effort=unknown'
    profile_file="$(profile_path "$family" generic)"
  fi

  printf '%s\n\nCANDIDATE PROFILE CONTENT:\n%s\n\n%s\n\n%s\n' \
    "$(cat "$skill_file")" "$(cat "$profile_file")" "$context" \
    "EVAL MODE: Apply Step 0 only. Read the referenced matching profile. Print exactly one line and nothing else: profile=<exact-id-or-generic> effort=<known-or-unknown>. The production hook's literal effort=unknown remains unknown; absent context also means generic/unknown." > "$prompt"

  start="$(now_ms)"
  set +e
  eval_model "$R" read-only "$prompt" "$answer"
  rc=$?
  set -e
  end="$(now_ms)"
  elapsed=$((end - start))
  if [ "$rc" -eq 0 ]; then
    classification="$(classify_profile "$(cat "$answer")" "$expected")"
  else
    classification="fail:model-exit-$rc"
  fi
  case "$classification" in pass) status=pass ;; *) status=fail ;; esac
  printf '%s\n' "$classification" > "$class_file"
  printf 'status=%s\nexit=%s\nelapsed_ms=%s\ninput_tokens=unavailable\noutput_tokens=unavailable\ncost=unavailable\n' \
    "$status" "$rc" "$elapsed" > "$status_file"
  printf 'profile-routing\t%s/%s\t%s\t%s\t%s\t%s\tyes\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\tunavailable\tunavailable\tunavailable\n' \
    "$skill_name" "$mode" "$mode" "$PROVIDER" "$MODEL" "$EFFORT" "$status" "$classification" "$rc" "$elapsed" \
    "$prompt" "$answer" "$class_file" "$status_file" >> "$ROWS"
  [ "$status" = pass ]
}

rc=0
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
R="$W/repo"; mkdir -p "$R"
printf 'Disposable profile-routing fixture.\n' > "$R/README.md"
git -C "$R" init -q; git -C "$R" add -A; git -C "$R" commit -q -m base
record_cell super-plan plugins/orchestration/skills/super-plan/SKILL.md orchestration orchestration:orchestrator context || rc=1
record_cell super-plan plugins/orchestration/skills/super-plan/SKILL.md orchestration orchestration:orchestrator generic-fallback || rc=1
record_cell wave plugins/orchestration/skills/multi-model/SKILL.md orchestration orchestration:orchestrator context || rc=1
record_cell wave plugins/orchestration/skills/multi-model/SKILL.md orchestration orchestration:orchestrator generic-fallback || rc=1
record_cell critical-review plugins/code-review/skills/critical-review/SKILL.md code-review code-review:reviewer context || rc=1
record_cell critical-review plugins/code-review/skills/critical-review/SKILL.md code-review code-review:reviewer generic-fallback || rc=1
record_cell ship plugins/orchestration/skills/ship/SKILL.md orchestration orchestration:orchestrator context || rc=1
record_cell ship plugins/orchestration/skills/ship/SKILL.md orchestration orchestration:orchestrator generic-fallback || rc=1
exit "$rc"
