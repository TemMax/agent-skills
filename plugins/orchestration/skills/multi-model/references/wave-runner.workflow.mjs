export const meta = {
  name: 'wave-runner',
  description: 'Reference supervised-wave runner: isolation, executors, supervision, escalation ladder',
  phases: [
    { title: 'Wave', detail: 'per task: executor → verify → judge → ladder' },
  ],
}

// Escalation policy tested by tests/lib/wave-runner.test.mjs — change the
// numbers there and here together.
// 'claude-opus-4-8' is the one full ID the harness resolves (Workflow's agent() accepts full IDs; 'opus-4-8' is rejected — probe wf_93d94701-ae1, 2026-09-01). Explicit rung only: not in LADDER_ORDER.
const MODELS = ['haiku', 'sonnet', 'opus', 'fable', 'claude-opus-4-8']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const LADDER_ORDER = ['haiku', 'sonnet', 'opus']
const MAX_ATTEMPTS_PER_RUNG = 2
const MAX_ATTEMPTS_PER_TASK = 6

const VERIFIER_DEFAULT = { model: 'sonnet', effort: 'low' }
const VERIFY_MARKER = '# Mechanical verification (facts only)'

function invalid(errors) { return { status: 'invalid-args', errors, tasks: [] } }

// Fail closed: a bad wave returns named errors and spawns nothing.
// The tool-call layer routinely delivers args as a JSON-encoded string (seen
// from both headless -p and interactive sessions, 2026-08-12), so a string
// that parses to an object is accepted: parse, then validate. Anything else
// still fails closed by name.
let wave = args
if (typeof wave === 'string') {
  try { wave = JSON.parse(wave) } catch (e) {
    return invalid(['args arrived as a string and could not be parsed as JSON: ' + e.message])
  }
}
if (typeof wave !== 'object' || wave === null || Array.isArray(wave)) {
  return invalid(['args must be a JSON object, not ' + (Array.isArray(wave) ? 'an array' : typeof wave)])
}

const errors = []
if (typeof wave.base !== 'string' || !/^[0-9a-f]{7,40}$/.test(wave.base)) {
  errors.push('base: a 7-40 char lowercase hex sha is required')
}
if (typeof wave.repoPath !== 'string' || !wave.repoPath.startsWith('/')) {
  errors.push('repoPath: an absolute path is required')
}
if (typeof wave.defaultBranch !== 'string' || wave.defaultBranch === '') {
  errors.push('defaultBranch: required')
}
if (typeof wave.supervisorPromptText !== 'string' || !wave.supervisorPromptText.includes('verdict')) {
  errors.push('supervisorPromptText: must be the text of references/supervisor-prompt.md (missing, or the wrong file was read)')
}
if (!wave.supervisor || !MODELS.includes(wave.supervisor.model)) {
  errors.push('supervisor.model: one of ' + MODELS.join('/'))
}
if (wave.supervisor && wave.supervisor.effort !== undefined && !EFFORTS.includes(wave.supervisor.effort)) {
  errors.push('supervisor.effort: one of ' + EFFORTS.join('/'))
}
if (wave.verifier !== undefined) {
  if (!wave.verifier || !MODELS.includes(wave.verifier.model)) {
    errors.push('verifier.model: one of ' + MODELS.join('/'))
  }
  if (wave.verifier && wave.verifier.effort !== undefined && !EFFORTS.includes(wave.verifier.effort)) {
    errors.push('verifier.effort: one of ' + EFFORTS.join('/'))
  }
}
if (!Array.isArray(wave.tasks) || wave.tasks.length === 0) {
  errors.push('tasks: a non-empty array is required')
} else {
  const seen = new Set()
  wave.tasks.forEach((t, i) => {
    const at = 'tasks[' + i + ']'
    if (!t || typeof t !== 'object') {
      errors.push(at + ': task must be an object')
      return
    }
    if (typeof t.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(t.id)) {
      errors.push(at + '.id: kebab-case required')
    } else if (seen.has(t.id)) {
      errors.push(at + '.id: duplicate "' + t.id + '"')
    } else { seen.add(t.id) }
    if (typeof t.description !== 'string' || t.description.trim() === '') {
      errors.push(at + '.description: required')
    }
    const c = t.contract
    if (!c || typeof c !== 'object') {
      errors.push(at + '.contract: required, with all five keys')
    } else {
      for (const k of ['files_allowed', 'files_forbidden', 'forbidden_moves', 'report_must_answer']) {
        if (!Array.isArray(c[k])) errors.push(at + '.contract.' + k + ': array required')
      }
      if (!Array.isArray(c.must_run)) {
        errors.push(at + '.contract.must_run: array required')
      } else {
        c.must_run.forEach((m, j) => {
          if (!m || typeof m.cmd !== 'string' || m.cmd === '') {
            errors.push(at + '.contract.must_run[' + j + '].cmd: required')
          }
          if (!m || typeof m.evidence !== 'string') {
            errors.push(at + '.contract.must_run[' + j + '].evidence: required')
          }
        })
      }
    }
    if (!t.executor || !MODELS.includes(t.executor.model)) {
      errors.push(at + '.executor.model: one of ' + MODELS.join('/') + ' (short names, or the pinned full ID claude-opus-4-8)')
    }
    if (t.executor && t.executor.effort !== undefined && !EFFORTS.includes(t.executor.effort)) {
      errors.push(at + '.executor.effort: one of ' + EFFORTS.join('/'))
    }
    if (t.ladder !== undefined && (!Array.isArray(t.ladder) || t.ladder.some((m) => !MODELS.includes(m)))) {
      errors.push(at + '.ladder: an array of ' + MODELS.join('/') + ' (short names, or the pinned full ID claude-opus-4-8)')
    }
    if (t.executor && MODELS.includes(t.executor.model) && Array.isArray(t.ladder)) {
      const transitions = [t.executor.model, ...t.ladder]
      if (new Set(transitions).size !== transitions.length) {
        errors.push(at + '.ladder: ladder transitions must use distinct models across executor and ladder')
      }
    }
    if (wave.supervisor && t.executor
      && [t.executor.model, ...(Array.isArray(t.ladder) ? t.ladder : [])].includes(wave.supervisor.model)) {
      errors.push(at + ': supervisor model also appears as executor or ladder rung')
    }
  })
}
if (errors.length > 0) return invalid(errors)

