// Simulated incoming mail: M2 ingests → M3 labels (email.triaged) → M4 enriches (email.enriched) → M5 scores links
// (email.flagged). Events go to room user:{id} through the Socket.io mock. Delays follow NFR-PERF-001/004/006 loosely.
import { control, scaled } from './control'
import { buildNotification } from './notifications'
import { currentSession } from './session'
import { changed, db, enrichArrival, insertArrival, scoreArrival, userById } from './store/db'
import { publish } from './store/events'
import { toAction, toLink, toListItem } from './store/serialize'
import { DEMO_TEMPLATES, TEMPLATES } from './store/templates'

const later = (ms: number) => new Promise((r) => setTimeout(r, scaled(ms)))
const between = (min: number, max: number) => min + Math.random() * (max - min)

/** Deliver one email to a user, through all three pipeline stages. */
export async function deliver(userId: string, template: number) {
  const user = userById(userId)
  // FR-ADM-007: a disconnected mailbox is no longer polled.
  if (!user?.mailbox || user.mailbox.status !== 'active') return
  const index = db.arrivals.push({ template, received_at: new Date().toISOString(), user_id: userId }) - 1
  const email = insertArrival(index)
  changed()
  publish(userId, 'email.triaged', { email_id: email.id, email: toListItem(db, email) })

  if (email.triage?.urgency.label === 'Critical') {
    const id = Math.max(0, ...db.notifications.map((n) => Number(n.id))) + 1
    const n = { ...buildNotification(id, { kind: 'new_email', email: toListItem(db, email) }, { type: 'email', id: email.id }, new Date().toISOString()), user_id: userId }
    db.notifications.push(n)
    const { user_id: _owner, ...wire } = n
    publish(userId, 'notification.new', { notification: wire })
  }

  // After each wait the email is looked up again: another tab may have replaced the store meanwhile
  // (src/mocks/tabsync.ts), and a reset drops it.
  await later(between(2000, 6000))
  const enriching = db.emails.get(email.id)
  if (!enriching) return
  enrichArrival(index, enriching)
  changed()
  publish(userId, 'email.enriched', {
    email_id: enriching.id,
    status: enriching.status,
    summary_one_line: enriching.summary?.one_line ?? null,
    summary_short: enriching.summary?.short ?? null,
    actions: [...db.actions.values()].filter((a) => a.email_id === enriching.id).map(toAction),
  })

  if (!TEMPLATES[template].links?.length) return
  await later(between(800, 2500))
  const scoring = db.emails.get(email.id)
  if (!scoring) return
  scoreArrival(index, scoring)
  changed()
  publish(userId, 'email.flagged', {
    email_id: scoring.id,
    security_flag: scoring.security_flag,
    links: db.urlChecks.filter((c) => c.email_id === scoring.id).map(toLink),
  })
}

const sessionUser = () => currentSession()?.user_id ?? null

/** One email now, for the signed-in user. */
export function sendOne() {
  const userId = sessionUser()
  if (userId) void deliver(userId, Math.floor(Math.random() * TEMPLATES.length))
}

/** §7.2 step 3: the five prepared emails within about 35 s. */
export function runDemo() {
  const userId = sessionUser()
  if (!userId) return
  DEMO_TEMPLATES.forEach((template, i) => setTimeout(() => void deliver(userId, template), scaled(i * 7000)))
}

let timer: ReturnType<typeof setTimeout> | undefined

/** Background arrivals every control.arrivalEvery seconds while not paused. */
export function startArrivals() {
  clearTimeout(timer)
  const [min, max] = control.arrivalEvery
  timer = setTimeout(() => {
    if (!control.paused) sendOne()
    startArrivals()
  }, scaled(between(min, max) * 1000))
}
