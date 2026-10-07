#!/usr/bin/env node
// Removes what a wave left behind — task worktrees, `wave/<id>` branches and,
// on request, run records — and only what is provably safe to remove: a
// branch must be proven integrated into the target and its worktree clean.
// Anything not proven is kept and listed with the reason. Host-neutral: no
// model, no network, nothing outside <repo>/.worktrees.
import { spawnSync } from 'node:child_process'
import { lstatSync, readFileSync, readdirSync, realpathSync, rmSync, rmdirSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { readPlanJson } from './worktree-env.mjs'

const USAGE = [
  'node wave-cleanup.mjs --repo <abs> --plan <file> [--plan <file> ...]',
  '                      [--wave <n>] [--into <ref>] [--branch <name>]',
  '                      [--records] [--dry-run]',
  'node wave-cleanup.mjs --help',
  '',
  '  --repo <abs>     main checkout, the top level of a git work tree',
  '  --plan <file>    wave plan; repeatable, the task ids are the union',
  '  --wave <n>       only the tasks of wave <n> (with exactly one --plan)',
  '  --into <ref>     integration target (default HEAD of --repo)',
  '  --branch <name>  also delete this local branch when it is integrated',
  '  --records        also remove the run records of the given plans',
  '  --dry-run        run every check, change nothing',
  '',
  'Prints one JSON object: { into, dryRun, removed, kept }.',
  'Exit 0: completed (kept entries are not an error); 1: a removal command',
  'failed; 2: usage error, nothing changed.',
].join('\n')

const SINGLE = ['repo', 'wave', 'into', 'branch']
const SWITCHES = ['records', 'dry-run']
const RUNNER_DIRS = ['claude-runner', 'codex-runner']
const STATE_DIR = 'codex-wave'
// A task id becomes a path segment and a ref segment; anything else is a
// malformed plan, never a path to act on.
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

class UsageError extends Error {}

function oneLine(text) {
  return String(text).split(/\r?\n/).map((s) => s.trim()).filter(Boolean).join(' ')
}

// Repository-selecting variables would silently point every check below at a
// different repository than --repo.
const GIT_ENV = { ...process.env }
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY']) {
  delete GIT_ENV[key]
}

function git(cwd, ...args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: GIT_ENV })
  return {
    ok: r.status === 0,
    out: (r.stdout || '').trim(),
    error: oneLine(r.stderr || (r.error && r.error.message) || '') || 'git ' + args[0] + ' failed',
  }
}

function lstat(path) {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}

function real(path) {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function parseArgs(argv) {
  const options = { plan: [] }
  if (argv.includes('--help')) return { help: true }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const name = arg.startsWith('--') ? arg.slice(2) : ''
    if (SWITCHES.includes(name)) {
      options[name] = true
      continue
    }
    if (name !== 'plan' && !SINGLE.includes(name)) throw new UsageError('unknown argument: ' + arg)
    const value = argv[i + 1]
    if (value === undefined || value.startsWith('--')) throw new UsageError(arg + ' needs a value')
    i += 1
    if (name === 'plan') {
      options.plan.push(value)
      continue
    }
    if (name in options) throw new UsageError(arg + ' given more than once')
    options[name] = value
  }
  if (options.repo === undefined) throw new UsageError('missing --repo')
  if (options.plan.length === 0) throw new UsageError('missing --plan')
  if (!isAbsolute(options.repo)) throw new UsageError('--repo: absolute path required')
  if (options.wave !== undefined && options.plan.length !== 1) {
    throw new UsageError('--wave is allowed only with exactly one --plan')
  }
  return options
}

function readWaves(planPath) {
  let plan
  try {
    plan = readPlanJson(planPath)
  } catch (error) {
    throw new UsageError('cannot read plan ' + planPath + ': ' + error.message)
  }
  const bad = (what) => new UsageError('malformed plan ' + planPath + ': ' + what)
  if (plan === null || typeof plan !== 'object' || !Array.isArray(plan.waves)) throw bad('`waves` must be an array')
  for (const wave of plan.waves) {
    if (wave === null || typeof wave !== 'object' || !Array.isArray(wave.tasks)) {
      throw bad('every wave needs a `tasks` array')
    }
    for (const task of wave.tasks) {
      if (task === null || typeof task !== 'object' || typeof task.id !== 'string' || !TASK_ID.test(task.id)) {
        throw bad('every task needs a string `id` of letters, digits, ".", "_" and "-"')
      }
    }
  }
  return plan.waves
}

function unique(ids) {
  return [...new Set(ids)]
}

function fail(message) {
  process.stderr.write('wave-cleanup: ' + oneLine(message) + '\n')
  process.exit(2)
}

// ---- everything up to `main` validates; nothing is changed before it ----

