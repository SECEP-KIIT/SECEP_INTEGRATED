// Runs the pop-up rules (FR-REM-007) on a new email that arrives over the socket. Module state, because realtime.ts
// runs outside React: useApplyPrefs feeds the rules and quiet hours, the shell feeds Focus mode.
import type { EmailListItem } from '../api/types'
import { lock } from '../boot/lock'
import { raiseAlert } from './alertBus'
import { DEFAULT_POPUP_RULES, popupMode, shouldPopUp, type PopupRules, type QuietHours } from './popupRules'

let rules: PopupRules = DEFAULT_POPUP_RULES
let quiet: QuietHours | null = null
let focused = false
const shown = new Set<string>()

export function configurePopups(next: { rules: PopupRules; quiet: QuietHours | null }) {
  rules = next.rules
  quiet = next.quiet
}
export const setPopupFocus = (on: boolean) => void (focused = on)

/** A real arrival: pop it up if the current mode's rule lets it through. Once per email; never behind the lock. */
export function maybePopUp(email: EmailListItem, now = new Date()) {
  const t = email.triage
  if (!t || email.read || email.handled || shown.has(email.id) || !lock.isOpen()) return
  if (!shouldPopUp({ urgency: t.urgency.label, sentiment: t.sentiment.label }, rules[popupMode(focused, quiet, now)])) return
  shown.add(email.id)
  const who = email.from.name ?? email.from.address
  const mood = t.sentiment.label === 'Frustrated' || t.sentiment.label === 'Negative' ? ` · ${t.sentiment.label}` : ''
  raiseAlert({ id: `email:${email.id}`, title: `${t.urgency.label}${mood} · ${who}`, body: email.subject, target: { type: 'email', id: email.id } }, 'email')
}
