// Stage progress of a running wave: one line per transition, appended to
// <out>/progress.log and echoed to stderr. Elapsed time only — measured
// facts, never an estimate.
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

export const formatElapsed = (seconds) => {
  const total = Math.max(0, Math.floor(seconds))
  return String(Math.floor(total / 60)).padStart(2, '0') + ':' + String(total % 60).padStart(2, '0')
}

// The verdict part of a review line: accepted, or rejected with the distinct
// violation classes in order of appearance.
export const verdictNote = (verdict) => {
  if (!verdict || typeof verdict.ok !== 'boolean') return 'no verdict'
  if (verdict.ok) return 'accepted'
  const classes = [...new Set((verdict.violations || []).map((v) => v && v.class).filter(Boolean))]
  return 'rejected' + (classes.length ? ' (' + classes.join(', ') + ')' : '')
}

export function createProgress(outDir, tag) {
  const start = Date.now()
  const path = join(outDir, 'progress.log')
  return (task, text) => {
    const line = '[+' + formatElapsed((Date.now() - start) / 1000) + '] ' + task + ': ' + text
    // The run directory does not exist before the preflight has passed.
    try { appendFileSync(path, line + '\n', { mode: 0o600 }) } catch { /* stderr still carries it */ }
    process.stderr.write(tag + ': ' + line + '\n')
  }
}