let options
let repo
let planIds
let taskIds
let into
let intoTree
try {
  options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    process.exit(0)
  }
  repo = resolve(options.repo)
  const top = git(repo, 'rev-parse', '--show-toplevel')
  if (!top.ok || real(top.out) !== real(repo)) throw new UsageError('--repo is not the top level of a git work tree: ' + repo)

  const plans = options.plan.map(readWaves)
  planIds = unique(plans.flat().flatMap((wave) => wave.tasks.map((task) => task.id)))
  taskIds = planIds
  if (options.wave !== undefined) {
    const waves = plans[0].filter((wave) => String(wave.wave) === options.wave)
    if (waves.length === 0) throw new UsageError('--wave ' + options.wave + ' names no wave of ' + options.plan[0])
    taskIds = unique(waves.flatMap((wave) => wave.tasks.map((task) => task.id)))
  }

  options.into ??= 'HEAD'
  const commit = git(repo, 'rev-parse', '--verify', '--quiet', '--end-of-options', options.into + '^{commit}')
  if (!commit.ok || !/^[0-9a-f]{40,64}$/.test(commit.out)) {
    throw new UsageError('--into does not resolve to a commit: ' + options.into)
  }
  into = commit.out
  const tree = git(repo, 'rev-parse', '--verify', '--quiet', into + '^{tree}')
  if (!tree.ok) throw new UsageError('--into does not resolve to a commit: ' + options.into)
  intoTree = tree.out
} catch (error) {
  if (error instanceof UsageError) fail(error.message)
  throw error
}

const dryRun = options['dry-run'] === true
const worktreesDir = join(repo, '.worktrees')
const removed = []
const kept = []
let removalFailed = false

function branchTip(name) {
  const r = git(repo, 'show-ref', '--verify', '--hash', 'refs/heads/' + name)
  return r.ok && /^[0-9a-f]{40,64}$/.test(r.out) ? r.out : null
}

// Integrated: the tip is already an ancestor of the target, or merging it
// into the target would produce exactly the target's tree (a squash). Every
// other outcome — a conflict, an error, a git without merge-tree
// --write-tree — is "not proven" and reads as false.
function integrated(tip) {
  if (git(repo, 'merge-base', '--is-ancestor', tip, into).ok) return true
  const merged = git(repo, 'merge-tree', '--write-tree', into, tip)
  return merged.ok && merged.out.split('\n')[0].trim() === intoTree
}

function isRepoWorktree(path, stat) {
  if (!stat.isDirectory()) return false
  const top = git(path, 'rev-parse', '--show-toplevel')
  if (!top.ok || real(top.out) !== real(path)) return false
  const own = git(path, 'rev-parse', '--path-format=absolute', '--git-common-dir')
  const main = git(repo, 'rev-parse', '--path-format=absolute', '--git-common-dir')
  return own.ok && main.ok && real(own.out) === real(main.out)
}

// Step A. `left` records, per task, whether a branch or a worktree remains
// after this step (in a dry run: would remain) — step C decides on that.
const left = new Map()

function cleanTask(id) {
  const branch = 'wave/' + id
  const path = join(worktreesDir, 'wave-' + id)
  const tip = branchTip(branch)
  const stat = lstat(path)
  left.set(id, tip !== null || stat !== null)
  if (tip === null && stat === null) return

  const keep = (reason, branchReason = reason) => {
    if (stat !== null) kept.push({ kind: 'worktree', task: id, path, reason })
    if (tip !== null) kept.push({ kind: 'branch', task: id, branch, reason: branchReason })
  }

  if (tip !== null && !integrated(tip)) return keep('not integrated into ' + options.into)
  if (stat !== null) {
    if (!isRepoWorktree(path, stat)) return keep('not a git worktree')
    if (tip === null) return keep('no ' + branch + ' branch')
    const head = git(path, 'rev-parse', '--verify', '--quiet', 'HEAD^{commit}')
    if (!head.ok || head.out !== tip) return keep('worktree HEAD differs from ' + branch)
    const status = git(path, 'status', '--porcelain', '--untracked-files=all')
    if (!status.ok) return keep(status.error)
    if (status.out !== '') return keep('uncommitted changes')

    // --force is safe only because every check above passed.
    if (!dryRun) {
      const gone = git(repo, 'worktree', 'remove', '--force', path)
      if (!gone.ok) {
        removalFailed = true
        return keep(gone.error)
      }
    }
    removed.push({ kind: 'worktree', task: id, path })
  }
  if (!dryRun) {
    const gone = git(repo, 'branch', '-D', branch)
    if (!gone.ok) {
      removalFailed = true
      kept.push({ kind: 'branch', task: id, branch, reason: gone.error })
      return
    }
  }
  removed.push({ kind: 'branch', task: id, branch, tip })
  left.set(id, false)
}

function checkedOutIn(name) {
  const list = git(repo, 'worktree', 'list', '--porcelain')
  if (!list.ok) return { error: list.error }
  let path = null
  for (const line of list.out.split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice('worktree '.length)
    else if (line === 'branch refs/heads/' + name) return { path }
  }
  return {}
}

