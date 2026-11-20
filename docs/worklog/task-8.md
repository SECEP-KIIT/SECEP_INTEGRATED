# Task 8: Tiling dashboard (frontend-decisions item 2; FR-UI-006–010): plan

**Status:** decided on 2 Nov 2026 (proposals §13a). Built in 8a (`task-8a.md`) and 8b (`task-8b.md`). The plan below is kept for reference.

## Plan (ready to build once §13 is decided)

### Dependencies
- `react-grid-layout@2.3.0` is in the stack list. Its peers are `react >= 16.3`, so React 18 is fine. It brings react-draggable, react-resizable and fast-equals.
- It loads lazily: only edit mode on desktop imports it.
- dnd-kit isn't needed yet. Phone placement is tap-a-widget, tap-a-slot (FR-UI-009); dnd-kit comes with task 9.

### Pieces
1. **Mock** (`routes/layouts.ts`): `GET` and `PUT /layouts/:deviceClass` exactly as §13.
   - Hand-written validation, starter pages when nothing is saved, 409 on a stale `base_updated_at`, 413 above 64 KB.
   - Persisted per user (layouts are already in the persistence scope, §8).
   - Contract tests.
2. **Model** (`src/dashboard/layoutModel.ts`, pure and unit-tested):
   - the device class from the width;
   - the `EmailFilter` ↔ `ColumnFilters` mapping (the column already builds the same query);
   - widget add, duplicate, remove, rename, colour, icon and resize; page add, rename, reorder and remove;
   - the phone slot packer (2 × 4, ghost slots for free space);
   - the limits.
3. **Saving** (`useLayout`): a query on `/layouts/:class` with optimistic local state and a debounced 800 ms PUT carrying `base_updated_at`. On a 409 it adopts the server copy and shows a toast: "Layout changed in another window".
4. **Pages** (`Dashboard.tsx` at `/`):
   - horizontal pages with `overscroll-behavior-x: contain`;
   - dots that expand to named pills on hover;
   - + adds a page from a starter or blank;
   - Ctrl+←/→ and Ctrl+1…9, ignored while typing or inside dialogs (same rule as F9);
   - trackpad swipe via wheel `deltaX` with a threshold;
   - only the active page renders; neighbours show as light previews during the swipe.
5. **Desktop grid:**
   - outside edit mode, a static CSS grid, with no react-grid-layout loaded;
   - Edit loads react-grid-layout (12 columns, snap, small/medium/large presets) with a subtle jiggle, which is transform only and off under reduced motion;
   - Done saves.
6. **Widget frame:**
   - title bar: icon, title, colour tint plus left stripe, and ⤢ to the full view;
   - ⋯ on hover, right-click or long-press opens a Radix popover menu: Rename (also double-click), Colour (8 named swatches, not colour alone), Icon, Size, Duplicate, Remove;
   - the widget body is lazy per type.
7. **Column as a widget:**
   - `Column` takes `{filters, sort, density}` from its widget and reports changes back for saving;
   - the `col-title` and `card-hint` ids become per-widget;
   - the drawer, toasts and `?` legend move up to the dashboard, shared by all columns.
8. **Phone:**
   - one-screen slot pages of 2 × 4 slots;
   - a column widget shows one card plus a peek, scrolls inside, and has an `n / N` counter;
   - long-press a gap (a 44 px touch zone) to edit: tap a widget, then a ghost slot.
9. **Gallery:** an "+ Add widget" sheet with live previews (a column preview renders three cards from the cache). It lists built types only.

### Tests
- `layoutModel`: packing, limits, the filter mapping;
- the mock contract: shapes, 400/409/413, owner-only;
- `useLayout`: the debounce and adopting the server copy on a 409;
- page keys: Ctrl+n is ignored inside dialogs.

### Chunks
- Dashboard: a lazy route.
- react-grid-layout: lazy, edit mode only.
- Widget bodies: lazy per type.
- Initial JS stays about 99 KB.

## Decisions needed (proposals §13)
1. The shape: as proposed, or with changes.
2. Phone grid: 2 × 4 slots per screen.
3. Starter page contents.
4. Routing: `/` = dashboard, `/inbox` = full view.
5. Tablet breakpoint: 640–1023 px.
