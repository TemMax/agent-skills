import { expect, test } from 'claude-code/testing'
const plugin = 'orchestration'
const policy = 'User-facing updates state the task, checks and results. Do not announce skills, instruction/profile filenames or loading, runtime model/effort or selection metadata.'

test('delivers host model on lifecycle starts without repeating on the first prompt', async ($, on) => {
  on('session.model', () => ({ value: 'claude-fable-5-1' }))
  on('classic.SessionStart', () => ({ additionalContext: [policy, 'Other hook'], sessionTitle: 'Keep' }))
  on('prompt.submit', ($, e) => ({ text: e.text, context: e.context }))
  for (const source of ['startup', 'resume', 'clear', 'compact', 'fork']) {
    const result = await $.classic.SessionStart({ source })
    expect(result).toEqual({ additionalContext: ['Other hook', 'PLUGIN_RUNTIME_CONTEXT_V1 plugin=' + plugin + ' host=claude model=claude-fable-5-1 effort=unknown\n' + policy], sessionTitle: 'Keep' })
  }
  expect(await $.prompt.submit({text:'User prompt'})).toEqual({text:'User prompt',context:undefined})
})

test('child context invalidates parent identity without consulting main model', async ($, on) => {
  on('classic.SubagentStart', () => ({ additionalContext: [policy, 'Other hook'] }))
  const result = await $.classic.SubagentStart({agent_id:'child',agent_type:'general-purpose'})
  expect(result.additionalContext).toEqual(['Other hook', 'PLUGIN_RUNTIME_CONTEXT_V1 plugin=' + plugin + ' host=claude model=unknown effort=unknown\n' + policy])
})


test('blocked model-change prompt retries delivery on the next allowed prompt', async ($, on) => {
  let model = 'claude-fable-5-1'
  let block = true
  on('session.model', () => ({ value: model }))
  on('classic.SessionStart', () => ({}))
  on('prompt.submit', ($, e) => {
    if (block) { block = false; return {drop:'Test block'} }
    return {text:e.text,context:e.context}
  })
  await $.classic.SessionStart({source:'startup'})
  model = 'claude-opus-5-5'
  expect(await $.prompt.submit({text:'Blocked'})).toEqual({drop:'Test block'})
  const allowed = await $.prompt.submit({text:'Allowed'})
  expect(allowed.context).toEqual(['PLUGIN_RUNTIME_CONTEXT_V1 plugin=' + plugin + ' host=claude model=claude-opus-5-5 effort=unknown\n' + policy])
})

test('clear invalidates delivery state even when the model API is unavailable', async ($, on) => {
  let outage = false
  on('session.model', () => outage ? {deny:'Test outage'} : {value:'claude-fable-5-1'})
  on('classic.SessionStart', () => ({}))
  on('prompt.submit', ($, e) => ({text:e.text,context:e.context}))
  await $.classic.SessionStart({source:'startup'})
  outage = true
  await $.classic.SessionStart({source:'clear'})
  outage = false
  const recovered = await $.prompt.submit({text:'After clear'})
  expect(recovered.context).toEqual(['PLUGIN_RUNTIME_CONTEXT_V1 plugin=' + plugin + ' host=claude model=claude-fable-5-1 effort=unknown\n' + policy])
})


test('AGENTS memory preserves other instructions and deduplicates imported files', async ($, on) => {
  on('fs.ancestors', () => ({value:[{dir:'/repo',name:'AGENTS.md',content:'Keep negatives',parts:[{path:'/repo/AGENTS.md',content:'Keep negatives'}]}]}))
  on('prompt.context', ($, e) => ({blocks:e.blocks,instructionFiles:e.instructionFiles}))
  const input={blocks:[{name:'other',text:'Keep'}],instructionFiles:[{path:'/repo/CLAUDE.md',kind:'project' as const,content:'Other rules'}]}
  const result=await $.prompt.context(input)
  expect(result.instructionFiles).toEqual([...input.instructionFiles,{path:'/repo/AGENTS.md',kind:'project',content:'Keep negatives'}])
  expect((await $.prompt.context({...input,instructionFiles:result.instructionFiles})).instructionFiles).toEqual(result.instructionFiles)
})

test('unknown memory provenance and denied reads retain the ordinary fallback', async ($, on) => {
  on('fs.ancestors', () => ({deny:'Test read denial'}))
  on('prompt.context', ($, e) => ({blocks:e.blocks,instructionFiles:e.instructionFiles}))
  const input={blocks:[{name:'other',text:'Keep'}]}
  expect((await $.prompt.context(input)).blocks).toEqual(input.blocks)
  expect((await $.prompt.context({...input,instructionFiles:[]})).instructionFiles).toEqual([])
})
