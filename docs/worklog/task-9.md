# Task 9: interactions (18 Nov 2026), desktop

Item 8 / FR-UI-027–029. Phone work is Version 2.

## Built
- **Selection:**
  - Ctrl/⌘+click toggles a card; Shift+click selects the range in that column; Ctrl/⌘+A selects every loaded card in the focused column; `x` toggles the focused card; Esc clears (before Focus mode sees it).
  - Selected cards get an accent outline and a check circle. Height is unchanged. The same email in two columns shows selected in both.
- **Topbar contextual mode:** with a selection, the search pill becomes `N selected · Jira · Calendar · Done · ✕`. Jira and Calendar make **separate** issues or events (the default); emails with nothing to send as is are skipped and counted.
- **Right-click menu:** one per page, opened at the pointer (Shift+F10 or the menu key at the card). Single card: Open, Jira, Calendar, handled/restore, Pin, read/unread, Select, Copy summary, with shortcuts on the right. On a card in a multi-selection: the bulk menu. Links keep the browser's menu. Arrow keys, Home and End move between items.
- **Card keys:** `j`/`k` (and ↓/↑) move focus within the column, `e` handled, ⇧J Jira, ⇧C Calendar, Ctrl/⌘+C copies "subject — summary" (already masked).
- **Undo (FR-UI-029):** Jira and Calendar sends execute immediately; the toast has Undo for ~10 s, and so does Ctrl/⌘+Z (the latest undo still on screen). Undo calls `POST /actions/:id/undo` (SRS §6.5), which deletes the issue or event, puts the action back to proposed and off the board, and audits `action.undo`. Done/Restore (single and bulk) also have Undo.
- **Mock:** the undo route with a 12 s server window (`actions.undo_until`, §6.6 v1.1; not on the wire), 409 after it.

## Not built (named)
- Dragging cards (onto board columns, sidebar projects, the calendar): comes with task 10 / 14, where the targets exist.
- Marquee selection, paste-to-create (task 12), `p` / `h` / `n` / `g c` (tasks 10, 13, 12, 14), the "one issue linking all" bulk mode, and right-click menus on column headers, tags and empty space.

## Gate
- lint and typecheck clean; **173/173 tests** (new: ranges, key map, undo round trip and window).
- Checked in headless Chromium: Ctrl/Shift selection, the topbar bar, the bulk and single menus, Send to Jira → toast → Ctrl+Z → "Deleted from Jira", Esc clears.

## Browser checks owed
1. `j`/`k` past the visible rows scrolls the column.
2. Ctrl+A inside a tile, then Done in the topbar: all leave with one Undo.
3. Shift+F10 on a focused card opens the menu next to it.
4. Dark mode: the selection outline, the check circle and the topbar bar.
