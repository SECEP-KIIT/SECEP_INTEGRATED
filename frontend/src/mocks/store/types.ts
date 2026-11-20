// Internal rows of the mock store, shaped after SRS §6.6. These are never sent as-is: serialize.ts builds every wire
// shape, so the API contract lives in one place. Fields the client must never see (raw URLs, secret values) exist
// only here.
import type {
  Action,
  AppNotification,
  EmailStatus,
  LayoutDeviceClass,
  LayoutPage,
  LinkVerdict,
  MailboxStatus,
  Person,
  Project,
  RecipientPosition,
  RoleCategory,
  SecurityFlag,
  TriageView,
  UiPrefs,
} from '../../api/types'

export interface UserRow {
  id: string
  email: string
  display_name: string | null
  role_category: RoleCategory
  is_admin: boolean
  permissions: string[]
  last_login_at: string | null
  ui_prefs: UiPrefs
  mailbox: { address: string; status: MailboxStatus; last_polled_at: string | null } | null
}

export interface ThreadMessage {
  id: string
  from: Person
  subject: string | null
  received_at: string
}

export interface ThreadRow {
  id: string
  user_id: string
  /** Every message in the thread, oldest first, including the stored emails. */
  messages: ThreadMessage[]
}

export interface EmailRow {
  id: string
  user_id: string
  thread_id: string | null
  from: Person
  to: Person[]
  cc: Person[]
  recipient_position: RecipientPosition
  subject: string | null
  received_at: string
  /** Sanitized and masked, as M2 stores it (FR-SEC-006). */
  body_text: string
  status: EmailStatus
  security_flag: SecurityFlag
  duplicate_count: number
  attachments: { index: number; filename: string; mime: string; size: number }[]
  auth_results: { spf: string; dkim: string; dmarc: string } | null
  triage: TriageView | null
  summary: { one_line: string; short: string } | null
  pinned: boolean
  snoozed_until: string | null
}

export interface UrlCheckRow {
  id: string
  email_id: string
  /** Raw URL: server-side only, never in a list or detail response (FR-SEC-004). */
  url: string
  anchor_text: string | null
  host: string
  /** `pending` until M5 has scored it. */
  verdict: LinkVerdict
  signals: string[]
  final_url: string
  chain: string[]
  /** Mock only, never on the wire: a worse verdict the click-time resolver finds (LinkSpec.clickVerdict). */
  click_verdict?: 'suspicious' | 'malicious'
  /** Mock only: how long the click-time check takes. */
  click_delay_ms?: number
}

export interface SecretRow {
  id: string
  email_id: string
  owner_user_id: string
  /** Only the type: the pipeline drops the value, and SECEP never holds it (proposals §18.4). */
  secret_type: string
}

export interface ActionRow extends Omit<Action, 'projects' | 'card_id'> {
  user_id: string
  /** Proposals §27.2: the user card a Jira issue or event was sent from. */
  card_id?: string | null
  /** §6.6 v1.1 `actions.undo_until`: until when POST /actions/:id/undo may delete the created issue or event. */
  undo_until?: string | null
}

export interface CorrectionRow {
  id: string
  email_id: string
  user_id: string
  field: 'email_type' | 'urgency' | 'sentiment'
  old_label: string
  new_label: string
  created_at: string
}

export interface LabelRuleRow {
  id: string
  user_id: string
  field: CorrectionRow['field']
  sender: string
  label: string
  hit_count: number
  created_at: string
}

export interface ModelMetrics {
  type_macro_f1: number
  urgency_macro_f1: number
  sentiment_macro_f1: number
  per_class_f1: Record<string, number>
  ece: number
}

export interface ModelRow {
  id: string
  version: string
  status: 'candidate' | 'promoted' | 'retired'
  metrics: ModelMetrics
  created_at: string
  promoted_at: string | null
}

export interface SettingsRow {
  jira: { site_url: string | null; email: string | null; project_key: string | null; token: string | null }
  llm: { base_url: string | null; model: string | null; api_style: 'ollama' | 'openai'; api_key: string | null }
  confidence_threshold: number
  protected_domains: string[]
  poll_interval_s: number
}

export interface AuditRow {
  id: number
  created_at: string
  actor_user_id: string | null
  event: string
  target: string | null
  details: Record<string, unknown>
  prev_hash: string
  hash: string
}

export interface NotificationRow extends AppNotification {
  user_id: string
}

/** §6.6 projects; progress is derived when serialised (toProject). */
export interface ProjectRow extends Omit<Project, 'progress'> {
  user_id: string
}

/** §6.6 email_projects and card_projects in one list: exactly one of email_id and action_id is set. */
export interface ProjectItemRow {
  project_id: string
  email_id: string | null
  action_id: string | null
  is_primary: boolean
  added_at: string
}

export interface NoteRow {
  id: string
  owner_user_id: string
  target_type: 'email' | 'card' | 'project' | null
  target_id: string | null
  body: string
  created_at: string
  updated_at: string
}

export interface ReminderRow {
  id: string
  user_id: string
  kind: 'manual'
  target: { type: 'email' | 'card'; id: string } | null
  title: string
  fire_at: string
  status: 'scheduled' | 'fired' | 'cancelled'
  fired_at: string | null
}

export interface FileRow {
  id: string
  owner_user_id: string
  target_type: 'email' | 'card' | 'project'
  target_id: string
  filename: string
  mime: string
  size: number
  created_at: string
}

export interface Db {
  users: UserRow[]
  threads: Map<string, ThreadRow>
  emails: Map<string, EmailRow>
  urlChecks: UrlCheckRow[]
  secrets: SecretRow[]
  actions: Map<string, ActionRow>
  corrections: CorrectionRow[]
  labelRules: LabelRuleRow[]
  models: ModelRow[]
  settings: SettingsRow
  audit: AuditRow[]
  notifications: NotificationRow[]
  projects: ProjectRow[]
  /** Emails and cards in projects (FR-UI-017). */
  projectItems: ProjectItemRow[]
  /** Notes (FR-CNT-003), masked on save. */
  notes: NoteRow[]
  /** Manual reminders (FR-REM-002). */
  reminders: ReminderRow[]
  /** Uploaded files (FR-CNT-006). The bytes live in memory only (files.ts), so they last until a reload. */
  files: FileRow[]
  /** Read state per user (proposal §1: per recipient, not a column on the email). */
  reads: Map<string, Set<string>>
  /** Handled state per user: email id → handled_at (proposals §10.3, email_states for M6). */
  handled: Map<string, Map<string, string>>
  /** Saved layouts per user and device class (user_layouts, FR-UI-010). None saved = the starter layout. */
  layouts: Map<string, Partial<Record<LayoutDeviceClass, { pages: LayoutPage[]; updated_at: string }>>>
  /** Emails delivered by the incoming-mail simulation, so persistence can regenerate them. */
  arrivals: { template: number; received_at: string; user_id: string }[]
}
