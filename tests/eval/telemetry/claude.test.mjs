// Offline tests for the telemetry CLI's `claude` subcommand. Builds a
// synthetic Claude Code session transcript (one orchestrator plus two
// agents: a direct background Agent-tool subagent under
// <session>/subagents/, and a workflow-run agent under
// <session>/subagents/workflows/<run-id>/, both hand-authored with exact
// minute-spaced timestamps) in a temp directory and asserts exact minutes,
// tokens, costs and concurrency. Never reads real ~/.claude transcripts.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const CLI = fileURLToPath(new URL('./telemetry.mjs', import.meta.url))

const SESSION = 'session-0000-0000-0000-000000000000'
const EXEC = 'exec-1111-1111-1111-111111111111'
const SUPER = 'super-2222-2222-2222-222222222222'

const BASE = Date.parse('2026-09-23T00:00:00.000Z')
const at = minutes => new Date(BASE + minutes * 60000).toISOString()
const row = (minutes, type, fields) => ({ timestamp: at(minutes), type, ...fields })
const userText = (minutes, text) => row(minutes, 'user', { message: { content: text } })
const toolResult = (minutes, toolUseId, content) =>
  row(minutes, 'user', { message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content }] } })
const assistant = (minutes, model, usage, content) =>
  row(minutes, 'assistant', { message: { model, usage, content } })
const toolUse = (id, name, input = {}) => ({ type: 'tool_use', id, name, input })
const usage = (input, cacheCreation, cacheRead, output) =>
  ({ input_tokens: input, cache_creation_input_tokens: cacheCreation, cache_read_input_tokens: cacheRead, output_tokens: output })

function jsonl(rows) {
  return rows.map(r => JSON.stringify(r)).join('\n') + '\n'
}

function buildFixture() {
  const dir = mktempDir()
  const projectDir = join(dir, 'projects', 'test-project')
  mkdirSync(projectDir, { recursive: true })

  // --- orchestrator ------------------------------------------------------
  // Turn A: 1 min model, a "Bash" tool call open 2 min ("tool:Bash"), then
  // 1 min model, then a final (no tool_use) assistant reply ends the turn
  // (model total so far = 2 min). Gap to the next real user message: 5 min
  // "user". Turn B: one assistant message opens two "Task" calls (spawns
  // both agents) after 1 min "model" (model total = 3 min); the executor's
  // tool_result lands after 3 min ("waiting"), the supervisor's after
  // another 4 min ("waiting", total waiting = 7 min); a final 1 min "model"
  // (total = 4 min) ends the turn.
  const rootRows = [
    userText(0, 'Do the task'),
    assistant(1, 'claude-opus-5-5', usage(1000, 0, 0, 200), [toolUse('b1', 'Bash')]),
    toolResult(3, 'b1', 'ok'),
    assistant(4, 'claude-opus-5-5', usage(1500, 0, 0, 300), [{ type: 'text', text: 'done with step one' }]),
    userText(9, 'Now spawn helpers'),
    assistant(10, 'claude-opus-5-5', usage(600, 0, 0, 50), [
      toolUse('s1', 'Task', { agent: 'executor' }),
      toolUse('s2', 'Task', { agent: 'supervisor' }),
    ]),
    toolResult(13, 's1', 'executor done'),
    toolResult(17, 's2', 'supervisor done'),
    assistant(18, 'claude-opus-5-5', usage(2000, 0, 200, 400), [{ type: 'text', text: 'all done' }]),
  ]

  // --- executor agent (direct background Agent-tool subagent) -----------
  // 1 min model, "Read" tool call open 1 min, then 1 min model. Wall = 3 min.
  const execRows = [
    userText(10, 'do X'),
    assistant(11, 'claude-sonnet-5', usage(400, 0, 0, 80), [toolUse('e1', 'Read')]),
    toolResult(12, 'e1', 'file contents'),
    assistant(13, 'claude-sonnet-5', usage(200, 0, 0, 40), [{ type: 'text', text: 'read done' }]),
  ]

  // --- supervisor agent (workflow-run agent, nested under workflows/) ---
  // 2 min model, a "Task" call open 4 min ("waiting"), then 1 min model.
  // Wall = 7 min.
  const superRows = [
    userText(10, 'spawn helper'),
    assistant(12, 'claude-haiku-4-5-20251001', usage(300, 0, 0, 60), [toolUse('p1', 'Task')]),
    toolResult(16, 'p1', 'helper done'),
    assistant(17, 'claude-haiku-4-5-20251001', usage(100, 0, 0, 20), [{ type: 'text', text: 'helper reported back' }]),
  ]

  const rootPath = join(projectDir, `${SESSION}.jsonl`)
  writeFileSync(rootPath, jsonl(rootRows))

  const subagentsDir = join(projectDir, SESSION, 'subagents')
  mkdirSync(subagentsDir, { recursive: true })
  writeFileSync(join(subagentsDir, `agent-${EXEC}.jsonl`), jsonl(execRows))
  writeFileSync(join(subagentsDir, `agent-${EXEC}.meta.json`), JSON.stringify({ label: 'executor-alpha' }))

  const workflowDir = join(subagentsDir, 'workflows', 'run-1')
  mkdirSync(workflowDir, { recursive: true })
  writeFileSync(join(workflowDir, 'journal.jsonl'), jsonl([row(10, 'workflow_event', { message: { content: 'spawned' } })]))
  writeFileSync(join(workflowDir, `agent-${SUPER}.jsonl`), jsonl(superRows))
  writeFileSync(join(workflowDir, `agent-${SUPER}.meta.json`), JSON.stringify({ label: 'supervisor-beta' }))

  const pricesPath = join(dir, 'prices.json')
  writeFileSync(pricesPath, JSON.stringify({
    'claude-opus-5-5': [4, 0.4, 20],
    'claude-sonnet-5': [3, 0.3, 15],
    'claude-haiku-4-5-20251001': [1, 0.1, 5],
  }))

  return { dir, rootPath, pricesPath }
}

