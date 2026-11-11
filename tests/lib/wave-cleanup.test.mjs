// Behaviour tier — wave-cleanup.mjs, the script that removes a wave's
// leftovers only when that is provably safe. Every test builds a real
// disposable Git repository (local user.name/user.email,
// commit.gpgsign=false), creates task worktrees the way the runners do and
// runs the script as a child process; never calls a model or the network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)),
  '../../plugins/orchestration/skills/multi-model/references/wave-cleanup.mjs')

const roots = []
process.on('exit', () => roots.forEach((path) => rmSync(path, { recursive: true, force: true })))

function git(repo, ...args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(['git', ...args].join(' ') + '\n' + result.stdout + result.stderr)
  }
  return result.stdout.trim()
}

function commitFile(checkout, file, content, message) {
  writeFileSync(join(checkout, file), content)
  git(checkout, 'add', '--', file)
  git(checkout, 'commit', '-m', message)
  return git(checkout, 'rev-parse', 'HEAD')
}

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'wave-cleanup-test-'))
  roots.push(root)
  const repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init')
  git(repo, 'config', 'user.name', 'Wave Cleanup Test')
  git(repo, 'config', 'user.email', 'wave-cleanup-test@example.invalid')
  git(repo, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(repo, '.gitignore'), 'build/\n')
  writeFileSync(join(repo, 'shared.txt'), 'one\ntwo\nthree\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'base')
  const base = git(repo, 'rev-parse', 'HEAD')
  return { root, repo, base, main: git(repo, 'symbolic-ref', '--short', 'HEAD') }
}

// waves: [[1, ['a', 'b']], [2, ['c']]]
function writePlan(root, name, waves) {
  const plan = { waves: waves.map(([wave, ids]) => ({ wave, tasks: ids.map((id) => ({ id })) })) }
  const path = join(root, name)
  writeFileSync(path, ['# Plan', '', '```json wave-plan', JSON.stringify(plan, null, 2), '```', ''].join('\n'))
  return path
}

function worktreePath(repo, id) {
  return join(repo, '.worktrees', 'wave-' + id)
}

// A task the way the runners create it, with one commit of its own.
function addTask(repo, id, base, file = id + '.txt', content = id + '\n') {
  const path = worktreePath(repo, id)
  git(repo, 'worktree', 'add', path, '-b', 'wave/' + id, base)
  return commitFile(path, file, content, 'task ' + id)
}

function merge(repo, id) {
  git(repo, 'merge', '--no-ff', '-m', 'merge ' + id, 'wave/' + id)
}

function squash(repo, id) {
  git(repo, 'merge', '--squash', 'wave/' + id)
  git(repo, 'commit', '-m', 'squash ' + id)
}

function cleanup(...args) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })
  let json = null
  try {
    json = JSON.parse(r.stdout)
  } catch {
    // usage errors print no JSON
  }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json }
}

function branchExists(repo, name) {
  return spawnSync('git', ['-C', repo, 'show-ref', '--verify', '--quiet', 'refs/heads/' + name]).status === 0
}

function listTree(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { recursive: true }).map(String).filter((p) => !p.includes('.git/')).sort()
}

// Everything the script could change: refs, registered worktrees, the main
// checkout's status and every path under .worktrees.
function snapshot(repo) {
  return {
    refs: git(repo, 'for-each-ref', '--format=%(refname) %(objectname)'),
    head: git(repo, 'rev-parse', 'HEAD'),
    worktrees: git(repo, 'worktree', 'list', '--porcelain'),
    status: git(repo, 'status', '--porcelain', '--untracked-files=all', '--ignored'),
    files: listTree(join(repo, '.worktrees')),
  }
}

function entry(list, kind, key, value) {
  return list.find((item) => item.kind === kind && item[key] === value)
}

function writeRecord(repo, runner, name, ids, status = 'done') {
  const dir = join(repo, '.worktrees', runner, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'summary.json'), JSON.stringify({ tasks: ids.map((id) => ({ id, status })) }))
  writeFileSync(join(dir, 'a.report.md'), 'report\n')
  return dir
}

// The run record of a finished run that accepted these tasks.
function accept(repo, ...ids) {
  return writeRecord(repo, 'claude-runner', 'accepted', ids, 'ok')
}

const NOT_ACCEPTED = 'no finished run record marks this task ok'

test('a task merged with a plain merge: worktree and branch removed, tip reported', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  const tip = addTask(repo, 'a', base)
  merge(repo, 'a')
  accept(repo, 'a')

  const r = cleanup('--repo', repo, '--plan', plan)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  assert.deepEqual(r.json, {
    into: git(repo, 'rev-parse', 'HEAD'),
    dryRun: false,
    removed: [
      { kind: 'worktree', task: 'a', path: worktreePath(repo, 'a') },
      { kind: 'branch', task: 'a', branch: 'wave/a', tip },
    ],
    kept: [],
  })
  assert.equal(existsSync(worktreePath(repo, 'a')), false)
  assert.equal(branchExists(repo, 'wave/a'), false)
  assert.doesNotMatch(git(repo, 'worktree', 'list', '--porcelain'), /wave-a/)
  // the reported tip restores the branch
  git(repo, 'branch', 'wave/a', r.json.removed[1].tip)
  assert.equal(git(repo, 'rev-parse', 'wave/a'), tip)
})

test('a task integrated with merge --squash plus a commit: removed', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  const tip = addTask(repo, 'a', base)
  squash(repo, 'a')
  accept(repo, 'a')
  // the target moving on elsewhere does not undo the proof
  commitFile(repo, 'later.txt', 'later\n', 'later')
  assert.notEqual(spawnSync('git', ['-C', repo, 'merge-base', '--is-ancestor', tip, 'HEAD']).status, 0)

  const r = cleanup('--repo', repo, '--plan', plan)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.kept, [])
  assert.deepEqual(r.json.removed.map((item) => item.kind), ['worktree', 'branch'])
  assert.equal(r.json.removed[1].tip, tip)
  assert.equal(existsSync(worktreePath(repo, 'a')), false)
  assert.equal(branchExists(repo, 'wave/a'), false)
})

test('a task not integrated: both kept, the reason names the target, nothing changed', () => {
  const { root, repo, base, main } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  accept(repo, 'a')
  const before = snapshot(repo)

  for (const [args, ref] of [[[], 'HEAD'], [['--into', main], main]]) {
    const r = cleanup('--repo', repo, '--plan', plan, ...args)
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(r.json.removed, [])
    assert.deepEqual(r.json.kept, [
      { kind: 'worktree', task: 'a', path: worktreePath(repo, 'a'), reason: 'not integrated into ' + ref },
      { kind: 'branch', task: 'a', branch: 'wave/a', reason: 'not integrated into ' + ref },
    ])
    assert.deepEqual(snapshot(repo), before)
  }
})

test('--into decides against that commit, not against HEAD', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  accept(repo, 'a')
  const before = snapshot(repo)

  const r = cleanup('--repo', repo, '--plan', plan, '--into', base)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.json.into, base)
  assert.deepEqual(r.json.removed, [])
  assert.equal(r.json.kept[0].reason, 'not integrated into ' + base)
  assert.deepEqual(snapshot(repo), before)
})

test('an integrated task with an untracked file or a modified tracked file is kept', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a', 'b']]])
  addTask(repo, 'a', base)
  addTask(repo, 'b', base)
  merge(repo, 'a')
  merge(repo, 'b')
  accept(repo, 'a', 'b')
  writeFileSync(join(worktreePath(repo, 'a'), 'notes.txt'), 'not committed\n')
  writeFileSync(join(worktreePath(repo, 'b'), 'b.txt'), 'edited after the commit\n')
  const before = snapshot(repo)

  const r = cleanup('--repo', repo, '--plan', plan)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed, [])
  assert.deepEqual(r.json.kept, [
    { kind: 'worktree', task: 'a', path: worktreePath(repo, 'a'), reason: 'uncommitted changes' },
    { kind: 'branch', task: 'a', branch: 'wave/a', reason: 'uncommitted changes' },
    { kind: 'worktree', task: 'b', path: worktreePath(repo, 'b'), reason: 'uncommitted changes' },
    { kind: 'branch', task: 'b', branch: 'wave/b', reason: 'uncommitted changes' },
  ])
  assert.deepEqual(snapshot(repo), before)
})

test('an integrated task whose worktree holds only an ignored file: removed', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  accept(repo, 'a')
  mkdirSync(join(worktreePath(repo, 'a'), 'build'))
  writeFileSync(join(worktreePath(repo, 'a'), 'build', 'out.o'), 'object\n')

  const r = cleanup('--repo', repo, '--plan', plan)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.kept, [])
  assert.equal(existsSync(worktreePath(repo, 'a')), false)
  assert.equal(branchExists(repo, 'wave/a'), false)
})

test('a target that changed the same lines again after integration: kept', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base, 'shared.txt', 'one\ntask\nthree\n')
  squash(repo, 'a')
  commitFile(repo, 'shared.txt', 'one\ntarget again\nthree\n', 'change the same line again')
  accept(repo, 'a')
  const before = snapshot(repo)

  const r = cleanup('--repo', repo, '--plan', plan)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed, [])
  assert.deepEqual(r.json.kept.map((item) => [item.kind, item.reason]), [
    ['worktree', 'not integrated into HEAD'],
    ['branch', 'not integrated into HEAD'],
  ])
  assert.deepEqual(snapshot(repo), before)
})

test('--wave touches only the tasks of that wave', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']], [2, ['b', 'c']]])
  for (const id of ['a', 'b', 'c']) {
    addTask(repo, id, base)
    merge(repo, id)
  }
  accept(repo, 'a', 'b', 'c')

  const r = cleanup('--repo', repo, '--plan', plan, '--wave', '2')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.kept, [])
  assert.deepEqual(r.json.removed.map((item) => item.task), ['b', 'b', 'c', 'c'])
  assert.equal(existsSync(worktreePath(repo, 'a')), true)
  assert.equal(branchExists(repo, 'wave/a'), true)
  for (const id of ['b', 'c']) {
    assert.equal(existsSync(worktreePath(repo, id)), false)
    assert.equal(branchExists(repo, 'wave/' + id), false)
  }
})

