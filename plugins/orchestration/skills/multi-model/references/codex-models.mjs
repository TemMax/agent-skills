// Exact plan IDs. Approved plans retain their recorded generation on replay.
export const ASTRA_MODELS = ['gpt-6.2-astra', 'gpt-6-astra']
export const CODEX_MODELS = ['gpt-6.2-sol', 'gpt-6.1-sol', 'gpt-6-sol', 'gpt-6-luna',
  'gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']
export const isAstra = model => ASTRA_MODELS.includes(model)
export const CODEX_TIERS = {
  'gpt-6-luna': 1, 'gpt-5.6-luna': 1,
  'gpt-6.2-sol': 2, 'gpt-6.1-sol': 2, 'gpt-6-sol': 2, 'gpt-5.6-sol': 2, 'gpt-5.6-terra': 2,
  'gpt-6.2-astra': 3, 'gpt-6-astra': 3,
}
