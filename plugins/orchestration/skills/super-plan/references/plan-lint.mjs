#!/usr/bin/env node
// Deterministic linter for super-plan wave plans. Zero dependencies, never
// writes anything. The rules here are load-bearing for execution: a plan
// this script passes feeds the wave-runner without translation.
//
// Usage: node plan-lint.mjs <plan-file> [--repo <path>]
// Exit 0 = clean (warnings allowed), 1 = errors, 2 = usage.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, isAbsolute, resolve, relative, sep } from 'node:path'

// Claude plans name models by full ID only; aliases re-point silently when
// a model ships (probe wf_e635018e-8f3, 2026-09-22: `opus` moved to Opus
// 5.5). Codex models use exact IDs; Astra execution is an explicit exception.
const CLAUDE_MODELS = [
  'claude-haiku-4-5-20251001',
  'claude-sonnet-5',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-opus-4-8',
  'claude-fable-5-1',
]
// The runner's default escalation ladder for a Claude task with no explicit
// `ladder` key: the models after the executor in this order.
const CLAUDE_DEFAULT_LADDER_ORDER = ['claude-haiku-4-5-20251001', 'claude-sonnet-5', 'claude-opus-5-5']
const defaultLadderFor = (execModel) => {
  const i = CLAUDE_DEFAULT_LADDER_ORDER.indexOf(execModel)
  return i === -1 ? [] : CLAUDE_DEFAULT_LADDER_ORDER.slice(i + 1)
}
const CLAUDE_ALIASES = ['haiku', 'sonnet', 'opus', 'fable']
const CODEX_MODELS = ['gpt-6-sol', 'gpt-6-luna', 'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']
const ASTRA = 'gpt-6-astra'
const MODELS = [...CLAUDE_MODELS, ...CODEX_MODELS]
const EXECUTOR_MODELS = [...MODELS, ASTRA]
const SUPERVISORS = [...MODELS, ASTRA]
const providerForModel = (model) => CLAUDE_MODELS.includes(model)
  ? 'claude'
  : CODEX_MODELS.includes(model) || model === ASTRA ? 'codex' : null
const aliasError = (field, model) => field + ': "' + model
  + '" is an alias — aliases re-point silently; use a full ID ('
  + CLAUDE_MODELS.join(', ') + ')'
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/
const CONTRACT_KEYS = ['files_allowed', 'files_forbidden', 'must_run',
  'forbidden_moves', 'report_must_answer']

// Premium models need a recorded, dated Gate 1 approval before a plan may
// route to them. Retired routes are a softer nudge — warnings, never errors.
const PREMIUM_MODELS = ['claude-fable-5-1', 'gpt-6-astra']
const RETIRED_GPT56 = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const argv = process.argv.slice(2)
const planFile = argv.find((a) => !a.startsWith('--'))
const repoIdx = argv.indexOf('--repo')
const repo = repoIdx === -1 ? null : argv[repoIdx + 1]
if (!planFile || (repoIdx !== -1 && !repo)) {
  console.error('usage: node plan-lint.mjs <plan-file> [--repo <path>]')
  process.exit(2)
}

const errors = []
const warns = []
const err = (m) => errors.push(m)
const warn = (m) => warns.push(m)

let text
try { text = readFileSync(planFile, 'utf8') } catch (e) {
  console.log('error: cannot read ' + planFile + ': ' + e.message)
  console.log('FAIL: 1 error(s), 0 warning(s)')
  process.exit(1)
}

// ---- header: the drift hook reads status at column 0 before any fence ----
const firstFence = text.indexOf('```')
const head = firstFence === -1 ? text : text.slice(0, firstFence)
const statusMatch = head.match(/^status:[ \t]*([a-zA-Z-]+)/m)
if (!statusMatch) {
  err('header: no column-0 `status:` line before the first code fence (the drift hook reads it there)')
} else if (!['draft', 'active', 'done'].includes(statusMatch[1])) {
  err('header: status must be draft|active|done, got "' + statusMatch[1] + '"')
}

// ---- machine half: exactly one `json wave-plan` fenced block; plain
// ```json fences inside task prose are deliberately NOT matched ----
const jsonBlocks = [...text.matchAll(/```json wave-plan\r?\n([\s\S]*?)\r?\n```/g)]
let plan = null
if (jsonBlocks.length !== 1) {
  err('machine half: expected exactly one ```json wave-plan block, found ' + jsonBlocks.length)
} else {
  try { plan = JSON.parse(jsonBlocks[0][1]) } catch (e) {
    err('machine half: JSON does not parse: ' + e.message)
  }
}

