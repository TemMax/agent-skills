#!/usr/bin/env node
// telemetry.mjs — where a ship/wave run spends time and money.
//
//   node telemetry.mjs codex --root <rollout.jsonl> [--sessions <dir>]
//     [--from ISO] [--to ISO] [--prices prices.json] [--json]
//   node telemetry.mjs claude --transcript <file>
//     [--from ISO] [--to ISO] [--prices prices.json] [--json]
//
// Reads a Codex orchestrator's rollout plus every descendant rollout under
// --sessions (see codex.mjs), or a Claude Code session transcript plus every
// agent transcript under its subagents directory (see claude.mjs); splits
// the orchestrator's own wall-clock time into model / tool:<name> / waiting
// / user buckets, and reports per-child role, model, tokens and cost. Never
// calls a model; pure log analysis.
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { loadCodexRun } from './codex.mjs'
import { loadClaudeRun } from './claude.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DEFAULT_PRICES = join(HERE, 'prices.json')

const USAGE_CODEX = `usage: node telemetry.mjs codex --root <rollout.jsonl> [--sessions <dir>] [--from ISO] [--to ISO] [--prices prices.json] [--json]`
const USAGE_CLAUDE = `usage: node telemetry.mjs claude --transcript <file> [--from ISO] [--to ISO] [--prices prices.json] [--json]`
const USAGE = `${USAGE_CODEX}\n${USAGE_CLAUDE}`

// ---------------------------------------------------------------------------
// CLI

export function parseArgs(argv) {
  const sub = argv[0]
  if (sub !== 'codex' && sub !== 'claude') {
    throw new Error(`unknown or missing subcommand${sub ? `: ${sub}` : ''}\n${USAGE}`)
  }
  const subUsage = sub === 'codex' ? USAGE_CODEX : USAGE_CLAUDE
  const opts = { json: false, subcommand: sub }
  const flags = sub === 'codex'
    ? { '--root': 'root', '--sessions': 'sessions', '--from': 'from', '--to': 'to', '--prices': 'prices' }
    : { '--transcript': 'transcript', '--from': 'from', '--to': 'to', '--prices': 'prices' }
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') { opts.json = true; continue }
    const key = flags[arg]
    if (!key) throw new Error(`unrecognized argument: ${arg}\n${subUsage}`)
    const value = argv[++i]
    if (value === undefined) throw new Error(`${arg} needs a value\n${subUsage}`)
    opts[key] = value
  }
  if (sub === 'codex' && !opts.root) throw new Error(`--root is required\n${USAGE_CODEX}`)
  if (sub === 'claude' && !opts.transcript) throw new Error(`--transcript is required\n${USAGE_CLAUDE}`)
  return opts
}

// ---------------------------------------------------------------------------
// Time bucketing
//
// Walk a rollout's rows in order. Between two consecutive rows, the elapsed
// time is charged to exactly one bucket, chosen by the state that was true
// going into that interval:
//   - outside an active turn (after task_complete, before the next
//     task_started): "user"
//   - inside an active turn with a tool call open: "tool:<name>", or
//     "waiting" for wait_agent/wait
//   - inside an active turn with nothing open: "model"
// Multiple nested open calls use the most recently opened one (calls close
// in LIFO order in practice); this only matters when a bucket name is
// chosen, never for the total duration accounted for.

function isCallOpen(payload) {
  return payload && (payload.type === 'custom_tool_call' || payload.type === 'function_call')
}
function isCallOutput(payload) {
  return payload && (payload.type === 'custom_tool_call_output' || payload.type === 'function_call_output')
}

