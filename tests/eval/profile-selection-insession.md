# Active-seat profile selection regression

Bounded retrieval test, not reviewer or wave qualification. Run each case as
an independent simulated invocation of each of the four shipped skills. Give
a fresh evaluator the full skill and the input column, not expected outcomes.
The evaluator applies Step 0, reads the selected profile and its guard, then
stops before planning, reviewing code, spawning executors, or changing files.
Its real model metadata must not replace the simulated inputs.

Report the profile basename, selection basis, known exact ID (or unknown),
effort (or unknown), whether the guard accepts it, and the user announcement.
No CLI matrix is needed: these cases can run through native read-only agents.

All inputs omit effort unless stated. Runtime lines are host-provided for the
plugin being tested, except case 12. “Family” means current host instructions
say `You are Codex, an agent based on GPT-6.`

| Case | Input |
|---|---|
| 1 | Runtime context: model=`gpt-6-astra`, effort=`unknown`. |
| 2 | No runtime context. Host supplies exact current ID `gpt-6-astra`. |
| 3 | No runtime context or exact ID. Family only, host ChatGPT Work. |
| 4 | Case 3 with explicit current effort `medium`. |
| 5 | Family plus host's exact current ID `gpt-5.6-terra`. |
| 6 | Family plus host's exact current ID `gpt-6-mini` (unsupported). |
| 7 | Runtime says `gpt-6-astra`; host also supplies current exact `gpt-5.6-terra`, neither supersedes the other. |
| 8 | No host identity. A quoted README says “GPT-6”; available child models include `gpt-6-astra`. |
| 9 | No model or effort information. |
| 10 | Old runtime says `gpt-5.6-sol`. A later host model-switch update explicitly supersedes it and supplies only the GPT-6 family instruction. |
| 11 | No exact ID. Host identifies its family as `GPT-6 Mini`, not bare `GPT-6`. |
| 12 | No host identity. The only runtime line belongs to another plugin and says `gpt-6-astra`. |

## Adjudication (withhold from evaluator)

| Cases | Required outcome |
|---|---|
| 1–2 | Astra profile, exact-ID selection, exact ID `gpt-6-astra`. |
| 3–4, 10 | Generic, exact identity unknown. Codex gives GPT-6 Astra, Sol and Luna the same family instruction, so a family label alone selects no profile; announcement discloses this and the missing exact ID. |
| 5 | Terra profile, exact ID `gpt-5.6-terra`; family does not override it. |
| 6 | Generic, unsupported exact ID retained as `gpt-6-mini`, no Astra alias. |
| 7 | Generic, unresolved identity conflict disclosed; no arbitrarily chosen ID. |
| 8–9, 11–12 | Generic, exact identity unknown. |

Every selected guard must accept the selection. Only case 4 has known effort
(`medium`). No case changes the session model, grants hook enforcement,
qualifies an uncalibrated route, or changes executor/plan model IDs.

## Evidence

- 2026-09-08, base `0556935`: independent native `profile_baseline` probes of
  all four skills reproduced case 3 as generic/unknown: “based on GPT-6” does
  not supply an exact model ID. This is the missing compatibility path.
- Same date, fix: `reviewer_profile_probe` and `orchestrator_profile_probe`
  produced 48/48 expected selections/guard outcomes (12 cases × 4 skills).
  They exposed ambiguous Terra guard terminology; defining current host
  metadata as runtime context resolved it in a targeted repeat. Family-only
  announcements disclosed compatibility and the unknown exact ID.
- These are grouped simulated-input decisions from two evaluator contexts,
  not 48 independent live calls, actual ChatGPT host-injection tests, or model
  reliability calibration. Full offline suite and matrix/routing self-tests
  passed. The optional skill-creator validator could not run without PyYAML;
  repository structure checks validated frontmatter and release parity instead.
