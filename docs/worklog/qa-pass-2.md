# QA pass 2: fixes from the task 6–7 browser pass (2 Nov 2026)

Frontend and mock only. The decisions are in proposals §12: §10 approved with the owner-only condition, §11.1 composer assignee, and read-marking. Read-marking is its own commit (`qa-pass-2-read.md`).

## Fixes

| # | Finding | Fix |
| --- | --- | --- |
| F7 | Phone toolbar too wide | ≤639 px: sort and density are icon-only. The native `<select>` sits invisible over the icon, so it stays focusable and is announced. A dot marks a non-default choice (a shape, not colour alone); the filter keeps its count badge. Quick chips are one row that scrolls sideways. |
| F8 | "Clear all" at the bottom of the filter popover | Moved to a header row at the top: "Filters · n active" plus Clear all. |
| F9 | Esc left Focus mode before closing the drawer | `focusKeyAction` ignores keys whose target is inside an open `<dialog>` or a Radix popover. The first Esc closes the layer; a second Esc, with nothing open, leaves Focus mode. F inside the drawer no longer toggles Focus mode behind it. |
| F10 | Drawer not full screen on phones | **Root cause:** the UA stylesheet caps a modal dialog at `max-width: calc(100% - 2em - 6px)`, which beat `width: 100vw`. Fixed with `max-width: none`; the breakpoint is now `max-width: 640px` (≤640, as asked). |
| F11 | Done / Restore applied inconsistently | **Root cause:** a client cache bug, not a DB gap. See below. |
| Seed | Links | New email "Links for this week's planning" (unread, 3 h old) with one link for each click-time outcome. See below. |
| Seed | Times | See below. |
| §12.2 | Composer assignee | The Jira composer shows a read-only "Assignee: you". The mock's simulated Jira is called with the caller as assignee. No wire change. The project and epic prefill waits for task 10. |

### F11 in detail

`updateEmail` removed the email from lists it no longer matched, but did nothing for lists it **newly** matched. Email lists never refetch on their own (`staleTime: Infinity`, so new mail can't jump in under the cursor). A Handled view loaded earlier therefore stayed without the email after Done, and the inbox stayed without it after Restore. Whether it reappeared depended on whether the socket echo (`email.triaged`) arrived before or after the HTTP response: the echo made it an "arrival" only when no cache held the email.

**The fix** (`settleLists` in `src/api/queries.ts`) decides from the PATCH response alone. For each cached list:
- **The email no longer belongs there:** it is removed.
- **It newly belongs there:**
  - if that list is **on screen** (has observers), the email is counted in "↑ n new" through `signalArrival`, never inserted;
  - if the list is **off screen**, it is marked stale (`invalidateQueries`, `refetchType: 'none'`), so it reloads the next time it's shown.

The socket echo can no longer change the outcome. After the PATCH, the detail cache always holds the email, so the echo patches in place and never adds an arrival.

**Focus:** if the drawer's own Mark handled removed the card it was opened from, closing the drawer moves focus to that column's title instead of losing it to `<body>`.

**Tests:**
- New: `actions.test.ts` "Done then Restore is deterministic across repeated toggles". It fails on the old code.
- Rewritten: the first handled test now checks that the off-screen view is invalidated and that the on-screen inbox gets a pill.

### Link samples

| Link | Outcome |
| --- | --- |
| Sprint board | clean → opens |
| Shared slides | delivered clean; the click-time resolver now finds a suspicious redirect → interstitial |
| Vendor portal | suspicious → interstitial with the inline warning |
| Invoice viewer | malicious → blocked |
| Last year's archive | clean, but the check takes 6 s |

The click-time verdict and the delay are mock-only row fields (`click_verdict`, `click_delay_ms`); neither is on the wire.

**Client side of the slow check (proposals §11.2):** after the check, if `navigator.userActivation.isActive` is false (the click's popup window has passed), the link doesn't call `window.open`, which would be silently blocked. It shows "Checked: clean. **Open it now**" for a fresh click instead.

### Action times

`ActionSpec` gains:
- `startAt { day: 'same' | weekday, hour, minute }`: local wall-clock time, moved a day or a week later if already past at arrival;
- `dueOn` (a weekday).

Results:
- "3 pm today" → 15:00 that day; "Thu 11:00" → Thursday 11:00; "Mon 10:00" → Monday 10:00.
- "by Friday" and "before Wednesday" get those weekdays.
- Due dates are now local dates (they were UTC slices).

**Persistence:** the mock store's `SCHEMA_VERSION` went from 2 to 3, so old snapshots are discarded and reseeded once.

## Gate
- lint and typecheck clean.
- **135/135 tests** (4 new: the F9 key rule, F11 determinism, link samples, event times).
- Build OK.
- `dist`: no mock or dev-panel code; one module script, no inline script.

## Sizes (gzip)

| Chunk | KB | Loaded |
| --- | --- | --- |
| index (boot) | 2.95 | initial |
| main | 78.59 | initial |
| queries (shared) | 14.47 | initial |
| jsx-runtime | 2.72 | initial |
| rolldown-runtime | 0.42 | initial |
| **Initial JS** | **99.15** | budget 200 |
| Inbox | 44.70 | lazy |
| EmailDrawer | 6.80 | lazy |
| socket.io-client | 12.86 | lazy |
| More / Placeholder | 0.45 / 0.15 | lazy |
| CSS: lock / main / Inbox / drawer | 1.51 / 3.26 / 3.40 / 1.75 | — |

## Browser checks owed
1. **F7 at 360 and 320 px:**
   - Sort, density, filter and legend are four icons on the title row, with no horizontal page scroll.
   - Tapping sort or density opens the native picker.
   - A non-default sort or density shows a dot; filters show a count.
   - The quick chips scroll sideways in one row.
2. **F8:** Clear all is at the top of the filter popover and is disabled with no filters.
3. **F9:**
   - With Focus mode on, open the drawer: the first Esc closes the drawer and Focus mode stays on; the second Esc leaves Focus mode.
   - The same with the filter popover open, and with the `?` legend.
4. **F10 at ≤640 px:** the drawer covers the whole screen, with no inbox visible at the edges. At 641 px and wider it's the side panel.
5. **F11:**
   - Repeat Done, then the Handled chip, then Restore, then the Handled chip off, several times: the email is always where it should be.
   - In the drawer, Mark handled, then close: focus lands on the column title.
6. **Links**, in "Links for this week's planning":
   - each of the four outcomes;
   - the archive link: after about 6 s you get "Checked: clean. Open it now", and clicking it opens a tab;
   - Shared slides shows "Checked: clean" in the list but an interstitial on click.
7. **Times:**
   - The "Quick call today about the renewal?" event starts at 15:00.
   - The design review starts Thursday 11:00; the weekly sync, Monday 10:00.
   - The board deck's due date is a Friday.
   - Reset the store first if a snapshot from before this change is loaded (the schema bump does it automatically).
8. **Composer** (Shift+click Jira) shows "Assignee: you".
