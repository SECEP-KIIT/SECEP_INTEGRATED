// Builds notification text the way M6 would (server role). Privacy rule for the lock screen (FR-WP-001): `title`
// is generic. It carries no sender, subject, event/card title or Jira issue key, because the lock is what a
// passer-by sees; only kind and timing may show. Details go in `body`, which the lock shows only when
// ui_prefs.glance_subjects is on. Task 13 reuses this builder.
import type { AppNotification, EmailListItem } from '../api/types'

type EmailFacts = Pick<EmailListItem, 'from' | 'subject' | 'triage'>

export type NotificationSource =
  | { kind: 'new_email'; email: EmailFacts }
  | { kind: 'meeting'; title: string; minutes: number }
  | { kind: 'reminder'; title: string }
  | { kind: 'jira_status'; key: string; status: string; title: string }
  | { kind: 'digest'; count: number }

export function notificationText(src: NotificationSource): Pick<AppNotification, 'title' | 'body'> {
  switch (src.kind) {
    case 'new_email': {
      const urgency = src.email.triage?.urgency.label
      const sender = src.email.from.name ?? src.email.from.address
      return {
        title: urgency === 'Critical' ? 'New Critical email' : 'New email',
        body: `${sender}: ${src.email.subject ?? '(no subject)'}`,
      }
    }
    case 'meeting':
      // Timing only, like "Next event · 11:00" on the glance line; the meeting title is content.
      return { title: `Meeting in ${src.minutes} min`, body: src.title }
    case 'reminder':
      return { title: 'Reminder due', body: src.title }
    case 'jira_status':
      // Issue keys count as content: the project key often names a client or project (ACME-12).
      return { title: 'Jira issue updated', body: `${src.key} moved to ${src.status}: ${src.title}` }
    case 'digest':
      return { title: 'Daily digest ready', body: `${src.count} emails need attention` }
  }
}

export function buildNotification(
  id: number,
  src: NotificationSource,
  target: AppNotification['target'],
  createdAt: string,
): AppNotification {
  return { id: String(id), kind: src.kind, ...notificationText(src), target, read_at: null, created_at: createdAt }
}
