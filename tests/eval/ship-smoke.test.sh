#!/usr/bin/env bash
# Offline test for tests/eval/ship-smoke.sh. No model is called: `codex` is
# replaced by a stub on PATH that performs the same git-level work a real
# orchestrator session would (merging the two fixture branches) and prints a
# `--json` stream containing one `thread.started` event, then writes a real
# rollout-*.jsonl under a stub CODEX_HOME so the real, offline
# tests/eval/telemetry/telemetry.mjs can parse it for real — this proves the
# script's own plumbing (fixture, orchestrator invocation, rollout lookup,
# telemetry call, runner-summary merge, comparison table) without ever
# calling a model. Stub input is injected purely through env vars (CODEX_HOME
# / SHIP_SMOKE_CODEX_SESSIONS_DIR / SHIP_SMOKE_RUNNER_SUMMARY, all read
# directly by ship-smoke.sh) plus a stub codex on PATH.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
BIN="$W/bin"; mkdir -p "$BIN"

# The stub: simulates one orchestrator session against the ship-smoke
# fixture repo it is handed via -C. It merges wave/add-guard (a real guard
# for src/calc.py) and wave/add-doc (a real docs/NOTE.md) into master so the
# fixture's own must_run commands go green, tells native vs. runner mode
# apart by whether its prompt mentions codex-wave-runner.mjs, writes a fake
# runner summary.json in runner mode, and finally emits a `thread.started`
# `--json` line plus a matching real rollout-*.jsonl under $CODEX_HOME.
cat > "$BIN/codex" <<'SH'
#!/usr/bin/env bash
set -uo pipefail
repo="" model=""
args=("$@")
i=0
while [ $i -lt ${#args[@]} ]; do
  case "${args[$i]}" in
    -C) repo="${args[$((i+1))]}" ;;
    --model) model="${args[$((i+1))]}" ;;
  esac
  i=$((i+1))
done
prompt="$(cat)"
is_runner=0
case "$prompt" in *codex-wave-runner.mjs*) is_runner=1 ;; esac

printf '%s\n' "${args[@]}" > "$repo/.ship-smoke-stub-argv"

base="$(git -C "$repo" rev-parse HEAD)"

git -C "$repo" branch wave/add-guard "$base"
git -C "$repo" worktree add -q "$repo/.worktrees/wave-add-guard" wave/add-guard
printf 'def divide(a, b):\n    if b == 0:\n        return None\n    return a / b\n' \
  > "$repo/.worktrees/wave-add-guard/src/calc.py"
git -C "$repo/.worktrees/wave-add-guard" add src/calc.py
git -C "$repo/.worktrees/wave-add-guard" commit -q -m 'guard division by zero'
git -C "$repo" worktree remove --force "$repo/.worktrees/wave-add-guard"

git -C "$repo" branch wave/add-doc "$base"
git -C "$repo" worktree add -q "$repo/.worktrees/wave-add-doc" wave/add-doc
printf 'The divide() guard returns None instead of raising on division by zero.\n' \
  > "$repo/.worktrees/wave-add-doc/docs/NOTE.md"
git -C "$repo/.worktrees/wave-add-doc" add docs/NOTE.md
git -C "$repo/.worktrees/wave-add-doc" commit -q -m 'document the guard'
git -C "$repo" worktree remove --force "$repo/.worktrees/wave-add-doc"

git -C "$repo" checkout -q master
git -C "$repo" merge -q --no-ff -m 'wave 1 merge' wave/add-guard
git -C "$repo" merge -q --no-ff -m 'wave 1 merge' wave/add-doc

