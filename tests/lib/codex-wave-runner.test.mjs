// Behaviour tier — codex-wave-runner.mjs against a real disposable Git repo
// and the offline tests/fixtures/bin/codex-stub double for `codex exec`.
// Never calls a real model or touches the network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync,
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
//
// Top-level plan keys: ci is "none" (no CI in this fixture repo), e2e names
// the first task (an existing id) so a derived-plan test can exercise both
// the kept-object and the rewritten-to-not-applicable cases, and approvals
// carries the premium sign-off required whenever gpt-6-astra is used (the
// fixture's supervisor, always).
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
    '  ],',
    '  "ci": "none: this fixture repo has no CI to run",',
    '  "e2e": { "task": "' + taskIds[0] + '" },',
    '  "approvals": { "premium": { "models": ["gpt-6-astra"],',
    '    "reason": "wave supervisor", "approved_by": "codex-wave-runner-test",',
    '    "date": "2026-09-24" } }',
    '}',
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

// Same as makeRepo, plus a tracked gradlew and a gitignored, untracked
// local.properties — the resolveWorktreeEnv auto-detection fixture from
// worktree-env.mjs (see tests/lib/worktree-env.test.mjs for the equivalent
// direct-unit coverage of that helper).
function makeGradleRepo() {
  const root = mkdtempSync(join(tmpdir(), 'codex-wave-runner-'))
  roots.push(root)
  const repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init')
  git(repo, 'config', 'user.name', 'Codex Runner Test')
  git(repo, 'config', 'user.email', 'codex-runner-test@example.invalid')
  git(repo, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(repo, 'README.md'), 'base\n')
  writeFileSync(join(repo, 'gradlew'), '#!/bin/sh\necho stub\n')
  writeFileSync(join(repo, '.gitignore'), 'local.properties\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'base')
  // Added after the commit so it stays untracked (isUntracked checks
  // git ls-files) while still matching .gitignore. Never opened again once
  // written: this test only ever asserts on the stub's logged *name*.
  writeFileSync(join(repo, 'local.properties'), 'sdk.dir=/nonexistent\n')
  const base = git(repo, 'rev-parse', 'HEAD')
  return { root, repo, base }
}

// The exact argv index-pairing every --add-dir assertion below relies on.
function addDirValues(argv) {
  const out = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--add-dir') out.push(argv[i + 1])
  }
  return out
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

test('CODEX_WAVE_RUNNER_SANDBOX_PROBE=fail exits 2 with the nested-sandbox error and launches nothing', () => {
  const { root, repo, base } = makeRepo()
  const planPath = writePlan(root, ['task-a'])
  const logPath = join(root, 'codex.log')

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB,
      '--out', join(root, 'out')],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good', CODEX_WAVE_RUNNER_SANDBOX_PROBE: 'fail' },
  )
  assert.equal(result.status, 2, result.stdout + result.stderr)
  assert.ok(result.json, 'stdout must be one JSON error object: ' + result.stdout)
  assert.deepEqual(result.json, {
    status: 'error',
    error: 'nested-sandbox',
    message: 'codex-wave-runner.mjs is running inside a sandbox that forbids nested sandboxing '
      + '(macOS seatbelt cannot nest), so its codex exec children cannot run commands. Run this '
      + 'command outside the Codex sandbox (escalated permissions); the children keep their own '
      + 'sandboxes.',
  })
  assert.equal(existsSync(logPath + '.d'), false, 'the stub must never have been invoked')
  assert.equal(existsSync(join(root, 'out')), false, 'no run directory may be created')
})

