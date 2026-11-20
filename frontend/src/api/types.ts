import type { Onboarding } from '../onboarding/onboarding'
import type { KeyActionId } from '../lib/keybinds'
import type { PopupRules, QuietHours } from '../lib/popupRules'
// Wire types for the public API: SRS §6.4.1 (shapes) and §6.6 (enums and nullability). snake_case on purpose:
// the client uses exactly what the API sends, so switching from MSW to the real API needs no mapping layer.
// Only the shapes used so far are here; add the rest from §6.4.1 as features need them, never invent fields.

export type EmailType = 'Task' | 'Info' | 'Credentials' | 'Meeting' | 'Approval'
export type Urgency = 'Low' | 'Medium' | 'High' | 'Critical'
export type Sentiment = 'Positive' | 'Neutral' | 'Negative' | 'Frustrated'
export type LabelSource = 'encoder' | 'llm' | 'user' | 'rule'
export type EmailStatus = 'ingested' | 'triaged' | 'enriched' | 'enrich_pending' | 'enrich_failed'
export type SecurityFlag = 'none' | 'suspicious' | 'malicious'
export type RecipientPosition = 'to' | 'cc' | 'bcc'
export type LinkVerdict = 'pending' | 'clean' | 'suspicious' | 'malicious'
export type RoleCategory = 'Executive' | 'Manager' | 'Engineer' | 'Analyst' | 'Consultant' | 'Client-facing' | 'Other'
export type MailboxStatus = 'active' | 'paused' | 'revoked' | 'error'

export type ActionType = 'create_jira_issue' | 'add_board_card' | 'add_calendar_event'
export type ActionOrigin = 'decoder' | 'user' | 'rule'
export type ActionStatus = 'proposed' | 'accepted' | 'executing' | 'done' | 'failed' | 'rejected'
export type BoardColumn = 'todo' | 'in_progress' | 'done'
export type JiraPriority = 'Highest' | 'High' | 'Medium' | 'Low'

export interface Person {
  address: string
  name: string | null
}

/** triage.v1 without `schema` and `email_id`. */
export interface TriageView {
  email_type: { label: EmailType; confidence: number; source: LabelSource }
  urgency: { label: Urgency; confidence: number }
  sentiment: { label: Sentiment; score: number; confidence: number }
  needs_review: boolean
  model_version: string
  processed_at: string
}

/** The only form in which a link reaches the client (FR-SEC-004). `pending` → check_id and go_url are null. */
export interface LinkView {
  check_id: string | null
  anchor_text: string | null
  host: string
  verdict: LinkVerdict
  go_url: string | null
}

/** enrich.v1 action shape, used for decoder actions. */
export interface DecoderActionPayload {
  title: string | null
  description: string | null
  priority: JiraPriority | null
  due_date: string | null
  start: string | null
  end: string | null
  attendees: string[] | null
}

/** User card payload, §6.4 (FR-CNT-002), for `origin = "user"`. */
export interface UserCardPayload {
  title: string
  description: string | null
  due_date: string | null
  due_time: string | null
  urgency: Urgency | null
  checklist: { text: string; done: boolean }[]
  source: 'in_person' | 'call' | 'chat' | null
  person: string | null
}

export interface Action {
  id: string
  email_id: string | null
  /**
   * PROPOSED (proposals §27.2): a Jira issue or calendar event sent from one of your cards (FR-CNT-002 "same
   * actions"); null otherwise. Such actions are not board cards themselves; the card lists them.
   */
  card_id: string | null
  type: ActionType
  origin: ActionOrigin
  status: ActionStatus
  payload: DecoderActionPayload | UserCardPayload
  board_column: BoardColumn | null
  board_position: number | null
  external_ref: string | null
  external_status: string | null
  error: string | null
  created_at: string
  updated_at: string
  /** PROPOSED (proposals §19.1): a user card's projects, primary first; [] for an email's actions. */
  projects: EmailProjectRef[]
}

