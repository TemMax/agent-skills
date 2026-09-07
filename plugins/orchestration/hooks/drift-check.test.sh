#!/usr/bin/env bash
# Gate tests for drift-check. Every case runs in dry-run, so the suite is
# offline, deterministic and costs nothing. The live end-to-end path is checked
# separately — see the last case, which is skipped unless LIVE=1.
set -uo pipefail
cd "$(dirname "$0")/../../.." || exit 1
. tests/test-env.sh

HOOK="$(cd "$(dirname "$0")" && pwd)/drift-check"
PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STOP_FIXTURE="$(pwd)/tests/fixtures/hooks/claude-stop.json"
fail=0

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# A throwaway repo so the tests never depend on the state of the real one.
setup_repo() {
  rm -rf "$WORK/repo"
  mkdir -p "$WORK/repo/docs/superpowers/plans"
  git -C "$WORK/repo" init -q .
  git -C "$WORK/repo" -c user.email=t@t -c user.name=t commit -q --allow-empty -m base
}

write_plan() {   # $1 = status, $2 = branch line ("" for none)
  cat > "$WORK/repo/docs/superpowers/plans/2026-01-01-wave-test.md" <<EOF
base: deadbee
status: $1

$2
EOF
}

write_transcript() {  # $1 = content
  printf '%s\n' "$1" > "$WORK/transcript.jsonl"
}

# Synthetic model-bearing payload for explicit provider routing. Claude's
# documented model-free Stop payload is exercised separately below.
# $1 overrides the message and $2 the host model.
run_hook() {
  local msg="${1-Summary: 2 tasks done, verified, nothing remaining.}"
  local model="${2-claude-fable-5-1}"
  ( cd "$WORK/repo" && python3 -c "
import json,sys
print(json.dumps({
    'hook_event_name': 'Stop',
    'model': sys.argv[3],
    'stop_hook_active': False,
    'last_assistant_message': sys.argv[2],
    'session_id': 'dryrun-session',
    'transcript_path': sys.argv[1],
}))
" "$WORK/transcript.jsonl" "$msg" "$model" \
    | CLAUDE_DRIFT_CHECK_DRYRUN=1 CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" "$HOOK" )
}

expect() {  # $1 = label, $2 = expected, $3 = actual
  if [ "$2" = "$3" ]; then
    echo "PASS  $1"
  else
    echo "FAIL  $1 — expected '$2', got '$3'"
    fail=1
  fi
}

CLAIM='{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Summary: 2 tasks done, verified, nothing remaining."}]}}'
NOCLAIM='{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Let me look at the file now."}]}}'
TOOLNOISE='{"type":"user","message":{"role":"user","content":"12 passed in 0.4s, all tests complete and verified"}}'

# 1. no plan at all
setup_repo; write_transcript "$CLAIM"
expect "no plan in the repo" "silent: no-active-plan" "$(run_hook)"

# 2. plan present but the wave is finished
setup_repo; write_plan done "branch: wave/alpha"; write_transcript "$CLAIM"
git -C "$WORK/repo" branch wave/alpha 2>/dev/null
expect "status: done wins over live branches" "silent: no-active-plan" "$(run_hook)"

# 3. active, but every branch it names is gone — the self-clearing net
setup_repo; write_plan active "branch: wave/alpha"; write_transcript "$CLAIM"
expect "active status, no live branches" "silent: no-live-branches" "$(run_hook)"

# 4. active with a live branch and a claim in the transcript
setup_repo; write_plan active "branch: wave/alpha"; write_transcript "$CLAIM"
git -C "$WORK/repo" branch wave/alpha
expect "active wave with a live branch" "would-call" "$(run_hook)"

