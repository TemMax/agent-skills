#!/usr/bin/env bash
#
# telegram-notify.test.sh — checks the CHANGELOG.md → Telegram release-announcement
# pipeline without ever sending anything or reaching the network. Portable across BSD
# awk/sed (macOS) and gawk/mawk (the Ubuntu runner), same as toki's equivalent test.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO_ROOT="$(pwd)"

PASSED=0
FAILED=0
fail() { FAILED=$((FAILED+1)); echo "FAIL: $1" >&2; }
ok() { PASSED=$((PASSED+1)); }
expect() { if grep -qF -- "$2" <<<"$1"; then ok; else fail "expected: $2 -- got: $1"; fi; }
reject() { if grep -qF -- "$2" <<<"$1"; then fail "unexpected: $2 -- got: $1"; else ok; fi; }
eq() { if [ "$1" = "$2" ]; then ok; else fail "$3 -- expected: [$2] got: [$1]"; fi; }

tmpfiles=()
tmpdirs=()
cleanup() {
    [ "${#tmpfiles[@]}" -eq 0 ] || rm -f "${tmpfiles[@]}"
    [ "${#tmpdirs[@]}" -eq 0 ] || rm -rf "${tmpdirs[@]}"
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Fixture git repository, built fresh under a temp directory.
# ---------------------------------------------------------------------------
REPO="$(mktemp -d)"
tmpdirs+=("$REPO")
git -C "$REPO" init -q
git -C "$REPO" config user.name "telegram-notify test"
git -C "$REPO" config user.email "telegram-notify-test@example.invalid"
git -C "$REPO" config commit.gpgsign false

# commit ROOT — no CHANGELOG.md yet.
echo "placeholder" > "$REPO/README.md"
git -C "$REPO" add README.md
git -C "$REPO" commit -q -m "root"
ROOT="$(git -C "$REPO" rev-parse HEAD)"

# commit A — CHANGELOG.md with "## 1.0.0".
cat > "$REPO/CHANGELOG.md" <<'MD'
# Changelog

## 1.0.0

### Highlights

**core**
- Initial release
MD
git -C "$REPO" add CHANGELOG.md
git -C "$REPO" commit -q -m "1.0.0"
A="$(git -C "$REPO" rev-parse HEAD)"

# commit B — adds "## 1.1.0" above it, with notes that exercise the escaping rules.
cat > "$REPO/CHANGELOG.md" <<'MD'
# Changelog

## 1.1.0

### Highlights

**telegram**
- Rich messages support GitHub-flavoured Markdown

### Features

- add `code` & <tags>
- **bold** and a [link](https://example.com/a)

## 1.0.0

### Highlights

**core**
- Initial release
MD
git -C "$REPO" add CHANGELOG.md
git -C "$REPO" commit -q -m "1.1.0"
B="$(git -C "$REPO" rev-parse HEAD)"

# commit C — adds "## 1.2.0" and "## 1.1.1".
cat > "$REPO/CHANGELOG.md" <<'MD'
# Changelog

## 1.2.0

### Highlights

**announce**
- Button label is now "Full changelog"

## 1.1.1

### Highlights

**telegram**
- Long notes are trimmed to fit Telegram's limit

## 1.1.0

### Highlights

**telegram**
- Rich messages support GitHub-flavoured Markdown

### Features

- add `code` & <tags>
- **bold** and a [link](https://example.com/a)

## 1.0.0

### Highlights

**core**
- Initial release
MD
git -C "$REPO" add CHANGELOG.md
git -C "$REPO" commit -q -m "1.2.0 and 1.1.1"
C="$(git -C "$REPO" rev-parse HEAD)"

C_CHANGELOG="$(mktemp)"
tmpfiles+=("$C_CHANGELOG")
git -C "$REPO" show "${C}:CHANGELOG.md" > "$C_CHANGELOG"

# ---------------------------------------------------------------------------
# changelog-section.sh
# ---------------------------------------------------------------------------
echo "== changelog-section.sh =="

section_110="$("$REPO_ROOT/scripts/changelog-section.sh" 1.1.0 "$C_CHANGELOG")"
expected_110="$(printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s' \
  '### Highlights' '' '**telegram**' '- Rich messages support GitHub-flavoured Markdown' '' \
  '### Features' '' '- add `code` & <tags>' '- **bold** and a [link](https://example.com/a)')"
eq "$section_110" "$expected_110" "1.1.0 section body is trimmed (now includes the Highlights block)"

if err="$("$REPO_ROOT/scripts/changelog-section.sh" 9.9.9 "$C_CHANGELOG" 2>&1)"; then
    fail "changelog-section.sh 9.9.9 unexpectedly succeeded: $err"
else
    st=$?
    eq "$st" "1" "missing version exits 1"
    expect "$err" 'changelog-section: no "## 9.9.9" section'
fi

section_100="$("$REPO_ROOT/scripts/changelog-section.sh" 1.0.0 "$C_CHANGELOG")"
expected_100="$(printf '%s\n%s\n%s\n%s' '### Highlights' '' '**core**' '- Initial release')"
eq "$section_100" "$expected_100" "last section (running to EOF) is handled (now the Highlights block)"

# ---------------------------------------------------------------------------
# changelog-highlights.sh
# ---------------------------------------------------------------------------
echo "== changelog-highlights.sh =="

highlights_110="$("$REPO_ROOT/scripts/changelog-highlights.sh" 1.1.0 "$C_CHANGELOG")"
expected_highlights_110="$(printf '%s\n%s\n%s' \
  '**telegram**' '- Rich messages support GitHub-flavoured Markdown')"
eq "$highlights_110" "$expected_highlights_110" \
  "1.1.0 Highlights block is trimmed and stops before ### Features"
reject "$highlights_110" "### Features"
reject "$highlights_110" "add \`code\`"

highlights_100="$("$REPO_ROOT/scripts/changelog-highlights.sh" 1.0.0 "$C_CHANGELOG")"
eq "$highlights_100" "$(printf '%s\n%s' '**core**' '- Initial release')" \
  "1.0.0 Highlights block (last section, running to EOF)"

no_highlights_changelog="$(mktemp)"
tmpfiles+=("$no_highlights_changelog")
cat > "$no_highlights_changelog" <<'MD'
# Changelog

## 9.9.9

No highlights block in this section at all.
MD
if err="$("$REPO_ROOT/scripts/changelog-highlights.sh" 9.9.9 "$no_highlights_changelog" 2>&1)"; then
    fail "changelog-highlights.sh 9.9.9 unexpectedly succeeded: $err"
else
    st=$?
    eq "$st" "1" "missing Highlights block exits 1"
    expect "$err" 'changelog-highlights: no "### Highlights" in "## 9.9.9"'
fi

# ---------------------------------------------------------------------------
# changelog-new-versions.sh
# ---------------------------------------------------------------------------
echo "== changelog-new-versions.sh =="

cd "$REPO"

out_ab="$("$REPO_ROOT/scripts/changelog-new-versions.sh" "$A" "$B")"
eq "$out_ab" "1.1.0" "A to B gives 1.1.0"

out_bc="$("$REPO_ROOT/scripts/changelog-new-versions.sh" "$B" "$C")"
eq "$out_bc" "$(printf '1.2.0\n1.1.1')" "B to C gives 1.2.0 then 1.1.1"

out_zero_c="$("$REPO_ROOT/scripts/changelog-new-versions.sh" \
  "0000000000000000000000000000000000000000" "$C")"
eq "$out_zero_c" "1.2.0" "all-zero before gives topmost only"

out_bb="$("$REPO_ROOT/scripts/changelog-new-versions.sh" "$B" "$B")"
eq "$out_bb" "" "B to B gives nothing"

out_root_a="$("$REPO_ROOT/scripts/changelog-new-versions.sh" "$ROOT" "$A")"
eq "$out_root_a" "1.0.0" "before-commit without the file gives the topmost only"

cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# telegram-notify.sh
# ---------------------------------------------------------------------------
echo "== telegram-notify.sh =="

notes="$(mktemp)"
tmpfiles+=("$notes")
cat > "$notes" <<'MD'
### Features

- add `code` & <tags>
- **bold** and a [link](https://example.com/a)
MD

rich="$(scripts/telegram-notify.sh --dry-run 1.1.0 "$notes")"
expect "$rich" "# agent-skills 1.1.0"
expect "$rich" "### Features"
expect "$rich" "- add \`code\` &amp; &lt;tags&gt;"
expect "$rich" "- **bold** and a [link](https://example.com/a)"
expect "$rich" '<tg-button type="url" style="success" url="https://github.com/TemMax/agent-skills/blob/main/CHANGELOG.md#110">Full changelog</tg-button>'
expect "$rich" '<tg-button type="url" url="https://github.com/TemMax/agent-skills">Repository</tg-button>'
reject "$rich" "<tags>"

printf 'keep `a <b> & c` literal\n' > "$notes.code"
tmpfiles+=("$notes.code")
expect "$(scripts/telegram-notify.sh --dry-run 1.0.0 "$notes.code")" 'keep `a <b> & c` literal'

message="$(scripts/telegram-notify.sh --dry-run-fallback 1.1.0 "$notes")"
expect "$message" "<b>agent-skills 1.1.0 released</b>"
expect "$message" "<b>Features</b>"
expect "$message" "• add <code>code</code> &amp; &lt;tags&gt;"
expect "$message" '• <b>bold</b> and a <a href="https://example.com/a">link</a>'
expect "$message" '<a href="https://github.com/TemMax/agent-skills/blob/main/CHANGELOG.md#110">Full changelog</a>'
expect "$message" "https://github.com/TemMax/agent-skills"
reject "$message" "##"
reject "$message" "<h2>"
reject "$message" "<ul>"

# A notes argument given as process substitution is a pipe that can be read only once; the
# rich message and the HTML fallback must each read it in full, not just the frame.
rich_procsub="$(scripts/telegram-notify.sh --dry-run 1.1.0 <(cat "$notes"))"
expect "$rich_procsub" "### Features"
expect "$rich_procsub" "- add \`code\` &amp; &lt;tags&gt;"

message_procsub="$(scripts/telegram-notify.sh --dry-run-fallback 1.1.0 <(cat "$notes"))"
expect "$message_procsub" "<b>Features</b>"
expect "$message_procsub" "• add <code>code</code> &amp; &lt;tags&gt;"

# A paragraph hard-wrapped over two lines, with a code span split across the wrap point, is
# unwrapped into one logical line before either form is built: the code span survives intact.
wrapped_notes="$(mktemp)"
tmpfiles+=("$wrapped_notes")
printf 'foo `a\n<b>` bar\n' > "$wrapped_notes"

wrapped_rich="$(scripts/telegram-notify.sh --dry-run 1.0.0 "$wrapped_notes")"
expect "$wrapped_rich" 'foo `a <b>` bar'

wrapped_message="$(scripts/telegram-notify.sh --dry-run-fallback 1.0.0 "$wrapped_notes")"
expect "$wrapped_message" 'foo <code>a &lt;b&gt;</code> bar'

echo "-- rich dry-run for 1.1.0 --"
printf '%s\n' "$rich"
echo "-- HTML fallback dry-run for 1.1.0 --"
printf '%s\n' "$message"

# Long notes are cut at a line boundary, never mid-tag, and stay under Telegram's limit.
long_notes="$(mktemp)"
tmpfiles+=("$long_notes")
for i in $(seq 1 200); do echo "- a **long** change number $i with some words"; done > "$long_notes"
long="$(scripts/telegram-notify.sh --dry-run-fallback 1.0.0 "$long_notes")"
[ "${#long}" -lt 4096 ] && ok || fail "message is ${#long} characters"
expect "$long" "…"
opens="$(grep -o '<b>' <<<"$long" | wc -l)"
closes="$(grep -o '</b>' <<<"$long" | wc -l)"
eq "$opens" "$closes" "balanced <b> tags"

# The rich notes get the same budget: cut at a line boundary, end with "…", and the full
# rich message (heading + notes + buttons) stays under Telegram's limit.
long_rich="$(scripts/telegram-notify.sh --dry-run 1.0.0 "$long_notes")"
[ "${#long_rich}" -le 4096 ] && ok || fail "rich message is ${#long_rich} characters"
expect "$long_rich" "…"
expect "$long_rich" '<tg-button type="url" style="success"'
expect "$long_rich" '<tg-button type="url" url='

# A cut that would land inside a fenced code block drops the fence's opening line and
# everything after it, instead of leaving an unbalanced ``` open.
fence_notes="$(mktemp)"
tmpfiles+=("$fence_notes")
{
    echo "- intro line before the fence"
    echo '```'
    for i in $(seq 1 200); do echo "code line number $i with filler text to grow the block"; done
    echo '```'
} > "$fence_notes"
fence_rich="$(scripts/telegram-notify.sh --dry-run 1.0.0 "$fence_notes")"
fences="$(grep -c '^```' <<<"$fence_rich" || true)"
eq "$((fences % 2))" "0" "no unbalanced fence -- fence count: $fences"

# Without credentials nothing is sent and the release is not failed.
fakebin="$(mktemp -d)"
tmpdirs+=("$fakebin")
marker="$fakebin/network-call-marker"
cat > "$fakebin/curl" <<EOF
#!/usr/bin/env bash
touch "$marker"
exit 1
EOF
chmod +x "$fakebin/curl"

set +e
out="$(env -u TELEGRAM_BOT_TOKEN -u TELEGRAM_CHAT_ID PATH="$fakebin:$PATH" \
  scripts/telegram-notify.sh 1.0.0 "$notes")"
status=$?
set -e
eq "$status" "0" "no-secrets path exits 0"
expect "$out" "skipping the announcement"
if [ -e "$marker" ]; then
    fail "curl marker was written -- a network call was made"
else
    ok
fi

# ---------------------------------------------------------------------------
# announce-changelog.sh
# ---------------------------------------------------------------------------
echo "== announce-changelog.sh =="

cd "$REPO"
announce_out="$("$REPO_ROOT/scripts/announce-changelog.sh" --dry-run "$A" "$B")"
cd "$REPO_ROOT"
expect "$announce_out" "# agent-skills 1.1.0"
# Only the Highlights block is posted, not the rest of the section.
expect "$announce_out" "**telegram**"
expect "$announce_out" "Rich messages support GitHub-flavoured Markdown"
reject "$announce_out" "### Features"
reject "$announce_out" "add \`code\`"

# A version whose section has no Highlights block is not sent, and the release is failed.
cd "$REPO"
cat > CHANGELOG.md <<'MD'
# Changelog

## 9.9.9

No highlights block in this section at all.
MD
set +e
missing_out="$("$REPO_ROOT/scripts/announce-changelog.sh" --dry-run --version 9.9.9 2>&1)"
missing_status=$?
set -e
cd "$REPO_ROOT"
eq "$missing_status" "1" "announce-changelog.sh --version exits 1 when Highlights is missing"
expect "$missing_out" 'changelog-highlights: no "### Highlights" in "## 9.9.9"'
reject "$missing_out" "# agent-skills 9.9.9"
git -C "$REPO" checkout -q -- CHANGELOG.md

printf '\n%s passed, %s failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
