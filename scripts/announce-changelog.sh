#!/usr/bin/env bash
#
# announce-changelog.sh — announce every newly released CHANGELOG.md section's Highlights on
# Telegram.
#
#   announce-changelog.sh [--dry-run] <before> <after>
#   announce-changelog.sh [--dry-run] --version <X.Y.Z>
#
# In the <before> <after> form, finds every version added to CHANGELOG.md between the two
# commits (via changelog-new-versions.sh) and announces each one's "### Highlights" block
# (via changelog-highlights.sh), reading it out of `git show <after>:CHANGELOG.md`. In the
# --version form, announces that block of the working tree's CHANGELOG.md directly — used to
# (re)announce a release by hand. --dry-run is passed through to telegram-notify.sh.
#
# Prints "no new CHANGELOG.md release section" and exits 0 when there is nothing to announce.
# A version whose section has no Highlights block prints changelog-highlights.sh's error and
# is not sent; that failure is reported for that version, but every other version is still
# tried. Exits 1 if any announcement failed. Temp files are removed on exit.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
USAGE="usage: announce-changelog.sh [--dry-run] (<before> <after> | --version <X.Y.Z>)"

DRY_RUN=()
if [ "${1:-}" = "--dry-run" ]; then
    DRY_RUN=(--dry-run)
    shift
fi

CHANGELOG_FILE="CHANGELOG.md"
tmpfiles=()
cleanup() { [ "${#tmpfiles[@]}" -eq 0 ] || rm -f "${tmpfiles[@]}"; }
trap cleanup EXIT

# announce_section <version> <changelog-file> — extract one section and notify on it.
announce_section() {
    local version="$1" file="$2" notes
    notes="$(mktemp)"
    tmpfiles+=("$notes")
    if ! "$SCRIPT_DIR/changelog-highlights.sh" "$version" "$file" > "$notes"; then
        return 1
    fi
    "$SCRIPT_DIR/telegram-notify.sh" "${DRY_RUN[@]}" "$version" "$notes"
}

if [ "${1:-}" = "--version" ]; then
    [ "$#" -ge 2 ] || { echo "$USAGE" >&2; exit 1; }
    VERSION="$2"
    announce_section "$VERSION" "$CHANGELOG_FILE"
    exit $?
fi

[ "$#" -ge 2 ] || { echo "$USAGE" >&2; exit 1; }
BEFORE="$1"
AFTER="$2"

versions="$("$SCRIPT_DIR/changelog-new-versions.sh" "$BEFORE" "$AFTER" "$CHANGELOG_FILE")"
if [ -z "$versions" ]; then
    echo "no new CHANGELOG.md release section"
    exit 0
fi

after_changelog="$(mktemp)"
tmpfiles+=("$after_changelog")
if ! git show "${AFTER}:${CHANGELOG_FILE}" > "$after_changelog" 2>/dev/null; then
    echo "announce-changelog: could not read ${CHANGELOG_FILE} at ${AFTER}" >&2
    exit 1
fi

rc=0
while IFS= read -r version; do
    [ -n "$version" ] || continue
    if ! announce_section "$version" "$after_changelog"; then
        rc=1
    fi
done <<< "$versions"

exit "$rc"
