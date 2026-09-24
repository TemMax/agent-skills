#!/usr/bin/env bash
# Offline test for tests/eval/skill-navigation.sh: the event-stream parser, the
# answer-field accessor, the read-check, and one probe driven end to end by a
# stub `claude` on PATH. No model is called.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh
. tests/eval/skill-navigation.sh

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

cat > "$W/events.jsonl" <<'JSONL'
{"type":"system","subtype":"init","model":"claude-opus-5-5"}
{"type":"assistant","message":{"content":[{"type":"text","text":"Reading the skill."},{"type":"tool_use","id":"t1","name":"Read","input":{"file_path":"/skill/SKILL.md"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"{\"not\": \"the answer\"}"}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"t2","name":"Grep","input":{"pattern":"x","path":"/skill/references/ignored.md"}},{"type":"tool_use","id":"t3","name":"Read","input":{"file_path":"/skill/references/verdicts.md","offset":10}}]}}
not json at all
{"type":"result","subtype":"success","result":"Per the skill, {draft} was wrong; final:\n{\"next\": \"rework-same-executor\", \"tell_executor_it_lied\": false, \"attach_verdict\": true, \"meta\": {\"k\": 1}}\nThat is my answer."}
JSONL

section "parser"
parsed="$(nav_parse "$W/events.jsonl")"
expect "both Read paths, in order, and nothing else" \
  "/skill/SKILL.md
/skill/references/verdicts.md" "$(nav_reads "$parsed")"
answer="$(nav_answer "$parsed")"
expect "the last top-level JSON object of the result" \
  '{"next":"rework-same-executor","tell_executor_it_lied":false,"attach_verdict":true,"meta":{"k":1}}' "$answer"
expect "string field"  "rework-same-executor" "$(nav_field "$answer" next)"
expect "false field"   "false" "$(nav_field "$answer" tell_executor_it_lied)"
expect "true field"    "true"  "$(nav_field "$answer" attach_verdict)"
expect "missing field" "<missing>" "$(nav_field "$answer" escalate)"
expect "no answer at all" "<missing>" "$(nav_field "" next)"

printf '%s\n' '{"type":"result","result":"I cannot answer that."}' > "$W/noanswer.jsonl"
expect "a result without a JSON object yields an empty answer" "" "$(nav_answer "$(nav_parse "$W/noanswer.jsonl")")"

