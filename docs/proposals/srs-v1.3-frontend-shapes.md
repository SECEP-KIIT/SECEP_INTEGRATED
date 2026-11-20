# Proposal for SRS v1.3: frontend wire shapes

Status: **PROPOSED**, not yet in the SRS. The frontend (M8) is built against these shapes on MSW mocks. They are typed in `frontend/src/api/types.ts` under "PROPOSED (pending SRS v1.3)". Each shape below names the route (SRS §6.5) or column (§6.6) it comes from. Conventions follow §6.4.1: snake_case, ISO UTC timestamps, arrays never `null`, lists as `{ items, next_cursor }`, errors in the §6.4.1 envelope.

Found while building task 4 (shell and lock screen). Later tasks will add to this file.

## 1. Read / unread state

**Gap:** FR-UI-002 (red Critical dot), FR-UI-005 (ambient glow) and FR-UI-021 (Unread quick chip) all need read state. Nothing in §6.4.1 or §6.6 stores it, and the Gmail scope is `gmail.readonly`, so SECEP can't use Gmail's UNREAD label as its own.

**Demo simplification (mock only):** the mock keeps read state internally, one reader per email. It is **not** a wire field yet. If a later task needs it on the card, the field would be `EmailListItem.read: boolean`, set via `PATCH /emails/:id { read }`.

**Production shape (proposed for M6/M7):** read state is **per recipient**, not a column on `emails`:

```sql
CREATE TABLE email_reads (
  email_id uuid NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (email_id, user_id));
```

`EmailListItem.read` is then computed for the caller. A single `emails.read_at` column must not become the final design. It assumes one reader per row and would break shared or delegated mailboxes. Task 5's mock store keeps read state in a per-user structure for the same reason.

## 2. `GET /me/glance`

§6.5 names the route ("Counts for the lock screen glance line"); no shape is given. It also feeds the sidebar count badges (FR-UI-002), so no extra endpoint is needed.

```json
{
  "counts": { "inbox_unread": 12, "critical_unread": 3, "board_todo": 4, "due_today": 5, "overdue": 1, "security_flags": 2 },
  "next_event": { "title": null, "start": "2026-11-04T05:30:00Z" },
  "subjects": null
}
```

- `security_flags` is `null` unless the caller has `security.review`.
- **Lock-screen privacy (FR-WP-001):** with `ui_prefs.glance_subjects` off (the default), `next_event.title` and `subjects` are `null`. The server enforces this, so a passer-by never sees content, only counts and a time.
  - **Decided (2 Nov):** event titles are gated like senders and subjects, under the same lock-screen threat model. The line keeps the time and reads "Next event · 11:00". This overrides the frontend-decisions example ("next: Standup 11:00"). If it proves too sparse, task 16 may add a separate calendar toggle rather than overloading `glance_subjects`.

## 3. `GET /notifications`

§6.5 names the route; §6.6 `notifications` has `kind` and a free-form `payload`. Proposed item (list in the §6.4.1 envelope):

```json
{ "id": "3", "kind": "new_email", "title": "New Critical email", "body": "R. Sen: Q3 board deck: final numbers by Friday 5 pm",
  "target": { "type": "email", "id": "uuid" }, "read_at": null, "created_at": "2026-11-04T09:12:40Z" }
```

- `kind`: `reminder | digest | meeting | new_email | jira_status` (the §6.6 comment).
- **Privacy rule:** `title` is generic and **never** contains a sender, subject, event title, card title or Jira issue key. Only the kind and timing may show. Details go in `body`. The lock screen shows only `title` unless `glance_subjects` is on. The bell (task 13) shows both.
  - `title` examples: "New Critical email", "Meeting in 15 min", "Reminder due", "Jira issue updated".
  - Issue keys count as content, because the project key often names a client or project ("ACME-12"). So "ATL-142 moved to Done" goes in `body`.
  - A meeting countdown is timing only, consistent with "Next event · 11:00" on the glance line.
- **ID conflict:** `notifications.id` is a `bigserial`, but §6.4.1 says IDs are UUID strings. Proposal: send it as a decimal string, or change the column to `uuid`.

## 4. `GET /projects`

§6.5 names the route. Proposed item: the §6.6 `projects` columns minus `tenant_id`, `owner_user_id` and `centroid`, plus a derived `progress`:

```json
{ "id": "uuid", "name": "Q3 board meeting", "colour": "#3b5bdb", "icon": "📊", "description": "…", "deadline": "2026-11-07T11:30:00Z",
  "jira_project_key": "ATL", "jira_epic": "ATL-100", "archived_at": null, "created_at": "…", "progress": { "done": 2, "total": 5 } }
```

- `colour` as `#rrggbb`. Item 5 / FR-UI-008 mention 8 swatches; the SRS should say whether `colour` is a hex value or a swatch name.
- `EmailListItem.projects[]` (currently `never[]`) is proposed as `{ id, name, colour, is_primary }`. It's needed from task 6.

## 5. `ui_prefs` keys and `PATCH /me/preferences`

The §6.6 comment names the keys; no types are given. Proposed (all optional; unset = default):

| Key | Type | Default | Used by |
| --- | --- | --- | --- |
| `motion` | `"full" \| "reduced" \| "off"` | unset = follow the OS | FR-UI-032 |
| `skip_lock` | boolean | `false` | FR-WP-001 |
| `idle_minutes` | integer 1–240, or `null` = off | `15` | FR-WP-004 |
| `glance_subjects` | boolean | `false` | FR-WP-001 |
| `sidebar_collapsed` | boolean | `false` | FR-UI-001 (**new key**) |

**Motion rule:** the most reduction wins between `motion` and the OS `prefers-reduced-motion`. An explicit `"full"` overrides the OS.

**`PATCH /me/preferences`** (§6.5 names it; no wire shape):
- Request: a partial object of the keys above. Unknown keys or wrong types → `422 validation_failed` with `details.fields`.
- Response: `{ "ui_prefs": { …the full stored object… } }`. `GET /me` returns the same object in `ui_prefs`.

The frontend mirrors `skip_lock`, `idle_minutes` and `motion` in `localStorage` (`secep.boot`), so the static lock screen can decide before `/me` answers. These values are non-personal and non-secret. The server copy stays authoritative.

## 6. Other notes from task 4

- **FR-UI-002 vs §6.7:** item 1 lists Calendar in the sidebar. It was shown while Calendar was being built (task 14); **Calendar is v2 (19 Nov 2026)**, so the sidebar entry, `/calendar` (redirects Home), the Calendar buttons, menu items, ⇧C key, "Download .ics" and calendar sends from cards are all hidden. The data shapes and mock routes stay for v2.
- **Metrics visibility:** FR-UI-002 doesn't say who sees Metrics. The frontend shows it to admins only, because `GET /admin/metrics` is an admin route.

## 7. Found while building the mock backend (task 5)

1. **`notification.new` payload:** `{ notification: Notification }`, using the item shape from §3. §6.5 names the event; §6.4.1 doesn't define it.
2. **Model `metrics` (`GET /admin/models`):** §6.4.1 says `metrics` without a shape. Proposed (FR-ML-009/012):
   `{ type_macro_f1, urgency_macro_f1, sentiment_macro_f1, per_class_f1: { Task, Info, Credentials, Meeting, Approval }, ece }`.
   Confusion matrices for the model card (§7.2 step 9) can be added in task 15.
3. **Promotion gates:** `409 conflict` with `details.failed_gates` as human-readable strings, e.g. "Approval F1 drops by 0.050 (limit 0.03)".
4. **Accept failures (FR-ORC-006):** §6.4.1 says accept returns "`Action` (… or `failed` with `error`)" and lists `502 upstream_error`. The mock does this:
   - Jira 400/401: `200` with the `Action` in `status: failed` and `error: "Jira 401: …"`.
   - 429/5xx still failing after retries (honouring Retry-After): `502 upstream_error` with `details { provider: "jira", status, message }`, and the action is marked `failed`.
   - **Decision needed:** confirm this split.
5. **Accept on a non-proposed action:**
   - `done` returns the action unchanged (FR-ORC-005).
   - `executing` → `409`.
   - `rejected` → `409`.
   - `reject` is allowed only from `proposed` or `failed`.
