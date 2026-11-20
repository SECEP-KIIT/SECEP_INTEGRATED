# Task 6: Cards & column widget (decisions items 3, 4, 6)

Run unattended on 2 Nov 2026 under the halt-don't-invent rule.

## Plan

**Scope:** the email card (FR-UI-011 layer 1, FR-UI-012, FR-UI-013, FR-UI-014 S, FR-UI-015 density), a column widget with a filter popover and chips (FR-UI-021), sort (FR-UI-023 S), the "↑ n new" pill (FR-UI-024), skeletons and empty states, a virtualised list (NFR-PERF-011), and the Focus-mode filter (FR-UI-004). The throwaway Inbox list is replaced.

**Halt-don't-invent finding (made while planning).** Several parts of items 3, 4 and 6 have no wire shape or no defined semantics in SRS v1.2. They are recorded in `docs/proposals/srs-v1.3-frontend-shapes.md` §9 and **not built**:
- the quick chips Unread, Due today, Needs my reply and Overdue (FR-UI-021, M);
- the Due tag, Due filter and Due sort;
- the Project, Status and Has-attachments/notes filter groups;
- facet counts;
- the Smart sort and its explanation;
- the external-sender tag, the note tag and custom tags;
- project dots and chips;
- filters for metadata tags;
- the column total count.

Per the run rules I park these, build only the fully specified part of task 6, commit it, and **stop. Task 7 is not started.**

**Built (all shapes from §6.4.1 / §6.5):**
- **Card:**
  - Type icon (Lucide shape per type). Sender name, sender role, time, urgency mark (colour plus shape plus text), pin.
  - Subject, the only bold line. One-line summary, muted, with a skeleton while enrichment runs.
  - Tag strip: security shield, sentiment (only Negative or Frustrated), Jira key or proposed-action count, attachments, replies, duplicates, masked secret, snoozed. At most 5, then `+N`. Hovering or focusing the strip shows every tag (CSS only, no React hover state).
  - `needs_review` type chip: dotted, with "?". Clicking it opens the type-correction menu (`PATCH /emails/:id/labels`, scope `email`). The scope toast is task 15.
  - Type, urgency, security and sentiment tags act as column filters.
  - Fixed height per density (Compact, Comfortable, Spacious).
- **Column:**
  - Header: title, loaded count, urgency bar, filter (⏷ with active count), sort, density, `?` legend.
  - Removable filter chips.
  - Filter popover (Radix): Type, Urgency, Sentiment, Security (`type`, `urgency`, `sentiment`, `flag`, OR within a group, AND across groups), Sender (`sender`), Date received (`received_after` / `received_before`).
  - Sort: Newest, Oldest, Urgency, Sender, Least confident first (`sort=`). Pinned cards stay on top.
  - TanStack Virtual list with infinite cursor paging. Skeleton cards. Empty states: "All clear — enjoy the view" and "Nothing matches".
- **"↑ n new" pill:** `arrivals` now keeps each arrived `EmailListItem`. A column counts only the arrivals that match its own filters and aren't loaded yet. Clicking the pill resets the column to page 1, scrolls to the top and tints the new cards for 2 s. Email lists never refetch on their own (no window-focus refetch, infinite staleTime), so nothing is ever inserted under the cursor.
- **Realtime:** `patchEmail` learns the infinite-query cache shape (pages), still patching in place.
- **Mock:**
  - `GET /emails` implements `sort` (newest, oldest, urgency, sender, confidence; smart and due are accepted and treated as newest until built; unknown values → 400) with pinned first.
  - `from.role_category` is the PROPOSED field (decision §8.5). It's serialised on `EmailListItem.from` only and typed via `SenderPerson`, read through a tolerant accessor. `Person` is unchanged.

**Dependencies:** `@tanstack/react-virtual` 3.14.25 and `@radix-ui/react-popover` 1.3.1. Both have React `^18` peers (checked with `npm view … peerDependencies`). Both are used only in the lazy inbox chunk.

**Files:**
- `src/inbox/`: `cardModel.ts` (pure: tags, order, time, query params, filter matching), `cardModel.test.ts`, `marks.tsx` (type icon, urgency mark, tag icons), `EmailCard.tsx`, `CorrectionMenu.tsx`, `FilterPopover.tsx`, `Legend.tsx`, `Column.tsx`, `inbox.css`
- `src/pages/Inbox.tsx` (rewritten)
- `src/api/queries.ts` (`emailListOptions`, `useCorrectLabel`), `src/api/realtime.ts` (+ test)
- `src/api/types.ts` (§6.4.1 `LabelCorrection` request/response types); `src/shell/useMinuteClock.ts` (moved out of Topbar)
- `src/shell/useBootSteps.ts`
- `src/mocks/routes/emails.ts`, `src/mocks/store/templates.ts`, `src/mocks/store/serialize.ts`, `src/mocks/contract.test.ts`
- `docs/proposals/srs-v1.3-frontend-shapes.md` §9

## Completion report

**Built:** everything listed under "Built" above.
- **Gate:** lint (oxlint) clean; typecheck clean; **119/119 tests** in 9 files (16 new: card model, infinite-cache patching and arrivals, mock sort and pinned-first, the proposed `from.role_category` key set); build OK.
- **New tests:**
  - `src/inbox/cardModel.test.ts`: tag order and +N, filters, chips, the query string, Focus mode, the arrival matcher, time.
  - `src/api/realtime.test.ts`: column (infinite) caches patch in place; arrivals keep and update their card.
  - `src/mocks/contract.test.ts`: sorts, 400 on an unknown sort, pinned first; `from` has `role_category`, while `to`/`cc`/thread stay `{address, name}`.