test('CODEX_WAVE_RUNNER_SANDBOX_PROBE=skip bypasses the probe and the wave runs to merge-ready', () => {
  const { root, repo, base } = makeRepo()
  const planPath = writePlan(root, ['task-a'])
  const outPath = join(root, 'out')
  const logPath = join(root, 'codex.log')

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB, '--out', outPath],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good', CODEX_WAVE_RUNNER_SANDBOX_PROBE: 'skip' },
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.ok(result.json, 'stdout must be one JSON summary')
  assert.equal(result.json.status, 'merge-ready')
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
  // --preflight off: this test is about jobs concurrency, not the preflight
  // probe, and the probe would otherwise add its own logged `sandbox`
  // invocation ahead of every executor/supervisor here, throwing off the
  // interval count and overlap math below.
  const oneResult = runRunner(
    ['--plan', onePlan, '--wave', '1', '--repo', one.repo, '--base', one.base,
      '--codex', STUB, '--jobs', '1', '--preflight', 'off', '--out', join(one.root, 'out')],
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
      '--codex', STUB, '--jobs', '2', '--preflight', 'off', '--out', join(two.root, 'out')],
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

test('(g) --jobs 2 with three tasks never overlaps more than two children, and overlaps at least once', () => {
  const { root, repo, base } = makeRepo()
  const planPath = writePlan(root, ['task-a', 'task-b', 'task-c'])
  const logPath = join(root, 'codex.log')

  // --preflight off: see the matching note on test (b) above.
  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base,
      '--codex', STUB, '--jobs', '2', '--preflight', 'off', '--out', join(root, 'out')],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good', CODEX_STUB_SLEEP: '1' },
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)

  const events = readLog(logPath)
  const intervals = events.filter((e) => e.event === 'start').map((s) => {
    const end = events.find((e) => e.event === 'end' && e.ts >= s.ts
      && JSON.stringify(e.argv) === JSON.stringify(s.argv))
    return [s.ts, end.ts]
  })
  assert.equal(intervals.length, 6, 'three executors and three supervisors')

  // Sweep-line max concurrency: never more than --jobs children overlapping.
  const points = intervals.flatMap(([start, end]) => [[start, 1], [end, -1]])
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  let concurrent = 0
  let maxConcurrent = 0
  for (const [, delta] of points) {
    concurrent += delta
    maxConcurrent = Math.max(maxConcurrent, concurrent)
  }
  assert.ok(maxConcurrent <= 2, '--jobs 2 must never run more than two children at once: max was '
    + maxConcurrent + ' ' + JSON.stringify(intervals))

  const anyOverlap = intervals.some(([aStart, aEnd], i) => intervals.some(([bStart], j) =>
    i !== j && bStart >= aStart && bStart < aEnd))
  assert.equal(anyOverlap, true, '--jobs 2 must run at least two children concurrently at some point: '
    + JSON.stringify(intervals))
})

test('(h) executor fail mode is recorded as a transport agent failure', () => {
  const { root, repo, base } = makeRepo()
  const planPath = writePlan(root, ['task-a'])
  const logPath = join(root, 'codex.log')

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB,
      '--out', join(root, 'out')],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'fail' },
  )
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.ok(result.json, result.stdout + result.stderr)
  assert.equal(result.json.status, 'stop')
  assert.equal(result.json.stopped.length, 1)
  assert.equal(result.json.stopped[0].task, 'task-a')
  assert.equal(result.json.stopped[0].reason, 'error')

  const state = JSON.parse(readFileSync(result.json.states[0], 'utf8'))
  const failures = state.tasks['task-a'].agentFailures
  assert.ok(failures.some((f) => f.point === 'executor' && f.kind === 'transport'),
    'expected a recorded executor transport failure: ' + JSON.stringify(failures))
})

test('(i) a child that outlives --timeout-min is killed and recorded as transport', () => {
  const { root, repo, base } = makeRepo()
  const planPath = writePlan(root, ['task-a'])
  const logPath = join(root, 'codex.log')

  // --timeout-min accepts a fractional value (it is not required to be an
  // integer), so a sub-minute timeout is expressed directly on the CLI
  // without needing a test-only seconds override: 0.01 min = 600ms, well
  // under CODEX_STUB_SLEEP's 2 real seconds.
  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB,
      '--timeout-min', '0.01', '--out', join(root, 'out')],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good', CODEX_STUB_SLEEP: '2' },
  )
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.ok(result.json, result.stdout + result.stderr)
  assert.equal(result.json.status, 'stop')
  assert.equal(result.json.stopped[0].task, 'task-a')
  assert.equal(result.json.stopped[0].reason, 'error')

  const executors = result.json.children.filter((c) => c.role === 'executor')
  assert.ok(executors.length >= 2, 'the helper must have been asked for a retry after a timed-out attempt: '
    + JSON.stringify(executors))
  assert.ok(executors.every((c) => c.seconds < 2),
    'every attempt must be killed well before CODEX_STUB_SLEEP elapses: '
    + JSON.stringify(executors.map((c) => c.seconds)))

  const state = JSON.parse(readFileSync(result.json.states[0], 'utf8'))
  const failures = state.tasks['task-a'].agentFailures
  assert.ok(failures.length >= 2 && failures.every((f) => f.point === 'executor' && f.kind === 'transport'),
    'expected timed-out attempts recorded as transport failures: ' + JSON.stringify(failures))
})

