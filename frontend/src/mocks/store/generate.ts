// Builds the seeded mock tenant: users, ~50 emails for the demo user, threads, link checks, masked secrets,
// actions in every state, models, settings, projects and notifications. Deterministic for a given seed and clock.
import type { ActionStatus, BoardColumn, Person, TriageView } from '../../api/types'
import { buildNotification } from '../notifications'
import { chance, int, pick, rng, round, uid, type Rng } from './random'
import { localDate } from './serialize'
import { LINK_SAMPLES, SENDERS, TEMPLATES, type ActionSpec, type Sender, type Template } from './templates'
import type { ActionRow, Db, EmailRow, UserRow } from './types'
import { backfillEmailCards } from './emailCardsCore'

export const SEED = 20261104
const DAY = 86_400_000
const HOUR = 3_600_000

/** Per-user handled map (proposals §10.3), created on first use. */
export function handledOf(db: Db, userId: string) {
  let m = db.handled.get(userId)
  if (!m) db.handled.set(userId, (m = new Map()))
  return m
}

// Id namespaces, so ids from different tables never collide.
const NS = { user: 1, email: 2, thread: 3, check: 4, secret: 5, action: 6, model: 7, project: 8, msg: 9, rule: 10 }

export const MODEL_VERSION = 'triage-2026-10-30'
export const CONFIDENCE_THRESHOLD = 0.6

let counter = 0
export const nextId = (ns: keyof typeof NS) => uid(NS[ns], ++counter)

/**
 * Runs `fn` with ids drawn from a fixed block for arrival `index` (and a sub-offset), whatever else has used ids in
 * the meantime. Replaying arrivals after a reload then recreates exactly the same ids.
 */
export function withIdBlock<T>(index: number, offset: number, fn: () => T): T {
  const saved = counter
  counter = 1_000_000 + index * 1000 + offset
  try {
    return fn()
  } finally {
    counter = saved
  }
}

const person = (s: Sender): Person => ({ address: s.address, name: s.name })
const iso = (ms: number) => new Date(ms).toISOString()

export const USERS: UserRow[] = [
  {
    id: uid(NS.user, 1), email: 'demo@northwind.example', display_name: 'Demo User', role_category: 'Engineer',
    is_admin: true, permissions: ['security.review'], last_login_at: null, ui_prefs: {},
    mailbox: { address: 'demo@northwind.example', status: 'active', last_polled_at: null },
  },
  {
    id: uid(NS.user, 2), email: 'sam.lee@northwind.example', display_name: 'Sam Lee', role_category: 'Analyst',
    is_admin: false, permissions: [], last_login_at: null, ui_prefs: {},
    mailbox: { address: 'sam.lee@northwind.example', status: 'active', last_polled_at: null },
  },
  {
    id: uid(NS.user, 3), email: 'rita.das@northwind.example', display_name: 'Rita Das', role_category: 'Manager',
    is_admin: false, permissions: ['security.review'], last_login_at: null, ui_prefs: {},
    mailbox: { address: 'rita.das@northwind.example', status: 'active', last_polled_at: null },
  },
]

function triageFor(r: Rng, t: Template, processedAt: string): TriageView {
  // A few emails land under the confidence threshold so the needs-review "?" appears (FR-UI-012).
  const typeConf = chance(r, 0.15) ? round(0.42 + r() * 0.16) : round(0.7 + r() * 0.28)
  const score = { Positive: 0.45, Neutral: 0, Negative: -0.45, Frustrated: -0.75 }[t.sentiment]
  return {
    email_type: { label: t.type, confidence: typeConf, source: 'encoder' },
    urgency: { label: t.urgency, confidence: round(0.62 + r() * 0.35) },
    sentiment: { label: t.sentiment, score: round(score + (r() - 0.5) * 0.2, 2), confidence: round(0.7 + r() * 0.28) },
    needs_review: typeConf < CONFIDENCE_THRESHOLD,
    model_version: MODEL_VERSION,
    processed_at: processedAt,
  }
}

export interface AddEmailOptions {
  template: Template
  user: UserRow
  receivedAt: number
  r: Rng
  /** Generated history: earlier messages in the thread, read state, an executed action, etc. */
  history?: boolean
  /** Arrivals start as `triaged` (labels, no summary yet); the pipeline enriches them later. */
  arriving?: boolean
}

