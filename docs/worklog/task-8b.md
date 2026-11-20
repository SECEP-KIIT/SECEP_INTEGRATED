# Task 8b: phone slot editing (FR-UI-009; item 2)

8b is finished, so phones are no longer read-only: the 8a `readOnly` fallback has been removed. Frontend only; no API change (phone layouts already used the §13a slot units).

## What's in it
- **Entering edit mode:**
  - **Long-press a gap** (500 ms): anywhere outside a widget, or within 16 px of a widget's edge. With the 12 px gap that's a ~44 px touch zone. Moving more than 10 px cancels it, so scrolling never triggers it.
  - **Edit** in the page bar does the same. It's the discoverable and keyboard/screen-reader route.
- **Moving a widget:**
  - Tap a widget to pick it. Its body becomes a pick button, so cards don't open while editing, and the title bar keeps its ⋯ menu.
  - The picked widget gets a thick outline and a ✓ badge.
  - **Ghost outlines** sized to it show every place it fits (`ghostSlots`: excluding its current place, never overlapping each other or other widgets). Tap one to move it there.
  - Tapping empty space deselects.
- **Widget menu on phones:**
  - Rename, colour, icon, Duplicate, Remove.
  - **Size** (half × 1 / full × 1 / full × 2) stays in place if it fits, else moves to the first slot that fits, else "No room for that size on this page".
  - Long-press on the title bar opens it outside edit mode too (FR-UI-008).
- **Pages on phones:** Add widget (gallery; first free slot, or "This page is full") and + page.
- **Short screens:** 4 rows when each gets ≥ 110 px, otherwise 3 rows that exactly fill the screen, with row 4 one snap-scroll below.
  - At 360 × 480 that's 3 rows of about 86 px.
  - The phone dashboard chrome is tighter (page bar 28 px, dots 24 px, 8 px padding) to give the slots more room.
- **Motion:** the same subtle jiggle (none under reduced motion); ghosts fade in.

## Gate
- lint and typecheck clean.
- **152/152 tests** (1 new: ghost slots; the row rule test is updated for 360 × 480 and 360 × 740).
- Build OK.
- `dist`: no mock code.

## Sizes (gzip)

| Chunk | KB | Loaded |
| --- | --- | --- |
| index (boot) | 3.09 | initial |
| main | 78.60 | initial |
| queries (shared) | 14.55 | initial |
| jsx-runtime | 2.72 | initial |
| rolldown-runtime | 0.42 | initial |
| **Initial JS** | **99.38** | budget 200 |
| Dashboard (includes react-grid-layout, about 24.45 standalone) | 28.19 | lazy |
| InboxHost | 45.43 | lazy |
| EmailDrawer | 6.99 | lazy |
| socket.io-client | 12.86 | lazy |
| CSS: lock / main / InboxHost / Dashboard / drawer | 1.51 / 3.28 / 3.43 / 2.75 / 1.75 | — |

## Browser checks owed (phone, ≤ 640 px, touch emulation on)
1. **Long-press:** in the gap between two widgets it enters edit mode (jiggle, Done button). Long-pressing inside a card or scrolling a column doesn't.
2. **Picking:**
   - Tap a widget: outline and ✓; ghost outlines of the same size appear wherever it fits, never overlapping.
   - Tap a ghost: it moves there and "Saving…" → "Saved".
   - Reload: it's kept.
3. **Taps while editing:**
   - A tap on a picked widget's body doesn't open a card.
   - Tapping empty space deselects.
   - Done leaves edit mode.
4. **Size from ⋯:**
   - Large on a full page says "No room".
   - Medium → Large where there's room grows in place or moves to the first fit.
5. **Add widget** on a phone page with space places it; on a full page it says "This page is full". + adds a page.
6. **Long-press on a title bar** (outside edit mode) opens the widget menu.
7. **360 × 480:**
   - 3 rows visible, the 4th reachable by one snap-scroll;
   - the large widget shows its title plus at least one card;
   - nothing overlaps the tab bar.
8. **360 × 600 and 360 × 740:** 4 rows, no scroll. Below 600 px tall: 3 rows plus a scroll (task 8c, proposals §15.6).
9. **Phone and desktop layouts stay separate:** edit on the phone, then open on desktop; the desktop layout is unchanged.
