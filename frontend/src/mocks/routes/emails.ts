// Emails (§6.5, §6.4.1): list with the v1.2 query, detail, label correction (FR-ML-010, FR-ML-013), .ics (FR-ORC-017).
import type { DecoderActionPayload, DueBucket, EmailType, EmailView, Sentiment, SecurityFlag, TriageView, Urgency } from '../../api/types'
import { page } from '../http/cursor'
import { Fail, own, route } from '../http/route'
import { csv, isDate, isDateTime, object } from '../http/validate'
import { changed, db, emailsOf, readsOf } from '../store/db'
import { publish } from '../store/events'
import { handledOf } from '../store/generate'
import { cardFollowsEmail } from '../store/emailCards'
import { localDate, toDetail, toListItem, dueDateOf } from '../store/serialize'
import { matchesDue } from '../../lib/due'
import type { EmailRow } from '../store/types'

const TYPES: EmailType[] = ['Task', 'Info', 'Credentials', 'Meeting', 'Approval']
const URGENCIES: Urgency[] = ['Low', 'Medium', 'High', 'Critical']
const SENTIMENTS: Sentiment[] = ['Positive', 'Neutral', 'Negative', 'Frustrated']
const FLAGS: SecurityFlag[] = ['none', 'suspicious', 'malicious']
const LABELS = { email_type: TYPES, urgency: URGENCIES, sentiment: SENTIMENTS } as const
const VIEWS: EmailView[] = ['unread', 'due_today', 'needs_reply', 'overdue', 'handled']
const DUE: DueBucket[] = ['overdue', 'today', 'next_7_days', 'later', 'none']

/** `needs_review` (PROPOSED, proposals §15.2): triage.v1's needs_review flag. true or false; anything else is 400. */
function needsReviewParam(url: URL): boolean | null {
  const v = url.searchParams.get('needs_review')
  if (v === null || v === '') return null
  if (v !== 'true' && v !== 'false') throw new Fail(400, 'bad_request', 'needs_review must be true or false')
  return v === 'true'
}
const REPLY_TYPES: EmailType[] = ['Task', 'Approval', 'Meeting']

/** `view` (PROPOSED, proposals §10.1): comma-separated, AND-combined. Unknown values: 422 invalid_parameter (§10). */
function views(url: URL): EmailView[] {
  const raw = url.searchParams.get('view')
  if (!raw) return []
  const list = raw.split(',').map((v) => v.trim()).filter(Boolean)
  const bad = list.filter((v) => !(VIEWS as string[]).includes(v))
  if (bad.length) throw new Fail(422, 'invalid_parameter', `Unknown view: ${bad.join(', ')}`, { parameter: 'view', allowed: VIEWS })
  return list as EmailView[]
}

/**
 * One view predicate for one email of `userId`. needs_reply is the demo rule (proposals §10.1, NEEDS TEAM SIGN-OFF):
 * latest thread message inbound, type Task/Approval/Meeting, no accepted action.
 */
function inView(view: EmailView, e: EmailRow, userId: string, today: string): boolean {
  const item = toListItem(db, e)
  switch (view) {
    case 'unread':
      return !(db.reads.get(userId)?.has(e.id) ?? false)
    case 'handled':
      return item.handled
    case 'due_today':
      return item.due_date === today
    case 'overdue':
      return item.due_date !== null && item.due_date < today && !item.handled
    case 'needs_reply': {
      const me = db.users.find((u) => u.id === userId)?.email.toLowerCase()
      const thread = e.thread_id ? db.threads.get(e.thread_id) : undefined
      const latest = thread?.messages.at(-1)?.from ?? e.from
      const accepted = [...db.actions.values()].some((a) => a.email_id === e.id && ['accepted', 'executing', 'done'].includes(a.status))
      return latest.address.toLowerCase() !== me && !!e.triage && REPLY_TYPES.includes(e.triage.email_type.label) && !accepted
    }
  }
}

function dateParam(url: URL, name: string) {
  const v = url.searchParams.get(name)
  if (v === null || v === '') return null
  if (!isDate(v)) throw new Fail(400, 'bad_request', `${name} must be YYYY-MM-DD`)
  return v
}

