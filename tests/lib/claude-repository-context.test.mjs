import assert from 'node:assert/strict';
import { test } from 'node:test';

for (const plugin of ['code-review', 'orchestration']) {
  const url = new URL(`../../plugins/${plugin}/hooks/runtime-context.mjs`, import.meta.url);
  const handler = async () => {
    let hook;
    (await import(url)).register((event, h) => { if (event === 'prompt.context') hook = h; });
    return hook;
  };
  const files = [{ path: '/repo/CLAUDE.md', kind: 'project', content: 'Existing rules' }];
  const input = { blocks: [{name:'claudeMd',text:'Existing rendered rules'}, {name:'other',text:'Keep'}], instructionFiles: files };
  const ancestors = [
    {dir:'/parent',name:'AGENTS.md',parts:[{path:'/parent/AGENTS.md',content:'Parent rules'}]},
    {dir:'/repo',name:'AGENTS.md',parts:[{path:'/repo/AGENTS.md',content:'Keep negatives'}, {path:'/repo/rules.md',content:'Imported rules'}, {path:'/repo/nested.md',content:'Nested rules'}]},
  ];
  test(`${plugin}: adds ancestor instructions and imports to native memory without replacing other context`, async () => {
    const h = await handler();
    let request;
    const result = await h({fs:{ancestors:async e=>{request=e;return ancestors}}}, input, async e=>e);
    assert.deepEqual(request,{names:['AGENTS.md']});
    assert.deepEqual(result.blocks,input.blocks);
    assert.deepEqual(result.instructionFiles,[...files,
      {path:'/parent/AGENTS.md',kind:'project',content:'Parent rules'},
      {path:'/repo/AGENTS.md',kind:'project',content:'Keep negatives'},
      {path:'/repo/rules.md',kind:'project',content:'Imported rules'},
      {path:'/repo/nested.md',kind:'project',content:'Nested rules'},
    ]);
    assert.deepEqual(input.instructionFiles,files);
    assert.strictEqual(await h({fs:{ancestors:async()=>ancestors}},result,async e=>e),result,'Second plugin must not duplicate files');
  });
  test(`${plugin}: unavailable/unknown memory and read denials preserve normal discovery fallback`, async () => {
    const h = await handler();
    const unknown={blocks:input.blocks};
    assert.deepEqual(await h({fs:{ancestors:async()=>{throw Error('Must not read with unknown provenance')}}},unknown,async e=>e),unknown);
    assert.deepEqual(await h({fs:{ancestors:async()=>{throw Error('Read denied')}}},input,async e=>e),input);
    assert.deepEqual(await h({fs:{ancestors:async()=>[]}},input,async e=>e),input);
  });
}
