// GET /me/glance, computed the way M6 would (server role; PROPOSED shape, pending SRS v1.3).
import type { DecoderActionPayload, Glance } from '../api/types'
import type { Db, UserRow } from './store/types'

const day = (iso: string) => iso.slice(0, 10)

export function computeGlance(db: Db, user: UserRow, now: Date): Glance {
  const read = db.reads.get(user.id) ?? new Set<string>()
  const mine = [...db.emails.values()].filter((e) => e.user_id === user.id)
  const unread = mine.filter((e) => !read.has(e.id))
  const criticalUnread = unread.filter((e) => e.triage?.urgency.label === 'Critical')
  const actions = [...db.actions.values()].filter((a) => a.user_id === user.id && a.status !== 'rejected')
  const dueDates = actions
    .filter((a) => a.status !== 'done' || a.board_column !== 'done')
    .map((a) => (a.payload as DecoderActionPayload).due_date)
    .filter((d): d is string => !!d)
  const today = day(now.toISOString())

  const next = actions
    .map((a) => a.payload as DecoderActionPayload)
    .filter((p) => p.start && Date.parse(p.start) > now.getTime())
    .sort((a, b) => Date.parse(a.start!) - Date.parse(b.start!))[0]

  // Lock-screen privacy (FR-WP-001): titles and subjects only when the user opted in.
  const details = user.ui_prefs.glance_subjects === true

  return {
    counts: {
      inbox_unread: unread.length,
      critical_unread: criticalUnread.length,
      board_todo: actions.filter((a) => a.board_column === 'todo').length,
      due_today: dueDates.filter((d) => d === today).length,
      overdue: dueDates.filter((d) => d < today).length,
      security_flags: user.permissions.includes('security.review')
        ? [...db.emails.values()].filter((e) => e.security_flag !== 'none').length
        : null,
    },
    next_event: next ? { title: details ? next.title : null, start: next.start! } : null,
    subjects: details ? criticalUnread.map((e) => e.subject ?? '(no subject)') : null,
  }
}