const verifier = {
  model: (wave.verifier && wave.verifier.model) || VERIFIER_DEFAULT.model,
  effort: (wave.verifier && wave.verifier.effort) || VERIFIER_DEFAULT.effort,
}

// ---------- prompt assembly ----------
// The executor's contract block and the supervisor's contract are rendered
// from the same object; they cannot diverge.

function yamlInline(items) { return '[' + items.join(', ') + ']' }

// Deliberately tiny: ** crosses slashes, * and ? do not; everything else is
// literal.
function globRe(glob) {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++ } else { re += '[^/]*' }
    } else if (ch === '?') { re += '[^/]' }
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp('^' + re + '$')
}

function pathAllowed(path, allowed, forbidden) {
  if (forbidden.some((g) => globRe(g).test(path))) return false
  return allowed.some((g) => globRe(g).test(path))
}

function renderContract(c) {
  const lines = ['contract:']
  lines.push('  files_allowed: ' + yamlInline(c.files_allowed))
  lines.push('  files_forbidden: ' + yamlInline(c.files_forbidden))
  if (c.must_run.length === 0) {
    lines.push('  must_run: []')
  } else {
    lines.push('  must_run:')
    for (const m of c.must_run) {
      lines.push('    - cmd: ' + m.cmd)
      lines.push('      evidence: ' + m.evidence)
    }
  }
  for (const key of ['forbidden_moves', 'report_must_answer']) {
    if (c[key].length === 0) {
      lines.push('  ' + key + ': []')
    } else {
      lines.push('  ' + key + ':')
      for (const item of c[key]) lines.push('    - ' + item)
    }
  }
  return lines.join('\n')
}

