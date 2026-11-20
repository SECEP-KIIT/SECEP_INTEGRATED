import { useEffect } from 'react'
import { useMe } from '../api/queries'
import type { UiPrefs } from '../api/types'
import { lock } from '../boot/lock'
import { isKeybinds, setBindings } from '../lib/keybinds'
import { configurePopups } from '../lib/popupGate'
import { DEFAULT_POPUP_RULES, isPopupRules, isQuietHours } from '../lib/popupRules'

export type ResolvedPrefs = Required<Omit<UiPrefs, 'motion' | 'onboarding'>> & { motion?: Exclude<UiPrefs['motion'], null> }

const DEFAULTS: ResolvedPrefs = {
  motion: undefined, // follow the OS
  skip_lock: false,
  idle_minutes: 15,
  glance_subjects: false,
  sidebar_collapsed: false,
  theme: 'auto',
  popup_rules: DEFAULT_POPUP_RULES,
  // Off for new users (19 Nov 2026, proposals §29); Settings fills in 22:00–08:00 when turned on.
  quiet_hours: null,
  keybinds: {},
}

/** ui_prefs is free-form jsonb on the server; take only well-typed values and default the rest. */
export function resolvePrefs(raw: Record<string, unknown> | undefined): ResolvedPrefs {
  const p = (raw ?? {}) as UiPrefs
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  return {
    motion: p.motion === 'full' || p.motion === 'reduced' || p.motion === 'off' ? p.motion : DEFAULTS.motion,
    skip_lock: bool(p.skip_lock, DEFAULTS.skip_lock),
    idle_minutes: p.idle_minutes === null || typeof p.idle_minutes === 'number' ? p.idle_minutes : DEFAULTS.idle_minutes,
    glance_subjects: bool(p.glance_subjects, DEFAULTS.glance_subjects),
    sidebar_collapsed: bool(p.sidebar_collapsed, DEFAULTS.sidebar_collapsed),
    theme: p.theme === 'light' || p.theme === 'dark' || p.theme === 'auto' ? p.theme : DEFAULTS.theme,
    popup_rules: isPopupRules(p.popup_rules) ? p.popup_rules : DEFAULTS.popup_rules,
    quiet_hours: p.quiet_hours === null || isQuietHours(p.quiet_hours) ? p.quiet_hours : DEFAULTS.quiet_hours,
    keybinds: isKeybinds(p.keybinds) ? p.keybinds : DEFAULTS.keybinds,
  }
}

export function usePrefs(): ResolvedPrefs {
  const { data: me } = useMe()
  return resolvePrefs(me?.ui_prefs)
}

/** Hands the lock-relevant prefs to the lock controller, which also mirrors them for the next static paint. */
export function useApplyPrefs() {
  const { skip_lock, idle_minutes, motion, theme, popup_rules, quiet_hours, keybinds } = usePrefs()
  const { isSuccess } = useMe()
  useEffect(() => {
    if (isSuccess) lock.configure({ skip_lock, idle_minutes, motion, theme })
  }, [isSuccess, skip_lock, idle_minutes, motion, theme])
  // Plain module state, read by realtime.ts (pop-ups) and every key handler (bindings): no React in those paths.
  useEffect(() => configurePopups({ rules: popup_rules, quiet: quiet_hours }), [popup_rules, quiet_hours])
  useEffect(() => setBindings(keybinds), [keybinds])
}

