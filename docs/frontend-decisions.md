# SECEP — Frontend design decisions (items 1–15, complete)

Brainstorm held 29–31 Oct 2026. All 15 items decided. Folded into **SRS v1.1** (sections 3.8–3.15, 6.4–6.8), which is authoritative for requirements, data model and API; this document keeps the design detail and rationale.
Priority keys follow the SRS: **M** Must (MVP) · **S** Should (if time allows before feature freeze, 8 Nov) · **F** Future. Tile sizes are written in full (small / medium / large) to avoid confusion with priorities.

## Standing principles

- **Fast and lightweight above all.** No slow or heavy website. Every feature carries a cost check.
- Performance targets: initial JavaScript ≤ ~200 KB gzipped; first meaningful screen ≤ 2 s (NFR-PERF-009).
- Borrow proven patterns from well-known products (Apple, Canva, Linear, Gmail, Superhuman). Elements behave the Apple way.
- No layout shift: cards never change height and columns never jump under the user's cursor.
- Cost checks are only raised in the discussion when there is an issue, written in CAPS.

## (1) Topbar & sidebar — decided

- **Layout:** both, as a **floating sheet**. Content is inset ~8 px with 12 px rounded corners, so the wallpaper shows around all four edges.
- **Sidebar:** collapsible, 64 px icons ↔ 220 px with labels; hover-peek (Arc style).
  - Top: Inbox, Board, **Calendar** (calendar icon; see item 14), Security, Metrics, with count badges and a red dot for Critical.
  - Middle: projects as coloured dots with names and progress rings.
  - Bottom: avatar, settings, Admin (admins only).
- **Topbar** (~56 px), three zones:
  - Left: page title / breadcrumb; clock and weather chip for the wallpaper's location.
  - Centre: search pill that opens the **command palette** (⌘K / Ctrl+K, also `/`).
  - Right: live sync indicator (`● synced 12 s ago`), notifications bell, **+ quick-add**.
  - **Contextual mode:** with cards selected, the centre becomes `3 selected · Jira · Calendar · Project ▸ · ✕`.
- **Adaptive legibility:** frosted glass behind bar contents; text colour switches with wallpaper brightness.
- **Focus mode** (`F`): sidebar hidden, slim topbar, only Critical and High cards.
- **Ambient urgency:** subtle warm glow on the sidebar edge while unread Critical mail exists.
- Phone: sidebar becomes a bottom tab bar.
- Cost notes: blur only on the small bar areas; wallpaper served as AVIF/WebP sized to the screen (~150–300 KB); palette code loads on first use.

## (2) Tiling dashboard & pages — decided

- **Everything is a widget.** Inbox columns, Board, Projects, Reminders, Calendar, Notes, Stats and Security are each one component rendered at two sizes: a **tile** on a dashboard page, or a **full view** from the sidebar / a tile's ⤢ button.
- **A column widget is a saved filter.** Several inbox columns can sit side by side with different filters.
- **Pages (home-screen style):**
  - Horizontal pages; dots at the bottom centre that expand into **named pills on hover**; **+** adds a page.
  - Switch by clicking a dot, trackpad swipe, `Ctrl + ←/→`, `Ctrl + 1…9`.
  - `overscroll-behavior-x: contain` so swiping never triggers browser Back.
  - **Starter templates:** Today, Triage, Planning.
  - Only the active page renders (neighbours as light previews while swiping).
- **Desktop tiling:**
  - `react-grid-layout`, 12-column snap grid, resize in grid steps, small / medium / large presets.
  - **Edit mode required** to move tiles (iOS jiggle mode), so dragging cards and dragging tiles never collide.
  - Widget gallery: "+ Add widget" drawer with live previews.