function executorPrompt(t) {
  const worktree = wave.repoPath + '/.worktrees/wave-' + t.id
  return [
    '# Task: ' + t.id,
    '',
    '## Context',
    t.description,
    t.context ? '' : null,
    t.context ? t.context : null,
    '',
    'You work in your own git worktree. You will not see any other task\'s',
    'edits; a quiet tree is expected, not a sign something is wrong.',
    '',
    '## Workspace (do this first)',
    'Repository: ' + wave.repoPath,
    '- cd ' + wave.repoPath,
    '- git worktree add ' + worktree + ' -b wave/' + t.id + ' ' + wave.base,
    '  (if the worktree and branch already exist from a prior attempt, reuse them as they are)',
    '- git -C ' + worktree + ' merge-base --is-ancestor ' + wave.base + ' origin/' + wave.defaultBranch,
    '  (must exit 0; if it does not, STOP and report — do not pick another base)',
    'Build-system commands (gradle, cargo, npm, pnpm, yarn, make, mvn and the',
    'like) — start them in the background with output to a log file and poll',
    'the log; a silent foreground wait looks like a stall and gets killed.',
    'Work and commit ONLY inside ' + worktree + '.',
    '',
    '## Boundaries',
    'You may change only paths matching: ' + yamlInline(t.contract.files_allowed),
    t.contract.files_forbidden.length > 0
      ? 'You must not touch: ' + yamlInline(t.contract.files_forbidden) : null,
    'Do not refactor adjacent code. Do not add unrequested features or files.',
    '',
    '## Dead-end protocol',
    'If data or access is missing, a tool is broken, or the path is impossible —',
    'stop and report what is blocking you. Do not invent values, do not work',
    'around the restriction, do not pick an interpretation on the user\'s behalf.',
    '',
    '## Prohibitions',
    'Do not spawn subagents. No force-push, no reset --hard, no rm outside the',
    'task\'s files. Do not work around a failing check — report it.',
    '',
    '## Definition of done and report format',
    'Your report must contain: the list of changed files; the gist of the',
    'change; the verbatim output of every must_run command, actually executed',
    'in your worktree; an answer to every report_must_answer question.',
    'Commit every change to your branch before reporting. Your report must',
    'also paste, run in your worktree: git log --oneline ' + wave.base + '..HEAD',
    '(must be non-empty) and git status --porcelain (must be empty) —',
    'uncommitted work does not exist for the wave.',
    'A claim that a command passed without its pasted output is a contract',
    'violation in its own right.',
    '',
    '## Contract (a supervisor will check every line of this against your branch)',
    renderContract(t.contract),
  ].filter((line) => line !== null).join('\n')
}

function verifierPrompt(t, report) {
  const wt = wave.repoPath + '/.worktrees/verify-' + t.id
  return [
    VERIFY_MARKER,
    '',
    'You collect facts about a branch. You decide nothing and judge nothing —',
    'run the commands below exactly and report what happened. Every number and',
    'path you report must come from output you produced yourself.',
    '',
    'Repository: ' + wave.repoPath,
    'BASE: ' + wave.base,
    'BRANCH: wave/' + t.id,
    '',
    'Steps:',
    '1. Record whether the branch tip differs from BASE:',
    '   git -C ' + wave.repoPath + ' rev-parse ' + wave.base + ' wave/' + t.id,
    '2. Record the changed paths, verbatim, one per array entry:',
    '   git -C ' + wave.repoPath + ' diff --name-only ' + wave.base + '..wave/' + t.id,
    '3. If ' + wt + ' already exists, remove it first:',
    '   git -C ' + wave.repoPath + ' worktree remove --force ' + wt,
    '   Then: git -C ' + wave.repoPath + ' worktree add --detach ' + wt + ' wave/' + t.id,
    '   Run the must_run commands below IN ORDER inside that worktree, as one',
    '   pipeline in one workspace. Record each command\'s exit code and output',
    '   (tail is fine for long green output; keep failures verbatim).',
    '   Build-system commands (gradle, cargo, npm, pnpm, yarn, make, mvn and',
    '   the like) must be started in the background with output to a log file',
    '   and polled — never a silent foreground wait.',
    '4. For each must_run command whose evidence is "required", record whether',
    '   the REPORT below contains pasted output for that command.',
    '5. Clean up: git -C ' + wave.repoPath + ' worktree remove --force ' + wt,
    '',
    'must_run:',
    ...t.contract.must_run.map((m) => '- ' + m.cmd + '  (evidence: ' + m.evidence + ')'),
    '',
    'REPORT (the executor\'s report — scan it only for step 4):',
    String(report),
  ].join('\n')
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    branchHasCommits: { type: 'boolean' },
    filesChanged: { type: 'array', items: { type: 'string' } },
    mustRun: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          cmd: { type: 'string' },
          exit: { type: 'integer' },
          output: { type: 'string' },
          pasteFoundInReport: { type: 'boolean' },
        },
        required: ['cmd', 'exit'],
      },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['branchHasCommits', 'filesChanged', 'mustRun'],
}