/** Keyword search over masked text only: subject and the stored (masked) body (FR-UI-026). */
const matchesKeywords = (e: EmailRow, q: string, subjectOnly = false) => {
  const hay = (subjectOnly ? (e.subject ?? '') : `${e.subject ?? ''}\n${e.body_text}`).toLowerCase()
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((term) => hay.includes(term))
}

/** The GET /emails filter parameters (§6.4.1 plus the PROPOSED view), parsed and checked. Throws Fail like the route. */
function parseFilters(url: URL) {
  // OR within a parameter, AND across parameters (§6.4.1).
  return {
    type: csv(url, 'type', TYPES),
    urgency: csv(url, 'urgency', URGENCIES),
    sentiment: csv(url, 'sentiment', SENTIMENTS),
    flag: csv(url, 'flag', FLAGS),
    due: csv(url, 'due', DUE),
    needsReview: needsReviewParam(url),
    sender: url.searchParams.get('sender')?.trim().toLowerCase() || null,
    after: dateParam(url, 'received_after'),
    before: dateParam(url, 'received_before'),
    view: views(url),
  }
}

/** The parameters a saved column filter may hold: GET /emails filters only, no sort, cursor, limit or q. */
export const FILTER_PARAMS = ['project', 'type', 'urgency', 'sentiment', 'flag', 'due', 'needs_review', 'sender', 'received_after', 'received_before', 'view'] as const

/**
 * Checks a widget filter (proposals §13) with the same parser GET /emails uses, so there is one vocabulary.
 * Returns an error message, or null when it is valid.
 */
export function filterError(filter: string): string | null {
  const url = new URL(`http://x/?${filter}`)
  const extra = [...url.searchParams.keys()].find((k) => !(FILTER_PARAMS as readonly string[]).includes(k))
  if (extra) return `Not a filter parameter: ${extra}`
  try {
    parseFilters(url)
    return null
  } catch (err) {
    return err instanceof Fail ? err.message : 'Invalid filter'
  }
}

function filtered(user: { id: string }, url: URL) {
  const { type, urgency, sentiment, flag, due, needsReview, sender, after, before, view } = parseFilters(url)
  const q = url.searchParams.get('q')?.trim() || null
  // PROPOSED (proposals §26): q_in=subject searches subjects only; all (default) also the masked body.
  const qIn = url.searchParams.get('q_in') ?? 'all'
  if (qIn !== 'subject' && qIn !== 'all') throw new Fail(422, 'invalid_parameter', 'q_in must be subject or all', { parameter: 'q_in' })
  // PROPOSED (proposals §27): include_handled=true keeps handled mail in the list (search), in the same order and paging.
  const ih = url.searchParams.get('include_handled')
  if (ih !== null && ih !== 'true' && ih !== 'false') throw new Fail(422, 'invalid_parameter', 'include_handled must be true or false', { parameter: 'include_handled' })
  const includeHandled = ih === 'true'
  const today = localDate(new Date().toISOString())
  // project (FR-UI-021): emails in any of these projects. The other S parameters (status, pinned, snoozed, tag) are
  // accepted and ignored until built (§6.4.1).
  const projects = url.searchParams.get('project')?.split(',').filter(Boolean) ?? null
  const inProject = projects && new Set(db.projectItems.filter((i) => i.email_id && projects.includes(i.project_id)).map((i) => i.email_id))
  const order = sorter(url)

  return emailsOf(user.id)
    .filter((e) => !inProject || inProject.has(e.id))
    .filter((e) => !type || (e.triage && type.includes(e.triage.email_type.label)))
    .filter((e) => !urgency || (e.triage && urgency.includes(e.triage.urgency.label)))
    .filter((e) => !sentiment || (e.triage && sentiment.includes(e.triage.sentiment.label)))
    .filter((e) => !flag || flag.includes(e.security_flag))
    // `due`: the derived due_date (proposals §10.2) in the user's local date; OR within the group.
    .filter((e) => !due || matchesDue(dueDateOf([...db.actions.values()].filter((a) => a.email_id === e.id)), due, today))
    .filter((e) => needsReview === null || (!!e.triage && e.triage.needs_review === needsReview))
    .filter((e) => {
      if (!sender) return true
      const addr = e.from.address.toLowerCase()
      return addr === sender || addr.endsWith(`@${sender.replace(/^@/, '')}`)
    })
    .filter((e) => !after || e.received_at.slice(0, 10) >= after)
    .filter((e) => !before || e.received_at.slice(0, 10) <= before)
    .filter((e) => !q || matchesKeywords(e, q, qIn === 'subject'))
    // Handled mail leaves the default inbox and is surfaced with view=handled (proposals §10.3).
    .filter((e) => includeHandled || view.includes('handled') || !(db.handled.get(user.id)?.has(e.id) ?? false))
    .filter((e) => view.every((v) => inView(v, e, user.id, today)))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || order(a, b)) // pinned stay on top (FR-UI-023)
}