test('two --plan files: the union of their tasks is handled, in plan order', () => {
  const { root, repo, base } = makeRepo()
  const first = writePlan(root, 'first.md', [[1, ['a']]])
  const second = writePlan(root, 'second.md', [[1, ['b', 'a']]])
  for (const id of ['a', 'b', 'outside']) {
    addTask(repo, id, base)
    merge(repo, id)
  }
  accept(repo, 'a', 'b', 'outside')

  const r = cleanup('--repo', repo, '--plan', first, '--plan', second)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed.map((item) => item.task), ['a', 'a', 'b', 'b'])
  assert.equal(branchExists(repo, 'wave/a'), false)
  assert.equal(branchExists(repo, 'wave/b'), false)
  // a wave/<id> branch of no given plan is not this run's to remove
  assert.equal(branchExists(repo, 'wave/outside'), true)
  assert.equal(existsSync(worktreePath(repo, 'outside')), true)
})

function writeState(repo, name, repoPath, ids) {
  const dir = join(repo, '.worktrees', 'codex-wave')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  writeFileSync(file, JSON.stringify({ repoPath, tasks: Object.fromEntries(ids.map((id) => [id, {}])) }))
  return file
}

test('--dry-run changes nothing and lists the removals', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a', 'b']]])
  const tip = addTask(repo, 'a', base)
  addTask(repo, 'b', base)
  merge(repo, 'a')
  git(repo, 'branch', 'feature', base)
  const record = writeRecord(repo, 'claude-runner', '1-abc', ['a'], 'ok')
  const state = writeState(repo, 'p.json', repo, ['a'])
  const before = snapshot(repo)

  const r = cleanup('--repo', repo, '--plan', plan, '--branch', 'feature', '--records', '--dry-run')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.json.dryRun, true)
  assert.deepEqual(r.json.removed, [
    { kind: 'worktree', task: 'a', path: worktreePath(repo, 'a') },
    { kind: 'branch', task: 'a', branch: 'wave/a', tip },
    { kind: 'branch', branch: 'feature', tip: base },
    { kind: 'record', path: record },
    { kind: 'state', path: state },
  ])
  assert.deepEqual(r.json.kept.map((item) => [item.kind, item.task]), [['worktree', 'b'], ['branch', 'b']])
  assert.deepEqual(snapshot(repo), before)
})

test('--records removes only the run records of the given plans', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a', 'b']]])
  addTask(repo, 'a', base)
  addTask(repo, 'b', base)
  merge(repo, 'a') // b stays unintegrated, so it keeps its branch

  const mineClaude = writeRecord(repo, 'claude-runner', '1-abc', ['a'], 'ok')
  const mineCodex = writeRecord(repo, 'codex-runner', '1-abc', ['a'])
  const foreign = writeRecord(repo, 'claude-runner', '1-other', ['a', 'zzz'])
  const busy = writeRecord(repo, 'codex-runner', '2-abc', ['a', 'b'], 'ok')
  const noSummary = join(repo, '.worktrees', 'codex-runner', 'scratch')
  mkdirSync(noSummary)
  const empty = writeRecord(repo, 'claude-runner', '3-empty', [])
  const mineState = writeState(repo, 'p.json', repo, ['a'])
  const foreignState = writeState(repo, 'elsewhere.json', join(root, 'another-repo'), ['a'])
  const busyState = writeState(repo, 'busy.json', repo, ['b'])
  const outside = join(root, 'outside-record')
  mkdirSync(outside)
  writeFileSync(join(outside, 'summary.json'), JSON.stringify({ tasks: [{ id: 'a' }] }))
  const link = join(repo, '.worktrees', 'claude-runner', 'linked')
  symlinkSync(outside, link)
  const stray = join(repo, '.worktrees', 'stray')
  mkdirSync(stray)

  const r = cleanup('--repo', repo, '--plan', plan, '--records')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed.filter((item) => item.kind === 'record' || item.kind === 'state'), [
    { kind: 'record', path: mineClaude },
    { kind: 'record', path: mineCodex },
    { kind: 'state', path: mineState },
  ])
  for (const path of [mineClaude, mineCodex, mineState]) assert.equal(existsSync(path), false, path)

  const notMine = 'not a run record of the given plans'
  const stillB = 'task b still has a branch or worktree'
  for (const [kind, path, reason] of [
    ['record', foreign, notMine],
    ['record', empty, notMine],
    ['record', noSummary, notMine],
    ['record', busy, stillB],
    ['state', foreignState, notMine],
    ['state', busyState, stillB],
    ['record', link, 'symbolic link'],
    ['other', stray, 'not recognized as a run record of the given plans'],
  ]) {
    assert.deepEqual(entry(r.json.kept, kind, 'path', path), { kind, path, reason })
    assert.equal(existsSync(path), true, path)
  }
  assert.equal(existsSync(join(foreign, 'summary.json')), true)
  assert.equal(existsSync(join(busy, 'a.report.md')), true)
  assert.equal(existsSync(join(outside, 'summary.json')), true)
  // step A's own leftovers are not reported a second time as `other`
  assert.equal(entry(r.json.kept, 'other', 'path', worktreePath(repo, 'b')), undefined)
  assert.equal(entry(r.json.kept, 'branch', 'task', 'b').reason, 'not integrated into HEAD')
})

test('--records removes the emptied parent directories, .worktrees included', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  writeRecord(repo, 'claude-runner', '1-abc', ['a'], 'ok')
  writeRecord(repo, 'codex-runner', '1-abc', ['a'])
  writeState(repo, 'p.json', repo, ['a'])

  const r = cleanup('--repo', repo, '--plan', plan, '--records')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.kept, [])
  assert.equal(existsSync(join(repo, '.worktrees')), false)
  assert.equal(git(repo, 'status', '--porcelain', '--untracked-files=all'), '')
})

test('without --records no run record is removed', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  const record = writeRecord(repo, 'claude-runner', '1-abc', ['a'], 'ok')

  const r = cleanup('--repo', repo, '--plan', plan)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed.map((item) => item.kind), ['worktree', 'branch'])
  assert.equal(existsSync(join(record, 'summary.json')), true)
})

// Verification output the way the Codex wave state helper lays it out.
function writeLogs(repo, id) {
  const dir = join(repo, '.worktrees', 'verification-logs', id)
  mkdirSync(join(dir, '1'), { recursive: true })
  writeFileSync(join(dir, '1', 'check.log'), 'ok\n')
  return dir
}

test('--records removes verification-logs/<id> of a cleaned task, then the emptied directory', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  accept(repo, 'a')
  const logs = writeLogs(repo, 'a')

  const r = cleanup('--repo', repo, '--plan', plan, '--records')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(entry(r.json.removed, 'record', 'path', logs), { kind: 'record', path: logs })
  assert.deepEqual(r.json.kept, [])
  assert.equal(existsSync(join(repo, '.worktrees', 'verification-logs')), false)
  assert.equal(existsSync(join(repo, '.worktrees')), false)
})

test('--records keeps verification-logs/<id> of a task that still has its branch', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a', 'b']]])
  addTask(repo, 'a', base)
  addTask(repo, 'b', base)
  merge(repo, 'a') // b stays unintegrated, so it keeps its branch
  accept(repo, 'a', 'b')
  const logsA = writeLogs(repo, 'a')
  const logsB = writeLogs(repo, 'b')

  const r = cleanup('--repo', repo, '--plan', plan, '--records')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(entry(r.json.removed, 'record', 'path', logsA), { kind: 'record', path: logsA })
  assert.equal(existsSync(logsA), false)
  assert.deepEqual(entry(r.json.kept, 'record', 'path', logsB),
    { kind: 'record', path: logsB, reason: 'task b still has a branch or worktree' })
  assert.equal(existsSync(join(logsB, '1', 'check.log')), true)
  assert.equal(branchExists(repo, 'wave/b'), true)
  assert.equal(entry(r.json.kept, 'other', 'path', join(repo, '.worktrees', 'verification-logs')), undefined)
})

test('--records keeps a verification-logs entry that is not a plan task id, and the parent', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  accept(repo, 'a')
  const parent = join(repo, '.worktrees', 'verification-logs')
  const foreign = writeLogs(repo, 'zzz')
  const file = join(parent, 'a.log')
  writeFileSync(file, 'not a directory\n')

  const r = cleanup('--repo', repo, '--plan', plan, '--records')
  assert.equal(r.status, 0, r.stderr)
  const reason = 'not a run record of the given plans'
  assert.deepEqual(entry(r.json.kept, 'record', 'path', foreign), { kind: 'record', path: foreign, reason })
  assert.deepEqual(entry(r.json.kept, 'record', 'path', file), { kind: 'record', path: file, reason })
  assert.equal(existsSync(join(foreign, '1', 'check.log')), true)
  assert.equal(existsSync(file), true)
  assert.equal(existsSync(parent), true)
  assert.equal(entry(r.json.kept, 'other', 'path', parent), undefined)
})

test('--records keeps a symlinked verification-logs entry and a symlinked verification-logs', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a', 'b']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  accept(repo, 'a')
  const outside = join(root, 'outside-logs')
  mkdirSync(join(outside, 'b'), { recursive: true })
  writeFileSync(join(outside, 'b', 'check.log'), 'ok\n')
  const parent = join(repo, '.worktrees', 'verification-logs')
  mkdirSync(parent, { recursive: true })
  const link = join(parent, 'a')
  symlinkSync(outside, link)

  const r = cleanup('--repo', repo, '--plan', plan, '--records')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(entry(r.json.kept, 'record', 'path', link), { kind: 'record', path: link, reason: 'symbolic link' })
  assert.equal(existsSync(link), true)
  assert.equal(existsSync(join(outside, 'b', 'check.log')), true)

  // the directory itself a link: kept, never entered (b has no branch or worktree)
  rmSync(parent, { recursive: true })
  symlinkSync(outside, parent)
  const again = cleanup('--repo', repo, '--plan', plan, '--records')
  assert.equal(again.status, 0, again.stderr)
  assert.deepEqual(again.json.removed, [])
  assert.deepEqual(entry(again.json.kept, 'other', 'path', parent), { kind: 'other', path: parent, reason: 'symbolic link' })
  assert.equal(existsSync(join(outside, 'b', 'check.log')), true)
})

test('without --records verification-logs is untouched and not listed', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  accept(repo, 'a')
  const logs = writeLogs(repo, 'a')

  const r = cleanup('--repo', repo, '--plan', plan)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed.map((item) => item.kind), ['worktree', 'branch'])
  assert.deepEqual(r.json.kept, [])
  assert.equal(existsSync(join(logs, '1', 'check.log')), true)
})

