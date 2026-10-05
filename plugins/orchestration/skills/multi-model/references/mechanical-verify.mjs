#!/usr/bin/env node
// Independent facts from committed artifacts. No model or credential-file reads.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, statSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { applyLinks, detectEnvironmentBlock } from './worktree-env.mjs'

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value

export function limitsErrors(limits) {
  if (limits === undefined) return []
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) return ['limits: object required']
  return Object.entries(limits).flatMap(([key, value]) => {
    const max = { max_attempts: 6, max_model_calls: 24 }[key]
    return !max || !Number.isInteger(value) || value < 1 || value > max
      ? ['limits.' + key + ': integer 1–' + (max || 'unsupported') + ' required'] : []
  })
}

export function supervisionErrors(task) {
  if (task.supervision === undefined || task.supervision === 'model') return []
  if (task.supervision !== 'mechanical') return ['supervision: model|mechanical required']
  const c = task.contract
  return !c || !Array.isArray(c.must_run) || c.must_run.length === 0
    || !Array.isArray(c.forbidden_moves) || c.forbidden_moves.length !== 0
    || !Array.isArray(c.report_must_answer) || c.report_must_answer.length !== 0
    ? ['supervision: mechanical requires must_run and no semantic forbidden_moves/report questions'] : []
}

function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 16 * 1024 * 1024 })
  if (r.status !== 0) throw new Error('verification-git: ' + (r.stderr || r.error?.message || args.join(' ')))
  return r.stdout.trim()
}

function linkMetadata(repo, links) {
  return links.map(path => {
    if (typeof path !== 'string' || path.startsWith('/') || path.split(/[\\/]/).includes('..')) {
      throw new Error('verification-link: repository-relative path required')
    }
    try {
      const s = statSync(join(repo, path))
      return [path, s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs, s.mode]
    } catch (e) { if (e.code === 'ENOENT') return [path, 'missing']; throw e }
  })
}

export function verifyPipeline({ repo, head, base, branch, contract, links = [], cache = [],
  environment = process.env, logDir, timeoutMs = 30 * 60 * 1000, retryFailures = true }) {
  const pinnedHead = git(repo, ['rev-parse', '--verify', head + '^{commit}'])
  const key = digest(canonical({ repo: realpathSync(resolve(repo, git(repo, ['rev-parse', '--git-common-dir']))), head: pinnedHead,
    base, branch, contract, environment, platform: process.platform, arch: process.arch,
    node: process.version, links: linkMetadata(repo, links), verifier: 1 }))
  const entries = contract.must_run
  const reusable = entries.length > 0 && entries.every(e => e.cache === 'artifact')
  const previous = reusable && cache.find(f => f.verification?.key === key
    && f.verification.head === pinnedHead && f.mustRun?.length === entries.length
    && f.mustRun.every((m, i) => m.cmd === entries[i].cmd && m.evidence === entries[i].evidence
      && m.attempts?.length === 1 && m.attempts[0].exit === 0 && !m.attempts[0].error))
  if (previous) return { verification: { key, head: pinnedHead, reused: true },
    mustRun: structuredClone(previous.mustRun) }

  const mustRun = entries.map(e => ({ cmd: e.cmd, evidence: e.evidence, attempts: [] }))
  if (logDir) mkdirSync(logDir, { recursive: true })
  for (let attempt = 1; attempt <= (retryFailures ? 2 : 1) && entries.length > 0; attempt++) {
    const root = mkdtempSync(join(tmpdir(), 'wave-verify-'))
    const checkout = join(root, 'checkout')
    let created = false
    try {
      git(repo, ['worktree', 'add', '--detach', checkout, pinnedHead]); created = true
      applyLinks(repo, checkout, links)
      for (let i = 0; i < entries.length; i++) {
        // Own the process group. The trap runs while bash waits and kills
        // descendants too, so timed-out builds cannot keep writing afterward.
        const r = spawnSync('bash', ['-c', 'trap \'kill -KILL -- -$$\' TERM; bash -c "$1" & wait $!',
          'wave-check', entries[i].cmd], { cwd: checkout, encoding: 'utf8', detached: true,
          timeout: timeoutMs, killSignal: 'SIGTERM', maxBuffer: 16 * 1024 * 1024 })
        const stdout = r.stdout || '', stderr = r.stderr || ''
        const compact = (text, stream) => {
          if (!logDir) return text
          const path = join(logDir, 'attempt-' + attempt + '-command-' + (i + 1) + '.' + stream)
          writeFileSync(path, text, { mode: 0o600 })
          const block = detectEnvironmentBlock(text)
          return text.length <= 12000 ? text : '[full output: ' + path + ']\n'
            + (block ? block.line + '\n' : '') + text.slice(-12000)
        }
        mustRun[i].attempts.push({ exit: r.status, stdout: compact(stdout, 'stdout'),
          stderr: compact(stderr, 'stderr'), ...(r.error ? { error: r.error.code || r.error.message } : {}) })
      }
    } finally {
      try { if (created) git(repo, ['worktree', 'remove', '--force', checkout]) }
      finally { rmSync(root, { recursive: true, force: true }) }
    }
    if (mustRun.every(m => m.attempts.at(-1).exit === 0)) break
  }
  return { verification: { key, head: pinnedHead, reused: false }, mustRun }
}