test('(j) a violation with null quote/pasteReproduced and satisfiable:true is stripped and reworked, '
  + 'not stopped as contract-unsatisfiable', () => {
  const { root, repo, base } = makeRepo()
  const planPath = writePlan(root, ['task-a'])
  const logPath = join(root, 'codex.log')
  const verdict = JSON.stringify({
    ok: false,
    violations: [{
      rule: 'must_run: true', class: 'must_run', evidence: 'flagged for review',
      quote: null, pasteReproduced: null, satisfiable: true,
    }],
    remarks: [],
  })

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB,
      '--out', join(root, 'out')],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good', CODEX_STUB_VERDICT: verdict },
  )
  // Mode stays "good" for every attempt: the first attempt commits and gets
  // this test's verdict; the retry the task is sent back to writes the exact
  // same content into the same worktree, so it has nothing new to commit and
  // the stub's `git commit` fails — which is enough to terminate the wave
  // quickly and deterministically (as a transport agent failure) without
  // needing the retry to actually succeed. The assertions below are about
  // the first verdict, not about how the task eventually ends.
  assert.ok(result.json, result.stdout + result.stderr)

  const state = JSON.parse(readFileSync(result.json.states[0], 'utf8'))
  const firstVerdict = state.tasks['task-a'].verdicts[0]
  assert.ok(firstVerdict, 'expected at least one recorded verdict')
  const violation = firstVerdict.verdict.violations[0]
  assert.equal(Object.hasOwn(violation, 'quote'), false, 'a null quote must be stripped: '
    + JSON.stringify(violation))
  assert.equal(Object.hasOwn(violation, 'pasteReproduced'), false, 'a null pasteReproduced must be stripped: '
    + JSON.stringify(violation))
  assert.equal(violation.satisfiable, true)

  // satisfiable:true must send the task back to rework, never straight to
  // contract-unsatisfiable — proven here by a second executor attempt having
  // been spawned at all (a stop right after the first verdict would mean
  // only one executor attempt ever ran).
  const executors = result.json.children.filter((c) => c.role === 'executor')
  assert.ok(executors.length >= 2, 'the task must have gone back to rework after the first verdict: '
    + JSON.stringify(executors))
  assert.notEqual(result.json.stopped.find((s) => s.task === 'task-a')?.reason, 'contract-unsatisfiable',
    'satisfiable:true must never stop the task as contract-unsatisfiable')
})

test('(l) a derived single-task plan rewrites a dropped wave-level e2e task to not-applicable, and keeps '
  + 'it for the e2e task itself', () => {
  const { root, repo, base } = makeRepo()
  const planPath = writePlan(root, ['task-a', 'task-b']) // e2e names task-a (planText's first taskId)
  const outPath = join(root, 'out')
  const logPath = join(root, 'codex.log')

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB, '--out', outPath],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good' },
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)

  const readDerivedPlan = (taskId) => {
    const text = readFileSync(join(outPath, 'plans', 'plan--' + taskId + '.md'), 'utf8')
    return JSON.parse(text.match(/```json wave-plan\n([\s\S]*?)\n```/)[1])
  }

  const e2eTaskPlan = readDerivedPlan('task-a')
  assert.deepEqual(e2eTaskPlan.e2e, { task: 'task-a' }, 'the e2e task\'s own derived plan keeps the e2e object')
  assert.equal(e2eTaskPlan.ci, 'none: this fixture repo has no CI to run', 'ci is copied unchanged')
  assert.ok(e2eTaskPlan.approvals && e2eTaskPlan.approvals.premium, 'approvals is copied unchanged')

  const otherTaskPlan = readDerivedPlan('task-b')
  assert.equal(otherTaskPlan.e2e, 'not-applicable: derived single-task plan; the wave-level e2e task is task-a',
    'a derived plan for a non-e2e task carries the not-applicable string naming the dropped e2e task')
  assert.equal(otherTaskPlan.ci, 'none: this fixture repo has no CI to run', 'ci is copied unchanged')
  assert.ok(otherTaskPlan.approvals && otherTaskPlan.approvals.premium, 'approvals is copied unchanged')
})

// Two-wave fixture for the (l1)/(l2) cases below: each wave gets its own
// tasks() block (see planText above), a distinct wave number and its own
// supervisor, so the derived plan for a wave-1 task can be checked against
// an e2e task that lives entirely outside that wave.
function tasksJson(taskIds) {
  return taskIds.map((id) => [
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
}

function planTextMultiWave(waveTaskIds, e2eValue) {
  const waves = waveTaskIds.map((ids, i) => [
    '  { "wave": ' + (i + 1) + ',',
    '    "supervisor": { "model": "gpt-6-astra", "effort": "high" },',
    '    "tasks": [',
    tasksJson(ids),
    '    ] }',
  ].join('\n')).join(',\n')
  const prose = waveTaskIds.flat().map((id) => '## Task ' + id + '\n\nStub work for ' + id + '.\n').join('\n')
  return [
    'status: draft',
    'base: pending',
    '',
    '# Plan — codex wave runner fixture',
    '',
    '```json wave-plan',
    '{ "waves": [',
    waves,
    '  ],',
    '  "ci": "none: this fixture repo has no CI to run",',
    '  "e2e": ' + JSON.stringify(e2eValue) + ',',
    '  "approvals": { "premium": { "models": ["gpt-6-astra"],',
    '    "reason": "wave supervisor", "approved_by": "codex-wave-runner-test",',
    '    "date": "2026-09-24" } }',
    '}',
    '```',
    '',
    prose,
  ].join('\n')
}

test('(l1) a derived single-task plan keeps a wave-level e2e task that lives in another wave', () => {
  const { root, repo, base } = makeRepo()
  const planPath = join(root, 'plan.md')
  // e2e names task-c, which belongs to wave 2 — not a sibling dropped by
  // deriving wave 1's task-a plan, so it must survive untouched.
  writeFileSync(planPath, planTextMultiWave([['task-a'], ['task-c']], { task: 'task-c' }))
  const outPath = join(root, 'out')
  const logPath = join(root, 'codex.log')

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB, '--out', outPath],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good' },
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)

  const derivedText = readFileSync(join(outPath, 'plans', 'plan--task-a.md'), 'utf8')
  const derivedPlan = JSON.parse(derivedText.match(/```json wave-plan\n([\s\S]*?)\n```/)[1])
  assert.deepEqual(derivedPlan.e2e, { task: 'task-c' },
    'an e2e task belonging to another wave is not one of this wave\'s dropped siblings, so it is kept as-is')
})

