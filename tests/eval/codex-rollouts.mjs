// Optional diagnostic collector, NOT an alternative wave scorer.
// Observed format: Codex 0.153.4, V2, one turn per direct child, isolated forks.
import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const requireFact = (ok, reason) => { if (!ok) throw new Error(reason) }
const one = (items, reason) => { requireFact(items.length === 1, reason); return items[0] }
const jsonl = bytes => {
  const rows = bytes.toString('utf8').split('\n').filter(x => x.trim()).map(JSON.parse)
  requireFact(rows.length && rows.every(x => x && typeof x === 'object' && !Array.isArray(x)), 'invalid-jsonl')
  return rows
}
const meta = rows => one(rows.filter(x => x.type === 'session_meta'), 'ambiguous-session-meta').payload
const contexts = rows => rows.filter(x => x.type === 'turn_context').map(x => x.payload)
const activities = rows => rows.filter(x => x.type === 'event_msg' && x.payload?.type === 'item_completed'
  && x.payload.item?.type === 'SubAgentActivity').map(x => x.payload)
const calls = rows => rows.filter(x => x.type === 'response_item' && x.payload?.type === 'function_call'
  && x.payload.name === 'spawn_agent').map(x => x.payload)

// Discover names, never search unrelated session bodies. Date directories allow
// midnight crossings; flat UUID filenames also allow replay from a saved capture.
function filenames(root, depth = 0) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name)
    if (entry.isDirectory() && depth < 3 && (depth === 0 ? /^\d{4}$/ : /^\d{2}$/).test(entry.name)) {
      return filenames(path, depth + 1)
    }
    return entry.name.endsWith('.jsonl') && !entry.isDirectory() ? [path] : []
  })
}

function verifySpawn(parentId, parent, child, activity) {
  const pm = meta(parent), cm = meta(child)
  requireFact(pm.cli_version === '0.153.4' && cm.cli_version === pm.cli_version, 'unsupported-cli-version')
  requireFact((pm.agent_path == null || pm.agent_path === '/root') && pm.parent_thread_id == null
    && pm.session_id === parentId, 'unsupported-parent-path')
  const pc = one(contexts(parent), 'unsupported-parent-turns')
  const cc = one(contexts(child), 'unsupported-child-turns')
  requireFact(pc.multi_agent_version === 'v2' && cc.multi_agent_version === 'v2', 'unsupported-agent-version')
  const call = one(calls(parent).filter(x => x.call_id === activity.item.id), 'unbound-spawn-call')
  const args = JSON.parse(call.arguments)
  requireFact(call.namespace === 'collaboration' && typeof call.call_id === 'string' && call.call_id, 'invalid-spawn-call')
  requireFact(typeof args.task_name === 'string' && /^[a-z0-9_]+$/.test(args.task_name), 'invalid-task-name')
  const path = '/root/' + args.task_name
  requireFact(args.fork_turns === 'none', 'unsupported-fork')
  const output = one(parent.filter(x => x.type === 'response_item' && x.payload?.type === 'function_call_output'
    && x.payload.call_id === call.call_id), 'missing-or-duplicate-call-output').payload
  requireFact(JSON.parse(output.output).task_name === path, 'wrong-call-output-path')
  requireFact(activity.thread_id === parentId && activity.turn_id === pc.turn_id
    && activity.item.agent_path === path, 'wrong-start-link')
  requireFact(cm.id === activity.item.agent_thread_id && cm.parent_thread_id === parentId
    && cm.session_id === parentId && cm.agent_path === path, 'wrong-child-link')
  requireFact(typeof pc.turn_id === 'string' && pc.turn_id && typeof cc.turn_id === 'string' && cc.turn_id
    && cc.root_turn_id === pc.turn_id, 'wrong-root-turn')
  requireFact(typeof args.model === 'string' && args.model && cc.model === args.model, 'wrong-model')
  requireFact(typeof args.reasoning_effort === 'string' && args.reasoning_effort
    && cc.effort === args.reasoning_effort, 'wrong-effort')
  requireFact(calls(child).length === 0, 'unsupported-nested-delegation')
  const completed = one(activities(parent).filter(x => x.item.kind === 'completed'
    && x.item.agent_thread_id === cm.id), 'missing-or-duplicate-completion')
  requireFact(completed.thread_id === parentId && completed.turn_id === pc.turn_id
    && completed.item.agent_path === path && completed.item.id === 'subagent-completed-' + cc.turn_id, 'wrong-completion-link')
  one(child.filter(x => x.type === 'event_msg' && x.payload?.type === 'task_complete'
    && x.payload.turn_id === cc.turn_id), 'missing-child-completion')
  const input = one(child.filter(x => x.type === 'response_item' && x.payload?.type === 'agent_message'
    && x.payload.author === '/root' && x.payload.recipient === path), 'ambiguous-delivered-task').payload
  const ciphertext = one(input.content.filter(x => x.type === 'encrypted_content'), 'unsupported-payload-format').encrypted_content
  requireFact(typeof ciphertext === 'string' && ciphertext && ciphertext === args.message, 'payload-mismatch')
  return { task: args.task_name, callId: call.call_id, childId: cm.id, turnId: cc.turn_id,
    model: cc.model, effort: cc.effort, ciphertextSha256: sha256(ciphertext) }
}