6. **User cards (`POST /actions`):** created with `status: "done"` and `board_column: "todo"`, because there's nothing to execute. `PATCH /actions/:id` board moves are allowed only for `done` cards (`409` otherwise).
7. **`GET /links/:checkId/go` for a link still `pending`:** unreachable from the UI (pending links have `check_id: null`). If called anyway: `409 conflict`.
8. **Personal rules (FR-ML-013):** the corrected email itself gets `source: "user"`. Later emails from that sender get `source: "rule"`, and the rule's `hit_count` goes up. The rule is not applied to mail already received. `scope: "similar"` (FR-ML-014, S) is stored as a plain correction until similarity overrides are built.
9. **WebSocket payloads:** the §6.5 one-liner (`email.triaged {email_id, triage}`) and the §6.4.1 table (`{email_id, email: EmailListItem}`) disagree. The mock follows §6.4.1, which is marked final. §6.5 should be updated.
10. **Socket.io transport:** WebSocket only (`transports: ["websocket"]`), with no long-polling fallback. The access token goes in the handshake `auth` payload, never the URL. On `connect_error "unauthenticated"` the client refreshes once and reconnects.
11. **Reveal re-auth in the mock:** `reauth_url` is `/api/v1/auth/google?reauth=1`, a browser navigation, which MSW's service worker does not intercept. The dev panel offers "Re-sign in" instead. Task 15 decides how the UI performs the Google round trip.
12. **Card gap for task 6:** FR-UI-011 shows the sender's *role* on every card, but `EmailListItem` has no sender-role field (`role_category` exists only for users). A shape is needed before task 6, e.g. `from.role_category: RoleCategory | null`.

## 8. Decisions after task 5 (2 Nov 2026)

**Deviations accepted**
1. **Hand-rolled Socket.IO mock** (`frontend/src/mocks/socketio.ts`) instead of `@mswjs/socket.io-binding`. The binding hardcodes the default namespace `/`, so a connect to `/ws` never completes. It also never sends engine.io pings, so socket.io-client drops the connection every ~30 s. The app still uses the real socket.io-client; a test connects it to the mock end to end.
2. **socket.io-client is imported lazily** (`frontend/src/api/realtime.ts`). engine.io-client captures `globalThis.WebSocket` when its module is first evaluated, so a static import would load before MSW patches `WebSocket` and bypass the mock. As a side effect, socket.io-client (12.9 KB gz) moves out of the app chunk. M6 must keep the client config: WebSocket transport, path `/api/socket.io`, namespace `/ws`, token in the handshake `auth`.

**Decisions**
3. **Failed accept (FR-ORC-006): confirmed.**
   - Jira 400/401 → `200` with the action at `status: "failed"` and Jira's message in `error`.
   - Persistent 429/5xx (after retries honouring Retry-After) → `502 upstream_error`, `details { provider: "jira", status, message }`.
   - To be written into §6.4.1 in v1.3 (replaces the "decision needed" in §7.4 above).
4. **`email.triaged` payload: §6.4.1 is final.** The §6.5 WebSocket one-liner (`email.triaged {email_id, triage}`, and the matching lines for the other events) **must be reconciled to §6.4.1 in v1.3**.
5. **`from.role_category`: PROPOSED only.** `EmailListItem.from` (a `Person`) gets `role_category: RoleCategory | null`, using the 7-role enum from §6.6 (`Executive, Manager, Engineer, Analyst, Consultant, Client-facing, Other`). `null` means the sender's role is unknown. It is needed for FR-UI-011 (sender role on every card). It is **not** folded into the final §6.4.1 `Person` shape until v1.3 adopts it. Typed as `SenderPerson` in the PROPOSED section of `frontend/src/api/types.ts`.
6. **Model `metrics` shape (§7.2 above): stays PROPOSED.** Not demo-critical; to be reviewed before task 10.

**Persistence scope, confirmed:** besides prefs, read state, actions, projects and layouts, the mock also persists label corrections and rules, admin users and settings (without secrets), models and the audit log. All of it sits under the same schema-version guard (discard and reseed on mismatch). Secret values and tokens are never persisted. The dev panel keeps a manual "Reset store" button.

## 9. Found while building cards and the column widget (task 6, 2 Nov 2026), **parked for review**