test('--dry-run --records lists the verification-logs removal and changes nothing', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  accept(repo, 'a')
  const logs = writeLogs(repo, 'a')
  const before = snapshot(repo)

  const r = cleanup('--repo', repo, '--plan', plan, '--records', '--dry-run')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.json.dryRun, true)
  assert.deepEqual(entry(r.json.removed, 'record', 'path', logs), { kind: 'record', path: logs })
  assert.deepEqual(r.json.kept, [])
  assert.deepEqual(snapshot(repo), before)
})

test('--branch: integrated deleted, checked out kept, unintegrated kept, missing silent', () => {
  const { root, repo, base, main } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  const elsewhere = join(root, 'feature-checkout')
  git(repo, 'worktree', 'add', elsewhere, '-b', 'feature', base)
  const tip = commitFile(elsewhere, 'feature.txt', 'feature\n', 'feature work')
  git(repo, 'merge', '--no-ff', '-m', 'merge feature', 'feature')
  git(repo, 'branch', 'unmerged', base)
  git(repo, 'checkout', '-q', 'unmerged')
  commitFile(repo, 'unmerged.txt', 'unmerged\n', 'unmerged work')
  git(repo, 'checkout', '-q', main)

  let r = cleanup('--repo', repo, '--plan', plan, '--branch', 'feature')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed, [])
  assert.deepEqual(r.json.kept, [
    { kind: 'branch', branch: 'feature', reason: 'checked out in ' + realpathSync(elsewhere) },
  ])
  assert.equal(branchExists(repo, 'feature'), true)

  r = cleanup('--repo', repo, '--plan', plan, '--branch', main)
  assert.deepEqual(r.json.kept, [{ kind: 'branch', branch: main, reason: 'checked out in ' + realpathSync(repo) }])
  assert.equal(branchExists(repo, main), true)

  r = cleanup('--repo', repo, '--plan', plan, '--branch', 'unmerged')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.kept, [{ kind: 'branch', branch: 'unmerged', reason: 'not integrated into HEAD' }])
  assert.equal(branchExists(repo, 'unmerged'), true)

  r = cleanup('--repo', repo, '--plan', plan, '--branch', 'no-such-branch')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual([r.json.removed, r.json.kept], [[], []])

  git(repo, 'worktree', 'remove', elsewhere)
  r = cleanup('--repo', repo, '--plan', plan, '--branch', 'feature')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed, [{ kind: 'branch', branch: 'feature', tip }])
  assert.deepEqual(r.json.kept, [])
  assert.equal(branchExists(repo, 'feature'), false)
})

// A remote the way a clone records it, without any network: the URL is never
// contacted, the remote-tracking ref is written directly.
function addRemote(repo, branch, commit) {
  git(repo, 'remote', 'add', 'origin', join(repo, '..', 'no-such-remote.git'))
  git(repo, 'update-ref', 'refs/remotes/origin/' + branch, commit)
}

test('--branch never deletes the integration target, however --into spells it', () => {
  const { root, repo, base, main } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addRemote(repo, main, base)
  git(repo, 'checkout', '-q', '--detach')
  const before = snapshot(repo)

  for (const target of [main, 'refs/heads/' + main, 'origin/' + main, 'refs/remotes/origin/' + main]) {
    for (const extra of [[], ['--dry-run']]) {
      const r = cleanup('--repo', repo, '--plan', plan, '--branch', main, '--into', target, ...extra)
      assert.equal(r.status, 0, r.stderr)
      assert.deepEqual(r.json.removed, [], target)
      assert.deepEqual(r.json.kept, [{ kind: 'branch', branch: main, reason: 'is the integration target' }], target)
      assert.deepEqual(snapshot(repo), before)
    }
  }
})

test('--branch never deletes the branch a remote HEAD points at, even when --into is a commit id', () => {
  const { root, repo, base, main } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  git(repo, 'branch', 'trunk', base)
  addRemote(repo, 'trunk', base)
  git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/trunk')
  git(repo, 'checkout', '-q', '--detach')
  const before = snapshot(repo)

  const r = cleanup('--repo', repo, '--plan', plan, '--branch', 'trunk', '--into', base)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed, [])
  assert.deepEqual(r.json.kept, [{ kind: 'branch', branch: 'trunk', reason: 'is the default branch' }])
  assert.deepEqual(snapshot(repo), before)

  // the other local branch is neither the target nor the default: deleted
  const other = cleanup('--repo', repo, '--plan', plan, '--branch', main, '--into', base)
  assert.equal(other.status, 0, other.stderr)
  assert.deepEqual(other.json.removed, [{ kind: 'branch', branch: main, tip: base }])
  assert.equal(branchExists(repo, 'trunk'), true)
})

test('--branch still deletes a feature branch whose tip equals the target tip (a fast-forward merge)', () => {
  const { root, repo, base, main } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  git(repo, 'checkout', '-q', '-b', 'feature')
  const tip = commitFile(repo, 'feature.txt', 'feature\n', 'feature work')
  git(repo, 'checkout', '-q', main)
  git(repo, 'merge', '--ff-only', 'feature')
  addRemote(repo, main, tip)
  git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/' + main)
  assert.notEqual(tip, base)
  assert.equal(git(repo, 'rev-parse', 'origin/' + main), tip)

  const r = cleanup('--repo', repo, '--plan', plan, '--branch', 'feature', '--into', 'origin/' + main)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed, [{ kind: 'branch', branch: 'feature', tip }])
  assert.deepEqual(r.json.kept, [])
  assert.equal(branchExists(repo, 'feature'), false)
  assert.equal(branchExists(repo, main), true)
})

// A judge's detached checkout inside a run record, left registered the way a
// killed runner leaves it.
function addJudgeCheckout(repo, record, commit) {
  const path = join(record, 't', 'judge-1.checkout')
  git(repo, 'worktree', 'add', '--detach', path, commit)
  return path
}

function registered(repo, path) {
  return git(repo, 'worktree', 'list', '--porcelain').split('\n').includes('worktree ' + realpathSync(path))
}

test('--records prunes the worktree registration a removed record directory held', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  const record = writeRecord(repo, 'claude-runner', '1-abc', ['a'], 'ok')
  const parent = realpathSync(join(record, '..'))
  const checkout = addJudgeCheckout(repo, record, base)
  assert.equal(registered(repo, checkout), true)

  const r = cleanup('--repo', repo, '--plan', plan, '--records')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, '')
  assert.deepEqual(entry(r.json.removed, 'record', 'path', record), { kind: 'record', path: record })
  assert.deepEqual(r.json.kept, [])
  assert.equal(existsSync(record), false)
  const listed = git(repo, 'worktree', 'list', '--porcelain')
  assert.equal(listed.includes(join(parent, '1-abc')), false, listed)
  assert.doesNotMatch(listed, /judge-1\.checkout/)
  assert.equal(listed.split('\n').filter((line) => line.startsWith('worktree ')).length, 1)
})

test('--dry-run --records and a run without --records leave the registration listed', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  const record = writeRecord(repo, 'claude-runner', '1-abc', ['a'], 'ok')
  const checkout = addJudgeCheckout(repo, record, base)
  // a second registration whose directory is already gone: only a prune drops it
  const stale = join(root, 'stale-checkout')
  git(repo, 'worktree', 'add', '--detach', stale, base)
  rmSync(stale, { recursive: true })
  const before = snapshot(repo)
  assert.match(before.worktrees, /stale-checkout/)

  let r = cleanup('--repo', repo, '--plan', plan, '--records', '--dry-run')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(entry(r.json.removed, 'record', 'path', record), { kind: 'record', path: record })
  assert.deepEqual(snapshot(repo), before)
  assert.equal(registered(repo, checkout), true)

  r = cleanup('--repo', repo, '--plan', plan)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed.map((item) => item.kind), ['worktree', 'branch'])
  assert.equal(existsSync(join(record, 'summary.json')), true)
  assert.equal(registered(repo, checkout), true)
  assert.match(git(repo, 'worktree', 'list', '--porcelain'), /stale-checkout/)
})

test('--records that removes no record directory prunes nothing', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  const record = writeRecord(repo, 'claude-runner', '1-abc', ['a'], 'ok')
  const stale = join(root, 'stale-checkout')
  git(repo, 'worktree', 'add', '--detach', stale, base)
  rmSync(stale, { recursive: true })

  const r = cleanup('--repo', repo, '--plan', plan, '--records')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed, [])
  assert.equal(existsSync(record), true)
  assert.match(git(repo, 'worktree', 'list', '--porcelain'), /stale-checkout/)
})

test('worktree states that prove nothing are kept with their reason', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['plain', 'nobranch', 'moved', 'bare', 'absent']]])
  // a directory that is not a worktree, next to an integrated branch
  git(repo, 'branch', 'wave/plain', base)
  mkdirSync(worktreePath(repo, 'plain'), { recursive: true })
  writeFileSync(join(worktreePath(repo, 'plain'), 'keep.txt'), 'someone put this here\n')
  // a worktree whose branch is gone
  addTask(repo, 'nobranch', base)
  git(worktreePath(repo, 'nobranch'), 'checkout', '-q', '--detach')
  git(repo, 'branch', '-D', 'wave/nobranch')
  // a worktree that no longer sits on its integrated branch
  addTask(repo, 'moved', base)
  merge(repo, 'moved')
  git(worktreePath(repo, 'moved'), 'checkout', '-q', '--detach', base)
  // an integrated branch with no worktree at all
  git(repo, 'branch', 'wave/bare', base)

  const r = cleanup('--repo', repo, '--plan', plan,
    ...['plain', 'nobranch', 'moved', 'bare'].flatMap((id) => ['--accepted', id]))
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed, [{ kind: 'branch', task: 'bare', branch: 'wave/bare', tip: base }])
  assert.deepEqual(r.json.kept, [
    { kind: 'worktree', task: 'plain', path: worktreePath(repo, 'plain'), reason: 'not a git worktree' },
    { kind: 'branch', task: 'plain', branch: 'wave/plain', reason: 'not a git worktree' },
    { kind: 'worktree', task: 'nobranch', path: worktreePath(repo, 'nobranch'), reason: 'no wave/nobranch branch' },
    { kind: 'worktree', task: 'moved', path: worktreePath(repo, 'moved'), reason: 'worktree HEAD differs from wave/moved' },
    { kind: 'branch', task: 'moved', branch: 'wave/moved', reason: 'worktree HEAD differs from wave/moved' },
  ])
  assert.equal(existsSync(join(worktreePath(repo, 'plain'), 'keep.txt')), true)
  assert.equal(branchExists(repo, 'wave/plain'), true)
  assert.equal(existsSync(worktreePath(repo, 'nobranch')), true)
  assert.equal(existsSync(worktreePath(repo, 'moved')), true)
  assert.equal(branchExists(repo, 'wave/moved'), true)
  assert.equal(branchExists(repo, 'wave/bare'), false)
})

