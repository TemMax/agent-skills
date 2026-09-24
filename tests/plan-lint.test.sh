#!/usr/bin/env bash
# Behaviour tier — does the SHIPPED plan linter catch each error class by
# name, pass the canonical clean plan, and keep warnings non-fatal? Mutants
# are generated from the clean fixture so the fixtures stay DRY.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
. tests/lib.sh

LINT=plugins/orchestration/skills/super-plan/references/plan-lint.mjs
CLEAN=tests/fixtures/plans/clean.md
CODEX_CLEAN=tests/fixtures/plans/codex-clean.md
GPT6_CLEAN=tests/fixtures/plans/codex-clean-gpt6.md
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

if ! command -v node >/dev/null 2>&1; then
  fail "node is required for this tier and was not found on PATH"
  summary; exit 1
fi

mutate() {  # $1 = old, $2 = new  → writes $W/m.md
  python3 - "$CLEAN" "$W/m.md" "$1" "$2" <<'PY'
import sys
src, dst, old, new = sys.argv[1:5]
s = open(src).read()
assert old in s, 'mutation target missing: ' + old
open(dst, 'w').write(s.replace(old, new, 1))
PY
}

codex_mutate() {  # $1 = old, $2 = new  → writes $W/m.md
  python3 - "$CODEX_CLEAN" "$W/m.md" "$1" "$2" <<'PY'
import sys
src, dst, old, new = sys.argv[1:5]
s = open(src).read()
assert old in s, 'mutation target missing: ' + old
open(dst, 'w').write(s.replace(old, new, 1))
PY
}

section "clean plan"
out="$(node "$LINT" "$CLEAN" 2>&1)"; rc=$?
expect "clean plan exits 0" "0" "$rc"
contains "clean summary line" "OK: 0 error(s)" "$out"

section "documented canonical plan"
if node --input-type=module - plugins/orchestration/skills/super-plan/SKILL.md "$W/documented.md" <<'JS'
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
const [source, target] = process.argv.slice(2)
const skill = readFileSync(source, 'utf8')
const blocks = [...skill.matchAll(/^   ```json wave-plan\r?\n([\s\S]*?)^   ```$/gm)]
assert.equal(blocks.length, 1, 'exactly one canonical wave-plan example is required')
const json = blocks[0][1].replace(/^   /gm, '').trimEnd()
const plan = JSON.parse(json)
const prose = plan.waves.flatMap((wave) => wave.tasks)
  .map((task) => '## Task ' + task.id + '\n\nExample task context.\n').join('\n')
// The skill's fenced example documents ci, e2e and its premium approval
// directly inside the JSON block, so this harness lints them as written.
// The skill describes its header and task prose separately from the JSON.
writeFileSync(target, 'status: draft\nbase: pending\n\n```json wave-plan\n'
  + JSON.stringify(plan, null, 2) + '\n```\n\n' + prose)
JS
then
  out="$(node "$LINT" "$W/documented.md" 2>&1)"; rc=$?
  expect "canonical SKILL.md example exits 0" "0" "$rc"
  contains "canonical SKILL.md example is lint-clean" "OK: 0 error(s)" "$out"
  if [ "$rc" -ne 0 ]; then printf '%s\n' "$out"; fi
else
  fail "canonical SKILL.md example could not be extracted"
fi

section "usage"
node "$LINT" >/dev/null 2>&1; expect "no args exits 2" "2" "$?"

section "each error class is caught by name"

mutate "status: draft" "status: banana"
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "bad status exits 1" "1" "$rc"
contains "bad status named" "status must be draft|active|done" "$out"

mutate "status: draft" "state: draft"
out="$(node "$LINT" "$W/m.md" 2>&1)"
contains "missing status named" "no column-0" "$out"

mutate '"waves"' '"waves'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "broken json exits 1" "1" "$rc"
contains "broken json named" "does not parse" "$out"

mutate '"id": "docs-sync"' '"id": "http-retry"'
out="$(node "$LINT" "$W/m.md" 2>&1)"
contains "duplicate id named" 'duplicate task id "http-retry"' "$out"

mutate '"branch": "wave/docs-sync"' '"branch": "docs-sync"'
out="$(node "$LINT" "$W/m.md" 2>&1)"
contains "bad branch named" 'must be "wave/docs-sync"' "$out"

mutate '"model": "claude-haiku-4-5-20251001"' '"model": "claude-haiku-4-5"'
out="$(node "$LINT" "$W/m.md" 2>&1)"
contains "long model id rejected" "executor.model" "$out"

mutate '          "forbidden_moves": [],
' ''
out="$(node "$LINT" "$W/m.md" 2>&1)"
contains "missing contract key named" "contract.forbidden_moves: array required" "$out"

mutate '"files_allowed": ["docs/**"]' '"files_allowed": ["src/**"]'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "same-wave overlap exits 1" "1" "$rc"
contains "overlap names both tasks" 'tasks "http-retry" and "docs-sync" overlap' "$out"

mutate '"files_forbidden": ["src/auth/**"]' '"files_forbidden": ["src/http/impl/**"]'
out="$(node "$LINT" "$W/m.md" 2>&1)"
contains "self allowed/forbidden overlap named" "overlaps its own files_forbidden" "$out"

mutate "## Task docs-sync" "## Task docs-sync-two"
out="$(node "$LINT" "$W/m.md" 2>&1)"
contains "missing prose section named" 'no "## Task docs-sync" section' "$out"
contains "orphan prose section named" '"## Task docs-sync-two" has no matching task' "$out"

section "warnings stay non-fatal"

mutate '"must_run": [{ "cmd": "true", "evidence": "required" }],
          "forbidden_moves": ["weakening, deleting or skipping an existing test"]' \
       '"must_run": [],
          "forbidden_moves": ["weakening, deleting or skipping an existing test"]'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "empty must_run exits 0" "0" "$rc"
contains "empty must_run warned" "must_run is empty" "$out"

mutate '"files_allowed": ["docs/**"]' '"files_allowed": []'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "empty files_allowed exits 0" "0" "$rc"
contains "empty files_allowed warned" "files_allowed is empty" "$out"

mkdir -p "$W/repo/docs"
mutate '"cmd": "true"' '"cmd": "definitely-not-a-real-binary-xyz"'
out="$(node "$LINT" "$W/m.md" --repo "$W/repo" 2>&1)"; rc=$?
expect "repo warnings exit 0" "0" "$rc"
contains "missing path prefix warned" 'prefix "src/http" does not exist' "$out"
contains "missing command warned" 'command "definitely-not-a-real-binary-xyz" found neither' "$out"

mutate '"cmd": "true"' '"cmd": "! grep -q x README.md"'
out="$(node "$LINT" "$W/m.md" --repo "$W/repo" 2>&1)"; rc=$?
expect "negated grep must_run exits 0" "0" "$rc"
check "negated grep produces no found-neither warning" '! grep -qF "found neither" <<<"$out"'

