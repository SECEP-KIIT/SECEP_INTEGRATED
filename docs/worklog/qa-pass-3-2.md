# QA pass 3, commit 2: desktop dashboard fixes (3 Nov 2026)

Frontend and mock only. Proposals §16.3.

## What changed
- **Trackpad swipe never goes Back:**
  - `overscroll-behavior-x: none` on `html` and `body` (while the dashboard is shown, via `html:has(.dash)`), on `.dash` and on the pages container;
  - the wheel listener is now native and non-passive, and claims sideways swipes with `preventDefault`.
- **Layout model: an ordered flow** (proposals §16.3, an FR-UI-008 change):
  - Tiles fill rows of 3 slots; small, medium and large take 1, 2 or 3.
  - CSS grid's sparse auto-placement does the flow, and `flow()` in `grid.ts` is the tested model of it. Rows share the page height (at least 300 px each) and are as tall as their tallest tile; more rows scroll.
  - **Dragging** (edit mode, by the title bar; or Space on a focused title bar, then the arrows):
    - the order changes live as you pass tiles, with same-size tiles swapping and other sizes inserting;
    - tiles slide to their new places (transform only; none under reduced motion);
    - a light copy follows the pointer;
    - Esc cancels and restores the order.
  - **Text selection** is off while dragging (`html[data-dragging]`).
  - **Size** in the widget menu: Small (1 slot), Medium (2), Large (3). It always fits now, so the "No room" note is gone. Duplicate places the copy right after the original.
  - **Edit-mode wobble:** 3 px of padding inside the page, so it never overflows into a scrollbar that would narrow the tiles.
- **react-grid-layout → dnd-kit** (`@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0, `@dnd-kit/utilities` 3.2.2, all with React 18 peers). The Dashboard chunk shrank **28.21 → 22.65 KB gzipped (−5.56 KB)**, and its CSS 2.75 → 2.38 KB.
- **Layout format:** the widget has `size` and `hidden` and no positions.
  - The mock store is now schema 5. A version 4 store is migrated (sorted by y, then x; size from width), not discarded.
  - The layouts route validates the new shape.
- **Page names** on hover or focus: all pills side by side in page order above the dots, the current one marked with a dot. They're clickable, and the dots stay the keyboard route.
- **Page ← →** in edit mode: you stay on the moved page, and its dot moves with it. ← is disabled on the first page, → on the last.
- **Delete page** shows "Deleted page "…". Undo" for 10 s (the FR-UI-029 pattern). Undo puts it back in its place and shows it.
  - Toasts can now carry one action button; `UNDO_MS` is 10 s.
- **Esc goes to the topmost layer wherever focus is:**
  - Focus mode's F and Esc, and the page keys, ignore keys while any dialog or popover is open (`anyLayerOpen`), not only when focus is inside one.
  - The drawer keeps focus: when the focused button disappears or is replaced, focus moves to the drawer title instead of dropping to `<body>`.

## Deviation, flagged
- **The phone format changed here, not in commit 4.** Both device classes share one widget shape and one migration, so the 8b slot editor (long-press gap, ghost slots, 2 × 4 rows) and its code were removed in this commit.
- **Between commits 2 and 4, phones are read-only:** each widget is a 300 px section in one vertical scroll, with no Edit button (the ⋯ menu still works).
- Commit 4 builds the sections view and the edit sheet.

## Gate
- lint and typecheck clean.
- **163/163 tests**. Changed or new:
  - the flow rows;
  - reorder (swap, insert, own place);
  - add and duplicate in order, with the cap;
  - delete and undo;
  - the v4 → v5 migration, including `load()` migrating instead of discarding;
  - starters in order with sizes;
  - 422 for a bad size, bad hidden and the old `x`;
  - Esc with focus on `<body>` while a layer is open.
- Build OK.
- `dist`: no mock code, one module script.
- **Headless Chrome, 1400 × 900:**
  - Today shows three equal tiles in one row;
  - dragging the first tile across makes two live swaps, saves, and selection is off during the drag;
  - pills sit side by side;
  - moving a page right keeps it shown with dot 2 current;
  - delete then Undo restores the page;
  - Focus mode, drawer, "Mark unread", Esc: the drawer closes, Focus mode stays; the next Esc leaves Focus mode.

## Sizes (gzip)

| Chunk | KB | Loaded |
| --- | --- | --- |
| index (boot) | 3.09 | initial |
| main | 78.68 | initial |
| queries (shared) | 14.95 | initial |
| jsx-runtime | 2.72 | initial |
| rolldown-runtime | 0.42 | initial |
| **Initial JS** | **99.86** | budget 200 |
| **Dashboard** (dnd-kit; was 28.21 with react-grid-layout) | **22.65** | lazy |
| InboxHost | 45.70 | lazy |
| EmailDrawer | 7.18 | lazy |
| socket.io-client | 12.86 | lazy |
| CSS: lock / main / InboxHost / Dashboard / drawer | 1.51 / 3.28 / 3.46 / 2.38 / 1.75 | — |

## Browser checks owed (desktop; tablet where noted)
1. **Windows precision touchpad, Chrome:** a two-finger swipe right on `/` changes page and never goes Back, including at the first page.
2. **Flow:**
   - Today is three tiles in one row;
   - set one to Medium: it takes two slots and the third tile moves to the next row, which shares the height;
   - Large takes a whole row.
3. **Drag in Edit:**
   - by the title bar, tiles reorder live, and same-size tiles swap;
   - dropping a Large tile before small ones pushes them down;
   - no text gets selected;
   - Esc mid-drag restores the order;
   - reload: the order is kept.
4. **Keyboard drag:** Tab to a title bar in Edit, Space, arrows, Space to drop (Esc cancels).
5. **Saved layouts from before** (persisted store schema 4) appear in the same top-to-bottom, left-to-right order, not reset.
6. **Pills:** hover the dots: all names side by side, none overlapping, the current one marked; click a name to go there.
7. **Page arrows:** Move right keeps you on the page and its dot moves; ← is disabled on the first page, → on the last.
8. **Delete page:** the toast offers Undo for about 10 s; Undo brings the page back in place.
9. **Esc order:**
   - Focus mode on, open a card, press Send to Jira or Add to calendar in the drawer;
   - Esc closes the drawer first and Focus mode stays on; Esc again leaves Focus mode;
   - focus never lands on the page behind while the drawer is open.
10. **Tablet (700–1000 px):** the same 3-slot rows, narrower.

Replaces task-8a checks 3, 4 (Size), 10 and 11, and all of task 8b (the phone slot editor is gone).