# Claude Stop has no model field. CLAUDE_PROJECT_DIR is supplied by the hook
# environment; CLAUDE_PLUGIN_ROOT alone also locates this shared Codex plugin.
# https://code.claude.com/docs/en/hooks#common-input-fields
mkdir -p "$WORK/stop-tmp"
run_stop_fixture() {
  ( cd "$WORK/repo" && TMPDIR="$WORK/stop-tmp" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" \
    "$HOOK" < "$STOP_FIXTURE" )
}
expect "documented Claude Stop without model reaches its judge" "would-call" \
  "$(CLAUDE_PROJECT_DIR="$WORK/repo" DRIFT_CHECK_DRYRUN=1 run_stop_fixture)"
expect "documented Claude Stop delivers its existing advice shape" \
  '{"hookSpecificOutput":{"hookEventName":"Stop","additionalContext":"- Task gamma has no verifier evidence."}}' \
  "$(CLAUDE_PROJECT_DIR="$WORK/repo" DRIFT_CHECK_FAKE_ANSWER='- Task gamma has no verifier evidence.' run_stop_fixture)"
expect "model-free Stop without a Claude host signal remains unknown" "silent: unknown-model" \
  "$(CLAUDE_PROJECT_DIR= DRIFT_CHECK_DRYRUN=1 run_stop_fixture)"
expect "model-free Codex Stop never guesses an active Codex model" "silent: unknown-model" \
  "$(CLAUDE_PROJECT_DIR= CODEX_PLUGIN_ROOT="$PLUGIN_ROOT" DRIFT_CHECK_DRYRUN=1 run_stop_fixture)"

# 4b. same as 4, but the plan declares its branch in the quoted JSON form
setup_repo; write_plan active '  "branch": "wave/alpha",'; write_transcript "$CLAIM"
git -C "$WORK/repo" branch wave/alpha
expect "quoted JSON branch is recognized" "would-call" "$(run_hook)"

# 4c. the negative that makes 4b meaningful: a JSON-declared branch that does
# NOT exist must silence the gate — if the sed matched nothing, the
# empty-branches opt-in path would return would-call here and 4b alone would
# pass a broken pattern (supervisor observation, wave/drift-json-branch).
setup_repo; write_plan active '  "branch": "wave/alpha",'; write_transcript "$CLAIM"
expect "quoted JSON branch, gone from git, silences" "silent: no-live-branches" "$(run_hook)"

# 5. re-entrancy guard beats every other gate
setup_repo; write_plan active "branch: wave/alpha"; write_transcript "$CLAIM"
git -C "$WORK/repo" branch wave/alpha
expect "nested run short-circuits" "silent: reentrant" \
  "$( cd "$WORK/repo" && printf '{}' | CLAUDE_DRIFT_CHECK_DRYRUN=1 CLAUDE_DRIFT_CHECK_ACTIVE=1 CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" "$HOOK" )"

# 6. active wave, but the turn claimed nothing worth checking
setup_repo; write_plan active "branch: wave/alpha"; write_transcript "$NOCLAIM"
git -C "$WORK/repo" branch wave/alpha
expect "cost pre-filter, nothing claimed" "silent: nothing-claimed" "$(run_hook 'Let me look at the file now.')"

# 7. an explicitly active plan naming no branches still runs — opting in is a
#    deliberate act, and the branch net simply has nothing to check
setup_repo; write_plan active ""; write_transcript "$CLAIM"
expect "explicitly active plan without branches runs" "would-call" "$(run_hook)"

# 7b. THE REGRESSION THAT MATTERS: a plan with no status field at all must not
#     switch the hook on. Open-by-default is what made the plan file a permanent
#     trigger in the first place.
setup_repo; write_transcript "$CLAIM"
cat > "$WORK/repo/docs/superpowers/plans/2026-01-01-wave-test.md" <<'EOF'
base: deadbee
tasks:
  - task: alpha
EOF
expect "plan with no status stays off" "silent: no-active-plan" "$(run_hook)"

# 7c. an unrecognised status is not an invitation either
setup_repo; write_plan paused ""; write_transcript "$CLAIM"
expect "unknown status stays off" "silent: no-active-plan" "$(run_hook)"