test('a failing removal is kept with the error, the other tasks continue, exit 1', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a', 'b']]])
  addTask(repo, 'a', base)
  addTask(repo, 'b', base)
  merge(repo, 'a')
  merge(repo, 'b')
  accept(repo, 'a', 'b')
  git(repo, 'worktree', 'lock', worktreePath(repo, 'a')) // one --force does not remove a locked worktree

  const r = cleanup('--repo', repo, '--plan', plan)
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(r.json.kept.map((item) => [item.kind, item.task]), [['worktree', 'a'], ['branch', 'a']])
  assert.match(r.json.kept[0].reason, /lock/)
  assert.equal(r.json.kept[1].reason, r.json.kept[0].reason)
  assert.deepEqual(r.json.removed.map((item) => [item.kind, item.task]), [['worktree', 'b'], ['branch', 'b']])
  assert.equal(existsSync(worktreePath(repo, 'a')), true)
  assert.equal(branchExists(repo, 'wave/a'), true)
  assert.equal(branchExists(repo, 'wave/b'), false)
})

test('--help prints the usage and exits 0', () => {
  const r = cleanup('--help')
  assert.equal(r.status, 0)
  assert.match(r.stdout, /wave-cleanup\.mjs --repo <abs> \[--plan <file> \.\.\.\]/)
  assert.equal(r.stderr, '')
})

test('every usage error exits 2 with one line on stderr and changes nothing', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  const other = writePlan(root, 'other.md', [[1, ['b']]])
  addTask(repo, 'a', base)
  merge(repo, 'a') // a valid run would remove this
  writeRecord(repo, 'claude-runner', '1-abc', ['a'], 'ok')
  mkdirSync(join(repo, 'sub'))
  const notGit = join(root, 'not-a-repo')
  mkdirSync(notGit)
  const noBlock = join(root, 'no-block.md')
  writeFileSync(noBlock, '# Plan without a block\n')
  const badJson = join(root, 'bad-json.md')
  writeFileSync(badJson, '```json wave-plan\n{ "waves": [\n```\n')
  const noWaves = join(root, 'no-waves.md')
  writeFileSync(noWaves, '```json wave-plan\n{ "tasks": [] }\n```\n')
  const noTasks = join(root, 'no-tasks.md')
  writeFileSync(noTasks, '```json wave-plan\n{ "waves": [] }\n```\n')
  const emptyWaves = join(root, 'empty-waves.md')
  writeFileSync(emptyWaves, '```json wave-plan\n{ "waves": [{ "wave": 1, "tasks": [] }] }\n```\n')
  const badId = join(root, 'bad-id.md')
  writeFileSync(badId, '```json wave-plan\n{ "waves": [{ "wave": 1, "tasks": [{ "id": "../escape" }] }] }\n```\n')
  const before = snapshot(repo)

  const cases = {
    'missing --repo': ['--plan', plan],
    '--wave without --plan': ['--repo', repo, '--branch', 'x', '--wave', '1'],
    'neither --plan nor --branch': ['--repo', repo],
    'a plan with no waves': ['--repo', repo, '--plan', noTasks],
    'a plan whose waves have no task': ['--repo', repo, '--plan', emptyWaves],
    '--accepted without --plan': ['--repo', repo, '--branch', 'x', '--accepted', 'a'],
    'relative --repo': ['--repo', 'repo', '--plan', plan],
    '--repo below the top level': ['--repo', join(repo, 'sub'), '--plan', plan],
    '--repo outside any repository': ['--repo', notGit, '--plan', plan],
    'unknown flag': ['--repo', repo, '--plan', plan, '--force'],
    'positional argument': ['--repo', repo, '--plan', plan, 'extra'],
    'flag without its value at the end': ['--repo', repo, '--plan', plan, '--into'],
    'flag followed by another flag': ['--repo', repo, '--plan', '--records'],
    'repeated --repo': ['--repo', repo, '--repo', repo, '--plan', plan],
    'repeated --into': ['--repo', repo, '--plan', plan, '--into', 'HEAD', '--into', 'HEAD'],
    'repeated --wave': ['--repo', repo, '--plan', plan, '--wave', '1', '--wave', '1'],
    'repeated --branch': ['--repo', repo, '--plan', plan, '--branch', 'x', '--branch', 'y'],
    '--wave with two plans': ['--repo', repo, '--plan', plan, '--plan', other, '--wave', '1'],
    '--wave naming no wave': ['--repo', repo, '--plan', plan, '--wave', '9'],
    '--into that is not a commit': ['--repo', repo, '--plan', plan, '--into', 'no-such-ref'],
    'unreadable plan': ['--repo', repo, '--plan', join(root, 'missing.md')],
    'plan without a block': ['--repo', repo, '--plan', noBlock],
    'plan with broken JSON': ['--repo', repo, '--plan', badJson],
    'plan without waves': ['--repo', repo, '--plan', noWaves],
    'plan with an unsafe task id': ['--repo', repo, '--plan', badId],
    'one bad plan among good ones': ['--repo', repo, '--plan', plan, '--plan', noBlock],
    '--summary without its value': ['--repo', repo, '--plan', plan, '--summary'],
    '--summary that does not exist': ['--repo', repo, '--plan', plan, '--summary', join(root, 'missing.json')],
    '--summary that is a directory': ['--repo', repo, '--plan', plan, '--summary', root],
    '--accepted without its value': ['--repo', repo, '--plan', plan, '--accepted'],
    '--accepted naming no task of the plans': ['--repo', repo, '--plan', plan, '--accepted', 'b'],
  }
  for (const [name, args] of Object.entries(cases)) {
    const r = cleanup(...args, '--records')
    assert.equal(r.status, 2, name + ': ' + r.stderr)
    assert.equal(r.stdout, '', name)
    assert.match(r.stderr, /^wave-cleanup: [^\n]+\n$/, name)
    assert.deepEqual(snapshot(repo), before, name)
  }
})

// A task the way the runners create it that has not committed yet.
function addIdleTask(repo, id, base) {
  git(repo, 'worktree', 'add', worktreePath(repo, id), '-b', 'wave/' + id, base)
}

function keptUnaccepted(repo, id) {
  return [
    { kind: 'worktree', task: id, path: worktreePath(repo, id), reason: NOT_ACCEPTED },
    { kind: 'branch', task: id, branch: 'wave/' + id, reason: NOT_ACCEPTED },
  ]
}

function writeSummary(file, summary) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(summary))
  return file
}

test('a task with no commits, a clean worktree and no run record is kept, nothing changed', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addIdleTask(repo, 'a', base)
  // the old proof alone would have passed: the tip is an ancestor, the tree is clean
  assert.equal(git(repo, 'rev-parse', 'wave/a'), git(repo, 'rev-parse', 'HEAD'))
  assert.equal(git(worktreePath(repo, 'a'), 'status', '--porcelain', '--untracked-files=all'), '')
  const before = snapshot(repo)

  for (const extra of [[], ['--dry-run'], ['--records'], ['--wave', '1']]) {
    const r = cleanup('--repo', repo, '--plan', plan, ...extra)
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(r.json.removed, [])
    assert.deepEqual(r.json.kept, keptUnaccepted(repo, 'a'))
    assert.deepEqual(snapshot(repo), before)
  }
})

test('an accepted, integrated sibling is removed; the unaccepted task of the same wave is untouched', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['done', 'running']]])
  const tip = addTask(repo, 'done', base)
  merge(repo, 'done')
  addIdleTask(repo, 'running', git(repo, 'rev-parse', 'HEAD'))
  const record = writeRecord(repo, 'codex-runner', '1-abc', ['done'], 'ok')
  const runningTip = git(repo, 'rev-parse', 'wave/running')

  const r = cleanup('--repo', repo, '--plan', plan, '--wave', '1')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed, [
    { kind: 'worktree', task: 'done', path: worktreePath(repo, 'done') },
    { kind: 'branch', task: 'done', branch: 'wave/done', tip },
  ])
  assert.deepEqual(r.json.kept, keptUnaccepted(repo, 'running'))
  assert.equal(existsSync(worktreePath(repo, 'done')), false)
  assert.equal(branchExists(repo, 'wave/done'), false)
  assert.equal(existsSync(worktreePath(repo, 'running')), true)
  assert.equal(git(repo, 'rev-parse', 'wave/running'), runningTip)
  assert.equal(git(worktreePath(repo, 'running'), 'rev-parse', 'HEAD'), runningTip)
  assert.equal(git(worktreePath(repo, 'running'), 'symbolic-ref', '--short', 'HEAD'), 'wave/running')
  assert.equal(existsSync(join(record, 'summary.json')), true)
})

test('a summary that marks an integrated, clean task failed is not acceptance', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  writeRecord(repo, 'claude-runner', '1-abc', ['a'], 'failed')
  writeRecord(repo, 'codex-runner', '1-abc', ['other'], 'ok')
  const before = snapshot(repo)

  const r = cleanup('--repo', repo, '--plan', plan)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed, [])
  assert.deepEqual(r.json.kept, keptUnaccepted(repo, 'a'))
  assert.deepEqual(snapshot(repo), before)
})

test('an ok summary whose recorded head differs from the branch tip is not acceptance; the matching head is', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  const accepted = addTask(repo, 'a', base)
  const tip = commitFile(worktreePath(repo, 'a'), 'more.txt', 'more\n', 'work after the accepted run')
  merge(repo, 'a')
  const file = join(repo, '.worktrees', 'codex-runner', '1-abc', 'summary.json')
  const summary = (head) => ({ tasks: [{ id: 'a', status: 'ok' }], recovery: { tasks: { a: { head } } } })
  writeSummary(file, summary(accepted))
  const before = snapshot(repo)

  let r = cleanup('--repo', repo, '--plan', plan)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed, [])
  assert.deepEqual(r.json.kept, keptUnaccepted(repo, 'a'))
  assert.deepEqual(snapshot(repo), before)

  writeSummary(file, summary(tip))
  r = cleanup('--repo', repo, '--plan', plan)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.kept, [])
  assert.deepEqual(r.json.removed, [
    { kind: 'worktree', task: 'a', path: worktreePath(repo, 'a') },
    { kind: 'branch', task: 'a', branch: 'wave/a', tip },
  ])
  assert.equal(branchExists(repo, 'wave/a'), false)
})

