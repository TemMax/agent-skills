import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const policy = 'User-facing updates state the task, checks and results. Do not announce skills, instruction/profile filenames or loading, runtime model/effort or selection metadata.';
for (const plugin of ['code-review', 'orchestration']) {
  const root = new URL(`../../plugins/${plugin}/`, import.meta.url);
  const handlers = () => {
    const map = new Map();
    return import(new URL('hooks/runtime-context.mjs', root)).then(({ register }) => {
      register((name, handler) => map.set(name, handler)); return map;
    });
  };
  test(`${plugin}: delivers host identity at startup/resume and preserves other hook results`, async () => {
    const h = await handlers();
    let model = 'claude-fable-5-1';
    const api = { session: { model: async () => model } };
    const legacy = `PLUGIN_RUNTIME_CONTEXT_V1 plugin=${plugin} host=claude model=claude-opus-5-5 effort=unknown\n${policy}`;
    const original = { additionalContext: ['Other plugin', legacy, policy], block: 'Keep block', sessionTitle: 'Keep title' };
    for (const source of ['startup', 'resume', 'clear', 'compact', 'fork']) {
      model = source === 'startup' ? 'claude-fable-5-1' : 'claude-opus-5-5[1m]';
      const result = await h.get('classic.SessionStart')(api, { source }, async () => original);
      assert.deepEqual(result, { ...original, additionalContext: ['Other plugin',
        `PLUGIN_RUNTIME_CONTEXT_V1 plugin=${plugin} host=claude model=${model} effort=unknown\n${policy}`] });
    }
    const prompt = { text: 'User prompt', context: ['Other context'] };
    assert.deepEqual(await h.get('prompt.submit')(api, prompt, async e => e), prompt, 'First prompt must not duplicate startup');
    model = 'claude-haiku-4-5-20251001';
    const changed = await h.get('prompt.submit')(api, prompt, async e => e);
    assert.equal(changed.text, prompt.text);
    assert.deepEqual(changed.context, ['Other context', `PLUGIN_RUNTIME_CONTEXT_V1 plugin=${plugin} host=claude model=${model} effort=unknown\n${policy}`]);
    assert.deepEqual(await h.get('prompt.submit')(api, prompt, async e => e), prompt, 'Unchanged model must not repeat context');
  });
  test(`${plugin}: child identity never borrows the main model and failed API retains fallback`, async () => {
    const h = await handlers();
    const api = { session: { model: async () => { throw Error('Main model must not be queried for child'); } } };
    const result = await h.get('classic.SubagentStart')(api, { agent_id: 'child' }, async () => ({ additionalContext: ['Other', policy] }));
    assert.deepEqual(result.additionalContext, ['Other', `PLUGIN_RUNTIME_CONTEXT_V1 plugin=${plugin} host=claude model=unknown effort=unknown\n${policy}`]);
    const fallback = { additionalContext: [policy] };
    assert.equal(await h.get('classic.SessionStart')(api, {}, async () => fallback), fallback);
    for (const model of ['sonnet', 'gpt-6-sol', 'claude-x\nmodel=other']) {
      const result = await h.get('classic.SessionStart')({session:{model:async()=>model}}, {}, async () => fallback);
      assert.equal(result, fallback, 'Unresolved/malformed identity must not be claimed');
    }
  });
  test(`${plugin}: dropped or stripped prompt does not suppress the next delivery`, async () => {
    const h = await handlers();
    let model = 'claude-fable-5-1';
    const api = { session: { model: async () => model } };
    await h.get('classic.SessionStart')(api, {}, async () => ({}));
    model = 'claude-opus-5-5';
    await h.get('prompt.submit')(api, {text:'Blocked'}, async () => ({drop:'Blocked by hook'}));
    let result = await h.get('prompt.submit')(api, {text:'Allowed'}, async e => e);
    assert.ok(result.context?.[0].includes('model=claude-opus-5-5'));
    model = 'claude-fable-5-1';
    await h.get('prompt.submit')(api, {text:'Stripped'}, async () => ({text:'Stripped'}));
    result = await h.get('prompt.submit')(api, {text:'Allowed'}, async e => e);
    assert.ok(result.context?.[0].includes('model=claude-fable-5-1'));
  });
  test(`${plugin}: failed lifecycle lookup invalidates earlier delivery state`, async () => {
    const h = await handlers();
    let outage = false;
    const api = {session:{model:async()=>{if(outage)throw Error('API outage');return 'claude-fable-5-1';}}};
    await h.get('classic.SessionStart')(api, {source:'startup'}, async () => ({}));
    outage = true;
    await h.get('classic.SessionStart')(api, {source:'clear'}, async () => ({}));
    outage = false;
    const result = await h.get('prompt.submit')(api, {text:'After clear'}, async e => e);
    assert.ok(result.context?.[0].includes('model=claude-fable-5-1'));
  });
  test(`${plugin}: Codex keeps the original shell events without Claude modules`, () => {
    const codex = JSON.parse(readFileSync(new URL('.codex-plugin/plugin.json', root)));
    const config = JSON.parse(readFileSync(new URL(codex.hooks, root)));
    const claude = JSON.parse(readFileSync(new URL('hooks/hooks.json', root)));
    assert.equal(config.modules, undefined);
    assert.deepEqual(config.hooks, claude.hooks);
    assert.deepEqual(claude.modules, ['./runtime-context.mjs']);
  });
}