/** Inserts one email with everything that belongs to it. Returns the row. */
export function addEmail(db: Db, { template: t, user, receivedAt, r, history = false, arriving = false }: AddEmailOptions) {
  const id = nextId('email')
  const from = typeof t.from === 'number' ? SENDERS[t.from] : t.from
  const me: Person = { address: user.email, name: user.display_name }
  const received = iso(receivedAt)

  const threadId = nextId('thread')
  const earlier = history && chance(r, 0.3) ? int(r, 1, 3) : 0
  const messages = Array.from({ length: earlier }, (_, i) => ({
    id: nextId('msg'),
    from: i % 2 ? me : person(from),
    subject: i ? `Re: ${t.subject}` : t.subject,
    received_at: iso(receivedAt - (earlier - i) * int(r, 2, 20) * HOUR),
  }))
  messages.push({ id, from: person(from), subject: earlier ? `Re: ${t.subject}` : t.subject, received_at: received })
  db.threads.set(threadId, { id: threadId, user_id: user.id, messages })

  const status: EmailRow['status'] = arriving
    ? 'triaged'
    : history
      ? pick(r, ['enriched', 'enriched', 'enriched', 'enriched', 'enriched', 'enriched', 'enrich_pending', 'enrich_failed'] as const)
      : 'enriched'

  const row: EmailRow = {
    id,
    user_id: user.id,
    thread_id: threadId,
    from: person(from),
    to: [me],
    cc: chance(r, 0.25) ? [person(pick(r, SENDERS))] : [],
    recipient_position: chance(r, 0.1) ? 'cc' : 'to',
    subject: messages[messages.length - 1].subject,
    received_at: received,
    body_text: t.body,
    status,
    security_flag: 'none',
    duplicate_count: history && chance(r, 0.1) ? int(r, 1, 3) : 0,
    attachments: (t.attachments ?? []).map((a, index) => ({ index, ...a })),
    auth_results: t.auth ?? { spf: 'pass', dkim: 'pass', dmarc: 'pass' },
    triage: triageFor(r, t, iso(receivedAt + 800)),
    summary: status === 'enriched' ? { one_line: t.oneLine, short: t.short } : null,
    pinned: false,
    snoozed_until: null,
  }
  db.emails.set(id, row)

  for (const link of t.links ?? []) {
    const host = new URL(link.url).host
    const chain = link.chain ?? [link.url]
    db.urlChecks.push({
      id: nextId('check'), email_id: id, url: link.url, anchor_text: link.anchor, host,
      // Arrivals are scored by M5 a moment later (email.flagged); until then the link is pending.
      verdict: arriving ? 'pending' : link.verdict,
      signals: link.signals ?? [], final_url: chain[chain.length - 1], chain,
      ...(link.clickVerdict && { click_verdict: link.clickVerdict }),
      ...(link.clickDelayMs && { click_delay_ms: link.clickDelayMs }),
    })
  }
  if (!arriving) row.security_flag = securityFlagOf(db, id)

  for (const s of t.secrets ?? []) {
    db.secrets.push({ id: nextId('secret'), email_id: id, owner_user_id: user.id, secret_type: s.type })
  }

  if (t.action && status === 'enriched') db.actions.set(...actionFor(db, row, t, user, r, history))
  return row
}

export function securityFlagOf(db: Db, emailId: string): EmailRow['security_flag'] {
  const verdicts = db.urlChecks.filter((c) => c.email_id === emailId).map((c) => c.verdict)
  if (verdicts.includes('malicious')) return 'malicious'
  return verdicts.includes('suspicious') ? 'suspicious' : 'none'
}

let jiraSeq = 140
export const nextJiraKey = (projectKey = 'ATL') => `${projectKey}-${++jiraSeq}`

/** After restoring persisted actions, continue numbering after the highest existing key, so keys never repeat. */
export function syncJiraSeq(db: Db) {
  for (const a of db.actions.values()) {
    const n = Number(/^[A-Z][A-Z0-9]+-(\d+)$/.exec(a.external_ref ?? '')?.[1])
    if (n > jiraSeq) jiraSeq = n
  }
}

/** M4's enrichment of an arrival: summaries, the proposed action, and M5's link verdicts. */
export function enrichEmail(db: Db, email: EmailRow, t: Template, user: UserRow, r: Rng) {
  email.status = 'enriched'
  email.summary = { one_line: t.oneLine, short: t.short }
  if (t.action) db.actions.set(...actionFor(db, email, t, user, r, false))
}

export function scoreLinks(db: Db, email: EmailRow, t: Template) {
  const checks = db.urlChecks.filter((c) => c.email_id === email.id)
  checks.forEach((c, i) => (c.verdict = t.links?.[i]?.verdict ?? 'clean'))
  email.security_flag = securityFlagOf(db, email.id)
}