# 5b. a turn our own advice caused must not be advised on again
setup_repo; write_plan active "branch: wave/alpha"; write_transcript "$CLAIM"
git -C "$WORK/repo" branch wave/alpha
expect "continuation after advice stays quiet" "silent: already-advised-this-chain" \
  "$( cd "$WORK/repo" && printf '{"hook_event_name":"Stop","model":"claude-fable-5-1","stop_hook_active":true,"last_assistant_message":"Summary: all tasks done, nothing remaining.","session_id":"stop-active"}' \
     | CLAUDE_DRIFT_CHECK_DRYRUN=1 CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" "$HOOK" )"

# 6b. tool output full of the old keywords must NOT trigger a call: this is the
#     measured failure of the previous filter, which passed 99% of real turns.
setup_repo; write_plan active "branch: wave/alpha"; write_transcript "$TOOLNOISE"
git -C "$WORK/repo" branch wave/alpha
expect "tool output alone does not trigger" "silent: nothing-claimed" "$(run_hook '12 passed in 0.4s, all tests complete and verified')"

# 7d. a plan that is not a wave plan activates it just the same
setup_repo; write_transcript "$CLAIM"
cat > "$WORK/repo/docs/superpowers/plans/2026-01-01-implementation.md" <<'EOF'
status: active
tasks:
  - task: alpha
EOF
expect "non-wave plan activates the check" "would-call" "$(run_hook)"

# 7e. a page that DOCUMENTS status: active inside a fence must not activate it
setup_repo; write_transcript "$CLAIM"
printf '# how to write a plan\n\n```yaml\nstatus: active\n```\n' \
  > "$WORK/repo/docs/superpowers/plans/2026-01-01-guide.md"
expect "fenced example does not activate" "silent: no-active-plan" "$(run_hook)"

# 7f. the wave-only branch gate must not silence a plan that merely mentions a
#     wave branch in prose — the trigger is generalised, that gate is not
setup_repo; write_transcript "$CLAIM"
cat > "$WORK/repo/docs/superpowers/plans/2026-01-01-impl.md" <<'EOF'
status: active
tasks:
  - task: rewrite the merge step
    note: earlier work landed on wave/alpha, see that branch
EOF
expect "prose mention of a branch does not silence" "would-call" "$(run_hook)"

# 8. the payload carries no final message (the turn said nothing)
setup_repo; write_plan active "branch: wave/alpha"
git -C "$WORK/repo" branch wave/alpha
expect "empty final message" "silent: nothing-said" "$(run_hook '')"

# 8b. a missing transcript file must NOT stop the check: the payload is the gate,
#     the file is only extra context, and at Stop time it may not be written yet.
setup_repo; write_plan active "branch: wave/alpha"
git -C "$WORK/repo" branch wave/alpha
rm -f "$WORK/transcript.jsonl"
expect "missing transcript still runs" "would-call" "$(run_hook)"

# 9. the prompt file must exist
setup_repo; write_plan active "branch: wave/alpha"; write_transcript "$CLAIM"
git -C "$WORK/repo" branch wave/alpha
expect "missing prompt file" "silent: no-prompt" \
  "$( cd "$WORK/repo" && printf '{"transcript_path":"%s"}' "$WORK/transcript.jsonl" \
     | CLAUDE_DRIFT_CHECK_DRYRUN=1 CLAUDE_PLUGIN_ROOT="$WORK/nonexistent" "$HOOK" )"

# 9b. the output contract, exercised offline through the fake-answer seam
setup_repo; write_plan active "branch: wave/alpha"; write_transcript "$CLAIM"
git -C "$WORK/repo" branch wave/alpha
fake() {
  local model="${3-claude-fable-5-1}"
  ( cd "$WORK/repo" && printf '{"session_id":"%s","last_assistant_message":"Summary: 2 tasks done, nothing remaining."}' "$1" \
    | python3 -c '
import json,sys
d=json.load(sys.stdin)
d.update({"hook_event_name":"Stop","model":sys.argv[1],"stop_hook_active":False})
print(json.dumps(d))
' "$model" \
    | DRIFT_CHECK_FAKE_ANSWER="$2" CLAUDE_DRIFT_CHECK_FAKE_ANSWER="$2" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" "$HOOK" )
}
case "$(fake memo-a '- task gamma was dropped')" in
  '{"hookSpecificOutput"'*) echo "PASS  bullet answer is delivered" ;;
  *) echo "FAIL  bullet answer was not delivered"; fail=1 ;;