- **Widget title bar:** **right-click** (PC) or **long-press** (phone) → Rename, colour (8 preset swatches tinting the title bar and a thin left stripe), **icon**, Size, Duplicate, Remove. A `⋯` button appears on hover for discoverability; double-click the title to rename.
- **Phone tiling (simple slot-based version):**
  - Fixed one-screen pages that do not scroll vertically; horizontal swipe changes pages.
  - Column widgets show one card plus a peek of the next, scrolling **vertically inside** the widget (Smart Stack model), with a `3 / 12` counter in the header.
  - **Long-press in a gap** between widgets enters edit mode. Visual gap 12–16 px; invisible ~44 px touch zone.
  - Free slots appear as ghost outlines sized to the widget; **tap a widget, then tap a slot** to place it.
  - Slot sizes: small = half width × 1 card; medium = full width × 1 card; large = full width × 2 cards.
  - Board on phone shows one column at a time with a `To do · Doing · Done` switcher.
- **Layouts saved on the server per user and per device class.**
- **Future:** time-aware pages (auto-switch by time of day); full drag-based phone tiling (drag to screen edge for next page, dnd-kit touch dragging).
- Widgets are code-split and load only when placed; long columns use virtualised lists (TanStack Virtual).

## (3) Compact info boxes (cards) — decided

- **Three layers:**
  1. Always visible: type icon · sender · role · time · urgency; subject (the only bold line); AI one-line summary (muted); tag strip.
  2. On hover / keyboard focus: quick actions (Jira · Calendar · Done · ⋯).
  3. On click: a **side drawer** with collapsible sections — Summary · Proposed actions · People & thread · Links & security · Notes & attachments.
- **Hover rules:** pure CSS (no React state on mouseenter); ~150 ms hover-intent delay; actions overlay the card's top-right corner (no height change); the same actions are available on the selected card, in the right-click menu and in the topbar. Touch has no hover.
- **Anti-clutter rules:** one bold element per card; colour only carries meaning; at most three text sizes; 8 px spacing scale; 1 px borders and faint tint instead of shadows; truncate rather than wrap.
- **Density switch per widget:** Compact / Comfortable / Spacious.
- **Spacebar preview** (macOS Quick Look).
- **Honest AI labels:** uncertain types show a dotted chip with a question mark (`Task?`), clicking opens the correction menu.
- **Smart widget headers:** count plus a thin bar split by urgency colours.
- **Empty states with character** ("All clear — enjoy the view").
- **Skeleton loading** instead of spinners (sole exception: the lock-screen loading indicator, item 15).
- **System font stack** (SF Pro / Segoe UI); **Lucide** line icons, tree-shaken.

## (4) Tags & symbols — decided

| Dimension | Channel |
|---|---|
| Email type | Lucide icon shape: Task, Info, Credentials, Meeting, Approval |
| Urgency | Colour + shape: Critical red filled double dot, High orange dot, Medium amber hollow dot, Low grey |
| Project | Coloured dot + name (split dot for several projects, see item 5) |
| Security | Shield (Suspicious / Malicious); hidden when clean |
| Sentiment | Shown only when Negative or Frustrated |
| Metadata | **Each piece as its own tag**: attachments `📎 2`, replies `↩ 4`, duplicates `×3`, masked secret `🔒`, Jira `⚡ Jira` → `✓ ATL-142`, note `📝`, external sender `↗`, snoozed `⏰` |
| Dates | No icon; one word of context: `Due Fri`, `Due Today 5 pm`; coloured by proximity (red < 24 h, orange ≤ 3 days, grey later) |

- Line icons for system tags; emoji only for user choices (widget icons, projects).
- Never colour alone (colour-blind safe).
- At most five tags visible, then `+N`; priority: security → due → project → action status → rest.
- **Hovering any tag, or the card (layer 2), opens a popover above the card listing all tags.** No in-place expansion.
- **Tags are clickable filters.**
- Tooltip on every tag; `?` key shows the full legend.
- Jira status stays live on the card (item 10).
- **Lightweight custom user tags** (name + colour only).

## (5) Projects — decided

