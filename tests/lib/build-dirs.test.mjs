// Build outputs shared between a task's checkouts: found by git, linked or
// cloned copy-on-write, never copied in full.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildDirs, seedBuildDirs, shareBuildDirs } from
  '../../plugins/orchestration/skills/multi-model/references/build-dirs.mjs'

function repo(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'build-dirs-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const r = join(root, 'repo')
  mkdirSync(r)
  const git = (...args) => assert.equal(spawnSync('git', ['-C', r, ...args]).status, 0, args.join(' '))
  git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't'); git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(r, '.gitignore'), 'target/\nnode_modules/\nbuild/\n.env\n')
  mkdirSync(join(r, 'app'))
  writeFileSync(join(r, 'app', 'main.txt'), 'x\n')
  git('add', '.'); git('commit', '-q', '-m', 'base')
  for (const d of ['target/debug', 'node_modules/pkg', 'app/build/classes']) mkdirSync(join(r, d), { recursive: true })
  writeFileSync(join(r, 'target/debug/dep.rlib'), 'dep\n')
  writeFileSync(join(r, '.env'), 'SECRET=1\n')
  const other = join(root, 'other')
  git('worktree', 'add', '-q', '--detach', other, 'HEAD')
  return { r, other }
}

test('build outputs are the ignored directories of any ecosystem; ignored files are not', (t) => {
  const { r } = repo(t)
  assert.deepEqual(buildDirs(r).sort(), ['app/build', 'node_modules', 'target'])
  assert.deepEqual(buildDirs(r, { skip: ['node_modules'] }).sort(), ['app/build', 'target'])
})

test('sharing links each directory and tells git to ignore the links', (t) => {
  const { r, other } = repo(t)
  assert.deepEqual(shareBuildDirs(r, other, { repo: r }).sort(), ['app/build', 'node_modules', 'target'])
  assert.ok(lstatSync(join(other, 'target')).isSymbolicLink())
  assert.equal(readFileSync(join(other, 'target/debug/dep.rlib'), 'utf8'), 'dep\n')
  assert.equal(spawnSync('git', ['-C', other, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).stdout, '')
})

test('seeding clones each directory; a directory already present is left alone', (t) => {
  const { r, other } = repo(t)
  mkdirSync(join(other, 'node_modules'))
  const cloned = seedBuildDirs(r, other)
  if (process.platform === 'darwin') {
    assert.deepEqual(cloned.sort(), ['app/build', 'target'])
    assert.equal(lstatSync(join(other, 'target')).isSymbolicLink(), false)
    assert.equal(readFileSync(join(other, 'target/debug/dep.rlib'), 'utf8'), 'dep\n')
  } else {
    // Without copy-on-write clones nothing is copied at all.
    for (const rel of ['app/build', 'target']) assert.equal(existsSync(join(other, rel)), cloned.includes(rel))
  }
})

test('only build-output names count: logs, data, agent state and path-pinned outputs stay out', (t) => {
  const { r } = repo(t)
  writeFileSync(join(r, '.gitignore'), 'target/\nnode_modules/\nbuild/\n.env\n*.log\n.claude/\n.venv/\ncmake-out/\n')
  for (const d of ['logs', '.claude/worktrees/x/target', '.venv/bin', 'native/build/CMakeFiles', 'py/build/env']) mkdirSync(join(r, d), { recursive: true })
  writeFileSync(join(r, 'logs/run.log'), 'x\n')
  writeFileSync(join(r, '.venv/pyvenv.cfg'), 'home = /usr/bin\n')
  writeFileSync(join(r, 'native/build/CMakeCache.txt'), 'x\n')
  writeFileSync(join(r, 'py/build/env/pyvenv.cfg'), 'x\n')
  assert.deepEqual(buildDirs(r).sort(), ['app/build', 'node_modules', 'target'])
})

test('a committed symlink cannot carry a cloned or linked directory out of the checkout', (t) => {
  const { r, other } = repo(t)
  const outside = mkdtempSync(join(tmpdir(), 'build-dirs-outside-'))
  t.after(() => rmSync(outside, { recursive: true, force: true }))
  rmSync(join(other, 'app'), { recursive: true, force: true })
  symlinkSync(outside, join(other, 'app'))
  assert.ok(!seedBuildDirs(r, other).includes('app/build'))
  assert.ok(!shareBuildDirs(r, other, { repo: r }).includes('app/build'))
  assert.equal(existsSync(join(outside, 'build')), false)
})