// The deterministic half of the contract, applied by the runner itself.
// The verifier supplies facts; nothing here asks a model to judge.
function mechanicalViolations(t, facts) {
  const v = []
  if (facts.branchHasCommits === false) {
    v.push({ rule: 'work must be committed to the branch', class: 'report',
      evidence: 'wave/' + t.id + ' tip equals BASE ' + wave.base.slice(0, 7)
        + ' — the branch carries no commits' })
  }
  const outside = (facts.filesChanged ?? []).filter((p) =>
    !pathAllowed(p, t.contract.files_allowed, t.contract.files_forbidden))
  if (outside.length > 0) {
    v.push({ rule: 'files_allowed: ' + yamlInline(t.contract.files_allowed), class: 'files',
      evidence: 'paths outside the allowed globs: ' + outside.join(', ') })
  }
  for (const m of (facts.mustRun ?? [])) {
    if (m.exit !== 0) {
      v.push({ rule: 'must_run: ' + m.cmd, class: 'must_run',
        evidence: 'exit ' + m.exit + ' when the verifier ran it: '
          + String(m.output ?? '').slice(-2000) })
    }
  }
  for (const m of t.contract.must_run) {
    if (m.evidence !== 'required') continue
    const f = (facts.mustRun ?? []).find((x) => x.cmd === m.cmd)
    if (f && f.pasteFoundInReport === false) {
      v.push({ rule: 'must_run: ' + m.cmd, class: 'report',
        evidence: 'contract says evidence: required and the report pastes no output for this command' })
    }
  }
  return v
}

function reworkPrompt(t, verdict) {
  return executorPrompt(t) + [
    '',
    '',
    '## Prior attempt was rejected',
    'A supervisor checked your branch against the contract and rejected it.',
    'The verdict, including the supervisor\'s own evidence:',
    '',
    JSON.stringify(verdict, null, 2),
    '',
    'Continue in the SAME worktree and branch (wave/' + t.id + '). Fix the',
    'violations. Do not restart from scratch and do not delete the branch.',
  ].join('\n')
}

function supervisorPrompt(t, report, facts) {
  return wave.supervisorPromptText + [
    '',
    '',
    'CONTRACT:',
    renderContract(t.contract),
    '',
    'REPO: ' + wave.repoPath,
    'BASE: ' + wave.base,
    'BRANCH: wave/' + t.id,
    facts ? '' : null,
    facts ? 'VERIFIER FACTS (a separate fact-collecting agent ran the commands itself;'
      + ' you may rely on its exit codes and outputs, and re-run anything you doubt):' : null,
    facts ? JSON.stringify(facts, null, 2) : null,
    '',
    'REPORT:',
    String(report),
  ].filter((line) => line !== null).join('\n')
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    violations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rule: { type: 'string' },
          class: { type: 'string' },
          evidence: { type: 'string' },
          quote: { type: 'string' },
          pasteReproduced: { type: 'boolean' },
          satisfiable: { type: 'boolean' },
        },
        required: ['rule', 'class', 'evidence'],
      },
    },
    remarks: { type: 'array', items: { type: 'string' } },
  },
  required: ['ok', 'violations', 'remarks'],
}

// ---------- the ladder ----------

function defaultLadder(model) {
  const i = LADDER_ORDER.indexOf(model)
  return i === -1 ? [] : LADDER_ORDER.slice(i + 1)
}

function sameRuleRepeat(prevVerdict, verdict) {
  if (!prevVerdict) return false
  const prev = prevVerdict.violations ?? []
  return (verdict.violations ?? []).some((v) =>
    prev.some((p) => p.class === v.class && p.rule === v.rule))
}

