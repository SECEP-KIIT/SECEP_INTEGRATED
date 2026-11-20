# QA pass 4: F13–F18, desktop (18 Nov 2026)

Phone moves to Version 2, so F12 is deferred. Proposals §17.

## What changed
- **F13 hover lift:** the lifted copy is the card with its tag strip opened to every tag, growing down over the cards below (or moving up near the bottom of the window). The separate tag box is gone. The card in the list still never changes height.
- **F14:** Jira, Calendar, Done and ⋯ in the lift are solid accent buttons (light and dark).
- **F15:** column header on two lines: title, count, ⤢ and ⋯; then filter, sort, density and ?.
- **F16 widget menu:** anchored to the tile and opens beside it (right, or left when there's no room). Quick filters at the top for inbox tiles. Colour and icon show the current choice with an edit icon and open their own picker. Sizes read 1x / 2x / 3x. The filter popover on a tile says "This tile's filter".
- **F17:** sizes 1x / 2x / 3x (labels; the wire values are unchanged).
- **F18 stacking:** `Widget.stacked`. Drop on the lower half of a lone tile ("Stack here"), or use "Stack under the tile before" / "Unstack" in the menu. Pairs are equal halves and move, resize and duplicate together. Mock `PUT` validates the rules (422); store schema 5 → 6 adds `stacked: false`.

## Gate
- lint and typecheck clean; **169/169 tests** (new: stacking rules, the 422s, the v5 → v6 migration).
- Build OK. Initial JS ≈ 101 KB gzipped (budget 200). Dashboard 25.5 KB, InboxHost 48.1 KB (lazy).
- Checked in headless Chromium at 1440 × 900: lift with solid buttons, menu beside the tile, colour picker, stack via the menu, and drag-to-stack with the "Stack here" zone.

## Browser checks owed
1. Hover a card with more than five tags: the strip opens inside the card, every tag is clickable, nothing jumps.
2. Lift near the bottom of a column: the copy moves up instead of going off screen; the bar flips below when there's no room above.
3. Widget menu on the rightmost tile opens to its left; on a 3x tile it still stays reachable.
4. Stack, then reload: the pair is kept. Remove either half: the other returns to full height.
5. Dark mode: the lift buttons and the pickers are readable.