mutate '"cmd": "true"' '"cmd": "FOO=1 true"'
out="$(node "$LINT" "$W/m.md" --repo "$W/repo" 2>&1)"; rc=$?
expect "env-assignment must_run exits 0" "0" "$rc"
check "env-assignment produces no found-neither warning" '! grep -qF "found neither" <<<"$out"'

mutate '"cmd": "true"' '"cmd": "! definitely-not-a-real-binary-xyz"'
out="$(node "$LINT" "$W/m.md" --repo "$W/repo" 2>&1)"; rc=$?
expect "negated missing command exits 0" "0" "$rc"
contains "negated missing command warned" 'command "definitely-not-a-real-binary-xyz" found neither' "$out"

section "the pinned full id"

mutate '"model": "claude-sonnet-5"' '"model": "claude-opus-4-8"'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "pinned full id in executor.model exits 0" "0" "$rc"
contains "pinned full id in executor.model is clean" "OK: 0 error(s)" "$out"

mutate '"ladder": ["claude-opus-5-5"]' '"ladder": ["claude-opus-4-8"]'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "pinned full id in ladder exits 0" "0" "$rc"
contains "pinned full id in ladder is clean" "OK: 0 error(s)" "$out"

mutate '"model": "claude-sonnet-5"' '"model": "opus-4-8"'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "unpinned full-looking id exits 1" "1" "$rc"
contains "unpinned full-looking id named" "executor.model" "$out"

section "Claude full ids only"

for alias in haiku sonnet opus fable; do
  mutate '"model": "claude-sonnet-5"' "\"model\": \"$alias\""
  out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
  expect "alias $alias as executor.model exits 1" "1" "$rc"
  contains "alias $alias as executor.model is named an alias" "is an alias" "$out"
done

mutate '"model": "claude-fable-5-1"' '"model": "fable"'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "alias supervisor exits 1" "1" "$rc"
contains "alias supervisor is named an alias" "supervisor.model: \"fable\" is an alias" "$out"

mutate '"ladder": ["claude-opus-5-5"]' '"ladder": ["opus"]'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "alias in ladder exits 1" "1" "$rc"
contains "alias in ladder is named an alias" "ladder" "$out"
contains "alias in ladder is named an alias" "is an alias" "$out"

for full in claude-opus-5 claude-fable-5-1; do
  cp "$CLEAN" "$W/m.md"
  python3 - "$W/m.md" "$full" <<'PY'
import sys
p, full = sys.argv[1:]
s = open(p).read()
s = s.replace('"model": "claude-fable-5-1"', '"model": "claude-opus-5-5"', 1)
s = s.replace('"ladder": ["claude-opus-5-5"]', '"ladder": ["claude-sonnet-5"]', 1)
s = s.replace('"model": "claude-sonnet-5"', f'"model": "{full}"', 1)
open(p, 'w').write(s)
PY
  out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
  expect "$full as explicit executor exits 0" "0" "$rc"
  contains "$full as explicit executor is clean" "OK: 0 error(s)" "$out"
done

section "Codex exact ids"
while read -r executor supervisor rung; do
  cp "$CLEAN" "$W/m.md"
  python3 - "$W/m.md" "$executor" "$supervisor" "$rung" <<'PY'
import sys
p, executor, supervisor, rung = sys.argv[1:]
s = open(p).read()
s = s.replace('"model": "claude-sonnet-5"', f'"model": "{executor}"')
s = s.replace('"model": "claude-haiku-4-5-20251001"', f'"model": "{executor}", "effort": "medium"')
s = s.replace('"model": "claude-fable-5-1"', f'"model": "{supervisor}"')
s = s.replace('"ladder": ["claude-opus-5-5"]', f'"ladder": ["{rung}"]')
open(p, 'w').write(s)
PY
  out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
  expect "$executor plan exits 0" "0" "$rc"
done <<'CASES'
gpt-5.6-sol gpt-5.6-terra gpt-5.6-luna
gpt-5.6-terra gpt-5.6-sol gpt-5.6-luna
gpt-5.6-luna gpt-5.6-terra gpt-5.6-sol
CASES

cp "$CODEX_CLEAN" "$W/m.md"
python3 - "$W/m.md" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read().replace(', "effort": "high"', '', 1)
open(p, 'w').write(s)
PY
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "Codex supervisor without effort exits 1" "1" "$rc"
contains "Codex supervisor effort is required" "supervisor.effort: explicit" "$out"

cp "$CODEX_CLEAN" "$W/m.md"
python3 - "$W/m.md" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read().replace(', "effort": "medium"', '', 1)
open(p, 'w').write(s)
PY
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "Codex executor without effort exits 1" "1" "$rc"
contains "Codex executor effort is required" "executor.effort: explicit" "$out"

cp "$CODEX_CLEAN" "$W/m.md"
python3 - "$W/m.md" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read().replace('"ladder": ["gpt-5.6-sol"]', '"ladder": ["gpt-5.6-luna"]')
open(p, 'w').write(s)
PY
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "Codex self-transition ladder exits 1" "1" "$rc"
contains "Codex self-transition ladder is named" "ladder transitions must use distinct models" "$out"

cp "$CODEX_CLEAN" "$W/m.md"
python3 - "$W/m.md" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read().replace('"ladder": ["gpt-5.6-sol"]', '"ladder": ["gpt-5.6-sol", "gpt-5.6-sol"]')
open(p, 'w').write(s)
PY
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "Codex repeated-transition ladder exits 1" "1" "$rc"
contains "Codex repeated-transition ladder is named" "ladder transitions must use distinct models" "$out"

mutate '"model": "claude-sonnet-5"' '"model": "gpt-5.6"'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "gpt-5.6 alias exits 1" "1" "$rc"
contains "gpt-5.6 alias is rejected" "executor.model" "$out"

mutate '"model": "claude-sonnet-5"' '"model": "gpt-5.6-mini"'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "gpt-5.6-mini alias exits 1" "1" "$rc"
contains "gpt-5.6-mini alias is rejected" "executor.model" "$out"

cp "$CLEAN" "$W/m.md"
python3 - "$W/m.md" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
s = s.replace('"model": "claude-sonnet-5"', '"model": "gpt-5.6-sol"')
open(p, 'w').write(s)
PY
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "mixed-provider wave exits 1" "1" "$rc"
contains "mixed-provider wave is named" "mixes providers" "$out"

