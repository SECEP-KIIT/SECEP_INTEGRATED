import * as Popover from '@radix-ui/react-popover'
import { AlarmClock, Bell as BellIcon, CalendarClock, Mail, SquareKanban, Zap } from 'lucide-react'
import { useState } from 'react'
import { useLocation } from 'react-router'
import { markNotificationsRead, useNotifications } from '../api/queries'
import type { AppNotification, NotificationKind } from '../api/types'
import { openNotificationTarget } from '../lib/openTarget'
import { useMinuteClock } from './useMinuteClock'

const ICON: Record<NotificationKind, typeof Mail> = {
  reminder: AlarmClock,
  meeting: CalendarClock,
  new_email: Mail,
  jira_status: Zap,
  digest: SquareKanban,
}

function ago(iso: string, now: Date) {
  const min = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000))
  if (min < 1) return 'now'
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  return h < 24 ? `${h} h` : new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/**
 * The notification bell (FR-REM-004, FR-UI-001): unread count, the list newest first, click to open what it is
 * about, "Mark all read". Undelivered reminders stay here until read. Shape icon + text, never colour alone.
 */
export function Bell() {
  const { data } = useNotifications()
  const now = useMinuteClock()
  const { pathname } = useLocation()
  const [isOpen, setOpen] = useState(false)
  const items = data?.items ?? []
  const unread = items.filter((n) => n.read_at === null).length

  const open = (n: AppNotification) => {
    setOpen(false)
    if (n.read_at === null) void markNotificationsRead([n.id]).catch(() => {})
    openNotificationTarget(n.target, pathname)
  }

  return (
    <Popover.Root open={isOpen} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button type="button" className="icon-button bell" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
          <BellIcon aria-hidden="true" size={18} />
          {unread > 0 && (
            <span key={unread} className="bell-badge" aria-hidden="true">
              {unread}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="bell-pop" side="bottom" align="end" sideOffset={6} collisionPadding={8} aria-label="Notifications">
          <header className="bell-head">
            <strong>Notifications</strong>
            <button type="button" className="text-button" disabled={unread === 0} onClick={() => void markNotificationsRead().catch(() => {})}>
              Mark all read
            </button>
          </header>
          {items.length === 0 ? (
            <p className="bell-empty">Nothing yet. Reminders and Critical emails will show up here.</p>
          ) : (
            <ul className="bell-list">
              {items.slice(0, 30).map((n) => {
                const Icon = ICON[n.kind]
                return (
                  <li key={n.id}>
                    <button type="button" className="bell-item" data-unread={n.read_at === null || undefined} onClick={() => open(n)}>
                      <Icon size={16} aria-hidden="true" />
                      <span className="bell-text">
                        <span className="bell-title">
                          {n.read_at === null && <span className="sr-only">Unread. </span>}
                          {n.title}
                        </span>
                        {n.body && <span className="bell-body">{n.body}</span>}
                      </span>
                      <time dateTime={n.created_at}>{ago(n.created_at, now)}</time>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
