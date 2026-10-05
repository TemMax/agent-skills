# First cost-control package: live acceptance cases

The pre-merge cases below are recorded in the [final acceptance report](acceptance-results-2026-10-05.md),
alongside the [initial dual-host report](cost-control-live-results-2026-10-05.md)
and [progressive-loading comparison](progressive-loading-results-2026-10-05.md).
Installed-plugin upgrade and new-session smoke happen only from Git after merge;
disposable candidate validation does not establish an installed upgrade.

These cases are required by [the repository rule](../../AGENTS.md) before the
package is called live-verified or release-ready. Use the authorized model routes
and orchestration 4.8.0 / code-review 1.15.0 candidate packages in fresh Claude
and Codex sessions. Verify actual loaded files/version, whether the candidate
is installed or supplied through a supported local-loading route. Shared plugin
discovery changes require normal plugin loading, not only a skill-text prompt.
Use the same repository snapshot, tasks and acceptance criteria for
the earlier package and this package. Keep repetitions and roles comparable.
Do not measure only the final response or treat cache reads as free input.

| Case | Required behavior | Quality condition |
| --- | --- | --- |
| Explain a docs PR | Description/diff/relevant discussion; no implementation or supervisor child | Accurate account of the actual changes; do not omit required repo instructions |
| Continue an approved task | No repeated design/plan question for the same decisions | A real new product decision still requires clarification |
| Apply the same skill twice | No repeated read when version/content remains in context | Reload relevant instructions after actual version change/context loss |
| Ready candidate, environment failure | Repair within scope; `--resume-from` performs checks/review without executor | Same pinned clean candidate; no stale green facts or inherited positive verdict |
| Correct signing contract | Lint before models; recover candidate after authorized correction | Persistent signing configuration remains protected; weakening gates needs the existing amendment authorization |
| Missing required link / disappearing lock | Required link stops early; access uses stable directory | No broad HOME access, secret reads or silent omission |
| Lost validator invariant with green tests | Independent semantic review rejects it | No mechanical-only shortcut for semantic obligations |
| Changed HEAD or command | Refuse stale candidate or rerun the amended contract | A previous success cannot override a red required command |
| Exhausted call budget | No additional child launch across recovery | Rename, recovery and repeated continuation cannot reset the cap |

Record task outcome and missed defects alongside child launches, instruction
reads, repeated approval questions and initial request size. For available usage
records, separate uncached input, cache creation, cache reads and output. Report
all repetitions and uncertainty; do not convert invocation counts into a promised
percentage of token savings or subscription-limit reduction.

| Case above | Claude evidence | Codex evidence |
| --- | --- | --- |
| Explain / approved continuation / unchanged repeated skill | `lazy-skill-claude-new-1` | `lazy-skill-codex-new-1` |
| New product fork | `final-acceptance-claude-decision-4` | `final-acceptance-codex-decision-4` |
| Actual changed version / fresh context | `final-acceptance-claude-reload-1` | `final-acceptance-codex-reload-2` |
| Ready candidate / environment failure | `cost-live-claude-recovery-new-1` | `cost-live-codex-recovery-new-2` |
| Positive authorized signing amendment | `final-acceptance-claude-signing-1` | `final-acceptance-codex-signing-1` |
| Links / lock / HEAD / red command / exhausted cap | recovery `guards` | recovery `guards-2/assessment-v2.json` |
| Lost invariant despite green tests | `cost-live-claude-semantic-new-1` | `cost-live-codex-semantic-new-1` |
| Other bounded entrypoints and repository rules | `final-acceptance-claude-entrypoints-3` | `final-acceptance-codex-entrypoints-3` |

Directories are under `/private/tmp`. Context loss is a fresh native session
recovering a checkpoint; automatic host compaction is not tested. The 4.8.1
version is confined to the reload fixture; release candidate remains 4.8.0.
Early unsigned/squash signing contradiction lint is Codex-specific; both hosts
pass positive recovery while persistent signing stays enabled.

Offline tests cover transport/state transitions, real Git artifact binding,
command execution, caps and isolation. Stub rejection checks establish that the
driver honors a negative semantic verdict; they do not establish that a live
reviewer will detect the defect. Actual read/gate behavior and semantic quality
remain live evaluation questions.
