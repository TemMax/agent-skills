#!/usr/bin/env bash
#
# changelog-new-versions.sh — list versions newly added to a changelog between two commits.
#
#   changelog-new-versions.sh <before> <after> [file]
#
# Prints, one per line in file order (newest first), every "X.Y.Z" heading
# (matching ^## [0-9]+\.[0-9]+\.[0-9]+$) present in `git show <after>:<file>` but not in
# `git show <before>:<file>`. Defaults to reading CHANGELOG.md in the current git repository.
#
# If <before> is empty, all zeros, not a commit that exists in this repository, or the file
# does not exist at <before>, this prints only the topmost version at <after> — so the first
# CHANGELOG.md announces one release, not the whole history. If the file does not exist at
# <after>, this prints nothing. This always exits 0.
set -euo pipefail

USAGE="usage: changelog-new-versions.sh <before> <after> [file]"
if [ "$#" -lt 2 ]; then
    echo "$USAGE" >&2
    exit 1
fi
BEFORE="$1"
AFTER="$2"
FILE="${3:-CHANGELOG.md}"

# Never lets a grep/sed pipeline's own exit status (e.g. "no match") escape under set -e.
versions_in() {
    printf '%s\n' "$1" | grep -E '^## [0-9]+\.[0-9]+\.[0-9]+$' | sed 's/^## //' || true
}

is_zero_or_empty() {
    [ -z "$BEFORE" ] && return 0
    case "$BEFORE" in
        *[!0]*) return 1 ;;
        *) return 0 ;;
    esac
}

after_content="$(git show "${AFTER}:${FILE}" 2>/dev/null)" || exit 0
after_versions="$(versions_in "$after_content")"
[ -n "$after_versions" ] || exit 0

topmost_only() {
    printf '%s\n' "$after_versions" | head -n 1
}

if is_zero_or_empty || ! git rev-parse --verify "${BEFORE}^{commit}" >/dev/null 2>&1; then
    topmost_only
    exit 0
fi

if ! before_content="$(git show "${BEFORE}:${FILE}" 2>/dev/null)"; then
    topmost_only
    exit 0
fi
before_versions="$(versions_in "$before_content")"

printf '%s\n' "$after_versions" | while IFS= read -r v; do
    if ! printf '%s\n' "$before_versions" | grep -qxF "$v"; then
        printf '%s\n' "$v"
    fi
done
exit 0