cp "$CLEAN" "$W/m.md"
python3 - "$W/m.md" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
s = s.replace('"model": "claude-sonnet-5"', '"model": "gpt-5.6-sol"')
s = s.replace('"model": "claude-haiku-4-5-20251001"', '"model": "gpt-5.6-luna"')
s = s.replace('"model": "claude-fable-5-1"', '"model": "gpt-5.6-terra"')
s = s.replace('"ladder": ["claude-opus-5-5"]', '"ladder": ["gpt-5.6-terra"]')
open(p, 'w').write(s)
PY
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "GPT supervisor collision exits 1" "1" "$rc"
contains "GPT supervisor collision is named" "supervisor model also appears as executor or ladder rung" "$out"

section "explicit Astra executor exception"

python3 - "$CODEX_CLEAN" "$W/m.md" <<'PY'
import sys
src, dst = sys.argv[1:]
s = open(src).read()
s = s.replace('"model": "gpt-5.6-terra", "effort": "high"',
              '"model": "gpt-6-astra", "effort": "high"')
s = s.replace('"model": "gpt-5.6-luna", "effort": "medium"',
              '"model": "gpt-6-astra", "effort": "medium"')
s = s.replace('"ladder": ["gpt-5.6-sol"],',
              '"ladder": [],\n        "astra_executor_reason": "Required executor capability.",')
s = s.replace('{ "waves": [',
              '{ "approvals": { "premium": { "models": ["gpt-6-astra"], '
              '"reason": "Astra required for this executor.", "approved_by": "fixture", '
              '"date": "2026-09-24" } },\n  "waves": [')
open(dst, 'w').write(s)
PY
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "justified initial Astra executor exits 0" "0" "$rc"
contains "justified initial Astra executor is clean" "OK: 0 error(s)" "$out"

python3 - "$W/m.md" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read().replace('        "ladder": [],\n', '')
open(p, 'w').write(s)
PY
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "justified initial Astra without ladder exits 0" "0" "$rc"
contains "justified initial Astra without ladder is clean" "OK: 0 error(s)" "$out"

python3 - "$CODEX_CLEAN" "$W/m.md" <<'PY'
import sys
src, dst = sys.argv[1:]
s = open(src).read()
s = s.replace('"model": "gpt-5.6-terra", "effort": "high"',
              '"model": "gpt-6-astra", "effort": "high"')
s = s.replace('"ladder": ["gpt-5.6-sol"],',
              '"ladder": ["gpt-6-astra"],\n        "astra_executor_reason": "Required final escalation.",')
s = s.replace('{ "waves": [',
              '{ "approvals": { "premium": { "models": ["gpt-6-astra"], '
              '"reason": "Astra required for this final rung.", "approved_by": "fixture", '
              '"date": "2026-09-24" } },\n  "waves": [')
open(dst, 'w').write(s)
PY
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "justified final Astra rung exits 0" "0" "$rc"
contains "justified final Astra rung is clean" "OK: 0 error(s)" "$out"

codex_mutate '"model": "gpt-5.6-luna", "effort": "medium"' \
  '"model": "gpt-6-astra", "effort": "medium"'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "Astra executor without opt-in exits 1" "1" "$rc"
contains "Astra executor without opt-in names reason" "astra_executor_reason" "$out"

python3 - "$W/m.md" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read().replace('        "ladder": ["gpt-5.6-sol"],\n', '')
open(p, 'w').write(s)
PY
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "Astra executor without ladder or opt-in exits 1" "1" "$rc"
contains "Astra executor without ladder still requires reason" "astra_executor_reason" "$out"

codex_mutate '"ladder": ["gpt-5.6-sol"],' '"ladder": ["gpt-5.6-sol"],
        "astra_executor_reason": "   ",'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "unused whitespace Astra reason exits 1" "1" "$rc"
contains "unused whitespace Astra reason is named" "astra_executor_reason" "$out"

python3 - "$CODEX_CLEAN" "$W/m.md" <<'PY'
import sys
src, dst = sys.argv[1:]
s = open(src).read()
s = s.replace('"model": "gpt-5.6-terra", "effort": "high"',
              '"model": "gpt-6-astra", "effort": "high"')
s = s.replace('"ladder": ["gpt-5.6-sol"],',
              '"ladder": ["gpt-6-astra", "gpt-5.6-sol"],\n        "astra_executor_reason": "Required escalation.",')
open(dst, 'w').write(s)
PY
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "non-terminal Astra rung exits 1" "1" "$rc"
contains "non-terminal Astra rung is named" "final executor rung" "$out"

section "GPT-6 exact ids"

out="$(node "$LINT" "$GPT6_CLEAN" 2>&1)"; rc=$?
expect "GPT-6 clean plan exits 0" "0" "$rc"
contains "GPT-6 clean plan summary line" "OK: 0 error(s)" "$out"

python3 - "$GPT6_CLEAN" "$W/m.md" <<'PY'
import sys
src, dst = sys.argv[1:]
s = open(src).read()
s = s.replace('"model": "gpt-6-luna", "effort": "medium"', '"model": "gpt-6-sol", "effort": "medium"')
s = s.replace('        "ladder": ["gpt-6-sol"],\n', '        "ladder": [],\n')
open(dst, 'w').write(s)
PY
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "gpt-6-sol executor with empty ladder exits 0" "0" "$rc"
contains "gpt-6-sol executor with empty ladder is clean" "OK: 0 error(s)" "$out"

mutate '"model": "claude-sonnet-5"' '"model": "gpt-6"'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "gpt-6 bare exits 1" "1" "$rc"
contains "gpt-6 bare is rejected" "executor.model" "$out"

mutate '"model": "claude-sonnet-5"' '"model": "gpt-6-mini"'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "gpt-6-mini exits 1" "1" "$rc"
contains "gpt-6-mini is rejected" "executor.model" "$out"

cp "$CLEAN" "$W/m.md"
python3 - "$W/m.md" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
s = s.replace('"model": "claude-sonnet-5"', '"model": "gpt-6-sol"')
open(p, 'w').write(s)
PY
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "gpt-6-sol mixed-provider wave exits 1" "1" "$rc"
contains "gpt-6-sol mixed-provider wave is named" "mixes providers" "$out"

section "Codex standard supervisor: gpt-6-sol"

python3 - "$GPT6_CLEAN" "$W/m.md" <<'PY'
import sys
src, dst = sys.argv[1:]
s = open(src).read()
s = s.replace('"model": "gpt-6-astra", "effort": "high"', '"model": "gpt-6-sol", "effort": "high"')
s = s.replace('        "ladder": ["gpt-6-sol"],\n', '        "ladder": [],\n')
open(dst, 'w').write(s)
PY
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "gpt-6-sol over gpt-6-luna exits 0" "0" "$rc"
check "gpt-6-sol over gpt-6-luna has no standard-supervisor error" \
  '! grep -qF "supervises only waves whose executors and rungs are all gpt-6-luna" <<<"$out"'

