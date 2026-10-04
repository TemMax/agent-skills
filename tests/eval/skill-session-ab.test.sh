#!/usr/bin/env bash
# Offline test for tests/eval/skill-session-ab.sh. No model is called: the
# codex executable is a stub (written below into a temp dir, injected through
# SKILL_SESSION_AB_CODEX_BIN) that logs its argv and cwd to a file in the
# temp dir and prints a minimal valid `--json` stream. CODEX_HOME and the
# sessions dir point at temp dirs, so the real ~/.codex is never touched.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
BIN="$W/codex-stub"
LOG="$W/codex-calls.log"
TID=11111111-2222-3333-4444-555555555555
OLD_SHA=d118fff1753803aa26f7d0abca400d97a4718dd7
DRIVER=tests/eval/skill-session-ab.sh

# The stub: `--version` prints one plain line and is not logged; any other
# call appends "cwd=<pwd> argv=<a>|<b>|...|" to $STUB_LOG and emits a
# minimal stream: thread.started (fixed id), turn.started, one agent_message,
# turn.completed with usage.
cat > "$BIN" <<SH
#!/usr/bin/env bash
if [ "\${1:-}" = "--version" ]; then echo "codex-cli 0.0.0-stub"; exit 0; fi
printf 'cwd=%s argv=' "\$(pwd)" >> "\$STUB_LOG"
printf '%s|' "\$@" >> "\$STUB_LOG"
printf '\n' >> "\$STUB_LOG"
echo '{"type":"thread.started","thread_id":"$TID"}'
echo '{"type":"turn.started"}'
echo '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"ok"}}'
echo '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1,"reasoning_output_tokens":0}}'
SH
chmod +x "$BIN"

export STUB_LOG="$LOG"
export CODEX_HOME="$W/codex-home"; mkdir -p "$CODEX_HOME/plugins/cache/temmax/orchestration/9.9.9"
export SKILL_SESSION_AB_SESSIONS_DIR="$W/sessions"; mkdir -p "$SKILL_SESSION_AB_SESSIONS_DIR"
export SKILL_SESSION_AB_CODEX_BIN="$BIN"

# drive <out> [driver args...] — runs the driver, stores output in $W/last.out, sets RC.
drive() { local out=$1; shift; : > "$LOG"; bash "$DRIVER" --out "$out" "$@" >"$W/last.out" 2>&1; RC=$?; }

HAVE_OLD=1
git cat-file -e "$OLD_SHA" 2>/dev/null || HAVE_OLD=0

section "usage and environment errors exit before creating anything"
drive "$W/o-bad" --arm bogus
expect "bad --arm exits 2" 2 "$RC"
check "bad --arm leaves --out uncreated" "[ ! -e '$W/o-bad' ]"
drive "$W/o-bad" --arm new --nope
expect "unknown option exits 2" 2 "$RC"
SKILL_SESSION_AB_CODEX_BIN="$W/no-such-codex" drive "$W/o-nocodex" --arm real
expect "missing codex executable exits 69" 69 "$RC"
check "missing codex leaves --out uncreated" "[ ! -e '$W/o-nocodex' ]"

section "a non-empty --out is refused with 73 and left untouched"
mkdir -p "$W/o-full"; echo keep > "$W/o-full/marker"
drive "$W/o-full" --arm real
expect "non-empty --out exits 73" 73 "$RC"
expect "non-empty --out content is untouched" "marker" "$(ls "$W/o-full")"
check "codex was not invoked" "[ ! -s '$LOG' ]"

section "arm new: --disable plugins, skills-codex path in the prompt"
OUTN="$W/o-new"
drive "$OUTN" --arm new --turns 3 --model m-test --effort low
expect "arm new run exits 0" 0 "$RC"
T1="$(cat "$OUTN/turn-1.prompt")"
SKN="$OUTN/skills/plugins/orchestration/skills-codex/multi-model/SKILL.md"
contains "arm new prompt names the skills-codex SKILL.md" "$SKN" "$T1"
check "that SKILL.md exists on disk" "[ -f '$SKN' ]"
FIRST="$(sed -n 1p "$LOG")"
contains "arm new first turn passes --disable plugins" "--disable|plugins|" "$FIRST"
contains "first turn uses exec --json" "argv=exec|--json|--skip-git-repo-check|-C|" "$FIRST"
contains "first turn passes the model flags" "-m|m-test|-c|model_reasoning_effort=\"low\"|" "$FIRST"
contains "first turn runs with cwd inside the out dir repo" "cwd=$(cd "$OUTN" && pwd -P)/repo argv=" "$FIRST"
check "the stub log lives outside the disposable repo" "[ ! -e '$OUTN/repo/codex-calls.log' ]"

