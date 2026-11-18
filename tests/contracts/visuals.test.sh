#!/usr/bin/env bash
# The visuals plugin: short entrypoints on both hosts that reach one shared page
# standard, one checker and two templates, and the standard's load-bearing rules.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
. tests/lib.sh

V=plugins/visuals
STD=$V/skills/visual-explanation/references/page-standard.md
CHK=$V/skills/visual-explanation/references/page-check.mjs
flat() { tr '\n' ' ' < "$1" | tr -s ' '; }

section "discovery descriptions are trigger-first and equal on both hosts"
EXPL_DESC="$(cat <<'EOF'
description: 'Show, do not tell. Use whenever the reply would explain how something works or how two things differ, compare options or versions, or lay out a flow, an architecture, a plan, findings, a state table, a before and after of a design or a decision to take — and whenever the user asks to see, show or visualize something ("I want to see it", "show me how X differs from Y"): build one self-contained HTML page, then reply in a few lines. A Markdown table, a pasted diff, code excerpts or an ASCII diagram in the reply is not a substitute. Do not use for a one-line answer or a status update. Keep skill names and instruction/profile filenames/loading out of updates, including before loading; state the task.'
EOF
)"
DEMO_DESC="description: 'Use when showing the result of work that can be seen — a screen or UI state, an animation or gesture, a device, emulator or stand run, a rendered preview, a chart, a before and after of a UI change — as the evidence that it is done: build one self-contained HTML demo page from real renders, screenshots and recordings, with what was not verified. Do not use when there is nothing to see, or to draw a mock-up in place of a real render. Keep skill names and instruction/profile filenames/loading out of updates, including before loading; state the task.'"
for tree in skills skills-codex; do
  expect "visual-explanation description ($tree)" "$EXPL_DESC" "$(sed -n '3p' $V/$tree/visual-explanation/SKILL.md)"
  expect "visual-demo description ($tree)" "$DEMO_DESC" "$(sed -n '3p' $V/$tree/visual-demo/SKILL.md)"
done

section "entrypoints stay short and every link resolves"
for f in $V/skills/*/SKILL.md $V/skills-codex/*/SKILL.md; do
  size="$(wc -c < "$f" | tr -d ' ')"
  check "entrypoint under 4 KB: $f ($size bytes)" "[ '$size' -lt 4096 ]"
  links="$(python3 - "$f" <<'PY'
import os, re, sys
p = sys.argv[1]
for t in re.findall(r'\]\(([^)#]+)\)', open(p).read()):
    if not t.startswith(('http', 'mailto:')):
        print(os.path.normpath(os.path.join(os.path.dirname(p), t)))
PY
)"
  for target in $links; do
    check "link resolves from $(basename "$(dirname "$(dirname "$f")")")/$(basename "$(dirname "$f")"): $target" "[ -f '$target' ]"
  done
  check "entrypoint links the page standard: $f" "grep -q 'references/page-standard.md)' '$f'"
  check "entrypoint links the checker: $f" "grep -q 'references/page-check.mjs)' '$f'"
done
check "explanation links its template (Claude)" "grep -q '](assets/explanation.html)' $V/skills/visual-explanation/SKILL.md"
check "demo links its template (Claude)" "grep -q '](assets/demo.html)' $V/skills/visual-demo/SKILL.md"
check "shared files exist once, under skills/visual-explanation" \
  "[ \"\$(find $V -name page-standard.md | wc -l | tr -d ' ')\" = 1 ] && [ \"\$(find $V -name page-check.mjs | wc -l | tr -d ' ')\" = 1 ]"

section "the page standard keeps its load-bearing rules"
S="$(flat "$STD")"
for phrase in \
  "no network request of any kind" \
  "referenced by a relative path" \
  ".context/visuals/<YYYY-MM-DD>-<slug>/index.html" \
  "git check-ignore -q .context/visuals" \
  "do not commit the page" \
  "Do not upload, publish or attach the page anywhere unless the user asks" \
  "needs the user's approval, and a cleanup report lists it as kept" \
  "html_render" \
  "give the absolute path as a link" \
  "Never paste loose images or videos into the chat as the demo" \
  "never draw an ASCII diagram" \
  "never present a hand-made HTML mock-up of a UI as if it were the real render" \
  "says only what the page does not" \
  "The verdict comes first, in two or three lines" \
  "in the language the user writes in" \
  "every claim on the page has its evidence on the page" \
  "marked Recommended with its reason" \
  "collapsed \`<details>\`" \
  "No secret, token, PIN, password, phone number or private key" \
  "No background colour on \`html\` or \`body\`" \
  "about 728 px wide on desktop and about 360 px on phones" \
  "No \`vh\` units anywhere and no \`height:100%\` on \`html\` or \`body\`" \
  "Charts get fixed pixel heights" \
  "@media (prefers-color-scheme: dark)" \
  "color-scheme: light dark" \
  "Write \"Everything listed was verified.\" only when that is true" \
  "Motion is recorded with the system animations on" \
  "A design export is a reference, never the result" \
  "nothing is drawn in its place" \
  "under 25 MB"; do
  contains "standard: $phrase" "$phrase" "$S"
done
for var in --background --foreground --muted-foreground --card --border --primary --secondary --success --warning --destructive --chart-1 --chart-6 --radius --font-sans --font-mono; do
  contains "standard names theme variable $var" "\`$var\`" "$S"
done

section "the standard's section tables are the checker's"
out="$(node --input-type=module - "$CHK" "$STD" <<'JS'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const [chk, std] = process.argv.slice(2)
const { SECTIONS } = await import(pathToFileURL(chk).href)
const text = readFileSync(std, 'utf8')
for (const kind of ['explanation', 'demo']) {
  const heading = kind === 'explanation' ? '## Explanation page' : '## Demo page'
  const part = text.slice(text.indexOf(heading)).split('\n## ')[0]
  const rows = [...part.matchAll(/^\| `([a-z-]+)` \| (yes|no) \|/gm)]
  const order = rows.map((r) => r[1])
  const required = rows.filter((r) => r[2] === 'yes').map((r) => r[1])
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  console.log(`${kind} ${same(order, SECTIONS[kind].order) && same(required, SECTIONS[kind].required) ? 'same' : 'differs: ' + order + ' / ' + required}`)
}
JS
)"
contains "explanation sections match" "explanation same" "$out"
contains "demo sections match" "demo same" "$out"

section "templates follow the frame rules and ship their placeholders"
for t in $V/skills/visual-explanation/assets/explanation.html $V/skills/visual-demo/assets/demo.html; do
  T="$(flat "$t")"
  for var in --foreground --muted-foreground --card --border --primary --success --warning --destructive --radius --font-sans --font-mono; do
    contains "$(basename "$t") uses $var with a fallback" "var($var, " "$T"
  done
  contains "$(basename "$t") follows the system theme in a browser" "color-scheme: light dark" "$T"
  contains "$(basename "$t") has dark fallbacks" "@media (prefers-color-scheme: dark)" "$T"
done
D="$(flat $V/skills/visual-demo/assets/demo.html)"
contains "demo template has the 1x speed button" 'data-rate="1"' "$D"
contains "demo template has the 0.25x speed button" 'data-rate="0.25"' "$D"
for m in $(grep -oE '(src|poster)="media/[^"]+"' $V/skills/visual-demo/assets/demo.html | sed -E 's/^[a-z]+="//; s/"$//' | sort -u); do
  check "demo placeholder ships and is named as one: $m" "[ -s '$V/skills/visual-demo/assets/$m' ] && case '$m' in media/placeholder-*) true;; *) false;; esac"
done

summary