async function runTask(t) {
  const rungs = [t.executor.model, ...(t.ladder ?? defaultLadder(t.executor.model))]
  const branch = 'wave/' + t.id
  const attempts = []
  const finish = (status) => ({ id: t.id, status, branch, attempts })
  let pasteStrikes = 0
  let verdictCount = 0
  let prevVerdict = null
  const mechSeen = new Set()

  // One API death is retried once and recorded; a second is a task error —
  // never a wave error.
  async function call(prompt, opts, rung) {
    let r = await agent(prompt, opts)
    if (r === null) {
      attempts.push({ rung, model: opts.model, effort: opts.effort,
                      kind: 'agent-error', verdict: null, escalation: null })
      log(t.id + ': ' + opts.label.split(':')[0] + ' died (' + opts.model + ') — retrying once')
      r = await agent(prompt, opts)
    }
    return r
  }

  for (let rung = 0; rung < rungs.length; rung++) {
    const model = rungs[rung]
    const effort = rung === 0 ? (t.executor.effort ?? 'medium') : 'high'
    for (let attemptOnRung = 1; attemptOnRung <= MAX_ATTEMPTS_PER_RUNG; attemptOnRung++) {
      if (verdictCount >= MAX_ATTEMPTS_PER_TASK) return finish('failed')
      verdictCount++

      const prompt = prevVerdict ? reworkPrompt(t, prevVerdict) : executorPrompt(t)
      log(t.id + ': ' + (prevVerdict ? 'rework' : 'executor') + ' ' + model + '/' + effort
        + ' — rung ' + (rung + 1) + '/' + rungs.length
        + ', attempt ' + verdictCount + '/' + MAX_ATTEMPTS_PER_TASK)
      const report = await call(prompt,
        { model, effort, label: 'exec:' + t.id, phase: 'Wave' }, rung)
      if (report === null) return finish('error')

      // Mechanical verify: cheap facts before an expensive judge. Fail-open —
      // a dead verifier skips the stage and the judge runs everything itself;
      // this stage can only save a judge call, never remove supervision.
      log(t.id + ': report received — verifying (' + verifier.model + ')')
      const facts = await call(verifierPrompt(t, report),
        { model: verifier.model, effort: verifier.effort,
          label: 'verify:' + t.id, phase: 'Wave', schema: VERIFY_SCHEMA }, rung)

      let verdict = null
      let kind = 'verdict'
      if (facts !== null) {
        const mech = mechanicalViolations(t, facts)
        const freshRules = mech.filter((v) => !mechSeen.has(v.class + '|' + v.rule))
        if (mech.length > 0 && freshRules.length === mech.length) {
          // Once per rule: bounce only when every rule in this set is fresh.
          // Any repeated rule routes the whole attempt to the judge — only a
          // judge can decide satisfiable.
          mech.forEach((v) => mechSeen.add(v.class + '|' + v.rule))
          verdict = { ok: false, violations: mech,
            remarks: ['mechanical verification — no model judged this attempt'] }
          kind = 'mechanical'
          log(t.id + ': mechanical reject [' + mech.map((v) => v.class).join(', ')
            + '] — rework without a judge')
        }
      }
      if (verdict === null) {
        log(t.id + ': judging (' + wave.supervisor.model + ')')
        verdict = await call(supervisorPrompt(t, report, facts),
          { model: wave.supervisor.model, effort: wave.supervisor.effort ?? 'high',
            label: 'judge:' + t.id, phase: 'Wave', schema: VERDICT_SCHEMA }, rung)
        if (verdict === null) return finish('error')
      }

      const attempt = { rung, model, effort, kind, verdict, escalation: null }
      attempts.push(attempt)
      const priorVerdict = prevVerdict
      prevVerdict = verdict
      const viols = verdict.violations ?? []
      log(t.id + ': verdict ' + (verdict.ok === true ? 'ok'
        : 'rejected [' + viols.map((v) => v.class).join(', ') + ']'))

      // Priority order is load-bearing; see the spec.
      if (viols.some((v) => v.satisfiable === false)) return finish('contract-unsatisfiable')
      if (verdict.ok === true) return finish('ok')
      if (viols.some((v) => v.pasteReproduced === false)) pasteStrikes++
      if (pasteStrikes >= 2) {
        attempt.escalation = 'paste-two-strikes'
        if (rung + 1 < rungs.length) log(t.id + ': escalating (paste-two-strikes) → ' + rungs[rung + 1])
        break
      }
      if (attemptOnRung === MAX_ATTEMPTS_PER_RUNG) {
        attempt.escalation = sameRuleRepeat(priorVerdict, verdict)
          ? 'same-rule-repeat' : 'rung-exhausted'
        if (rung + 1 < rungs.length) {
          log(t.id + ': escalating (' + attempt.escalation + ') → ' + rungs[rung + 1])
        }
      }
    }
  }
  return finish('failed')
}

phase('Wave')
log('wave: ' + wave.tasks.length + ' task(s) from base ' + wave.base.slice(0, 7))
const results = await pipeline(wave.tasks, (t) => runTask(t))
const tasks = results.map((r, i) => r ??
  { id: wave.tasks[i].id, status: 'error', branch: 'wave/' + wave.tasks[i].id, attempts: [] })
for (const t of tasks) log('task ' + t.id + ': ' + t.status)
return {
  status: tasks.every((t) => t.status === 'ok') ? 'done' : 'partial',
  errors: [],
  tasks,
}