const newest = (a: EmailRow, b: EmailRow) => b.received_at.localeCompare(a.received_at)
const RANK: Record<Urgency, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 }
const senderKey = (e: EmailRow) => (e.from.name ?? e.from.address).toLowerCase()

/**
 * `sort` (§6.5 v1.1 list; newest is the default and the only Must sort, FR-ORC-008). Ties fall back to newest.
 * `smart` and `due` are accepted and served as newest until built: Smart's weights and per-card explanation and the
 * email due date have no shape yet (proposals §9). Untriaged emails sort last for urgency and confidence.
 */
function sorter(url: URL): (a: EmailRow, b: EmailRow) => number {
  const sort = url.searchParams.get('sort') || 'newest'
  switch (sort) {
    case 'newest':
    case 'smart':
    case 'due':
      return newest
    case 'oldest':
      return (a, b) => -newest(a, b)
    case 'urgency':
      return (a, b) => (a.triage ? RANK[a.triage.urgency.label] : 9) - (b.triage ? RANK[b.triage.urgency.label] : 9) || newest(a, b)
    case 'sender':
      return (a, b) => senderKey(a).localeCompare(senderKey(b)) || newest(a, b)
    case 'confidence':
      return (a, b) => (a.triage?.email_type.confidence ?? 2) - (b.triage?.email_type.confidence ?? 2) || newest(a, b)
    default:
      throw new Fail(422, 'invalid_parameter', 'sort must be smart, newest, oldest, due, urgency, sender or confidence', {
        parameter: 'sort',
      })
  }
}

/** RFC 5545 text escaping, so email-derived text can't inject calendar properties. */
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const icsDate = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '')

