// Pop-up alerts that drop in from the top of the screen: a reminder or meeting that fires (FR-REM-004), or a new
// email the pop-up rules let through (FR-REM-007, popupGate.ts). The shell's
// TopAlerts shows them; realtime.ts raises them. Plain events, like the toast bus.
import type { AppNotification } from '../api/types'

const EVENT = 'secep:alert'

export interface TopAlert {
  id: string
  title: string
  body: string | null
  target: AppNotification['target']
  /** An email pop-up has no notification row behind it, so opening it marks nothing read. */
  kind: 'notification' | 'email'
}

export const raiseAlert = (n: Pick<AppNotification, 'id' | 'title' | 'body' | 'target'>, kind: TopAlert['kind'] = 'notification') =>
  dispatchEvent(new CustomEvent<TopAlert>(EVENT, { detail: { id: n.id, title: n.title, body: n.body, target: n.target, kind } }))

export function onAlert(fn: (a: TopAlert) => void) {
  const handler = (e: Event) => fn((e as CustomEvent<TopAlert>).detail)
  addEventListener(EVENT, handler)
  return () => removeEventListener(EVENT, handler)
}
