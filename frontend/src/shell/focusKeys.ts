// Focus mode keys (FR-UI-004): F (or the key set in Settings) toggles, Esc leaves. Pure, so it's unit-tested.
import { hasModifier, matches } from '../lib/keybinds'

interface KeyLike {
  key: string
  code?: string
  shiftKey?: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  target: EventTarget | null
}

/** Single-key shortcuts must never fire while the user is typing. */
export function isTypingTarget(target: EventTarget | null) {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null
  if (!el?.tagName) return false
  return el.isContentEditable === true || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

/**
 * F9, QA pass 3: while any dialog (drawer, legend, gallery) or popover is open, keys belong to the topmost layer,
 * wherever keyboard focus is. Focus can land outside the layer (a clicked button inside it disappears), so asking
 * whether the key's target is inside a layer isn't enough. Esc closes the layer first; only a later Esc, with
 * nothing open, leaves Focus mode. The native modal <dialog> and Radix popovers close on Esc themselves.
 */
export function focusKeyAction(e: KeyLike, focused: boolean, layerOpen = false): 'toggle' | 'exit' | null {
  if (layerOpen || inLayer(e.target)) return null
  if (matches(e, 'focus') && (hasModifier('focus') || !isTypingTarget(e.target))) return 'toggle'
  if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return null
  if (e.key === 'Escape' && focused) return 'exit'
  return null
}

const LAYER = 'dialog[open], [data-radix-popper-content-wrapper]'

export function inLayer(target: EventTarget | null) {
  const el = target as { closest?: (selector: string) => unknown } | null
  return !!el?.closest?.(LAYER)
}

/** Whether any dialog or popover is open anywhere on the page. */
export const anyLayerOpen = (doc: Pick<Document, 'querySelector'> = document) => doc.querySelector(LAYER) !== null
