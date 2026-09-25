#!/usr/bin/env bash
#
# telegram-notify.sh — announce a published CHANGELOG.md release in a Telegram channel.
#
#   telegram-notify.sh [--dry-run | --dry-run-fallback] <version> <notes-file>
#
# Sends a Telegram rich message (Bot API `sendRichMessage`): an "agent-skills X.Y.Z" heading,
# the release notes as they are — rich Markdown is GitHub-flavoured, so headings and lists
# render natively — and a row of buttons to the CHANGELOG.md section and the repository. If
# Telegram refuses the rich message, the same announcement goes out as a plain HTML message
# instead, where headings become bold lines and bullets become "•".
#
# Needs TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID (a channel's @username or its numeric -100…
# id; the bot must be an admin allowed to post). Without them it prints a notice and exits 0,
# so a release never fails for want of an announcement. --dry-run prints the rich message,
# --dry-run-fallback the HTML one, instead of sending.
set -euo pipefail
cd "$(dirname "$0")/.."

USAGE="usage: telegram-notify.sh [--dry-run | --dry-run-fallback] <version> <notes-file>"
DRY_RUN=""
case "${1:-}" in
    --dry-run) DRY_RUN=rich; shift ;;
    --dry-run-fallback) DRY_RUN=html; shift ;;
esac
VERSION="${1:?$USAGE}"
NOTES_FILE="${2:?$USAGE}"
REPO="${REPO:-TemMax/agent-skills}"
ANCHOR="$(printf '%s' "$VERSION" | tr -d '.')"
CHANGELOG_URL="https://github.com/${REPO}/blob/main/CHANGELOG.md#${ANCHOR}"
REPO_URL="https://github.com/${REPO}"
# Telegram caps a message at 4096 characters; the notes get what the frame leaves. The
# same budget caps both the plain-HTML notes and the rich-Markdown notes.
NOTES_BUDGET=3500

# Read the notes once: a notes argument given as process substitution is a pipe that can be
# read only once, so both awk programs below must work from this single copy.
NOTES_COPY="$(mktemp)"
trap 'rm -f "$NOTES_COPY"' EXIT
cat "$NOTES_FILE" > "$NOTES_COPY"

notes="$(awk '
  function esc(s) {
    gsub(/&/, "\\&amp;", s)
    gsub(/</, "\\&lt;", s)
    gsub(/>/, "\\&gt;", s)
    return s
  }
  function wrap(s, re, dlen, tag,    out, inner) {
    out = ""
    while (match(s, re)) {
      inner = substr(s, RSTART + dlen, RLENGTH - 2 * dlen)
      out = out substr(s, 1, RSTART - 1) "<" tag ">" inner "</" tag ">"
      s = substr(s, RSTART + RLENGTH)
    }
    return out s
  }
  function links(s,    out, span, text, url, mid) {
    out = ""
    while (match(s, /\[[^]]+\]\([^)]+\)/)) {
      span = substr(s, RSTART, RLENGTH)
      mid = index(span, "](")
      text = substr(span, 2, mid - 2)
      url = substr(span, mid + 2, length(span) - mid - 2)
      out = out substr(s, 1, RSTART - 1) "<a href=\"" url "\">" text "</a>"
      s = substr(s, RSTART + RLENGTH)
    }
    return out s
  }
  function inline(s) {
    s = esc(s)
    s = wrap(s, "`[^`]+`", 1, "code")
    s = wrap(s, "\\*\\*[^*]+\\*\\*", 2, "b")
    return links(s)
  }
  function flush() { if (para != "") { print para; para = "" } }
  function gap() { flush(); if (printed) print ""; }
  BEGIN { para = ""; printed = 0; inlist = 0 }
  /^[[:space:]]*$/ { flush(); inlist = 0; next }
  /^#+[[:space:]]/ {
    gap(); line = $0; sub(/^#+[[:space:]]+/, "", line)
    print "<b>" inline(line) "</b>"; printed = 1; inlist = 0; next
  }
  /^[[:space:]]*[-*][[:space:]]/ {
    if (!inlist) gap(); else flush()
    line = $0; sub(/^[[:space:]]*[-*][[:space:]]+/, "", line)
    print "• " inline(line); printed = 1; inlist = 1; next
  }
  {
    if (para == "" && !inlist) gap()
    para = (para == "" ? inline($0) : para " " inline($0)); printed = 1
  }
  END { flush() }