python3 - "$GPT6_CLEAN" "$W/m.md" <<'PY'
import sys
src, dst = sys.argv[1:]
s = open(src).read()
s = s.replace('"model": "gpt-6-astra", "effort": "high"', '"model": "gpt-6-sol", "effort": "high"')
s = s.replace('"model": "gpt-6-luna", "effort": "medium"', '"model": "gpt-6-sol", "effort": "medium"')
s = s.replace('        "ladder": ["gpt-6-sol"],\n', '        "ladder": [],\n')
open(dst, 'w').write(s)
PY
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "gpt-6-sol over gpt-6-sol executor exits 1" "1" "$rc"
contains "gpt-6-sol over gpt-6-sol executor named" \
  'waves[0].supervisor.model: gpt-6-sol supervises only waves whose executors and rungs are all gpt-6-luna' "$out"

python3 - "$GPT6_CLEAN" "$W/m.md" <<'PY'
import sys
src, dst = sys.argv[1:]
s = open(src).read()
s = s.replace('"model": "gpt-6-astra", "effort": "high"', '"model": "gpt-6-sol", "effort": "high"')
s = s.replace('"model": "gpt-6-luna", "effort": "medium"', '"model": "gpt-5.6-terra", "effort": "medium"')
s = s.replace('        "ladder": ["gpt-6-sol"],\n', '        "ladder": [],\n')
open(dst, 'w').write(s)
PY
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "gpt-6-sol over gpt-5.6-terra executor exits 1" "1" "$rc"
contains "gpt-6-sol over gpt-5.6-terra executor named" \
  'waves[0].supervisor.model: gpt-6-sol supervises only waves whose executors and rungs are all gpt-6-luna' "$out"

section "Claude default ladder"

mk_default_ladder_plan() {  # $1 = ladder JSON fragment ("" = no ladder key) → writes $W/m.md
  python3 - "$W/m.md" "$1" <<'PY'
import json, sys
dst, ladder_line = sys.argv[1:]
task = {
  "id": "sonnet-task",
  "branch": "wave/sonnet-task",
  "executor": {"model": "claude-sonnet-5", "effort": "medium"},
  "contract": {
    "files_allowed": ["src/**"],
    "files_forbidden": [],
    "must_run": [{"cmd": "true", "evidence": "required"}],
    "forbidden_moves": [],
    "report_must_answer": ["What changed?"]
  }
}
if ladder_line:
  task["ladder"] = json.loads(ladder_line)
plan = {
  "waves": [{
    "wave": 1,
    "supervisor": {"model": "claude-opus-5-5", "effort": "high"},
    "tasks": [task]
  }],
  "ci": "none: fixture plan with no CI workflows",
  "e2e": {"task": "sonnet-task"}
}
out = ('status: draft\nbase: pending\n\n```json wave-plan\n'
       + json.dumps(plan, indent=2) + '\n```\n\n## Task sonnet-task\n\nExample task context.\n')
open(dst, 'w').write(out)
PY
}

mk_default_ladder_plan ""
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "Sonnet task without ladder under Opus 5.5 supervisor exits 1" "1" "$rc"
contains "Sonnet task without ladder under Opus 5.5 supervisor named" \
  'supervisor model also appears as executor or ladder rung' "$out"

mk_default_ladder_plan "[]"
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "Sonnet task with explicit empty ladder under Opus 5.5 supervisor exits 0" "0" "$rc"
check "Sonnet task with explicit empty ladder has no supervisor-collision error" \
  '! grep -qF "supervisor model also appears as executor or ladder rung" <<<"$out"'

section "ci: required CI entrypoint"

mutate '  "ci": "none: fixture repository without CI workflows",
' ''
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "missing ci exits 1" "1" "$rc"
contains "missing ci named" 'ci: required — the exact CI entrypoint commands, or "none: <reason>"' "$out"

mutate '"ci": "none: fixture repository without CI workflows"' '"ci": "none: short"'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "ci none reason too short exits 1" "1" "$rc"
contains "ci none reason too short named" \
  'ci: "none: <reason>" requires a reason of at least 10 characters' "$out"

mutate '"ci": "none: fixture repository without CI workflows"' \
       '"ci": { "commands": ["true"], "workflows": [] }'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "ci object form with a command exits 0" "0" "$rc"
contains "ci object form with a command is clean" "OK: 0 error(s)" "$out"

mutate '"ci": "none: fixture repository without CI workflows"' '"ci": { "commands": [] }'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "ci object form with no commands exits 1" "1" "$rc"
contains "ci object form with no commands named" 'ci.commands: at least one non-empty command required' "$out"

mutate '"ci": "none: fixture repository without CI workflows"' \
       '"ci": { "commands": ["true"], "workflows": "oops" }'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "ci.workflows not an array exits 1" "1" "$rc"
contains "ci.workflows not an array named" 'ci.workflows: array required' "$out"

mutate '"ci": "none: fixture repository without CI workflows"' '"ci": ["oops"]'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "ci wrong shape exits 1" "1" "$rc"
contains "ci wrong shape named" \
  'ci: must be an object {commands, workflows} or a "none: <reason>" string' "$out"

mutate '"ci": "none: fixture repository without CI workflows"' \
       '"ci": { "commands": ["true", ""], "workflows": [] }'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "ci commands junk entry exits 1" "1" "$rc"
contains "ci commands junk entry named" \
  'ci.commands: at least one non-empty command required' "$out"

mutate '"ci": "none: fixture repository without CI workflows"' \
       '"ci": { "commands": ["true"] }'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "ci.workflows missing exits 1" "1" "$rc"
contains "ci.workflows missing named" 'ci.workflows: array required' "$out"

section "ci: repo-checked commands"

mkdir -p "$W/ci_repo/.github/workflows"
cat > "$W/ci_repo/.github/workflows/ci.yml" <<'YAML'
name: CI
on: push
jobs:
  test:
    steps:
      - run: npm test
YAML

out="$(node "$LINT" "$CLEAN" --repo "$W/ci_repo" 2>&1)"; rc=$?
expect "none ci form rejected when repo has workflows exits 1" "1" "$rc"
contains "none ci form rejected when repo has workflows named" \
  "the repository has CI workflows; list their commands in ci.commands" "$out"

mutate '"ci": "none: fixture repository without CI workflows"' \
       '"ci": { "commands": ["npm test"], "workflows": [".github/workflows/missing.yml"] }'
out="$(node "$LINT" "$W/m.md" --repo "$W/ci_repo" 2>&1)"; rc=$?
expect "ci workflow path missing under repo exits 1" "1" "$rc"
contains "ci workflow path missing under repo named" \
  'ci.workflows: ".github/workflows/missing.yml" does not exist under' "$out"

mutate '"ci": "none: fixture repository without CI workflows"' \
       '"ci": { "commands": ["npm test"], "workflows": [".github/workflows/ci.yml"] }'
