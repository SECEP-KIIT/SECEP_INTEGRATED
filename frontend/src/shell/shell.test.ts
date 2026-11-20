import { describe, expect, it } from 'vitest'
import type { Glance, Me } from '../api/types'
import { computeGlance } from '../mocks/glance'
import { notificationText } from '../mocks/notifications'
import { createDb } from '../mocks/store/generate'
import { toListItem, toMe } from '../mocks/store/serialize'
import type { DecoderActionPayload } from '../api/types'

const db = createDb(Date.parse('2026-11-04T10:00:00Z'))
const demo = db.users[0]
const me = toMe(demo)
const emails = [...db.emails.values()].filter((e) => e.user_id === demo.id)
const notifications = db.notifications.filter((n) => n.user_id === demo.id)
import { anyLayerOpen, focusKeyAction, isTypingTarget } from './focusKeys'
import { glanceLine, lockNotificationText } from './lockText'
import { moreNav, NAV, phoneTabs, visibleNav } from './nav'
import { resolvePrefs } from './prefs'
import { DEFAULT_POPUP_RULES } from '../lib/popupRules'

const key = (k: string, extra: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; target: unknown }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  target: null,
  ...extra,
}) as Parameters<typeof focusKeyAction>[0]

describe('focus mode keys (FR-UI-004)', () => {
  it('F toggles, Esc exits only when focused', () => {
    expect(focusKeyAction(key('f'), false)).toBe('toggle')
    expect(focusKeyAction(key('F'), true)).toBe('toggle')
    expect(focusKeyAction(key('Escape'), true)).toBe('exit')
    expect(focusKeyAction(key('Escape'), false)).toBeNull()
  })

  it('ignores modifiers and typing', () => {
    expect(focusKeyAction(key('f', { ctrlKey: true }), false)).toBeNull()
    expect(focusKeyAction(key('f', { target: { tagName: 'INPUT' } }), false)).toBeNull()
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true)
    expect(isTypingTarget({ tagName: 'BUTTON' } as unknown as EventTarget)).toBe(false)
  })

  it('leaves Esc and F to an open dialog or popover first (F9)', () => {
    const inside = (selector: string | null) => ({ tagName: 'BUTTON', closest: (s: string) => (selector && s.includes(selector) ? {} : null) })
    expect(focusKeyAction(key('Escape', { target: inside('dialog[open]') }), true)).toBeNull()
    expect(focusKeyAction(key('Escape', { target: inside('[data-radix-popper-content-wrapper]') }), true)).toBeNull()
    expect(focusKeyAction(key('f', { target: inside('dialog[open]') }), false)).toBeNull()
    expect(focusKeyAction(key('Escape', { target: inside(null) }), true)).toBe('exit')
  })

  it('an open layer gets Esc even when focus fell outside it, e.g. to <body> (QA pass 3)', () => {
    const body = { tagName: 'BODY', closest: () => null }
    expect(focusKeyAction(key('Escape', { target: body }), true, true)).toBeNull()
    expect(focusKeyAction(key('f', { target: body }), false, true)).toBeNull()
    expect(focusKeyAction(key('Escape', { target: body }), true, false)).toBe('exit')
    expect(anyLayerOpen({ querySelector: (s: string) => (s.includes('dialog[open]') ? ({} as Element) : null) })).toBe(true)
    expect(anyLayerOpen({ querySelector: () => null })).toBe(false)
  })
})

describe('nav gating (sidebar and tab bar share it)', () => {
  const user = { ...me, is_admin: false, permissions: [] } satisfies Me
  it('hides Security without security.review', () => {
    expect(visibleNav(user).map((i) => i.label)).toEqual(['Home', 'Inbox', 'Board'])
    expect(visibleNav(me).map((i) => i.label)).toEqual(NAV.map((i) => i.label))
  })
  it('shows only ungated items before /me arrives', () => {
    expect(visibleNav(undefined).map((i) => i.label)).toEqual(['Home', 'Inbox', 'Board'])
  })
  it('phone tabs are Home, Inbox, Board, Security; the rest go under More (proposals §15.3)', () => {
    expect(phoneTabs(me).map((i) => i.label)).toEqual(['Home', 'Inbox', 'Board', 'Security'])
    expect(moreNav(me).map((i) => i.label)).toEqual([]) // Calendar is v2; Metrics is the Stats widget now
    expect(phoneTabs(user).map((i) => i.label)).toEqual(['Home', 'Inbox', 'Board']) // no security.review
  })
})

