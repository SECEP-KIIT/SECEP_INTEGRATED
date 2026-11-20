// Manual reminders (FR-REM-002, SRS §6.5 GET/POST /reminders, PATCH/DELETE /reminders/:id; shapes in proposals §21).
// "Remind me" on an email or card: one notification when fire_at passes (mocks/reminders.ts fires it).
import type { Reminder } from '../../api/types'
import { page } from '../http/cursor'
import { Fail, own, route } from '../http/route'
import { isDateTime, isStr, object } from '../http/validate'
import { changed, db } from '../store/db'
import type { ReminderRow } from '../store/types'

const toReminder = ({ user_id: _u, ...r }: ReminderRow): Reminder => ({ ...r })

export const reminderRoutes = [
  route('get', '/reminders', 'user', ({ user, url }) => {
    const status = url.searchParams.get('status')
    if (status && !['scheduled', 'fired', 'cancelled'].includes(status)) throw new Fail(400, 'bad_request', 'Unknown status')
    const items = db.reminders.filter((r) => r.user_id === user.id && (!status || r.status === status)).sort((a, b) => a.fire_at.localeCompare(b.fire_at))
    return page(url, items.map(toReminder))
  }),

  route('post', '/reminders', 'user', ({ user, body }) => {
    const f = object(body).only(['target', 'title', 'fire_at'])
    const t = (f.body.target ?? null) as { type?: string; id?: string } | null
    if (t !== null && !(typeof t === 'object' && (t.type === 'email' || t.type === 'card') && typeof t.id === 'string')) f.add('target', 'Must be {type: email|card, id} or null')
    if (!isStr(f.body.title, 200) || !(f.body.title as string).trim()) f.add('title', 'Text, 1–200 characters')
    if (!isDateTime(f.body.fire_at)) f.add('fire_at', 'Must be a date-time')
    else if (Date.parse(f.body.fire_at as string) <= Date.now()) f.add('fire_at', 'Must be in the future')
    f.done()
    if (t?.type === 'email') own(db.emails.get(t.id!), user, 'Email')
    if (t?.type === 'card') {
      const a = own(db.actions.get(t.id!), user, 'Card')
      if (a.email_id !== null) throw new Fail(404, 'not_found', 'Card not found')
    }
    const r: ReminderRow = {
      id: crypto.randomUUID(), user_id: user.id, kind: 'manual', target: t ? { type: t.type as 'email' | 'card', id: t.id! } : null,
      title: (f.body.title as string).trim(), fire_at: new Date(f.body.fire_at as string).toISOString(), status: 'scheduled', fired_at: null,
    }
    db.reminders.push(r)
    changed()
    return toReminder(r)
  }, { status: 201 }),

  route<{ id: string }>('patch', '/reminders/:id', 'user', ({ user, params, body }) => {
    const r = own(db.reminders.find((x) => x.id === params.id && x.status === 'scheduled'), user, 'Reminder')
    const f = object(body).only(['fire_at', 'status'])
    if ('fire_at' in f.body && (!isDateTime(f.body.fire_at) || Date.parse(f.body.fire_at as string) <= Date.now())) f.add('fire_at', 'Must be a future date-time')
    if ('status' in f.body && f.body.status !== 'cancelled') f.add('status', 'Only "cancelled" can be set')
    f.done()
    if (f.body.fire_at) r.fire_at = new Date(f.body.fire_at as string).toISOString()
    if (f.body.status === 'cancelled') r.status = 'cancelled'
    changed()
    return toReminder(r)
  }),

  route<{ id: string }>('delete', '/reminders/:id', 'user', ({ user, params }) => {
    const r = own(db.reminders.find((x) => x.id === params.id), user, 'Reminder')
    db.reminders = db.reminders.filter((x) => x !== r)
    changed()
    return undefined
  }),
]