section "--turns 3 produces turn-1..3 with exec then exec resume <id>"
for k in 1 2 3; do check "turn-$k.jsonl exists" "[ -s '$OUTN/turn-$k.jsonl' ]"; done
check "no turn-4.jsonl" "[ ! -e '$OUTN/turn-4.jsonl' ]"
expect "stub was called three times" 3 "$(wc -l < "$LOG" | tr -d ' ')"
contains "turn 2 is exec resume with the fixed id" "argv=exec|resume|--json|--skip-git-repo-check|--disable|plugins|-m|m-test|-c|model_reasoning_effort=\"low\"|-c|sandbox_mode=\"danger-full-access\"|$TID|" "$(sed -n 2p "$LOG")"
contains "turn 3 is exec resume with the fixed id" "argv=exec|resume|" "$(sed -n 3p "$LOG")"
contains "turn 3 resumes the same id" "|$TID|" "$(sed -n 3p "$LOG")"
check "resumed turns do not pass -C" "! sed -n '2,3p' '$LOG' | grep -q -- '|-C|'"
contains "meta records the thread id" "thread_id=$TID" "$(cat "$OUTN/meta.txt")"
check "final-state.txt written" "[ -s '$OUTN/final-state.txt' ]"

section "the disposable repo's own tests pass"
check "python3 -m unittest discover -s tests passes in the generated repo" \
  "(cd '$OUTN/repo' && python3 -m unittest discover -s tests)"

section "arm real: installed plugin, no --disable plugins"
OUTR="$W/o-real"
drive "$OUTR" --arm real --turns 2
expect "arm real run exits 0" 0 "$RC"
check "arm real never passes --disable" "! grep -q -- '--disable' '$LOG'"
contains "arm real names the skill by plugin" "orchestration:multi-model" "$(cat "$OUTR/turn-1.prompt")"
check "arm real extracts no skill tree" "[ ! -e '$OUTR/skills' ]"
contains "arm real records the installed plugin cache version" "installed_orchestration=9.9.9" "$(cat "$OUTR/meta.txt")"

section "arm old: --disable plugins, skills path in the prompt"
if [ "$HAVE_OLD" = 1 ]; then
  OUTO="$W/o-old"
  drive "$OUTO" --arm old --turns 1
  expect "arm old run exits 0" 0 "$RC"
  SKO="$OUTO/skills/plugins/orchestration/skills/multi-model/SKILL.md"
  contains "arm old prompt names the skills SKILL.md" "$SKO" "$(cat "$OUTO/turn-1.prompt")"
  check "that SKILL.md exists on disk" "[ -f '$SKO' ]"
  check "arm old has no skills-codex entrypoint in its prompt" "! grep -q skills-codex '$OUTO/turn-1.prompt'"
  contains "arm old passes --disable plugins" "--disable|plugins|" "$(sed -n 1p "$LOG")"
else
  printf '  \033[33mSKIP\033[0m  arm old: %s is not available (shallow clone)\n' "$OLD_SHA"
fi

section "a --new-ref without skills-codex/ exits 2 and creates nothing"
if [ "$HAVE_OLD" = 1 ]; then
  drive "$W/o-noskc" --arm new --new-ref "$OLD_SHA"
  expect "new arm on a ref without skills-codex exits 2" 2 "$RC"
  contains "the message says why" "skills-codex" "$(cat "$W/last.out")"
  check "--out is left uncreated" "[ ! -e '$W/o-noskc' ]"
else
  printf '  \033[33mSKIP\033[0m  missing-skills-codex case: %s is not available (shallow clone)\n' "$OLD_SHA"
fi

summary
