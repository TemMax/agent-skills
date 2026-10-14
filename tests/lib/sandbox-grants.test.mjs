// Which directories a Codex sandbox may be opened to: the path rules alone,
// on a throwaway home directory.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deniedPaths, grantFor, grantsFromOutput, programDirs, reportBlockedCommand, reproductionEnv } from
  '../../plugins/orchestration/skills/multi-model/references/sandbox-grants.mjs'

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'sandbox-grants-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const home = join(root, 'home')
  for (const d of ['.ssh', '.codex', '.konan', '.m2/repository', 'Library/Application Support/kotlin',
    'Library/Keychains', '.local/share/mise/shims', '.local/share/nvim/lazy/plugin/.git', '.dotfiles/objects',
    '.dotfiles/refs', 'Developer/repo', '.agent-runs/w1']) mkdirSync(join(home, d), { recursive: true })
  writeFileSync(join(home, '.dotfiles', 'HEAD'), 'ref: refs/heads/main\n')
  const ctx = { home, excluded: [join(home, 'Developer/repo'), join(home, '.agent-runs/w1')],
    pathDirs: [join(home, '.local/share/mise/shims'), '/usr/bin'] }
  return { root, home, ctx }
}

test('tool directories under the home directory are opened', (t) => {
  const { home, ctx } = fixture(t)
  assert.equal(grantFor(join(home, '.konan/x/y'), ctx).rel, '~/.konan')
  assert.equal(grantFor(join(home, '.m2/repository/a.jar'), ctx).rel, '~/.m2')
  assert.equal(grantFor(join(home, 'Library/Application Support/kotlin/daemon/run.lock'), ctx).rel,
    '~/Library/Application Support/kotlin')
})

test('letter case does not get past the protected list or the excluded paths', (t) => {
  const { home, ctx } = fixture(t)
  for (const p of ['.SSH/authorized_keys', '.CODEX/config.toml', '.Codex/x', 'library/keychains/login',
    'Library/Application Support/CLAUDE/x', '.ZSHRC']) {
    assert.ok(grantFor(join(home, p), ctx).refused, p)
  }
  assert.ok(grantFor(join(home, '.AGENT-RUNS/w1/state.json'), ctx).refused, 'the run directory')
})

test('directories holding programs on PATH, git repositories and shell start-up files are refused', (t) => {
  const { home, ctx } = fixture(t)
  assert.equal(grantFor(join(home, '.local/share/mise/installs/x'), ctx).refused, 'holds programs on PATH')
  assert.ok(grantFor(join(home, '.local/share/nvim/x'), ctx).refused)
  assert.equal(grantFor(join(home, '.dotfiles/x'), ctx).refused, 'a git repository or holds one')
  for (const p of ['.bashrc', '.config/autostart/x.desktop', '.local/bin/git', '.cursor/x', '.gemini/x']) {
    assert.ok(grantFor(join(home, p), ctx).refused, p)
  }
  assert.ok(grantFor(join(home, 'Documents/x'), ctx).refused)
  assert.ok(grantFor(join(home, '../elsewhere/x'), ctx).refused)
})

test('a symlinked tool directory pointing at a protected one is refused', (t) => {
  const { home, ctx } = fixture(t)
  symlinkSync(join(home, '.ssh'), join(home, '.innocent'))
  assert.ok(grantFor(join(home, '.innocent/known_hosts'), ctx).refused)
})

test('denials are found in any letter case and from npm and Go wording', (t) => {
  const { home } = fixture(t)
  const out = ["Error: EPERM: operation not permitted, mkdir '" + home + "/.npm/_cacache'",
    'npm ERR! code EACCES permission denied ' + home + '/.npm-global/x',
    'mkdir ' + home + '/Library/Caches/go-build/aa: operation not permitted'].join('\n')
  assert.deepEqual(deniedPaths(out, home).map((p) => p.slice(home.length)),
    ['/.npm/_cacache', '/.npm-global/x', '/Library/Caches/go-build/aa'])
})

test('nothing is created unless creation is asked for; an open directory is not opened twice', (t) => {
  const { home, ctx } = fixture(t)
  const out = 'mkdir: ' + home + '/.newtool/x: Operation not permitted\nmkdir: ' + home + '/.konan/y: Operation not permitted'
  const none = grantsFromOutput(out, { ...ctx, writable: [join(home, '.KONAN')] })
  assert.deepEqual(none.granted, [])
  assert.equal(existsSync(join(home, '.newtool')), false)
  const made = grantsFromOutput(out, { ...ctx, writable: [], create: true })
  assert.deepEqual(made.granted.map((g) => g.rel), ['~/.newtool', '~/.konan'])
  assert.ok(existsSync(join(home, '.newtool')))
})

test('the blocked command is read from the report; backticks around it are dropped, inside it refused', () => {
  const r = (line) => reportBlockedCommand('environment-blocked: x\n' + line)
  assert.equal(r('blocked-command: `sh tools/gen.sh`'), 'sh tools/gen.sh')
  assert.equal(r('`blocked-command: sh tools/gen.sh`'), 'sh tools/gen.sh')
  assert.equal(r('blocked-command: <the exact command that failed>'), null)
  assert.equal(r('blocked-command: echo `id`'), null)
})

test('a reproduction runs without the variables a Codex shell leaves out', () => {
  assert.deepEqual(Object.keys(reproductionEnv({ PATH: '/bin', OPENAI_API_KEY: 'x', GH_TOKEN: 'y', HOME: '/h', AWS_SECRET_ACCESS_KEY: 'z' })),
    ['PATH', 'HOME'])
})

test('programs linked from a PATH directory, and a PATH entry written with ~, protect their directories', (t) => {
  const { home } = fixture(t)
  mkdirSync(join(home, '.local/share/tool/versions/1'), { recursive: true })
  writeFileSync(join(home, '.local/share/tool/versions/1/tool'), '#!/bin/sh\n')
  mkdirSync(join(home, 'bin'))
  symlinkSync(join(home, '.local/share/tool/versions/1/tool'), join(home, 'bin/tool'))
  mkdirSync(join(home, '.mise/shims'), { recursive: true })
  const pathDirs = programDirs([join(home, 'bin'), '~/.mise/shims'], home)
  const ctx = { home, excluded: [], pathDirs }
  assert.equal(grantFor(join(home, '.local/share/tool/cache'), ctx).refused, 'holds programs on PATH')
  assert.equal(grantFor(join(home, '.mise/cache'), ctx).refused, 'holds programs on PATH')
})

test('a .git segment is refused anywhere, and a repository inside a cache container is a cache', (t) => {
  const { home, ctx } = fixture(t)
  assert.equal(grantFor(join(home, '.git/hooks/x'), ctx).refused, 'a git directory')
  assert.equal(grantFor(join(home, '.cache/.git/x'), ctx).refused, 'a git directory')
  mkdirSync(join(home, 'Library/Caches/org.swift.swiftpm/repositories/dep/.git'), { recursive: true })
  assert.equal(grantFor(join(home, 'Library/Caches/org.swift.swiftpm/x'), ctx).rel, '~/Library/Caches/org.swift.swiftpm')
})

test('a named command with a control character is refused', () => {
  assert.equal(reportBlockedCommand('environment-blocked: x\nblocked-command: sh a.sh\u0000b'), null)
})
