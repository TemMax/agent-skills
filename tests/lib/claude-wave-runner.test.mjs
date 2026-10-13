import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const runner = resolve('plugins/orchestration/skills/multi-model/references/claude-wave-runner.mjs')
function fixture(t, limits, supervision, contractPatch = {}, { repoParent = '', extraTasks = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'claude-native-test-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const repo = join(root, repoParent, 'repo'); mkdirSync(repo, { recursive: true })
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
        must_run: [{ cmd: 'test -f src/one.txt', evidence: 'required', cache: 'artifact' }], ...contractPatch } }, ...extraTasks] }
  const plan = join(root, 'plan.md')
  writeFileSync(plan, 'status: draft\nbase: pending\n```json wave-plan\n'
    + JSON.stringify({ waves: [wave], ci: 'none: fixture has no CI', e2e: 'not-applicable: fixture has no flows' })
    + '\n```\n\n## Task one\n\nCreate src/one.txt.\n'
    + extraTasks.map(x => '\n## Task ' + x.id + '\n\nCreate ' + x.id + '.\n').join(''))
  const cli = join(root, 'claude-stub')
  writeFileSync(cli, `#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const argv=process.argv.slice(2), prompt=readFileSync(0,'utf8');
appendFileSync(process.env.NATIVE_TEST_CALLS,JSON.stringify({argv,prompt})+'\\n');
if(process.env.NATIVE_TEST_MODE==='bad'){console.log('not json');process.exit(0)}
const seen=readFileSync(process.env.NATIVE_TEST_CALLS,'utf8').trim().split('\\n').map(l=>JSON.parse(l));
if(argv.includes('--resume')&&process.env.NATIVE_TEST_MODE==='resume-exit')process.exit(1);
if(argv.includes('--resume')&&process.env.NATIVE_TEST_MODE==='resume-bad-json'){console.log('not json');process.exit(0)}
if(!argv.includes('--json-schema')){
 const repo=process.cwd(), wt=repo+'/.worktrees/one';
 const git=(cwd,...a)=>{const r=spawnSync('git',['-C',cwd,...a],{encoding:'utf8'});if(r.status!==0)throw Error(r.stderr)};
 if(!existsSync(wt))git(repo,'worktree','add','-b','wave/one',wt,'${base}');
 mkdirSync(wt+'/src',{recursive:true});writeFileSync(wt+'/src/one.txt','done');writeFileSync(wt+'/src/call-'+seen.length+'.txt','done');git(wt,'add','.');git(wt,'-c','commit.gpgsign=false','commit','-m','task');
 console.log(JSON.stringify({type:'result',is_error:false,result:'done',usage:{input_tokens:2,cache_creation_input_tokens:10,cache_read_input_tokens:50,output_tokens:3}}));
}else{
 if(process.env.NATIVE_TEST_MODE==='mutate')writeFileSync(process.cwd()+'/src/one.txt','tampered');
 if(process.env.NATIVE_TEST_MODE==='commit'){
  writeFileSync(process.cwd()+'/src/one.txt','tampered');
  spawnSync('git',['add','.']);spawnSync('git',['-c','commit.gpgsign=false','commit','-m','judge mutation']);
 }
 const firstJudge=seen.filter(c=>c.argv.includes('--json-schema')).length===1;
 const reject=['reject','unsat'].includes(process.env.NATIVE_TEST_MODE) || process.env.NATIVE_TEST_MODE==='missing-invariant'
  || (firstJudge && ['reject-once','resume-exit','resume-bad-json'].includes(process.env.NATIVE_TEST_MODE));
 console.log(JSON.stringify({type:'result',is_error:false,structured_output:{ok:!reject,violations:reject?[process.env.NATIVE_TEST_MODE==='unsat'?{class:'must_run',rule:'test -f src/one.txt',evidence:'needs a file outside files_allowed',satisfiable:false}:{class:'report',rule:'answer',evidence:'missing'}]:[],remarks:[]},usage:{input_tokens:2,cache_creation_input_tokens:10,cache_read_input_tokens:50,output_tokens:3}}));
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

const isJudge = c => c.argv.includes('--json-schema')
const flag = (c, name) => c.argv.includes(name) ? c.argv[c.argv.indexOf(name) + 1] : undefined
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const readCalls = f => readFileSync(f.calls, 'utf8').trim().split('\n').map(JSON.parse)

test('native Claude runner spends two model calls, verifies independently and narrows child tools', t => {
  const f = fixture(t); const r = run(f)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.summary.status, 'done')
  assert.equal(r.summary.children.length, 2)
  const calls = readFileSync(f.calls, 'utf8').trim().split('\n').map(JSON.parse)
  assert.ok(calls.every(c => c.argv.includes('--tools')))
  assert.ok(calls.every(c => c.argv.includes('--strict-mcp-config') && !c.argv.includes('--mcp-config')))
  assert.ok(isJudge(calls[1]) && !isJudge(calls[0]))
  assert.ok(calls.filter(isJudge).every(c => c.argv.includes('--no-session-persistence')
    && !c.argv.includes('--resume') && !c.argv.includes('--session-id')))
  assert.match(flag(calls[0], '--session-id'), UUID)
  assert.ok(!calls[0].argv.includes('--no-session-persistence') && !calls[0].argv.includes('--resume'))
  assert.equal(r.summary.children[0].sessionId, flag(calls[0], '--session-id'))
  assert.ok(!('resumed' in r.summary.children[0]) && !('sessionId' in r.summary.children[1]))
  assert.ok(calls[1].prompt.includes('VERIFIER FACTS'))
  assert.ok(!calls[1].argv[calls[1].argv.indexOf('--tools') + 1].includes('Edit'))
  assert.equal(r.summary.usage.output, 6)
  assert.ok(r.stdout.length < 2000)
  // One line per stage, with elapsed time, in the run directory and on stderr.
  const progress = readFileSync(join(f.out, 'progress.log'), 'utf8').trim().split('\n')
  const stages = progress.map(line => line.replace(/^\[\+\d\d:\d\d\] /, '').replace(/\d\d:\d\d/, 'T').replace(/\(.*\)/, '(M)'))
  assert.ok(progress.every(line => /^\[\+\d\d:\d\d\] /.test(line)), progress.join('\n'))
  const id = r.summary.tasks[0].id
  assert.deepEqual(stages.filter(line => !line.startsWith('wave: preflight')), [
    id + ': executor call 1 started (M)', id + ': executor call 1 finished in T',
    id + ': checks started', id + ': checks finished in T',
    id + ': review 1 started (M)', id + ': review 1 finished in T: accepted',
    id + ': accepted', 'wave: finished: done'])
  assert.ok(r.stderr.includes('claude-wave-runner: ' + progress[0]), r.stderr)
  assert.ok(r.summary.wallSeconds >= 0 && r.summary.children.every(c => c.seconds >= 0))
})

test('a done run prints the cleanup command in stdout and summary.json; other statuses omit it', t => {
  const f = fixture(t); const r = run(f)
  assert.equal(r.status, 0, r.stderr)
  const expected = 'node ' + join(dirname(runner), 'wave-cleanup.mjs') + ' --repo ' + f.repo
    + ' --plan ' + resolve(f.plan) + ' --wave 1 --summary ' + join(f.out, 'summary.json')
  assert.equal(JSON.parse(r.stdout).afterIntegration, expected)
  assert.equal(r.summary.afterIntegration, expected)
  const g = fixture(t, { max_model_calls: 1 }); const b = run(g)
  assert.equal(b.status, 1, b.stderr)
  assert.ok(!('afterIntegration' in JSON.parse(b.stdout)))
  assert.ok(!('afterIntegration' in b.summary))
})

test('a repository path with a space yields a quoted cleanup command that the shell parses', t => {
  const f = fixture(t, undefined, undefined, {}, { repoParent: 'dir with space' }); const r = run(f)
  assert.equal(r.status, 0, r.stderr)
  const q = v => "'" + v + "'"
  const expected = 'node ' + join(dirname(runner), 'wave-cleanup.mjs') + ' --repo ' + q(f.repo)
    + ' --plan ' + resolve(f.plan) + ' --wave 1 --summary ' + join(f.out, 'summary.json')
  assert.ok(f.repo.includes(' '))
  assert.equal(JSON.parse(r.stdout).afterIntegration, expected)
  assert.equal(r.summary.afterIntegration, expected)
  const help = spawnSync('sh', ['-c', expected + ' --help'], { encoding: 'utf8' })
  assert.equal(help.status, 0, help.stderr)
})

test('a partial wave with one ok task still prints the cleanup command', t => {
  const two = { id: 'two', branch: 'wave/two', executor: { model: 'claude-sonnet-5-5', effort: 'medium' }, ladder: [],
    contract: { files_allowed: ['other/**'], files_forbidden: [], forbidden_moves: [], report_must_answer: [],
      must_run: [{ cmd: 'test -f other/two.txt', evidence: 'required', cache: 'artifact' }] } }
  const f = fixture(t, undefined, undefined, {}, { extraTasks: [two] }); const r = run(f)
  assert.equal(r.status, 1, r.stderr)
  assert.deepEqual(r.summary.tasks.map(x => x.status === 'ok'), [true, false])
  assert.ok(JSON.parse(r.stdout).afterIntegration)
  assert.equal(r.summary.afterIntegration, JSON.parse(r.stdout).afterIntegration)
})

test('a same-rung rework resumes the executor session with the continuation only', t => {
  const f = fixture(t); const r = run(f, 'reject-once')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.summary.tasks[0].status, 'ok')
  const calls = readCalls(f), exec = calls.filter(c => !isJudge(c)), judge = calls.filter(isJudge)
  assert.equal(exec.length, 2); assert.equal(judge.length, 2)
  const first = flag(exec[0], '--session-id')
  assert.match(first, UUID)
  assert.ok(exec[0].prompt.startsWith('# Task: one') && !exec[0].argv.includes('--resume'))
  assert.equal(flag(exec[1], '--resume'), first)
  assert.ok(!exec[1].argv.includes('--session-id') && !exec[1].argv.includes('--no-session-persistence'))
  assert.ok(exec[1].argv.includes('--strict-mcp-config') && !exec[1].argv.includes('--mcp-config'))
  assert.equal(flag(exec[1], '--model'), flag(exec[0], '--model'))
  assert.equal(flag(exec[1], '--effort'), flag(exec[0], '--effort'))
  assert.ok(exec[1].prompt.startsWith('## Prior attempt was rejected'))
  assert.ok(exec[1].prompt.includes('The supervisor reads only this final report'))
  assert.ok(exec[1].prompt.includes('git log --oneline ' + f.base + '..HEAD'))
  assert.ok(!exec[1].prompt.includes('# Task:'))
  assert.ok(judge.every(c => c.argv.includes('--no-session-persistence')
    && !c.argv.includes('--resume') && !c.argv.includes('--session-id')))
  const children = r.summary.children.filter(c => c.role === 'exec')
  assert.deepEqual(children.map(c => [c.sessionId, c.resumed, c.ok]), [[first, undefined, true], [first, true, true]])
  assert.equal(readFileSync(children[1].prompt, 'utf8'), exec[1].prompt, '.prompt.md holds exactly the text sent')
  assert.equal(r.summary.usage.output, 12, 'usage is summed per call, resumed or not')
})

test('a failed resume drops the session and the retry starts fresh with the full rework prompt', t => {
  for (const mode of ['resume-exit', 'resume-bad-json']) {
    const f = fixture(t); const r = run(f, mode)
    assert.equal(r.status, 0, r.stderr)
    assert.equal(r.summary.tasks[0].status, 'ok')
    const calls = readCalls(f), exec = calls.filter(c => !isJudge(c))
    assert.equal(exec.length, 3); assert.equal(calls.filter(isJudge).length, 2)
    const first = flag(exec[0], '--session-id'), fresh = flag(exec[2], '--session-id')
    assert.equal(flag(exec[1], '--resume'), first)
    assert.ok(!exec[1].prompt.includes('# Task:'))
    assert.match(fresh, UUID); assert.notEqual(fresh, first)
    assert.ok(!exec[2].argv.includes('--resume') && !exec[2].argv.includes('--no-session-persistence'))
    assert.ok(exec[2].prompt.startsWith('# Task: one'))
    assert.ok(exec[2].prompt.includes('## Prior attempt was rejected'))
    assert.ok(!exec[2].prompt.includes('The supervisor reads only this final report'))
    const children = r.summary.children.filter(c => c.role === 'exec')
    assert.deepEqual(children.map(c => [c.sessionId, c.resumed, c.ok]),
      [[first, undefined, true], [first, true, false], [fresh, undefined, true]])
    assert.equal(readFileSync(children[2].prompt, 'utf8'), exec[2].prompt)
    assert.equal(r.summary.tasks[0].attempts.filter(a => a.kind === 'agent-error').length, 1)
  }
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

// Continuation: one more executor attempt on a stopped candidate, with the
// coordinator's note.
function stopped(t) {
  const f = fixture(t)
  const first = run(f, 'reject')
  assert.equal(first.summary.tasks[0].status, 'failed', first.stderr)
  assert.equal(first.summary.children.filter(c => c.role === 'exec').length, 2)
  const note = join(f.root, 'note.md')
  writeFileSync(note, 'src/one.txt holds the wrong text: write the final answer there.\n')
  return { f, note, summaryPath: join(f.out, 'summary.json') }
}
const continued = (f, name, summaryPath, extra, mode) =>
  run({ ...f, out: join(f.root, name) }, mode, ['--resume-from', summaryPath, ...extra])

test('a continuation gives a stopped task one fresh attempt at high with the note and the prior verdicts', t => {
  const { f, note, summaryPath } = stopped(t)
  const second = continued(f, 'run2', summaryPath, ['--continue-note', note])
  assert.equal(second.status, 0, second.stderr)
  assert.equal(second.summary.status, 'done')
  const execs = second.summary.children.filter(c => c.role === 'exec')
  assert.equal(execs.length, 3)
  assert.equal(execs.at(-1).model, 'claude-sonnet-5-5')
  assert.equal(execs.at(-1).effort, 'high')
  assert.ok(!('resumed' in execs.at(-1)))
  const call = readCalls(f).filter(c => !isJudge(c)).at(-1)
  assert.ok(call.argv.includes('--session-id') && !call.argv.includes('--resume'))
  assert.match(call.prompt, /^# Task: one/)
  assert.match(call.prompt, /## Continuation of a stopped task/)
  assert.match(call.prompt, /COORDINATOR NOTE[^\n]*\nsrc\/one\.txt holds the wrong text/)
  assert.match(call.prompt, /PRIOR VERDICTS \(oldest first\):/)
  assert.equal(second.summary.tasks[0].attempts.at(-1).kind, 'continuation')
  assert.deepEqual(second.summary.continuation.tasks, ['one'])
  assert.deepEqual(second.summary.continuation.approvedBy, { one: 'coordinator' })
  assert.match(readFileSync(second.summary.continuation.noteFile, 'utf8'), /wrong text/)
  assert.equal(second.summary.recovery.tasks.one.executorCalls, 3)
  assert.equal(second.summary.recovery.tasks.one.continuations, 1)
  const progress = readFileSync(join(f.root, 'run2', 'progress.log'), 'utf8')
  assert.match(progress, /one: continuation: one more attempt with the coordinator's note \(coordinator\)\n[^\n]*one: executor call 1 started \(claude-sonnet-5-5 high\)/)
})

test('a rejected continuation ends the task; a second one needs --user-approved', t => {
  const { f, note, summaryPath } = stopped(t)
  const second = continued(f, 'run2', summaryPath, ['--continue-note', note], 'reject')
  assert.notEqual(second.status, 0)
  assert.equal(second.summary.tasks[0].status, 'failed')
  assert.equal(second.summary.children.filter(c => c.role === 'exec').length, 3, 'exactly one more attempt')
  const secondSummary = join(f.root, 'run2', 'summary.json')

  const before = readCalls(f).length
  const refused = continued(f, 'run3', secondSummary, ['--continue-note', note])
  assert.equal(refused.status, 2, refused.stderr)
  assert.match(refused.stderr, /nothing to continue — one: already had a continuation; a further one needs the user's yes — then pass --user-approved/)
  assert.equal(readCalls(f).length, before, 'nothing is launched')
  assert.equal(existsSync(secondSummary + '.resumed'), false)
  assert.equal(existsSync(join(f.root, 'run3')), false)

  const approved = continued(f, 'run4', secondSummary, ['--continue-note', note, '--user-approved'])
  assert.equal(approved.status, 0, approved.stderr)
  assert.deepEqual(approved.summary.continuation.approvedBy, { one: 'user' })
  assert.equal(approved.summary.recovery.tasks.one.continuations, 2)
})

test('a continuation is refused without a rejected task, a note or a resumed run', t => {
  const f = fixture(t)
  assert.equal(run(f).status, 0)
  const note = join(f.root, 'note.md'); writeFileSync(note, 'fix it\n')
  const none = continued(f, 'run2', join(f.out, 'summary.json'), ['--continue-note', note])
  assert.equal(none.status, 2)
  assert.match(none.stderr, /the previous run has no rejected task to continue/)
  const alone = run({ ...f, out: join(f.root, 'run3') }, undefined, ['--continue-note', note])
  assert.equal(alone.status, 2)
  assert.match(alone.stderr, /--continue-note continues a stopped run: it requires --resume-from/)
})

test('a continuation verdict that blames the contract ends as contract-unsatisfiable, not as a rejection', t => {
  const { f, note, summaryPath } = stopped(t)
  const second = continued(f, 'run2', summaryPath, ['--continue-note', note], 'unsat')
  assert.notEqual(second.status, 0)
  assert.equal(second.summary.tasks[0].status, 'contract-unsatisfiable')
  const refused = continued(f, 'run3', join(f.root, 'run2', 'summary.json'), ['--continue-note', note, '--user-approved'])
  assert.equal(refused.status, 2, refused.stderr)
  assert.match(refused.stderr, /the previous run has no rejected task to continue/)
})

test('a continuation executor that dies is launched once, ends as an error and is not counted', t => {
  const { f, note, summaryPath } = stopped(t)
  const second = continued(f, 'run2', summaryPath, ['--continue-note', note], 'bad')
  assert.notEqual(second.status, 0)
  assert.equal(second.summary.tasks[0].status, 'error')
  assert.equal(second.summary.children.filter(c => c.role === 'exec').length, 3, 'one launch, no relaunch')
  assert.equal(second.summary.children.filter(c => c.role === 'judge').length, 2, 'no review of a missing report')
  assert.ok(!('continuations' in second.summary.recovery.tasks.one))
})
