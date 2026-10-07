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

import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applyLinks, checkDependsOn, detectEnvironmentBlock, effectivePlan, gitCommonDir,
  resolveWorktreeEnv, TASK_HEADING_SOURCE, requireExecutable,
} from './worktree-env.mjs'

import { recoveryScope, readRecovery, makeRecoveryReceipt, claimRecovery, recoveredReport, candidate } from './candidate-recovery.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const HELPER = join(here, 'codex-wave-state.mjs')
const LINT = join(here, '..', '..', 'super-plan', 'references', 'plan-lint.mjs')

const USAGE = [
  'usage: node codex-wave-runner.mjs --plan <file> --wave <n> --repo <abs> --base <40-hex sha>',
  '         [--jobs 3] [--codex codex] [--timeout-min 45] [--out <dir>]',
  '         [--executor-network on|off] [--preflight on|off] [--resume-from <summary.json>]',
  '       node codex-wave-runner.mjs --reset --plan <file> --wave <n> --repo <abs> --base <40-hex sha>',
  '         [--out <dir>]',
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
  '  --executor-network on|off sandbox network access for executor and supervisor',
  '                            children (default on)',
  '  --preflight on|off        probe every distinct must_run command in the wave\'s',
  '                            tasks, sandboxed at the base commit, before any',
  '                            model child starts (default on)',
  '  --reset                   remove this wave\'s stopped worktrees, wave/<id> branches and state files, rename its run directory, then exit; never runs a model',
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
    '--timeout-min', '--out', '--executor-network', '--preflight', '--resume-from']
  const raw = {}
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--reset') {
      if (Object.hasOwn(raw, flag)) usageError('duplicate option ' + flag)
      raw[flag] = true
      continue
    }
    if (!FLAGS.includes(flag)) usageError('unknown option "' + flag + '"')
    if (i + 1 >= argv.length) usageError(flag + ' requires a value')
    if (Object.hasOwn(raw, flag)) usageError('duplicate option ' + flag)
    raw[flag] = argv[++i]
  }
  if (raw['--reset']) {
    for (const flag of ['--jobs', '--codex', '--timeout-min', '--executor-network', '--preflight', '--resume-from']) {
      if (Object.hasOwn(raw, flag)) usageError(flag + ' cannot be used with --reset')
    }
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

  const preflight = raw['--preflight'] ?? 'on'
  if (!['on', 'off'].includes(preflight)) usageError('--preflight must be "on" or "off"')

  const planPath = resolve(raw['--plan'])
  const repoPath = raw['--repo']
  const base = raw['--base']
  const outPath = raw['--out'] !== undefined
    ? resolve(raw['--out'])
    : join(repoPath, '.worktrees', 'codex-runner', String(waveNumber) + '-' + base.slice(0, 12))

  return {
    reset: raw['--reset'] === true,
    resumeFrom: raw['--resume-from'] ? resolve(raw['--resume-from']) : null,
    planPath,
    waveNumber,
    repoPath,
    base,
    jobs,
    codexBin: raw['--codex'] ?? 'codex',
    timeoutMs: Math.round(timeoutMin * 60000),
    outPath,
    executorNetworkOn: executorNetwork === 'on',
    preflightOn: preflight === 'on',
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
      const taskHeading = new RegExp(TASK_HEADING_SOURCE).exec(heading[0])
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
  // The derived single-task plan otherwise keeps every other top-level key
  // (ci, approvals, ...) exactly as cloned above. e2e is the one exception:
  // when the original plan names a wave-level e2e task that this wave's
  // derived plan dropped (because it isn't taskId, but it was one of this
  // wave's sibling tasks), the derived plan can no longer claim that e2e
  // coverage, so it is marked not-applicable instead. An e2e task that
  // belongs to another wave entirely is untouched by this derivation and is
  // passed through unchanged.
  if (plan.e2e && typeof plan.e2e === 'object' && plan.e2e.task !== taskId
    && wave.tasks.some((t) => t && t.id === plan.e2e.task)) {
    derivedPlan.e2e = 'not-applicable: derived single-task plan; the wave-level e2e task is ' + plan.e2e.task
  }
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

// The thread id of a `codex exec --json` child: the first JSON line with
// type "thread.started" carries it. '' when the child never printed one.
function readThreadId(eventsPath) {
  let text = ''
  try { text = readFileSync(eventsPath, 'utf8') } catch { return '' }
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    let event
    try { event = JSON.parse(trimmed) } catch { continue }
    if (event && event.type === 'thread.started') {
      return typeof event.thread_id === 'string' ? event.thread_id : ''
    }
  }
  return ''
}

function hasTurnCompleted(eventsPath) {
  let text = ''
  try { text = readFileSync(eventsPath, 'utf8') } catch { return false }
  return text.split('\n').some((line) => {
    try { return JSON.parse(line.trim())?.type === 'turn.completed' } catch { return false }
  })
}

// A resumed thread reports thread-cumulative usage, so a resumed child's own
// usage is what the thread grew by since the previous child (never below 0).
function usageSince(cumulative, previous) {
  const usage = {}
  for (const key of Object.keys(cumulative)) {
    usage[key] = Math.max(0, cumulative[key] - (typeof previous[key] === 'number' ? previous[key] : 0))
  }
  return usage
}

async function runCodexChild({ semaphore, codexBin, args, prompt, eventsPath, stderrPath, timeoutMs, cwd }) {
  await semaphore.acquire()
  try {
    const start = Date.now()
    const outcome = await new Promise((resolve_) => {
      let child
      try {
        child = spawn(codexBin, args, {
          detached: true, stdio: ['pipe', 'pipe', 'pipe'], ...(cwd ? { cwd } : {}),
        })
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
// Start-up sandbox-nesting probe. macOS seatbelt (sandbox-exec) cannot nest:
// if this runner is itself already running inside a sandbox, every `codex
// exec` child it spawns with `--sandbox workspace-write` will be unable to
// run commands. Detect that up front, before any helper call or child
// launch, rather than let every task fail one by one.
//
// CODEX_WAVE_RUNNER_SANDBOX_PROBE overrides the real probe for tests:
// "skip" runs no probe at all, "fail" behaves as if the probe failed
// (without needing an actually-nested sandbox to test against), and unset
// runs the real probe.
// ---------------------------------------------------------------------------

function sandboxNestingBlocked() {
  const override = process.env.CODEX_WAVE_RUNNER_SANDBOX_PROBE
  if (override === 'skip') return false
  if (override === 'fail') return true
  if (process.platform !== 'darwin') return false
  const probe = spawnSync('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)', '/usr/bin/true'])
  return probe.status !== 0 && String(probe.stderr).includes('Operation not permitted')
}

function reportNestedSandboxAndExit() {
  process.stdout.write(JSON.stringify({
    status: 'error',
    error: 'nested-sandbox',
    message: 'codex-wave-runner.mjs is running inside a sandbox that forbids nested sandboxing '
      + '(macOS seatbelt cannot nest), so its codex exec children cannot run commands. Run this '
      + 'command outside the Codex sandbox (escalated permissions); the children keep their own '
      + 'sandboxes.',
  }) + '\n')
  process.exit(2)
}

// ---------------------------------------------------------------------------
// Cleanup hints: printed to stderr and carried on summary.json whenever the
// run stops, so the human (or orchestrator) knows exactly how to tear down
// whatever worktrees/branches init already created.
// ---------------------------------------------------------------------------

// Also removes the task's state file: cleanup plus a fresh --out is then
// everything a re-run needs (no leftover state-conflict, no leftover
// worktree or branch).
function cleanupLine(repoPath, taskId, statePath) {
  return 'git -C ' + repoPath + ' worktree remove --force '
    + join(repoPath, '.worktrees', 'wave-' + taskId)
    + ' && git -C ' + repoPath + ' branch -D wave/' + taskId
    + ' && rm -f ' + statePath
}

function buildCleanup(repoPath, taskIds, statePaths) {
  return taskIds.map((taskId) => cleanupLine(repoPath, taskId, statePaths[taskId]))
}

// ---------------------------------------------------------------------------
// Preflight: before any model child starts, probe the checked-out base
// commit with every distinct must_run command from the wave's tasks, in the
// same sandbox an executor gets. A command whose output matches a known
// machine-failure signature (detectEnvironmentBlock) means the run cannot
// possibly succeed here, so it is caught once instead of letting every task
// discover it independently. A plain red command with no signature is only
// recorded, never treated as a stop, since it may be expected-red.
// ---------------------------------------------------------------------------

function tailLinesRaw(path, n) {
  let text = ''
  try { text = readFileSync(path, 'utf8') } catch { return [] }
  const lines = text.split(/\r?\n/)
  if (lines.length > 0 && lines.at(-1) === '') lines.pop()
  return lines.slice(-n)
}

function tailLines(path, n, maxLen) {
  return tailLinesRaw(path, n).map((line) => line.slice(0, maxLen))
}

// A child that timed out, exited non-zero, or produced an empty/unparsable
// result may have failed because the machine — not the work — is broken.
// Its stderr file plus the last 200 lines of its events file are checked
// for a known signature before the caller falls back to a generic
// transport/null-result agent failure.
function checkEnvironmentBlock(stderrPath, eventsPath) {
  let stderrText = ''
  try { stderrText = readFileSync(stderrPath, 'utf8') } catch { /* none captured */ }
  const eventsTail = tailLinesRaw(eventsPath, 200).join('\n')
  return detectEnvironmentBlock(stderrText + '\n' + eventsTail)
}

function distinctMustRunCmds(wave) {
  const cmds = []
  for (const task of wave.tasks) {
    for (const entry of task.contract.must_run) {
      if (!cmds.includes(entry.cmd)) cmds.push(entry.cmd)
    }
  }
  return cmds
}

// The linked worktree's own gitdir (<repo>/.git/worktrees/<name>). Codex
// keeps it read-only unless it is an explicit writable root, even when the
// git common dir is --add-dir'd (openai/codex #23661, #27418; reproduced on
// Codex CLI 0.159.0, 2026-09-29).
function worktreeGitDir(worktreePath) {
  const r = spawnSync('git', ['-C', worktreePath, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8' })
  if (r.status !== 0) {
    throw new Error('git rev-parse --absolute-git-dir failed in ' + worktreePath + ': ' + (r.stderr || '').trim())
  }
  return r.stdout.trim()
}

// The exact argv every preflight command runs under: the same
// workspace-write sandbox and writable roots an executor gets, wrapping the
// command in `bash -c` so it runs exactly as the contract's must_run cmd
// reads, with codex itself never invoked as a model (no prompt, no -o).
function preflightSandboxArgs({ writableRoots, networkOn, cmd }) {
  return [
    'sandbox',
    '-c', 'sandbox_mode="workspace-write"',
    '-c', 'sandbox_workspace_write.writable_roots=' + JSON.stringify(writableRoots),
    ...(networkOn ? ['-c', 'sandbox_workspace_write.network_access=true'] : []),
    '--', 'bash', '-c', cmd,
  ]
}

// Runs every distinct must_run command against a detached worktree at the
// base commit. The scratch worktree lives under a fresh mkdtemp directory of
// its own, under <repo>/.worktrees/ — never under --out, since the preflight
// now runs before --out exists at all (a stop here must leave nothing
// behind). Always removes that worktree before returning (even when a
// blocking signature was found), so the caller can report the stop with
// nothing left to clean up.
function runPreflight({ codexBin, repoPath, base, timeoutMs, env, commonDir, networkOn, wave }) {
  const worktreesDir = join(repoPath, '.worktrees')
  mkdirSync(worktreesDir, { recursive: true })
  const preflightPath = mkdtempSync(join(worktreesDir, 'codex-preflight-'))
  const added = spawnSync('git', ['-C', repoPath, 'worktree', 'add', '--detach', preflightPath, base],
    { encoding: 'utf8' })
  if (added.status !== 0) {
    throw new Error('preflight worktree checkout failed: ' + (added.stderr || added.stdout))
  }
  const results = []
  let blocked = null
  const blocks = []
  try {
    applyLinks(repoPath, preflightPath, env.links)
    const writableRoots = [worktreeGitDir(preflightPath), commonDir, ...env.writable]
    for (const cmd of distinctMustRunCmds(wave)) {
      const args = preflightSandboxArgs({ writableRoots, networkOn, cmd })
      const start = Date.now()
      const run = spawnSync(codexBin, args, {
        cwd: preflightPath, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024,
      })
      const seconds = (Date.now() - start) / 1000
      const exit = run.status === null ? -1 : run.status
      results.push({ cmd, exit, seconds })
      const detected = detectEnvironmentBlock((run.stdout || '') + '\n' + (run.stderr || ''))
      if (detected) {
        const entry = { cmd, id: detected.id, line: detected.line }; blocks.push(entry); blocked ??= entry
      }
    }
  } finally {
    const removed = spawnSync('git', ['-C', repoPath, 'worktree', 'remove', '--force', preflightPath],
      { encoding: 'utf8' })
    if (removed.status !== 0) {
      process.stderr.write('codex-wave-runner: warning: failed to remove preflight worktree '
        + preflightPath + ': ' + (removed.stderr || removed.stdout) + '\n')
    }
  }
  return { blocked, blocks, results }
}

// ---------------------------------------------------------------------------
// Main orchestration
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// --reset: remove a stopped wave's worktrees, branches and state files and
// move its run directory aside. Only git and file operations; no lint, no
// codex, no sandbox probe.
// ---------------------------------------------------------------------------

const RESETTABLE_STATUSES = ['merge-ready', 'contract-unsatisfiable', 'failed', 'error', 'environment-blocked']

function resetRefuse(taskId, reason) {
  process.stderr.write('codex-wave-runner: reset refused for task "' + taskId + '": ' + reason + '\n')
  process.exit(1)
}

function gitRun(args) {
  return spawnSync('git', args, { encoding: 'utf8' })
}

function runReset(config) {
  let text
  try { text = readFileSync(config.planPath, 'utf8') } catch (error) {
    process.stderr.write('codex-wave-runner: cannot read ' + config.planPath + ': ' + error.message + '\n')
    process.exit(1)
  }
  const blockMatch = WAVE_PLAN_BLOCK.exec(text)
  if (!blockMatch) {
    process.stderr.write('codex-wave-runner: no ```json wave-plan block in ' + config.planPath + '\n')
    process.exit(1)
  }
  let plan
  try { plan = JSON.parse(blockMatch[1]) } catch (error) {
    process.stderr.write('codex-wave-runner: wave-plan JSON does not parse: ' + error.message + '\n')
    process.exit(1)
  }
  const wave = plan.waves && plan.waves[config.waveNumber - 1]
  if (!wave || !Array.isArray(wave.tasks) || wave.tasks.length === 0) {
    process.stderr.write('codex-wave-runner: wave ' + config.waveNumber + ' does not exist or has no tasks\n')
    process.exit(1)
  }
  const planBasename = basename(config.planPath).replace(/\.[^.]+$/, '')
  const repo = config.repoPath

  const items = wave.tasks.map((task) => {
    const id = task.id
    return {
      id,
      recoveryStatePaths: [],
      worktree: join(repo, '.worktrees', 'wave-' + id),
      branch: 'wave/' + id,
      statePath: join(repo, '.worktrees', 'codex-wave',
        planBasename + '--' + id + '-w' + config.waveNumber + '-' + config.base.slice(0, 12) + '.json'),
    }
  })

  // A prior completed state must not let reset remove a branch currently
  // being reviewed by a recovery run. Recovery states live beside old states.
  const stateDir = join(repo, '.worktrees', 'codex-wave')
  for (const file of existsSync(stateDir) ? readdirSync(stateDir) : []) {
    if (!file.endsWith('.json')) continue
    let state
    try { state = JSON.parse(readFileSync(join(stateDir, file), 'utf8')) } catch { continue }
    if (state?.candidateRecovery !== true) continue
    const affected = items.find(item => state.tasks?.[item.id]?.branch === item.branch)
    if (!affected) continue
    if (state.repoPath !== repo || state.base !== config.base || typeof state.planPath !== 'string'
      || state.tasks[affected.id].worktree !== affected.worktree) resetRefuse(affected.id, 'recovery state identity mismatch')
    if (!existsSync(join(dirname(dirname(state.planPath)), 'summary.json'))) {
      resetRefuse(affected.id, 'recovery run has not produced its final summary; preserve the candidate')
    }
    affected.recoveryStatePaths.push(join(stateDir, file))
  }
  // All checks first; nothing is changed until every task has passed.
  for (const item of items) {
    if (existsSync(item.statePath)) {
      let state
      try { state = JSON.parse(readFileSync(item.statePath, 'utf8')) } catch (error) {
        resetRefuse(item.id, 'state file ' + item.statePath + ' does not parse: ' + error.message)
      }
      const entry = state && state.tasks && state.tasks[item.id]
      if (!entry || entry.branch !== item.branch || entry.worktree !== item.worktree) {
        resetRefuse(item.id, 'state file ' + item.statePath + ' does not describe branch ' + item.branch
          + ' and worktree ' + item.worktree)
      }
      if (!RESETTABLE_STATUSES.includes(entry.status)) {
        resetRefuse(item.id, 'status ' + entry.status + ': a runner may still be running; '
          + 'if none is, run the printed cleanup line by hand\n'
          + cleanupLine(repo, item.id, item.statePath))
      }
    }
    if (existsSync(item.worktree)) {
      const inside = gitRun(['-C', item.worktree, 'rev-parse', '--is-inside-work-tree'])
      let isRoot = false
      if (inside.status === 0) {
        const top = gitRun(['-C', item.worktree, 'rev-parse', '--show-toplevel'])
        try { isRoot = top.status === 0 && realpathSync(top.stdout.trim()) === realpathSync(item.worktree) } catch { isRoot = false }
      }
      if (!isRoot) resetRefuse(item.id, 'not a git worktree: ' + item.worktree)
      const status = gitRun(['-C', item.worktree, 'status', '--porcelain'])
      if (status.status !== 0 || status.stdout.trim() !== '') {
        resetRefuse(item.id, 'uncommitted changes in ' + item.worktree + '; commit, move or discard them first')
      }
    }
  }

  for (const item of items) {
    const removed = []
    let tip = null
    const tipRun = gitRun(['-C', repo, 'rev-parse', '--verify', '-q', 'refs/heads/' + item.branch])
    if (tipRun.status === 0) tip = tipRun.stdout.trim()
    if (existsSync(item.worktree)) {
      const run = gitRun(['-C', repo, 'worktree', 'remove', '--force', item.worktree])
      if (run.status !== 0) {
        process.stderr.write('codex-wave-runner: git worktree remove failed for task "' + item.id + '": '
          + run.stderr + '\n')
        process.exit(1)
      }
      removed.push('worktree')
    }
    if (tip !== null) {
      const run = gitRun(['-C', repo, 'branch', '-D', item.branch])
      if (run.status !== 0) {
        process.stderr.write('codex-wave-runner: git branch -D failed for task "' + item.id + '": '
          + run.stderr + '\n')
        process.exit(1)
      }
      removed.push('branch')
    }
    if (existsSync(item.statePath)) {
      rmSync(item.statePath)
      removed.push('state')
    }
    for (const path of item.recoveryStatePaths) { rmSync(path); removed.push('recovery-state') }
    if (removed.length === 0) {
      process.stdout.write('reset ' + item.id + ': nothing to remove\n')
    } else {
      process.stdout.write('reset ' + item.id + ': removed ' + removed.join(', ')
        + (tip !== null
          ? '; branch tip was ' + tip + ' (restore: git -C ' + repo + ' branch ' + item.branch + ' ' + tip + ')'
          : '') + '\n')
    }
  }

  if (existsSync(config.outPath)) {
    let k = 1
    while (existsSync(config.outPath + '.reset-' + k)) k++
    const moved = config.outPath + '.reset-' + k
    renameSync(config.outPath, moved)
    process.stdout.write('reset: moved run directory to ' + moved + '\n')
  }
  process.exit(0)
}

async function main() {
  const config = parseArgv(process.argv.slice(2))
  if (config.reset) runReset(config)
  requireExecutable(config.codexBin)
  if (sandboxNestingBlocked()) reportNestedSandboxAndExit()

  if (existsSync(config.outPath)) {
    process.stderr.write('codex-wave-runner: --out already exists: ' + config.outPath + '\n')
    process.exit(73)
  }

  // Step 2: the plan must be lint-clean before anything is touched.
  const lint = spawnSync(process.execPath,
    [LINT, config.planPath, '--repo', config.repoPath, '--base', config.base],
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

  // Worktree environment (writable cache dirs, linked untracked files) and
  // the repository's git common dir, so every sandboxed Codex child (executor
  // and supervisor) can write caches and, for the executor, commit from a
  // linked worktree. See the Plan Format section in super-plan/SKILL.md.
  const planForEnv = effectivePlan(config.planPath, config.repoPath)
  const env = resolveWorktreeEnv(config.repoPath, planForEnv)
  const scope = recoveryScope({ host: 'codex', repo: config.repoPath, base: config.base,
    waveNumber: config.waveNumber, wave, plan: planForEnv, markdown: originalText })
  const recovery = config.resumeFrom ? readRecovery(config.resumeFrom, scope) : null
  const commonDir = gitCommonDir(config.repoPath)
  if (env.missingWritable.length > 0) {
    process.stderr.write('codex-wave-runner: missing writable dirs (skipped): '
      + env.missingWritable.join(', ') + '\n')
  }

  // depends_on: refuse to start this wave until whatever it depends on is
  // present, before any worktree exists. See the Plan Format section in
  // super-plan/SKILL.md. Checked before --out is created, before verify, and
  // before `init`: a stop here must leave nothing behind to clean up.
  const unmetDependsOn = checkDependsOn(planForEnv, config.waveNumber, config.repoPath)
  if (unmetDependsOn.length > 0) {
    const summary = {
      status: 'stop',
      wave: config.waveNumber,
      stopped: [{ task: '*', reason: 'depends-on-unmet' }],
      dependsOn: unmetDependsOn,
      cleanup: [],
    }
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n')
    process.exit(1)
  }

  // Preflight: probe every distinct must_run command, sandboxed at the base
  // commit, before any model child starts and before --out or any task
  // worktree/state exists — a matched signature stops the whole run here,
  // cheaply, with nothing left to clean up, instead of every task
  // discovering the same machine problem on its own after `init` has already
  // created its worktree, branch and state file. A red command with no
  // matching signature is only ever recorded (it may be expected-red), which
  // is why its result still rides along on the final summary.json below even
  // when nothing is blocked.
  let preflightResults = null
  if (config.preflightOn && !recovery) {
    const { blocked, blocks, results } = runPreflight({
      codexBin: config.codexBin, repoPath: config.repoPath, base: config.base, timeoutMs: config.timeoutMs,
      env, commonDir, networkOn: config.executorNetworkOn, wave,
    })
    preflightResults = results
    if (blocked) {
      const summary = {
        status: 'stop',
        wave: config.waveNumber,
        stopped: [{ task: '*', reason: 'environment-blocked' }],
        preflight: { results, blocked, blocks },
        cleanup: [],
      }
      process.stdout.write(JSON.stringify(summary, null, 2) + '\n')
      process.stderr.write(blocked.line + '\n')
      process.exit(1)
    }
  }

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
      originalText, plan, waveIndex, taskId, outPath: config.outPath,
      planBasename: recovery ? planBasename + '-recovery-' + createHash('sha256').update(config.outPath).digest('hex').slice(0, 12) : planBasename,
    })
    const derivedLint = spawnSync(process.execPath,
      [LINT, derivedPlanPath, '--repo', config.repoPath, '--base', config.base],
      { encoding: 'utf8' })
    if (derivedLint.status !== 0) {
      process.stdout.write(derivedLint.stdout || '')
      process.stderr.write(derivedLint.stderr || '')
      process.stderr.write('codex-wave-runner: derived plan for task "' + taskId + '" failed lint\n')
      process.exit(1)
    }
    let initResult
    try {
      initResult = recovery ? runHelper(['adopt-candidate', '--plan', derivedPlanPath, '--wave', String(config.waveNumber),
        '--repo', config.repoPath, '--base', config.base], { [taskId]: { ...recovery.tasks[taskId],
          report: recoveredReport(recovery.tasks[taskId].report) } })
        : helperInit(derivedPlanPath, config.waveNumber, config.repoPath, config.base)
    } catch (error) {
      const gitNotWritable = /cannot lock ref|unable to create directory|Operation not permitted/
        .test(error.message)
      const hint = gitNotWritable
        ? '\nthe repository\'s .git is not writable in this session; run the runner where it can write'
          + ' .git (for example `codex exec --add-dir <repo>/.git`, or full access)'
        : ''
      process.stderr.write('codex-wave-runner: init failed for task "' + taskId + '": '
        + error.message + hint + '\n')
      process.exit(1)
    }
    if (!Array.isArray(initResult.tasks) || initResult.tasks.length !== 1 || initResult.tasks[0] !== taskId) {
      process.stderr.write('codex-wave-runner: init for task "' + taskId
        + '" did not produce a single-task state as expected\n')
      process.exit(1)
    }
    statePaths[taskId] = initResult.state
  }

  if (recovery) claimRecovery(recovery, join(config.outPath, 'summary.json'))
  const semaphore = createSemaphore(config.jobs)
  const children = recovery ? [...recovery.summary.children] : []
  // taskId -> { source: 'executor'|'supervisor', id, line } the first time a
  // child's failure is classified environment for that task, so the blocked
  // line reaches the orchestrator on the final stopped[] entry (the state
  // helper itself only ever receives {error:{kind:'environment'}}).
  const environmentBlocks = {}

  // taskId -> { threadId, model, effort, usage } of the task's last executor
  // child that exited 0 in time with a non-empty report, in this runner
  // process only. `usage` is that thread's cumulative usage so far.
  const executorSessions = new Map()

  // One executor child. With `session` it resumes that thread on
  // action.continuation; without, it starts a fresh thread on action.prompt.
  // Returns the payload for record-executor and whether an environment block
  // was found; the caller records exactly one payload per state attempt.
  async function launchExecutor(taskId, action, session, fallbackFrom) {
    const taskDir = join(config.outPath, taskId)
    mkdirSync(taskDir, { recursive: true })
    const attempt = (children.filter((c) => c.task === taskId && c.role === 'executor').length) + 1
    const promptPath = join(taskDir, 'executor-' + attempt + '.prompt.md')
    const reportPath = join(taskDir, 'executor-' + attempt + '.report.md')
    const eventsPath = join(taskDir, 'executor-' + attempt + '.events.jsonl')
    const stderrPath = join(taskDir, 'executor-' + attempt + '.stderr')
    const prompt = session ? action.continuation : action.prompt
    writeFileSync(promptPath, prompt)
    const writableRoots = 'sandbox_workspace_write.writable_roots='
      + JSON.stringify([worktreeGitDir(action.worktree), commonDir, ...env.writable])
    // `codex exec resume` accepts neither --sandbox, -C nor --add-dir: the
    // sandbox is set through -c overrides and the worktree through cwd.
    const args = session ? [
      'exec', 'resume', session.threadId, '--skip-git-repo-check',
      '-c', 'sandbox_mode="workspace-write"',
      '-c', writableRoots,
      ...(config.executorNetworkOn ? ['-c', 'sandbox_workspace_write.network_access=true'] : []),
      '--model', action.model,
      '-c', 'model_reasoning_effort=' + action.effort,
      '--json', '-o', reportPath, '-',
    ] : [
      'exec', '--skip-git-repo-check', '-C', action.worktree,
      '--sandbox', 'workspace-write',
      '--add-dir', commonDir,
      ...env.writable.flatMap((d) => ['--add-dir', d]),
      '-c', writableRoots,
      ...(config.executorNetworkOn ? ['-c', 'sandbox_workspace_write.network_access=true'] : []),
      '--model', action.model,
      '-c', 'model_reasoning_effort=' + action.effort,
      '--json', '-o', reportPath, '-',
    ]
    const result = await runCodexChild({
      semaphore, codexBin: config.codexBin, args, prompt,
      eventsPath, stderrPath, timeoutMs: config.timeoutMs,
      ...(session ? { cwd: action.worktree } : {}),
    })
    const threadId = session ? session.threadId : readThreadId(eventsPath)
    children.push({
      task: taskId, role: 'executor', attempt, model: action.model, effort: action.effort,
      exit: result.exitCode, seconds: result.wallSeconds,
      usage: session ? usageSince(result.usage, session.usage) : result.usage,
      promptFile: promptPath, eventsFile: eventsPath, stderrFile: stderrPath,
      ...(session ? { resumed: true } : {}),
      ...(threadId ? { threadId } : {}),
      ...(fallbackFrom ? { fallbackFrom } : {}),
      ...(result.timedOut ? { timedOut: true, eventsTail: tailLines(eventsPath, 10, 500) } : {}),
    })
    let payload
    let envBlock = null
    if (result.timedOut || result.exitCode !== 0) {
      envBlock = checkEnvironmentBlock(stderrPath, eventsPath)
      payload = envBlock ? { error: { kind: 'environment' } } : { error: { kind: 'transport' } }
    } else {
      let report = ''
      try { report = readFileSync(reportPath, 'utf8') } catch { report = '' }
      if (report === '') {
        envBlock = checkEnvironmentBlock(stderrPath, eventsPath)
        payload = envBlock ? { error: { kind: 'environment' } } : { error: { kind: 'null-result' } }
      } else {
        payload = { report }
      }
    }
    if (Object.hasOwn(payload, 'report')) {
      // The stored cumulative usage only ever moves forward, and only on a
      // child that actually reported a completed turn.
      const advanced = !session || (hasTurnCompleted(eventsPath)
        && Object.keys(result.usage).every((key) => result.usage[key] >= (session.usage[key] ?? 0)))
      executorSessions.set(taskId, {
        threadId, model: action.model, effort: action.effort,
        usage: advanced ? result.usage : session.usage,
      })
    } else {
      executorSessions.delete(taskId)
    }
    return { payload, envBlock }
  }

  // The per-task model-call cap: every child of the task counts, whatever
  // its role. It applies only with an explicit limit or on a recovery run.
  const modelCallCapReached = (taskId) => (wave.limits?.max_model_calls !== undefined || recovery)
    && children.filter(child => child.task === taskId).length >= (wave.limits?.max_model_calls ?? 24)

  async function handleExecutor(taskId, statePath, action) {
    const stored = executorSessions.get(taskId)
    // Resume only the same rung's own thread: same model and effort as the
    // task's previous executor child, with a thread id read in this process.
    const session = typeof action.continuation === 'string' && action.continuation !== ''
      && stored && stored.model === action.model && stored.effort === action.effort
      && typeof stored.threadId === 'string' && stored.threadId !== ''
      ? stored : null
    let outcome = await launchExecutor(taskId, action, session, null)
    // A resume that failed for no machine reason is retried at once as a
    // fresh thread within the same state attempt: only the fresh child's
    // payload is recorded, so the state's attempt counters never see it.
    // At the model-call cap there is no fallback: the failed resume's own
    // payload is recorded and the dispatch loop stops the task.
    if (session && !Object.hasOwn(outcome.payload, 'report') && !outcome.envBlock
      && !modelCallCapReached(taskId)) {
      outcome = await launchExecutor(taskId, action, null, 'resume')
    }
    if (outcome.envBlock) {
      environmentBlocks[taskId] = { source: 'executor', id: outcome.envBlock.id, line: outcome.envBlock.line }
    }
    helperRecordExecutor(statePath, taskId, outcome.payload)
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

  // The --output-schema JSON Schema cannot express codex-wave-state.mjs's own
  // rule that `ok === (violations.length === 0)` (record-verdict's
  // validVerdict enforces it and throws otherwise). A model can satisfy the
  // schema while violating that rule, e.g. {"ok":true,"violations":[{...}]},
  // which would otherwise make record-verdict throw and stop the whole task
  // as "runner-error". Check for that mismatch here and treat it the same as
  // a null result, so the helper's ordinary supervisor-failure policy
  // (agentFailures / consecutive-failure -> "error") applies instead.
  function isConsistentVerdict(verdict) {
    return Boolean(verdict) && typeof verdict === 'object' && !Array.isArray(verdict)
      && typeof verdict.ok === 'boolean'
      && Array.isArray(verdict.violations)
      && Array.isArray(verdict.remarks) && verdict.remarks.every((remark) => typeof remark === 'string')
      && verdict.ok === (verdict.violations.length === 0)
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

    const pinnedHead = spawnSync('git', ['-C', config.repoPath, 'rev-parse', action.branch], { encoding: 'utf8' }).stdout.trim()
    const bound = JSON.parse(readFileSync(statePath, 'utf8')).tasks[taskId].verifierFacts.at(-1)?.verification?.head
    if (bound && bound !== pinnedHead) throw new Error('candidate changed after verification')
    const added = spawnSync('git', ['-C', config.repoPath, 'worktree', 'add', '--detach',
      checkoutPath, pinnedHead], { encoding: 'utf8' })
    if (added.status !== 0) {
      throw new Error('supervisor worktree checkout failed for task "' + taskId + '": '
        + (added.stderr || added.stdout))
    }
    applyLinks(config.repoPath, checkoutPath, env.links)
    try {
      const args = [
        'exec', '--ephemeral', '--skip-git-repo-check', '-C', checkoutPath,
        '--sandbox', 'workspace-write',
        '--add-dir', commonDir,
        ...env.writable.flatMap((d) => ['--add-dir', d]),
        '-c', 'sandbox_workspace_write.writable_roots=' + JSON.stringify([worktreeGitDir(checkoutPath), commonDir, ...env.writable]),
        ...(config.executorNetworkOn ? ['-c', 'sandbox_workspace_write.network_access=true'] : []),
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
        promptFile: promptPath, eventsFile: eventsPath, stderrFile: stderrPath,
        ...(result.timedOut ? { timedOut: true, eventsTail: tailLines(eventsPath, 10, 500) } : {}),
      })
      let payload
      if (result.timedOut || result.exitCode !== 0) {
        const envBlock = checkEnvironmentBlock(stderrPath, eventsPath)
        if (envBlock) environmentBlocks[taskId] = { source: 'supervisor', id: envBlock.id, line: envBlock.line }
        payload = envBlock ? { error: { kind: 'environment' } } : { error: { kind: 'transport' } }
      } else {
        let parsed = null
        try { parsed = JSON.parse(readFileSync(reportPath, 'utf8')) } catch { parsed = null }
        if (parsed === null) {
          const envBlock = checkEnvironmentBlock(stderrPath, eventsPath)
          if (envBlock) environmentBlocks[taskId] = { source: 'supervisor', id: envBlock.id, line: envBlock.line }
          payload = envBlock ? { error: { kind: 'environment' } } : { error: { kind: 'null-result' } }
        } else {
          const stripped = stripNullViolationKeys(parsed)
          payload = isConsistentVerdict(stripped) ? stripped : { error: { kind: 'null-result' } }
        }
      }
      const head = spawnSync('git', ['-C', checkoutPath, 'rev-parse', 'HEAD'], { encoding: 'utf8' })
      const branchHead = spawnSync('git', ['-C', config.repoPath, 'rev-parse', action.branch], { encoding: 'utf8' })
      const status = spawnSync('git', ['-C', checkoutPath, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' })
      if (head.status !== 0 || head.stdout.trim() !== pinnedHead || branchHead.status !== 0
        || branchHead.stdout.trim() !== pinnedHead || status.status !== 0 || status.stdout.trim()) {
        payload = { error: { kind: 'null-result' } }
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
        if (recovery && action.action === 'merge-ready') candidate(config.repoPath, config.base, taskId, recovery.tasks[taskId].head)
        if (action.action === 'merge-ready') return { task: taskId, status: 'merge-ready' }
        if (action.action === 'stop') return { task: taskId, status: 'stop', reason: action.reason }
        if (['spawn-executor', 'spawn-supervisor'].includes(action.action) && modelCallCapReached(taskId)) {
          return { task: taskId, status: 'stop', reason: 'budget-exhausted' }
        }
        if (recovery && action.action === 'spawn-executor') return { task: taskId, status: 'stop', reason: 'candidate-rejected' }
        if (recovery) candidate(config.repoPath, config.base, taskId, recovery.tasks[taskId].head)
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

  const stopped = results.filter((r) => r.status === 'stop').map((r) => ({
    task: r.task, reason: r.reason,
    ...(environmentBlocks[r.task] ? { environment: environmentBlocks[r.task] } : {}),
  }))
  const status = stopped.length === 0 ? 'merge-ready' : 'stop'
  const states = taskIds.map((taskId) => statePaths[taskId])
  const tasks = taskIds.map((taskId) => helperSummary(statePaths[taskId]).tasks[0])

  const reports = Object.fromEntries(taskIds.map(id => {
    const state = JSON.parse(readFileSync(statePaths[id], 'utf8'))
    return [id, state.tasks[id].reports.at(-1) || '']
  }))
  const summary = {
    recovery: makeRecoveryReceipt(scope, children, reports),
    ...(recovery ? { previousSummary: recovery.path } : {}),
    status, stopped, states, wave: config.waveNumber, tasks, children, wallSeconds,
    ...(preflightResults ? { preflight: { results: preflightResults } } : {}),
    ...(status === 'stop'
      ? { cleanup: buildCleanup(config.repoPath, stopped.map((s) => s.task), statePaths) }
      : {}),
    ...(status === 'merge-ready'
      ? {
        afterIntegration: 'node ' + join(here, 'wave-cleanup.mjs') + ' --repo ' + config.repoPath
          + ' --plan ' + config.planPath + ' --wave ' + config.waveNumber
          + ' --summary ' + join(config.outPath, 'summary.json'),
      }
      : {}),
  }
  if (summary.cleanup) {
    for (const line of summary.cleanup) process.stderr.write(line + '\n')
    // Each cleanup line above also removes that task's state file (see
    // cleanupLine), so once every printed line has been run, a fresh --out
    // is all a re-run needs.
    process.stderr.write('recover a clean candidate with --resume-from ' + join(config.outPath, 'summary.json')
      + ' --out <new-dir>; cleanup discards the candidate\n')
    process.stderr.write('re-run with a fresh --out after cleanup\n')
    process.stderr.write('codex-wave-runner: or re-run after: node ' + fileURLToPath(import.meta.url)
      + ' --reset --plan ' + config.planPath + ' --wave ' + config.waveNumber
      + ' --repo ' + config.repoPath + ' --base ' + config.base + '\n')
  }
  writeFileSync(join(config.outPath, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n')
  process.exit(status === 'merge-ready' ? 0 : 1)
}

await main()
