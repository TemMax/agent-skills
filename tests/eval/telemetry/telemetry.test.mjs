// Offline tests for the telemetry CLI. Builds a synthetic Codex run (one
// root rollout plus two direct children and one grandchild, all
// hand-authored with exact minute-spaced timestamps) in a temp directory and
// asserts exact minutes, costs, concurrency and a thread-limit error. Never
// reads real ~/.codex sessions.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const CLI = fileURLToPath(new URL('./telemetry.mjs', import.meta.url))
const PRICES = fileURLToPath(new URL('./prices.json', import.meta.url))

const ROOT = 'root-0000-0000-0000-000000000000'
const EXEC = 'exec-1111-1111-1111-111111111111'
const SUPER = 'super-2222-2222-2222-222222222222'
const GRANDCHILD = 'gc-3333-3333-3333-333333333333'

const BASE = Date.parse('2026-09-23T00:00:00.000Z')
const at = minutes => new Date(BASE + minutes * 60000).toISOString()
const row = (minutes, type, payload) => ({ timestamp: at(minutes), type, payload })
const call = (minutes, callId, name) => row(minutes, 'response_item', { type: 'function_call', call_id: callId, name })
const callOutput = (minutes, callId, output) => row(minutes, 'response_item', { type: 'function_call_output', call_id: callId, output })
const usage = (minutes, input, cached, output, reasoning) =>
  row(minutes, 'token_usage_record', { usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: reasoning } })

function jsonl(rows) {
  return rows.map(r => JSON.stringify(r)).join('\n') + '\n'
}

function buildFixture() {
  const dir = mktempDir()
  const sessions = join(dir, 'sessions', '2026', '09', '23')
  mkdirSync(sessions, { recursive: true })

  // --- root (orchestrator) --------------------------------------------
  // Turn A: 2 min "model", then an exec call open 2 min ("tool:exec"),
  // then 1 min "model", then task_complete (model = 3 min so far).
  // Gap to next task_started: 4 min "user".
  // Turn B: three spawn_agent calls (1 min each -> tool:spawn_agent): a
  // success (executor child), a thread-limit failure, a success
  // (supervisor child); then wait_agent open 4 min ("waiting"); then 1
  // min "model" (total model = 4 min), a compacted record, task_complete.
  const rootRows = [
    row(0, 'session_meta', { id: ROOT, cwd: '/repo', cli_version: '0.155.0' }),
    row(0, 'turn_context', { model: 'gpt-6-astra', effort: 'high' }),
    row(0, 'event_msg', { type: 'task_started' }),
    usage(2, 1000, 0, 200, 0),
    call(2, 't1', 'exec'),
    callOutput(4, 't1', 'ok'),
    usage(4, 1500, 0, 300, 0),
    row(5, 'event_msg', { type: 'task_complete' }),
    row(9, 'event_msg', { type: 'task_started' }),
    row(9, 'turn_context', { model: 'gpt-6-astra', effort: 'high' }),
    call(9, 's1', 'spawn_agent'),
    callOutput(10, 's1', JSON.stringify({ task_name: '/root/task_executor_alpha' })),
    call(10, 's2', 'spawn_agent'),
    callOutput(11, 's2', 'collab spawn failed: agent thread limit reached'),
    call(11, 's3', 'spawn_agent'),
    usage(11, 600, 0, 50, 0),
    callOutput(12, 's3', JSON.stringify({ task_name: '/root/task_supervisor_beta' })),
    call(12, 'w1', 'wait_agent'),
    callOutput(16, 'w1', 'ok'),
    usage(16, 2000, 200, 400, 100),
    row(17, 'compacted', {}),
    row(17, 'event_msg', { type: 'task_complete' }),
  ]

  // --- executor child ---------------------------------------------------
  // 2 min tool:exec, then 1 min model, then task_complete. Wall = 3 min.
  const execRows = [
    row(9, 'session_meta', { id: EXEC, parent_thread_id: ROOT, agent_path: '/root/task_executor_alpha', cli_version: '0.155.0' }),
    row(9, 'turn_context', { model: 'gpt-5.6-sol', effort: 'medium' }),
    row(9, 'event_msg', { type: 'task_started' }),
    call(9, 'e1', 'exec'),
    callOutput(11, 'e1', 'ok'),
    usage(11, 400, 0, 80, 0),
    row(12, 'event_msg', { type: 'task_complete' }),
  ]

  // --- supervisor child ---------------------------------------------------
  // 2 min model, spawns a grandchild, waits 4 min, 1 min model. Wall = 7 min.
  const superRows = [
    row(11, 'session_meta', { id: SUPER, parent_thread_id: ROOT, agent_path: '/root/task_supervisor_beta', cli_version: '0.155.0' }),
    row(11, 'turn_context', { model: 'gpt-6-sol', effort: 'medium' }),
    row(11, 'event_msg', { type: 'task_started' }),
    call(13, 'p1', 'spawn_agent'),
    callOutput(13, 'p1', JSON.stringify({ task_name: '/root/task_helper_gamma' })),
    call(13, 'p2', 'wait_agent'),
    callOutput(17, 'p2', 'ok'),
    usage(17, 300, 0, 60, 0),
    row(18, 'event_msg', { type: 'task_complete' }),
  ]

  // --- grandchild (spawned by the supervisor, not the root) ------------
  // 1 min model. Wall = 1 min. Role classifies as "other".
  const grandchildRows = [
    row(13, 'session_meta', { id: GRANDCHILD, parent_thread_id: SUPER, agent_path: '/root/task_helper_gamma', cli_version: '0.155.0' }),
    row(13, 'turn_context', { model: 'gpt-6-luna', effort: 'low' }),
    row(13, 'event_msg', { type: 'task_started' }),
    usage(14, 100, 0, 20, 0),
    row(14, 'event_msg', { type: 'task_complete' }),
  ]

  const rootPath = join(sessions, `rollout-root-${ROOT}.jsonl`)
  writeFileSync(rootPath, jsonl(rootRows))
  writeFileSync(join(sessions, `rollout-exec-${EXEC}.jsonl`), jsonl(execRows))
  writeFileSync(join(sessions, `rollout-super-${SUPER}.jsonl`), jsonl(superRows))
  writeFileSync(join(sessions, `rollout-gc-${GRANDCHILD}.jsonl`), jsonl(grandchildRows))

  return { dir, rootPath, sessionsDir: join(dir, 'sessions') }
}

