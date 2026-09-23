// Behaviour tier — codex-wave-runner.mjs against a real disposable Git repo
// and the offline tests/fixtures/bin/codex-stub double for `codex exec`.
// Never calls a real model or touches the network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..', '..')
const RUNNER = join(ROOT, 'plugins', 'orchestration', 'skills', 'multi-model', 'references',
  'codex-wave-runner.mjs')
const STUB = join(ROOT, 'tests', 'fixtures', 'bin', 'codex-stub')

const roots = []
process.on('exit', () => roots.forEach((path) => rmSync(path, { recursive: true, force: true })))

function git(repo, ...args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(['git', ...args].join(' ') + '\n' + result.stdout + result.stderr)
  }
  return result.stdout.trim()
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'codex-wave-runner-'))
  roots.push(root)
  const repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init')
  // Not sourced from tests/test-env.sh here (this file is registered as a
  // raw `node --test` invocation), so every disposable repo configures
  // itself: a real machine's global commit.gpgsign=true would otherwise
  // hang the stub's `git commit` on a GPG prompt.
  git(repo, 'config', 'user.name', 'Codex Runner Test')
  git(repo, 'config', 'user.email', 'codex-runner-test@example.invalid')
  git(repo, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(repo, 'README.md'), 'base\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'base')
  const base = git(repo, 'rev-parse', 'HEAD')
  return { root, repo, base }
}

// One task per id, models fixed per the task brief: gpt-6-luna executor,
// gpt-6-sol ladder rung, gpt-6-astra/high supervisor. Distinct files_allowed
// globs per task so the *original* plan itself stays lint-clean (same-wave
// tasks must not share files) before the runner ever splits it.
function planText(taskIds) {
  const tasks = taskIds.map((id) => [
    '      { "id": "' + id + '", "branch": "wave/' + id + '",',
    '        "executor": { "model": "gpt-6-luna", "effort": "medium" },',
    '        "ladder": ["gpt-6-sol"],',
    '        "contract": {',
    '          "files_allowed": ["src/' + id + '/**"],',
    '          "files_forbidden": [],',
    '          "must_run": [{ "cmd": "true", "evidence": "required" }],',
    '          "forbidden_moves": [],',
    '          "report_must_answer": ["What did the stub change?"] } }',
  ].join('\n')).join(',\n')
  const prose = taskIds.map((id) => '## Task ' + id + '\n\nStub work for ' + id + '.\n').join('\n')
  return [
    'status: draft',
    'base: pending',
    '',
    '# Plan — codex wave runner fixture',
    '',
    '```json wave-plan',
    '{ "waves": [',
    '  { "wave": 1,',
    '    "supervisor": { "model": "gpt-6-astra", "effort": "high" },',
    '    "tasks": [',
    tasks,
    '    ] }',
    '] }',
    '```',
    '',
    prose,
  ].join('\n')
}

function writePlan(root, taskIds) {
  const path = join(root, 'plan.md')
  writeFileSync(path, planText(taskIds))
  return path
}

function runRunner(args, env = {}) {
  const result = spawnSync(process.execPath, [RUNNER, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  })
  let json = null
  try { json = JSON.parse(result.stdout) } catch { /* not every run prints JSON (usage errors, lint) */ }
  return { ...result, json }
}

