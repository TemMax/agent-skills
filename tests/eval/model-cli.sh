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
        # Not plan mode: plan mode injects the host's own plan-mode system
        # prompt, and models discard the harness's EVAL MODE instruction as an
        # injection (measured 2026-09-22: Haiku 4.5 F3 0/5 in plan mode, 5/5
        # with this allowlist). "read-only" here means no file-editing tools;
        # Bash stays because the supervisor fixture must run commands.
        read-only)
          (cd "$cwd" && timeout "$limit" claude -p --model "$model" --effort "$effort" \
            --permission-mode dontAsk --permission-prompts none --no-session-persistence \
            --allowedTools 'Read,Glob,Grep,Bash' --disallowedTools 'Edit,Write,NotebookEdit' \
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
      if [ "$sandbox" = workspace-write ] && [ "${EVAL_CODEX_CWD_IS_REPO:-0}" = 1 ]; then
        (cd "$cwd" && timeout "$limit" codex exec --ephemeral --ignore-user-config --ignore-rules \
          --skip-git-repo-check --sandbox "$sandbox" --model "$model" \
          -c "model_reasoning_effort=\"$effort\"" \
          -C "$cwd" --add-dir "$(dirname "$cwd")" \
          --output-last-message "$answer_file" - < "$prompt_file" >/dev/null)
      else
        (cd "$launch_cwd" && timeout "$limit" codex exec --ephemeral --ignore-user-config --ignore-rules \
          --skip-git-repo-check --sandbox "$sandbox" --model "$model" \
          -c "model_reasoning_effort=\"$effort\"" \
          --output-last-message "$answer_file" - < "$prompt_file" >/dev/null)
      fi
      ;;
  esac
}

# Print an answer only when its model invocation completed successfully.
eval_model_answer() {
  local answer_file="$4"
  eval_model "$@" || return $?
  cat "$answer_file"
}
