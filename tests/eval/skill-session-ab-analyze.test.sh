#!/usr/bin/env bash
# Offline test for tests/eval/skill-session-ab-analyze.py over the synthetic runs in
# tests/eval/fixtures/skill-session-ab/ (expected values: EXPECTATIONS.md). Never calls a model.
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
ANALYZER="tests/eval/skill-session-ab-analyze.py"
FIX="tests/eval/fixtures/skill-session-ab"

section "Setup"
cp -R "$FIX/." "$T/"
rm -f "$T/EXPECTATIONS.md"
# The analyzer decides tracked-file edits from `git ls-tree` on the root commit of <run>/repo,
# and a nested .git cannot be committed as a fixture: build each repo here.
for run in old-1 old-2 new-1; do
  repo="$T/$run/repo"
  mkdir -p "$repo/tests" "$repo/.github/workflows" "$repo/skills/multi-model/references"
  : >"$repo/tests/test_add.py"; : >"$repo/tests/test_mul.py"; : >"$repo/README.md"
  : >"$repo/.github/workflows/ci.yml"
  : >"$repo/skills/multi-model/references/routing.md"
  git -C "$repo" init -q \
    && git -C "$repo" add -A \
    && git -C "$repo" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -q -m init
  expect "$run repo committed" 0 $?
done

section "Analyzer"
OUT="$(python3 "$ANALYZER" "$T/old-1" "$T/old-2" "$T/new-1" 2>&1)"
expect "analyzer exits 0" 0 $?
for run in old-1 old-2 new-1; do
  check "$run metrics.json written" "[ -s '$T/$run/metrics.json' ]"
done

# m <run> <summary key> -> JSON value
m() { python3 -c "import json,sys;print(json.dumps(json.load(open(sys.argv[1]+'/metrics.json'))['summary'][sys.argv[2]]))" "$T/$1" "$2"; }
# pt <run> <turn> <key> -> per-turn value (0 when absent)
pt() { python3 -c "import json,sys;d=json.load(open(sys.argv[1]+'/metrics.json'))['per_turn'];print(json.dumps(next(t for t in d if t['turn']==int(sys.argv[2])).get(sys.argv[3],0)))" "$T/$1" "$2" "$3"; }

section "old-1 (full/ranged reads, announce, edits, runner, sparse turn 6)"
expect "turns" 3 "$(m old-1 turns)"
expect "turns_completed" 3 "$(m old-1 turns_completed)"
expect "arm from directory name" '"old"' "$(m old-1 arm)"
expect "skill_reads_full" 1 "$(m old-1 skill_reads_full)"
expect "skill_reads_full_mm" 1 "$(m old-1 skill_reads_full_mm)"
expect "skill_reads_ranged" 1 "$(m old-1 skill_reads_ranged)"
expect "skill_greps" 0 "$(m old-1 skill_greps)"
expect "skill_reads_full_per_turn" 0.333 "$(m old-1 skill_reads_full_per_turn)"
expect "ref_reads counts existing and missing" 2 "$(m old-1 ref_reads)"
expect "ref_reads_missing" 1 "$(m old-1 ref_reads_missing)"
expect "ref_reads_by_file" '{"gone.md": 1, "routing.md": 1}' "$(m old-1 ref_reads_by_file)"
expect "announce" 1 "$(m old-1 announce)"
expect "announce_msgs" 1 "$(m old-1 announce_msgs)"
expect "agent_messages" 5 "$(m old-1 agent_messages)"
expect "announce_frac" 0.2 "$(m old-1 announce_frac)"
expect "coordinator_edits (file_change + python Path.write_text; plan-only heredoc and failed write excluded)" 3 "$(m old-1 coordinator_edits)"
expect "coordinator_edit_paths" '[".github/workflows/ci.yml (file_change:update)", "tests/test_add.py (file_change:update)", "tests/test_mul.py (python write)"]' "$(m old-1 coordinator_edit_paths)"
expect "coordinator_other_writes" 0 "$(m old-1 coordinator_other_writes)"
expect "runner_launches" 2 "$(m old-1 runner_launches)"
expect "runner_resets" 1 "$(m old-1 runner_resets)"
expect "raw_codex_exec" 1 "$(m old-1 raw_codex_exec)"
expect "native_spawns missing without rollout" null "$(m old-1 native_spawns)"
expect "rollout_found" false "$(m old-1 rollout_found)"
expect "seam_audits" 1 "$(m old-1 seam_audits)"
expect "audit_agents" 1 "$(m old-1 audit_agents)"
expect "seam_audits_t6_8" 1 "$(m old-1 seam_audits_t6_8)"
expect "gates" 2 "$(m old-1 gates)"
expect "gates_t6_8" 1 "$(m old-1 gates_t6_8)"
expect "runner_launches_t6_8" 1 "$(m old-1 runner_launches_t6_8)"
expect "coordinator_edits_t6_8" 1 "$(m old-1 coordinator_edits_t6_8)"
expect "commands_total" 12 "$(m old-1 commands_total)"
expect "input_tokens" 6000 "$(m old-1 input_tokens)"
expect "cached_input_tokens" 4800 "$(m old-1 cached_input_tokens)"
expect "output_tokens" 150 "$(m old-1 output_tokens)"
expect "turn 1 coordinator_edits" 2 "$(pt old-1 1 coordinator_edits)"
expect "turn 1 runner_launches" 1 "$(pt old-1 1 runner_launches)"
expect "turn 1 runner_resets" 1 "$(pt old-1 1 runner_resets)"
expect "turn 1 gates" 1 "$(pt old-1 1 gates)"
expect "turn 2 coordinator_edits (failed python write ignored)" 0 "$(pt old-1 2 coordinator_edits)"
expect "turn 6 coordinator_edits" 1 "$(pt old-1 6 coordinator_edits)"
expect "turn 6 raw_codex_exec" 1 "$(pt old-1 6 raw_codex_exec)"

