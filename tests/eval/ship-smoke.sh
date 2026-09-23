#!/usr/bin/env bash
# ship-smoke — measures one small Codex wave run two ways (the orchestrator
# driving the wave natively vs. through codex-wave-runner.mjs) and compares
# wall time, orchestrator cost and correctness via the telemetry analyzer.
#
# Usage: bash tests/eval/ship-smoke.sh --mode native|runner|both
#          [--orchestrator gpt-6-sol] [--effort high] --results DIR
#
# Builds a disposable repo with a local bare origin and a lint-clean two-task
# Codex wave plan (add-guard / add-doc, supervisor gpt-6-astra/high), runs
# one Codex orchestrator session per requested mode (WITHOUT --ephemeral, so
# its rollout persists), finds that session's root rollout under
# ~/.codex/sessions by its `thread.started` id, and hands it to
# tests/eval/telemetry/telemetry.mjs. Writes <results>/<mode>/telemetry.json
# per mode and one <results>/comparison.md table. Never calls a model itself;
# it only launches `codex exec` and reads its own persisted evidence.
#
# --results is part of the evidence contract, not a cache: it must be absent
# or empty, else this exits 73 without touching it.
#
# Testing hooks (offline; see ship-smoke.test.sh):
#   SHIP_SMOKE_CODEX_BIN         codex executable to invoke (default "codex",
#                                 resolved on PATH — a test prepends a stub)
#   SHIP_SMOKE_CODEX_SESSIONS_DIR  where the root rollout is searched for
#                                 (default ${CODEX_HOME:-~/.codex}/sessions)
#   SHIP_SMOKE_RUNNER_SUMMARY    override the runner's summary.json path
#                                 (default <repo>/.worktrees/codex-runner/
#                                 1-<base12>/summary.json, the runner's own
#                                 default --out)
#   SHIP_SMOKE_TIMEOUT           per-orchestrator-session timeout, seconds
#                                 (default 1800)
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
ROOT="$(pwd)"

SKILL_DIR="$ROOT/plugins/orchestration/skills/multi-model"
PROTOCOL="$SKILL_DIR/references/codex-wave-protocol.md"
RUNNER="$SKILL_DIR/references/codex-wave-runner.mjs"
STATE_HELPER="$SKILL_DIR/references/codex-wave-state.mjs"
LINTER="$ROOT/plugins/orchestration/skills/super-plan/references/plan-lint.mjs"
TELEMETRY="$ROOT/tests/eval/telemetry/telemetry.mjs"
PRICES="$ROOT/tests/eval/telemetry/prices.json"

usage() {
  cat <<'USAGE'
Usage: bash tests/eval/ship-smoke.sh --mode native|runner|both
         [--orchestrator gpt-6-sol] [--effort high] --results DIR

Measures one small Codex wave run two ways — the orchestrator executing the
wave with the native spawn_agent/wait_agent action loop vs. driving it
through codex-wave-runner.mjs — and compares wall time, orchestrator cost
and whether the merged result passes the fixture's must_run, via
tests/eval/telemetry/telemetry.mjs. --mode both runs one instance of each,
each against its own fresh fixture repo.

--results is part of the evidence contract, not a cache: it must be an
absent or empty directory, else this exits 73 without touching it.
USAGE
}

MODE="" ORCHESTRATOR="gpt-6-sol" EFFORT="high" RESULTS=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --orchestrator) ORCHESTRATOR="$2"; shift 2 ;;
    --effort) EFFORT="$2"; shift 2 ;;
    --results) RESULTS="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'ship-smoke: unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$MODE" in
  native|runner|both) ;;
  '') printf 'ship-smoke: --mode is required\n' >&2; usage >&2; exit 2 ;;
  *) printf 'ship-smoke: --mode must be native, runner or both: %s\n' "$MODE" >&2; usage >&2; exit 2 ;;
esac
if [ -z "$RESULTS" ]; then
  printf 'ship-smoke: --results is required\n' >&2; usage >&2; exit 2