- A user-owned container: name, colour, emoji icon, description, optional deadline, optional linked Jira project / epic. Holds emails, user-made cards, notes, files, reminders.
- **An email or card can belong to several projects.**
  - Shown as **one split dot** (conic-gradient pie): 2 projects = two halves, 3 = thirds, and so on; at most 4 slices, 5+ shows a ring with the number.
  - Dot grows from 10 to 12 px when split.
  - Project chip reads `Atlas +1`; hovering lists all projects, each clickable as a filter.
  - The **first project assigned is primary**: it decides Jira routing and is the left slice; changeable in one click. The Jira target is shown before accepting.
  - Dragging a card onto a sidebar project **adds** that project; removal via the chip's right-click menu or *Replace project*.
- **Getting emails in:**
  - Manual: drag onto a sidebar project, right-click → Project ▸, bulk assign, `p` shortcut.
  - **Thread inheritance:** later replies join all of the thread's projects automatically.
  - **Rules (S):** Gmail-style filters (sender, domain, subject).
  - **AI suggestion chips (S):** project centroid embedding vs. new email → `+ Atlas? ✓ ✕`. Suggests only, never auto-files.
- **Project view:** header with deadline countdown and progress ring; sections Emails · Tasks · Notes · Files · Timeline; "Make a page for it".
- **Jira mapping** per project.
- **Archive** instead of delete (still searchable).
- **Health colour** on the ring: amber with overdue tasks; red when deadline < 48 h and progress < 70 %.
- **Shared projects: F.**

## (6) Per-column filter & sort — decided

- Column header: title, count, urgency bar, filter (⏷ with active count), sort (↕), ⋯.
- **Removable filter chips** under the header show active filters; each ✕ removes one. No filters, no row.
- **Filter popover** groups: Type · Urgency · Project · Due · Status · Sender · Security · Sentiment · Has attachments/notes · Date received; **live counts** per option; zero-count options greyed.
- Logic: OR within a group, AND across groups. **AND/OR builder: F.**
- Quick chips: Unread · Due today · Needs my reply · Overdue.
- **Sort:** Smart (default) · Newest · Oldest · Due soonest · Urgency · Sender · Least confident first.
  - **Smart sort:** urgency + due proximity + unread + sender seniority, decaying with age; `ⓘ` explains each card's position.
  - **Least confident first:** review mode for label corrections.
- **Pinned cards** stay on top.
- **`↑ 2 new` pill** instead of inserting new cards under the cursor.
- **Grouping within a column** by day, sender or project; collapsible.
- **Save as widget** from any filter + sort combination.
- Filtering runs on the server (indexed `GET /emails`); facet counts computed only when the popover opens.

## (7) Search — decided

- **The ⌘K palette is the single search entry**; `/` also opens it.
- Results grouped: Emails · Cards · Projects · People · Actions; ↑↓, Enter, Space to preview, Esc.
- **Gmail-style operators** with autocomplete: `from:` `to:` `project:` `type:` `urgency:` `due:` `has:` `is:` `before:` `after:` `"exact"` `-exclude`. Typed operators turn into filter chips; the same syntax works in a column's filter field.
- **Typo tolerance** with `pg_trgm`; prefix matching.
- **Semantic hybrid search (S, FR-ORC-011):** keyword + embedding results merged; skipped for operator-only queries.
- Recent searches; saved searches become widgets.
- Match highlighting in snippets.
- Search covers notes and attachment filenames. **In-attachment search (PDF/OCR): F. Natural-language queries via LLM: F.**
- Search runs over masked text only, so secrets can never surface.
- 150 ms debounce; stale requests cancelled; max 8 results per group.

## (8) Canva-style interactions — decided

