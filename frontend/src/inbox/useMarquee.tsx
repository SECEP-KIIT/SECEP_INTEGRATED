import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useSelection } from './selection'

/** Marquee selection (FR-UI-027, item 8): press on empty space in a column and drag a box over cards. */
const THRESHOLD = 5 // px of movement before a press becomes a drag; less is a plain click on the background
const EDGE = 28 // px from the top or bottom edge where the column scrolls while dragging
const SCROLL_STEP = 14
// Pressing on any of these is not the start of a marquee (cards are draggable themselves, for projects).
const SKIP = '.card, button, a, input, select, textarea, label, [role="menuitem"]'

interface Drag {
  x0: number
  /** Where the press happened, in the list's own coordinates, so scrolling while dragging keeps the anchor. */
  cy0: number
  base: string[]
  additive: boolean
  active: boolean
}

interface Box {
  left: number
  top: number
  width: number
  height: number
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi)
const rowsTop = (el: HTMLElement) => el.querySelector('.col-rows')?.getBoundingClientRect().top ?? 0

/**
 * Pointer handlers for the column's scroll area plus the rectangle to render. Selects by row position (every row has
 * the same pitch), so it also works for rows the virtualised list hasn't drawn. Shift or Ctrl/⌘ adds to the current
 * selection; Esc during a drag puts the selection back.
 */
export function useMarquee(ids: readonly string[], pitch: number, enabled: boolean) {
  const selection = useSelection()
  const drag = useRef<Drag | null>(null)
  const [box, setBox] = useState<Box | null>(null)
  const latest = useRef({ ids, pitch, selection })
  latest.current = { ids, pitch, selection }

  const endDrag = (restore: boolean) => {
    const d = drag.current
    drag.current = null
    document.body.style.userSelect = ''
    setBox(null)
    if (!d) return
    const { selection: s } = latest.current
    if (restore && d.active) s.set(d.base)
    else if (!d.active && !d.additive) s.clear() // a plain click on the background
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !drag.current?.active) return
      e.stopPropagation()
      endDrag(true)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // endDrag reads only refs and a state setter.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startsOnEmpty = (e: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>) => {
    if (!enabled || e.button !== 0) return false
    if ('pointerType' in e && e.pointerType !== 'mouse') return false
    if ((e.target as Element).closest(SKIP)) return false
    const el = e.currentTarget
    return e.clientX - el.getBoundingClientRect().left <= el.clientWidth // not on the scrollbar
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!startsOnEmpty(e)) return
    const el = e.currentTarget
    const additive = e.shiftKey || e.ctrlKey || e.metaKey
    drag.current = { x0: e.clientX, cy0: e.clientY - rowsTop(el), base: additive ? [...selection.selected] : [], additive, active: false }
    el.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const el = e.currentTarget
    const r = el.getBoundingClientRect()
    if (!d.active) {
      if (Math.hypot(e.clientX - d.x0, e.clientY - (d.cy0 + rowsTop(el))) < THRESHOLD) return
      d.active = true
      document.body.style.userSelect = 'none'
    }
    if (e.clientY < r.top + EDGE) el.scrollTop -= SCROLL_STEP
    else if (e.clientY > r.bottom - EDGE) el.scrollTop += SCROLL_STEP
    const top = rowsTop(el)
    const x = clamp(e.clientX, r.left, r.left + el.clientWidth)
    const y = clamp(e.clientY, r.top, r.bottom)
    const cy1 = y - top
    const { ids: order, pitch: p } = latest.current
    const lo = Math.max(0, Math.floor(Math.min(d.cy0, cy1) / p))
    const hi = Math.min(order.length - 1, Math.floor(Math.max(d.cy0, cy1) / p))
    const hit = lo <= hi ? order.slice(lo, hi + 1) : []
    selection.set([...new Set([...d.base, ...hit])])
    const yA = clamp(d.cy0 + top, r.top, r.bottom)
    setBox({ left: Math.min(d.x0, x), top: Math.min(yA, y), width: Math.abs(x - d.x0), height: Math.abs(y - yA) })
  }

  const overlay =
    box &&
    createPortal(
      <div
        aria-hidden="true"
        className="marquee"
        style={{
          position: 'fixed',
          ...box,
          pointerEvents: 'none',
          zIndex: 50,
          borderRadius: 4,
          border: '1px solid var(--accent, #3b82f6)',
          background: 'color-mix(in srgb, var(--accent, #3b82f6) 14%, transparent)',
        }}
      />,
      document.body,
    )

  return {
    overlay,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: () => endDrag(false),
      onPointerCancel: () => endDrag(true),
      // Stops the browser starting a text selection from the press.
      onMouseDown: (e: MouseEvent<HTMLDivElement>) => {
        if (startsOnEmpty(e)) e.preventDefault()
      },
    },
  }
}
