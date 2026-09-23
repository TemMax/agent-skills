#!/usr/bin/env node
// Deterministic state and mechanical verification for Codex-native waves.
// This helper never calls a model or the network. It prints one JSON object.
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const CODEX_MODELS = ['gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']
const ASTRA = 'gpt-6-astra'
const CODEX_EXECUTOR_MODELS = [...CODEX_MODELS, ASTRA]
const CODEX_SUPERVISORS = [...CODEX_MODELS, ASTRA]
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
export const ACTIONS = ['spawn-executor', 'verify', 'spawn-supervisor', 'merge-ready', 'stop']

const CLAUDE_MODELS = ['claude-haiku-4-5-20251001', 'claude-sonnet-5', 'claude-opus-5-5',
  'claude-opus-5', 'claude-opus-4-8', 'claude-fable-5-1']
const CLAUDE_ALIASES = ['haiku', 'sonnet', 'opus', 'fable']
const isClaudeModel = (model) => CLAUDE_MODELS.includes(model) || CLAUDE_ALIASES.includes(model)
const CONTRACT_KEYS = ['files_allowed', 'files_forbidden', 'must_run',
  'forbidden_moves', 'report_must_answer']
const AGENT_ERRORS = ['null-result', 'transport', 'tool-unavailable']
const COMMANDS = {
  init: ['plan', 'wave', 'repo', 'base'],
  next: ['state'],
  'record-executor': ['state', 'task'],
  verify: ['state', 'task'],
  'supervisor-prompt': ['state', 'task'],
  'record-verdict': ['state', 'task'],
  summary: ['state'],
}
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const SHA = /^[0-9a-f]{40}$/
const MAX_EXECUTOR_ATTEMPTS = 6
const TASK_STATUSES = ['ready', 'reported', 'verified', 'merge-ready',
  'contract-unsatisfiable', 'failed', 'error']
const ESCALATIONS = [null, 'same-rule-repeat', 'rung-exhausted',
  'paste-two-strikes', 'raised-effort']
const STATE_KEYS = ['schema', 'planPath', 'planDigest', 'wave', 'repoPath', 'base',
  'supervisor', 'tasks']
const TASK_KEYS = ['status', 'branch', 'worktree', 'rungs', 'rung',
  'attemptOnRung', 'totalAttempts', 'pasteStrikes', 'reports',
  'verifierFacts', 'verdicts', 'agentFailures']

class NamedError extends Error {
  constructor(name, message) {
    super(name + ': ' + message)
    this.name = name
  }
}

const clone = (value) => JSON.parse(JSON.stringify(value))
const ownKeysAre = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0')

export function atomicWrite(path, value) {
  const tmp = path + '.tmp'
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmp, path)
}

export function parseCli(argv) {
  if (!Array.isArray(argv) || argv.length === 0 || !COMMANDS[argv[0]]) {
    throw new NamedError('usage', 'expected one of ' + Object.keys(COMMANDS).join('|'))
  }
  const command = argv[0]
  const allowed = COMMANDS[command]
  const options = {}
  for (let i = 1; i < argv.length; i += 2) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (!flag || !flag.startsWith('--') || value === undefined) {
      throw new NamedError('usage', command + ': options must be --name value pairs')
    }
    const key = flag.slice(2)
    if (!allowed.includes(key)) throw new NamedError('usage', command + ': unknown option --' + key)
    if (Object.hasOwn(options, key)) throw new NamedError('usage', command + ': duplicate option --' + key)
    options[key] = value
  }
  const missing = allowed.filter((key) => !Object.hasOwn(options, key))
  if (missing.length) throw new NamedError('usage', command + ': missing --' + missing.join(', --'))
  return { command, options }
}

export function extractWavePlan(markdown) {
  if (typeof markdown !== 'string') throw new NamedError('plan-parse', 'plan must be Markdown text')
  const blocks = [...markdown.matchAll(/```json wave-plan\r?\n([\s\S]*?)\r?\n```/g)]
  if (blocks.length !== 1) {
    throw new NamedError('plan-parse', 'expected exactly one ```json wave-plan block, found ' + blocks.length)
  }
  let plan
  try { plan = JSON.parse(blocks[0][1]) } catch (error) {
    throw new NamedError('plan-parse', 'wave-plan JSON does not parse: ' + error.message)
  }
  if (!plan || typeof plan !== 'object' || Array.isArray(plan) || !Array.isArray(plan.waves)) {
    throw new NamedError('plan-parse', '`waves` must be an array')
  }
  return plan
}