- **Selection:** click; `Ctrl/⌘ + click` (across columns); `Shift + click` (range); **marquee drag** on empty space; `Ctrl/⌘ + A`; `Esc`. Selected cards show an accent outline and a check circle. Phone: ☑ in the column header enters selection mode.
- **Context-aware right-click menu** for cards, multiple cards, column headers, widget titles, tags, empty space and sidebar projects.
  - Shortcuts shown on the right; ▸ submenus; destructive items red and last.
  - Opens at the cursor, flips near edges.
  - **Browser's own menu kept on text fields and links.**
  - Phone: long-press a card opens the same menu with a card preview.
  - Built with **Radix UI** menus.
- **Drag and drop** (dnd-kit): drop targets light up on drag start; multi-drag as a stack with a count.
  - Onto a board column → move; onto a sidebar project → add project; **onto the Calendar widget → event at that time slot**; files from the desktop onto a card → attach.
- **Keyboard:** `j`/`k` · `Enter` · `Space` · `x` · `e` · `p` · `h` (snooze) · `n` (quick-add) · `⇧J` · `⇧C` · `g c` (Calendar) · `?`; disabled while typing in fields.
- **Undo:** `Ctrl/⌘ + Z` for reversible actions, plus an undo toast (`Moved 3 cards to Atlas · Undo`).
- **No delay on Jira / Calendar actions** — they execute immediately (the proposed 5-second wait was rejected as feeling like latency). **Decided instead:** the toast reads `Sent to Jira · ATL-142 · Undo`; clicking Undo within ~10 s deletes the just-created Jira issue or Calendar event (needs delete permission on the Jira project, granted by default on a free Jira site).
- **Paste to create:** pasting text, an image or a file on the dashboard creates a card.
- `Ctrl/⌘ + C` on a card copies a summary with a link; `Ctrl/⌘ + D` duplicates a widget or user card.
- One menu component and one delegated event listener for the whole dashboard.

## (9) Animations — decided

- **Principle:** motion carries meaning (where something came from, what changed, what is draggable), never decoration.
- **Ground rules:**
  - Animate `transform` and `opacity` only; no animated `box-shadow` or blur radius (glows and lifts use opacity on a pre-drawn pseudo-element).
  - Durations 80–250 ms; only gesture-driven page swipes run longer.
  - Ease-out on enter, ease-in on exit; springs only for drag and swipe.
  - Always interruptible; input is never queued behind an animation. Repeated keyboard navigation (`j`/`k`, arrows) is instant.
  - `will-change` only while animating.
  - Nothing animates directly beneath a moving `backdrop-filter` area.
- **Library: Framer Motion (Motion for React)**, accepted for convenience despite ~35–50 KB gzipped. Use `LazyMotion` + `m` components with features loaded asynchronously to keep the initial bundle small. View Transitions API for page and drawer changes where supported. `react-grid-layout` and dnd-kit keep their built-in transforms.
- **Per element:**

| Element | Motion | Duration |
|---|---|---|
| Menus, popovers, tag popover (Radix) | Fade + scale 0.96 → 1 from the anchor | 120 ms in, 80 ms out |
| ⌘K palette | Fade + scale 0.98 → 1; results appear without animation | 140 ms |
| Side drawer | Slide 24 px + fade; content behind dims slightly | 200 ms |
| Pages | Follow finger/trackpad 1:1, then spring settle; active dot widens into its pill | ~300 ms settle |
| Edit mode (tiles) | **iOS jiggle** (±0.6°, staggered); resize snaps to grid | 150 ms snap |
| Hover quick actions | Fade in after the 150 ms hover intent | 100 ms |
| New cards (after `↑ 2 new`) | Fade in **with an accent tint that fades over 2 s** | 200 ms + 2 s |
| Reorder (sort change) | FLIP glide to new positions | 200 ms |
| Card removal | Fade, then the gap closes (intentional, not a layout shift) | 120 + 180 ms |
| Labels / summaries arriving | Skeleton cross-fades to content in reserved space | 150 ms |
| Drag | Lift (scale 1.02), drop targets glow, spring settle; multi-drag as a fanned stack | ~200 ms |
| Jira / Calendar success | `⚡ Jira` changes into `✓ ATL-142`, check drawn by SVG stroke | 250 ms |
| Undo toast | Slides up; shrinking bar (`scaleX`) shows the ~10 s undo window | 180 ms + 10 s |
| Sync indicator | Single pulse per sync, no loop | 400 ms |
| Skeletons | One shimmer gradient via `translateX` | 1.2 s loop |
| Ambient urgency glow | Pulses 3 times on new Critical mail, then stays steady | 3 × 1.5 s |

