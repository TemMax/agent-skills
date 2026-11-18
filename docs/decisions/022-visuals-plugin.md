# 022 — Visual pages as a separate plugin with two skills and a code checker

18 November 2026. Applies to visuals 0.1.0 (release 4.25.1) in Claude Code and Codex.

## Context

The user oversees many autonomous agents and reads their output all day. Text
is slow to read and a picture is fast; as models do more of the legwork, human
work moves to oversight and understanding, and a large, custom, disposable
artifact such as a web page becomes worth asking for. Agents answered with long
text, ASCII diagrams the user cannot read, and loose screenshots or videos with
no verdict, no method and no list of what was not checked. Some showed a
hand-made HTML mock-up where a real render was asked for, or recorded motion
with the system animations off. The page they should build must be simple to
read and still complete.

## Decision

**A separate plugin, `visuals`.** Showing work is not part of planning,
execution or review, and it applies to every task, including ones that never
touch orchestration or code-review. A separate plugin installs on its own, has
its own version, and keeps the other plugins' entrypoints unchanged. It selects
no model profile, so it has no runtime-context hook: the rule that keeps
instruction files out of messages is stated in each entrypoint.

**Two skills, one standard.** `visual-explanation` triggers when the user must
understand something with structure or asks to see it; `visual-demo` triggers
when work has a result that can be seen and the page is the evidence it is
done. Their triggers and their pages differ (a picture and decisions against
real captures and a not-verified list), so one skill would carry a description
too broad to trigger reliably and a body that mixes both. The rules they share
live once, in `skills/visual-explanation/references/page-standard.md`, beside
the checker; each skill owns its template. Codex entrypoints in `skills-codex/`
reach the shared files by relative path, as the other plugins do (decision 013).

**A checker in code, not prose.** The rules a program can decide are decided
by `page-check.mjs`, a zero-dependency Node script with unit tests that build
one page per rule, broken only by that rule. It fails a page that:

- loads anything from the network: a `src`, `srcset`, `poster` or SVG
  `<image>`/`<use>` `href` that points to a network address, a stylesheet or
  script file, `@import`, a network `url()`, a network API in a script, or a
  network address a script would load (written right after `src`, `srcset`,
  `poster`, `data`, `setAttribute` of one of them, a CSS `url(` or a
  `Worker(`, or inside markup the script writes); an address that only
  becomes a link target or text passes;
- references local media that is missing, empty, absolute or outside the
  page's folder, or, in a demo's `states` or `motion`, a template placeholder
  (named `placeholder-*` or byte-identical to a shipped one);
- lacks a required section or a verdict, has a figure without a caption, an
  image without alt text, a video without controls, or a demo `states`
  section with no image or video;