test('an ok summary does not accept a worktree whose branch is gone', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  git(worktreePath(repo, 'a'), 'checkout', '-q', '--detach')
  git(repo, 'branch', '-D', 'wave/a')
  accept(repo, 'a')
  const before = snapshot(repo)

  const r = cleanup('--repo', repo, '--plan', plan)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed, [])
  assert.deepEqual(r.json.kept, [
    { kind: 'worktree', task: 'a', path: worktreePath(repo, 'a'), reason: NOT_ACCEPTED },
  ])
  assert.deepEqual(snapshot(repo), before)
})

test('--summary outside the default directories accepts the task; an unreadable one exits 2, a gone one is skipped', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a', 'b']]])
  const tipA = addTask(repo, 'a', base)
  const tipB = addTask(repo, 'b', base)
  merge(repo, 'a')
  merge(repo, 'b')
  const forA = writeSummary(join(root, 'out-a', 'summary.json'), { tasks: [{ id: 'a', status: 'ok' }] })
  const forB = writeSummary(join(root, 'out-b', 'summary.json'),
    { tasks: [{ id: 'b', status: 'ok' }], recovery: { tasks: { b: { head: tipB } } } })
  const broken = join(root, 'broken.json')
  writeFileSync(broken, '{ "tasks": [')
  const noTasks = writeSummary(join(root, 'no-tasks.json'), { status: 'done' })
  const before = snapshot(repo)

  // its directory is there, the file is not
  let r = cleanup('--repo', repo, '--plan', plan, '--summary', forA, '--summary', join(root, 'summary.json'))
  assert.equal(r.status, 2, r.stderr)
  assert.equal(r.stdout, '')
  assert.match(r.stderr, /^wave-cleanup: cannot read --summary [^\n]+\n$/)
  assert.deepEqual(snapshot(repo), before)

  // a summary that does not parse or has no tasks array marks nothing
  r = cleanup('--repo', repo, '--plan', plan, '--summary', broken, '--summary', noTasks)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed, [])
  assert.deepEqual(r.json.kept, [...keptUnaccepted(repo, 'a'), ...keptUnaccepted(repo, 'b')])
  assert.deepEqual(snapshot(repo), before)

  // a summary whose directory is gone (an earlier cleanup removed it) is
  // skipped, and named on stderr
  const gone = join(root, 'gone', 'summary.json')
  r = cleanup('--repo', repo, '--plan', plan, '--summary', forA, '--summary', gone)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr, 'wave-cleanup: skipped --summary ' + gone + ': its directory does not exist\n')
  assert.deepEqual(r.json.removed, [
    { kind: 'worktree', task: 'a', path: worktreePath(repo, 'a') },
    { kind: 'branch', task: 'a', branch: 'wave/a', tip: tipA },
  ])
  assert.deepEqual(r.json.kept, keptUnaccepted(repo, 'b'))

  r = cleanup('--repo', repo, '--plan', plan, '--summary', forA, '--summary', forB)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed.map((item) => [item.kind, item.task]), [['worktree', 'b'], ['branch', 'b']])
  assert.deepEqual(r.json.kept, [])
  // the summaries named on the command line are left where they are
  for (const file of [forA, forB, broken, noTasks]) assert.equal(existsSync(file), true, file)
})

test('--accepted accepts a task without any record; an id outside the plans exits 2', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']], [2, ['b']]])
  const tip = addTask(repo, 'a', base)
  addTask(repo, 'b', base)
  addTask(repo, 'outside', base)
  for (const id of ['a', 'b', 'outside']) merge(repo, id)
  const before = snapshot(repo)

  let r = cleanup('--repo', repo, '--plan', plan, '--accepted', 'a', '--accepted', 'outside')
  assert.equal(r.status, 2, r.stderr)
  assert.equal(r.stdout, '')
  assert.equal(r.stderr, 'wave-cleanup: --accepted names no task of the given plans: outside\n')
  assert.deepEqual(snapshot(repo), before)

  r = cleanup('--repo', repo, '--plan', plan, '--accepted', 'a')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed, [
    { kind: 'worktree', task: 'a', path: worktreePath(repo, 'a') },
    { kind: 'branch', task: 'a', branch: 'wave/a', tip },
  ])
  assert.deepEqual(r.json.kept, keptUnaccepted(repo, 'b'))
  assert.equal(existsSync(worktreePath(repo, 'outside')), true)

  // acceptance does not replace the integration proof or the clean worktree
  git(repo, 'worktree', 'add', worktreePath(repo, 'a'), '-b', 'wave/a', base)
  commitFile(worktreePath(repo, 'a'), 'again.txt', 'again\n', 'unmerged work')
  writeFileSync(join(worktreePath(repo, 'b'), 'notes.txt'), 'not committed\n')
  r = cleanup('--repo', repo, '--plan', plan, '--accepted', 'a', '--accepted', 'b')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed, [])
  assert.deepEqual(r.json.kept.map((item) => [item.task, item.reason]), [
    ['a', 'not integrated into HEAD'], ['a', 'not integrated into HEAD'],
    ['b', 'uncommitted changes'], ['b', 'uncommitted changes'],
  ])
})

test('a summary reached through a symbolic link under a runner directory is ignored', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  const ok = { tasks: [{ id: 'a', status: 'ok' }] }
  const outside = join(root, 'outside-run')
  writeSummary(join(outside, 'summary.json'), ok)
  // a run directory that is a link
  mkdirSync(join(repo, '.worktrees', 'claude-runner'), { recursive: true })
  symlinkSync(outside, join(repo, '.worktrees', 'claude-runner', 'linked'))
  // a summary.json that is a link
  mkdirSync(join(repo, '.worktrees', 'codex-runner', '1-abc'), { recursive: true })
  symlinkSync(join(outside, 'summary.json'), join(repo, '.worktrees', 'codex-runner', '1-abc', 'summary.json'))
  const before = snapshot(repo)

  let r = cleanup('--repo', repo, '--plan', plan)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed, [])
  assert.deepEqual(r.json.kept, keptUnaccepted(repo, 'a'))
  assert.deepEqual(snapshot(repo), before)

  // the same summary as a real file in a real run directory does accept
  writeSummary(join(repo, '.worktrees', 'claude-runner', 'real', 'summary.json'), ok)
  r = cleanup('--repo', repo, '--plan', plan)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed.map((item) => item.kind), ['worktree', 'branch'])
  assert.equal(existsSync(join(outside, 'summary.json')), true)
})

// A runner given --out <repo>/.worktrees/runs/wave-<n> keeps its record
// outside the two default directories; --summary names it.
test('--records removes the directory of each --summary under .worktrees, then the emptied parents', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']], [2, ['b']]])
  addTask(repo, 'a', base)
  addTask(repo, 'b', base)
  merge(repo, 'a')
  merge(repo, 'b')
  const one = writeRecord(repo, 'runs', 'wave-1', ['a'], 'ok')
  const two = writeRecord(repo, 'runs', 'wave-2', ['b'], 'ok')
  const named = ['--summary', join(one, 'summary.json'), '--summary', join(two, 'summary.json')]
  const runs = join(repo, '.worktrees', 'runs')

  // without --summary the run directory is not recognized and stays
  const plain = cleanup('--repo', repo, '--plan', plan, '--records', '--dry-run')
  assert.equal(plain.status, 0, plain.stderr)
  assert.deepEqual(entry(plain.json.kept, 'other', 'path', runs),
    { kind: 'other', path: runs, reason: 'not recognized as a run record of the given plans' })

  const before = snapshot(repo)
  const dry = cleanup('--repo', repo, '--plan', plan, '--records', '--dry-run', ...named)
  assert.equal(dry.status, 0, dry.stderr)
  assert.deepEqual(dry.json.removed.filter((item) => item.kind === 'record'),
    [{ kind: 'record', path: one }, { kind: 'record', path: two }])
  assert.deepEqual(dry.json.kept, [])
  assert.deepEqual(snapshot(repo), before)

  const r = cleanup('--repo', repo, '--plan', plan, '--records', ...named)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed.filter((item) => item.kind === 'record'),
    [{ kind: 'record', path: one }, { kind: 'record', path: two }])
  assert.deepEqual(r.json.kept, [])
  assert.equal(existsSync(join(repo, '.worktrees')), false)
  assert.equal(git(repo, 'status', '--porcelain', '--untracked-files=all'), '')
})

test('--records keeps a --summary directory that is outside .worktrees, not a record, linked, foreign or busy', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a', 'b']]])
  addTask(repo, 'a', base)
  addTask(repo, 'b', base)
  merge(repo, 'a') // b stays unintegrated, so it keeps its branch and worktree
  const worktrees = join(repo, '.worktrees')
  const outside = writeSummary(join(root, 'out', 'summary.json'), { tasks: [{ id: 'a', status: 'ok' }] })
  const foreign = writeRecord(repo, 'runs', 'foreign', ['a', 'zzz'])
  const busy = writeRecord(repo, 'runs', 'busy', ['b'])
  const odd = join(worktrees, 'runs', 'odd')
  const oddFile = writeSummary(join(odd, 'copy.json'), { tasks: [{ id: 'a' }] })
  const notes = join(worktrees, 'runs', 'notes.txt')
  writeFileSync(notes, 'mine\n')
  const inTask = join(worktreePath(repo, 'b'), 'out')
  writeSummary(join(inTask, 'summary.json'), { tasks: [{ id: 'b' }] })
  const target = join(root, 'linked-target')
  writeSummary(join(target, 'summary.json'), { tasks: [{ id: 'a' }] })
  const linked = join(worktrees, 'linked')
  symlinkSync(target, linked)
  const checkout = join(worktrees, 'checkout')
  mkdirSync(checkout)
  git(checkout, 'init', '-q')
  writeSummary(join(checkout, 'summary.json'), { tasks: [{ id: 'a' }] })

  const files = [outside, join(foreign, 'summary.json'), join(busy, 'summary.json'), oddFile,
    join(inTask, 'summary.json'), join(linked, 'summary.json'), join(checkout, 'summary.json')]
  const r = cleanup('--repo', repo, '--plan', plan, '--records', ...files.flatMap((file) => ['--summary', file]))
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed.filter((item) => item.kind === 'record'), [])
  // a record outside .worktrees is listed where it really is, links resolved
  for (const [kind, path, reason] of [
    ['record', realpathSync(join(root, 'out')), 'outside ' + worktrees],
    ['record', foreign, 'not a run record of the given plans'],
    ['record', busy, 'task b still has a branch or worktree'],
    ['record', odd, 'the --summary file is not named summary.json'],
    ['record', inTask, 'inside the worktree of task b'],
    ['record', realpathSync(target), 'outside ' + worktrees],
    ['other', linked, 'not recognized as a run record of the given plans'],
    ['record', checkout, 'inside another git work tree'],
    ['other', notes, 'not recognized as a run record of the given plans'],
  ]) {
    assert.deepEqual(entry(r.json.kept, kind, 'path', path), { kind, path, reason })
    assert.equal(existsSync(path), true, path)
  }
  assert.equal(existsSync(join(target, 'summary.json')), true)
  assert.equal(entry(r.json.kept, 'other', 'path', join(worktrees, 'runs')), undefined)
})

