import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { validateCodexWave, makeState, nextAction } from '../../plugins/orchestration/skills/multi-model/references/codex-wave-state.mjs'

const skills = 'plugins/orchestration/skills/'
const refs = skills + 'multi-model/references/'
const read = path => readFileSync(path, 'utf8')

test('all entrypoints and Codex profiles resolve the packaged route', () => {
  for (const name of ['multi-model', 'super-plan', 'ship']) {
    assert.match(read(skills + name + '/SKILL.md'), /codex-routing\.md/)
  }
  for (const name of ['gpt-5-6-sol', 'gpt-5-6-terra', 'gpt-5-6-luna', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna', 'generic']) {
    const profile = read(refs + 'orchestrator-' + name + '.md')
    assert.match(profile, /codex-routing\.md/)
    assert.doesNotMatch(profile, /Do not author a production GPT-5\.6|Return `unsupported`/)
  }
  assert.match(read(refs + 'codex-routing.md'), /gpt-calibration-evidence\.md/)
  assert.match(read(refs + 'gpt-calibration-evidence.md'), /63\/87/)
})

test('documented task routes lint and dispatch with exact model, effort, isolation and separate supervisor', () => {
  const rows = [...read(refs + 'codex-routing.md').matchAll(/^\| (mechanical|ordinary|difficult) \| `([^`]+)` \| `([^`]+)` \| (.*?) \|$/gm)]
  assert.equal(rows.length, 3)
  const expected = {
    mechanical: ['gpt-6-luna', 'medium', ['gpt-6-sol']],
    ordinary: ['gpt-6-sol', 'medium', []],
    difficult: ['gpt-6-sol', 'high', []],
  }
  const root = mkdtempSync(join(tmpdir(), 'codex-authoring-'))
  try {
    for (const [, kind, model, effort, ladderText] of rows) {
      const ladder = [...ladderText.matchAll(/`([^`]+)`/g)].map(m => m[1])
      assert.deepEqual([model, effort, ladder], expected[kind])
      const doc = read('tests/fixtures/plans/codex-clean.md')
      const wave = JSON.parse(doc.match(/```json wave-plan\n([\s\S]*?)\n```/)[1]).waves[0]
      wave.supervisor = { model: 'gpt-6-astra', effort: 'high' }
      wave.tasks[0].executor = { model, effort }
      wave.tasks[0].ladder = ladder
      assert.deepEqual(validateCodexWave(wave, 0), [])
      const planPath = join(root, kind + '.md')
      writeFileSync(planPath, doc.replace(/```json wave-plan\n[\s\S]*?\n```/, '```json wave-plan\n' + JSON.stringify({ waves: [wave] }) + '\n```'))
      const lint = spawnSync(process.execPath, [skills + 'super-plan/references/plan-lint.mjs', planPath], { encoding: 'utf8' })
      assert.equal(lint.status, 0, lint.stdout + lint.stderr)
      const state = makeState({ planPath, planDigest: 'test', waveNumber: 1, repoPath: root, base: 'a'.repeat(40), wave })
      const action = nextAction(state)
      assert.equal(action.action, 'spawn-executor')
      assert.equal(action.model, model)
      assert.equal(action.effort, effort)
      assert.equal(action.worktree, join(root, '.worktrees/wave-divide-guard'))
      state.tasks['divide-guard'].status = 'verified'
      const review = nextAction(state)
      assert.equal(review.action, 'spawn-supervisor')
      assert.equal(review.model, 'gpt-6-astra')
      assert.equal(review.effort, 'high')
      assert.ok(![model, ...ladder].includes(review.model))
      const mixed = structuredClone(wave)
      mixed.supervisor.model = 'opus'
      assert.ok(validateCodexWave(mixed, 0).length)
      const missingEffort = structuredClone(wave)
      delete missingEffort.tasks[0].executor.effort
      assert.ok(validateCodexWave(missingEffort, 0).length)
    }
  } finally { rmSync(root, { recursive: true, force: true }) }
})