test('(l2) a string e2e value is passed through unchanged in every derived plan', () => {
  const { root, repo, base } = makeRepo()
  const planPath = join(root, 'plan.md')
  writeFileSync(planPath, planTextMultiWave([['task-a', 'task-b']],
    'not-applicable: no end-to-end fixture in this repo'))
  const outPath = join(root, 'out')
  const logPath = join(root, 'codex.log')

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB, '--out', outPath],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good' },
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)

  for (const id of ['task-a', 'task-b']) {
    const derivedText = readFileSync(join(outPath, 'plans', 'plan--' + id + '.md'), 'utf8')
    const derivedPlan = JSON.parse(derivedText.match(/```json wave-plan\n([\s\S]*?)\n```/)[1])
    assert.equal(derivedPlan.e2e, 'not-applicable: no end-to-end fixture in this repo',
      'a string e2e value is never an object, so the rewrite condition never applies to it')
  }
})

test('(k) an inconsistent verdict (ok:true with a violation) is a supervisor null-result, not a runner crash', () => {
  const { root, repo, base } = makeRepo()
  const planPath = writePlan(root, ['task-a'])
  const logPath = join(root, 'codex.log')
  const verdict = JSON.stringify({
    ok: true,
    violations: [{ rule: 'must_run: true', class: 'must_run', evidence: 'looked fine but flagged anyway' }],
    remarks: [],
  })

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB,
      '--out', join(root, 'out')],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good', CODEX_STUB_VERDICT: verdict },
  )
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.ok(result.json, result.stdout + result.stderr)
  assert.equal(result.json.status, 'stop')
  assert.equal(result.json.stopped.length, 1)
  assert.equal(result.json.stopped[0].task, 'task-a')
  assert.notEqual(result.json.stopped[0].reason, 'runner-error',
    'an inconsistent verdict must not stop the task as runner-error: ' + JSON.stringify(result.json.stopped))
  assert.equal(result.json.stopped[0].reason, 'error')

  const state = JSON.parse(readFileSync(result.json.states[0], 'utf8'))
  const failures = state.tasks['task-a'].agentFailures
  assert.ok(failures.some((f) => f.point === 'supervisor' && f.kind === 'null-result'),
    'expected the inconsistent verdict recorded as a supervisor null-result failure: ' + JSON.stringify(failures))
})

test('(m) executor and supervisor argv both carry --add-dir <git common dir>', () => {
  const { root, repo, base } = makeRepo()
  const planPath = writePlan(root, ['task-a'])
  const logPath = join(root, 'codex.log')

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB,
      '--out', join(root, 'out')],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good' },
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const commonDir = git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir')

  // The preflight probe (default on) logs its own `sandbox` start record
  // with prompt: null (it is never a model call) alongside these — every
  // prompt-based filter below must skip it rather than crash on it.
  const starts = readLog(logPath).filter((entry) => entry.event === 'start')
  const executorStart = starts.find((entry) => entry.prompt?.startsWith('# Task: '))
  const supervisorStart = starts.find((entry) => entry.prompt?.startsWith('# Supervisor Prompt'))
  assert.ok(executorStart, 'expected a logged executor invocation')
  assert.ok(supervisorStart, 'expected a logged supervisor invocation')
  assert.ok(addDirValues(executorStart.argv).includes(commonDir),
    'executor argv must add-dir the git common dir: ' + JSON.stringify(executorStart.argv))
  assert.ok(addDirValues(supervisorStart.argv).includes(commonDir),
    'supervisor argv must add-dir the git common dir: ' + JSON.stringify(supervisorStart.argv))
})