test('--records decides a --summary in a default runner directory once, and an inner record before its parent', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']], [2, ['b']]])
  addTask(repo, 'a', base)
  addTask(repo, 'b', base)
  merge(repo, 'a')
  merge(repo, 'b')
  const usual = writeRecord(repo, 'claude-runner', '1-abc', ['a'], 'ok')
  const outer = writeRecord(repo, 'runs', 'wave-2', ['b'], 'ok')
  const inner = join(outer, 'resumed')
  writeSummary(join(inner, 'summary.json'), { tasks: [{ id: 'b', status: 'ok' }] })

  const r = cleanup('--repo', repo, '--plan', plan, '--records', '--summary', join(usual, 'summary.json'),
    '--summary', join(outer, 'summary.json'), '--summary', join(inner, 'summary.json'))
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed.filter((item) => item.kind === 'record'),
    [{ kind: 'record', path: usual }, { kind: 'record', path: inner }, { kind: 'record', path: outer }])
  assert.deepEqual(r.json.kept, [])
  assert.equal(existsSync(join(repo, '.worktrees')), false)
})

// A runner's --out must not exist yet, so a later run can be given a
// directory inside an earlier run's record.
test('--records keeps a --summary record that holds a record which stays, in the dry run and the real one', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']], [2, ['b']]])
  addTask(repo, 'a', base)
  addTask(repo, 'b', base)
  merge(repo, 'a') // b is not integrated: its branch and worktree are left
  const outer = join(repo, '.worktrees', 'runs')
  writeSummary(join(outer, 'summary.json'), { tasks: [{ id: 'a', status: 'ok' }] })
  const inner = writeRecord(repo, 'runs', 'wave-2', ['b'], 'ok')
  const named = ['--summary', join(outer, 'summary.json'), '--summary', join(inner, 'summary.json')]
  const expected = [
    { kind: 'record', path: inner, reason: 'task b still has a branch or worktree' },
    { kind: 'record', path: outer, reason: 'holds ' + inner + ', which stays' },
  ]

  const dry = cleanup('--repo', repo, '--plan', plan, '--records', '--dry-run', ...named)
  assert.equal(dry.status, 0, dry.stderr)
  const r = cleanup('--repo', repo, '--plan', plan, '--records', ...named)
  assert.equal(r.status, 0, r.stderr)
  for (const run of [dry, r]) {
    assert.deepEqual(run.json.removed.filter((item) => item.kind === 'record'), [])
    assert.deepEqual(run.json.kept.filter((item) => item.kind === 'record'), expected)
  }
  assert.equal(existsSync(join(inner, 'summary.json')), true)
  assert.equal(existsSync(join(outer, 'summary.json')), true)
})

test('--records keeps a record directory that holds another plan\'s run record, named or default', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  const named = writeRecord(repo, 'runs', 'wave-1', ['a'], 'ok')
  const strangerInNamed = join(named, 'x')
  writeSummary(join(strangerInNamed, 'summary.json'), { tasks: [{ id: 'zzz', status: 'ok' }] })
  const usual = writeRecord(repo, 'claude-runner', '1-abc', ['a'], 'ok')
  const strangerInUsual = join(usual, 'resume')
  writeSummary(join(strangerInUsual, 'summary.json'), { tasks: [{ id: 'zzz', status: 'ok' }] })

  const r = cleanup('--repo', repo, '--plan', plan, '--records', '--summary', join(named, 'summary.json'))
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed.filter((item) => item.kind === 'record'), [])
  assert.deepEqual(entry(r.json.kept, 'record', 'path', named),
    { kind: 'record', path: named, reason: 'holds ' + strangerInNamed + ', which stays' })
  assert.deepEqual(entry(r.json.kept, 'record', 'path', usual),
    { kind: 'record', path: usual, reason: 'holds ' + strangerInUsual + ', which stays' })
  assert.equal(existsSync(join(strangerInNamed, 'summary.json')), true)
  assert.equal(existsSync(join(strangerInUsual, 'summary.json')), true)
})

test('--records leaves .worktrees itself and the default directories\' records to their own rules', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  const worktrees = join(repo, '.worktrees')
  const top = writeSummary(join(worktrees, 'summary.json'), { tasks: [{ id: 'a', status: 'ok' }] })
  const logs = writeLogs(repo, 'a')
  const inLogs = writeSummary(join(logs, 'summary.json'), { tasks: [{ id: 'a', status: 'ok' }] })
  const named = ['--summary', top, '--summary', inLogs]

  const dry = cleanup('--repo', repo, '--plan', plan, '--records', '--dry-run', ...named)
  assert.equal(dry.status, 0, dry.stderr)
  const r = cleanup('--repo', repo, '--plan', plan, '--records', ...named)
  assert.equal(r.status, 0, r.stderr)
  for (const run of [dry, r]) {
    assert.deepEqual(run.json.removed.filter((item) => item.kind === 'record'), [{ kind: 'record', path: logs }])
    assert.deepEqual(run.json.kept, [
      { kind: 'record', path: worktrees, reason: 'not a run record directory' },
      { kind: 'other', path: top, reason: 'not recognized as a run record of the given plans' },
    ])
  }
  assert.equal(existsSync(top), true)
  assert.equal(existsSync(logs), false)
})

test('--records takes a relative --summary from the working directory and prunes a checkout the record held', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  const record = writeRecord(repo, 'runs', 'wave-1', ['a'], 'ok')
  const checkout = addJudgeCheckout(repo, record, base)
  assert.equal(registered(repo, checkout), true)

  const r = spawnSync(process.execPath, [SCRIPT, '--repo', repo, '--plan', plan, '--records',
    '--summary', join('.worktrees', 'runs', 'wave-1', 'summary.json')], { encoding: 'utf8', cwd: repo })
  assert.equal(r.status, 0, r.stderr)
  const json = JSON.parse(r.stdout)
  assert.deepEqual(json.removed.filter((item) => item.kind === 'record'), [{ kind: 'record', path: record }])
  assert.deepEqual(json.kept, [])
  assert.equal(existsSync(join(repo, '.worktrees')), false)
  assert.equal(git(repo, 'worktree', 'list', '--porcelain').includes('judge-1.checkout'), false)
})

// A killed run leaves its --out without a summary.json; the first files each
// runner writes there still mark it as a run.
test('--records keeps a record directory that holds a run with no summary.json yet, in the dry run and the real one', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']], [2, ['b']]])
  addTask(repo, 'a', base)
  addTask(repo, 'b', base)
  merge(repo, 'a') // b's run was killed: its branch and worktree are left
  const outer = join(repo, '.worktrees', 'runs')
  writeSummary(join(outer, 'summary.json'), { tasks: [{ id: 'a', status: 'ok' }] })
  const killed = join(outer, 'wave-2')
  mkdirSync(join(killed, 'b'), { recursive: true })
  writeFileSync(join(killed, 'launch.workflow.mjs'), '// launch\n')
  const usual = writeRecord(repo, 'claude-runner', '1-abc', ['a'], 'ok')
  const codexKilled = join(usual, 'retry')
  mkdirSync(codexKilled)
  writeFileSync(join(codexKilled, 'verdict.schema.json'), '{}\n')
  const named = ['--summary', join(outer, 'summary.json')]
  const expected = [
    { kind: 'record', path: usual, reason: 'holds ' + codexKilled + ', which stays' },
    { kind: 'record', path: outer, reason: 'holds ' + killed + ', which stays' },
  ]

  const dry = cleanup('--repo', repo, '--plan', plan, '--records', '--dry-run', ...named)
  assert.equal(dry.status, 0, dry.stderr)
  const r = cleanup('--repo', repo, '--plan', plan, '--records', ...named)
  assert.equal(r.status, 0, r.stderr)
  for (const run of [dry, r]) {
    assert.deepEqual(run.json.removed.filter((item) => item.kind === 'record'), [])
    assert.deepEqual(run.json.kept.filter((item) => item.kind === 'record'), expected)
  }
  assert.equal(existsSync(join(killed, 'launch.workflow.mjs')), true)
  assert.equal(existsSync(join(codexKilled, 'verdict.schema.json')), true)
})

test('--records does not search a checkout that a record holds, and keeps one that holds a repository', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  const record = writeRecord(repo, 'runs', 'wave-1', ['a'], 'ok')
  const checkout = addJudgeCheckout(repo, record, base)
  // the checked-out project's own files are no run of this repository
  writeSummary(join(checkout, 'fixtures', 'summary.json'), { tasks: [{ id: 'zzz', status: 'ok' }] })
  writeFileSync(join(checkout, 'fixtures', 'progress.log'), 'step\n')
  // a repository of its own, put inside another record
  const other = writeRecord(repo, 'runs', 'wave-2', ['a'], 'ok')
  const own = join(other, 'mine')
  mkdirSync(own)
  git(own, 'init', '-q')

  const r = cleanup('--repo', repo, '--plan', plan, '--records',
    '--summary', join(record, 'summary.json'), '--summary', join(other, 'summary.json'))
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed.filter((item) => item.kind === 'record'), [{ kind: 'record', path: record }])
  assert.deepEqual(r.json.kept, [{ kind: 'record', path: other, reason: 'holds ' + own + ', which stays' }])
  assert.equal(existsSync(record), false)
  assert.equal(git(repo, 'worktree', 'list', '--porcelain').includes('judge-1.checkout'), false)
  assert.equal(existsSync(join(own, '.git')), true)
})

