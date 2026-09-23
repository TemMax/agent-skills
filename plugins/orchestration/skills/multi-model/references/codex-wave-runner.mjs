#!/usr/bin/env node
// Deterministic, in-process driver for the Codex-native wave protocol
// (codex-wave-protocol.md). An orchestrator model driving that protocol one
// tool call at a time spends most of its wall time waiting on its own
// tool-call round trips, not on the Codex children themselves; this script
// runs the same helper-governed loop without a model in the loop.
//
// codex-wave-state.mjs (never modified here) is the only state machine, and
// its `next` command always returns the action for the FIRST unfinished task
// of a *state* — so one state can only ever advance one task at a time. To
// run a wave's tasks in parallel without changing that helper, this script
// gives every task its own derived plan and its own state: for task T of the
// selected wave, it writes a copy of the plan whose selected wave's `tasks`
// array holds only T, then calls the helper's `init` on that copy. Each task
// therefore gets its own worktree, branch, state file — and its own `next`
// loop, which can run concurrently with every other task's loop under a
// shared --jobs limit on live child processes.
//
// A note on that per-task derived plan: the brief for this script says the
// only edit is to the `json wave-plan` block, with "all prose unchanged".
// Taken completely literally that is not achievable: plan-lint.mjs (which
// this script must not modify, and must keep passing — see step 2 below)
// rejects a plan whose prose has a "## Task <id>" section with no matching
// task in the json block, in either direction. A wave with more than one
// task therefore cannot be split into single-task derived plans while
// leaving literally every "## Task" section standing — confirmed empirically
// against the shipped linter before writing this file. The reading applied
// here is the only one under which "one state per task" and "lint it" (step
// 4) can both hold: the json block changes to select only T, and the prose
// sections for the *other* tasks that were in this same wave are dropped
// along with them (T's own section, every other wave, and all surrounding
// prose are untouched, byte for byte). See the final report for this task.
//
// Zero dependencies. Node ESM only.

import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const HELPER = join(here, 'codex-wave-state.mjs')
const LINT = join(here, '..', '..', 'super-plan', 'references', 'plan-lint.mjs')

const USAGE = [
  'usage: node codex-wave-runner.mjs --plan <file> --wave <n> --repo <abs> --base <40-hex sha>',
  '         [--jobs 3] [--codex codex] [--timeout-min 45] [--out <dir>]',
  '         [--executor-network on|off]',
  '',
  'Runs the Codex-native wave protocol (codex-wave-protocol.md) for one',
  'wave, one state machine per task, executing tasks concurrently under a',
  'shared --jobs limit on live `codex exec` children. Never calls a model',
  'itself and never bypasses codex-wave-state.mjs, the sole state machine.',
  '',
  'Options:',
  '  --plan <file>             wave plan Markdown file (required)',
  '  --wave <n>                1-based wave number to run (required)',
  '  --repo <abs>              absolute path to the repository (required)',
  '  --base <40-hex sha>       full lowercase base commit SHA (required)',
  '  --jobs <n>                max concurrent codex exec children (default 3)',
  '  --codex <path>            codex executable to run (default "codex")',
  '  --timeout-min <n>         per-child timeout in minutes (default 45)',
  '  --out <dir>               run directory; must not already exist',
  '                            (default <repo>/.worktrees/codex-runner/<wave>-<base12>)',
  '  --executor-network on|off executor sandbox network access (default on)',
  '  --help                    print this text and exit 0',
  '',
  'Exit status: 0 merge-ready, 1 stop (including a lint failure on the plan),',
  '2 usage error, 73 --out already exists.',
].join('\n')

