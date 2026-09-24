#!/usr/bin/env bash
# effort-detection — measures, live, that the production runtime-context
# hook and each host actually surface the running session's effort:
#
#   1. Codex: a gpt-6-luna session started with
#      model_reasoning_effort="low" gets a SessionStart hook whose
#      additionalContext reports
#      PLUGIN_RUNTIME_CONTEXT_V1 plugin=orchestration host=codex
#      model=gpt-6-luna effort=low.
#   2. Claude Code: a session started with --effort low sees that effort
#      from its shell tool (printenv CLAUDE_EFFORT).
#
# Cost: two small model calls — one gpt-6-luna call and one claude-sonnet-5
# call. Must run outside any sandbox: Codex's own seatbelt sandbox cannot
# nest another sandboxed `codex exec`, so this script cannot run inside one.
# Do not run it from a sandboxed agent session; the coordinator runs it
# after merge.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

REPO_ROOT="$PWD"

section "Codex SessionStart hook — live effort"

if ! command -v codex >/dev/null 2>&1; then
  printf '  SKIP  codex not on PATH\n'
else
  W="$(mktemp -d)"
  trap 'rm -rf "$W"' EXIT

  git -C "$W" init -q
  git -C "$W" -c user.email=eval@example.com -c user.name=eval commit -q --allow-empty -m base

  # Wrapper Codex's SessionStart hook runs: it forwards its stdin to this
  # repository's own runtime-context hook and appends (and prints) that
  # hook's raw stdout, so the assistant transcript and hook-out.jsonl both
  # carry the hook's additionalContext line.
  cat > "$W/hook-wrapper.sh" <<EOF
#!/usr/bin/env bash
set -u
out="\$("$REPO_ROOT/plugins/orchestration/hooks/runtime-context")"
printf '%s\n' "\$out" >> "$W/hook-out.jsonl"
printf '%s\n' "\$out"
EOF
  chmod +x "$W/hook-wrapper.sh"

  : > "$W/hook-out.jsonl"

  # --dangerously-bypass-hook-trust trusts, for this one invocation only,
  # this repository's own hook-wrapper.sh (nothing else) so the SessionStart
  # hook runs without an interactive trust prompt.
  codex exec --skip-git-repo-check --dangerously-bypass-hook-trust -C "$W" \
    --model gpt-6-luna -c 'model_reasoning_effort="low"' \
    -c "hooks.SessionStart=[{hooks=[{type=\"command\",command=\"$W/hook-wrapper.sh\"}]}]" \
    "Reply with the single word ok." < /dev/null >/dev/null 2>&1

  if grep -qF 'PLUGIN_RUNTIME_CONTEXT_V1 plugin=orchestration host=codex model=gpt-6-luna effort=low' "$W/hook-out.jsonl" 2>/dev/null; then
    codex_result=found
  else
    codex_result=missing
  fi
  expect "Codex SessionStart hook reports the session's effort" "found" "$codex_result"

  rm -rf "$W"
  trap - EXIT
fi

section "Claude Code shell tool — live effort"

if ! command -v claude >/dev/null 2>&1; then
  printf '  SKIP  claude not on PATH\n'
else
  claude_answer="$(env -u CLAUDE_EFFORT claude -p "Run exactly: printenv CLAUDE_EFFORT ; and reply with its raw output only, or EMPTY." \
    --model claude-sonnet-5 --effort low --allowedTools "Bash(printenv:*)" < /dev/null 2>/dev/null)"
  if printf '%s' "$claude_answer" | grep -qF 'low'; then
    claude_result=found
  else
    claude_result=missing
  fi
  expect "Claude Code shell tool sees the session's effort" "found" "$claude_result"
fi

summary
