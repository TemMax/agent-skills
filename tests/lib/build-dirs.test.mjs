// Build outputs shared between a task's checkouts: found by git, linked or
// cloned copy-on-write, never copied in full.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, lutimesSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync,
  symlinkSync, writeFileSync } from 'node:fs'
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

// A link whose time is set: one directory clone keeps it, `cp -cR` makes a
// new link, so the time tells which of the two cloned the directory.
function linkedPackage(r) {
  mkdirSync(join(r, 'node_modules/.store/pkg'), { recursive: true })
  writeFileSync(join(r, 'node_modules/.store/pkg/run.sh'), '#!/bin/sh\n')
  chmodSync(join(r, 'node_modules/.store/pkg/run.sh'), 0o755)
  symlinkSync('.store/pkg', join(r, 'node_modules/pkg-link'))
  lutimesSync(join(r, 'node_modules/pkg-link'), new Date('2001-01-01'), new Date('2001-01-01'))
  return lstatSync(join(r, 'node_modules/pkg-link')).mtimeMs
}

test('on APFS a small directory is cloned in one call: same tree, links, modes and times', { skip: process.platform !== 'darwin' }, (t) => {
  const { r, other } = repo(t)
  const linkTime = linkedPackage(r)
  assert.deepEqual(seedBuildDirs(r, other).sort(), ['app/build', 'node_modules', 'target'])
  assert.equal(readlinkSync(join(other, 'node_modules/pkg-link')), '.store/pkg')
  assert.equal(lstatSync(join(other, 'node_modules/pkg-link')).mtimeMs, linkTime)
  assert.equal(statSync(join(other, 'node_modules/.store/pkg/run.sh')).mode & 0o777, 0o755)
  assert.equal(statSync(join(other, 'node_modules/.store/pkg/run.sh')).mtimeMs, statSync(join(r, 'node_modules/.store/pkg/run.sh')).mtimeMs)
  assert.equal(readFileSync(join(other, 'target/debug/dep.rlib'), 'utf8'), 'dep\n')
  assert.equal(spawnSync('git', ['-C', other, 'status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).stdout, '')
})

test('when the clone calls fail, each directory is cloned file by file', { skip: process.platform !== 'darwin' }, (t) => {
  const { r, other } = repo(t)
  const linkTime = linkedPackage(r)
  const bin = mkdtempSync(join(tmpdir(), 'no-clonefile-'))
  t.after(() => rmSync(bin, { recursive: true, force: true }))
  writeFileSync(join(bin, 'osascript'), '#!/bin/sh\necho -1\n', { mode: 0o755 })
  const path = process.env.PATH
  process.env.PATH = bin + ':' + path
  t.after(() => { process.env.PATH = path })
  assert.deepEqual(seedBuildDirs(r, other).sort(), ['app/build', 'node_modules', 'target'])
  assert.equal(readlinkSync(join(other, 'node_modules/pkg-link')), '.store/pkg')
  assert.notEqual(lstatSync(join(other, 'node_modules/pkg-link')).mtimeMs, linkTime)
  assert.equal(readFileSync(join(other, 'target/debug/dep.rlib'), 'utf8'), 'dep\n')
})

test('on APFS a large directory is cloned in subtrees with the same contents', { skip: process.platform !== 'darwin' }, (t) => {
  const { r, other } = repo(t)
  const linkTime = linkedPackage(r)
  // Three packages of 900 files: too many for one call, each one call.
  for (const name of ['a', 'b', 'c']) {
    mkdirSync(join(r, 'node_modules', name, 'lib'), { recursive: true })
    for (let i = 0; i < 900; i++) writeFileSync(join(r, 'node_modules', name, 'lib', i + '.js'), name + i)
  }
  mkdirSync(join(r, 'node_modules/ünï cødé'))
  writeFileSync(join(r, 'node_modules/ünï cødé/日本.js'), 'x')
  writeFileSync(join(r, 'node_modules/.modules.yaml'), 'top\n')
  chmodSync(join(r, 'node_modules/a'), 0o700)
  chmodSync(join(r, 'node_modules'), 0o777)
  assert.deepEqual(seedBuildDirs(r, other).sort(), ['app/build', 'node_modules', 'target'])
  // Split: made anew with the umask applied, as `cp -cR` does; a clone of
  // the whole directory would have kept 777.
  assert.equal(statSync(join(other, 'node_modules')).mode & 0o777, 0o777 & ~process.umask())
  const list = (root) => spawnSync('find', ['.'], { cwd: root, encoding: 'utf8' }).stdout.split('\n').sort()
  assert.deepEqual(list(join(other, 'node_modules')), list(join(r, 'node_modules')))
  assert.equal(readFileSync(join(other, 'node_modules/b/lib/899.js'), 'utf8'), 'b899')
  assert.equal(readFileSync(join(other, 'node_modules/ünï cødé/日本.js'), 'utf8'), 'x')
  assert.equal(readFileSync(join(other, 'node_modules/.modules.yaml'), 'utf8'), 'top\n')
  assert.equal(statSync(join(other, 'node_modules/a')).mode & 0o777, 0o700)
  assert.equal(lstatSync(join(other, 'node_modules/pkg-link')).mtimeMs, linkTime)
})

test('a read-only directory that is split gets its entries, then its mode', { skip: process.platform !== 'darwin' }, (t) => {
  const { r, other } = repo(t)
  const linkTime = linkedPackage(r)
  for (const name of ['a', 'b', 'c']) {
    mkdirSync(join(r, 'node_modules/ro', name), { recursive: true })
    for (let i = 0; i < 900; i++) writeFileSync(join(r, 'node_modules/ro', name, i + '.js'), name + i)
  }
  chmodSync(join(r, 'node_modules/ro'), 0o555)
  try {
    assert.deepEqual(seedBuildDirs(r, other).sort(), ['app/build', 'node_modules', 'target'])
    assert.equal(readFileSync(join(other, 'node_modules/ro/c/899.js'), 'utf8'), 'c899')
    assert.equal(statSync(join(other, 'node_modules/ro')).mode & 0o777, 0o555 & ~process.umask())
    assert.equal(lstatSync(join(other, 'node_modules/pkg-link')).mtimeMs, linkTime)
  } finally {
    for (const root of [r, other]) if (existsSync(join(root, 'node_modules/ro'))) chmodSync(join(root, 'node_modules/ro'), 0o755)
  }
})

test('a clone that fails partway is removed, read-only parts too, and copied as before', { skip: process.platform !== 'darwin' }, (t) => {
  const { r, other } = repo(t)
  linkedPackage(r)
  const bin = mkdtempSync(join(tmpdir(), 'partial-clone-'))
  t.after(() => rmSync(bin, { recursive: true, force: true }))
  // Leaves a read-only directory with a file in the target, then fails.
  writeFileSync(join(bin, 'osascript'), '#!/bin/sh\nmkdir -p "$6/x" && touch "$6/x/f" && chmod 555 "$6/x"\necho failed\n', { mode: 0o755 })
  const path = process.env.PATH
  process.env.PATH = bin + ':' + path
  t.after(() => { process.env.PATH = path })
  assert.deepEqual(seedBuildDirs(r, other).sort(), ['app/build', 'node_modules', 'target'])
  assert.equal(existsSync(join(other, 'node_modules/x')), false)
  assert.equal(readlinkSync(join(other, 'node_modules/pkg-link')), '.store/pkg')
  assert.equal(readFileSync(join(other, 'target/debug/dep.rlib'), 'utf8'), 'dep\n')
})

test('a tree with a FIFO is cloned file by file, as before', { skip: process.platform !== 'darwin' }, (t) => {
  const { r, other } = repo(t)
  const linkTime = linkedPackage(r)
  assert.equal(spawnSync('mkfifo', [join(r, 'node_modules/.store/pipe')]).status, 0)
  assert.deepEqual(seedBuildDirs(r, other).sort(), ['app/build', 'node_modules', 'target'])
  assert.equal(readlinkSync(join(other, 'node_modules/pkg-link')), '.store/pkg')
  assert.notEqual(lstatSync(join(other, 'node_modules/pkg-link')).mtimeMs, linkTime)
})

// Gradle's configuration cache names the checkout it was made in: a clone of it
// made another checkout build the repository checkout's sources.
function gradleCache(r) {
  mkdirSync(join(r, '.gradle/configuration-cache/key'), { recursive: true })
  writeFileSync(join(r, '.gradle/configuration-cache/key/entry.bin'), 'paths of repo\n')
  writeFileSync(join(r, '.gradle/file-system.probe'), 'probe\n')
  writeFileSync(join(r, '.gitignore'), readFileSync(join(r, '.gitignore'), 'utf8') + '.gradle/\n')
}

test('a cloned .gradle leaves its configuration cache behind; the source keeps it', { skip: process.platform !== 'darwin' }, (t) => {
  const { r, other } = repo(t)
  gradleCache(r)
  assert.ok(seedBuildDirs(r, other).includes('.gradle'))
  assert.equal(readFileSync(join(other, '.gradle/file-system.probe'), 'utf8'), 'probe\n')
  assert.equal(existsSync(join(other, '.gradle/configuration-cache')), false)
  assert.equal(readFileSync(join(r, '.gradle/configuration-cache/key/entry.bin'), 'utf8'), 'paths of repo\n')
})

test('a .gradle is never linked: its configuration cache would build the other checkout', (t) => {
  const { r, other } = repo(t)
  gradleCache(r)
  const linked = shareBuildDirs(r, other, { repo: r })
  assert.ok(!linked.includes('.gradle'))
  assert.ok(linked.includes('target'))
  assert.equal(existsSync(join(other, '.gradle')), false)
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
