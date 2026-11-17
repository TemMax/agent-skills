import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { validateCodexWave, makeState, nextAction } from '../../plugins/orchestration/skills/multi-model/references/codex-wave-state.mjs'

const skills = 'plugins/orchestration/skills/'
const refs = skills + 'multi-model/references/'
const read = path => readFileSync(path, 'utf8')
const readSkill = path => {
  const entry = read(path)
  return entry.includes('[WORKFLOW.md](WORKFLOW.md)')
    ? entry + '\n' + read(join(dirname(path), 'WORKFLOW.md')) : entry
}

test('all entrypoints and Codex profiles resolve the packaged route', () => {
  for (const name of ['multi-model', 'super-plan', 'ship']) {
    assert.match(readSkill(skills + name + '/SKILL.md'), /codex-routing\.md/)
    assert.match(readSkill('plugins/orchestration/skills-codex/' + name + '/SKILL.md'), /codex-routing\.md/)
  }
  for (const name of ['gpt-5-6-sol', 'gpt-5-6-terra', 'gpt-5-6-luna', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-1-sol', 'gpt-6-luna', 'generic']) {
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
    mechanical: ['gpt-6-luna', 'medium', ['gpt-6.2-sol']],
    ordinary: ['gpt-6.2-sol', 'medium', []],
    difficult: ['gpt-6.2-sol', 'high', []],
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
      // Top-level plan keys: no CI in this fixture, the wave's single task
      // doubles as the e2e task, and approvals.premium is required because
      // the supervisor above is gpt-6-astra.
      const planObject = {
        waves: [wave],
        ci: 'none: this fixture repo has no CI to run',
        e2e: { task: 'divide-guard' },
        approvals: {
          premium: {
            models: ['gpt-6-astra'],
            reason: 'wave supervisor',
            approved_by: 'codex-authoring-route-test',
            date: '2026-09-24',
          },
        },
      }
      const planPath = join(root, kind + '.md')
      writeFileSync(planPath, doc.replace(/```json wave-plan\n[\s\S]*?\n```/, '```json wave-plan\n' + JSON.stringify(planObject) + '\n```'))
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

test('both packages resolve the two exact 6.2 seats from each skill', () => {
  for (const tree of ['skills', 'skills-codex']) {
    for (const name of ['multi-model', 'super-plan', 'ship', 'critical-review']) {
      const review = name === 'critical-review'
      const path = join('plugins', review ? 'code-review' : 'orchestration', tree, name)
      const source = name === 'multi-model' ? 'SKILL.md' : review ? 'PROFILE.md' : 'WORKFLOW.md'
      const rows = read(join(path, source)).split('\n')
      for (const model of ['gpt-6.2-astra', 'gpt-6.2-sol']) {
        const matches = rows.filter(row => row.startsWith('| `' + model + '` |'))
        assert.equal(matches.length, 1, path + ': ' + model)
        const profile = matches[0].split('`')[3]
        assert.ok(profile.endsWith((review ? 'reviewer-' : 'orchestrator-') + model.replace('.', '-') + '.md'))
        assert.ok(read(join(path, profile)).includes('exact active host ID `' + model + '`'))
      }
    }
  }
})

test('Astra execution, escalation and final review preserve the exact authorized generation', () => {
  const fixture = read('tests/fixtures/plans/codex-clean-gpt6.md')
  const block = /```json wave-plan\n([\s\S]*?)\n```/
  const original = JSON.parse(fixture.match(block)[1])
  const astra = 'gpt-6.2-astra'
  const previous = 'gpt-6-astra'
  const sol = 'gpt-6.2-sol'
  const root = mkdtempSync(join(tmpdir(), 'gpt62-approvals-'))
  function assertRoute({ executor = sol, ladder = [], supervisor = sol, approval = [], reason, review, error, waveError }) {
    const plan = structuredClone(original)
    const wave = plan.waves[0]
    const task = wave.tasks[0]
    wave.supervisor.model = supervisor
    task.executor.model = executor
    task.ladder = ladder
    if (reason) task.astra_executor_reason = 'User requested a premium implementation experiment.'
    if (approval.length) plan.approvals.premium.models = approval
    else delete plan.approvals
    if (review) plan.review = { model: review, effort: 'high' }
    const validation = validateCodexWave(wave, 0)
    if (waveError) assert.match(validation.join('\n'), waveError)
    else assert.deepEqual(validation, [])
    const planPath = join(root, 'plan.md')
    writeFileSync(planPath, fixture.replace(block, '```json wave-plan\n' + JSON.stringify(plan) + '\n```'))
    const lint = spawnSync(process.execPath, [skills + 'super-plan/references/plan-lint.mjs', planPath], { encoding: 'utf8' })
    const output = lint.stdout + lint.stderr
    if (error) {
      assert.notEqual(lint.status, 0, output)
      assert.match(output, error)
    } else assert.equal(lint.status, 0, output)
  }
  try {
    assertRoute({})
    assertRoute({ review: sol })
    assertRoute({ executor: 'gpt-6-luna', ladder: [sol] })
    for (const id of [astra, previous]) {
      assertRoute({ executor: id, supervisor: id, approval: [id], reason: true })
      assertRoute({ ladder: [id], supervisor: id, approval: [id], reason: true })
      assertRoute({ review: id, approval: [id] })
    }
    assertRoute({ executor: astra, supervisor: astra, reason: true, error: /requires approvals.premium/ })
    assertRoute({ supervisor: astra, approval: [previous], error: /requires approvals.premium/ })
    assertRoute({ review: astra, approval: [previous], error: /requires approvals.premium/ })
    assertRoute({ executor: astra, supervisor: previous, reason: true, approval: [astra, previous],
      waveError: /exact gpt-6.2-astra supervisor/, error: /supervisor/ })
    assertRoute({ ladder: [previous, astra], supervisor: previous, approval: [previous, astra], reason: true,
      waveError: /must be the final/, error: /must be the final/ })
    assertRoute({ executor: astra, supervisor: astra, approval: [astra],
      waveError: /astra_executor_reason/, error: /astra_executor_reason/ })
    assertRoute({ executor: 'gpt-6.2', waveError: /executor.model/, error: /executor.model/ })
    assertRoute({ executor: 'claude-sonnet-5-5', waveError: /host-mismatch/, error: /host-mismatch|mixes providers/i })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