- **Reduced motion:** honours OS `prefers-reduced-motion`, plus a **Settings toggle: Motion — Full · Reduced · Off**. Reduced = 100 ms cross-fades instead of movement; jiggle → dashed outline; shimmer and glow static; swipes still track the finger but settle without a spring.
- **Review after build:** if the frontend feels heavy or laggy once built, revisit the library choice and any expensive effects.

## (10) Jira, Calendar & re-classify actions — decided

**Jira**
- **One click** sends the decoder's proposal as is. **`⇧J` / Shift+click** opens a mini composer prefilled with title, priority (mapped from urgency), due date, assignee = me, and project/epic from the card's primary project.
- **One issue per thread:** if the thread already has an issue, the button becomes **`+ Comment on ATL-142`** (`POST /rest/api/3/issue/{key}/comment`) instead of creating a near-duplicate.
- **Bulk send:** selected cards → **separate issues (default)** or one issue linking all emails, chosen in the contextual topbar.
- **Live status on the card:** one batched JQL query (`key in (…)`) every ~2 min, only while cards with issues are visible. No webhooks (they need a public HTTPS endpoint, as with Gmail push).
- **Two-way sync (S):** issue reaches Done in Jira → card moves to Done.

**Calendar** (S, see item 14)
- **Invite detection:** an email with a `text/calendar` part shows **RSVP (Yes · Maybe · No)** instead of "Add to Calendar", since Gmail has usually added the event already. No duplicates.
- **Plain-text meeting emails:** mini composer from the decoder's proposal; times in the user's time zone, sender's zone in a tooltip.
- **Clash warning (S)** — computed from events read with `calendar.events` (item 14), so no extra free/busy scope is needed.
- **`.ics` download (M):** works with any calendar app, no scope.

**Re-classify with personalisation**
- After a correction, a toast offers the scope: **This email only** (default) · **Always from this sender** · **Always for emails like this (S)**.
- **Always from this sender** creates a **personal rule**: a deterministic per-user override applied after triage. Listed in *Settings › My labelling rules* with hit counts; cards show `ⓘ labelled by your rule`.
- **Emails like this (S):** personal nearest-neighbour memory; a new email with cosine ≥ 0.90 to one the user corrected takes that label. pgvector makes this nearly free; no per-user models.
- **Every correction still feeds global retraining** (FR-ML-010); personal rules never change the shared model, so one user's preferences cannot poison everyone's labels.
- **Type change affecting actions** (e.g. Info → Task) re-runs the decoder for fresh proposals.
- Contract change: `triage.v1` `source` gains `"rule"` (SRS v1.1).

## (11) User-made cards, notes & attachments — decided

**User-made cards** (tasks given face to face, on a call, in a chat)
- **Quick-add:** topbar **+**, `n`, or paste. One natural line: `Send deck to Priya fri 5pm #Atlas !high`; date, `#project`, `!urgency` and `@person` become chips while typing. Small in-house parser (today, tomorrow, weekdays, times, "in 3 days"), or chrono-node lazy-loaded on first use.
- **Fields:** title, description, due, urgency, project(s), tags, checklist, **source** (`✋ In person · 📞 Call · 💬 Chat`) with an optional person from contacts seen in mail.
- **Looks like an email card**, with the source icon where the type icon would be.
- **Same actions as email cards:** Jira (item 10 rules), Calendar, projects, board, undo.
- **Storage (Option A):** an `actions` row with `email_id = NULL`, `origin = user`; extra fields in `payload`. Board, Jira flow, undo and audit are reused with no new code.