test('--records runs the same command again after an earlier run removed the named record', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']], [2, ['b']]])
  addTask(repo, 'a', base)
  const tipB = addTask(repo, 'b', base)
  merge(repo, 'a')
  merge(repo, 'b')
  const record = writeRecord(repo, 'runs', 'wave-1', ['a'], 'ok')
  const usual = writeRecord(repo, 'claude-runner', '2-abc', ['b'], 'ok')
  const notes = join(worktreePath(repo, 'b'), 'notes.txt')
  writeFileSync(notes, 'not committed\n')
  const args = ['--repo', repo, '--plan', plan, '--records', '--summary', join(record, 'summary.json')]

  let r = cleanup(...args)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed.filter((item) => item.kind === 'record'), [{ kind: 'record', path: record }])
  assert.deepEqual(entry(r.json.kept, 'record', 'path', usual),
    { kind: 'record', path: usual, reason: 'task b still has a branch or worktree' })

  rmSync(notes)
  r = cleanup(...args)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stderr,
    'wave-cleanup: skipped --summary ' + join(record, 'summary.json') + ': its directory does not exist\n')
  assert.deepEqual(r.json.removed, [
    { kind: 'worktree', task: 'b', path: worktreePath(repo, 'b') },
    { kind: 'branch', task: 'b', branch: 'wave/b', tip: tipB },
    { kind: 'record', path: usual },
  ])
  assert.deepEqual(r.json.kept, [])
  assert.equal(existsSync(join(repo, '.worktrees')), false)
})

test('--records reports a --summary in a task worktree the same way in the dry run and the real one', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a', 'b']]])
  addTask(repo, 'a', base)
  addTask(repo, 'b', base)
  merge(repo, 'a')
  merge(repo, 'b')
  // ignored run directories (build/ is in .gitignore): a's worktree is clean
  const inA = join(worktreePath(repo, 'a'), 'build', 'run')
  writeSummary(join(inA, 'summary.json'), { tasks: [{ id: 'a', status: 'ok' }] })
  const inB = join(worktreePath(repo, 'b'), 'build', 'run')
  writeSummary(join(inB, 'summary.json'), { tasks: [{ id: 'b', status: 'ok' }] })
  writeFileSync(join(worktreePath(repo, 'b'), 'notes.txt'), 'not committed\n')
  const named = ['--summary', join(inA, 'summary.json'), '--summary', join(inB, 'summary.json')]

  const dry = cleanup('--repo', repo, '--plan', plan, '--records', '--dry-run', ...named)
  assert.equal(dry.status, 0, dry.stderr)
  const r = cleanup('--repo', repo, '--plan', plan, '--records', ...named)
  assert.equal(r.status, 0, r.stderr)
  for (const run of [dry, r]) {
    assert.deepEqual(entry(run.json.removed, 'worktree', 'task', 'a'),
      { kind: 'worktree', task: 'a', path: worktreePath(repo, 'a') })
    // a's record goes with its worktree; b's worktree, and so its record, stays
    assert.deepEqual(run.json.kept.filter((item) => item.kind === 'record'),
      [{ kind: 'record', path: inB, reason: 'inside the worktree of task b' }])
  }
  assert.equal(existsSync(worktreePath(repo, 'a')), false)
  assert.equal(existsSync(join(inB, 'summary.json')), true)
})

test('--records decides a --summary directory the same way whatever the order of the options', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  const dir = writeRecord(repo, 'runs', 'wave-1', ['a'], 'ok')
  const copy = writeSummary(join(dir, 'copy.json'), { tasks: [{ id: 'a', status: 'ok' }] })
  for (const order of [[join(dir, 'summary.json'), copy], [copy, join(dir, 'summary.json')]]) {
    const r = cleanup('--repo', repo, '--plan', plan, '--records', '--dry-run',
      ...order.flatMap((file) => ['--summary', file]))
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(r.json.removed.filter((item) => item.kind === 'record'), [])
    assert.deepEqual(r.json.kept, [
      { kind: 'record', path: dir, reason: 'the --summary file is not named summary.json' },
      { kind: 'other', path: dirname(dir), reason: 'not recognized as a run record of the given plans' },
    ])
  }
})

test('--records lists a --summary reached through a link at its real place, the same in the dry run and the real one', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  const target = join(root, 'elsewhere', 'wave-1')
  writeSummary(join(target, 'summary.json'), { tasks: [{ id: 'a', status: 'ok' }] })
  // a default record and a named one each hold a link to that outside record
  const usual = writeRecord(repo, 'claude-runner', '1-abc', ['a'], 'ok')
  symlinkSync(target, join(usual, 'ext'))
  const outer = writeRecord(repo, 'runs', 'wave-1', ['a'], 'ok')
  symlinkSync(target, join(outer, 'ext'))
  // the second spelling of the repository (realpath: /private/var on macOS)
  const spelled = join(realpathSync(repo), '.worktrees', 'runs', 'wave-1', 'ext', 'summary.json')
  const named = ['--summary', join(usual, 'ext', 'summary.json'), '--summary', spelled,
    '--summary', join(outer, 'summary.json')]

  const dry = cleanup('--repo', repo, '--plan', plan, '--records', '--dry-run', ...named)
  assert.equal(dry.status, 0, dry.stderr)
  const r = cleanup('--repo', repo, '--plan', plan, '--records', ...named)
  assert.equal(r.status, 0, r.stderr)
  for (const run of [dry, r]) {
    assert.deepEqual(run.json.removed.filter((item) => item.kind === 'record'),
      [{ kind: 'record', path: usual }, { kind: 'record', path: outer }])
    assert.deepEqual(run.json.kept,
      [{ kind: 'record', path: realpathSync(target), reason: 'outside ' + join(repo, '.worktrees') }])
  }
  assert.equal(existsSync(join(target, 'summary.json')), true)
  assert.equal(existsSync(join(repo, '.worktrees')), false)
})

test('--records takes a --summary named through a link inside .worktrees where it really is', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  const record = writeRecord(repo, 'runs', 'wave-1', ['a'], 'ok')
  const latest = join(repo, '.worktrees', 'latest')
  symlinkSync(record, latest)

  const r = cleanup('--repo', repo, '--plan', plan, '--records', '--summary', join(latest, 'summary.json'))
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed.filter((item) => item.kind === 'record'), [{ kind: 'record', path: record }])
  assert.deepEqual(r.json.kept,
    [{ kind: 'other', path: latest, reason: 'not recognized as a run record of the given plans' }])
  assert.equal(existsSync(record), false)
  // the link itself is no record: it stays, and is listed
  assert.deepEqual(readdirSync(join(repo, '.worktrees')), ['latest'])
})

test('--records takes a --summary in other letter case as the directory it names, where the file system allows it', (t) => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']], [2, ['b']]])
  addTask(repo, 'a', base)
  addTask(repo, 'b', base)
  merge(repo, 'a')
  merge(repo, 'b')
  const usual = writeRecord(repo, 'claude-runner', '1-abc', ['a'], 'ok')
  const record = writeRecord(repo, 'runs', 'wave-2', ['b'], 'ok')
  if (!existsSync(join(repo, '.worktrees', 'RUNS'))) return t.skip('case-sensitive file system')
  const named = ['--summary', join(repo, '.worktrees', 'Claude-Runner', '1-abc', 'summary.json'),
    '--summary', join(repo, '.worktrees', 'Runs', 'Wave-2', 'summary.json')]

  const dry = cleanup('--repo', repo, '--plan', plan, '--records', '--dry-run', ...named)
  assert.equal(dry.status, 0, dry.stderr)
  const r = cleanup('--repo', repo, '--plan', plan, '--records', ...named)
  assert.equal(r.status, 0, r.stderr)
  for (const run of [dry, r]) {
    // each directory once, in the spelling the file system stores
    assert.deepEqual(run.json.removed.filter((item) => item.kind === 'record'),
      [{ kind: 'record', path: usual }, { kind: 'record', path: record }])
    assert.deepEqual(run.json.kept, [])
  }
  assert.equal(existsSync(join(repo, '.worktrees')), false)
})

// ---- the ready command a dry run prints ----
//
// A summary's `After the merge:` line carries this command as printed, so it
// has to run as it is from any directory: the script's own path and every
// path option absolute, every word quoted for a POSIX shell.