export const emailRoutes = [
  route('get', '/emails', 'user', ({ user, url }) => page(url, filtered(user, url).map((e) => toListItem(db, e)))),

  route<{ id: string }>('get', '/emails/:id', 'user', ({ user, params }) =>
    toDetail(db, own(db.emails.get(params.id), user, 'Email')),
  ),

  // PATCH /emails/:id (§6.5 v1.1 {pinned, snoozed_until}; handled and read PROPOSED, §10.3 and §12.3). Returns the
  // updated EmailDetail. own() makes it owner-only, and handled and read change only the caller's own state (§12.1).
  route<{ id: string }>('patch', '/emails/:id', 'user', ({ user, params, body }) => {
    const email = own(db.emails.get(params.id), user, 'Email')
    const f = object(body).only(['pinned', 'snoozed_until', 'handled', 'read'])
    if ('pinned' in f.body && typeof f.body.pinned !== 'boolean') f.add('pinned', 'Must be true or false')
    if ('handled' in f.body && typeof f.body.handled !== 'boolean') f.add('handled', 'Must be true or false')
    if ('read' in f.body && typeof f.body.read !== 'boolean') f.add('read', 'Must be true or false')
    if ('snoozed_until' in f.body && f.body.snoozed_until !== null && !isDateTime(f.body.snoozed_until)) f.add('snoozed_until', 'Must be an ISO date-time or null')
    f.done()
    if (typeof f.body.pinned === 'boolean') email.pinned = f.body.pinned
    if ('snoozed_until' in f.body) email.snoozed_until = f.body.snoozed_until as string | null
    if (typeof f.body.handled === 'boolean') {
      const handled = handledOf(db, user.id)
      if (f.body.handled) handled.set(email.id, handled.get(email.id) ?? new Date().toISOString())
      else handled.delete(email.id)
      cardFollowsEmail(user.id, email.id, f.body.handled)
    }
    if (typeof f.body.read === 'boolean') {
      if (f.body.read) readsOf(user.id).add(email.id)
      else readsOf(user.id).delete(email.id)
    }
    changed()
    publish(user.id, 'email.triaged', { email_id: email.id, email: toListItem(db, email) })
    return toDetail(db, email)
  }),

  route<{ id: string }>('patch', '/emails/:id/labels', 'user', ({ user, params, body }) => {
    const email = own(db.emails.get(params.id), user, 'Email')
    const f = object(body).only(['field', 'value', 'scope'])
    const field = f.body.field as keyof typeof LABELS
    const scope = (f.body.scope ?? 'email') as 'email' | 'sender' | 'similar'
    if (!(field in LABELS)) f.add('field', 'Must be email_type, urgency or sentiment')
    else if (!(LABELS[field] as readonly string[]).includes(f.body.value as string)) f.add('value', `Not a valid ${field}`)
    if (!['email', 'sender', 'similar'].includes(scope)) f.add('scope', 'Must be email, sender or similar')
    f.done()
    if (!email.triage) throw new Fail(409, 'conflict', 'Email is not triaged yet')

    const triage = email.triage as TriageView
    const value = f.body.value as string
    const correction = {
      id: crypto.randomUUID(), // a UUID string (proposals §10.5)
      email_id: email.id,
      user_id: user.id,
      field,
      old_label: triage[field].label,
      new_label: value,
      created_at: new Date().toISOString(),
    }
    db.corrections.push(correction) // FR-ML-010; feeds retraining (FR-ML-011)
    triage[field].label = value as never
    if (field === 'email_type') triage.email_type.source = 'user'
    triage.needs_review = false

    // FR-ML-013 "Always from this sender": a personal rule, this user only, never the shared model (FR-ML-015).
    // "Emails like this" (FR-ML-014, S) is stored as a plain correction until similarity overrides are built.
    let ruleId: string | null = null
    if (scope === 'sender') {
      const sender = email.from.address.toLowerCase()
      const existing = db.labelRules.find((r) => r.user_id === user.id && r.field === field && r.sender === sender)
      if (existing) existing.label = value
      else db.labelRules.push({ id: crypto.randomUUID(), user_id: user.id, field, sender, label: value, hit_count: 0, created_at: correction.created_at })
      ruleId = (existing ?? db.labelRules.at(-1)!).id
    }
    changed()
    // Relabel of a known email: clients update it in place (§6.4.1 email.triaged).
    publish(user.id, 'email.triaged', { email_id: email.id, email: toListItem(db, email) })
    return { triage: structuredClone(triage), correction_id: correction.id, rule_id: ruleId }
  }),

  route<{ id: string }>('get', '/emails/:id/ics', 'user', ({ user, params }) => {
    const email = own(db.emails.get(params.id), user, 'Email')
    const event = [...db.actions.values()].find((a) => a.email_id === email.id && a.type === 'add_calendar_event')
    const p = event?.payload as DecoderActionPayload | undefined
    if (email.triage?.email_type.label !== 'Meeting' || !p?.start || !p.end) {
      throw new Fail(404, 'not_found', 'No meeting time for this email')
    }
    const lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SECEP//EN', 'BEGIN:VEVENT',
      `UID:${email.id}@secep`, `DTSTAMP:${icsDate(new Date().toISOString())}`,
      `DTSTART:${icsDate(p.start)}`, `DTEND:${icsDate(p.end)}`,
      `SUMMARY:${icsText(p.title ?? email.subject ?? 'Meeting')}`,
      ...(p.description ? [`DESCRIPTION:${icsText(p.description)}`] : []),
      ...(p.attendees ?? []).map((a) => `ATTENDEE:mailto:${a}`),
      'END:VEVENT', 'END:VCALENDAR',
    ]
    return new Response(lines.join('\r\n') + '\r\n', {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="meeting.ics"',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  }),
]
