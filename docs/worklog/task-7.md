# Task 7: Drawer & actions (decisions items 3 and 10)

Planned and built straight through, as allowed; the user reviews the finished result.

## Plan

**Scope:** card layer 2 (hover/focus quick actions) and layer 3 (the side drawer) from FR-UI-011; the Jira one-click and ⇧-click composer (FR-ORC-012, M); calendar events, simulated (FR-ORC-010); the .ics download (FR-ORC-017, M); "Done" as handled (decision §10.3); following links through the click-time check (FR-SEC-004, M); Space preview (FR-UI-015, S).

**Shapes used (all §6.4.1 / §6.5, or decided in proposals §10):**
- `GET /emails/:id` → `EmailDetail`.
- `POST /actions/:id/accept {payload?}`, `POST /actions/:id/reject`, `POST /emails/:id/actions {type, payload}`.
- `GET /emails/:id/ics`.
- `GET /links/:checkId/go` → open / interstitial / blocked.
- `PATCH /emails/:id {handled, pinned}` → `EmailDetail`.

**Quick actions (Jira · Calendar · Done · ⋯):** overlay the card's top-right; CSS hover with a 150 ms intent; on keyboard focus at once; no height change.
- **Jira:** sends the decoder's proposal as is. Shift+click opens the composer. No proposal → composer for a new issue. An existing key shows `✓ KEY`.
- **Calendar:** accepts the proposed event; otherwise opens the composer.
- **Done:** marks the email handled; the card fades out and leaves the list (an intentional removal, item 9). In the Handled view the button reads "Restore".
- **⋯:** opens the drawer.

**Drawer:** a native modal `<dialog>` at the right, lazy chunk. It slides 24 px with a fade (200 ms) and dims the content behind (item 9). Collapsible sections:
- **Summary:** short summary, labels with confidence and their source, the full email as plain text.
- **Proposed actions:** each action with its status; accept, edit (composer), decline, retry on failure; new Jira issue or event; .ics.
- **People & thread:** from (with the PROPOSED role), to, cc, your position, the thread.
- **Links & security:** flag, SPF/DKIM/DMARC, links through the click-time check, masked-secret count.
- **Notes & attachments:** the attachment list. Downloads and notes come in task 12.

The header has Pin and Handled toggles. Enter, click or Space on a card opens it; Esc closes it.

**Not in task 7 (by the task order, not gaps):**
- `+ Comment on KEY` (FR-ORC-013, S): the mock treats `mode: comment` as a new issue.
- Bulk send: task 9.
- RSVP and clash warnings: task 14.
- Undo: task 9.
- Showing the Jira target from the primary project: task 10.
- Reveal and the full interstitial page: task 15.

**Files:**
- `src/api/client.ts` (`apiBlob`), `types.ts` (`GoResponse`), `queries.ts` (detail options and the action, email and link mutations), `realtime.ts` (export `patchActionCache`)
- `src/inbox/CardActions.tsx`, `inboxContext.ts`, `Toaster.tsx`
- `src/drawer/EmailDrawer.tsx`, `ActionList.tsx`, `Composer.tsx`, `LinkList.tsx`, `drawer.css`
- `EmailCard.tsx`, `Column.tsx`, `pages/Inbox.tsx`, tests

## Completion report

**Built:**
- **Quick actions** on the card (`CardActions.tsx`).
- **Drawer** as a lazy chunk (`src/drawer/`), with all five sections.
- **Actions:**
  - accept, edit (composer), decline and retry, with live status: Sending… → `✓ ATL-142 · To Do` (drawn check), Failed with Jira's error;
  - new Jira issue or calendar event (create, then accept);
  - .ics download.
- **Links:** opened through the click-time check, with an inline suspicious warning ("Open anyway") and a blocked state.
- **Pin and Handled toggles; toasts.**
- **Opening:** card click, Enter and Space open the drawer.

