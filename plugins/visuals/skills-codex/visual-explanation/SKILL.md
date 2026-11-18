---
name: visual-explanation
description: 'Show, do not tell. Use whenever the reply would explain how something works or how two things differ, compare options or versions, or lay out a flow, an architecture, a plan, findings, a state table, a before and after of a design or a decision to take — and whenever the user asks to see, show or visualize something ("I want to see it", "show me how X differs from Y"): build one self-contained HTML page, then reply in a few lines. A Markdown table, a pasted diff, code excerpts or an ASCII diagram in the reply is not a substitute. Do not use for a one-line answer or a status update. Keep skill names and instruction/profile filenames/loading out of updates, including before loading; state the task.'
metadata:
  author: https://github.com/TemMax
  version: 0.1.0
---

# Explaining with a page

Text is slow to read and a picture is fast. When what the user must take in
has structure, show it as one HTML page: the verdict first, one main picture,
the options and the questions, with the evidence on the page. A one-line
answer or a status update stays plain text.

Resolve relative resource paths from this SKILL.md's physical directory.
Resolve a symlinked skill directory to its target first; repository cwd is not
the base for the standard, template and checker paths below.

## Steps

1. Read [the page standard](../../skills/visual-explanation/references/page-standard.md) once per session. Its
   rules apply to every page you build; a later page reuses what you read.
2. Gather the facts and their evidence before writing: every claim on the page
   needs its file path, command output, link or picture on the page.
3. Copy [the explanation template](../../skills/visual-explanation/assets/explanation.html) to
   `<workspace>/.context/visuals/<YYYY-MM-DD>-<slug>/index.html` and replace
   every example text. Keep the `data-section` blocks in the template's order,
   choose the main picture for the content (flow, tree, timeline, comparison
   table, state matrix), and delete the optional blocks you do not use.
4. Check it with [page-check.mjs](../../skills/visual-explanation/references/page-check.mjs):
   `node <this plugin's folder>/skills/visual-explanation/references/page-check.mjs <page> --kind explanation`.
   Fix every `FAIL` line and read every `WARN` line.
5. Show the page in the conversation when the host can render it, otherwise
   link it. Then reply as the next section says, and stop.

### The reply after the page

The reply is the page, shown in the conversation or given as a Markdown link
with the absolute path, and then at most the one question that needs an
answer now or one sentence the page cannot carry. It is never a summary: not
the verdict again, not the findings again, not the not-verified list again,
and not the path as code or bold text.

- Good: “[Retry: fixed vs backoff](/abs/path/.context/visuals/2026-11-18-retry/index.html) — question 1 needs your answer before I touch the callers.”
- Good: «[Повторы: фиксированные и с отсрочкой](/abs/path/.context/visuals/2026-11-18-retry/index.html) — нужен ответ на вопрос 1, прежде чем я трону вызовы.»
- Bad: “Page: `/abs/path/…/index.html`. In short: the first retries every error, the second only network errors…”
- Bad: «Страница: **/abs/path/…/index.html**. Коротко: первая версия повторяет любую ошибку, вторая — только сетевые…»

### User-facing communication

The opening update names what you will explain, for example: “I’ll put the
two options side by side on one page.” / «Соберу оба варианта на одной
странице». Read the standard and the template as one internal preparation
step, without announcing it. The final message is the page plus a short reply.

In every message to the user, never name, quote or link this skill's
instruction files unless the user's request is about them. The page you built
is not an instruction file: link it.