esac
expect "identical advice is not repeated" "{}" "$(fake memo-a '- task gamma was dropped')"
case "$(fake memo-a '- task beta has no evidence')" in
  '{"hookSpecificOutput"'*) echo "PASS  different advice still gets through" ;;
  *) echo "FAIL  different advice was suppressed"; fail=1 ;;
esac
expect "NOTHING is suppressed" "{}" "$(fake memo-b 'NOTHING')"
expect "off-contract answer is suppressed" "{}" "$(fake memo-c 'I am ready to check the wave.')"
for marker in '* gamma dropped' '1. gamma dropped' '• gamma dropped'; do
  case "$(fake "memo-$RANDOM" "$marker")" in
    '{"hookSpecificOutput"'*) echo "PASS  bullet form accepted: ${marker%% *}" ;;
    *) echo "FAIL  bullet form rejected: $marker"; fail=1 ;;
  esac
done
# the memo must survive a host with no shasum, where it silently died before
STUB="$WORK/stub"; mkdir -p "$STUB"; printf '#!/bin/sh\nexit 127\n' > "$STUB/shasum"; chmod +x "$STUB/shasum"
nos() { ( cd "$WORK/repo" && printf '{"hook_event_name":"Stop","model":"claude-fable-5-1","stop_hook_active":false,"session_id":"nosha","last_assistant_message":"Summary: all done, nothing remaining."}' \
  | PATH="$STUB:$PATH" CLAUDE_DRIFT_CHECK_FAKE_ANSWER='- gamma dropped' CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" "$HOOK" ); }
rm -f "${TMPDIR:-/tmp}/claude-drift-memo-nosha"
nos >/dev/null
expect "repeat suppression survives a host without shasum" "{}" "$(nos)"
rm -f "${TMPDIR:-/tmp}/claude-drift-memo-nosha"
# 9c. delivered advice is recorded where a human can audit it
LOGF="${TMPDIR:-/tmp}/claude-drift-log/memo-log.jsonl"
rm -f "$LOGF"
fake memo-log '- task gamma was dropped' >/dev/null
if [ -s "$LOGF" ] && python3 -c "
import json,sys
d=json.loads(open('$LOGF').readline())
sys.exit(0 if 'gamma' in d.get('advice','') and d.get('session')=='memo-log' and d.get('plan') else 1)"; then
  echo "PASS  delivered advice is logged with its session and plan"
else
  echo "FAIL  advice log missing or malformed"; fail=1
fi
rm -f "$LOGF"
rm -f "${TMPDIR:-/tmp}"/claude-drift-memo-memo-*

# 9d. exact provider routing in dry-run. Claude retains its historical dry-run
# text; Codex names the exact different-model judge and fixed high effort.
setup_repo; write_plan active "branch: wave/alpha"; write_transcript "$CLAIM"
git -C "$WORK/repo" branch wave/alpha
ROUTING_CLAIM='Summary: 2 tasks done, verified, nothing remaining.'
expect "Claude dry-run output is unchanged" "would-call" "$(run_hook "$ROUTING_CLAIM" claude-fable-5-1)"
expect "Astra routes to an independent Sol-high judge" "would-call: host=codex judge=gpt-5.6-sol effort=high" \
  "$(run_hook 'Summary: all tasks done, nothing remaining.' gpt-6-astra)"
expect "Sol routes to Terra-high" "would-call: host=codex judge=gpt-5.6-terra effort=high" \
  "$(run_hook "$ROUTING_CLAIM" gpt-5.6-sol)"
expect "normalized Sol alias routes to Terra-high" "would-call: host=codex judge=gpt-5.6-terra effort=high" \
  "$(run_hook "$ROUTING_CLAIM" gpt-5.6)"
expect "Terra routes to Sol-high" "would-call: host=codex judge=gpt-5.6-sol effort=high" \
  "$(run_hook "$ROUTING_CLAIM" gpt-5.6-terra)"
expect "Luna routes to Sol-high" "would-call: host=codex judge=gpt-5.6-sol effort=high" \
  "$(run_hook "$ROUTING_CLAIM" gpt-5.6-luna)"
expect "unknown model is visible in dry-run" "silent: unknown-model" \
  "$(run_hook "$ROUTING_CLAIM" gpt-5.6-mini)"
expect "explicit Codex identity wins over a Claude environment signal" \
  "would-call: host=codex judge=gpt-5.6-terra effort=high" \
  "$(CLAUDE_PROJECT_DIR="$WORK/repo" run_hook "$ROUTING_CLAIM" gpt-5.6-sol)"
expect "unknown explicit model never borrows the Claude environment" "silent: unknown-model" \
  "$(CLAUDE_PROJECT_DIR="$WORK/repo" run_hook "$ROUTING_CLAIM" future-model)"

# 9e. provider output adapters and host-independent repeat suppression.
CODEX_ADVICE='{"status":"advice","advice":["Task gamma has no verifier evidence."]}'
rm -f "${TMPDIR:-/tmp}"/claude-drift-memo-provider-* \
  "${TMPDIR:-/tmp}"/claude-drift-memo-generic-*
case "$(fake provider-claude '- task gamma was dropped' claude-fable-5-1)" in
  '{"hookSpecificOutput"'*) echo "PASS  Claude advice keeps additionalContext shape" ;;
  *) echo "FAIL  Claude advice shape changed"; fail=1 ;;