export interface EmailListItem {
  id: string
  thread_id: string | null
  from: Person
  to: Person[]
  cc: Person[]
  recipient_position: RecipientPosition
  subject: string | null
  received_at: string
  status: EmailStatus
  security_flag: SecurityFlag
  duplicate_count: number
  attachment_count: number
  reply_count: number
  has_masked_secret: boolean
  triage: TriageView | null
  summary_one_line: string | null
  proposed_action_count: number
  jira_key: string | null
  pinned: boolean
  snoozed_until: string | null
  /**
   * PROPOSED (pending SRS v1.3, proposals §10.2): YYYY-MM-DD, derived server-side from the email's actions (earliest
   * due_date or calendar start date). The source of truth stays in actions. null = no due date.
   */
  due_date: string | null
  /** PROPOSED (proposals §10.3): handled by the current user (per recipient). Reversible; hidden from the default inbox. */
  handled: boolean
  /**
   * PROPOSED (proposals §1, §12.3): read by the current user (per recipient, an email_reads row). Set when the user
   * opens the email and by the manual Mark read / unread toggle.
   */
  read: boolean
  /**
   * PROPOSED (proposals §4, §18): the projects this email belongs to (FR-UI-017), the primary first, then in the order
   * they were added. Empty when it belongs to none.
   */
  projects: EmailProjectRef[]
  // Should feature; the element shape is not in the SRS yet, so nothing can be put in it until it is.
  tags: never[]
  /** PROPOSED (proposals §19.2): how many notes the user has on this email (the 📝 tag). */
  note_count: number
}

/** PROPOSED (proposals §19.2): a note (FR-CNT-003). body is markdown-lite and already masked. */
export interface Note {
  id: string
  target_type: NoteTarget | null
  target_id: string | null
  body: string
  created_at: string
  updated_at: string
}
export type NoteTarget = 'email' | 'card' | 'project'

/** PROPOSED (proposals §21): a manual reminder ("Remind me", FR-REM-002). Fires once as a notification at fire_at. */
export interface Reminder {
  id: string
  kind: 'manual'
  target: { type: 'email' | 'card'; id: string } | null
  title: string
  fire_at: string
  status: 'scheduled' | 'fired' | 'cancelled'
  fired_at: string | null
}

/** PROPOSED (proposals §19.3): an uploaded file (FR-CNT-006). Download with GET /files/:id. */
export interface FileRef {
  id: string
  target_type: NoteTarget
  target_id: string
  filename: string
  mime: string
  size: number
  created_at: string
}

export interface EmailDetail extends EmailListItem {
  /** Sanitized, masked plain text. Never auto-link URLs in it; only `links` are clickable. */
  body_text: string
  summary_short: string | null
  actions: Action[]
  links: LinkView[]
  attachments: { index: number; filename: string; mime: string; size: number }[]
  /**
   * In the same order as the [MASKED:<type>] tokens in body_text. secret_type is free text in §6.6. SECEP never holds
   * or reveals the value (proposals §18.4): the user opens the message in their mail app (open_url) to see it.
   */
  masked_secrets: { id: string; secret_type: string }[]
  /**
   * PROPOSED (proposals §18.4): this message in the user's own mail app (Gmail on the web), built by M6 from
   * emails.provider_message_id and the mailbox address. null when it can't be linked.
   */
  open_url: string | null
  auth_results: { spf: string; dkim: string; dmarc: string } | null
  /** null when thread_id is null (§6.6 emails.thread_id is nullable). */
  thread: {
    id: string
    message_count: number
    messages: { id: string; from: Person; subject: string | null; received_at: string }[]
  } | null
}

/**
 * GET /links/:checkId/go (§6.4.1, FR-SEC-004): the click-time verdict. The client opens `url` itself only for
 * "open"; "interstitial" needs explicit confirmation; "blocked" never opens.
 */
export type GoResponse =
  | { action: 'open'; url: string }
  | { action: 'interstitial'; verdict: 'suspicious'; final_url: string; chain: string[]; signals: string[] }
  | { action: 'blocked'; verdict: 'malicious'; chain: string[]; signals: string[] }

export interface Me {
  id: string
  email: string
  display_name: string | null
  role_category: RoleCategory
  is_admin: boolean
  permissions: string[]
  mailbox: { address: string; status: MailboxStatus; last_polled_at: string | null } | null
  ui_prefs: Record<string, unknown>
}

