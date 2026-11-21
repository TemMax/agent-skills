---
name: visual-explanation
description: 'Use when the user asks to see, show or visualize something, in any language ("show me", "I want to see it", "покажи"), or when a picture is clearly the faster way to understand: a flow with branches, several options against several criteria, a state matrix, a before and after, something spatial or visual. Then add one self-contained HTML page to a complete text answer; the page never replaces the answer. Do not use for a status update, a short or one-line answer, a linear list of steps, a yes or no with its reason, a summary of finished work that fits in a few lines, or an ordinary explanation in conversation; when in doubt, answer in text. Keep skill names and instruction/profile filenames/loading out of updates, including before loading; state the task.'
metadata:
  author: https://github.com/TemMax
  version: 0.1.2
---

# Adding a page to an explanation

A page helps when the user has to take in a shape that text lays out slowly:
branches, several options against several criteria, states, a before and
after. It is added to a good text answer, never in its place: the reply in the
chat still carries the conclusion, and it alone carries the questions. When a
text answer is enough, and that is the usual case, answer in text and build no
page. A small table in a text reply is fine; an ASCII diagram is not.

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
5. Show the page: render it in the conversation when the host can render
   HTML, and give the Markdown link to the file as well, because the user
   shares the file; when the host has no renderer, the link alone. A bare link
   is not enough when a renderer exists. Then reply as the next section says.

### The reply

The reply stands on its own: the user can read it and answer without opening
the page.

- The conclusion in two or three lines.
- Every question the user must answer, written out with its lettered options
  and the recommended one, so the user can answer "1A 2B" in the chat. The
  questions are in the reply only: the page does not repeat them, it marks the
  place a decision bears on with a short label such as "question 1".
- The page, rendered in the conversation when the host can, and always the
  Markdown link to the file with its absolute path.

The page carries the picture, the evidence and the detail, so the reply does
not paste the page's tables, findings list or not-verified list in full. Never
write "see the page for the result" or "answer the questions on the page".

Good:

> Backoff is the safer default: it retries only network errors and spreads the retries out, while the fixed version also retries bugs.
>
> 1. Switch the callers now? A. Yes, in this change (recommended: two call sites, both tested) B. Later, separately.
>
> [Retry: fixed vs backoff](/abs/path/.context/visuals/2026-11-18-retry/index.html)

> Надёжнее вариант с отсрочкой: он повторяет только сетевые ошибки и разносит попытки по времени, а фиксированный повторяет и ошибки в коде.
>
> 1. Перевести вызовы сейчас? A. Да, в этом изменении (рекомендую: два места, оба покрыты тестами) B. Позже, отдельно.
>
> [Повторы: фиксированные и с отсрочкой](/abs/path/.context/visuals/2026-11-18-retry/index.html)

Bad (the result and the questions are hidden in the file):

> [Results](/abs/path/.context/visuals/2026-11-18-retry/index.html). Need answers to questions 1 and 2 at the bottom of the page.

> [Результаты](/abs/path/.context/visuals/2026-11-18-retry/index.html). Нужны ответы на вопросы 1 и 2 внизу страницы.

### User-facing communication

The opening update names what you will explain, for example: “I’ll put the
two options side by side on one page.” / «Соберу оба варианта на одной
странице». Read the standard and the template as one internal preparation
step, without announcing it. The final message is the reply above, with the page.

In every message to the user, never name, quote or link this skill's
instruction files unless the user's request is about them. The page you built
is not an instruction file: link it.
