// Actions (§6.5, §6.4.1): FR-ORC-001–007. Only allowlisted types with valid payloads execute, and only after the
// owner accepts (FR-ORC-002). One Jira issue per action (FR-ORC-005).
import type { ActionType, BoardColumn, DecoderActionPayload, JiraPriority, Urgency, UserCardPayload } from '../../api/types'
import { createIssue, JiraError } from '../jira'
import { page } from '../http/cursor'
import { errorResponse, Fail, own, route } from '../http/route'
import { isDate, isDateTime, isEmail, isInt, isOptStr, isStr, object, type Fields } from '../http/validate'
import { audit } from '../store/audit'
import { changed, db } from '../store/db'
import { emailFollowsCard } from '../store/emailCards'
import { publish } from '../store/events'
import { projectCards, toAction, toListItem } from '../store/serialize'
import type { ActionRow, UserRow } from '../store/types'

const TYPES: ActionType[] = ['create_jira_issue', 'add_board_card', 'add_calendar_event']
const COLUMNS: BoardColumn[] = ['todo', 'in_progress', 'done']
const PRIORITIES: JiraPriority[] = ['Highest', 'High', 'Medium', 'Low']
const PAYLOAD_KEYS = ['title', 'description', 'priority', 'due_date', 'start', 'end', 'attendees'] as const

/** FR-UI-029: "about 10 s" in the UI; the server allows a little more for the round trip. */
const UNDO_WINDOW_MS = 12_000

/** FR-ORC-004: urgency → Jira priority. */
export const PRIORITY_FOR: Record<Urgency, JiraPriority> = { Critical: 'Highest', High: 'High', Medium: 'Medium', Low: 'Low' }

/** enrich.v1 field rules for (partial) payload edits. */
function checkPayloadFields(f: Fields, p: Record<string, unknown>, prefix = 'payload.') {
  for (const k of Object.keys(p)) if (!(PAYLOAD_KEYS as readonly string[]).includes(k)) f.add(prefix + k, 'Unknown field')
  if ('title' in p && !isOptStr(p.title, 120)) f.add(`${prefix}title`, 'At most 120 characters')
  if ('description' in p && !isOptStr(p.description, 2000)) f.add(`${prefix}description`, 'At most 2000 characters')
  if ('priority' in p && p.priority !== null && !PRIORITIES.includes(p.priority as JiraPriority)) f.add(`${prefix}priority`, 'Not a Jira priority')
  if ('due_date' in p && p.due_date !== null && !isDate(p.due_date)) f.add(`${prefix}due_date`, 'Must be YYYY-MM-DD')
  for (const k of ['start', 'end'] as const) if (k in p && p[k] !== null && !isDateTime(p[k])) f.add(prefix + k, 'Must be an ISO date-time')
  if ('attendees' in p && p.attendees !== null && !(Array.isArray(p.attendees) && p.attendees.every(isEmail))) {
    f.add(`${prefix}attendees`, 'Must be a list of email addresses')
  }
}

/** §6.4 per-type rules, enforced before execution (FR-ORC-002). */
function checkTypeRules(type: ActionType, p: DecoderActionPayload, f: Fields) {
  if (!p.title) f.add('payload.title', 'Required')
  if (type === 'create_jira_issue' && !p.priority) f.add('payload.priority', 'Required for a Jira issue')
  if (type === 'add_calendar_event') {
    if (!p.start) f.add('payload.start', 'Required for a calendar event')
    if (!p.end) f.add('payload.end', 'Required for a calendar event')
    if (!p.attendees?.length) f.add('payload.attendees', 'Required for a calendar event')
    if (p.start && p.end && p.end <= p.start) f.add('payload.end', 'Must be after start')
  }
}

const now = () => new Date().toISOString()

const URGENCIES: Urgency[] = ['Critical', 'High', 'Medium', 'Low']
const SOURCES = ['in_person', 'call', 'chat']
const CARD_KEYS = ['title', 'description', 'due_date', 'due_time', 'urgency', 'checklist', 'source', 'person'] as const