function usageError(message) {
  process.stderr.write(USAGE + '\n\n' + message + '\n')
  process.exit(2)
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------

function parseArgv(argv) {
  if (argv.includes('--help')) {
    process.stdout.write(USAGE + '\n')
    process.exit(0)
  }
  const FLAGS = ['--plan', '--wave', '--repo', '--base', '--jobs', '--codex',
    '--timeout-min', '--out', '--executor-network']
  const raw = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (!FLAGS.includes(flag)) usageError('unknown option "' + flag + '"')
    if (i + 1 >= argv.length) usageError(flag + ' requires a value')
    if (Object.hasOwn(raw, flag)) usageError('duplicate option ' + flag)
    raw[flag] = argv[++i]
  }
  for (const required of ['--plan', '--wave', '--repo', '--base']) {
    if (!Object.hasOwn(raw, required)) usageError('missing required option ' + required)
  }

  const waveNumber = Number(raw['--wave'])
  if (!Number.isInteger(waveNumber) || waveNumber < 1) usageError('--wave must be a positive integer')

  if (!isAbsolute(raw['--repo'])) usageError('--repo must be an absolute path')

  if (!/^[0-9a-f]{40}$/.test(raw['--base'])) usageError('--base must be a full lowercase 40-hex SHA')

  const jobs = raw['--jobs'] === undefined ? 3 : Number(raw['--jobs'])
  if (!Number.isInteger(jobs) || jobs < 1) usageError('--jobs must be a positive integer')

  const timeoutMin = raw['--timeout-min'] === undefined ? 45 : Number(raw['--timeout-min'])
  if (!Number.isFinite(timeoutMin) || timeoutMin <= 0) usageError('--timeout-min must be a positive number')

  const executorNetwork = raw['--executor-network'] ?? 'on'
  if (!['on', 'off'].includes(executorNetwork)) usageError('--executor-network must be "on" or "off"')

  const planPath = resolve(raw['--plan'])
  const repoPath = raw['--repo']
  const base = raw['--base']
  const outPath = raw['--out'] !== undefined
    ? resolve(raw['--out'])
    : join(repoPath, '.worktrees', 'codex-runner', String(waveNumber) + '-' + base.slice(0, 12))

  return {
    planPath,
    waveNumber,
    repoPath,
    base,
    jobs,
    codexBin: raw['--codex'] ?? 'codex',
    timeoutMs: Math.round(timeoutMin * 60000),
    outPath,
    executorNetworkOn: executorNetwork === 'on',
  }
}

// ---------------------------------------------------------------------------
// Per-task plan derivation (see the header comment for why prose sections
// for dropped tasks are removed alongside them).
// ---------------------------------------------------------------------------

const clone = (value) => JSON.parse(JSON.stringify(value))
const WAVE_PLAN_BLOCK = /```json wave-plan\r?\n([\s\S]*?)\r?\n```/

function replaceWavePlanBlock(text, planObject) {
  const match = WAVE_PLAN_BLOCK.exec(text)
  if (!match) throw new Error('no ```json wave-plan block found while deriving a per-task plan')
  const replacement = '```json wave-plan\n' + JSON.stringify(planObject, null, 2) + '\n```'
  return text.slice(0, match.index) + replacement + text.slice(match.index + match[0].length)
}