' "$NOTES_COPY")"

# Cut at a line boundary so no tag is left open.
if [ "${#notes}" -gt "$NOTES_BUDGET" ]; then
    notes="$(printf '%s\n' "$notes" | awk -v budget="$NOTES_BUDGET" '
        { if (used + length($0) + 1 > budget) exit; print; used += length($0) + 1 }')"
    notes="${notes}"$'\n'"…"
fi

# The notes carry no HTML of their own: escape <, > and & outside `code` spans so a note
# about "<tags>" stays text instead of becoming rich-message markup.
rich_notes="$(awk '
  function esc(s) { gsub(/&/, "\\&amp;", s); gsub(/</, "\\&lt;", s); gsub(/>/, "\\&gt;", s); return s }
  {
    n = split($0, parts, "`"); out = ""
    for (i = 1; i <= n; i++) out = out (i % 2 ? esc(parts[i]) : parts[i]) (i < n ? "`" : "")
    print out
  }
' "$NOTES_COPY")"

# Cut at a line boundary, same as the HTML notes above; never leave a fenced code block
# (```…```) open — if the cut falls inside one, drop the fence's opening line and
# everything after it.
if [ "${#rich_notes}" -gt "$NOTES_BUDGET" ]; then
    rich_notes="$(printf '%s\n' "$rich_notes" | awk -v budget="$NOTES_BUDGET" '
        { if (used + length($0) + 1 > budget) exit; print; used += length($0) + 1 }')"
    rich_notes="$(printf '%s\n' "$rich_notes" | awk '
        /^```/ { if (!fence) { fence = 1; open_line = NR } else { fence = 0 } }
        { lines[NR] = $0 }
        END {
            last = NR
            if (fence) last = open_line - 1
            for (i = 1; i <= last; i++) print lines[i]
        }')"
    rich_notes="${rich_notes}"$'\n'"…"
fi

rich="# agent-skills ${VERSION}

${rich_notes}

<tg-button-row align=\"left\">
<tg-button type=\"url\" style=\"success\" url=\"${CHANGELOG_URL}\">Changelog</tg-button>
<tg-button type=\"url\" url=\"${REPO_URL}\">Repository</tg-button>
</tg-button-row>"

message="<b>agent-skills ${VERSION} released</b>

${notes}

<a href=\"${CHANGELOG_URL}\">Changelog</a> · <a href=\"${REPO_URL}\">Repository</a>"

case "$DRY_RUN" in
    rich) printf '%s\n' "$rich"; exit 0 ;;
    html) printf '%s\n' "$message"; exit 0 ;;
esac

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
    echo "::notice::TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set; skipping the announcement."
    exit 0
fi

# The token is part of the URL; curl is kept quiet so it never reaches the log.
API="https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}"
describe() { sed 's/.*"description":"\([^"]*\)".*/\1/' <<<"$1"; }

rich_body="$(RICH="$rich" CHAT="$TELEGRAM_CHAT_ID" python3 -c '
import json, os
print(json.dumps({"chat_id": os.environ["CHAT"], "rich_message": {"markdown": os.environ["RICH"]}}))')"
response="$(curl -sS --max-time 30 "$API/sendRichMessage" \
    -H "Content-Type: application/json" --data-binary "$rich_body")"
if grep -q '"ok":true' <<<"$response"; then
    echo "Announced ${VERSION} on Telegram."
    exit 0
fi
echo "::warning::Telegram refused the rich message ($(describe "$response")); sending plain HTML instead."

response="$(curl -sS --max-time 30 "$API/sendMessage" \
    --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
    --data-urlencode "text=${message}" \
    --data-urlencode "parse_mode=HTML" \
    --data-urlencode "link_preview_options={\"is_disabled\":true}")"
if ! grep -q '"ok":true' <<<"$response"; then
    echo "Telegram rejected the announcement: $(describe "$response")" >&2
    exit 1
fi
echo "Announced ${VERSION} on Telegram (plain HTML)."
