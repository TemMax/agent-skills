// Codex rollout parser for the telemetry CLI (tests/eval/telemetry/telemetry.mjs).
// Observed record shapes: Codex 0.154-0.155. Every rollout line is
// {"timestamp": ISO, "type": T, "payload": {...}}. See telemetry.mjs for the
// event vocabulary this module hands upward.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// Parse one rollout-*.jsonl file into an array of {timestamp, type, payload}
// rows, in file order (Codex appends rows chronologically).
export function parseRollout(path) {
  const text = readFileSync(path, 'utf8')
  const rows = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const row = JSON.parse(trimmed)
    rows.push(row)
  }
  return rows
}

// The single session_meta payload for a rollout. Codex writes exactly one
// per file, always near the top.
export function sessionMeta(rows) {
  const row = rows.find(r => r && r.type === 'session_meta')
  return row ? row.payload || {} : null
}

// The id a rollout is filed under (root or child alike).
export function sessionId(meta) {
  if (!meta) return null
  return meta.id ?? meta.session_id ?? null
}

// The id of the rollout that spawned this one, or null for a root. Handles
// the direct `parent_thread_id` field, the nested
// `source.subagent.parent_thread_id` shape, and the nested
// `source.subagent.thread_spawn.parent_thread_id` shape (the real one Codex
// writes for a spawned subagent thread).
export function parentId(meta) {
  if (!meta) return null
  if (meta.parent_thread_id) return meta.parent_thread_id
  const subagent = meta.source && meta.source.subagent
  if (subagent && typeof subagent === 'object') {
    if (subagent.parent_thread_id) return subagent.parent_thread_id
    const threadSpawn = subagent.thread_spawn
    if (threadSpawn && typeof threadSpawn === 'object' && threadSpawn.parent_thread_id) {
      return threadSpawn.parent_thread_id
    }
  }
  return null
}

// Recursively find every .jsonl file under a Codex sessions directory
// (normally ~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<id>.jsonl, but
// we don't assume the exact layout so a temp fixture tree also works).
export function discoverRolloutFiles(sessionsDir) {
  const out = []
  let entries
  try {
    entries = readdirSync(sessionsDir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const path = join(sessionsDir, entry.name)
    if (entry.isDirectory()) {
      out.push(...discoverRolloutFiles(path))
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      out.push(path)
    }
  }
  return out
}

// Load a root rollout plus every rollout that descends from it, at any
// depth: rollout B is included when its session_meta's parent id equals the
// root's id, or (recursively) the id of an already-included rollout.
//
// Returns { root: {id, path, rows, meta}, children: [{id, path, rows, meta,
// parentId}, ...] } where `children` is the full, flattened descendant set
// (direct children, grandchildren, ...), each carrying its own immediate
// parentId so callers can reconstruct the tree if they need to.
export function loadCodexRun(rootRolloutPath, sessionsDir) {
  const rootRows = parseRollout(rootRolloutPath)
  const rootMeta = sessionMeta(rootRows)
  if (!rootMeta) throw new Error(`no session_meta in root rollout: ${rootRolloutPath}`)
  const rootId = sessionId(rootMeta)
  if (!rootId) throw new Error(`root rollout has no session id: ${rootRolloutPath}`)

  const byId = new Map()
  byId.set(rootId, { id: rootId, path: rootRolloutPath, rows: rootRows, meta: rootMeta, parentId: null })

  if (sessionsDir) {
    for (const path of discoverRolloutFiles(sessionsDir)) {
      let rows
      try {
        rows = parseRollout(path)
      } catch {
        continue // malformed or unreadable file: not this run's concern
      }
      const meta = sessionMeta(rows)
      if (!meta) continue
      const id = sessionId(meta)
      if (!id || id === rootId) continue // keep the explicitly-given root copy
      if (byId.has(id)) continue // first discovery wins
      byId.set(id, { id, path, rows, meta, parentId: parentId(meta) })
    }
  }

  const children = []
  const found = new Set([rootId])
  const queue = [rootId]
  while (queue.length) {
    const current = queue.shift()
    for (const node of byId.values()) {
      if (found.has(node.id)) continue
      if (node.parentId === current) {
        found.add(node.id)
        children.push(node)
        queue.push(node.id)
      }
    }
  }

  return {
    root: { id: rootId, path: rootRolloutPath, rows: rootRows, meta: rootMeta },
    children: children.map(({ id, path, rows, meta, parentId: pid }) => ({ id, path, rows, meta, parentId: pid })),
  }
}

