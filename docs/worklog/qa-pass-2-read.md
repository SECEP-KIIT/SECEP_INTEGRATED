# QA pass 2b: read-marking (proposals §12.3, 2 Nov 2026)

PROPOSED, per recipient, like handled. Frontend and mock only.

## What changed

- **Wire:**
  - `EmailListItem.read: boolean` (so also on `EmailDetail`), computed for the caller from the per-user read set (`email_reads` in M6, §1).
  - `PATCH /emails/:id { read: true | false }`. It is owner-only: `own()` returns 404 for anyone else (§12.1), and it changes only the caller's read state. The response is the updated `EmailDetail`; the socket echo is `email.triaged`.
  - Contract tests pin the new key and check: 422 on a non-boolean, 404 for another user, `view=unread` and `glance.inbox_unread` follow.
- **Opening marks read:** `DrawerBody` sends one `PATCH { read: true }` per open, only if the email is unread. A manual choice made during the same open wins: Mark unread isn't overridden. A failure is silent.
- **Manual toggle:** a "Mark unread" / "Mark read" button in the drawer header, next to Pin and Mark handled.
- **Lists:**
  - `settleLists` (from the F11 fix) now applies the Unread view's rule too.
  - Reading removes the email from an Unread list. Marking it unread counts it in "↑ n new" where an Unread list is on screen, or marks an off-screen Unread list stale. It is never inserted.
  - The arrival matcher rejects read mail in Unread columns.
  - Sidebar and lock-glance counts refresh after each change.
- **Card:** unread shows as an accent dot before the sender plus a semibold sender name, with sr-only "Unread". It's a shape plus weight, not colour alone, and the line height is unchanged, so the card's height never changes when it's read.

## Gate
- lint and typecheck clean.
- **137/137 tests** (2 new: the contract test for read, and the client read-marking test).
- Build OK.
- `dist`: no mock code.

## Sizes (gzip)

| Chunk | KB | Loaded |
| --- | --- | --- |
| index (boot) | 2.95 | initial |
| main | 78.59 | initial |
| queries (shared) | 14.50 | initial |
| jsx-runtime | 2.72 | initial |
| rolldown-runtime | 0.42 | initial |
| **Initial JS** | **99.18** | budget 200 |
| Inbox | 44.74 | lazy |
| EmailDrawer | 7.08 | lazy |
| socket.io-client | 12.86 | lazy |
| CSS: lock / main / Inbox / drawer | 1.51 / 3.26 / 3.42 / 1.75 | — |

## Browser checks owed
1. **Unread cards:** they show the dot and a bold sender.
   - Open one: after closing, the dot is gone.
   - The sidebar Inbox badge drops by one.
   - The card's height doesn't change.
2. **Unread chip:** with it on, open an email.
   - It leaves the Unread list behind the drawer.
   - On close, focus lands on the column title.
3. **In the drawer:**
   - "Mark unread": the dot comes back on the card in the inbox.
   - Closing and reopening marks it read again.
   - Mark unread, then Mark read, in the same open: no automatic re-mark fights it.
4. **Mark unread with the Unread chip off,** then turn the chip on: the email is in the list (the off-screen list reloaded).
5. **Live:**
   - New mail arrives unread and counts in the Unread column's pill.
   - In a second tab, opening the email updates its dot in the first tab.