// Each stub invocation writes its start/end record to its own file under
// "<path>.d" (see tests/fixtures/bin/codex-stub), so concurrent writers
// never interleave into a shared log. Read every record and sort it back
// into a stable, deterministic order: by timestamp, tie-broken by file name
// (the file name embeds a nanosecond timestamp and pid, so ties are rare).
function readLog(path) {
  const dir = path + '.d'
  const names = readdirSync(dir).filter((name) => name.endsWith('.json')).sort()
  return names
    .map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')))
    .map((record, i) => ({ record, name: names[i] }))
    .sort((a, b) => (a.record.ts - b.record.ts) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map(({ record }) => record)
}

// ---------------------------------------------------------------------------

test('usage text is printed for --help', () => {
  const result = runRunner(['--help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /^usage: node codex-wave-runner\.mjs/)
  assert.match(result.stdout, /--jobs 3/)
})

test('(a) two tasks, good executor, clean verdict reach merge-ready', () => {
  const { root, repo, base } = makeRepo()
  const planPath = writePlan(root, ['task-a', 'task-b'])
  const outPath = join(root, 'out')
  const logPath = join(root, 'codex.log')

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB, '--out', outPath],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good' },
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.ok(result.json, 'stdout must be one JSON summary')
  assert.equal(result.json.status, 'merge-ready')
  assert.deepEqual(result.json.stopped, [])
  assert.equal(result.json.wave, 1)

  for (const id of ['task-a', 'task-b']) {
    assert.match(git(repo, 'log', '--oneline', 'wave/' + id), /stub: task work/,
      'branch ' + id + ' must carry the stub commit')
  }

  const executors = result.json.children.filter((c) => c.role === 'executor')
  const supervisors = result.json.children.filter((c) => c.role === 'supervisor')
  assert.equal(executors.length, 2, 'two executor children')
  assert.equal(supervisors.length, 2, 'two supervisor children')
  for (const child of result.json.children) {
    assert.equal(child.exit, 0)
    assert.deepEqual(Object.keys(child.usage).sort(),
      ['cached_input_tokens', 'input_tokens', 'output_tokens', 'reasoning_output_tokens'].sort())
    assert.ok(child.usage.input_tokens > 0, 'usage must be summed from turn.completed, not left at 0')
  }

  // Every prompt file equals what the helper returned: compare to the exact
  // prompt the stub received on stdin and logged.
  const logEntries = readLog(logPath).filter((entry) => entry.event === 'start')
  for (const child of result.json.children) {
    const onDisk = readFileSync(child.promptFile, 'utf8')
    const logged = logEntries.find((entry) => entry.cwd
      && (entry.prompt === onDisk) && entry.cwd.endsWith(child.role === 'executor'
        ? 'wave-' + child.task
        : 'supervisor-' + child.attempt))
    assert.ok(logged, 'no stub invocation logged the exact prompt written to ' + child.promptFile)
    assert.equal(logged.prompt, onDisk)
  }
  assert.equal(executors.every((c) => readFileSync(c.promptFile, 'utf8').startsWith('# Task: ')), true)
  assert.equal(supervisors.every((c) => readFileSync(c.promptFile, 'utf8').startsWith('# Supervisor Prompt')),
    true)

  // Supervisor worktrees are removed afterwards.
  const worktrees = git(repo, 'worktree', 'list', '--porcelain')
  assert.equal(worktrees.includes('supervisor-'), false, 'no supervisor worktree should remain: ' + worktrees)

  assert.equal(result.json.tasks.length, 2)
  assert.ok(result.json.tasks.every((t) => t.status === 'ok'))
})

test('(b) --jobs 1 never overlaps children; --jobs 2 does', () => {
  const one = makeRepo()
  const onePlan = writePlan(one.root, ['task-a', 'task-b'])
  const oneLog = join(one.root, 'codex.log')
  const oneResult = runRunner(
    ['--plan', onePlan, '--wave', '1', '--repo', one.repo, '--base', one.base,
      '--codex', STUB, '--jobs', '1', '--out', join(one.root, 'out')],
    { CODEX_STUB_LOG: oneLog, CODEX_STUB_EXECUTOR_MODE: 'good', CODEX_STUB_SLEEP: '1' },
  )
  assert.equal(oneResult.status, 0, oneResult.stdout + oneResult.stderr)
  const oneEvents = readLog(oneLog)
  const oneIntervals = oneEvents.filter((e) => e.event === 'start').map((s) => {
    const end = oneEvents.find((e) => e.event === 'end' && e.ts >= s.ts
      && JSON.stringify(e.argv) === JSON.stringify(s.argv))
    return [s.ts, end.ts]
  })
  const oneOverlaps = oneIntervals.some(([aStart, aEnd], i) => oneIntervals.some(([bStart], j) =>
    i !== j && bStart >= aStart && bStart < aEnd))
  assert.equal(oneOverlaps, false, '--jobs 1 must never run two children at once: ' + JSON.stringify(oneIntervals))
  assert.equal(oneIntervals.length, 4, 'two executors and two supervisors')

  const two = makeRepo()
  const twoPlan = writePlan(two.root, ['task-a', 'task-b'])
  const twoLog = join(two.root, 'codex.log')
  const twoResult = runRunner(
    ['--plan', twoPlan, '--wave', '1', '--repo', two.repo, '--base', two.base,
      '--codex', STUB, '--jobs', '2', '--out', join(two.root, 'out')],
    { CODEX_STUB_LOG: twoLog, CODEX_STUB_EXECUTOR_MODE: 'good', CODEX_STUB_SLEEP: '1' },
  )
  assert.equal(twoResult.status, 0, twoResult.stdout + twoResult.stderr)
  const twoEvents = readLog(twoLog)
  const twoIntervals = twoEvents.filter((e) => e.event === 'start').map((s) => {
    const end = twoEvents.find((e) => e.event === 'end' && e.ts >= s.ts
      && JSON.stringify(e.argv) === JSON.stringify(s.argv))
    return [s.ts, end.ts]
  })
  const twoOverlaps = twoIntervals.some(([aStart, aEnd], i) => twoIntervals.some(([bStart], j) =>
    i !== j && bStart >= aStart && bStart < aEnd))
  assert.equal(twoOverlaps, true, '--jobs 2 must run at least two children concurrently at some point: '
    + JSON.stringify(twoIntervals))
})

test('(c) an empty executor report is recorded as null-result and the loop continues', () => {
  const { root, repo, base } = makeRepo()
  const planPath = writePlan(root, ['task-a'])
  const logPath = join(root, 'codex.log')

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB,
      '--out', join(root, 'out')],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'empty' },
  )
  // codex-wave-state.mjs turns two consecutive agent failures at the same
  // attempt number into task status "error" (appendAgentFailure) — the loop
  // does continue (a second spawn-executor happens) rather than stopping on
  // the first empty report, which is exactly what this case checks for.
  assert.equal(result.status, 1)
  assert.ok(result.json, result.stdout + result.stderr)
  assert.equal(result.json.status, 'stop')
  assert.equal(result.json.stopped.length, 1)
  assert.equal(result.json.stopped[0].task, 'task-a')
  assert.equal(result.json.stopped[0].reason, 'error')
  const executors = result.json.children.filter((c) => c.role === 'executor')
  assert.ok(executors.length >= 2, 'the helper must have been asked for a second attempt: '
    + JSON.stringify(executors))
  assert.ok(executors.every((c) => c.exit === 0), 'the stub itself exits 0 in empty mode')
  // No branch commit was ever produced, since the executor never committed.
  const branches = git(repo, 'branch', '--list', 'wave/task-a')
  assert.notEqual(branches, '')
})

