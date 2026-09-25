// Shared worktree environment for the wave runners and the plan linter:
// which untracked files a fresh worktree links, which cache directories a
// sandboxed Codex child may write, which output means "the machine, not the
// work, failed", and the one `## Task <id>` heading rule every parser uses.
// Nothing here reads the content of a linked file.
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'

export const TASK_HEADING_SOURCE = '^## Task ([a-z0-9-]+)[ \\t]*\\r?$'

export function taskHeadingIds(markdown) {
  return [...markdown.matchAll(new RegExp(TASK_HEADING_SOURCE, 'gm'))].map((m) => m[1])
}

export function malformedTaskHeadings(markdown) {
  const good = new RegExp(TASK_HEADING_SOURCE)
  return markdown.split('\n').map((line) => line.replace(/\r$/, ''))
    .filter((line) => /^## Task\b/.test(line) && !good.test(line))
}

// Ordered: the first signature that matches names the block.
export const ENVIRONMENT_SIGNATURES = [
  { id: 'android-sdk-missing', re: /SDK location not found/ },
  { id: 'gradle-service', re: /Could not create service of type/ },
  { id: 'git-lock', re: /Unable to create '[^']*\.lock'/ },
  { id: 'git-ref-lock', re: /cannot lock ref/ },
  { id: 'git-object-write', re: /unable to create directory|insufficient permission for adding an object/ },
  { id: 'commit-signing', re: /failed to write commit object|gpg failed to sign the data/ },
  { id: 'read-only-fs', re: /Read-only file system/ },
  { id: 'permission-denied', re: /Operation not permitted/ },
]

export function detectEnvironmentBlock(text) {
  const lines = String(text ?? '').split(/\r?\n/)
  for (const sig of ENVIRONMENT_SIGNATURES) {
    const line = lines.find((l) => sig.re.test(l))
    if (line !== undefined) return { id: sig.id, line: line.trim().slice(0, 300) }
  }
  return null
}

export const ENVIRONMENT_BLOCKED_MARKER = 'environment-blocked:'

// The marker counts only when it is the first non-empty line of the
// report, optionally wrapped in backticks, and its text after the colon is
// non-empty and not a `<placeholder>` in angle brackets. This avoids
// matching pasted-in prose (e.g. README text) that mentions the marker
// mid-report without the executor actually hitting an environment block.
export function reportEnvironmentBlock(report) {
  const lines = String(report ?? '').split(/\r?\n/)
  const firstNonEmpty = lines.find((l) => l.trim() !== '')
  if (firstNonEmpty === undefined) return null
  const m = /^`?environment-blocked:[ \t]*(.*?)`?$/.exec(firstNonEmpty.trim())
  if (!m) return null
  const line = m[1].trim()
  if (line === '' || line.startsWith('<')) return null
  return { id: 'reported', line: line.slice(0, 300) }
}

export function readPlanJson(planPath) {
  const text = readFileSync(planPath, 'utf8')
  const blocks = [...text.matchAll(/```json wave-plan\r?\n([\s\S]*?)\r?\n```/g)]
  if (blocks.length !== 1) {
    throw new Error('expected exactly one ```json wave-plan block in ' + planPath + ', found ' + blocks.length)
  }
  return JSON.parse(blocks[0][1])
}

export const INHERITED_KEYS = ['ci', 'e2e', 'worktree', 'approvals', 'review']

// Task ids declared by this plan's own `waves` — never the parent's, even
// after inheritance is applied. Used to tell whether an inherited e2e.task
// still names something that exists in the child.
function ownTaskIds(plan) {
  return (Array.isArray(plan.waves) ? plan.waves : [])
    .flatMap((w) => (w && typeof w === 'object' && Array.isArray(w.tasks) ? w.tasks : []))
    .filter((t) => t && typeof t === 'object' && typeof t.id === 'string')
    .map((t) => t.id)
}

export function effectivePlan(planPath, repo) {
  const plan = readPlanJson(planPath)
  if (typeof plan.inherits === 'string') {
    const parentPath = isAbsolute(plan.inherits) ? plan.inherits : resolve(repo, plan.inherits)
    const parent = readPlanJson(parentPath)
    const childOmittedE2e = plan.e2e === undefined
    for (const key of INHERITED_KEYS) {
      if (plan[key] === undefined && parent[key] !== undefined) plan[key] = parent[key]
    }
    // An inherited e2e naming a task id is naming one of the PARENT's task
    // ids — a recovery plan's own waves rarely include it. That is not an
    // error; the parent's e2e task simply isn't part of this recovery.
    if (childOmittedE2e && plan.e2e && typeof plan.e2e === 'object' && !Array.isArray(plan.e2e)
      && typeof plan.e2e.task === 'string' && !ownTaskIds(plan).includes(plan.e2e.task)) {
      plan.e2e = 'not-applicable: inherited e2e task ' + plan.e2e.task + ' is not part of this recovery plan'
    }
  }
  return plan
}

export function expandHome(p) {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

export function gitCommonDir(repo) {
  const r = spawnSync('git', ['-C', repo, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('git rev-parse --git-common-dir failed in ' + repo + ': ' + (r.stderr || '').trim())
  return r.stdout.trim()
}

export function isUntracked(repo, rel) {
  if (!existsSync(join(repo, rel))) return false
  const r = spawnSync('git', ['-C', repo, 'ls-files', '--error-unmatch', '--', rel], { encoding: 'utf8' })
  return r.status !== 0
}

function assertRelative(rel) {
  if (typeof rel !== 'string' || rel === '' || isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) {
    throw new Error('worktree link must be a repository-relative path without "..": ' + JSON.stringify(rel))
  }
}

export function resolveWorktreeEnv(repo, plan) {
  const w = plan && typeof plan.worktree === 'object' && plan.worktree !== null ? plan.worktree : {}
  const explicitLinks = Array.isArray(w.links) ? w.links : []
  explicitLinks.forEach(assertRelative)
  const explicitWritable = (Array.isArray(w.writable) ? w.writable : []).map(expandHome)
  const auto = { links: [], writable: [] }
  if (w.auto !== false) {
    if (existsSync(join(repo, 'gradlew'))) {
      auto.writable.push(process.env.GRADLE_USER_HOME || join(homedir(), '.gradle'), join(homedir(), '.android'))
      if (isUntracked(repo, 'local.properties')) auto.links.push('local.properties')
    }
    if (existsSync(join(repo, 'Cargo.toml'))) {
      auto.writable.push(process.env.CARGO_HOME || join(homedir(), '.cargo'))
    }
  }
  const uniq = (xs) => [...new Set(xs)]
  const allWritable = uniq([...explicitWritable, ...auto.writable])
  return {
    links: uniq([...explicitLinks, ...auto.links]),
    writable: allWritable.filter((d) => existsSync(d)),
    missingWritable: allWritable.filter((d) => !existsSync(d)),
    auto,
  }
}

export function applyLinks(repo, checkout, links) {
  const out = { linked: [], present: [], missing: [] }
  for (const rel of links) {
    assertRelative(rel)
    const src = join(repo, rel)
    const dst = join(checkout, rel)
    if (!existsSync(src)) { out.missing.push(rel); continue }
    let present = false
    try { lstatSync(dst); present = true } catch { present = false }
    if (present) { out.present.push(rel); continue }
    mkdirSync(dirname(dst), { recursive: true })
    symlinkSync(src, dst)
    out.linked.push(rel)
  }
  return out
}

// Keeps runner-made directories and linked files out of every worktree's
// `git status` — info/exclude lives in the common dir, so it covers all
// linked worktrees at once.
export function excludeFromGit(repo, entries) {
  const excludePath = join(gitCommonDir(repo), 'info', 'exclude')
  mkdirSync(dirname(excludePath), { recursive: true })
  const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : ''
  const have = new Set(current.split(/\r?\n/))
  const add = entries.filter((e) => !have.has(e))
  if (add.length > 0) {
    appendFileSync(excludePath, (current === '' || current.endsWith('\n') ? '' : '\n') + add.join('\n') + '\n')
  }
  return add
}

export function checkDependsOn(plan, wave, repo) {
  const unmet = []
  for (const d of Array.isArray(plan.depends_on) ? plan.depends_on : []) {
    if (d.wave !== wave) continue
    const r = d.repo === '.' ? repo : d.repo
    const res = spawnSync('git', ['-C', r, 'cat-file', '-e', d.ref + ':' + d.path], { encoding: 'utf8' })
    if (res.status !== 0) unmet.push({ ...d, reason: d.path + ' is not present at ' + d.ref + ' in ' + r })
  }
  return unmet
}