test('(n) supervisor argv gets the network flag by default and drops it with --executor-network off', () => {
  const on = makeRepo()
  const onPlan = writePlan(on.root, ['task-a'])
  const onLog = join(on.root, 'codex.log')
  const onResult = runRunner(
    ['--plan', onPlan, '--wave', '1', '--repo', on.repo, '--base', on.base, '--codex', STUB,
      '--out', join(on.root, 'out')],
    { CODEX_STUB_LOG: onLog, CODEX_STUB_EXECUTOR_MODE: 'good' },
  )
  assert.equal(onResult.status, 0, onResult.stdout + onResult.stderr)
  const onSupervisorStart = readLog(onLog).find((entry) => entry.event === 'start'
    && entry.prompt?.startsWith('# Supervisor Prompt'))
  assert.ok(onSupervisorStart, 'expected a logged supervisor invocation')
  assert.ok(onSupervisorStart.argv.includes('sandbox_workspace_write.network_access=true'),
    'supervisor argv must carry the network flag by default: ' + JSON.stringify(onSupervisorStart.argv))

  const off = makeRepo()
  const offPlan = writePlan(off.root, ['task-a'])
  const offLog = join(off.root, 'codex.log')
  const offResult = runRunner(
    ['--plan', offPlan, '--wave', '1', '--repo', off.repo, '--base', off.base, '--codex', STUB,
      '--executor-network', 'off', '--out', join(off.root, 'out')],
    { CODEX_STUB_LOG: offLog, CODEX_STUB_EXECUTOR_MODE: 'good' },
  )
  assert.equal(offResult.status, 0, offResult.stdout + offResult.stderr)
  const offSupervisorStart = readLog(offLog).find((entry) => entry.event === 'start'
    && entry.prompt?.startsWith('# Supervisor Prompt'))
  assert.ok(offSupervisorStart, 'expected a logged supervisor invocation')
  assert.equal(offSupervisorStart.argv.includes('sandbox_workspace_write.network_access=true'), false,
    '--executor-network off must drop the supervisor network flag too: '
    + JSON.stringify(offSupervisorStart.argv))
})

test('(o) a gitignored local.properties is linked into the supervisor checkout, and '
  + 'GRADLE_USER_HOME is add-dir\'d when it exists', () => {
  const { root, repo, base } = makeGradleRepo()
  const planPath = writePlan(root, ['task-a'])
  const logPath = join(root, 'codex.log')
  const gradleHome = mkdtempSync(join(tmpdir(), 'codex-wave-runner-gradle-'))
  roots.push(gradleHome)

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB,
      '--out', join(root, 'out')],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good', GRADLE_USER_HOME: gradleHome },
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)

  const supervisorStart = readLog(logPath).find((entry) => entry.event === 'start'
    && entry.prompt?.startsWith('# Supervisor Prompt'))
  assert.ok(supervisorStart, 'expected a logged supervisor invocation')
  assert.ok(Array.isArray(supervisorStart.symlinks), 'the stub must log a symlinks array')
  assert.ok(supervisorStart.symlinks.includes('local.properties'),
    'the supervisor checkout must have local.properties linked: ' + JSON.stringify(supervisorStart.symlinks))
  assert.ok(addDirValues(supervisorStart.argv).includes(gradleHome),
    'supervisor argv must add-dir an existing GRADLE_USER_HOME: ' + JSON.stringify(supervisorStart.argv))
})

// ---------------------------------------------------------------------------
// --preflight (default on): probes every distinct must_run command,
// sandboxed at the base commit, before any model child starts.
// ---------------------------------------------------------------------------

test('(p) a signature in the preflight output stops with environment-blocked, before init: no --out, no '
  + 'state file, no task worktree/branch, and an immediate re-run proceeds', () => {
  const { root, repo, base } = makeRepo()
  const planPath = writePlan(root, ['task-a'])
  const logPath = join(root, 'codex.log')
  const outPath = join(root, 'out')
  const runArgs = ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB,
    '--out', outPath]

  const result = runRunner(runArgs, {
    CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good',
    CODEX_STUB_SANDBOX_OUTPUT: 'bash: Operation not permitted\n', CODEX_STUB_SANDBOX_EXIT: '1',
  })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.ok(result.json, result.stdout + result.stderr)
  assert.equal(result.json.status, 'stop')
  assert.deepEqual(result.json.stopped, [{ task: '*', reason: 'environment-blocked' }])
  assert.ok(result.json.preflight, 'expected a preflight field on the stop summary')
  assert.equal(result.json.preflight.blocked.cmd, 'true')
  assert.equal(result.json.preflight.blocked.id, 'permission-denied')
  assert.match(result.json.preflight.blocked.line, /Operation not permitted/)
  assert.deepEqual(result.json.preflight.results.map((r) => r.cmd), ['true'])
  assert.equal(result.json.preflight.results[0].exit, 1)

  // The preflight now runs before `init`, so nothing was ever created:
  // cleanup is empty, no --out directory, no state file and no task
  // worktree/branch — a re-run with the same arguments must be able to
  // proceed cleanly.
  assert.deepEqual(result.json.cleanup, [], 'nothing was created yet, so there is nothing to clean up')
  assert.equal(existsSync(outPath), false, 'no --out directory may be created on a preflight stop')
  const stateFiles = spawnSync('sh',
    ['-c', 'ls "' + repo + '/.worktrees/codex-wave" 2>/dev/null | grep "\\.json$" || true'],
    { encoding: 'utf8' }).stdout.trim()
  assert.equal(stateFiles, '', 'no state file may exist after a preflight stop: ' + stateFiles)
  const branches = git(repo, 'branch', '--list', 'wave/task-a')
  assert.equal(branches, '', 'no wave/* branch may exist after a preflight stop')

  const starts = readLog(logPath).filter((entry) => entry.event === 'start')
  assert.equal(starts.filter((entry) => entry.prompt?.startsWith('# Task: ')).length, 0,
    'no executor should ever have started: ' + JSON.stringify(starts))
  assert.equal(starts.filter((entry) => entry.argv[0] === 'sandbox').length, 1,
    'exactly one preflight command should have run')

  // The preflight worktree itself is removed in a finally, regardless of
  // the stop.
  const worktrees = git(repo, 'worktree', 'list', '--porcelain')
  assert.equal(worktrees.includes('preflight'), false, 'no preflight worktree should remain: ' + worktrees)

  // An immediate re-run with the same arguments proceeds once the machine
  // problem is gone (here: turning the preflight off).
  const rerun = runRunner([...runArgs, '--preflight', 'off'],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good' })
  assert.equal(rerun.status, 0, 'a re-run with the same --out must succeed once the block is gone: '
    + rerun.stdout + rerun.stderr)
  assert.equal(rerun.json.status, 'merge-ready')
})

