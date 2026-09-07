import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const cli = fileURLToPath(new URL('./codex-rollouts.mjs', import.meta.url))
const parentId = '01a07c4f-5707-7603-8795-b094af15439f'
const childIds = ['01a07c4f-7ba5-7b61-8f78-f701e6001789', '01a07c4f-9b15-7192-9391-4ac9b1a7cea2']
const event = (type, payload) => ({ timestamp: '2026-09-07T23:59:59Z', type, payload })
const jsonl = rows => rows.map(JSON.stringify).join('\n') + '\n'
const activity = (i, kind) => event('event_msg', { type: 'item_completed', thread_id: parentId,
  turn_id: 'parent-turn', item: { type: 'SubAgentActivity', id: kind === 'started' ? `call-${i}` : `subagent-completed-child-turn-${i}`,
    kind, agent_thread_id: childIds[i], agent_path: `/root/task_${i}` } })

// Hand-authored, minimal 0.153.4 V2 boundary fixtures. No real session content.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'codex-rollouts-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const sessions = join(root, 'sessions'), dest = join(root, 'capture')
  const days = ['2026/09/07', '2026/09/08']
  for (const day of days) mkdirSync(join(sessions, day), { recursive: true })
  const parent = [event('session_meta', { id: parentId, session_id: parentId, cli_version: '0.153.4', agent_path: '/root' }),
    event('turn_context', { turn_id: 'parent-turn', model: 'gpt-6-astra', effort: 'medium', multi_agent_version: 'v2' })]
  const children = childIds.map((id, i) => {
    const model = ['gpt-5.6-luna', 'gpt-6-astra'][i], effort = ['medium', 'high'][i]
    parent.push(event('response_item', { type: 'function_call', namespace: 'collaboration', name: 'spawn_agent',
      call_id: `call-${i}`, arguments: JSON.stringify({ task_name: `task_${i}`, model,
        reasoning_effort: effort, fork_turns: 'none', message: `gAAAA-fixture-${i}` }) }),
    event('response_item', { type: 'function_call_output', call_id: `call-${i}`, output: JSON.stringify({ task_name: `/root/task_${i}` }) }),
    activity(i, 'started'), activity(i, 'completed'))
    return [event('session_meta', { id, parent_thread_id: parentId, session_id: parentId,
      agent_path: `/root/task_${i}`, cli_version: '0.153.4' }),
    event('turn_context', { turn_id: `child-turn-${i}`, root_turn_id: 'parent-turn', model, effort, multi_agent_version: 'v2' }),
    event('response_item', { type: 'agent_message', author: '/root', recipient: `/root/task_${i}`,
      content: [{ type: 'input_text', text: 'Message Type: NEW_TASK\nPayload:\n' },
        { type: 'encrypted_content', encrypted_content: `gAAAA-fixture-${i}` }] }),
    event('event_msg', { type: 'task_complete', turn_id: `child-turn-${i}` })]
  })
  const paths = [parentId, ...childIds].map((id, i) => join(sessions, days[i === 0 ? 0 : 1], `rollout-fixture-${id}.jsonl`))
  const input = jsonl([{ type: 'thread.started', thread_id: parentId }, { type: 'turn.completed', usage: {} }])
  const save = () => [parent, ...children].forEach((rows, i) => writeFileSync(paths[i], jsonl(rows)))
  const run = (stdin = input) => spawnSync(process.execPath, [cli, '--sessions', sessions, '--output', dest], { input: stdin, encoding: 'utf8', timeout: 5000 })
  save()
  return { root, sessions, dest, parent, children, paths, save, run, input }
}
const report = f => JSON.parse(readFileSync(join(f.dest, 'report.json'), 'utf8'))

test('real CLI root metadata has null path, but still binds by session ID', t => {
  const f = fixture(t)
  f.parent[0].payload.agent_path = null
  f.parent[0].payload.parent_thread_id = null
  f.save()
  assert.equal(f.run().status, 0)
  assert.equal(report(f).routing, 'verified-runtime-records')
})

test('two children cannot reuse one spawn call while leaving another call unmatched', t => {
  const f = fixture(t)
  const start = f.parent[8].payload.item, completion = f.parent[9].payload.item
  start.id = 'call-0'
  start.agent_path = completion.agent_path = '/root/task_0'
  f.children[1][0].payload.agent_path = '/root/task_0'
  f.children[1][1].payload.model = 'gpt-5.6-luna'
  f.children[1][1].payload.effort = 'medium'
  f.children[1][2].payload.recipient = '/root/task_0'
  f.children[1][2].payload.content[1].encrypted_content = 'gAAAA-fixture-0'
  f.save()
  assert.equal(f.run().status, 0)
  assert.equal(report(f).routing, 'unverified')
})

