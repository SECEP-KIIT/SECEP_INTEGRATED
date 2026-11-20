# QA pass 3, commit 3: narrow columns and the hover lift (3 Nov 2026)

Frontend only, with no API or SRS change. The card layers of frontend-decisions item 3 change: the tag popover is replaced by the lift.

## What changed
- **Compact toolbar for narrow columns, by the column's own width.**
  - `.column` is a size container, and `@container column (max-width: 480px)` switches the toolbar on any column under 480 px: dashboard tiles, phone, a narrow tablet.
  - The breakpoint test forbids only media queries on screen width; this is a container query on the column, and a comment in `inbox.css` says so.
  - It replaces the phone-only F7 rules. Sort and density are icons, with a dot when not at their default. The filter shows its count, and the title row stays on one line (the title truncates first).
- **Tiles are saved filters:**
  - no quick chips and no active-filter chips;
  - the filter button becomes a badge counting the whole saved filter, quick views included, with it written out in the tooltip ("Filter: Urgency: Critical, Urgency: High");
  - the chip rows stay in the ⤢ full view (`Column variant="tile"`).
- **Hover lift** (`src/inbox/CardLift.tsx`, one per inbox page):
  - **What shows:** on hover after 150 ms, or keyboard focus on a card, a floating copy of the card lifts, in a portal on `<body>`. Jira · Calendar · Done · ⋯ sits above it and the full tag list below it.
  - **No layout shift:** the copy covers neighbouring cards and never pushes them; the card in the list never changes height (NFR-PERF-011).
  - **Placement:** the portal is outside the virtual list's scroller, so nothing clips it. The bar goes below the card, or the tags above it, when there's no room (`placeLift`).
  - **Pointer:** the raised copy lets the pointer through, so clicks and wheel scrolling still reach the real card and its column. A scroll or resize drops the lift.
  - **Keyboard:** Tab from a focused card goes into the bar, then the tags; Tab past them continues with the card's own buttons; Shift+Tab returns to the card; Esc closes the lift.
  - **Never on touch:** it needs `(hover: hover) and (pointer: fine)` and a mouse pointer.
  - It **replaces the separate tag popover** and the old in-card action overlay. Live updates show in an open lift.
  - The card's content is now `CardBody`, shared by the card and its copy.

## Interpretation, flagged
- **The tile's filter badge still opens the filter popover,** so a tile's saved filter stays editable where it is. Without that, a tile's filter could only be changed by removing the tile and adding a new one: ⤢ opens `/inbox`, which doesn't save back to the tile.
  - "Clear all" in a tile clears the quick view too, consistent with the badge count.
  - Say if the badge should be read-only instead.
- **Touch has no quick actions** between this commit and commit 4, which adds the long-press menu. A tap still opens the drawer.

## Gate
- lint and typecheck clean.
- **165/165 tests**. New: lift placement flips; the tile filter summary.
- Build OK.
- `dist`: no mock code, one module script.
- **Headless Chrome, 1400 × 900:**
  - tiles have no chip rows; selects are 30 px icons; badges read "Filter: Due today" (count 1) and "Filter: Urgency: Critical, Urgency: High" (count 2); title rows are one line;
  - hover: no lift at 80 ms, lifted by 330 ms, bar above, tags below, card heights unchanged;
  - moving onto the bar keeps it, and leaving drops it;
  - a wheel over the lift scrolls the column 200 px and drops it;
  - Tab: card → Jira → Calendar → Done → ⋯ → tags;
  - with `hover: none` and `pointer: coarse` emulated, no lift.

## Sizes (gzip)

| Chunk | KB | Loaded |
| --- | --- | --- |
| index (boot) | 3.09 | initial |
| main | 78.68 | initial |
| queries (shared) | 14.95 | initial |
| jsx-runtime | 2.72 | initial |
| rolldown-runtime | 0.42 | initial |
| **Initial JS** | **99.86** | budget 200 |
| Dashboard | 22.65 | lazy |
| InboxHost (with the lift, +1.59) | 47.29 | lazy |
| EmailDrawer | 7.19 | lazy |
| socket.io-client | 12.86 | lazy |
| CSS: lock / main / InboxHost / Dashboard / drawer | 1.51 / 3.28 / 3.52 / 2.38 / 1.75 | — |

## Browser checks owed
1. **Compact toolbar:**
   - small tiles on `/` show icon-only tools on one row, with a dot on Sort or Density when changed;
   - resizing a tile to Large brings the labelled selects back (the container is over 480 px);
   - `/inbox` on a wide window keeps the full toolbar and the chip rows.
2. **Tile badge:** the count covers quick views (Due today shows 1); the tooltip lists the filter; clicking opens the popover; changes save to the tile.
3. **Hover lift (mouse):**
   - after a short pause the card lifts, with the bar above and every tag below;
   - neighbours are covered, not moved; nothing jumps in the list;
   - clicking the raised card opens the drawer;
   - the wheel scrolls the column;
   - Jira, Calendar and Done work from the bar, and Done fades the card out;
   - at the top of a column the bar goes below the card; near the bottom of the window the tags go above.
4. **Keyboard:** Tab onto a card lifts it; Tab enters the bar, then the tags; Tab again continues; Shift+Tab goes back to the card; Esc closes the lift.
5. **Touch** (DevTools touch emulation or a real tablet): no lift and no bar; a tap opens the drawer.
6. **The old tag popover is gone:** hovering the tag strip shows nothing extra apart from the lift.

Replaces task-6 checks on the hover action overlay and the tag popover.
