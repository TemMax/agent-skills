#!/usr/bin/env node
// Builds a Codex-style rollout JSONL from a held-out drift case.
// Usage: node tests/eval/drift-rollout.mjs <case.json> <out.jsonl>
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CLAIM = /\b(i|we) (ran|verified|merged|pushed|completed|finished|tested)\b|\ball (tasks|three|of them)\b|\b(wave|task|plan)\b[^.]{0,40}\b(complete|done|finished)\b|\bnothing remaining\b|\bsummary:/i;
const BRANCH_LINE = /^\s*-?\s*"?branch"?\s*:/m;
const KINDS = ['say', 'user', 'reasoning', 'run', 'tool'];
const EXTRA = { say: [], user: [], reasoning: [], run: ['output', 'exit_code'], tool: ['arguments', 'output'] };
const START = Date.parse('2026-09-30T10:00:00.000Z');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';

export function validateCase(c) {
  if (!isObj(c)) return 'case must be a JSON object';
  for (const k of Object.keys(c)) {
    if (!['title', 'plan', 'events'].includes(k)) return `unknown key "${k}"`;
  }
  if (!isStr(c.title) || c.title.trim() === '') return 'title must be a non-empty string';
  if (!isStr(c.plan) || c.plan.trim() === '') return 'plan must be a non-empty string';
  if (BRANCH_LINE.test(c.plan)) return 'plan must not contain a branch: line';
  if (!Array.isArray(c.events) || c.events.length < 1 || c.events.length > 80) {
    return 'events must be a list of 1-80 objects';
  }
  for (let i = 0; i < c.events.length; i++) {
    const e = c.events[i];
    const at = `event ${i + 1}`;
    if (!isObj(e)) return `${at} must be an object`;
    const kinds = Object.keys(e).filter((k) => KINDS.includes(k));
    if (kinds.length !== 1) return `${at} must have exactly one of ${KINDS.join(', ')}`;
    const kind = kinds[0];
    for (const k of Object.keys(e)) {
      if (k !== kind && !EXTRA[kind].includes(k)) return `${at} has unknown key "${k}"`;
    }
    if (!isStr(e[kind])) return `${at} ${kind} must be a string`;
    if (kind === 'say' && e.say.trim() === '') return `${at} say must not be empty`;
    if (kind === 'run') {
      if (!isStr(e.output)) return `${at} run needs a string output`;
      if ('exit_code' in e && !Number.isInteger(e.exit_code)) return `${at} exit_code must be an integer`;
    }
    if (kind === 'tool') {
      if (!isObj(e.arguments)) return `${at} tool needs an object arguments`;
      if (!isStr(e.output)) return `${at} tool needs a string output`;
    }
  }
  const last = c.events[c.events.length - 1];
  if (!('say' in last)) return 'last event must be a say';
  if (last.say.includes('\n') || last.say.includes('\r')) return 'final say must be a single line';
  if (!CLAIM.test(last.say)) return 'final say does not match the claim regex';
  return null;
}

export function buildRollout(c) {
  const err = validateCase(c);
  if (err) throw new Error(err);
  const lines = [];
  const add = (type, payload) => {
    const timestamp = new Date(START + lines.length * 7000).toISOString();
    lines.push(JSON.stringify({ timestamp, type, payload }));
  };
  const ts0 = new Date(START).toISOString();
  add('session_meta', {
    id: '00000000-0000-4000-8000-000000000001', timestamp: ts0, cwd: '/work/repo',
    originator: 'codex_exec', cli_version: '0.159.0', model_provider: 'openai',
  });
  add('turn_context', {
    cwd: '/work/repo', approval_policy: 'never', sandbox_policy: { type: 'workspace-write' },
    model: 'gpt-6-astra', effort: 'high', summary: 'auto',
  });
  let n = 0;
  for (const e of c.events) {
    if ('say' in e) {
      add('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: e.say }] });
      add('event_msg', { type: 'agent_message', message: e.say });
    } else if ('user' in e) {
      add('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: e.user }] });
      add('event_msg', { type: 'user_message', message: e.user });
    } else if ('reasoning' in e) {
      add('response_item', {
        type: 'reasoning', summary: [{ type: 'summary_text', text: e.reasoning }],
        content: null, encrypted_content: 'gAAAAB-redacted',
      });
    } else if ('run' in e) {
      const call_id = `call_${++n}`;
      const code = 'exit_code' in e ? e.exit_code : 0;
      add('response_item', {
        type: 'function_call', name: 'exec_command',
        arguments: JSON.stringify({ cmd: e.run, workdir: '/work/repo' }), call_id,
      });
      add('response_item', { type: 'function_call_output', call_id, output: `Exit code: ${code}\nOutput:\n${e.output}` });
    } else {
      const call_id = `call_${++n}`;
      add('response_item', {
        type: 'function_call', name: e.tool, arguments: JSON.stringify(e.arguments), call_id,
      });
      add('response_item', { type: 'function_call_output', call_id, output: e.output });
    }
  }
  return { lines, lastMessage: c.events[c.events.length - 1].say };
}

function main(argv) {
  const [casePath, outPath] = argv;
  if (!casePath || !outPath) {
    process.stderr.write('usage: node tests/eval/drift-rollout.mjs <case.json> <out.jsonl>\n');
    return 2;
  }
  let c;
  try {
    c = JSON.parse(readFileSync(casePath, 'utf8'));
  } catch (e) {
    process.stderr.write(`drift-rollout: ${casePath}: ${e.message}\n`);
    return 2;
  }
  const err = validateCase(c);
  if (err) {
    process.stderr.write(`drift-rollout: ${casePath}: ${err}\n`);
    return 2;
  }
  const { lines, lastMessage } = buildRollout(c);
  writeFileSync(outPath, lines.join('\n') + '\n');
  process.stdout.write(lastMessage);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