esac
expect "Sol advice requests one exact continuation" \
  '{"decision":"block","reason":"Task gamma has no verifier evidence."}' \
  "$(fake provider-sol "$CODEX_ADVICE" gpt-5.6-sol)"
expect "Terra advice requests the same Codex continuation shape" \
  '{"decision":"block","reason":"Task gamma has no verifier evidence."}' \
  "$(fake provider-terra "$CODEX_ADVICE" gpt-5.6-terra)"
MULTI_CODEX_ADVICE='{"status":"advice","advice":["Task gamma has no verifier evidence.","Task delta has no test output."]}'
expect "multiple Codex advice items remain newline-separated JSON bullets" \
  '{"decision":"block","reason":"Task gamma has no verifier evidence.\nTask delta has no test output."}' \
  "$(fake provider-multi "$MULTI_CODEX_ADVICE" gpt-5.6-sol)"
if python3 -c '
import json,sys
entry=json.loads(open(sys.argv[1]).readlines()[-1])
sys.exit(0 if entry.get("advice") == "Task gamma has no verifier evidence.\nTask delta has no test output." else 1)
' "${TMPDIR:-/tmp}/claude-drift-log/provider-multi.jsonl"; then
  echo "PASS  normalized Codex bullets are preserved in the audit log"
else
  echo "FAIL  normalized Codex bullets were not audited"; fail=1
fi
expect "Codex clean verdict emits no continuation" "{}" \
  "$(fake provider-luna-clean '{"status":"nothing","advice":[]}' gpt-5.6-luna)"
expect "unknown model never borrows a provider output shape" "{}" \
  "$(fake provider-unknown '- task gamma was dropped' future-model)"
expect "first Codex judge can deliver advice" \
  '{"decision":"block","reason":"Task gamma has no verifier evidence."}' \
  "$(fake provider-shared "$CODEX_ADVICE" gpt-5.6-sol)"
expect "content memo is independent of Codex host-model route" "{}" \
  "$(fake provider-shared "$CODEX_ADVICE" gpt-5.6-terra)"

# 9f. both recursion signals win before provider selection or model invocation.
expect "Codex continuation after advice emits no output" "{}" \
  "$( cd "$WORK/repo" && printf '%s' '{"hook_event_name":"Stop","model":"gpt-5.6-sol","stop_hook_active":true,"last_assistant_message":"Summary: all tasks done, nothing remaining.","session_id":"codex-stop-active"}' \
     | DRIFT_CHECK_FAKE_ANSWER="$CODEX_ADVICE" CLAUDE_DRIFT_CHECK_FAKE_ANSWER="$CODEX_ADVICE" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" "$HOOK" )"
