#!/usr/bin/env node
// Deterministic linter for super-plan wave plans. Zero dependencies, never
// writes anything. The rules here are load-bearing for execution: a plan
// this script passes feeds the wave-runner without translation.
//
// Usage: node plan-lint.mjs <plan-file> [--repo <path>] [--base <sha>]
// Exit 0 = clean (warnings allowed), 1 = errors, 2 = usage.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, isAbsolute, resolve, relative, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { TASK_HEADING_SOURCE, malformedTaskHeadings, effectivePlan } from '../../multi-model/references/worktree-env.mjs'

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
const baseIdx = argv.indexOf('--base')
const base = baseIdx === -1 ? null : argv[baseIdx + 1]
if (!planFile || (repoIdx !== -1 && !repo) || (baseIdx !== -1 && (!base || !repo))) {
  console.error('usage: node plan-lint.mjs <plan-file> [--repo <path>] [--base <sha>]')
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

// Copied from wave-runner.workflow.mjs's globRe. Deliberately tiny: **
// crosses slashes, * and ? do not; everything else is literal.
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

const ids = []
// `effective`: plan with `inherits` applied (effectivePlan semantics, shared
// with the wave-runner) — used wherever ci/e2e/approvals may fall back to a
// parent plan the child omits them from. Stays the plan itself otherwise.
let effective = plan
if (plan) {
  // `inherits`: a repository-relative path (or absolute) to a parent plan.
  // With --repo, ci/e2e/approvals fall back to the parent's when the child
  // omits them.
  if (plan.inherits !== undefined) {
    if (typeof plan.inherits !== 'string') {
      err('inherits: must be a string naming the parent plan')
    } else if (repo) {
      try {
        effective = effectivePlan(planFile, repo)
      } catch (e) {
        err('inherits: "' + plan.inherits + '" cannot be read as a plan: ' + e.message)
      }
    }
  }
  const premiumApproval = effective.approvals && typeof effective.approvals === 'object'
    && !Array.isArray(effective.approvals) ? effective.approvals.premium : undefined
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
          // Report only when the forbidden glob covers the allowed one: a
          // literal (no-wildcard) allowed path that the forbidden glob
          // matches, or a forbidden glob that covers by prefix — `**`, or
          // exactly `<literal prefix>/**` (wildcards only at the trailing
          // `**`, none in the middle) whose prefix sits at or above the
          // allowed glob's prefix. A forbidden glob with wildcards before
          // its trailing `**` (e.g. `app/**/src/**`) narrows rather than
          // covers, and so does a forbidden glob that narrows an allowed
          // one (a deeper prefix, or a literal file under it) — both are a
          // legal carve-out and reported nowhere here.
          for (const a of c.files_allowed) for (const f of c.files_forbidden) {
            if (typeof a !== 'string' || typeof f !== 'string') continue
            const aHasWildcard = /[*?]/.test(a)
            let overlaps = false
            if (!aHasWildcard) {
              overlaps = globRe(f).test(a)
            } else {
              const fPrefix = literalPrefix(f)
              if (f === '**' || f === fPrefix + '/**') {
                const aPrefix = literalPrefix(a)
                overlaps = fPrefix === '' || fPrefix === aPrefix || aPrefix.startsWith(fPrefix + '/')
              }
            }
            if (overlaps) {
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

  // ---- worktree (optional): only links/writable/auto, shapes checked here;
  // with --repo, a link that doesn't exist in the repo is a warning ----
  if (plan.worktree !== undefined) {
    const w = plan.worktree
    const WORKTREE_KEYS = ['links', 'writable', 'auto']
    if (!w || typeof w !== 'object' || Array.isArray(w)
      || Object.keys(w).some((k) => !WORKTREE_KEYS.includes(k))) {
      err('worktree: must be an object with only "links", "writable" and "auto"')
    } else {
      const isRelLink = (l) => typeof l === 'string' && l !== '' && !l.startsWith('/')
        && !l.split(/[\\/]/).includes('..')
      if (w.links !== undefined) {
        if (!Array.isArray(w.links) || !w.links.every(isRelLink)) {
          err('worktree.links: array of non-empty repository-relative strings required (no leading "/", no ".." segment)')
        } else if (repo) {
          for (const link of w.links) {
            if (!existsSync(join(repo, link))) {
              warn('worktree: link "' + link + '" does not exist in the repo')
            }
          }
        }
      }
      if (w.writable !== undefined) {
        const isWritablePath = (p) => typeof p === 'string' && (isAbsolute(p) || p.startsWith('~/'))
        if (!Array.isArray(w.writable) || !w.writable.every(isWritablePath)) {
          err('worktree.writable: array of absolute or "~/"-prefixed strings required')
        }
      }
      if (w.auto !== undefined && typeof w.auto !== 'boolean') {
        err('worktree.auto: boolean required')
      }
    }
  }

  // ---- depends_on (optional): a launcher gate on another repo/wave/ref/path ----
  if (plan.depends_on !== undefined) {
    if (!Array.isArray(plan.depends_on)) {
      err('depends_on: array required')
    } else {
      const waveNumbers = (Array.isArray(plan.waves) ? plan.waves : [])
        .filter((w) => w && typeof w === 'object').map((w) => w.wave)
      plan.depends_on.forEach((d, di) => {
        const dat = 'depends_on[' + di + ']'
        if (!d || typeof d !== 'object' || Array.isArray(d)) {
          err(dat + ': must be an object with exactly "wave", "repo", "ref" and "path"')
          return
        }
        const DEPENDS_ON_KEYS = ['wave', 'repo', 'ref', 'path']
        const keys = Object.keys(d)
        if (keys.length !== DEPENDS_ON_KEYS.length || !DEPENDS_ON_KEYS.every((k) => keys.includes(k))) {
          err(dat + ': must be an object with exactly "wave", "repo", "ref" and "path"')
        }
        if (!(Number.isInteger(d.wave) && waveNumbers.includes(d.wave))) {
          err(dat + '.wave: must be an integer naming an existing wave')
        }
        if (!(d.repo === '.' || (typeof d.repo === 'string' && isAbsolute(d.repo)))) {
          err(dat + '.repo: must be "." or an absolute path')
        }
        if (typeof d.ref !== 'string' || d.ref === '') {
          err(dat + '.ref: non-empty string required')
        }
        if (typeof d.path !== 'string' || d.path === '' || isAbsolute(d.path)) {
          err(dat + '.path: non-empty relative string required')
        }
      })
    }
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
  const ci = effective.ci
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

  // ---- ci-gate coverage (warning): each ci.commands entry should be
  // exercised by some task's must_run, or it isn't actually gating the
  // change that broke it ----
  if (ci && typeof ci === 'object' && !Array.isArray(ci) && Array.isArray(ci.commands)) {
    const CI_GATE_RUNNERS = ['./gradlew', 'gradle', 'npm', 'pnpm', 'yarn', 'npx', 'make',
      'cargo', 'go', 'python', 'python3', 'uv', 'bash', 'sh']
    const gateToken = (cmd) => {
      const tokens = cmd.trim().split(/\s+/).filter((t) => t !== '' && !t.startsWith('$') && !t.startsWith('-'))
      if (tokens.length === 0) return null
      if (CI_GATE_RUNNERS.includes(tokens[0])) {
        let rest = tokens.slice(1)
        if (rest[0] === 'run') rest = rest.slice(1)
        return rest[0] || null
      }
      return tokens[0]
    }
    const allMustRunCmds = (Array.isArray(plan.waves) ? plan.waves : [])
      .flatMap((w) => (w && typeof w === 'object' && Array.isArray(w.tasks) ? w.tasks : []))
      .flatMap((t) => (t && typeof t === 'object' && t.contract && Array.isArray(t.contract.must_run)
        ? t.contract.must_run : []))
      .map((m) => m && typeof m.cmd === 'string' ? m.cmd : null)
      .filter((c) => c !== null)
    for (const cmd of ci.commands) {
      if (typeof cmd !== 'string' || cmd.trim() === '') continue
      const token = gateToken(cmd)
      if (!token) continue
      if (!allMustRunCmds.some((c) => c.includes(token))) {
        warn('ci-gate: "' + cmd.trim() + '" — no task\'s must_run carries "' + token
          + '"; scope that gate to each task\'s module')
      }
    }
  }

  // ---- e2e (required): the task that runs the shipped fixtures end to end ----
  const e2e = effective.e2e
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
        const e2eWaveIndex = plan.waves.findIndex((w) => w && Array.isArray(w.tasks)
          && w.tasks.some((t) => t && typeof t === 'object' && t.id === e2e.task))
        const laterWaves = e2eWaveIndex >= 0 ? plan.waves.slice(e2eWaveIndex + 1) : []
        const laterTasks = laterWaves.flatMap((w) => Array.isArray(w.tasks)
          ? w.tasks.filter((t) => t && typeof t === 'object') : [])
        const isDocOnly = (t) => t.contract && Array.isArray(t.contract.files_allowed)
          && t.contract.files_allowed.length > 0
          && t.contract.files_allowed.every((f) => typeof f === 'string'
            && (f.endsWith('.md') || f.startsWith('docs/')))
        const allDocsOnly = laterTasks.length > 0 && laterTasks.every(isDocOnly)
        if (!allDocsOnly) {
          warn('e2e.task: "' + e2e.task + '" is not in the last wave')
        }
      }
    }
  } else {
    err('e2e: must be {"task": "<id>"} or a "not-applicable: <reason>" string')
  }

  // ---- absolute paths under $HOME (warning): a must_run command that
  // references a path under the user's home directory and outside the
  // checked repo — executors run in a different, sandboxed worktree ----
  {
    const HOME = homedir()
    const repoAbs = repo ? resolve(repo) : null
    const isUnderRepo = (p) => repoAbs !== null && (p === repoAbs || p.startsWith(repoAbs + sep))
    for (const w of (Array.isArray(plan.waves) ? plan.waves : [])) {
      for (const t of (w && typeof w === 'object' && Array.isArray(w.tasks) ? w.tasks : [])) {
        if (!t || !t.contract || !Array.isArray(t.contract.must_run)) continue
        for (const m of t.contract.must_run) {
          if (!m || typeof m.cmd !== 'string' || m.cmd === '') continue
          for (const raw of m.cmd.split(/\s+/).filter(Boolean)) {
            const tok = raw.replace(/^['"]|['"]$/g, '')
            let resolvedPath = null
            if (tok === '~') resolvedPath = HOME
            else if (tok.startsWith('~/')) resolvedPath = join(HOME, tok.slice(2))
            else if (isAbsolute(tok) && (tok === HOME || tok.startsWith(HOME + sep))) resolvedPath = tok
            if (resolvedPath === null || isUnderRepo(resolvedPath)) continue
            warn('must_run: "' + m.cmd + '" references ' + tok
              + ' outside the repository — executors run in a sandboxed worktree')
          }
        }
      }
    }
  }

  // ---- parallelism: too many single-task waves signals the plan wasn't
  // cut for width, unless the author explains it under "## Parallelism" ----
  const waves = plan.waves
  if (Array.isArray(waves)) {
    const single = waves.filter((w) => w && typeof w === 'object'
      && Array.isArray(w.tasks) && w.tasks.length === 1
      && w.tasks[0] && typeof w.tasks[0] === 'object').length
    if (waves.length >= 3 && single * 2 > waves.length
      && !/^## Parallelism[ \t]*$/m.test(text)) {
      warn('parallelism: ' + single + ' of ' + waves.length + ' waves hold a single task — re-cut for width (files_allowed by file, a contract-first wave, independent chains side by side) or explain each single-task wave under "## Parallelism"')
    }
  }
}

// ---- prose half ↔ machine half ----
// Shared with worktree-env.mjs (and the runner) via TASK_HEADING_SOURCE: a
// heading that trails a title on the same line (e.g. "## Task foo — Title")
// looked fine here but crashed the runner's init, so it must be exactly
// "## Task <id>" with the title on the next line instead.
const proseIds = [...text.matchAll(new RegExp(TASK_HEADING_SOURCE, 'gm'))].map((m) => m[1])
for (const bare of malformedTaskHeadings(text)) {
  err('prose: task heading "' + bare + '" must be exactly "## Task <id>" — put the title on the next line')
}
for (const id of ids) {
  if (!proseIds.includes(id)) err('prose: no "## Task ' + id + '" section for task "' + id + '"')
}
for (const id of proseIds) {
  if (!ids.includes(id)) err('prose: section "## Task ' + id + '" has no matching task in the json block')
}

// A step's `working-directory:` can appear before or after its `run:`
// within the same `- ` list item; every raw line inside that item gets the
// item's working-directory (if any) recorded against it, so command lines
// can also be matched as `cd <dir> && <line>`. Block boundaries are found
// purely by indentation: a `- ` marker's item runs through the following
// more-indented (or blank) lines, ending at the next line indented at or
// past the marker's own column.
const workingDirsByLine = (rawLines) => {
  const byLine = new Array(rawLines.length).fill(null)
  for (let start = 0; start < rawLines.length; start++) {
    const marker = rawLines[start].match(/^(\s*)-\s/)
    if (!marker) continue
    const indent = marker[1].length
    let end = rawLines.length - 1
    for (let i = start + 1; i < rawLines.length; i++) {
      if (rawLines[i].trim() === '') continue
      const lineIndent = (rawLines[i].match(/^[ \t]*/) || [''])[0].length
      if (lineIndent <= indent) { end = i - 1; break }
    }
    let wd = null
    for (let i = start; i <= end; i++) {
      const stripped = rawLines[i].replace(/^[ \t]+/, '').replace(/^-\s+/, '')
      const m = stripped.match(/^working-directory:\s*(.+?)\s*$/)
      if (m) { wd = m[1].replace(/^['"]|['"]$/g, ''); break }
    }
    if (wd) for (let i = start; i <= end; i++) byLine[i] = wd
  }
  return byLine
}
// Split a workflow file's text into the lines a command may be matched
// against: normal lines have leading whitespace, an optional `- ` and an
// optional `run:`/`run: |` prefix stripped; a `run: |` block scalar's
// following more-indented lines are each their own raw line. Every actual
// command line also gets a `cd <dir> && <line>` sibling entry when its step
// carries a working-directory.
const deriveWorkflowLines = (workflowText) => {
  const rawLines = workflowText.split(/\r?\n/)
  const wdByLine = workingDirsByLine(rawLines)
  const out = []
  let blockIndent = null
  for (let idx = 0; idx < rawLines.length; idx++) {
    const raw = rawLines[idx]
    const indent = (raw.match(/^[ \t]*/) || [''])[0].length
    const isBlank = raw.trim() === ''
    if (blockIndent !== null) {
      if (isBlank) { out.push(''); continue }
      if (indent > blockIndent) {
        const line = raw.trim()
        out.push(line)
        if (line !== '' && wdByLine[idx]) out.push('cd ' + wdByLine[idx] + ' && ' + line)
        continue
      }
      blockIndent = null // dedented past the block; fall through
    }
    let stripped = raw.replace(/^[ \t]+/, '')
    stripped = stripped.replace(/^-\s+/, '')
    if (/^run:\s*\|\s*$/.test(stripped)) {
      blockIndent = indent
      out.push('')
      continue
    }
    const wasRun = /^run:\s*/.test(stripped) && stripped.trim() !== 'run:'
    const line = stripped.replace(/^run:\s*/, '').trim()
    out.push(line)
    if (wasRun && line !== '' && wdByLine[idx]) out.push('cd ' + wdByLine[idx] + ' && ' + line)
  }
  return out
}
// A command matches a line when it IS the line, or occurs in it bounded on
// the left by line start/`&&`/`;`/`|` and on the right by line end/`&&`/
// `;`/`|`/`\` (whitespace around the boundary ignored) — never as a bare
// substring fragment of a longer token. Trailing shell-variable arguments
// ($NAME, ${NAME}, "$NAME" or "${NAME}") between the command and that right
// boundary are also allowed, so a command still matches a workflow line that
// forwards flags through an env var.
const VAR_TOKEN = '(?:"\\$\\{[A-Za-z_][A-Za-z0-9_]*\\}"|"\\$[A-Za-z_][A-Za-z0-9_]*"'
  + '|\\$\\{[A-Za-z_][A-Za-z0-9_]*\\}|\\$[A-Za-z_][A-Za-z0-9_]*)'
const cmdMatchesLine = (cmd, line) => {
  const esc = cmd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('(?:^|&&|;|\\|)\\s*' + esc + '(?:\\s+' + VAR_TOKEN + ')*\\s*(?:&&|;|\\||\\\\|$)')
  return re.test(line)
}
const commandInWorkflows = (cmd, workflowTexts) =>
  workflowTexts.some((t) => deriveWorkflowLines(t).some((l) => cmdMatchesLine(cmd, l)))

// ---- --base <sha>: read .github/workflows from a commit instead of the
// working tree. gitShow returns null (never throws) when the blob is
// missing so callers treat that the same as a missing file. ----
const gitLsTreeNames = (repoDir, sha, dirPrefix) => {
  const r = spawnSync('git', ['-C', repoDir, 'ls-tree', '--name-only', sha, dirPrefix], { encoding: 'utf8' })
  if (r.status !== 0) return []
  return r.stdout.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((p) => p.startsWith(dirPrefix) ? p.slice(dirPrefix.length) : p)
}
const gitPathExists = (repoDir, sha, p) =>
  spawnSync('git', ['-C', repoDir, 'cat-file', '-e', sha + ':' + p], { encoding: 'utf8' }).status === 0
const gitPathIsFile = (repoDir, sha, p) =>
  spawnSync('git', ['-C', repoDir, 'cat-file', '-t', sha + ':' + p], { encoding: 'utf8' }).stdout.trim() === 'blob'
const gitShow = (repoDir, sha, p) => {
  const r = spawnSync('git', ['-C', repoDir, 'show', sha + ':' + p], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout : null
}

// ---- repo-checked ci: a repo with real workflows must name real commands ----
if (repo && plan) {
  let workflowDirEntries = []
  if (base) {
    workflowDirEntries = gitLsTreeNames(repo, base, '.github/workflows/')
  } else {
    try { workflowDirEntries = readdirSync(join(repo, '.github/workflows')) } catch (e) { workflowDirEntries = [] }
  }
  const repoHasWorkflows = workflowDirEntries.some((f) => /\.ya?ml$/i.test(f))
  if (repoHasWorkflows) {
    const ci = effective.ci
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
        if (base) {
          if (!gitPathExists(repo, base, wfPath)) {
            err('ci.workflows: "' + wfPath + '" does not exist under ' + repo)
          } else if (!gitPathIsFile(repo, base, wfPath)) {
            err('ci.workflows: "' + wfPath + '" is not a file')
          } else {
            const shown = gitShow(repo, base, wfPath)
            if (shown !== null) workflowTexts.push(shown)
          }
        } else {
          const full = resolve(repo, wfPath)
          if (!existsSync(full)) {
            err('ci.workflows: "' + wfPath + '" does not exist under ' + repo)
          } else if (!statSync(full).isFile()) {
            err('ci.workflows: "' + wfPath + '" is not a file')
          } else {
            try { workflowTexts.push(readFileSync(full, 'utf8')) } catch (e) { /* unreadable; skip */ }
          }
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
  // With --base, existence is checked against that commit, not the working
  // tree — a task's files_allowed path may exist in the working tree only
  // because a prior wave already created it there.
  const pathExists = (p) => base ? gitPathExists(repo, base, p) : existsSync(join(repo, p))
  // Missing files_allowed prefixes: when the prefix's own top-level segment
  // is also missing, that's a likely typo and gets its own warning; when
  // the top-level segment exists (only a deeper path is missing — expected
  // when a task creates it), fold all such prefixes into one warning below.
  const foldedMissing = []
  for (const w of plan.waves) {
    for (const t of (Array.isArray(w.tasks) ? w.tasks : [])) {
      if (!t || !t.contract) continue
      for (const g of (t.contract.files_allowed || [])) {
        if (typeof g !== 'string') continue
        const p = literalPrefix(g)
        if (!p || pathExists(p)) continue
        const seg = p.split('/')[0]
        if (seg && !pathExists(seg)) {
          warn('repo: files_allowed prefix "' + p + '" does not exist under ' + repo
            + ' and neither does its top-level directory "' + seg + '" (task "' + t.id + '") — typo?')
        } else {
          foldedMissing.push({ p, id: t.id })
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
  if (foldedMissing.length > 0) {
    const shown = foldedMissing.slice(0, 5).map((m) => m.p + ' (task ' + m.id + ')')
    let msg = 'repo: ' + foldedMissing.length + ' files_allowed path(s) do not exist yet (expected when their task creates them): '
      + shown.join(', ')
    if (foldedMissing.length > 5) msg += ', and ' + (foldedMissing.length - 5) + ' more'
    warn(msg)
  }
}

for (const w of warns) console.log('warn: ' + w)
for (const e of errors) console.log('error: ' + e)
console.log((errors.length ? 'FAIL' : 'OK') + ': ' + errors.length + ' error(s), ' + warns.length + ' warning(s)')
process.exit(errors.length ? 1 : 0)
