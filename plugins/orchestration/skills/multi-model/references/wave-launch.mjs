#!/usr/bin/env node
// Deterministic launcher generator for Claude waves. Zero dependencies.
// The host's Workflow tool rejects a scriptPath outside the working directory
// (the plugin cache is outside it), and hand-copying the wave input into a
// tool call invites transcription errors. This script writes a self-contained
// copy of wave-runner.workflow.mjs inside the repository with the wave input
// embedded as WAVE_ARGS; the orchestrator then calls
// Workflow({ scriptPath: <printed path> }) with no args.
//
// Usage: node wave-launch.mjs <plan-file> --wave <n> --base <40-hex sha>
//          --repo <absolute repo path> --default-branch <branch>
//          [--verifier <model>:<effort>] [--out <path>]
// Success: prints the generated file's absolute path on stdout, exit 0.
// Failure: one-line reason on stderr, exit 1 (2 for usage), nothing written.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { TASK_HEADING_SOURCE, effectivePlan, checkDependsOn, resolveWorktreeEnv, excludeFromGit } from './worktree-env.mjs'

const USAGE = 'usage: node wave-launch.mjs <plan-file> --wave <n> --base <40-hex sha>'
  + ' --repo <absolute repo path> --default-branch <branch>'
  + ' [--verifier <model>:<effort>] [--out <path>]'

const here = dirname(fileURLToPath(import.meta.url))
const LINT = join(here, '..', '..', 'super-plan', 'references', 'plan-lint.mjs')
const RUNNER = join(here, 'wave-runner.workflow.mjs')
const SUPERVISOR_PROMPT = join(here, 'supervisor-prompt.md')

function die(reason, code = 1) {
  process.stderr.write(String(reason).split('\n').map((l) => 'wave-launch: ' + l).join('\n') + '\n')
  process.exit(code)
}

// ---- arguments ----
const FLAGS = ['--wave', '--base', '--repo', '--default-branch', '--verifier', '--out']
const opts = {}
let planFile = null
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a.startsWith('--')) {
    if (!FLAGS.includes(a)) die('unknown option ' + a + ' — ' + USAGE, 2)
    if (i + 1 >= argv.length) die(a + ' needs a value — ' + USAGE, 2)
    if (a in opts) die(a + ' given twice', 2)
    opts[a] = argv[++i]
  } else if (planFile === null) {
    planFile = a
  } else {
    die('unexpected argument ' + a + ' — ' + USAGE, 2)
  }
}
if (planFile === null) die('missing <plan-file> — ' + USAGE, 2)
for (const f of ['--wave', '--base', '--repo', '--default-branch']) {
  if (!(f in opts)) die('missing ' + f + ' — ' + USAGE, 2)
}

// ---- 1. the plan must be lint-clean ----
const lint = spawnSync(process.execPath, [LINT, planFile, '--repo', opts['--repo']], { encoding: 'utf8' })
if (lint.status !== 0) {
  const first = String(lint.stdout || lint.stderr || '').split('\n').find((l) => l.startsWith('error:'))
  die('plan is not lint-clean' + (first ? ' (' + first.trim() + ')' : ''))
}

// ---- 2. validate the launch flags ----
if (!/^[0-9]+$/.test(opts['--wave'])) die('--wave must be a non-negative integer, got "' + opts['--wave'] + '"')
const waveNo = Number(opts['--wave'])
const base = opts['--base']
if (!/^[0-9a-f]{40}$/.test(base)) die('--base must be a 40-char lowercase hex sha, got "' + base + '"')
const repoPath = opts['--repo']
if (!isAbsolute(repoPath)) die('--repo must be an absolute path, got "' + repoPath + '"')
const defaultBranch = opts['--default-branch']
if (defaultBranch === '') die('--default-branch must be non-empty')
let verifier
if ('--verifier' in opts) {
  const m = /^([^:]+):([^:]+)$/.exec(opts['--verifier'])
  if (!m) die('--verifier must be <model>:<effort>, got "' + opts['--verifier'] + '"')
  verifier = { model: m[1], effort: m[2] }
}