/** User-card payload rules (§6.4 FR-CNT-002, proposals §19.1), for a whole payload or a partial edit. */
export function checkCardPayload(f: Fields, p: Record<string, unknown>, partial: boolean) {
  for (const k of Object.keys(p)) if (!(CARD_KEYS as readonly string[]).includes(k)) f.add(`payload.${k}`, 'Unknown field')
  if ((!partial || 'title' in p) && !(isStr(p.title, 120) && (p.title as string).trim())) f.add('payload.title', 'Required, at most 120 characters')
  if ('description' in p && !isOptStr(p.description, 2000)) f.add('payload.description', 'At most 2000 characters')
  if ('due_date' in p && p.due_date !== null && !isDate(p.due_date)) f.add('payload.due_date', 'Must be YYYY-MM-DD')
  if ('due_time' in p && p.due_time !== null && !(typeof p.due_time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(p.due_time))) f.add('payload.due_time', 'Must be HH:MM')
  if ('urgency' in p && p.urgency !== null && !URGENCIES.includes(p.urgency as Urgency)) f.add('payload.urgency', 'Not an urgency')
  if ('checklist' in p && !(Array.isArray(p.checklist) && p.checklist.length <= 50 && p.checklist.every((i) => i && typeof i === 'object' && isStr(i.text, 200) && i.text.trim() && typeof i.done === 'boolean' && Object.keys(i).length === 2))) {
    f.add('payload.checklist', 'Up to 50 items of {text, done}')
  }
  if ('source' in p && p.source !== null && !SOURCES.includes(p.source as string)) f.add('payload.source', 'Must be in_person, call or chat')
  if ('person' in p && !isOptStr(p.person, 120)) f.add('payload.person', 'At most 120 characters')
}
const isUserCard = (a: ActionRow) => a.origin === 'user' && a.email_id === null && a.type === 'add_board_card'

/** Appends a card to the end of a board column (FR-ORC-007). */
function placeOnBoard(a: ActionRow, column: BoardColumn) {
  const others = [...db.actions.values()].filter((x) => x.user_id === a.user_id && x.board_column === column && x.id !== a.id)
  a.board_column = column
  a.board_position = others.length
}

function emitUpdated(a: ActionRow) {
  publish(a.user_id, 'action.updated', { action: toAction(a) })
  const email = a.email_id ? db.emails.get(a.email_id) : undefined
  // proposed_action_count / jira_key changed on the card: update it in place.
  if (email) publish(a.user_id, 'email.triaged', { email_id: email.id, email: toListItem(db, email) })
}

const KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/
const EPIC_RE = /^[A-Z][A-Z0-9]{1,9}-\d+$/

/** The caller's primary project for an email or card (FR-UI-017: it decides Jira routing). */
function primaryProject(a: ActionRow, user: UserRow) {
  const items = db.projectItems.filter((i) => i.is_primary && (a.email_id ? i.email_id === a.email_id : i.action_id === (a.card_id ?? a.id)))
  return items.map((i) => db.projects.find((p) => p.id === i.project_id)).find((p) => p && p.user_id === user.id)
}

/**
 * Proposals §25.2 (FR-ORC-012): where the issue goes. An explicit `jira` in the accept body wins; otherwise the primary
 * project's Jira project and epic; otherwise the tenant default project with no epic.
 */
export function jiraTarget(a: ActionRow, user: UserRow, given?: { project_key: string | null; epic: string | null }) {
  const p = primaryProject(a, user)
  const fallback = db.settings.jira.project_key ?? 'ATL'
  if (given) return { project_key: given.project_key ?? fallback, epic: given.epic }
  return { project_key: p?.jira_project_key ?? fallback, epic: p?.jira_project_key ? p.jira_epic : null }
}

