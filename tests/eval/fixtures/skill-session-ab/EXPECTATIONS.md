# skill-session-ab fixtures: expected analyzer output

Synthetic runs in the `codex exec --json` schema, no recorded data. Arms come from the directory
name (`old-1`, `old-2` -> arm `old`; `new-1` -> arm `new`). Turn files are not contiguous
(`old-1` has turns 1, 2, 6). There is no `rollout.jsonl` in any run, so `native_spawns` is
reported as missing (`null` in metrics.json, `-` in the per-arm table) and `rollout_found` is
false. `tests/eval/skill-session-ab-analyze.test.sh` copies these runs to a temp dir and creates
`<run>/repo` (git init, one commit with `tests/test_add.py`, `tests/test_mul.py`, `README.md`,
`.github/workflows/ci.yml`, `skills/multi-model/references/routing.md`), because a nested `.git`
cannot be committed. `SKILL.md` and the other reference files do not exist in the repo.

Shell commands are `/bin/zsh -lc "<script>"`. "Counts" means it is a coordinator edit.

## old-1

| Turn | Event | Metric effect |
| --- | --- | --- |
| 1 | message "Использую профиль gpt-6.1-sol. Читаю навык." | announce 1, announce_msgs 1 |
| 1 | `cat skills/multi-model/SKILL.md` | skill_reads_full 1, skill_reads_full_mm 1 |
| 1 | `sed -n '1,40p' skills/multi-model/SKILL.md` | skill_reads_ranged 1 |
| 1 | `cat skills/multi-model/references/routing.md` (file exists) | ref_reads +1 |
| 1 | `cat skills/multi-model/references/gone.md` (file missing) | ref_reads +1, ref_reads_missing 1 |
| 1 | `file_change` update `tests/test_add.py` | counts (coordinator_edits +1) |
| 1 | python heredoc: `ast.parse(open(p))`, `git show`, `Path('README.md').read_text()`, a plan dict naming three tracked paths, writes the plan to `/tmp/ab-plan.json` | does NOT count (the only write target is outside the repo; read-only paths are not writes). This is the false-positive regression: the source analyzer counted all three tracked paths |
| 1 | python heredoc `Path('tests/test_mul.py').write_text(...)` | counts (`tests/test_mul.py (python write)`) |
| 1 | `node .../codex-wave-runner.mjs --plan plan.json` | runner_launches 1 |
| 1 | `node .../codex-wave-runner.mjs --reset` | runner_resets 1 |
| 1 | message "План готов. Подтвердить запуск волны?" | gates 1 |
| 2 | failed python heredoc `open('README.md', 'w')` (status failed) | does NOT count |
| 2 | `ls`, message "Продолжаю." | commands only |
| 6 | `file_change` update `.github/workflows/ci.yml` | counts, coordinator_edits_t6_8 1 |
| 6 | `node .../codex-wave-runner.mjs --plan ci.json` | runner_launches_t6_8 1 |
| 6 | `codex exec -m gpt-6.1-sol 'seam audit of the ci change'` | raw_codex_exec 1, seam_audits 1, audit_agents 1, seam_audits_t6_8 1 |
| 6 | message "Gate 2: подтвердить запуск?" | gates 1, gates_t6_8 1 |

Summary: turns 3, turns_completed 3, skill_reads_full 1, skill_reads_full_mm 1,
skill_reads_ranged 1, skill_greps 0, skill_reads_full_per_turn 0.333, ref_reads 2,
ref_reads_missing 1, ref_reads_by_file {gone.md: 1, routing.md: 1}, announce 1, announce_msgs 1,
agent_messages 5, announce_frac 0.2, coordinator_edits 3 (paths: `.github/workflows/ci.yml
(file_change:update)`, `tests/test_add.py (file_change:update)`, `tests/test_mul.py (python
write)`), coordinator_other_writes 0, runner_launches 2, runner_resets 1, raw_codex_exec 1,
native_spawns null, seam_audits 1, audit_agents 1, seam_audits_t6_8 1, gates 2, gates_t6_8 1,
runner_launches_t6_8 1, coordinator_edits_t6_8 1, commands_total 12, input/cached/output tokens
6000 / 4800 / 150.

## old-2 (turns 1, 2)

| Turn | Event | Metric effect |
| --- | --- | --- |
| 1 | message "Беру профиль Sol для этой задачи." (+ a plain message) | announce 1, announce_msgs 1, agent_messages 2 |
| 1 | `cat skills/multi-model/SKILL.md` | skill_reads_full 1 |
| 1 | `python3.12 - <<'PY'` with `(root / 'README.md').write_text(...)` | does NOT count: target is not a literal or a variable bound to one (accepted under-count) |
| 2 | `node .../codex-wave-runner.mjs --plan plan.json` | runner_launches 1 |

Summary: turns 2, skill_reads_full 1, skill_reads_ranged 0, ref_reads 0, announce 1,
agent_messages 3, announce_frac 0.333, coordinator_edits 0, runner_launches 1, native_spawns
null, commands_total 3, input/cached/output tokens 1200 / 400 / 30.

## new-1 (turns 1, 2, 3)

| Turn | Event | Metric effect |
| --- | --- | --- |
| 1 | `cat skills-codex/multi-model/SKILL.md` | skill_reads_full 1 |
| 1 | `cat skills-codex/multi-model/references/runner.md` (file missing) | ref_reads 1, ref_reads_missing 1 |
| 1 | `python3.12 - <<'PY'` with `target = 'README.md'` and `open(target, 'w')` | counts (`README.md (python write)`) |
| 1 | `python3 -c "open('.github/workflows/ci.yml', 'a').write('x')"` | counts (`.github/workflows/ci.yml (python write)`) |
| 1 | `python3 -c 'print(open("tests/test_add.py").read())'` | does NOT count (read) |
| 2 | `node .../codex-wave-runner.mjs --plan plan.json` | runner_launches 1 |
| 3 | `sed -n '1,9999p' skills-codex/multi-model/SKILL.md` | skill_reads_full 1 (range covers the whole file) |
| 3 | `echo 'done' > notes.txt` | untracked: coordinator_other_writes 1 |

Summary: turns 3, skill_reads_full 2, skill_reads_full_per_turn 0.667, ref_reads 1,
ref_reads_missing 1, announce 0, agent_messages 3, announce_frac 0.0, coordinator_edits 2 (paths:
`.github/workflows/ci.yml (python write)`, `README.md (python write)`), coordinator_other_writes
1, runner_launches 1, runner_resets 0, coordinator_edits_t6_8 0, native_spawns null,
commands_total 8, input/cached/output tokens 1800 / 1000 / 85.

## Per-arm table

| metric | new (n=1) | old (n=2) |
| --- | --- | --- |
| skill_reads_full | 2.0 [2] | 1.0 [1, 1] |
| skill_reads_full_per_turn | 0.67 [0.667] | 0.42 [0.333, 0.5] |
| ref_reads | 1.0 [1] | 1.0 [2, 0] |
| announce_frac | 0.0 [0.0] | 0.27 [0.2, 0.333] |
| coordinator_edits | 2.0 [2] | 1.5 [3, 0] |
| runner_launches | 1.0 [1] | 1.5 [2, 1] |
| native_spawns | - ['-'] | - ['-', '-'] |
| input_tokens | 1800.0 [1800] | 3600.0 [6000, 1200] |