out="$(node "$LINT" "$W/m.md" --repo "$W/ci_repo" 2>&1)"; rc=$?
expect "ci command listed in workflow text exits 0" "0" "$rc"
check "ci command listed in workflow text has no substring-mismatch error" \
  '! grep -qF "does not appear in any listed" <<<"$out"'

mutate '"ci": "none: fixture repository without CI workflows"' \
       '"ci": { "commands": ["make lint"], "workflows": [".github/workflows/ci.yml"] }'
out="$(node "$LINT" "$W/m.md" --repo "$W/ci_repo" 2>&1)"; rc=$?
expect "ci command missing from workflow text exits 1" "1" "$rc"
contains "ci command missing from workflow text named" \
  'ci.commands: "make lint" does not appear in any listed ci.workflows file' "$out"

section "ci.workflows: path safety"

mkdir -p "$W/ci_repo/docs"
echo '# notes' > "$W/ci_repo/docs/notes.md"
mkdir -p "$W/ci_repo/.github/workflows/folder.yml"

mutate '"ci": "none: fixture repository without CI workflows"' \
       '"ci": { "commands": ["npm test"], "workflows": [".github/workflows/plan.md"] }'
out="$(node "$LINT" "$W/m.md" --repo "$W/ci_repo" 2>&1)"; rc=$?
expect "plan path as workflow exits 1" "1" "$rc"
contains "plan path as workflow named" \
  'ci.workflows: ".github/workflows/plan.md" must be a .yml/.yaml file under .github/workflows' "$out"

mutate '"ci": "none: fixture repository without CI workflows"' \
       '"ci": { "commands": ["npm test"], "workflows": ["../outside.yml"] }'
out="$(node "$LINT" "$W/m.md" --repo "$W/ci_repo" 2>&1)"; rc=$?
expect "../ workflow path exits 1" "1" "$rc"
contains "../ workflow path named" \
  'ci.workflows: "../outside.yml" must be a .yml/.yaml file under .github/workflows' "$out"

mutate '"ci": "none: fixture repository without CI workflows"' \
       '"ci": { "commands": ["npm test"], "workflows": ["/etc/ci.yml"] }'
out="$(node "$LINT" "$W/m.md" --repo "$W/ci_repo" 2>&1)"; rc=$?
expect "absolute workflow path exits 1" "1" "$rc"
contains "absolute workflow path named" \
  'ci.workflows: "/etc/ci.yml" must be a .yml/.yaml file under .github/workflows' "$out"

mutate '"ci": "none: fixture repository without CI workflows"' \
       '"ci": { "commands": ["npm test"], "workflows": ["docs/notes.md"] }'
out="$(node "$LINT" "$W/m.md" --repo "$W/ci_repo" 2>&1)"; rc=$?
expect "docs/notes.md workflow path exits 1" "1" "$rc"
contains "docs/notes.md workflow path named" \
  'ci.workflows: "docs/notes.md" must be a .yml/.yaml file under .github/workflows' "$out"

mutate '"ci": "none: fixture repository without CI workflows"' \
       '"ci": { "commands": ["npm test"], "workflows": [".github/workflows/folder.yml"] }'
out="$(node "$LINT" "$W/m.md" --repo "$W/ci_repo" 2>&1)"; rc=$?
expect "directory workflow path exits 1" "1" "$rc"
contains "directory workflow path named" \
  'ci.workflows: ".github/workflows/folder.yml" is not a file' "$out"

mutate '"ci": "none: fixture repository without CI workflows"' \
       '"ci": { "commands": ["npm test"], "workflows": [] }'
out="$(node "$LINT" "$W/m.md" --repo "$W/ci_repo" 2>&1)"; rc=$?
expect "empty workflows when repo has workflows exits 1" "1" "$rc"
contains "empty workflows when repo has workflows named" \
  'ci.workflows: required — the repository has CI workflows and none are listed' "$out"

mutate '"ci": "none: fixture repository without CI workflows"' \
       '"ci": { "commands": ["npm test"], "workflows": [".github/workflows/ci.yml"] }'
out="$(node "$LINT" "$W/m.md" --repo "$W/ci_repo" 2>&1)"; rc=$?
expect "safe workflow path under the dir exits 0" "0" "$rc"
check "safe workflow path under the dir has no path-safety error" \
  '! grep -qF "must be a .yml/.yaml file" <<<"$out"'

printf 'name: CI\non: push\njobs:\n  test:\n    steps:\n      - run: npm test\n' \
  > "$W/ci_repo/.github/workflows/..foo.yml"
mutate '"ci": "none: fixture repository without CI workflows"' \
       '"ci": { "commands": ["npm test"], "workflows": [".github/workflows/..foo.yml"] }'
out="$(node "$LINT" "$W/m.md" --repo "$W/ci_repo" 2>&1)"; rc=$?
expect "dotdot-prefixed filename inside workflows dir exits 0" "0" "$rc"
check "dotdot-prefixed filename inside workflows dir has no path-safety error" \
  '! grep -qF "must be a .yml/.yaml file" <<<"$out"'

section "ci: command matching"

cat > "$W/ci_repo/.github/workflows/matching.yml" <<'YAML'
name: Matching
on: push
jobs:
  test:
    steps:
      - run: npm ci && npm test
      - run: |
          npm run build
          npm run e2e
YAML

mutate '"ci": "none: fixture repository without CI workflows"' \
       '"ci": { "commands": ["npm"], "workflows": [".github/workflows/ci.yml"] }'
out="$(node "$LINT" "$W/m.md" --repo "$W/ci_repo" 2>&1)"; rc=$?
expect "truncated command fragment exits 1" "1" "$rc"
contains "truncated command fragment named" \
  'ci.commands: "npm" does not appear in any listed ci.workflows file' "$out"

mutate '"ci": "none: fixture repository without CI workflows"' \
       '"ci": { "commands": ["npm test"], "workflows": [".github/workflows/matching.yml"] }'
out="$(node "$LINT" "$W/m.md" --repo "$W/ci_repo" 2>&1)"; rc=$?
expect "compound command line match exits 0" "0" "$rc"
check "compound command line match has no substring-mismatch error" \
  '! grep -qF "does not appear in any listed" <<<"$out"'

mutate '"ci": "none: fixture repository without CI workflows"' \
       '"ci": { "commands": ["npm run e2e"], "workflows": [".github/workflows/matching.yml"] }'
out="$(node "$LINT" "$W/m.md" --repo "$W/ci_repo" 2>&1)"; rc=$?
expect "run block command line match exits 0" "0" "$rc"
check "run block command line match has no substring-mismatch error" \
  '! grep -qF "does not appear in any listed" <<<"$out"'

section "e2e: required end-to-end task"

mutate '  "e2e": { "task": "http-retry" },
' ''
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "missing e2e exits 1" "1" "$rc"
contains "missing e2e named" \
  'e2e: required — the task that runs the shipped fixtures end to end, or "not-applicable: <reason>"' "$out"