function mktempDir() {
  return mkdtempSync(join(tmpdir(), 'telemetry-claude-test-'))
}

function run(fixture, extraArgs = []) {
  return spawnSync(process.execPath, [CLI, 'claude', '--transcript', fixture.rootPath,
    '--prices', fixture.pricesPath, '--json', ...extraArgs], { encoding: 'utf8', timeout: 10000 })
}

test('CLI usage: missing subcommand and missing --transcript are rejected', () => {
  const noSub = spawnSync(process.execPath, [CLI], { encoding: 'utf8' })
  assert.notEqual(noSub.status, 0)
  assert.match(noSub.stderr, /usage: node telemetry\.mjs claude --transcript/)

  const noTranscript = spawnSync(process.execPath, [CLI, 'claude'], { encoding: 'utf8' })
  assert.notEqual(noTranscript.status, 0)
  assert.match(noTranscript.stderr, /--transcript is required/)
})

test('report: orchestrator time split, requests, token stats', t => {
  const fixture = buildFixture()
  t.after(() => rmSync(fixture.dir, { recursive: true, force: true }))
  const result = run(fixture)
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)

  assert.equal(report.window.from, at(0))
  assert.equal(report.window.to, at(18))

  assert.equal(report.orchestrator.id, SESSION)
  assert.equal(report.orchestrator.model, 'claude-opus-5-5')
  assert.equal(report.orchestrator.effort, null)
  assert.deepEqual(report.orchestrator.minutes, {
    model: 4, 'tool:Bash': 2, waiting: 7, user: 5,
  })
  assert.equal(report.orchestrator.requests, 4)
  assert.equal(report.orchestrator.medianInputTokens, 1250)
  assert.equal(report.orchestrator.meanInputTokens, 1275)
  assert.equal(report.orchestrator.compactions, 0)
})