test('(q) a plain red preflight command does not stop the run', () => {
  const { root, repo, base } = makeRepo()
  const planPath = writePlan(root, ['task-a'])
  const logPath = join(root, 'codex.log')

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB,
      '--out', join(root, 'out')],
    {
      CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good',
      CODEX_STUB_SANDBOX_OUTPUT: 'just a plain failure, nothing machine-related\n',
      CODEX_STUB_SANDBOX_EXIT: '1',
    },
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.ok(result.json, result.stdout + result.stderr)
  assert.equal(result.json.status, 'merge-ready', 'an expected-red preflight command must never stop the run')
  // It is still recorded, just not treated as a stop.
  assert.deepEqual(result.json.preflight.results.map((r) => ({ cmd: r.cmd, exit: r.exit })),
    [{ cmd: 'true', exit: 1 }])

  const starts = readLog(logPath).filter((entry) => entry.event === 'start')
  assert.ok(starts.some((entry) => entry.prompt?.startsWith('# Task: ')),
    'the executor must still have run after an expected-red preflight command')
})

test('(r) --preflight off skips the probe entirely', () => {
  const { root, repo, base } = makeRepo()
  const planPath = writePlan(root, ['task-a'])
  const logPath = join(root, 'codex.log')

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB,
      '--preflight', 'off', '--out', join(root, 'out')],
    {
      CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good',
      // Even a would-be-blocking signature must never be probed for.
      CODEX_STUB_SANDBOX_OUTPUT: 'Operation not permitted', CODEX_STUB_SANDBOX_EXIT: '1',
    },
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(result.json.status, 'merge-ready')
  assert.equal(Object.hasOwn(result.json, 'preflight'), false,
    '--preflight off must leave no preflight field on the summary')

  const starts = readLog(logPath).filter((entry) => entry.event === 'start')
  assert.equal(starts.filter((entry) => entry.argv[0] === 'sandbox').length, 0,
    '--preflight off must never invoke the sandbox probe: ' + JSON.stringify(starts))
})

test('(s) the preflight argv includes writable_roots with the git common dir', () => {
  const { root, repo, base } = makeRepo()
  const planPath = writePlan(root, ['task-a'])
  const logPath = join(root, 'codex.log')
  const commonDir = git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir')

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB,
      '--out', join(root, 'out')],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good' },
  )
  assert.equal(result.status, 0, result.stdout + result.stderr)

  const sandboxStart = readLog(logPath).find((entry) => entry.event === 'start' && entry.argv[0] === 'sandbox')
  assert.ok(sandboxStart, 'expected a logged preflight (sandbox) invocation')
  assert.deepEqual(sandboxStart.argv.slice(0, 2), ['sandbox', '-c'])
  assert.ok(sandboxStart.argv.includes('sandbox_mode="workspace-write"'),
    'preflight argv must set sandbox_mode=workspace-write: ' + JSON.stringify(sandboxStart.argv))
  const writableRootsArg = sandboxStart.argv.find((a) => a.startsWith('sandbox_workspace_write.writable_roots='))
  assert.ok(writableRootsArg, 'expected a writable_roots -c value: ' + JSON.stringify(sandboxStart.argv))
  const writableRoots = JSON.parse(writableRootsArg.slice('sandbox_workspace_write.writable_roots='.length))
  assert.ok(writableRoots.includes(commonDir),
    'writable_roots must include the git common dir: ' + JSON.stringify(writableRoots))
  assert.ok(sandboxStart.argv.includes('sandbox_workspace_write.network_access=true'),
    'preflight argv must carry the network flag by default: ' + JSON.stringify(sandboxStart.argv))
  assert.deepEqual(sandboxStart.argv.slice(-3), ['bash', '-c', 'true'],
    'preflight must wrap the must_run cmd in bash -c: ' + JSON.stringify(sandboxStart.argv))
})