**Notes**
- Attach to any **email, card or project**; standalone **Notes widget**.
- **Editor: markdown-lite** (~5 KB): bold, italics, lists, `- [ ]` checkboxes, links, rendered live. Rich editors (TipTap / Lexical, 50–100 KB) rejected.
- **Autosave** (debounced) with `edited 2 min ago`; no version history.
- **Meeting notes template:** on a Meeting card a new note starts with attendees and agenda from the email; every `- [ ]` line gets **→ Card** / **→ Jira** on hover.
- **Masking applies to notes:** secrets pasted into a note are masked on save and revealed like email credentials.

**Attachments**
- Files on cards by drag from the desktop, 📎, or paste. 25 MB per file; per-user quota set by the admin. Stored on a Docker volume; S3-compatible storage (MinIO) is F.
- **Email attachments are never stored** (FR-ING-003): opening one streams it on demand from Gmail (`messages.attachments.get`, within `gmail.readonly`).
- **Previews:** image thumbnails and PDFs in a sandboxed viewer; everything else downloads. Always `Content-Disposition: attachment` + `nosniff`.
- **No virus scanning** (ClamAV rejected: ~1–1.5 GB RAM).

## (12) Sending / requesting tasks between users — FUTURE (entire item)

Recorded for continuity; nothing here is built in the MVP.
- **Same organisation, in-app:** Assign to ▸ / `@person`; recipient sees `↘ from …` with Accept · Decline (reason) · Ask; status flows back live; sender sees status only, never the recipient's notes. Would be `actions` rows with assigner, assignee and assignment status.
- **Requests view:** separate **Received** and **Sent** tabs; health chip **On track · At risk · Blocked · Done**, **Late** automatic after the due date; progress control snapping to 0 / 25 / 50 / 75 / 90 / 100 %; update history with notes; automatic At risk when < 25 % of time remains and progress < 75 %; requester notified on accept/decline, status changes, milestones (50 / 90 / 100 %) and Late, not on every change; Nudge after the due date.
- **External recipients:** **"Send as email"** opens the user's own mail app (`mailto:`) with a task block and a `[SECEP-XXXX]` reference; no `gmail.send` scope. Replies are linked by Gmail thread + reference; external requests can only show Awaiting reply → Replied.
- **Resources:** read-only shared copies of files, links and notes.
- **Signed watermark:** not needed — thread ID + reference code already link replies; an HMAC key cannot be verified outside the organisation. Revisit only with a real cross-organisation use (Ed25519, published key).
- Effort noted for planning: core ~2.5–3 person-days; progress/history/nudges another ~2–3.

## (13) Reminders & notifications — decided (S)

- **Automatic reminders from due dates:** **21:00 the night before · 09:00 on the due day · 1 h before** (if a time is set) **· 24 h before for Critical**. User-adjustable. Reminders within 30 min of each other merge.
- **Snooze / "Remind me"** (`h`, right-click): Later today · Tomorrow 9 am · Next week · Pick a time. The card **drops to the bottom of its column**, ~55 % opacity, below a collapsible **"Snoozed · 3"** divider; returns to its normal place with `⏰` when due. Header counts exclude snoozed cards.
- **Channels:** in-app (toast, bell, ambient glow) **S**; **Web Push** (service worker + `web-push`, self-generated VAPID keys; iPhone only when installed to the home screen, iOS 16.4+) **S**; email **F**.
- **Daily digest by push** at a user-chosen time (default 08:30), e.g. *"Today: 3 due, 2 Critical unread"*; tapping opens the dashboard.
- **Meeting mode:** meeting time from the email (invite file or decoder proposal) or Google Calendar.
  - 15 min before: notes and attachments (≤ 25 MB) prefetched for offline use.
  - 5 min before: push + toast *"Standup in 5 min · 2 notes · 1 file"*; opens **Meeting mode** (notes, attachments, agenda, attendees, Join link).
  - At start: slim **"Now: Standup"** strip under the topbar until the scheduled end.