export function timeBucketsMs(rows) {
  const buckets = {}
  const add = (name, ms) => { if (ms > 0) buckets[name] = (buckets[name] || 0) + ms }
  let turnActive = false
  const open = []
  let prevT = null
  const bucketName = () => {
    if (!turnActive) return 'user'
    if (open.length) {
      const name = open[open.length - 1].name
      return name === 'wait_agent' || name === 'wait' ? 'waiting' : `tool:${name}`
    }
    return 'model'
  }
  for (const row of rows) {
    const t = Date.parse(row.timestamp)
    if (Number.isNaN(t)) continue
    if (prevT !== null) add(bucketName(), t - prevT)
    if (row.type === 'event_msg') {
      if (row.payload?.type === 'task_started') turnActive = true
      else if (row.payload?.type === 'task_complete') turnActive = false
    } else if (row.type === 'response_item') {
      const p = row.payload
      if (isCallOpen(p) && p.call_id) {
        open.push({ call_id: p.call_id, name: p.name })
      } else if (isCallOutput(p) && p.call_id) {
        const idx = open.findIndex(o => o.call_id === p.call_id)
        if (idx !== -1) open.splice(idx, 1)
      }
    }
    prevT = t
  }
  return buckets
}

// ---------------------------------------------------------------------------
// Window filtering

function rowTimestamps(rows) {
  return rows.map(r => Date.parse(r.timestamp)).filter(t => !Number.isNaN(t))
}

export function resolveWindow(nodes, fromArg, toArg) {
  const all = nodes.flatMap(n => rowTimestamps(n.rows))
  const from = fromArg ? Date.parse(fromArg) : Math.min(...all)
  const to = toArg ? Date.parse(toArg) : Math.max(...all)
  return { from, to }
}

function windowFilter(rows, from, to) {
  return rows.filter(r => {
    const t = Date.parse(r.timestamp)
    return !Number.isNaN(t) && t >= from && t <= to
  })
}

// ---------------------------------------------------------------------------
// Token / role / model extraction

function sumTokens(rows) {
  const totals = { input: 0, cachedInput: 0, output: 0, reasoningOutput: 0 }
  const requestInputs = []
  for (const row of rows) {
    if (row.type !== 'token_usage_record') continue
    const usage = row.payload?.usage || {}
    totals.input += usage.input_tokens || 0
    totals.cachedInput += usage.cached_input_tokens || 0
    totals.output += usage.output_tokens || 0
    totals.reasoningOutput += usage.reasoning_output_tokens || 0
    requestInputs.push(usage.input_tokens || 0)
  }
  return { totals, requestInputs }
}

function classifyRole(agentPath) {
  if (typeof agentPath === 'string') {
    if (agentPath.includes('executor')) return 'executor'
    if (agentPath.includes('supervisor')) return 'supervisor'
  }
  return 'other'
}

function lastTurnContext(rows) {
  let last = null
  for (const row of rows) if (row.type === 'turn_context') last = row.payload
  return last || {}
}

function countCompactions(rows) {
  return rows.filter(r => r.type === 'compacted').length
}