if [ "$is_runner" = 1 ]; then
  out_dir="$repo/.worktrees/codex-runner/1-${base:0:12}"
  mkdir -p "$out_dir"
  cat > "$out_dir/summary.json" <<JSON
{
  "status": "merge-ready",
  "stopped": [],
  "wave": 1,
  "wallSeconds": 42.5,
  "children": [
    {"task": "add-guard", "role": "executor", "attempt": 1, "model": "gpt-6-luna", "effort": "medium",
     "exit": 0, "seconds": 12.3,
     "usage": {"input_tokens": 4000, "cached_input_tokens": 500, "output_tokens": 900, "reasoning_output_tokens": 100}},
    {"task": "add-guard", "role": "supervisor", "attempt": 1, "model": "gpt-6-astra", "effort": "high",
     "exit": 0, "seconds": 8.1,
     "usage": {"input_tokens": 3000, "cached_input_tokens": 0, "output_tokens": 400, "reasoning_output_tokens": 50}},
    {"task": "add-doc", "role": "executor", "attempt": 1, "model": "gpt-6-sol", "effort": "medium",
     "exit": 0, "seconds": 6.7,
     "usage": {"input_tokens": 2500, "cached_input_tokens": 0, "output_tokens": 300, "reasoning_output_tokens": 0}},
    {"task": "add-doc", "role": "supervisor", "attempt": 1, "model": "gpt-6-astra", "effort": "high",
     "exit": 0, "seconds": 5.2,
     "usage": {"input_tokens": 2200, "cached_input_tokens": 0, "output_tokens": 250, "reasoning_output_tokens": 0}}
  ]
}
JSON
fi

thread_id="$(python3 -c 'import uuid; print(uuid.uuid4())')"
# Same precedence ship-smoke.sh itself uses, so the stub always writes where
# the script will look: SHIP_SMOKE_CODEX_SESSIONS_DIR first, else
# CODEX_HOME/sessions.
sessions_dir="${SHIP_SMOKE_CODEX_SESSIONS_DIR:-${CODEX_HOME:?CODEX_HOME or SHIP_SMOKE_CODEX_SESSIONS_DIR must be set for the stub}/sessions}/2026/09/23"
mkdir -p "$sessions_dir"
rollout="$sessions_dir/rollout-20260923000000-$thread_id.jsonl"
python3 - "$rollout" "$thread_id" "$model" <<'PY'
import json, sys
from datetime import datetime, timedelta
path, thread_id, model = sys.argv[1:]
base = datetime(2026, 9, 23, 0, 0, 0)
ts = lambda m: (base + timedelta(minutes=m)).isoformat() + "Z"
rows = [
    {"timestamp": ts(0), "type": "session_meta", "payload": {"id": thread_id, "cwd": "/repo", "cli_version": "0.155.0"}},
    {"timestamp": ts(0), "type": "turn_context", "payload": {"model": model, "effort": "high"}},
    {"timestamp": ts(0), "type": "event_msg", "payload": {"type": "task_started"}},
    {"timestamp": ts(1), "type": "token_usage_record",
     "payload": {"usage": {"input_tokens": 5000, "cached_input_tokens": 200, "output_tokens": 800, "reasoning_output_tokens": 100}}},
    {"timestamp": ts(1), "type": "response_item", "payload": {"type": "function_call", "call_id": "c1", "name": "spawn_agent"}},
    {"timestamp": ts(3), "type": "response_item", "payload": {"type": "function_call_output", "call_id": "c1", "output": "ok"}},
    {"timestamp": ts(3), "type": "token_usage_record",
     "payload": {"usage": {"input_tokens": 3000, "cached_input_tokens": 0, "output_tokens": 500, "reasoning_output_tokens": 0}}},
    {"timestamp": ts(4), "type": "event_msg", "payload": {"type": "task_complete"}},
]
with open(path, "w", encoding="utf-8") as f:
    for row in rows:
        f.write(json.dumps(row) + "\n")
PY

printf '{"type":"thread.started","thread_id":"%s"}\n' "$thread_id"
exit 0
SH
chmod +x "$BIN/codex"

# Extracts the ```json wave-plan fenced block from a generated plan.md and
# prints it as compact JSON on stdout. Kept as its own script (rather than
# inline in a `check` expression) because `check` re-parses its argument with
# `eval`, and a literal ``` fence inside a double-quoted string would be
# re-interpreted as command substitution on that second pass.
cat > "$W/extract-plan.py" <<'PY'
import json, re, sys
text = open(sys.argv[1], encoding="utf-8").read()
fence = chr(96) * 3
m = re.search(r"" + fence + r"json wave-plan\r?\n([\s\S]*?)\r?\n" + fence, text)
if not m:
    sys.exit(1)
json.dump(json.loads(m.group(1)), sys.stdout)
PY

section "usage and argument validation"
check "no arguments prints usage and exits 2" \
  "PATH=\"$BIN:\$PATH\" bash tests/eval/ship-smoke.sh; [ \$? -eq 2 ]"
