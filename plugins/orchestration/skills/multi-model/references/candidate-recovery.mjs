// Local recovery receipts. No old verdict or verifier output is accepted.
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { TASK_HEADING_SOURCE } from './worktree-env.mjs'

const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
const git = (repo, args) => {
  const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', timeout: 30000 })
  if (r.status !== 0) throw new Error('candidate recovery: ' + (r.stderr || 'git failed').trim())
  return r.stdout.trim()
}

export function recoveryScope({ host, repo, base, waveNumber, wave, plan, markdown }) {
  const headings = [...markdown.matchAll(new RegExp(TASK_HEADING_SOURCE, 'gm'))]
  const prose = Object.fromEntries(wave.tasks.map(task => {
    const heading = headings.find(h => h[1] === task.id)
    if (!heading) throw new Error('recovery: missing task prose: ' + task.id)
    const rest = markdown.slice(heading.index + heading[0].length)
    const end = rest.search(/^## /m)
    return [task.id, createHash('sha256').update((end < 0 ? rest : rest.slice(0, end)).trim()).digest('hex')]
  }))
  // The caller explicitly supplies a newly linted contract. Roles, task ids,
  // product prose, authorization and delivery scope must stay unchanged.
  const { limits, tasks, ...waveScope } = wave
  return { host, repo: realpathSync(repo), base, waveNumber, prose,
    wave: { ...waveScope, tasks: tasks.map(({ contract, ...task }) => task) },
    approvals: plan.approvals ?? null, review: plan.review ?? null,
    ci: plan.ci ?? null, e2e: plan.e2e ?? null, depends_on: plan.depends_on ?? [],
    limits: { max_attempts: limits?.max_attempts ?? 6, max_model_calls: limits?.max_model_calls ?? 24 } }
}

export function candidate(repo, base, id, expectedHead) {
  const branch = 'wave/' + id
  const head = git(repo, ['rev-parse', '--verify', 'refs/heads/' + branch])
  if (expectedHead && head !== expectedHead) throw new Error('candidate recovery: changed HEAD for ' + id)
  if (head === base) throw new Error('candidate recovery: no candidate commits for ' + id)
  git(repo, ['merge-base', '--is-ancestor', base, head])
  const worktrees = git(repo, ['worktree', 'list', '--porcelain']).split('\n\n')
  const block = worktrees.find(b => b.split('\n').includes('branch refs/heads/' + branch))
  if (!block) throw new Error('candidate recovery: attached worktree required for ' + id)
  const worktree = block.split('\n').find(l => l.startsWith('worktree ')).slice(9)
  if (git(worktree, ['status', '--porcelain', '--untracked-files=all']) !== '') {
    throw new Error('candidate recovery: dirty worktree for ' + id)
  }
  return { head, worktree }
}

// Executor attempts as the wave state counts them: a fresh child launched
// after a failed resume (fallbackFrom 'resume') shares that resume's attempt.
const executorAttempts = calls => calls.filter(c => ['executor', 'exec'].includes(c.role)
  && c.fallbackFrom !== 'resume').length

export function makeRecoveryReceipt(scope, children, reports = {}) {
  const tasks = {}
  for (const task of scope.wave.tasks) {
    let artifact = null
    try { artifact = candidate(scope.repo, scope.base, task.id) } catch {}
    const calls = children.filter(c => c.task === task.id)
    const executors = calls.filter(c => ['executor', 'exec'].includes(c.role))
    const previousReport = reports[task.id]
    tasks[task.id] = { ...artifact, report: typeof previousReport === 'string' ? previousReport : '',
      modelCalls: calls.length, executorCalls: executorAttempts(calls),
      executorModel: executors.at(-1)?.model ?? null }
  }
  return { schema: 1, scope, tasks }
}

export function readRecovery(summaryPath, scope) {
  const path = resolve(summaryPath)
  if (existsSync(path + '.resumed')) throw new Error('recovery: receipt already continued; use its latest summary')
  const summary = JSON.parse(readFileSync(path, 'utf8'))
  const receipt = summary.recovery
  if (!receipt || receipt.schema !== 1 || !equal(receipt.scope, scope)
    || !Array.isArray(summary.children)) throw new Error('recovery: scope/roles/budget changed or receipt missing')
  if (!equal(Object.keys(receipt.tasks).sort(), scope.wave.tasks.map(t => t.id).sort())) throw new Error('recovery: task identities changed')
  for (const task of scope.wave.tasks) {
    const saved = receipt.tasks[task.id], calls = summary.children.filter(c => c.task === task.id)
    if (!saved || !/^[0-9a-f]{40}$/.test(saved.head) || typeof saved.report !== 'string'
      || saved.modelCalls !== calls.length || saved.executorCalls !== executorAttempts(calls)
      || saved.executorModel !== calls.filter(c => ['executor', 'exec'].includes(c.role)).at(-1)?.model
      || saved.executorCalls < 1 || saved.executorCalls > 6) throw new Error('recovery: invalid candidate/counters for ' + task.id)
    candidate(scope.repo, scope.base, task.id, saved.head)
  }
  return { path, summary, tasks: receipt.tasks }
}

export function claimRecovery(recovery, nextSummary) {
  // Exclusive claim prevents two continuations spending the same remaining budget.
  writeFileSync(recovery.path + '.resumed', resolve(nextSummary) + '\n', { flag: 'wx', mode: 0o600 })
}

export function recoveredReport(report) {
  return 'Recovered committed candidate. Earlier executor report follows; prior environment failures are historical, not current evidence.\n\n' + report
}
