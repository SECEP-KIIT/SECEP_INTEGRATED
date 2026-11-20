import { AlarmClock, CalendarClock, Mail, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import { markNotificationsRead } from '../api/queries'
import { onAlert, type TopAlert } from '../lib/alertBus'
import { openNotificationTarget } from '../lib/openTarget'

const SHOW_MS = 5_000
const MAX = 3

/**
 * Reminders and meetings that fire drop in from the top of the screen (FR-REM-004) and stay 5 s, or until dismissed;
 * the bell keeps them either way. A ring beside the close button runs once over those 5 s; hovering or focusing the
 * alert pauses both. Shape icon + text, never colour alone. Motion is transform, opacity and the ring's stroke.
 */
export function TopAlerts() {
  const [alerts, setAlerts] = useState<TopAlert[]>([])
  useEffect(() => onAlert((a) => setAlerts((cur) => [a, ...cur.filter((x) => x.id !== a.id)].slice(0, MAX))), [])
  if (alerts.length === 0) return null
  const dismiss = (id: string) => setAlerts((cur) => cur.filter((x) => x.id !== id))
  return (
    <div className="top-alerts" role="region" aria-label="Alerts">
      {alerts.map((a) => (
        <Alert key={a.id} alert={a} onDone={() => dismiss(a.id)} />
      ))}
    </div>
  )
}

function Alert({ alert: a, onDone }: { alert: TopAlert; onDone: () => void }) {
  const { pathname } = useLocation()
  const [paused, setPaused] = useState(false)
  const left = useRef(SHOW_MS)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })
  // Count down only while not paused; on pause, keep what is left.
  useEffect(() => {
    if (paused) return
    const start = Date.now()
    const t = window.setTimeout(() => done.current(), left.current)
    return () => {
      window.clearTimeout(t)
      left.current = Math.max(0, left.current - (Date.now() - start))
    }
  }, [paused])

  return (
    <div
      className="top-alert"
      role="alert"
      data-paused={paused || undefined}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setPaused(false)}
    >
      {a.kind === 'email' ? <Mail size={18} aria-hidden="true" /> : a.title.startsWith('Meeting') ? <CalendarClock size={18} aria-hidden="true" /> : <AlarmClock size={18} aria-hidden="true" />}
      <button
        type="button"
        className="top-alert-main"
        onClick={() => {
          onDone()
          if (a.kind === 'notification') void markNotificationsRead([a.id]).catch(() => {})
          openNotificationTarget(a.target, pathname)
        }}
      >
        <strong>{a.title}</strong>
        {a.body && <span>{a.body}</span>}
      </button>
      <svg className="alert-ring" viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
        <circle cx="10" cy="10" r="8" pathLength="100" style={{ animationDuration: `${SHOW_MS}ms` }} />
      </svg>
      <button type="button" className="toast-close" onClick={onDone} aria-label="Dismiss">
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
}