test('(d) an unsatisfiable verdict stops the wave with contract-unsatisfiable', () => {
  const { root, repo, base } = makeRepo()
  const planPath = writePlan(root, ['task-a'])
  const logPath = join(root, 'codex.log')
  const verdict = JSON.stringify({
    ok: false,
    violations: [{
      rule: 'must_run: true', class: 'must_run', evidence: 'no compliant change could pass this',
      satisfiable: false,
    }],
    remarks: [],
  })

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB,
      '--out', join(root, 'out')],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good', CODEX_STUB_VERDICT: verdict },
  )
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.ok(result.json)
  assert.equal(result.json.status, 'stop')
  assert.deepEqual(result.json.stopped, [{ task: 'task-a', reason: 'contract-unsatisfiable' }])
})

test('(e) an already-existing --out exits 73', () => {
  const { root, repo, base } = makeRepo()
  const planPath = writePlan(root, ['task-a'])
  const outPath = join(root, 'out')
  mkdirSync(outPath, { recursive: true })

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB, '--out', outPath],
    { CODEX_STUB_LOG: join(root, 'codex.log') },
  )
  assert.equal(result.status, 73)
})

test('(f) a lint error exits 1 and creates no .worktrees/wave-*', () => {
  const { root, repo, base } = makeRepo()
  // No column-0 `status:` header — plan-lint.mjs rejects this before the
  // runner ever touches state.
  const planPath = join(root, 'plan.md')
  writeFileSync(planPath, planText(['task-a']).split('\n').slice(2).join('\n'))

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB,
      '--out', join(root, 'out')],
    { CODEX_STUB_LOG: join(root, 'codex.log') },
  )
  assert.equal(result.status, 1)
  assert.match(result.stdout, /status:/)
  const worktrees = spawnSync('sh', ['-c', 'ls "' + repo + '/.worktrees" 2>/dev/null | grep "^wave-" || true'],
    { encoding: 'utf8' }).stdout.trim()
  assert.equal(worktrees, '', 'no wave-* worktree may exist after a lint failure')
})