function mktempDir() {
  return mkdtempSync(join(tmpdir(), 'telemetry-codex-test-'))
}

function run(fixture, extraArgs = []) {
  return spawnSync(process.execPath, [CLI, 'codex', '--root', fixture.rootPath, '--sessions', fixture.sessionsDir,
    '--prices', PRICES, '--json', ...extraArgs], { encoding: 'utf8', timeout: 10000 })
}

test('CLI usage: missing subcommand and missing --root are rejected', () => {
  const noSub = spawnSync(process.execPath, [CLI], { encoding: 'utf8' })
  assert.notEqual(noSub.status, 0)
  assert.match(noSub.stderr, /usage: node telemetry\.mjs codex --root/)

  const noRoot = spawnSync(process.execPath, [CLI, 'codex'], { encoding: 'utf8' })
  assert.notEqual(noRoot.status, 0)
  assert.match(noRoot.stderr, /--root is required/)
})

test('report: orchestrator time split, requests, compactions', t => {
  const fixture = buildFixture()
  t.after(() => rmSync(fixture.dir, { recursive: true, force: true }))
  const result = run(fixture)
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)

  assert.equal(report.window.from, at(0))
  assert.equal(report.window.to, at(18))

  assert.equal(report.orchestrator.id, ROOT)
  assert.equal(report.orchestrator.model, 'gpt-6-astra')
  assert.equal(report.orchestrator.effort, 'high')
  assert.deepEqual(report.orchestrator.minutes, {
    model: 4, 'tool:exec': 2, 'tool:spawn_agent': 3, waiting: 4, user: 4,
  })
  assert.equal(report.orchestrator.requests, 4)
  assert.equal(report.orchestrator.medianInputTokens, 1250)
  assert.equal(report.orchestrator.meanInputTokens, 1275)
  assert.equal(report.orchestrator.compactions, 1)
})