expect "generic inherited recursion guard is primary" "silent: reentrant" \
  "$( cd "$WORK/repo" && printf '%s' '{"hook_event_name":"Stop","model":"gpt-5.6-sol","stop_hook_active":false,"last_assistant_message":"Summary: all tasks done, nothing remaining.","session_id":"codex-reentrant"}' \
     | DRIFT_CHECK_ACTIVE=1 CLAUDE_DRIFT_CHECK_DRYRUN=1 CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" "$HOOK" )"

# 9g. generic environment names are primary and legacy names remain fallbacks.
expect "generic dry-run overrides a legacy fake answer" \
  "would-call: host=codex judge=gpt-5.6-terra effort=high" \
  "$( cd "$WORK/repo" && printf '%s' '{"hook_event_name":"Stop","model":"gpt-5.6-sol","stop_hook_active":false,"last_assistant_message":"Summary: all tasks done, nothing remaining.","session_id":"generic-dryrun"}' \
     | DRIFT_CHECK_DRYRUN=1 CLAUDE_DRIFT_CHECK_FAKE_ANSWER='- legacy fallback must not win' CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" "$HOOK" )"
expect "generic fake answer overrides the legacy fallback" \
  '{"decision":"block","reason":"Task gamma has no verifier evidence."}' \
  "$( cd "$WORK/repo" && printf '%s' '{"hook_event_name":"Stop","model":"gpt-5.6-sol","stop_hook_active":false,"last_assistant_message":"Summary: all tasks done, nothing remaining.","session_id":"generic-fake"}' \
     | DRIFT_CHECK_FAKE_ANSWER="$CODEX_ADVICE" CLAUDE_DRIFT_CHECK_FAKE_ANSWER=NOTHING CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" "$HOOK" )"

# 9h. Codex structured output is accepted only when both schema and cross-field
# invariants hold. Every invalid/unavailable verdict is recorded, never clean.
assert_unavailable() {
  local label="$1" session="$2"
  local file="${TMPDIR:-/tmp}/claude-drift-log/${session}.jsonl"
  if [ -s "$file" ] && python3 -c '
import json,sys
entry=json.loads(open(sys.argv[1]).readlines()[-1])
sys.exit(0 if entry.get("status") == "unavailable" and entry.get("advice") == "drift-check unavailable" else 1)
' "$file"; then
    echo "PASS  $label"
  else
    echo "FAIL  $label"; fail=1
  fi
  rm -f "$file"
}

for row in \
  'invalid-json|not-json' \
  'extra-property|{"status":"nothing","advice":[],"extra":true}' \
  'nothing-with-advice|{"status":"nothing","advice":["gamma"]}' \
  'advice-with-empty-array|{"status":"advice","advice":[]}' \
  'advice-with-empty-string|{"status":"advice","advice":[""]}'
do
  label="${row%%|*}"; answer="${row#*|}"; session="invalid-${label}"
  rm -f "${TMPDIR:-/tmp}/claude-drift-log/${session}.jsonl"
  expect "invalid Codex verdict is suppressed: $label" "{}" \
    "$(fake "$session" "$answer" gpt-5.6-sol)"
  assert_unavailable "invalid Codex verdict is audited: $label" "$session"
done

# 9i. Exercise the actual host command boundaries with local stubs. No provider
# process or network is used; assertions cover arguments, prompt transport, and
# capture-only-the-final-file behavior.
STUBBIN="$WORK/provider-stubs"
mkdir -p "$STUBBIN"
cat > "$STUBBIN/timeout" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" > "$TIMEOUT_ARGS"
[ "$1" = "300" ] || exit 91
shift
exec "$@"
EOF
cat > "$STUBBIN/codex" <<'EOF'
#!/bin/sh
: > "$CODEX_ARGS"
answer_file=""
previous=""
has_skip_git_repo_check=0
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  printf 'git\n' > "$CODEX_CWD_KIND"
else
  printf 'non-git\n' > "$CODEX_CWD_KIND"