function shellQuote(value) {
  return /^[A-Za-z0-9_@%+=:,.\/-]+$/.test(value) ? value : "'" + value.replace(/'/g, "'\\''") + "'"
}

function readyCommand(...words) {
  return ['node', realpathSync(SCRIPT), ...words].map(shellQuote).join(' ')
}

test('--dry-run also prints the same cleanup as a ready command: absolute paths, quoted, no --dry-run', () => {
  const { root, repo, base, main } = makeRepo()
  writePlan(root, "the plan's wave.md", [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  git(repo, 'branch', 'feature', base)
  writeRecord(repo, 'runs', 'wave 1', ['a'], 'ok')
  const before = snapshot(repo)

  // --plan and --summary relative to the working directory
  const r = spawnSync(process.execPath, [SCRIPT, '--dry-run', '--repo', repo, '--plan', join('..', "the plan's wave.md"),
    '--into', main, '--records', '--summary', join('.worktrees', 'runs', 'wave 1', 'summary.json'),
    '--branch', 'feature', '--accepted', 'a'], { encoding: 'utf8', cwd: repo })
  assert.equal(r.status, 0, r.stderr)
  const json = JSON.parse(r.stdout)
  assert.equal(json.dryRun, true)
  assert.equal(json.command, readyCommand('--repo', repo, '--plan', join(realpathSync(root), "the plan's wave.md"),
    '--into', main, '--records', '--summary', join(realpathSync(repo), '.worktrees', 'runs', 'wave 1', 'summary.json'),
    '--branch', 'feature', '--accepted', 'a'))
  assert.match(json.command, /^node \//)
  assert.match(json.command, /the plan'\\''s wave\.md'/)
  assert.doesNotMatch(json.command, /--dry-run/)
  assert.deepEqual(snapshot(repo), before)
})

test('the printed command keeps the options as given: every --plan, --wave, and no --into when none was given', () => {
  const { root, repo, base } = makeRepo()
  const one = writePlan(root, 'one.md', [[1, ['a']], [2, ['b']]])
  const two = writePlan(root, 'two.md', [[1, ['c']]])
  addTask(repo, 'a', base)

  let r = cleanup('--repo', repo, '--plan', one, '--plan', two, '--dry-run')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.json.command, readyCommand('--repo', repo, '--plan', realpathSync(one), '--plan', realpathSync(two)))

  r = cleanup('--repo', repo, '--plan', one, '--wave', '2', '--dry-run')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.json.command, readyCommand('--repo', repo, '--plan', realpathSync(one), '--wave', '2'))
})

test('the printed command runs from any directory and removes what the dry run listed; a real run prints none', () => {
  const { root, repo, base, main } = makeRepo()
  writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  git(repo, 'branch', 'feature', base)
  const record = writeRecord(repo, 'runs', 'wave-1', ['a'], 'ok')

  const dry = spawnSync(process.execPath, [SCRIPT, '--repo', repo, '--plan', 'plan.md', '--into', main, '--records',
    '--summary', join('repo', '.worktrees', 'runs', 'wave-1', 'summary.json'), '--branch', 'feature', '--dry-run'],
  { encoding: 'utf8', cwd: root })
  assert.equal(dry.status, 0, dry.stderr)
  const listed = JSON.parse(dry.stdout)
  assert.equal(existsSync(record), true)

  const elsewhere = mkdtempSync(join(tmpdir(), 'wave-cleanup-elsewhere-'))
  roots.push(elsewhere)
  const run = spawnSync('/bin/sh', ['-c', listed.command], {
    encoding: 'utf8', cwd: elsewhere, env: { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH },
  })
  assert.equal(run.status, 0, run.stderr)
  const done = JSON.parse(run.stdout)
  assert.equal(done.dryRun, false)
  assert.equal('command' in done, false)
  assert.deepEqual(done.removed, listed.removed)
  assert.deepEqual(done.kept, listed.kept)
  assert.equal(existsSync(record), false)
  assert.equal(branchExists(repo, 'feature'), false)
})

test('without --plan only --branch is handled: the integrated feature branch goes, the rest stays', () => {
  const { root, repo, base } = makeRepo()
  writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  const record = writeRecord(repo, 'claude-runner', '1-abc', ['a'], 'ok')
  git(repo, 'branch', 'feature', base)

  const dry = cleanup('--repo', repo, '--branch', 'feature', '--records', '--dry-run')
  assert.equal(dry.status, 0, dry.stderr)
  assert.deepEqual(dry.json.removed, [{ kind: 'branch', branch: 'feature', tip: base }])
  assert.deepEqual(entry(dry.json.kept, 'record', 'path', record),
    { kind: 'record', path: record, reason: 'not a run record of the given plans' })
  assert.equal(dry.json.command, readyCommand('--repo', repo, '--records', '--branch', 'feature'))

  const r = cleanup('--repo', repo, '--branch', 'feature', '--records')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed, dry.json.removed)
  assert.equal(branchExists(repo, 'feature'), false)
  assert.equal(branchExists(repo, 'wave/a'), true)
  assert.equal(existsSync(worktreePath(repo, 'a')), true)
  assert.equal(existsSync(record), true)
})

test('the printed command names the script and each --plan and --summary where they really are', () => {
  const { root, repo, base } = makeRepo()
  const real = mkdtempSync(join(tmpdir(), 'wave-cleanup-real-'))
  roots.push(real)
  mkdirSync(join(real, 'deep'))
  writePlan(real, 'plan.md', [[1, ['a']]])
  symlinkSync(join(real, 'deep'), join(root, 'link'))
  const linkedScript = join(root, 'wave-cleanup.mjs')
  symlinkSync(SCRIPT, linkedScript)
  addTask(repo, 'a', base)
  merge(repo, 'a')
  writeRecord(repo, 'runs', 'wave-1', ['a'], 'ok')
  symlinkSync(join(repo, '.worktrees', 'runs'), join(root, 'runs-link'))

  // `link/..` is `real` to the kernel, `root` to a string join
  const plan = root + '/link/../plan.md' // not join(), which would drop `link/..` as a string
  const summary = join(root, 'runs-link', 'wave-1', 'summary.json')
  const r = spawnSync(process.execPath, [linkedScript, '--repo', repo, '--plan', plan, '--records', '--summary', summary,
    '--dry-run'], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const json = JSON.parse(r.stdout)
  assert.equal(json.command, readyCommand('--repo', repo, '--plan', realpathSync(join(real, 'plan.md')), '--records',
    '--summary', realpathSync(summary)))
  const run = spawnSync('/bin/sh', ['-c', json.command], { encoding: 'utf8', cwd: tmpdir(),
    env: { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH } })
  assert.equal(run.status, 0, run.stderr)
  assert.deepEqual(JSON.parse(run.stdout).removed, json.removed)
})

test('the printed command survives quotes, $ and spaces in every path when a shell runs it', () => {
  const base0 = mkdtempSync(join(tmpdir(), 'wave cleanup $HOME "q" it\'s-'))
  roots.push(base0)
  const repo = join(base0, 'the repo')
  mkdirSync(repo)
  git(repo, 'init')
  git(repo, 'config', 'user.name', 'Wave Cleanup Test')
  git(repo, 'config', 'user.email', 'wave-cleanup-test@example.invalid')
  git(repo, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(repo, 'shared.txt'), 'one\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'base')
  const base = git(repo, 'rev-parse', 'HEAD')
  const plan = writePlan(base0, "a plan's $1 \"x\".md", [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  const record = writeRecord(repo, 'runs', 'wave $2 "1"', ['a'], 'ok')
  git(repo, 'branch', 'feature', base)

  const dry = cleanup('--repo', repo, '--plan', plan, '--into', 'HEAD', '--records', '--summary', join(record, 'summary.json'),
    '--branch', 'feature', '--dry-run')
  assert.equal(dry.status, 0, dry.stderr)
  const run = spawnSync('/bin/sh', ['-c', dry.json.command], { encoding: 'utf8', cwd: '/',
    env: { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH } })
  assert.equal(run.status, 0, run.stderr)
  const done = JSON.parse(run.stdout)
  assert.equal(done.dryRun, false)
  assert.deepEqual(done.removed, dry.json.removed)
  assert.deepEqual(done.kept, dry.json.kept)
  assert.equal(existsSync(record), false)
  assert.equal(branchExists(repo, 'feature'), false)
})

test('a --summary through a link and `..` is read, listed and printed as the same record', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  const record = writeRecord(repo, join('runs', 'b'), 'a', ['a'], 'ok') // .worktrees/runs/b/a
  mkdirSync(join(repo, '.worktrees', 'runs', 'b', 'c'))
  symlinkSync(join(repo, '.worktrees', 'runs', 'b', 'c'), join(repo, '.worktrees', 'runs', 'lnk'))
  // `lnk/..` is .worktrees/runs/b to the kernel, .worktrees/runs to a string join
  const summary = repo + '/.worktrees/runs/lnk/../a/summary.json'

  const dry = cleanup('--repo', repo, '--plan', plan, '--records', '--summary', summary, '--dry-run')
  assert.equal(dry.status, 0, dry.stderr)
  assert.deepEqual(dry.json.removed.filter((item) => item.kind === 'record'), [{ kind: 'record', path: record }])
  assert.match(dry.json.command, /--summary \S*\/runs\/b\/a\/summary\.json/)
  const run = spawnSync('/bin/sh', ['-c', dry.json.command], { encoding: 'utf8', cwd: tmpdir(),
    env: { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH } })
  assert.equal(run.status, 0, run.stderr)
  const done = JSON.parse(run.stdout)
  assert.deepEqual(done.removed, dry.json.removed)
  assert.deepEqual(done.kept, dry.json.kept)
  assert.equal(existsSync(record), false)
})

test('a --summary that is itself a link is decided the same in the dry run and by the printed command', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  const target = writeRecord(repo, 'runs', 'w2', ['a'], 'ok')
  const named = join(repo, '.worktrees', 'runs', 'w1')
  mkdirSync(named)
  symlinkSync(join(target, 'summary.json'), join(named, 'summary.json'))

  const dry = cleanup('--repo', repo, '--plan', plan, '--records', '--summary', join(named, 'summary.json'), '--dry-run')
  assert.equal(dry.status, 0, dry.stderr)
  // the link's own directory is the named record; the file name is not resolved
  assert.match(dry.json.command, /--summary \S*\/runs\/w1\/summary\.json/)
  assert.deepEqual(entry(dry.json.kept, 'record', 'path', named),
    { kind: 'record', path: named, reason: 'not a run record of the given plans' })
  const run = spawnSync('/bin/sh', ['-c', dry.json.command], { encoding: 'utf8', cwd: tmpdir(),
    env: { ...process.env, PATH: dirname(process.execPath) + ':' + process.env.PATH } })
  assert.equal(run.status, 0, run.stderr)
  const done = JSON.parse(run.stdout)
  assert.deepEqual(done.removed, dry.json.removed)
  assert.deepEqual(done.kept, dry.json.kept)
  assert.equal(existsSync(join(named, 'summary.json')), true)
  assert.equal(existsSync(join(target, 'summary.json')), true)
})

test('a --summary whose directory is gone through a link and `..` is skipped, never read as another record', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  const other = writeRecord(repo, 'runs', 'a', ['a'], 'ok') // .worktrees/runs/a, not the named one
  mkdirSync(join(repo, '.worktrees', 'runs', 'b', 'c'), { recursive: true })
  symlinkSync(join(repo, '.worktrees', 'runs', 'b', 'c'), join(repo, '.worktrees', 'runs', 'lnk'))
  // the kernel's .worktrees/runs/b/a is gone; a string join would name .worktrees/runs/a
  const summary = repo + '/.worktrees/runs/lnk/../a/summary.json'

  const dry = cleanup('--repo', repo, '--plan', plan, '--records', '--summary', summary, '--dry-run')
  assert.equal(dry.status, 0, dry.stderr)
  assert.equal(dry.stderr, 'wave-cleanup: skipped --summary ' + summary + ': its directory does not exist\n')
  assert.equal(entry(dry.json.removed, 'record', 'path', other), undefined)
  assert.match(dry.json.command, /--summary \S*\/runs\/lnk\/\.\.\/a\/summary\.json/)
  const r = cleanup('--repo', repo, '--plan', plan, '--records', '--summary', summary)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(existsSync(other), true)
})

test('a --plan the file system cannot find is not read as another file a string join would name', () => {
  const { root, repo, base } = makeRepo()
  writePlan(root, 'plan.md', [[1, ['a']]]) // root/plan.md exists
  const real = mkdtempSync(join(tmpdir(), 'wave-cleanup-real-'))
  roots.push(real)
  mkdirSync(join(real, 'deep'))
  symlinkSync(join(real, 'deep'), join(root, 'link'))
  addTask(repo, 'a', base)
  // to the kernel this is real/plan.md, which does not exist
  const r = cleanup('--repo', repo, '--plan', root + '/link/../plan.md', '--dry-run')
  assert.equal(r.status, 2, r.stdout)
  assert.match(r.stderr, /^wave-cleanup: cannot read plan /)
})
