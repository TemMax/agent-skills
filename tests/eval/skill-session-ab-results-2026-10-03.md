# Skill-session A/B results, 2026-10-03

Measurement of how the old `skills/` entrypoint and the new `skills-codex/`
entrypoint behave in a long scripted Codex orchestrator session, recorded with
`tests/eval/skill-session-ab.sh` and analyzed with
`tests/eval/skill-session-ab-analyze.py`. Tables below come from the corrected
analyzer; see "What changed versus the pre-fix summary".

## Setup

- Model: GPT-6.1 Sol, effort high. Codex CLI 0.160.0.
- Scenario: 8 scripted turns on a disposable repo with 5 planted duplicate
  tests. Turns 1-5 run the main task (remove duplicate unit tests via parallel
  sub-agents); turn 6 asks for a separate one-file `ci.yml` edit.
- Arms:
  - old: `skills/` at d118fff (4.6.0, before Codex entrypoints).
  - new: `skills-codex/` at 7fc26b9.
  - Both ran with `--disable plugins`, so Step 0 had no runtime-context hook
    and selected the generic profile. 3 runs each: `old-1..3`, `new-1..3`.
  - real: 1 run (`real-1`) on the then-installed 4.7.0, with plugins and
    hooks enabled.

## Per-arm table

Mean per arm, with per-run values in brackets (output of the analyzer over the
seven runs):

```
                   metric                                   new (n=3)                                   old (n=3)             real (n=1)
         skill_reads_full                              1.67 [2, 1, 2]                              1.33 [1, 1, 2]                1.0 [1]
      skill_reads_full_mm                               1.0 [1, 1, 1]                               1.0 [1, 1, 1]                1.0 [1]
skill_reads_full_per_turn                    0.21 [0.25, 0.125, 0.25]                   0.17 [0.125, 0.125, 0.25]           0.12 [0.125]
       skill_reads_ranged                              1.33 [0, 1, 3]                              2.67 [2, 4, 2]                0.0 [0]
              skill_greps                              0.67 [0, 1, 1]                              0.33 [0, 1, 0]                0.0 [0]
                ref_reads                             7.33 [5, 10, 7]                           10.67 [13, 13, 6]              12.0 [12]
                 announce                               1.0 [1, 1, 1]                               1.0 [1, 1, 1]                1.0 [1]
            announce_frac                   0.06 [0.056, 0.05, 0.062]                   0.05 [0.045, 0.05, 0.053]           0.06 [0.062]
        coordinator_edits                              0.67 [1, 0, 1]                               1.0 [1, 1, 1]                1.0 [1]
          runner_launches                              1.67 [1, 3, 1]                               1.0 [1, 1, 1]                1.0 [1]
            runner_resets                              0.33 [0, 1, 0]                               0.0 [0, 0, 0]                0.0 [0]
           raw_codex_exec                               0.0 [0, 0, 0]                               0.0 [0, 0, 0]                0.0 [0]
            native_spawns                               4.0 [5, 3, 4]                              4.67 [3, 6, 5]                6.0 [6]
              seam_audits                              0.33 [0, 0, 1]                               0.0 [0, 0, 0]                0.0 [0]
             audit_agents                               4.0 [5, 3, 4]                              4.67 [3, 6, 5]                3.0 [3]
         seam_audits_t6_8                               0.0 [0, 0, 0]                               0.0 [0, 0, 0]                0.0 [0]
               gates_t6_8                               0.0 [0, 0, 0]                               0.0 [0, 0, 0]                0.0 [0]
     runner_launches_t6_8                              0.67 [0, 2, 0]                               0.0 [0, 0, 0]                0.0 [0]
           commands_total                          32.67 [37, 29, 32]                          34.67 [38, 34, 32]              27.0 [27]
             input_tokens   13928474.0 [14084454, 14014746, 13686222]  14267659.67 [14626887, 13985171, 14190921]  13607473.0 [13607473]
      cached_input_tokens  13350741.33 [13711872, 13177856, 13162496]  13713066.67 [14139392, 13468544, 13531264]  13203840.0 [13203840]
            output_tokens             89866.67 [86655, 102641, 80304]            100223.33 [111638, 97627, 91405]        68528.0 [68528]
```

## Task outcomes

- In all seven runs the working tree / feature branch ended with exactly the 5
  planted duplicates removed via supervised waves. `origin/main` was left
  untouched in most runs, since publication stayed on branches.
- The T6 one-file `ci.yml` edit was made by the coordinator itself in 6 of 7
  runs (old 3/3, new 2/3, real 1/1). In new-2 it went through a single-task
  wave, without seam audit or gate.

## Conclusions

- Skill re-reads after turn 1 and repeated profile announcements did not
  reproduce in either arm (`skill_reads_full` is 1-2 per run, almost all in
  turn 1; `announce` is 1 in every run). The original session's re-reads are
  therefore not explained by the skill text at this scale; long-session
  context compaction is an untested hypothesis.
- Delegation of the main task was correct in all arms.
- The follow-up small edit (T6) was accepted by the user and became Codex
  rule 3's exception in 4.7.1.

## What changed versus the pre-fix scratchpad summary

Only the coordinator-edit metrics changed. The pre-fix analyzer counted python
code that touched a path as a "python write" coordinator edit (the
analyzer's own contract now excludes paths that are only read or mentioned).
Those were false positives: the flagged files (`README.md`, the planted test
files, `ci.yml`) were not written by the coordinator's python code. With the
AST-based write detection, `coordinator_edits` per arm moved from
new 3.0 [1, 7, 1], old 4.33 [6, 1, 6], real 6.0 [6] to
new 0.67 [1, 0, 1], old 1.0 [1, 1, 1], real 1.0 [1]. That is exactly the
`ci.yml` `file_change:update` per run, and none in new-2, where the edit went
through a wave. The per-turn `coEdit` column changed accordingly (for example
old-1 turn 1 from 5 to 0). Every other metric in the per-arm table and every
other per-run column is identical to the pre-fix summary.

## Limitations

- n=3 per arm (n=1 for real), one scenario.
- Shell parsing is heuristic.
- Sub-agent edits are visible only in child rollouts, not in the coordinator's
  stream.
- `coordinator_other_writes` keeps residual noise from `>` inside python
  code; it never reaches `coordinator_edits`.

## Reproduction

Each arm run needs a fresh, empty `--out` directory and calls a live model
(see the `## skill-session-ab` section of `tests/README.md` for cost). The new
arm is pinned to the recorded ref, since the driver's default `HEAD` is newer.
The real arm used the then-installed 4.7.0 plugin; it runs whatever is
installed now.

```bash
for i in 1 2 3; do
  bash tests/eval/skill-session-ab.sh --arm old --rep $i --out runs/old-$i
  bash tests/eval/skill-session-ab.sh --arm new --rep $i --out runs/new-$i \
    --new-ref 7fc26b9a716521c9e596fd806b828d704710d92b
done
bash tests/eval/skill-session-ab.sh --arm real --rep 1 --out runs/real-1

python3 tests/eval/skill-session-ab-analyze.py \
  runs/old-1 runs/old-2 runs/old-3 runs/new-1 runs/new-2 runs/new-3 runs/real-1
```

The analyzer rewrites `metrics.json` in each run directory and prints the
per-run tables and the per-arm table above.