fi
for argument in "$@"; do
  printf '%s\n' "$argument" >> "$CODEX_ARGS"
  if [ "$previous" = "--output-last-message" ]; then answer_file="$argument"; fi
  if [ "$argument" = "--skip-git-repo-check" ]; then has_skip_git_repo_check=1; fi
  previous="$argument"
done
if [ "$(cat "$CODEX_CWD_KIND")" = "non-git" ] && [ "$has_skip_git_repo_check" -ne 1 ]; then
  exit 86
fi
printf 'accepted\n' > "$CODEX_ACCEPTED"
cat > "$CODEX_STDIN"
printf 'provider stdout must not become hook output\n'
[ "${CODEX_STUB_STATUS:-0}" = 0 ] || exit "$CODEX_STUB_STATUS"
stub_answer="${CODEX_STUB_ANSWER:-}"
[ -n "$stub_answer" ] || stub_answer='{"status":"nothing","advice":[]}'
printf '%s' "$stub_answer" > "$answer_file"
EOF
cat > "$STUBBIN/claude" <<'EOF'
#!/bin/sh
python3 -c 'import json,os,sys; json.dump(sys.argv[1:], open(os.environ["CLAUDE_ARGS"], "w"))' "$@"
cat > "$CLAUDE_STDIN"
printf '%s\n' "${CLAUDE_STUB_ANSWER:-NOTHING}"
EOF
chmod +x "$STUBBIN/timeout" "$STUBBIN/codex" "$STUBBIN/claude"

