// Contract tests for the mock backend: every Must route through msw/node, checked against SRS §6.4.1/§6.5.
// M6 must pass the same expectations, so these double as its acceptance list.
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DecoderActionPayload } from '../api/types'
import { control } from './control'
import { handlers } from './handlers'
import { registry } from './http/route'
import { deliver } from './pipeline'
import { tickReminders } from './reminders'
import { signIn } from './session'
import { verifyChain } from './store/audit'
import { db, initStore } from './store/db'
import { subscribe } from './store/events'
import { createDb } from './store/generate'
import { load, save, SCHEMA_VERSION, STORAGE_KEY } from './store/persist'
import { TEMPLATES } from './store/templates'
import { localDate } from './store/serialize'
import { addDays } from '../lib/due'

// msw resolves the handlers' relative /api/v1 paths against location, which Node doesn't have.
vi.stubGlobal('location', new URL('http://localhost/'))
const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  initStore({ persistEnabled: false })
  control.latency = [0, 0]
  control.speed = 1000 // simulated Jira/pipeline delays become ~ms
  control.jiraMode = 'ok'
})
afterEach(() => vi.useRealTimers())

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────────────────
type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(method: string, path: string, { token, body }: { token?: string; body?: unknown } = {}) {
  const res = await fetch(`http://localhost/api/v1${path}`, {
    method,
    headers: { ...(token && { Authorization: `Bearer ${token}` }), ...(body !== undefined && { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = res.status === 204 ? '' : await res.text()
  let json: Json | null = null
  try {
    json = text ? (JSON.parse(text) as Json) : null
  } catch {
    json = null
  }
  return { status: res.status, json: json as Json, text, headers: res.headers }
}
const USER = { demo: 0, sam: 1, rita: 2 } as const
async function login(who: keyof typeof USER = 'demo') {
  signIn(db.users[USER[who]].id)
  const { json } = await call('POST', '/auth/refresh')
  return json.access_token as string
}
const keys = (o: object) => Object.keys(o).sort()
const sorted = (k: string[]) => [...k].sort()
const demoEmails = () => [...db.emails.values()].filter((e) => e.user_id === db.users[0].id)
/** The default inbox leaves handled mail out (proposals §10.3). */
const inboxEmails = () => demoEmails().filter((e) => !db.handled.get(db.users[0].id)?.has(e.id))

// Key sets copied from SRS §6.4.1.
const LIST_KEYS = ['id', 'thread_id', 'from', 'to', 'cc', 'recipient_position', 'subject', 'received_at', 'status', 'security_flag', 'duplicate_count', 'attachment_count', 'reply_count', 'has_masked_secret', 'triage', 'summary_one_line', 'proposed_action_count', 'jira_key', 'pinned', 'snoozed_until', 'due_date', 'handled', 'read', 'projects', 'tags', 'note_count']
const DETAIL_KEYS = [...LIST_KEYS, 'body_text', 'summary_short', 'actions', 'links', 'attachments', 'masked_secrets', 'open_url', 'auth_results', 'thread']
const TRIAGE_KEYS = ['email_type', 'urgency', 'sentiment', 'needs_review', 'model_version', 'processed_at']
const LINK_KEYS = ['check_id', 'anchor_text', 'host', 'verdict', 'go_url']
const ACTION_KEYS = ['id', 'email_id', 'card_id', 'type', 'origin', 'status', 'payload', 'board_column', 'board_position', 'external_ref', 'external_status', 'error', 'created_at', 'updated_at', 'projects']
const ME_KEYS = ['id', 'email', 'display_name', 'role_category', 'is_admin', 'permissions', 'mailbox', 'ui_prefs']
const ERROR_KEYS = ['code', 'message', 'details', 'request_id']

describe('§6.4.1 shapes', () => {
  it('GET /me', async () => {
    const { json } = await call('GET', '/me', { token: await login() })
    expect(keys(json)).toEqual(sorted(ME_KEYS))
  })

  it('GET /emails and /emails/:id: exact keys, nothing the client must not see', async () => {
    const token = await login()
    const list = await call('GET', '/emails?limit=50', { token })
    expect(keys(list.json)).toEqual(['items', 'next_cursor'])
    expect(list.json.items).toHaveLength(inboxEmails().length)
    for (const item of list.json.items) {
      expect(keys(item)).toEqual(sorted(LIST_KEYS))
      if (item.triage) expect(keys(item.triage)).toEqual(sorted(TRIAGE_KEYS))
    }
    for (const { id } of list.json.items.slice(0, 50)) {
      const { json: d } = await call('GET', `/emails/${id}`, { token })
      expect(keys(d)).toEqual(sorted(DETAIL_KEYS))
      for (const l of d.links) expect(keys(l)).toEqual(sorted(LINK_KEYS))
      for (const a of d.actions) expect(keys(a)).toEqual(sorted(ACTION_KEYS))
      // Masked tokens map in order onto masked_secrets.
      const tokens = [...d.body_text.matchAll(/\[MASKED:([a-z0-9_]+)\]/gi)].map((m: RegExpMatchArray) => m[1])
      expect(tokens).toEqual(d.masked_secrets.map((s: Json) => s.secret_type))
      // open_url is the one URL: the message in the user's own Gmail (proposals §18.4), never a link from the body.
      expect(d.open_url).toMatch(/^https:\/\/mail\.google\.com\//)
      const raw = JSON.stringify({ ...d, open_url: null })
      for (const banned of ['ml_text', 'provider_message_id', 'message_id_hdr', 'value_enc', 'user_id', 'owner_user_id', '"url"', 'href', '"value"']) {
        expect(raw).not.toContain(banned)
      }
      expect(raw).not.toMatch(/https?:\/\//) // links only as LinkView (FR-SEC-004)
    }
  })

  it('every error uses the envelope', async () => {
    const { status, json } = await call('GET', '/me')
    expect(status).toBe(401)
    expect(keys(json)).toEqual(['error'])
    expect(keys(json.error)).toEqual(sorted(ERROR_KEYS))
    expect(json.error.code).toBe('unauthenticated')
  })
})

describe('access control (deny by default, FR-ADM-005)', () => {
  // §6.5 Must routes and their access rule. `owner` routes register as `user` and check ownership in the handler.
  const MUST: [string, string, string][] = [
    ['post', '/auth/refresh', 'cookie'], ['post', '/auth/logout', 'user'], ['get', '/me', 'user'],
    ['get', '/emails', 'user'], ['get', '/emails/:id', 'user'], ['patch', '/emails/:id/labels', 'user'],
    ['get', '/links/:checkId/go', 'user'], ['get', '/emails/:id/ics', 'user'],
    ['get', '/actions', 'user'], ['post', '/emails/:id/actions', 'user'], ['post', '/actions', 'user'],
    ['post', '/actions/:id/accept', 'user'], ['post', '/actions/:id/reject', 'user'], ['patch', '/actions/:id', 'user'],
    ['delete', '/mailboxes/me', 'user'],
    ['get', '/projects', 'user'], ['post', '/projects', 'user'], ['get', '/projects/:id', 'user'], ['patch', '/projects/:id', 'user'],
    ['post', '/projects/:id/items', 'user'], ['delete', '/projects/:id/items/:itemId', 'user'],
    ['get', '/admin/settings', 'admin'], ['put', '/admin/settings', 'admin'], ['post', '/admin/settings/test', 'admin'],
    ['get', '/admin/users', 'admin'], ['post', '/admin/users', 'admin'], ['patch', '/admin/users/:id', 'admin'],
    ['get', '/admin/models', 'admin'], ['post', '/admin/models/retrain', 'admin'], ['post', '/admin/models/:id/promote', 'admin'],
    ['get', '/admin/metrics', 'admin'], ['get', '/security/flags', 'security.review'], ['get', '/audit', 'security.review'],
  ]
  it.each(MUST)('%s %s is registered as %s', (method, path, access) => {
    expect(registry).toContainEqual({ method, path, access })
  })

  it('403 for admin routes without admin, and for security routes without security.review', async () => {
    const sam = await login('sam')
    for (const path of ['/admin/settings', '/admin/users', '/admin/models', '/admin/metrics', '/security/flags', '/audit']) {
      const { status, json } = await call('GET', path, { token: sam })
      expect([path, status, json.error.code]).toEqual([path, 403, 'forbidden'])
    }
    const rita = await login('rita')
    expect((await call('GET', '/security/flags', { token: rita })).status).toBe(200)
    expect((await call('GET', '/audit', { token: rita })).status).toBe(200)
    expect((await call('GET', '/admin/settings', { token: rita })).status).toBe(403)
  })

  it("404 for another user's resources, so their ids aren't confirmed", async () => {
    const demoEmail = demoEmails()[0]
    const demoAction = [...db.actions.values()].find((a) => a.user_id === db.users[0].id)!
    const sam = await login('sam')
    expect((await call('GET', `/emails/${demoEmail.id}`, { token: sam })).status).toBe(404)
    expect((await call('POST', `/actions/${demoAction.id}/accept`, { token: sam, body: {} })).status).toBe(404)
  })

  it('unmatched /api/v1 paths are 404, never passed through', async () => {
    const { status, json } = await call('GET', '/definitely/not/a/route', { token: await login() })
    expect(status).toBe(404)
    expect(json.error.code).toBe('not_found')
  })
})

describe('GET /emails query (§6.4.1)', () => {
  it('pages with an opaque cursor; limit 1–50', async () => {
    const token = await login()
    const seen: string[] = []
    let cursor: string | null = ''
    while (cursor !== null) {
      const { json } = await call('GET', `/emails?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { token })
      seen.push(...json.items.map((e: Json) => e.id))
      cursor = json.next_cursor
    }
    expect(seen).toHaveLength(inboxEmails().length)
    expect(new Set(seen).size).toBe(inboxEmails().length)
    expect((await call('GET', '/emails?limit=51', { token })).status).toBe(400)
    expect((await call('GET', '/emails?cursor=nope', { token })).status).toBe(400)
  })

  it('newest first by default (FR-ORC-008)', async () => {
    const { json } = await call('GET', '/emails?limit=50', { token: await login() })
    const times = json.items.map((e: Json) => e.received_at)
    expect(times).toEqual([...times].sort().reverse())
  })

  it('OR within a parameter, AND across parameters', async () => {
    const token = await login()
    const { json } = await call('GET', '/emails?limit=50&type=Task,Meeting&urgency=High', { token })
    expect(json.items.length).toBeGreaterThan(0)
    for (const e of json.items) {
      expect(['Task', 'Meeting']).toContain(e.triage.email_type.label)
      expect(e.triage.urgency.label).toBe('High')
    }
    expect((await call('GET', '/emails?type=Spam', { token })).status).toBe(400)
  })

  it('flag, sender (address or domain) and date range', async () => {
    const token = await login()
    const flagged = await call('GET', '/emails?limit=50&flag=suspicious,malicious', { token })
    expect(flagged.json.items.length).toBeGreaterThan(0)
    for (const e of flagged.json.items) expect(e.security_flag).not.toBe('none')
    const domain = await call('GET', '/emails?limit=50&sender=contoso-client.example', { token })
    for (const e of domain.json.items) expect(e.from.address).toMatch(/@contoso-client\.example$/)
    const today = new Date().toISOString().slice(0, 10)
    const recent = await call('GET', `/emails?limit=50&received_after=${today}`, { token })
    for (const e of recent.json.items) expect(e.received_at.slice(0, 10) >= today).toBe(true)
  })

  it('sort: oldest, urgency, sender and confidence order the list; pinned stay on top; unknown sort is 422', async () => {
    const token = await login()
    const get = async (sort: string) => (await call('GET', `/emails?limit=50&sort=${sort}`, { token })).json.items as Json[]
    const at = (l: Json[]) => l.map((e) => e.received_at as string)
    const newest = await get('newest')
    expect(at(newest)).toEqual([...at(newest)].sort().reverse())
    const oldest = await get('oldest')
    expect(at(oldest)).toEqual([...at(oldest)].sort())
    const rank: Record<string, number> = { Critical: 0, High: 1, Medium: 2, Low: 3 }
    const urgency = (await get('urgency')).filter((e) => e.triage).map((e) => rank[e.triage.urgency.label])
    expect(urgency).toEqual([...urgency].sort((a, b) => a - b))
    const conf = (await get('confidence')).filter((e) => e.triage).map((e) => e.triage.email_type.confidence as number)
    expect(conf).toEqual([...conf].sort((a, b) => a - b))
    const names = (await get('sender')).map((e) => ((e.from.name ?? e.from.address) as string).toLowerCase())
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
    // smart and due are accepted and served as newest until built (proposals §9).
    expect(at(await get('smart'))).toEqual(at(newest))
    const bad = await call('GET', '/emails?sort=random', { token })
    expect(bad.status).toBe(422)
    expect(bad.json.error.code).toBe('invalid_parameter') // proposals §10.4

    // FR-UI-023: a pinned email stays on top under any sort.
    const last = oldest.at(-1)!
    db.emails.get(last.id as string)!.pinned = true
    expect((await get('oldest'))[0].id).toBe(last.id)
  })

  it('from carries the PROPOSED role_category (proposals §8.5); to, cc and thread stay plain Person', async () => {
    const token = await login()
    const { json } = await call('GET', '/emails?limit=50', { token })
    for (const e of json.items) {
      expect(keys(e.from)).toEqual(['address', 'name', 'role_category'])
      for (const p of [...e.to, ...e.cc]) expect(keys(p)).toEqual(['address', 'name'])
    }
    expect(json.items.some((e: Json) => e.from.role_category === 'Executive')).toBe(true)
    expect(json.items.some((e: Json) => e.from.role_category === null)).toBe(true)
    const d = (await call('GET', `/emails/${json.items[0].id}`, { token })).json
    for (const m of d.thread?.messages ?? []) expect(keys(m.from)).toEqual(['address', 'name'])
  })

  it('view (proposals §10.1): unread, due_today, overdue, needs_reply, AND-combined; unknown is 422', async () => {
    const token = await login()
    const me = db.users[0]
    const get = async (q: string) => (await call('GET', `/emails?limit=50&${q}`, { token })).json.items as Json[]
    const today = new Date()
    const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    const unread = await get('view=unread')
    expect(unread.length).toBeGreaterThan(0)
    for (const e of unread) expect(db.reads.get(me.id)!.has(e.id)).toBe(false)

    // Give one email a due date today and one a past date through its actions (the source of truth).
    const [a, b] = inboxEmails()
    const dueAction = (email: { id: string }, due: string) =>
      db.actions.set(`test-${email.id}`, {
        id: `test-${email.id}`, user_id: me.id, email_id: email.id, type: 'create_jira_issue', origin: 'user', status: 'proposed',
        payload: { title: 't', description: null, priority: 'High', due_date: due, start: null, end: null, attendees: null },
        board_column: null, board_position: null, external_ref: null, external_status: null, error: null, created_at: day, updated_at: day,
      })
    dueAction(a, day)
    dueAction(b, '2020-01-01')
    expect((await get('view=due_today')).map((e) => e.id)).toContain(a.id)
    const overdue = await get('view=overdue')
    expect(overdue.map((e) => e.id)).toContain(b.id)
    for (const e of overdue) expect(e.due_date < day).toBe(true)
    // AND-combined.
    for (const e of await get('view=unread,overdue')) expect(db.reads.get(me.id)!.has(e.id) === false && e.due_date < day).toBe(true)

    for (const e of await get('view=needs_reply')) expect(['Task', 'Approval', 'Meeting']).toContain(e.triage.email_type.label)

    const bad = await call('GET', '/emails?view=starred', { token })
    expect(bad.status).toBe(422)
    expect(bad.json.error.code).toBe('invalid_parameter')
  })

  it('due_date: earliest action due_date or calendar start date; rejected actions do not count (proposals §10.2)', async () => {
    const token = await login()
    const email = inboxEmails().find((e) => ![...db.actions.values()].some((x) => x.email_id === e.id))!
    const mk = (id: string, status: 'proposed' | 'rejected', due: string | null, start: string | null) =>
      db.actions.set(id, {
        id, user_id: db.users[0].id, email_id: email.id, type: start ? 'add_calendar_event' : 'create_jira_issue', origin: 'user', status,
        payload: { title: 't', description: null, priority: 'High', due_date: due, start, end: start, attendees: null },
        board_column: null, board_position: null, external_ref: null, external_status: null, error: null, created_at: '', updated_at: '',
      })
    const detail = async () => (await call('GET', `/emails/${email.id}`, { token })).json
    expect((await detail()).due_date).toBeNull()
    mk('d1', 'proposed', '2030-05-10', null)
    mk('d2', 'rejected', '2030-05-01', null)
    mk('d3', 'proposed', null, '2030-05-08T09:00:00')
    expect((await detail()).due_date).toBe('2030-05-08')
  })

  it('PATCH /emails/:id handled (proposals §10.3): reversible, leaves the default inbox, shown by view=handled', async () => {
    const token = await login()
    const email = inboxEmails()[0]
    const res = await call('PATCH', `/emails/${email.id}`, { token, body: { handled: true } })
    expect(res.status).toBe(200)
    expect(res.json).toMatchObject({ id: email.id, handled: true, body_text: expect.any(String) })
    const ids = async (q: string) => ((await call('GET', `/emails?limit=50${q}`, { token })).json.items as Json[]).map((e) => e.id)
    expect(await ids('')).not.toContain(email.id)
    expect(await ids('&view=handled')).toContain(email.id)
    expect((await call('PATCH', `/emails/${email.id}`, { token, body: { handled: false } })).json.handled).toBe(false)
    expect(await ids('')).toContain(email.id)
    expect((await call('PATCH', `/emails/${email.id}`, { token, body: { pinned: true } })).json.pinned).toBe(true)
    expect((await call('PATCH', `/emails/${email.id}`, { token, body: { handled: 'yes' } })).status).toBe(422)
    expect((await call('PATCH', `/emails/${email.id}`, { token, body: { done: true } })).status).toBe(422)
    // Per recipient: another user can't touch it.
    expect((await call('PATCH', `/emails/${email.id}`, { token: await login('sam'), body: { handled: true } })).status).toBe(404)
  })

  it('PATCH /emails/:id read (proposals §12.3): per user, reversible, drives view=unread and the glance count', async () => {
    const token = await login()
    const email = inboxEmails().find((e) => !db.reads.get(db.users[0].id)?.has(e.id))!
    const unread = async () => ((await call('GET', '/emails?limit=50&view=unread', { token })).json.items as Json[]).map((e) => e.id)
    const glance = async () => (await call('GET', '/me/glance', { token })).json.counts.inbox_unread as number
    const before = await glance()
    expect(await unread()).toContain(email.id)
    const res = await call('PATCH', `/emails/${email.id}`, { token, body: { read: true } })
    expect(res.json).toMatchObject({ id: email.id, read: true })
    expect(await unread()).not.toContain(email.id)
    expect(await glance()).toBe(before - 1)
    expect((await call('PATCH', `/emails/${email.id}`, { token, body: { read: false } })).json.read).toBe(false)
    expect(await unread()).toContain(email.id)
    expect((await call('PATCH', `/emails/${email.id}`, { token, body: { read: 1 } })).status).toBe(422)
    // Owner-only (§12.1): another user gets 404, and the owner's state is untouched.
    expect((await call('PATCH', `/emails/${email.id}`, { token: await login('sam'), body: { read: true } })).status).toBe(404)
    expect(await unread()).toContain(email.id)
  })

  it('layouts are owner-only (proposals §13): keyed by the caller, never another user', async () => {
    const demo = await login()
    const start = (await call('GET', '/layouts/desktop', { token: demo })).json
    const put = await call('PUT', '/layouts/desktop', { token: demo, body: { pages: [{ ...start.pages[0], name: 'Demo only' }], base_updated_at: null } })
    expect(put.status).toBe(200)
    const sam = await login('sam')
    expect((await call('GET', '/layouts/desktop', { token: sam })).json).toMatchObject({ is_default: true })
    // Sam saving doesn't touch the demo user's layout.
    expect((await call('PUT', '/layouts/desktop', { token: sam, body: { pages: start.pages, base_updated_at: null } })).status).toBe(200)
    expect((await call('GET', '/layouts/desktop', { token: await login() })).json.pages[0].name).toBe('Demo only')
    expect((await call('GET', '/layouts/desktop', {})).status).toBe(401)
  })

  it('GET /emails due and needs_review (proposals §15.1, §15.2): OR within due, AND across groups', async () => {
    const token = await login()
    const all = (await call('GET', '/emails?limit=50', { token })).json.items as Json[]
    const ids = async (q: string) => ((await call('GET', `/emails?limit=50&${q}`, { token })).json.items as Json[]).map((e) => e.id)
    const today = localDate(new Date().toISOString())
    const in7 = (d: string | null) => d !== null && d >= today && d <= addDays(today, 6)
    expect(await ids('due=next_7_days')).toEqual(all.filter((e) => in7(e.due_date as string | null)).map((e) => e.id))
    expect(await ids('due=none')).toEqual(all.filter((e) => e.due_date === null).map((e) => e.id))
    const overdueOrToday = all.filter((e) => e.due_date !== null && (e.due_date as string) <= today).map((e) => e.id)
    expect(await ids('due=overdue,today')).toEqual(overdueOrToday)
    expect(await ids('due=later')).toEqual(all.filter((e) => e.due_date !== null && (e.due_date as string) > addDays(today, 6)).map((e) => e.id))
    const review = all.filter((e) => (e.triage as Json | null)?.needs_review === true).map((e) => e.id)
    expect(review.length).toBeGreaterThan(0)
    expect(await ids('needs_review=true')).toEqual(review)
    expect(await ids('needs_review=true&due=none')).toEqual(review.filter((id) => all.find((e) => e.id === id)!.due_date === null))
    expect((await call('GET', '/emails?due=soon', { token })).status).toBe(400)
    expect((await call('GET', '/emails?needs_review=yes', { token })).status).toBe(400)
  })

  it('keyword search runs over masked text only (FR-UI-026)', async () => {
    const token = await login()
    db.handled.clear() // search the whole mailbox; handled mail is otherwise outside the default inbox
    expect((await call('GET', '/emails?q=VPN%20account', { token })).json.items.length).toBeGreaterThan(0)
    // The fake secret value is never in the searchable text.
    expect((await call('GET', '/emails?q=Lantern-Orbit', { token })).json.items).toHaveLength(0)
  })
})

describe('actions (FR-ORC-001–007)', () => {
  const proposedJira = () =>
    [...db.actions.values()].find((a) => a.user_id === db.users[0].id && a.type === 'create_jira_issue' && a.status === 'proposed')!

  it('accepting a Jira action creates one issue, puts the card in To do, and a second accept returns the same key', async () => {
    const token = await login()
    const a = proposedJira()
    const first = await call('POST', `/actions/${a.id}/accept`, { token, body: {} })
    expect(first.status).toBe(200)
    expect(first.json).toMatchObject({ status: 'done', external_ref: expect.stringMatching(/^ATL-\d+$/), board_column: 'todo' })
    const again = await call('POST', `/actions/${a.id}/accept`, { token, body: {} })
    expect(again.json.external_ref).toBe(first.json.external_ref) // FR-ORC-005
    expect([...db.actions.values()].filter((x) => x.external_ref === first.json.external_ref)).toHaveLength(1)
  })

  it('maps urgency to priority when the proposal has none (FR-ORC-004)', async () => {
    const token = await login()
    const a = proposedJira()
    ;(a.payload as DecoderActionPayload).priority = null
    const { json } = await call('POST', `/actions/${a.id}/accept`, { token, body: {} })
    const urgency = db.emails.get(a.email_id!)!.triage!.urgency.label
    expect(json.payload.priority).toBe({ Critical: 'Highest', High: 'High', Medium: 'Medium', Low: 'Low' }[urgency])
  })

  it('Jira 401 fails the action with Jira’s error; 5xx after retries is 502 upstream_error (FR-ORC-006)', async () => {
    const token = await login()
    control.jiraMode = 'unauthorized'
    const failed = await call('POST', `/actions/${proposedJira().id}/accept`, { token, body: {} })
    expect(failed.status).toBe(200)
    expect(failed.json).toMatchObject({ status: 'failed', error: expect.stringContaining('Jira 401') })

    control.jiraMode = 'server_error'
    const down = await call('POST', `/actions/${proposedJira().id}/accept`, { token, body: {} })
    expect(down.status).toBe(502)
    expect(down.json.error).toMatchObject({ code: 'upstream_error', details: { provider: 'jira', status: 503 } })

    control.jiraMode = 'rate_limited_once'
    const retried = await call('POST', `/actions/${proposedJira().id}/accept`, { token, body: {} })
    expect(retried.json.status).toBe('done') // 429 retried after Retry-After
  })

  it('edits are validated; per-type rules give action_invalid (FR-ORC-002)', async () => {
    const token = await login()
    const a = proposedJira()
    const unknown = await call('POST', `/actions/${a.id}/accept`, { token, body: { payload: { colour: 'red' } } })
    expect([unknown.status, unknown.json.error.code]).toEqual([422, 'validation_failed'])
    const noTitle = await call('POST', `/actions/${a.id}/accept`, { token, body: { payload: { title: null } } })
    expect([noTitle.status, noTitle.json.error.code]).toEqual([422, 'action_invalid'])
    expect(noTitle.json.error.details.fields).toHaveProperty(['payload.title'])
  })

  it('reject, then board moves persist positions (FR-ORC-007)', async () => {
    const token = await login()
    const rejected = await call('POST', `/actions/${proposedJira().id}/reject`, { token })
    expect(rejected.json.status).toBe('rejected')
    const card = (await call('POST', '/actions', { token, body: { type: 'add_board_card', payload: { title: 'Call the bank' } } })).json
    expect(card).toMatchObject({ origin: 'user', email_id: null, board_column: 'todo' })
    const moved = await call('PATCH', `/actions/${card.id}`, { token, body: { board_column: 'in_progress', board_position: 0 } })
    expect(moved.json).toMatchObject({ board_column: 'in_progress', board_position: 0 })
    const column = (await call('GET', '/actions?column=in_progress&limit=50', { token })).json.items
    expect(column[0].id).toBe(card.id)
    expect(column.map((c: Json) => c.board_position)).toEqual(column.map((_: unknown, i: number) => i))
  })
})

describe('projects (FR-UI-016–017, proposals §18)', () => {
  it('an email in a project is a task: card in To do, handled ⇄ Done both ways (proposals §23)', async () => {
    const token = await login()
    const proj = (await call('POST', '/projects', { token, body: { name: 'Tasks', colour: '#123456' } })).json
    const email = (await call('GET', '/emails?limit=1', { token })).json.items[0]
    await call('POST', `/projects/${proj.id}/items`, { token, body: { email_id: email.id } })
    const cards = async () => (await call('GET', `/actions?status=done&project=${proj.id}&limit=50`, { token })).json.items as Json[]
    let [card] = (await cards()).filter((c) => c.email_id === email.id)
    expect(card).toMatchObject({ board_column: 'todo', origin: 'rule', type: 'add_board_card' })
    // Adding it again (or to another project) never makes a second card.
    await call('POST', `/projects/${proj.id}/items`, { token, body: { email_id: email.id } })
    expect((await cards()).filter((c) => c.email_id === email.id)).toHaveLength(1)
    await call('PATCH', `/emails/${email.id}`, { token, body: { handled: true } })
    ;[card] = (await cards()).filter((c) => c.email_id === email.id)
    expect(card.board_column).toBe('done')
    expect((await call('GET', `/projects/${proj.id}`, { token })).json.progress).toEqual({ done: 1, total: 1 })
    await call('PATCH', `/actions/${card.id}`, { token, body: { board_column: 'in_progress', board_position: 0 } })
    expect((await call('GET', `/emails/${email.id}`, { token })).json.handled).toBe(false)
    await call('PATCH', `/actions/${card.id}`, { token, body: { board_column: 'done', board_position: 0 } })
    expect((await call('GET', `/emails/${email.id}`, { token })).json.handled).toBe(true)
  })

  it('creates, edits and archives a project; validates fields; another user gets 404', async () => {
    const token = await login()
    const bad = await call('POST', '/projects', { token, body: { name: '', colour: 'blue', extra: 1 } })
    expect(bad.status).toBe(422)
    expect(Object.keys(bad.json.error.details.fields).sort()).toEqual(['colour', 'extra', 'name'])
    const made = await call('POST', '/projects', { token, body: { name: 'Atlas', colour: '#3B5BDB', icon: '🧭', jira_project_key: 'ATL' } })
    expect(made.status).toBe(201)
    expect(made.json).toMatchObject({ name: 'Atlas', colour: '#3b5bdb', archived_at: null, progress: { done: 0, total: 0 } })
    const edited = await call('PATCH', `/projects/${made.json.id}`, { token, body: { description: 'Q4', archived: true } })
    expect(edited.json).toMatchObject({ description: 'Q4', archived_at: expect.any(String) })
    const list = (await call('GET', '/projects?limit=50', { token })).json.items
    expect(list.at(-1).id).toBe(made.json.id) // archived ones last
    const other = await login('sam')
    expect((await call('GET', `/projects/${made.json.id}`, { token: other })).status).toBe(404)
  })

  it('files emails: first project is primary, list items carry projects, ?project= filters, removal promotes the next', async () => {
    const token = await login()
    const a = (await call('POST', '/projects', { token, body: { name: 'A', colour: '#111111' } })).json
    const b = (await call('POST', '/projects', { token, body: { name: 'B', colour: '#222222' } })).json
    const email = (await call('GET', '/emails?limit=1', { token })).json.items[0]
    const before = email.projects.length
    const first = await call('POST', `/projects/${a.id}/items`, { token, body: { email_id: email.id } })
    expect(first.json).toMatchObject({ project_id: a.id, email_id: email.id, action_id: null, is_primary: before === 0 })
    await call('POST', `/projects/${b.id}/items`, { token, body: { email_id: email.id } })
    let refs = (await call('GET', `/emails/${email.id}`, { token })).json.projects
    expect(refs.map((r: { id: string }) => r.id)).toEqual(expect.arrayContaining([a.id, b.id]))
    expect(refs[0].is_primary).toBe(true)
    const filtered = (await call('GET', `/emails?project=${b.id}&limit=50`, { token })).json.items
    expect(filtered.map((e: { id: string }) => e.id)).toEqual([email.id])
    expect((await call('POST', `/projects/${a.id}/items`, { token, body: { email_id: email.id, action_id: 'x' } })).status).toBe(422)
    if (before === 0) {
      expect((await call('DELETE', `/projects/${a.id}/items/${email.id}`, { token })).status).toBe(204)
      refs = (await call('GET', `/emails/${email.id}`, { token })).json.projects
      expect(refs).toEqual([{ id: b.id, name: 'B', colour: '#222222', is_primary: true }])
    }
    expect((await call('DELETE', `/projects/${a.id}/items/${email.id}`, { token })).status).toBe(before === 0 ? 404 : 204)
  })
})

describe('security (FR-SEC-003/004/008)', () => {
  it('there is no Reveal route (QA pass 5): SECEP never holds a credential value', async () => {
    const token = await login()
    const secret = db.secrets.find((s) => s.owner_user_id === db.users[0].id)!
    expect((await call('POST', `/secrets/${secret.id}/reveal`, { token })).status).toBe(404)
  })

  it('/links/:id/go: open when clean, interstitial with the chain when suspicious, blocked when malicious', async () => {
    const token = await login()
    const of = (v: string) => db.urlChecks.find((c) => c.verdict === v && db.emails.get(c.email_id)!.user_id === db.users[0].id)!
    expect((await call('GET', `/links/${of('clean').id}/go`, { token })).json).toEqual({ action: 'open', url: of('clean').final_url })
    const sus = (await call('GET', `/links/${of('suspicious').id}/go`, { token })).json
    expect(sus).toMatchObject({ action: 'interstitial', verdict: 'suspicious', chain: expect.arrayContaining([expect.any(String)]) })
    expect(sus.chain.length).toBeGreaterThan(1)
    expect((await call('GET', `/links/${of('malicious').id}/go`, { token })).json).toMatchObject({ action: 'blocked', verdict: 'malicious' })
  })

  it('the audit log is a valid hash chain, and tampering breaks it (FR-ADM-006)', async () => {
    const token = await login()
    await call('POST', `/actions/${[...db.actions.values()].find((a) => a.status === 'proposed' && a.user_id === db.users[0].id)!.id}/accept`, { token, body: {} })
    await call('PUT', '/admin/settings', { token, body: { poll_interval_s: 60 } })
    expect(db.audit.length).toBeGreaterThanOrEqual(2)
    expect(await verifyChain(db.audit)).toBe(true)
    const tampered = db.audit.map((r) => ({ ...r }))
    tampered[0].details = { forged: true }
    expect(await verifyChain(tampered)).toBe(false)
    const { json } = await call('GET', '/audit', { token })
    expect(keys(json.items[0])).toEqual(sorted(['id', 'created_at', 'actor', 'event', 'target', 'details', 'hash', 'prev_hash']))
  })
})

describe('labels (FR-ML-010, FR-ML-013)', () => {
  it('a correction with scope sender creates a personal rule that labels the next email from that sender', async () => {
    const token = await login()
    const tIndex = TEMPLATES.findIndex((t) => t.from === 2) // Arjun
    const email = demoEmails().find((e) => e.from.address === 'arjun.mehta@northwind.example')!
    const { status, json } = await call('PATCH', `/emails/${email.id}/labels`, { token, body: { field: 'urgency', value: 'Critical', scope: 'sender' } })
    expect(status).toBe(200)
    expect(keys(json)).toEqual(['correction_id', 'rule_id', 'triage'])
    expect(json.correction_id).toMatch(/^[0-9a-f-]{36}$/) // a UUID string (proposals §10.5)
    expect(json.rule_id).toEqual(expect.any(String))
    expect(json.triage.urgency.label).toBe('Critical')

    await deliver(db.users[0].id, tIndex)
    const arrived = [...db.emails.values()].at(-1)!
    expect(arrived.triage!.urgency.label).toBe('Critical')
    expect(db.labelRules[0].hit_count).toBe(1)

    const bad = await call('PATCH', `/emails/${email.id}/labels`, { token, body: { field: 'urgency', value: 'Urgent' } })
    expect([bad.status, bad.json.error.code]).toEqual([422, 'validation_failed'])
  })

  it('an email_type correction marks the label as the user’s', async () => {
    const token = await login()
    const email = demoEmails().find((e) => e.triage?.email_type.label === 'Info')!
    const { json } = await call('PATCH', `/emails/${email.id}/labels`, { token, body: { field: 'email_type', value: 'Task' } })
    expect(json.triage.email_type).toMatchObject({ label: 'Task', source: 'user' })
    expect(json.rule_id).toBeNull()
  })
})

describe('admin', () => {
  it('settings never return secret values; secrets are write-only', async () => {
    const token = await login()
    const { json } = await call('GET', '/admin/settings', { token })
    expect(json.jira.token_set).toBe(true)
    expect(JSON.stringify(json)).not.toContain(db.settings.jira.token!)
    const put = await call('PUT', '/admin/settings', { token, body: { jira: { token: 'new-secret-token' } } })
    expect(put.text).not.toContain('new-secret-token')
    expect(JSON.stringify(db.audit.at(-1))).not.toContain('new-secret-token')
  })

  it('retrain → candidate → promote passes the gates; a worse candidate is refused with failed_gates (FR-ML-012)', async () => {
    const token = await login()
    const r = await call('POST', '/admin/models/retrain', { token })
    expect([r.status, r.json.job]).toEqual([202, 'retrain'])
    await new Promise((res) => setTimeout(res, 40))
    const candidate = db.models.find((m) => m.status === 'candidate')!
    const promoted = await call('POST', `/admin/models/${candidate.id}/promote`, { token })
    expect(promoted.json.status).toBe('promoted')
    expect(db.models.filter((m) => m.status === 'promoted')).toHaveLength(1)

    const worse = { ...structuredClone(candidate), id: crypto.randomUUID(), version: 'worse', status: 'candidate' as const }
    worse.metrics.per_class_f1.Approval -= 0.1
    db.models.push(worse)
    const refused = await call('POST', `/admin/models/${worse.id}/promote`, { token })
    expect(refused.status).toBe(409)
    expect(refused.json.error.details.failed_gates[0]).toMatch(/Approval/)
  })

  it('q_in=subject searches subjects only; all also the body; anything else is 422 (§26)', async () => {
    const token = await login()
    const e = demoEmails().find((x) => x.subject && x.body_text.length > 40)!
    const bodyWord = e.body_text.split(/\s+/).find((w) => /^[a-z]{6,}$/i.test(w) && !(e.subject ?? '').toLowerCase().includes(w.toLowerCase()))!
    const get = async (qIn: string) => {
      const q = `/emails?q=${encodeURIComponent(bodyWord)}&q_in=${qIn}&limit=50`
      return [...(await call('GET', q, { token })).json.items, ...(await call('GET', `${q}&view=handled`, { token })).json.items]
    }
    expect((await get('all')).some((x: { id: string }) => x.id === e.id)).toBe(true)
    for (const it of await get('subject')) expect((it.subject ?? '').toLowerCase()).toContain(bodyWord.toLowerCase())
    expect((await call('GET', '/emails?q=x&q_in=body', { token })).status).toBe(422)
    // §27: include_handled keeps handled mail in one list.
    const handled = [...(db.handled.get(db.users[0].id) ?? [])]
    const both = (await call('GET', '/emails?include_handled=true&limit=50', { token })).json.items
    expect(handled.length).toBeGreaterThan(0)
    expect(both.some((x: { handled: boolean }) => x.handled)).toBe(true)
    expect((await call('GET', '/emails?include_handled=1', { token })).status).toBe(422)
  })

  it('metrics and .ics', async () => {
    const token = await login()
    const m = (await call('GET', '/admin/metrics?days=30', { token })).json
    expect(keys(m)).toEqual(['confidence_histogram', 'override_rate_by_class', 'sentiment', 'urgency', 'volume_by_type', 'window_days'])
    expect(m.confidence_histogram).toHaveLength(10)
    for (const h of [m.urgency, m.sentiment]) {
      expect(keys(h)).toEqual(['confidence_histogram', 'override_rate', 'volume'])
      expect(h.confidence_histogram).toHaveLength(10)
    }
    expect(keys(m.urgency.volume)).toEqual(['Critical', 'High', 'Low', 'Medium'])
    const meeting = demoEmails().find((e) => e.triage?.email_type.label === 'Meeting' && [...db.actions.values()].some((a) => a.email_id === e.id))!
    const ics = await call('GET', `/emails/${meeting.id}/ics`, { token })
    expect(ics.headers.get('Content-Type')).toMatch(/^text\/calendar/)
    expect(ics.text).toContain('BEGIN:VEVENT')
    const task = demoEmails().find((e) => e.triage?.email_type.label === 'Task')!
    expect((await call('GET', `/emails/${task.id}/ics`, { token })).status).toBe(404)
  })
})

describe('incoming mail and events (§6.4.1 WebSocket payloads)', () => {
  it('emits triaged → enriched → flagged with the documented payloads', async () => {
    const seen: [string, Json][] = []
    const off = subscribe((_u, event, payload) => seen.push([event, payload as Json]))
    const phishing = TEMPLATES.findIndex((t) => t.links?.some((l) => l.verdict === 'suspicious'))
    await deliver(db.users[0].id, phishing)
    off()
    const events = seen.map(([e]) => e).filter((e) => e.startsWith('email.'))
    expect(events).toEqual(['email.triaged', 'email.enriched', 'email.flagged'])
    const [, triaged] = seen.find(([e]) => e === 'email.triaged')!
    expect(keys(triaged)).toEqual(['email', 'email_id'])
    expect(keys(triaged.email)).toEqual(sorted(LIST_KEYS))
    expect(triaged.email.summary_one_line).toBeNull() // not enriched yet
    const [, enriched] = seen.find(([e]) => e === 'email.enriched')!
    expect(keys(enriched)).toEqual(['actions', 'email_id', 'status', 'summary_one_line', 'summary_short'])
    const [, flagged] = seen.find(([e]) => e === 'email.flagged')!
    expect(keys(flagged)).toEqual(['email_id', 'links', 'security_flag'])
    expect(flagged.security_flag).toBe('suspicious')
  })

  it('a revoked mailbox gets no new mail (FR-ADM-007)', async () => {
    const token = await login()
    expect((await call('DELETE', '/mailboxes/me', { token })).status).toBe(204)
    const before = db.emails.size
    await deliver(db.users[0].id, 0)
    expect(db.emails.size).toBe(before)
  })
})

describe('store', () => {
  it('generation is deterministic', () => {
    const t = Date.parse('2026-11-04T10:00:00Z')
    const a = createDb(t)
    const b = createDb(t)
    expect(JSON.stringify([...a.emails.values()])).toBe(JSON.stringify([...b.emails.values()]))
  })

  it('persists only user state, never secrets; versioned; arrivals replay to the same ids', async () => {
    const mem = new Map<string, string>()
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) }
    ;(globalThis as { localStorage?: unknown }).localStorage = storage
    try {
      initStore({ persistEnabled: true })
      await deliver(db.users[0].id, 0)
      const arrivedId = [...db.emails.values()].at(-1)!.id
      const action = [...db.actions.values()].find((a) => a.email_id === arrivedId)!
      action.status = 'rejected'
      save(storage, db, 20261104)

      const blob = mem.get(STORAGE_KEY)!
      expect(blob).not.toContain(db.settings.jira.token!)
      expect(JSON.parse(blob).schema).toBe(SCHEMA_VERSION)

      initStore({ persistEnabled: true })
      expect(db.emails.has(arrivedId)).toBe(true)
      expect(db.actions.get(action.id)?.status).toBe('rejected')
      expect(db.secrets.find((s) => s.email_id === arrivedId)?.secret_type ?? null).toBe(TEMPLATES[0].secrets?.[0]?.type ?? null)

      mem.set(STORAGE_KEY, JSON.stringify({ ...JSON.parse(blob), schema: SCHEMA_VERSION + 1 }))
      expect(load(storage, 20261104)).toBeNull()
      expect(mem.has(STORAGE_KEY)).toBe(false) // discarded, will reseed
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage
    }
  })
})

describe('ui_prefs.theme (PROPOSED, proposals §16.6)', () => {
  it('PATCH /me/preferences stores light, dark or auto; anything else is 422', async () => {
    const token = await login()
    const ok = await call('PATCH', '/me/preferences', { token, body: { theme: 'dark' } })
    expect(ok.status).toBe(200)
    expect(ok.json.ui_prefs.theme).toBe('dark')
    expect((await call('GET', '/me', { token })).json.ui_prefs.theme).toBe('dark')
    expect((await call('PATCH', '/me/preferences', { token, body: { theme: 'auto' } })).json.ui_prefs.theme).toBe('auto')
    expect((await call('PATCH', '/me/preferences', { token, body: { theme: 'sepia' } })).status).toBe(422)
  })

  it('PATCH /me/preferences: motion null goes back to following the system (Settings, proposals §22)', async () => {
    const token = await login()
    expect((await call('PATCH', '/me/preferences', { token, body: { motion: 'off' } })).json.ui_prefs.motion).toBe('off')
    expect((await call('PATCH', '/me/preferences', { token, body: { motion: null } })).json.ui_prefs.motion).toBeNull()
    expect((await call('PATCH', '/me/preferences', { token, body: { motion: 'wobbly' } })).status).toBe(422)
  })

  it('PATCH /me/preferences: pop-up rules, quiet hours and key binds (proposals §28)', async () => {
    const token = await login()
    const rules = { normal: { urgency: 'medium', sentiment: 'negative' }, focus: { urgency: 'critical', sentiment: 'off' }, quiet: { urgency: 'none', sentiment: 'off' } }
    const ok = await call('PATCH', '/me/preferences', { token, body: { popup_rules: rules, quiet_hours: { start: '23:30', end: '07:00' }, keybinds: { lock: 'Alt+Q' } } })
    expect(ok.status).toBe(200)
    expect(ok.json.ui_prefs).toMatchObject({ popup_rules: rules, quiet_hours: { start: '23:30', end: '07:00' }, keybinds: { lock: 'Alt+Q' } })
    expect((await call('PATCH', '/me/preferences', { token, body: { quiet_hours: null } })).json.ui_prefs.quiet_hours).toBeNull()
    for (const body of [{ popup_rules: { normal: rules.normal } }, { quiet_hours: { start: '25:00', end: '07:00' } }, { keybinds: { teleport: 'T' } }, { keybinds: { lock: 'Ctrl+Alt+Q' } }]) {
      expect((await call('PATCH', '/me/preferences', { token, body })).status).toBe(422)
    }
  })
  it('PATCH /me/preferences: onboarding progress (proposals §29)', async () => {
    const token = await login()
    const ok = await call('PATCH', '/me/preferences', { token, body: { onboarding: { tour: 'done', done: ['open_email'], hints: ['remind'] } } })
    expect(ok.status).toBe(200)
    expect(ok.json.ui_prefs.onboarding).toEqual({ tour: 'done', done: ['open_email'], hints: ['remind'] })
    expect((await call('PATCH', '/me/preferences', { token, body: { onboarding: { done: ['teleport'] } } })).status).toBe(422)
  })
})

describe('user cards (FR-CNT-002, proposals §19.1)', () => {
  it('creates, edits, files, deletes; rejects bad payloads and edits to email actions', async () => {
    const t = await login('demo')
    const bad = await call('POST', '/actions', { token: t, body: { type: 'add_board_card', payload: { title: '', urgency: 'Huge', due_time: '25:00', checklist: [{ text: 'x' }] } } })
    expect(bad.status).toBe(422)
    expect(Object.keys((bad.json!.error as Json).details!.fields as Json).sort()).toEqual(['payload.checklist', 'payload.due_time', 'payload.title', 'payload.urgency'])
    expect((await call('POST', '/actions', { token: t, body: { type: 'add_board_card', payload: { title: 'x', due_time: '10:00' } } })).status).toBe(422)

    const made = await call('POST', '/actions', { token: t, body: { type: 'add_board_card', payload: { title: ' Call the bank ', source: 'call', checklist: [{ text: 'IBAN', done: false }] } } })
    expect(made.status).toBe(201)
    const card = made.json as Json
    expect(card).toMatchObject({ origin: 'user', status: 'done', board_column: 'todo', email_id: null, projects: [] })
    expect((card.payload as Json).title).toBe('Call the bank')

    const edited = await call('PATCH', `/actions/${card.id}`, { token: t, body: { payload: { urgency: 'High', due_date: '2026-12-01', due_time: '09:30' } } })
    expect(edited.status).toBe(200)
    expect(edited.json!.payload).toMatchObject({ title: 'Call the bank', urgency: 'High', due_time: '09:30', source: 'call' })
    expect((await call('PATCH', `/actions/${card.id}`, { token: t, body: { payload: { colour: 'red' } } })).status).toBe(422)

    const project = (await call('POST', '/projects', { token: t, body: { name: 'Bank', colour: '#336699' } })).json!
    expect((await call('POST', `/projects/${project.id}/items`, { token: t, body: { action_id: card.id } })).status).toBe(200)
    const listed = (await call('GET', `/actions?project=${project.id}`, { token: t })).json!.items as Json[]
    expect(listed.map((a) => a.id)).toEqual([card.id])
    expect(listed[0].projects).toEqual([{ id: project.id, name: 'Bank', colour: '#336699', is_primary: true }])

    const emailAction = [...db.actions.values()].find((a) => a.user_id === db.users[0].id && a.email_id)!
    expect((await call('PATCH', `/actions/${emailAction.id}`, { token: t, body: { payload: { title: 'x' } } })).status).toBe(409)
    expect((await call('DELETE', `/actions/${emailAction.id}`, { token: t })).status).toBe(409)

    const sam = await login('sam')
    expect((await call('DELETE', `/actions/${card.id}`, { token: sam })).status).toBe(404)
    expect((await call('DELETE', `/actions/${card.id}`, { token: t })).status).toBe(204)
    expect(db.actions.has(card.id as string)).toBe(false)
    expect(db.projectItems.some((i) => i.action_id === card.id)).toBe(false)
  })
})

describe('manual reminders (FR-REM-002, proposals §21)', () => {
  it('creates on an email, lists, reschedules, fires once as a notification, deletes; validates and guards', async () => {
    const t = await login('demo')
    const email = [...db.emails.values()].find((e) => e.user_id === db.users[0].id)!
    const soon = new Date(Date.now() + 3_600_000).toISOString()
    const made = await call('POST', '/reminders', { token: t, body: { target: { type: 'email', id: email.id }, title: 'Call back', fire_at: soon } })
    expect(made.status).toBe(201)
    expect(made.json).toMatchObject({ kind: 'manual', status: 'scheduled', target: { type: 'email', id: email.id }, title: 'Call back', fired_at: null })
    expect(Object.keys(made.json!).sort()).toEqual(['fire_at', 'fired_at', 'id', 'kind', 'status', 'target', 'title'])
    expect(((await call('GET', '/reminders?status=scheduled', { token: t })).json!.items as Json[]).map((r) => r.id)).toEqual([made.json!.id])
    const later = new Date(Date.now() + 7_200_000).toISOString()
    expect((await call('PATCH', `/reminders/${made.json!.id}`, { token: t, body: { fire_at: later } })).json!.fire_at).toBe(later)
    for (const bad of [{ title: '', fire_at: soon }, { title: 'x', fire_at: '2001-01-01T00:00:00Z' }]) expect((await call('POST', '/reminders', { token: t, body: bad })).status).toBe(422)
    expect((await call('POST', '/reminders', { token: t, body: { target: { type: 'email', id: 'nope' }, title: 'x', fire_at: soon } })).status).toBe(404)
    // Time passes: it fires exactly once, with a generic title and the email as the target.
    const events: Json[] = []
    const off = subscribe((_u, event, payload) => event === 'notification.new' && events.push(payload as Json))
    const after = new Date(Date.parse(later) + 1000)
    expect(tickReminders(after)).toBeGreaterThanOrEqual(1)
    expect(tickReminders(after)).toBe(0)
    off()
    expect(events.map((e) => e.notification as Json).find((n) => n.body === 'Call back')).toMatchObject({ kind: 'reminder', title: 'Reminder due', target: { type: 'email', id: email.id } })
    expect(((await call('GET', '/reminders?status=fired', { token: t })).json!.items as Json[]).length).toBe(1)
    expect((await call('DELETE', `/reminders/${made.json!.id}`, { token: t })).status).toBe(204)
    expect((await call('DELETE', `/reminders/${made.json!.id}`, { token: t })).status).toBe(404)
  })
})

describe('notes (FR-CNT-003, proposals §19.2)', () => {
  it('stores as typed, scopes by target, counts on the email, guards ownership', async () => {
    const t = await login('demo')
    const email = [...db.emails.values()].find((e) => e.user_id === db.users[0].id)!
    const made = await call('POST', '/notes', { token: t, body: { target_type: 'email', target_id: email.id, body: 'VPN password: hunter2\n- [ ] book room' } })
    expect(made.status).toBe(201)
    expect(made.json!.body).toBe('VPN password: hunter2\n- [ ] book room')
    expect(Object.keys(made.json!).sort()).toEqual(['body', 'created_at', 'id', 'target_id', 'target_type', 'updated_at'])
    expect((await call('GET', `/emails/${email.id}`, { token: t })).json!.note_count).toBe(1)

    const loose = await call('POST', '/notes', { token: t, body: { body: 'standalone' } })
    expect(loose.json!.target_type).toBeNull()
    const standalone = (await call('GET', '/notes?target_type=none', { token: t })).json!.items as Json[]
    expect(standalone.map((n) => n.id)).toEqual([loose.json!.id])
    const onEmail = (await call('GET', `/notes?target_type=email&target_id=${email.id}`, { token: t })).json!.items as Json[]
    expect(onEmail.map((n) => n.id)).toEqual([made.json!.id])

    expect((await call('POST', '/notes', { token: t, body: { target_type: 'email', body: 'x' } })).status).toBe(422)
    expect((await call('POST', '/notes', { token: t, body: { body: 'x'.repeat(20_001) } })).status).toBe(422)
    const sam = await login('sam')
    expect((await call('POST', '/notes', { token: sam, body: { target_type: 'email', target_id: email.id, body: 'x' } })).status).toBe(404)
    expect((await call('PATCH', `/notes/${made.json!.id}`, { token: sam, body: { body: 'x' } })).status).toBe(404)

    const patched = await call('PATCH', `/notes/${made.json!.id}`, { token: t, body: { body: 'OTP 123456' } })
    expect(patched.json!.body).toBe('OTP 123456')
    expect((await call('DELETE', `/notes/${made.json!.id}`, { token: t })).status).toBe(204)
    expect((await call('GET', `/emails/${email.id}`, { token: t })).json!.note_count).toBe(0)
  })
})

describe('files (FR-CNT-006/007/008, proposals §19.3)', () => {
  it('uploads to a card, lists, serves safe headers, previews only images/PDFs, guards ownership, streams attachments', async () => {
    const t = await login('demo')
    const card = (await call('POST', '/actions', { token: t, body: { type: 'add_board_card', payload: { title: 'Files' } } })).json!
    const upload = (token: string, name: string, type: string, bytes: number | string = 'hello', target = card.id as string) => {
      const form = new FormData()
      form.append('target_type', 'card')
      form.append('target_id', target)
      form.append('file', new File([typeof bytes === 'number' ? new Uint8Array(bytes) : bytes], name, { type }))
      return fetch('http://localhost/api/v1/files', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form })
    }
    const res = await upload(t, '../../etc/notes.html', 'text/html', '<script>alert(1)</script>')
    expect(res.status).toBe(201)
    const ref = (await res.json()) as Json
    expect(Object.keys(ref).sort()).toEqual(['created_at', 'filename', 'id', 'mime', 'size', 'target_id', 'target_type'])
    expect(ref.filename).toBe('notes.html')

    const list = (await call('GET', `/files?target_type=card&target_id=${card.id}`, { token: t })).json!.items as Json[]
    expect(list.map((f) => f.id)).toEqual([ref.id])

    const auth = { Authorization: `Bearer ${t}` }
    for (const q of ['', '?inline=1']) {
      const got = await fetch(`http://localhost/api/v1/files/${ref.id}${q}`, { headers: auth })
      expect(got.headers.get('content-disposition')).toMatch(/^attachment;/) // HTML never inline
      expect(got.headers.get('x-content-type-options')).toBe('nosniff')
      expect(got.headers.get('content-security-policy')).toMatch(/sandbox/)
    }
    const png = (await (await upload(t, 'a.png', 'image/png')).json()) as Json
    expect((await fetch(`http://localhost/api/v1/files/${png.id}?inline=1`, { headers: auth })).headers.get('content-disposition')).toMatch(/^inline;/)

    expect((await upload(t, 'big.bin', 'application/octet-stream', 25 * 1024 * 1024 + 1)).status).toBe(413)
    const sam = await login('sam')
    expect((await upload(sam, 'x.txt', 'text/plain')).status).toBe(404)
    expect((await call('DELETE', `/files/${ref.id}`, { token: sam })).status).toBe(404)
    expect((await call('DELETE', `/files/${ref.id}`, { token: t })).status).toBe(204)

    const withAttachment = [...db.emails.values()].find((e) => e.user_id === db.users[0].id && e.attachments.length)!
    const att = await fetch(`http://localhost/api/v1/emails/${withAttachment.id}/attachments/0`, { headers: auth })
    expect(att.status).toBe(200)
    expect(att.headers.get('content-disposition')).toMatch(/^attachment;/)
    expect((await fetch(`http://localhost/api/v1/emails/${withAttachment.id}/attachments/99`, { headers: auth })).status).toBe(404)
  })
})

describe('notifications and reminders (FR-REM-001/004, proposals §20)', () => {
  it('POST /notifications/read marks some by id, then all; bad ids are 422', async () => {
    const t = await login('demo')
    const list = async () => (await call('GET', '/notifications', { token: t })).json!.items as Json[]
    const before = await list()
    expect(before.length).toBeGreaterThan(1)
    expect(before.every((n) => n.read_at === null)).toBe(true)
    expect((await call('POST', '/notifications/read', { token: t, body: { ids: [before[0].id] } })).status).toBe(204)
    const some = await list()
    expect(some.filter((n) => n.read_at !== null).map((n) => n.id)).toEqual([before[0].id])
    expect((await call('POST', '/notifications/read', { token: t, body: { ids: 'x' } })).status).toBe(422)
    expect((await call('POST', '/notifications/read', { token: t, body: {} })).status).toBe(204)
    expect((await list()).every((n) => n.read_at !== null)).toBe(true)
  })

  it('fires each reminder once, from the due date, with a generic title and the item as target', async () => {
    const t = await login('demo')
    const due = addDays(localDate(new Date().toISOString()), 1)
    const card = (await call('POST', '/actions', { token: t, body: { type: 'add_board_card', payload: { title: 'Send the deck', due_date: due } } })).json!
    const [y, m, d] = due.split('-').map(Number)
    const nineAm = new Date(y, m - 1, d, 9, 5)
    const events: Json[] = []
    const off = subscribe((_u, event, payload) => event === 'notification.new' && events.push(payload as Json))
    expect(tickReminders(nineAm)).toBeGreaterThanOrEqual(1)
    expect(tickReminders(nineAm)).toBe(0)
    off()
    const mine = events.map((e) => e.notification as Json).find((n) => (n.target as Json).id === card.id)!
    expect(mine).toMatchObject({ kind: 'reminder', title: 'Reminder due', body: 'Send the deck', target: { type: 'card', id: card.id }, read_at: null })
    const listed = (await call('GET', '/notifications', { token: t })).json!.items as Json[]
    expect(listed.some((n) => n.id === mine.id)).toBe(true)
  })
})
