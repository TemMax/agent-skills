#!/usr/bin/env bash
# Shared headless model adapter for disposable semantic-evaluation fixtures.

eval_model() {
  local cwd="$1" sandbox="$2" prompt_file="$3" answer_file="$4"
  local provider="${EVAL_PROVIDER:-claude}"
  local model="${EVAL_MODEL:-claude-haiku-4-5-20251001}"
  local effort="${EVAL_EFFORT:-medium}"
  local limit="${EVAL_TIMEOUT:-600}"

  case "$sandbox" in
    read-only|workspace-write) ;;
    *) return 2 ;;
  esac
  case "$provider" in
    claude|codex) ;;
    *) return 2 ;;
  esac

  : > "$answer_file"

  case "$provider" in
    claude)
      case "$sandbox" in
        read-only)
          (cd "$cwd" && timeout "$limit" claude -p --model "$model" --effort "$effort" \
            --permission-mode plan --permission-prompts none --no-session-persistence \
            < "$prompt_file" > "$answer_file")
          ;;
        workspace-write)
          (cd "$cwd" && timeout "$limit" claude -p --model "$model" --effort "$effort" \
            --permission-mode acceptEdits --permission-prompts none --no-session-persistence \
            --allowedTools 'Read,Glob,Grep,Edit,Write,Bash' \
            < "$prompt_file" > "$answer_file")
          ;;
      esac
      ;;
    codex)
      local launch_cwd="$cwd"
      if [ "$sandbox" = workspace-write ]; then
        launch_cwd="$(dirname "$cwd")"
      fi
      (cd "$launch_cwd" && timeout "$limit" codex exec --ephemeral --ignore-user-config --ignore-rules \
        --skip-git-repo-check --sandbox "$sandbox" --model "$model" \
        -c "model_reasoning_effort=\"$effort\"" \
        --output-last-message "$answer_file" - < "$prompt_file" >/dev/null)
      ;;
  esac
}

# Print an answer only when its model invocation completed successfully.
eval_model_answer() {
  local answer_file="$4"
  eval_model "$@" || return $?
  cat "$answer_file"
}