export interface Page<T> {
  items: T[]
  next_cursor: string | null
}

/**
 * GET /emails `due` values (PROPOSED, proposals §15.1), OR-combined like the other filter groups. Buckets of the
 * derived due_date in the user's time zone; next_7_days is a rolling 7 days starting today.
 */
export type DueBucket = 'overdue' | 'today' | 'next_7_days' | 'later' | 'none'

/** GET /emails `view` values (PROPOSED, proposals §10.1/§10.3), AND-combined. */
export type EmailView = 'unread' | 'due_today' | 'needs_reply' | 'overdue' | 'handled'

/**
 * PATCH /emails/:id request (§6.5 v1.1: pinned, snoozed_until; handled and read are PROPOSED, §10.3 and §12.3, owner-only
 * and per user, §12.1). Response: EmailDetail.
 */
export interface EmailPatch {
  pinned?: boolean
  snoozed_until?: string | null
  handled?: boolean
  read?: boolean
}

/** PATCH /emails/:id/labels request (§6.4.1). scope defaults to email; similar is S (FR-ML-014). */
export interface LabelCorrection {
  field: 'email_type' | 'urgency' | 'sentiment'
  value: string
  scope?: 'email' | 'sender' | 'similar'
}

/** PATCH /emails/:id/labels response (§6.4.1). correction_id: corrections.id is a bigserial but §6.4.1 says IDs are
 * UUID strings. Decided (proposals §10.5): a UUID string. */
export interface LabelCorrectionResponse {
  triage: TriageView
  correction_id: string
  rule_id: string | null
}

export interface RefreshResponse {
  access_token: string
  expires_in: number
}

export type ErrorCode =
  | 'bad_request'
  | 'unauthenticated'
  | 'reauth_required'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation_failed'
  | 'action_invalid'
  /** PROPOSED (proposals §10.4): 422 for an unknown sort or view value. */
  | 'invalid_parameter'
  | 'rate_limited'
  | 'upstream_error'
  | 'unavailable'
  /** PROPOSED (proposals §19.3): 413 over 25 MB, or over the user's file quota. */
  | 'file_too_large'
  | 'quota_exceeded'

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details: unknown; request_id: string }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// PROPOSED (pending SRS v1.3). The SRS names these routes (§6.5) or columns (§6.6) but defines no wire shape yet.
// Derived from §6.6 where possible; see docs/proposals/srs-v1.3-frontend-shapes.md. Change them only alongside
// that document, so M6 builds the same thing.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** users.ui_prefs keys named in the §6.6 comment, typed here; sidebar_collapsed is new. All optional on the wire. */
export interface UiPrefs {
  /** Unset = follow the OS (FR-UI-032). */
  /** null clears it (back to following the OS; proposals §22). */
  motion?: 'full' | 'reduced' | 'off' | null
  skip_lock?: boolean
  /** null = idle return off (FR-WP-004). */
  idle_minutes?: number | null
  glance_subjects?: boolean
  sidebar_collapsed?: boolean
  /** PROPOSED (proposals §16.6): Light, Dark, or Auto (follow the system). Unset = Auto. */
  theme?: 'light' | 'dark' | 'auto'
  /** PROPOSED (proposals §28.1, FR-REM-007): which new emails pop up, per Normal / Focus / Quiet hours. */
  popup_rules?: PopupRules
  /** PROPOSED (proposals §28.1): local HH:MM range; null = quiet hours off. Unset = 22:00–08:00. */
  quiet_hours?: QuietHours | null
  /** PROPOSED (proposals §28.3): action id → key combo, overrides of the defaults only. */
  keybinds?: Partial<Record<KeyActionId, string>>
  /** PROPOSED (proposals §29): tour, Getting started checklist and first-use hint progress. */
  onboarding?: Onboarding
}

/** GET /admin/metrics (§6.5, admin): the classifier over `window_days`. Shown in the Stats widget. */
/** GET /admin/settings (§6.5): secrets are never returned, only whether one is set. */
export interface AdminSettings {
  jira: { site_url: string | null; email: string | null; project_key: string | null; token_set: boolean }
  llm: { base_url: string | null; model: string | null; api_style: 'ollama' | 'openai'; api_key_set: boolean }
  confidence_threshold: number
  protected_domains: string[]
  poll_interval_s: number
}