**Shapes:** only §6.4.1 / §6.5 and the §10 decisions. One new gap: §11.1 (assignee, project and epic aren't in the action payload). I did **not halt** for it: the composer is complete for every field that exists, and nothing was invented for the missing ones. It's parked for review. `SenderPerson` / `from.role_category` is still read only through the tolerant accessor; `Person` is unchanged.

**Security-relevant code:**
- `LinkList.tsx`:
  - links open only via `GET /links/:checkId/go`;
  - only `http(s)` URLs, in a new tab with `noopener,noreferrer`;
  - suspicious links need an explicit "Open anyway"; malicious links never open;
  - the redirect chain and signals are shown as text, never as links.
- Body, subject and summary are plain text through `MaskedText`; there is no `dangerouslySetInnerHTML`.
- The .ics file goes through the authenticated client into a temporary object URL (revoked after 1 s); nothing is rendered.
- Toasts and errors never contain email content: messages come from fixed strings or §6.4.1 error messages, apart from the Jira issue key in success toasts and Jira's own error text.

**Deviations and reasons:**
1. **Native `<dialog>` instead of Radix Dialog:** focus trap, Esc, inert background and focus return come built in, and the Radix dependency is avoided. Radix popovers inside it portal into the dialog (`PortalContainer`), because a modal dialog makes `<body>` inert.
2. **Space opens the drawer** as the quick preview (FR-UI-015) rather than a separate Quick Look overlay. Esc closes it.
3. **Card removal on Done:** a 120 ms fade, then the item leaves the cache and the virtual list closes the gap instantly. The 180 ms gap-closing glide comes with the FLIP pass (task 17). Restoring doesn't re-insert the card into an open list; it comes back with the next load or the pill (no insertion under the cursor).
4. **No exit animation on the drawer** (an instant close); item 9 only specifies the enter motion.
5. **Deferred by the task order:** comment-on-existing-issue (FR-ORC-013, S), bulk send, undo (task 9), RSVP and clash warnings (task 14), the Jira target from the primary project (task 10), Reveal and the full interstitial (task 15), attachment download and notes (task 12).
6. **Quick-action Calendar** shows on every card. With no proposal it opens the composer for a new event. The list item doesn't say whether a calendar proposal exists.

**Gate:** lint and typecheck clean; **131/131 tests** (5 new in `src/drawer/actions.test.ts` against the real mock: handled removal and restore, accept and the 502 refetch, reject, the three `/go` shapes, the .ics); build OK.

**Sizes (gzip):**

| Chunk | Size | Loaded |
| --- | --- | --- |
| `index` (boot) | 2.95 KB | initial |
| `main` | 78.55 KB | initial |
| `queries` (shared; was `shield-alert`, 13.84 KB) | 14.35 KB | initial |
| `jsx-runtime` | 2.72 KB | initial |
| `rolldown-runtime` | 0.42 KB | initial |
| **Initial JS total** | **98.99 KB** | budget 200 KB |
| `Inbox` | 44.51 KB | lazy (route) |
| `EmailDrawer` | 6.70 KB | lazy (first open) |
| `esm` (socket.io-client) | 12.86 KB | lazy |
| `More` / `Placeholder` | 0.45 / 0.15 KB | lazy |
| CSS: lock / main / Inbox / EmailDrawer | 1.51 / 3.26 / 3.24 / 1.73 KB | — |

`dist`: no mock or dev-panel code; `secep.boot` only in the boot chunk; one module script, no inline script.

**Browser checks owed (task 7):**
1. **Quick actions:**
   - Appear after about 150 ms of hover, at the top-right, without changing the card's height.
   - Appear at once when tabbing into a card.
   - Hidden on touch, where a tap opens the drawer.
2. **Jira one-click:** a proposed Jira email gets the success toast "Sent to Jira as ATL-…", and the card's tag turns into `✓ ATL-…` in place.
   - With the dev panel's Jira modes: 401 → error toast plus Failed in the drawer with Retry; 503 → upstream toast and the drawer shows Failed; 429 once → succeeds.
3. **Shift+click Jira / Calendar** opens the drawer with the composer filled; edit, then send. A field error (e.g. clear the title) shows inline.
4. **Calendar** on a Meeting email: accepts the proposal ("In your calendar"); Download .ics saves `meeting.ics`.
5. **Done:**
   - The card fades and leaves; the "Marked as handled" toast shows.
   - With the Handled chip on it's listed, and Restore removes it from that view.
   - The drawer's Mark handled / not handled and Pin work; a pinned card moves to the top on the next load.
6. **Drawer:**
   - Slides in from the right with a dimmed backdrop; Esc and a backdrop click close it, and focus returns to the card.
   - The five sections collapse and expand.
   - Under Reduced motion it's a fade; Off is instant.
   - On a phone it's full screen.
7. **"Task?" in the drawer:** the correction menu opens and is clickable inside the modal (portal container).
8. **Links:**
   - Clean opens a new tab; check there's no `window.opener`.
   - Suspicious shows the warning; "Open anyway" opens the final URL.
   - Malicious shows Blocked with no open button.
   - Pending is disabled.
   - With latency set to slow, check the popup isn't blocked (§11.2).
9. **Live updates while the drawer is open:** send mail or accept from another flow; actions update in place.
10. Esc in the drawer also leaves Focus mode if it's on (a shared Esc). Check whether that's acceptable.
