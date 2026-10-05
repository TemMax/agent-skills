#!/usr/bin/env bash
# Codex skills live in skills-codex/ beside the Claude skills. Each pair must
# satisfy the split contract, and the Codex super-plan example must lint clean.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

export PYTHONDONTWRITEBYTECODE=1
CHECK=tests/lib/codex-skill-check.py
LINT=plugins/orchestration/skills/super-plan/references/plan-lint.mjs
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

section "Codex/Claude skill pair contract"
for pair in \
  "orchestration multi-model" \
  "orchestration super-plan" \
  "orchestration ship" \
  "code-review critical-review"; do
  set -- $pair
  plugin="$1"; name="$2"
  out="$(python3 "$CHECK" "plugins/$plugin/skills/$name/SKILL.md" "plugins/$plugin/skills-codex/$name/SKILL.md" "$name" 2>&1)"; rc=$?
  expect "codex-skill-check exits 0: $plugin/$name" "0" "$rc"
  if [ "$rc" -ne 0 ]; then printf '%s\n' "$out"; fi
done

section "Codex super-plan canonical example"
if ! command -v node >/dev/null 2>&1; then
  fail "node is required for this test and was not found on PATH"
  summary; exit 1
fi
python3 tests/lib/skill-source.py plugins/orchestration/skills-codex/super-plan/SKILL.md > "$W/source.md"
if node --input-type=module - "$W/source.md" "$W/documented.md" <<'JS'
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
writeFileSync(target, 'status: draft\nbase: pending\n\n```json wave-plan\n'
  + JSON.stringify(plan, null, 2) + '\n```\n\n' + prose)
JS
then
  out="$(node "$LINT" "$W/documented.md" 2>&1)"; rc=$?
  expect "Codex SKILL.md example exits 0" "0" "$rc"
  contains "Codex SKILL.md example is lint-clean" "OK: 0 error(s)" "$out"
  printf '%s\n' "$out"
else
  fail "Codex SKILL.md example could not be extracted"
fi

summary