/** PUT /admin/settings: the GET shape; secrets as `token` / `api_key` only when changing them. */
export interface AdminSettingsInput {
  jira?: Partial<Omit<AdminSettings['jira'], 'token_set'>> & { token?: string }
  llm?: Partial<Omit<AdminSettings['llm'], 'api_key_set'>> & { api_key?: string }
  confidence_threshold?: number
  protected_domains?: string[]
  poll_interval_s?: number
}

export interface SettingsTest {
  jira: { ok: boolean; error: string | null }
  llm: { ok: boolean; error: string | null }
}

/** GET /admin/users item (§6.5). */
export interface AdminUser {
  id: string
  email: string
  display_name: string | null
  role_category: RoleCategory
  is_admin: boolean
  permissions: string[]
  last_login_at: string | null
}

/** GET /admin/models item (§6.5); metrics as M1's model card reports them. */
export interface ModelView {
  id: string
  version: string
  status: 'candidate' | 'promoted' | 'retired'
  metrics: { type_macro_f1: number; urgency_macro_f1: number; sentiment_macro_f1: number; per_class_f1: Record<string, number>; ece: number }
  created_at: string
  promoted_at: string | null
}

/**
 * PROPOSED (proposals §25.2, FR-ORC-012): optional in `POST /actions/:id/accept` for create_jira_issue. Omitted, the
 * server uses the primary project's Jira project and epic, else the tenant default project.
 */
export interface JiraTarget {
  project_key: string | null
  epic: string | null
}

export interface ConfidenceBin {
  bin_start: number
  bin_end: number
  count: number
}

/** PROPOSED (proposals §25.1): the same three figures as the email-type fields, for urgency and for sentiment. */
export interface HeadMetrics<L extends string> {
  volume: Partial<Record<L, number>>
  override_rate: Partial<Record<L, number>>
  confidence_histogram: ConfidenceBin[]
}

export interface AdminMetrics {
  window_days: number
  volume_by_type: Partial<Record<EmailType, number>>
  override_rate_by_class: Partial<Record<EmailType, number>>
  confidence_histogram: ConfidenceBin[]
  urgency: HeadMetrics<Urgency>
  sentiment: HeadMetrics<Sentiment>
}

/** PATCH /me/preferences: request is a partial UiPrefs; response is the full stored object. */
export interface PreferencesResponse {
  ui_prefs: UiPrefs
}

/** GET /me/glance: lock-screen glance line (FR-WP-001) and sidebar count badges (FR-UI-002). */
export interface Glance {
  counts: {
    inbox_unread: number
    critical_unread: number
    board_todo: number
    due_today: number
    overdue: number
    /** null without security.review. */
    security_flags: number | null
  }
  /** title is null unless ui_prefs.glance_subjects is on (lock-screen privacy). */
  next_event: { title: string | null; start: string } | null
  /** Subjects of unread Critical mail; null unless ui_prefs.glance_subjects is on. */
  subjects: string[] | null
}

export type NotificationKind = 'reminder' | 'digest' | 'meeting' | 'new_email' | 'jira_status'

/**
 * GET /notifications item. The §6.6 payload jsonb is split into title / body / target. `title` never contains a
 * sender or subject (it's what the lock screen shows by default); `body` carries those details.
 * id: notifications.id is a bigserial, sent as a string (§6.4.1 says IDs are UUID strings: flagged).
 */
export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  body: string | null
  target: { type: 'email' | 'card' | 'event'; id: string } | null
  read_at: string | null
  created_at: string
}

/** GET /projects item: §6.6 projects columns minus tenant_id, owner_user_id and centroid, plus derived progress. */
export interface Project {
  id: string
  name: string
  colour: string
  icon: string | null
  description: string | null
  deadline: string | null
  jira_project_key: string | null
  jira_epic: string | null
  archived_at: string | null
  created_at: string
  progress: { done: number; total: number }
}

/** PROPOSED (proposals §4, §18): one of an email's projects, as cards show it (split dot and "Name +n" chip). */
export interface EmailProjectRef {
  id: string
  name: string
  colour: string
  is_primary: boolean
}