// ---------------------------------------------------------------------------
// Environment detection for children: a timed-out, non-zero, empty or
// unparsable result is checked against detectEnvironmentBlock before it
// falls back to a generic transport/null-result agent failure.
// ---------------------------------------------------------------------------

test('(t) an executor stub that exits non-zero with "Operation not permitted" on stderr ends the task as '
  + 'environment-blocked', () => {
  const { root, repo, base } = makeRepo()
  const planPath = writePlan(root, ['task-a'])
  const logPath = join(root, 'codex.log')

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB,
      '--out', join(root, 'out')],
    {
      CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'fail',
      CODEX_STUB_FAIL_STDERR: 'chmod: /repo/.git/objects: Operation not permitted',
    },
  )
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.ok(result.json, result.stdout + result.stderr)
  assert.equal(result.json.status, 'stop')
  assert.equal(result.json.stopped.length, 1)
  assert.equal(result.json.stopped[0].task, 'task-a')
  assert.equal(result.json.stopped[0].reason, 'environment-blocked')
  assert.equal(result.json.tasks[0].status, 'environment-blocked')
  // The blocked line reaches the orchestrator on the stopped[] entry itself
  // (the state helper only ever sees {error:{kind:'environment'}}).
  assert.deepEqual(result.json.stopped[0].environment, {
    source: 'executor', id: 'permission-denied', line: 'chmod: /repo/.git/objects: Operation not permitted',
  })

  const state = JSON.parse(readFileSync(result.json.states[0], 'utf8'))
  const failures = state.tasks['task-a'].agentFailures
  assert.ok(failures.some((f) => f.point === 'executor' && f.kind === 'environment'),
    'expected a recorded executor environment failure: ' + JSON.stringify(failures))
  // An environment-typed error is a machine problem, not a charged attempt.
  assert.equal(state.tasks['task-a'].totalAttempts, 0,
    'an environment-typed failure must not grow totalAttempts: ' + JSON.stringify(state.tasks['task-a']))
})

// ---------------------------------------------------------------------------
// Timeout diagnostics: every children[] entry gets stderrFile, and a timed
// out child also gets timedOut and eventsTail.
// ---------------------------------------------------------------------------

test('(u) a timed-out child has timedOut and eventsTail, and every child has stderrFile', () => {
  const { root, repo, base } = makeRepo()
  const planPath = writePlan(root, ['task-a'])
  const logPath = join(root, 'codex.log')

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB,
      '--timeout-min', '0.01', '--out', join(root, 'out')],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good', CODEX_STUB_SLEEP: '2' },
  )
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.ok(result.json, result.stdout + result.stderr)
  assert.ok(result.json.children.length > 0)
  assert.ok(result.json.children.every((c) => typeof c.stderrFile === 'string' && c.stderrFile !== ''),
    'every children[] entry must carry stderrFile: ' + JSON.stringify(result.json.children))
  const timedOutChildren = result.json.children.filter((c) => c.timedOut === true)
  assert.ok(timedOutChildren.length > 0, 'expected at least one timed-out child: '
    + JSON.stringify(result.json.children))
  for (const child of timedOutChildren) {
    assert.ok(Array.isArray(child.eventsTail), 'timedOut child must carry eventsTail: ' + JSON.stringify(child))
    assert.ok(child.eventsTail.length <= 10)
    assert.ok(child.eventsTail.every((line) => line.length <= 500))
  }
})

// ---------------------------------------------------------------------------
// depends_on: refuse to start the wave until whatever it depends on exists.
// ---------------------------------------------------------------------------

function planTextWithDependsOn(taskIds, dependsOn) {
  const base = planText(taskIds)
  return base.replace('"ci": "none: this fixture repo has no CI to run",',
    '"ci": "none: this fixture repo has no CI to run",\n  "depends_on": ' + JSON.stringify(dependsOn) + ',')
}