check "--mode with a bad value exits 2" \
  "PATH=\"$BIN:\$PATH\" bash tests/eval/ship-smoke.sh --mode nonsense --results $W/r-bad-mode; [ \$? -eq 2 ]"
check "missing --results exits 2" \
  "PATH=\"$BIN:\$PATH\" bash tests/eval/ship-smoke.sh --mode native; [ \$? -eq 2 ]"
check "--supervisor with a bad value exits 2 with the usage error" \
  "PATH=\"$BIN:\$PATH\" bash tests/eval/ship-smoke.sh --mode native --supervisor gpt-6-nonsense --results $W/r-bad-supervisor > $W/bad-supervisor.out 2>&1; rc=\$?; [ \$rc -eq 2 ] && grep -qF -- '--supervisor must be gpt-6-astra or gpt-6-sol' $W/bad-supervisor.out"

DIRTY="$W/dirty-results"; mkdir -p "$DIRTY"
printf 'pre-existing evidence\n' > "$DIRTY/keep.txt"
set +e
PATH="$BIN:$PATH" bash tests/eval/ship-smoke.sh --mode native --results "$DIRTY" > "$W/dirty.out" 2>&1
rc_dirty=$?
set -e
expect "a non-empty --results directory exits 73" "73" "$rc_dirty"
check "the existing file in a dirty --results directory is untouched" "grep -qxF 'pre-existing evidence' '$DIRTY/keep.txt'"
check "nothing new was written into the dirty directory" "[ ! -e '$DIRTY/comparison.md' ]"

section "native mode: no model called, comparison table has the right shape"
RESULTS_NATIVE="$W/results-native"
set +e
CODEX_HOME="$W/codex-home-native" PATH="$BIN:$PATH" \
  bash tests/eval/ship-smoke.sh --mode native --results "$RESULTS_NATIVE" \
  > "$W/native.out" 2>&1
rc_native=$?
set -e
expect "native mode exits 0" "0" "$rc_native"
check "telemetry.json was written for native mode" "[ -f '$RESULTS_NATIVE/native/telemetry.json' ]"
check "comparison.md was written" "[ -f '$RESULTS_NATIVE/comparison.md' ]"
REPO_NATIVE="$(cat "$RESULTS_NATIVE/native/repo-path.txt")"
check "the stub codex was invoked without --ephemeral" \
  "! grep -qF -- '--ephemeral' '$REPO_NATIVE/.ship-smoke-stub-argv'"
check "the stub codex was invoked with --json --skip-git-repo-check and workspace-write" \
  "grep -qxF -- '--json' '$REPO_NATIVE/.ship-smoke-stub-argv' && grep -qxF -- '--skip-git-repo-check' '$REPO_NATIVE/.ship-smoke-stub-argv' && grep -qxF -- 'workspace-write' '$REPO_NATIVE/.ship-smoke-stub-argv'"
check "the stub codex was invoked with --add-dir pointing at the fixture repo's .git" \
  "grep -qxF -- '--add-dir' '$REPO_NATIVE/.ship-smoke-stub-argv' && grep -qxF -- '$REPO_NATIVE/.git' '$REPO_NATIVE/.ship-smoke-stub-argv'"
check "the stub codex was invoked with network access enabled for workspace-write" \
  "grep -qxF -- 'sandbox_workspace_write.network_access=true' '$REPO_NATIVE/.ship-smoke-stub-argv'"
check "the stub codex was not invoked with danger-full-access" \
  "! grep -qxF -- 'danger-full-access' '$REPO_NATIVE/.ship-smoke-stub-argv'"
check "the fixture's committed .gitignore lists __pycache__/" \
  "git -C '$REPO_NATIVE' show HEAD:.gitignore | grep -qxF '__pycache__/'"
COMPARISON_NATIVE="$(cat "$RESULTS_NATIVE/comparison.md")"
contains "comparison table has a native row" "| native |" "$COMPARISON_NATIVE"
contains "comparison table's must_run column reads pass" "pass |" "$COMPARISON_NATIVE"
check "comparison table has a supervisor column reading gpt-6-astra by default" \
  "grep -qE '^\| native \| gpt-6-astra \|' '$RESULTS_NATIVE/comparison.md'"
