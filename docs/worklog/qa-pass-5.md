# QA pass 5: fixes from the PR #2–#5 browser check (18 Nov 2026)

Proposals §18. On `fix/qa-pass-5`, stacked on PR #5.

## What changed
- **PR #2, edit mode:** while tiles are rearranged, every column's body and tools are `inert`: no hover lift, clicks or keys on cards.
- **PR #3, Ctrl+A:** works with nothing selected. It selects the loaded cards of the column with focus, else the one under the pointer, else the only column. It never selects the page's text over a column.
- **PR #3, Ctrl+Z:** the undo did run, but a restored card was treated as new mail and hidden behind "↑ n new", so nothing seemed to happen. An undo now reloads the list in place. The drawer's Mark handled now goes through the same path, so its toast has Undo (and Ctrl+Z) too.
- **PR #3, See:** the Mark-handled toast reads `See · Undo`. See opens the new fourth starter page, **Handled**, which holds only a full-width Handled column.
- **PR #3, Add to project:** a **Project** button in the hover bar, **Project ▸** in the selection bar, and "Add to project" / "Add all to project" in the right-click menu, plus `p`. A picker shows each project as in all, some or none of the chosen emails. Choosing one adds them all, or removes them all when every one is already in it; the toast has Undo. Cards show their projects as a split dot and a "Name +n" chip.
- **PR #4, credentials:** no Reveal. The drawer lists credential types only, with "Open in Gmail to view". The reveal route is gone from the mock and M6.
- **M6 parity:** `/projects` CRUD and items, `project=` on `/emails` and `/actions`, `projects` on list items, `open_url`, the seeder files demo emails into projects, and the Handled starter page.

## Gate
- Frontend: lint and typecheck clean, **191/191 tests**, build OK. Initial JS ≈ 101 KB gzipped.
- Backend: **13/13 tests** against PostgreSQL 16 + pgvector (new: projects, the filter, `open_url`, no reveal).
- Headless Chromium, mock mode: Ctrl+A over a column selects 20 cards and no text; Project in the hover bar, selection bar and menu; add shows the chip; Done → Ctrl+Z puts the card back; See opens the Handled page with the handled card; edit mode leaves cards inert.