mutate '"e2e": { "task": "http-retry" }' '"e2e": "not-applicable: fixture has no end-to-end task"'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "e2e not-applicable form exits 0" "0" "$rc"
contains "e2e not-applicable form is clean" "OK: 0 error(s)" "$out"

mutate '"e2e": { "task": "http-retry" }' '"e2e": "not-applicable: short"'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "e2e not-applicable reason too short exits 1" "1" "$rc"
contains "e2e not-applicable reason too short named" \
  'e2e: "not-applicable: <reason>" requires a reason of at least 10 characters' "$out"

mutate '"e2e": { "task": "http-retry" }' '"e2e": { "task": "no-such-task" }'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "e2e unknown task id exits 1" "1" "$rc"
contains "e2e unknown task id named" 'e2e.task: must name a task id that exists in the plan' "$out"

mutate '"e2e": { "task": "http-retry" }' '"e2e": 123'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "e2e wrong shape exits 1" "1" "$rc"
contains "e2e wrong shape named" \
  'e2e: must be {"task": "<id>"} or a "not-applicable: <reason>" string' "$out"

python3 - "$CLEAN" "$W/m.md" <<'PY'
import json, re, sys
src, dst = sys.argv[1:]
s = open(src).read()
m = re.search(r'```json wave-plan\n(.*?)\n```', s, re.S)
plan = json.loads(m.group(1))
plan['waves'].append({
  "wave": 2,
  "supervisor": {"model": "claude-fable-5-1", "effort": "high"},
  "tasks": [{
    "id": "docs-followup",
    "branch": "wave/docs-followup",
    "executor": {"model": "claude-haiku-4-5-20251001"},
    "ladder": [],
    "contract": {
      "files_allowed": ["docs2/**"],
      "files_forbidden": [],
      "must_run": [{"cmd": "true", "evidence": "required"}],
      "forbidden_moves": [],
      "report_must_answer": ["What changed?"]
    }
  }]
})
new_json = json.dumps(plan, indent=2)
out = s[:m.start(1)] + new_json + s[m.end(1):]
out += '\n## Task docs-followup\n\nFollow-up doc work.\n'
open(dst, 'w').write(out)
PY
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "e2e task not in last wave exits 0" "0" "$rc"
contains "e2e task not in last wave warned" 'e2e.task: "http-retry" is not in the last wave' "$out"

python3 - "$CLEAN" "$W/m.md" <<'PY'
import json, re, sys
src, dst = sys.argv[1:]
s = open(src).read()
m = re.search(r'```json wave-plan\n(.*?)\n```', s, re.S)
plan = json.loads(m.group(1))
plan['waves'] = [
  { "wave": 1,
    "supervisor": {"model": "claude-fable-5-1", "effort": "high"},
    "tasks": [{
      "id": "http-prep",
      "branch": "wave/http-prep",
      "executor": {"model": "claude-sonnet-5", "effort": "medium"},
      "ladder": [],
      "contract": {
        "files_allowed": ["src/prep/**"],
        "files_forbidden": [],
        "must_run": [{"cmd": "true", "evidence": "required"}],
        "forbidden_moves": [],
        "report_must_answer": ["What changed?"]
      }
    }]
  },
  { "wave": 2,
    "supervisor": {"model": "claude-fable-5-1", "effort": "high"},
    "tasks": [{
      "id": "http-retry",
      "branch": "wave/http-retry",
      "executor": {"model": "claude-sonnet-5", "effort": "medium"},
      "ladder": ["claude-opus-5-5"],
      "contract": {
        "files_allowed": ["src/http/**"],
        "files_forbidden": ["src/auth/**"],
        "must_run": [{"cmd": "true", "evidence": "required"}],
        "forbidden_moves": ["weakening, deleting or skipping an existing test"],
        "report_must_answer": ["Which call sites now retry?"]
      }
    }]
  },
  { "wave": 3,
    "supervisor": {"model": "claude-fable-5-1", "effort": "high"},
    "tasks": [{
      "id": "docs-followup",
      "branch": "wave/docs-followup",
      "executor": {"model": "claude-haiku-4-5-20251001"},
      "ladder": [],
      "contract": {
        "files_allowed": ["docs/notes.md", "CHANGELOG.md"],
        "files_forbidden": [],
        "must_run": [{"cmd": "true", "evidence": "required"}],
        "forbidden_moves": [],
        "report_must_answer": ["What changed?"]
      }
    }]
  }
]
new_json = json.dumps(plan, indent=2)
out = s[:m.start(1)] + new_json + s[m.end(1):]
out = re.sub(r'\n## Task docs-sync\n\nUpdate the docs to describe retries\.\n', '', out)
out += '\n## Task http-prep\n\nPrep work before retries.\n'
out += '\n## Task docs-followup\n\nFollow-up doc work.\n'
open(dst, 'w').write(out)
PY
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "e2e task documentation-only later wave exits 0" "0" "$rc"
check "e2e task documentation-only later wave has no not-in-last-wave warning" \
  '! grep -qF "is not in the last wave" <<<"$out"'

python3 - "$CLEAN" "$W/m.md" <<'PY'
import json, re, sys
src, dst = sys.argv[1:]
s = open(src).read()
m = re.search(r'```json wave-plan\n(.*?)\n```', s, re.S)
plan = json.loads(m.group(1))
plan['waves'] = [
  { "wave": 1,
    "supervisor": {"model": "claude-fable-5-1", "effort": "high"},
    "tasks": [{
      "id": "http-prep",
      "branch": "wave/http-prep",
      "executor": {"model": "claude-sonnet-5", "effort": "medium"},
      "ladder": [],
      "contract": {
        "files_allowed": ["src/prep/**"],
        "files_forbidden": [],
        "must_run": [{"cmd": "true", "evidence": "required"}],
        "forbidden_moves": [],
        "report_must_answer": ["What changed?"]
      }
    }]
  },
  { "wave": 2,
    "supervisor": {"model": "claude-fable-5-1", "effort": "high"},
    "tasks": [{
      "id": "http-retry",
      "branch": "wave/http-retry",
      "executor": {"model": "claude-sonnet-5", "effort": "medium"},
      "ladder": ["claude-opus-5-5"],
      "contract": {
        "files_allowed": ["src/http/**"],
        "files_forbidden": ["src/auth/**"],
        "must_run": [{"cmd": "true", "evidence": "required"}],
        "forbidden_moves": ["weakening, deleting or skipping an existing test"],
        "report_must_answer": ["Which call sites now retry?"]
      }
    }]
  },
  { "wave": 3,
    "supervisor": {"model": "claude-fable-5-1", "effort": "high"},
    "tasks": [{
      "id": "src-followup",
      "branch": "wave/src-followup",
      "executor": {"model": "claude-sonnet-5", "effort": "medium"},
      "ladder": [],
      "contract": {
        "files_allowed": ["src/other/**"],
        "files_forbidden": [],
        "must_run": [{"cmd": "true", "evidence": "required"}],
        "forbidden_moves": [],
        "report_must_answer": ["What changed?"]
      }
    }]
  }
]
new_json = json.dumps(plan, indent=2)
out = s[:m.start(1)] + new_json + s[m.end(1):]
out = re.sub(r'\n## Task docs-sync\n\nUpdate the docs to describe retries\.\n', '', out)
out += '\n## Task http-prep\n\nPrep work before retries.\n'
out += '\n## Task src-followup\n\nFollow-up source work.\n'
open(dst, 'w').write(out)
PY
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "e2e task documentation-only later wave with src exits 0" "0" "$rc"
contains "e2e task documentation-only later wave with src still warned" \
  'e2e.task: "http-retry" is not in the last wave' "$out"

