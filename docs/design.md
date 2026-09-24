# Design notes

The hub is a daily notebook for a UIT student: its first job is to say what to do first given the free time
left. The visual language borrows from the Vietnamese school notebook (*vở ô li*) and its purple fountain-pen
ink (*mực tím*); dark mode is the green classroom board (*bảng đen*).

## Tokens (`apps/web/app/globals.css`)

| Role | Light | Dark | Meaning |
|---|---|---|---|
| `bg` paper | `#f6f7fb` | `#18211d` | the page |
| `surface` sheet | `#ffffff` | `#1f2a25` | sections laid on the page |
| `border` ruling | `#dadcee` | `#34433b` | lines and outlines |
| `text` graphite / chalk | `#1c1e2b` | `#e7ece4` | body |
| `accent` ink | `#3a2e9c` | `#b4a6ff` | links, primary actions, focus, the current page |
| `danger` red pen | `#c0342e` | `#ff8a80` | overdue, urgent, destructive — nothing else |
| `warn` / `highlight` | `#8a5a00` / `#ffe36e` | `#f2d46e` / `#6b5a1a` | "coming up", search matches |
| `ok` | `#1e7a57` | `#7ed0a2` | done, everyone free |
| `margin` | `#ebb1ae` | `#7a3f3b` | the notebook's red margin line |

Colour always means something; decorative colour comes only from the user's own course/project colours.

## Type

- **Be Vietnam Pro** (400–700) for the whole interface: drawn for Vietnamese diacritics. Body 15px with
  1.55 line height so stacked marks do not collide; page titles 26px semibold; section titles 15–19px.
- **Playwrite VN** (300), TypeTogether's model of Vietnamese school handwriting, only for the Today date line
  and the wordmark. Nowhere else.
- Monospace only for things that are literally code (commands, pairing codes, links to copy).

## Structure

- One signature element: the Today page head, the date written in ink over faint ô-li ruling. The red
  margin line between the index and the page is the only other literal notebook reference.
- The main task list on Today is written directly on the page (ruled rows, a red-pen or highlighter stroke
  for urgency); supporting information sits on sheets (`Card`). Radii follow hierarchy: sheets 16px,
  controls 8px, badges 5px.
- The calendar is a *thời khóa biểu*: a time grid with UIT periods (tiết) marked in the gutter, drawn in SVG
  because the CSP forbids inline styles. Phones get a per-day list instead.
- No "A · B · C" chains: secondary facts go through `<Meta>` (spaced) or plain commas. No all-caps labels.
- Motion: one ink-in reveal of the date line; `prefers-reduced-motion` turns it off.

## Copy

Sentence case, plain verbs, the user's words ("share my free/busy", not "enable availability export").
Empty states say what to do next. Errors say what happened and how to fix it.