/**
 * POST /projects request, and PATCH /projects/:id (every field optional there, plus `archived`). PROPOSED (proposals
 * §18.1): the §6.6 columns a user sets. colour is `#rrggbb`.
 */
export interface ProjectInput {
  name: string
  colour: string
  icon?: string | null
  description?: string | null
  deadline?: string | null
  jira_project_key?: string | null
  jira_epic?: string | null
}
export type ProjectPatch = Partial<ProjectInput> & { archived?: boolean }

/**
 * POST /projects/:id/items request (§6.5 v1.1 "add or remove emails and cards; set primary"). PROPOSED (proposals
 * §18.2): exactly one of email_id and action_id. `primary` makes this project the item's primary one; the first
 * project an item gets is primary anyway (FR-UI-017). Response: the item. Adding an item that is already in the
 * project only applies `primary`. DELETE /projects/:id/items/:itemId takes the email or action id.
 */
export interface ProjectItemInput {
  email_id?: string
  action_id?: string
  primary?: boolean
}
export interface ProjectItem {
  project_id: string
  email_id: string | null
  action_id: string | null
  is_primary: boolean
  added_at: string
}

/**
 * PROPOSED (pending SRS v1.3, proposals doc §8.5): the sender with their role category, for the role on every card
 * (FR-UI-011). Not part of the final §6.4.1 Person; EmailListItem.from stays `Person` until v1.3 adopts this.
 * null = role unknown.
 */
export interface SenderPerson extends Person {
  role_category: RoleCategory | null
}

// ── Layouts (PROPOSED, proposals §13 as decided on 2 Nov 2026; FR-UI-006–010) ─────────────────────────────────────
// GET /layouts/:deviceClass → Layout (nothing saved: the starter layout, is_default true, updated_at null).
// PUT /layouts/:deviceClass { pages, base_updated_at } → Layout. A full replace; a stale base_updated_at → 409.

export type LayoutDeviceClass = 'desktop' | 'tablet' | 'phone'
export type WidgetType = 'inbox_column' | 'board' | 'projects' | 'reminders' | 'calendar' | 'notes' | 'stats' | 'security'
export type Swatch = 'slate' | 'blue' | 'teal' | 'green' | 'amber' | 'orange' | 'red' | 'violet'

/** How many of a row's 3 slots a tile takes on desktop and tablet: 1, 2 or 3 (proposals §16.3). */
export type WidgetSize = 'small' | 'medium' | 'large'

/**
 * A tile. A page lists its widgets IN ORDER: on desktop and tablet they flow into rows of 3 slots, left to right,
 * top to bottom (proposals §16.3, replacing free x/y on a 12-column grid). Phone stacks them as sections.
 */
export interface Widget {
  /** A stable uuid, made by the client when the widget is added. */
  id: string
  type: WidgetType
  /** Desktop and tablet only; phones ignore it. */
  size: WidgetSize
  /** Phone only (a section toggled off in the edit sheet); desktop and tablet ignore it. */
  hidden: boolean
  /**
   * PROPOSED (F18, proposals §17): shares the slot of the widget before it, the two at half height each. At most two
   * per slot, and a stacked widget has its base's size. Phones ignore it (sections in order).
   */
  stacked: boolean
  /** null = the type's default title. */
  title: string | null
  colour: Swatch | null
  /** One emoji, or null. */
  icon: string | null
  /** inbox_column only: a GET /emails query string of filter parameters (no sort, cursor or limit). */
  filter: string | null
  sort: 'smart' | 'newest' | 'oldest' | 'due' | 'urgency' | 'sender' | 'confidence' | null
  density: 'compact' | 'comfortable' | 'spacious' | null
}

export interface LayoutPage {
  id: string
  name: string
  order: number
  widgets: Widget[]
}

export interface Layout {
  device_class: LayoutDeviceClass
  pages: LayoutPage[]
  /** null until the first save. */
  updated_at: string | null
  /** true while nothing is saved: these are the starter pages. */
  is_default: boolean
}

export interface LayoutPut {
  pages: LayoutPage[]
  /** The updated_at this edit was based on (null for the first save). */
  base_updated_at: string | null
}