invoke_provider_stub() {
  local session="$1" model="$2"
  ( cd "$WORK/repo" && printf '{"hook_event_name":"Stop","model":"%s","stop_hook_active":false,"last_assistant_message":"Summary: all tasks done, nothing remaining.","session_id":"%s"}' "$model" "$session" \
    | PATH="$STUBBIN:$PATH" TIMEOUT_ARGS="$WORK/timeout.args" CODEX_ARGS="$WORK/codex.args" CODEX_STDIN="$WORK/codex.stdin" CODEX_CWD_KIND="$WORK/codex.cwd-kind" CODEX_ACCEPTED="$WORK/codex.accepted" CLAUDE_ARGS="$WORK/claude.args" CLAUDE_STDIN="$WORK/claude.stdin" CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" "$HOOK" )
}

rm -f "$WORK/timeout.args" "$WORK/codex.args" "$WORK/codex.stdin" \
  "$WORK/codex.cwd-kind" "$WORK/codex.accepted" \
  "${TMPDIR:-/tmp}/claude-drift-memo-codex-cli" \
  "${TMPDIR:-/tmp}/claude-drift-log/codex-cli.jsonl"
expect "Codex judge runs successfully from the neutral directory" \
  '{"decision":"block","reason":"Task gamma has no verifier evidence."}' \
  "$(CODEX_STUB_ANSWER="$CODEX_ADVICE" invoke_provider_stub codex-cli gpt-5.6-sol)"
expect "Codex judge cwd is intentionally outside a Git repository" "non-git" \
  "$(cat "$WORK/codex.cwd-kind" 2>/dev/null)"
expect "non-Git Codex invocation was authorized and accepted" "accepted" \
  "$(cat "$WORK/codex.accepted" 2>/dev/null)"
if [ -s "$WORK/timeout.args" ] && [ "$(sed -n '1p' "$WORK/timeout.args")" = 300 ]; then
  echo "PASS  Codex judge has an exact 300-second process timeout"
else
  echo "FAIL  Codex judge timeout was not 300"; fail=1
fi
if [ -s "$WORK/codex.args" ] && python3 -c '
import sys
args=open(sys.argv[1]).read().splitlines()
schema=sys.argv[2]
expected=[
  "exec", "--ephemeral", "--ignore-user-config", "--ignore-rules",
  "--skip-git-repo-check", "--sandbox", "read-only", "--model",
  "gpt-5.6-terra", "-c", "model_reasoning_effort=\"high\"",
  "--output-schema", schema, "--output-last-message",
]
ok=(args[:14] == expected and len(args) == 16 and args[14] and args[15] == "-")
sys.exit(0 if ok else 1)
' "$WORK/codex.args" "$PLUGIN_ROOT/hooks/drift-verdict.schema.json"; then
  echo "PASS  Codex judge invocation is exact, non-Git, read-only, and headless"
else
  echo "FAIL  Codex judge invocation was missing or unsafe"; fail=1
fi
if python3 -c '
import sys
args=open(sys.argv[1]).read().splitlines()
banned={"--dangerously-bypass-approvals-and-sandbox", "--dangerously-bypass-hook-trust"}
unsafe=[arg for arg in args if arg in banned or "danger" in arg.lower() or "bypass" in arg.lower()]
sys.exit(0 if not unsafe else 1)
' "$WORK/codex.args"; then
  echo "PASS  Codex judge has no danger or bypass flags"
else
  echo "FAIL  Codex judge included a danger or bypass flag"; fail=1
fi
if [ -s "$WORK/codex.stdin" ] && grep -qF 'Plan (' "$WORK/codex.stdin" \
   && grep -qF 'Summary: all tasks done, nothing remaining.' "$WORK/codex.stdin"; then
  echo "PASS  Codex judge receives the complete prompt on stdin"
else
  echo "FAIL  Codex judge did not receive the complete prompt on stdin"; fail=1
fi

rm -f "$WORK/claude.args" "$WORK/claude.stdin"
expect "Claude judge clean answer remains silent" "{}" \
  "$(CLAUDE_STUB_ANSWER=NOTHING invoke_provider_stub claude-cli claude-fable-5-1)"
if [ -s "$WORK/claude.args" ] && python3 -c '
import json,sys
args=json.load(open(sys.argv[1]))
ok=(len(args) == 9 and args[0] == "-p" and "Plan (" in args[1]
    and "Summary: all tasks done, nothing remaining." in args[1]
    and args[2:] == ["--model", "claude-haiku-4-5-20251001",
                    "--permission-mode", "plan", "--permission-prompts", "none",
                    "--no-session-persistence"]
    and "bypassPermissions" not in args)
sys.exit(0 if ok else 1)
' "$WORK/claude.args"; then
  echo "PASS  Claude judge keeps complete-prompt safe plan-mode invocation"
else
  echo "FAIL  Claude judge invocation was incomplete or unsafe"; fail=1
fi

UNAVAILABLE_SESSION=codex-unavailable
rm -f "${TMPDIR:-/tmp}/claude-drift-log/${UNAVAILABLE_SESSION}.jsonl"
expect "unavailable Codex judge emits no false-clean continuation" "{}" \
  "$(CODEX_STUB_STATUS=7 invoke_provider_stub "$UNAVAILABLE_SESSION" gpt-5.6-sol)"
assert_unavailable "unavailable Codex judge is audited" "$UNAVAILABLE_SESSION"

# 10. the real path, model included. Off by default: it costs a model call.
if [ "${LIVE:-}" = "1" ]; then
  setup_repo; write_plan active "branch: wave/alpha"; write_transcript "$CLAIM"
  git -C "$WORK/repo" branch wave/alpha
  out="$( cd "$WORK/repo" && printf '{"hook_event_name":"Stop","model":"claude-fable-5-1","stop_hook_active":false,"transcript_path":"%s","last_assistant_message":"Summary: all tasks done, nothing remaining.","session_id":"live"}' "$WORK/transcript.jsonl" \
         | CLAUDE_PLUGIN_ROOT="$PLUGIN_ROOT" "$HOOK" )"
  case "$out" in
    '{}'|'{"hookSpecificOutput"'*) echo "PASS  live path emits valid JSON: ${out:0:40}" ;;
    *) echo "FAIL  live path emitted: ${out:0:80}"; fail=1 ;;
  esac
  python3 -c "import json,sys;json.loads(sys.argv[1])" "$out" \
    && echo "PASS  live output parses as JSON" \
    || { echo "FAIL  live output is not JSON"; fail=1; }
else
  echo "SKIP  live path (set LIVE=1 to run it)"
fi

exit $fail