test('report: per-child role, model, wall time and model-vs-tool minutes', t => {
  const fixture = buildFixture()
  t.after(() => rmSync(fixture.dir, { recursive: true, force: true }))
  const result = run(fixture)
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)

  assert.equal(report.children.length, 2)
  const byId = Object.fromEntries(report.children.map(c => [c.id, c]))

  assert.equal(byId[EXEC].role, 'executor')
  assert.equal(byId[EXEC].model, 'claude-sonnet-5')
  assert.equal(byId[EXEC].wallMinutes, 3)
  assert.equal(byId[EXEC].requests, 2)
  assert.equal(byId[EXEC].tokens.total, 720)
  assert.equal(byId[EXEC].modelMinutes, 2)
  assert.equal(byId[EXEC].toolMinutes, 1)

  assert.equal(byId[SUPER].role, 'supervisor')
  assert.equal(byId[SUPER].model, 'claude-haiku-4-5-20251001')
  assert.equal(byId[SUPER].wallMinutes, 7)
  assert.equal(byId[SUPER].modelMinutes, 3)
  assert.equal(byId[SUPER].toolMinutes, 4)
})

test('report: concurrency buckets', t => {
  const fixture = buildFixture()
  t.after(() => rmSync(fixture.dir, { recursive: true, force: true }))
  const result = run(fixture)
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)

  assert.deepEqual(report.concurrency, { '0': 11, '1': 4, '2': 3, '3+': 0 })
  assert.equal(report.threadLimitErrors, 0)
})

test('report: cost by role x model, priced from prices.json, cache writes priced as input', t => {
  const fixture = buildFixture()
  t.after(() => rmSync(fixture.dir, { recursive: true, force: true }))
  const result = run(fixture)
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)

  assert.equal(report.cost.unpriced.length, 0)
  const byRoleModel = Object.fromEntries(report.cost.byRoleModel.map(g => [`${g.role}/${g.model}`, g]))

  assert.equal(byRoleModel['orchestrator/claude-opus-5-5'].tokens.total, 5100 + 200 + 950)
  assert.equal(byRoleModel['orchestrator/claude-opus-5-5'].cost, 0.03948)
  assert.equal(byRoleModel['executor/claude-sonnet-5'].cost, 0.0036)
  assert.equal(byRoleModel['supervisor/claude-haiku-4-5-20251001'].cost, 0.0008)
  assert.equal(report.cost.total, 0.04388)
})

test('unpriced model is listed as unpriced, never guessed', t => {
  const fixture = buildFixture()
  t.after(() => rmSync(fixture.dir, { recursive: true, force: true }))
  // Give the executor agent a model with no entry in prices.json.
  const unknownPath = join(fixture.dir, 'projects', 'test-project', SESSION, 'subagents', `agent-${EXEC}.jsonl`)
  const rows = [
    userText(10, 'do X'),
    assistant(11, 'claude-unknown-9', usage(400, 0, 0, 80), [toolUse('e1', 'Read')]),
    toolResult(12, 'e1', 'file contents'),
    assistant(13, 'claude-unknown-9', usage(200, 0, 0, 40), [{ type: 'text', text: 'read done' }]),
  ]
  writeFileSync(unknownPath, jsonl(rows))

  const result = run(fixture)
  assert.equal(result.status, 0, result.stderr)
  const report = JSON.parse(result.stdout)

  const unpriced = report.cost.unpriced.find(g => g.role === 'executor')
  assert.ok(unpriced, 'expected an unpriced executor/claude-unknown-9 group')
  assert.equal(unpriced.model, 'claude-unknown-9')
  assert.equal(unpriced.tokens.total, 720)
  assert.ok(!report.cost.byRoleModel.some(g => g.model === 'claude-unknown-9'), 'unknown model must never get a guessed price')
})

test('readable table output (non-JSON) mentions the key sections', t => {
  const fixture = buildFixture()
  t.after(() => rmSync(fixture.dir, { recursive: true, force: true }))
  const result = spawnSync(process.execPath, [CLI, 'claude', '--transcript', fixture.rootPath,
    '--prices', fixture.pricesPath], { encoding: 'utf8', timeout: 10000 })
  assert.equal(result.status, 0, result.stderr)
  for (const marker of ['window:', 'orchestrator:', 'children:', 'concurrency', 'thread-limit errors:', 'cost by role x model:']) {
    assert.ok(result.stdout.includes(marker), `expected table output to include "${marker}"`)
  }
})
