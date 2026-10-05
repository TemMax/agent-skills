// Runs a REAL workflow-script file offline: same file that ships, stubbed
// runtime. The workflow dialect has no imports and returns via top-level
// `return`, so the file body is legal inside an async function once the single
// `export` is neutralised.
import { readFile } from 'node:fs/promises'

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

export async function runWorkflow(scriptPath, { args, agentStub, verifyStub }) {
  let src = await readFile(scriptPath, 'utf8')
  src = src.replace(/^export const meta/m, 'const meta')

  const calls = []
  const agent = async (prompt, opts = {}) => {
    calls.push({ prompt, opts })
    return agentStub(prompt, opts, calls.length - 1)
  }
  // Faithful to the documented contract: stages run per item with no barrier;
  // a throwing stage drops that item to null and skips its remaining stages.
  const pipeline = (items, ...stages) =>
    Promise.all(items.map(async (item, index) => {
      let prev = item
      for (const stage of stages) {
        try { prev = await stage(prev, item, index) } catch { return null }
      }
      return prev
    }))
  // Thunks run concurrently; a rejecting thunk resolves to null, never rejects.
  const parallel = (thunks) => Promise.all(thunks.map((t) => Promise.resolve().then(t).catch(() => null)))
  const phase = () => {}
  const log = () => {}
  const budget = { total: null, spent: () => 0, remaining: () => Infinity }
  const workflow = async () => { throw new Error('nested workflow() is not simulated') }

  const fn = new AsyncFunction('agent', 'pipeline', 'parallel', 'phase', 'log', 'args', 'budget', 'workflow', 'verify', src)
  const result = await fn(agent, pipeline, parallel, phase, log, args, budget, workflow, verifyStub)
  return { result, calls }
}