- **Pop-up rules, user-chosen** (asked on first sign-in, editable): separately for **Normal · Focus mode · Quiet hours**, which new-email urgencies pop up (*All · Medium+ · High+ · Critical only · None*) and whether **Negative / Frustrated** pops up regardless. Defaults: Normal = High+ and Frustrated; Focus = Critical only; Quiet = none. Quiet hours default 22:00–08:00 local. Non-popping items arrive silently.
- **Good manners:** reminders within a minute batch into one; push action buttons *Done · Snooze 1 h* on Chrome/Edge; missed reminders wait in the bell.
- **Scheduler:** `reminders` table in PostgreSQL + Redis sorted set by fire time; M6 worker every 15 s; idempotent; rebuilt from PostgreSQL if Redis is lost.
- Effort: in-app + scheduler + snooze ~2–2.5 person-days; Web Push +1–1.5.

## (14) Calendar — decided (S)

- **No Google Calendar iframe:** private calendars need third-party cookies (blocked by Safari/Firefox), it cannot accept drops or open our cards, cannot be styled, and loads ~1–2 MB.
- **One Calendar, built in two steps** (the user sees one merged view):
  - Step A — SECEP's own entries: meetings from emails, due dates, reminders, tasks. No permission needed; also the fallback if Calendar access is declined.
  - Step B — the user's Google calendars via `calendar.events` (already planned in the SRS): all calendars, colour-coded, per-calendar toggles. Needed for the goal of never switching tabs.
- **Sync:** incremental (`syncToken`), every ~5 min while visible.
- **Calendar button:** sidebar **Calendar** entry with a calendar icon (replaces "Agenda"), shortcut `g c`, opens a full-screen **Day · Week · Month** view. Tile views: Day timeline (small), 3-day / Week (large), Agenda list on phone; red now-line.
- **Create from the calendar:** click or drag an empty slot → popover with **Event · Task · Reminder**.
  - **Event** → written to the user's **Google Calendar** (Meet link toggle); Google's own notifications then work everywhere.
  - **Task** → stays in SECEP (no Google Tasks, no `tasks` scope).
  - **Reminder created in the calendar** → **always also creates a short Google event** (`⏰ Call the bank`) with a pop-up alert. If Calendar is not connected, saved in SECEP with a notice. Automatic reminders (due dates, snoozes) never go to Google.
- **Own Google events:** popover **Edit** (title, time, attendees, description, Meet link) and **Delete** (confirm; notify attendees) in place — **S**. Others' events: **RSVP only**.
- **No drag-to-reschedule** of Google events.
- Drop a card onto a slot → event (item 8). Click a SECEP meeting → its card and Meeting mode. "Open in Google Calendar" link for the rest.
- **Timeline built in-house** with CSS grid (~10 KB); FullCalendar (~80–100 KB) rejected.
- Effort: ~3–3.5 person-days for both steps plus create/edit.

## (15) Lock screen & living wallpaper — decided (S)

**Lock screen (desktop)**
- Large clock, date, weather of the wallpaper place, **glance line with counts only** by default (*"3 Critical · next: Standup 11:00 · 5 due today"*; subjects opt-in), stacked recent notifications.
- **Doubles as the loading screen:** built into the page's static HTML/CSS (~5 KB) with the wallpaper cached, so it paints within ~0.3 s while the app boots behind it; glance counts fade in when data arrives.
- **Stays until the user clicks or presses a key**, with a **"Skip lock screen"** setting.
- **Loading indicator (if entered before ready):** a boxed, low-opacity **"Loading"** label at the **right middle**; a spinner segment travels around the box outline and **lengthens with load progress until it covers the whole outline** at 100 %, then SECEP enters. Progress comes from weighted real boot steps (JS chunks, `/me`, layout, `/emails`, socket). No bottom bar.
- Entering: the sheet rises into place while the wallpaper settles back (Framer Motion).
- **Idle return:** after a user-set idle period (default 15 min; can be off) → back to the lock screen, content hidden. **Cosmetic privacy curtain** only; real security is the computer's own lock; the admin may optionally enforce Google re-sign-in after X hours.