check "wall minutes column is the expected 4" "grep -qE '^\| native \| gpt-6-astra \| 4(\.0+)? \|' '$RESULTS_NATIVE/comparison.md'"
check "orchestrator model-minutes column is the expected 2" \
  "grep -qE '^\| native \| gpt-6-astra \| 4(\.0+)? \| 2(\.0+)? \|' '$RESULTS_NATIVE/comparison.md'"
check "orchestrator share-of-wall column reads 50.0%" "grep -qF '50.0%' '$RESULTS_NATIVE/comparison.md'"
check "orchestrator requests column reads 2" "grep -qE '\| 2 \| 8000 \|' '$RESULTS_NATIVE/comparison.md'"
check "fixture's must_run actually passed after the stub's merge" "[ \"\$(cat '$RESULTS_NATIVE/native/must_run.txt')\" = true ]"
check "plan.md evidence was copied" "[ -s '$RESULTS_NATIVE/native/plan.md' ]"
check "runner-summary.json is absent in native mode" "[ ! -e '$RESULTS_NATIVE/native/runner-summary.json' ]"

section "the fixture plan is lint-clean against the fixture repo"
check "plan-lint.mjs reports 0 errors on the fixture" \
  "node plugins/orchestration/skills/super-plan/references/plan-lint.mjs '$RESULTS_NATIVE/native/plan.md' --repo '$REPO_NATIVE' | grep -qE '^OK: 0 error'"

section "default supervisor (--supervisor omitted): plan unchanged"
PLAN_JSON_NATIVE="$W/plan-native.json"
python3 "$W/extract-plan.py" "$RESULTS_NATIVE/native/plan.md" > "$PLAN_JSON_NATIVE"
check "default plan's wave supervisor is gpt-6-astra/high" \
  "python3 -c \"import json; p=json.load(open('$PLAN_JSON_NATIVE')); s=p['waves'][0]['supervisor']; exit(0 if s=={'model':'gpt-6-astra','effort':'high'} else 1)\""
check "default plan's add-guard executor/ladder unchanged (gpt-6-luna/medium, ladder gpt-6-sol)" \
  "python3 -c \"import json; p=json.load(open('$PLAN_JSON_NATIVE')); tk=p['waves'][0]['tasks'][0]; exit(0 if tk['executor']=={'model':'gpt-6-luna','effort':'medium'} and tk['ladder']==['gpt-6-sol'] else 1)\""
check "default plan's add-doc executor unchanged (gpt-6-sol/medium, no ladder key)" \
  "python3 -c \"import json; p=json.load(open('$PLAN_JSON_NATIVE')); tk=p['waves'][0]['tasks'][1]; exit(0 if tk['executor']=={'model':'gpt-6-sol','effort':'medium'} and 'ladder' not in tk else 1)\""
check "default plan still carries approvals.premium for gpt-6-astra" \
  "python3 -c \"import json; p=json.load(open('$PLAN_JSON_NATIVE')); a=p.get('approvals',{}).get('premium',{}); exit(0 if a.get('models')==['gpt-6-astra'] else 1)\""
check "default orchestrator prompt names supervisor gpt-6-astra/high" \
  "grep -qF 'supervisor gpt-6-astra/high' '$RESULTS_NATIVE/native/orchestrator.prompt.md'"

section "--supervisor gpt-6-sol: standard-supervisor plan variant"
RESULTS_SOL="$W/results-sol"
set +e
CODEX_HOME="$W/codex-home-sol" PATH="$BIN:$PATH" \
  bash tests/eval/ship-smoke.sh --mode native --supervisor gpt-6-sol --results "$RESULTS_SOL" \
  > "$W/sol.out" 2>&1
rc_sol=$?
set -e
expect "Sol supervisor mode exits 0" "0" "$rc_sol"
check "Sol variant plan.md evidence was copied" "[ -s '$RESULTS_SOL/native/plan.md' ]"
REPO_SOL="$(cat "$RESULTS_SOL/native/repo-path.txt")"
PLAN_JSON_SOL="$W/plan-sol.json"
python3 "$W/extract-plan.py" "$RESULTS_SOL/native/plan.md" > "$PLAN_JSON_SOL"
check "Sol variant plan's wave supervisor is gpt-6-sol/high" \
  "python3 -c \"import json; p=json.load(open('$PLAN_JSON_SOL')); s=p['waves'][0]['supervisor']; exit(0 if s=={'model':'gpt-6-sol','effort':'high'} else 1)\""
