#!/usr/bin/env node
// Claude CLI transport for the shipped Workflow policy. Verification is code.
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { recoveryScope, readRecovery, makeRecoveryReceipt, claimRecovery, recoveredReport, candidate } from './candidate-recovery.mjs'
import { effectivePlan, requireExecutable } from './worktree-env.mjs'
import { applyLinks, detectEnvironmentBlock } from './worktree-env.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const USAGE = 'node claude-wave-runner.mjs --plan <file> --wave <n> --repo <abs> --base <sha> --default-branch <branch> [--claude claude] [--jobs 3] [--timeout-min 45] [--out <dir>] [--preflight on|off] [--resume-from <summary.json>]'
const options = {}, flags = ['plan', 'wave', 'repo', 'base', 'default-branch', 'claude', 'jobs', 'timeout-min', 'out', 'preflight', 'resume-from']
try {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') { console.log(USAGE); process.exit(0) }
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]?.slice(2)
    if (!args[i]?.startsWith('--') || !flags.includes(name) || args[i + 1] === undefined || name in options) throw new Error(USAGE)
    options[name] = args[i + 1]
  }
  for (const key of ['plan', 'wave', 'repo', 'base', 'default-branch']) if (!options[key]) throw new Error('missing --' + key)
  if (!isAbsolute(options.repo)) throw new Error('--repo: absolute path required')
  for (const [name, fallback] of [['jobs', '3'], ['timeout-min', '45']]) {
    options[name] ??= fallback
    if (!/^\d+$/.test(options[name]) || Number(options[name]) < 1 || Number(options[name]) > 1440) throw new Error('invalid --' + name)
  }
  options.preflight ??= 'on'
  if (!['on', 'off'].includes(options.preflight)) throw new Error('--preflight: on|off')
  options.out = resolve(options.out || join(options.repo, '.worktrees', 'claude-runner', options.wave + '-' + options.base.slice(0, 12)))
  if (existsSync(options.out)) { process.stderr.write('run directory exists; artifacts preserved: ' + options.out + '\n'); process.exit(73) }
} catch (error) { process.stderr.write(error.message + '\n'); process.exit(2) }

try { requireExecutable(options.claude || 'claude') } catch (error) { process.stderr.write(error.message + '\n'); process.exit(1) }

// The existing launcher remains the sole plan→Workflow input adapter. It lints,
// checks pushed base/depends_on, and writes only after validation succeeds.
const scriptPath = join(options.out, 'launch.workflow.mjs')
const launch = spawnSync(process.execPath, [join(here, 'wave-launch.mjs'), options.plan,
  '--wave', options.wave, '--repo', options.repo, '--base', options.base,
  '--default-branch', options['default-branch'], '--out', scriptPath], { encoding: 'utf8', timeout: 60000 })
if (launch.status !== 0) { process.stderr.write(launch.stderr || launch.stdout || 'launch failed\n'); process.exit(1) }
let source = readFileSync(scriptPath, 'utf8').replace(/^export const meta/m, 'const meta')
const inputMatch = source.match(/^const WAVE_ARGS = (.+)$/m)
const wave = JSON.parse(inputMatch[1])
const plan = effectivePlan(options.plan, options.repo)
const scope = recoveryScope({ host: 'claude', repo: options.repo, base: options.base,
  waveNumber: Number(options.wave), wave: plan.waves.find(w => w.wave === Number(options.wave)), plan, markdown: readFileSync(options.plan, 'utf8') })
const recovery = options['resume-from'] ? readRecovery(options['resume-from'], scope) : null
if (recovery) {
  wave.recovery = Object.fromEntries(Object.entries(recovery.tasks).map(([id, saved]) => [id, { ...saved, report: recoveredReport(saved.report) }]))
  source = source.replace(/^const WAVE_ARGS = .+$/m, () => 'const WAVE_ARGS = ' + JSON.stringify(wave))
}
const reports = Object.fromEntries(Object.entries(recovery?.tasks || {}).map(([id, t]) => [id, t.report]))
const children = recovery ? [...recovery.summary.children] : []
const factsCache = new Map(), latestFacts = new Map(), verificationCounts = new Map(), roleCounts = new Map()
// task id → { sessionId, model, effort } of the last accepted executor call.
const executorSessions = new Map()
const usage = recovery ? { ...recovery.summary.usage } : { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 }
const childEnv = { ...process.env }; delete childEnv.CLAUDECODE
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
const log = text => process.stderr.write('claude-wave-runner: ' + text + '\n')
let active = 0
const waiters = []
async function slot() { if (active >= Number(options.jobs)) await new Promise(r => waiters.push(r)); else active++ }
function release() { const next = waiters.shift(); if (next) next(); else active-- }