fi

results_dir_is_fresh() {
  local directory="$1"
  [ ! -e "$directory" ] || {
    [ -d "$directory" ] && [ -z "$(find "$directory" -mindepth 1 -print -quit)" ]
  }
}
if ! results_dir_is_fresh "$RESULTS"; then
  printf 'ship-smoke: --results must be an absent or empty directory: %s\n' "$RESULTS" >&2
  exit 73
fi
mkdir -p "$RESULTS" || exit 1

CODEX_BIN="${SHIP_SMOKE_CODEX_BIN:-codex}"
if ! command -v "$CODEX_BIN" >/dev/null 2>&1; then
  printf 'ship-smoke: codex executable unavailable: %s\n' "$CODEX_BIN" >&2
  exit 69
fi
CODEX_BIN="$(command -v "$CODEX_BIN")"
SESSIONS_DIR="${SHIP_SMOKE_CODEX_SESSIONS_DIR:-${CODEX_HOME:-$HOME/.codex}/sessions}"
TIMEOUT="${SHIP_SMOKE_TIMEOUT:-1800}"

# ---------------------------------------------------------------------------
# Fixture: a disposable repo with a local bare origin and a lint-clean
# two-task wave plan (divide-guard style: base has working code and a test
# file the executor may not touch; the guard/doc are each a small, separate
# change).

build_fixture() { # work-dir -> sets REPO, BASE, PLAN
  local work="$1"
  REPO="$work/repo"
  mkdir -p "$REPO/src" "$REPO/tests" "$REPO/docs"
  printf '.worktrees/\n__pycache__/\n*.pyc\n' > "$REPO/.gitignore"
  printf 'def divide(a, b):\n    return a / b\n' > "$REPO/src/calc.py"
  touch "$REPO/src/__init__.py" "$REPO/tests/__init__.py"
  cat > "$REPO/tests/test_calc.py" <<'PY'
import unittest
from src.calc import divide

class CalcTest(unittest.TestCase):
    def test_divide(self):
        self.assertEqual(divide(6, 3), 2)

    def test_divide_by_zero_returns_none(self):
        self.assertIsNone(divide(1, 0))
PY
  : > "$REPO/docs/.gitkeep"
  PLAN="$REPO/plan.md"
  cat > "$PLAN" <<'MD'
status: draft
base: pending

# Plan — ship-smoke wave

```json wave-plan
{ "waves": [
  { "wave": 1,
    "supervisor": { "model": "gpt-6-astra", "effort": "high" },
    "tasks": [
      { "id": "add-guard",
        "branch": "wave/add-guard",
        "executor": { "model": "gpt-6-luna", "effort": "medium" },
        "ladder": ["gpt-6-sol"],
        "contract": {
          "files_allowed": ["src/**"],
          "files_forbidden": ["tests/**"],
          "must_run": [{ "cmd": "python3 -m unittest discover -s tests -t .", "evidence": "required" }],
          "forbidden_moves": ["weakening, deleting or skipping an existing test"],
          "report_must_answer": ["How is division by zero handled?"] } },
      { "id": "add-doc",
        "branch": "wave/add-doc",
        "executor": { "model": "gpt-6-sol", "effort": "medium" },
        "contract": {
          "files_allowed": ["docs/**"],
          "files_forbidden": ["src/**", "tests/**"],
          "must_run": [{ "cmd": "test -s docs/NOTE.md", "evidence": "required" }],
          "forbidden_moves": [],
          "report_must_answer": ["What does the note explain?"] } }
    ] }
] }
```

## Task add-guard

Add a guard for division by zero in `src/calc.py` without modifying the
tests.

## Task add-doc

Write a short `docs/NOTE.md` describing the division-by-zero guard.
MD
  git -C "$REPO" init -q
  git -C "$REPO" symbolic-ref HEAD refs/heads/master
  git -C "$REPO" config user.name 'ship-smoke fixture'
  git -C "$REPO" config user.email 'ship-smoke@example.invalid'
  git -C "$REPO" add -A
  git -C "$REPO" commit -q -m base
  BASE="$(git -C "$REPO" rev-parse HEAD)"
  git init -q --bare "$work/origin.git"
  git -C "$REPO" remote add origin "$work/origin.git"
  git -C "$REPO" push -q origin HEAD:master
}