// ---- 3. the base must already be pushed to the shared remote ----
// A fix wave's base often only exists on the local machine that ran the
// previous wave; refuse to launch executors against a base nobody else can
// see. The fetch is best-effort: if it fails (offline, no network to the
// remote), warn once and fall back to whatever origin/<branch> is already
// tracked locally, rather than blocking the launch on connectivity.
const fetch = spawnSync('git', ['-C', repoPath, 'fetch', '--quiet', 'origin', defaultBranch], { encoding: 'utf8' })
if (fetch.status !== 0) {
  const reason = String(fetch.stderr || (fetch.error && fetch.error.message) || '').trim().split('\n')[0]
  process.stderr.write('wave-launch: warning: git fetch origin ' + defaultBranch
    + (reason ? ' failed (' + reason + ')' : ' failed')
    + ', continuing with the existing origin/' + defaultBranch + ' tracking ref\n')
}
const ancestor = spawnSync('git', ['-C', repoPath, 'merge-base', '--is-ancestor', base, 'origin/' + defaultBranch],
  { encoding: 'utf8' })
if (ancestor.status !== 0) {
  die('base ' + base + ' is not on origin/' + defaultBranch + ' — push it first; a fix wave takes git rev-parse origin/' + defaultBranch)
}

// ---- 4. parse the plan ----
let text
try { text = readFileSync(planFile, 'utf8') } catch (e) { die('cannot read ' + planFile + ': ' + e.message) }
let plan
try { plan = effectivePlan(planFile, repoPath) } catch (e) { die(e.message) }

// A section runs from its heading line to the next `## Task ` heading or EOF.
const sections = new Map()
const headings = [...text.matchAll(new RegExp(TASK_HEADING_SOURCE, 'gm'))]
headings.forEach((m, i) => {
  const id = m[1].trim()
  const start = m.index + m[0].length
  const end = i + 1 < headings.length ? headings[i + 1].index : text.length
  sections.set(id, text.slice(start, end).trim())
})

const wave = (Array.isArray(plan.waves) ? plan.waves : []).find((w) => w && w.wave === waveNo)
if (!wave) die('wave ' + waveNo + ' not found in the plan')

// ---- 5. depends_on must already be satisfied ----
const unmet = checkDependsOn(plan, waveNo, repoPath)
if (unmet.length > 0) {
  die(unmet.map((u) => 'depends_on unmet for wave ' + waveNo + ': ' + u.reason).join('\n'))
}

// ---- 6. build the runner input ----
const tasks = (Array.isArray(wave.tasks) ? wave.tasks : []).map((t) => {
  const description = sections.get(t.id)
  if (description === undefined || description === '') die('task "' + t.id + '" has no "## Task ' + t.id + '" prose section')
  const { branch, ...rest } = t
  return { ...rest, description }
})
let supervisorPromptText
try { supervisorPromptText = readFileSync(SUPERVISOR_PROMPT, 'utf8') } catch (e) { die('cannot read supervisor-prompt.md: ' + e.message) }
const input = { base, defaultBranch, repoPath, supervisorPromptText, supervisor: wave.supervisor }
if (verifier) input.verifier = verifier
const env = resolveWorktreeEnv(repoPath, plan)
input.worktree = { links: env.links }
input.tasks = tasks

// ---- 7. embed it in the runner, after the meta literal ----
let runner
try { runner = readFileSync(RUNNER, 'utf8') } catch (e) { die('cannot read wave-runner.workflow.mjs: ' + e.message) }
const lines = runner.split('\n')
const metaStart = lines.indexOf('export const meta = {')
if (metaStart === -1) die('runner has no "export const meta = {" line')
const metaEnd = lines.indexOf('}', metaStart + 1)
if (metaEnd === -1) die('runner meta literal has no closing "}" line')
lines.splice(metaEnd + 1, 0, 'const WAVE_ARGS = ' + JSON.stringify(input))

// ---- 8. keep runner directories and linked files out of `git status` ----
// wave-launch.mjs is the only place that writes into .worktrees/ or links
// files like local.properties, so it is the only place that can exclude
// them; auto-detection above links an untracked local.properties whether or
// not it happens to already be gitignored.
try { excludeFromGit(repoPath, ['.worktrees/', ...env.links.map((l) => '/' + l)]) }
catch (e) { die('cannot update info/exclude: ' + e.message) }

// ---- 9. write and print ----
const out = '--out' in opts
  ? resolve(opts['--out'])
  : join(repoPath, '.worktrees', 'launch', 'wave-' + waveNo + '.workflow.mjs')
try {
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, lines.join('\n'))
} catch (e) { die('cannot write ' + out + ': ' + e.message) }
process.stdout.write(out + '\n')
