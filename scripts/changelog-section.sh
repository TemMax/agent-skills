#!/usr/bin/env bash
#
# changelog-section.sh — print one version's section body from a changelog.
#
#   changelog-section.sh <version> [file]
#
# Prints everything after the line "## <version>" up to (not including) the next line
# starting with "## ", with leading and trailing blank lines trimmed. Defaults to reading
# CHANGELOG.md in the current directory. Exits 1 with a message on stderr if the section is
# missing (including when [file] itself cannot be read).
set -euo pipefail

USAGE="usage: changelog-section.sh <version> [file]"
VERSION="${1:?$USAGE}"
FILE="${2:-CHANGELOG.md}"

if ! output="$(awk -v version="$VERSION" '
  BEGIN { heading = "## " version; found = 0; in_section = 0; n = 0 }
  {
    if ($0 == heading) { found = 1; in_section = 1; next }
    if (in_section && index($0, "## ") == 1) { in_section = 0 }
    if (in_section) { lines[n++] = $0 }
  }
  END {
    if (!found) { exit 1 }
    start = 0
    while (start < n && lines[start] == "") start++
    last = n - 1
    while (last >= start && lines[last] == "") last--
    for (i = start; i <= last; i++) print lines[i]
  }
' "$FILE" 2>/dev/null)"; then
    echo "changelog-section: no \"## ${VERSION}\" section in ${FILE}" >&2
    exit 1
fi

printf '%s\n' "$output"