function taskProse(markdown, id) {
  const headings = [...markdown.matchAll(/^## Task ([a-z0-9-]+)[ \t]*\r?$/gm)]
  const matches = headings.filter((match) => match[1] === id)
  if (matches.length !== 1) {
    throw new NamedError('plan-prose', 'expected exactly one "## Task ' + id
      + '" section, found ' + matches.length)
  }
  const start = matches[0].index + matches[0][0].length
  const remainder = markdown.slice(start).replace(/^\r?\n/, '')
  const nextHeading = remainder.search(/^## /m)
  const prose = (nextHeading === -1 ? remainder : remainder.slice(0, nextHeading))
    .replace(/\r\n/g, '\n').trim()
  if (prose === '') throw new NamedError('plan-prose', 'task "' + id + '" prose is empty')
  return prose
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
}

function selectedPlanDigest(markdown, wave) {
  const content = {
    wave: canonical(wave),
    taskProse: wave.tasks.map((task) => ({ id: task.id, prose: taskProse(markdown, task.id) })),
  }
  return createHash('sha256').update(JSON.stringify(content)).digest('hex')
}

export function validateCodexWave(wave, index) {
  const at = 'waves[' + index + ']'
  const errors = []
  if (!wave || typeof wave !== 'object' || Array.isArray(wave)) return [at + ': must be an object']
  const supervisor = wave.supervisor
  if (!supervisor || typeof supervisor !== 'object' || Array.isArray(supervisor)) {
    errors.push(at + '.supervisor: required')
  } else {
    if (!CODEX_SUPERVISORS.includes(supervisor.model)) {
      errors.push(at + '.supervisor.model: ' + (isClaudeModel(supervisor.model)
        ? 'host-mismatch: Claude model in Codex wave'
        : 'one of ' + CODEX_SUPERVISORS.join('/')))
    }
    if (!EFFORTS.includes(supervisor.effort)) {
      errors.push(at + '.supervisor.effort: explicit value required; one of ' + EFFORTS.join('/'))
    }
  }
  if (!Array.isArray(wave.tasks) || wave.tasks.length === 0) {
    errors.push(at + '.tasks: non-empty array required')
    return errors
  }
  const ids = []
  wave.tasks.forEach((task, taskIndex) => {
    const tat = at + '.tasks[' + taskIndex + ']'
    if (!task || typeof task !== 'object' || Array.isArray(task)) {
      errors.push(tat + ': must be an object')
      return
    }
    if (typeof task.id !== 'string' || !KEBAB.test(task.id)) {
      errors.push(tat + '.id: kebab-case required')
    } else {
      ids.push(task.id)
      if (task.branch !== 'wave/' + task.id) errors.push(tat + '.branch: must be "wave/' + task.id + '"')
    }
    const executor = task.executor
    if (!executor || typeof executor !== 'object' || Array.isArray(executor)) {
      errors.push(tat + '.executor: required')
    } else {
      if (!CODEX_EXECUTOR_MODELS.includes(executor.model)) {
        errors.push(tat + '.executor.model: ' + (isClaudeModel(executor.model)
          ? 'host-mismatch: Claude model in Codex wave'
          : 'one of ' + CODEX_EXECUTOR_MODELS.join('/')))
      }
      if (!EFFORTS.includes(executor.effort)) {
        errors.push(tat + '.executor.effort: explicit value required; one of ' + EFFORTS.join('/'))
      }
    }
    if (task.ladder !== undefined && (!Array.isArray(task.ladder)
      || task.ladder.some((model) => !CODEX_EXECUTOR_MODELS.includes(model)))) {
      const hostMismatch = Array.isArray(task.ladder)
        && task.ladder.some(isClaudeModel)
      errors.push(tat + '.ladder: ' + (hostMismatch ? 'host-mismatch: Claude model in Codex wave'
        : 'array of ' + CODEX_EXECUTOR_MODELS.join('/')))
    }
    const transitions = executor && CODEX_EXECUTOR_MODELS.includes(executor.model)
      ? [executor.model, ...(Array.isArray(task.ladder) ? task.ladder : [])] : []
    const usesAstra = transitions.includes(ASTRA)
    const astraReasonValid = typeof task.astra_executor_reason === 'string'
      && task.astra_executor_reason.trim() !== ''
    if (usesAstra) {
      if (!astraReasonValid) {
        errors.push(tat + '.astra_executor_reason: non-empty string required for Astra execution')
      }
      if (transitions.at(-1) !== ASTRA) {
        errors.push(tat + '.ladder: gpt-6-astra must be the final executor rung')
      }
      if (!supervisor || supervisor.model !== ASTRA) {
        errors.push(tat + ': Astra execution requires exact gpt-6-astra supervisor')
      }
    } else if (Object.hasOwn(task, 'astra_executor_reason')) {
      errors.push(tat + '.astra_executor_reason: only allowed when Astra is an executor or ladder rung')
    }
    if (transitions.length > 0) {
      if (new Set(transitions).size !== transitions.length) {
        errors.push(tat + '.ladder: ladder transitions must use distinct models across executor and ladder')
      }
    }
    if (supervisor && executor
      && [executor.model, ...(Array.isArray(task.ladder) ? task.ladder : [])]
        .includes(supervisor.model)
      && !(usesAstra && astraReasonValid && supervisor.model === ASTRA)) {
      errors.push(tat + ': supervisor model also appears as executor or ladder rung')
    }
    const contract = task.contract
    if (!contract || typeof contract !== 'object' || Array.isArray(contract)) {
      errors.push(tat + '.contract: required, with all five keys')
    } else {
      for (const key of CONTRACT_KEYS) {
        if (!Array.isArray(contract[key])) errors.push(tat + '.contract.' + key + ': array required')
      }
      if (Array.isArray(contract.must_run)) contract.must_run.forEach((item, itemIndex) => {
        if (!item || typeof item !== 'object' || typeof item.cmd !== 'string' || item.cmd === '') {
          errors.push(tat + '.contract.must_run[' + itemIndex + '].cmd: required')
        }
        if (!item || typeof item !== 'object' || typeof item.evidence !== 'string') {
          errors.push(tat + '.contract.must_run[' + itemIndex + '].evidence: required')
        }
      })
    }
  })
  for (const id of new Set(ids.filter((value, i) => ids.indexOf(value) !== i))) {
    errors.push(at + ': duplicate task id "' + id + '"')
  }
  return errors
}

export function makeState({ planPath, planDigest, waveNumber, repoPath, base, wave }) {
  const tasks = {}
  for (const task of wave.tasks) {
    tasks[task.id] = {
      status: 'ready',
      branch: task.branch,
      worktree: join(repoPath, '.worktrees', 'wave-' + task.id),
      rungs: [task.executor.model, ...(task.ladder ?? [])],
      rung: 0,
      attemptOnRung: 0,
      totalAttempts: 0,
      pasteStrikes: 0,
      reports: [],
      verifierFacts: [],
      verdicts: [],
      agentFailures: [],
    }
  }
  return {
    schema: 1,
    planPath,
    planDigest,
    wave: waveNumber,
    repoPath,
    base,
    supervisor: {
      model: wave.supervisor.model,
      effort: wave.supervisor.effort,
    },
    tasks,
  }
}

function readPlanWave(state) {
  let markdown
  try { markdown = readFileSync(state.planPath, 'utf8') } catch (error) {
    throw new NamedError('plan-read', error.message)
  }
  const plan = extractWavePlan(markdown)
  const wave = plan.waves[state.wave - 1]
  if (!wave) throw new NamedError('state-schema', 'selected wave no longer exists in plan')
  return { markdown, wave }
}

function taskSpec(state, id) {
  const { markdown, wave } = readPlanWave(state)
  const task = wave.tasks.find((candidate) => candidate && candidate.id === id)
  if (!task) throw new NamedError('state-schema', 'task "' + id + '" no longer exists in plan')
  return { ...task, prose: taskProse(markdown, id) }
}

const nonemptyString = (value) => typeof value === 'string' && value.length > 0
const boundedInteger = (value, max) => Number.isInteger(value) && value >= 0 && value <= max

function validProcessFact(fact) {
  if (!fact || typeof fact !== 'object' || Array.isArray(fact)) return false
  const keys = Object.keys(fact)
  if (!keys.every((key) => ['exit', 'stdout', 'stderr', 'error'].includes(key))) return false
  return Object.hasOwn(fact, 'exit') && Object.hasOwn(fact, 'stdout')
    && Object.hasOwn(fact, 'stderr')
    && (fact.exit === null || boundedInteger(fact.exit, Number.MAX_SAFE_INTEGER))
    && typeof fact.stdout === 'string' && typeof fact.stderr === 'string'
    && (fact.error === undefined || typeof fact.error === 'string')
}

function validMechanicalViolation(violation) {
  return ownKeysAre(violation, ['class', 'rule', 'evidence'])
    && nonemptyString(violation.class) && nonemptyString(violation.rule)
    && typeof violation.evidence === 'string'
}

function validVerifierFact(fact, state, task) {
  if (!ownKeysAre(fact, ['base', 'branch', 'currentBranch', 'baseIsAncestor',
    'worktreeStatus', 'preflightPassed', 'changedPaths', 'commitCount', 'diff',
    'git', 'mustRun', 'violations'])) return false
  if (fact.base !== state.base || fact.branch !== task.branch
    || (fact.currentBranch !== null && typeof fact.currentBranch !== 'string')
    || typeof fact.baseIsAncestor !== 'boolean' || typeof fact.worktreeStatus !== 'string'
    || typeof fact.preflightPassed !== 'boolean'
    || !Array.isArray(fact.changedPaths) || fact.changedPaths.some((path) => !nonemptyString(path))
    || (fact.commitCount !== null && !boundedInteger(fact.commitCount, Number.MAX_SAFE_INTEGER))
    || typeof fact.diff !== 'string' || !Array.isArray(fact.mustRun)
    || !Array.isArray(fact.violations)
    || fact.violations.some((violation) => !validMechanicalViolation(violation))) return false
  if (!ownKeysAre(fact.git, ['branch', 'ancestor', 'status', 'names', 'diff', 'count'])
    || Object.values(fact.git).some((entry) => !validProcessFact(entry))) return false
  return fact.mustRun.every((entry) => {
    const normal = ownKeysAre(entry, ['cmd', 'evidence', 'attempts'])
    const skipped = ownKeysAre(entry, ['cmd', 'evidence', 'attempts', 'skipped'])
      && entry.skipped === 'safety-preflight'
    return (normal || skipped) && nonemptyString(entry.cmd) && typeof entry.evidence === 'string'
      && Array.isArray(entry.attempts) && entry.attempts.length <= 2
      && entry.attempts.every(validProcessFact)
      && (!skipped || entry.attempts.length === 0)
  })
}

function validVerdictHistoryEntry(entry, task) {
  return ownKeysAre(entry, ['rung', 'attemptOnRung', 'model', 'effort', 'verdict', 'escalation'])
    && boundedInteger(entry.rung, task.rungs.length - 1)
    && boundedInteger(entry.attemptOnRung, 2)
    && entry.model === task.rungs[entry.rung] && EFFORTS.includes(entry.effort)
    && validVerdict(entry.verdict) && ESCALATIONS.includes(entry.escalation)
}

function outputEvidencePresent(report, entry) {
  if (entry.evidence !== 'required') return true
  const finalAttempt = entry.attempts.at(-1)
  if (!finalAttempt) return false
  const lines = (finalAttempt.stdout + '\n' + finalAttempt.stderr)
    .split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length >= 2)
  return lines.length === 0 || lines.some((line) => report.includes(line))
}

function mergeReadyHasCleanHistories(task, spec) {
  if (task.totalAttempts < 1 || task.reports.length !== task.totalAttempts
    || task.verifierFacts.length !== task.reports.length
    || task.verdicts.length !== task.reports.length) return false
  const fact = task.verifierFacts.at(-1)
  const verdict = task.verdicts.at(-1)
  if (!fact || !verdict || verdict.verdict.ok !== true
    || verdict.verdict.violations.length !== 0 || verdict.escalation !== null
    || fact.violations.length !== 0 || fact.preflightPassed !== true
    || fact.currentBranch !== task.branch || fact.baseIsAncestor !== true
    || fact.worktreeStatus !== '' || !Number.isInteger(fact.commitCount)
    || fact.commitCount < 1) return false
  if (Object.values(fact.git).some((process) => process.exit !== 0 || process.error !== undefined)) {
    return false
  }
  if (fact.changedPaths.some((path) => !matchesAny(path, spec.contract.files_allowed)
    || matchesAny(path, spec.contract.files_forbidden))) return false
  if (fact.mustRun.length !== spec.contract.must_run.length) return false
  // A green final attempt is its own evidence (see verifyTask's must_run loop),
  // so this re-derivation requires only exit 0, matching that same rule.
  return spec.contract.must_run.every((expected, index) => {
    const actual = fact.mustRun[index]
    const finalAttempt = actual && actual.attempts.at(-1)
    return actual && actual.cmd === expected.cmd && actual.evidence === expected.evidence
      && actual.skipped === undefined && finalAttempt && finalAttempt.exit === 0
      && finalAttempt.error === undefined
  })
}

function validateStoredState(state, statePath) {
  const errors = []
  const err = (field, message) => errors.push(field + ': ' + message)
  if (!ownKeysAre(state, STATE_KEYS)) {
    return ['state: expected exact schema-1 top-level fields']
  }
  if (state.schema !== 1) err('schema', 'expected 1')
  if (!nonemptyString(state.planPath)) err('planPath', 'non-empty string required')
  if (typeof state.planDigest !== 'string' || !/^[0-9a-f]{64}$/.test(state.planDigest)) {
    err('planDigest', 'lowercase sha256 required')
  }
  if (!nonemptyString(state.repoPath)) err('repoPath', 'non-empty string required')
  if (!Number.isInteger(state.wave) || state.wave < 1) err('wave', 'positive integer required')
  if (!SHA.test(state.base)) err('base', 'full lowercase 40-hex SHA required')
  if (!ownKeysAre(state.supervisor, ['model', 'effort'])) {
    err('supervisor', 'exact model and effort required')
  } else {
    if (!CODEX_SUPERVISORS.includes(state.supervisor.model)) err('supervisor.model', 'unsupported Codex model')
    if (!EFFORTS.includes(state.supervisor.effort)) err('supervisor.effort', 'unsupported effort')
  }
  if (!state.tasks || typeof state.tasks !== 'object' || Array.isArray(state.tasks)
    || Object.keys(state.tasks).length === 0) err('tasks', 'non-empty object required')
  if (errors.length) return errors

  const planName = basename(state.planPath).replace(/\.[^.]+$/, '')
  const expectedStatePath = join(state.repoPath, '.worktrees', 'codex-wave',
    planName + '-w' + state.wave + '-' + state.base.slice(0, 12) + '.json')
  try {
    if (realpathSync(statePath) !== realpathSync(expectedStatePath)) {
      err('state path', 'does not match schema fields')
    }
  } catch {
    err('state path', 'does not match schema fields')
  }

  let wave
  let markdown
  let planWaveValid = false
  try {
    markdown = readFileSync(state.planPath, 'utf8')
    const plan = extractWavePlan(markdown)
    wave = plan.waves[state.wave - 1]
    if (!wave) err('wave', 'selected plan wave does not exist')
    else {
      const waveErrors = validateCodexWave(wave, state.wave - 1)
      if (waveErrors.length) err('plan wave', waveErrors.join('; '))
      else planWaveValid = true
    }
  } catch (error) {
    err('planPath', error.message)
  }
  if (!wave) return errors
  try {
    if (state.planDigest !== selectedPlanDigest(markdown, wave)) {
      err('plan digest', 'approved selected wave/task content changed; reinitialization required')
    }
  } catch (error) {
    err('plan digest', error.message + '; reinitialization required')
  }
  if (!planWaveValid) return errors
  const expectedSupervisor = {
    model: wave.supervisor.model,
    effort: wave.supervisor.effort,
  }
  if (state.supervisor.model !== expectedSupervisor.model
    || state.supervisor.effort !== expectedSupervisor.effort) {
    err('supervisor', 'does not match selected plan wave')
  }
  const planIds = wave.tasks.map((task) => task.id)
  const stateIds = Object.keys(state.tasks)
  if (planIds.length !== stateIds.length || planIds.some((id, index) => id !== stateIds[index])) {
    err('tasks', 'ids/order do not match selected plan wave')
  }
  for (const id of stateIds) {
    const task = state.tasks[id]
    const spec = wave.tasks.find((candidate) => candidate.id === id)
    if (!KEBAB.test(id)) err('tasks.' + id, 'kebab id required')
    if (!ownKeysAre(task, TASK_KEYS)) {
      err('tasks.' + id, 'expected exact schema-1 task fields')
      continue
    }
    if (!TASK_STATUSES.includes(task.status)) err('tasks.' + id + '.status', 'unsupported status')
    if (task.branch !== 'wave/' + id || (spec && task.branch !== spec.branch)) {
      err('tasks.' + id + '.branch', 'must be wave/' + id + ' and match plan')
    }
    const expectedWorktree = join(state.repoPath, '.worktrees', 'wave-' + id)
    if (task.worktree !== expectedWorktree) err('tasks.' + id + '.worktree', 'does not match repo/task')
    const rungsValid = Array.isArray(task.rungs) && task.rungs.length > 0
      && task.rungs.every((model) => CODEX_EXECUTOR_MODELS.includes(model))
      && new Set(task.rungs).size === task.rungs.length
    if (!rungsValid
      || task.rungs.some((model) => !CODEX_EXECUTOR_MODELS.includes(model))) {
      err('tasks.' + id + '.rungs', 'non-empty distinct supported Codex models required')
    } else {
      const usesAstra = task.rungs.includes(ASTRA)
      if (usesAstra && (task.rungs.at(-1) !== ASTRA || state.supervisor.model !== ASTRA)) {
        err('tasks.' + id + '.rungs', 'Astra requires a final rung and exact Astra supervisor')
      }
      if (task.rungs.includes(state.supervisor.model)
        && !(usesAstra && state.supervisor.model === ASTRA)) {
        err('tasks.' + id + '.rungs', 'supervisor model also appears as executor or ladder rung')
      }
      if (spec) {
        const expectedRungs = [spec.executor.model, ...(spec.ladder ?? [])]
        if (JSON.stringify(task.rungs) !== JSON.stringify(expectedRungs)) {
          err('tasks.' + id + '.rungs', 'do not match selected plan task')
        }
      }
    }
    const rungMax = Array.isArray(task.rungs) && task.rungs.length ? task.rungs.length - 1 : -1
    if (!boundedInteger(task.rung, rungMax)) err('tasks.' + id + '.rung', 'out of bounds')
    const attemptOnRungValid = boundedInteger(task.attemptOnRung, 2)
    const totalAttemptsValid = boundedInteger(task.totalAttempts, MAX_EXECUTOR_ATTEMPTS)
    if (!attemptOnRungValid) err('tasks.' + id + '.attemptOnRung', '0..2 required')
    if (!totalAttemptsValid) {
      err('tasks.' + id + '.totalAttempts', '0..' + MAX_EXECUTOR_ATTEMPTS + ' required')
    }
    if (attemptOnRungValid && totalAttemptsValid && task.attemptOnRung > task.totalAttempts) {
      err('tasks.' + id + '.attemptOnRung', 'cannot exceed totalAttempts')
    }
    if (totalAttemptsValid && task.status === 'ready'
      && task.totalAttempts === MAX_EXECUTOR_ATTEMPTS) {
      err('tasks.' + id + '.status', 'ready at executor attempt cap')
    }
    if (!boundedInteger(task.pasteStrikes, 2)) err('tasks.' + id + '.pasteStrikes', '0..2 required')
    if (!Array.isArray(task.reports) || task.reports.some((report) => typeof report !== 'string')) {
      err('tasks.' + id + '.reports', 'string array required')
    } else if (task.reports.length !== task.totalAttempts) {
      err('tasks.' + id + '.reports', 'length must equal totalAttempts')
    }
    if (!Array.isArray(task.verifierFacts)
      || task.verifierFacts.some((fact) => !validVerifierFact(fact, state, task))) {
      err('tasks.' + id + '.verifierFacts', 'invalid verifier history')
    }
    if (!Array.isArray(task.verdicts) || (!rungsValid && task.verdicts.length > 0)
      || (rungsValid && task.verdicts.some((entry) => !validVerdictHistoryEntry(entry, task)))) {
      err('tasks.' + id + '.verdicts', 'invalid verdict history')
    }
    if (!Array.isArray(task.agentFailures) || task.agentFailures.some((failure) =>
      !ownKeysAre(failure, ['point', 'kind', 'attempt'])
      || !['executor', 'supervisor'].includes(failure.point)
      || !AGENT_ERRORS.includes(failure.kind)
      || !Number.isInteger(failure.attempt) || failure.attempt < 1
      || failure.attempt > MAX_EXECUTOR_ATTEMPTS)) {
      err('tasks.' + id + '.agentFailures', 'invalid typed failure history')
    }
    if (Array.isArray(task.verifierFacts) && Array.isArray(task.reports)
      && task.verifierFacts.length > task.reports.length) {
      err('tasks.' + id + '.verifierFacts', 'cannot outnumber reports')
    }
    if (Array.isArray(task.verdicts) && Array.isArray(task.verifierFacts)
      && task.verdicts.length > task.verifierFacts.length) {
      err('tasks.' + id + '.verdicts', 'cannot outnumber verifier facts')
    }
    if (task.status === 'merge-ready' && spec && Array.isArray(task.reports)
      && Array.isArray(task.verifierFacts) && Array.isArray(task.verdicts)
      && !mergeReadyHasCleanHistories(task, spec)) {
      err('tasks.' + id + '.merge-ready', 'requires supporting clean histories')
    }
  }
  return errors
}

function requireTask(state, id) {
  const task = state.tasks && state.tasks[id]
  if (!task) throw new NamedError('task-not-found', id)
  return task
}

function baseEffort(state, id, task) {
  const spec = taskSpec(state, id)
  return task.rung === 0 ? spec.executor.effort : 'high'
}

function nextHigherEffort(effort) {
  const supported = EFFORTS.slice(0, EFFORTS.indexOf('max'))
  const index = supported.indexOf(effort)
  return index === -1 ? null : (supported[index + 1] ?? null)
}

function currentEffort(state, id, task) {
  const normal = baseEffort(state, id, task)
  const latest = task.verdicts.at(-1)
  return latest && latest.rung === task.rung && latest.escalation === 'raised-effort'
    ? nextHigherEffort(latest.effort)
    : normal
}

function executorPrompt(state, id, task, spec) {
  const prior = task.verdicts.at(-1)
  const astraException = task.rungs[task.rung] === ASTRA
  return [
    '# Task: ' + id,
    '',
    '## Context',
    spec.prose,
    '',
    'The user already approved this exact wave plan and task. Begin implementation immediately;',
    'do not request another design or approval. The dead-end rules below still apply.',
    astraException ? '' : null,
    astraException ? '## Explicit Astra executor exception' : null,
    astraException ? spec.astra_executor_reason : null,
    '',
    'You work in your own git worktree. You will not see any other task\'s',
    'edits; a quiet tree is expected, not a sign something is wrong.',
    '',
    '## Workspace (already prepared)',
    'BASE: ' + state.base,
    'BRANCH: ' + task.branch,
    'WORKTREE: ' + task.worktree,
    'Work and commit only inside the existing worktree above.',
    '',
    '## Boundaries',
    'You may change only paths matching: ' + JSON.stringify(spec.contract.files_allowed),
    spec.contract.files_forbidden.length > 0
      ? 'You must not touch: ' + JSON.stringify(spec.contract.files_forbidden) : null,
    'Do not refactor adjacent code. Do not add unrequested features or files.',
    '',
    '## Dead-end protocol',
    'If data or access is missing, a tool is broken, or the path is impossible —',
    'stop and report what is blocking you. Do not invent values, do not work',
    'around the restriction, and do not pick an interpretation on the user\'s behalf.',
    '',
    '## Prohibitions',
    'Do not spawn subagents. No force-push, no reset --hard, and no rm outside',
    'the task\'s files. Do not work around a failing check — report it.',
    '',
    '## Definition of done and report format',
    'Report the changed files, the gist of the change, the verbatim output of',
    'every must_run command actually executed, and an answer to every',
    'report_must_answer question. Commit every change before reporting.',
    'Also paste: git log --oneline ' + state.base + '..HEAD (non-empty) and',
    'git status --porcelain (empty). A pass claim without required pasted output',
    'is a contract violation.',
    '',
    '## Contract (a supervisor will check every line against your branch)',
    JSON.stringify(spec.contract, null, 2),
    prior ? '' : null,
    prior ? 'PRIOR VERDICT:' : null,
    prior ? JSON.stringify(prior.verdict, null, 2) : null,
    prior ? 'Continue in the same worktree and branch; fix the violations.' : null,
  ].filter((line) => line !== null).join('\n')
}

export function nextAction(state) {
  const entries = Object.entries(state.tasks ?? {})
  let firstMergeReady = null
  const mergeReadyIds = []
  for (const [id, task] of entries) {
    const common = { status: 'ok', task: id, branch: task.branch, worktree: task.worktree }
    if (task.status === 'ready') {
      const spec = taskSpec(state, id)
      const latest = task.verdicts.at(-1)
      return {
        ...common,
        action: 'spawn-executor',
        model: task.rungs[task.rung],
        effort: currentEffort(state, id, task),
        ...(task.rungs[task.rung] === ASTRA
          ? { astraExecutorReason: spec.astra_executor_reason } : {}),
        ...(latest && latest.escalation ? { reason: latest.escalation } : {}),
        prompt: executorPrompt(state, id, task, spec),
      }
    }
    if (task.status === 'reported') return { ...common, action: 'verify' }
    if (task.status === 'verified') {
      const sameModelReview = task.rungs[task.rung] === ASTRA
      return {
        ...common,
        action: 'spawn-supervisor',
        model: state.supervisor.model,
        effort: state.supervisor.effort,
        ...(sameModelReview ? { reviewContext: 'fresh', sameModelReview: true } : {}),
      }
    }
    if (task.status === 'merge-ready') {
      firstMergeReady ??= common
      mergeReadyIds.push(id)
      continue
    }
    if (['contract-unsatisfiable', 'failed', 'error'].includes(task.status)) {
      return { ...common, action: 'stop', reason: task.status }
    }
    throw new NamedError('state-schema', 'unknown task status "' + task.status + '"')
  }
  if (entries.length > 0 && mergeReadyIds.length === entries.length) {
    return { ...firstMergeReady, action: 'merge-ready', tasks: mergeReadyIds }
  }
  throw new NamedError('state-schema', 'state has no tasks')
}

function isAgentError(result) {
  return ownKeysAre(result, ['error']) && ownKeysAre(result.error, ['kind'])
    && AGENT_ERRORS.includes(result.error.kind)
}

function appendAgentFailure(task, point, kind, attempt) {
  task.agentFailures.push({ point, kind, attempt })
  let consecutive = 0
  for (let i = task.agentFailures.length - 1; i >= 0; i--) {
    const failure = task.agentFailures[i]
    if (failure.point !== point || failure.attempt !== attempt) break
    consecutive++
  }
  if (consecutive >= 2) task.status = 'error'
}

export function recordExecutor(state, id, result) {
  const updated = clone(state)
  const task = requireTask(updated, id)
  if (task.status !== 'ready') throw new NamedError('state-transition', id + ': executor not expected')
  if (task.totalAttempts >= MAX_EXECUTOR_ATTEMPTS) {
    throw new NamedError('state-transition', id + ': executor attempt cap reached')
  }
  if (isAgentError(result)) {
    appendAgentFailure(task, 'executor', result.error.kind, task.totalAttempts + 1)
    return updated
  }
  if (!ownKeysAre(result, ['report']) || typeof result.report !== 'string') {
    throw new NamedError('executor-result', 'expected exactly {"report":"..."} or a fixed typed error')
  }
  task.reports.push(result.report)
  task.totalAttempts++
  task.attemptOnRung++
  task.status = 'reported'
  return updated
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return {
    exit: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error.code ?? result.error.message } : {}),
  }
}