function countThreadLimitErrors(rows) {
  const MARKER = 'collab spawn failed: agent thread limit reached'
  let count = 0
  for (const row of rows) {
    if (row.type !== 'response_item' || !isCallOutput(row.payload)) continue
    const output = row.payload.output
    const text = typeof output === 'string' ? output : JSON.stringify(output ?? '')
    if (text.includes(MARKER)) count++
  }
  return count
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
function mean(values) {
  if (!values.length) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

// ---------------------------------------------------------------------------
// Claude time bucketing
//
// A Claude Code transcript has no explicit turn-boundary event, so the turn
// state is inferred from row shape instead of a task_started/task_complete
// pair: a 'user' row starts a turn unless its content is entirely
// 'tool_result' items (that's a tool answer flowing back into an ongoing
// turn, not a new request); an 'assistant' row with no 'tool_use' item ends
// the turn (a final answer, nothing left pending). Between two consecutive
// rows the elapsed time is charged, as in timeBucketsMs, to the state that
// was true going into that interval: outside a turn -> "user", inside a
// turn with a tool call open -> "tool:<name>" (or "waiting" for the Task
// tool, which spawns a background agent and is awaited much like codex's
// wait_agent), inside a turn with nothing open -> "model".

function isRealClaudeUserRow(row) {
  if (row.type !== 'user') return false
  const content = row.message?.content
  if (typeof content !== 'object' || content === null) return true
  if (!Array.isArray(content)) return true
  return content.some(item => !(item && item.type === 'tool_result'))
}

function claudeToolResultIds(row) {
  const content = row.message?.content
  if (!Array.isArray(content)) return []
  return content.filter(item => item && item.type === 'tool_result').map(item => item.tool_use_id)
}

function claudeToolUseItems(row) {
  const content = row.message?.content
  if (!Array.isArray(content)) return []
  return content.filter(item => item && item.type === 'tool_use')
}

export function timeBucketsMsClaude(rows) {
  const buckets = {}
  const add = (name, ms) => { if (ms > 0) buckets[name] = (buckets[name] || 0) + ms }
  let turnActive = false
  const open = []
  let prevT = null
  const bucketName = () => {
    if (!turnActive) return 'user'
    if (open.length) {
      const name = open[open.length - 1].name
      return name === 'Task' ? 'waiting' : `tool:${name}`
    }
    return 'model'
  }
  for (const row of rows) {
    const t = Date.parse(row.timestamp)
    if (Number.isNaN(t)) continue
    if (prevT !== null) add(bucketName(), t - prevT)
    if (row.type === 'user') {
      if (isRealClaudeUserRow(row)) turnActive = true
      for (const id of claudeToolResultIds(row)) {
        const idx = open.findIndex(o => o.id === id)
        if (idx !== -1) open.splice(idx, 1)
      }
    } else if (row.type === 'assistant') {
      const uses = claudeToolUseItems(row)
      for (const use of uses) open.push({ id: use.id, name: use.name })
      if (!uses.length) turnActive = false
    }
    prevT = t
  }
  return buckets
}

// ---------------------------------------------------------------------------
// Claude token / role / model extraction

function sumTokensClaude(rows) {
  const totals = { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 }
  const requestInputs = []
  for (const row of rows) {
    if (row.type !== 'assistant') continue
    const usage = row.message?.usage
    if (!usage) continue
    const input = usage.input_tokens || 0
    totals.input += input
    totals.cacheCreation += usage.cache_creation_input_tokens || 0
    totals.cacheRead += usage.cache_read_input_tokens || 0
    totals.output += usage.output_tokens || 0
    requestInputs.push(input)
  }
  return { totals, requestInputs }
}

function lastAssistantModel(rows) {
  let model = null
  for (const row of rows) {
    if (row.type === 'assistant' && row.message?.model) model = row.message.model
  }
  return model
}

// A child's role comes from its meta sidecar: an explicit `role`, or a
// `label` classified the same way codex's classifyRole reads an agent_path
// (substring match), falling back to 'other' when neither is available.
function classifyRoleClaude(meta) {
  if (meta && typeof meta.role === 'string' && meta.role) return meta.role
  const label = meta && typeof meta.label === 'string' ? meta.label : null
  if (label) {
    if (label.includes('executor')) return 'executor'
    if (label.includes('supervisor')) return 'supervisor'
  }
  return 'other'
}

// Cache writes (cache_creation_input_tokens) are priced as input; cache
// reads (cache_read_input_tokens) get the cached/discounted price.
function costForClaude(prices, model, tokens) {
  const p = priceFor(prices, model)
  if (!p) return null
  const [inputPrice, cachedPrice, outputPrice] = p
  const billableInput = tokens.input + tokens.cacheCreation
  return billableInput / 1e6 * inputPrice + tokens.cacheRead / 1e6 * cachedPrice + tokens.output / 1e6 * outputPrice
}

// ---------------------------------------------------------------------------
// Concurrency

export function concurrencyMs(intervals, from, to) {
  const buckets = { '0': 0, '1': 0, '2': 0, '3+': 0 }
  const delta = new Map()
  const bump = (t, d) => delta.set(t, (delta.get(t) || 0) + d)
  for (const [start, end] of intervals) {
    const s = Math.max(start, from), e = Math.min(end, to)
    if (e <= s) continue
    bump(s, 1)
    bump(e, -1)
  }
  bump(from, 0)
  bump(to, 0)
  const times = [...delta.keys()].sort((a, b) => a - b)
  let active = 0
  for (let i = 0; i < times.length - 1; i++) {
    active += delta.get(times[i])
    const dur = times[i + 1] - times[i]
    if (dur <= 0) continue
    const key = active >= 3 ? '3+' : String(active)
    buckets[key] += dur
  }
  return buckets
}

// ---------------------------------------------------------------------------
// Cost

function priceFor(prices, model) {
  const p = prices[model]
  return Array.isArray(p) && p.length === 3 ? p : null
}

function costFor(prices, model, totals) {
  const p = priceFor(prices, model)
  if (!p) return null
  const [inputPrice, cachedPrice, outputPrice] = p
  const billableOutput = totals.output + totals.reasoningOutput
  return totals.input / 1e6 * inputPrice + totals.cachedInput / 1e6 * cachedPrice + billableOutput / 1e6 * outputPrice
}

const round = (n, places = 6) => {
  if (n === null || n === undefined) return n
  const f = 10 ** places
  return Math.round(n * f) / f
}

// ---------------------------------------------------------------------------
// Report assembly

export function buildReport(run, opts) {
  const prices = opts.prices || {}
  const { from, to } = resolveWindow([run.root, ...run.children], opts.from, opts.to)

  const rootRows = windowFilter(run.root.rows, from, to)
  const rootBucketsMs = timeBucketsMs(rootRows)
  const rootMinutes = {}
  for (const [name, ms] of Object.entries(rootBucketsMs)) rootMinutes[name] = round(ms / 60000, 4)
  const { totals: rootTokenTotals, requestInputs: rootRequestInputs } = sumTokens(rootRows)
  const rootContext = lastTurnContext(rootRows)

  const childNodes = run.children.map(node => {
    const rows = windowFilter(node.rows, from, to)
    const role = classifyRole(node.meta?.agent_path)
    const context = lastTurnContext(rows)
    const timestamps = rowTimestamps(rows)
    const interval = timestamps.length ? [Math.min(...timestamps), Math.max(...timestamps)] : null
    const wallMs = interval ? interval[1] - interval[0] : 0
    const { totals, requestInputs } = sumTokens(rows)
    const buckets = timeBucketsMs(rows)
    const modelMs = buckets.model || 0
    let toolMs = 0
    for (const [name, ms] of Object.entries(buckets)) if (name !== 'model' && name !== 'user') toolMs += ms
    return {
      id: node.id,
      agentPath: node.meta?.agent_path ?? null,
      role,
      model: context.model ?? null,
      effort: context.effort ?? null,
      wallMinutes: round(wallMs / 60000, 4),
      requests: requestInputs.length,
      tokens: { ...totals, total: totals.input + totals.cachedInput + totals.output + totals.reasoningOutput },
      modelMinutes: round(modelMs / 60000, 4),
      toolMinutes: round(toolMs / 60000, 4),
      interval,
      threadLimitErrorsInWindow: countThreadLimitErrors(rows),
    }
  })
  const children = childNodes.map(({ interval, threadLimitErrorsInWindow, ...rest }) => rest)

  const concurrency = concurrencyMs(childNodes.filter(c => c.interval).map(c => c.interval), from, to)
  const concurrencyMinutes = {}
  for (const [k, ms] of Object.entries(concurrency)) concurrencyMinutes[k] = round(ms / 60000, 4)

  const threadLimitErrors = countThreadLimitErrors(rootRows) + childNodes.reduce((sum, c) => sum + c.threadLimitErrorsInWindow, 0)

  // Cost by role x model.
  const groups = new Map()
  const bump = (role, model, totals) => {
    const key = `${role}\u0000${model ?? '(unknown)'}`
    if (!groups.has(key)) groups.set(key, { role, model, tokens: { input: 0, cachedInput: 0, output: 0, reasoningOutput: 0 } })
    const g = groups.get(key)
    g.tokens.input += totals.input
    g.tokens.cachedInput += totals.cachedInput
    g.tokens.output += totals.output
    g.tokens.reasoningOutput += totals.reasoningOutput
  }
  bump('orchestrator', rootContext.model ?? null, rootTokenTotals)
  for (const c of children) bump(c.role, c.model, c.tokens)

  const byRoleModel = [], unpriced = []
  let total = 0
  for (const g of groups.values()) {
    const cost = g.model ? costFor(prices, g.model, g.tokens) : null
    if (cost === null) {
      unpriced.push({ role: g.role, model: g.model, tokens: { ...g.tokens, total: g.tokens.input + g.tokens.cachedInput + g.tokens.output + g.tokens.reasoningOutput } })
    } else {
      byRoleModel.push({ role: g.role, model: g.model, tokens: { ...g.tokens, total: g.tokens.input + g.tokens.cachedInput + g.tokens.output + g.tokens.reasoningOutput }, cost: round(cost) })
      total += cost
    }
  }

  return {
    window: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    orchestrator: {
      id: run.root.id,
      model: rootContext.model ?? null,
      effort: rootContext.effort ?? null,
      minutes: rootMinutes,
      requests: rootRequestInputs.length,
      medianInputTokens: median(rootRequestInputs),
      meanInputTokens: mean(rootRequestInputs) === null ? null : round(mean(rootRequestInputs), 4),
      compactions: countCompactions(rootRows),
    },
    children,
    concurrency: concurrencyMinutes,
    threadLimitErrors,
    cost: { byRoleModel, unpriced, total: round(total) },
  }
}

// Same report shape as buildReport: window, orchestrator (time buckets,
// requests, token stats), children (role, model, tokens, wall/model/tool
// minutes), concurrency and cost by role x model. `effort` (a codex
// reasoning-effort setting), `compactions` and `threadLimitErrors` have no
// Claude-transcript equivalent in this schema, so they report null/0 rather
// than a guessed value.
export function buildClaudeReport(run, opts) {
  const prices = opts.prices || {}
  const { from, to } = resolveWindow([run.root, ...run.children], opts.from, opts.to)

  const rootRows = windowFilter(run.root.rows, from, to)
  const rootBucketsMs = timeBucketsMsClaude(rootRows)
  const rootMinutes = {}
  for (const [name, ms] of Object.entries(rootBucketsMs)) rootMinutes[name] = round(ms / 60000, 4)
  const { totals: rootTokenTotals, requestInputs: rootRequestInputs } = sumTokensClaude(rootRows)
  const rootModel = lastAssistantModel(rootRows)

  const childNodes = run.children.map(node => {
    const rows = windowFilter(node.rows, from, to)
    const role = classifyRoleClaude(node.meta)
    const model = lastAssistantModel(rows)
    const timestamps = rowTimestamps(rows)
    const interval = timestamps.length ? [Math.min(...timestamps), Math.max(...timestamps)] : null
    const wallMs = interval ? interval[1] - interval[0] : 0
    const { totals, requestInputs } = sumTokensClaude(rows)
    const buckets = timeBucketsMsClaude(rows)
    const modelMs = buckets.model || 0
    let toolMs = 0
    for (const [name, ms] of Object.entries(buckets)) if (name !== 'model' && name !== 'user') toolMs += ms
    return {
      id: node.id,
      role,
      model,
      wallMinutes: round(wallMs / 60000, 4),
      requests: requestInputs.length,
      tokens: { ...totals, total: totals.input + totals.cacheCreation + totals.cacheRead + totals.output },
      modelMinutes: round(modelMs / 60000, 4),
      toolMinutes: round(toolMs / 60000, 4),
      interval,
    }
  })
  const children = childNodes.map(({ interval, ...rest }) => rest)

  const concurrency = concurrencyMs(childNodes.filter(c => c.interval).map(c => c.interval), from, to)
  const concurrencyMinutes = {}
  for (const [k, ms] of Object.entries(concurrency)) concurrencyMinutes[k] = round(ms / 60000, 4)

  // Cost by role x model.
  const groups = new Map()
  const bump = (role, model, totals) => {
    const key = `${role}\u0000${model ?? '(unknown)'}`
    if (!groups.has(key)) groups.set(key, { role, model, tokens: { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 } })
    const g = groups.get(key)
    g.tokens.input += totals.input
    g.tokens.cacheCreation += totals.cacheCreation
    g.tokens.cacheRead += totals.cacheRead
    g.tokens.output += totals.output
  }
  bump('orchestrator', rootModel, rootTokenTotals)
  for (const c of children) bump(c.role, c.model, c.tokens)

  const byRoleModel = [], unpriced = []
  let total = 0
  for (const g of groups.values()) {
    const cost = g.model ? costForClaude(prices, g.model, g.tokens) : null
    const tokens = { ...g.tokens, total: g.tokens.input + g.tokens.cacheCreation + g.tokens.cacheRead + g.tokens.output }
    if (cost === null) {
      unpriced.push({ role: g.role, model: g.model, tokens })
    } else {
      byRoleModel.push({ role: g.role, model: g.model, tokens, cost: round(cost) })
      total += cost
    }
  }

  return {
    window: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    orchestrator: {
      id: run.root.id,
      model: rootModel,
      effort: null,
      minutes: rootMinutes,
      requests: rootRequestInputs.length,
      medianInputTokens: median(rootRequestInputs),
      meanInputTokens: mean(rootRequestInputs) === null ? null : round(mean(rootRequestInputs), 4),
      compactions: 0,
    },
    children,
    concurrency: concurrencyMinutes,
    threadLimitErrors: 0,
    cost: { byRoleModel, unpriced, total: round(total) },
  }
}

// ---------------------------------------------------------------------------
// Rendering

function fmtMinutes(n) {
  return (n ?? 0).toFixed(2)
}

export function renderTable(report) {
  const lines = []
  lines.push(`window: ${report.window.from} .. ${report.window.to}`)
  lines.push('')
  lines.push('orchestrator:')
  lines.push(`  id: ${report.orchestrator.id}`)
  lines.push(`  model: ${report.orchestrator.model} (${report.orchestrator.effort})`)
  lines.push(`  requests: ${report.orchestrator.requests}  median input tokens: ${report.orchestrator.medianInputTokens}  mean: ${report.orchestrator.meanInputTokens}  compactions: ${report.orchestrator.compactions}`)
  lines.push('  minutes:')
  for (const [name, minutes] of Object.entries(report.orchestrator.minutes).sort()) {
    lines.push(`    ${name}: ${fmtMinutes(minutes)}`)
  }
  lines.push('')
  lines.push('children:')
  if (!report.children.length) lines.push('  (none)')
  for (const c of report.children) {
    lines.push(`  ${c.id}  role=${c.role}  model=${c.model} (${c.effort})  wall=${fmtMinutes(c.wallMinutes)}m  requests=${c.requests}  tokens=${c.tokens.total}  model=${fmtMinutes(c.modelMinutes)}m  tool=${fmtMinutes(c.toolMinutes)}m`)
  }
  lines.push('')
  lines.push('concurrency (minutes with N children active):')
  for (const [k, minutes] of Object.entries(report.concurrency)) lines.push(`  ${k}: ${fmtMinutes(minutes)}`)
  lines.push('')
  lines.push(`thread-limit errors: ${report.threadLimitErrors}`)
  lines.push('')
  lines.push('cost by role x model:')
  for (const g of report.cost.byRoleModel) lines.push(`  ${g.role} / ${g.model}: $${g.cost.toFixed(6)} (tokens=${g.tokens.total})`)
  if (report.cost.unpriced.length) {
    lines.push('  unpriced:')
    for (const g of report.cost.unpriced) lines.push(`    ${g.role} / ${g.model ?? '(unknown)'}: tokens=${g.tokens.total} (no price on record)`)
  }
  lines.push(`  total: $${report.cost.total.toFixed(6)}`)
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Entry point

function loadPrices(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`could not read prices file ${path}: ${error.message}`)
  }
}

function main(argv) {
  const opts = parseArgs(argv)
  const prices = loadPrices(opts.prices ? resolve(opts.prices) : DEFAULT_PRICES)
  let report
  if (opts.subcommand === 'codex') {
    const rootPath = resolve(opts.root)
    const sessionsDir = opts.sessions ? resolve(opts.sessions) : join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions')
    const run = loadCodexRun(rootPath, sessionsDir)
    report = buildReport(run, { from: opts.from, to: opts.to, prices })
  } else {
    const transcriptPath = resolve(opts.transcript)
    const run = loadClaudeRun(transcriptPath)
    report = buildClaudeReport(run, { from: opts.from, to: opts.to, prices })
  }
  if (opts.json) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(renderTable(report))
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
