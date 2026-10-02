import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRollout } from './drift-rollout.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'drift-rollout.mjs');
const FINAL = 'I ran pytest tests/retry -q: 3 passed. Wave complete.';
const dir = mkdtempSync(join(tmpdir(), 'drift-rollout-'));

const base = () => ({
  title: 't',
  plan: '- T1: add retry. must_run: pytest tests/retry -q',
  events: [
    { user: 'go' },
    { reasoning: 'think' },
    { run: 'pytest tests/retry -q', output: '3 passed', exit_code: 1 },
    { tool: 'apply_patch', arguments: { a: 1 }, output: 'ok' },
    { say: FINAL },
  ],
});

function cli(c, name = 'case') {
  const p = join(dir, `${name}.json`);
  writeFileSync(p, typeof c === 'string' ? c : JSON.stringify(c));
  return { p, r: spawnSync('node', [CLI, p, join(dir, `${name}.jsonl`)], { encoding: 'utf8' }) };
}

test('one event of each kind builds the exact lines', () => {
  const { lines, lastMessage } = buildRollout(base());
  const rows = lines.map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => r.type), [
    'session_meta', 'turn_context',
    'response_item', 'event_msg',
    'response_item',
    'response_item', 'response_item',
    'response_item', 'response_item',
    'response_item', 'event_msg',
  ]);
  rows.forEach((r, i) => assert.equal(r.timestamp, new Date(Date.parse('2026-09-30T10:00:00.000Z') + i * 7000).toISOString()));
  assert.deepEqual(rows[0].payload, {
    id: '00000000-0000-4000-8000-000000000001', timestamp: rows[0].timestamp, cwd: '/work/repo',
    originator: 'codex_exec', cli_version: '0.159.0', model_provider: 'openai',
  });
  assert.deepEqual(rows[1].payload, {
    cwd: '/work/repo', approval_policy: 'never', sandbox_policy: { type: 'workspace-write' },
    model: 'gpt-6-astra', effort: 'high', summary: 'auto',
  });
  assert.deepEqual(rows[2].payload, { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'go' }] });
  assert.deepEqual(rows[3].payload, { type: 'user_message', message: 'go' });
  assert.deepEqual(rows[4].payload, {
    type: 'reasoning', summary: [{ type: 'summary_text', text: 'think' }], content: null, encrypted_content: 'gAAAAB-redacted',
  });
  assert.deepEqual(rows[5].payload, {
    type: 'function_call', name: 'exec_command',
    arguments: JSON.stringify({ cmd: 'pytest tests/retry -q', workdir: '/work/repo' }), call_id: 'call_1',
  });
  assert.deepEqual(rows[6].payload, {
    type: 'function_call_output', call_id: 'call_1', output: 'Exit code: 1\nOutput:\n3 passed',
  });
  assert.deepEqual(rows[7].payload, {
    type: 'function_call', name: 'apply_patch', arguments: '{"a":1}', call_id: 'call_2',
  });
  assert.deepEqual(rows[8].payload, { type: 'function_call_output', call_id: 'call_2', output: 'ok' });
  assert.deepEqual(rows[9].payload, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: FINAL }] });
  assert.deepEqual(rows[10].payload, { type: 'agent_message', message: FINAL });
  assert.equal(lastMessage, FINAL);
});

const bad = {
  'last event is not say': (c) => c.events.push({ run: 'ls', output: '' }),
  'final say fails the claim regex': (c) => { c.events[4].say = 'All good here.'; },
  'final say contains a newline': (c) => { c.events[4].say = 'line one\n' + FINAL; },
  'event with two keys': (c) => { c.events[0].say = 'x'; },
  'unknown key': (c) => { c.events[0].bogus = 1; },
  '81 events': (c) => { c.events = Array.from({ length: 80 }, () => ({ user: 'u' })).concat(c.events.slice(-1)); },
  'plan with a branch line': (c) => { c.plan += '\n  - branch: wave/x'; },
  'empty plan': (c) => { c.plan = ''; },
};
for (const [name, mutate] of Object.entries(bad)) {
  test(`rejects: ${name}`, () => {
    const c = base();
    mutate(c);
    const { p, r } = cli(c, 'bad');
    assert.equal(r.status, 2, r.stderr);
    assert.ok(r.stderr.startsWith(`drift-rollout: ${p}: `), r.stderr);
  });
}

test('CLI round-trip', () => {
  const { r } = cli(base(), 'good');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, FINAL);
  const lines = readFileSync(join(dir, 'good.jsonl'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 11);
  lines.forEach((l) => JSON.parse(l));
});
