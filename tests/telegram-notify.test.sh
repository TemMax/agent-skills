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

Initial release.
MD
git -C "$REPO" add CHANGELOG.md
git -C "$REPO" commit -q -m "1.0.0"
A="$(git -C "$REPO" rev-parse HEAD)"

# commit B — adds "## 1.1.0" above it, with notes that exercise the escaping rules.
cat > "$REPO/CHANGELOG.md" <<'MD'
# Changelog

## 1.1.0

### Features

- add `code` & <tags>
- **bold** and a [link](https://example.com/a)

## 1.0.0

Initial release.
MD
git -C "$REPO" add CHANGELOG.md
git -C "$REPO" commit -q -m "1.1.0"
B="$(git -C "$REPO" rev-parse HEAD)"

# commit C — adds "## 1.2.0" and "## 1.1.1".
cat > "$REPO/CHANGELOG.md" <<'MD'
# Changelog

## 1.2.0

Second minor release.

## 1.1.1

Patch release.

## 1.1.0

### Features

- add `code` & <tags>
- **bold** and a [link](https://example.com/a)

## 1.0.0

Initial release.
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
expected_110="$(printf '%s\n%s\n%s\n%s' \
  '### Features' '' '- add `code` & <tags>' '- **bold** and a [link](https://example.com/a)')"
eq "$section_110" "$expected_110" "1.1.0 section body is trimmed"

if err="$("$REPO_ROOT/scripts/changelog-section.sh" 9.9.9 "$C_CHANGELOG" 2>&1)"; then
    fail "changelog-section.sh 9.9.9 unexpectedly succeeded: $err"
else
    st=$?
    eq "$st" "1" "missing version exits 1"
    expect "$err" 'changelog-section: no "## 9.9.9" section'
fi

section_100="$("$REPO_ROOT/scripts/changelog-section.sh" 1.0.0 "$C_CHANGELOG")"
eq "$section_100" "Initial release." "last section (running to EOF) is handled"

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
expect "$rich" '<tg-button type="url" style="success" url="https://github.com/TemMax/agent-skills/blob/main/CHANGELOG.md#110">Changelog</tg-button>'
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
expect "$message" "https://github.com/TemMax/agent-skills/blob/main/CHANGELOG.md#110"
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

printf '\n%s passed, %s failed\n' "$PASSED" "$FAILED"
[ "$FAILED" -eq 0 ]
