import type { DecoderActionPayload, JiraPriority, Urgency, UserCardPayload } from '../api/types'

export type SendType = 'create_jira_issue' | 'add_calendar_event'
const PRIORITY_FOR: Record<Urgency, JiraPriority> = { Critical: 'Highest', High: 'High', Medium: 'Medium', Low: 'Low' }
const EMPTY: DecoderActionPayload = { title: null, description: null, priority: null, due_date: null, start: null, end: null, attendees: null }

/** The composer's starting point, from the card: title, description, due date, priority from urgency; an event at the
 * due time (or 9 am on the due date, else tomorrow 9 am), one hour long, with you as the attendee (the §6.4 rules
 * need one). A card with no urgency defaults to Medium priority. */
export function cardDraft(p: UserCardPayload, type: SendType, now = new Date(), me: string | null = null): DecoderActionPayload {
  const base = { ...EMPTY, title: p.title.slice(0, 120), description: p.description }
  if (type === 'create_jira_issue') return { ...base, priority: p.urgency ? PRIORITY_FOR[p.urgency] : 'Medium', due_date: p.due_date }
  let start: Date
  if (p.due_date) start = new Date(`${p.due_date}T${p.due_time ?? '09:00'}`)
  else {
    start = new Date(now)
    start.setDate(start.getDate() + 1)
    start.setHours(9, 0, 0, 0)
  }
  return { ...base, start: start.toISOString(), end: new Date(start.getTime() + 3_600_000).toISOString(), attendees: me ? [me] : [] }
}