// A "## Task <id>" section runs from its heading to the next level-2 heading
// (of any kind) or end of file — the same boundary codex-wave-state.mjs and
// plan-lint.mjs both use.
function removeTaskSections(text, idsToRemove) {
  if (idsToRemove.length === 0) return text
  const drop = new Set(idsToRemove)
  const headings = [...text.matchAll(/^## .*$/gm)]
  const spans = headings
    .map((heading, index) => {
      const end = index + 1 < headings.length ? headings[index + 1].index : text.length
      const taskHeading = /^## Task ([a-z0-9-]+)\s*$/.exec(heading[0])
      return taskHeading ? { id: taskHeading[1], start: heading.index, end } : null
    })
    .filter((span) => span && drop.has(span.id))
    .sort((a, b) => b.start - a.start)
  let result = text
  for (const span of spans) result = result.slice(0, span.start) + result.slice(span.end)
  return result
}

// Writes <outPath>/plans/<planBasename>--<taskId>.md and returns its path.
function deriveTaskPlan({ originalText, plan, waveIndex, taskId, outPath, planBasename }) {
  const wave = plan.waves[waveIndex]
  const task = wave.tasks.find((candidate) => candidate && candidate.id === taskId)
  const derivedPlan = clone(plan)
  derivedPlan.waves[waveIndex] = { ...clone(wave), tasks: [clone(task)] }
  let text = replaceWavePlanBlock(originalText, derivedPlan)
  const idsToRemove = wave.tasks.map((candidate) => candidate.id).filter((id) => id !== taskId)
  text = removeTaskSections(text, idsToRemove)
  const planPath = join(outPath, 'plans', planBasename + '--' + taskId + '.md')
  mkdirSync(dirname(planPath), { recursive: true })
  writeFileSync(planPath, text)
  return planPath
}

// ---------------------------------------------------------------------------
// codex-wave-state.mjs subprocess wrappers. Every call is synchronous and
// cheap (git plus small JSON transforms, never a model or the network), so
// blocking the event loop for the length of one call is acceptable even
// while other tasks' codex children are running concurrently in the
// background (see runCodexChild below, which is genuinely async).
// ---------------------------------------------------------------------------

function runHelper(args, stdinObject) {
  const result = spawnSync(process.execPath, [HELPER, ...args], {
    encoding: 'utf8',
    input: stdinObject === undefined ? undefined : JSON.stringify(stdinObject),
    maxBuffer: 64 * 1024 * 1024,
  })
  let json = null
  try { json = JSON.parse(result.stdout) } catch { /* leave json null */ }
  if (result.status !== 0 || !json || json.status === 'invalid') {
    throw new Error('codex-wave-state.mjs ' + args.join(' ') + ' failed: '
      + (result.stderr || result.stdout || 'exit ' + String(result.status)))
  }
  return json
}

const helperInit = (planPath, waveNumber, repoPath, base) =>
  runHelper(['init', '--plan', planPath, '--wave', String(waveNumber), '--repo', repoPath, '--base', base])
const helperNext = (statePath) => runHelper(['next', '--state', statePath])
const helperRecordExecutor = (statePath, taskId, payload) =>
  runHelper(['record-executor', '--state', statePath, '--task', taskId], payload)
const helperVerify = (statePath, taskId) => runHelper(['verify', '--state', statePath, '--task', taskId])
const helperSupervisorPrompt = (statePath, taskId) =>
  runHelper(['supervisor-prompt', '--state', statePath, '--task', taskId])
const helperRecordVerdict = (statePath, taskId, payload) =>
  runHelper(['record-verdict', '--state', statePath, '--task', taskId], payload)
const helperSummary = (statePath) => runHelper(['summary', '--state', statePath])

// ---------------------------------------------------------------------------
// A shared limit on live `codex exec` children (executors and supervisors,
// across every task's loop).
// ---------------------------------------------------------------------------

function createSemaphore(limit) {
  let active = 0
  const queue = []
  function acquire() {
    return new Promise((resolve_) => {
      const tryRun = () => {
        if (active < limit) { active++; resolve_() } else queue.push(tryRun)
      }
      tryRun()
    })
  }
  function release() {
    active--
    const next = queue.shift()
    if (next) next()
  }
  return { acquire, release }
}

// ---------------------------------------------------------------------------
// One codex exec child: spawned async (so children across tasks genuinely
// overlap), stdin gets the prompt, stdout/stderr are captured to files,
// --timeout-min is enforced by killing the whole process group.
// ---------------------------------------------------------------------------

function sumUsage(eventsPath) {
  const usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 }
  let text = ''
  try { text = readFileSync(eventsPath, 'utf8') } catch { return usage }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let event
    try { event = JSON.parse(trimmed) } catch { continue }
    if (event && event.type === 'turn.completed' && event.usage && typeof event.usage === 'object') {
      for (const key of Object.keys(usage)) {
        const value = event.usage[key]
        if (typeof value === 'number') usage[key] += value
      }
    }
  }
  return usage
}

