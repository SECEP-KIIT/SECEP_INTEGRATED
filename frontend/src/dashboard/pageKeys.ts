// Page switching keys (FR-UI-007): Ctrl+←/→ and Ctrl+1…9. Pure, so it's unit-tested.
import { inLayer, isTypingTarget } from '../shell/focusKeys'

interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  target: EventTarget | null
}

export type PageKey = { by: -1 | 1 } | { to: number } | null

/**
 * Never while typing (Ctrl+← moves by word there) or inside a dialog or popover (keys belong to that layer, F9).
 * Ctrl+1…9 is reserved for tab switching by some browsers, which then never deliver it; Ctrl+←/→ always works.
 */
export function pageKeyAction(e: KeyLike, pageCount: number, layerOpen = false): PageKey {
  if (layerOpen || !e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || isTypingTarget(e.target) || inLayer(e.target)) return null
  if (e.key === 'ArrowLeft') return { by: -1 }
  if (e.key === 'ArrowRight') return { by: 1 }
  if (/^[1-9]$/.test(e.key)) {
    const to = Number(e.key) - 1
    return to < pageCount ? { to } : null
  }
  return null
}

/** A horizontal trackpad swipe: enough sideways travel, clearly more sideways than vertical. */
export const SWIPE_WHEEL_PX = 120
export const SWIPE_TOUCH_PX = 60
export const isSideways = (dx: number, dy: number) => Math.abs(dx) > 2 * Math.abs(dy)
