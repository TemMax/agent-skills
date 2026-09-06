#!/usr/bin/env node
// Deterministic linter for super-plan wave plans. Zero dependencies, never
// writes anything. The rules here are load-bearing for execution: a plan
// this script passes feeds the wave-runner without translation.
//
// Usage: node plan-lint.mjs <plan-file> [--repo <path>]
// Exit 0 = clean (warnings allowed), 1 = errors, 2 = usage.
import { readFileSync, existsSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'

// Claude plans use short IDs except for the one pinned Opus ID accepted by
// Workflow. Codex plans use only the exact public GPT-5.6 IDs.
const CLAUDE_MODELS = ['haiku', 'sonnet', 'opus', 'fable', 'claude-opus-4-8']
const CODEX_MODELS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']
const MODELS = [...CLAUDE_MODELS, ...CODEX_MODELS]
const providerForModel = (model) => CLAUDE_MODELS.includes(model)
  ? 'claude'
  : CODEX_MODELS.includes(model) ? 'codex' : null
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/
const CONTRACT_KEYS = ['files_allowed', 'files_forbidden', 'must_run',
  'forbidden_moves', 'report_must_answer']

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
  if (!Array.isArray(plan.waves) || plan.waves.length === 0) {
    err('machine half: `waves` must be a non-empty array')
  } else {
    plan.waves.forEach((w, wi) => {
      const at = 'waves[' + wi + ']'
      if (!w || typeof w !== 'object') { err(at + ': must be an object'); return }
      if (!w.supervisor || !MODELS.includes(w.supervisor.model)) {
        err(at + '.supervisor.model: one of ' + MODELS.join('/') + ' (short names, or the pinned full ID claude-opus-4-8)')
      }
      if (w.supervisor && providerForModel(w.supervisor.model) === 'codex'
        && w.supervisor.effort === undefined) {
        err(at + '.supervisor.effort: explicit Codex effort required; one of ' + EFFORTS.join('/'))
      } else if (w.supervisor && w.supervisor.effort !== undefined
        && !EFFORTS.includes(w.supervisor.effort)) {
        err(at + '.supervisor.effort: one of ' + EFFORTS.join('/'))
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
        if (!t.executor || !MODELS.includes(t.executor.model)) {
          err(tat + '.executor.model: one of ' + MODELS.join('/') + ' (short names, or the pinned full ID claude-opus-4-8)')
        }
        if (t.executor && providerForModel(t.executor.model) === 'codex'
          && t.executor.effort === undefined) {
          err(tat + '.executor.effort: explicit Codex effort required; one of ' + EFFORTS.join('/'))
        } else if (t.executor && t.executor.effort !== undefined
          && !EFFORTS.includes(t.executor.effort)) {
          err(tat + '.executor.effort: one of ' + EFFORTS.join('/'))
        }
        if (t.ladder !== undefined && (!Array.isArray(t.ladder) || t.ladder.some((m) => !MODELS.includes(m)))) {
          err(tat + '.ladder: array of ' + MODELS.join('/') + ' (short names, or the pinned full ID claude-opus-4-8)')
        }
        if (t.executor && MODELS.includes(t.executor.model) && Array.isArray(t.ladder)) {
          const transitions = [t.executor.model, ...t.ladder]
          if (new Set(transitions).size !== transitions.length) {
            err(tat + '.ladder: ladder transitions must use distinct models across executor and ladder')
          }
        }
        if (w.supervisor && t.executor
          && [t.executor.model, ...(Array.isArray(t.ladder) ? t.ladder : [])].includes(w.supervisor.model)) {
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
}

// ---- prose half ↔ machine half ----
const proseIds = [...text.matchAll(/^## Task ([a-z0-9-]+)/gm)].map((m) => m[1])
for (const id of ids) {
  if (!proseIds.includes(id)) err('prose: no "## Task ' + id + '" section for task "' + id + '"')
}
for (const id of proseIds) {
  if (!ids.includes(id)) err('prose: section "## Task ' + id + '" has no matching task in the json block')
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
        const bin = m.cmd.trim().split(/\s+/)[0]
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