check "Sol variant's add-guard executor is gpt-6-luna/medium with empty ladder" \
  "python3 -c \"import json; p=json.load(open('$PLAN_JSON_SOL')); tk=p['waves'][0]['tasks'][0]; exit(0 if tk['executor']=={'model':'gpt-6-luna','effort':'medium'} and tk['ladder']==[] else 1)\""
check "Sol variant's add-doc executor is gpt-6-luna/medium with empty ladder" \
  "python3 -c \"import json; p=json.load(open('$PLAN_JSON_SOL')); tk=p['waves'][0]['tasks'][1]; exit(0 if tk['executor']=={'model':'gpt-6-luna','effort':'medium'} and tk['ladder']==[] else 1)\""
check "Sol variant plan carries no approvals key (no premium model used)" \
  "python3 -c \"import json; p=json.load(open('$PLAN_JSON_SOL')); exit(0 if 'approvals' not in p else 1)\""
check "Sol variant plan's other fields (ci/e2e/contracts) unchanged" \
  "python3 -c \"import json; p=json.load(open('$PLAN_JSON_SOL')); w=p['waves'][0]; exit(0 if w['tasks'][0]['contract']['files_allowed']==['src/**'] and w['tasks'][1]['contract']['files_allowed']==['docs/**'] and p['ci']=='none: disposable fixture repository without CI' else 1)\""
check "Sol variant orchestrator prompt names supervisor gpt-6-sol/high" \
  "grep -qF 'supervisor gpt-6-sol/high' '$RESULTS_SOL/native/orchestrator.prompt.md'"
check "Sol variant plan is lint-clean against its fixture repo" \
  "node plugins/orchestration/skills/super-plan/references/plan-lint.mjs '$RESULTS_SOL/native/plan.md' --repo '$REPO_SOL' | grep -qE '^OK: 0 error'"
contains "Sol variant comparison.md shows the supervisor" "| native | gpt-6-sol |" "$(cat "$RESULTS_SOL/comparison.md")"

section "runner mode: --sessions override, summary.json children merged in"
RESULTS_RUNNER="$W/results-runner"
SESSIONS_OVERRIDE="$W/sessions-override/sessions"
set +e
env -u CODEX_HOME SHIP_SMOKE_CODEX_SESSIONS_DIR="$SESSIONS_OVERRIDE" \
  PATH="$BIN:$PATH" bash tests/eval/ship-smoke.sh --mode runner --results "$RESULTS_RUNNER" \
  > "$W/runner.out" 2>&1
rc_runner=$?
set -e
expect "runner mode exits 0" "0" "$rc_runner"
check "runner-summary.json evidence was copied" "[ -f '$RESULTS_RUNNER/runner/runner-summary.json' ]"
check "telemetry.json gained the runner's executor/supervisor rows" \
  "python3 -c \"import json; r=json.load(open('$RESULTS_RUNNER/runner/telemetry.json')); ids={c['id'] for c in r['children']}; exit(0 if {'add-guard-executor-1','add-guard-supervisor-1','add-doc-executor-1','add-doc-supervisor-1'} <= ids else 1)\""
check "the merged runner rows carry role, model and seconds-derived minutes" \
  "python3 -c \"import json; r=json.load(open('$RESULTS_RUNNER/runner/telemetry.json')); c=[x for x in r['children'] if x['id']=='add-guard-executor-1'][0]; exit(0 if c['role']=='executor' and c['model']=='gpt-6-luna' and abs(c['wallMinutes']-12.3/60)<1e-6 else 1)\""
check "cost total accounts for the runner rows (nonzero)" \
  "python3 -c \"import json; r=json.load(open('$RESULTS_RUNNER/runner/telemetry.json')); exit(0 if r['cost']['total'] > 0 else 1)\""
