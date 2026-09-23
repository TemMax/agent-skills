// Claude Code transcript parser for the telemetry CLI (tests/eval/telemetry/telemetry.mjs).
// Observed record shape: Claude Code writes a session transcript JSONL at
// ~/.claude/projects/<project>/<session-id>.jsonl. Every line has `type`
// ('user', 'assistant', 'system', ...) and `timestamp`; an assistant line's
// `message.usage` carries {input_tokens, cache_creation_input_tokens,
// cache_read_input_tokens, output_tokens} and `message.model` the model id.
// A tool call is a `message.content[]` item of type 'tool_use' (id, name),
// answered by a later user line whose `message.content` has a 'tool_result'
// with the same `tool_use_id`.
//
// Workflow runs write <project>/<session-id>/subagents/workflows/<run-id>/
// with journal.jsonl (a workflow-level event log, not a message transcript)
// and one agent-<id>.jsonl per agent, in the same line format as the
// orchestrator transcript, plus an agent-<id>.meta.json sidecar. Background
// Agent-tool subagents write directly under <session-id>/subagents/ with the
// same agent-<id>.jsonl / agent-<id>.meta.json convention. See telemetry.mjs
// for the bucket vocabulary and report shape this module's output feeds.
import { readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

// Parse one transcript .jsonl file into an array of raw row objects, in
// file order (Claude Code appends rows chronologically).
export function parseTranscript(path) {
  const text = readFileSync(path, 'utf8')
  const rows = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    rows.push(JSON.parse(trimmed))
  }
  return rows
}

// Recursively find every agent transcript under a session's subagents
// directory: direct background Agent-tool subagents
// (<session>/subagents/agent-<id>.jsonl) and workflow-run agents
// (<session>/subagents/workflows/<run-id>/agent-<id>.jsonl) alike.
// journal.jsonl files and .meta.json sidecars are not message transcripts
// and are not returned here.
export function discoverAgentFiles(subagentsDir) {
  const out = []
  let entries
  try {
    entries = readdirSync(subagentsDir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const path = join(subagentsDir, entry.name)
    if (entry.isDirectory()) {
      out.push(...discoverAgentFiles(path))
    } else if (entry.isFile() && /^agent-.+\.jsonl$/.test(entry.name)) {
      out.push(path)
    }
  }
  return out
}

// The id an agent-<id>.jsonl transcript is filed under.
function agentIdFromPath(path) {
  const name = basename(path)
  const m = name.match(/^agent-(.+)\.jsonl$/)
  return m ? m[1] : name
}

// The agent-<id>.meta.json sidecar for an agent transcript, or null when
// absent or unreadable.
function readMeta(agentPath) {
  const metaPath = agentPath.replace(/\.jsonl$/, '.meta.json')
  try {
    return JSON.parse(readFileSync(metaPath, 'utf8'))
  } catch {
    return null
  }
}

// Load an orchestrator session transcript plus every agent transcript filed
// under its subagents directory, at any depth (a workflow run's agents and
// direct Agent-tool subagents are both included; telemetry.mjs tells them
// apart, if it needs to, via each child's meta sidecar).
//
// Given .../<project>/<session-id>.jsonl, the subagents directory is
// .../<project>/<session-id>/subagents/.
//
// Returns { root: {id, path, rows}, children: [{id, path, rows, meta}, ...] }.
export function loadClaudeRun(transcriptPath) {
  const rootRows = parseTranscript(transcriptPath)
  const projectDir = dirname(transcriptPath)
  const sessionId = basename(transcriptPath).replace(/\.jsonl$/, '')
  const subagentsDir = join(projectDir, sessionId, 'subagents')

  const children = discoverAgentFiles(subagentsDir).map(path => ({
    id: agentIdFromPath(path),
    path,
    rows: parseTranscript(path),
    meta: readMeta(path),
  }))

  return {
    root: { id: sessionId, path: transcriptPath, rows: rootRows },
    children,
  }
}
