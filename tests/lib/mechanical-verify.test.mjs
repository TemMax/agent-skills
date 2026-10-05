import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { verifyPipeline, verifyBranch } from '../../plugins/orchestration/skills/multi-model/references/mechanical-verify.mjs'
import { makeState, recordExecutor, verifyTask, recordVerdict } from '../../plugins/orchestration/skills/multi-model/references/codex-wave-state.mjs'

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'mechanical-verify-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, 'repo'); mkdirSync(repo)
  const git = (...args) => {
    const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim()
  }
  git('init'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(repo, '.gitignore'), '.worktrees/\n')
  writeFileSync(join(repo, 'a.txt'), 'base'); git('add', '.'); git('commit', '-m', 'base')
  const base = git('rev-parse', 'HEAD'); git('checkout', '-b', 'wave/test')
  writeFileSync(join(repo, 'a.txt'), 'task'); git('commit', '-am', 'task')
  const contract = { files_allowed: ['a.txt'], files_forbidden: [], forbidden_moves: [],
    report_must_answer: [], must_run: [{ cmd: 'test -f a.txt', evidence: 'required', cache: 'artifact' }] }
  const options = { repo, branch: 'wave/test', base, head: git('rev-parse', 'HEAD'), contract }
  return { root, repo, git, options }
}

test('only an opted-in green pipeline on the identical binding can be reused', t => {
  const { options } = fixture(t)
  const first = verifyPipeline(options)
  assert.equal(first.verification.reused, false)
  const second = verifyPipeline({ ...options, cache: [first] })
  assert.equal(second.verification.reused, true)
  assert.deepEqual(second.mustRun, first.mustRun)
  const changed = structuredClone(options); delete changed.contract.must_run[0].cache
  assert.equal(verifyPipeline({ ...changed, cache: [first] }).verification.reused, false)
})

test('head, branch, contract, environment and linked metadata invalidate reuse', t => {
  const { repo, git, options } = fixture(t)
  const first = verifyPipeline(options)
  for (const change of [{ branch: 'wave/other' }, { environment: { test: 'different' } },
    { contract: { ...options.contract, must_run: [{ cmd: 'true', evidence: 'required', cache: 'artifact' }] } }]) {
    assert.equal(verifyPipeline({ ...options, ...change, cache: [first] }).verification.reused, false)
  }
  writeFileSync(join(repo, 'a.txt'), 'next'); git('commit', '-am', 'next')
  assert.equal(verifyPipeline({ ...options, head: git('rev-parse', 'HEAD'), cache: [first] }).verification.reused, false)
  writeFileSync(join(repo, 'local.properties'), 'sdk.dir=one')
  const linked = verifyPipeline({ ...options, links: ['local.properties'] })
  writeFileSync(join(repo, 'local.properties'), 'sdk.dir=changed')
  assert.equal(verifyPipeline({ ...options, links: ['local.properties'], cache: [linked] }).verification.reused, false)
})

test('ordered prerequisites survive and a healing failure repeats the whole fresh pipeline', t => {
  const { options } = fixture(t)
  const ordered = { ...options, contract: { ...options.contract, must_run: [
    { cmd: 'echo ready > generated', evidence: 'required' },
    { cmd: 'test -f generated', evidence: 'required' },
  ] } }
  assert.ok(verifyPipeline(ordered).mustRun.every(m => m.attempts.length === 1 && m.attempts[0].exit === 0))
  const poison = { ...options, contract: { ...options.contract, must_run: [
    { cmd: 'test -f healed || { touch healed; exit 1; }', evidence: 'required', cache: 'artifact' },
  ] } }
  const first = verifyPipeline(poison)
  assert.deepEqual(first.mustRun[0].attempts.map(a => a.exit), [1, 1])
  assert.equal(verifyPipeline({ ...poison, cache: [first] }).verification.reused, false)
})

test('branch verification rejects dirty or forbidden work and captures command facts', t => {
  const { repo, options } = fixture(t)
  const facts = verifyBranch({ ...options, report: 'done' })
  assert.equal(facts.branchHasCommits, true)
  assert.deepEqual(facts.filesChanged, ['a.txt'])
  assert.equal(facts.mustRun[0].exit, 0)
  writeFileSync(join(repo, 'a.txt'), 'dirty')
  assert.throws(() => verifyBranch(options), /clean/)
})

test('verification persists full output while limiting facts passed to a model', t => {
  const { root, options } = fixture(t)
  const result = verifyPipeline({ ...options, logDir: join(root, 'logs'), contract: {
    ...options.contract, must_run: [{ cmd: "python3 -c 'print(\"x\"*80000)'", evidence: 'required' }],
  } })
  assert.ok(result.mustRun[0].attempts[0].stdout.length < 20000)
  assert.ok(readFileSync(join(root, 'logs', 'attempt-1-command-1.stdout'), 'utf8').length > 80000)
})

test('timed-out commands terminate their descendants and never cache a result', async t => {
  const { root, options } = fixture(t)
  const marker = join(root, 'late-write')
  const timed = { ...options, timeoutMs: 50, contract: { ...options.contract,
    must_run: [{ cmd: `sleep 0.5; touch '${marker}'`, evidence: 'required', cache: 'artifact' }] } }
  const facts = verifyPipeline(timed)
  assert.ok(facts.mustRun[0].attempts.every(a => a.error === 'ETIMEDOUT'))
  await new Promise(r => setTimeout(r, 700))
  assert.throws(() => readFileSync(marker), /ENOENT/)
})

test('Codex reuses an unchanged opted-in pipeline after report-only rework and respects attempt limits', t => {
  const { root, repo, options } = fixture(t)
  const wave = { wave: 1, limits: { max_attempts: 2 },
    supervisor: { model: 'gpt-6.1-sol', effort: 'high' }, tasks: [{ id: 'test', branch: 'wave/test',
      executor: { model: 'gpt-6-luna', effort: 'medium' }, ladder: [], contract: options.contract }] }
  const planPath = join(root, 'plan.md')
  writeFileSync(planPath, '```json wave-plan\n' + JSON.stringify({ waves: [wave] }) + '\n```\n\n## Task test\n\nDo it.\n')
  let s = makeState({ planPath, planDigest: 'unused', waveNumber: 1, repoPath: repo, base: options.base, wave })
  s.tasks.test.worktree = repo
  s = verifyTask(recordExecutor(s, 'test', { report: 'one' }), 'test')
  assert.equal(s.tasks.test.verifierFacts.at(-1).verification.reused, false)
  const reject = { ok: false, violations: [{ class: 'report', rule: 'answer', evidence: 'missing answer' }], remarks: [] }
  s = recordVerdict(s, 'test', reject)
  s = verifyTask(recordExecutor(s, 'test', { report: 'two' }), 'test')
  assert.equal(s.tasks.test.verifierFacts.at(-1).verification.reused, true)
  s = recordVerdict(s, 'test', reject)
  assert.equal(s.tasks.test.status, 'failed')
})