section "premium approval"

mutate '"e2e": { "task": "http-retry" },
  "approvals": { "premium": { "models": ["claude-fable-5-1"],
    "reason": "Fable required for narrative QA judging on this wave.",
    "approved_by": "fixture", "date": "2026-09-24" } }' \
  '"e2e": { "task": "http-retry" }'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "premium model without approval exits 1" "1" "$rc"
contains "premium model without approval named" \
  'premium model claude-fable-5-1 requires approvals.premium (models, reason, approved_by, date) recorded at Gate 1' "$out"

mutate '"reason": "Fable required for narrative QA judging on this wave.",' '"reason": "too short",'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "premium reason too short exits 1" "1" "$rc"
contains "premium reason too short named" \
  'approvals.premium.reason: at least 10 non-space characters required' "$out"

mutate '"approved_by": "fixture",' '"approved_by": "",'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "premium approved_by empty exits 1" "1" "$rc"
contains "premium approved_by empty named" \
  'approvals.premium.approved_by: non-empty string required' "$out"

mutate '"date": "2026-09-24" } }' '"date": "2026-02-30" } }'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "premium impossible date exits 1" "1" "$rc"
contains "premium impossible date named" \
  'approvals.premium.date: must be a real calendar date (YYYY-MM-DD)' "$out"

mutate '"date": "2026-09-24" } }' '"date": "2026-13-45" } }'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "premium regex-matching but impossible date exits 1" "1" "$rc"
contains "premium regex-matching but impossible date named" \
  'approvals.premium.date: must be a real calendar date (YYYY-MM-DD)' "$out"
check "premium regex-matching but impossible date prints no stack trace" \
  '! grep -qiE "RangeError|Invalid time value|at Object" <<<"$out"'

mutate '"models": ["claude-fable-5-1"],' '"models": ["gpt-6-astra"],'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "premium mismatched model exits 1" "1" "$rc"
contains "premium mismatched model named" \
  'premium model claude-fable-5-1 requires approvals.premium (models, reason, approved_by, date) recorded at Gate 1' "$out"

python3 - "$CODEX_CLEAN" "$W/m.md" <<'PY'
import sys
src, dst = sys.argv[1:]
s = open(src).read()
s = s.replace('"model": "gpt-5.6-terra", "effort": "high"',
              '"model": "gpt-6-astra", "effort": "high"')
s = s.replace('"ladder": ["gpt-5.6-sol"],',
              '"ladder": ["gpt-6-astra"],\n        "astra_executor_reason": "Required final escalation.",')
open(dst, 'w').write(s)
PY
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "Astra ladder rung without premium approval exits 1" "1" "$rc"
contains "Astra ladder rung without premium approval named" \
  'premium model gpt-6-astra requires approvals.premium (models, reason, approved_by, date) recorded at Gate 1' "$out"

mutate '"models": ["claude-fable-5-1"],' '"models": ["claude-fable-5-1", "gpt-6-astra"],'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "unused premium model still exits 0" "0" "$rc"
contains "unused premium model warned" \
  'approvals.premium.models: "gpt-6-astra" is listed but never used in the plan' "$out"

section "retired-route warnings"

out="$(node "$LINT" "$CODEX_CLEAN" 2>&1)"; rc=$?
expect "codex-clean plan with retired routes still exits 0" "0" "$rc"
contains "gpt-5.6-terra retired route warned" \
  'retired route: gpt-5.6-terra is not chosen for new plans (GPT-6 Sol/Luna replace it)' "$out"
contains "gpt-5.6-luna retired route warned" \
  'retired route: gpt-5.6-luna is not chosen for new plans (GPT-6 Sol/Luna replace it)' "$out"
contains "gpt-5.6-sol retired route warned" \
  'retired route: gpt-5.6-sol is not chosen for new plans (GPT-6 Sol/Luna replace it)' "$out"

out="$(node "$LINT" "$GPT6_CLEAN" 2>&1)"
check "GPT-6 ids are not flagged as retired routes" '! grep -qF "retired route:" <<<"$out"'

mutate '"model": "claude-sonnet-5"' '"model": "claude-opus-5"'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "opus-5 executor still exits 0" "0" "$rc"
contains "opus-5 executor retired route warned" \
  'retired route: Opus 5 is no longer an executor route (use claude-opus-5-5)' "$out"

mutate '"model": "claude-sonnet-5"' '"model": "claude-opus-4-8"'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "opus-4-8 executor still exits 0" "0" "$rc"
contains "opus-4-8 executor warned" "Opus 4.8 is routed only for compiled-binary work" "$out"

mutate '"ladder": ["claude-opus-5-5"]' '"ladder": ["claude-opus-4-8"]'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "opus-4-8 ladder rung still exits 0" "0" "$rc"
contains "opus-4-8 ladder rung warned" "Opus 4.8 is routed only for compiled-binary work" "$out"

section "review: Codex final-review child"

codex_mutate '"e2e": { "task": "divide-guard" }' \
  '"e2e": { "task": "divide-guard" },
  "review": { "model": "gpt-6-astra", "effort": "high" },
  "approvals": { "premium": { "models": ["gpt-6-astra"],
    "reason": "Astra reviews the final diff before merge.",
    "approved_by": "fixture", "date": "2026-09-24" } }'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "review Astra with approval exits 0" "0" "$rc"
contains "review Astra with approval is clean" "OK: 0 error(s)" "$out"

codex_mutate '"e2e": { "task": "divide-guard" }' \
  '"e2e": { "task": "divide-guard" },
  "review": { "model": "gpt-6-astra", "effort": "high" }'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "review Astra without approval exits 1" "1" "$rc"
contains "review Astra without approval named" \
  'review.model: premium model gpt-6-astra requires approvals.premium (models, reason, approved_by, date) recorded at Gate 1' "$out"

