---
name: visual-demo
description: 'Use when showing the result of work that can be seen, and whenever you changed something the user can see — a colour, a layout, a text on screen, a state, an animation or gesture — and the user asks to see the result or to be shown, in any language ("show me the result", "покажи"); also for a device, emulator or stand run, a rendered preview, a chart, or a before and after of a UI change. Finish the change, then build one self-contained HTML demo page from real renders, screenshots and recordings, with what was not verified, as the evidence that it is done. A text description of the change alone, or a loose screenshot, is not a substitute for the page. Do not use when there is nothing to see, or to draw a mock-up in place of a real render. Keep skill names and instruction/profile filenames/loading out of updates, including before loading; state the task.'
metadata:
  author: https://github.com/TemMax
  version: 0.1.2
---

# Showing the result on a demo page

When work has a result that can be seen, the evidence that it is done is the
result itself: real renders, screenshots and recordings on one HTML page, with
what was not verified stated plainly. Never loose images or videos in the chat,
and never a hand-made mock-up in place of the real render.

## Steps

1. Read [the page standard](../visual-explanation/references/page-standard.md)
   once per session. Its rules apply to every page you build; a later page
   reuses what you read.
2. Capture the real thing on the final build: each state that changed as a
   screenshot or a preview render, each motion or gesture as a recording made
   with the system animations on (all scales at 1, read back first), the same
   state before and after when existing UI changed, and the design reference
   when one exists. Whatever you could not capture goes on the not-verified
   list; nothing is drawn in its place.
   Keep the working files (capture scripts, raw captures, temporary copies of
   the app) in a `work/` folder inside the page's own folder, never at a fixed
   name in a shared temp directory; the page references only `media/`.
3. Copy [the demo template](assets/demo.html), and only that file, to
   `<workspace>/.context/visuals/<YYYY-MM-DD>-<slug>/index.html`. Put the
   captures in a `media/` folder beside it and point every `media/placeholder-*`
   path at a real capture. Fill the verdict, the not-verified list and how it
   was checked (device or emulator or renderer, build variant, stand or
   backend, animation scales); link each finding to the frame that shows it;
   delete the optional blocks you do not use.
4. Check it with [page-check.mjs](../visual-explanation/references/page-check.mjs):
   `node <the visual-explanation skill's folder>/references/page-check.mjs <page> --kind demo`.
   Fix every `FAIL` line and read every `WARN` line.
5. Show the page: render it in the conversation when the host can render
   HTML, and give the Markdown link to the file as well, because the user
   shares the file; when the host has no renderer, the link alone. A bare link
   is not enough when a renderer exists. Then reply as the next section says.

### The reply

The reply stands on its own: the user can read it and answer without opening
the page.

- What works, what does not and what was not verified, in two or three lines.
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

> All three states of the settings screen work on the emulator; the list gap is 12 px where the design has 16 px. Not verified: dark theme, tablets.
>
> 1. Fix the gap now? A. Yes (recommended: one line) B. Later.
>
> [Settings screen on the emulator](/abs/path/.context/visuals/2026-11-18-settings/index.html)

> Все три состояния экрана настроек работают на эмуляторе; отступ списка 12 px, в макете 16 px. Не проверено: тёмная тема, планшеты.
>
> 1. Исправить отступ сейчас? A. Да (рекомендую: одна строка) B. Позже.
>
> [Экран настроек на эмуляторе](/abs/path/.context/visuals/2026-11-18-settings/index.html)

Bad (the result and the questions are hidden in the file):

> [Demo](/abs/path/.context/visuals/2026-11-18-settings/index.html). See the page for the result; question 1 is at the bottom.

> [Демо](/abs/path/.context/visuals/2026-11-18-settings/index.html). Результат на странице, вопрос 1 внизу.

### User-facing communication

The opening update names what you will show, for example: “I’ll capture the
three states on the emulator and put them on one page.” / «Сниму три состояния
на эмуляторе и соберу их на одной странице». Read the standard and the template
as one internal preparation step, without announcing it. The final message is the reply above, with the page.

In every message to the user, never name, quote or link this skill's
instruction files unless the user's request is about them. The page you built
is not an instruction file: link it.