describe('resolvePrefs', () => {
  it('defaults, and drops wrongly typed values', () => {
    expect(resolvePrefs({})).toEqual({ motion: undefined, skip_lock: false, idle_minutes: 15, glance_subjects: false, sidebar_collapsed: false, theme: 'auto', popup_rules: DEFAULT_POPUP_RULES, quiet_hours: null, keybinds: {} })
    expect(resolvePrefs({ quiet_hours: null, keybinds: { lock: 'Alt+Q' }, popup_rules: { bad: 1 } })).toMatchObject({ quiet_hours: null, keybinds: { lock: 'Alt+Q' }, popup_rules: DEFAULT_POPUP_RULES })
    expect(resolvePrefs({ theme: 'dark' }).theme).toBe('dark')
    expect(resolvePrefs({ theme: 'sepia' }).theme).toBe('auto')
    expect(resolvePrefs({ motion: 'wild', skip_lock: 'yes', idle_minutes: null })).toMatchObject({ motion: undefined, skip_lock: false, idle_minutes: null })
  })
})

// Lock-screen privacy (FR-WP-001): a passer-by sees counts, never senders, subjects, item titles or issue keys,
// unless the user opted in with glance_subjects.
describe('lock-screen privacy', () => {
  const titles = [...db.actions.values()].map((a) => (a.payload as DecoderActionPayload).title ?? '')
  const sensitive = [...emails.flatMap((e) => [e.subject ?? '', e.from.name ?? '', e.from.address]), ...titles, 'ATL-'].filter(Boolean)
  const critical = emails.find((e) => e.triage?.urgency.label === 'Critical')!

  it('notification titles never carry a sender, subject, item title or issue key', () => {
    expect(notifications.length).toBeGreaterThan(0)
    for (const n of notifications) for (const s of sensitive) expect(n.title).not.toContain(s)
    const text = notificationText({ kind: 'new_email', email: toListItem(db, critical) })
    expect(text.title).toBe('New Critical email')
    expect(text.body).toContain(critical.from.name!)
    const jira = notificationText({ kind: 'jira_status', key: 'ATL-141', status: 'Done', title: 'Collect Q3 churn figures' })
    expect(jira.title).toBe('Jira issue updated')
    expect(jira.body).toContain('ATL-141')
  })

  it('the lock shows notification bodies only with glance_subjects', () => {
    expect(lockNotificationText(notifications[0], false).body).toBeNull()
    expect(lockNotificationText(notifications[0], true).body).toBe(notifications[0].body)
  })

  it('glance hides event titles and subjects unless opted in', () => {
    const now = new Date(Date.parse('2026-11-04T10:00:00Z') - 3 * 86_400_000)
    const off = computeGlance(db, { ...demo, ui_prefs: {} }, now)
    expect(off.next_event).not.toBeNull()
    expect(off.next_event?.title).toBeNull()
    expect(off.subjects).toBeNull()
    const line = glanceLine(off, now)
    for (const s of sensitive) expect(line).not.toContain(s)

    const on = computeGlance(db, { ...demo, ui_prefs: { glance_subjects: true } }, now)
    expect(on.next_event?.title).toBeTruthy()
    expect(on.subjects).not.toBeNull()
  })

  it('security_flags count is withheld without security.review', () => {
    expect(computeGlance(db, { ...demo, permissions: [] }, new Date()).counts.security_flags).toBeNull()
    expect(computeGlance(db, demo, new Date()).counts.security_flags).toBeGreaterThan(0)
  })

  it('formats the glance line from counts', () => {
    const g: Glance = {
      counts: { inbox_unread: 5, critical_unread: 3, board_todo: 0, due_today: 5, overdue: 0, security_flags: 1 },
      next_event: { title: null, start: '2026-11-04T11:00:00' },
      subjects: null,
    }
    expect(glanceLine(g, new Date('2026-11-04T09:00:00'))).toMatch(/^3 Critical · Next event · .+ · 5 due today$/)
  })
})