async function execute(a: ActionRow, user: UserRow, target?: { project_key: string; epic: string | null }): Promise<Response | ActionRow> {
  a.status = 'executing'
  a.updated_at = now()
  try {
    if (a.type === 'create_jira_issue') {
      const t = target ?? jiraTarget(a, user)
      // FR-ORC-003; assigned to the caller (§12.2), in the target project and under its epic (§25.2).
      a.external_ref = await createIssue({ assignee: user.email, project_key: t.project_key, epic: t.epic })
      a.external_status = 'To Do'
    } else if (a.type === 'add_calendar_event') {
      a.external_ref = `evt_${crypto.randomUUID().slice(0, 8)}` // simulated Google Calendar events.insert (FR-ORC-010)
    }
    a.status = 'done'
    a.error = null
    a.undo_until = new Date(Date.now() + UNDO_WINDOW_MS).toISOString()
    // FR-ORC-007: accepted cards and created Jira issues land in To do. One sent from a card (§27.2) stays off the
    // board: the card is already there and lists it.
    if (!a.card_id) placeOnBoard(a, 'todo')
    await audit(user.id, 'action.execute', a.id, { type: a.type, outcome: 'done', external_ref: a.external_ref })
    return a
  } catch (err) {
    if (!(err instanceof JiraError)) throw err
    a.status = 'failed'
    a.error = `Jira ${err.status}: ${err.message}`
    await audit(user.id, 'action.execute', a.id, { type: a.type, outcome: 'failed', status: err.status })
    // 400/401: the action fails and the user sees Jira's error (FR-ORC-006). Retries exhausted on 429/5xx: 502.
    if (err.retryable) {
      return errorResponse(502, 'upstream_error', 'Jira is unavailable', { provider: 'jira', status: err.status, message: err.message })
    }
    return a
  } finally {
    a.updated_at = now()
    changed()
    emitUpdated(a)
  }
}

/** Takes a card off the board and closes the gap it leaves. */
function removeFromBoard(a: ActionRow) {
  const from = a.board_column
  a.board_column = null
  a.board_position = null
  if (!from) return
  ;[...db.actions.values()]
    .filter((x) => x.user_id === a.user_id && x.board_column === from)
    .sort((x, y) => (x.board_position ?? 0) - (y.board_position ?? 0))
    .forEach((c, i) => (c.board_position = i))
}

function boardMove(a: ActionRow, column: BoardColumn, position: number) {
  const cards = [...db.actions.values()]
    .filter((x) => x.user_id === a.user_id && x.board_column === column && x.id !== a.id)
    .sort((x, y) => (x.board_position ?? 0) - (y.board_position ?? 0))
  const from = a.board_column
  cards.splice(Math.min(position, cards.length), 0, a)
  cards.forEach((c, i) => {
    c.board_column = column
    c.board_position = i
  })
  // Close the gap in the column it left.
  if (from && from !== column) {
    ;[...db.actions.values()]
      .filter((x) => x.user_id === a.user_id && x.board_column === from)
      .sort((x, y) => (x.board_position ?? 0) - (y.board_position ?? 0))
      .forEach((c, i) => (c.board_position = i))
  }
}

/**
 * PROPOSED (proposals §27.2): POST /actions { type: create_jira_issue | add_calendar_event, payload, card_id } makes a
 * proposed action for one of the caller's cards, accepted as usual (POST /actions/:id/accept). Same payload and
 * per-type rules as an email's actions; the Jira priority defaults from the card's urgency.
 */
