# QA pass 3, commit 1: dev defaults and live updates (3 Nov 2026)

Frontend and mock only. Proposals §16.1–16.2.

## What changed
- **Persistence is on by default in dev.** `VITE_MOCK_PERSIST=0` turns it off; `.env.example` says so. A reload no longer silently reseeds the store.
- **Same tab: why tiles seemed dead.** The socket, arrivals and the pill all worked. Headless Chrome on `/`: 30 sends gave "13 new" on Critical + High. There were two real gaps:
  - **Random mail is mostly Low or Medium** (13 of 22 templates), so the Today tiles often had nothing to count. Use "Run §7.2 demo" for Critical mail.
  - **The Due tiles could never count an arrival.** `due_date` appears only at enrichment, and `email.enriched` carries no due date. The client now derives it from the event's actions with the §10.2 rule (`dueDateOfActions` in `src/lib/due.ts`, shared with the mock). Proposals §16.1.
  - Also: `email.triaged` that changes `handled`/`read` (another tab or device) now settles lists the same way as a local PATCH (`settleLists` moved into `src/api/realtime.ts`). Proposals §16.2.
- **Two tabs: one mock, as one server would be** (`src/mocks/tabsync.ts`, a BroadcastChannel):
  - after each change the tab sends its whole store (structured clone) and the others adopt it, so REST answers agree;
  - each socket event it published follows, always after the store, and the other tabs deliver it to their own sockets;
  - a new tab asks for the current store before serving its first request;
  - dev-panel knobs (pause, speed, latency, Jira mode) and Reset store reach every tab;
  - background mail comes from one tab only (a Web Lock), so two tabs don't both send;
  - the pipeline looks the email up again after each wait, so adopting another tab's store mid-delivery is safe;
  - last writer wins: two changes in the same instant in two tabs can lose one. That's acceptable for a dev mock.

## Gate
- lint and typecheck clean.
- **162/162 tests**. New:
  - Due-today arrival counted after enrichment, plus handled from another session (`realtime.test.ts`);
  - five two-tab tests with real BroadcastChannels, tab A being the real store and pipeline (`tabsync.test.ts`): events after the store, no echo, change without an event, join, knobs and reset.
- Build OK.
- `dist`: no mock code, one module script.
- **Headless Chrome, two tabs:**
  - 8 emails sent in A reach B's store and B's tiles ("2 new", and "1 new" on Due today);
  - speed reaches B;
  - handled in A removes the email from all of B's lists.

## Sizes (gzip)

| Chunk | KB | Loaded |
| --- | --- | --- |
| index (boot) | 3.09 | initial |
| main | 78.63 | initial |
| queries (shared) | 14.95 (+0.41: due rule, settling) | initial |
| jsx-runtime | 2.72 | initial |
| rolldown-runtime | 0.42 | initial |
| **Initial JS** | **99.81** | budget 200 |
| Dashboard | 28.21 | lazy |
| InboxHost | 45.67 | lazy |
| EmailDrawer | 6.98 | lazy |
| socket.io-client | 12.86 | lazy |

## Browser checks owed
1. **Persistence:** with no `VITE_MOCK_PERSIST` in `.env.local`, mark an email read and reload: still read. With `VITE_MOCK_PERSIST=0`: reseeded.
2. **Same tab on `/`:**
   - "Run §7.2 demo" shows "↑ n new" on Critical + High within seconds;
   - once a demo email's due date appears (after enrichment), Due today counts it if it's due today.
3. **Two tabs** (both on `/` or `/inbox`):
   - "Send one email" in A shows "↑ 1 new" on the matching tile in B;
   - opening the email from B's pill works;
   - Done or Mark read in A removes it from B's matching lists;
   - Pause in A's dev panel pauses mail in both.
4. **Reset store in one tab** reloads both, and both show the fresh seed.
5. **Layout conflict** (task-8a check 8) now really crosses tabs: edit in A, then in B; B says "changed in another window" and reloads A's layout.