test('captures only linked rollouts across midnight; distinguishes route, delivery and plaintext', t => {
  const f = fixture(t)
  // Reading unrelated bodies would fail; filename discovery alone must suffice.
  writeFileSync(join(f.sessions, '2026/09/07/rollout-unrelated.jsonl'), 'NOT JSON: unrelated private data')
  const result = f.run()
  assert.equal(result.status, 0, result.stderr)
  const r = report(f)
  assert.equal(r.capture, 'complete')
  assert.equal(r.routing, 'verified-runtime-records')
  assert.equal(r.delivery, 'identical-ciphertext')
  assert.equal(r.plaintextPromptBinding, 'unverified-encrypted')
  assert.equal(r.fullWaveQualification, false)
  assert.deepEqual(r.spawns.map(x => [x.childId, x.model, x.effort]), [
    [childIds[0], 'gpt-5.6-luna', 'medium'], [childIds[1], 'gpt-6-astra', 'high']])
  assert.deepEqual(readdirSync(join(f.dest, 'rollouts')).sort(), [parentId, ...childIds].map(x => x + '.jsonl').sort())
  for (const [i, artifact] of r.artifacts.entries()) {
    const bytes = readFileSync(f.paths[i])
    assert.deepEqual(readFileSync(join(f.dest, 'rollouts', artifact.id + '.jsonl')), bytes)
    assert.equal(artifact.sha256, createHash('sha256').update(bytes).digest('hex'))
    assert.equal(statSync(join(f.dest, 'rollouts', artifact.id + '.jsonl')).mode & 0o777, 0o600)
  }
  assert.equal(statSync(f.dest).mode & 0o777, 0o700)
  assert.equal(statSync(join(f.dest, 'report.json')).mode & 0o777, 0o600)
  assert.equal(f.run().status, 73, 'never overwrite a recorded capture')
})

// Each mutation must remove a specific evidentiary claim without erasing raw data.
for (const [name, mutate] of [
  ['wrong model', f => f.children[0][1].payload.model = 'gpt-5.6-sol'],
  ['wrong effort', f => f.children[0][1].payload.effort = 'high'],
  ['wrong parent', f => f.children[0][0].payload.parent_thread_id = childIds[1]],
  ['not a root session', f => f.parent[0].payload.parent_thread_id = childIds[1]],
  ['wrong root session ID', f => f.parent[0].payload.session_id = childIds[1]],
  ['wrong session', f => f.children[0][0].payload.session_id = childIds[1]],
  ['wrong task path', f => f.children[0][0].payload.agent_path = '/root/other'],
  ['wrong root turn', f => f.children[0][1].payload.root_turn_id = 'other-turn'],
  ['unbound call', f => f.parent.find(x => x.payload?.item?.kind === 'started').payload.item.id = 'other-call'],
  ['missing call output', f => f.parent.splice(3, 1)],
  ['missing completion', f => f.parent.splice(5, 1)],
  ['completion for another turn', f => f.parent[5].payload.item.id = 'subagent-completed-other-turn'],
  ['different delivered payload', f => f.children[0][2].payload.content[1].encrypted_content = 'other'],
  ['ambiguous child turn', f => f.children[0].push(structuredClone(f.children[0][1]))],
  ['unknown CLI format', f => f.parent[0].payload.cli_version = '9.0.0'],
  ['missing effort', f => delete f.children[0][1].payload.effort],
  ['no launches', f => f.parent.splice(2)],
  ['duplicate start', f => f.parent.push(structuredClone(f.parent[4]))],
  ['unexpected nested delegation', f => f.children[0].push(event('response_item', { type: 'function_call', namespace: 'collaboration', name: 'spawn_agent' }))],
]) test(`does not verify ${name}`, t => {
  const f = fixture(t)
  mutate(f); f.save()
  assert.equal(f.run().status, 0)
  const r = report(f)
  assert.equal(r.routing, 'unverified')
  assert.notEqual(r.plaintextPromptBinding, 'verified')
  assert.equal(r.fullWaveQualification, false)
  assert.ok(r.problems.length > 0)
  assert.ok(r.artifacts.some(x => x.id === parentId))
})

for (const mode of ['missing', 'duplicate', 'symlink', 'malformed', 'truncated', 'wrong-id']) {
  test(`retains diagnostic failure for ${mode} child without accepting other sessions`, t => {
    const f = fixture(t)
    if (mode === 'missing') rmSync(f.paths[1])
    if (mode === 'duplicate') writeFileSync(join(f.sessions, `2026/09/07/rollout-copy-${childIds[0]}.jsonl`), readFileSync(f.paths[1]))
    if (mode === 'symlink') { rmSync(f.paths[1]); symlinkSync(f.paths[2], f.paths[1]) }
    if (mode === 'malformed') writeFileSync(f.paths[1], 'not json\n')
    if (mode === 'truncated') writeFileSync(f.paths[1], jsonl(f.children[0]) + '{')
    if (mode === 'wrong-id') { f.children[0][0].payload.id = childIds[1]; f.save() }
    assert.equal(f.run().status, 0)
    const r = report(f)
    assert.equal(r.routing, 'unverified')
    assert.ok(r.problems.length)
    assert.ok(r.artifacts.some(x => x.id === parentId))
  })
}

for (const input of ['not-json', jsonl([{ type: 'thread.started', thread_id: '../../other' }]),
  jsonl([{ type: 'thread.started', thread_id: parentId }, { type: 'thread.started', thread_id: childIds[0] }])]) {
  test('invalid or ambiguous CLI identity never falls back to latest session', t => {
    const f = fixture(t)
    assert.equal(f.run(input).status, 0)
    const r = report(f)
    assert.equal(r.capture, 'partial')
    assert.equal(r.routing, 'unverified')
    assert.deepEqual(r.artifacts, [])
  })
}
