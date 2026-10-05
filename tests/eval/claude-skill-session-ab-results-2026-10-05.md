# Claude multi-turn A/B smoke — 2026-10-05

This is a real two-turn plumbing/behavior check, not a token-efficiency or
delegated-workflow benchmark. One repetition per arm, Claude Code 2.1.289,
`claude-sonnet-5-5`, medium effort, 150-second timeout per turn,
print-mode CLI budget $3 per session. Both arms loaded through `--plugin-dir`
with hooks enabled and user/project settings excluded. No marketplace changes.

The same disposable fixture contained 19 passing tests and a local bare origin.
Turn 1 invoked `orchestration:multi-model` and requested a read-only inspection;
turn 2 resumed the same UUID and requested CI timeout 10 → 15 as a single-agent
edit. Expected outcomes were frozen before the calls. Final Git diffs show
exactly that one-line CI change; all 19 test bodies and product code remained
unchanged and unittest passed. No agents, commits or PRs were created.

| Observation | Old | New |
| --- | ---: | ---: |
| Plugin version | 4.7.2 | 4.8.0, uncommitted candidate snapshot |
| Completed turns | 2/2 | 2/2 |
| Host skill loads | 1 | 1 |
| Profile announcements | 1 | 0 |
| Approval gates / agent launches | 0 / 0 | 0 / 0 |
| Coordinator input, including caches | 136,786 | 139,310 |
| Cache reads, included above | 87,204 | 88,023 |
| Cache creation, included above | 49,574 | 51,279 |
| Coordinator output | 283 | 246 |
| CLI-reported API cost | $0.34268960000000004 | $0.3524266 |
| Turn wall time, seconds | 6.26 + 6.29 | 10.19 + 7.70 |
| Fixture outcome | passed | passed |

The old response began “Профиль: generic.” and explained its model selection.
The new response began with the requested timeout value and did not announce
its profile. The follow-up did not reload the skill in either arm.

No token saving was demonstrated: input/cost were slightly higher in the new
arm. One short repetition per version is insufficient for a savings estimate
or a general quality claim. CLI cost is not subscription-quota usage. The
eight-turn duplicate-removal case, independent executor/supervisor operation,
environment failure/recovery and changed-contract cases were not run live here.
The new bench has offline coverage for its eight-turn protocol and fixture
outcomes; that is not a live pass of those scenarios.

Old source: `612d4f98da67861b0cd7f547fd5bb2974b062d0c`.
Old entrypoint SHA-256:
`fead12cc492826d49a34d287babc6d74d52c1f6a5de248cf4098b1c5b656863c`.
New entrypoint SHA-256:
`48988758c8dedb7e6cab21ff79fb9e7be823bae8b13a337951a305f983228335`.
Each `meta.json` includes the full candidate file manifest. Host init metadata
and the host-injected skill body identify the corresponding snapshot paths;
the snapshots did not change during execution.

Raw local evidence (temporary directories, not versioned):

- Old: `/private/tmp/agent-skills-claude-smoke-20261005-old-1`, session
  `dd4b1561-a7fa-428c-9819-26c7d745856e`.
- New: `/private/tmp/agent-skills-claude-smoke-20261005-1`, session
  `2ddd74dd-bfe9-4079-af84-2e5a92821be9`.

Streams, prompts, CLI arguments, stderr, copied transcripts, `turns.tsv`,
`expected.json`, `loaded-candidate.json`, `final-state.txt`, fixture test output
and `metrics.json` are retained there. The analyzer can recompute metrics
without another model call:

```bash
python3 tests/eval/claude-skill-session-ab-analyze.py \
  /tmp/agent-skills-claude-smoke-20261005-old-1 \
  /tmp/agent-skills-claude-smoke-20261005-1
```
