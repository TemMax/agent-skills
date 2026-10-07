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

test('a task merged with a plain merge: worktree and branch removed, tip reported', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  const tip = addTask(repo, 'a', base)
  merge(repo, 'a')

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

  const r = cleanup('--repo', repo, '--plan', first, '--plan', second)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed.map((item) => item.task), ['a', 'a', 'b', 'b'])
  assert.equal(branchExists(repo, 'wave/a'), false)
  assert.equal(branchExists(repo, 'wave/b'), false)
  // a wave/<id> branch of no given plan is not this run's to remove
  assert.equal(branchExists(repo, 'wave/outside'), true)
  assert.equal(existsSync(worktreePath(repo, 'outside')), true)
})

function writeRecord(repo, runner, name, ids) {
  const dir = join(repo, '.worktrees', runner, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'summary.json'), JSON.stringify({ tasks: ids.map((id) => ({ id, status: 'done' })) }))
  writeFileSync(join(dir, 'a.report.md'), 'report\n')
  return dir
}

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
  const record = writeRecord(repo, 'claude-runner', '1-abc', ['a'])
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

  const mineClaude = writeRecord(repo, 'claude-runner', '1-abc', ['a'])
  const mineCodex = writeRecord(repo, 'codex-runner', '1-abc', ['a'])
  const foreign = writeRecord(repo, 'claude-runner', '1-other', ['a', 'zzz'])
  const busy = writeRecord(repo, 'codex-runner', '2-abc', ['a', 'b'])
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
})

test('--records removes the emptied parent directories, .worktrees included', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  writeRecord(repo, 'claude-runner', '1-abc', ['a'])
  writeRecord(repo, 'codex-runner', '1-abc', ['a'])
  writeState(repo, 'p.json', repo, ['a'])

  const r = cleanup('--repo', repo, '--plan', plan, '--records')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.kept, [])
  assert.equal(existsSync(join(repo, '.worktrees')), false)
  assert.equal(git(repo, 'status', '--porcelain', '--untracked-files=all'), '')
})

test('without --records no run record is read or removed', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  addTask(repo, 'a', base)
  merge(repo, 'a')
  const record = writeRecord(repo, 'claude-runner', '1-abc', ['a'])

  const r = cleanup('--repo', repo, '--plan', plan)
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(r.json.removed.map((item) => item.kind), ['worktree', 'branch'])
  assert.equal(existsSync(join(record, 'summary.json')), true)
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

  const r = cleanup('--repo', repo, '--plan', plan)
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
  assert.match(r.stdout, /wave-cleanup\.mjs --repo <abs> --plan <file>/)
  assert.equal(r.stderr, '')
})

test('every usage error exits 2 with one line on stderr and changes nothing', () => {
  const { root, repo, base } = makeRepo()
  const plan = writePlan(root, 'plan.md', [[1, ['a']]])
  const other = writePlan(root, 'other.md', [[1, ['b']]])
  addTask(repo, 'a', base)
  merge(repo, 'a') // a valid run would remove this
  writeRecord(repo, 'claude-runner', '1-abc', ['a'])
  mkdirSync(join(repo, 'sub'))
  const notGit = join(root, 'not-a-repo')
  mkdirSync(notGit)
  const noBlock = join(root, 'no-block.md')
  writeFileSync(noBlock, '# Plan without a block\n')
  const badJson = join(root, 'bad-json.md')
  writeFileSync(badJson, '```json wave-plan\n{ "waves": [\n```\n')
  const noWaves = join(root, 'no-waves.md')
  writeFileSync(noWaves, '```json wave-plan\n{ "tasks": [] }\n```\n')
  const badId = join(root, 'bad-id.md')
  writeFileSync(badId, '```json wave-plan\n{ "waves": [{ "wave": 1, "tasks": [{ "id": "../escape" }] }] }\n```\n')
  const before = snapshot(repo)

  const cases = {
    'missing --repo': ['--plan', plan],
    'missing --plan': ['--repo', repo],
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
  }
  for (const [name, args] of Object.entries(cases)) {
    const r = cleanup(...args, '--records')
    assert.equal(r.status, 2, name + ': ' + r.stderr)
    assert.equal(r.stdout, '', name)
    assert.match(r.stderr, /^wave-cleanup: [^\n]+\n$/, name)
    assert.deepEqual(snapshot(repo), before, name)
  }
})