section "parser (codex)"
cat > "$W/codex-events.jsonl" <<'JSONL'
{"type":"item.completed","item":{"id":"cmd1","type":"command_execution","command":"/bin/zsh -lc 'sed -n \"1,200p\" /skill/SKILL.md'","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"cmd2","type":"command_execution","command":"cd /skill && cat references/verdicts.md | head -50","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"cmd3","type":"command_execution","command":"wc -l /skill/references/ignored.md","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"cmd4","type":"command_execution","command":"rg -n drift references/orchestrator-drift-hook.md","exit_code":0,"status":"completed"}}
{"type":"item.completed","item":{"id":"cmd5","type":"command_execution","command":"cat 'references/broken.md","exit_code":0,"status":"completed"}}
not a json line at all
{"type":"item.completed","item":{"id":"m1","type":"agent_message","text":"First scratch: {\"draft\": true}"}}
{"type":"item.completed","item":{"id":"m2","type":"agent_message","text":"Final answer: {\"lint_command\": \"node plan-lint.mjs\", \"init_command\": \"node codex-wave-state.mjs init --wave 1 1111111111111111111111111111111111111111\", \"uses_claude_workflow\": false}"}}
JSONL
parsed_codex="$(nav_parse_codex "$W/codex-events.jsonl")"
expect "zsh -lc wrap, cd-joined pipe read, no-read program, unresolved relative read, an unparseable command skipped, a non-JSON line skipped, and only the last agent_message's answer" \
  "/skill/SKILL.md
/skill/references/verdicts.md
references/orchestrator-drift-hook.md" "$(nav_reads "$parsed_codex")"
expect "the last agent_message's last top-level JSON object" \
  '{"lint_command":"node plan-lint.mjs","init_command":"node codex-wave-state.mjs init --wave 1 1111111111111111111111111111111111111111","uses_claude_workflow":false}' \
  "$(nav_answer "$parsed_codex")"

GW="$W/glob"; mkdir -p "$GW/references"
: > "$GW/references/a.md"; : > "$GW/references/b.md"
printf '%s\n' "{\"type\":\"item.completed\",\"item\":{\"id\":\"g1\",\"type\":\"command_execution\",\"command\":\"cd $GW && cat references/*.md\",\"exit_code\":0,\"status\":\"completed\"}}" \
  > "$W/glob-events.jsonl"
expect "glob expansion against the tracked directory yields both absolute paths" \
  "$GW/references/a.md
$GW/references/b.md" "$(nav_reads "$(nav_parse_codex "$W/glob-events.jsonl")")"

section "parser (codex): shell variables and for loops"
cat > "$W/vars-events.jsonl" <<'JSONL'
{"type":"item.completed","item":{"id":"v1","type":"command_execution","command":"/bin/zsh -lc 'skill_root=/skill; sed -n \"1,240p\" \"$skill_root/SKILL.md\"; sed -n \"1,200p\" \"$skill_root/references/verdicts.md\"'","exit_code":0,"status":"completed"}}
JSONL
expect "variable assignment then substitution in two quoted read args" \
  "/skill/SKILL.md
/skill/references/verdicts.md" "$(nav_reads "$(nav_parse_codex "$W/vars-events.jsonl")")"

cat > "$W/for-events.jsonl" <<'JSONL'
{"type":"item.completed","item":{"id":"l1","type":"command_execution","command":"/bin/zsh -lc 'for f in /skill/references/codex-routing.md /skill/references/codex-wave-protocol.md; do echo \"--- $f\"; sed -n '\"'\"'1,260p'\"'\"' \"$f\"; done'","exit_code":0,"status":"completed"}}
JSONL
expect "for loop expands the loop variable into one read per value, echo emits nothing" \
  "/skill/references/codex-routing.md
/skill/references/codex-wave-protocol.md" "$(nav_reads "$(nav_parse_codex "$W/for-events.jsonl")")"

printf '%s\n' '{"type":"item.completed","item":{"id":"e1","type":"command_execution","command":"export D=/skill && cat ${D}/references/a.md","exit_code":0,"status":"completed"}}' \
  > "$W/export-events.jsonl"
expect "export NAME=value then \${NAME} substitution" \
  "/skill/references/a.md" "$(nav_reads "$(nav_parse_codex "$W/export-events.jsonl")")"

printf '%s\n' '{"type":"item.completed","item":{"id":"u1","type":"command_execution","command":"cat \"$UNKNOWN/x.md\"","exit_code":0,"status":"completed"}}' \
  > "$W/unknown-events.jsonl"
expect "an argument still holding an unknown variable after substitution is skipped" \
  "" "$(nav_reads "$(nav_parse_codex "$W/unknown-events.jsonl")")"

printf '%s\n' '{"type":"item.completed","item":{"id":"x1","type":"command_execution","command":"X=1 cat /skill/SKILL.md","exit_code":0,"status":"completed"}}' \
  > "$W/mixed-events.jsonl"
expect "a leading assignment followed by a program is dropped and the program still runs" \
  "/skill/SKILL.md" "$(nav_reads "$(nav_parse_codex "$W/mixed-events.jsonl")")"

section "read-check"
S="$W/skill"; mkdir -p "$S/references"
: > "$S/SKILL.md"; : > "$S/references/verdicts.md"
printf '%s\n' "$S/SKILL.md" "$S/references/../references/verdicts.md" > "$W/reads.txt"
printf '%s\n' "$S/SKILL.md" > "$W/reads-skill-only.txt"
expect "absent file -> skip"              "skip" "$(nav_read_status "$S" references/contract-amendment.md "$W/reads.txt")"
expect "present and read -> yes"          "yes"  "$(nav_read_status "$S" references/verdicts.md "$W/reads.txt")"
expect "present, not read -> no"          "no"   "$(nav_read_status "$S" references/verdicts.md "$W/reads-skill-only.txt")"
printf '%s\n' "skill/references/verdicts.md" > "$W/reads-rel.txt"
expect "relative read resolved from cwd"  "yes"  "$(nav_read_status "$S" references/verdicts.md "$W/reads-rel.txt" "$W")"

# nav_report_read calls pass/fail; run it in a subshell so its verdict can be
# asserted without counting towards this test's own totals.
report() { ( FAILED=0; PASSED=0; nav_report_read "$@" >"$W/report.out"; echo "$PASSED/$FAILED" ); }
expect "absent file reports as a pass"   "1/0" "$(report "$S" references/contract-amendment.md 0 3)"
contains "absent file prints SKIP"       "SKIP read-check (references/contract-amendment.md absent)" "$(cat "$W/report.out")"
expect "present, read every run -> pass" "1/0" "$(report "$S" references/verdicts.md 3 3)"
expect "present, missed one run -> fail" "0/1" "$(report "$S" references/verdicts.md 2 3)"
contains "failure shows k/n"             "read references/verdicts.md (2/3)" "$(cat "$W/report.out")"

section "read-check (optional)"
expect "optional, absent file reports as a pass" "1/0" "$(report "$S" optional:references/contract-amendment.md 0 3)"
contains "optional, absent file prints SKIP" "SKIP read-check (references/contract-amendment.md absent)" "$(cat "$W/report.out")"
expect "optional, present and read -> pass"     "1/0" "$(report "$S" optional:references/verdicts.md 3 3)"
contains "optional, present and read prints INFO with k/n" \
  "INFO read references/verdicts.md (3/3, optional)" "$(cat "$W/report.out")"
expect "optional, present and not read -> still a pass" "1/0" "$(report "$S" optional:references/verdicts.md 0 3)"
contains "optional, present and not read prints INFO with k/n" \
  "INFO read references/verdicts.md (0/3, optional)" "$(cat "$W/report.out")"

section "probe driven by a stub claude (no model call)"
BIN="$W/bin"; mkdir -p "$BIN"
cat > "$BIN/claude" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$NAV_STUB_LOG/argv"
cat > "$NAV_STUB_LOG/stdin"
n="$(cat "$NAV_STUB_LOG/count" 2>/dev/null || echo 0)"; n=$((n+1)); echo "$n" > "$NAV_STUB_LOG/count"
lied=false; [ "$n" -eq 2 ] && lied=true
printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"%s/SKILL.md"}}]}}\n' "$NAV_STUB_SKILL"
printf '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{"file_path":"%s/references/verdicts.md"}}]}}\n' "$NAV_STUB_SKILL"
printf '{"type":"result","result":"{\\"next\\": \\"rework-same-executor\\", \\"tell_executor_it_lied\\": %s, \\"attach_verdict\\": true}"}\n' "$lied"
SH
chmod +x "$BIN/claude"
mkdir -p "$W/log"
out="$(
  PATH="$BIN:$PATH" NAV_STUB_LOG="$W/log" NAV_STUB_SKILL="$S" \
  SKILL_DIR="$S" EVAL_MODEL=stub-model EVAL_REPEAT=3 NAV_WORK="$W" FAILED=0 PASSED=0
  export NAV_STUB_LOG NAV_STUB_SKILL
  nav_probe N4 "stub" references/verdicts.md "a scenario" "a shape" \
    "eq:next:rework-same-executor" "eq:tell_executor_it_lied:false" "has:next:rework"
  echo "totals $PASSED/$FAILED"
)"
expect "stub was called once per repetition" "3" "$(cat "$W/log/count")"
contains "read-check counts every repetition" "read references/verdicts.md (3/3)" "$out"
contains "SKILL.md read-check"                "read SKILL.md (3/3)" "$out"
contains "k/n for a held assertion"           "next = rework-same-executor (3/3)" "$out"
contains "one bad repetition fails it"        "tell_executor_it_lied = false (2/3)" "$out"
contains "contains-style assertion"           "next contains 'rework' (3/3)" "$out"
contains "exactly one failure overall"        "totals 4/1" "$out"
argv="$(cat "$W/log/argv")"
contains "model flag"            "stub-model" "$argv"
contains "dontAsk, not plan mode" "dontAsk" "$argv"
case "$argv" in *plan*) fail "no plan permission mode" "$argv" ;; *) pass "no plan permission mode" ;; esac
contains "read-only tool allowlist" "Read,Glob,Grep" "$argv"
contains "stream-json events"       "stream-json" "$argv"
contains "prompt opens in EVAL MODE on SKILL_DIR" "EVAL MODE: Read and apply the multi-model skill at $S/SKILL.md" "$(cat "$W/log/stdin")"

