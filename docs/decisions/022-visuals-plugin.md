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

**A checker in code, not prose.** The rules a program can decide — no network
request, local media present and inside the page's folder, required sections
and a non-empty verdict, captions, alt text, video controls, a demo states
section with a real image or video, no `vh` or `height:100%` on html or body,
no text that looks like a token or private key, no ASCII diagram in `<pre>` —
are decided by `page-check.mjs`, a zero-dependency Node script with unit tests
that build one failing page per rule. It is deterministic and costs no model
call, so an agent runs it on every page and fixes what it reports instead of
judging its own page. It warns, without failing, on section order, unknown
sections, a background on html or body, and a page over 25 MB. What it cannot
decide (that a screenshot is real, that the verdict is true) stays in the
standard.

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

Offline: the checker's unit tests build one page per rule that breaks only
that rule, and the two templates pass; four rules were mutation-checked (the
figure caption, video controls, secret and ASCII-diagram rules: each disabled,
its test went red, restored). The structure and contract tiers cover both
hosts' entrypoints, the descriptions, every link and the standard's section
tables against the checker's.

Live, on Claude Code 2.1.327 with `claude-sonnet-5-5` at medium effort, the
candidate loaded from a disposable snapshot through `--plugin-dir` with user
and project settings off (the method in `tests/README.md`); every init event
named the snapshot's path and version 0.1.0, and the snapshot's hashes were
unchanged after each call. Expectations were frozen before the first call.
Four calls in all, about $0.26:

| Call | Prompt | Outcome |
|---|---|---|
| 1 | "Explain to me how retry_fixed.py differs from retry_backoff.py in this repository. I want to see it." | **Failed**: the skill was listed but not loaded; the answer was a pasted diff. |
| 2 | the same, after the description named "see", "show" and "compare" | **Failed**: the full description reached the model's skill listing; the answer was text, code excerpts and a Markdown table. |
| 3 | the same, with the shipped description ("Show, do not tell. Use whenever the reply would explain how something works or how two things differ … A Markdown table, a pasted diff, code excerpts or an ASCII diagram in the reply is not a substitute.") | **Passed**: the skill loaded from the snapshot, the agent read the standard and the template, wrote `.context/visuals/2026-11-18-retry-fixed-vs-backoff/index.html`, which passes `page-check.mjs --kind explanation` (rerun independently), checked that `.context/` is ignored, and committed nothing. Its reply gave the path in code rather than as a link and repeated the page's main points in three bullets. |
| 4 | "What Python version does pyproject.toml require? Answer in one line." | **Passed**: no skill loaded, no page, a one-line answer naming 3.11. |

Not run: `visual-demo` live (it needs a device, emulator or renderer to
capture); any Codex live check; repetitions, so one pass is "can", not a rate.
Calls 1 and 2 show that a description that only allows the skill does not make
Sonnet use it; the shipped description directs it.

## Implementation anchors

- [Page standard](../../plugins/visuals/skills/visual-explanation/references/page-standard.md),
  [checker](../../plugins/visuals/skills/visual-explanation/references/page-check.mjs),
  [explanation template](../../plugins/visuals/skills/visual-explanation/assets/explanation.html),
  [demo template](../../plugins/visuals/skills/visual-demo/assets/demo.html).
- [Checker tests](../../tests/lib/page-check.test.mjs),
  [contract](../../tests/contracts/visuals.test.sh).
