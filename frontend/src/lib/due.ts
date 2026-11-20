// The GET /emails `due` filter (PROPOSED, proposals §15.1): which due buckets an email's derived due_date falls in.
// One definition, used by the mock (the list) and the client (whether an arrival counts towards a column's pill).
import type { DueBucket } from '../api/types'

export const DUE_BUCKETS: { key: DueBucket; label: string }[] = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Today' },
  { key: 'next_7_days', label: 'Next 7 days' },
  { key: 'later', label: 'Later' },
  { key: 'none', label: 'No due date' },
]

/** YYYY-MM-DD plus n days, on the calendar (no time-zone drift: the dates are already local to the user). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + n))
  return t.toISOString().slice(0, 10)
}

/**
 * Whether a due date falls in a bucket, `today` being the user's local date.
 * - overdue: before today · today: today · none: no due date
 * - next_7_days: a rolling 7 days starting today (today … today + 6), so it includes today
 * - later: after those 7 days
 */
export function inDueBucket(dueDate: string | null, bucket: DueBucket, today: string): boolean {
  if (bucket === 'none') return dueDate === null
  if (dueDate === null) return false
  switch (bucket) {
    case 'overdue':
      return dueDate < today
    case 'today':
      return dueDate === today
    case 'next_7_days':
      return dueDate >= today && dueDate <= addDays(today, 6)
    case 'later':
      return dueDate > addDays(today, 6)
  }
}

/** Local calendar date of an ISO time (the mock runs in the browser; M6 needs the user's zone, proposals §10). */
export const localDate = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * PROPOSED due_date (proposals §10.2): the earliest action due_date or calendar start date, else null. Rejected
 * proposals don't count. The mock derives list items with it, and the client applies it to the actions that
 * `email.enriched` carries, which has no due_date of its own (proposals §16.1).
 */
export function dueDateOfActions(actions: readonly { status: string; payload: unknown }[]): string | null {
  const dates = actions
    .filter((a) => a.status !== 'rejected')
    .flatMap((a) => {
      const p = a.payload as { due_date?: string | null; start?: string | null }
      return [p.due_date ?? null, p.start ? localDate(p.start) : null]
    })
    .filter((d): d is string => d !== null)
    .sort()
  return dates[0] ?? null
}

/** OR within the group (§6.4.1): any listed bucket matches. An empty list is no filter. */
export const matchesDue = (dueDate: string | null, buckets: readonly DueBucket[], today: string) =>
  buckets.length === 0 || buckets.some((b) => inDueBucket(dueDate, b, today))
