import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type MutableRefObject, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cardTags, type FilterPatch } from './cardModel'
import { CardActions } from './CardActions'
import { CardBody, Tag } from './CardBody'
import { TouchActions } from './TouchActions'
import { LiftContext, placeLift, type LiftApi, type LiftPlace, type LiftTarget } from './liftContext'

/** Hover intent before a card lifts (item 3, the same 150 ms as every hover reveal). */
const HOVER_INTENT_MS = 150
/** Grace for moving the pointer between the card and its bar or tags. */
const LEAVE_GRACE_MS = 120
const GAP = 4
const MARGIN = 8
const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The hover lift (FR-UI-011 layer 2, QA pass 3), one per inbox page. On hover after the intent delay, or keyboard
 * focus, the card lifts into a floating copy in a portal: Jira · Calendar · Done · ⋯ above it, and the copy's own tag
 * strip opens to show every tag (F13), so the copy grows downwards over the cards below.
 *
 * - The copy covers its neighbours but never pushes them; the card in the list never changes (NFR-PERF-011).
 * - The portal sits outside the virtual list's scroller, so nothing clips it. The bar and the tags flip to the
 *   other side when there's no room.
 * - The raised card itself lets the pointer through: clicks and wheel scrolling still reach the real card and its
 *   column. Any scroll or resize drops the lift.
 * - Keyboard: Tab from a focused card enters the bar; Tab past it continues after the card; Shift+Tab returns to the
 *   card; Esc closes the bar.
 */
export function CardLiftProvider({ children }: { children: ReactNode }) {
  const [lifted, setLifted] = useState<{ target: LiftTarget; rect: DOMRect } | null>(null)
  const [menu, setMenu] = useState<LiftTarget | null>(null)
  const current = useRef<LiftTarget | null>(null)
  const showTimer = useRef(0)
  const hideTimer = useRef(0)
  const root = useRef<HTMLDivElement | null>(null)

  // Drops the hover lift only. Pointer and scroll timers use this, so they never close the touch menu.
  const drop = useCallback(() => {
    clearTimeout(showTimer.current)
    clearTimeout(hideTimer.current)
    current.current = null
    setLifted(null)
  }, [])
  // Drops the lift and the touch menu (opening the drawer, a new menu).
  const hide = useCallback(() => {
    drop()
    setMenu(null)
  }, [drop])
  const show = useCallback((target: LiftTarget) => {
    clearTimeout(showTimer.current)
    clearTimeout(hideTimer.current)
    if (!target.el.isConnected) return
    current.current = target
    setLifted({ target, rect: target.el.getBoundingClientRect() })
  }, [])

  const api = useMemo<LiftApi>(
    () => ({
      enter(target) {
        clearTimeout(hideTimer.current)
        if (current.current?.email.id === target.email.id) return
        clearTimeout(showTimer.current)
        showTimer.current = window.setTimeout(() => show(target), HOVER_INTENT_MS)
      },
      leave() {
        clearTimeout(showTimer.current)
        clearTimeout(hideTimer.current)
        hideTimer.current = window.setTimeout(drop, LEAVE_GRACE_MS)
      },
      focus: show,
      blur(id, next) {
        if (current.current?.email.id !== id || (next instanceof Node && root.current?.contains(next))) return
        drop()
      },
      refresh(target) {
        if (current.current?.email.id !== target.email.id) return
        current.current = target
        setLifted((l) => l && { ...l, target })
      },
      isLifted: (id) => current.current?.email.id === id,
      menu(target) {
        hide()
        setMenu(target)
      },
      enterBar() {
        const first = root.current?.querySelector<HTMLElement>('.lift-bar button:not([disabled])')
        first?.focus()
        return !!first
      },
      hide,
    }),
    [hide, drop, show],
  )

  // The lift is placed for one scroll position and one window size.
  useEffect(() => {
    if (!lifted) return
    const onMove = (e: Event) => {
      if (e.type === 'scroll' && e.target instanceof Node && root.current?.contains(e.target)) return
      drop()
    }
    addEventListener('scroll', onMove, true)
    addEventListener('resize', onMove)
    return () => {
      removeEventListener('scroll', onMove, true)
      removeEventListener('resize', onMove)
    }
  }, [lifted, drop])

  return (
    <LiftContext.Provider value={api}>
      {children}
      {lifted &&
        createPortal(
          <Lift
            key={lifted.target.email.id}
            target={lifted.target}
            rect={lifted.rect}
            rootRef={root}
            onPointerEnter={() => clearTimeout(hideTimer.current)}
            onPointerLeave={api.leave}
            onClose={hide}
          />,
          document.body,
        )}
      {menu && <TouchActions key={menu.email.id} target={menu} onClose={() => setMenu(null)} />}
    </LiftContext.Provider>
  )
}


