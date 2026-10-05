import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const runner = resolve('plugins/orchestration/skills/multi-model/references/claude-wave-runner.mjs')
function fixture(t, limits, supervision, contractPatch = {}) {
  const root = mkdtempSync(join(tmpdir(), 'claude-native-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, 'repo'); mkdirSync(repo)
  function git(...args) {
    const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim()
  }
  git('init', '-b', 'main'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid')
  git('config', 'commit.gpgsign', 'false')
  writeFileSync(join(repo, 'README.md'), 'base'); git('add', '.'); git('commit', '-m', 'base')
  const base = git('rev-parse', 'HEAD')
  const remote = join(root, 'origin.git')
  assert.equal(spawnSync('git', ['init', '--bare', remote]).status, 0)
  git('remote', 'add', 'origin', remote); git('push', 'origin', 'main')
  const wave = { wave: 1, ...(limits ? { limits } : {}), supervisor: { model: 'claude-opus-5', effort: 'high' },
    tasks: [{ id: 'one', branch: 'wave/one', ...(supervision ? { supervision } : {}), executor: { model: 'claude-sonnet-5-5', effort: 'medium' }, ladder: [],
      contract: { files_allowed: ['src/**'], files_forbidden: [], forbidden_moves: [], report_must_answer: [],
        must_run: [{ cmd: 'test -f src/one.txt', evidence: 'required', cache: 'artifact' }], ...contractPatch } }] }
  const plan = join(root, 'plan.md')
  writeFileSync(plan, 'status: draft\nbase: pending\n```json wave-plan\n'
    + JSON.stringify({ waves: [wave], ci: 'none: fixture has no CI', e2e: 'not-applicable: fixture has no flows' })
    + '\n```\n\n## Task one\n\nCreate src/one.txt.\n')
  const cli = join(root, 'claude-stub')
  writeFileSync(cli, `#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const argv=process.argv.slice(2), prompt=readFileSync(0,'utf8');
appendFileSync(process.env.NATIVE_TEST_CALLS,JSON.stringify({argv,prompt})+'\\n');
if(process.env.NATIVE_TEST_MODE==='bad'){console.log('not json');process.exit(0)}
if(!argv.includes('--json-schema')){
 const repo=process.cwd(), wt=repo+'/.worktrees/one';
 const git=(cwd,...a)=>{const r=spawnSync('git',['-C',cwd,...a],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr)};
 git(repo,'worktree','add','-b','wave/one',wt,'${base}');
 mkdirSync(wt+'/src',{recursive:true});writeFileSync(wt+'/src/one.txt','done');git(wt,'add','.');git(wt,'-c','commit.gpgsign=false','commit','-m','task');
 console.log(JSON.stringify({type:'result',is_error:false,result:'done',usage:{input_tokens:2,cache_creation_input_tokens:10,cache_read_input_tokens:50,output_tokens:3}}));
}else{
 if(process.env.NATIVE_TEST_MODE==='mutate')writeFileSync(process.cwd()+'/src/one.txt','tampered');
 if(process.env.NATIVE_TEST_MODE==='commit'){
  writeFileSync(process.cwd()+'/src/one.txt','tampered');
  spawnSync('git',['add','.']);spawnSync('git',['-c','commit.gpgsign=false','commit','-m','judge mutation']);
 }
 const reject=process.env.NATIVE_TEST_MODE==='reject' || process.env.NATIVE_TEST_MODE==='missing-invariant';
 console.log(JSON.stringify({type:'result',is_error:false,structured_output:{ok:!reject,violations:reject?[{class:'report',rule:'answer',evidence:'missing'}]:[],remarks:[]},usage:{input_tokens:2,cache_creation_input_tokens:10,cache_read_input_tokens:50,output_tokens:3}}));
}
`, { mode: 0o755 })
  const out = join(root, 'run'), calls = join(root, 'calls.jsonl')
  return { root, repo, plan, base, cli, out, calls }
}
function run(f, mode, extra = []) {
  const r = spawnSync(process.execPath, [runner, '--plan', f.plan, '--wave', '1', '--repo', f.repo,
    '--base', f.base, '--default-branch', 'main', '--claude', f.cli, '--out', f.out, '--preflight', 'off', ...extra],
  { encoding: 'utf8', timeout: 30000, env: { ...process.env, NATIVE_TEST_CALLS: f.calls, NATIVE_TEST_MODE: mode || '' } })
  return { ...r, summary: existsSync(join(f.out, 'summary.json')) ? JSON.parse(readFileSync(join(f.out, 'summary.json'))) : null }
}

test('native Claude runner spends two model calls, verifies independently and narrows child tools', t => {
  const f = fixture(t); const r = run(f)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.summary.status, 'done')
  assert.equal(r.summary.children.length, 2)
  const calls = readFileSync(f.calls, 'utf8').trim().split('\n').map(JSON.parse)
  assert.ok(calls.every(c => c.argv.includes('--no-session-persistence') && c.argv.includes('--tools') && !c.argv.includes('--resume')))
  assert.ok(calls[1].prompt.includes('VERIFIER FACTS'))
  assert.ok(!calls[1].argv[calls[1].argv.indexOf('--tools') + 1].includes('Edit'))
  assert.equal(r.summary.usage.output, 6)
  assert.ok(r.stdout.length < 2000)
})

test('native budget bounds stop before excess calls and preserve review artifacts', t => {
  const f = fixture(t, { max_model_calls: 1 }); const r = run(f)
  assert.equal(r.status, 1, r.stderr)
  assert.equal(r.summary.tasks[0].status, 'budget-exhausted')
  assert.equal(r.summary.children.length, 1)
  assert.ok(existsSync(join(f.out, 'one', 'verification-1.json')))
})

test('malformed child output is retried once and cannot produce acceptance', t => {
  const f = fixture(t); const r = run(f, 'bad')
  assert.equal(r.status, 1, r.stderr)
  assert.equal(r.summary.tasks[0].status, 'error')
  assert.equal(r.summary.children.length, 2)
})

test('invalid limits fail before artifact directories or model launches', t => {
  const f = fixture(t, { max_attempts: 0 }); const r = run(f)
  assert.notEqual(r.status, 0)
  assert.equal(existsSync(f.out), false)
  assert.equal(existsSync(f.calls), false)
})

test('mechanical mode rejects semantic obligations and unknown cache declarations before launching', t => {
  for (const patch of [{ report_must_answer: ['Explain the behavior'] },
    { forbidden_moves: ['Do not weaken validation'] }, { must_run: [] },
    { must_run: [{ cmd: 'true', evidence: 'required', cache: 'automatic' }] }]) {
    const f = fixture(t, undefined, 'mechanical', patch); const r = run(f)
    assert.notEqual(r.status, 0)
    assert.equal(existsSync(f.out), false)
    assert.equal(existsSync(f.calls), false)
  }
})

test('a supervisor that modifies its checkout cannot return an accepted artifact', t => {
  const f = fixture(t); const r = run(f, 'mutate')
  assert.equal(r.status, 1, r.stderr)
  assert.equal(r.summary.tasks[0].status, 'error')
})

test('a supervisor cannot accept a changed detached HEAD even when its checkout is clean', t => {
  const f = fixture(t); const r = run(f, 'commit')
  assert.equal(r.status, 1, r.stderr)
  assert.equal(r.summary.tasks[0].status, 'error')
  assert.equal(r.summary.usage.output, 9, 'usage includes both rejected judge calls')
})

test('explicit mechanical task completes with one model call and independent green predicates', t => {
  const f = fixture(t, undefined, 'mechanical'); const r = run(f)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.summary.tasks[0].status, 'ok')
  assert.equal(r.summary.children.length, 1)
})


test('recovery rechecks the changed contract and calls only the judge, preserving earlier spend', t => {
  const f = fixture(t); const first = run(f, 'mutate')
  assert.equal(first.summary.children.length, 3)
  const oldSummary = join(f.out, 'summary.json')
  const text = readFileSync(f.plan, 'utf8').replace('"forbidden_moves":[]', '"forbidden_moves":["Keep validator invariants"]')
  writeFileSync(f.plan, text)
  f.out = join(f.root, 'recovered')
  const second = run(f, undefined, ['--resume-from', oldSummary])
  assert.equal(second.status, 0, second.stderr)
  assert.equal(second.summary.children.length, 4)
  assert.equal(second.summary.children.filter(c => c.role === 'exec').length, 1)
  assert.equal(second.summary.usage.output, 12)
  assert.ok(readFileSync(second.summary.children.at(-1).prompt, 'utf8').includes('Keep validator invariants'))
  assert.ok(existsSync(oldSummary + '.resumed'))
  f.out = join(f.root, 'fork')
  assert.notEqual(run(f, undefined, ['--resume-from', oldSummary]).status, 0)
})

test('recovery keeps the call cap and does not restart an executor or grant extra budget', t => {
  const f = fixture(t, { max_model_calls: 1 }); const first = run(f)
  assert.equal(first.summary.children.length, 1)
  const oldSummary = join(f.out, 'summary.json'); f.out = join(f.root, 'resumed')
  const second = run(f, undefined, ['--resume-from', oldSummary])
  assert.equal(second.summary.tasks[0].status, 'budget-exhausted')
  assert.equal(second.summary.children.length, 1)
})

test('changed candidate, dirty worktree, changed roles or budget cannot be adopted', t => {
  for (const mode of ['head', 'dirty', 'roles', 'budget']) {
    const f = fixture(t, { max_model_calls: 4 }); run(f)
    const oldSummary = join(f.out, 'summary.json'); f.out = join(f.root, 'resumed')
    if (mode === 'roles' || mode === 'budget') {
      writeFileSync(f.plan, readFileSync(f.plan, 'utf8').replace(mode === 'roles' ? '"effort":"medium"' : '"max_model_calls":4',
        mode === 'roles' ? '"effort":"high"' : '"max_model_calls":5'))
    } else {
      const wt = join(f.repo, '.worktrees', 'one'); writeFileSync(join(wt, 'src/one.txt'), 'changed')
      if (mode === 'head') {
        spawnSync('git', ['-C', wt, 'add', '.']); spawnSync('git', ['-C', wt, '-c', 'commit.gpgsign=false', 'commit', '-m', 'changed'])
      }
    }
    const second = run(f, undefined, ['--resume-from', oldSummary])
    assert.notEqual(second.status, 0)
    assert.equal(readFileSync(f.calls, 'utf8').trim().split('\n').length, 2)
  }
})

test('independent review still rejects a lost invariant during recovery without reimplementation', t => {
  const f = fixture(t); run(f, 'mutate')
  const oldSummary = join(f.out, 'summary.json'); f.out = join(f.root, 'resumed')
  const second = run(f, 'missing-invariant', ['--resume-from', oldSummary])
  assert.equal(second.summary.tasks[0].status, 'candidate-rejected')
  assert.equal(second.summary.children.filter(c => c.role === 'exec').length, 1)
})

test('unavailable review CLI fails before creating artifacts or model calls', t => {
  const f = fixture(t); f.cli = join(f.root, 'unavailable')
  const r = run(f)
  assert.notEqual(r.status, 0)
  assert.match(r.stderr, /CLI adapter unavailable/)
  assert.equal(existsSync(f.out), false)
  assert.equal(existsSync(f.calls), false)
})


test('recovery cannot reuse green evidence after a must_run amendment', t => {
  const f = fixture(t); run(f)
  const oldSummary = join(f.out, 'summary.json')
  writeFileSync(f.plan, readFileSync(f.plan, 'utf8').replace('test -f src/one.txt', 'test -f src/missing.txt'))
  f.out = join(f.root, 'resumed')
  const r = run(f, undefined, ['--resume-from', oldSummary])
  assert.equal(r.status, 1)
  assert.equal(r.summary.tasks[0].status, 'candidate-rejected')
  assert.equal(r.summary.children.length, 2, 'no executor or judge can override red mechanical checks')
  const facts = JSON.parse(readFileSync(join(f.out, 'one/verification-1.json'), 'utf8'))
  assert.equal(facts.mustRun[0].exit, 1)
})
