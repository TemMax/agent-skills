// Behaviour tier — worktree-env.mjs, the shared module for the wave runners
// and the plan linter. Uses real disposable Git repos (git init, local
// user.email/user.name, commit.gpgsign=false); never calls a model or the
// network. Never reads the content of a linked file — only lstatSync() to
// confirm it is a symlink.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  TASK_HEADING_SOURCE,
  taskHeadingIds,
  malformedTaskHeadings,
  ENVIRONMENT_SIGNATURES,
  detectEnvironmentBlock,
  ENVIRONMENT_BLOCKED_MARKER,
  reportEnvironmentBlock,
  readPlanJson,
  INHERITED_KEYS,
  effectivePlan,
  expandHome,
  gitCommonDir,
  isUntracked,
  resolveWorktreeEnv,
  applyLinks,
  excludeFromGit,
  checkDependsOn,
} from '../../plugins/orchestration/skills/multi-model/references/worktree-env.mjs'

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
  const root = mkdtempSync(join(tmpdir(), 'worktree-env-test-'))
  roots.push(root)
  const repo = join(root, 'repo')
  mkdirSync(repo, { recursive: true })
  git(repo, 'init')
  git(repo, 'config', 'user.name', 'Worktree Env Test')
  git(repo, 'config', 'user.email', 'worktree-env-test@example.invalid')
  git(repo, 'config', 'commit.gpgsign', 'false')
  writeFileSync(join(repo, 'README.md'), 'base\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-m', 'base')
  const base = git(repo, 'rev-parse', 'HEAD')
  return { root, repo, base }
}

// --- taskHeadingIds / malformedTaskHeadings -------------------------------

test('TASK_HEADING_SOURCE is exported as the raw source string', () => {
  assert.equal(typeof TASK_HEADING_SOURCE, 'string')
  assert.equal(TASK_HEADING_SOURCE, '^## Task ([a-z0-9-]+)[ \\t]*\\r?$')
})

test('taskHeadingIds: extracts ids from valid headings, ignores malformed ones', () => {
  const md = [
    '## Task a-b',
    'some body text',
    '## Task a-b — Title',
    '## Task A',
    '## Task solo-task',
  ].join('\n')
  assert.deepEqual(taskHeadingIds(md), ['a-b', 'solo-task'])
})

test('taskHeadingIds: handles CRLF line endings', () => {
  const md = '## Task a-b\r\nbody\r\n## Task c-d\r\n'
  assert.deepEqual(taskHeadingIds(md), ['a-b', 'c-d'])
})

test('malformedTaskHeadings: flags a heading with trailing title text and an uppercase id', () => {
  const md = [
    '## Task a-b',
    '## Task a-b — Title',
    '## Task A',
  ].join('\n')
  assert.deepEqual(malformedTaskHeadings(md), ['## Task a-b — Title', '## Task A'])
})

test('malformedTaskHeadings: a well-formed heading is not flagged, CRLF included', () => {
  const md = '## Task a-b\r\n## Task c-d\r\n'
  assert.deepEqual(malformedTaskHeadings(md), [])
})

// --- ENVIRONMENT_SIGNATURES / detectEnvironmentBlock ----------------------

test('detectEnvironmentBlock: android-sdk-missing', () => {
  const line = 'SDK location not found. Define a valid SDK location…'
  assert.deepEqual(detectEnvironmentBlock(line), { id: 'android-sdk-missing', line })
})

test('detectEnvironmentBlock: gradle-service', () => {
  const line = 'Could not create service of type ScriptPluginFactory'
  assert.deepEqual(detectEnvironmentBlock(line), { id: 'gradle-service', line })
})

test('detectEnvironmentBlock: git-lock wins over permission-denied when both match — order matters', () => {
  const line = "fatal: Unable to create '/r/.git/worktrees/w/index.lock': Operation not permitted"
  assert.deepEqual(detectEnvironmentBlock(line), { id: 'git-lock', line })
})

test('detectEnvironmentBlock: permission-denied on its own', () => {
  const line = 'touch: /Users/x/.gradle/x: Operation not permitted'
  assert.deepEqual(detectEnvironmentBlock(line), { id: 'permission-denied', line })
})

test('detectEnvironmentBlock: a clean build log returns null', () => {
  const log = ['BUILD SUCCESSFUL in 4s', '12 actionable tasks: 12 executed'].join('\n')
  assert.equal(detectEnvironmentBlock(log), null)
})