section "probe driven by a stub codex (no model call)"
CBIN="$W/cbin"; mkdir -p "$CBIN"
cat > "$CBIN/codex" <<'SH'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$NAV_STUB_LOG/argv"
cat > "$NAV_STUB_LOG/stdin"
n="$(cat "$NAV_STUB_LOG/count" 2>/dev/null || echo 0)"; n=$((n+1)); echo "$n" > "$NAV_STUB_LOG/count"
lied=false; [ "$n" -eq 2 ] && lied=true
printf '{"type":"item.completed","item":{"id":"cmd1","type":"command_execution","command":"cat %s/SKILL.md","exit_code":0,"status":"completed"}}\n' "$NAV_STUB_SKILL"
printf '{"type":"item.completed","item":{"id":"cmd2","type":"command_execution","command":"cat %s/references/verdicts.md","exit_code":0,"status":"completed"}}\n' "$NAV_STUB_SKILL"
printf '{"type":"item.completed","item":{"id":"msg1","type":"agent_message","text":"{\\"next\\": \\"rework-same-executor\\", \\"tell_executor_it_lied\\": %s, \\"attach_verdict\\": true}"}}\n' "$lied"
SH
chmod +x "$CBIN/codex"
mkdir -p "$W/clog"
cout="$(
  PATH="$CBIN:$PATH" NAV_STUB_LOG="$W/clog" NAV_STUB_SKILL="$S" \
  SKILL_DIR="$S" EVAL_MODEL=stub-model EVAL_PROVIDER=codex EVAL_EFFORT=medium EVAL_REPEAT=3 NAV_WORK="$W" FAILED=0 PASSED=0
  export NAV_STUB_LOG NAV_STUB_SKILL EVAL_PROVIDER EVAL_EFFORT
  nav_probe N4 "stub" references/verdicts.md "a scenario" "a shape" \
    "eq:next:rework-same-executor" "eq:tell_executor_it_lied:false" "has:next:rework"
  echo "totals $PASSED/$FAILED"
)"
expect "stub was called once per repetition" "3" "$(cat "$W/clog/count")"
contains "read-check counts every repetition (reads recovered from command_execution events)" \
  "read references/verdicts.md (3/3)" "$cout"
contains "SKILL.md read-check" "read SKILL.md (3/3)" "$cout"
contains "k/n for a held assertion" "next = rework-same-executor (3/3)" "$cout"
contains "one bad repetition fails it" "tell_executor_it_lied = false (2/3)" "$cout"
contains "contains-style assertion" "next contains 'rework' (3/3)" "$cout"
contains "exactly one failure overall" "totals 4/1" "$cout"
cargv="$(cat "$W/clog/argv")"
contains "model flag"          "stub-model" "$cargv"
contains "json output"         "--json" "$cargv"
contains "read-only sandbox"   "read-only" "$cargv"
contains "ephemeral"           "--ephemeral" "$cargv"
contains "effort passed through -c" 'model_reasoning_effort="medium"' "$cargv"

section "unknown EVAL_PROVIDER"
pout="$( (EVAL_PROVIDER=bogus nav_main) 2>&1 )"; pec=$?
expect "nav_main exits 2" "2" "$pec"
contains "prints the unknown provider" "unknown EVAL_PROVIDER: bogus" "$pout"

summary