async function runCodexChild({ semaphore, codexBin, args, prompt, eventsPath, stderrPath, timeoutMs }) {
  await semaphore.acquire()
  try {
    const start = Date.now()
    const outcome = await new Promise((resolve_) => {
      let child
      try {
        child = spawn(codexBin, args, { detached: true, stdio: ['pipe', 'pipe', 'pipe'] })
      } catch (error) {
        resolve_({
          exitCode: null, timedOut: false, wallSeconds: (Date.now() - start) / 1000,
          stdout: Buffer.alloc(0), stderr: Buffer.from(String(error.message || error)),
        })
        return
      }
      const outChunks = []
      const errChunks = []
      let timedOut = false
      let settled = false
      child.stdout.on('data', (chunk) => outChunks.push(chunk))
      child.stderr.on('data', (chunk) => errChunks.push(chunk))
      child.stdin.on('error', () => { /* child may exit before stdin is fully written */ })
      child.stdin.write(prompt)
      child.stdin.end()
      const timer = setTimeout(() => {
        timedOut = true
        try { process.kill(-child.pid, 'SIGKILL') } catch { try { child.kill('SIGKILL') } catch { /* gone */ } }
      }, timeoutMs)
      const finish = (exitCode) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve_({
          exitCode, timedOut, wallSeconds: (Date.now() - start) / 1000,
          stdout: Buffer.concat(outChunks), stderr: Buffer.concat(errChunks),
        })
      }
      child.on('error', () => finish(null))
      child.on('close', (code) => finish(code))
    })
    mkdirSync(dirname(eventsPath), { recursive: true })
    writeFileSync(eventsPath, outcome.stdout)
    writeFileSync(stderrPath, outcome.stderr)
    return {
      exitCode: outcome.exitCode,
      timedOut: outcome.timedOut,
      wallSeconds: outcome.wallSeconds,
      usage: sumUsage(eventsPath),
    }
  } finally {
    semaphore.release()
  }
}

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------