function sendFromCard(user: UserRow, body: unknown) {
  const f = object(body).only(['type', 'payload', 'card_id'])
  const type = f.body.type as ActionType
  if (type !== 'create_jira_issue' && type !== 'add_calendar_event') f.add('type', 'Must be create_jira_issue or add_calendar_event')
  const raw = (f.body.payload ?? {}) as Record<string, unknown>
  if (typeof raw !== 'object' || Array.isArray(raw)) f.add('payload', 'Must be an object')
  else checkPayloadFields(f, raw)
  f.done()
  const card = own(typeof f.body.card_id === 'string' ? db.actions.get(f.body.card_id) : undefined, user, 'Card')
  if (!isUserCard(card)) throw new Fail(409, 'conflict', 'Only cards you made can be sent')
  const payload: DecoderActionPayload = { title: null, description: null, priority: null, due_date: null, start: null, end: null, attendees: null, ...raw }
  const urgency = (card.payload as UserCardPayload).urgency
  if (type === 'create_jira_issue' && !payload.priority && urgency) payload.priority = PRIORITY_FOR[urgency]
  checkTypeRules(type, payload, f)
  f.done('action_invalid', 'Action payload fails the per-type rules')
  const a: ActionRow = {
    id: crypto.randomUUID(), user_id: user.id, email_id: null, card_id: card.id, type, origin: 'user', status: 'proposed', payload,
    board_column: null, board_position: null, external_ref: null, external_status: null, error: null, created_at: now(), updated_at: now(),
  }
  db.actions.set(a.id, a)
  changed()
  emitUpdated(a)
  return new Response(JSON.stringify(toAction(a)), { status: 201, headers: { 'Content-Type': 'application/json' } })
}

