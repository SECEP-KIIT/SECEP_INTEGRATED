# Task 8a: tiling dashboard: pages, grid, starters, saving (FR-UI-006–008, FR-UI-010; item 2)

Built on the decided §13 shape (proposals §13a). Frontend and mock only. Phone slot **editing** is 8b. In 8a, phones show the saved layout read-only.

## What's in it
- **One breakpoint constant** (`src/lib/breakpoints.ts`): phone ≤ 640, tablet 641–1023, desktop ≥ 1024.
  - The boot chunk sets `<html data-device>`, and every stylesheet selects on it instead of width media queries (the drawer's full screen, the phone shell, the column toolbar).
  - The idle lock and the layout device class read the same constant.
  - A test fails if any CSS file gains a width media query.
- **Mock** `GET`/`PUT /layouts/:deviceClass` (`src/mocks/routes/layouts.ts`), exactly as §13a:
  - starter layout with `is_default`;
  - full replace with a 409 on a stale `base_updated_at`;
  - 422 for an unknown type, the caps, a bad filter (same parser as `GET /emails`), swatch, emoji or position, and phone overlap;
  - owner-only by construction;
  - persisted (store schema 4).
- **Starters as data** (`src/mocks/starters.ts`), built-in widget types only, so tasks 10 and 14 can add Board and Calendar entries:
  - **Today:** Critical + High, Due today, Overdue.
  - **Triage:** Unread, Needs review (`sort=confidence`), Security-flagged.
  - **Planning:** Needs my reply. "Due this week" is parked (proposals §14.1).
- **Saving** (`useLayout`):
  - a local draft and an 800 ms debounced full PUT, one at a time;
  - on a 409 a toast appears and the latest layout reloads;
  - other errors keep the draft and show "Not saved", then go out again with the next change;
  - leaving the page or crossing a breakpoint saves at once.
  - A column's filter, sort and density are saved too: the column is controlled by its widget.
- **Pages** (`/`):
  - only the active page renders, sliding in from its side (transform and opacity; a fade under reduced motion);
  - dots at the bottom centre with name pills on hover or focus, and + for a blank page;
  - Ctrl+←/→ and Ctrl+1…9 (ignored while typing or inside a dialog or popover);
  - trackpad swipe (wheel `deltaX`) and touch swipe, with `overscroll-behavior-x: contain`;
  - in edit mode the page can be renamed, moved left or right, or deleted (one page always stays).
- **Desktop and tablet grid:** react-grid-layout with 12 columns and a row height from the page height.
  - Tiles drag by the title bar and resize from the corner, only in Edit, with a subtle jiggle (none under reduced motion).
  - Done leaves edit mode; saving is continuous.
- **Widget frame:**
  - emoji, title and colour (a tinted header plus a 3 px left stripe), and ⤢ to `/inbox?<filter>`;
  - a menu on ⋯, right-click or long-press: Rename (also double-click), 8 named swatches, emoji icon, Small/Medium/Large, Duplicate, Remove;
  - saved widget types that aren't built yet show a placeholder.
- **Gallery** ("Add widget", edit mode): the inbox column presets, each with a live preview of its first three subjects. Only built types are listed.
- **Phone (read-only in 8a):**
  - 2 × 4 slot pages, with the row height from the available height;
  - 3 rows plus a snap-scroll on short screens;
  - stack columns: one card plus a peek, scrolling inside, with an `n / N` counter;
  - no Edit, no menu, no add-page.
- **Shared plumbing:**
  - `InboxHost` holds one drawer, one legend and one toast stack per page, for both `/` and `/inbox`.
  - Column ids and card subject ids are per instance (the same email can appear in two tiles).
  - "Home" is added to the nav (§14.3).
  - Boot step `layout` now waits for the layout.

## Deviations, flagged
- **§14.1:** "Due this week" isn't built (no query vocabulary).
- **§14.2:** "Needs review" is a sort, not a filter.
- **§14.3:** Home was added to the nav.
- **§14.4:** Ctrl+1…9 may be taken by the browser.
- **No neighbour previews while swiping:** the page changes on release and slides in.
- **`useLayout` isn't unit-tested as a hook** (there's no React test renderer in the stack). Its parts are tested: the PUT/409 contract against the mock, and the pure model.

