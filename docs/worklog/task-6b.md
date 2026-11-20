# Task 6 finish: F6, quick chips, due tag (2 Nov 2026)

Built on the §9 decisions recorded in `docs/proposals/srs-v1.3-frontend-shapes.md` §10 (resolved for the mock, PROPOSED pending v1.3).

## Built

- **F6 (≤ 360 px column toolbar overflow):** the column title row and the tool group now wrap. Below 640 px the tools take their own row under the title, and the sort and density selects are capped at 8.5em (11em elsewhere), truncating with an ellipsis. `.column` has `min-width: 0`, so nothing pushes the column wider than its slot.
- **Quick chips (FR-UI-021, M):** toggle buttons (`aria-pressed`) under the header for Unread · Due today · Needs my reply · Overdue, plus Handled. They map to `GET /emails?view=…` (AND-combined), which sits first in the query. "Needs my reply" has a tooltip noting it's a demo rule pending team sign-off. Quick views count as "filtered" for the empty state but aren't removable chips (the toggle itself shows the state).
- **Due tag (FR-UI-013, M):** from `EmailListItem.due_date`. One word, no icon: "Overdue", "Due today", "Due tomorrow", "Due Fri", "Due 20 Nov". Red for overdue or today, orange within 3 days, grey later; the word says it too. It's placed right after security (item 4 priority). Overdue and Due today are clickable and apply the matching quick view. The legend shows the three tones.
- **Arrival matcher:** handled mail counts only in the Handled view; due views use `due_date`; needs_reply checks the type (an arrival is unread and inbound by nature).
- **Mock:**
  - `view` param (422 `invalid_parameter` on unknown values).
  - Handled excluded by default.
  - Derived `due_date` on list and detail.
  - Per-user handled map, persisted; `SCHEMA_VERSION` 2.
  - `PATCH /emails/:id {pinned, snoozed_until, handled}` → `EmailDetail`.
  - Unknown sort → 422 `invalid_parameter`.
  - `correction_id` is a UUID.
  - Seed: some older, read emails start handled (chosen by index, so the rest of the seeded mailbox is unchanged).

## Deviations and notes
- The mock's reading of the decisions is listed in proposals §10:
  - `handled: boolean` on the wire;
  - `view=handled`;
  - rejected actions don't count towards `due_date`;
  - local time zone;
  - unknown view → 422.
- Still open: how a read row gets created. Nothing marks mail read yet, so Unread works on the seeded read state.
- Email `pinned`/`snoozed_until` aren't persisted across reloads (emails are regenerated from the seed); handled state is.

## Gate and sizes
- **Gate:** lint and typecheck clean; **126/126 tests** (7 new: views, due_date derivation, PATCH handled, 422s, UUID `correction_id`, due tag, quick-view query and matcher); build OK.
- **Sizes (gzip):**
  - Initial JS **98.37 KB**: boot 2.95, main 78.43, shared 13.84, jsx-runtime 2.72, runtime 0.42.
  - Lazy: Inbox 42.39 (was 41.59), socket.io-client 12.86, More 0.45, Placeholder 0.15.
  - CSS: lock 1.51, main 3.26, Inbox 2.81.
- `dist`: no mock or dev-panel code; `secep.boot` only in the boot chunk.

## Browser checks owed
1. **F6:** at 360 px (and 320 px), no horizontal scroll in the inbox. The tools wrap to a second row; the sort and density selects stay usable; the quick chips wrap.
2. Quick chips:
   - Each toggles (pressed style) and refetches without a skeleton flash.
   - Unread shows only unread.
   - Handled shows the seeded handled emails, and only those.
   - Combining chips narrows the list (AND).
   - With nothing matching, the "Nothing matches" empty state appears with "Clear filters".
3. **Due tags:** red, orange and grey on real cards; clicking "Overdue" / "Due today" presses the chip; the legend lists the tones.
4. **"↑ n new"** with a quick view on: send mail from the dev panel while Handled is on; no pill should appear.
