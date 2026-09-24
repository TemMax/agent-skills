#!/usr/bin/env bash
# Tier 3 wave probe. Claude retains the shipped Workflow boundary. Codex now
# drives the deterministic, helper-governed codex-wave-runner.mjs (no
# orchestrator model session at all) instead of a live spawn_agent/wait
# orchestrator turn. classify_codex_events/classify_codex remain in this file
# as the native-protocol classifier for Codex <=0.153.4 event streams (still
# self-tested below as a documented fallback) but are no longer on the live
# codex_probe path; classify_runner is what scores the live runner-driven
# path now.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh
. tests/test-env.sh
. tests/eval/model-cli.sh

ROOT="$PWD"
CODEX_STATE="$ROOT/plugins/orchestration/skills/multi-model/references/codex-wave-state.mjs"
CODEX_RUNNER="$ROOT/plugins/orchestration/skills/multi-model/references/codex-wave-runner.mjs"
CODEX_PROTOCOL="$ROOT/plugins/orchestration/skills/multi-model/references/codex-wave-protocol.md"
MULTI_SKILL="$ROOT/plugins/orchestration/skills/multi-model/SKILL.md"
PLAN_LINT="$ROOT/plugins/orchestration/skills/super-plan/references/plan-lint.mjs"

find_state() {
  local repo="$1" candidate found='' count=0
  for candidate in "$repo"/.worktrees/codex-wave/*.json; do
    if [ -f "$candidate" ]; then
      found="$candidate"
      count=$((count + 1))
    fi
  done
  [ "$count" -eq 1 ] || return 1
  printf '%s' "$found"
}

make_failure_plan() { # clean-plan output
  python3 - "$1" "$2" <<'PY'
import sys

source, output = sys.argv[1:]
with open(source, encoding="utf-8") as stream:
    text = stream.read()
old = '"must_run": [{ "cmd": "python3 -m unittest discover -s tests -t .", "evidence": "required" }]'
new = '"must_run": [{ "cmd": "python3 -m unittest discover -s tests -t .", "evidence": "required" }, { "cmd": "python3 -c \\"import sys; print(\'independent verifier red\'); sys.exit(1)\\"", "evidence": "required" }]'
assert text.count(old) == 1
with open(output, "w", encoding="utf-8") as stream:
    stream.write(text.replace(old, new))
PY
}

# Adds the plan-lint required top-level keys (ci, e2e and, when a premium
# model — claude-fable-5-1 or gpt-6-astra — appears as any wave's
# supervisor/executor/ladder model, approvals.premium) into the fenced
# ```json wave-plan``` block of a plan.md this harness generates. These
# fixture repos carry no .github/workflows and exercise the harness itself,
# not a separate e2e suite, so ci/e2e are always the "none"/"not-applicable"
# forms; approvals.premium is added only when it applies.
inject_plan_lint_fields() { # plan-file
  python3 - "$1" <<'PY'
import json
import re
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as stream:
    text = stream.read()
match = re.search(r"```json wave-plan\r?\n([\s\S]*?)\r?\n```", text)
assert match, "no fenced wave-plan JSON block found"
plan = json.loads(match.group(1))

premium_ids = {"claude-fable-5-1", "gpt-6-astra"}
found = set()
for wave in plan.get("waves", []):
    supervisor = wave.get("supervisor") or {}
    if supervisor.get("model") in premium_ids:
        found.add(supervisor["model"])
    for task in wave.get("tasks", []):
        executor = task.get("executor") or {}
        if executor.get("model") in premium_ids:
            found.add(executor["model"])
        for ladder_model in task.get("ladder") or []:
            if ladder_model in premium_ids:
                found.add(ladder_model)

plan["ci"] = "none: disposable fixture repository without CI"
plan["e2e"] = "not-applicable: fixture plan exercises the harness"
if found:
    plan["approvals"] = {
        "premium": {
            "models": sorted(found),
            "reason": "premium model used in this fixture wave",
            "approved_by": "harness",
            "date": "2026-09-24",
        }
    }

new_block = json.dumps(plan, indent=2)
new_text = text[:match.start(1)] + new_block + text[match.end(1):]
with open(path, "w", encoding="utf-8") as stream:
    stream.write(new_text)
PY
}

file_sha256() {
  python3 - "$1" <<'PY'
import hashlib, sys
print(hashlib.sha256(open(sys.argv[1], 'rb').read()).hexdigest())
PY
}

publish_diagnostic_jsonl() { # destination; authentic diagnostic bytes on stdin
  python3 /dev/fd/3 "$1" 3<<'PY'
import os
import secrets
import stat
import sys

target = sys.argv[1]
directory = os.path.dirname(target) or "."
name = os.path.basename(target)
limit = 64 * 1024 * 1024
directory_fd = None
temporary_fd = None
temporary_name = None

def abort(message):
    print(f"diagnostic publish failed: {message}", file=sys.stderr)
    raise SystemExit(74)

if name in {"", ".", ".."}:
    abort("unsupported destination")

try:
    directory_flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) \
        | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    directory_fd = os.open(directory, directory_flags)
    if not stat.S_ISDIR(os.fstat(directory_fd).st_mode):
        abort("destination parent is not a directory")
    try:
        destination_mode = os.stat(name, dir_fd=directory_fd, follow_symlinks=False).st_mode
    except FileNotFoundError:
        destination_mode = None
    if destination_mode is not None and not any(check(destination_mode) for check in (
            stat.S_ISREG, stat.S_ISLNK, stat.S_ISFIFO)):
        abort("unsupported existing destination type")

    payload = sys.stdin.buffer.read(limit + 1)
    if len(payload) > limit:
        abort("diagnostic exceeds 64 MiB limit")

    for _ in range(128):
        candidate = f".{name}.{secrets.token_hex(16)}.tmp"
        try:
            temporary_fd = os.open(
                candidate,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0)
                | getattr(os, "O_NOFOLLOW", 0),
                0o600,
                dir_fd=directory_fd,
            )
            temporary_name = candidate
            break
        except FileExistsError:
            continue
    if temporary_fd is None:
        abort("could not create a private temporary file")
    if not stat.S_ISREG(os.fstat(temporary_fd).st_mode):
        abort("temporary destination is not a regular file")

    view = memoryview(payload)
    while view:
        written = os.write(temporary_fd, view)
        if written <= 0:
            abort("short write")
        view = view[written:]
    os.close(temporary_fd)
    temporary_fd = None
    os.replace(temporary_name, name, src_dir_fd=directory_fd, dst_dir_fd=directory_fd)
    temporary_name = None
except SystemExit:
    raise
except (OSError, ValueError) as error:
    abort(str(error))
finally:
    if temporary_fd is not None:
        try:
            os.close(temporary_fd)
        except OSError:
            pass
    if temporary_name is not None and directory_fd is not None:
        try:
            os.unlink(temporary_name, dir_fd=directory_fd)
        except OSError:
            pass
    if directory_fd is not None:
        try:
            os.close(directory_fd)
        except OSError:
            pass
PY
}

capture_codex_evidence() { # expected repo base answer-source codex-jsonl-source cell
  local expected="$1" repo="$2" base="$3" answer_source="$4" event_source="$5" cell="$6"
  local evidence event_json='' state='' candidate state_count=0 before copy_hash after summary_rc wt rc
  evidence="$cell/evidence"
  mkdir -p "$evidence"
  if [ -f "$answer_source" ]; then
    command cp "$answer_source" "$evidence/final-answer.txt"
  else
    : > "$evidence/final-answer.txt"
  fi
  if [ "$event_source" = - ]; then
    event_json="$(cat)"
    if [ -n "$event_json" ]; then
      printf '%s\n' "$event_json" | publish_diagnostic_jsonl \
        "$evidence/codex-exec-events.jsonl" || return 74
    else
      : | publish_diagnostic_jsonl "$evidence/codex-exec-events.jsonl" || return 74
    fi
  elif [ -f "$event_source" ]; then
    publish_diagnostic_jsonl "$evidence/codex-exec-events.jsonl" < "$event_source" || return 74
  else
    : | publish_diagnostic_jsonl "$evidence/codex-exec-events.jsonl" || return 74
  fi
  printf '%s\n' "$expected" > "$evidence/expected.txt"
  printf '%s\n' "$base" > "$evidence/base.txt"
  printf '%s\n' "$repo" > "$evidence/repo.txt"

  for candidate in "$repo"/.worktrees/codex-wave/*.json; do
    if [ -f "$candidate" ]; then
      state="$candidate"
      state_count=$((state_count + 1))
    fi
  done
  printf '%s\n' "$state_count" > "$evidence/state-count.txt"
  if [ "$state_count" -eq 1 ]; then
    before="$(file_sha256 "$state")"
    command cp "$state" "$evidence/state.json"
    copy_hash="$(file_sha256 "$evidence/state.json")"
    if node "$CODEX_STATE" summary --state "$state" \
      > "$evidence/helper-summary.stdout" 2> "$evidence/helper-summary.stderr"; then
      summary_rc=0
    else
      summary_rc=$?
    fi
    after="$(file_sha256 "$state")"
    printf 'before=%s\ncopy=%s\nafter=%s\n' "$before" "$copy_hash" "$after" \
      > "$evidence/state-hashes.txt"
    printf '%s\n' "$summary_rc" > "$evidence/helper-summary.status"
    printf '%s\n' "$state" > "$evidence/canonical-state-path.txt"
  else
    printf '1\n' > "$evidence/helper-summary.status"
    printf 'canonical state count: %s\n' "$state_count" > "$evidence/helper-summary.stderr"
  fi
  [ -f "$repo/plan.md" ] && command cp "$repo/plan.md" "$evidence/plan.md"
  command cp "$ROOT/plugins/orchestration/skills/multi-model/references/supervisor-prompt.md" \
    "$evidence/supervisor-prompt.md"

  wt="$repo/.worktrees/wave-divide-guard"
  if git -C "$repo" rev-parse master > "$evidence/default-head.txt" 2> "$evidence/default-head.stderr"; then
    rc=0
  else
    rc=$?
  fi
  printf '%s\n' "$rc" > "$evidence/default-head.status"
  if git --git-dir="$repo/.eval/origin.git" rev-parse refs/heads/master \
    > "$evidence/origin-head.txt" 2> "$evidence/origin-head.stderr"; then
    rc=0
  else
    rc=$?
  fi
  printf '%s\n' "$rc" > "$evidence/origin-head.status"
  if git -C "$wt" branch --show-current > "$evidence/task-branch.txt" 2> "$evidence/task-branch.stderr"; then
    rc=0
  else
    rc=$?
  fi
  printf '%s\n' "$rc" > "$evidence/task-branch.status"
  if git -C "$wt" rev-parse HEAD > "$evidence/task-head.txt" 2> "$evidence/task-head.stderr"; then
    rc=0
  else
    rc=$?
  fi
  printf '%s\n' "$rc" > "$evidence/task-head.status"
  if git -C "$repo" merge-base --is-ancestor wave/divide-guard master \
    > "$evidence/task-merged.stdout" 2> "$evidence/task-merged.stderr"; then
    rc=0
  else
    rc=$?
  fi
  printf '%s\n' "$rc" > "$evidence/task-merged.status"
  if git -C "$wt" merge-base --is-ancestor "$base" HEAD \
    > "$evidence/task-ancestor.stdout" 2> "$evidence/task-ancestor.stderr"; then
    rc=0
  else
    rc=$?
  fi
  printf '%s\n' "$rc" > "$evidence/task-ancestor.status"
  if (cd "$wt" && python3 -m unittest discover -s tests -t .) \
    > "$evidence/fresh-must-run.stdout" 2> "$evidence/fresh-must-run.stderr"; then
    rc=0
  else
    rc=$?
  fi
  printf '%s\n' "$rc" > "$evidence/fresh-must-run.status"
  if [ "$expected" = failure ]; then
    if (cd "$wt" && python3 -c "import sys; print('independent verifier red'); sys.exit(1)") \
      > "$evidence/fresh-independent.stdout" 2> "$evidence/fresh-independent.stderr"; then
      rc=0
    else
      rc=$?
    fi
    printf '%s\n' "$rc" > "$evidence/fresh-independent.status"
  fi
}

# Native-protocol classifier for Codex <=0.153.4 `exec --json` event streams
# (spawn_agent/wait collab items). Codex CLI 0.155.1 no longer emits
# spawn_agent items, so this classifier can no longer verify a live run; it
# is kept, with its self-test cases below, purely as a documented fallback
# for older Codex builds. It is not called from codex_probe any more —
# classify_runner (further down) scores the live, deterministic-runner path.
classify_codex_events() { # caller-owned-codex-jsonl
  python3 /dev/fd/3 "$1" 3<<'PY'
import json
import re
import sys

path = sys.argv[1]

def fail(reason="unverified-native-actions"):
    print("fail:" + reason)
    raise SystemExit

try:
    if path == "-":
        raw_lines = [line for line in sys.stdin if line.strip()]
    else:
        with open(path, encoding="utf-8") as stream:
            raw_lines = [line for line in stream if line.strip()]
    if not raw_lines:
        fail()
    events = [json.loads(line) for line in raw_lines]
    if not all(isinstance(event, dict) for event in events):
        fail()
except (OSError, UnicodeError, json.JSONDecodeError):
    fail()

collab = []
for event in events:
    if event.get("type") != "item.completed":
        continue
    item = event.get("item")
    if not isinstance(item, dict):
        continue
    if item.get("type") == "command_execution":
        command = item.get("command")
        if isinstance(command, str) and re.search(r"(?:^|[\s/])(claude|Workflow)(?:\s|$)", command, re.I):
            fail("claude-workflow-in-codex-events")
    if item.get("type") == "collab_tool_call":
        collab.append(item)

if len(collab) != 4 or [item.get("tool") for item in collab] != [
        "spawn_agent", "wait", "spawn_agent", "wait"]:
    fail()
if any(item.get("status") != "completed" for item in collab):
    fail()
if any(isinstance(item.get("prompt"), str)
       and re.search(r"\b(?:claude|Workflow)\b", item["prompt"], re.I)
       for item in collab):
    fail("claude-workflow-in-codex-events")

sender = collab[0].get("sender_thread_id")
if not isinstance(sender, str) or not sender \
        or any(item.get("sender_thread_id") != sender for item in collab):
    fail()

def one_receiver(item):
    receivers = item.get("receiver_thread_ids")
    if not isinstance(receivers, list) or len(receivers) != 1 \
            or not isinstance(receivers[0], str) or not receivers[0]:
        fail()
    return receivers[0]

executor = one_receiver(collab[0])
if one_receiver(collab[1]) != executor:
    fail()
supervisor = one_receiver(collab[2])
if one_receiver(collab[3]) != supervisor or supervisor == executor:
    fail()

executor_prompt = collab[0].get("prompt")
supervisor_prompt = collab[2].get("prompt")
approval_context = (
    "The user already approved this exact wave plan and task. Begin implementation immediately;\n"
    "do not request another design or approval. The dead-end rules below still apply.\n\n")
if not isinstance(executor_prompt, str) \
        or not executor_prompt.startswith("# Task: divide-guard\n") \
        or executor_prompt.count(approval_context) != 1 \
        or not all(heading in executor_prompt for heading in (
            "## Context", "## Workspace (already prepared)", "## Boundaries",
            "## Dead-end protocol", "## Prohibitions",
            "## Definition of done and report format",
            "## Contract (a supervisor will check every line against your branch)")):
    fail()
if not isinstance(supervisor_prompt, str) \
        or not supervisor_prompt.startswith("# Supervisor Prompt") \
        or "You are supervising one task produced by another agent." not in supervisor_prompt \
        or not all(label in supervisor_prompt for label in ("CONTRACT:", "VERIFIER FACTS:", "REPORT:")):
    fail()

def agent_status(item, receiver):
    states = item.get("agents_states")
    if not isinstance(states, dict) or set(states) != {receiver} \
            or not isinstance(states[receiver], dict):
        fail()
    return states[receiver].get("status")

if agent_status(collab[0], executor) not in {"pending_init", "running", "completed"} \
        or agent_status(collab[1], executor) != "completed" \
        or agent_status(collab[2], supervisor) not in {"pending_init", "running", "completed"} \
        or agent_status(collab[3], supervisor) != "completed":
    fail()
print("pass")
PY
}

eval_codex_json() { # real-codex repo sandbox prompt answer output-variable [new-rollout-directory]
  local real_codex="$1" repo="$2" sandbox="$3" prompt="$4" answer="$5" output_name="$6"
  local model="${EVAL_MODEL:-gpt-5.6-sol}" effort="${EVAL_EFFORT:-medium}"
  local limit="${EVAL_TIMEOUT:-600}" captured='' real_rc launch_cwd="$repo"
  local rollout_dir="${7:-}" rollout_rc=0
  local -a persistence=(--ephemeral) rollout_args=()
  case "${EVAL_CODEX_ROLLOUTS:-0}" in
    0) ;;
    1)
      [ -n "$rollout_dir" ] || return 2
      [ ! -e "$rollout_dir" ] && [ ! -L "$rollout_dir" ] || return 73
      [ -d "$(dirname "$rollout_dir")" ] || return 2
      persistence=()
      if [ -n "${EVAL_CODEX_SESSIONS_DIR:-}" ]; then
        rollout_args=(--sessions "$EVAL_CODEX_SESSIONS_DIR")
      fi
      ;;
    *) return 2 ;;
  esac
  [ -x "$real_codex" ] || return 69
  case "$sandbox" in read-only|workspace-write) ;; *) return 2 ;; esac
  if [ "$sandbox" = workspace-write ]; then launch_cwd="$(dirname "$repo")"; fi
  : > "$answer" || return
  if captured="$(cd "$launch_cwd" && timeout "$limit" "$real_codex" exec --json \
    ${persistence[@]+"${persistence[@]}"} --ignore-user-config --ignore-rules --skip-git-repo-check \
    --sandbox "$sandbox" --model "$model" \
    -c "model_reasoning_effort=\"$effort\"" --output-last-message "$answer" - < "$prompt")"; then
    real_rc=0
  else
    real_rc=$?
  fi
  if [ "${EVAL_CODEX_ROLLOUTS:-0}" = 1 ]; then
    # Same private stream as scoring, never a model-writable event-log path.
    # A saved report (even partial/unverified) is diagnostic, not a passing cell.
    if printf '%s\n' "$captured" | node "$ROOT/tests/eval/codex-rollouts.mjs" \
      --output "$rollout_dir" ${rollout_args[@]+"${rollout_args[@]}"} >/dev/null; then
      rollout_rc=0
    else
      rollout_rc=$?
    fi
  fi
  if [ -z "$captured" ] || ! printf '%s\n' "$captured" | python3 -c '
import json, sys
lines = [line for line in sys.stdin if line.strip()]
if not lines:
    raise SystemExit(1)
for line in lines:
    try:
        event = json.loads(line)
    except (TypeError, json.JSONDecodeError):
        raise SystemExit(1)
    if not isinstance(event, dict):
        raise SystemExit(1)
'; then
    printf -v "$output_name" '%s' ''
    return 74
  fi
  printf -v "$output_name" '%s' "$captured"
  [ "$real_rc" -ne 0 ] || [ "$rollout_rc" -eq 0 ] || return "$rollout_rc"
  return "$real_rc"
}

classify_codex() { # expected immutable-cell base [events-source|-]
  local expected="$1" cell="$2" base="$3" source="${4:-}" evidence answer events event_classification event_json state_count summary_status
  evidence="$cell/evidence"
  answer="$evidence/final-answer.txt"
  events="$evidence/codex-exec-events.jsonl"
  if [ ! -s "$answer" ]; then
    printf 'fail:empty-final-answer'
    return
  fi
  if [ "$source" = - ]; then
    event_json="$(cat)"
  else
    event_json="$(cat "$events" 2>/dev/null || true)"
  fi
  event_classification="$(printf '%s\n' "$event_json" | classify_codex_events -)"
  if [ "$event_classification" != pass ]; then
    if grep -qi 'tool-unavailable' "$answer" 2>/dev/null; then
      printf 'fail:tool-unavailable'
    else
      printf '%s' "$event_classification"
    fi
    return
  fi
  if grep -qi 'tool-unavailable' "$answer" 2>/dev/null; then
    printf 'fail:tool-unavailable'
    return
  fi
  state_count="$(tr -d '[:space:]' < "$evidence/state-count.txt" 2>/dev/null || true)"
  if [ "$state_count" = 0 ]; then
    printf 'fail:missing-codex-wave-state'
    return
  elif [ "$state_count" = 1 ]; then
    :
  elif printf '%s' "$state_count" | grep -Eq '^[2-9][0-9]*$'; then
    printf 'fail:multiple-codex-wave-states'
    return
  else
    printf 'fail:invalid-state-count-evidence'
    return
  fi
  if [ ! -s "$evidence/state.json" ]; then
    printf 'fail:missing-codex-wave-state'
    return
  fi
  summary_status="$(tr -d '[:space:]' < "$evidence/helper-summary.status" 2>/dev/null || true)"
  if [ "$summary_status" != 0 ]; then
    printf 'fail:invalid-helper-summary'
    return
  fi
  printf '%s\n' "$event_json" | python3 /dev/fd/3 "$expected" "$evidence" "$base" "${EVAL_MODEL:-gpt-5.6-sol}" 3<<'PY'
import hashlib
import json
import re
import sys
from pathlib import Path

expected, evidence_arg, base, orchestrator_model = sys.argv[1:]
evidence = Path(evidence_arg)

def text(name):
    return (evidence / name).read_text(encoding="utf-8")

def status(name):
    try:
        return int(text(name).strip())
    except (OSError, ValueError):
        return None

def fail(reason):
    print("fail:" + reason)
    raise SystemExit

try:
    hashes = dict(line.split("=", 1) for line in text("state-hashes.txt").splitlines())
    copied_bytes = (evidence / "state.json").read_bytes()
    copied_hash = hashlib.sha256(copied_bytes).hexdigest()
    if set(hashes) != {"before", "copy", "after"} \
            or len(set(hashes.values())) != 1 or hashes["copy"] != copied_hash:
        fail("state-changed-during-capture")
    state = json.loads(copied_bytes)
    summary = json.loads(text("helper-summary.stdout"))
    events = [json.loads(line) for line in sys.stdin.read().splitlines() if line.strip()]
    collab = [event["item"] for event in events
              if event.get("type") == "item.completed"
              and isinstance(event.get("item"), dict)
              and event["item"].get("type") == "collab_tool_call"]
    plan_text = text("plan.md")
    blocks = re.findall(r"```json wave-plan\r?\n([\s\S]*?)\r?\n```", plan_text)
    if len(blocks) != 1:
        fail("invalid-captured-state")
    plan = json.loads(blocks[0])
    wave = plan["waves"][0]
    plan_task = wave["tasks"][0]
    task = state["tasks"]["divide-guard"]
    if state.get("schema") != 1 or state.get("wave") != 1 or state.get("base") != base:
        fail("invalid-captured-state")
    if set(state.get("tasks", {})) != {"divide-guard"} or plan_task.get("id") != "divide-guard":
        fail("invalid-captured-state")
except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
    fail("invalid-captured-state")

executor_prompt = collab[0].get("prompt") if len(collab) == 4 else None
prose_match = re.search(
    r"^## Task divide-guard\r?\n([\s\S]*?)(?=\r?\n## |\Z)", plan_text, re.M)
task_prose = prose_match.group(1).strip() if prose_match else None
required_headings = [
    "## Context",
    "## Workspace (already prepared)",
    "## Boundaries",
    "## Dead-end protocol",
    "## Prohibitions",
    "## Definition of done and report format",
    "## Contract (a supervisor will check every line against your branch)",
]
prompt_contract = json.dumps(plan_task.get("contract"), indent=2, ensure_ascii=False)
approval_context = (
    "The user already approved this exact wave plan and task. Begin implementation immediately;\n"
    "do not request another design or approval. The dead-end rules below still apply.\n\n")
if not isinstance(executor_prompt, str) \
        or not executor_prompt.startswith("# Task: divide-guard\n\n## Context\n") \
        or task_prose is None or "## Context\n" + task_prose + "\n" not in executor_prompt \
        or executor_prompt.count(approval_context) != 1 \
        or any(executor_prompt.count(heading) != 1 for heading in required_headings) \
        or [executor_prompt.index(heading) for heading in required_headings] != sorted(
            executor_prompt.index(heading) for heading in required_headings) \
        or "BASE: " + base not in executor_prompt \
        or "BRANCH: " + str(task.get("branch", "")) not in executor_prompt \
        or "WORKTREE: " + str(task.get("worktree", "")) not in executor_prompt \
        or not executor_prompt.endswith(prompt_contract):
    fail("unverified-native-actions")

try:
    supervisor_prompt_text = text("supervisor-prompt.md")
    executor_model = task["rungs"][task["rung"]]
    report = str(task["reports"][-1]).replace(executor_model, "[executor-model-redacted]")
    expected_supervisor_prompt = supervisor_prompt_text + "\n".join([
        "",
        "",
        "CODEX OUTPUT CONTRACT:",
        "Return one JSON object with exactly these three root keys:",
        '{"ok": boolean, "violations": array, "remarks": array of strings}.',
        'For a clean result, use {"ok":true,"violations":[],"remarks":["evidence summary"]}.',
        "Describe successful pasted-output comparisons in remarks.",
        "For a failing result, use ok:false and put each finding in violations.",
        "Each violation has rule, class and evidence strings, plus an optional quote string.",
        "pasteReproduced and satisfiable are boolean fields inside the relevant violation;",
        "include satisfiable on each must_run violation and explain it in that violation's evidence.",
        "",
        "CONTRACT:",
        json.dumps(plan_task["contract"], indent=2, ensure_ascii=False),
        "",
        "REPO: " + str(state["repoPath"]),
        "BASE: " + str(state["base"]),
        "BRANCH: " + str(task["branch"]),
        "",
        "VERIFIER FACTS:",
        json.dumps(task["verifierFacts"][-1], indent=2, ensure_ascii=False),
        "",
        "REPORT:",
        report,
    ])
except (OSError, IndexError, KeyError, TypeError):
    fail("unverified-native-actions")
supervisor_prompt = collab[2].get("prompt") if len(collab) == 4 else None
if supervisor_prompt != expected_supervisor_prompt or executor_model in supervisor_prompt:
    fail("unverified-native-actions")

expected_supervisor = {"model": "gpt-6-astra" if orchestrator_model == "gpt-6-astra" else "gpt-5.6-terra", "effort": "high"}
expected_executor = {"model": "gpt-6-luna", "effort": "medium"}
if wave.get("supervisor") != expected_supervisor \
        or plan_task.get("executor") != expected_executor \
        or plan_task.get("ladder") != ["gpt-6-sol"] \
        or state.get("supervisor") != expected_supervisor \
        or task.get("rungs") != ["gpt-6-luna", "gpt-6-sol"] \
        or task.get("rung") != 0:
    fail("wrong-plan-model-tuple")
verdicts = task.get("verdicts")
if not isinstance(verdicts, list) or not verdicts \
        or verdicts[-1].get("model") != "gpt-6-luna" \
        or verdicts[-1].get("effort") != "medium":
    fail("wrong-plan-model-tuple")

facts = task.get("verifierFacts")
if not isinstance(facts, list) or not facts:
    fail("invalid-terminal-state-or-evidence")
must_run = facts[-1].get("mustRun")
if not isinstance(must_run, list) or not must_run:
    fail("invalid-terminal-state-or-evidence")
primary = must_run[0]
if primary.get("cmd") != "python3 -m unittest discover -s tests -t ." \
        or not primary.get("attempts") or primary["attempts"][-1].get("exit") != 0:
    fail("invalid-terminal-state-or-evidence")
primary_output = "".join(str(primary["attempts"][-1].get(key, "")) for key in ("stdout", "stderr"))
if "Ran 2 tests" not in primary_output or "OK" not in primary_output:
    fail("invalid-terminal-state-or-evidence")

if status("default-head.status") != 0 or status("origin-head.status") != 0:
    fail("invalid-publication-evidence")
default_head = text("default-head.txt").strip()
origin_head = text("origin-head.txt").strip()
if expected == "failure":
    if default_head != base or origin_head != base:
        fail("merged-failing-task")
else:
    if default_head == base or origin_head != default_head:
        fail("unpublished-success")
    if status("task-merged.status") != 0:
        fail("invalid-success-publication")
if status("task-branch.status") != 0 or text("task-branch.txt").strip() != "wave/divide-guard" \
        or status("task-head.status") != 0 or text("task-head.txt").strip() == base \
        or status("task-ancestor.status") != 0:
    fail("invalid-task-branch-evidence")

summary_tasks = summary.get("tasks") if isinstance(summary, dict) else None
summary_task = summary_tasks[0] if isinstance(summary_tasks, list) and len(summary_tasks) == 1 else {}
fresh_output = text("fresh-must-run.stdout") + text("fresh-must-run.stderr")
if status("fresh-must-run.status") != 0 or "Ran 2 tests" not in fresh_output or "OK" not in fresh_output:
    fail("unverified-success" if expected == "success" else "invalid-fresh-primary-verifier")
if expected == "success":
    if task.get("status") != "merge-ready" or summary.get("status") != "done" \
            or summary_task.get("id") != "divide-guard" or summary_task.get("status") != "ok":
        fail("invalid-terminal-state-or-evidence")
else:
    if task.get("status") not in {"contract-unsatisfiable", "failed"} \
            or summary.get("status") != "partial" \
            or summary_task.get("status") not in {"contract-unsatisfiable", "failed"}:
        fail("invalid-terminal-state-or-evidence")
    if len(must_run) != 2 or not must_run[1].get("attempts") \
            or must_run[1]["attempts"][-1].get("exit") in {None, 0}:
        fail("missing-real-failing-verifier-facts")
    failing_output = "".join(str(must_run[1]["attempts"][-1].get(key, "")) for key in ("stdout", "stderr"))
    fresh_independent = text("fresh-independent.stdout") + text("fresh-independent.stderr")
    if "independent verifier red" not in failing_output \
            or status("fresh-independent.status") in {None, 0} \
            or "independent verifier red" not in fresh_independent:
        fail("missing-real-failing-verifier-facts")
print("pass")
PY
}

# Classifier for the live path: codex-wave-runner.mjs drove codex-wave-state.mjs
# directly (no orchestrator model, no native spawn_agent/wait events). Reads
# the runner's own --out directory (recorded at <cell>/runner) plus the same
# repo-side evidence classify_codex uses (captured at <cell>/evidence by
# capture_codex_evidence, whose fresh-checkout must_run logic this reuses
# as-is). "success" requires exit 0 + merge-ready; "failure" (the
# independent-must-run fixture) requires the runner to have stopped or
# reworked per the helper and never to have reported merge-ready over the
# permanently-red second must_run.
classify_runner() { # expected cell
  local expected="$1" cell="$2"
  python3 /dev/fd/3 "$expected" "$cell" 3<<'PY'
import glob
import json
import re
import sys
from pathlib import Path

expected, cell_arg = sys.argv[1:]
cell = Path(cell_arg)
runner_dir = cell / "runner"
evidence = cell / "evidence"


def fail(reason):
    print("fail:" + reason)
    raise SystemExit


def text(relative):
    return (evidence / relative).read_text(encoding="utf-8")


def status(relative):
    try:
        return int(text(relative).strip())
    except (OSError, ValueError):
        return None


try:
    run_exit = int((cell / "run-exit-code.txt").read_text(encoding="utf-8").strip())
except (OSError, ValueError):
    fail("missing-run-exit-code")

try:
    summary = json.loads((runner_dir / "summary.json").read_text(encoding="utf-8"))
except (OSError, ValueError):
    fail("missing-runner-summary")

if expected == "success":
    if run_exit != 0 or summary.get("status") != "merge-ready" or summary.get("stopped"):
        fail("runner-did-not-reach-merge-ready")
else:
    if run_exit == 0 or summary.get("status") != "stop":
        fail("runner-unexpectedly-merge-ready")
    stopped = summary.get("stopped") if isinstance(summary.get("stopped"), list) else []
    stop_entry = next((s for s in stopped if s.get("task") == "divide-guard"), None)
    if stop_entry is None or stop_entry.get("reason") not in ("contract-unsatisfiable", "failed"):
        fail("runner-did-not-stop-cleanly")

summary_tasks = summary.get("tasks")
summary_task = None
for candidate in (summary_tasks or []):
    if isinstance(candidate, dict) and candidate.get("id") == "divide-guard":
        summary_task = candidate
if summary_task is None:
    fail("missing-task-summary")
if expected == "success":
    if summary_task.get("status") != "ok":
        fail("task-not-ok")
else:
    if summary_task.get("status") not in ("contract-unsatisfiable", "failed"):
        fail("task-not-stopped-cleanly")

# The mechanical-verifier helper's own summary must agree (reuses the same
# `node codex-wave-state.mjs summary` evidence classify_codex checks).
if status("helper-summary.status") != 0:
    fail("invalid-helper-summary")
try:
    helper_summary = json.loads(text("helper-summary.stdout"))
except (OSError, ValueError):
    fail("invalid-helper-summary")
helper_tasks = helper_summary.get("tasks") if isinstance(helper_summary, dict) else None
helper_task = helper_tasks[0] if isinstance(helper_tasks, list) and len(helper_tasks) == 1 else {}
if expected == "success":
    if helper_summary.get("status") != "done" or helper_task.get("id") != "divide-guard" \
            or helper_task.get("status") != "ok":
        fail("invalid-helper-summary")
else:
    if helper_summary.get("status") != "partial" \
            or helper_task.get("status") not in ("contract-unsatisfiable", "failed"):
        fail("invalid-helper-summary")

# Task branch carries a real commit, verified fresh (same helper as classify_codex).
try:
    base = text("base.txt").strip()
except OSError:
    fail("invalid-task-branch-evidence")
if status("task-branch.status") != 0 or text("task-branch.txt").strip() != "wave/divide-guard":
    fail("invalid-task-branch-evidence")
if status("task-head.status") != 0 or text("task-head.txt").strip() == base:
    fail("invalid-task-branch-evidence")
if status("task-ancestor.status") != 0:
    fail("invalid-task-branch-evidence")
fresh_output = text("fresh-must-run.stdout") + text("fresh-must-run.stderr")
if status("fresh-must-run.status") != 0 or "Ran 2 tests" not in fresh_output or "OK" not in fresh_output:
    fail("unverified-fresh-must-run")

if expected == "failure":
    # The second must_run is unconditionally red; the runner must have kept
    # (never laundered) that real failing evidence, both freshly and in the
    # captured state, and must never have recorded an ok:true verdict over it.
    fresh_independent = text("fresh-independent.stdout") + text("fresh-independent.stderr")
    if status("fresh-independent.status") in (None, 0) or "independent verifier red" not in fresh_independent:
        fail("missing-real-failing-verifier-facts")
    try:
        state = json.loads((evidence / "state.json").read_text(encoding="utf-8"))
        task_state = state["tasks"]["divide-guard"]
        must_run = task_state["verifierFacts"][-1]["mustRun"]
    except (KeyError, IndexError, TypeError, ValueError, OSError):
        fail("invalid-captured-state")
    if len(must_run) != 2 or not must_run[1].get("attempts") \
            or must_run[1]["attempts"][-1].get("exit") in (None, 0):
        fail("missing-real-failing-verifier-facts")
    failing_output = "".join(str(must_run[1]["attempts"][-1].get(key, "")) for key in ("stdout", "stderr"))
    if "independent verifier red" not in failing_output:
        fail("missing-real-failing-verifier-facts")
    if any(entry.get("verdict", {}).get("ok") is True for entry in task_state.get("verdicts", [])):
        fail("merge-ready-with-red-must-run")

# Every executor/supervisor prompt file the runner wrote must be the real
# thing: same starts-with/contains checks classify_codex applies to the
# native-protocol spawn_agent prompt, reused verbatim.
try:
    plan_text = (evidence / "plan.md").read_text(encoding="utf-8")
except OSError:
    fail("missing-plan-evidence")
prose_match = re.search(r"^## Task divide-guard\r?\n([\s\S]*?)(?=\r?\n## |\Z)", plan_text, re.M)
task_prose = prose_match.group(1).strip() if prose_match else None
blocks = re.findall(r"```json wave-plan\r?\n([\s\S]*?)\r?\n```", plan_text)
if len(blocks) != 1 or task_prose is None:
    fail("invalid-plan-evidence")
plan = json.loads(blocks[0])
plan_task = plan["waves"][0]["tasks"][0]
if plan_task.get("id") != "divide-guard":
    fail("invalid-plan-evidence")
prompt_contract = json.dumps(plan_task.get("contract"), indent=2, ensure_ascii=False)

task_dir = runner_dir / "divide-guard"
executor_prompts = sorted(glob.glob(str(task_dir / "executor-*.prompt.md")))
supervisor_prompts = sorted(glob.glob(str(task_dir / "supervisor-*.prompt.md")))
if not executor_prompts or not supervisor_prompts:
    fail("missing-prompt-files")
rework_line = "Continue in the same worktree and branch; fix the violations."
for prompt_path in executor_prompts:
    content = Path(prompt_path).read_text(encoding="utf-8")
    if Path(prompt_path).name == "executor-1.prompt.md":
        if not content.startswith("# Task: divide-guard\n\n## Context\n") \
                or "## Context\n" + task_prose + "\n" not in content \
                or not content.endswith(prompt_contract):
            fail("executor-prompt-mismatch")
    else:
        if not content.startswith("# Task: divide-guard\n\n## Context\n") \
                or "## Context\n" + task_prose + "\n" not in content \
                or prompt_contract not in content \
                or not content.rstrip().endswith(rework_line):
            fail("executor-prompt-mismatch")
        contract_idx = content.find(prompt_contract)
        after_contract = content[contract_idx + len(prompt_contract):]
        pv_idx = after_contract.find("PRIOR VERDICT:")
        if pv_idx == -1:
            fail("executor-prompt-mismatch")
        after_pv = after_contract[pv_idx + len("PRIOR VERDICT:"):]
        rework_idx = after_pv.rfind(rework_line)
        if rework_idx == -1:
            fail("executor-prompt-mismatch")
        verdict_text = after_pv[:rework_idx].strip()
        try:
            verdict = json.loads(verdict_text)
        except (ValueError, TypeError):
            fail("executor-prompt-mismatch")
        if not isinstance(verdict, dict) or not isinstance(verdict.get("ok"), bool) \
                or not isinstance(verdict.get("violations"), list) \
                or not isinstance(verdict.get("remarks"), list):
            fail("executor-prompt-mismatch")
for prompt_path in supervisor_prompts:
    content = Path(prompt_path).read_text(encoding="utf-8")
    if not content.startswith("# Supervisor Prompt") \
            or "CONTRACT:" not in content or "VERIFIER FACTS:" not in content or "REPORT:" not in content:
        fail("supervisor-prompt-mismatch")

print("pass")
PY
}

now_ms() { python3 -c 'import time; print(time.monotonic_ns() // 1000000)' ; }

record_codex_cell() { # scenario semantic expected repo base source-prompt
  local scenario="$1" semantic="$2" expected="$3" repo="$4" base="$5" source_prompt="$6"
  local slug cell prompt answer class_file status_file state_file event_file event_json='' start end elapsed eval_rc event_publish_rc capture_rc classification status
  slug="${EVAL_MODEL}-wave-${scenario}"
  cell="$EVAL_RESULTS_DIR/raw/$slug"
  if [ -e "$cell" ]; then
    printf 'wave: refusing to overwrite recorded cell %s\n' "$cell" >&2
    return 73
  fi
  mkdir -p "$cell"
  command cp "$source_prompt" "$cell/prompt.md"
  prompt="$cell/prompt.md"
  answer="$cell/final-answer.txt"
  class_file="$cell/classification.txt"
  status_file="$cell/status.txt"
  event_file="$cell/codex-exec-events.jsonl"
  start="$(now_ms)"
  set +e
  eval_codex_json "$REAL_CODEX" "$repo" workspace-write "$prompt" "$answer" event_json "$cell/rollouts"
  eval_rc=$?
  set -e
  if [ -n "$event_json" ]; then
    if printf '%s\n' "$event_json" | publish_diagnostic_jsonl "$event_file"; then
      event_publish_rc=0
    else
      event_publish_rc=$?
    fi
    if printf '%s\n' "$event_json" | capture_codex_evidence \
      "$expected" "$repo" "$base" "$answer" - "$cell"; then
      capture_rc=0
    else
      capture_rc=$?
    fi
  else
    if : | publish_diagnostic_jsonl "$event_file"; then
      event_publish_rc=0
    else
      event_publish_rc=$?
    fi
    if : | capture_codex_evidence "$expected" "$repo" "$base" "$answer" - "$cell"; then
      capture_rc=0
    else
      capture_rc=$?
    fi
  fi
  end="$(now_ms)"
  elapsed=$((end - start))
  if [ "$eval_rc" -eq 0 ]; then
    if [ "$event_publish_rc" -ne 0 ]; then
      classification="fail:diagnostic-publish-$event_publish_rc"
    elif [ "$capture_rc" -ne 0 ]; then
      classification="fail:diagnostic-publish-$capture_rc"
    else
      classification="$(printf '%s\n' "$event_json" | classify_codex "$expected" "$cell" "$base" -)"
    fi
  else
    classification="fail:model-exit-$eval_rc"
  fi
  case "$classification" in pass) status=pass ;; *) status=fail ;; esac
  state_file="$(find_state "$repo" 2>/dev/null || true)"
  printf '%s\n' "$classification" > "$class_file"
  printf 'status=%s\nexit=%s\nelapsed_ms=%s\ncodex_events=%s\ncodex_event_diagnostic_capture=%s\ncodex_evidence_diagnostic_capture=%s\ninput_tokens=unavailable\noutput_tokens=unavailable\ncost=unavailable\nstate=%s\n' \
    "$status" "$eval_rc" "$elapsed" "$event_file" "$event_publish_rc" "$capture_rc" "${state_file:-unavailable}" > "$status_file"
  if [ "${EVAL_CODEX_ROLLOUTS:-0}" = 1 ]; then
    printf 'codex_rollouts=%s\n' "$cell/rollouts/report.json" >> "$status_file"
  fi
  printf 'wave\t%s\t%s\t%s\t%s\t%s\tyes\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\tunavailable\tunavailable\tunavailable\n' \
    "$scenario" "$semantic" "${EVAL_PROVIDER:-codex}" "$EVAL_MODEL" "${EVAL_EFFORT:-medium}" "$status" "$classification" "$eval_rc" "$elapsed" \
    "$prompt" "$answer" "$class_file" "$status_file" >> "$ROWS"
  [ "$status" = pass ]
}

record_runner_cell() { # scenario semantic expected repo base
  local scenario="$1" semantic="$2" expected="$3" repo="$4" base="$5"
  local slug cell out_dir class_file status_file start end elapsed run_rc capture_rc classification status
  slug="${EVAL_MODEL}-wave-${scenario}"
  cell="$EVAL_RESULTS_DIR/raw/$slug"
  if [ -e "$cell" ]; then
    printf 'wave: refusing to overwrite recorded cell %s\n' "$cell" >&2
    return 73
  fi
  mkdir -p "$cell"
  out_dir="$cell/runner"
  class_file="$cell/classification.txt"
  status_file="$cell/status.txt"
  start="$(now_ms)"
  set +e
  node "$CODEX_RUNNER" --plan "$repo/plan.md" --wave 1 --repo "$repo" --base "$base" \
    --jobs 2 --codex "$REAL_CODEX" --out "$out_dir" \
    > "$cell/runner-stdout.json" 2> "$cell/runner-stderr.txt"
  run_rc=$?
  set -e
  printf '%s' "$run_rc" > "$cell/run-exit-code.txt"
  end="$(now_ms)"
  elapsed=$((end - start))
  # Reuses capture_codex_evidence purely for its repo-side evidence
  # (fresh-checkout must_run, task branch, helper summary) — there is no
  # answer/event-trace file on this path, so those two sources are left
  # nonexistent and it records them empty.
  set +e
  capture_codex_evidence "$expected" "$repo" "$base" \
    "$cell/no-answer" "$cell/no-events" "$cell"
  capture_rc=$?
  set -e
  if [ "$run_rc" -ne 0 ] && [ "$run_rc" -ne 1 ]; then
    classification="fail:runner-exit-$run_rc"
  elif [ "$capture_rc" -ne 0 ]; then
    classification="fail:diagnostic-publish-$capture_rc"
  else
    classification="$(classify_runner "$expected" "$cell")"
  fi
  case "$classification" in pass) status=pass ;; *) status=fail ;; esac
  printf '%s\n' "$classification" > "$class_file"
  printf 'status=%s\nexit=%s\nelapsed_ms=%s\nrunner_out=%s\nrunner_evidence_diagnostic_capture=%s\ninput_tokens=unavailable\noutput_tokens=unavailable\ncost=unavailable\n' \
    "$status" "$run_rc" "$elapsed" "$out_dir" "$capture_rc" > "$status_file"
  printf 'wave\t%s\t%s\t%s\t%s\t%s\tyes\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\tunavailable\tunavailable\tunavailable\n' \
    "$scenario" "$semantic" "${EVAL_PROVIDER:-codex}" "$EVAL_MODEL" "${EVAL_EFFORT:-medium}" "$status" "$classification" "$run_rc" "$elapsed" \
    "$repo/plan.md" "$out_dir/summary.json" "$class_file" "$status_file" >> "$ROWS"
  [ "$status" = pass ]
}

init_codex_repo() { # root success|failure
  local root="$1" mode="$2"
  R="$root/repo"
  mkdir -p "$R/src" "$R/tests" "$R/.eval"
  printf '.eval/\n.worktrees/\n__pycache__/\n*.pyc\n' > "$R/.gitignore"
  printf 'def divide(a, b):\n    return a / b\n' > "$R/src/calc.py"
  cat > "$R/tests/test_calc.py" <<'PY'
import unittest
from src.calc import divide

class CalcTest(unittest.TestCase):
    def test_divide(self):
        self.assertEqual(divide(6, 3), 2)

    def test_divide_by_zero_returns_none(self):
        self.assertIsNone(divide(1, 0))
PY
  touch "$R/src/__init__.py" "$R/tests/__init__.py"
  if [ "$mode" = failure ]; then
    make_failure_plan tests/fixtures/plans/codex-clean.md "$R/plan.md"
  else
    command cp tests/fixtures/plans/codex-clean.md "$R/plan.md"
  fi
  sed -e 's/"model": "gpt-5.6-luna"/"model": "gpt-6-luna"/' -e 's/"gpt-5.6-sol"/"gpt-6-sol"/' \
    "$R/plan.md" > "$root/renamed-plan.md"
  command mv "$root/renamed-plan.md" "$R/plan.md"
  if [ "${EVAL_MODEL:-}" = gpt-6-astra ]; then
    sed 's/"model": "gpt-5.6-terra"/"model": "gpt-6-astra"/' "$R/plan.md" > "$root/astra-plan.md"
    command mv "$root/astra-plan.md" "$R/plan.md"
  fi
  inject_plan_lint_fields "$R/plan.md"
  git -C "$R" init -q
  git -C "$R" add -A
  git -C "$R" commit -q -m base
  BASE="$(git -C "$R" rev-parse HEAD)"
  BARE="$R/.eval/origin.git"
  git init -q --bare "$BARE"
  git -C "$R" remote add origin "$BARE"
  git -C "$R" push -q origin HEAD:master
}

evolve_test_wave() { # root success|failure
  local root="$1" expected="$2" init_out verdict worktree
  init_codex_repo "$root" "$expected"
  TEST_REPO="$R"; TEST_BASE="$BASE"
  init_out="$(node "$CODEX_STATE" init --plan "$R/plan.md" --wave 1 --repo "$R" --base "$BASE")"
  TEST_STATE="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["state"])' <<<"$init_out")"
  node "$CODEX_STATE" next --state "$TEST_STATE" > "$root/executor-action.json"
  worktree="$R/.worktrees/wave-divide-guard"
  python3 - "$worktree/src/calc.py" <<'PY'
import sys
with open(sys.argv[1], "w", encoding="utf-8") as stream:
    stream.write("def divide(a, b):\n    if b == 0:\n        return None\n    return a / b\n")
PY
  git -C "$worktree" add src/calc.py
  git -C "$worktree" commit -q -m 'guard division by zero'
  printf '{"report":"Implemented and tested the division-by-zero guard. Verifier output: OK"}\n' \
    | node "$CODEX_STATE" record-executor --state "$TEST_STATE" --task divide-guard >/dev/null
  node "$CODEX_STATE" verify --state "$TEST_STATE" --task divide-guard >/dev/null
  node "$CODEX_STATE" supervisor-prompt --state "$TEST_STATE" --task divide-guard \
    > "$root/supervisor-prompt.json"
  if [ "$expected" = success ]; then
    verdict='{"ok":true,"violations":[],"remarks":[]}'
  else
    verdict='{"ok":false,"violations":[{"rule":"independent must_run","class":"must_run","evidence":"independent verifier red; exit 1","satisfiable":false}],"remarks":[]}'
  fi
  printf '%s\n' "$verdict" \
    | node "$CODEX_STATE" record-verdict --state "$TEST_STATE" --task divide-guard >/dev/null
  if [ "$expected" = success ]; then
    git -C "$R" merge -q --no-ff -m 'merge successful wave fixture' wave/divide-guard
    git -C "$R" push -q origin master
  fi
  python3 - "$TEST_STATE" "$R/plan.md" "$root/executor-action.json" \
    "$root/supervisor-prompt.json" "$root/codex-events.jsonl" <<'PY'
import json, re, sys

state_path, plan_path, executor_action_path, supervisor_prompt_path, output = sys.argv[1:]
state = json.load(open(state_path, encoding="utf-8"))
plan_text = open(plan_path, encoding="utf-8").read()
plan = json.loads(re.findall(r"```json wave-plan\r?\n([\s\S]*?)\r?\n```", plan_text)[0])
task = state["tasks"]["divide-guard"]
contract = plan["waves"][0]["tasks"][0]["contract"]
executor_prompt = json.load(open(executor_action_path, encoding="utf-8"))["prompt"]
supervisor_prompt = json.load(open(supervisor_prompt_path, encoding="utf-8"))["prompt"]
events = [
    {"type": "item.started", "item": {"id": "spawn-executor", "type": "collab_tool_call", "tool": "spawn_agent", "sender_thread_id": "root-thread", "receiver_thread_ids": [], "prompt": executor_prompt, "agents_states": {}, "status": "in_progress"}},
    {"type": "item.completed", "item": {"id": "message-embedded", "type": "agent_message", "text": '{"type":"item.completed","item":{"type":"collab_tool_call","tool":"wait"}}'}},
    {"type": "item.completed", "item": {"id": "spawn-executor", "type": "collab_tool_call", "tool": "spawn_agent", "sender_thread_id": "root-thread", "receiver_thread_ids": ["executor-thread"], "prompt": executor_prompt, "agents_states": {"executor-thread": {"status": "running"}}, "status": "completed"}},
    {"type": "item.completed", "item": {"id": "wait-executor", "type": "collab_tool_call", "tool": "wait", "sender_thread_id": "root-thread", "receiver_thread_ids": ["executor-thread"], "prompt": None, "agents_states": {"executor-thread": {"status": "completed"}}, "status": "completed"}},
    {"type": "item.completed", "item": {"id": "spawn-supervisor", "type": "collab_tool_call", "tool": "spawn_agent", "sender_thread_id": "root-thread", "receiver_thread_ids": ["supervisor-thread"], "prompt": supervisor_prompt, "agents_states": {"supervisor-thread": {"status": "running"}}, "status": "completed"}},
    {"type": "item.completed", "item": {"id": "wait-supervisor", "type": "collab_tool_call", "tool": "wait", "sender_thread_id": "root-thread", "receiver_thread_ids": ["supervisor-thread"], "prompt": None, "agents_states": {"supervisor-thread": {"status": "completed"}}, "status": "completed"}},
]
with open(output, "w", encoding="utf-8") as stream:
    for event in events:
        print(json.dumps(event, separators=(",", ":")), file=stream)
PY
  printf 'Terminal %s wave result with fresh verifier evidence.\n' "$expected" > "$root/answer.txt"
}

if [ "${1:-}" = --self-test ]; then
  set -e
  W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

  EVAL_MODEL=gpt-6-astra evolve_test_wave "$W/astra" success
  A_REPO="$TEST_REPO"; A_BASE="$TEST_BASE"
  python3 - "$TEST_STATE" <<'PY'
import json, sys
state = json.load(open(sys.argv[1]))
assert state["supervisor"] == {"model": "gpt-6-astra", "effort": "high"}
assert state["tasks"]["divide-guard"]["rungs"] == ["gpt-6-luna", "gpt-6-sol"]
PY
  mkdir -p "$W/astra-cell"
  capture_codex_evidence success "$A_REPO" "$A_BASE" "$W/astra/answer.txt" \
    "$W/astra/codex-events.jsonl" "$W/astra-cell"
  [ "$(EVAL_MODEL=gpt-6-astra classify_codex success "$W/astra-cell" "$A_BASE")" = pass ]
  [ "$(EVAL_MODEL=gpt-5.6-sol classify_codex success "$W/astra-cell" "$A_BASE")" = 'fail:wrong-plan-model-tuple' ]

  evolve_test_wave "$W/success" success
  S_REPO="$TEST_REPO"; S_BASE="$TEST_BASE"
  gitignore_at_base="$(git -C "$S_REPO" show "$S_BASE:.gitignore")"
  case "$gitignore_at_base" in *'__pycache__/'*) ;; *)
    printf 'wave RED: base .gitignore missing __pycache__/\n' >&2; exit 1 ;;
  esac
  case "$gitignore_at_base" in *'*.pyc'*) ;; *)
    printf 'wave RED: base .gitignore missing *.pyc\n' >&2; exit 1 ;;
  esac
  mkdir -p "$W/success-cell"
  capture_codex_evidence success "$S_REPO" "$S_BASE" "$W/success/answer.txt" \
    "$W/success/codex-events.jsonl" "$W/success-cell"
  [ "$(classify_codex success "$W/success-cell" "$S_BASE")" = pass ]
  success_default="$(cat "$W/success-cell/evidence/default-head.txt")"
  git -C "$S_REPO" update-ref refs/remotes/origin/master "$S_BASE"
  mkdir -p "$W/success-stale-tracking"
  capture_codex_evidence success "$S_REPO" "$S_BASE" "$W/success/answer.txt" \
    "$W/success/codex-events.jsonl" "$W/success-stale-tracking"
  [ "$(cat "$W/success-stale-tracking/evidence/origin-head.txt")" = "$success_default" ]
  [ "$(classify_codex success "$W/success-stale-tracking" "$S_BASE")" = pass ]
  git -C "$S_REPO" update-ref refs/remotes/origin/master "$success_default"
  command cp -R "$W/success-cell" "$W/success-unpushed"
  printf '%s\n' "$S_BASE" > "$W/success-unpushed/evidence/origin-head.txt"
  [ "$(classify_codex success "$W/success-unpushed" "$S_BASE")" = 'fail:unpublished-success' ]
  command cp -R "$W/success-cell" "$W/success-unmerged"
  printf '1\n' > "$W/success-unmerged/evidence/task-merged.status"
  [ "$(classify_codex success "$W/success-unmerged" "$S_BASE")" = 'fail:invalid-success-publication' ]

  command cp -R "$W/success-cell" "$W/obsolete-executor-prompt"
  python3 - "$W/obsolete-executor-prompt/evidence/codex-exec-events.jsonl" <<'PY'
import json, sys

path = sys.argv[1]
events = [json.loads(line) for line in open(path, encoding="utf-8") if line.strip()]
spawn = next(event["item"] for event in events
             if event.get("type") == "item.completed"
             and event.get("item", {}).get("type") == "collab_tool_call"
             and event["item"].get("tool") == "spawn_agent"
             and str(event["item"].get("prompt", "")).startswith("# Task:"))
spawn["prompt"] = "Implement task divide-guard in the existing task worktree.\nWORKTREE: /tmp/obsolete\nCONTRACT: {}"
with open(path, "w", encoding="utf-8") as stream:
    for event in events:
        print(json.dumps(event, separators=(",", ":")), file=stream)
PY
  [ "$(classify_codex success "$W/obsolete-executor-prompt" "$S_BASE")" = 'fail:unverified-native-actions' ]

  for approval_mutation in removed negated; do
    command cp -R "$W/success-cell" "$W/executor-approval-$approval_mutation"
    python3 - "$W/executor-approval-$approval_mutation/evidence/codex-exec-events.jsonl" \
      "$approval_mutation" <<'PY'
import json, sys

path, mutation = sys.argv[1:]
events = [json.loads(line) for line in open(path, encoding="utf-8") if line.strip()]
spawn = next(event["item"] for event in events
             if event.get("type") == "item.completed"
             and event.get("item", {}).get("type") == "collab_tool_call"
             and event["item"].get("tool") == "spawn_agent"
             and str(event["item"].get("prompt", "")).startswith("# Task:"))
approval = ("The user already approved this exact wave plan and task. Begin implementation immediately;\n"
            "do not request another design or approval. The dead-end rules below still apply.\n\n")
if approval not in spawn["prompt"]:
    raise SystemExit("approval fixture block missing")
spawn["prompt"] = (spawn["prompt"].replace(approval, "", 1) if mutation == "removed"
                   else spawn["prompt"].replace("already approved", "has not approved", 1))
with open(path, "w", encoding="utf-8") as stream:
    for event in events:
        print(json.dumps(event, separators=(",", ":")), file=stream)
PY
    approval_actual="$(classify_codex success "$W/executor-approval-$approval_mutation" "$S_BASE")"
    if [ "$approval_actual" != 'fail:unverified-native-actions' ]; then
      printf 'wave RED: %s executor approval context unexpectedly classified as %s\n' \
        "$approval_mutation" "$approval_actual" >&2
      exit 1
    fi
  done

  command cp -R "$W/success-cell" "$W/replaced-events-cell"
  authentic_events='{"type":"thread.started","thread_id":"authentic-invalid-wave"}'
  rm "$W/replaced-events-cell/evidence/codex-exec-events.jsonl"
  printf 'wave-symlink-target-sentinel\n' > "$W/wave-symlink-target"
  ln -s "$W/wave-symlink-target" \
    "$W/replaced-events-cell/evidence/codex-exec-events.jsonl"
  set +e
  printf '%s\n' "$authentic_events" | publish_diagnostic_jsonl \
    "$W/replaced-events-cell/evidence/codex-exec-events.jsonl"
  publish_rc=$?
  set -e
  if [ "$publish_rc" -ne 0 ]; then
    printf 'wave RED: atomic diagnostic publisher returned %s\n' "$publish_rc" >&2
    exit 1
  fi
  [ "$(cat "$W/wave-symlink-target")" = wave-symlink-target-sentinel ]
  [ -f "$W/replaced-events-cell/evidence/codex-exec-events.jsonl" ]
  [ ! -L "$W/replaced-events-cell/evidence/codex-exec-events.jsonl" ]
  printf '%s\n' "$authentic_events" > "$W/expected-authentic-events.jsonl"
  command cmp "$W/expected-authentic-events.jsonl" \
    "$W/replaced-events-cell/evidence/codex-exec-events.jsonl"

  rm "$W/replaced-events-cell/evidence/codex-exec-events.jsonl"
  mkfifo "$W/replaced-events-cell/evidence/codex-exec-events.jsonl"
  export -f publish_diagnostic_jsonl
  set +e
  timeout 5 bash -c 'printf "%s\n" "$1" | publish_diagnostic_jsonl "$2"' \
    _ "$authentic_events" "$W/replaced-events-cell/evidence/codex-exec-events.jsonl"
  fifo_publish_rc=$?
  set -e
  if [ "$fifo_publish_rc" -ne 0 ]; then
    printf 'wave RED: FIFO diagnostic publisher returned %s\n' "$fifo_publish_rc" >&2
    exit 1
  fi
  [ -f "$W/replaced-events-cell/evidence/codex-exec-events.jsonl" ]
  command cmp "$W/expected-authentic-events.jsonl" \
    "$W/replaced-events-cell/evidence/codex-exec-events.jsonl"

  (command cp "$W/success/codex-events.jsonl" \
    "$W/replaced-events-cell/evidence/codex-exec-events.jsonl") &
  replace_pid=$!
  wait "$replace_pid"
  replaced_actual="$(printf '%s\n' "$authentic_events" \
    | classify_codex success "$W/replaced-events-cell" "$S_BASE" -)"
  if [ "$replaced_actual" != 'fail:unverified-native-actions' ]; then
    printf 'wave RED: replaced diagnostic events unexpectedly classified as %s\n' \
      "$replaced_actual" >&2
    exit 1
  fi

  for mutation in contract facts report repo base branch executor-model-leak; do
    command cp -R "$W/success-cell" "$W/wrong-supervisor-$mutation"
    python3 - "$W/wrong-supervisor-$mutation/evidence/codex-exec-events.jsonl" "$mutation" <<'PY'
import json, sys

path, mutation = sys.argv[1:]
events = [json.loads(line) for line in open(path, encoding="utf-8") if line.strip()]
spawn = next(event["item"] for event in events
             if event.get("type") == "item.completed"
             and event.get("item", {}).get("type") == "collab_tool_call"
             and event["item"].get("tool") == "spawn_agent"
             and str(event["item"].get("prompt", "")).startswith("# Supervisor Prompt"))
prompt = spawn["prompt"]
replacements = {
    "contract": ('"files_allowed"', '"files_allowed_wrong"'),
    "facts": ('"preflightPassed": true', '"preflightPassed": false'),
    "report": ("Implemented and tested the division-by-zero guard.", "Unrelated report."),
    "repo": ("REPO: ", "REPO: /unrelated/repo # "),
    "base": ("BASE: ", "BASE: 0000000000000000000000000000000000000000 # "),
    "branch": ("BRANCH: wave/divide-guard", "BRANCH: wave/other-task"),
}
if mutation == "executor-model-leak":
    prompt += "\nexecutor model: gpt-6-luna"
else:
    old, new = replacements[mutation]
    if old not in prompt:
        raise SystemExit("fixture token missing: " + mutation)
    prompt = prompt.replace(old, new, 1)
spawn["prompt"] = prompt
with open(path, "w", encoding="utf-8") as stream:
    for event in events:
        print(json.dumps(event, separators=(",", ":")), file=stream)
PY
    actual="$(classify_codex success "$W/wrong-supervisor-$mutation" "$S_BASE")"
    if [ "$actual" != 'fail:unverified-native-actions' ]; then
      printf 'wave RED: wrong supervisor %s unexpectedly classified as %s\n' "$mutation" "$actual" >&2
      exit 1
    fi
  done

  command cp -R "$W/success-cell" "$W/legacy-text-trace"
  printf 'native:spawn-executor model=gpt-5.6-luna effort=medium\nnative:wait executor\nnative:spawn-supervisor model=gpt-5.6-terra effort=high\nnative:wait supervisor\n' \
    > "$W/legacy-text-trace/evidence/codex-exec-events.jsonl"
  [ "$(classify_codex success "$W/legacy-text-trace" "$S_BASE")" = 'fail:unverified-native-actions' ]

  canonical_state="$(find_state "$S_REPO")"
  command cp "$canonical_state" "$S_REPO/.worktrees/codex-wave/second-state.json"
  mkdir -p "$W/multiple-state-cell"
  capture_codex_evidence success "$S_REPO" "$S_BASE" "$W/success/answer.txt" \
    "$W/success/codex-events.jsonl" "$W/multiple-state-cell"
  [ "$(classify_codex success "$W/multiple-state-cell" "$S_BASE")" = 'fail:multiple-codex-wave-states' ]
  rm "$S_REPO/.worktrees/codex-wave/second-state.json"
  command mv "$canonical_state" "$W/saved-canonical-state.json"
  mkdir -p "$W/missing-state-cell"
  capture_codex_evidence success "$S_REPO" "$S_BASE" "$W/success/answer.txt" \
    "$W/success/codex-events.jsonl" "$W/missing-state-cell"
  [ "$(cat "$W/missing-state-cell/evidence/state-count.txt")" = 0 ]
  [ "$(classify_codex success "$W/missing-state-cell" "$S_BASE")" = 'fail:missing-codex-wave-state' ]
  command mv "$W/saved-canonical-state.json" "$canonical_state"

  command cp -R "$W/success-cell" "$W/empty-answer"
  : > "$W/empty-answer/evidence/final-answer.txt"
  [ "$(classify_codex success "$W/empty-answer" "$S_BASE")" = 'fail:empty-final-answer' ]
  command cp -R "$W/success-cell" "$W/empty-trace"
  : > "$W/empty-trace/evidence/codex-exec-events.jsonl"
  [ "$(classify_codex success "$W/empty-trace" "$S_BASE")" = 'fail:unverified-native-actions' ]
  command cp -R "$W/success-cell" "$W/malformed-events"
  printf 'not-json\n' > "$W/malformed-events/evidence/codex-exec-events.jsonl"
  [ "$(classify_codex success "$W/malformed-events" "$S_BASE")" = 'fail:unverified-native-actions' ]
  command cp -R "$W/success-cell" "$W/embedded-only-events"
  printf '%s\n' '{"type":"item.completed","item":{"id":"message","type":"agent_message","text":"{\"type\":\"item.completed\",\"item\":{\"type\":\"collab_tool_call\",\"tool\":\"spawn_agent\"}}"}}' > "$W/embedded-only-events/evidence/codex-exec-events.jsonl"
  [ "$(classify_codex success "$W/embedded-only-events" "$S_BASE")" = 'fail:unverified-native-actions' ]
  command cp -R "$W/success-cell" "$W/duplicate-collab-event"
  tail -n 1 "$W/success-cell/evidence/codex-exec-events.jsonl" >> "$W/duplicate-collab-event/evidence/codex-exec-events.jsonl"
  [ "$(classify_codex success "$W/duplicate-collab-event" "$S_BASE")" = 'fail:unverified-native-actions' ]
  command cp -R "$W/success-cell" "$W/wrong-receiver-event"
  sed 's/\["executor-thread"\]/["other-thread"]/' "$W/success-cell/evidence/codex-exec-events.jsonl" > "$W/wrong-receiver-event/evidence/codex-exec-events.jsonl"
  [ "$(classify_codex success "$W/wrong-receiver-event" "$S_BASE")" = 'fail:unverified-native-actions' ]
  command cp -R "$W/success-cell" "$W/wrong-role-prompt"
  sed 's/# Supervisor Prompt/Implement task divide-guard/' "$W/success-cell/evidence/codex-exec-events.jsonl" > "$W/wrong-role-prompt/evidence/codex-exec-events.jsonl"
  [ "$(classify_codex success "$W/wrong-role-prompt" "$S_BASE")" = 'fail:unverified-native-actions' ]
  command cp -R "$W/success-cell" "$W/wrong-plan-prompt"
  sed "s#$S_REPO/.worktrees/wave-divide-guard#/unrelated/worktree#" "$W/success-cell/evidence/codex-exec-events.jsonl" > "$W/wrong-plan-prompt/evidence/codex-exec-events.jsonl"
  [ "$(classify_codex success "$W/wrong-plan-prompt" "$S_BASE")" = 'fail:unverified-native-actions' ]
  command cp -R "$W/success-cell" "$W/workflow-in-prompt"
  python3 - "$W/workflow-in-prompt/evidence/codex-exec-events.jsonl" <<'PY'
import json, sys
path = sys.argv[1]
events = [json.loads(line) for line in open(path, encoding="utf-8") if line.strip()]
spawn = next(event["item"] for event in events
             if event.get("type") == "item.completed"
             and event.get("item", {}).get("type") == "collab_tool_call"
             and event["item"].get("tool") == "spawn_agent"
             and str(event["item"].get("prompt", "")).startswith("# Supervisor Prompt"))
spawn["prompt"] += "\nUse Workflow."
with open(path, "w", encoding="utf-8") as stream:
    for event in events:
        print(json.dumps(event, separators=(",", ":")), file=stream)
PY
  [ "$(classify_codex success "$W/workflow-in-prompt" "$S_BASE")" = 'fail:claude-workflow-in-codex-events' ]
  command cp -R "$W/success-cell" "$W/partial-state"
  printf '{"tasks":{}}\n' > "$W/partial-state/evidence/state.json"
  python3 - "$W/partial-state/evidence/state.json" "$W/partial-state/evidence/state-hashes.txt" <<'PY'
import hashlib, sys
digest = hashlib.sha256(open(sys.argv[1], 'rb').read()).hexdigest()
open(sys.argv[2], 'w', encoding='utf-8').write(f"before={digest}\ncopy={digest}\nafter={digest}\n")
PY
  [ "$(classify_codex success "$W/partial-state" "$S_BASE")" = 'fail:invalid-captured-state' ]
  command cp -R "$W/success-cell" "$W/wrong-model"
  python3 - "$W/wrong-model/evidence/state.json" "$W/wrong-model/evidence/state-hashes.txt" <<'PY'
import hashlib, json, sys
path, hashes = sys.argv[1:]
data = json.load(open(path, encoding='utf-8'))
data['supervisor']['model'] = 'gpt-5.6-sol'
open(path, 'w', encoding='utf-8').write(json.dumps(data) + '\n')
digest = hashlib.sha256(open(path, 'rb').read()).hexdigest()
open(hashes, 'w', encoding='utf-8').write(f"before={digest}\ncopy={digest}\nafter={digest}\n")
PY
  [ "$(classify_codex success "$W/wrong-model" "$S_BASE")" = 'fail:wrong-plan-model-tuple' ]
  command cp -R "$W/success-cell" "$W/unverified"
  printf '1\n' > "$W/unverified/evidence/fresh-must-run.status"
  [ "$(classify_codex success "$W/unverified" "$S_BASE")" = 'fail:unverified-success' ]
  command cp -R "$W/success-cell" "$W/claude-trace"
  printf '%s\n' '{"type":"item.completed","item":{"id":"forbidden-command","type":"command_execution","command":"claude -p forbidden","aggregated_output":"","exit_code":0,"status":"completed"}}' >> "$W/claude-trace/evidence/codex-exec-events.jsonl"
  [ "$(classify_codex success "$W/claude-trace" "$S_BASE")" = 'fail:claude-workflow-in-codex-events' ]
  command cp -R "$W/success-cell" "$W/unrelated-trace"
  printf 'some unrelated nonempty activity\n' > "$W/unrelated-trace/evidence/codex-exec-events.jsonl"
  [ "$(classify_codex success "$W/unrelated-trace" "$S_BASE")" = 'fail:unverified-native-actions' ]
  command cp -R "$W/success-cell" "$W/duplicate-trace"
  tail -n 1 "$W/success-cell/evidence/codex-exec-events.jsonl" >> "$W/duplicate-trace/evidence/codex-exec-events.jsonl"
  [ "$(classify_codex success "$W/duplicate-trace" "$S_BASE")" = 'fail:unverified-native-actions' ]
  command cp -R "$W/success-cell" "$W/same-model-trace"
  sed 's/supervisor-thread/executor-thread/g' "$W/success-cell/evidence/codex-exec-events.jsonl" > "$W/same-model-trace/evidence/codex-exec-events.jsonl"
  [ "$(classify_codex success "$W/same-model-trace" "$S_BASE")" = 'fail:unverified-native-actions' ]
  command cp -R "$W/success-cell" "$W/extra-wait-trace"
  tail -n 1 "$W/success-cell/evidence/codex-exec-events.jsonl" >> "$W/extra-wait-trace/evidence/codex-exec-events.jsonl"
  [ "$(classify_codex success "$W/extra-wait-trace" "$S_BASE")" = 'fail:unverified-native-actions' ]

  evolve_test_wave "$W/failure" failure
  F_REPO="$TEST_REPO"; F_BASE="$TEST_BASE"
  mkdir -p "$W/failure-cell"
  capture_codex_evidence failure "$F_REPO" "$F_BASE" "$W/failure/answer.txt" \
    "$W/failure/codex-events.jsonl" "$W/failure-cell"
  [ "$(classify_codex failure "$W/failure-cell" "$F_BASE")" = pass ]
  command cp -R "$W/failure-cell" "$W/failure-stale-primary"
  printf '1\n' > "$W/failure-stale-primary/evidence/fresh-must-run.status"
  [ "$(classify_codex failure "$W/failure-stale-primary" "$F_BASE")" = 'fail:invalid-fresh-primary-verifier' ]
  command cp -R "$W/failure-cell" "$W/failure-late-merge"
  printf '%s\n' deadbeef > "$W/failure-late-merge/evidence/default-head.txt"
  [ "$(classify_codex failure "$W/failure-late-merge" "$F_BASE")" = 'fail:merged-failing-task' ]
  command cp -R "$W/failure-cell" "$W/failure-remote-push"
  command cp "$W/failure-remote-push/evidence/task-head.txt" \
    "$W/failure-remote-push/evidence/origin-head.txt"
  [ "$(classify_codex failure "$W/failure-remote-push" "$F_BASE")" = 'fail:merged-failing-task' ]
  git -C "$F_REPO" push -q origin wave/divide-guard:master
  git -C "$F_REPO" update-ref refs/remotes/origin/master "$F_BASE"
  mkdir -p "$W/failure-hidden-remote-push"
  capture_codex_evidence failure "$F_REPO" "$F_BASE" "$W/failure/answer.txt" \
    "$W/failure/codex-events.jsonl" "$W/failure-hidden-remote-push"
  [ "$(classify_codex failure "$W/failure-hidden-remote-push" "$F_BASE")" = 'fail:merged-failing-task' ]

  mkdir -p "$W/capture-model-repo"
  : > "$W/capture-prompt.md"
  cat > "$W/real-codex-stub" <<'SH'
#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" > "$CAPTURE_TEST_ARGS"
pwd > "$CAPTURE_TEST_PWD"
[ -z "${CODEX_EVAL_REAL_CODEX:-}" ]
[ -z "${CODEX_EVAL_EVENT_SINK:-}" ]
[ -z "${CODEX_EVAL_WRAPPER_DIR:-}" ]
[ -z "${CODEX_EVAL_AUTH_SECRET:-}" ]
case "${CAPTURE_TEST_OUTPUT:-valid}" in
  valid) printf '%s\n' '{"type":"thread.started","thread_id":"offline-wrapper-test"}' ;;
  empty) : ;;
  malformed) printf 'not-json\n' ;;
  *) exit 92 ;;
esac
exit "${CAPTURE_TEST_EXIT:-0}"
SH
  chmod +x "$W/real-codex-stub"
  capture_events=''
  CAPTURE_TEST_ARGS="$W/capture-args" CAPTURE_TEST_PWD="$W/capture-pwd" EVAL_TIMEOUT=5 EVAL_MODEL=gpt-5.6-sol EVAL_EFFORT=medium \
    eval_codex_json "$W/real-codex-stub" "$W/capture-model-repo" workspace-write \
    "$W/capture-prompt.md" "$W/capture-answer.txt" capture_events
  [ "$capture_events" = '{"type":"thread.started","thread_id":"offline-wrapper-test"}' ]
  expected_capture_args="exec --json --ephemeral --ignore-user-config --ignore-rules --skip-git-repo-check --sandbox workspace-write --model gpt-5.6-sol -c model_reasoning_effort=\"medium\" --output-last-message $W/capture-answer.txt -"
  [ "$(cat "$W/capture-args")" = "$expected_capture_args" ]
  [ "$(cat "$W/capture-pwd")" = "$W" ]

  failure_events=''
  set +e
  CAPTURE_TEST_ARGS="$W/capture-failure-args" CAPTURE_TEST_PWD="$W/capture-failure-pwd" CAPTURE_TEST_EXIT=19 EVAL_TIMEOUT=5 \
    eval_codex_json "$W/real-codex-stub" "$W/capture-model-repo" read-only \
    "$W/capture-prompt.md" "$W/capture-failure-answer.txt" failure_events
  capture_rc=$?
  set -e
  [ "$capture_rc" -eq 19 ]
  [ "$failure_events" = '{"type":"thread.started","thread_id":"offline-wrapper-test"}' ]
  [ "$(cat "$W/capture-failure-pwd")" = "$W/capture-model-repo" ]

  for bad_output in empty malformed; do
    bad_events='stale'
    set +e
    CAPTURE_TEST_ARGS="$W/capture-$bad_output-args" CAPTURE_TEST_PWD="$W/capture-$bad_output-pwd" CAPTURE_TEST_OUTPUT="$bad_output" EVAL_TIMEOUT=5 \
      eval_codex_json "$W/real-codex-stub" "$W/capture-model-repo" read-only \
      "$W/capture-prompt.md" "$W/capture-$bad_output-answer.txt" bad_events
    capture_rc=$?
    set -e
    [ "$capture_rc" -eq 74 ] && [ -z "$bad_events" ]
  done

  # Opt-in retains sessions and adds diagnostics without changing native scoring.
  local_rollout_events=''
  EVAL_CODEX_ROLLOUTS=1 EVAL_CODEX_SESSIONS_DIR="$W/missing-sessions" \
    CAPTURE_TEST_ARGS="$W/retained-args" CAPTURE_TEST_PWD="$W/retained-pwd" EVAL_TIMEOUT=5 \
    eval_codex_json "$W/real-codex-stub" "$W/capture-model-repo" read-only \
    "$W/capture-prompt.md" "$W/retained-answer.txt" local_rollout_events "$W/retained-rollouts"
  if grep -q -- '--ephemeral' "$W/retained-args"; then
    printf 'wave RED: opt-in still uses --ephemeral\n' >&2
    exit 1
  fi
  [ "$local_rollout_events" = '{"type":"thread.started","thread_id":"offline-wrapper-test"}' ]
  [ -s "$W/retained-rollouts/report.json" ]
  [ "$(printf '%s\n' "$local_rollout_events" | classify_codex_events -)" = 'fail:unverified-native-actions' ]
  set +e
  EVAL_CODEX_ROLLOUTS=1 EVAL_CODEX_SESSIONS_DIR="$W/missing-sessions" CAPTURE_TEST_EXIT=19 \
    CAPTURE_TEST_ARGS="$W/retained-failure-args" CAPTURE_TEST_PWD="$W/retained-failure-pwd" EVAL_TIMEOUT=5 \
    eval_codex_json "$W/real-codex-stub" "$W/capture-model-repo" read-only \
    "$W/capture-prompt.md" "$W/retained-failure-answer.txt" local_rollout_events "$W/retained-failure-rollouts"
  retained_rc=$?
  set -e
  [ "$retained_rc" -eq 19 ] && [ -s "$W/retained-failure-rollouts/report.json" ]

  # Bad options and reused destinations must be rejected before invoking Codex.
  for opt in invalid reused missing-destination; do
    set +e
    EVAL_CODEX_ROLLOUTS="$([ "$opt" = invalid ] && printf invalid || printf 1)" \
      CAPTURE_TEST_ARGS="$W/never-$opt" CAPTURE_TEST_PWD="$W/never-pwd-$opt" EVAL_TIMEOUT=5 \
      eval_codex_json "$W/real-codex-stub" "$W/capture-model-repo" read-only \
      "$W/capture-prompt.md" "$W/never-answer-$opt" local_rollout_events \
      "$([ "$opt" = missing-destination ] || printf '%s' "$W/retained-rollouts")"
    retained_rc=$?
    set -e
    [ "$retained_rc" -ne 0 ] && [ ! -e "$W/never-$opt" ]
  done

  # --- classify_runner: the live path's classifier. No model and no real
  # codex-wave-runner.mjs invocation here — it builds a synthetic
  # <cell>/runner directory (what the runner writes) out of the exact same
  # real, non-model state and prompts evolve_test_wave already produced
  # above for $W/success-cell and $W/failure-cell, reusing their
  # already-captured evidence (fresh must_run, task branch, helper summary).
  build_runner_out() { # cell expected executor-action-json supervisor-prompt-json [status-override] [exit-override]
    local cell="$1" expected="$2" executor_json="$3" supervisor_json="$4"
    local status_override="${5:-}" exit_override="${6:-}" out exit_code
    out="$cell/runner"
    mkdir -p "$out/divide-guard"
    python3 - "$cell" "$expected" "$executor_json" "$supervisor_json" "$status_override" <<'PY'
import json
import sys
from pathlib import Path

cell_arg, expected, executor_json, supervisor_json, status_override = sys.argv[1:]
cell = Path(cell_arg)
out = cell / "runner"
executor_prompt = json.loads(Path(executor_json).read_text(encoding="utf-8"))["prompt"]
supervisor_prompt = json.loads(Path(supervisor_json).read_text(encoding="utf-8"))["prompt"]
(out / "divide-guard" / "executor-1.prompt.md").write_text(executor_prompt, encoding="utf-8")
(out / "divide-guard" / "supervisor-1.prompt.md").write_text(supervisor_prompt, encoding="utf-8")
helper_summary = json.loads((cell / "evidence" / "helper-summary.stdout").read_text(encoding="utf-8"))
task_summary = helper_summary["tasks"][0]
runner_status = status_override or ("merge-ready" if expected == "success" else "stop")
stopped = [] if runner_status == "merge-ready" else [{"task": "divide-guard", "reason": task_summary["status"]}]
summary = {
    "status": runner_status,
    "stopped": stopped,
    "wave": 1,
    "states": ["synthetic-state.json"],
    "tasks": [task_summary],
    "children": [],
    "wallSeconds": 1.0,
}
(out / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
PY
    if [ -n "$exit_override" ]; then exit_code="$exit_override"
    elif [ "$expected" = success ]; then exit_code=0
    else exit_code=1
    fi
    printf '%s' "$exit_code" > "$cell/run-exit-code.txt"
  }

  build_runner_out "$W/success-cell" success "$W/success/executor-action.json" "$W/success/supervisor-prompt.json"
  [ "$(classify_runner success "$W/success-cell")" = pass ]

  build_runner_out "$W/failure-cell" failure "$W/failure/executor-action.json" "$W/failure/supervisor-prompt.json"
  [ "$(classify_runner failure "$W/failure-cell")" = pass ]

  # A buggy runner must never be believed if it claims merge-ready over the
  # independent must_run fixture's permanently-red second command.
  command cp -R "$W/failure-cell" "$W/runner-forged-merge-ready"
  build_runner_out "$W/runner-forged-merge-ready" failure "$W/failure/executor-action.json" \
    "$W/failure/supervisor-prompt.json" merge-ready 0
  [ "$(classify_runner failure "$W/runner-forged-merge-ready")" = 'fail:runner-unexpectedly-merge-ready' ]

  # A runner exit code that disagrees with its own summary.json must fail.
  command cp -R "$W/success-cell" "$W/runner-wrong-exit"
  build_runner_out "$W/runner-wrong-exit" success "$W/success/executor-action.json" \
    "$W/success/supervisor-prompt.json" '' 1
  [ "$(classify_runner success "$W/runner-wrong-exit")" = 'fail:runner-did-not-reach-merge-ready' ]

  # No summary.json at all (e.g. the runner crashed before writing one).
  command cp -R "$W/success-cell" "$W/runner-no-summary"
  rm -f "$W/runner-no-summary/runner/summary.json"
  printf '0' > "$W/runner-no-summary/run-exit-code.txt"
  [ "$(classify_runner success "$W/runner-no-summary")" = 'fail:missing-runner-summary' ]

  # A missing executor prompt file must fail.
  command cp -R "$W/success-cell" "$W/runner-missing-prompt"
  build_runner_out "$W/runner-missing-prompt" success "$W/success/executor-action.json" \
    "$W/success/supervisor-prompt.json"
  rm "$W/runner-missing-prompt/runner/divide-guard/executor-1.prompt.md"
  [ "$(classify_runner success "$W/runner-missing-prompt")" = 'fail:missing-prompt-files' ]

  # A tampered executor prompt (contract no longer matches the plan) must fail.
  command cp -R "$W/success-cell" "$W/runner-tampered-executor-prompt"
  build_runner_out "$W/runner-tampered-executor-prompt" success "$W/success/executor-action.json" \
    "$W/success/supervisor-prompt.json"
  printf '\nnot the real contract\n' \
    >> "$W/runner-tampered-executor-prompt/runner/divide-guard/executor-1.prompt.md"
  [ "$(classify_runner success "$W/runner-tampered-executor-prompt")" = 'fail:executor-prompt-mismatch' ]

  # A valid attempt-2 rework prompt (previous verdict appended, ending with the
  # rework line) must pass.
  command cp -R "$W/success-cell" "$W/runner-rework-prompt"
  build_runner_out "$W/runner-rework-prompt" success "$W/success/executor-action.json" \
    "$W/success/supervisor-prompt.json"
  python3 - "$W/runner-rework-prompt/runner/divide-guard/executor-1.prompt.md" \
    "$W/runner-rework-prompt/runner/divide-guard/executor-2.prompt.md" <<'PY'
import json
import sys
first, second = sys.argv[1:]
content = open(first, encoding="utf-8").read()
verdict = json.dumps({"ok": False, "violations": [], "remarks": []}, indent=2)
rework = (content
          + '\n\nPRIOR VERDICT:\n' + verdict + '\n'
          + "Continue in the same worktree and branch; fix the violations.\n")
open(second, "w", encoding="utf-8").write(rework)
PY
  [ "$(classify_runner success "$W/runner-rework-prompt")" = pass ]

  # An attempt-2 rework prompt without the "PRIOR VERDICT:" line must fail.
  command cp -R "$W/success-cell" "$W/runner-rework-no-prior-verdict"
  build_runner_out "$W/runner-rework-no-prior-verdict" success "$W/success/executor-action.json" \
    "$W/success/supervisor-prompt.json"
  python3 - "$W/runner-rework-no-prior-verdict/runner/divide-guard/executor-1.prompt.md" \
    "$W/runner-rework-no-prior-verdict/runner/divide-guard/executor-2.prompt.md" <<'PY'
import sys
first, second = sys.argv[1:]
content = open(first, encoding="utf-8").read()
rework = (content
          + '\n\nSome other note that is not the prior verdict marker\n\n'
          + "Continue in the same worktree and branch; fix the violations.\n")
open(second, "w", encoding="utf-8").write(rework)
PY
  [ "$(classify_runner success "$W/runner-rework-no-prior-verdict")" = 'fail:executor-prompt-mismatch' ]

  # An attempt-2 rework prompt whose "PRIOR VERDICT:" payload is not JSON must fail.
  command cp -R "$W/success-cell" "$W/runner-rework-non-json-verdict"
  build_runner_out "$W/runner-rework-non-json-verdict" success "$W/success/executor-action.json" \
    "$W/success/supervisor-prompt.json"
  python3 - "$W/runner-rework-non-json-verdict/runner/divide-guard/executor-1.prompt.md" \
    "$W/runner-rework-non-json-verdict/runner/divide-guard/executor-2.prompt.md" <<'PY'
import sys
first, second = sys.argv[1:]
content = open(first, encoding="utf-8").read()
rework = (content
          + '\n\nPRIOR VERDICT:\nnot actually json\n\n'
          + "Continue in the same worktree and branch; fix the violations.\n")
open(second, "w", encoding="utf-8").write(rework)
PY
  [ "$(classify_runner success "$W/runner-rework-non-json-verdict")" = 'fail:executor-prompt-mismatch' ]

  # An attempt-2 rework prompt that lacks the contract JSON must fail.
  command cp -R "$W/success-cell" "$W/runner-rework-missing-contract"
  build_runner_out "$W/runner-rework-missing-contract" success "$W/success/executor-action.json" \
    "$W/success/supervisor-prompt.json"
  python3 - "$W/runner-rework-missing-contract/runner/divide-guard/executor-1.prompt.md" \
    "$W/runner-rework-missing-contract/runner/divide-guard/executor-2.prompt.md" <<'PY'
import sys
first, second = sys.argv[1:]
content = open(first, encoding="utf-8").read()
header_and_context = content.split("## Workspace", 1)[0]
rework = (header_and_context
          + '\n\nPrevious verdict: {"ok": false, "violations": []}\n\n'
          + "Continue in the same worktree and branch; fix the violations.\n")
open(second, "w", encoding="utf-8").write(rework)
PY
  [ "$(classify_runner success "$W/runner-rework-missing-contract")" = 'fail:executor-prompt-mismatch' ]

  # A supervisor prompt missing a required label must fail.
  command cp -R "$W/success-cell" "$W/runner-bad-supervisor-prompt"
  build_runner_out "$W/runner-bad-supervisor-prompt" success "$W/success/executor-action.json" \
    "$W/success/supervisor-prompt.json"
  sed 's/CONTRACT:/xxx/' \
    "$W/runner-bad-supervisor-prompt/runner/divide-guard/supervisor-1.prompt.md" \
    > "$W/runner-bad-supervisor-prompt/runner/divide-guard/supervisor-1.prompt.md.tmp"
  command mv "$W/runner-bad-supervisor-prompt/runner/divide-guard/supervisor-1.prompt.md.tmp" \
    "$W/runner-bad-supervisor-prompt/runner/divide-guard/supervisor-1.prompt.md"
  [ "$(classify_runner success "$W/runner-bad-supervisor-prompt")" = 'fail:supervisor-prompt-mismatch' ]

  printf 'wave Codex scorer self-test: PASS\n'
  exit
fi

codex_probe() {
  : "${EVAL_RESULTS_DIR:?set EVAL_RESULTS_DIR to a new caller-owned results directory}"
  EVAL_MODEL="${EVAL_MODEL:-gpt-5.6-sol}"
  EVAL_EFFORT="${EVAL_EFFORT:-medium}"
  EVAL_PROVIDER=codex
  export EVAL_MODEL EVAL_EFFORT EVAL_PROVIDER
  export GIT_AUTHOR_NAME='Codex Eval' GIT_AUTHOR_EMAIL='codex-eval@example.invalid'
  export GIT_COMMITTER_NAME="$GIT_AUTHOR_NAME" GIT_COMMITTER_EMAIL="$GIT_AUTHOR_EMAIL"
  ROWS="$EVAL_RESULTS_DIR/cells.tsv"
  mkdir -p "$EVAL_RESULTS_DIR"
  if [ ! -e "$ROWS" ]; then
    printf 'script\tscenario\tsemantic_path\tprovider\tmodel\teffort\tblocking\tstatus\tclassification\texit\telapsed_ms\tprompt\tfinal_answer\tclassification_evidence\tstatus_evidence\tinput_tokens\toutput_tokens\tcost\n' > "$ROWS"
  fi
  local work rc=0 success_repo success_base failure_repo failure_base
  REAL_CODEX="$(command -v codex)" || {
    printf 'wave: codex executable unavailable\n' >&2
    return 69
  }
  work="$(mktemp -d)"; trap 'rm -rf "$work"' RETURN

  # No orchestrator model session: codex-wave-runner.mjs drives
  # codex-wave-state.mjs directly, spawning only executor/supervisor `codex
  # exec` children with the models codex-clean.md's plan already carries.
  init_codex_repo "$work/success" success
  success_repo="$R"; success_base="$BASE"
  record_runner_cell codex-native-success success success "$success_repo" "$success_base" || rc=1

  init_codex_repo "$work/failure" failure
  failure_repo="$R"; failure_base="$BASE"
  record_runner_cell codex-independent-must-run failure failure "$failure_repo" "$failure_base" || rc=1
  return "$rc"
}

claude_probe() {
  # Retained Claude Workflow boundary probe.
  local model="${EVAL_MODEL:-claude-haiku-4-5-20251001}"
  local runner="$ROOT/plugins/orchestration/skills/multi-model/references/wave-runner.workflow.mjs"
  local work repo base default_branch out
  work="$(mktemp -d)"; trap 'rm -rf "$work"' RETURN
  git init -q --bare "$work/origin.git"
  git clone -q "$work/origin.git" "$work/repo" 2>/dev/null
  repo="$work/repo"
  mkdir -p "$repo/src" "$repo/tests"
  printf 'def divide(a, b):\n    return a / b\n' > "$repo/src/calc.py"
  cat > "$repo/tests/test_calc.py" <<'PY'
import unittest
from src.calc import divide

class TestDivide(unittest.TestCase):
    def test_divide(self):
        self.assertEqual(divide(6, 3), 2)
    def test_divide_by_zero_returns_none(self):
        self.assertIsNone(divide(1, 0))
PY
  touch "$repo/src/__init__.py" "$repo/tests/__init__.py"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m base
  default_branch="$(git -C "$repo" rev-parse --abbrev-ref HEAD)"
  git -C "$repo" push -q origin "HEAD:$default_branch"
  base="$(git -C "$repo" rev-parse HEAD)"
  python3 - "$work/args.json" "$base" "$default_branch" "$repo" <<'PY'
import json, sys
out, base, branch, repo = sys.argv[1:5]
sup = open('plugins/orchestration/skills/multi-model/references/supervisor-prompt.md').read()
json.dump({
    "base": base, "defaultBranch": branch, "repoPath": repo,
    "supervisorPromptText": sup,
    "supervisor": {"model": "claude-sonnet-5", "effort": "medium"},
    "tasks": [{
        "id": "divide-guard",
        "description": "Make divide() return None when the divisor is zero, so the whole suite passes.",
        "context": "src/calc.py holds divide(); tests/test_calc.py already expects None on zero.",
        "contract": {
            "files_allowed": ["src/**"], "files_forbidden": ["tests/**"],
            "must_run": [{"cmd": "python3 -m unittest discover -s tests -t .", "evidence": "required"}],
            "forbidden_moves": ["weakening, deleting or skipping an existing test"],
            "report_must_answer": ["What happens when the divisor is zero?"]
        },
        "executor": {"model": "claude-haiku-4-5-20251001", "effort": "medium"}, "ladder": []
    }]
}, open(out, "w"))
PY
  section "the real Workflow boundary"
  out="$(timeout 900 claude -p "Read the JSON object in $work/args.json. Invoke the Workflow tool with scriptPath \"$runner\" and that object as args — a real JSON object, not a string. When it completes, print the workflow's returned JSON verbatim and nothing else." --permission-mode bypassPermissions --model "$model" </dev/null 2>/dev/null)"
  if [ -z "$out" ] || printf '%s' "$out" | grep -qiE 'no such tool|not available|do not have access'; then
    pass "SKIPPED: Workflow is unreachable from headless claude -p (tool absent) — the boundary is proven by the in-session probe (tests/eval/wave-insession.md), not this tier"
  elif printf '%s' "$out" | grep -q 'invalid-args'; then
    fail "runner rejected the wave args even after parse-then-validate" "${out:0:200}"
  else
    contains "the wave returned a status" '"status"' "$out"
    contains "the task is in the result" 'divide-guard' "$out"
    case "$out" in
      *'"ok"'* | *'"failed"'* | *'"contract-unsatisfiable"'* | *'"error"'*) pass "the task carries a terminal status" ;;
      *) fail "the task carries a terminal status" "${out:0:160}" ;;
    esac
  fi
  summary
}

if [ "${EVAL_PROVIDER:-claude}" = codex ]; then
  codex_probe
else
  claude_probe
fi