async function main() {
  const config = parseArgv(process.argv.slice(2))

  if (existsSync(config.outPath)) {
    process.stderr.write('codex-wave-runner: --out already exists: ' + config.outPath + '\n')
    process.exit(73)
  }

  // Step 2: the plan must be lint-clean before anything is touched.
  const lint = spawnSync(process.execPath, [LINT, config.planPath, '--repo', config.repoPath],
    { encoding: 'utf8' })
  if (lint.status !== 0) {
    process.stdout.write(lint.stdout || '')
    process.stderr.write(lint.stderr || '')
    process.exit(1)
  }

  let originalText
  try { originalText = readFileSync(config.planPath, 'utf8') } catch (error) {
    process.stderr.write('codex-wave-runner: cannot read ' + config.planPath + ': ' + error.message + '\n')
    process.exit(1)
  }
  const blockMatch = WAVE_PLAN_BLOCK.exec(originalText)
  if (!blockMatch) {
    process.stderr.write('codex-wave-runner: no ```json wave-plan block in ' + config.planPath + '\n')
    process.exit(1)
  }
  let plan
  try { plan = JSON.parse(blockMatch[1]) } catch (error) {
    process.stderr.write('codex-wave-runner: wave-plan JSON does not parse: ' + error.message + '\n')
    process.exit(1)
  }
  const waveIndex = config.waveNumber - 1
  const wave = plan.waves && plan.waves[waveIndex]
  if (!wave || !Array.isArray(wave.tasks) || wave.tasks.length === 0) {
    process.stderr.write('codex-wave-runner: wave ' + config.waveNumber + ' does not exist or has no tasks\n')
    process.exit(1)
  }
  const taskIds = wave.tasks.map((task) => task.id)
  const planBasename = basename(config.planPath).replace(/\.[^.]+$/, '')

  // Everything from here on is real work; create the run directory and the
  // one artifact shared by every supervisor spawn.
  mkdirSync(config.outPath, { recursive: true })
  const verdictSchemaPath = join(config.outPath, 'verdict.schema.json')
  writeFileSync(verdictSchemaPath, JSON.stringify({
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'violations', 'remarks'],
    properties: {
      ok: { type: 'boolean' },
      violations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['rule', 'class', 'evidence', 'quote', 'pasteReproduced', 'satisfiable'],
          properties: {
            rule: { type: 'string' },
            class: { type: 'string' },
            evidence: { type: 'string' },
            quote: { type: ['string', 'null'] },
            pasteReproduced: { type: ['boolean', 'null'] },
            satisfiable: { type: ['boolean', 'null'] },
          },
        },
      },
      remarks: { type: 'array', items: { type: 'string' } },
    },
  }, null, 2) + '\n')

  // Step 4: one derived plan + one lint pass + one `init` per task, all
  // sequential and all before any task loop starts.
  const statePaths = {}
  for (const taskId of taskIds) {
    const derivedPlanPath = deriveTaskPlan({
      originalText, plan, waveIndex, taskId, outPath: config.outPath, planBasename,
    })
    const derivedLint = spawnSync(process.execPath, [LINT, derivedPlanPath, '--repo', config.repoPath],
      { encoding: 'utf8' })
    if (derivedLint.status !== 0) {
      process.stdout.write(derivedLint.stdout || '')
      process.stderr.write(derivedLint.stderr || '')
      process.stderr.write('codex-wave-runner: derived plan for task "' + taskId + '" failed lint\n')
      process.exit(1)
    }
    let initResult
    try {
      initResult = helperInit(derivedPlanPath, config.waveNumber, config.repoPath, config.base)
    } catch (error) {
      process.stderr.write('codex-wave-runner: init failed for task "' + taskId + '": ' + error.message + '\n')
      process.exit(1)
    }
    if (!Array.isArray(initResult.tasks) || initResult.tasks.length !== 1 || initResult.tasks[0] !== taskId) {
      process.stderr.write('codex-wave-runner: init for task "' + taskId
        + '" did not produce a single-task state as expected\n')
      process.exit(1)
    }
    statePaths[taskId] = initResult.state
  }

  const semaphore = createSemaphore(config.jobs)
  const children = []

  async function handleExecutor(taskId, statePath, action) {
    const taskDir = join(config.outPath, taskId)
    mkdirSync(taskDir, { recursive: true })
    const attempt = (children.filter((c) => c.task === taskId && c.role === 'executor').length) + 1
    const promptPath = join(taskDir, 'executor-' + attempt + '.prompt.md')
    const reportPath = join(taskDir, 'executor-' + attempt + '.report.md')
    const eventsPath = join(taskDir, 'executor-' + attempt + '.events.jsonl')
    const stderrPath = join(taskDir, 'executor-' + attempt + '.stderr')
    writeFileSync(promptPath, action.prompt)
    const args = [
      'exec', '--ephemeral', '--skip-git-repo-check', '-C', action.worktree,
      '--sandbox', 'workspace-write',
      ...(config.executorNetworkOn ? ['-c', 'sandbox_workspace_write.network_access=true'] : []),
      '--model', action.model,
      '-c', 'model_reasoning_effort=' + action.effort,
      '--json', '-o', reportPath, '-',
    ]
    const result = await runCodexChild({
      semaphore, codexBin: config.codexBin, args, prompt: action.prompt,
      eventsPath, stderrPath, timeoutMs: config.timeoutMs,
    })
    children.push({
      task: taskId, role: 'executor', attempt, model: action.model, effort: action.effort,
      exit: result.exitCode, seconds: result.wallSeconds, usage: result.usage,
      promptFile: promptPath, eventsFile: eventsPath,
    })
    let payload
    if (result.timedOut || result.exitCode !== 0) {
      payload = { error: { kind: 'transport' } }
    } else {
      let report = ''
      try { report = readFileSync(reportPath, 'utf8') } catch { report = '' }
      payload = report === '' ? { error: { kind: 'null-result' } } : { report }
    }
    helperRecordExecutor(statePath, taskId, payload)
  }

  function stripNullViolationKeys(verdict) {
    if (!verdict || !Array.isArray(verdict.violations)) return verdict
    return {
      ...verdict,
      violations: verdict.violations.map((violation) => {
        const cleaned = { ...violation }
        for (const key of Object.keys(cleaned)) {
          if (cleaned[key] === null) delete cleaned[key]
        }
        return cleaned
      }),
    }
  }

  async function handleSupervisor(taskId, statePath, action) {
    const taskDir = join(config.outPath, taskId)
    mkdirSync(taskDir, { recursive: true })
    const attempt = (children.filter((c) => c.task === taskId && c.role === 'supervisor').length) + 1
    const promptPath = join(taskDir, 'supervisor-' + attempt + '.prompt.md')
    const reportPath = join(taskDir, 'supervisor-' + attempt + '.report.md')
    const eventsPath = join(taskDir, 'supervisor-' + attempt + '.events.jsonl')
    const stderrPath = join(taskDir, 'supervisor-' + attempt + '.stderr')
    const checkoutPath = join(taskDir, 'supervisor-' + attempt)

    const promptResult = helperSupervisorPrompt(statePath, taskId)
    writeFileSync(promptPath, promptResult.prompt)

    const added = spawnSync('git', ['-C', config.repoPath, 'worktree', 'add', '--detach',
      checkoutPath, action.branch], { encoding: 'utf8' })
    if (added.status !== 0) {
      throw new Error('supervisor worktree checkout failed for task "' + taskId + '": '
        + (added.stderr || added.stdout))
    }
    try {
      const args = [
        'exec', '--ephemeral', '--skip-git-repo-check', '-C', checkoutPath,
        '--sandbox', 'workspace-write',
        '--model', action.model,
        '-c', 'model_reasoning_effort=' + action.effort,
        '--output-schema', verdictSchemaPath,
        '--json', '-o', reportPath, '-',
      ]
      const result = await runCodexChild({
        semaphore, codexBin: config.codexBin, args, prompt: promptResult.prompt,
        eventsPath, stderrPath, timeoutMs: config.timeoutMs,
      })
      children.push({
        task: taskId, role: 'supervisor', attempt, model: action.model, effort: action.effort,
        exit: result.exitCode, seconds: result.wallSeconds, usage: result.usage,
        promptFile: promptPath, eventsFile: eventsPath,
      })
      let payload
      if (result.timedOut || result.exitCode !== 0) {
        payload = { error: { kind: 'transport' } }
      } else {
        let parsed = null
        try { parsed = JSON.parse(readFileSync(reportPath, 'utf8')) } catch { parsed = null }
        payload = parsed === null ? { error: { kind: 'null-result' } } : stripNullViolationKeys(parsed)
      }
      helperRecordVerdict(statePath, taskId, payload)
    } finally {
      const removed = spawnSync('git', ['-C', config.repoPath, 'worktree', 'remove', '--force', checkoutPath],
        { encoding: 'utf8' })
      if (removed.status !== 0) {
        process.stderr.write('codex-wave-runner: warning: failed to remove supervisor worktree '
          + checkoutPath + ': ' + (removed.stderr || removed.stdout) + '\n')
      }
    }
  }

  async function runTaskLoop(taskId) {
    const statePath = statePaths[taskId]
    try {
      for (;;) {
        const action = helperNext(statePath)
        if (action.action === 'merge-ready') return { task: taskId, status: 'merge-ready' }
        if (action.action === 'stop') return { task: taskId, status: 'stop', reason: action.reason }
        if (action.action === 'spawn-executor') { await handleExecutor(taskId, statePath, action); continue }
        if (action.action === 'verify') { helperVerify(statePath, taskId); continue }
        if (action.action === 'spawn-supervisor') { await handleSupervisor(taskId, statePath, action); continue }
        throw new Error('unknown helper action "' + action.action + '" for task "' + taskId + '"')
      }
    } catch (error) {
      return { task: taskId, status: 'stop', reason: 'runner-error: ' + error.message }
    }
  }

  const start = Date.now()
  const results = await Promise.all(taskIds.map((taskId) => runTaskLoop(taskId)))
  const wallSeconds = (Date.now() - start) / 1000

  const stopped = results.filter((r) => r.status === 'stop').map((r) => ({ task: r.task, reason: r.reason }))
  const status = stopped.length === 0 ? 'merge-ready' : 'stop'
  const states = taskIds.map((taskId) => statePaths[taskId])
  const tasks = taskIds.map((taskId) => helperSummary(statePaths[taskId]).tasks[0])

  const summary = { status, stopped, states, wave: config.waveNumber, tasks, children, wallSeconds }
  writeFileSync(join(config.outPath, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n')
  process.exit(status === 'merge-ready' ? 0 : 1)
}

await main()
