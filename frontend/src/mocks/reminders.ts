// The mock reminder scheduler (FR-REM-001/003/004): every 15 s it looks at due dates, fires each reminder once as
// a notification (bell + toast over the socket), and remembers what fired. M6 does this with PostgreSQL + Redis.
import type { AppNotification } from '../api/types'
import { reminderTimes } from '../reminders/schedule'
import { control, scaled } from './control'
import { buildNotification } from './notifications'
import { changed, db } from './store/db'
import { publish } from './store/events'
import { localDate, toListItem } from './store/serialize'

const FIRED_KEY = 'secep.mock.fired'
const STALE_MS = 3_600_000
const fired = new Set<string>(
  (() => {
    try {
      return JSON.parse(localStorage.getItem(FIRED_KEY) ?? '[]') as string[]
    } catch {
      return []
    }
  })(),
)
const remember = (key: string) => {
  fired.add(key)
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify([...fired].slice(-500)))
  } catch {
    // Storage full or off: reminders may repeat after a reload. Fine for a mock.
  }
}

interface Due {
  user_id: string
  target: NonNullable<AppNotification['target']>
  title: string
  date: string
  time: string | null
  critical: boolean
}

/** What has a due date, per user: open user cards, and unhandled emails with a derived due date. */
function dueItems(): Due[] {
  const out: Due[] = []
  for (const a of db.actions.values()) {
    if (a.email_id !== null || a.board_column === 'done') continue
    const p = a.payload as { title?: string; due_date?: string | null; due_time?: string | null; urgency?: string }
    if (p.due_date) out.push({ user_id: a.user_id, target: { type: 'card', id: a.id }, title: p.title ?? 'Card', date: p.due_date, time: p.due_time ?? null, critical: p.urgency === 'Critical' })
  }
  for (const e of db.emails.values()) {
    const item = toListItem(db, e)
    if (item.handled || !item.due_date) continue
    out.push({ user_id: e.user_id, target: { type: 'email', id: e.id }, title: item.subject ?? '(no subject)', date: item.due_date, time: null, critical: item.triage?.urgency.label === 'Critical' })
  }
  return out
}

function notify(userId: string, title: string, target: AppNotification['target']) {
  const id = Math.max(0, ...db.notifications.map((n) => Number(n.id))) + 1
  const n = { ...buildNotification(id, { kind: 'reminder', title }, target, new Date().toISOString()), user_id: userId }
  db.notifications.push(n)
  changed()
  const { user_id: _owner, ...wire } = n
  publish(userId, 'notification.new', { notification: wire })
}

/** One pass: each reminder whose time has come (within the last hour) fires once. Returns how many fired. */
export function tickReminders(now = new Date()) {
  let count = 0
  for (const item of dueItems()) {
    for (const t of reminderTimes(item)) {
      const key = `${item.target.type}:${item.target.id}:${t.getTime()}`
      if (fired.has(key) || t.getTime() > now.getTime()) continue
      remember(key)
      if (now.getTime() - t.getTime() > STALE_MS) continue // came due while nobody was looking; don't flood the bell
      notify(item.user_id, item.title, item.target)
      count++
    }
  }
  // Manual reminders ("Remind me"): each fires once when its time has come, whatever the age.
  for (const r of db.reminders) {
    if (r.status !== 'scheduled' || Date.parse(r.fire_at) > now.getTime()) continue
    r.status = 'fired'
    r.fired_at = now.toISOString()
    notify(r.user_id, r.title, r.target)
    count++
  }
  return count
}

let timer: ReturnType<typeof setTimeout> | undefined
export function startReminders() {
  clearTimeout(timer)
  timer = setTimeout(() => {
    if (!control.paused) tickReminders()
    startReminders()
  }, scaled(15_000))
}

/** Dev panel: a reminder right now for the signed-in user's next due item (or a plain one). */
export function fireReminderNow(userId: string) {
  const mine = dueItems().filter((d) => d.user_id === userId).sort((a, b) => a.date.localeCompare(b.date))
  const next = mine.find((d) => d.date >= localDate(new Date().toISOString())) ?? mine[0]
  if (next) notify(userId, next.title, next.target)
}