function collect(sessions, output, input) {
  const report = { schema: 1, scope: 'direct-isolated-spawns-single-turn', capture: 'complete', parentId: null,
    routing: 'unverified', delivery: 'unverified', plaintextPromptBinding: 'unverified',
    fullWaveQualification: false, spawns: [], artifacts: [], problems: [] }
  mkdirSync(join(output, 'rollouts'), { mode: 0o700 })
  let names, totalBytes = 0
  const loaded = new Map()
  function load(id) {
    if (loaded.has(id)) return loaded.get(id)
    try {
      requireFact(typeof id === 'string' && uuid.test(id), 'invalid-thread-id')
      const path = one(names.filter(x => basename(x) === id + '.jsonl'
        || basename(x).endsWith('-' + id + '.jsonl')), 'missing-or-duplicate-rollout')
      const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      let bytes
      try {
        const before = fstatSync(fd)
        requireFact(before.isFile() && before.size <= 64 * 1024 * 1024, 'unsupported-rollout-file')
        requireFact(totalBytes + before.size <= 128 * 1024 * 1024, 'capture-size-limit')
        bytes = readFileSync(fd)
        const after = fstatSync(fd)
        requireFact(bytes.length === before.size && after.size === before.size
          && after.mtimeMs === before.mtimeMs, 'rollout-changed-during-capture')
      } finally { closeSync(fd) }
      totalBytes += bytes.length
      let rows, parseError
      try { rows = jsonl(bytes) } catch { parseError = true }
      if (rows) requireFact(meta(rows).id === id, 'wrong-rollout-identity')
      writeFileSync(join(output, 'rollouts', id + '.jsonl'), bytes, { flag: 'wx', mode: 0o600 })
      report.artifacts.push({ id, sha256: sha256(bytes), bytes: bytes.length })
      requireFact(!parseError, 'malformed-rollout')
      loaded.set(id, rows)
      return rows
    } catch (error) {
      report.capture = 'partial'
      report.problems.push({ threadId: id, reason: error.code || (error instanceof SyntaxError ? 'invalid-json' : error.message) })
      return null
    }
  }
  try {
    let events
    try { events = jsonl(input) } catch { throw new Error('invalid-cli-events') }
    const rootEvent = one(events.filter(x => x.type === 'thread.started'), 'ambiguous-cli-thread')
    requireFact(typeof rootEvent.thread_id === 'string' && uuid.test(rootEvent.thread_id), 'invalid-cli-thread')
    report.parentId = rootEvent.thread_id
    names = filenames(realpathSync(sessions))
    const parent = load(report.parentId)
    requireFact(parent, 'parent-rollout-unavailable')
    const started = activities(parent).filter(x => x.item.kind === 'started')
    requireFact(started.length > 0 && started.length <= 64, 'unsupported-spawn-count')
    requireFact(new Set(started.map(x => x.item.agent_thread_id)).size === started.length
      && started.every(x => x.item.agent_thread_id !== report.parentId), 'duplicate-or-self-child')
    const callIds = calls(parent).map(x => x.call_id), startIds = started.map(x => x.item.id)
    requireFact(callIds.length === started.length && new Set(callIds).size === callIds.length
      && new Set(startIds).size === startIds.length && startIds.every(id => callIds.includes(id)), 'unmatched-spawn-activity')
    for (const activity of started) {
      const childId = activity.item.agent_thread_id, child = load(childId)
      if (!child) continue
      try { report.spawns.push(verifySpawn(report.parentId, parent, child, activity)) }
      catch (error) { report.problems.push({ threadId: childId, reason: error instanceof SyntaxError ? 'invalid-call-json' : error.message }) }
    }
    if (!report.problems.length && report.spawns.length === started.length) {
      report.routing = 'verified-runtime-records'
      report.delivery = 'identical-ciphertext'
      report.plaintextPromptBinding = 'unverified-encrypted'
    }
  } catch (error) {
    report.capture = 'partial'
    report.problems.push({ reason: error.code || error.message })
  }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
  return report
}

try {
  const args = process.argv.slice(2)
  const opts = {}
  for (let i = 0; i < args.length; i += 2) {
    requireFact(['--sessions', '--output'].includes(args[i]) && args[i + 1] && !opts[args[i]], 'invalid-arguments')
    opts[args[i]] = args[i + 1]
  }
  requireFact(opts['--output'], 'usage: codex-rollouts.mjs --output NEW_DIRECTORY [--sessions DIRECTORY]; CLI JSONL on stdin')
  const output = resolve(opts['--output'])
  requireFact(lstatSync(dirname(output)).isDirectory(), 'output-parent-must-be-directory')
  // Nonrecursive mkdir refuses existing directories and symlinks; never overwrite.
  try { mkdirSync(output, { mode: 0o700 }) }
  catch (error) { if (error.code === 'EEXIST') process.exit(73); throw error }
  const sessions = opts['--sessions'] || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')
  const report = collect(sessions, output, readFileSync(0))
  // Exit 0 means diagnostics were written, not that routing or the wave passed.
  console.log(JSON.stringify({ capture: report.capture, routing: report.routing, plaintextPromptBinding: report.plaintextPromptBinding }))
} catch (error) {
  console.error('rollout capture failed:', error.code || error.message)
  process.exitCode = 74
}
