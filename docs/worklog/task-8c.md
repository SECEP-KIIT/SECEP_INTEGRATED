# Task 8c: decisions on proposals §14 (2 Nov 2026)

One small commit, recorded in proposals §15. Frontend and mock only.

## What changed
- **`due` filter** (`GET /emails?due=overdue|today|next_7_days|later|none`):
  - one rule in `src/lib/due.ts`, used by the mock's list and the client's arrival matcher;
  - `next_7_days` is a rolling 7 days starting today, in the local date;
  - a Due group in the filter popover, with Due chips;
  - the Planning starter gains "Due this week" (`due=next_7_days`), and the gallery has it too.
- **`needs_review=true|false` filter:**
  - a "Review" checkbox in the popover, plus a chip;
  - the Triage "Needs review" starter is now `needs_review=true`, least-confident first.
- **Phone tab bar:** Home, Inbox, Board, Security, More. Calendar moves under More until task 14 (`nav.ts` `phoneTabs` / `moreNav`).
- **Short phones:** 3 rows plus a scroll only when the screen is under 600 px tall; otherwise 4 rows with no scroll (the FR-UI-009 exception, §15.6).
- **Over-limit saves:** already 422 with `details.fields`, never trimmed (§15.5); the tests cover 25 widgets and 10 pages.

Saved layouts and existing columns keep working: an older starter's "Needs review" (an empty filter, `sort=confidence`) stays as saved. Only the default layout changes.

## Gate
- lint and typecheck clean.
- **155/155 tests**. New:
  - due buckets, including the month and year rollover;
  - `GET /emails` `due` and `needs_review`, OR within and AND across, with 400s;
  - the filter round trip;
  - the starters;
  - the phone tabs;
  - the 600 px rule.
- Build OK.
- `dist`: no mock code, one module script.

## Sizes (gzip)

| Chunk | KB | Loaded |
| --- | --- | --- |
| index (boot) | 3.09 | initial |
| main | 78.63 | initial |
| queries (shared) | 14.54 | initial |
| jsx-runtime | 2.72 | initial |
| rolldown-runtime | 0.42 | initial |
| **Initial JS** | **99.40** | budget 200 |
| Dashboard (with react-grid-layout) | 28.20 | lazy |
| InboxHost | 45.80 | lazy |
| EmailDrawer | 6.99 | lazy |
| socket.io-client | 12.86 | lazy |
| CSS: lock / main / InboxHost / Dashboard / drawer | 1.51 / 3.28 / 3.43 / 2.75 / 1.75 | — |

## Browser checks owed
1. **Filter popover:**
   - Due has Overdue, Today, Next 7 days, Later and No due date; ticking two shows both (OR); each adds a "Due: …" chip.
   - "Needs review" in the Review group shows only dotted-chip (needs-review) cards and adds a chip.
   - Clear all resets both.
2. **Planning page:** "Due this week" lists only cards with due tags from today to six days ahead; "Needs my reply" follows. Use Reset store in the dev panel if a layout was already saved.
3. **Triage "Needs review":** every card has the dotted type chip, least confident first.
4. **Phone tab bar:**
   - Home, Inbox, Board, Security (with security.review), More.
   - More lists Calendar, plus Metrics and Admin for admins.
5. **Phone height:**
   - 360 × 599: 3 rows with the 4th scrolling.
   - 360 × 600 and 360 × 740: 4 rows, no vertical scroll.

These checks replace task-8a check 1 (Needs review and Planning contents) and the 360 × 740 part of task-8b check 8. The rest of the 8a and 8b lists stand.
