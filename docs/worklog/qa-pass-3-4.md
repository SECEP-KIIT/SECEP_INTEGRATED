# QA pass 3, commit 4: phone option A (3 Nov 2026)

Frontend and mock only. Proposals §16.4 (FR-UI-009) and §16.5 (FR-WP-003). Phone layouts already store order and `hidden` since commit 2 (§16.3), so there's no new wire change.

## What changed
- **Phone home = sections in one vertical scroll** (`PhonePage`, `PhoneSection`).
  - Each widget is a section: title bar (icon, name, ⋯ menu), count, its top 3 cards, and "See all n →" to `/inbox` with its filter and sort. Nothing scrolls inside a section.
  - "↑ n new" works per section; the pill logic is now `useNewPill`, shared with the column.
  - Tapping a type or tag on a section card opens the full column with that filter added.
  - Hidden widgets are left out.
- **Segmented page switcher** (Today | Triage | Planning | +) replaces the dots and the swipe on phone. The pressed page is filled and bold, and the switcher scrolls sideways when names don't fit. There's no horizontal swipe on phone; tablets keep theirs.
- **One slim header row:** switcher plus Edit. The separate title and "Starter layout" row is gone; the save state shows in the sheet.
- **Edit sheet** (`PhoneEditSheet`, a native modal `<dialog>` at the bottom) has:
  - the page name;
  - the sections, each with a drag handle (dnd-kit; touch, mouse or keyboard) and a Shown/Hidden switch, the state written out;
  - Add widget (the gallery opens over the sheet);
  - Delete page, which closes the sheet and offers the 10 s undo.
- **Touch card actions:** no hover bar.
  - A tap opens the drawer.
  - A **long-press** (500 ms; moving 10 px first is a scroll) opens an action sheet: Send to Jira, Add to calendar, Done, Pin, Open, Cancel. The tap that ends the press is swallowed.
  - The browser's own long-press callout and text selection are off on touch cards.
  - The logic is shared with the hover bar (`useQuickActions`); Pin is `PATCH /emails/:id {pinned}`.
- **Lock screen on phone:** the Loading box is bottom centre, 32 px above the bottom (plus the safe area), not right middle. Desktop is unchanged.
- **Removed:** the column's `stack` variant and its n / N counter. Phones use sections now.
- **Fixed on the way:** the topbar sync indicator updated its state while another component rendered, which React warned about when sections mounted on a page switch. It now defers the update.

## Gate
- lint and typecheck clean.
- **166/166 tests** (new: the phone sheet's `moveWidget`).
- Build OK.
- `dist`: no mock code, one module script.
- **Headless Chrome, 360 × 740, touch, `hover: none`:**
  - the lock Loading box is bottom centre, 32 px up;
  - one header row with Today* | Triage | Planning | +, and no dots;
  - Today has 3 sections (3, 1 and 3 cards), none scrolling inside, and See all links to `/inbox?urgency=Critical,High` etc.;
  - tapping Triage switches;
  - a long-press opens the action sheet with the five actions, and it stays open after release;
  - a tap opens the drawer;
  - Edit lists the 3 sections; hiding one removes it from the page; dragging the first row's handle below the third reorders, and the sheet says "Saved".

## Sizes (gzip)

| Chunk | KB | Loaded |
| --- | --- | --- |
| index (boot) | 3.09 | initial |
| main | 78.70 | initial |
| queries (shared) | 14.95 | initial |
| jsx-runtime | 2.72 | initial |
| rolldown-runtime | 0.42 | initial |
| **Initial JS** | **99.88** | budget 200 |
| Dashboard (sections, sheet) | 24.41 | lazy |
| InboxHost (touch menu) | 48.02 | lazy |
| EmailDrawer | 6.99 | lazy |
| socket.io-client | 12.86 | lazy |
| CSS: lock / main / InboxHost / Dashboard / drawer | 1.57 / 3.28 / 3.56 / 3.10 / 1.75 | — |

## Browser checks owed (phone ≤ 640 px; a real phone if possible)
1. **Lock screen:** tap during boot; the Loading box is bottom centre above the home indicator and doesn't cover the notifications.
2. **Header:** one row, the switcher and Edit; no dots, no "Starter layout" row. Tap each page; + adds one. With many pages the switcher scrolls sideways and keeps the current page in view.
3. **No sideways swipe** on the phone dashboard; vertical scrolling of the sections works.
4. **Sections:**
   - title, count, three cards, "See all n →" (opens `/inbox` with the same filter and sort);
   - no scrolling inside a section;
   - "Send one email" from the dev panel shows "↑ 1 new" on a matching section, and tapping it brings the card in.
5. **Cards:**
   - a tap opens the drawer;
   - a long-press opens the action menu (Jira, Calendar, Done, Pin, Open) with no browser callout or text selection;
   - the menu stays open after lifting the finger;
   - each action works, and Cancel or tapping outside closes it;
   - a scroll that starts on a card never opens the menu.
6. **Edit sheet:**
   - rename the page;
   - drag a section by its handle, and the page order follows;
   - switch one to Hidden, and it disappears from the page;
   - Add widget opens the gallery over the sheet;
   - Delete page shows the undo toast after the sheet closes;
   - Done closes the sheet;
   - reload: everything kept.
7. **Phone and desktop layouts stay separate** (edit on phone, then check desktop).
8. **Tablet (641–1023):** still the desktop tiles with the hover lift (with a mouse); on touch, the long-press menu.

Replaces task-8a check 11 (phone slots) and the commit 2 interim phone note.
