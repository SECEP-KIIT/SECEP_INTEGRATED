// Editable key binds (proposals §28.3). One list of actions with their default keys; ui_prefs.keybinds stores only
// the user's overrides. Every shortcut handler asks `matches(e, id)`, so a change in Settings applies everywhere.
// Pure apart from the small current-bindings store, which useApplyPrefs feeds from ui_prefs.
import { useSyncExternalStore } from 'react'

export type KeyActionId = 'search' | 'search_alt' | 'quick_add' | 'focus' | 'lock' | 'next' | 'prev' | 'select' | 'done' | 'project' | 'remind' | 'jira'

export interface KeyActionDef {
  id: KeyActionId
  label: string
  group: 'App' | 'Cards'
  default: string
}

/** Combos are `Mod+`, `Alt+`, `Shift+` (in that order) then one key. Mod is Ctrl, or ⌘ on a Mac. */
export const KEY_ACTIONS: KeyActionDef[] = [
  { id: 'search', label: 'Search', group: 'App', default: 'Mod+K' },
  { id: 'search_alt', label: 'Search (second key)', group: 'App', default: '/' },
  { id: 'quick_add', label: 'Quick add a card', group: 'App', default: 'N' },
  { id: 'focus', label: 'Focus mode on or off', group: 'App', default: 'F' },
  { id: 'lock', label: 'Lock screen', group: 'App', default: 'Alt+L' },
  { id: 'next', label: 'Next card', group: 'Cards', default: 'J' },
  { id: 'prev', label: 'Previous card', group: 'Cards', default: 'K' },
  { id: 'select', label: 'Select', group: 'Cards', default: 'X' },
  { id: 'done', label: 'Mark as handled', group: 'Cards', default: 'E' },
  { id: 'project', label: 'Add to project', group: 'Cards', default: 'P' },
  { id: 'remind', label: 'Remind me', group: 'Cards', default: 'R' },
  { id: 'jira', label: 'Send to Jira', group: 'Cards', default: 'Shift+J' },
]
const IDS = new Set<string>(KEY_ACTIONS.map((a) => a.id))
const DEFAULTS = Object.fromEntries(KEY_ACTIONS.map((a) => [a.id, a.default])) as Record<KeyActionId, string>

/** Keys that stay fixed: Esc closes, Tab and Enter move and open, arrows mirror next/previous, Ctrl/⌘+C copies. */
const RESERVED = new Set(['ESCAPE', 'TAB', 'ENTER', ' ', 'ARROWUP', 'ARROWDOWN', 'ARROWLEFT', 'ARROWRIGHT', 'BACKSPACE', 'DELETE', 'Mod+C', 'Mod+V', 'Mod+X', 'Mod+A', 'Mod+Z'])
const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'Fn', 'OS'])

export interface KeyLike {
  key: string
  code?: string
  shiftKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
}

/**
 * The combo a key press makes, or null for a lone modifier. Letters and digits come from `code` when it's there, so
 * Alt+L stays "Alt+L" on a Mac (where e.key is "¬"). Shift is kept for letters, digits and named keys only: for a
 * symbol the character already says it ("?" is Shift+/).
 */
export function comboOf(e: KeyLike): string | null {
  if (MODIFIERS.has(e.key)) return null
  const fromCode = e.code?.match(/^Key([A-Z])$|^Digit(\d)$/)
  const key = fromCode ? (fromCode[1] ?? fromCode[2]) : e.key.toUpperCase()
  const alnum = /^[A-Z0-9]$/.test(key)
  const named = key.length > 1
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('Mod')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey && (alnum || named)) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

const COMBO = /^(Mod\+)?(Alt\+)?(Shift\+)?([^+]|[A-Z][A-Z0-9]{1,11})$/
export const isCombo = (v: unknown): v is string => typeof v === 'string' && v.length <= 24 && COMBO.test(v)

/** Why a combo can't be used, or null. */
export function comboProblem(combo: string): string | null {
  const key = combo.split('+').pop() ?? ''
  if (RESERVED.has(combo) || RESERVED.has(key)) return `${display(combo)} is kept for its usual job`
  return null
}

/** ui_prefs.keybinds: action id → combo, overrides only. */
export const isKeybinds = (v: unknown): v is Partial<Record<KeyActionId, string>> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.entries(v).every(([k, c]) => IDS.has(k) && isCombo(c))

/** The full map: defaults with the user's overrides on top (unknown or invalid entries ignored). */
export function resolveBindings(overrides: unknown): Record<KeyActionId, string> {
  const out = { ...DEFAULTS }
  if (typeof overrides === 'object' && overrides !== null) {
    for (const [k, c] of Object.entries(overrides)) if (IDS.has(k) && isCombo(c)) out[k as KeyActionId] = c
  }
  return out
}

/** Which action already uses this combo (other than `except`), so Settings can refuse a clash. */
export function usedBy(bindings: Record<KeyActionId, string>, combo: string, except?: KeyActionId): KeyActionId | null {
  return (Object.keys(bindings) as KeyActionId[]).find((id) => id !== except && bindings[id] === combo) ?? null
}

/** Only what differs from the defaults goes on the wire. */
export const overridesOf = (bindings: Record<KeyActionId, string>) =>
  Object.fromEntries(Object.entries(bindings).filter(([id, c]) => DEFAULTS[id as KeyActionId] !== c)) as Partial<Record<KeyActionId, string>>

export const defaultOf = (id: KeyActionId) => DEFAULTS[id]

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

/** "Mod+K" → "Ctrl K" or "⌘K"; "Shift+J" → "⇧J"; "Alt+L" → "Alt L" or "⌥L". */
export function display(combo: string, mac = isMac): string {
  const parts = combo.split('+')
  const key = parts.pop() ?? ''
  const name = key === ' ' ? 'Space' : key.length > 1 ? key[0] + key.slice(1).toLowerCase() : key
  const mods = parts.map((m) => (m === 'Mod' ? (mac ? '⌘' : 'Ctrl ') : m === 'Alt' ? (mac ? '⌥' : 'Alt ') : '⇧'))
  return mods.join('') + name
}

// ── Current bindings (fed from ui_prefs by useApplyPrefs) ──────────────────────────────────────────────────────
let current = { ...DEFAULTS }
const listeners = new Set<() => void>()

export function setBindings(overrides: unknown) {
  const next = resolveBindings(overrides)
  if (JSON.stringify(next) === JSON.stringify(current)) return
  current = next
  for (const l of listeners) l()
}

export const bindingOf = (id: KeyActionId) => current[id]

export const matches = (e: KeyLike, id: KeyActionId) => comboOf(e) === current[id]

/** True when the bound combo has Ctrl/⌘ or Alt, so it may fire even while typing in a field. */
export const hasModifier = (id: KeyActionId) => /^(Mod|Alt)\+/.test(current[id])

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}
const snapshot = () => current

/** All current bindings, re-rendering when Settings changes one. */
export const useBindings = () => useSyncExternalStore(subscribe, snapshot)
/** One binding for display, e.g. in a menu or a title. */
export const useKeyLabel = (id: KeyActionId) => display(useBindings()[id])