**Deviations, with reasons**
1. **All-tags popover:** opens on hovering or focusing the tag strip, not the whole card, and is drawn over the card's upper rows rather than above the card. Opening on any card hover would cover the summary every time the pointer crosses a card; card hover belongs to the layer-2 quick actions (task 7). Drawing it inside the card means the list's scroll container can never clip it (the top card would otherwise lose it). Still pure CSS with the 150 ms intent, as item 3 requires.
2. **Compact density:** subject and summary share one line, so all of layer 1 stays visible at 76 px.
3. **Header count:** the loaded count ("25+"), with the urgency bar over loaded cards. There is no total on the wire (proposals §9.8).
4. **Correction menu:** the dotted "Task?" chip opens it; it saves with scope `email` (the FR-ML-013 default). The scope toast stays in task 15, as the task order says.
5. **Not wired yet:** card click (drawer) and Space preview move to task 7, which builds the drawer; Space preview needs `GET /emails/:id`.
6. **Column state:** filter, sort and density are kept in memory per column. They're persisted with the layouts in task 8 (`GET/PUT /layouts/:deviceClass`).
7. **"↑ n new":** a click scrolls to the top, keeps only page 1 in the cache and refetches it. The old cards stay on screen until it arrives (no skeleton flash), then the arrivals fade in with a 2 s accent tint.
   - Each column counts the arrivals that match its own filters, arrived after its first page was requested, and aren't loaded yet.
   - Email lists never refetch on their own (no window-focus or reconnect refetch, `staleTime: Infinity`), so nothing is ever inserted under the cursor.
8. **Mock sort:** `smart` and `due` are accepted and served as newest; an unknown `sort` → 400 (proposals §9.9, §9.15). The UI offers Newest, Oldest, Urgency, Sender and Least confident first.
9. **`--line-strong` contrast:** first written as alpha 0.28, which measured 1.80:1. Raised to 0.5 (3.15:1 on cards, 3.09:1 on the column). All new token contrast comments now give measured values.

**Halt-don't-invent:** 16 gaps are recorded in `docs/proposals/srs-v1.3-frontend-shapes.md` §9. Item 1 (the quick chips) and item 2 (the email due date) block **Must** parts of FR-UI-021 and FR-UI-013. Item 13 (what "Done" means) blocks task 7's quick actions. **The run stops here; task 7 was not started.**

**Chunk sizes (gzip):**

| Chunk | Size | Loaded |
| --- | --- | --- |
| `index` (boot: lock, wallpaper) | 2.89 KB | initial |
| `main` | 78.44 KB | initial (modulepreload) |
| `shield-alert` (shared: TanStack Query and Lucide used by main and Inbox) | 13.84 KB | initial (modulepreload) |
| `jsx-runtime` | 2.72 KB | initial |
| `rolldown-runtime` | 0.42 KB | initial |
| **Initial JS total** | **98.31 KB** | budget 200 KB (task 5: 96.7 KB) |
| `Inbox` (cards, column, Radix Popover, TanStack Virtual) | 41.59 KB | lazy (route) |
| `esm` (socket.io-client) | 12.86 KB | lazy |
| `More` / `Placeholder` | 0.45 / 0.15 KB | lazy |
| CSS: `index` (lock) / `main` / `Inbox` | 1.38 / 3.21 / 2.70 KB | — |

`dist` checks: no msw, worker, dev-panel or `secep.mock` code (`grep` is empty); the lock controller (`secep.boot`) appears only in the boot chunk; `index.html` has one module script with `src` and no inline script.

**Browser checks owed (not attempted):**
1. Cards keep their height on hover, on focus and while a summary or label arrives live. Check all three densities, and that the tags row isn't clipped.
2. All-tags popover: the 150 ms intent; strip tags stay clickable while it's open; nothing is clipped on the first or last visible card.
3. **"↑ n new":** send mail from the dev panel (Ctrl+Shift+D) while scrolled down.
   - The pill appears and nothing moves.
   - A click scrolls to the top, the new cards fade in with the tint, and there's no skeleton flash.
   - A column filtered to a non-matching type shows no pill.
4. **Filter popover:**
   - Esc and outside-click close it, and focus returns to the trigger.
   - Ticking boxes updates the list without flashing skeletons.
   - The Sender field waits 300 ms; removing a chip and Clear all sync back into the field.
5. **Correction menu:** "Task?" opens it; choosing a type turns the chip solid in place; an error shows the alert.
6. **Focus mode:** `F` shows only Critical and High; Focus mode with only Medium/Low ticked shows the "Nothing matches" state.
7. Virtual list: smooth scrolling with ~50 cards; the next page loads before the end; screen-reader position ("3 of 50").
8. `?` opens the legend; Esc and the backdrop close it; `?` typed in the Sender field doesn't open it.
9. Reduced and Off motion: menus cross-fade, the shimmer is static, and the tint is static under Off.
10. Still owed from task 4: blur-on-settle pop, clip-path peek jank, 1-minute idle return, project rings with the sidebar expanded.
11. Still owed from task 5: the §7.2 demo from the dev panel, and switching users with sidebar gating.