test('ENVIRONMENT_SIGNATURES: git-lock is ordered before permission-denied', () => {
  const gitLockIdx = ENVIRONMENT_SIGNATURES.findIndex((s) => s.id === 'git-lock')
  const permIdx = ENVIRONMENT_SIGNATURES.findIndex((s) => s.id === 'permission-denied')
  assert.ok(gitLockIdx >= 0 && permIdx >= 0 && gitLockIdx < permIdx)
})

// --- reportEnvironmentBlock -------------------------------------------------

test('ENVIRONMENT_BLOCKED_MARKER is the literal marker text', () => {
  assert.equal(ENVIRONMENT_BLOCKED_MARKER, 'environment-blocked:')
})

test('reportEnvironmentBlock: matches when the marker is the first line', () => {
  const report = ['`environment-blocked: git-lock — could not write .git/index.lock`', ''].join('\n')
  assert.deepEqual(reportEnvironmentBlock(report), { id: 'reported', line: 'git-lock — could not write .git/index.lock' })
})

test('reportEnvironmentBlock: marker on line 5 after prose returns null', () => {
  const report = ['Did the work.', 'Ran the tests.', 'Everything looked fine.', 'Committed.', '`environment-blocked: git-lock — could not write .git/index.lock`', ''].join('\n')
  assert.equal(reportEnvironmentBlock(report), null)
})

test('reportEnvironmentBlock: first line is verbatim README placeholder text, not a real block', () => {
  const report = ['`environment-blocked: <verbatim error line>`', 'rest of report'].join('\n')
  assert.equal(reportEnvironmentBlock(report), null)
})

test('reportEnvironmentBlock: leading blank lines then marker still matches', () => {
  const report = ['', '  ', '`environment-blocked: git-lock — could not write .git/index.lock`', ''].join('\n')
  assert.deepEqual(reportEnvironmentBlock(report), { id: 'reported', line: 'git-lock — could not write .git/index.lock' })
})

test('reportEnvironmentBlock: ignores prose that merely mentions the words mid-line', () => {
  const report = 'I checked and this does not look environment-blocked: it is a real bug.'
  assert.equal(reportEnvironmentBlock(report), null)
})

test('reportEnvironmentBlock: no marker anywhere returns null', () => {
  assert.equal(reportEnvironmentBlock('all good, nothing to report'), null)
})

// --- readPlanJson / INHERITED_KEYS / effectivePlan -------------------------

test('effectivePlan: inherits missing keys from the parent, keeps the child own keys', () => {
  const { root, repo } = makeRepo()
  const parentPath = join(root, 'parent.md')
  writeFileSync(parentPath, [
    '# Parent plan',
    '```json wave-plan',
    JSON.stringify({ ci: 'required', e2e: 'task-a', worktree: { auto: true }, approvals: ['premium'], review: 'high' }),
    '```',
    '',
  ].join('\n'))
  const childPath = join(root, 'child.md')
  writeFileSync(childPath, [
    '# Child plan',
    '```json wave-plan',
    JSON.stringify({ inherits: parentPath, ci: 'none' }),
    '```',
    '',
  ].join('\n'))
  const plan = effectivePlan(childPath, repo)
  assert.equal(plan.ci, 'none') // child's own key is kept, not overwritten
  assert.equal(plan.e2e, 'task-a') // inherited
  assert.deepEqual(plan.worktree, { auto: true }) // inherited
  assert.deepEqual(plan.approvals, ['premium']) // inherited
  assert.equal(plan.review, 'high') // inherited
  assert.deepEqual(INHERITED_KEYS, ['ci', 'e2e', 'worktree', 'approvals', 'review'])
})

test('effectivePlan: inherited e2e naming a task id outside the child\'s own waves becomes not-applicable', () => {
  const { root, repo } = makeRepo()
  const parentPath = join(root, 'parent.md')
  writeFileSync(parentPath, [
    '# Parent plan',
    '```json wave-plan',
    JSON.stringify({ waves: [], ci: 'required', e2e: { task: 'http-retry' } }),
    '```',
    '',
  ].join('\n'))
  const childPath = join(root, 'child.md')
  writeFileSync(childPath, [
    '# Child plan',
    '```json wave-plan',
    JSON.stringify({
      inherits: parentPath,
      ci: 'none: recovery',
      waves: [{ wave: 1, tasks: [{ id: 'patch-fix' }] }],
    }),
    '```',
    '',
  ].join('\n'))
  const plan = effectivePlan(childPath, repo)
  assert.equal(plan.e2e, 'not-applicable: inherited e2e task http-retry is not part of this recovery plan')
})