## Gate
- lint and typecheck clean.
- **151/151 tests** (14 new in `src/dashboard/dashboard.test.ts`, 1 in the contract tests).
- Build OK.
- `dist`: no mock, starter or dev-panel code; one module script, no inline script.

## Sizes (gzip)

| Chunk | KB | Loaded |
| --- | --- | --- |
| index (boot, now with breakpoints) | 3.09 | initial |
| main | 78.61 | initial |
| queries (shared) | 14.55 | initial |
| jsx-runtime | 2.72 | initial |
| rolldown-runtime | 0.42 | initial |
| **Initial JS** | **99.39** | budget 200 |
| **Dashboard** (route `/`, includes react-grid-layout) | **27.60** | lazy |
| of which react-grid-layout | ≈ 24.45 measured standalone (with react-draggable and react-resizable) | — |
| InboxHost (column, cards, filters; shared by `/` and `/inbox`) | 45.43 | lazy |
| Inbox route | 0.30 | lazy |
| EmailDrawer | 6.99 | lazy |
| socket.io-client | 12.86 | lazy |
| CSS: lock / main / InboxHost / Dashboard / drawer | 1.51 / 3.28 / 3.43 / 2.49 / 1.75 | — |

## Browser checks owed
1. **First visit to `/`:**
   - Three starter pages (Today, Triage, Planning) and "Starter layout" in the bar.
   - Today shows Critical + High, Due today and Overdue side by side; each list matches its title.
   - Triage's Needs review lists only needs-review mail, least confident first (`needs_review=true`, task 8c).
   - Planning shows Due this week (`due=next_7_days`), then Needs my reply (task 8c).
2. **Pages:**
   - Hovering the dots shows every page name as a pill, with no layout shift.
   - Clicking a dot, Ctrl+←/→ and (if the browser allows) Ctrl+2 change pages.
   - Two-finger trackpad swipe changes pages and never navigates Back.
   - Keys are ignored while typing in a filter field or with the drawer open.
3. **Edit:**
   - Tiles jiggle (not under reduced motion), drag by the title bar, snap to the grid, and resize from the corner.
   - Cards inside still scroll; dragging a card area doesn't move the tile.
   - "Saving…" then "Saved".
   - Reload: everything is where you left it.
4. **Widget menu** (⋯, right-click the title, double-click to rename):
   - rename;
   - each swatch tints the header and draws the stripe;
   - emoji;
   - Small, Medium and Large;
   - Duplicate places a copy;
   - Remove.
5. **Column state saves:** change a tile's quick chip, sort or density, then reload: kept. ⤢ opens `/inbox` with the same filter and sort.
6. **Gallery:** Add widget shows the presets with three live subjects each; picking one adds the tile.
7. **New page:** + adds a blank page; rename it, move it left or right, delete it; the last page can't be deleted.
8. **Conflict:**
   - Open `/` in two windows and edit in A.
   - Then edit in B: B shows "changed in another window" and reloads A's layout.
9. **Shared widgets:**
   - The drawer, legend (`?`) and toasts work from any tile.
   - The same email in two tiles opens the same drawer.
   - Done in one tile removes it from both.
10. **Tablet (700–1000 px):** the 12-column grid with two tiles per row, not phone slots.
11. **Phone (≤ 640):**
    - slot pages, with the first widget full × 2 and the others full × 1;
    - each column scrolls one card at a time with "n / N";
    - no Edit button;
    - swipe changes pages.
    - **At 360 × 480:** 3 rows visible, the 4th reachable by scrolling, nothing cramped.
12. **Breakpoint edges:**
    - at 640 the drawer is full screen and the phone shell shows;
    - at 641 the tablet grid with the sidebar;
    - phones never idle-lock.
13. **`/inbox`** still works on its own (the sidebar Inbox entry). Home in the sidebar and tab bar opens `/` (§14.3).