# ---------------------------------------------------------------------------
# Orchestrator prompts

build_prompt() { # mode repo plan base
  local mode="$1" repo="$2" plan="$3" base="$4"
  cat <<PROMPT
# Task: ship-smoke wave 1

You are the Codex orchestrator for one supervised wave, run directly against
this repository (already checked out at \`$repo\`, base commit \`$base\`
pushed to \`origin\` as the tip of \`master\`).

## Plan

The wave plan is at \`$plan\`. Read it before acting. Run wave 1 (two
independent tasks: add-guard, add-doc; supervisor gpt-6-astra/high).

## Protocol

Follow the Codex-native supervised wave protocol at:
  $PROTOCOL
The state helper is at:
  $STATE_HELPER
The plan linter is at:
  $LINTER

Step 1: lint the plan against this repository before touching anything:
  node $LINTER $plan --repo $repo
Stop on any linter error; do not repair the plan by hand.
PROMPT
  if [ "$mode" = native ]; then
    cat <<'PROMPT'

## Execution: native action loop

Use the protocol's "Commands and action loop" section: init the wave state,
then call `next` and perform exactly its one returned action in a loop,
using `spawn_agent`/`wait_agent`/`followup_task` for every executor and
supervisor child, until every task is merge-ready or stopped. Do NOT launch
codex-wave-runner.mjs for this run — that is a separate benchmark mode.
PROMPT
  else
    cat <<PROMPT

## Execution: deterministic runner

Use the protocol's "Default: the deterministic runner" section. Launch:
  node $RUNNER --plan $plan --wave 1 --repo $repo --base $base
as a background command and wait for it with long waits — it does its own
internal polling of its Codex children; do not also poll it yourself. When
it finishes, read only its \`summary.json\` (its default --out directory is
\`<repo>/.worktrees/codex-runner/1-<first 12 hex of base>\`) — never its
internal state files, worktrees, or child transcripts.
PROMPT
  fi
  cat <<'PROMPT'

## Finishing

On merge-ready, confirm every task is `ok` and merge every `ok` branch into
`master` yourself, in plan/task order, with:
  git merge --no-ff -m "wave 1 merge" wave/<task-id>
This is a local-only fixture: do not push to `origin`. For any task that
stopped instead, report its verdict and branch name; do not merge it and do
not retry outside the protocol.

When finished, print one final line: `WAVE DONE: <status>`, where <status>
is `merge-ready` if every task merged or `stopped` otherwise.

## Dead-end protocol

If spawn_agent or wait_agent is unavailable, stop and print
`WAVE DONE: tool-unavailable` — do not simulate the missing tool or fall
back silently.
PROMPT
}

# ---------------------------------------------------------------------------
# Orchestrator session, rollout lookup, telemetry

run_orchestrator() { # mode repo plan base out-dir -> sets ORCH_RC, ORCH_JSON_LOG
  local mode="$1" repo="$2" plan="$3" base="$4" out="$5"
  local prompt_file="$out/orchestrator.prompt.md"
  build_prompt "$mode" "$repo" "$plan" "$base" > "$prompt_file"
  ORCH_JSON_LOG="$out/orchestrator.jsonl"
  # danger-full-access, not workspace-write: Codex's workspace-write sandbox
  # refuses writes under .git (e.g. creating refs/heads/wave/<task> or a
  # worktree's index lock), which real Conductor sessions never hit because
  # they run Codex with full access. This mirrors that. It only ever targets
  # the disposable fixture repo this script builds under a mktemp workdir.
  if timeout "$TIMEOUT" "$CODEX_BIN" exec --json --skip-git-repo-check -C "$repo" \
      --sandbox danger-full-access --model "$ORCHESTRATOR" \
      -c "model_reasoning_effort=\"$EFFORT\"" - < "$prompt_file" \
      > "$ORCH_JSON_LOG" 2> "$out/orchestrator.stderr"; then
    ORCH_RC=0
  else
    ORCH_RC=$?
  fi
}

extract_thread_id() { # json-log
  python3 - "$1" <<'PY'
import json, sys
path = sys.argv[1]
try:
    stream = open(path, encoding="utf-8")
except OSError:
    sys.exit(1)
with stream:
    for line in stream:
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict) or event.get("type") != "thread.started":
            continue
        tid = event.get("thread_id")
        if not tid and isinstance(event.get("thread"), dict):
            tid = event["thread"].get("id")
        if tid:
            print(tid)
            sys.exit(0)
sys.exit(1)
PY
}

find_rollout() { # sessions-dir thread-id
  node - "$1" "$2" <<'JS'
import { discoverRolloutFiles, parseRollout, sessionMeta, sessionId } from './tests/eval/telemetry/codex.mjs'
const [sessionsDir, threadId] = process.argv.slice(2)
let found = null
for (const path of discoverRolloutFiles(sessionsDir)) {
  let rows
  try { rows = parseRollout(path) } catch { continue }
  const meta = sessionMeta(rows)
  if (!meta) continue
  if (sessionId(meta) === threadId) { found = path; break }
}
if (!found) {
  process.stderr.write('ship-smoke: no rollout found for thread ' + threadId + ' under ' + sessionsDir + '\n')
  process.exit(1)
}
process.stdout.write(found + '\n')
JS
}

run_telemetry() { # root-rollout sessions-dir out-json
  node "$TELEMETRY" codex --root "$1" --sessions "$2" --json > "$3"
}

# For runner mode, fold the runner's own summary.json children (executor and
# supervisor codex-exec calls it made directly, never seen as Codex child
# rollouts since the runner — not the orchestrator — spawned them) into the
# telemetry report as extra rows, priced the same way telemetry.mjs prices
# every other row.
merge_runner_summary() { # telemetry-json summary-json out-json
  node - "$1" "$2" "$PRICES" "$3" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs'
const [reportPath, summaryPath, pricesPath, outPath] = process.argv.slice(2)
const report = JSON.parse(readFileSync(reportPath, 'utf8'))
let summary = null
try { summary = JSON.parse(readFileSync(summaryPath, 'utf8')) } catch { summary = null }
const round = (n, places = 6) => { const f = 10 ** places; return Math.round(n * f) / f }
if (summary && Array.isArray(summary.children)) {
  let prices = {}
  try { prices = JSON.parse(readFileSync(pricesPath, 'utf8')) } catch { prices = {} }
  for (const child of summary.children) {
    const usage = child.usage || {}
    const tokens = {
      input: usage.input_tokens || 0,
      cachedInput: usage.cached_input_tokens || 0,
      output: usage.output_tokens || 0,
      reasoningOutput: usage.reasoning_output_tokens || 0,
    }
    tokens.total = tokens.input + tokens.cachedInput + tokens.output + tokens.reasoningOutput
    const wallMinutes = round((child.seconds || 0) / 60, 4)
    report.children.push({
      id: `${child.task}-${child.role}-${child.attempt}`,
      agentPath: null,
      role: child.role,
      model: child.model,
      effort: child.effort,
      wallMinutes,
      requests: null,
      tokens,
      modelMinutes: wallMinutes,
      toolMinutes: 0,
      source: 'runner-summary',
    })
    const p = Array.isArray(prices[child.model]) && prices[child.model].length === 3 ? prices[child.model] : null
    if (!p) {
      report.cost.unpriced.push({ role: child.role, model: child.model, tokens })
      continue
    }
    const [inputPrice, cachedPrice, outputPrice] = p
    const cost = tokens.input / 1e6 * inputPrice + tokens.cachedInput / 1e6 * cachedPrice
      + (tokens.output + tokens.reasoningOutput) / 1e6 * outputPrice
    let group = report.cost.byRoleModel.find(g => g.role === child.role && g.model === child.model)
    if (!group) {
      group = { role: child.role, model: child.model,
        tokens: { input: 0, cachedInput: 0, output: 0, reasoningOutput: 0, total: 0 }, cost: 0 }
      report.cost.byRoleModel.push(group)
    }
    group.tokens.input += tokens.input
    group.tokens.cachedInput += tokens.cachedInput
    group.tokens.output += tokens.output
    group.tokens.reasoningOutput += tokens.reasoningOutput
    group.tokens.total += tokens.total
    group.cost = round(group.cost + cost)
    report.cost.total = round(report.cost.total + cost)
  }
  report.runnerStatus = summary.status ?? null
  report.runnerWallSeconds = summary.wallSeconds ?? null
}
writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n')
JS
}

check_must_run() { # repo plan -> prints true/false
  python3 - "$1" "$2" <<'PY'
import json, re, subprocess, sys
repo, plan_path = sys.argv[1], sys.argv[2]
text = open(plan_path, encoding="utf-8").read()
m = re.search(r"```json wave-plan\r?\n([\s\S]*?)\r?\n```", text)
if not m:
    print("false")
    sys.exit()
plan = json.loads(m.group(1))
ok = True
for wave in plan.get("waves", []):
    for task in wave.get("tasks", []):
        for check in task.get("contract", {}).get("must_run", []):
            proc = subprocess.run(["bash", "-c", check["cmd"]], cwd=repo,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if proc.returncode != 0:
                ok = False
print("true" if ok else "false")
PY
}

# ---------------------------------------------------------------------------
# One mode's run

run_one_mode() { # mode
  local mode="$1"
  local mode_dir="$RESULTS/$mode" work repo base plan rc=0 thread_id rollout
  mkdir -p "$mode_dir"
  work="$(mktemp -d)"
  build_fixture "$work"
  repo="$REPO"; base="$BASE"; plan="$PLAN"
  printf '%s\n' "$repo" > "$mode_dir/repo-path.txt"
  cp "$plan" "$mode_dir/plan.md"

  run_orchestrator "$mode" "$repo" "$plan" "$base" "$mode_dir"
  printf '%s\n' "$ORCH_RC" > "$mode_dir/orchestrator.exit"
  [ "$ORCH_RC" -eq 0 ] || rc=1

  if ! thread_id="$(extract_thread_id "$ORCH_JSON_LOG")"; then
    printf 'ship-smoke: %s: no thread.started event in orchestrator output\n' "$mode" >&2
    return 1
  fi
  printf '%s\n' "$thread_id" > "$mode_dir/thread-id.txt"

  if ! rollout="$(find_rollout "$SESSIONS_DIR" "$thread_id")"; then
    return 1
  fi
  printf '%s\n' "$rollout" > "$mode_dir/rollout-path.txt"

  run_telemetry "$rollout" "$SESSIONS_DIR" "$mode_dir/telemetry.json"

  if [ "$mode" = runner ]; then
    local summary_path="${SHIP_SMOKE_RUNNER_SUMMARY:-$repo/.worktrees/codex-runner/1-${base:0:12}/summary.json}"
    if [ -f "$summary_path" ]; then
      cp "$summary_path" "$mode_dir/runner-summary.json"
      merge_runner_summary "$mode_dir/telemetry.json" "$summary_path" "$mode_dir/telemetry.json.tmp" \
        && mv "$mode_dir/telemetry.json.tmp" "$mode_dir/telemetry.json"
    else
      printf 'ship-smoke: runner mode: no summary.json at %s\n' "$summary_path" >&2
      rc=1
    fi
  fi

  check_must_run "$repo" "$plan" > "$mode_dir/must_run.txt"
  [ "$(cat "$mode_dir/must_run.txt")" = true ] || rc=1
  return "$rc"
}

# ---------------------------------------------------------------------------
# Comparison table

write_comparison() { # results-dir mode...
  python3 - "$@" <<'PY'
import json, os, sys

results_dir = sys.argv[1]
modes = sys.argv[2:]

def orchestrator_input_tokens(report):
    for g in report["cost"]["byRoleModel"] + report["cost"]["unpriced"]:
        if g["role"] == "orchestrator":
            return g["tokens"]["input"]
    return None

rows = []
had_missing = False
for mode in modes:
    telemetry_path = os.path.join(results_dir, mode, "telemetry.json")
    must_run_path = os.path.join(results_dir, mode, "must_run.txt")
    if not os.path.exists(telemetry_path):
        had_missing = True
        rows.append({
            "mode": mode,
            "wall_minutes": "n/a",
            "orch_model_minutes": "n/a",
            "orch_model_share": "n/a",
            "orch_requests": "n/a",
            "orch_input_tokens": "n/a",
            "total_cost": "n/a",
            "must_run": "not-run",
        })
        continue
    with open(telemetry_path, encoding="utf-8") as f:
        report = json.load(f)
    must_run = "pass"
    if os.path.exists(must_run_path):
        must_run = "pass" if open(must_run_path, encoding="utf-8").read().strip() == "true" else "fail"
    orch = report["orchestrator"]
    orch_minutes = orch.get("minutes", {})
    wall_minutes = sum(orch_minutes.values())
    orch_model_minutes = orch_minutes.get("model", 0)
    share = (orch_model_minutes / wall_minutes) if wall_minutes else 0.0
    rows.append({
        "mode": mode,
        "wall_minutes": round(wall_minutes, 4),
        "orch_model_minutes": round(orch_model_minutes, 4),
        "orch_model_share": share,
        "orch_requests": orch.get("requests"),
        "orch_input_tokens": orchestrator_input_tokens(report),
        "total_cost": report["cost"]["total"],
        "must_run": must_run,
    })

lines = ["# ship-smoke comparison", ""]
lines.append("| mode | wall (min) | orchestrator model (min) | orchestrator share of wall "
              "| orchestrator requests | orchestrator input tokens | total cost ($) | must_run |")
lines.append("| --- | --- | --- | --- | --- | --- | --- | --- |")
for r in rows:
    if r["must_run"] == "not-run":
        lines.append("| {mode} | n/a | n/a | n/a | n/a | n/a | n/a | not-run |".format(mode=r["mode"]))
        continue
    lines.append(
        "| {mode} | {wall_minutes} | {orch_model_minutes} | {share:.1%} | {orch_requests} "
        "| {orch_input_tokens} | {total_cost} | {must_run} |".format(
            mode=r["mode"], wall_minutes=r["wall_minutes"], orch_model_minutes=r["orch_model_minutes"],
            share=r["orch_model_share"], orch_requests=r["orch_requests"],
            orch_input_tokens=r["orch_input_tokens"], total_cost=r["total_cost"], must_run=r["must_run"]))
lines.append("")
text = "\n".join(lines)
with open(os.path.join(results_dir, "comparison.md"), "w", encoding="utf-8") as f:
    f.write(text)
sys.stdout.write(text)
sys.exit(1 if had_missing else 0)
PY
}

# ---------------------------------------------------------------------------
# Main

MODES=()
case "$MODE" in
  native) MODES=(native) ;;
  runner) MODES=(runner) ;;
  both) MODES=(native runner) ;;
esac

OVERALL_RC=0
for m in "${MODES[@]}"; do
  run_one_mode "$m" || OVERALL_RC=1
done

write_comparison "$RESULTS" "${MODES[@]}" || OVERALL_RC=1
printf '\n\nresults: %s\n' "$RESULTS"

exit "$OVERALL_RC"
