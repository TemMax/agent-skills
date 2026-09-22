// CLI-level contract for the deterministic Codex wave helper. Every case uses
// a real disposable Git repository and the shipped executable.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(here, '..', '..')
const CLI = join(ROOT, 'plugins', 'orchestration', 'skills', 'multi-model',
  'references', 'codex-wave-state.mjs')
const FIXTURE = join(ROOT, 'tests', 'fixtures', 'plans', 'codex-clean.md')
const {
  buildSupervisorPrompt,
  recordExecutor: transitionRecordExecutor,
  recordVerdict: transitionRecordVerdict,
} = await import(pathToFileURL(CLI).href)

const roots = []
process.on('exit', () => roots.forEach((path) => rmSync(path, { recursive: true, force: true })))

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.status !== 0) {
    throw new Error([command, ...args].join(' ') + '\n' + result.stdout + result.stderr)
  }
  return result.stdout.trim()
}

function git(repo, ...args) {
  return run('git', ['-C', repo, ...args])
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'codex-wave-state-'))
  roots.push(root)
  const repo = join(root, 'repo')
  mkdirSync(join(repo, 'src'), { recursive: true })
  mkdirSync(join(repo, 'tests'), { recursive: true })
  writeFileSync(join(repo, '.gitignore'), '__pycache__/\n')
  writeFileSync(join(repo, 'src', 'divide.py'), 'def divide(a, b):\n    return a / b\n')
  writeFileSync(join(repo, 'tests', '__init__.py'), '')
  writeFileSync(join(repo, 'tests', 'test_divide.py'), [
    'import unittest',
    'from src.divide import divide',
    '',
    'class DivideTest(unittest.TestCase):',
    '    def test_divide(self):',
    '        self.assertEqual(divide(6, 3), 2)',
    '',
  ].join('\n'))
  git(repo, 'init')
  git(repo, 'config', 'user.name', 'Codex Test')
  git(repo, 'config', 'user.email', 'codex-test@example.invalid')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'base')
  const base = git(repo, 'rev-parse', 'HEAD')
  const plan = join(root, basename(FIXTURE))
  cpSync(FIXTURE, plan)
  return { root, repo, plan, base }
}

function invoke(args, input) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    input: input === undefined ? undefined : JSON.stringify(input),
  })
  let json
  try { json = JSON.parse(result.stdout) } catch {
    json = null
  }
  return { ...result, json }
}

function ok(args, input) {
  const result = invoke(args, input)
  assert.equal(result.status, 0, result.stderr || result.stdout)
  assert.ok(result.json, 'stdout must be one JSON object')
  return result.json
}

function init(over = {}) {
  const env = makeRepo()
  if (over.planText) writeFileSync(env.plan, over.planText(readFileSync(env.plan, 'utf8')))
  const result = invoke(['init', '--plan', env.plan, '--wave', '1', '--repo', env.repo,
    '--base', env.base])
  if (!over.invalid) {
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.ok(result.json)
    env.statePath = result.json.state
    env.worktree = join(env.repo, '.worktrees', 'wave-divide-guard')
  }
  return { ...env, result }
}

