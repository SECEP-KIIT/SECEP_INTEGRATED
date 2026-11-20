import type { AppNotification, Glance } from '../api/types'

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
const dayTimeFmt = new Intl.DateTimeFormat(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

/**
 * "3 Critical · Next event · 11:00 · 5 due today". With glance_subjects off the server sends no event title, so the
 * line says something is coming without saying what (FR-WP-001).
 */
export function glanceLine(g: Glance, now: Date): string {
  const parts = glanceParts(g, now).flatMap((p) => (p.detail ? [p.text, p.detail] : [p.text]))
  return parts.length ? parts.join(' · ') : 'All clear'
}

/** The glance as separate chips for the lock screen: one per count, the next event with its time. */
export function glanceParts(g: Glance, now: Date): { key: string; text: string; detail?: string }[] {
  const parts: { key: string; text: string; detail?: string }[] = []
  if (g.counts.critical_unread) parts.push({ key: 'crit', text: `${g.counts.critical_unread} Critical` })
  if (g.next_event) {
    const start = new Date(g.next_event.start)
    parts.push({ key: 'next', text: g.next_event.title ? `Next: ${g.next_event.title}` : 'Next event', detail: (sameDay(start, now) ? timeFmt : dayTimeFmt).format(start) })
  }
  if (g.counts.due_today) parts.push({ key: 'due', text: `${g.counts.due_today} due today` })
  if (g.counts.overdue) parts.push({ key: 'overdue', text: `${g.counts.overdue} overdue` })
  return parts
}

/**
 * What the lock screen may show of a notification. By default only the generic title (no sender, subject or item
 * title), because the lock is what a passer-by sees. The body only with glance_subjects (FR-WP-001).
 */
export function lockNotificationText(n: AppNotification, showDetails: boolean) {
  return { title: n.title, body: showDetails ? n.body : null }
}