/** A local wall-clock time on the received day, or on the next given weekday on or after it. */
function wallClock(received: number, day: 'same' | number, hour: number, minute = 0) {
  const d = new Date(received)
  if (day !== 'same') d.setDate(d.getDate() + ((day - d.getDay() + 7) % 7))
  d.setHours(hour, minute, 0, 0)
  return d.getTime()
}

/** The meeting start the summary names (ActionSpec.startAt), never before the email arrived. */
function startOf(spec: ActionSpec, received: number): number | null {
  if (!spec.startAt) return null
  const { day, hour, minute } = spec.startAt
  const t = wallClock(received, day, hour, minute)
  return t > received ? t : t + (day === 'same' ? 1 : 7) * DAY
}

/** The due date the summary names, as a local date. */
function dueOf(spec: ActionSpec, received: number): string | null {
  if (spec.dueOn !== undefined) return localDate(iso(wallClock(received, spec.dueOn, 12)))
  if (spec.dueInDays !== undefined) return localDate(iso(received + spec.dueInDays * DAY))
  return null
}

/** The decoder's proposal for an email (enrich.v1 action shape), optionally already executed. */
export function actionFor(db: Db, email: EmailRow, t: Template, user: UserRow, r: Rng, history: boolean): [string, ActionRow] {
  const spec = t.action!
  const received = Date.parse(email.received_at)
  const start = startOf(spec, received)
  const created = iso(received + 4000)
  const roll = history ? r() : 0
  const status: ActionStatus = roll < 0.45 ? 'proposed' : roll < 0.85 ? 'done' : 'rejected'
  const column: BoardColumn | null = status === 'done' ? pick(r, ['todo', 'in_progress', 'done'] as const) : null
  const jira = spec.type === 'create_jira_issue' && status === 'done'

  const id = nextId('action')
  const row: ActionRow = {
    id,
    user_id: user.id,
    email_id: email.id,
    type: spec.type,
    origin: 'decoder',
    status,
    payload: {
      title: spec.title,
      description: spec.description,
      priority: spec.priority ?? null,
      due_date: dueOf(spec, received),
      start: start ? iso(start) : null,
      end: start ? iso(start + (spec.minutes ?? 30) * 60_000) : null,
      attendees: start ? [email.from.address, user.email] : null,
    },
    board_column: column,
    board_position: null,
    external_ref: jira ? nextJiraKey() : spec.type === 'add_calendar_event' && status === 'done' ? `evt_${id.slice(-6)}` : null,
    external_status: jira ? ({ todo: 'To Do', in_progress: 'In Progress', done: 'Done' } as const)[column!] : null,
    error: null,
    created_at: created,
    updated_at: created,
  }
  if (column) row.board_position = [...db.actions.values()].filter((a) => a.user_id === user.id && a.board_column === column).length
  return [id, row]
}