function state(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function next(path) {
  return ok(['next', '--state', path])
}

function recordExecutor(path, payload, id = 'divide-guard') {
  return ok(['record-executor', '--state', path, '--task', id], payload)
}

function verify(path, id = 'divide-guard') {
  return ok(['verify', '--state', path, '--task', id])
}

function recordVerdict(path, payload, id = 'divide-guard') {
  return ok(['record-verdict', '--state', path, '--task', id], payload)
}

function prepareAttempt(env, report = 'implemented guard', id = 'divide-guard') {
  const taskWorktree = state(env.statePath).tasks[id].worktree
  if (git(taskWorktree, 'rev-list', '--count', env.base + '..HEAD') === '0') {
    const marker = id === 'divide-guard'
      ? join(taskWorktree, 'src', 'attempt-marker.txt')
      : join(taskWorktree, 'src', 'multiply', 'attempt-marker.txt')
    mkdirSync(dirname(marker), { recursive: true })
    writeFileSync(marker, 'committed task work\n')
    git(taskWorktree, 'add', marker)
    git(taskWorktree, 'commit', '-m', 'record task work')
  }
  recordExecutor(env.statePath, { report: report + '\n\nmust_run output:\nOK\n' }, id)
  verify(env.statePath, id)
}

function withSecondTask(text) {
  const second = `,
      { "id": "multiply-guard",
        "branch": "wave/multiply-guard",
        "executor": { "model": "gpt-5.6-luna", "effort": "medium" },
        "ladder": ["gpt-5.6-sol"],
        "contract": {
          "files_allowed": ["src/multiply/**"],
          "files_forbidden": ["tests/**"],
          "must_run": [{ "cmd": "true", "evidence": "required" }],
          "forbidden_moves": ["weakening tests"],
          "report_must_answer": ["How is multiplication handled?"] } }`
  return text.replace(' } }\n    ] }', ' } }' + second + '\n    ] }')
    + '\n## Task multiply-guard\n\nAdd the second independent guard.\n'
}

function withMustRun(text, commands) {
  return text.replace(/"must_run": \[[^\n]+\]/, '"must_run": ' + JSON.stringify(commands))
}

function failed(rule = 'files_allowed: src/**', klass = 'files', extra = {}) {
  return {
    ok: false,
    violations: [{ rule, class: klass, evidence: 'observed failure', quote: '', ...extra }],
    remarks: [],
  }
}

function clean() {
  return { ok: true, violations: [], remarks: [] }
}

const tests = []
const test = (name, fn) => tests.push({ name, fn })

test('C1 init creates one schema-1 state and exact-base worktree branch', () => {
  const env = init()
  const files = readdirSync(join(env.repo, '.worktrees', 'codex-wave'))
  assert.deepEqual(files, ['codex-clean-w1-' + env.base.slice(0, 12) + '.json'])
  assert.equal(env.statePath, join(env.repo, '.worktrees', 'codex-wave', files[0]))
  const saved = state(env.statePath)
  assert.equal(saved.schema, 1)
  assert.equal(saved.base, env.base)
  assert.equal(saved.tasks['divide-guard'].branch, 'wave/divide-guard')
  assert.equal(git(env.worktree, 'rev-parse', 'HEAD'), env.base)
  assert.equal(git(env.worktree, 'branch', '--show-current'), 'wave/divide-guard')
  assert.equal(git(env.repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm).length, 2)
})

test('C1b a state file reached through an equivalent directory alias is accepted', () => {
  const env = init()
  const alias = join(env.root, 'repo-alias')
  symlinkSync(env.repo, alias, 'dir')
  const aliasedState = join(alias, '.worktrees', 'codex-wave', basename(env.statePath))
  const action = next(aliasedState)
  assert.equal(action.action, 'spawn-executor')
  assert.equal(action.worktree, env.worktree)
})

test('C1e relative init paths survive later commands from a different cwd', () => {
  const env = makeRepo()
  const result = spawnSync(process.execPath, [CLI, 'init', '--plan', basename(env.plan),
    '--wave', '1', '--repo', 'repo', '--base', env.base], {
    cwd: env.root, encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stderr || result.stdout)
  env.statePath = JSON.parse(result.stdout).state
  // next and every remaining CLI call run from ROOT, not the init cwd.
  const action = next(env.statePath)
  assert.equal(action.action, 'spawn-executor')
  assert.equal(realpathSync(action.worktree),
    realpathSync(join(env.repo, '.worktrees', 'wave-divide-guard')))
  assert.equal(git(action.worktree, 'rev-parse', 'HEAD'), env.base)
  prepareAttempt(env)
  recordVerdict(env.statePath, clean())
  assert.equal(next(env.statePath).action, 'merge-ready')
})

test('C1c a mutating command reached through a state symlink updates the canonical file', () => {
  const env = init()
  const alias = join(env.root, 'state-alias.json')
  symlinkSync(env.statePath, alias)
  recordExecutor(alias, { report: 'implemented guard\n\nmust_run output:\nOK\n' })
  assert.equal(state(env.statePath).tasks['divide-guard'].status, 'reported')
  assert.equal(lstatSync(alias).isSymbolicLink(), true)
})

test('C1d a state symlink to an alternate file is rejected', () => {
  const env = init()
  const alternate = join(env.root, 'alternate-state.json')
  const alias = join(env.root, 'state-alias.json')
  writeFileSync(alternate, readFileSync(env.statePath))
  symlinkSync(alternate, alias)
  const result = invoke(['next', '--state', alias])
  assert.notEqual(result.status, 0)
  assert.match(result.json.errors.join('; '), /state path: does not match schema fields/)
})

test('C2 selected Claude wave is host-mismatch and creates nothing', () => {
  const env = init({ invalid: true, planText: (text) => text.replace(
    '"model": "gpt-5.6-luna"', '"model": "sonnet"') })
  assert.notEqual(env.result.status, 0)
  assert.equal(env.result.json.status, 'invalid')
  assert.match(env.result.json.errors.join('; '), /host-mismatch/)
  assert.equal(existsSync(join(env.repo, '.worktrees')), false)
  assert.equal(git(env.repo, 'branch', '--list', 'wave/divide-guard'), '')
})

test('C2b selected wave with a full Claude ID is host-mismatch and creates nothing', () => {
  const env = init({ invalid: true, planText: (text) => text.replace(
    '"model": "gpt-5.6-luna"', '"model": "claude-sonnet-5"') })
  assert.notEqual(env.result.status, 0)
  assert.equal(env.result.json.status, 'invalid')
  assert.match(env.result.json.errors.join('; '), /host-mismatch/)
  assert.equal(existsSync(join(env.repo, '.worktrees')), false)
  assert.equal(git(env.repo, 'branch', '--list', 'wave/divide-guard'), '')
})

test('C3 next preserves approved task prose and all six mandatory prompt blocks', () => {
  const env = init()
  const action = next(env.statePath)
  assert.equal(action.action, 'spawn-executor')
  assert.equal(action.task, 'divide-guard')
  assert.equal(action.model, 'gpt-5.6-luna')
  assert.equal(action.effort, 'medium')
  assert.equal(action.worktree, env.worktree)
  assert.match(action.prompt, /Add a guard for division by zero without modifying the tests\./)
  assert.match(action.prompt, /user already approved/i)
  assert.match(action.prompt, /begin implementation immediately/i)
  assert.match(action.prompt, /do not request another (?:design or )?approval/i)
  for (const heading of ['## Context', '## Boundaries', '## Dead-end protocol',
    '## Prohibitions', '## Definition of done and report format', '## Contract']) {
    assert.match(action.prompt, new RegExp(heading))
  }
  for (const key of ['files_allowed', 'files_forbidden', 'must_run',
    'forbidden_moves', 'report_must_answer']) assert.match(action.prompt, new RegExp(key))
})

test('C4 record-executor stores only report text and advances to verify', () => {
  const env = init()
  recordExecutor(env.statePath, { report: 'guard added; tests pass' })
  const saved = state(env.statePath).tasks['divide-guard']
  assert.deepEqual(saved.reports, ['guard added; tests pass'])
  assert.equal(saved.totalAttempts, 1)
  assert.equal(saved.status, 'reported')
  assert.equal(next(env.statePath).action, 'verify')
})

test('C5 verifier records diff, paths, commits, and both fresh non-zero command attempts', () => {
  const env = init({ planText: (text) => text.replace(
    'python3 -m unittest discover -s tests -t .',
    "if [ -f .retry-marker ]; then printf second-out; printf second-err >&2; exit 3; else touch .retry-marker; printf first-out; printf first-err >&2; exit 7; fi") })
  writeFileSync(join(env.worktree, 'src', 'divide.py'),
    'def divide(a, b):\n    if b == 0:\n        raise ZeroDivisionError\n    return a / b\n')
  git(env.worktree, 'add', 'src/divide.py')
  git(env.worktree, 'commit', '-m', 'guard division')
  recordExecutor(env.statePath, { report: 'implemented and tested' })
  verify(env.statePath)
  const facts = state(env.statePath).tasks['divide-guard'].verifierFacts[0]
  assert.deepEqual(facts.changedPaths, ['src/divide.py'])
  assert.equal(facts.commitCount, 1)
  assert.match(facts.diff, /ZeroDivisionError/)
  assert.match(facts.diff, /diff --git a\/src\/divide.py b\/src\/divide.py/)
  assert.equal(facts.currentBranch, 'wave/divide-guard')
  assert.equal(facts.baseIsAncestor, true)
  assert.equal(facts.worktreeStatus, '')
  const command = facts.mustRun[0]
  assert.match(command.cmd, /^if \[ -f \.retry-marker \]/)
  assert.deepEqual(command.attempts.map((a) => a.exit), [7, 7])
  assert.deepEqual(command.attempts.map((a) => a.stdout), ['first-out', 'first-out'])
  assert.deepEqual(command.attempts.map((a) => a.stderr), ['first-err', 'first-err'])
  assert.ok(facts.violations.some((v) => v.class === 'must_run'))
  assert.equal(next(env.statePath).action, 'spawn-supervisor')
})

test('C5b a failed must_run cannot become merge-ready after a clean supervisor verdict', () => {
  const env = init({ planText: (text) => text.replace(
    'python3 -m unittest discover -s tests -t .',
    'printf mechanical-failure >&2; exit 9') })
  writeFileSync(join(env.worktree, 'src', 'divide.py'),
    'def divide(a, b):\n    return None if b == 0 else a / b\n')
  git(env.worktree, 'add', 'src/divide.py')
  git(env.worktree, 'commit', '-m', 'guard division')
  recordExecutor(env.statePath, { report: 'must_run output:\nmechanical-failure' })
  verify(env.statePath)
  recordVerdict(env.statePath, clean())
  const action = next(env.statePath)
  assert.equal(action.action, 'spawn-executor')
  assert.ok(state(env.statePath).tasks['divide-guard'].verdicts.at(-1)
    .verdict.violations.some((v) => v.class === 'must_run'))
})

test('C5c an out-of-scope path cannot become merge-ready after a clean supervisor verdict', () => {
  const env = init()
  writeFileSync(join(env.worktree, 'tests', 'forbidden.py'), 'changed outside scope\n')
  git(env.worktree, 'add', 'tests/forbidden.py')
  git(env.worktree, 'commit', '-m', 'touch forbidden path')
  recordExecutor(env.statePath, { report: 'changed files: tests/forbidden.py\n\nmust_run output:\nOK' })
  verify(env.statePath)
  recordVerdict(env.statePath, clean())
  const action = next(env.statePath)
  assert.equal(action.action, 'spawn-executor')
  assert.ok(state(env.statePath).tasks['divide-guard'].verdicts.at(-1)
    .verdict.violations.some((v) => v.class === 'files'))
})

test('C5d missing required command evidence is a blocking mechanical fact', () => {
  const env = init({ planText: (text) => text.replace(
    'python3 -m unittest discover -s tests -t .', 'printf required-evidence') })
  writeFileSync(join(env.worktree, 'src', 'divide.py'),
    'def divide(a, b):\n    return None if b == 0 else a / b\n')
  git(env.worktree, 'add', 'src/divide.py')
  git(env.worktree, 'commit', '-m', 'guard division')
  recordExecutor(env.statePath, { report: 'changed the guard; no command output pasted' })
  verify(env.statePath)
  const facts = state(env.statePath).tasks['divide-guard'].verifierFacts.at(-1)
  assert.ok(facts.violations.some((v) => v.class === 'report' && /evidence/.test(v.rule)))
  recordVerdict(env.statePath, clean())
  assert.equal(next(env.statePath).action, 'spawn-executor')
})

test('C5e a self-healing failure fails both fresh checkouts and blocks merge-ready', () => {
  const env = init({ planText: (text) => withMustRun(text, [{
    cmd: 'if test -f __pycache__/ready; then printf warmed; else mkdir -p __pycache__; touch __pycache__/ready; printf missing-prerequisite; exit 1; fi',
    evidence: 'required',
  }]) })
  const worktreesBefore = git(env.repo, 'worktree', 'list', '--porcelain')
  prepareAttempt(env, 'must_run output:\nmissing-prerequisite')
  const facts = state(env.statePath).tasks['divide-guard'].verifierFacts.at(-1)
  assert.deepEqual(facts.mustRun[0].attempts.map((a) => a.exit), [1, 1])
  assert.deepEqual(facts.mustRun[0].attempts.map((a) => a.stdout),
    ['missing-prerequisite', 'missing-prerequisite'])
  assert.ok(facts.violations.some((v) => v.class === 'must_run'))
  assert.equal(existsSync(join(env.worktree, '__pycache__', 'ready')), false)
  assert.equal(git(env.repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm).length,
    worktreesBefore.match(/^worktree /gm).length)
  recordVerdict(env.statePath, clean())
  assert.equal(next(env.statePath).action, 'spawn-executor')
})

test('C5f generator and tests share one fresh committed checkout without executor artifacts', () => {
  const env = init({ planText: (text) => withMustRun(text, [
    { cmd: 'test -f src/attempt-marker.txt && test ! -e __pycache__/fixture && mkdir -p __pycache__ && printf generated > __pycache__/fixture && pwd', evidence: 'optional' },
    { cmd: 'test $(cat __pycache__/fixture) = generated && printf fixture-ok', evidence: 'required' },
  ]) })
  mkdirSync(join(env.worktree, '__pycache__'))
  writeFileSync(join(env.worktree, '__pycache__', 'fixture'), 'executor-only')
  prepareAttempt(env, 'must_run output:\nfixture-ok')
  const facts = state(env.statePath).tasks['divide-guard'].verifierFacts.at(-1)
  assert.deepEqual(facts.mustRun.map((entry) => entry.attempts.map((a) => a.exit)), [[0], [0]])
  assert.equal(facts.mustRun[1].attempts[0].stdout, 'fixture-ok')
  assert.deepEqual(facts.violations, [])
  const checkout = facts.mustRun[0].attempts[0].stdout.trim()
  assert.notEqual(checkout, env.worktree)
  assert.equal(existsSync(checkout), false, 'temporary checkout must be removed')
  assert.equal(existsSync(dirname(checkout)), false, 'temporary parent must be removed')
  assert.equal(git(env.repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm).length, 2)
  assert.equal(readFileSync(join(env.worktree, '__pycache__', 'fixture'), 'utf8'), 'executor-only')
  recordVerdict(env.statePath, clean())
  assert.equal(next(env.statePath).action, 'merge-ready')
})

test('C5g a failing command poisons its successor in both complete sequence attempts', () => {
  const env = init({ planText: (text) => withMustRun(text, [
    { cmd: 'mkdir -p __pycache__ && pwd', evidence: 'optional' },
    { cmd: 'if test -f __pycache__/poison; then rm __pycache__/poison; printf healed; else touch __pycache__/poison; printf poisoned; exit 1; fi', evidence: 'required' },
    { cmd: 'if test -f __pycache__/poison; then printf successor-poisoned; exit 2; else printf successor-clean; fi', evidence: 'required' },
  ]) })
  prepareAttempt(env, 'must_run output:\npoisoned\nsuccessor-poisoned')
  const facts = state(env.statePath).tasks['divide-guard'].verifierFacts.at(-1)
  assert.deepEqual(facts.mustRun.map((entry) => entry.attempts.map((a) => a.exit)),
    [[0, 0], [1, 1], [2, 2]])
  assert.deepEqual(facts.mustRun[2].attempts.map((a) => a.stdout),
    ['successor-poisoned', 'successor-poisoned'])
  assert.equal(facts.violations.filter((v) => v.class === 'must_run').length, 2)
  const checkouts = facts.mustRun[0].attempts.map((a) => a.stdout.trim())
  assert.notEqual(checkouts[0], checkouts[1], 'retry must use another fresh checkout')
  for (const checkout of checkouts) {
    assert.notEqual(checkout, env.worktree)
    assert.equal(existsSync(checkout), false)
    assert.equal(existsSync(dirname(checkout)), false)
  }
  assert.equal(existsSync(join(env.worktree, '__pycache__', 'poison')), false)
  assert.equal(git(env.repo, 'worktree', 'list', '--porcelain').match(/^worktree /gm).length, 2)
  recordVerdict(env.statePath, clean())
  assert.equal(next(env.statePath).action, 'spawn-executor')
})

test('C6 supervisor prompt carries artifacts but redacts every executor id occurrence', () => {
  const env = init()
  writeFileSync(join(env.worktree, 'src', 'divide.py'), 'def divide(a, b):\n    return None if b == 0 else a / b\n')
  git(env.worktree, 'add', 'src/divide.py')
  git(env.worktree, 'commit', '-m', 'guard division')
  prepareAttempt(env, 'gpt-5.6-luna changed the guard; checked by gpt-5.6-luna')
  const out = ok(['supervisor-prompt', '--state', env.statePath, '--task', 'divide-guard'])
  assert.equal(out.task, 'divide-guard')
  assert.match(out.prompt, /CONTRACT/)
  assert.match(out.prompt, /files_allowed/)
  assert.match(out.prompt, new RegExp(env.base))
  assert.match(out.prompt, /wave\/divide-guard/)
  assert.match(out.prompt, /VERIFIER FACTS/)
  assert.match(out.prompt, /changedPaths/)
  assert.match(out.prompt, /REPORT/)
  assert.equal((out.prompt.match(/\[executor-model-redacted\]/g) || []).length, 2)
  assert.doesNotMatch(out.prompt, /gpt-5\.6-luna/)
})

test('C7 clean verdict yields merge-ready and done summary', () => {
  const env = init()
  prepareAttempt(env)
  recordVerdict(env.statePath, clean())
  assert.equal(next(env.statePath).action, 'merge-ready')
  const summary = ok(['summary', '--state', env.statePath])
  assert.equal(summary.status, 'done')
  assert.equal(summary.tasks[0].id, 'divide-guard')
  assert.equal(summary.tasks[0].status, 'ok')
})

test('C7b root-level violation metadata is rejected without changing verified state', () => {
  const env = init()
  prepareAttempt(env)
  const before = readFileSync(env.statePath, 'utf8')
  for (const field of ['pasteReproduced', 'satisfiable']) {
    const result = invoke(['record-verdict', '--state', env.statePath,
      '--task', 'divide-guard'], { ...clean(), [field]: true })
    assert.notEqual(result.status, 0)
    assert.match(result.json.errors.join('; '), /supervisor-result: expected the fixed verdict schema/)
    assert.equal(readFileSync(env.statePath, 'utf8'), before)
  }
  recordVerdict(env.statePath, { ...clean(), remarks: ['The pasted output reproduced.'] })
  assert.equal(next(env.statePath).action, 'merge-ready')
})

test('C8 first violation requests same-model rework with prior verdict', () => {
  const env = init()
  prepareAttempt(env)
  const verdict = failed()
  recordVerdict(env.statePath, verdict)
  const action = next(env.statePath)
  assert.equal(action.action, 'spawn-executor')
  assert.equal(action.model, 'gpt-5.6-luna')
  assert.equal(action.effort, 'medium')
  assert.match(action.prompt, /PRIOR VERDICT/)
  assert.match(action.prompt, /observed failure/)
  assert.equal(state(env.statePath).tasks['divide-guard'].verdicts[0].escalation, null)
})

test('C9a repeated class and rule advances Luna directly to Sol', () => {
  const env = init()
  prepareAttempt(env)
  recordVerdict(env.statePath, failed('same rule'))
  prepareAttempt(env)
  recordVerdict(env.statePath, failed('same rule'))
  const action = next(env.statePath)
  assert.equal(action.model, 'gpt-5.6-sol')
  assert.equal(action.effort, 'high')
  assert.equal(action.reason, 'same-rule-repeat')
  const task = state(env.statePath).tasks['divide-guard']
  assert.equal(task.rung, 1)
  assert.equal(task.verdicts[1].escalation, 'same-rule-repeat')
})

test('C9b second distinct violation advances Luna directly to Sol', () => {
  const env = init()
  prepareAttempt(env)
  recordVerdict(env.statePath, failed('first rule', 'files'))
  prepareAttempt(env)
  recordVerdict(env.statePath, failed('second rule', 'report'))
  const action = next(env.statePath)
  assert.equal(action.model, 'gpt-5.6-sol')
  assert.equal(action.reason, 'rung-exhausted')
  assert.equal(state(env.statePath).tasks['divide-guard'].verdicts[1].escalation,
    'rung-exhausted')
})

test('C10 second paste strike skips remaining rung attempt', () => {
  const env = init()
  const paste = failed('must reproduce', 'must_run', { pasteReproduced: false, satisfiable: true })
  prepareAttempt(env)
  recordVerdict(env.statePath, paste)
  prepareAttempt(env)
  recordVerdict(env.statePath, failed('a distinct command', 'must_run',
    { pasteReproduced: false, satisfiable: true }))
  const action = next(env.statePath)
  assert.equal(action.model, 'gpt-5.6-sol')
  assert.equal(action.reason, 'paste-two-strikes')
  const task = state(env.statePath).tasks['divide-guard']
  assert.equal(task.pasteStrikes, 2)
  assert.equal(task.verdicts[1].escalation, 'paste-two-strikes')
})

test('C11 satisfiable:false stops task immediately', () => {
  const env = init()
  prepareAttempt(env)
  recordVerdict(env.statePath, failed('unfixable command', 'must_run',
    { satisfiable: false }))
  const action = next(env.statePath)
  assert.equal(action.action, 'stop')
  assert.equal(action.reason, 'contract-unsatisfiable')
  assert.equal(state(env.statePath).tasks['divide-guard'].status, 'contract-unsatisfiable')
})

test('C12 terminal Sol gets one higher-effort retry, then stops without max', () => {
  const env = init()
  prepareAttempt(env)
  recordVerdict(env.statePath, failed('luna first'))
  prepareAttempt(env)
  recordVerdict(env.statePath, failed('luna second'))
  prepareAttempt(env)
  recordVerdict(env.statePath, failed('sol first'))
  let action = next(env.statePath)
  assert.equal(action.action, 'spawn-executor')
  assert.equal(action.model, 'gpt-5.6-sol')
  assert.equal(action.effort, 'xhigh')
  assert.notEqual(action.effort, 'max')
  prepareAttempt(env)
  recordVerdict(env.statePath, failed('sol second'))
  action = next(env.statePath)
  assert.equal(action.action, 'stop')
  assert.equal(action.reason, 'failed')
  assert.equal(state(env.statePath).tasks['divide-guard'].totalAttempts, 4)
})

test('C12b terminal Terra under Sol gets medium-to-high rework, then stops without max', () => {
  const env = init({ planText: (text) => text
    .replace('"model": "gpt-5.6-terra", "effort": "high"',
      '"model": "gpt-5.6-sol", "effort": "high"')
    .replace('"model": "gpt-5.6-luna", "effort": "medium"',
      '"model": "gpt-5.6-terra", "effort": "medium"')
    .replace('"ladder": ["gpt-5.6-sol"]', '"ladder": []') })
  prepareAttempt(env)
  recordVerdict(env.statePath, failed('terra first'))
  let action = next(env.statePath)
  assert.equal(action.action, 'spawn-executor')
  assert.equal(action.model, 'gpt-5.6-terra')
  assert.equal(action.effort, 'high')
  assert.notEqual(action.effort, 'max')
  prepareAttempt(env)
  recordVerdict(env.statePath, failed('terra second'))
  action = next(env.statePath)
  assert.equal(action.action, 'stop')
  assert.equal(action.reason, 'failed')
})

function atCap(env, { previousVerdict = null, pasteStrikes = 0 } = {}) {
  prepareAttempt(env)
  const saved = state(env.statePath)
  const task = saved.tasks['divide-guard']
  task.totalAttempts = 6
  task.attemptOnRung = 2
  task.reports = ['one', 'two', 'three', 'four', 'five', 'six\nOK']
  task.pasteStrikes = pasteStrikes
  task.verdicts = previousVerdict ? [{
    rung: 0,
    attemptOnRung: 1,
    model: 'gpt-5.6-luna',
    effort: 'medium',
    verdict: previousVerdict,
    escalation: null,
  }] : []
  return saved
}

test('C12c lower-level absolute-cap transition stops after a sixth report', () => {
  const env = init()
  const updated = transitionRecordVerdict(atCap(env), 'divide-guard', failed('sixth rule'))
  const task = updated.tasks['divide-guard']
  assert.equal(task.status, 'failed')
  assert.equal(task.totalAttempts, 6)
  assert.equal(task.verdicts.at(-1).escalation, 'rung-exhausted')
})

test('C12d lower-level cap preserves repeated-rule classification', () => {
  const env = init()
  const verdict = failed('cap repeated rule')
  const updated = transitionRecordVerdict(
    atCap(env, { previousVerdict: verdict }), 'divide-guard', verdict)
  assert.equal(updated.tasks['divide-guard'].status, 'failed')
  assert.equal(updated.tasks['divide-guard'].verdicts.at(-1).escalation, 'same-rule-repeat')
})

test('C12e lower-level cap preserves second-paste-strike classification', () => {
  const env = init()
  const updated = transitionRecordVerdict(atCap(env, { pasteStrikes: 1 }), 'divide-guard',
    failed('paste two', 'must_run', { pasteReproduced: false, satisfiable: true }))
  assert.equal(updated.tasks['divide-guard'].status, 'failed')
  assert.equal(updated.tasks['divide-guard'].verdicts.at(-1).escalation, 'paste-two-strikes')
})

test('C13 executor errors are typed: retry once, then error without message', () => {
  const env = init()
  recordExecutor(env.statePath, { error: { kind: 'transport' } })
  assert.equal(next(env.statePath).action, 'spawn-executor')
  recordExecutor(env.statePath, { error: { kind: 'transport' } })
  const action = next(env.statePath)
  assert.equal(action.action, 'stop')
  assert.equal(action.reason, 'error')
  const task = state(env.statePath).tasks['divide-guard']
  assert.deepEqual(task.agentFailures, [
    { point: 'executor', kind: 'transport', attempt: 1 },
    { point: 'executor', kind: 'transport', attempt: 1 },
  ])
  assert.doesNotMatch(JSON.stringify(task), /message/)
})

test('C13b successful executor result resets the consecutive error count', () => {
  const env = init()
  recordExecutor(env.statePath, { error: { kind: 'transport' } })
  prepareAttempt(env)
  recordVerdict(env.statePath, failed('first rejected report'))
  recordExecutor(env.statePath, { error: { kind: 'tool-unavailable' } })
  const action = next(env.statePath)
  assert.equal(action.action, 'spawn-executor')
  assert.equal(state(env.statePath).tasks['divide-guard'].status, 'ready')
})

test('C14 supervisor errors retry once at supervisor, then mark error', () => {
  const env = init()
  prepareAttempt(env)
  recordVerdict(env.statePath, { error: { kind: 'null-result' } })
  assert.equal(next(env.statePath).action, 'spawn-supervisor')
  recordVerdict(env.statePath, { error: { kind: 'null-result' } })
  const action = next(env.statePath)
  assert.equal(action.action, 'stop')
  assert.equal(action.reason, 'error')
  assert.deepEqual(state(env.statePath).tasks['divide-guard'].agentFailures, [
    { point: 'supervisor', kind: 'null-result', attempt: 1 },
    { point: 'supervisor', kind: 'null-result', attempt: 1 },
  ])
})

test('C14b successful verdict resets the consecutive supervisor error count', () => {
  const env = init()
  prepareAttempt(env)
  recordVerdict(env.statePath, { error: { kind: 'transport' } })
  recordVerdict(env.statePath, failed('first rejected report'))
  prepareAttempt(env)
  recordVerdict(env.statePath, { error: { kind: 'null-result' } })
  const action = next(env.statePath)
  assert.equal(action.action, 'spawn-supervisor')
  assert.equal(state(env.statePath).tasks['divide-guard'].status, 'verified')
})

test('C15 malformed stdin is non-zero and leaves state byte-for-byte unchanged', () => {
  const env = init()
  const before = readFileSync(env.statePath)
  const result = spawnSync(process.execPath,
    [CLI, 'record-executor', '--state', env.statePath, '--task', 'divide-guard'],
    { cwd: ROOT, encoding: 'utf8', input: '{ definitely not JSON' })
  assert.notEqual(result.status, 0)
  assert.equal(JSON.parse(result.stdout).status, 'invalid')
  assert.match(result.stdout, /stdin-json/)
  assert.deepEqual(readFileSync(env.statePath), before)
})

test('C16 existing worktree is a named conflict and is never removed', () => {
  const env = makeRepo()
  const occupied = join(env.repo, '.worktrees', 'wave-divide-guard')
  mkdirSync(occupied, { recursive: true })
  writeFileSync(join(occupied, 'sentinel'), 'preserve me')
  const result = invoke(['init', '--plan', env.plan, '--wave', '1', '--repo', env.repo,
    '--base', env.base])
  assert.notEqual(result.status, 0)
  assert.equal(result.json.status, 'invalid')
  assert.match(result.json.errors.join('; '), /worktree-conflict/)
  assert.equal(readFileSync(join(occupied, 'sentinel'), 'utf8'), 'preserve me')
  assert.equal(existsSync(join(env.repo, '.worktrees', 'codex-wave')), false)
})

test('C16b existing state conflict is detected before any Git mutation', () => {
  const env = makeRepo()
  const stateDir = join(env.repo, '.worktrees', 'codex-wave')
  mkdirSync(stateDir, { recursive: true })
  const statePath = join(stateDir, 'codex-clean-w1-' + env.base.slice(0, 12) + '.json')
  writeFileSync(statePath, 'preserve exact bytes\n')
  const result = invoke(['init', '--plan', env.plan, '--wave', '1', '--repo', env.repo,
    '--base', env.base])
  assert.notEqual(result.status, 0)
  assert.match(result.json.errors.join('; '), /state-conflict/)
  assert.equal(readFileSync(statePath, 'utf8'), 'preserve exact bytes\n')
  assert.equal(existsSync(join(env.repo, '.worktrees', 'wave-divide-guard')), false)
  assert.equal(git(env.repo, 'branch', '--list', 'wave/divide-guard'), '')
})

test('C17 supervisor collision in executor or ladder is exact schema error', () => {
  for (const mutate of [
    (text) => text.replace('"model": "gpt-5.6-luna"', '"model": "gpt-5.6-terra"'),
    (text) => text.replace('"ladder": ["gpt-5.6-sol"]', '"ladder": ["gpt-5.6-terra"]'),
  ]) {
    const env = init({ invalid: true, planText: mutate })
    assert.notEqual(env.result.status, 0)
    assert.equal(env.result.json.status, 'invalid')
    assert.match(env.result.json.errors.join('; '),
      /supervisor model also appears as executor or ladder rung/)
    assert.equal(existsSync(join(env.repo, '.worktrees')), false)
    assert.equal(git(env.repo, 'branch', '--list', 'wave/divide-guard'), '')
  }
})

test('C17b missing Codex supervisor effort is rejected before worktree creation', () => {
  const env = init({ invalid: true, planText: (text) => text.replace(
    '"model": "gpt-5.6-terra", "effort": "high"', '"model": "gpt-5.6-terra"') })
  assert.notEqual(env.result.status, 0)
  assert.match(env.result.json.errors.join('; '), /supervisor\.effort.*required/)
  assert.equal(existsSync(join(env.repo, '.worktrees')), false)
})

test('C17c missing Codex executor effort is rejected before worktree creation', () => {
  const env = init({ invalid: true, planText: (text) => text.replace(
    '"model": "gpt-5.6-luna", "effort": "medium"', '"model": "gpt-5.6-luna"') })
  assert.notEqual(env.result.status, 0)
  assert.match(env.result.json.errors.join('; '), /executor\.effort.*required/)
  assert.equal(existsSync(join(env.repo, '.worktrees')), false)
})

test('C17d ladder cannot transition back to its executor model', () => {
  const env = init({ invalid: true, planText: (text) => text.replace(
    '"ladder": ["gpt-5.6-sol"]', '"ladder": ["gpt-5.6-luna"]') })
  assert.notEqual(env.result.status, 0)
  assert.match(env.result.json.errors.join('; '), /ladder transitions must use distinct models/)
  assert.equal(existsSync(join(env.repo, '.worktrees')), false)
})

test('C17e ladder cannot repeat a later model transition', () => {
  const env = init({ invalid: true, planText: (text) => text.replace(
    '"ladder": ["gpt-5.6-sol"]', '"ladder": ["gpt-5.6-sol", "gpt-5.6-sol"]') })
  assert.notEqual(env.result.status, 0)
  assert.match(env.result.json.errors.join('; '), /ladder transitions must use distinct models/)
  assert.equal(existsSync(join(env.repo, '.worktrees')), false)
})

test('C18 tampered schema-1 state cannot redirect verify cwd or run must_run', () => {
  const env = init({ planText: (text) => text.replace(
    'python3 -m unittest discover -s tests -t .', 'printf executed > must-run-executed') })
  recordExecutor(env.statePath, { report: 'ready for verification' })
  const redirected = join(env.root, 'redirected')
  mkdirSync(redirected)
  const tampered = state(env.statePath)
  tampered.tasks['divide-guard'].worktree = redirected
  writeFileSync(env.statePath, JSON.stringify(tampered, null, 2) + '\n')
  const before = readFileSync(env.statePath)
  const result = invoke(['verify', '--state', env.statePath, '--task', 'divide-guard'])
  assert.notEqual(result.status, 0)
  assert.equal(result.json.status, 'invalid')
  assert.match(result.json.errors.join('; '), /state-schema.*worktree/)
  assert.equal(existsSync(join(redirected, 'must-run-executed')), false)
  assert.deepEqual(readFileSync(env.statePath), before)
})

test('C18b every safety-relevant stored field is validated before next', () => {
  const env = init()
  const original = state(env.statePath)
  const cases = [
    ['planPath', (s) => { s.planPath = '' }],
    ['repoPath', (s) => { s.repoPath = '' }],
    ['wave', (s) => { s.wave = 0 }],
    ['base', (s) => { s.base = 'abc' }],
    ['supervisor.model', (s) => { s.supervisor.model = 'sonnet' }],
    ['supervisor.model full Claude ID', (s) => { s.supervisor.model = 'claude-sonnet-5' }],
    ['supervisor.effort', (s) => { s.supervisor.effort = 'extreme' }],
    ['tasks', (s) => { s.tasks = {} }],
    ['task id', (s) => { s.tasks.Bad = s.tasks['divide-guard']; delete s.tasks['divide-guard'] }],
    ['status', (s) => { s.tasks['divide-guard'].status = 'launch-anything' }],
    ['branch', (s) => { s.tasks['divide-guard'].branch = 'main' }],
    ['worktree', (s) => { s.tasks['divide-guard'].worktree = env.root }],
    ['rungs', (s) => { s.tasks['divide-guard'].rungs = [] }],
    ['supervisor collision', (s) => { s.tasks['divide-guard'].rungs = ['gpt-5.6-terra'] }],
    ['rung', (s) => { s.tasks['divide-guard'].rung = 8 }],
    ['attemptOnRung', (s) => { s.tasks['divide-guard'].attemptOnRung = -1 }],
    ['totalAttempts', (s) => { s.tasks['divide-guard'].totalAttempts = 7 }],
    ['pasteStrikes', (s) => { s.tasks['divide-guard'].pasteStrikes = -1 }],
    ['reports', (s) => { s.tasks['divide-guard'].reports = {} }],
    ['verifierFacts', (s) => { s.tasks['divide-guard'].verifierFacts = [{}] }],
    ['verdicts', (s) => { s.tasks['divide-guard'].verdicts = [{}] }],
    ['agentFailures', (s) => { s.tasks['divide-guard'].agentFailures = [{ message: 'redirect' }] }],
  ]
  for (const [name, mutate] of cases) {
    const tampered = structuredClone(original)
    mutate(tampered)
    writeFileSync(env.statePath, JSON.stringify(tampered, null, 2) + '\n')
    const before = readFileSync(env.statePath)
    const result = invoke(['next', '--state', env.statePath])
    assert.notEqual(result.status, 0, name + ' must be rejected')
    assert.equal(result.json.status, 'invalid', name)
    assert.match(result.json.errors.join('; '), /state-schema/, name)
    assert.deepEqual(readFileSync(env.statePath), before, name)
  }
})

test('C18c state identities and rungs remain tied to the selected plan wave', () => {
  const env = init()
  writeFileSync(env.plan, readFileSync(env.plan, 'utf8').replace(
    '"ladder": ["gpt-5.6-sol"]', '"ladder": []'))
  const before = readFileSync(env.statePath)
  const result = invoke(['next', '--state', env.statePath])
  assert.notEqual(result.status, 0)
  assert.match(result.json.errors.join('; '), /state-schema.*rungs/)
  assert.deepEqual(readFileSync(env.statePath), before)
})

test('C18i mutable plan status does not invalidate initialized state', () => {
  const env = init()
  writeFileSync(env.plan, readFileSync(env.plan, 'utf8').replace('status: draft', 'status: active'))
  assert.equal(next(env.statePath).action, 'spawn-executor')
})

test('C18j substantive approved task prose changes require reinitialization', () => {
  const env = init()
  writeFileSync(env.plan, readFileSync(env.plan, 'utf8').replace(
    'Add a guard for division by zero without modifying the tests.',
    'Add a different guard and modify the tests.'))
  const before = readFileSync(env.statePath)
  const result = invoke(['next', '--state', env.statePath])
  assert.notEqual(result.status, 0)
  assert.match(result.json.errors.join('; '), /plan digest.*reinitialization/)
  assert.deepEqual(readFileSync(env.statePath), before)
})

test('C18k substantive approved contract changes require reinitialization', () => {
  const env = init()
  writeFileSync(env.plan, readFileSync(env.plan, 'utf8').replace(
    '"files_allowed": ["src/**"]', '"files_allowed": ["src/**", "lib/**"]'))
  const before = readFileSync(env.statePath)
  const result = invoke(['next', '--state', env.statePath])
  assert.notEqual(result.status, 0)
  assert.match(result.json.errors.join('; '), /plan digest.*reinitialization/)
  assert.deepEqual(readFileSync(env.statePath), before)
})

test('C18l persisted merge-ready state requires a completed verdict history', () => {
  const env = init()
  const tampered = state(env.statePath)
  tampered.tasks['divide-guard'].status = 'merge-ready'
  writeFileSync(env.statePath, JSON.stringify(tampered, null, 2) + '\n')
  const before = readFileSync(env.statePath)
  const result = invoke(['next', '--state', env.statePath])
  assert.notEqual(result.status, 0)
  assert.match(result.json.errors.join('; '), /merge-ready.*supporting clean histories/)
  assert.deepEqual(readFileSync(env.statePath), before)
})

test('C18m persisted merge-ready state rejects failed mechanical history', () => {
  const env = init({ planText: (text) => text.replace(
    'python3 -m unittest discover -s tests -t .', 'printf persisted-failure >&2; exit 8') })
  writeFileSync(join(env.worktree, 'src', 'divide.py'),
    'def divide(a, b):\n    return None if b == 0 else a / b\n')
  git(env.worktree, 'add', 'src/divide.py')
  git(env.worktree, 'commit', '-m', 'guard division')
  recordExecutor(env.statePath, { report: 'must_run output:\npersisted-failure' })
  verify(env.statePath)
  const tampered = state(env.statePath)
  const task = tampered.tasks['divide-guard']
  task.status = 'merge-ready'
  task.verdicts.push({
    rung: 0,
    attemptOnRung: 1,
    model: 'gpt-5.6-luna',
    effort: 'medium',
    verdict: clean(),
    escalation: null,
  })
  writeFileSync(env.statePath, JSON.stringify(tampered, null, 2) + '\n')
  const before = readFileSync(env.statePath)
  const result = invoke(['next', '--state', env.statePath])
  assert.notEqual(result.status, 0)
  assert.match(result.json.errors.join('; '), /merge-ready.*supporting clean histories/)
  assert.deepEqual(readFileSync(env.statePath), before)
})

test('C18d malformed rungs in progressed history produce a named rejection', () => {
  const env = init()
  prepareAttempt(env)
  recordVerdict(env.statePath, failed('first failure'))
  const tampered = state(env.statePath)
  tampered.tasks['divide-guard'].rungs = null
  writeFileSync(env.statePath, JSON.stringify(tampered, null, 2) + '\n')
  const before = readFileSync(env.statePath)
  const result = invoke(['next', '--state', env.statePath])
  assert.notEqual(result.status, 0)
  assert.match(result.json.errors.join('; '), /state-schema.*rungs/)
  assert.deepEqual(readFileSync(env.statePath), before)
})

test('C18e malformed selected plan wave produces a named state rejection', () => {
  const env = init()
  writeFileSync(env.plan, readFileSync(env.plan, 'utf8').replace(
    '"supervisor": { "model": "gpt-5.6-terra", "effort": "high" }',
    '"supervisor": null'))
  const before = readFileSync(env.statePath)
  const result = invoke(['next', '--state', env.statePath])
  assert.notEqual(result.status, 0)
  assert.match(result.json.errors.join('; '), /state-schema.*plan wave/)
  assert.deepEqual(readFileSync(env.statePath), before)
})

test('C18f ready state at the six-attempt cap is rejected without action or write', () => {
  const env = init()
  const tampered = state(env.statePath)
  const task = tampered.tasks['divide-guard']
  task.status = 'ready'
  task.totalAttempts = 6
  task.reports = ['one', 'two', 'three', 'four', 'five', 'six']
  writeFileSync(env.statePath, JSON.stringify(tampered, null, 2) + '\n')
  const before = readFileSync(env.statePath)
  const result = invoke(['next', '--state', env.statePath])
  assert.notEqual(result.status, 0)
  assert.equal(result.json.status, 'invalid')
  assert.match(result.json.errors.join('; '), /state-schema.*ready.*attempt cap/)
  assert.equal(result.json.action, undefined)
  assert.deepEqual(readFileSync(env.statePath), before)
})

test('C18g recordExecutor transition cannot create a seventh report', () => {
  const env = init()
  const tampered = state(env.statePath)
  const task = tampered.tasks['divide-guard']
  task.status = 'ready'
  task.totalAttempts = 6
  task.reports = ['one', 'two', 'three', 'four', 'five', 'six']
  const before = structuredClone(tampered)
  assert.throws(
    () => transitionRecordExecutor(tampered, 'divide-guard', { report: 'seven' }),
    /state-transition:.*executor attempt cap reached/)
  assert.deepEqual(tampered, before)
})

test('C18h attempt-on-rung count cannot exceed total executor attempts', () => {
  const env = init()
  const tampered = state(env.statePath)
  tampered.tasks['divide-guard'].attemptOnRung = 1
  writeFileSync(env.statePath, JSON.stringify(tampered, null, 2) + '\n')
  const before = readFileSync(env.statePath)
  const result = invoke(['next', '--state', env.statePath])
  assert.notEqual(result.status, 0)
  assert.equal(result.json.status, 'invalid')
  assert.match(result.json.errors.join('; '), /state-schema.*attemptOnRung.*totalAttempts/)
  assert.deepEqual(readFileSync(env.statePath), before)
})

test('C19 safety preflight blocks must_run on branch mismatch', () => {
  const env = init({ planText: (text) => text.replace(
    'python3 -m unittest discover -s tests -t .', 'printf executed > must-run-executed') })
  git(env.worktree, 'switch', '-c', 'wrong-branch')
  recordExecutor(env.statePath, { report: 'ready' })
  verify(env.statePath)
  const facts = state(env.statePath).tasks['divide-guard'].verifierFacts.at(-1)
  assert.equal(facts.currentBranch, 'wrong-branch')
  assert.ok(facts.violations.some((v) => /current branch/.test(v.rule)))
  assert.equal(facts.mustRun[0].skipped, 'safety-preflight')
  assert.deepEqual(facts.mustRun[0].attempts, [])
  assert.equal(existsSync(join(env.worktree, 'must-run-executed')), false)
})

test('C19b safety preflight blocks must_run when base is not an ancestor', () => {
  const env = init({ planText: (text) => text.replace(
    'python3 -m unittest discover -s tests -t .', 'printf executed > must-run-executed') })
  recordExecutor(env.statePath, { report: 'ready' })
  const tree = git(env.worktree, 'rev-parse', 'HEAD^{tree}')
  const orphan = git(env.worktree, 'commit-tree', tree, '-m', 'orphan')
  git(env.worktree, 'reset', '--hard', orphan)
  verify(env.statePath)
  const facts = state(env.statePath).tasks['divide-guard'].verifierFacts.at(-1)
  assert.equal(facts.currentBranch, 'wave/divide-guard')
  assert.equal(facts.baseIsAncestor, false)
  assert.ok(facts.violations.some((v) => /ancestor/.test(v.rule)))
  assert.equal(facts.mustRun[0].skipped, 'safety-preflight')
  assert.equal(existsSync(join(env.worktree, 'must-run-executed')), false)
})

test('C19c safety preflight records dirty artifacts and blocks must_run', () => {
  const env = init({ planText: (text) => text.replace(
    'python3 -m unittest discover -s tests -t .', 'printf executed > must-run-executed') })
  writeFileSync(join(env.worktree, 'src', 'untracked.py'), 'dirty\n')
  recordExecutor(env.statePath, { report: 'ready' })
  verify(env.statePath)
  const facts = state(env.statePath).tasks['divide-guard'].verifierFacts.at(-1)
  assert.match(facts.worktreeStatus, /\?\? src\/untracked\.py/)
  assert.ok(facts.violations.some((v) => v.class === 'worktree'))
  assert.equal(facts.mustRun[0].skipped, 'safety-preflight')
  assert.equal(existsSync(join(env.worktree, 'must-run-executed')), false)
})

test('C20 multi-task next skips ready-to-merge tasks until the wave is ready', () => {
  const env = init({ planText: withSecondTask })
  prepareAttempt(env, 'first task report', 'divide-guard')
  recordVerdict(env.statePath, clean(), 'divide-guard')
  let action = next(env.statePath)
  assert.equal(action.action, 'spawn-executor')
  assert.equal(action.task, 'multiply-guard')
  prepareAttempt(env, 'second task report', 'multiply-guard')
  recordVerdict(env.statePath, clean(), 'multiply-guard')
  action = next(env.statePath)
  assert.equal(action.action, 'merge-ready')
  assert.deepEqual(action.tasks, ['divide-guard', 'multiply-guard'])
  assert.equal(ok(['summary', '--state', env.statePath]).status, 'done')
})

function withAstraSupervisor(text) {
  return text.replace('"model": "gpt-5.6-terra", "effort": "high"',
    '"model": "gpt-6-astra", "effort": "high"')
}

function withAstraReason(text, reason = 'Only Astra can exercise the required executor capability.') {
  return text.replace('"ladder": ["gpt-5.6-sol"],',
    '"ladder": ["gpt-5.6-sol"],\n        "astra_executor_reason": ' + JSON.stringify(reason) + ',')
}

function withInitialAstra(text) {
  return withAstraSupervisor(withAstraReason(text)
    .replace('"model": "gpt-5.6-luna"', '"model": "gpt-6-astra"')
    .replace('"ladder": ["gpt-5.6-sol"]', '"ladder": []'))
}

function withoutLadder(text) {
  return text.replace(/        "ladder": \[[^\n]*\],\n/, '')
}

function withAstraRung(text) {
  return withAstraSupervisor(withAstraReason(text)
    .replace('"ladder": ["gpt-5.6-sol"]', '"ladder": ["gpt-6-astra"]'))
}

test('C21 Astra supervises each ordinary GPT-5.6 executor without replacing it', () => {
  for (const model of ['gpt-5.6-luna', 'gpt-5.6-terra', 'gpt-5.6-sol']) {
    const env = init({ planText: (text) => withAstraSupervisor(text)
      .replace('"model": "gpt-5.6-luna"', '"model": "' + model + '"')
      .replace('"ladder": ["gpt-5.6-sol"]', '"ladder": []') })
    assert.equal(next(env.statePath).model, model)
    prepareAttempt(env)
    const action = next(env.statePath)
    assert.equal(action.action, 'spawn-supervisor')
    assert.equal(action.model, 'gpt-6-astra')
    assert.equal(action.effort, 'high')
    recordVerdict(env.statePath, clean())
    assert.equal(next(env.statePath).action, 'merge-ready')
  }
})

test('C21a an explicitly justified initial Astra executor completes under fresh-context Astra review', () => {
  const env = init({ planText: withInitialAstra })
  const dispatch = next(env.statePath)
  assert.equal(dispatch.action, 'spawn-executor')
  assert.equal(dispatch.model, 'gpt-6-astra')
  assert.equal(dispatch.effort, 'medium')
  assert.equal(dispatch.astraExecutorReason,
    'Only Astra can exercise the required executor capability.')
  assert.match(dispatch.prompt, /explicit Astra executor exception/i)
  prepareAttempt(env, 'gpt-6-astra implemented the guard')
  const review = next(env.statePath)
  assert.equal(review.action, 'spawn-supervisor')
  assert.equal(review.model, 'gpt-6-astra')
  assert.equal(review.effort, 'high')
  assert.equal(review.reviewContext, 'fresh')
  assert.equal(review.sameModelReview, true)
  const prompt = ok(['supervisor-prompt', '--state', env.statePath, '--task', 'divide-guard']).prompt
  assert.match(prompt, /\[executor-model-redacted\] implemented the guard/i)
  assert.doesNotMatch(prompt, /gpt-6-astra implemented the guard/i)
  recordVerdict(env.statePath, clean())
  assert.equal(next(env.statePath).action, 'merge-ready')
  const summary = ok(['summary', '--state', env.statePath])
  assert.equal(summary.status, 'done')
  assert.deepEqual(summary.tasks[0].astraExecutor, {
    reason: 'Only Astra can exercise the required executor capability.',
    dispatched: true,
    supervisorModel: 'gpt-6-astra',
    reviewContext: 'fresh',
    sameModelReview: true,
  })
})

test('C21ab Astra supervisor prompt does not disclose the task author', () => {
  const env = init({ planText: withInitialAstra })
  prepareAttempt(env, 'gpt-6-astra implemented the guard')
  const template = [
    'Astra is an available supervisor model.',
    'Same-model review requires a fresh role; it is not different-model independence.',
  ].join('\n')
  const prompt = buildSupervisorPrompt(state(env.statePath), 'divide-guard', template)
  assert.match(prompt, /Astra is an available supervisor model/)
  assert.match(prompt, /Same-model review requires a fresh role/)
  assert.match(prompt, /not different-model independence/)
  assert.match(prompt, /\[executor-model-redacted\] implemented the guard/)
  assert.doesNotMatch(prompt, /ASTRA REVIEW CONTEXT:/)
  assert.doesNotMatch(prompt, /Review the opted-in Astra executor/i)
})

test('C21aa an initial Astra executor may explicitly omit its empty ladder', () => {
  const env = init({ planText: (text) => withoutLadder(withInitialAstra(text)) })
  const dispatch = next(env.statePath)
  assert.equal(dispatch.model, 'gpt-6-astra')
  assert.equal(dispatch.astraExecutorReason,
    'Only Astra can exercise the required executor capability.')
})

test('C21b an explicitly justified Sol-to-Astra ladder dispatches Astra last at high effort', () => {
  const env = init({ planText: (text) => withAstraRung(text)
    .replace('"model": "gpt-5.6-luna"', '"model": "gpt-5.6-sol"') })
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal(next(env.statePath).model, 'gpt-5.6-sol')
    prepareAttempt(env)
    recordVerdict(env.statePath, failed('unresolved requirement ' + attempt))
  }
  const dispatch = next(env.statePath)
  assert.equal(dispatch.action, 'spawn-executor')
  assert.equal(dispatch.model, 'gpt-6-astra')
  assert.equal(dispatch.effort, 'high')
  assert.equal(dispatch.astraExecutorReason,
    'Only Astra can exercise the required executor capability.')
  prepareAttempt(env)
  assert.equal(next(env.statePath).sameModelReview, true)
  recordVerdict(env.statePath, clean())
  assert.equal(next(env.statePath).action, 'merge-ready')
})

test('C21c Astra executor opt-in rejects missing, malformed, unused and non-terminal reasons', () => {
  const cases = [
    ['initial Astra without opt-in', (text) => withAstraSupervisor(text)
      .replace('"model": "gpt-5.6-luna"', '"model": "gpt-6-astra"')
      .replace('"ladder": ["gpt-5.6-sol"]', '"ladder": []'), /astra_executor_reason/],
    ['initial Astra without ladder or opt-in', (text) => withoutLadder(withAstraSupervisor(text)
      .replace('"model": "gpt-5.6-luna"', '"model": "gpt-6-astra"')),
    /astra_executor_reason/],
    ['Astra rung without opt-in', (text) => withAstraSupervisor(text)
      .replace('"ladder": ["gpt-5.6-sol"]', '"ladder": ["gpt-6-astra"]'),
    /astra_executor_reason/],
    ['whitespace opt-in', (text) => withAstraSupervisor(withAstraReason(text, '   ')
      .replace('"ladder": ["gpt-5.6-sol"]', '"ladder": ["gpt-6-astra"]')),
    /astra_executor_reason/],
    ['non-string opt-in', (text) => withAstraRung(text)
      .replace('"astra_executor_reason": "Only Astra can exercise the required executor capability."',
        '"astra_executor_reason": 42'), /astra_executor_reason/],
    ['unused opt-in', withAstraReason, /astra_executor_reason.*only allowed/],
    ['Astra not final', (text) => withAstraSupervisor(withAstraReason(text)
      .replace('"ladder": ["gpt-5.6-sol"]',
        '"ladder": ["gpt-6-astra", "gpt-5.6-sol"]')), /final.*rung/],
  ]
  for (const [label, mutate, message] of cases) {
    const env = init({ invalid: true, planText: mutate })
    assert.equal(env.result.status, 1, label)
    assert.match(env.result.json.errors.join('; '), message, label)
    assert.equal(existsSync(join(env.repo, '.worktrees')), false, label)
  }
})

test('C21d Astra execution requires exact Astra supervision and explicit efforts', () => {
  const cases = [
    ['other supervisor', (text) => withAstraReason(text)
      .replace('"ladder": ["gpt-5.6-sol"]', '"ladder": ["gpt-6-astra"]'),
    /requires exact gpt-6-astra supervisor/],
    ['missing initial effort', (text) => withInitialAstra(text)
      .replace('"model": "gpt-6-astra", "effort": "medium"',
        '"model": "gpt-6-astra"'), /executor\.effort.*required/],
    ['missing supervisor effort', (text) => withInitialAstra(text)
      .replace('"model": "gpt-6-astra", "effort": "high"',
        '"model": "gpt-6-astra"'), /supervisor\.effort.*required/],
  ]
  for (const [label, mutate, message] of cases) {
    const env = init({ invalid: true, planText: mutate })
    assert.equal(env.result.status, 1, label)
    assert.match(env.result.json.errors.join('; '), message, label)
  }
})

test('C21e an ordinary collision in another task remains invalid', () => {
  const env = init({ invalid: true, planText: (text) => withSecondTask(text)
    .replace('{ "id": "multiply-guard",\n        "branch": "wave/multiply-guard",\n'
      + '        "executor": { "model": "gpt-5.6-luna", "effort": "medium" }',
    '{ "id": "multiply-guard",\n        "branch": "wave/multiply-guard",\n'
      + '        "executor": { "model": "gpt-5.6-terra", "effort": "medium" }') })
  assert.equal(env.result.status, 1)
  assert.match(env.result.json.errors.join('; '),
    /tasks\[1\].*supervisor model also appears as executor or ladder rung/)
})

test('C21f Astra supervision preserves the six-attempt terminal stop', () => {
  const env = init({ planText: (text) => withAstraSupervisor(text)
    .replace('"ladder": ["gpt-5.6-sol"]',
      '"ladder": ["gpt-5.6-terra", "gpt-5.6-sol"]') })
  const expected = ['gpt-5.6-luna', 'gpt-5.6-luna', 'gpt-5.6-terra',
    'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-5.6-sol']
  for (const model of expected) {
    const action = next(env.statePath)
    assert.equal(action.action, 'spawn-executor')
    assert.equal(action.model, model)
    assert.notEqual(action.effort, 'max')
    prepareAttempt(env)
    recordVerdict(env.statePath, failed('same unresolved requirement'))
  }
  assert.equal(next(env.statePath).action, 'stop')
  assert.equal(next(env.statePath).reason, 'failed')
  assert.equal(state(env.statePath).tasks['divide-guard'].totalAttempts, 6)
})

test('C21g persisted Astra executor injection is rejected before a spawn', () => {
  const env = init()
  const saved = state(env.statePath)
  saved.tasks['divide-guard'].rungs[0] = 'gpt-6-astra'
  writeFileSync(env.statePath, JSON.stringify(saved))
  const before = readFileSync(env.statePath, 'utf8')
  const result = invoke(['next', '--state', env.statePath])
  assert.equal(result.status, 1)
  assert.match(result.json.errors.join('; '), /rungs/)
  assert.equal(readFileSync(env.statePath, 'utf8'), before)
})

test('C21h changing or removing an initialized Astra reason invalidates the plan digest', () => {
  for (const mutate of [
    (text) => text.replace('Only Astra can exercise the required executor capability.',
      'A different post-initialization rationale.'),
    (text) => text.replace(/        "astra_executor_reason": [^\n]+\n/, ''),
  ]) {
    const env = init({ planText: withInitialAstra })
    writeFileSync(env.plan, mutate(readFileSync(env.plan, 'utf8')))
    const before = readFileSync(env.statePath)
    const result = invoke(['next', '--state', env.statePath])
    assert.equal(result.status, 1)
    assert.match(result.json.errors.join('; '), /plan digest.*reinitialization/)
    assert.deepEqual(readFileSync(env.statePath), before)
  }
})

test('C21i opted-in Astra mechanical rejection overrides a clean supervisor verdict', () => {
  const env = init({ planText: (text) => withInitialAstra(text)
    .replace('python3 -m unittest discover -s tests -t .', 'printf astra-mechanical-failure; exit 9') })
  writeFileSync(join(env.worktree, 'src', 'divide.py'),
    'def divide(a, b):\n    return None if b == 0 else a / b\n')
  git(env.worktree, 'add', 'src/divide.py')
  git(env.worktree, 'commit', '-m', 'guard division')
  recordExecutor(env.statePath, { report: 'must_run output:\nastra-mechanical-failure' })
  verify(env.statePath)
  recordVerdict(env.statePath, clean())
  assert.equal(next(env.statePath).action, 'spawn-executor')
  assert.ok(state(env.statePath).tasks['divide-guard'].verdicts.at(-1)
    .verdict.violations.some((violation) => violation.class === 'must_run'))
})

test('C21ia summary does not claim same-model review when a Sol executor finishes before Astra', () => {
  const env = init({ planText: (text) => withAstraRung(text)
    .replace('"model": "gpt-5.6-luna"', '"model": "gpt-5.6-sol"') })
  prepareAttempt(env)
  recordVerdict(env.statePath, clean())
  const astra = ok(['summary', '--state', env.statePath]).tasks[0].astraExecutor
  assert.deepEqual(astra, {
    reason: 'Only Astra can exercise the required executor capability.',
    dispatched: false,
  })
})

test('C21j plan linter enforces the same Astra executor opt-in contract', () => {
  const env = makeRepo()
  const original = readFileSync(env.plan, 'utf8')
  const linter = join(ROOT, 'plugins/orchestration/skills/super-plan/references/plan-lint.mjs')
  const cases = [
    ['Astra supervisor', withAstraSupervisor(original), 0, /OK: 0 error/],
    ['Astra executor opt-in', withInitialAstra(original), 0, /OK: 0 error/],
    ['Astra rung opt-in', withAstraRung(original), 0, /OK: 0 error/],
    ['Astra executor without reason', withAstraSupervisor(original)
      .replace('"model": "gpt-5.6-luna"', '"model": "gpt-6-astra"')
      .replace('"ladder": ["gpt-5.6-sol"]', '"ladder": []'),
    1, /astra_executor_reason/],
    ['Astra rung without reason', withAstraSupervisor(original)
      .replace('"ladder": ["gpt-5.6-sol"]', '"ladder": ["gpt-6-astra"]'),
    1, /astra_executor_reason/],
    ['whitespace Astra reason', withAstraRung(original)
      .replace('Only Astra can exercise the required executor capability.', '   '),
    1, /astra_executor_reason/],
    ['non-string Astra reason', withAstraRung(original)
      .replace('"astra_executor_reason": "Only Astra can exercise the required executor capability."',
        '"astra_executor_reason": false'), 1, /astra_executor_reason/],
    ['unused Astra reason', withAstraReason(original), 1, /astra_executor_reason.*only allowed/],
    ['Astra before final rung', withAstraSupervisor(withAstraReason(original)
      .replace('"ladder": ["gpt-5.6-sol"]',
        '"ladder": ["gpt-6-astra", "gpt-5.6-sol"]')), 1, /final executor rung/],
    ['non-Astra supervisor', withAstraReason(original)
      .replace('"ladder": ["gpt-5.6-sol"]', '"ladder": ["gpt-6-astra"]'),
    1, /requires exact gpt-6-astra supervisor/],
    ['missing supervisor effort', withAstraSupervisor(original)
      .replace('"model": "gpt-6-astra", "effort": "high"',
        '"model": "gpt-6-astra"'), 1, /supervisor\.effort/],
    ['mixed providers', withAstraSupervisor(original)
      .replace('"model": "gpt-5.6-luna"', '"model": "sonnet"'),
    1, /mixes providers/],
  ]
  for (const [label, markdown, status, message] of cases) {
    writeFileSync(env.plan, markdown)
    const result = spawnSync(process.execPath, [linter, env.plan], { encoding: 'utf8' })
    assert.equal(result.status, status, label + ': ' + result.stdout + result.stderr)
    assert.match(result.stdout, message, label)
  }
})

let failedCount = 0
for (const { name, fn } of tests) {
  try {
    await fn()
    console.log('ok - ' + name)
  } catch (error) {
    failedCount++
    console.error('not ok - ' + name)
    console.error(error.stack || error)
  }
}
if (failedCount) {
  console.error(failedCount + ' of ' + tests.length + ' scenarios failed')
  process.exit(1)
}
console.log('C1-C17: ' + tests.length + ' scenarios passed')
