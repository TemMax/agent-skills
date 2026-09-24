// Runs a script produced by wave-launch.mjs through the simulator with
// args undefined, so the only way the wave reaches the runner is the embedded
// WAVE_ARGS line. No model calls.
// Run: node tests/lib/wave-launch.test.mjs <generated-file> <plan-file> <base> <repo>
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { runWorkflow } from './workflow-sim.mjs'

const [GEN, PLAN, BASE, REPO] = process.argv.slice(2)
assert.ok(GEN && PLAN && BASE && REPO, 'usage: wave-launch.test.mjs <generated> <plan> <base> <repo>')

const here = dirname(fileURLToPath(import.meta.url))
const REFS = join(here, '..', '..', 'plugins', 'orchestration', 'skills', 'multi-model', 'references')

// Green facts whose changed path sits inside each fixture task's files_allowed.
const ALLOWED_PATH = { 'http-retry': 'src/http/client.js', 'docs-sync': 'docs/retries.md' }

function agentStub(prompt, opts = {}) {
  const id = (prompt.match(/wave\/([a-z0-9-]+)/) ?? [])[1]
  const label = opts.label ?? ''
  if (label.startsWith('verify:')) {
    return { branchHasCommits: true, filesChanged: [ALLOWED_PATH[id]],
      mustRun: [{ cmd: 'true', exit: 0, output: '(exit 0)', pasteFoundInReport: true }], notes: [] }
  }
  if (label.startsWith('judge:')) return { ok: true, violations: [], remarks: [] }
  return 'report for ' + id + '\ncommitted on wave/' + id + '\n$ true\n(exit 0)'
}

const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('W1 the embedded WAVE_ARGS is the exact runner input built from the plan', async () => {
  const src = await readFile(GEN, 'utf8')
  const line = src.split('\n').find((l) => l.startsWith('const WAVE_ARGS = '))
  assert.ok(line, 'WAVE_ARGS line present')
  const input = JSON.parse(line.slice('const WAVE_ARGS = '.length))
  assert.deepEqual(Object.keys(input),
    ['base', 'defaultBranch', 'repoPath', 'supervisorPromptText', 'supervisor', 'tasks'])
  assert.equal(input.base, BASE)
  assert.equal(input.defaultBranch, 'main')
  assert.equal(input.repoPath, REPO)
  assert.equal(input.supervisorPromptText, await readFile(join(REFS, 'supervisor-prompt.md'), 'utf8'))
  assert.deepEqual(input.supervisor, { model: 'claude-fable-5-1', effort: 'high' })
  assert.deepEqual(input.tasks.map((t) => t.id), ['http-retry', 'docs-sync'])
  for (const t of input.tasks) assert.ok(!('branch' in t), t.id + ' carries no branch')
  assert.equal(input.tasks[0].description,
    'Add retry with backoff to the HTTP client. Full description and code go here.')
  assert.equal(input.tasks[1].description, 'Update the docs to describe retries.')
  const plan = await readFile(PLAN, 'utf8')
  const json = JSON.parse(plan.match(/```json wave-plan\r?\n([\s\S]*?)\r?\n```/)[1])
  const { branch, ...planTask } = json.waves[0].tasks[0]
  assert.deepEqual({ ...input.tasks[0], description: undefined }, { ...planTask, description: undefined })
})

test('W2 args undefined: the generated script runs the wave from WAVE_ARGS alone', async () => {
  const { result, calls } = await runWorkflow(GEN, { args: undefined, agentStub })
  assert.equal(result.status, 'done', JSON.stringify(result.errors ?? result))
  assert.deepEqual(result.tasks.map((t) => [t.id, t.status]), [['http-retry', 'ok'], ['docs-sync', 'ok']])
  const exec = calls.filter((c) => (c.opts.label ?? '') === 'exec:http-retry')
  assert.equal(exec.length, 1)
  assert.ok(exec[0].prompt.includes('Add retry with backoff'), 'executor prompt carries the task prose')
  assert.ok(exec[0].prompt.includes(BASE), 'executor prompt carries the base sha')
  assert.equal(exec[0].opts.model, 'claude-sonnet-5')
  const judge = calls.filter((c) => (c.opts.label ?? '') === 'judge:http-retry')
  assert.equal(judge.length, 1)
  assert.equal(judge[0].opts.model, 'claude-fable-5-1')
})

let failed = 0
for (const t of tests) {
  try { await t.fn(); console.log('ok -', t.name) }
  catch (e) { failed++; console.log('not ok -', t.name); console.log('   ', e.message) }
}
process.exit(failed ? 1 : 0)