function globRegex(glob) {
  let expression = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]
    if (char === '*' && glob[i + 1] === '*') { expression += '.*'; i++ }
    else if (char === '*') expression += '[^/]*'
    else if (char === '?') expression += '[^/]'
    else expression += char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
  }
  return new RegExp('^' + expression + '$')
}

const matchesAny = (path, globs) => globs.some((glob) => typeof glob === 'string'
  && globRegex(glob).test(path))

function runContractCommand(cmd, cwd) {
  const result = spawnSync(cmd, { cwd, encoding: 'utf8', shell: true })
  return {
    exit: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    ...(result.error ? { error: result.error.code ?? result.error.message } : {}),
  }
}

// Keyed by head SHA under the state file's own directory, so a re-verify of
// an unchanged commit can reuse a prior mechanical must_run run instead of
// re-executing it. Never reused across a different head SHA or a contract
// whose must_run list has since changed (contractDigest guards that).
function verifyCachePath(state, headSha) {
  return join(state.repoPath, '.worktrees', 'codex-wave', 'verify-cache', headSha + '.json')
}

function readVerifyCache(state, headSha, contractDigest) {
  try {
    const raw = JSON.parse(readFileSync(verifyCachePath(state, headSha), 'utf8'))
    if (raw && typeof raw === 'object' && raw.contractDigest === contractDigest
      && Array.isArray(raw.mustRun)) return raw.mustRun
  } catch { /* no usable cache entry; fall through to a real run */ }
  return null
}

