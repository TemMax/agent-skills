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
description: 'Use when the user asks to see, show or visualize something, in any language ("show me", "I want to see it", "покажи"), or when a picture is clearly the faster way to understand: a flow with branches, several options against several criteria, a state matrix, a before and after, something spatial or visual. Then add one self-contained HTML page to a complete text answer; the page never replaces the answer. Do not use for a status update, a short or one-line answer, a linear list of steps, a yes or no with its reason, a summary of finished work that fits in a few lines, or an ordinary explanation in conversation; when in doubt, answer in text. Keep skill names and instruction/profile filenames/loading out of updates, including before loading; state the task.'
EOF
)"
DEMO_DESC="$(cat <<'EOF'
description: 'Use when showing the result of work that can be seen, and whenever you changed something the user can see — a colour, a layout, a text on screen, a state, an animation or gesture — and the user asks to see the result or to be shown, in any language ("show me the result", "покажи"); also for a device, emulator or stand run, a rendered preview, a chart, or a before and after of a UI change. Finish the change, then build one self-contained HTML demo page from real renders, screenshots and recordings, with what was not verified, as the evidence that it is done. A text description of the change alone, or a loose screenshot, is not a substitute for the page. Do not use when there is nothing to see, or to draw a mock-up in place of a real render. Keep skill names and instruction/profile filenames/loading out of updates, including before loading; state the task.'
EOF
)"
for tree in skills skills-codex; do
  expect "visual-explanation description ($tree)" "$EXPL_DESC" "$(sed -n '3p' $V/$tree/visual-explanation/SKILL.md)"
  expect "visual-demo description ($tree)" "$DEMO_DESC" "$(sed -n '3p' $V/$tree/visual-demo/SKILL.md)"
done

section "entrypoints stay short and every link resolves"
for f in $V/skills/*/SKILL.md $V/skills-codex/*/SKILL.md; do
  size="$(wc -c < "$f" | tr -d ' ')"
  check "entrypoint under 7.5 KB: $f ($size bytes)" "[ '$size' -lt 7500 ]"
  links="$(python3 - "$f" <<'PY'
import os, re, sys
p = sys.argv[1]
for t in re.findall(r'\]\(([^)#]+)\)', open(p).read()):
    if not t.startswith(('http', 'mailto:', '/')):
        print(os.path.normpath(os.path.join(os.path.dirname(p), t)))
PY
)"
  for target in $links; do
    check "link resolves from $(basename "$(dirname "$(dirname "$f")")")/$(basename "$(dirname "$f")"): $target" "[ -f '$target' ]"
  done
  check "entrypoint links the page standard: $f" "grep -q 'references/page-standard.md)' '$f'"
  check "entrypoint links the checker: $f" "grep -q 'references/page-check.mjs)' '$f'"
done
for f in $V/skills/*/SKILL.md $V/skills-codex/*/SKILL.md; do
  E="$(flat "$f")"
  for phrase in \
    "### The reply" \
    "The reply stands on its own: the user can read it and answer without opening the page." \
    "Every question the user must answer, written out with its lettered options and the recommended one, so the user can answer \"1A 2B\" in the chat. The questions are in the reply only: the page does not repeat them, it marks the place a decision bears on with a short label such as \"question 1\"." \
    "The page, rendered in the conversation when the host can, and always the Markdown link to the file with its absolute path." \
    "does not paste the page's tables, findings list or not-verified list in full" \
    "Never write \"see the page for the result\" or \"answer the questions on the page\"." \
    "render it in the conversation when the host can render HTML, and give the Markdown link to the file as well" \
    "A bare link is not enough when a renderer exists." \
    "Bad (the result and the questions are hidden in the file):"; do
    contains "reply rule in $f: $phrase" "$phrase" "$E"
  done
  for phrase in "at most the one question" "It is never a summary" "### The reply after the page" "The same questions are on the page"; do
    check "old page-only reply rule is gone from $f: $phrase" "! grep -qF '$phrase' '$f'"
  done
  good="$(python3 tests/lib/visuals-good-replies.py "$f")"
  expect "two good replies (English, Russian), each with its conclusion, lettered question and link: $f" "ok" "$good"
  check "the reply section comes before the communication section: $f" \
    "[ \$(grep -n '^### The reply$' '$f' | cut -d: -f1) -lt \$(grep -n '^### User-facing communication' '$f' | cut -d: -f1) ]"
done
E="$(flat $V/skills/visual-explanation/SKILL.md)"
contains "explanation bad reply is the real one" "Need answers to questions 1 and 2 at the bottom of the page." "$E"
contains "explanation bad reply in Russian" "Нужны ответы на вопросы 1 и 2 внизу страницы." "$E"
for phrase in "When a text answer is enough, and that is the usual case, answer in text and build no page." "A small table in a text reply is fine; an ASCII diagram is not." "It is added to a good text answer, never in its place"; do
  contains "explanation body keeps text the default: $phrase" "$phrase" "$E"
