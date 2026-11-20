import { isOnboarding } from '../../onboarding/onboarding'
// Auth, the caller's profile and preferences, glance, notifications, mailbox (§6.5, §6.4.1 + PROPOSED).
import type { PreferencesResponse, RefreshResponse, UiPrefs } from '../../api/types'
import { computeGlance } from '../glance'
import { page } from '../http/cursor'
import { Fail, route } from '../http/route'
import { object, isInt } from '../http/validate'
import { issueToken, signOut } from '../session'
import { changed, db } from '../store/db'
import { toMe } from '../store/serialize'
import { isKeybinds } from '../../lib/keybinds'
import { isPopupRules, isQuietHours } from '../../lib/popupRules'

const PREF_CHECKS: Record<keyof UiPrefs, (v: unknown) => boolean> = {
  motion: (v) => v === null || v === 'full' || v === 'reduced' || v === 'off',
  skip_lock: (v) => typeof v === 'boolean',
  idle_minutes: (v) => v === null || isInt(v, 1, 240),
  glance_subjects: (v) => typeof v === 'boolean',
  sidebar_collapsed: (v) => typeof v === 'boolean',
  theme: (v) => v === 'light' || v === 'dark' || v === 'auto',
  // PROPOSED (proposals §28)
  popup_rules: isPopupRules,
  quiet_hours: (v) => v === null || isQuietHours(v),
  keybinds: isKeybinds,
  onboarding: isOnboarding,
}

export const meRoutes = [
  // Refresh: authenticated by the (simulated) httpOnly refresh cookie, not a bearer token.
  route('post', '/auth/refresh', 'cookie', () => {
    const token = issueToken()
    if (!token) throw new Fail(401, 'unauthenticated', 'Not signed in')
    return token satisfies RefreshResponse
  }),

  route('post', '/auth/logout', 'user', () => {
    signOut()
    return undefined
  }),

  route('get', '/me', 'user', ({ user }) => toMe(user)),

  // PROPOSED (pending SRS v1.3).
  route('patch', '/me/preferences', 'user', ({ user, body }) => {
    const f = object(body)
    for (const [k, v] of Object.entries(f.body)) {
      const check = PREF_CHECKS[k as keyof UiPrefs]
      if (!check) f.add(k, 'Unknown preference')
      else if (!check(v)) f.add(k, 'Invalid value')
    }
    f.done('validation_failed', 'Invalid preferences')
    user.ui_prefs = { ...user.ui_prefs, ...(f.body as UiPrefs) }
    changed()
    return { ui_prefs: { ...user.ui_prefs } } satisfies PreferencesResponse
  }),

  route('get', '/me/glance', 'user', ({ user }) => computeGlance(db, user, new Date())),

  route('get', '/notifications', 'user', ({ user, url }) =>
    page(
      url,
      db.notifications
        .filter((n) => n.user_id === user.id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map(({ user_id: _owner, ...n }) => n),
    ),
  ),

  // §6.5: POST /notifications/read { ids? }: those, or every unread one when ids is left out.
  route('post', '/notifications/read', 'user', ({ user, body }) => {
    const f = object(body).only(['ids'])
    const ids = f.body.ids
    if (ids !== undefined && !(Array.isArray(ids) && ids.every((i) => typeof i === 'string'))) f.add('ids', 'Must be an array of notification ids')
    f.done()
    const at = new Date().toISOString()
    for (const n of db.notifications) if (n.user_id === user.id && n.read_at === null && (ids === undefined || (ids as string[]).includes(n.id))) n.read_at = at
    changed()
    return undefined
  }, { status: 204 }),

  // FR-ADM-007: revoke the Google token and stop polling (the mock pipeline skips revoked mailboxes).
  route('delete', '/mailboxes/me', 'user', ({ user }) => {
    if (user.mailbox) user.mailbox.status = 'revoked'
    changed()
    return undefined
  }),
]