async function processRun(executable, argv, stdin, stdoutPath, stderrPath, cwd = options.repo, timed = true) {
  const stdout = openSync(stdoutPath, 'w', 0o600), stderr = openSync(stderrPath, 'w', 0o600)
  try {
    return await new Promise(resolveRun => {
      const child = spawn(executable, argv, { cwd, env: childEnv, detached: true, stdio: ['pipe', stdout, stderr] })
      let timer
      const kill = () => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }
      child.once('error', () => { clearTimeout(timer); resolveRun(false) })
      child.once('close', code => { clearTimeout(timer); kill(); resolveRun(code === 0) })
      child.stdin.on('error', () => {})
      child.stdin.end(stdin)
      // Verification owns per-command deadlines and cleanup. Killing its worker
      // would bypass those handlers and orphan detached build process groups.
      if (timed) timer = setTimeout(kill, Number(options['timeout-min']) * 60000)
    })
  } finally { closeSync(stdout); closeSync(stderr) }
}

async function agent(prompt, opts) {
  await slot()
  let checkout, execTask, accepted = false
  try {
    const [role, id] = opts.label.split(':')
    if (role === 'exec') execTask = id
    const countKey = role + ':' + id, n = (roleCounts.get(countKey) || 0) + 1
    roleCounts.set(countKey, n)
    const directory = join(options.out, id); mkdirSync(directory, { recursive: true })
    const prefix = join(directory, role + '-' + n)
    // A same-rung rework continues the executor's own session: only the
    // continuation is sent. Any other executor call starts a named session.
    const session = role === 'exec' ? executorSessions.get(id) : undefined
    const resumed = typeof opts.continuation === 'string' && opts.continuation !== ''
      && session !== undefined && session.model === opts.model && session.effort === opts.effort
    const sessionId = role !== 'exec' ? undefined : resumed ? session.sessionId : randomUUID()
    const input = resumed ? opts.continuation : prompt
    writeFileSync(prefix + '.prompt.md', input, { mode: 0o600 })
    const tools = role === 'exec' ? 'Read,Glob,Grep,Edit,Write,Bash' : 'Read,Glob,Grep,Bash'
    const argv = ['-p', '--model', opts.model, '--effort', opts.effort,
      ...(role !== 'exec' ? ['--no-session-persistence'] : resumed ? ['--resume', sessionId] : ['--session-id', sessionId]),
      '--output-format', 'json', '--tools', tools,
      '--allowedTools', tools, '--permission-mode', role === 'exec' ? 'acceptEdits' : 'dontAsk',
      '--permission-prompts', 'none']
    if (opts.schema) argv.push('--json-schema', JSON.stringify(opts.schema))
    if (role !== 'exec') argv.push('--disallowedTools', 'Edit,Write,NotebookEdit')
    const entry = { task: id, role, model: opts.model, effort: opts.effort,
      prompt: prefix + '.prompt.md', result: prefix + '.result.json', stderr: prefix + '.stderr', ok: false,
      ...(resumed ? { resumed: true } : {}), ...(sessionId ? { sessionId } : {}) }
    children.push(entry)
    let branchHead
    const git = args => {
      const r = spawnSync('git', ['-C', options.repo, ...args], { encoding: 'utf8', timeout: 30000 })
      if (r.status !== 0) throw new Error(r.stderr || 'git failed')
      return r.stdout.trim()
    }
    if (recovery) candidate(options.repo, options.base, id, recovery.tasks[id].head)
    if (role === 'judge') {
      branchHead = git(['rev-parse', '--verify', 'refs/heads/wave/' + id])
      if (latestFacts.get(id)?.verification?.head !== branchHead) return null
      checkout = prefix + '.checkout'
      git(['worktree', 'add', '--detach', checkout, branchHead])
      applyLinks(options.repo, checkout, wave.worktree?.links || [])
    }
    const transportOk = await processRun(options.claude || 'claude', argv, input, entry.result, entry.stderr, checkout || options.repo)
    let result
    try { result = JSON.parse(readFileSync(entry.result, 'utf8')) } catch { return null }
    const u = result.usage || {}
    for (const [key, source] of Object.entries({ input: 'input_tokens', cacheCreation: 'cache_creation_input_tokens',
      cacheRead: 'cache_read_input_tokens', output: 'output_tokens' })) {
      if (Number.isFinite(u[source]) && u[source] >= 0) usage[key] += u[source]
    }
    entry.usage = u
    // Rejected answers still consumed tokens; account for reported usage before
    // deciding whether transport or artifact integrity permits acceptance.
    if (!transportOk) return null
    if (checkout) {
      const status = spawnSync('git', ['-C', checkout, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' })
      const head = spawnSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
      if (status.status !== 0 || status.stdout.trim() !== ''
        || head.status !== 0 || head.stdout.trim() !== branchHead
        || git(['rev-parse', 'refs/heads/wave/' + id]) !== branchHead) return null
    }
    if (result.is_error || result.type !== 'result') return null
    const answer = opts.schema ? result.structured_output : result.result
    if (opts.schema) {
      if (!answer || typeof answer.ok !== 'boolean' || !Array.isArray(answer.violations)
        || Object.keys(answer).sort().join(',') !== 'ok,remarks,violations'
        || !Array.isArray(answer.remarks) || answer.ok !== (answer.violations.length === 0)
        || answer.remarks.some(r => typeof r !== 'string')
        || answer.violations.some(v => !v || !['files', 'must_run', 'forbidden-move', 'report', 'environment'].includes(v.class)
          || typeof v.rule !== 'string' || typeof v.evidence !== 'string'
          || (['must_run', 'forbidden-move'].includes(v.class) && typeof v.satisfiable !== 'boolean'))) return null
    } else if (typeof answer !== 'string' || answer.trim() === '') return null
    entry.ok = true
    if (role === 'exec') {
      reports[id] = answer
      executorSessions.set(id, { sessionId, model: opts.model, effort: opts.effort })
      accepted = true
    }
    return answer
  } finally {
    // A failed executor call forfeits its session: the policy's single retry
    // then starts fresh with the full rework prompt.
    if (execTask !== undefined && !accepted) executorSessions.delete(execTask)
    if (checkout) spawnSync('git', ['-C', options.repo, 'worktree', 'remove', '--force', checkout], { encoding: 'utf8', timeout: 30000 })
    release()
  }
}

async function verify(task, report) {
  const n = (verificationCounts.get(task.id) || 0) + 1; verificationCounts.set(task.id, n)
  const directory = join(options.out, task.id); mkdirSync(directory, { recursive: true })
  const prefix = join(directory, 'verification-' + n)
  const request = { repo: wave.repoPath, branch: 'wave/' + task.id, base: wave.base, contract: task.contract,
    links: wave.worktree?.links || [], report, cache: factsCache.get(task.id) || [], logDir: prefix + '.logs',
    timeoutMs: Number(options['timeout-min']) * 60000 }
  save(prefix + '.request.json', request)
  // Separate process keeps long builds from blocking child timeouts and CLI IO.
  if (!await processRun(process.execPath, [join(here, 'mechanical-verify.mjs'), '--request', prefix + '.request.json',
    '--output', prefix + '.json'], '', prefix + '.stdout', prefix + '.stderr', options.repo, false)) throw new Error('verification failed: ' + prefix + '.stderr')
  const { pipeline, ...facts } = JSON.parse(readFileSync(prefix + '.json', 'utf8'))
  factsCache.set(task.id, [pipeline])
  latestFacts.set(task.id, facts)
  return facts
}

const pipeline = (items, ...stages) => Promise.all(items.map(async item => {
  let result = item
  try { for (const stage of stages) result = await stage(result, item); return result }
  catch (error) { log(error.message); return null }
}))
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
let result
try {
  if (options.preflight === 'on' && !recovery) {
    const blocks = []
    for (const task of wave.tasks) {
      const prefix = join(options.out, 'preflight-' + task.id)
      save(prefix + '.request.json', { pipelineOnly: true, repo: wave.repoPath, head: wave.base, base: wave.base,
        branch: 'base', contract: task.contract, links: wave.worktree?.links || [], logDir: prefix + '.logs', retryFailures: false,
        timeoutMs: Number(options['timeout-min']) * 60000 })
      if (!await processRun(process.execPath, [join(here, 'mechanical-verify.mjs'), '--request', prefix + '.request.json',
        '--output', prefix + '.json'], '', prefix + '.stdout', prefix + '.stderr', options.repo, false)) throw new Error('preflight failed: ' + prefix + '.stderr')
      const facts = JSON.parse(readFileSync(prefix + '.json', 'utf8'))
      const taskBlocks = facts.mustRun.filter(m => m.attempts.at(-1).exit !== 0)
        .map(m => detectEnvironmentBlock(m.attempts.at(-1).stdout + m.attempts.at(-1).stderr)).filter(Boolean)
      blocks.push(...taskBlocks.map(block => task.id + ': ' + block.line))
    }
    if (blocks.length) throw new Error('environment-blocked: ' + blocks.join('; '))
  }
  if (recovery) claimRecovery(recovery, join(options.out, 'summary.json'))
  result = await new AsyncFunction('agent', 'pipeline', 'phase', 'log', 'args', 'verify', source)(agent, pipeline, () => {}, log, wave, verify)
} catch (error) { result = { status: 'error', errors: [error.message], tasks: [] } }
// A model cannot overrule red mechanical facts with an ok:true verdict.
for (const task of result.tasks) {
  const facts = latestFacts.get(task.id)
  const currentHead = spawnSync('git', ['-C', options.repo, 'rev-parse', '--verify', 'refs/heads/wave/' + task.id],
    { encoding: 'utf8', timeout: 30000 })
  if (task.status === 'ok' && (!facts || !facts.branchHasCommits || facts.forbiddenPaths.length
    || facts.mustRun.some(m => m.exit !== 0) || currentHead.status !== 0
    || currentHead.stdout.trim() !== facts.verification.head)) {
    task.status = 'failed'; result.status = 'partial'
    result.errors.push('mechanical checks still fail for ' + task.id)
  }
}
const summary = { ...result, children, usage, recovery: makeRecoveryReceipt(scope, children, reports),
  ...(recovery ? { previousSummary: recovery.path } : {}) }
save(join(options.out, 'summary.json'), summary)
console.log(JSON.stringify({ status: summary.status, tasks: summary.tasks.map(({ id, status, branch }) => ({ id, status, branch })),
  errors: summary.errors, modelCalls: children.length, summaryPath: join(options.out, 'summary.json') }))
process.exitCode = summary.status === 'done' ? 0 : 1