// Glob overlap by literal prefix (documented approximation: src/http/** vs
// src/** collide; src/a/** vs src/b/** do not; a leading wildcard collides
// with everything).
const literalPrefix = (glob) => {
  const i = glob.search(/[*?\[]/)
  return (i === -1 ? glob : glob.slice(0, i)).replace(/\/+$/, '')
}
const prefixesCollide = (a, b) => {
  const pa = literalPrefix(a), pb = literalPrefix(b)
  return pa === '' || pb === '' || pa === pb
    || pa.startsWith(pb + '/') || pb.startsWith(pa + '/')
}

const ids = []
if (plan) {
  const premiumApproval = plan.approvals && typeof plan.approvals === 'object'
    && !Array.isArray(plan.approvals) ? plan.approvals.premium : undefined
  const premiumModelsValid = !!(premiumApproval && typeof premiumApproval === 'object'
    && !Array.isArray(premiumApproval) && Array.isArray(premiumApproval.models))
  const usedPremiumModels = new Set()
  const checkPremium = (path, model) => {
    if (!PREMIUM_MODELS.includes(model)) return
    usedPremiumModels.add(model)
    if (!premiumModelsValid || !premiumApproval.models.includes(model)) {
      err(path + ': premium model ' + model
        + ' requires approvals.premium (models, reason, approved_by, date) recorded at Gate 1')
    }
  }
  const retiredWarn = (model) => {
    if (RETIRED_GPT56.includes(model)) {
      warn('retired route: ' + model + ' is not chosen for new plans (GPT-6 Sol/Luna replace it)')
    }
  }
  const retiredExecLadderWarn = (model) => {
    if (model === 'claude-opus-5') {
      warn('retired route: Opus 5 is no longer an executor route (use claude-opus-5-5)')
    } else if (model === 'claude-opus-4-8') {
      warn('Opus 4.8 is routed only for compiled-binary work — ignore this warning if the task is compiled-binary reverse-engineering')
    }
  }

  if (!Array.isArray(plan.waves) || plan.waves.length === 0) {
    err('machine half: `waves` must be a non-empty array')
  } else {
    plan.waves.forEach((w, wi) => {
      const at = 'waves[' + wi + ']'
      if (!w || typeof w !== 'object') { err(at + ': must be an object'); return }
      if (!w.supervisor || !SUPERVISORS.includes(w.supervisor.model)) {
        err(w.supervisor && CLAUDE_ALIASES.includes(w.supervisor.model)
          ? aliasError(at + '.supervisor.model', w.supervisor.model)
          : at + '.supervisor.model: one of ' + SUPERVISORS.join('/'))
      }
      if (w.supervisor && providerForModel(w.supervisor.model) === 'codex'
        && w.supervisor.effort === undefined) {
        err(at + '.supervisor.effort: explicit Codex effort required; one of ' + EFFORTS.join('/'))
      } else if (w.supervisor && w.supervisor.effort !== undefined
        && !EFFORTS.includes(w.supervisor.effort)) {
        err(at + '.supervisor.effort: one of ' + EFFORTS.join('/'))
      }
      if (w.supervisor && typeof w.supervisor.model === 'string') {
        checkPremium(at + '.supervisor.model', w.supervisor.model)
        retiredWarn(w.supervisor.model)
      }
      if (!Array.isArray(w.tasks) || w.tasks.length === 0) {
        err(at + '.tasks: non-empty array required'); return
      }
      w.tasks.forEach((t, ti) => {
        const tat = at + '.tasks[' + ti + ']'
        if (!t || typeof t !== 'object') { err(tat + ': must be an object'); return }
        if (typeof t.id !== 'string' || !KEBAB.test(t.id)) {
          err(tat + '.id: kebab-case required')
        } else {
          ids.push(t.id)
        }
        if (t.branch !== 'wave/' + t.id) err(tat + '.branch: must be "wave/' + t.id + '"')
        if (!t.executor || !EXECUTOR_MODELS.includes(t.executor.model)) {
          err(t.executor && CLAUDE_ALIASES.includes(t.executor.model)
            ? aliasError(tat + '.executor.model', t.executor.model)
            : tat + '.executor.model: one of ' + EXECUTOR_MODELS.join('/'))
        }
        if (t.executor && providerForModel(t.executor.model) === 'codex'
          && t.executor.effort === undefined) {
          err(tat + '.executor.effort: explicit Codex effort required; one of ' + EFFORTS.join('/'))
        } else if (t.executor && t.executor.effort !== undefined
          && !EFFORTS.includes(t.executor.effort)) {
          err(tat + '.executor.effort: one of ' + EFFORTS.join('/'))
        }
        if (t.executor && typeof t.executor.model === 'string') {
          checkPremium(tat + '.executor.model', t.executor.model)
          retiredWarn(t.executor.model)
          retiredExecLadderWarn(t.executor.model)
        }
        if (t.ladder !== undefined && (!Array.isArray(t.ladder)
          || t.ladder.some((m) => !EXECUTOR_MODELS.includes(m)))) {
          const alias = Array.isArray(t.ladder) && t.ladder.find((m) => CLAUDE_ALIASES.includes(m))
          err(alias
            ? aliasError(tat + '.ladder', alias)
            : tat + '.ladder: array of ' + EXECUTOR_MODELS.join('/'))
        }
        if (Array.isArray(t.ladder)) {
          t.ladder.forEach((m, li) => {
            if (typeof m !== 'string') return
            checkPremium(tat + '.ladder[' + li + ']', m)
            retiredWarn(m)
            retiredExecLadderWarn(m)
          })
        }
        const transitions = t.executor && EXECUTOR_MODELS.includes(t.executor.model)
          ? [t.executor.model, ...(Array.isArray(t.ladder) ? t.ladder : [])] : []
        const usesAstra = transitions.includes(ASTRA)
        const astraReasonValid = typeof t.astra_executor_reason === 'string'
          && t.astra_executor_reason.trim() !== ''
        if (usesAstra) {
          if (!astraReasonValid) {
            err(tat + '.astra_executor_reason: non-empty string required for Astra execution')
          }
          if (transitions.at(-1) !== ASTRA) {
            err(tat + '.ladder: gpt-6-astra must be the final executor rung')
          }
          if (!w.supervisor || w.supervisor.model !== ASTRA) {
            err(tat + ': Astra execution requires exact gpt-6-astra supervisor')
          }
        } else if (Object.hasOwn(t, 'astra_executor_reason')) {
          err(tat + '.astra_executor_reason: only allowed when Astra is an executor or ladder rung')
        }
        if (transitions.length > 0) {
          if (new Set(transitions).size !== transitions.length) {
            err(tat + '.ladder: ladder transitions must use distinct models across executor and ladder')
          }
        }
        const effectiveLadder = Array.isArray(t.ladder)
          ? t.ladder
          : (t.executor && providerForModel(t.executor.model) === 'claude'
            ? defaultLadderFor(t.executor.model) : [])
        if (w.supervisor && t.executor
          && [t.executor.model, ...effectiveLadder].includes(w.supervisor.model)
          && !(usesAstra && astraReasonValid && w.supervisor.model === ASTRA)) {
          err(tat + ': supervisor model also appears as executor or ladder rung')
        }
        const c = t.contract
        if (!c || typeof c !== 'object') { err(tat + '.contract: required, with all five keys'); return }
        for (const k of CONTRACT_KEYS) {
          if (!Array.isArray(c[k])) err(tat + '.contract.' + k + ': array required')
        }
        if (Array.isArray(c.files_allowed) && c.files_allowed.length === 0) {
          warn(tat + ' ("' + t.id + '"): files_allowed is empty — the executor has nothing it may change')
        }
        if (Array.isArray(c.must_run)) {
          if (c.must_run.length === 0) {
            warn(tat + ' ("' + t.id + '"): must_run is empty — nothing for the supervisor to run')
          }
          c.must_run.forEach((m, mi) => {
            if (!m || typeof m.cmd !== 'string' || m.cmd === '') err(tat + '.contract.must_run[' + mi + '].cmd: required')
            if (!m || typeof m.evidence !== 'string') err(tat + '.contract.must_run[' + mi + '].evidence: required')
          })
        }
        if (Array.isArray(c.files_allowed) && Array.isArray(c.files_forbidden)) {
          for (const a of c.files_allowed) for (const f of c.files_forbidden) {
            if (typeof a === 'string' && typeof f === 'string' && prefixesCollide(a, f)) {
              err(tat + ' ("' + t.id + '"): files_allowed "' + a + '" overlaps its own files_forbidden "' + f + '"')
            }
          }
        }
      })
      if (w.supervisor && w.supervisor.model === 'gpt-6-sol') {
        const allLuna = w.tasks.every((t) => t && typeof t === 'object'
          && t.executor && t.executor.model === 'gpt-6-luna'
          && (!Array.isArray(t.ladder) || t.ladder.every((m) => m === 'gpt-6-luna')))
        if (!allLuna) {
          err(at + '.supervisor.model: gpt-6-sol supervises only waves whose executors and rungs are all gpt-6-luna')
        }
      }
      const waveModels = [
        w.supervisor && w.supervisor.model,
        ...w.tasks.flatMap((t) => t && typeof t === 'object'
          ? [t.executor && t.executor.model, ...(Array.isArray(t.ladder) ? t.ladder : [])]
          : []),
      ]
      const providers = new Set(waveModels.map(providerForModel).filter(Boolean))
      if (providers.size > 1) {
        err(at + ': mixes providers; one wave must be entirely claude or entirely codex')
      }
      // The rule the whole linter exists for: same-wave tasks must not share files.
      const list = w.tasks.filter((t) => t && t.contract && Array.isArray(t.contract.files_allowed))
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          for (const a of list[i].contract.files_allowed) {
            for (const b of list[j].contract.files_allowed) {
              if (typeof a === 'string' && typeof b === 'string' && prefixesCollide(a, b)) {
                err(at + ': tasks "' + list[i].id + '" and "' + list[j].id + '" overlap on "'
                  + a + '" vs "' + b + '" — same-wave tasks must not share files; merge them or split the waves')
              }
            }
          }
        }
      }
    })
  }
  const dup = [...new Set(ids.filter((x, i) => ids.indexOf(x) !== i))]
  for (const d of dup) err('ids: duplicate task id "' + d + '"')

  // Field-level premium approval errors, reported once and independent of
  // the model-specific errors checkPremium already raised above.
  if (usedPremiumModels.size > 0) {
    const pa = premiumApproval && typeof premiumApproval === 'object' && !Array.isArray(premiumApproval)
      ? premiumApproval : {}
    if (!(typeof pa.reason === 'string' && pa.reason.replace(/\s/g, '').length >= 10)) {
      err('approvals.premium.reason: at least 10 non-space characters required')
    }
    if (!(typeof pa.approved_by === 'string' && pa.approved_by.trim() !== '')) {
      err('approvals.premium.approved_by: non-empty string required')
    }
    const pd = typeof pa.date === 'string' && DATE_RE.test(pa.date)
      ? new Date(pa.date + 'T00:00:00Z') : null
    if (!(pd && !isNaN(pd.getTime()) && pd.toISOString().slice(0, 10) === pa.date)) {
      err('approvals.premium.date: must be a real calendar date (YYYY-MM-DD)')
    }
  }

  if (premiumApproval && Array.isArray(premiumApproval.models)) {
    for (const m of premiumApproval.models) {
      if (typeof m === 'string' && PREMIUM_MODELS.includes(m) && !usedPremiumModels.has(m)) {
        warn('approvals.premium.models: "' + m + '" is listed but never used in the plan')
      }
    }
  }

  // ---- ci (required): CI entrypoint commands, or an explicit opt-out ----
  const ci = plan.ci
  if (ci === undefined) {
    err('ci: required — the exact CI entrypoint commands, or "none: <reason>"')
  } else if (typeof ci === 'string') {
    if (!ci.startsWith('none: ') || ci.slice('none: '.length).trim().length < 10) {
      err('ci: "none: <reason>" requires a reason of at least 10 characters')
    }
  } else if (ci && typeof ci === 'object' && !Array.isArray(ci)) {
    if (!Array.isArray(ci.commands) || ci.commands.length === 0
      || !ci.commands.every((c) => typeof c === 'string' && c.trim() !== '')) {
      err('ci.commands: at least one non-empty command required')
    }
    if (!Array.isArray(ci.workflows)) {
      err('ci.workflows: array required')
    }
  } else {
    err('ci: must be an object {commands, workflows} or a "none: <reason>" string')
  }

  // ---- e2e (required): the task that runs the shipped fixtures end to end ----
  const e2e = plan.e2e
  if (e2e === undefined) {
    err('e2e: required — the task that runs the shipped fixtures end to end, or "not-applicable: <reason>"')
  } else if (typeof e2e === 'string') {
    if (!e2e.startsWith('not-applicable: ') || e2e.slice('not-applicable: '.length).trim().length < 10) {
      err('e2e: "not-applicable: <reason>" requires a reason of at least 10 characters')
    }
  } else if (e2e && typeof e2e === 'object' && !Array.isArray(e2e)) {
    if (typeof e2e.task !== 'string' || !ids.includes(e2e.task)) {
      err('e2e.task: must name a task id that exists in the plan')
    } else if (Array.isArray(plan.waves) && plan.waves.length > 0) {
      const lastWave = plan.waves[plan.waves.length - 1]
      const lastWaveIds = lastWave && Array.isArray(lastWave.tasks)
        ? lastWave.tasks.filter((t) => t && typeof t === 'object').map((t) => t.id) : []
      if (!lastWaveIds.includes(e2e.task)) {
        warn('e2e.task: "' + e2e.task + '" is not in the last wave')
      }
    }
  } else {
    err('e2e: must be {"task": "<id>"} or a "not-applicable: <reason>" string')
  }

  // ---- review (optional): the Codex final-review child chosen at Gate 1;
  // Claude plans review in-session and must not name one ----
  const review = plan.review
  if (review !== undefined) {
    if (!review || typeof review !== 'object' || Array.isArray(review)) {
      err('review: must be an object {"model", "effort"}')
    } else {
      const reviewModelValid = review.model === ASTRA || review.model === 'gpt-6-sol'
      if (!reviewModelValid) {
        err('review.model: one of gpt-6-astra/gpt-6-sol — the Codex final-review child chosen at Gate 1')
      } else {
        checkPremium('review.model', review.model)
      }
      if (!EFFORTS.includes(review.effort)) {
        err('review.effort: one of ' + EFFORTS.join('/'))
      }
      const reviewPlanModels = Array.isArray(plan.waves) ? plan.waves.flatMap((w) => w && typeof w === 'object'
        ? [w.supervisor && w.supervisor.model, ...(Array.isArray(w.tasks) ? w.tasks.flatMap((t) => t && typeof t === 'object'
          ? [t.executor && t.executor.model, ...(Array.isArray(t.ladder) ? t.ladder : [])] : []) : [])]
        : []) : []
      const reviewPlanProviders = new Set(reviewPlanModels.map(providerForModel).filter(Boolean))
      if (reviewPlanProviders.size === 1 && reviewPlanProviders.has('claude')) {
        err('review: only Codex plans name a final-review child; Claude reviews run in the session')
      }
    }
  }
}