Task 6 builds only what §6.4.1 / §6.5 fully define. The items below have no wire shape or no defined meaning, so they are **not built**, and the unattended run stopped after task 6 instead of continuing to task 7 (halt-don't-invent rule). Each entry names what the UI needs and a suggested shape. The suggestions are proposals only; nothing below is mocked or typed yet.

**Blocking a Must requirement**

1. **Quick chips (FR-UI-021, M): Unread · Due today · Needs my reply · Overdue.** None of the four can be expressed with the §6.4.1 `GET /emails` query.
   - *Unread:* needs read state on the wire (§1 suggests `EmailListItem.read: boolean`, computed per caller from `email_reads`) **and** a query parameter, e.g. `read=false`.
   - *Due today / Overdue:* need an email due date (item 2) and values for the S parameter `due`, which §6.5 names without values. Suggested: `due=overdue|today|week|none`, in the user's time zone (which also needs a source: `ui_prefs.time_zone`, or `tz=` on the request).
   - *Needs my reply:* no definition anywhere. One option: `recipient_position = "to"`, the latest thread message is not from me, and the type is Task, Approval or Meeting. Needs a decision, then a parameter (e.g. `is=needs_reply`, matching the FR-UI-025 `is:` operator).
2. **Email due date (FR-UI-013, M: "due dates as one word of context coloured by proximity").** `EmailListItem` has no due field. The only due dates are in proposed action payloads (`DecoderActionPayload.due_date`), which the list item doesn't carry. Suggested: `EmailListItem.due_at: string | null`, the earliest `due_date` among the email's open actions (with a `due_time` where known). This also feeds the Due filter group, `sort=due` and Smart sort.

**Should requirements**

3. **Projects on cards and the Project filter (FR-UI-017, FR-UI-021).** §4 suggests `EmailListItem.projects[]` = `{ id, name, colour, is_primary }`, with `project=<id>,<id>` as the query value. **Confirm** this before the split dot and chip are built (task 10).
4. **Status filter group (FR-UI-021).** "Status" is undefined: the email pipeline status (`ingested … enrich_failed`), the action status, or pinned/snoozed/read? The S parameter `status` has no values.
5. **Has attachments / notes (FR-UI-021).** No parameter. Suggested: `has=attachments,notes`, mirroring the FR-UI-025 `has:` operator.
6. **Every tag as a filter (FR-UI-014).** Only type, urgency, security and sentiment have parameters, so only those are clickable now. Attachments, replies, duplicates, masked secret, Jira and snoozed need e.g. `has=attachments,replies,duplicates,secret,jira`, plus values for the S parameter `snoozed` (e.g. `snoozed=true|false`).
7. **Facet counts (FR-UI-022) — `GET /emails/facets` has no shape.** Suggested: the same query as `GET /emails`; the response counts each group's options with that group's own selection left out, e.g. `{ "type": { "Task": 12, … }, "urgency": { … }, "sentiment": { … }, "flag": { … }, "total": 48 }`.
8. **Column count and urgency bar (item 3 "count plus a thin bar split by urgency").** `Page` has no total. The header shows the loaded count ("25+") and the urgency split of the loaded cards, which is honest but partial. The facets `total` and `urgency` counts (7) would make it exact.
9. **Smart sort (FR-UI-023).** The weights ("urgency, due proximity, unread and sender seniority, decaying with age") and the per-card explanation (ⓘ) have no shape. Suggested: when `sort=smart`, each item carries `rank_reasons: string[]` (e.g. `["Critical", "Due today", "From an Executive"]`). The mock accepts `smart` and `due` and serves them as newest; the UI doesn't offer them yet.
10. **External sender tag ↗ (FR-UI-014).** "External" depends on `tenants.domains`, which the client never sees. Suggested: `EmailListItem.from_external: boolean`, computed by M6.
11. **`⚡ Jira` vs a count (item 4).** The list item has `proposed_action_count` but not the action types, so the card shows `⚡ 2` ("2 proposed actions"), not `⚡ Jira`. Suggested: `proposed_action_types: ActionType[]`. Optional; the drawer (task 7) lists the actions anyway.
12. **Note tag 📝 and custom tags (FR-UI-014).** Need `EmailListItem.note_count` (or `has_note`) and the `tags[]` element shape (`{ id, name, colour }`). Both come with notes and tags (task 12).

**Needed by task 7 (found early)**

13. **The "Done" quick action (item 3 layer 2: Jira · Calendar · Done · ⋯).** What "Done" means for an *email* is undefined. Options: reject all of the email's open proposals; or mark the email handled, which needs a new field. Needs a decision before task 7 builds the quick actions.

**Smaller notes**

14. **`correction_id` type.** `PATCH /emails/:id/labels` returns `correction_id`. `corrections.id` is a `bigserial`, but §6.4.1 says IDs are UUID strings; the mock sends a number. Same conflict as `notifications.id` (§3); resolve both the same way.
15. **Unknown `sort` values.** The mock answers `400 bad_request` for a value outside `smart|newest|oldest|due|urgency|sender|confidence`, following the §6.4.1 "malformed query" row. The SRS doesn't say; confirm.
16. **Pinned first.** FR-UI-023 says pinned cards stay on top; the mock applies this under every sort, including the Must `newest`.

## 10. Decisions on §9 (2 Nov 2026), resolved for the mock (PROPOSED, pending v1.3)

These were decided by the user after task 6. The mock and the frontend implement them. They stay PROPOSED until SRS v1.3 adopts them.

1. **Quick chips (§9.1): `GET /emails?view=unread|due_today|needs_reply|overdue`**, comma-separated and **AND-combined** (an email must satisfy every listed view), and AND-combined with the other parameters.
   - `unread`: no read row for the current user (`email_reads`, §1).
   - `due_today` / `overdue`: use the derived `due_date` (item 2). `due_today` = `due_date` is today; `overdue` = `due_date` before today, **excluding handled** emails.
   - `needs_reply`: **NEEDS TEAM SIGN-OFF.** FR-UI-021 is a Must with no SRS definition. The mock implements this demo predicate:
     - the thread's latest message is inbound (not from the user);
     - the type is Task, Approval or Meeting;
     - the email has no accepted action (status `accepted`, `executing` or `done`).
2. **Email due date (§9.2): `EmailListItem.due_date: string (YYYY-MM-DD) | null`, the same on `EmailDetail`.** Derived server-side: the earliest of
   - every non-null action `payload.due_date`, and
   - the date of every non-null calendar `payload.start`;
   - else `null`.

   The source of truth stays in `actions`.
3. **"Done" (§9.13): per-recipient handled state.** M6 table: `email_states(email_id, user_id, handled_at)`; the mock keeps a per-user map. **Reversible.** Handled emails are excluded from the default inbox and surfaced through a view. The field is named **handled**, never "done", so it can't be confused with `action.status = "done"`.
4. **Unknown `sort` (§9.15): `422 invalid_parameter`.** This is a new error code for the §6.4.1 table.
5. **`correction_id` (§9.14): a string (UUID).**

**How the mock reads these** (choices made while implementing, flagged for review; none changes the decisions above):
- **Wire field for handled:** `EmailListItem.handled: boolean` (a boolean like `pinned`; `handled_at` stays server-side). Set with `PATCH /emails/:id { handled: true | false }`; §6.5 already lists `PATCH /emails/:id` with `{pinned, snoozed_until}`. The response is the updated `EmailDetail` ("mutations return the updated resource").
- **Surfacing handled:** `view=handled` lists only handled emails. Without it, `GET /emails` omits handled emails. So `view=handled,overdue` is always empty, as overdue excludes handled.
- **Rejected actions don't count towards `due_date`:** a declined proposal isn't a commitment. Confirm.
- **Time zone for "today" and for converting a calendar `start` to a date:** the mock uses the browser's local time zone. M6 needs the user's zone (e.g. `ui_prefs.time_zone`); still open.
- **Unknown `view` values** also get `422 invalid_parameter`. Other malformed parameters (e.g. `type=Spam`) keep their `400 bad_request`; say if those should move to 422 too.

**Resolved in §12.3** (was open): how a read row gets created. Opening an email (implicit), or `PATCH /emails/:id { read }` as §1 suggested? The mock creates none yet, so the Unread chip works on the seeded read state, and opening the drawer doesn't mark anything read. `EmailListItem.read` is still not on the wire.

## 11. Found while building the drawer and actions (task 7, 2 Nov 2026)

1. **Composer assignee, project and epic (FR-ORC-012, M).** FR-ORC-012 says the ⇧J composer is prefilled with "assignee = the user and the primary project's Jira project and epic". The enrich.v1 action payload (§6.4, `DecoderActionPayload`) has no `assignee`, `jira_project_key` or `epic` field, so `POST /actions/:id/accept { payload }` can't carry them, and the mock rejects unknown payload fields.
   - **What the composer does now:** shows only title, description, priority and due date (plus start, end and attendees for events). The issue goes to the tenant's Jira project from `/admin/settings`.
   - **Nothing is invented:** there is no assignee control and no read-only "Assignee: you" text.
   - **Suggested for v1.3:** either M6 always assigns to the user's linked Jira account (then nothing is needed on the wire beyond saying so), or the payload gains `assignee: "me" | null` and `jira_project_key` / `jira_epic`, filled from the email's primary project (§4, task 10).
2. **Popup blocking on link open.** The client opens a link only after the `/links/:checkId/go` round trip. Browsers allow `window.open` for a short time after the click (Chrome's transient activation is about 5 s), so it normally works; with a very slow check it could be blocked. No shape change; a browser check is listed in the task 7 worklog.

## 12. Decisions after the task 6–7 browser pass (2 Nov 2026)

1. **§10 approved,** with one condition: `PATCH /emails/:id { handled }` is **owner-only and per-user scoped**. It changes only the caller's own `email_states` row, and only for an email the caller can read (else 404, as for every other email route). For v1.3, consider merging handled and read into one per-user state endpoint.
2. **§11.1 / FR-ORC-012 composer prefill: partially met.**
   - **Assignee = the current user, now.** M6 assigns the issue to the caller's linked Jira account (§11.1's first option), so nothing new is needed on the wire. The composer shows a read-only "Assignee: you" line, and the mock's simulated Jira records the caller as assignee.
   - **The Jira project and epic prefill is deferred to task 10,** when projects carry their Jira config. The interim (omit the missing fields) stands. FR-ORC-012's remainder is tracked under task 10.
3. **Read-marking (was open in §10): PROPOSED.**
   - **Opening an email marks it read for the current user:** the client sends an explicit `PATCH /emails/:id { read: true }` when the drawer opens. It's per recipient, like handled (an `email_reads` row, §1).
   - **There is also a manual toggle:** Mark unread / Mark read (`{ read: false | true }`).
   - **On the wire:** `EmailListItem.read: boolean` (and on `EmailDetail`), computed for the caller.
   - **Same owner-only rule as handled.** The change goes out to the user's other tabs as `email.triaged`, like other `PATCH /emails/:id` changes.
   - **The Unread chip** (`view=unread`) now reflects live changes. An email read while the Unread chip is on leaves that list, the same way handled leaves the inbox.
   - **Implemented in the mock and the client (qa-pass-2-read).** `read` is in `EmailListItem` and `EmailPatch` (the PROPOSED parts of `src/api/types.ts`); this supersedes §1's "not a wire field yet". A card shows unread as a dot plus a heavier sender name. A failed automatic mark is silent and leaves the email unread.

## 13. Found while planning the tiling dashboard (task 8, 2 Nov 2026): **HALTED, needs a decision**

FR-UI-010 (S) saves layouts per user and device class through `GET, PUT /layouts/:deviceClass` (§6.5). **§6.4.1 defines no request or response shape for it.** The only hint is the §6.6 comment on `user_layouts.pages`: `[{name, order, widgets:[{type, x, y, w, h, title, colour, icon, filter, sort, density}]}]`. Every part of task 8 (pages, tiles, the title-bar menu, the gallery, saving) is built on this model, so nothing has been built.

**What's missing** (each is a needed field or rule, not a detail):
1. **Request and response bodies.**
   - What GET returns when nothing is saved yet: 404, or the starter layout?
   - Whether PUT replaces the whole layout or patches it.
   - Concurrent saves from two tabs: last write wins, or a 409?
   - How the client picks a `deviceClass`: the tablet breakpoint is undefined.
2. **Identity.** There is no `id` on pages or widgets, but duplicate, remove, rename, React keys and moves all need a stable one.
3. **Widget `type` values.** FR-UI-006 lists the views but gives no enum.
4. **`filter`, `sort`, `density`:** no format. Is `filter` a query string, or an object of §6.4.1 `GET /emails` parameters?
5. **`colour`:** "8 swatches" (FR-UI-008), with no names or values.
6. **`icon`:** no value set.
7. **Phone units (FR-UI-009).** Slots are half × 1, full × 1 and full × 2 cards, but neither `x, y, w, h` in slot units nor the slots per one-screen page is defined.
8. **Starter templates Today, Triage and Planning (FR-UI-007):** no contents. Do they come from the server or the client?
9. **Limits:** pages per device (Ctrl+1…9 suggests 9), widgets per page, body size.
10. **Routing.** Does `/` become the paged dashboard, with sidebar Inbox opening the single-column full view (FR-UI-006 "tile or full view")? Today `/` redirects to `/inbox`.

**Proposed shape (for approval; the mock would implement exactly this):**

```ts
type DeviceClass = 'desktop' | 'tablet' | 'phone'   // client: < 640 px phone, 640–1023 tablet, else desktop
// GET /layouts/:deviceClass → 200 Layout. Nothing saved: 200 with the starter pages and updated_at: null
//   (the server owns the templates, so every client gets the same ones). Unknown deviceClass → 400 bad_request.
// PUT /layouts/:deviceClass { pages, base_updated_at } → 200 Layout. Replaces the whole layout (ajv-validated).
//   base_updated_at older than the stored row → 409 conflict with details.current (another tab or device saved).
interface Layout { device_class: DeviceClass; pages: LayoutPage[]; updated_at: string | null }
interface LayoutPage { id: string /* uuid, client-generated */; name: string /* 1–40 chars */; order: number; widgets: Widget[] }
interface Widget {
  id: string                                 // uuid, client-generated
  type: 'inbox_column' | 'board' | 'projects' | 'reminders' | 'calendar' | 'notes' | 'stats' | 'security'
  x: number; y: number; w: number; h: number // grid units. Desktop and tablet: 12 columns, row = 1 card pitch.
                                             // Phone: 2 columns × 4 rows per screen (small 1×1, medium 2×1, large 2×2)
  title: string | null                       // null = the type's default title
  colour: 'slate' | 'blue' | 'teal' | 'green' | 'amber' | 'orange' | 'red' | 'violet' | null
  icon: string | null                        // a Lucide name from a fixed allowlist of about 24
  filter: EmailFilter | null                 // inbox_column only
  sort: 'smart' | 'newest' | 'oldest' | 'due' | 'urgency' | 'sender' | 'confidence' | null
  density: 'compact' | 'comfortable' | 'spacious' | null
}
// The §6.4.1 GET /emails parameters as an object, so ajv can check it and M6 can run it as a query unchanged.
interface EmailFilter {
  type?: EmailType[]; urgency?: Urgency[]; sentiment?: Sentiment[]; flag?: SecurityFlag[]
  sender?: string; received_after?: string; received_before?: string; view?: EmailView[]
}
```

- **Limits:** at most 9 pages and 24 widgets per page; a 64 KB body (413 above it).
- **Save cadence:** the client PUTs 800 ms after the last change (FR-UI-010).
- **Starters**, using only built widgets until tasks 10–15 add theirs:
  - **Today:** Due today, Needs my reply, and Critical + High.
  - **Triage:** Unread, Security (`flag=suspicious,malicious`), and Inbox.
  - **Planning:** Overdue, Inbox sorted by urgency, and a Board tile once task 10 lands.
- **Routing:** `/` is the paged dashboard; `/inbox` stays the full-view column, and sidebar Inbox opens it.
- **Gallery:** lists only widget types that are built. The others appear as their tasks land.

### 13a. Decided (2 Nov 2026): the §13 shape with these amendments; implemented in the mock and the client

- **`filter` is a `GET /emails` query string of filter parameters**, e.g. `urgency=Critical,High` or `view=due_today`. It replaces the `EmailFilter` object above, so there is no second format.
  - **Allowed parameters:** `type`, `urgency`, `sentiment`, `flag`, `sender`, `received_after`, `received_before`, `view`. Not `sort` (a separate field), `cursor`, `limit` or `q`.
  - The mock checks it with the same parser `GET /emails` uses.
  - It is `null` for every widget type except `inbox_column`.
- **Every page and widget has a stable uuid.** The starter layout's ids are stable too, so two GETs of the default return the same layout.
- **`colour`** is one of the 8 names (`slate … violet`), never a hex value. **`icon`** is a single emoji (one pictographic grapheme) or `null`.
- **PUT** `{ pages, base_updated_at }` is a full replace.
  - If `base_updated_at` doesn't match the stored `updated_at` (`null` when nothing is saved), the response is `409 conflict` with `details.updated_at`. The client drops its draft and reloads.
  - `updated_at` is strictly increasing.
- **GET with nothing saved** returns 200 with the starter layout, `is_default: true` and `updated_at: null`. Once anything is saved, `is_default` is `false`.
- **422 `validation_failed`** with `details.fields` covers: an unknown widget `type`, the caps (1–9 pages, ≤ 24 widgets per page), unknown keys, a bad filter, swatch, emoji, sort or density, a position outside the grid, and overlapping phone slots.
  - An unknown `deviceClass` in the path gets 400 `bad_request`.
  - **There is no 413:** the SRS has no such error code, and the caps plus field lengths bound the body.
- **Owner-only:** the row is keyed by the caller's user id from the token, and no request can name another user. Contract test: `layouts are owner-only`.
- **Grid units:**
  - **Desktop and tablet:** 12 columns, with 12 rows per screen. The row height follows the page height, and taller pages scroll.
  - **Phone:** 2 × 4 slots (`w`, `h` ∈ {1, 2}). The row height comes from the available height: 4 rows when each gets at least 110 px, otherwise 3 rows fill the screen and the 4th is a snap-scroll away.
- **Breakpoints:** one constant in `src/lib/breakpoints.ts`: phone ≤ 640, tablet 641–1023, desktop ≥ 1024. The layout device class, the idle lock and all CSS read it. The CSS selects on `<html data-device>`, and a test forbids width media queries.
- **Routing:** `/` is the paged dashboard. `/inbox` is the independent single-column view, and one commented line in `App.tsx` points `/` back at it. ⤢ on a tile opens `/inbox?<filter>&sort=…`.

## 14. Found while building the tiling dashboard (task 8a, 2 Nov 2026)

1. **"Due this week" (Planning starter) has no query vocabulary.** `GET /emails` has no parameter for it: `due` is a reserved S parameter with no values, and `view` has `due_today` and `overdue` only.
   - **Not built.** The Planning starter holds "Needs my reply" only. A comment in `src/mocks/starters.ts` marks where the column goes.
   - **Options:** (a) `view=due_this_week` (due_date from today to the end of the week, excluding handled; needs a week-start rule), or (b) give `due` values, e.g. `due=today|week|overdue`, folding in the two existing views.
2. **"Needs review (least-confident first)."** No `needs_review` filter parameter exists. The starter column is the inbox sorted with `sort=confidence`, so needs-review mail rises to the top, but the column also lists everything else.
   - If it should list only needs-review mail, it needs a parameter, e.g. `view=needs_review` (`triage.needs_review = true`). Confirm.
3. **Home in the navigation.** The sidebar and tab bar gained "Home" (`/`) first, otherwise the dashboard is unreachable. FR-UI-002's list doesn't name it. On phones it takes a tab slot, so Security moves under More (it shows only with `security.review` anyway). Confirm.
4. **Ctrl+1…9:** some browsers keep these keys for switching tabs and never deliver them to the page. Ctrl+←/→, the dots and swipe always work.

## 15. Decisions on §14 (2 Nov 2026), implemented in the mock and the client (PROPOSED for v1.3)

1. **`GET /emails?due=overdue|today|next_7_days|later|none`** (resolves §14.1). It is comma-separated, OR within the group and AND across groups, like `type` and `flag`. It reads the derived `due_date` (§10.2) against the user's local date (§10: the mock uses the browser zone; M6 needs `ui_prefs.time_zone`).
   - `overdue`: `due_date` < today.
   - `today`: `due_date` = today.
   - `next_7_days`: a **rolling** 7 days starting today (today … today + 6), so it includes today.
   - `later`: after those 7 days.
   - `none`: no due date.
   - An unknown value gets `400 bad_request`, like the other filter groups.
   - **The filter popover has a Due group now** (FR-UI-021).
   - `view=due_today` and `view=overdue` stay for the quick chips.
   - **Planning starter:** "Due this week" = `due=next_7_days`, then "Needs my reply".
   - The `due` value fills the reserved S parameter of the same name in §6.4.1.
2. **`GET /emails?needs_review=true|false`** (resolves §14.2): the triage.v1 `needs_review` flag; any other value is `400 bad_request`. The Triage starter's "Needs review" column is `needs_review=true`, `sort=confidence`. The popover has it as a "Review" group checkbox, and it shows as a removable chip.
3. **Home in the navigation** (resolves §14.3). It stays first in the sidebar. **This is a change to FR-UI-002 for v1.3:** "The sidebar shall list Home, Inbox, Board, Calendar, Security and Metrics …".
   - The **phone tab bar** is Home, Inbox, Board, Security, More. Security shows only with `security.review`, as in the sidebar. Calendar sits under More until its full view (task 14).
4. **Known browser limitation, for v1.3** (resolves §14.4): Ctrl+1…9 (FR-UI-007) can be reserved by the browser for tab switching and never reach the page. Ctrl+←/→, the dots and swipe always work. No change.
5. **Over-limit layout saves:** a `PUT /layouts/:deviceClass` above the caps (9 pages, 24 widgets per page) gets `422 validation_failed` with the standard error body (`details.fields`). The server never trims silently. The client refuses the edit before saving ("A dashboard holds up to 9 pages", "This page is full"), so it never sends one.
6. **Short phone screens: a deliberate exception to FR-UI-009's no-scroll rule.** With a screen (viewport) height **below 600 px**, a phone page shows 3 slot rows at a time and the 4th row is a snap-scroll away, rather than cramming 4 rows. At 600 px and taller, all 4 rows fill one screen with no vertical scroll. The layout data is the same 2 × 4 grid either way.

## 16. QA pass 3 (3 Nov 2026): changes for v1.3

Decided after the browser pass on QA pass 2, read-marking and tasks 8a–8c. Each item notes the commit that builds it.

1. **`email.enriched` has no `due_date`** (commit 1, a gap in §10.2). The PROPOSED `due_date` is derived on the server, but the §6.5 `email.enriched` payload doesn't carry it. A Due tile could therefore never count an arrival whose due date appears only at enrichment.
   - **For now:** the client applies the §10.2 rule (the earliest action `due_date` or calendar start date, rejected proposals excluded) to the event's `actions`. One rule in `src/lib/due.ts`, shared with the mock.
   - **For v1.3:** add `due_date: string | null` to the `email.enriched` payload. The server knows the user's time zone; the client uses the browser's.
2. **State changes are live in every session** (commit 1). When `PATCH /emails/:id` changes `handled`, `read`, `pinned` or `snoozed_until`, M6 sends `email.triaged` with the full `EmailListItem` to room `user:{id}`, so every other tab and device of that user settles its lists. The mock already did this, and the client now acts on it (F11 list settling). §6.5 describes `email.triaged` only as the triage result, so it needs one sentence: "also sent when the user's own state for the email changes".
3. **Layouts are ordered lists, not free placement** (commit 2). This changes FR-UI-008 ("a 12-column snap grid") and the §13a widget shape.
   - **Desktop and tablet:** a page is an ordered list of tiles that fill rows of 3 slots, left to right, top to bottom.
     - `small`, `medium` and `large` take 1, 2 or 3 slots.
     - A tile that doesn't fit the rest of a row starts the next one, pushing the tiles after it right, then down.
     - Each row is as tall as its tallest tile.
     - Dragging changes the order: same-size tiles swap; otherwise the dragged tile takes the target's place and the rest move one along.
     - FR-UI-008 for v1.3: "Tiles flow in order into rows of three slots; a tile is small, medium or large (1, 2 or 3 slots); dragging reorders them."
   - **Wire shape:** `Widget` loses `x`, `y`, `w` and `h`, and gains `size: 'small' | 'medium' | 'large'` and `hidden: boolean`. Array order is page order.
     - `size` applies to desktop and tablet; `hidden` applies to phone (commit 4's edit sheet). Both are present on every device class, so there is one shape.
     - `PUT` gets 422 for a bad `size` or `hidden`, and for the old position fields, which are now unknown.
     - The phone overlap check is gone, since nothing is placed.
   - **Migration** (`user_layouts` in M6; mock store schema 4 → 5):
     - sort each page's widgets by `y`, then `x`;
     - size from the width: grid `w` ≤ 4 is small, ≤ 8 medium, else large; phone half width small, full × 1 medium, full × 2 large;
     - `hidden: false`.
   - **Starters:** Today and Triage are three small tiles each (one row); Planning is Due this week (medium) and Needs my reply (small). Desktop and tablet share them.
   - **§15.6 is obsolete:** the phone no longer has slot rows, so the 600 px short-screen exception goes away. Commit 4 replaces the phone model and records the FR-UI-009 change.
4. **Phone dashboard: sections, not slots (option A)** (commit 4). This changes FR-UI-009 ("2 × 4 slot pages, no scrolling").
   - **Home on phone** is the page's widgets as stacked sections in one vertical scroll. Each section has:
     - a title and count;
     - its top 3 cards;
     - "See all n →", which opens the full column (`/inbox` with the widget's filter and sort).
   - Nothing scrolls inside a section, and new mail shows as "↑ n new" (FR-UI-024).
   - **Page switcher:** a segmented control at the top (Today | Triage | Planning | +) replaces the dots and the swipe. Phones don't use a horizontal swipe for pages.
   - **One slim header row:** the page switcher and Edit. There's no separate title or "Starter layout" row; the save state shows in the edit sheet.
   - **Editing:** Edit opens a bottom sheet listing the page's sections. Each row has a drag handle to reorder it and a switch to show or hide it, plus Add widget, the page name and Delete page (with the 10 s undo). The 8b long-press / ghost-slot editor is gone.
   - **Card actions on touch:** no hover bar. A tap opens the drawer; a long-press opens an action menu: Jira, Calendar, Done, Pin, Open.
   - **Layout data:** phone layouts store order plus `hidden`, the §16.3 shape (no slots). `size` is ignored on phone.
   - FR-UI-009 for v1.3: "On phones each dashboard page is a vertical list of sections, one per widget, each showing its top three items and a link to the full view; a segmented control switches pages; Edit opens a sheet to reorder, hide, add and remove sections; a long-press on a card opens its actions."
   - §15.6 (the 600 px short-screen exception) no longer applies.
5. **Lock screen on phone: the Loading box sits bottom centre** (commit 4). It's above the safe area and clear of the notifications, instead of right middle over them. Desktop keeps right middle. This changes FR-WP-003 for v1.3: "…a boxed Loading indicator at the right middle (bottom centre on phones)…"
6. **Dark mode: new scope, a v1.3 addition** (commit 5; not in SRS v1.2).
   - **`ui_prefs.theme: 'light' | 'dark' | 'auto'`** (PROPOSED). Unset means `auto`, which follows the system's `prefers-color-scheme` and changes with it.
     - It's saved through `PATCH /me/preferences`; any other value gets `422 validation_failed`.
     - It's mirrored to the `secep.boot` boot preferences (one keyword, nothing personal), so the theme is right before the app paints.
   - **What it covers:** the sheet, columns, cards, chips, drawer, popovers, sheets, menus and dashboard tiles. The lock screen, the wallpaper and the frosted bars keep following the wallpaper tone, as before.
   - **Contrast:** all text meets AA, and marks, edges and focus are at least 3:1. The ratios are recorded in `tokens.css`, including the urgency marks, the security and due tags, and sentiment.
   - **Where to choose it:** in the avatar menu (desktop and tablet) and on the More page (phone) until the Settings page (task 16).
   - New text for v1.3, next to FR-UI-032 (motion): "The user can choose a Light, Dark or Auto (system) theme; the choice is stored in ui_prefs.theme and applied on every device."

## 17. QA pass 4 (18 Nov 2026): changes for v1.3

Scope note: phone work moves to **Version 2** (next semester), together with the Future items. F12 (phone back navigation) is deferred there.

1. **Widget sizes are 1x, 2x and 3x** (F17). Labels only: the wire values stay `small | medium | large` (one, two or three slots wide). Every tile is the full row height, or half of it when stacked.
2. **Stacked widgets** (F18). `Widget` gains **`stacked: boolean`** (required):
   - `true` means the widget shares the slot of the widget before it, the two at **equal half height**.
   - At most two per slot: a stacked widget must follow an unstacked one, and it has that widget's `size`. `PUT /layouts/:deviceClass` returns **422** otherwise (`…stacked` or `…size`).
   - A pair moves, resizes and duplicates as one slot. Removing either gives the other the full slot back.
   - Desktop: dropping a tile on the **lower half** of a tile that's alone in its slot stacks it there. The widget menu also has "Stack under the tile before" and "Unstack", for the keyboard.
   - Phones ignore `stacked` and show the widgets as sections in order.
   - **Migration** (`user_layouts.pages` jsonb, M6; mock store schema 5 → 6): add `stacked: false` to every saved widget. No table change; `001_init.sql` is unaffected.
3. **Hover lift** (F13, F14): the copy's own tag strip opens to every tag inside the card, instead of a separate tag box. Jira, Calendar and Done are solid accent buttons. No wire change.
4. **Tile header on two lines** (F15), and the **widget menu** opens beside the tile (F16). The menu holds the tile's quick filters, and the colour and icon pickers show only the current choice until opened. The filter popover on a tile is headed "This tile's filter". No wire change.

## 18. QA pass 5 (18 Nov 2026): projects on the wire, no Reveal

1. **Projects API** (§6.5 v1.1 names `/projects` and "add or remove emails and cards; set primary"; shapes PROPOSED here):
   - `GET /projects` (active first, then archived; each oldest first), `GET /projects/:id`, `POST /projects` (201), `PATCH /projects/:id`. Request fields are the §6.6 columns a user sets: `name` (≤ 60), `colour` (`#rrggbb`, stored lower case), `icon` (one emoji), `description` (≤ 500), `deadline`, `jira_project_key` (like `ATL`), `jira_epic` (like `ATL-100`). PATCH also takes `archived: true | false`; archiving replaces deletion (FR-UI-016). `Project.progress` is derived: done / total of the board cards that come from the project's emails or are filed in it.
   - **§18.2** `POST /projects/:id/items {email_id | action_id, primary?}` returns `{project_id, email_id, action_id, is_primary, added_at}`. The first project an item gets is primary (FR-UI-017); `primary: true` moves it. Adding an item that is already there only applies `primary`. `DELETE /projects/:id/items/:itemId` takes the email or action id (204); when the primary leaves, the oldest remaining project becomes primary. Archived projects take no new items (409).
   - **§18.3** `GET /actions?project=<id>`: a project's cards (its board).
2. **`EmailListItem.projects`** = `{id, name, colour, is_primary}[]`, primary first, then in the order added (confirms §4 / §9.3). `project=<id>,<id>` filters `GET /emails` (FR-UI-021), and is valid in a saved widget filter. The mock seeds the Q3 deck and the Pune trip into their projects; so does `seed-demo.js`.
3. **§18.4 No Reveal** (team decision, 18 Nov): SECEP never holds or shows a credential's value. The pipeline replaces it with its type; the drawer lists only the types and links to the message in the user's own mail app. Changes:
   - `POST /secrets/:id/reveal` is **removed**, and FR-SEC-008 (re-auth for Reveal) with it. FR-SEC-007 reads "masked with its type; the value is never stored".
   - `EmailDetail.open_url: string | null`: the message in Gmail on the web (`https://mail.google.com/mail/?authuser=<mailbox>#all/<provider_message_id>`), built by M6.
   - **For M7 (Ampa):** `masked_secrets.value_enc` should become nullable or be dropped. Until then the demo seeder stores a fixed encrypted placeholder.
4. **Starter layout gains a fourth page, "Handled"**, with one 3x Handled column. "See" on a Mark-handled toast opens it; a layout saved before it existed gets the page added at the end (no page added at the page cap: the Handled full view opens instead). No wire change.

## 19. Task 12 (19 Nov 2026): user cards, notes and files on the wire (PROPOSED for v1.3)

The §6.6 tables (`actions` with `origin = user`, `notes`, `files`, `masked_secrets.note_id`) and the §6.5 v1.1 route names already exist. What follows are the shapes and rules the SRS does not give.

1. **User cards (FR-CNT-001/002).**
   - `POST /actions {type: "add_board_card", payload}` validates the §6.4 user-card payload: `title` 1–120; `description` ≤ 2000; `due_date` `YYYY-MM-DD`; `due_time` `HH:MM` (needs `due_date`); `urgency` one of the four labels; `checklist` ≤ 50 items of `{text: 1–200, done: boolean}`; `source` `in_person | call | chat | null`; `person` ≤ 120. The card is created `done` in To do (as in §6 note 6) and returned with 201.
   - `PATCH /actions/:id` (v1.1 "adds `{payload}`"): a partial user-card payload, merged and re-validated. Only for `origin = user` cards with no email (`409` otherwise: decoder actions are edited when accepted). `board_column` and `board_position` stay a pair; a body may hold either the pair, `payload`, or both.
   - **New: `DELETE /actions/:id`** (204) for user cards only (`409` for any other action). The client's Undo re-creates the card from the payload it held (a new id). Audited without content.
   - **`Action.projects`** = `{id, name, colour, is_primary}[]` (the `EmailListItem.projects` shape): a user card's projects, primary first; `[]` for an email's actions, whose email carries them.
   - Quick-add files a card into its `#project`s with `POST /projects/:id/items {action_id}` (§18.2, unchanged).
   - **Open:** "Send to Jira / Calendar" from a user card (FR-CNT-002 "same actions") needs an action with no email that points at the card. Suggested: `POST /actions {type: "create_jira_issue" | "add_calendar_event", payload, card_id}` → a `proposed` action, accepted as usual. Not built until agreed.
2. **Notes (FR-CNT-003/004/005).**
   - `Note = {id, target_type: "email" | "card" | "project" | null, target_id: uuid | null, body, created_at, updated_at}`. `body` is markdown-lite, at most 20 000 characters, and is returned **masked**.
   - `GET /notes?target_type=&target_id=` (both or neither; neither = every note of the user, newest edit first; `target_type=none` = standalone only). `POST /notes {target_type?, target_id?, body}` → 201. `PATCH /notes/:id {body}`. `DELETE /notes/:id` → 204. A target the user doesn't own → 404.
   - **Masking (FR-CNT-005, after §18.4):** on save, secrets are replaced by `[MASKED:<type>]` (M5 `POST /v1/mask` when it runs, otherwise M6's local copy of the same patterns). A `masked_secrets` row per secret keeps its type with `note_id`; the value is never kept (the encrypted placeholder until `value_enc` is nullable). There is no Reveal.
   - `EmailListItem.note_count` (int): the 📝 tag (§6 note 12). The project view counts its own notes from `GET /notes`.
   - Meeting template (FR-CNT-004) is client-side: a new note on a Meeting email starts with `## Attendees` (from/to/cc) and `## Agenda` (the summary). Each `- [ ]` line offers → Card (`POST /actions`) and → Jira (`POST /emails/:id/actions`, the email's composer).
3. **Files (FR-CNT-006/007/008).**
   - `FileRef = {id, target_type: "email" | "card" | "project", target_id, filename, mime, size, created_at}`.
   - **New: `GET /files?target_type=&target_id=`** lists a target's files, newest first.
   - `POST /files` (multipart: `target_type`, `target_id`, `file`) → 201 `FileRef`. Over 25 MB → 413 `file_too_large`; over the user's quota (`settings.file_quota_mb`, default 500) → 413 `quota_exceeded`. Only the filename's last path part is kept, cut to 200 characters.
   - `GET /files/:id` → the bytes with `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`. `?inline=1` is allowed for images and PDFs only: it serves `inline` (still sandboxed) for the preview. The client always fetches with the bearer token and shows a blob URL.
   - `GET /emails/:id/attachments/:index` (FR-CNT-007) uses the `index` from `EmailDetail.attachments` (the SRS says `attachmentId`; the index is what the client has). Streamed from Gmail, never stored; same headers. The mock serves a small generated file. **For M1:** Gmail's `attachments.get` needs the attachment id, so each `emails.attachments` element should also keep `attachment_id`. Until it does (and M6 has the mailbox's Google token), M6 answers 503 `unavailable`.
   - **Preview (FR-CNT-008):** the client fetches with the bearer token and shows a blob URL: images in an `<img>`, PDFs in the browser's own PDF viewer inside an iframe (that viewer runs in the browser's sandboxed process; a `sandbox` attribute would stop it rendering at all). HTML, SVG and everything else only download.
   - The mock keeps uploaded bytes in memory, so they last until a reload.
   - Pasting or dropping a file on the dashboard creates a user card titled with the file name and attaches the file (FR-UI-030).

## 20. Task 12 follow-up and task 13 (19 Nov 2026): notes without masking, email files, reminders (PROPOSED for v1.3)

**Changes to §19 (decided by Sky, 19 Nov, after browser testing):**

1. **Notes are not masked.** A note is the user's own jotting; masking made a typed password unrecoverable. `POST/PATCH /notes` store the body as typed. This replaces the masking rule in §19.2: FR-CNT-005 and the §6.5 row "Notes CRUD (masked on save)" should read "stored as typed". No `masked_secrets` rows are written for notes, so the §19 request to Ampa (nullable `value_enc`) now concerns emails only. The M6 mask copy (`backend/src/services/mask.js`) is removed. The rule still holds for email bodies: the site never handles credential values.
2. **Files can hang on an email.** `target_type` of `POST /files` and `GET /files` is `email | card | project`. The schema (§6.6 `files.target_type`) already allows `email`; only the route list in §19.3 said card and project. Same checks: the email must be the caller's own (404 otherwise), 25 MB a file, quota.
3. **No note template.** FR-CNT-004 (a Meeting email's note starts with attendees and agenda) is dropped for now. A note is free text; attachments sit beside it. The project page shows notes and files as pills in one box.

**New for task 13 (reminders and notifications):**

4. `POST /notifications/read` (§6.5 names it): body `{ ids?: string[] }`. With `ids`, those notifications become read; without, every unread one. Response `204`. Ids that belong to someone else are ignored. Ids are UUID strings in the schema (`notifications.id` is `uuid` in `001_init.sql`), so the earlier bigserial concern in §3 is resolved on the database side; the mock still sends decimal strings.
5. **Snooze** reuses `PATCH /emails/:id { snoozed_until }` (§6.5 v1.1). A snoozed email sinks below a "Snoozed · n" divider in its column and returns with ⏰ until opened. **Not built:** snoozing board cards. `actions` has no snooze column; adding `actions.snoozed_until` and `PATCH /actions/:id { snoozed_until }` is the suggested change if cards should snooze too (FR-REM-002 says "card").
6. **Automatic reminders (FR-REM-001):** 21:00 the day before, 09:00 on the due day, 1 h before when a time is set, 24 h before for Critical; reminders within 30 min merge into the later one. Each fires once as a `notification.new` event (`kind: "reminder"`, `title: "Reminder due"`, `body` = the item's title, `target` = the email or card), which the client shows as a toast and in the bell. The mock runs this every 15 s from due dates (emails and open user cards) and remembers what fired. **M6 does not yet:** it needs the `reminders` table, the 15 s tick, exactly-once firing, and the Redis index (FR-REM-003).
7. **Deferred (flashy, on hold for time):** Web Push and `POST /push/subscriptions` (FR-REM-004 push part), daily digest (FR-REM-005), Meeting mode and the "Now:" strip (FR-REM-006), pop-up rules per Normal / Focus / Quiet (FR-REM-007, with the settings task 16), manual `GET/POST /reminders` and the "Remind me" on cards.

## 21. Task 13 polish (19 Nov 2026): manual reminders, note files, snooze vs handled (PROPOSED for v1.3)

1. **Manual reminders ("Remind me", FR-REM-002).** Uses the routes §6.5 already names. Shape (the `reminders` table of §6.6, manual rows only):
   `Reminder { id, kind: "manual", target: {type: "email" | "card", id} | null, title, fire_at, status: "scheduled" | "fired" | "cancelled", fired_at }`.
   - `GET /reminders?status=` (own, by `fire_at`), `POST /reminders {target?, title 1–200, fire_at}` → 201 (`fire_at` must be in the future; the target must be the caller's own, else 404), `PATCH /reminders/:id {fire_at?, status?: "cancelled"}` (only while `scheduled`), `DELETE /reminders/:id` → 204.
   - When `fire_at` passes the reminder fires once: a `notification.new` event with `kind: "reminder"`, generic `title: "Reminder due"`, `body` = the reminder's title (the email subject by default), `target` = the email or card. The email is not hidden or moved (unlike snooze).
   - M6: `backend/src/api/reminders.js` plus a 15 s `fireDueReminders()` tick on PostgreSQL (`FOR UPDATE SKIP LOCKED`, status set and notification inserted in one statement). Redis index and the automatic due-date reminders (§20.6) are still M6 to do.
   - Not built: Google mirror of manual reminders (FR-CAL-004) and "Remind me" on board cards (the card menu has no entry yet; the API already accepts `card` targets).
2. **Files inside a note.** No schema change. A file attached from a note is uploaded to that note's own email, card or project (`POST /files`) and the note body holds `[file:<uuid>]`. The client shows the token as a chip; a deleted file shows "File removed".
3. **Handled mail is not snoozed.** The client ignores `snoozed_until` once an email is handled: no ⏰, no "Snoozed" divider, no dimming on the Handled page. No API change.
4. **UI only:** reminders and meetings drop in from the top of the screen (12 s, dismiss or click to open the target), the bell badge is red and pops when the count grows, `r` and "Remind me" in the card menu and the email drawer.

### 21.5 Fix round (task 15, 19 Nov 2026)

- **Snooze removed from the UI** (Sky's call): no Snooze menu item, `h` key, drawer button, "Snoozed · n" divider or ⏰ tag. "Remind me" (`r`, right-click, drawer, and "Remind me about all" for a selection) is the only way to come back to an email later. `PATCH /emails/:id {snoozed_until}` stays in the contract but the client no longer sends it; FR-REM-002's "card drops to the bottom" part is not built.
- **Notes save on Save** (or Ctrl+Enter), not while typing. Cancel discards changes and deletes files attached during that edit. Closing the drawer with unsaved text still saves it, so nothing is lost. Escape closes only an unchanged note.
- **Top alerts:** 5 s, a blue ring beside × that runs once over the 5 s, paused while hovered or focused.
- **Bell badge:** the real count, no "9+" cap.

## 22. Settings page (task 16, lean; 19 Nov 2026) (PROPOSED for v1.3)

1. **`/settings`** edits the existing `ui_prefs` keys through `PATCH /me/preferences`, saved on change: theme (Light / Dark / Auto), motion (System / Full / Reduced / Off, FR-UI-032), sidebar collapsed, skip lock screen, idle return (Never / 5 / 15 / 30 / 60 min, FR-WP-004), lock-screen subjects (`glance_subjects`).
2. **`ui_prefs.motion` accepts `null`** to clear it, meaning "follow the system". Mock and M6 validators updated.
3. **Not built (v2):** wallpaper places with photos, EXIF suggestions, renditions, suncalc per place and the weather chip (FR-WP-006–009, `/me/places`); pop-up rules and quiet hours (FR-REM-007); digest time and reminder defaults. The wallpaper stays the built-in sun-phase gradient.

## 23. An email in a project is a task (19 Nov 2026) (PROPOSED for v1.3)

1. **Adding an email to a project** (`POST /projects/:id/items {email_id}`) gives it a board card if it has none: `type: add_board_card`, `origin: "rule"`, `status: done`, `payload.title` = subject, column **To do** (or **Done** if the email is already handled). One card per email, shared by every project it is in; it counts in project progress.
2. **Handled ⇄ Done:** `PATCH /emails/:id {handled: true}` moves the email's card to Done; `false` moves it from Done back to To do. Moving the card into Done (`PATCH /actions/:id`) marks the email handled; moving it out marks it not handled. Both send the usual `action.updated` / `email.triaged` events.
3. **Project board accepts emails:** dropping emails from a list onto a To do / In progress / Done column files them in the project (rule 1) and moves their cards there.
4. Seed data and saved mock snapshots are backfilled on load. **M6:** not built yet (same rules in `projects.js`, `emails.js`, `actions.js`, plus a one-off backfill).
5. **Lock screen subjects** (when opted in) show at most three distinct subjects, then "and n more".

## 24. Metrics as a widget, lock now, readable lock screen (19 Nov 2026) (PROPOSED for v1.3)

1. **No Metrics page.** FR-UI-002's "Metrics" nav item is replaced by a **Stats** home widget (`type: "stats"`, already in the WidgetType enum): everyone sees today's counts from `GET /me/glance`; admins also see the classifier over 30 days from `GET /admin/metrics` (volume per type, correction rate, confidence histogram). `/metrics` redirects to Home. The Planning starter page gains the Stats tile (mock and M6 starters). Non-column widgets keep `filter: null`.
2. **Lock now:** a lock button in the topbar and **Alt+L** bring up the lock screen at once (the same curtain as the idle return, FR-WP-004). Desktop only.
3. **Lock screen glance:** one frosted chip per fact (Critical, next event with its time, due today, overdue); opted-in subjects in one card headed "Critical unread" (three distinct at most).
4. **Board lanes** are lightly colour-coded (To do blue, In progress amber, Done green), with the existing ○ ◐ ● shapes kept.

## 25. Admin page, richer classifier stats, Jira target (19 Nov 2026) (PROPOSED for v1.3)

1. **`GET /admin/metrics` gains urgency and sentiment** (additive; the v1.1 type fields are unchanged): `urgency` and `sentiment`, each `{ volume: { <label>: n }, override_rate: { <label>: 0.04 }, confidence_histogram: [ { bin_start, bin_end, count } ×10 ] }`. Override rate counts corrections with `field` = that head and `old_label` = the label, inside the window. The Stats widget switches between Type, Urgency and Sentiment and shows emails labelled, share at ≥ 80 % confidence, share corrected, a per-label table (count, share, corrected) and a labelled histogram (count over each bar, 0–100 % ticks, axis titles).
2. **`POST /actions/:id/accept` gains `jira?: { project_key: string | null, epic: string | null }`** (create_jira_issue only; 422 for other types). `project_key` is a Jira key (`^[A-Z][A-Z0-9]{1,9}$`), `epic` an issue key. Resolution: given `jira` → its project (null → tenant default) and epic; omitted → the caller's primary project for the email (its `jira_project_key` and `jira_epic`), else the tenant default project with no epic. This completes FR-ORC-012's prefill (deferred in §12.2) and shows the FR-UI-017 Jira target before accepting: a proposed Jira action reads "to ATL › ATL-100", and the composer has Jira project and Epic fields prefilled from the primary project. Implemented in the mock; M6 needs the same rule.
3. **Admin page** (`/admin`, admins only) uses only the §6.5 admin routes: Connections (Jira and LLM settings, secrets write-only, Test connection), Classifier and polling (threshold, protected domains, interval), Users (allow-list, role, security review), Models (Retrain, Promote with the failed gates listed, F1 deltas against the live model). M6 does not implement these routes yet.
4. **Board lanes:** coloured top edge only; the lane body keeps the neutral column background (amends §24.4).
5. **An empty dashboard page** shows an Add widget button (in the page and the toolbar) until it has a widget.


## 26. Search, lean (19 Nov 2026) (PROPOSED for v1.3)

1. **`GET /emails` gains `q_in=subject|all`** (default `all`, today's behaviour: subject and masked body). `subject` matches the words against the subject only. Any other value → `422 invalid_parameter`. Implemented in the mock and M6.
2. **The palette (FR-UI-025, cut down)** opens with Ctrl/⌘+K, `/` (when not typing) or the topbar pill, and loads on first use. It searches **email subjects** (open and handled mail; handled via a second `view=handled` request, merged newest first, at most 8) and **project names** (from `GET /projects`, archived included and labelled). When no subject matches, **Go deeper** repeats the search with `q_in=all`. **Filters:** type, urgency, unread / due today / overdue, include handled, mapped to the existing `GET /emails` parameters. Enter or click opens the email in the inbox drawer (whose People & thread section lists the earlier messages) or the project page. 150 ms debounce; stale requests cancelled; matches highlighted as plain text.
3. **Not in the lean palette** (need `GET /search`, whose response shape §6.5 never defined): people, cards, actions, notes and attachment filenames, typed operators, typo tolerance, saved searches.
4. **Lock screen:** the recent-notification cards are removed; the glance chips and the Critical unread card remain.

## 27. Search scrolling, cards to Jira/Calendar, Remind me on the board (19 Nov 2026) (PROPOSED for v1.3)

1. **`GET /emails` gains `include_handled=true|false`** (default false). True keeps handled mail in the list, in the same order and paging, so search pages through one list (25 at a time, more on scroll) instead of merging two. Other values → `422 invalid_parameter`. Ignored when `view` already includes `handled`. Implemented in the mock and M6, with tests.
2. **Sending one of your cards to Jira or Calendar** (FR-CNT-002 "same actions"; resolves §19's open point):
   - `POST /actions { type: "create_jira_issue" | "add_calendar_event", payload, card_id }` → `201` Action, `status: "proposed"`, `origin: "user"`, `email_id: null`, `card_id` set. Same payload fields and §6.4 per-type rules as an email's actions (a Jira priority left empty defaults from the card's urgency). `card_id` must be one of the caller's own cards (404 otherwise; 409 if it isn't a user card). Then `POST /actions/:id/accept` as usual, with §25.2's `jira` target (default: the card's primary project, else the tenant default). Undo as usual.
   - **`Action.card_id: string | null`** on the wire (null for every other action).
   - Such an action is **not placed on the board**: the card is already there. The card lists what was sent with `GET /actions?card=<card id>`.
   - The card sheet's **Send to** section: Jira, Calendar (the drawer's composer, prefilled from the card: title, description, due date, priority from urgency or Medium; an event at the due time or tomorrow 9 am, one hour, with you as attendee) and Remind me.
   - Implemented in the mock; **M6 still needs it**.
3. **Remind me on board cards:** right-click, `r`, or the ⏰ button that appears on hover. An email's card reminds about the email (`target.type = "email"`), one of your cards about the card (`"card"`). Uses the existing `POST /reminders`.
4. **Search result in the Inbox:** picking an email in search opens `/inbox?found=<id>&sq=<words>`. The Inbox shows only that email (from `GET /emails/:id`) with a "search: …" pill beside the title. The pill reopens search with the same words; its ✕ shows the whole inbox. No wire change.

## 28. Pop-up rules, quiet hours, lock refresh, key binds (19 Nov 2026) (PROPOSED for v1.3)

### 28.1 `ui_prefs.popup_rules` and `ui_prefs.quiet_hours` (FR-REM-007)
- `popup_rules`: `{ normal, focus, quiet }`, each `{ urgency: "all" | "medium" | "high" | "critical" | "none", sentiment: "off" | "frustrated" | "negative" }`. `sentiment` pops an email up whatever its urgency: `frustrated` = Frustrated only, `negative` = Negative or Frustrated. All three modes are required; extra keys → 422.
- `quiet_hours`: `{ start: "HH:MM", end: "HH:MM" }` in the user's local time (start > end wraps past midnight), or `null` = off. Unset = `22:00–08:00`.
- Defaults (FR-REM-007): Normal = High+ and Frustrated, Focus = Critical only, Quiet = none.
- **Mode:** quiet hours win over Focus mode, then Focus, else Normal.
- Applied in the client to new emails arriving over the socket (`email.triaged` for an email no list holds): a top alert with a mail icon, `Urgency · Mood · Sender` and the subject, once per email, never behind the lock. Everything else arrives silently (inbox, "↑ n new", bell counts). Reminders (FR-REM-004) are unchanged.
- "Asked on first sign-in", lean: when `popup_rules` is unset, the client saves the defaults and shows a toast naming them, with Change → Settings › Notifications.
- M6 validates both keys in `PATCH /me/preferences` (done). Web Push filtering by the same rules is v2 with Web Push.

### 28.2 Lock-screen refresh
A round button top right of the lock screen, shown once the app has loaded. It refetches every active query (glance chips, subjects, the dashboard behind the lock) without opening the lock; the icon spins while it runs. No API change.

### 28.3 `ui_prefs.keybinds`
- Editable actions and defaults: `search` Mod+K, `search_alt` /, `quick_add` N, `focus` F, `lock` Alt+L, `next` J, `prev` K, `select` X, `done` E, `project` P, `remind` R, `jira` Shift+J. `Mod` = Ctrl, or ⌘ on a Mac.
- Wire: `{ [action]: combo }`, **overrides only**; a combo is `(Mod+)?(Alt+)?(Shift+)?KEY`, KEY one character or a named key in capitals (e.g. `F2`). Unknown actions or bad combos → 422. `{}` resets all.
- Fixed and not bindable: Esc, Tab, Enter, Space, arrows, Backspace/Delete, Ctrl/⌘+C/V/X/A/Z, Shift+F10 and the menu key. Settings refuses a combo another action already uses.
- A combo without Mod or Alt never fires while typing or with a dialog open.

## 29. Lock over dialogs, quiet hours default, first-run help (19 Nov 2026) (PROPOSED for v1.3)

### 29.0 Corrections
- **Lock vs dialogs:** browser dialogs sit in the top layer, above the lock's z-index. When the lock comes down (idle, Alt+L, button) the client closes every open dialog and sends Escape to menus; an open email panel is remembered and reopens on the same email after unlock. `lock.ts` emits `secep:locking` / `secep:unlocked`; synthetic keys never open the lock.
- **Quiet hours default off** (changes FR-REM-007's "default 22:00–08:00"): unset `quiet_hours` = `null`. Turning them on fills in 22:00–08:00.
- The §28.1 first-run toast (and its automatic save of the pop-up defaults) is removed; the tour below replaces it.

### 29.1 Tour
Five "where things are" steps (Inbox, opening an email, Board, Search, Pop-ups and privacy) plus Admin for admins. Spotlight + card beside, below or above it; when the target fills the screen (a whole column, the board) the card sits in the bottom-right corner so it never covers headings; centred when the part isn't on screen; bottom sheet on phones. Not modal; Esc closes (paused, Settings offers Resume), ←/→ move. The last step has the Normal pop-up level and quiet-hours switch inside the card. Offered once after the lock first opens (Take the tour / Not now); never starts by itself. Lazy chunk (~2.7 KB gz).

### 29.2 Getting started checklist (Home)
Open an email · Send a task to Jira · Add a card of your own · Search your mail · Choose which emails pop up · Turn on quiet hours. Ticked automatically when done, each with a Go button; hideable. When the last item is ticked a toast says so and the list goes away for good.

### 29.3 First-use hints
Inbox (card keys, shown with the user's own bindings) and Board (Remind me). Once each; not during the tour or before it has been offered.

### 29.4 Ways back in
Settings › Tutorial: Start the tour, Resume from step n, Show Getting started, Show tips again. Search: "tutorial", "tour", "help", "guide"… → Start the tutorial; "shortcuts", "keys"… → Keyboard shortcuts.

### 29.5 `ui_prefs.onboarding`
`{ tour?: "done" | "skipped" | "paused", tour_step?: 0–19, checklist_hidden?: boolean, done?: ChecklistId[], hints?: ("card_keys" | "remind")[] }`, ChecklistId ∈ `open_email, send_jira, quick_add, search, popup_rules, quiet_hours`. Unknown keys/ids → 422. The client sends the whole object, one write at a time. Mock and M6 validate it.