test('report: per-child role, model, wall time and model-vs-tool minutes', t => {
  const fixture = buildFixture()
  t.after(() => rmSync(fixture.dir, { recursive: true, force: true }))
  const result = run(fixture)
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)

  assert.equal(report.children.length, 3)
  const byId = Object.fromEntries(report.children.map(c => [c.id, c]))

  assert.equal(byId[EXEC].role, 'executor')
  assert.equal(byId[EXEC].model, 'gpt-5.6-sol')
  assert.equal(byId[EXEC].wallMinutes, 3)
  assert.equal(byId[EXEC].requests, 1)
  assert.equal(byId[EXEC].tokens.total, 480)
  assert.equal(byId[EXEC].modelMinutes, 1)
  assert.equal(byId[EXEC].toolMinutes, 2)

  assert.equal(byId[SUPER].role, 'supervisor')
  assert.equal(byId[SUPER].model, 'gpt-6-sol')
  assert.equal(byId[SUPER].wallMinutes, 7)
  assert.equal(byId[SUPER].modelMinutes, 3)
  assert.equal(byId[SUPER].toolMinutes, 4)

  assert.equal(byId[GRANDCHILD].role, 'other')
  assert.equal(byId[GRANDCHILD].model, 'gpt-6-luna')
  assert.equal(byId[GRANDCHILD].wallMinutes, 1)
  assert.equal(byId[GRANDCHILD].modelMinutes, 1)
  assert.equal(byId[GRANDCHILD].toolMinutes, 0)
})

test('report: concurrency buckets and one thread-limit error', t => {
  const fixture = buildFixture()
  t.after(() => rmSync(fixture.dir, { recursive: true, force: true }))
  const result = run(fixture)
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)

  assert.deepEqual(report.concurrency, { '0': 9, '1': 7, '2': 2, '3+': 0 })
  assert.equal(report.threadLimitErrors, 1)
})

test('report: cost by role x model, priced from prices.json', t => {
  const fixture = buildFixture()
  t.after(() => rmSync(fixture.dir, { recursive: true, force: true }))
  const result = run(fixture)
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)

  assert.equal(report.cost.unpriced.length, 0)
  const byRoleModel = Object.fromEntries(report.cost.byRoleModel.map(g => [`${g.role}/${g.model}`, g]))

  assert.equal(byRoleModel['orchestrator/gpt-6-astra'].tokens.total, 5100 + 200 + 950 + 100)
  assert.equal(byRoleModel['orchestrator/gpt-6-astra'].cost, 0.1037)
  assert.equal(byRoleModel['executor/gpt-5.6-sol'].cost, 0.0032)
  assert.equal(byRoleModel['supervisor/gpt-6-sol'].cost, 0.0012)
  assert.equal(byRoleModel['other/gpt-6-luna'].cost, 0.00002)
  assert.equal(report.cost.total, 0.10812)
})

test('unpriced model is listed as unpriced, never guessed', t => {
  const fixture = buildFixture()
  t.after(() => rmSync(fixture.dir, { recursive: true, force: true }))
  // Give the executor child a model with no entry in prices.json.
  const unknownPath = join(fixture.sessionsDir, '2026', '09', '23', `rollout-exec-${EXEC}.jsonl`)
  const rows = [
    row(9, 'session_meta', { id: EXEC, parent_thread_id: ROOT, agent_path: '/root/task_executor_alpha', cli_version: '0.155.0' }),
    row(9, 'turn_context', { model: 'gpt-9-unknown', effort: 'medium' }),
    row(9, 'event_msg', { type: 'task_started' }),
    usage(11, 400, 0, 80, 0),
    row(12, 'event_msg', { type: 'task_complete' }),
  ]
  writeFileSync(unknownPath, jsonl(rows))

  const result = run(fixture)
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)

  const unpriced = report.cost.unpriced.find(g => g.role === 'executor')
  assert.ok(unpriced, 'expected an unpriced executor/gpt-9-unknown group')
  assert.equal(unpriced.model, 'gpt-9-unknown')
  assert.equal(unpriced.tokens.total, 480)
  assert.ok(!report.cost.byRoleModel.some(g => g.model === 'gpt-9-unknown'), 'unknown model must never get a guessed price')
})

test('readable table output (non-JSON) mentions the key sections', t => {
  const fixture = buildFixture()
  t.after(() => rmSync(fixture.dir, { recursive: true, force: true }))
  const result = spawnSync(process.execPath, [CLI, 'codex', '--root', fixture.rootPath, '--sessions', fixture.sessionsDir,
    '--prices', PRICES], { encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0, result.stderr)
  for (const marker of ['window:', 'orchestrator:', 'children:', 'concurrency', 'thread-limit errors:', 'cost by role x model:']) {
    assert.ok(result.stdout.includes(marker), `expected table output to include "${marker}"`)
  }
})