function Lift({ target, rect, rootRef, onPointerEnter, onPointerLeave, onClose }: {
  target: LiftTarget
  rect: DOMRect
  rootRef: MutableRefObject<HTMLDivElement | null>
  onPointerEnter: () => void
  onPointerLeave: () => void
  onClose: () => void
}) {
  const { email, now, density, el } = target
  const tags = cardTags(email, now)
  const barRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<(LiftPlace & { top: number }) | null>(null)

  // The copy grows down by its opened tag strip; near the bottom of the window it moves up instead. The bar goes
  // above the copy, or below it where there's no room.
  useLayoutEffect(() => {
    const barH = barRef.current?.offsetHeight ?? 0
    const h = cardRef.current?.offsetHeight ?? rect.height
    const top = Math.max(MARGIN, Math.min(rect.top, innerHeight - MARGIN - h))
    setPlace({ ...placeLift({ top, bottom: top + h }, barH, 0, innerHeight, GAP, MARGIN), top })
  }, [rect, tags.length])

  const filter = (p: FilterPatch) => (e: MouseEvent) => {
    e.stopPropagation()
    target.onFilter(p)
  }

  // Keyboard inside the bar: Tab past the end continues after the card, Shift+Tab before the start returns to it.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      el.focus()
      return
    }
    if (e.key !== 'Tab') return
    const items = [...(rootRef.current?.querySelectorAll<HTMLElement>(TABBABLE) ?? [])]
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.shiftKey && i === 0) {
      e.preventDefault()
      el.focus()
    } else if (!e.shiftKey && i === items.length - 1) {
      e.preventDefault()
      onClose()
      nextTabbable(el)?.focus()
    }
  }

  return (
    <div
      ref={rootRef}
      className="card-lift"
      data-placed={place ? '' : undefined}
      style={{ left: rect.left, top: place?.top ?? rect.top, width: rect.width }}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        if (!(e.relatedTarget instanceof Node) || (!e.currentTarget.contains(e.relatedTarget) && e.relatedTarget !== el)) onClose()
      }}
    >
      {/* First in the DOM, so Tab from the card reaches the actions before the tags. */}
      <div
        ref={barRef}
        className="lift-bar"
        data-place={place?.bar ?? 'above'}
        onPointerEnter={onPointerEnter}
        onPointerLeave={onPointerLeave}
      >
        <CardActions email={email} onLeave={(leaving) => (target.onLeave(leaving), leaving && onClose())} />
      </div>
      {/* The raised copy: looks like the card and lets the pointer through to it; only its opened tags take clicks. */}
      <div className="card lift-card" data-density={density} ref={cardRef} style={{ minHeight: rect.height }}>
        <div className="lift-body" aria-hidden="true" ref={(n) => n?.setAttribute('inert', '')}>
          <CardBody email={email} now={now} subjectId={undefined} filter={filter} tags={false} />
        </div>
        {tags.length > 0 && (
          <ul className="tag-row lift-tags" aria-label="All tags" onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
            {tags.map((t) => (
              <li key={t.kind}>
                <Tag tag={t} onFilter={filter} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

/** The element Tab would reach after `el`, as if the lift weren't there (its own buttons first, then onwards). */
function nextTabbable(el: HTMLElement): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>(TABBABLE)].filter((n) => !n.closest('.card-lift') && n.offsetParent !== null)
  const after = all.filter((n) => el.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING)
  return after[0] ?? null
}