test('effectivePlan: inherited e2e naming one of the child\'s own task ids keeps full checking', () => {
  const { root, repo } = makeRepo()
  const parentPath = join(root, 'parent.md')
  writeFileSync(parentPath, [
    '# Parent plan',
    '```json wave-plan',
    JSON.stringify({ waves: [], ci: 'required', e2e: { task: 'http-retry' } }),
    '```',
    '',
  ].join('\n'))
  const childPath = join(root, 'child.md')
  writeFileSync(childPath, [
    '# Child plan',
    '```json wave-plan',
    JSON.stringify({
      inherits: parentPath,
      ci: 'none: recovery',
      waves: [{ wave: 1, tasks: [{ id: 'http-retry' }] }],
    }),
    '```',
    '',
  ].join('\n'))
  const plan = effectivePlan(childPath, repo)
  assert.deepEqual(plan.e2e, { task: 'http-retry' })
})

test('effectivePlan: a child that sets its own e2e is never rewritten, even when it names an id outside its waves', () => {
  const { root, repo } = makeRepo()
  const parentPath = join(root, 'parent.md')
  writeFileSync(parentPath, [
    '# Parent plan',
    '```json wave-plan',
    JSON.stringify({ waves: [], ci: 'required', e2e: { task: 'http-retry' } }),
    '```',
    '',
  ].join('\n'))
  const childPath = join(root, 'child.md')
  writeFileSync(childPath, [
    '# Child plan',
    '```json wave-plan',
    JSON.stringify({
      inherits: parentPath,
      ci: 'none: recovery',
      e2e: { task: 'not-a-real-task' },
      waves: [{ wave: 1, tasks: [{ id: 'patch-fix' }] }],
    }),
    '```',
    '',
  ].join('\n'))
  const plan = effectivePlan(childPath, repo)
  assert.deepEqual(plan.e2e, { task: 'not-a-real-task' })
})

test('readPlanJson: throws when the file has no wave-plan block', () => {
  const { root } = makeRepo()
  const p = join(root, 'no-plan.md')
  writeFileSync(p, '# nothing here\n')
  assert.throws(() => readPlanJson(p), /expected exactly one/)
})

// --- expandHome --------------------------------------------------------

test('expandHome: expands ~ and ~/ prefixes, leaves other paths untouched', () => {
  const abs = '/already/absolute'
  assert.equal(expandHome(abs), abs)
  assert.ok(expandHome('~').length > 0)
  assert.ok(expandHome('~/foo').endsWith(join('foo')))
})

// --- gitCommonDir / isUntracked ---------------------------------------------

test('gitCommonDir: returns the absolute .git directory for a plain repo', () => {
  const { repo } = makeRepo()
  const common = gitCommonDir(repo)
  assert.ok(existsSync(common))
  assert.ok(common.endsWith('.git'))
})

test('isUntracked: false for a tracked file, false for a missing file, true for an untracked one present on disk', () => {
  const { repo } = makeRepo()
  assert.equal(isUntracked(repo, 'README.md'), false)
  assert.equal(isUntracked(repo, 'does-not-exist.txt'), false)
  writeFileSync(join(repo, 'scratch.txt'), 'dummy\n')
  assert.equal(isUntracked(repo, 'scratch.txt'), true)
})

// --- resolveWorktreeEnv -----------------------------------------------------

test('resolveWorktreeEnv: gradlew + untracked local.properties yields the link; writable includes GRADLE_USER_HOME', () => {
  const { root, repo } = makeRepo()
  writeFileSync(join(repo, 'gradlew'), '#!/bin/sh\necho stub\n')
  writeFileSync(join(repo, '.gitignore'), 'local.properties\n')
  writeFileSync(join(repo, 'local.properties'), 'sdk.dir=/nonexistent\n')
  const gradleHome = join(root, 'gradle-home')
  mkdirSync(gradleHome, { recursive: true })
  const prevGradleHome = process.env.GRADLE_USER_HOME
  process.env.GRADLE_USER_HOME = gradleHome
  try {
    const env = resolveWorktreeEnv(repo, {})
    assert.deepEqual(env.links, ['local.properties'])
    assert.ok(env.writable.includes(gradleHome))
  } finally {
    if (prevGradleHome === undefined) delete process.env.GRADLE_USER_HOME
    else process.env.GRADLE_USER_HOME = prevGradleHome
  }
})