export function createDb(now: number, seed = SEED): Db {
  counter = 0
  jiraSeq = 140
  const r = rng(seed)
  const db: Db = {
    users: USERS.map((u) => ({ ...u, ui_prefs: { ...u.ui_prefs }, last_login_at: iso(now - 2 * HOUR), mailbox: u.mailbox && { ...u.mailbox, last_polled_at: iso(now - 20_000) } })),
    threads: new Map(),
    emails: new Map(),
    urlChecks: [],
    secrets: [],
    actions: new Map(),
    corrections: [],
    labelRules: [],
    handled: new Map(),
    models: [
      { id: uid(NS.model, 1), version: 'triage-2026-10-24', status: 'retired', created_at: iso(now - 9 * DAY), promoted_at: iso(now - 9 * DAY),
        metrics: { type_macro_f1: 0.71, urgency_macro_f1: 0.64, sentiment_macro_f1: 0.69, per_class_f1: { Task: 0.76, Info: 0.74, Credentials: 0.83, Meeting: 0.71, Approval: 0.52 }, ece: 0.081 } },
      { id: uid(NS.model, 2), version: MODEL_VERSION, status: 'promoted', created_at: iso(now - 3 * DAY), promoted_at: iso(now - 3 * DAY),
        metrics: { type_macro_f1: 0.78, urgency_macro_f1: 0.69, sentiment_macro_f1: 0.73, per_class_f1: { Task: 0.82, Info: 0.79, Credentials: 0.9, Meeting: 0.77, Approval: 0.62 }, ece: 0.054 } },
    ],
    settings: {
      jira: { site_url: 'https://northwind-demo.atlassian.example', email: 'demo@northwind.example', project_key: 'ATL', token: 'mock-jira-token' },
      llm: { base_url: 'http://ollama:11434', model: 'qwen2.5:7b-instruct', api_style: 'ollama', api_key: null },
      confidence_threshold: CONFIDENCE_THRESHOLD,
      protected_domains: ['northwind.example'],
      poll_interval_s: 30,
    },
    audit: [],
    notifications: [],
    projects: [],
    projectItems: [],
    notes: [],
    reminders: [],
    files: [],
    layouts: new Map(),
    reads: new Map(USERS.map((u) => [u.id, new Set<string>()])),
    arrivals: [],
  }

  // Mailboxes: 50 emails for the demo user, 20 each for the others, over the last 14 days.
  for (const [user, count] of [[db.users[0], 50], [db.users[1], 20], [db.users[2], 20]] as const) {
    const times = Array.from({ length: count }, () => now - Math.floor(r() ** 1.6 * 14 * DAY) - 60_000).sort((a, b) => a - b)
    times.forEach((t, i) => {
      // Cycle through the templates so every type, urgency and link verdict appears; shuffle a little.
      const template = TEMPLATES[(i * 7 + int(r, 0, 2)) % TEMPLATES.length]
      const row = addEmail(db, { template, user, receivedAt: t, r, history: true })
      // Older mail is mostly read; recent mail mostly unread.
      if (chance(r, now - t > 2 * DAY ? 0.85 : 0.3)) db.reads.get(user.id)!.add(row.id)
      // A few older, read emails are already handled, so the Handled view has something in it.
      // Index-based, not random: drawing from r here would change every email generated after it.
      if (db.reads.get(user.id)!.has(row.id) && now - t > 5 * DAY && i % 4 === 1) handledOf(db, user.id).set(row.id, iso(t + HOUR))
    })
  }

  const demo = db.users[0]
  // Every click-time link outcome in one recent, unread email (LINK_SAMPLES).
  addEmail(db, { template: LINK_SAMPLES, user: demo, receivedAt: now - 3 * HOUR, r })
  db.projects = [
    { id: uid(NS.project, 1), user_id: demo.id, name: 'Q3 board meeting', colour: '#3b5bdb', icon: '📊', description: 'Deck and numbers for the Q3 board meeting.', deadline: iso(now + 3 * DAY), jira_project_key: 'ATL', jira_epic: 'ATL-100', archived_at: null, created_at: iso(now - 12 * DAY) },
    { id: uid(NS.project, 2), user_id: demo.id, name: 'Pune client visit', colour: '#e8590c', icon: '✈️', description: null, deadline: iso(now + 9 * DAY), jira_project_key: null, jira_epic: null, archived_at: null, created_at: iso(now - 5 * DAY) },
    { id: uid(NS.project, 3), user_id: demo.id, name: 'Onboarding redesign', colour: '#2b8a3e', icon: '🧭', description: 'New sign-up and first-run screens.', deadline: null, jira_project_key: 'ONB', jira_epic: null, archived_at: null, created_at: iso(now - 30 * DAY) },
  ]
  // Some of the demo mailbox already filed (FR-UI-016): the board deck and the Pune trip by subject.
  const file = (projectNo: number, match: RegExp) => {
    for (const e of db.emails.values()) {
      if (e.user_id !== demo.id || !match.test(e.subject ?? '')) continue
      const primary = !db.projectItems.some((i) => i.email_id === e.id)
      db.projectItems.push({ project_id: uid(NS.project, projectNo), email_id: e.id, action_id: null, is_primary: primary, added_at: e.received_at })
    }
  }
  file(1, /Q3 board|board deck/i)
  file(2, /Pune/i)

  // A few recent notifications per user, built with the privacy-safe builder (titles carry no content).
  let n = 0
  for (const user of db.users) {
    const recent = [...db.emails.values()].filter((e) => e.user_id === user.id).sort((a, b) => b.received_at.localeCompare(a.received_at))
    for (const e of recent.filter((e) => e.triage?.urgency.label === 'Critical').slice(0, 2)) {
      db.notifications.push({ ...buildNotification(++n, { kind: 'new_email', email: { from: e.from, subject: e.subject, triage: e.triage } }, { type: 'email', id: e.id }, iso(Date.parse(e.received_at) + 1000)), user_id: user.id })
    }
  }
  backfillEmailCards(db)
  return db
}