export function verifyBranch(options) {
  const { repo, branch, base, contract, report = '' } = options
  git(repo, ['check-ref-format', '--branch', branch])
  const head = git(repo, ['rev-parse', '--verify', 'refs/heads/' + branch + '^{commit}'])
  git(repo, ['merge-base', '--is-ancestor', base, head])
  const blocks = git(repo, ['worktree', 'list', '--porcelain']).split('\n\n')
  const block = blocks.find(b => b.split('\n').includes('branch refs/heads/' + branch))
  if (block) {
    const checkout = block.split('\n').find(l => l.startsWith('worktree ')).slice(9)
    if (git(checkout, ['status', '--porcelain', '--untracked-files=all']) !== '') {
      throw new Error('verification-worktree: task checkout must be clean')
    }
  }
  const filesChanged = git(repo, ['diff', '--name-only', base + '..' + head]).split('\n').filter(Boolean)
  const match = (path, patterns) => patterns.some(pattern => {
    let re = ''
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i]
      if (c === '*' && pattern[i + 1] === '*') { re += '.*'; i++ }
      else if (c === '*') re += '[^/]*'
      else if (c === '?') re += '[^/]'
      else re += c.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
    }
    return new RegExp('^' + re + '$').test(path)
  })
  const forbiddenPaths = filesChanged.filter(path => !match(path, contract.files_allowed) || match(path, contract.files_forbidden))
  const result = verifyPipeline({ ...options, head })
  const mustRun = result.mustRun.map(m => {
    const final = m.attempts.at(-1)
    const output = final.stdout + final.stderr
    return { cmd: m.cmd, exit: final.exit, output,
      pasteFoundInReport: output.trim() === '' || output.split('\n').some(l => l.length >= 2 && report.includes(l)),
      ...(final.error ? { error: final.error } : {}) }
  })
  const env = mustRun.filter(m => m.exit !== 0).map(m => detectEnvironmentBlock(m.output)).find(Boolean)
  return { branchHasCommits: Number(git(repo, ['rev-list', '--count', base + '..' + head])) > 0,
    filesChanged, forbiddenPaths, mustRun, notes: [], verification: result.verification,
    pipeline: result, ...(env ? { environmentBlocked: env.line } : {}) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 6 || process.argv[2] !== '--request' || process.argv[4] !== '--output') {
      throw new Error('usage: node mechanical-verify.mjs --request <json> --output <json>')
    }
    const options = JSON.parse(readFileSync(process.argv[3], 'utf8'))
    const facts = options.pipelineOnly ? verifyPipeline(options) : verifyBranch(options)
    writeFileSync(process.argv[5], JSON.stringify(facts), { mode: 0o600 })
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1 }
}