test('(v) an unmet depends_on stops before any worktree exists, leaves no --out or state file, and an '
  + 'immediate re-run with the dependency now present proceeds', () => {
  const { root, repo, base } = makeRepo()
  const outPath = join(root, 'out')
  const missingPath = 'does-not-exist.txt'
  const planPath = join(root, 'plan.md')
  writeFileSync(planPath, planTextWithDependsOn(['task-a'], [
    { wave: 1, repo: '.', ref: base, path: missingPath },
  ]))
  const logPath = join(root, 'codex.log')

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB, '--out', outPath],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good' },
  )
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.ok(result.json, result.stdout + result.stderr)
  assert.equal(result.json.status, 'stop')
  assert.deepEqual(result.json.stopped, [{ task: '*', reason: 'depends-on-unmet' }])
  assert.ok(Array.isArray(result.json.dependsOn) && result.json.dependsOn.length === 1,
    'expected the unmet dependency listed: ' + JSON.stringify(result.json.dependsOn))
  assert.equal(result.json.dependsOn[0].path, missingPath)
  assert.deepEqual(result.json.cleanup, [], 'nothing was created yet, so there is nothing to clean up')

  const worktrees = spawnSync('sh', ['-c', 'ls "' + repo + '/.worktrees" 2>/dev/null | grep "^wave-" || true'],
    { encoding: 'utf8' }).stdout.trim()
  assert.equal(worktrees, '', 'no wave-* worktree may exist before init has ever run: ' + worktrees)
  assert.equal(existsSync(logPath + '.d'), false, 'no codex child may ever have been launched')
  assert.equal(existsSync(outPath), false, 'no --out directory may be created on a depends-on stop')
  const stateFiles = spawnSync('sh',
    ['-c', 'ls "' + repo + '/.worktrees/codex-wave" 2>/dev/null | grep "\\.json$" || true'],
    { encoding: 'utf8' }).stdout.trim()
  assert.equal(stateFiles, '', 'no state file may exist after a depends-on stop: ' + stateFiles)
  const branches = git(repo, 'branch', '--list', 'wave/task-a')
  assert.equal(branches, '', 'no wave/* branch may exist after a depends-on stop')

  // Satisfy the dependency (a new commit carrying the file the plan
  // depends on) and re-run with the same --out: it must now proceed.
  writeFileSync(join(repo, missingPath), 'present\n')
  git(repo, 'add', missingPath)
  git(repo, 'commit', '-m', 'add dependency file')
  const depRef = git(repo, 'rev-parse', 'HEAD')
  const rerunPlanPath = join(root, 'plan-rerun.md')
  writeFileSync(rerunPlanPath, planTextWithDependsOn(['task-a'], [
    { wave: 1, repo: '.', ref: depRef, path: missingPath },
  ]))
  const rerun = runRunner(
    ['--plan', rerunPlanPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB, '--out', outPath],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good' },
  )
  assert.equal(rerun.status, 0, 'a re-run with the same --out must succeed once the dependency is met: '
    + rerun.stdout + rerun.stderr)
  assert.equal(rerun.json.status, 'merge-ready')
})

// ---------------------------------------------------------------------------
// Cleanup hint: on any stop, summary.json carries one cleanup string per
// stopped (real) task, and prints them to stderr.
// ---------------------------------------------------------------------------

test('(w) the cleanup strings (including the state file) are present on stop, with a re-run hint', () => {
  const { root, repo, base } = makeRepo()
  const planPath = writePlan(root, ['task-a'])
  const logPath = join(root, 'codex.log')

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB,
      '--out', join(root, 'out')],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'fail' },
  )
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.ok(result.json, result.stdout + result.stderr)
  assert.equal(result.json.status, 'stop')
  assert.equal(result.json.states.length, 1)
  const expected = 'git -C ' + repo + ' worktree remove --force ' + join(repo, '.worktrees', 'wave-task-a')
    + ' && git -C ' + repo + ' branch -D wave/task-a'
    + ' && rm -f ' + result.json.states[0]
  assert.deepEqual(result.json.cleanup, [expected])
  assert.ok(result.stderr.includes(expected), 'the cleanup line must also be printed to stderr: ' + result.stderr)
  assert.ok(result.stderr.includes('re-run with a fresh --out after cleanup'),
    'expected the re-run hint after the cleanup lines: ' + result.stderr)
})

test('(w2) running the printed cleanup line and re-running with a fresh --out lets init succeed', () => {
  const { root, repo, base } = makeRepo()
  const planPath = writePlan(root, ['task-a'])
  const logPath = join(root, 'codex.log')

  const result = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB,
      '--out', join(root, 'out')],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'fail' },
  )
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.equal(result.json.cleanup.length, 1)

  for (const line of result.json.cleanup) {
    const cleanup = spawnSync('sh', ['-c', line], { encoding: 'utf8' })
    assert.equal(cleanup.status, 0, 'cleanup line must succeed: ' + line + '\n' + cleanup.stdout + cleanup.stderr)
  }
  assert.equal(existsSync(result.json.states[0]), false, 'the state file must be gone after cleanup')
  const branches = git(repo, 'branch', '--list', 'wave/task-a')
  assert.equal(branches, '', 'the branch must be gone after cleanup')

  const rerun = runRunner(
    ['--plan', planPath, '--wave', '1', '--repo', repo, '--base', base, '--codex', STUB,
      '--out', join(root, 'out2')],
    { CODEX_STUB_LOG: logPath, CODEX_STUB_EXECUTOR_MODE: 'good' },
  )
  assert.equal(rerun.status, 0, 'a re-run with a fresh --out after cleanup must succeed: '
    + rerun.stdout + rerun.stderr)
  assert.equal(rerun.json.status, 'merge-ready')
})