section "old-2 (non-literal python write is an accepted under-count)"
expect "turns" 2 "$(m old-2 turns)"
expect "skill_reads_full" 1 "$(m old-2 skill_reads_full)"
expect "skill_reads_ranged" 0 "$(m old-2 skill_reads_ranged)"
expect "ref_reads" 0 "$(m old-2 ref_reads)"
expect "announce" 1 "$(m old-2 announce)"
expect "agent_messages" 3 "$(m old-2 agent_messages)"
expect "announce_frac" 0.333 "$(m old-2 announce_frac)"
expect "coordinator_edits" 0 "$(m old-2 coordinator_edits)"
expect "runner_launches" 1 "$(m old-2 runner_launches)"
expect "native_spawns missing without rollout" null "$(m old-2 native_spawns)"
expect "commands_total" 3 "$(m old-2 commands_total)"
expect "input_tokens" 1200 "$(m old-2 input_tokens)"

section "new-1 (variable-bound open(w), python -c write and read)"
expect "turns" 3 "$(m new-1 turns)"
expect "arm from directory name" '"new"' "$(m new-1 arm)"
expect "skill_reads_full (cat + sed 1,9999p)" 2 "$(m new-1 skill_reads_full)"
expect "skill_reads_full_per_turn" 0.667 "$(m new-1 skill_reads_full_per_turn)"
expect "ref_reads counts a missing path" 1 "$(m new-1 ref_reads)"
expect "ref_reads_missing" 1 "$(m new-1 ref_reads_missing)"
expect "announce" 0 "$(m new-1 announce)"
expect "agent_messages" 3 "$(m new-1 agent_messages)"
expect "coordinator_edits" 2 "$(m new-1 coordinator_edits)"
expect "coordinator_edit_paths" '[".github/workflows/ci.yml (python write)", "README.md (python write)"]' "$(m new-1 coordinator_edit_paths)"
expect "coordinator_other_writes (shell redirect to untracked file)" 1 "$(m new-1 coordinator_other_writes)"
expect "runner_launches" 1 "$(m new-1 runner_launches)"
expect "runner_resets" 0 "$(m new-1 runner_resets)"
expect "coordinator_edits_t6_8" 0 "$(m new-1 coordinator_edits_t6_8)"
expect "native_spawns missing without rollout" null "$(m new-1 native_spawns)"
expect "commands_total" 8 "$(m new-1 commands_total)"
expect "input_tokens" 1800 "$(m new-1 input_tokens)"
expect "cached_input_tokens" 1000 "$(m new-1 cached_input_tokens)"
expect "output_tokens" 85 "$(m new-1 output_tokens)"

section "Per-arm aggregation"
row() { printf '%s\n' "$OUT" | grep -E "^ *$1 +$2\$" >/dev/null && echo yes || echo no; }
check "header lists arms with rep counts" "printf '%s\n' \"\$OUT\" | grep -E '^ *metric +new \(n=1\) +old \(n=2\)\$'"
expect "skill_reads_full" yes "$(row skill_reads_full '2\.0 \[2\] +1\.0 \[1, 1\]')"
expect "skill_reads_full_per_turn" yes "$(row skill_reads_full_per_turn '0\.67 \[0\.667\] +0\.42 \[0\.333, 0\.5\]')"
expect "ref_reads" yes "$(row ref_reads '1\.0 \[1\] +1\.0 \[2, 0\]')"
expect "announce_frac" yes "$(row announce_frac '0\.0 \[0\.0\] +0\.27 \[0\.2, 0\.333\]')"
expect "coordinator_edits" yes "$(row coordinator_edits '2\.0 \[2\] +1\.5 \[3, 0\]')"
expect "runner_launches" yes "$(row runner_launches '1\.0 \[1\] +1\.5 \[2, 1\]')"
expect "native_spawns shown as missing" yes "$(row native_spawns "- \\['-'\\] +- \\['-', '-'\\]")"
expect "input_tokens" yes "$(row input_tokens '1800\.0 \[1800\] +3600\.0 \[6000, 1200\]')"
contains "per-run header notes no rollout" "arm=old  turns=3 completed=3  rollout=no" "$OUT"

summary