codex_mutate '"e2e": { "task": "divide-guard" }' \
  '"e2e": { "task": "divide-guard" },
  "review": { "model": "gpt-6-sol", "effort": "medium" }'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "review valid Sol exits 0" "0" "$rc"
contains "review valid Sol is clean" "OK: 0 error(s)" "$out"

codex_mutate '"e2e": { "task": "divide-guard" }' \
  '"e2e": { "task": "divide-guard" },
  "review": { "model": "gpt-6-luna", "effort": "medium" }'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "review bad model exits 1" "1" "$rc"
contains "review bad model named" \
  'review.model: one of gpt-6-astra/gpt-6-sol — the Codex final-review child chosen at Gate 1' "$out"

codex_mutate '"e2e": { "task": "divide-guard" }' \
  '"e2e": { "task": "divide-guard" },
  "review": { "model": "gpt-6-sol", "effort": "bogus" }'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "review bad effort exits 1" "1" "$rc"
contains "review bad effort named" "review.effort: one of low/medium/high/xhigh/max" "$out"

mutate '"e2e": { "task": "http-retry" },' \
  '"e2e": { "task": "http-retry" },
  "review": { "model": "gpt-6-sol", "effort": "medium" },'
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "Claude plan with review exits 1" "1" "$rc"
contains "Claude plan with review named" \
  'review: only Codex plans name a final-review child; Claude reviews run in the session' "$out"

python3 - "$GPT6_CLEAN" "$W/m.md" <<'PY'
import sys
src, dst = sys.argv[1:]
s = open(src).read()
s = s.replace('"supervisor": { "model": "gpt-6-astra", "effort": "high" },',
              '"supervisor": { "model": "gpt-6-sol", "effort": "high" },')
s = s.replace('        "ladder": ["gpt-6-sol"],\n', '')
s = s.replace('"e2e": { "task": "divide-guard" },',
              '"e2e": { "task": "divide-guard" },\n  "review": { "model": "gpt-6-astra", "effort": "high" },')
open(dst, 'w').write(s)
PY
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "Astra only as review model exits 0" "0" "$rc"
check "Astra only as review model prints no never-used warning" \
  '! grep -qF "is listed but never used in the plan" <<<"$out"'

python3 - "$GPT6_CLEAN" "$W/m2.md" <<'PY'
import sys
src, dst = sys.argv[1:]
s = open(src).read()
s = s.replace('"supervisor": { "model": "gpt-6-astra", "effort": "high" },',
              '"supervisor": { "model": "gpt-6-sol", "effort": "high" },')
s = s.replace('        "ladder": ["gpt-6-sol"],\n', '')
s = s.replace('"e2e": { "task": "divide-guard" },',
              '"e2e": { "task": "divide-guard" },\n  "review": { "model": "gpt-6-astra", "effort": "high" },')
s = s.replace('"date": "2026-09-24"', '"date": "2026-02-30"')
open(dst, 'w').write(s)
PY
out="$(node "$LINT" "$W/m2.md" 2>&1)"; rc=$?
expect "Astra only as review model with impossible approval date exits 1" "1" "$rc"
contains "Astra only as review model with impossible approval date named" \
  'approvals.premium.date: must be a real calendar date (YYYY-MM-DD)' "$out"

section "parallelism: single-task-wave width warning"

# Builds a plan with one wave per entry in $1 (a Python list literal of task
# counts, e.g. "[1, 1, 1]"), each task a distinct, valid single-file task, and
# the last wave's last task named as e2e.task. $2 = target path. $3 = "section"
# to also add a "## Parallelism" heading, exercising the escape hatch.
build_width_plan() {  # $1 = counts, $2 = dst, $3 = "section" (optional)
  python3 - "$CLEAN" "$2" "$1" "${3:-}" <<'PY'
import json, re, sys
src, dst, counts_src, add_section = sys.argv[1:5]
s = open(src).read()
m = re.search(r'```json wave-plan\n(.*?)\n```', s, re.S)
plan = json.loads(m.group(1))
counts = json.loads(counts_src)
waves = []
tasks_flat = []
tid = 0
for wi, n in enumerate(counts, start=1):
    tasks = []
    for _ in range(n):
        tid += 1
        name = 'w%d-t%d' % (wi, tid)
        tasks.append({
            "id": name,
            "branch": "wave/" + name,
            "executor": {"model": "claude-sonnet-5", "effort": "medium"},
            "ladder": ["claude-opus-5-5"],
            "contract": {
                "files_allowed": ["src/" + name + "/**"],
                "files_forbidden": [],
                "must_run": [{"cmd": "true", "evidence": "required"}],
                "forbidden_moves": [],
                "report_must_answer": ["What changed?"]
            }
        })
        tasks_flat.append(name)
    waves.append({"wave": wi, "supervisor": {"model": "claude-fable-5-1", "effort": "high"}, "tasks": tasks})
plan['waves'] = waves
plan['e2e'] = {"task": tasks_flat[-1]}
prose = '\n'.join('## Task %s\n\nWork for %s.\n' % (t, t) for t in tasks_flat)
heading = '# Plan — width test\n\n'
if add_section == 'section':
  heading += '## Parallelism\n\nEach single-task wave depends on the prior wave completing.\n\n'
out = 'status: draft\nbase: pending\n\n' + heading + '```json wave-plan\n' \
  + json.dumps(plan, indent=2) + '\n```\n\n' + prose
open(dst, 'w').write(out)
PY
}

build_width_plan '[1, 1, 1]' "$W/m.md"
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "3 of 3 single-task waves exits 0" "0" "$rc"
contains "3 of 3 single-task waves warned" \
  'parallelism: 3 of 3 waves hold a single task' "$out"

build_width_plan '[1, 1, 1]' "$W/m.md" section
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "3 of 3 single-task waves with Parallelism section exits 0" "0" "$rc"
check "3 of 3 single-task waves with Parallelism section has no parallelism warning" \
  '! grep -qF "parallelism:" <<<"$out"'

build_width_plan '[1, 1, 2]' "$W/m.md"
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "2 of 3 single-task waves exits 0" "0" "$rc"
contains "2 of 3 single-task waves warned" \
  'parallelism: 2 of 3 waves hold a single task' "$out"

build_width_plan '[1, 1, 2, 2]' "$W/m.md"
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "2 of 4 single-task waves exits 0" "0" "$rc"
check "2 of 4 single-task waves has no parallelism warning" \
  '! grep -qF "parallelism:" <<<"$out"'

build_width_plan '[1, 1]' "$W/m.md"
out="$(node "$LINT" "$W/m.md" 2>&1)"; rc=$?
expect "2 of 2 single-task waves exits 0" "0" "$rc"
check "2 of 2 single-task waves has no parallelism warning" \
  '! grep -qF "parallelism:" <<<"$out"'

summary