// ---- prose half ↔ machine half ----
const proseIds = [...text.matchAll(/^## Task ([a-z0-9-]+)/gm)].map((m) => m[1])
for (const id of ids) {
  if (!proseIds.includes(id)) err('prose: no "## Task ' + id + '" section for task "' + id + '"')
}
for (const id of proseIds) {
  if (!ids.includes(id)) err('prose: section "## Task ' + id + '" has no matching task in the json block')
}

// Split a workflow file's text into the lines a command may be matched
// against: normal lines have leading whitespace, an optional `- ` and an
// optional `run:`/`run: |` prefix stripped; a `run: |` block scalar's
// following more-indented lines are each their own raw line.
const deriveWorkflowLines = (workflowText) => {
  const rawLines = workflowText.split(/\r?\n/)
  const out = []
  let blockIndent = null
  for (const raw of rawLines) {
    const indent = (raw.match(/^[ \t]*/) || [''])[0].length
    const isBlank = raw.trim() === ''
    if (blockIndent !== null) {
      if (isBlank) { out.push(''); continue }
      if (indent > blockIndent) { out.push(raw.trim()); continue }
      blockIndent = null // dedented past the block; fall through
    }
    let stripped = raw.replace(/^[ \t]+/, '')
    stripped = stripped.replace(/^-\s+/, '')
    if (/^run:\s*\|\s*$/.test(stripped)) {
      blockIndent = indent
      out.push('')
      continue
    }
    out.push(stripped.replace(/^run:\s*/, '').trim())
  }
  return out
}
// A command matches a line when it IS the line, or occurs in it bounded on
// the left by line start/`&&`/`;`/`|` and on the right by line end/`&&`/
// `;`/`|`/`\` (whitespace around the boundary ignored) — never as a bare
// substring fragment of a longer token.
const cmdMatchesLine = (cmd, line) => {
  const esc = cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('(?:^|&&|;|\\|)\\s*' + esc + '\\s*(?:&&|;|\\||\\\\|$)')
  return re.test(line)
}
const commandInWorkflows = (cmd, workflowTexts) =>
  workflowTexts.some((t) => deriveWorkflowLines(t).some((l) => cmdMatchesLine(cmd, l)))

// ---- repo-checked ci: a repo with real workflows must name real commands ----
if (repo && plan) {
  let workflowDirEntries = []
  try { workflowDirEntries = readdirSync(join(repo, '.github/workflows')) } catch (e) { workflowDirEntries = [] }
  const repoHasWorkflows = workflowDirEntries.some((f) => /\.ya?ml$/i.test(f))
  if (repoHasWorkflows) {
    const ci = plan.ci
    if (typeof ci === 'string') {
      err('ci: the repository has CI workflows; list their commands in ci.commands')
    } else if (ci && typeof ci === 'object' && !Array.isArray(ci)) {
      const workflows = Array.isArray(ci.workflows) ? ci.workflows : []
      if (workflows.length === 0) {
        err('ci.workflows: required — the repository has CI workflows and none are listed')
      }
      const workflowsDir = join(repo, '.github/workflows')
      const workflowTexts = []
      for (const wfPath of workflows) {
        if (typeof wfPath !== 'string') continue
        const isYaml = wfPath.endsWith('.yml') || wfPath.endsWith('.yaml')
        const wfRel = relative(workflowsDir, resolve(repo, wfPath))
        const escapesDir = wfRel === '..' || wfRel.startsWith('..' + sep)
        if (isAbsolute(wfPath) || escapesDir || !isYaml) {
          err('ci.workflows: "' + wfPath + '" must be a .yml/.yaml file under .github/workflows')
          continue
        }
        const full = resolve(repo, wfPath)
        if (!existsSync(full)) {
          err('ci.workflows: "' + wfPath + '" does not exist under ' + repo)
        } else if (!statSync(full).isFile()) {
          err('ci.workflows: "' + wfPath + '" is not a file')
        } else {
          try { workflowTexts.push(readFileSync(full, 'utf8')) } catch (e) { /* unreadable; skip */ }
        }
      }
      const commands = Array.isArray(ci.commands)
        ? ci.commands.filter((c) => typeof c === 'string' && c.trim() !== '') : []
      for (const cmd of commands) {
        const trimmed = cmd.trim()
        if (!commandInWorkflows(trimmed, workflowTexts)) {
          err('ci.commands: "' + trimmed + '" does not appear in any listed ci.workflows file')
        }
      }
    }
  }
}

// ---- optional repo checks (warnings only) ----
if (repo && plan && Array.isArray(plan.waves)) {
  const pathDirs = (process.env.PATH || '').split(':').filter(Boolean)
  for (const w of plan.waves) {
    for (const t of (Array.isArray(w.tasks) ? w.tasks : [])) {
      if (!t || !t.contract) continue
      for (const g of (t.contract.files_allowed || [])) {
        if (typeof g !== 'string') continue
        const p = literalPrefix(g)
        if (p && !existsSync(join(repo, p))) {
          warn('repo: files_allowed prefix "' + p + '" does not exist under ' + repo + ' (task "' + t.id + '")')
        }
      }
      for (const m of (t.contract.must_run || [])) {
        if (!m || typeof m.cmd !== 'string' || m.cmd === '') continue
        const tokens = m.cmd.trim().split(/\s+/)
        let i = 0
        while (i < tokens.length) {
          const tok = tokens[i]
          if (tok === '!') {
            i++
          } else if (tok === '(' || tok.startsWith('(')) {
            tokens[i] = tok.slice(1)
            if (tokens[i] === '') i++
          } else if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
            i++
          } else {
            break
          }
        }
        const bin = i < tokens.length ? tokens[i] : ''
        if (bin === '') continue
        const found = bin.includes('/')
          ? existsSync(isAbsolute(bin) ? bin : join(repo, bin))
          : pathDirs.some((d) => existsSync(join(d, bin)))
        if (!found) warn('repo: must_run command "' + bin + '" found neither on PATH nor in the repo (task "' + t.id + '")')
      }
    }
  }
}

for (const w of warns) console.log('warn: ' + w)
for (const e of errors) console.log('error: ' + e)
console.log((errors.length ? 'FAIL' : 'OK') + ': ' + errors.length + ' error(s), ' + warns.length + ' warning(s)')
process.exit(errors.length ? 1 : 0)
