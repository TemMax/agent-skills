# Page standard

Both visual skills build pages by these rules. `page-check.mjs` (beside this
file) checks the ones a program can check; the rest are yours to keep.

## The file

1. One self-contained HTML file: CSS and JS inline, no network request of any
   kind, so it opens offline on any machine, now and later.
2. Images and videos are local files in the page's folder, referenced by a
   relative path, so the folder can be moved or archived whole.
3. It lives in the owning workspace (the worktree the task runs in) at
   `.context/visuals/<YYYY-MM-DD>-<slug>/index.html`, with its media in a
   `media/` folder beside it, so each page keeps its evidence together.
4. Working files for a page (capture scripts, raw captures, temporary copies
   of the app) live in a `work/` folder inside the page's own folder, never at
   a fixed name in a shared temp directory, because agents running side by
   side overwrite and delete each other's fixed names; the page references
   only `media/`. A browser profile or cache made for a capture goes to a
   temporary directory the agent creates for the run, or is deleted after the
   capture, so `work/` keeps only what explains how the captures were made.
5. Check that `.context/` is ignored by git (`git check-ignore -q .context/visuals`).
   If it is not, say so in the reply and do not commit the page, because a page
   is working evidence, not source.
6. Do not upload, publish or attach the page anywhere unless the user asks,
   because it can hold private work.
7. Keep the page. Deleting it on cleanup or after a merge needs the user's
   approval, and a cleanup report lists it as kept, because it is the record of
   what the user was shown.

## Showing it

8. When the host offers a tool that renders an HTML page inside the
   conversation, use it, by that tool's own rules for input and size; when it
   offers none, give the absolute path as a link. Either way the user sees the
   page, not a description of it, and the file stays on disk. The page does
   not depend on any one host: it is a plain file that opens in a browser.
   One host's tools, as an example: in T3 Code, `html_render` takes the
   absolute `path` and, as `height`, the `contentHeight` that `html_preview`
   measured; when it refuses a path, pass the file's content as `html` with
   the media paths made absolute.
9. Never paste loose images or videos into the chat as the demo, never draw an
   ASCII diagram, and never present a hand-made HTML mock-up of a UI as if it
   were the real render, because the user must be able to trust that what
   looks like the product is the product.
10. The text reply after the page is short and says only what the page does
   not, such as a question that needs an answer now, because the user already
   has the page in front of them. It links the page file and repeats none of
   the page's points.

## Content

11. The verdict comes first, in two or three lines: what is true, what is done,
    what is needed from the user, so a reader who stops there still knows.
12. Simple words, in the language the user writes in, because the page is read
    fast.
13. Simple but complete: every claim on the page has its evidence on the page
    (a screenshot, a recording, a command with its output, a file path, a link),
    because a claim without evidence is one the user must check by hand.
14. A decision the user must take is a numbered question; its options carry
    letters (A, B, C) and one is marked Recommended with its reason, so the user
    can answer "1A" in one line.
15. Detail that most readers skip goes into a collapsed `<details>` whose
    `<summary>` says what is inside, so the page stays short without losing it.
16. No secret, token, PIN, password, phone number or private key on the page,
    screenshots included (crop or cover them), because a page outlives the task
    and travels.
17. Every top-level block carries a `data-section` attribute naming it (lists
    below), in the order given, so the checker and the reader find each part.
18. Every picture sits in a `<figure>` with a `<figcaption>`, every `<img>` has
    an `alt` text, and every `<video>` has `controls`, so each one says what it
    shows and can be paused.

## Layout: the conversation frame and the browser

The same file must read well opened in a browser and inside a conversation
frame, where a host that can render HTML embeds it, in light and dark. The
rules below keep a page safe in a narrow embedded frame and cost nothing in a
browser; the numbers come from T3 Code's frame, the one they were measured
against. Start from a template; it already does all of this.

19. No background colour on `html` or `body`, and no outer card, border, banner
    or side padding, because the frame sits on the thread's own background and
    adds its own gutter.
20. Fluid widths only: the frame is about 728 px wide on desktop and about
    360 px on phones, so grids wrap and wide tables scroll inside their own box.
21. No `vh` units anywhere and no `height:100%` on `html` or `body`, because the
    frame takes its height from the content and both loop or are rejected.
22. Charts get fixed pixel heights, for the same reason.
23. Colours come from the host's theme variables with fallbacks: `--background`,
    `--foreground`, `--muted-foreground`, `--card`, `--border`, `--primary`,
    `--secondary`, `--success`, `--warning`, `--destructive`, `--chart-1` to
    `--chart-6`, `--radius`, `--font-sans`, `--font-mono`. Define the page's own
    tokens on `:root` as `var(--foreground, <light>)`, redefine them under
    `@media (prefers-color-scheme: dark)` with dark fallbacks, and set
    `color-scheme: light dark` on `:root`, so the host's theme wins in the frame
    and the system theme wins in a browser.
24. A box that needs its own background gets 16 px padding and
    `var(--radius)` corners, so it matches the host's boxes.
25. Keep the page with its media under 25 MB (H.264 video, long side at most
    1280 px), because larger pages load slowly and are hard to keep.

## Check before showing

```bash
node <this folder>/page-check.mjs <page>/index.html --kind explanation|demo
```

Fix every `FAIL` line and read every `WARN` line; show the page only when the
check ends with `OK`. Exit 0 is a pass, 1 a failure, 2 a wrong command line.

## Explanation page

Sections, in this order:

| `data-section` | Required | What it holds |
|---|---|---|
| `verdict` | yes | The answer in two or three lines. |
| `picture` | yes | One main picture built in HTML, CSS or inline SVG. |
| `options` | no | The options side by side, the recommended one marked, with what each costs and gives. |
| `questions` | no | Numbered questions with lettered options and a recommendation. |
| `details` | no | Collapsed `<details>` for what most readers skip. |
| `sources` | no | File paths and links the page rests on. |

Choose the picture for the content, not for decoration: a sequence of steps
is a flow of boxes and arrows; a hierarchy is a tree of nested lists; events
in time are a timeline; options against criteria are a comparison table;
states against conditions are a matrix with coloured cells; a design change is
the before and after side by side. One picture that answers the question beats
several that decorate it.

## Demo page

Sections, in this order:

| `data-section` | Required | What it holds |
|---|---|---|
| `verdict` | yes | What works, what does not, what the user must decide. |
| `not-verified` | yes | What was not checked, stated plainly. Write "Everything listed was verified." only when that is true. |
| `method` | yes | How it was checked: device, emulator or preview renderer; build variant; stand or backend; system animation scales. |
| `states` | yes | A gallery of labelled states, each a real render or screenshot, with the design reference (for example a Figma export) beside it when one exists. |
| `motion` | no | `<video controls>` with 1× and 0.25× speed buttons, and a strip of key frames. |
| `before-after` | no | The same state before and after, on the same device, when existing UI changed. |
| `findings` | no | Each finding linked to the frame that shows it (`<a href="#state-…">`). |
| `questions` | no | Numbered open questions with lettered options and a recommendation. |

- A real render is a screenshot or recording from the device, emulator or
  stand, or an image from a preview renderer that draws the actual UI code;
  `method` names which. A design export is a reference, never the result.
- Motion is recorded with the system animations on (all scales at 1, read back
  before recording), because a recording with animations off shows no motion.
  Write the scales in `method`.
- When something could not be captured, it goes under `not-verified`; nothing
  is drawn in its place.