function writeVerifyCache(state, headSha, contractDigest, mustRun) {
  const path = verifyCachePath(state, headSha)
  mkdirSync(dirname(path), { recursive: true })
  atomicWrite(path, { contractDigest, mustRun })
}

function runContractSequence(repo, head, entries) {
  const root = mkdtempSync(join(tmpdir(), 'codex-wave-verify-'))
  const checkout = join(root, 'checkout')
  let created = false
  try {
    const added = runGit(repo, ['worktree', 'add', '--detach', checkout, head])
    if (added.exit !== 0) {
      throw new NamedError('verification-worktree', added.stderr || added.error || 'checkout failed')
    }
    created = true
    return entries.map((entry) => runContractCommand(entry.cmd, checkout))
  } finally {
    // This disposable checkout belongs only to this sequence attempt. Its
    // generated and ignored artifacts must not reach the next attempt.
    try {
      if (created) {
        const removed = runGit(repo, ['worktree', 'remove', '--force', checkout])
        if (removed.exit !== 0) {
          throw new NamedError('verification-worktree', removed.stderr || removed.error || 'cleanup failed')
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
}

export function verifyTask(state, id) {
  const updated = clone(state)
  const task = requireTask(updated, id)
  if (task.status !== 'reported') throw new NamedError('state-transition', id + ': verify not expected')
  const spec = taskSpec(updated, id)
  const branch = runGit(task.worktree, ['branch', '--show-current'])
  const ancestor = runGit(task.worktree,
    ['merge-base', '--is-ancestor', updated.base, 'HEAD'])
  const status = runGit(task.worktree, ['status', '--porcelain', '--untracked-files=all'])
  const currentBranch = branch.exit === 0 ? branch.stdout.trim() : null
  const baseIsAncestor = ancestor.exit === 0
  const worktreeStatus = status.stdout
  const preflightViolations = []
  if (branch.exit !== 0 || currentBranch !== task.branch) preflightViolations.push({
    class: 'git',
    rule: 'current branch must equal ' + task.branch,
    evidence: currentBranch ?? branch.stderr ?? branch.error ?? '',
  })
  if (!baseIsAncestor) preflightViolations.push({
    class: 'git',
    rule: 'base must be an ancestor of HEAD',
    evidence: 'git merge-base --is-ancestor exited ' + String(ancestor.exit)
      + (ancestor.stderr || ancestor.error || ''),
  })
  if (status.exit !== 0) preflightViolations.push({
    class: 'git',
    rule: 'git status must establish task worktree state',
    evidence: status.stderr || status.error || '',
  })
  else if (worktreeStatus !== '') preflightViolations.push({
    class: 'worktree',
    rule: 'task worktree must be clean before verification',
    evidence: worktreeStatus,
  })
  const preflightPassed = preflightViolations.length === 0
  const names = runGit(task.worktree, ['diff', '--name-only', updated.base + '..HEAD'])
  const binaryDiff = runGit(task.worktree,
    ['diff', '--no-ext-diff', '--binary', updated.base + '..HEAD'])
  const count = runGit(task.worktree, ['rev-list', '--count', updated.base + '..HEAD'])
  const changedPaths = names.exit === 0
    ? names.stdout.split(/\r?\n/).filter(Boolean)
    : []
  const commitCount = count.exit === 0 && /^\d+\s*$/.test(count.stdout)
    ? Number(count.stdout.trim())
    : null
  const violations = [...preflightViolations]
  if (names.exit !== 0) violations.push({
    class: 'git', rule: 'git diff --name-only must succeed', evidence: names.stderr || names.error || '',
  })
  if (binaryDiff.exit !== 0) violations.push({
    class: 'git', rule: 'git diff --binary must succeed', evidence: binaryDiff.stderr || binaryDiff.error || '',
  })
  if (count.exit !== 0) violations.push({
    class: 'git', rule: 'git rev-list --count must succeed', evidence: count.stderr || count.error || '',
  })
  else if (commitCount === 0) violations.push({
    class: 'commits', rule: 'branch must contain at least one commit', evidence: 'commit count: 0',
  })
  for (const path of changedPaths) {
    const allowed = matchesAny(path, spec.contract.files_allowed)
    const forbidden = matchesAny(path, spec.contract.files_forbidden)
    if (!allowed || forbidden) violations.push({
      class: 'files',
      rule: forbidden ? 'files_forbidden' : 'files_allowed',
      evidence: path,
    })
  }
  const mustRun = spec.contract.must_run.map((entry) => ({
    cmd: entry.cmd, evidence: entry.evidence, attempts: [],
    ...(!preflightPassed ? { skipped: 'safety-preflight' } : {}),
  }))
  if (preflightPassed && mustRun.length > 0) {
    const head = runGit(task.worktree, ['rev-parse', '--verify', 'HEAD^{commit}'])
    if (head.exit !== 0 || !SHA.test(head.stdout.trim())) {
      throw new NamedError('verification-worktree', head.stderr || head.error || 'task HEAD is not a commit')
    }
    const headSha = head.stdout.trim()
    const contractDigest = createHash('sha256').update(JSON.stringify(spec.contract.must_run)).digest('hex')
    const cached = readVerifyCache(updated, headSha, contractDigest)
    if (cached) {
      cached.forEach((entry, index) => { if (mustRun[index]) mustRun[index].attempts = entry.attempts })
    } else {
      // Pin both complete attempts to the committed task head. Preceding
      // commands may generate prerequisites or poison their successors.
      for (let attempt = 0; attempt < 2; attempt++) {
        const results = runContractSequence(updated.repoPath, headSha, mustRun)
        results.forEach((result, index) => mustRun[index].attempts.push(result))
        if (results.every((result) => result.exit === 0)) break
      }
      writeVerifyCache(updated, headSha, contractDigest, mustRun)
    }
  }
  for (const recorded of mustRun) {
    if (!preflightPassed) continue
    const { cmd, attempts } = recorded
    const finalAttemptFailed = attempts.at(-1).exit !== 0
    if (finalAttemptFailed) violations.push({
      class: 'must_run',
      rule: cmd,
      evidence: 'exit ' + String(attempts.at(-1).exit) + '\n'
        + attempts.at(-1).stdout + attempts.at(-1).stderr,
    })
    // A green final attempt is itself the evidence for the command, so a
    // missing paste is only a violation when that final attempt was red.
    if (finalAttemptFailed && !outputEvidencePresent(task.reports.at(-1), recorded)) violations.push({
      class: 'report',
      rule: 'must_run: ' + cmd + ' requires pasted evidence',
      evidence: 'the executor report contains none of the verifier command output',
    })
  }
  const facts = {
    base: updated.base,
    branch: task.branch,
    currentBranch,
    baseIsAncestor,
    worktreeStatus,
    preflightPassed,
    changedPaths,
    commitCount,
    diff: binaryDiff.stdout,
    git: { branch, ancestor, status, names, diff: binaryDiff, count },
    mustRun,
    violations,
  }
  task.verifierFacts.push(facts)
  task.status = 'verified'
  return updated
}

export function buildSupervisorPrompt(state, id, promptText) {
  const task = requireTask(state, id)
  if (task.status !== 'verified') {
    throw new NamedError('state-transition', id + ': supervisor prompt not expected before verification')
  }
  if (typeof promptText !== 'string' || promptText === '') {
    throw new NamedError('supervisor-prompt', 'prompt text is required')
  }
  const spec = taskSpec(state, id)
  const executorModel = task.rungs[task.rung]
  const report = String(task.reports.at(-1)).split(executorModel)
    .join('[executor-model-redacted]')
  const facts = task.verifierFacts.at(-1)
  let verifierFactsJson = JSON.stringify(facts, null, 2)
  // The stored state always keeps the full diff; only this prompt copy is
  // capped, so a huge diff cannot blow up the supervisor's context window.
  if (verifierFactsJson.length > 60000) {
    const omit = (text) => '[omitted: ' + text.length + ' characters; read it with git diff '
      + state.base + '..' + task.branch + ']'
    const promptFacts = clone(facts)
    promptFacts.diff = omit(facts.diff)
    promptFacts.git = { ...promptFacts.git, diff: { ...promptFacts.git.diff, stdout: omit(facts.git.diff.stdout) } }
    verifierFactsJson = JSON.stringify(promptFacts, null, 2)
  }
  return promptText + [
    '',
    '',
    'CODEX OUTPUT CONTRACT:',
    'Return one JSON object with exactly these three root keys:',
    '{"ok": boolean, "violations": array, "remarks": array of strings}.',
    'For a clean result, use {"ok":true,"violations":[],"remarks":["evidence summary"]}.',
    'Describe successful pasted-output comparisons in remarks.',
    'For a failing result, use ok:false and put each finding in violations.',
    'Each violation has rule, class and evidence strings, plus an optional quote string.',
    'pasteReproduced and satisfiable are boolean fields inside the relevant violation;',
    'include satisfiable on each must_run violation and explain it in that violation\'s evidence.',
    '',
    'CONTRACT:',
    JSON.stringify(spec.contract, null, 2),
    '',
    'REPO: ' + state.repoPath,
    'BASE: ' + state.base,
    'BRANCH: ' + task.branch,
    '',
    'VERIFIER FACTS:',
    verifierFactsJson,
    '',
    'REPORT:',
    report,
  ].filter((line) => line !== null).join('\n')
}

function validVerdict(verdict) {
  if (!ownKeysAre(verdict, ['ok', 'violations', 'remarks'])
    || typeof verdict.ok !== 'boolean' || !Array.isArray(verdict.violations)
    || !Array.isArray(verdict.remarks) || verdict.remarks.some((remark) => typeof remark !== 'string')) {
    return false
  }
  if (verdict.ok !== (verdict.violations.length === 0)) return false
  return verdict.violations.every((violation) => violation && typeof violation === 'object'
    && typeof violation.rule === 'string' && typeof violation.class === 'string'
    && typeof violation.evidence === 'string'
    && (violation.quote === undefined || typeof violation.quote === 'string')
    && (violation.pasteReproduced === undefined || typeof violation.pasteReproduced === 'boolean')
    && (violation.satisfiable === undefined || typeof violation.satisfiable === 'boolean'))
}

function sameRuleRepeat(previous, current) {
  if (!previous) return false
  return current.violations.some((violation) => previous.violations.some((prior) =>
    prior.class === violation.class && prior.rule === violation.rule))
}

export function recordVerdict(state, id, result) {
  const updated = clone(state)
  const task = requireTask(updated, id)
  if (task.status !== 'verified') throw new NamedError('state-transition', id + ': verdict not expected')
  if (isAgentError(result)) {
    appendAgentFailure(task, 'supervisor', result.error.kind, task.totalAttempts)
    return updated
  }
  if (!validVerdict(result)) {
    throw new NamedError('supervisor-result', 'expected the fixed verdict schema or a fixed typed error')
  }
  const mechanicalViolations = task.verifierFacts.at(-1)?.violations ?? [{
    class: 'verification',
    rule: 'mechanical verifier facts are required before a verdict',
    evidence: 'no verifier history exists for this executor report',
  }]
  const effectiveResult = mechanicalViolations.length === 0 ? result : {
    ok: false,
    violations: [...clone(mechanicalViolations), ...clone(result.violations)],
    remarks: clone(result.remarks),
  }
  const model = task.rungs[task.rung]
  const effort = currentEffort(updated, id, task)
  const previousEntry = [...task.verdicts].reverse().find((entry) => entry.rung === task.rung)
  const entry = {
    rung: task.rung,
    attemptOnRung: task.attemptOnRung,
    model,
    effort,
    verdict: clone(effectiveResult),
    escalation: null,
  }
  task.verdicts.push(entry)
  if (effectiveResult.ok === true) {
    task.status = 'merge-ready'
    return updated
  }
  if (effectiveResult.violations.some((violation) => violation.satisfiable === false)) {
    task.status = 'contract-unsatisfiable'
    return updated
  }
  if (effectiveResult.violations.some((violation) => violation.pasteReproduced === false)) {
    task.pasteStrikes++
  }
  const raisedEffortTerminal = task.rung === task.rungs.length - 1
    && ((model === 'gpt-5.6-sol' && updated.supervisor.model === 'gpt-5.6-terra')
      || (model === 'gpt-5.6-terra' && updated.supervisor.model === 'gpt-5.6-sol'))
  if (task.pasteStrikes >= 2) {
    entry.escalation = 'paste-two-strikes'
  } else if (raisedEffortTerminal && task.attemptOnRung === 1 && nextHigherEffort(effort)) {
    entry.escalation = 'raised-effort'
  } else if (!raisedEffortTerminal && task.attemptOnRung >= 2) {
    entry.escalation = sameRuleRepeat(previousEntry && previousEntry.verdict, effectiveResult)
      ? 'same-rule-repeat'
      : 'rung-exhausted'
  }
  if (task.totalAttempts >= MAX_EXECUTOR_ATTEMPTS) {
    task.status = 'failed'
    return updated
  }
  if (task.pasteStrikes >= 2) {
    if (task.rung + 1 < task.rungs.length) {
      task.rung++
      task.attemptOnRung = 0
      task.status = 'ready'
    } else {
      task.status = 'failed'
    }
    return updated
  }
  if (raisedEffortTerminal) {
    if (entry.escalation === 'raised-effort') {
      task.status = 'ready'
    } else {
      task.status = 'failed'
    }
    return updated
  }
  if (task.attemptOnRung < 2) {
    task.status = 'ready'
    return updated
  }
  if (task.rung + 1 < task.rungs.length) {
    task.rung++
    task.attemptOnRung = 0
    task.status = 'ready'
  } else {
    task.status = 'failed'
  }
  return updated
}

export function summarize(state) {
  const stateTasks = Object.entries(state.tasks ?? {})
  const tasks = stateTasks.map(([id, task]) => {
    const usesAstra = task.rungs.includes(ASTRA)
    const spec = usesAstra ? taskSpec(state, id) : null
    const astraDispatched = usesAstra && (task.rungs[task.rung] === ASTRA
      && task.attemptOnRung > 0 || task.verdicts.some((entry) => entry.model === ASTRA))
    return {
      id,
      status: task.status === 'merge-ready' ? 'ok' : task.status,
      branch: task.branch,
      attempts: clone(task.verdicts),
      ...(usesAstra ? {
        astraExecutor: {
          reason: spec.astra_executor_reason,
          dispatched: astraDispatched,
          ...(astraDispatched ? {
            supervisorModel: state.supervisor.model,
            reviewContext: 'fresh',
            sameModelReview: true,
          } : {}),
        },
      } : {}),
    }
  })
  return {
    status: stateTasks.length > 0 && stateTasks.every(([, task]) => task.status === 'merge-ready')
      ? 'done'
      : 'partial',
    tasks,
  }
}

function readState(path) {
  let canonicalPath
  let parsed
  try {
    canonicalPath = realpathSync(path)
    parsed = JSON.parse(readFileSync(canonicalPath, 'utf8'))
  } catch (error) {
    throw new NamedError('state-read', error.message)
  }
  const errors = validateStoredState(parsed, canonicalPath)
  if (errors.length) throw new NamedError('state-schema', errors.join('; '))
  return { state: parsed, canonicalPath }
}

function parseStdin() {
  let text
  try { text = readFileSync(0, 'utf8') } catch (error) {
    throw new NamedError('stdin-json', error.message)
  }
  try { return JSON.parse(text) } catch (error) {
    throw new NamedError('stdin-json', error.message)
  }
}

function gitAt(repo, args) {
  return spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
}

function initCommand(options) {
  // Persist cwd-independent paths before Git or state/worktree creation uses them.
  options = { ...options, plan: resolve(options.plan), repo: resolve(options.repo) }
  const waveNumber = Number(options.wave)
  if (!Number.isInteger(waveNumber) || waveNumber < 1) {
    throw new NamedError('wave-number', 'must be a positive integer')
  }
  if (!SHA.test(options.base)) throw new NamedError('base-sha', 'must be a full lowercase 40-hex SHA')
  let markdown
  try { markdown = readFileSync(options.plan, 'utf8') } catch (error) {
    throw new NamedError('plan-read', error.message)
  }
  const plan = extractWavePlan(markdown)
  const wave = plan.waves[waveNumber - 1]
  if (!wave) throw new NamedError('wave-number', 'wave ' + waveNumber + ' does not exist')
  const errors = validateCodexWave(wave, waveNumber - 1)
  if (errors.length) throw new NamedError('wave-schema', errors.join('; '))
  if (!existsSync(options.repo)) throw new NamedError('repo', 'path does not exist: ' + options.repo)
  const resolved = gitAt(options.repo, ['rev-parse', '--verify', options.base + '^{commit}'])
  if (resolved.status !== 0 || resolved.stdout.trim() !== options.base) {
    throw new NamedError('base-sha', 'commit is not present in repository')
  }
  const state = makeState({
    planPath: options.plan,
    planDigest: selectedPlanDigest(markdown, wave),
    waveNumber,
    repoPath: options.repo,
    base: options.base,
    wave,
  })
  const stateDir = join(options.repo, '.worktrees', 'codex-wave')
  const planName = basename(options.plan).replace(/\.[^.]+$/, '')
  const statePath = join(stateDir, planName + '-w' + waveNumber + '-' + options.base.slice(0, 12) + '.json')
  if (existsSync(statePath)) throw new NamedError('state-conflict', statePath + ' already exists')
  for (const task of Object.values(state.tasks)) {
    const branchExists = gitAt(options.repo, ['show-ref', '--verify', '--quiet',
      'refs/heads/' + task.branch]).status === 0
    if (existsSync(task.worktree) || branchExists) {
      throw new NamedError('worktree-conflict', task.worktree + ' or ' + task.branch + ' already exists')
    }
  }
  for (const task of Object.values(state.tasks)) {
    mkdirSync(dirname(task.worktree), { recursive: true })
    const created = spawnSync('git', ['-C', options.repo, 'worktree', 'add', task.worktree,
      '-b', task.branch, options.base], { encoding: 'utf8' })
    if (created.status !== 0) {
      throw new NamedError('worktree-conflict', created.stderr || created.error?.message || task.worktree)
    }
  }
  mkdirSync(stateDir, { recursive: true })
  atomicWrite(statePath, state)
  return { status: 'ok', state: statePath, wave: waveNumber, tasks: Object.keys(state.tasks) }
}

function runCli(argv) {
  const { command, options } = parseCli(argv)
  if (command === 'init') return initCommand(options)
  const { state, canonicalPath } = readState(options.state)
  if (command === 'next') return nextAction(state)
  if (command === 'summary') return summarize(state)
  if (command === 'record-executor') {
    const updated = recordExecutor(state, options.task, parseStdin())
    atomicWrite(canonicalPath, updated)
    return { status: 'ok', task: options.task, next: nextAction(updated) }
  }
  if (command === 'verify') {
    const updated = verifyTask(state, options.task)
    atomicWrite(canonicalPath, updated)
    return {
      status: 'ok', task: options.task,
      facts: updated.tasks[options.task].verifierFacts.at(-1),
    }
  }
  if (command === 'supervisor-prompt') {
    const promptPath = join(dirname(fileURLToPath(import.meta.url)), 'supervisor-prompt.md')
    return {
      status: 'ok', task: options.task,
      prompt: buildSupervisorPrompt(state, options.task, readFileSync(promptPath, 'utf8')),
    }
  }
  if (command === 'record-verdict') {
    const updated = recordVerdict(state, options.task, parseStdin())
    atomicWrite(canonicalPath, updated)
    return { status: 'ok', task: options.task, next: nextAction(updated) }
  }
  throw new NamedError('usage', 'unknown command')
}

function main() {
  try {
    process.stdout.write(JSON.stringify(runCli(process.argv.slice(2))) + '\n')
  } catch (error) {
    process.stdout.write(JSON.stringify({ status: 'invalid', errors: [error.message] }) + '\n')
    process.exitCode = error.name === 'usage' ? 2 : 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
