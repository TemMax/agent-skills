---
name: visual-demo
description: 'Use when showing the result of work that can be seen, and whenever you changed something the user can see — a colour, a layout, a text on screen, a state, an animation or gesture — and the user asks to see the result or to be shown, in any language ("show me the result", "покажи"); also for a device, emulator or stand run, a rendered preview, a chart, or a before and after of a UI change. Finish the change, then build one self-contained HTML demo page from real renders, screenshots and recordings, with what was not verified, as the evidence that it is done. A text description of the change or a loose screenshot in the reply is not a substitute. Do not use when there is nothing to see, or to draw a mock-up in place of a real render. Keep skill names and instruction/profile filenames/loading out of updates, including before loading; state the task.'
metadata:
  author: https://github.com/TemMax
  version: 0.1.0
---

# Showing the result on a demo page

When work has a result that can be seen, the evidence that it is done is the
result itself: real renders, screenshots and recordings on one HTML page, with
what was not verified stated plainly. Never loose images or videos in the chat,
and never a hand-made mock-up in place of the real render.

Resolve relative resource paths from this SKILL.md's physical directory.
Resolve a symlinked skill directory to its target first; repository cwd is not
the base for the standard, template and checker paths below.

## Steps

1. Read [the page standard](../../skills/visual-explanation/references/page-standard.md)
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
3. Copy [the demo template](../../skills/visual-demo/assets/demo.html), and only that file, to
   `<workspace>/.context/visuals/<YYYY-MM-DD>-<slug>/index.html`. Put the
   captures in a `media/` folder beside it and point every `media/placeholder-*`
   path at a real capture. Fill the verdict, the not-verified list and how it
   was checked (device or emulator or renderer, build variant, stand or
   backend, animation scales); link each finding to the frame that shows it;
   delete the optional blocks you do not use.
4. Check it with [page-check.mjs](../../skills/visual-explanation/references/page-check.mjs):
   `node <this plugin's folder>/skills/visual-explanation/references/page-check.mjs <page> --kind demo`.
   Fix every `FAIL` line and read every `WARN` line.
5. Show the page in the conversation when the host can render it, otherwise
   link it. Then reply as the next section says, and stop.

### The reply after the page

The reply is the page, shown in the conversation or given as a Markdown link
with the absolute path, and then at most the one question that needs an
answer now or one sentence the page cannot carry. It is never a summary: not
the verdict again, not the findings again, not the not-verified list again,
and not the path as code or bold text.

- Good: “[Settings screen on the emulator](/abs/path/.context/visuals/2026-11-18-settings/index.html) — fix the list gap now (question 1)?”
- Good: «[Экран настроек на эмуляторе](/abs/path/.context/visuals/2026-11-18-settings/index.html) — исправить отступ списка сейчас (вопрос 1)?»
- Bad: “Done: `/abs/path/…/index.html`. All three states work, dark theme not verified, the gap is 12 px…”
- Bad: «Готово: **/abs/path/…/index.html**. Все три состояния работают, тёмная тема не проверена, отступ 12 px…»

### User-facing communication

The opening update names what you will show, for example: “I’ll capture the
three states on the emulator and put them on one page.” / «Сниму три состояния
на эмуляторе и соберу их на одной странице». Read the standard and the template
as one internal preparation step, without announcing it. The final message is
the page plus a short reply.

In every message to the user, never name, quote or link this skill's
instruction files unless the user's request is about them. The page you built
is not an instruction file: link it.