done
check "explanation body no longer opens with 'Text is slow to read'" "! grep -qF 'Text is slow to read' $V/skills/visual-explanation/SKILL.md $V/skills-codex/visual-explanation/SKILL.md"
for phrase in "Use when the user asks to see, show or visualize something, in any language" "a picture is clearly the faster way to understand" "the page never replaces the answer" "Do not use for a status update, a short or one-line answer, a linear list of steps, a yes or no with its reason, a summary of finished work that fits in a few lines, or an ordinary explanation in conversation" "when in doubt, answer in text"; do
  contains "explanation trigger is a balance: $phrase" "$phrase" "$EXPL_DESC"
done
case "$EXPL_DESC" in
  *"is not a substitute"*|*"Show, do not tell"*|*"whenever the reply"*) fail "explanation description drops the always-a-page wording" ;;
  *) pass "explanation description drops the always-a-page wording" ;;
esac
for phrase in "whenever you changed something the user can see" '"show me the result", "покажи"' "A text description of the change alone, or a loose screenshot, is not a substitute for the page." "Do not use when there is nothing to see"; do
  contains "demo trigger covers edits the user asks to see: $phrase" "$phrase" "$DEMO_DESC"
done
contains "demo keeps working files in work/" "in a \`work/\` folder inside the page's own folder, never at a fixed name in a shared temp directory" "$(flat $V/skills/visual-demo/SKILL.md)"
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
  "Give the page both ways." \
  "also give the Markdown link to the file with its absolute path, because the user shares the file with others" \
  "When the host offers no renderer, give the link alone. A bare link is not enough when a renderer exists." \
  "when it refuses a path, pass the file's content as \`html\` with the media paths made absolute" \
  "The reply in the chat stands on its own" \
  "every question the user must answer, written out with its lettered options" \
  "never says \"see the page for the result\" or \"answer the questions on the page\"" \
  "A decision the user must take is asked in the reply only, as a numbered question" \
  "The page never repeats a question, its options or its recommendation, and has no questions section" \
  "mark that place with a short label carrying the reply's number, such as \"question 1\"" \
  "write the decision as a fact and remove the label" \
  "An \`options\` comparison is not a repeat: it stays, with the recommended option marked; only the question about it is asked in the reply." \
  "Never paste loose images or videos into the chat as the demo" \
  "never draw an ASCII diagram" \
  "never present a hand-made HTML mock-up of a UI as if it were the real render" \
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
  "under 25 MB" \
  "live in a \`work/\` folder inside the page's own folder, never at a fixed name in a shared temp directory" \
  "the page references only \`media/\`" \
  "A browser profile or cache made for a capture goes to a temporary directory the agent creates for the run, or is deleted after the capture" \
  "\`work/\` keeps only what explains how the captures were made"; do
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
check "the standard has no questions section" "! grep -q '^| .questions. |' $STD"
check "the checker has no questions section" "! grep -qE \"order: .*'questions'\" $CHK"

section "templates follow the frame rules and ship their placeholders"
for t in $V/skills/visual-explanation/assets/explanation.html $V/skills/visual-demo/assets/demo.html; do
  T="$(flat "$t")"
  for var in --foreground --muted-foreground --card --border --primary --success --warning --destructive --radius --font-sans --font-mono; do
    contains "$(basename "$t") uses $var with a fallback" "var($var, " "$T"
  done
  contains "$(basename "$t") follows the system theme in a browser" "color-scheme: light dark" "$T"
  contains "$(basename "$t") has dark fallbacks" "@media (prefers-color-scheme: dark)" "$T"
done
for t in $V/skills/visual-explanation/assets/explanation.html $V/skills/visual-demo/assets/demo.html; do
  check "$(basename "$t") has no questions section" "! grep -qiE 'data-section=\"questions\"|Questions for you|class=\"questions\"' '$t'"
  check "$(basename "$t") tells the author where questions go" "flat '$t' | grep -qiF 'ask every question in the reply, never on the page'"
done
D="$(flat $V/skills/visual-demo/assets/demo.html)"
contains "demo template has the 1x speed button" 'data-rate="1"' "$D"
contains "demo template has the 0.25x speed button" 'data-rate="0.25"' "$D"
for m in $(grep -oE '(src|poster)="media/[^"]+"' $V/skills/visual-demo/assets/demo.html | sed -E 's/^[a-z]+="//; s/"$//' | sort -u); do
  check "demo placeholder ships and is named as one: $m" "[ -s '$V/skills/visual-demo/assets/$m' ] && case '$m' in media/placeholder-*) true;; *) false;; esac"
done

summary