- uses `vh` units in CSS, an inline style, or a style a script sets
  (`.style`, `cssText`, `setProperty`, or CSS or a style attribute it writes;
  a `vh` mentioned in a script's prose passes), or `height:100%` on html or
  body;
- holds text that looks like a token or a private key;
- draws an ASCII diagram in `<pre>` or in an element styled `white-space:pre`
  or `pre-wrap`.

It warns, without failing, on section order, unknown sections, a background on
html or body, a page over 25 MB, a demo state drawn as SVG or a `data:` URI
(a state must be a real capture), a network address in a script that also
loads from a variable it cannot follow, and text that looks like a phone
number or a password or PIN with its value (a PIN being 4 to 8 digits, so a
version pin such as `pin = 3.11` is silent); these have too many false
positives to fail on. The shipped templates are exempt from the placeholder and
drawn-state rules in place only. It is deterministic and costs no model call,
so an agent runs it on every page and fixes what it reports instead of judging
its own page. What it cannot decide (that a screenshot is real, that the
verdict is true) stays in the standard.

**Release number.** The changelog names each release after the orchestration
version and the structure tier checks that. Visuals 0.1.0 therefore ships as
release 4.25.1, with orchestration unchanged apart from its version number.

## Consequences

Agents that have the plugin build pages in the owning workspace under
`.context/visuals/`, render them in the conversation where the host can and
keep them after cleanup unless the user approves deleting them. The demo
template ships with placeholder media so it passes the checker in place; a page
copied from it fails until every placeholder is replaced by a real capture.

The checker's ASCII-diagram rule is a heuristic: three or more lines in one
`<pre>` made mostly of `+ - |` or carrying two or more box-drawing characters.
A pasted `tree` listing or a Markdown table in `<pre>` fails it on purpose; a
YAML file with three `---` separators would too.

Not settled by this decision: whether T3 Code's `html_render` resolves a page's
relative media paths when given the file path (its preview tool documents
inlining absolute local paths only).

## Validation

Offline: each checker rule fails (or warns) on a page built to break only that
rule, and the two templates pass. Every rule added after the live test was
mutation-checked (each disabled, its test red, restored): placeholder media,
SVG `href`, script network addresses, `vh` from a script, `white-space:pre`
diagrams, drawn states, phone numbers and password or PIN values; so were four
earlier rules (figure caption, video controls, secret, ASCII diagram in
`<pre>`), and the narrowing that followed the re-measure (script addresses
by load context, `vh` only as a style, a PIN of 4 to 8 digits), with a passing
test for each false positive it removed. The 32 pages the two live rounds
produced still pass, with no failure and no warning. The
structure and contract tiers cover both hosts' entrypoints, the descriptions,
the reply section, every link and the standard's section tables against the
checker's.

Live, 31 calls on Claude Code 2.1.327 (Sonnet 5.5 and Opus 5.5) and Codex
0.170.0 (GPT-6.2 Sol), the candidate loaded from a disposable snapshot with
expectations frozen first, about $2.81 of reported Claude cost:

- The skills triggered in 17 of 17 cases that called for a page, and in 0 of
  11 that did not (a one-line question, a yes-or-no status, a rename across
  files, a docstring with nothing to see).
- All 20 pages passed the checker, and every demo used real screenshots.
- The reply repeated the page: 8 of 15 Claude replies summarised it and 5 gave
  the path as code or bold text instead of a link; Codex replies were clean.
  Each entrypoint now has its own section on the reply, with a good and a bad
  example in English and Russian. Re-measured on the fixed candidate: 1 of 10
  Claude replies repeated the page (was 8 of 15), 0 of 10 gave the path as
  code or bold text (was 5 of 15), and Codex 0 of 2.
- Agents wrote capture scripts to fixed names in a shared temp directory and
  reset them with `rm -rf`, which lets agents running side by side clobber each
  other; the standard and the demo skill now keep working files in the page's
  own `work/` folder.
- Hand-made bad pages that the checker passed (placeholder media, a drawn
  state, an SVG or script network load, `vh` from a script, a diagram in a
  `white-space:pre` block, a phone number and a password) became the rules
  above; a page holding a diff in `<pre>` still passes.

- In the re-measure, Sonnet built a demo page in only 2 of 4 runs whose
  request was mainly an edit ending with "show me the result": it made the
  change, took its own screenshot and answered in text. The demo description
  now names that case (a change the user can see, then "show me" or
  "покажи") and says a text description or a loose screenshot is not a
  substitute. Re-measured on Sonnet at b3d6707: 4 of 4 such requests built
  the page, and 4 edits with nothing to see built none.
- A browser profile made for a capture ended up in a page's `work/` folder
  (1.8 MB); the standard now sends it to a temporary directory the agent
  creates for the run, or deletes it after the capture.

An earlier round of four Sonnet calls found that a description which only
allows the skill does not make the model use it; the shipped description
directs it ("Show, do not tell …").

## Addendum — visuals 0.1.1 (release 4.25.2): the reply stands on its own

**What was wrong.** In real use, 0.1.0 made agents answer almost only through
pages. A long experiment ended with this as the whole final reply:
"[Results](…/index.html). Need answers to questions 1 and 2 at the bottom of
the page." The result and the questions were in a file, and the page was not
rendered in the conversation.

**The wrong metric.** The first release was tuned and validated on two
numbers. The trigger rate was measured only against under-triggering: a
request that called for a page and got text counted as a miss, while a page
built for an ordinary answer did not. The reply was scored on how rarely it
repeated the page. Both numbers improved round after round (17 of 17
triggers, replies repeating the page down from 8 of 15 to 1 of 10), and both
pushed the same way: more pages, less in the chat. Neither asked whether the
reply answered the user. The text that followed from them had three faults:
the explanation description fired "whenever the reply would explain…" and
called a Markdown table in a reply no substitute; the reply rule forbade the
verdict and allowed at most one question; and when the host refused a file
path, agents fell back to a bare link.

**Decision.**

- The reply in the chat stands on its own: the conclusion in two or three
  lines (for a demo, what works, what does not and what was not verified) and
  every question the user must answer, with its lettered options and the
  recommended one, so the user answers "1A 2B" in the chat. The page carries
  the picture, the evidence and the detail; the reply does not paste the
  page's tables, findings list or not-verified list in full, and never points
  to the page for the result or for the questions.
- The page is given both ways: rendered in the conversation when the host can
  render HTML, and always as a Markdown link to the file, which the user
  shares. A bare link is not enough when a renderer exists. A renderer stays
  optional and host-neutral; T3 Code's `html_render` is the example.
- `visual-explanation` is a balance: it is used when the user asks to see,
  show or visualize something, or when a picture is clearly the faster way to
  understand (a flow with branches, several options against several criteria,
  a state matrix, a before and after, something spatial). It is not used for a
  status, a short answer, a linear list of steps, a yes or no with its reason,
  a summary of finished work that fits in a few lines, or an ordinary
  explanation. When in doubt, the answer is text. A page is added to a good
  text answer; it never turns the answer into a page. A small table in a text
  reply is fine; only ASCII diagrams stay forbidden.
- `visual-demo` keeps its trigger and gets the same reply rule.
- The page checker does not change.

**What a measurement must count from now on.** Over-triggering as well as
under-triggering: a set of prompts that should be answered in text, scored
for pages built. And the reply on its own: whether a reader who never opens
the page gets the conclusion and every question. No live run has measured
0.1.1 yet.

## Implementation anchors

- [Page standard](../../plugins/visuals/skills/visual-explanation/references/page-standard.md),
  [checker](../../plugins/visuals/skills/visual-explanation/references/page-check.mjs),
  [explanation template](../../plugins/visuals/skills/visual-explanation/assets/explanation.html),
  [demo template](../../plugins/visuals/skills/visual-demo/assets/demo.html).
- [Checker tests](../../tests/lib/page-check.test.mjs),
  [contract](../../tests/contracts/visuals.test.sh).