test('resolveWorktreeEnv: worktree.auto:false disables detection entirely', () => {
  const { repo } = makeRepo()
  writeFileSync(join(repo, 'gradlew'), '#!/bin/sh\necho stub\n')
  writeFileSync(join(repo, '.gitignore'), 'local.properties\n')
  writeFileSync(join(repo, 'local.properties'), 'sdk.dir=/nonexistent\n')
  const env = resolveWorktreeEnv(repo, { worktree: { auto: false } })
  assert.deepEqual(env.links, [])
  assert.deepEqual(env.auto, { links: [], writable: [] })
})

test('resolveWorktreeEnv: an explicit link containing ".." throws', () => {
  const { repo } = makeRepo()
  assert.throws(
    () => resolveWorktreeEnv(repo, { worktree: { links: ['../escape.txt'] } }),
    /without "\.\."/,
  )
})

// --- applyLinks --------------------------------------------------------

test('applyLinks: creates a symlink, verified via lstatSync, never by reading the file', () => {
  const { root, repo } = makeRepo()
  writeFileSync(join(repo, 'local.properties'), 'sdk.dir=/nonexistent\n')
  const checkout = join(root, 'checkout')
  mkdirSync(checkout, { recursive: true })
  const out = applyLinks(repo, checkout, ['local.properties'])
  assert.deepEqual(out.linked, ['local.properties'])
  assert.deepEqual(out.present, [])
  assert.deepEqual(out.missing, [])
  const st = lstatSync(join(checkout, 'local.properties'))
  assert.equal(st.isSymbolicLink(), true)
})

test('applyLinks: skips a destination that already exists, reports a missing source', () => {
  const { root, repo } = makeRepo()
  writeFileSync(join(repo, 'present.txt'), 'dummy\n')
  const checkout = join(root, 'checkout2')
  mkdirSync(checkout, { recursive: true })
  writeFileSync(join(checkout, 'present.txt'), 'already here\n')
  const out = applyLinks(repo, checkout, ['present.txt', 'missing.txt'])
  assert.deepEqual(out.linked, [])
  assert.deepEqual(out.present, ['present.txt'])
  assert.deepEqual(out.missing, ['missing.txt'])
})

// --- excludeFromGit ----------------------------------------------------

test('excludeFromGit: idempotent — a second call with the same entries adds nothing new', () => {
  const { repo } = makeRepo()
  const first = excludeFromGit(repo, ['local.properties', 'build/'])
  assert.deepEqual(first, ['local.properties', 'build/'])
  const excludePath = join(gitCommonDir(repo), 'info', 'exclude')
  const afterFirst = readFileSync(excludePath, 'utf8')
  assert.ok(afterFirst.includes('local.properties'))
  assert.ok(afterFirst.includes('build/'))

  const second = excludeFromGit(repo, ['local.properties', 'build/'])
  assert.deepEqual(second, [])
  const afterSecond = readFileSync(excludePath, 'utf8')
  assert.equal(afterSecond, afterFirst)

  const third = excludeFromGit(repo, ['local.properties', 'new-entry.txt'])
  assert.deepEqual(third, ['new-entry.txt'])
})

// --- checkDependsOn ------------------------------------------------------

test('checkDependsOn: a present path is not reported, a missing one is', () => {
  const { repo, base } = makeRepo()
  const plan = {
    depends_on: [
      { wave: 1, repo: '.', ref: base, path: 'README.md' },
      { wave: 1, repo: '.', ref: base, path: 'does-not-exist.txt' },
      { wave: 2, repo: '.', ref: base, path: 'does-not-exist-either.txt' },
    ],
  }
  const unmet = checkDependsOn(plan, 1, repo)
  assert.equal(unmet.length, 1)
  assert.equal(unmet[0].path, 'does-not-exist.txt')
  assert.ok(unmet[0].reason.includes('does-not-exist.txt is not present at'))
})