**Phone**
- System splash (icon + colour) → our wallpaper with clock and glance as the loading screen → **dissolves into the dashboard automatically** when ready. No idle lock.

**Expected load times (estimates; verify after build)**

| Situation | Estimate |
|---|---|
| First visit, laptop, 10 Mbps | ~1.2–2 s |
| Repeat visit, laptop (cached shell) | ~0.5–1 s |
| First visit, mid-range phone, 4G | ~2–3.5 s |
| Repeat visit, phone | ~0.8–1.5 s |

**Living wallpaper — "My places"**
- Users add **their own places** (home, a favourite spot): up to **5 places**, each with **1–5 photos** for **dawn · day · golden hour · dusk · night**. Fewer is fine: the nearest photo covers the gaps (2 = day + night; 1 = all day, auto-dimmed at night).
- **Smart assist:** photo timestamp suggests the phase, photo location suggests the city; the user confirms. **Only the city is kept; all photo metadata is stripped.**
- **Sun to follow:** user option per place — **that place's own time** (a window home) or **my local time**.
- **Home weather:** topbar chip shows the place's weather (Open-Meteo, free, no key).
- **Focal point** per photo so the floating sheet and the phone's portrait crop never cover what matters.
- **Several places:** pick one or rotate daily.
- **Curated places** (6–8; team's own or Unsplash/CC0 photos, credited in Settings › About) only as the fallback for users without their own.
- Sun position via `suncalc` (~3 KB), checked every 5 min, cross-faded over ~60 s.
- Inside the app: visible only around the floating sheet, dimmed ~20 %, adaptive text colour.
- **Cost control:** loads after the first useful screen behind a ~30-byte blurred placeholder; only current + next photo fetched (AVIF/WebP, 150–300 KB); uploads resized to screen sizes (~3 MB per place); data-saver / low-end devices get one static photo. **Video wallpapers rejected. Weather effects: F.**
- Effort: base ~2 person-days + ~1.5–2 for custom places, plus photo curation.

## Data model & API

All additions from items 1–15 are specified in **SRS v1.1**: migration `003_v1_1_addendum.sql` (6.6), API additions (6.5), configuration keys (6.8). Highlights: `user_layouts`, `projects` + `email_projects` / `card_projects`, `project_rules`, `user_tags` / `email_tags` / `card_tags`, `user_label_rules`, `notes`, `files`, `reminders`, `notifications`, `push_subscriptions`, `calendar_sync` / `calendar_events`, `wallpaper_places`, `users.ui_prefs`, pin/snooze columns, `pg_trgm`, and `triage.v1` source `"rule"`.

## Future & rejected (summary)

- **Future:** all of item 12 (in-app assignment, Requests sent/received with progress and health, "Send as email", resources, signed watermark); shared projects; AND/OR filter builder; in-attachment search; natural-language search; time-aware pages; drag-based phone tiling; MinIO storage; email digest; weather effects on wallpaper.
- **Rejected:** Google Calendar iframe; Google Tasks / `tasks` scope; drag-to-reschedule Google events; rich text editors; ClamAV; FullCalendar; video wallpapers; 5-second delay before Jira/Calendar actions; `gmail.send`.

## Open reminders

- When the frontend is built and shown, **revisit whether hover quick-actions still feel right**.
- After build, **check animation cost** (bundle size, frame drops on mid-range laptops and phones) and dial back if needed.
- After build, **measure the real load times** against the estimates in item 15.