# add-guard-executor-1: gpt-6-luna @ [0.1, 0.01, 0.5], usage input=4000
# cached=500 output=900 reasoning=100 (both cached and reasoning nonzero, so
# a formula that double-counted either would drift from these exact values).
# tokens.total must be input+output only (cachedInput is a subset of input,
# reasoningOutput a subset of output): 4000+900=4900. cost must be
# (input-cachedInput)*in + cachedInput*cached + output*out, never adding
# reasoningOutput on top of output: (4000-500)/1e6*0.1 + 500/1e6*0.01 +
# 900/1e6*0.5 = 0.000805.
check "merged runner row's tokens.total excludes cachedInput/reasoningOutput double-count" \
  "python3 -c \"import json; r=json.load(open('$RESULTS_RUNNER/runner/telemetry.json')); c=[x for x in r['children'] if x['id']=='add-guard-executor-1'][0]; exit(0 if c['tokens']['total']==4900 and c['tokens']['cachedInput']==500 and c['tokens']['reasoningOutput']==100 else 1)\""
check "merged runner row's cost matches the analyzer's non-double-counting formula exactly" \
  "python3 -c \"import json; r=json.load(open('$RESULTS_RUNNER/runner/telemetry.json')); g=[x for x in r['cost']['byRoleModel'] if x['role']=='executor' and x['model']=='gpt-6-luna'][0]; exit(0 if abs(g['cost']-0.000805)<1e-9 and g['tokens']['total']==4900 else 1)\""
contains "comparison table has a runner row" "| runner |" "$(cat "$RESULTS_RUNNER/comparison.md")"

section "--mode both runs one native and one runner instance against independent fixtures"
RESULTS_BOTH="$W/results-both"
set +e
CODEX_HOME="$W/codex-home-both" PATH="$BIN:$PATH" \
  bash tests/eval/ship-smoke.sh --mode both --results "$RESULTS_BOTH" \
  > "$W/both.out" 2>&1
rc_both=$?
set -e
expect "both mode exits 0" "0" "$rc_both"
check "native telemetry.json exists under --mode both" "[ -f '$RESULTS_BOTH/native/telemetry.json' ]"
check "runner telemetry.json exists under --mode both" "[ -f '$RESULTS_BOTH/runner/telemetry.json' ]"
check "the two submodes used different fixture repos" \
  "[ \"\$(cat '$RESULTS_BOTH/native/repo-path.txt')\" != \"\$(cat '$RESULTS_BOTH/runner/repo-path.txt')\" ]"
BOTH_COMPARISON="$(cat "$RESULTS_BOTH/comparison.md")"
contains "comparison table has both rows under --mode both" "| native |" "$BOTH_COMPARISON"
contains "comparison table has the runner row too" "| runner |" "$BOTH_COMPARISON"

section "codex --skip-git-repo-check exec is never invoked with --ephemeral (rollouts persist)"
check "at least one rollout was captured under the stub CODEX_HOME" \
  "find '$W/codex-home-native/sessions' -name '*.jsonl' -print -quit | grep -q ."

section "a mode whose telemetry.json never got written (it failed before telemetry) is reported, not a crash"
BIN_BROKEN="$W/bin-broken"; mkdir -p "$BIN_BROKEN"
cat > "$BIN_BROKEN/codex" <<'SH'
#!/usr/bin/env bash
# Simulates an orchestrator session that fails outright: no thread.started
# line, so ship-smoke.sh can never find a rollout or run telemetry for it.
cat >/dev/null
exit 1
SH
chmod +x "$BIN_BROKEN/codex"
RESULTS_BROKEN="$W/results-broken"
set +e
CODEX_HOME="$W/codex-home-broken" PATH="$BIN_BROKEN:$PATH" \
  bash tests/eval/ship-smoke.sh --mode native --results "$RESULTS_BROKEN" \
  > "$W/broken.out" 2>&1
rc_broken=$?
set -e
check "a mode that fails before telemetry makes the script exit non-zero" "[ $rc_broken -ne 0 ]"
check "telemetry.json was never written for the broken mode" "[ ! -e '$RESULTS_BROKEN/native/telemetry.json' ]"
check "comparison.md was still written instead of crashing" "[ -f '$RESULTS_BROKEN/comparison.md' ]"
COMPARISON_BROKEN="$(cat "$RESULTS_BROKEN/comparison.md")"
contains "comparison table still has a native row" "| native |" "$COMPARISON_BROKEN"
contains "comparison table shows n/a values and must_run=not-run for the missing-telemetry mode" \
  "| native | gpt-6-astra | n/a | n/a | n/a | n/a | n/a | n/a | not-run |" "$COMPARISON_BROKEN"

summary