// Step B.
function cleanBranch(name) {
  if (taskIds.some((id) => 'wave/' + id === name)) return // step A decided it
  const tip = branchTip(name)
  if (tip === null) return
  const keep = (reason) => kept.push({ kind: 'branch', branch: name, reason })
  const where = checkedOutIn(name)
  if (where.error !== undefined) return keep(where.error)
  if (where.path !== undefined) return keep('checked out in ' + where.path)
  if (!integrated(tip)) return keep('not integrated into ' + options.into)
  if (!dryRun) {
    const gone = git(repo, 'branch', '-D', name)
    if (!gone.ok) {
      removalFailed = true
      return keep(gone.error)
    }
  }
  removed.push({ kind: 'branch', branch: name, tip })
}

function readJson(path) {
  const stat = lstat(path)
  if (stat === null || !stat.isFile()) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function stillLeft(id) {
  if (!left.has(id)) {
    left.set(id, branchTip('wave/' + id) !== null || lstat(join(worktreesDir, 'wave-' + id)) !== null)
  }
  return left.get(id)
}

function children(dir) {
  try {
    return readdirSync(dir).sort()
  } catch {
    return []
  }
}

// One run record or state file: `ids` is null when it is not this plan's.
function cleanRecord(kind, path, ids, remove) {
  const keep = (reason) => kept.push({ kind, path, reason })
  if (ids === null || ids.length === 0 || !ids.every((id) => typeof id === 'string' && planIds.includes(id))) {
    return keep('not a run record of the given plans')
  }
  const busy = ids.find(stillLeft)
  if (busy !== undefined) return keep('task ' + busy + ' still has a branch or worktree')
  if (!dryRun) {
    try {
      remove(path)
    } catch (error) {
      removalFailed = true
      return keep(oneLine(error.message))
    }
  }
  removed.push({ kind, path })
}

function summaryIds(dir) {
  const summary = readJson(join(dir, 'summary.json'))
  if (summary === null || typeof summary !== 'object' || !Array.isArray(summary.tasks)) return null
  return summary.tasks.map((task) => (task !== null && typeof task === 'object' ? task.id : undefined))
}

function stateIds(file) {
  const state = readJson(file)
  if (state === null || typeof state !== 'object' || typeof state.repoPath !== 'string') return null
  if (state.tasks === null || typeof state.tasks !== 'object' || Array.isArray(state.tasks)) return null
  if (!isAbsolute(state.repoPath) || real(state.repoPath) !== real(repo)) return null
  return Object.keys(state.tasks)
}

const UNRECOGNIZED = 'not recognized as a run record of the given plans'

// Step C.
function cleanRecords() {
  const root = lstat(worktreesDir)
  if (root === null) return
  if (root.isSymbolicLink()) return kept.push({ kind: 'other', path: worktreesDir, reason: 'symbolic link' })
  if (!root.isDirectory()) return

  const known = new Set([...RUNNER_DIRS, STATE_DIR, ...taskIds.map((id) => 'wave-' + id)])
  for (const name of [...RUNNER_DIRS, STATE_DIR]) {
    const dir = join(worktreesDir, name)
    const stat = lstat(dir)
    if (stat === null) continue
    if (stat.isSymbolicLink()) {
      kept.push({ kind: 'other', path: dir, reason: 'symbolic link' })
      continue
    }
    if (!stat.isDirectory()) {
      kept.push({ kind: 'other', path: dir, reason: UNRECOGNIZED })
      continue
    }
    const isState = name === STATE_DIR
    const kind = isState ? 'state' : 'record'
    for (const child of children(dir)) {
      const path = join(dir, child)
      const childStat = lstat(path)
      if (childStat === null) continue
      if (isState && !child.endsWith('.json')) kept.push({ kind: 'other', path, reason: UNRECOGNIZED })
      else if (childStat.isSymbolicLink()) kept.push({ kind, path, reason: 'symbolic link' })
      else if (isState) cleanRecord(kind, path, stateIds(path), (file) => rmSync(file))
      else {
        cleanRecord(kind, path, childStat.isDirectory() ? summaryIds(path) : null,
          (target) => rmSync(target, { recursive: true }))
      }
    }
  }
  for (const child of children(worktreesDir)) {
    if (!known.has(child)) kept.push({ kind: 'other', path: join(worktreesDir, child), reason: UNRECOGNIZED })
  }
  if (dryRun) return
  for (const dir of [...RUNNER_DIRS, STATE_DIR].map((name) => join(worktreesDir, name)).concat(worktreesDir)) {
    const stat = lstat(dir)
    if (stat === null || !stat.isDirectory() || children(dir).length > 0) continue
    try {
      rmdirSync(dir)
    } catch {
      // Not empty after all (a concurrent writer): leaving it is the safe outcome.
    }
  }
}

for (const id of taskIds) cleanTask(id)
if (options.branch !== undefined) cleanBranch(options.branch)
if (options.records) cleanRecords()

console.log(JSON.stringify({ into, dryRun, removed, kept }, null, 2))
process.exit(removalFailed ? 1 : 0)
