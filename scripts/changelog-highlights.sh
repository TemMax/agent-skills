#!/usr/bin/env bash
#
# changelog-highlights.sh — print one version's "### Highlights" block from a changelog.
#
#   changelog-highlights.sh <version> [file]
#
# Inside the "## <version>" section, finds the "### Highlights" block — everything after
# that heading, ending at whichever of these comes first: the first non-blank line that
# is neither a group line ("**name**") nor a bullet ("- ..."); the next "### " or "## "
# heading; or EOF — and prints its body with leading and trailing blank lines trimmed.
# Defaults to reading CHANGELOG.md in the current directory. Exits 1 with a message on
# stderr if the version section is missing, or its Highlights block is missing or empty
# (including when [file] itself cannot be read).
set -euo pipefail

USAGE="usage: changelog-highlights.sh <version> [file]"
VERSION="${1:?$USAGE}"
FILE="${2:-CHANGELOG.md}"

if ! output="$(awk -v version="$VERSION" '
  BEGIN {
    section_heading = "## " version
    highlights_heading = "### Highlights"
    in_section = 0; in_highlights = 0; found_highlights = 0; n = 0
  }
  in_highlights {
    if (index($0, "### ") == 1 || index($0, "## ") == 1) {
      in_highlights = 0
      if (index($0, "## ") == 1) { in_section = 0 }
      next
    }
    if ($0 == "" || $0 ~ /^\*\*[a-z0-9-]+\*\*$/ || $0 ~ /^- /) { lines[n++] = $0; next }
    in_highlights = 0
    next
  }
  {
    if ($0 == section_heading) { in_section = 1; next }
    if (in_section && index($0, "## ") == 1) { in_section = 0; next }
    if (in_section && $0 == highlights_heading) { in_highlights = 1; found_highlights = 1 }
  }
  END {
    if (!found_highlights) { exit 1 }
    start = 0
    while (start < n && lines[start] == "") start++
    last = n - 1
    while (last >= start && lines[last] == "") last--
    if (start > last) { exit 1 }
    for (i = start; i <= last; i++) print lines[i]
  }
' "$FILE" 2>/dev/null)"; then
    echo "changelog-highlights: no \"### Highlights\" in \"## ${VERSION}\" of ${FILE}" >&2
    exit 1
fi

printf '%s\n' "$output"
