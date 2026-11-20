// Pop-up rules (FR-REM-007, §28.1) and key binds (§28.3): the pure parts.
import { afterEach, describe, expect, it } from 'vitest'
import { comboOf, comboProblem, display, isKeybinds, matches, overridesOf, resolveBindings, setBindings, usedBy } from './keybinds'
import { isOnboarding } from '../onboarding/onboarding'
import { DEFAULT_POPUP_RULES, inQuietHours, isPopupRules, isQuietHours, popupMode, shouldPopUp } from './popupRules'

const at = (h: number, m = 0) => new Date(2026, 10, 19, h, m)

describe('pop-up rules', () => {
  it('quiet hours wrap past midnight and are off when null or empty', () => {
    const q = { start: '22:00', end: '08:00' }
    expect([at(21, 59), at(22), at(3), at(7, 59), at(8)].map((d) => inQuietHours(q, d))).toEqual([false, true, true, true, false])
    expect(inQuietHours({ start: '13:00', end: '14:00' }, at(13, 30))).toBe(true)
    expect(inQuietHours(null, at(23))).toBe(false)
    expect(inQuietHours({ start: '09:00', end: '09:00' }, at(9))).toBe(false)
  })

  it('quiet hours win over focus mode', () => {
    const q = { start: '22:00', end: '08:00' }
    expect(popupMode(true, q, at(23))).toBe('quiet')
    expect(popupMode(true, q, at(12))).toBe('focus')
    expect(popupMode(false, q, at(12))).toBe('normal')
  })

  it('defaults: Normal = High+ and Frustrated, Focus = Critical only, Quiet = none', () => {
    const { normal, focus, quiet } = DEFAULT_POPUP_RULES
    expect(shouldPopUp({ urgency: 'High', sentiment: 'Neutral' }, normal)).toBe(true)
    expect(shouldPopUp({ urgency: 'Medium', sentiment: 'Neutral' }, normal)).toBe(false)
    expect(shouldPopUp({ urgency: 'Low', sentiment: 'Frustrated' }, normal)).toBe(true)
    expect(shouldPopUp({ urgency: 'Low', sentiment: 'Negative' }, normal)).toBe(false)
    expect(shouldPopUp({ urgency: 'High', sentiment: 'Frustrated' }, focus)).toBe(false)
    expect(shouldPopUp({ urgency: 'Critical', sentiment: 'Neutral' }, focus)).toBe(true)
    expect(shouldPopUp({ urgency: 'Critical', sentiment: 'Frustrated' }, quiet)).toBe(false)
    expect(shouldPopUp({ urgency: 'Low', sentiment: 'Negative' }, { urgency: 'none', sentiment: 'negative' })).toBe(true)
    expect(shouldPopUp({ urgency: 'Low', sentiment: 'Neutral' }, { urgency: 'all', sentiment: 'off' })).toBe(true)
  })

  it('validates the stored shapes', () => {
    expect(isPopupRules(DEFAULT_POPUP_RULES)).toBe(true)
    expect(isPopupRules({ ...DEFAULT_POPUP_RULES, quiet: { urgency: 'loud', sentiment: 'off' } })).toBe(false)
    expect(isPopupRules({ normal: DEFAULT_POPUP_RULES.normal })).toBe(false)
    expect(isQuietHours({ start: '22:00', end: '08:00' })).toBe(true)
    expect(isQuietHours({ start: '24:00', end: '08:00' })).toBe(false)
    expect(isQuietHours({ start: '22:00' })).toBe(false)
  })
})

describe('key binds', () => {
  afterEach(() => setBindings({}))
  const k = (key: string, o: { code?: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) => ({ key, ...o })

  it('turns key presses into combos', () => {
    expect(comboOf(k('j'))).toBe('J')
    expect(comboOf(k('J', { shiftKey: true }))).toBe('Shift+J')
    expect(comboOf(k('k', { ctrlKey: true }))).toBe('Mod+K')
    expect(comboOf(k('k', { metaKey: true }))).toBe('Mod+K')
    expect(comboOf(k('¬', { altKey: true, code: 'KeyL' }))).toBe('Alt+L') // a Mac's Alt+L
    expect(comboOf(k('?', { shiftKey: true }))).toBe('?')
    expect(comboOf(k('/'))).toBe('/')
    expect(comboOf(k('F2', { shiftKey: true }))).toBe('Shift+F2')
    expect(comboOf(k('Shift', { shiftKey: true }))).toBeNull()
  })

  it('matches the defaults, then the overrides', () => {
    expect(matches(k('k', { ctrlKey: true }), 'search')).toBe(true)
    expect(matches(k('/'), 'search_alt')).toBe(true)
    setBindings({ search: 'Alt+S', next: 'N' })
    expect(matches(k('k', { ctrlKey: true }), 'search')).toBe(false)
    expect(matches(k('s', { altKey: true, code: 'KeyS' }), 'search')).toBe(true)
    expect(matches(k('n'), 'next')).toBe(true)
  })

  it('finds clashes, refuses reserved keys and stores overrides only', () => {
    const b = resolveBindings({})
    expect(usedBy(b, 'J', 'prev')).toBe('next')
    expect(usedBy(b, 'J', 'next')).toBeNull()
    expect(comboProblem('ESCAPE')).not.toBeNull()
    expect(comboProblem('Mod+C')).not.toBeNull()
    expect(comboProblem('Alt+Q')).toBeNull()
    expect(overridesOf({ ...b, lock: 'Alt+Q' })).toEqual({ lock: 'Alt+Q' })
    expect(isKeybinds({ lock: 'Alt+Q' })).toBe(true)
    expect(isKeybinds({ teleport: 'T' })).toBe(false)
    expect(isKeybinds({ lock: 'Alt+Ctrl+Q' })).toBe(false)
    expect(resolveBindings({ lock: 42, nope: 'X' }).lock).toBe('Alt+L')
  })

  it('shows combos the way the platform writes them', () => {
    expect(display('Mod+K', false)).toBe('Ctrl K')
    expect(display('Mod+K', true)).toBe('⌘K')
    expect(display('Shift+J', false)).toBe('⇧J')
    expect(display('Alt+L', true)).toBe('⌥L')
    expect(display('PAGEDOWN', false)).toBe('Pagedown')
  })
})

describe('onboarding progress (§29)', () => {
  it('accepts partial progress and refuses unknown keys or ids', () => {
    expect(isOnboarding({})).toBe(true)
    expect(isOnboarding({ tour: 'paused', tour_step: 2, done: ['open_email', 'search'], hints: ['remind'], checklist_hidden: false })).toBe(true)
    expect(isOnboarding({ tour: 'maybe' })).toBe(false)
    expect(isOnboarding({ tour_step: -1 })).toBe(false)
    expect(isOnboarding({ done: ['fly'] })).toBe(false)
    expect(isOnboarding({ extra: 1 })).toBe(false)
  })
})