export const actionRoutes = [
  route('get', '/actions', 'user', ({ user, url }) => {
    const status = url.searchParams.get('status')
    const column = url.searchParams.get('column')
    if (column && !COLUMNS.includes(column as BoardColumn)) throw new Fail(400, 'bad_request', 'Unknown column')
    // PROPOSED (proposals §18.3): a project's cards, from its emails or filed in it.
    const projectId = url.searchParams.get('project')
    // PROPOSED (proposals §27.2): the Jira issues and events sent from one card.
    const cardId = url.searchParams.get('card')
    if (cardId) own(db.actions.get(cardId), user, 'Card')
    const inProject = projectId ? new Set(projectCards(db, own(db.projects.find((p) => p.id === projectId), user, 'Project').id).map((a) => a.id)) : null
    const items = [...db.actions.values()]
      .filter((a) => a.user_id === user.id && (!status || a.status === status) && (!column || a.board_column === column) && (!inProject || inProject.has(a.id)) && (!cardId || a.card_id === cardId))
      .sort((a, b) => (a.board_position ?? Infinity) - (b.board_position ?? Infinity) || b.created_at.localeCompare(a.created_at))
    return page(url, items.map(toAction))
  }),

  route<{ id: string }>('post', '/emails/:id/actions', 'user', ({ user, params, body }) => {
    const email = own(db.emails.get(params.id), user, 'Email')
    const f = object(body).only(['type', 'payload'])
    const type = f.body.type as ActionType
    if (!TYPES.includes(type)) f.add('type', 'Not an allowed action type')
    const raw = (f.body.payload ?? {}) as Record<string, unknown>
    checkPayloadFields(f, raw)
    f.done()
    const payload: DecoderActionPayload = { title: null, description: null, priority: null, due_date: null, start: null, end: null, attendees: null, ...raw }
    if (type === 'create_jira_issue' && !payload.priority && email.triage) payload.priority = PRIORITY_FOR[email.triage.urgency.label]
    checkTypeRules(type, payload, f)
    f.done('action_invalid', 'Action payload fails the per-type rules')
    const a: ActionRow = {
      id: crypto.randomUUID(), user_id: user.id, email_id: email.id, type, origin: 'user', status: 'proposed', payload,
      board_column: null, board_position: null, external_ref: null, external_status: null, error: null, created_at: now(), updated_at: now(),
    }
    db.actions.set(a.id, a)
    changed()
    emitUpdated(a)
    return toAction(a)
  }),

  // User card (FR-CNT-002, proposals §19.1): no email; lands in To do.
  route('post', '/actions', 'user', ({ user, body }) => {
    if ((body as { card_id?: unknown } | null)?.card_id !== undefined) return sendFromCard(user, body)
    const f = object(body).only(['type', 'payload'])
    if (f.body.type !== 'add_board_card') f.add('type', 'Only add_board_card')
    const p = (f.body.payload ?? {}) as Record<string, unknown>
    if (typeof p !== 'object' || Array.isArray(p)) f.add('payload', 'Must be an object')
    else checkCardPayload(f, p, false)
    f.done()
    const c = p as Partial<UserCardPayload>
    if (c.due_time && !c.due_date) f.add('payload.due_time', 'Needs a due date')
    f.done()
    const payload: UserCardPayload = {
      title: c.title!.trim(), description: c.description ?? null, due_date: c.due_date ?? null, due_time: c.due_time ?? null,
      urgency: c.urgency ?? null, checklist: c.checklist ?? [], source: c.source ?? null, person: c.person ?? null,
    }
    const a: ActionRow = {
      id: crypto.randomUUID(), user_id: user.id, email_id: null, type: 'add_board_card', origin: 'user', status: 'done', payload,
      board_column: null, board_position: null, external_ref: null, external_status: null, error: null, created_at: now(), updated_at: now(),
    }
    placeOnBoard(a, 'todo')
    db.actions.set(a.id, a)
    changed()
    emitUpdated(a)
    return toAction(a)
  }, { status: 201 }),

  // PROPOSED (proposals §19.1): a user card can be deleted; the client's Undo re-creates it.
  route<{ id: string }>('delete', '/actions/:id', 'user', async ({ user, params }) => {
    const a = own(db.actions.get(params.id), user, 'Action')
    if (!isUserCard(a)) throw new Fail(409, 'conflict', 'Only cards you made can be deleted')
    removeFromBoard(a)
    db.actions.delete(a.id)
    db.projectItems = db.projectItems.filter((i) => i.action_id !== a.id)
    db.notes = db.notes.filter((n) => !(n.target_type === 'card' && n.target_id === a.id))
    await audit(user.id, 'action.delete', a.id, { type: a.type })
    changed()
    return undefined
  }),

  route<{ id: string }>('post', '/actions/:id/accept', 'user', async ({ user, params, body }) => {
    const a = own(db.actions.get(params.id), user, 'Action')
    // FR-ORC-005: already executed → return it as is; never a second issue.
    if (a.status === 'done') return toAction(a)
    if (a.status === 'executing') throw new Fail(409, 'conflict', 'Action is already executing')
    if (a.status === 'rejected') throw new Fail(409, 'conflict', 'Action was rejected')

    const f = object(body ?? {}).only(['payload', 'mode', 'jira'])
    const edits = (f.body.payload ?? {}) as Record<string, unknown>
    if (typeof edits !== 'object' || Array.isArray(edits)) f.add('payload', 'Must be an object')
    else checkPayloadFields(f, edits)
    // Proposals §25.2: optional Jira target for create_jira_issue only.
    const jira = f.body.jira as { project_key?: unknown; epic?: unknown } | undefined
    if (jira !== undefined) {
      if (a.type !== 'create_jira_issue') f.add('jira', 'Only for Jira issues')
      else if (typeof jira !== 'object' || jira === null || Array.isArray(jira) || Object.keys(jira).some((k) => k !== 'project_key' && k !== 'epic')) f.add('jira', 'Must be { project_key, epic }')
      else {
        if (jira.project_key != null && !(typeof jira.project_key === 'string' && KEY_RE.test(jira.project_key))) f.add('jira.project_key', 'A Jira project key, like ATL')
        if (jira.epic != null && !(typeof jira.epic === 'string' && EPIC_RE.test(jira.epic))) f.add('jira.epic', 'An issue key, like ATL-100')
      }
    }
    // mode "comment" (FR-ORC-013, S) is accepted and treated as "issue" until commenting is built.
    if (f.body.mode !== undefined && f.body.mode !== 'issue' && f.body.mode !== 'comment') f.add('mode', 'Must be issue or comment')
    f.done()

    const payload = { ...(a.payload as DecoderActionPayload), ...edits } as DecoderActionPayload
    const email = a.email_id ? db.emails.get(a.email_id) : undefined
    if (a.type === 'create_jira_issue' && !payload.priority && email?.triage) payload.priority = PRIORITY_FOR[email.triage.urgency.label]
    checkTypeRules(a.type, payload, f)
    f.done('action_invalid', 'Action payload fails the per-type rules')
    a.payload = payload

    const given = jira && { project_key: (jira.project_key as string | null | undefined) ?? null, epic: (jira.epic as string | null | undefined) ?? null }
    const result = await execute(a, user, a.type === 'create_jira_issue' ? jiraTarget(a, user, given) : undefined)
    return result instanceof Response ? result : toAction(result)
  }),

  // FR-UI-029 / §6.5: within the undo window, delete the created Jira issue or Calendar event (simulated) and put the
  // action back to proposed, off the board. Audited without content.
  route<{ id: string }>('post', '/actions/:id/undo', 'user', async ({ user, params }) => {
    const a = own(db.actions.get(params.id), user, 'Action')
    if (a.status !== 'done' || !a.undo_until || Date.parse(a.undo_until) < Date.now()) {
      throw new Fail(409, 'conflict', 'This action can no longer be undone')
    }
    const ref = a.external_ref
    removeFromBoard(a)
    a.status = 'proposed'
    a.external_ref = null
    a.external_status = null
    a.undo_until = null
    a.updated_at = now()
    await audit(user.id, 'action.undo', a.id, { type: a.type, external_ref: ref })
    changed()
    emitUpdated(a)
    return toAction(a)
  }),

  route<{ id: string }>('post', '/actions/:id/reject', 'user', ({ user, params }) => {
    const a = own(db.actions.get(params.id), user, 'Action')
    if (a.status !== 'proposed' && a.status !== 'failed') throw new Fail(409, 'conflict', `Cannot reject a ${a.status} action`)
    a.status = 'rejected'
    a.updated_at = now()
    changed()
    emitUpdated(a)
    return toAction(a)
  }),

  // Board moves (FR-ORC-007) and, for user cards, payload edits (v1.1, proposals §19.1). pinned and snoozed_until
  // come with their features.
  route<{ id: string }>('patch', '/actions/:id', 'user', ({ user, params, body }) => {
    const a = own(db.actions.get(params.id), user, 'Action')
    const f = object(body).only(['board_column', 'board_position', 'payload'])
    const move = 'board_column' in f.body || 'board_position' in f.body
    const edit = f.body.payload as Record<string, unknown> | undefined
    if (!move && edit === undefined) f.add('payload', 'Nothing to change')
    if (move) {
      if (!COLUMNS.includes(f.body.board_column as BoardColumn)) f.add('board_column', 'Must be todo, in_progress or done')
      if (!isInt(f.body.board_position, 0, 10_000)) f.add('board_position', 'Must be a non-negative integer')
    }
    if (edit !== undefined) {
      if (!edit || typeof edit !== 'object' || Array.isArray(edit)) f.add('payload', 'Must be an object')
      else checkCardPayload(f, edit, true)
    }
    f.done()
    if (edit !== undefined) {
      if (!isUserCard(a)) throw new Fail(409, 'conflict', 'Only cards you made can be edited here')
      const next = { ...(a.payload as UserCardPayload), ...edit } as UserCardPayload
      if (next.due_time && !next.due_date) f.add('payload.due_time', 'Needs a due date')
      f.done()
      a.payload = { ...next, title: next.title.trim() }
    }
    if (move) {
      if (a.status !== 'done') throw new Fail(409, 'conflict', 'Only cards on the board can move')
      boardMove(a, f.body.board_column as BoardColumn, f.body.board_position as number)
      emailFollowsCard(a)
    }
    a.updated_at = now()
    changed()
    emitUpdated(a)
    return toAction(a)
  }),
]
