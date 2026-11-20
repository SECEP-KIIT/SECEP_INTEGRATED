import { memo, useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { startEmailDrag } from '../lib/dragEmails'
import type { EmailListItem } from '../api/types'
import type { Density, FilterPatch } from './cardModel'
import { CardBody } from './CardBody'
import { cardKeyAction, copySummary } from './cardKeys'
import { useInbox } from './inboxContext'
import { canLift, useLift, type LiftTarget } from './liftContext'
import { useQuickActions } from './quickActions'
import { columnOrder, useSelection } from './selection'

/** Long-press on touch opens the action menu (QA pass 3); moving this far first is a scroll, not a press. */
const LONG_PRESS_MS = 500
const MOVE_TOLERANCE = 10

interface Props {
  email: EmailListItem
  now: Date
  density: Density
  /** Arrived through the "↑ n new" pill: fades in with an accent tint for 2 s (item 9). */
  fresh: boolean
  onFilter: (patch: FilterPatch) => void
}

/**
 * A card in a column (FR-UI-011, item 3). Layer 1 is CardBody. Its height is fixed by its density (NFR-PERF-011):
 * every line truncates, and the summary and labels reserve their space while they load.
 *
 * Layer 2, desktop: the hover lift (CardLift). After the hover intent, or on keyboard focus, a floating copy shows
 * the quick actions above the card and every tag below it, in a portal; this card never changes. Touch has no lift:
 * a tap opens the drawer (FR-UI-009) and a long-press opens the action menu (TouchActions). Layer 3: a click, Enter or Space opens the side drawer (Space is the quick
 * preview, FR-UI-015). Buttons inside the card stop their clicks, so they never also open the drawer.
 */
export const EmailCard = memo(function EmailCard({ email, now, density, fresh, onFilter }: Props) {
  // Per card instance: the same email can sit in several columns on one dashboard page.
  const subjectId = useId()
  const { open, menu, toast, pickProject, pickRemind } = useInbox()
  const lift = useLift()
  const ref = useRef<HTMLElement>(null)
  const [leaving, setLeaving] = useState(false)
  const selection = useSelection()
  const selected = selection.selected.has(email.id)
  const quick = useQuickActions(email, setLeaving)
  // Touch long-press: the timer, where it started, and whether it fired (then the click that follows is swallowed).
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null)
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer)
    if (press.current && !press.current.fired) press.current = null
  }
  useEffect(() => () => cancelPress(), [])
  const filter = (patch: FilterPatch) => (e: ReactMouseEvent) => {
    e.stopPropagation()
    onFilter(patch)
  }
  const target = (): LiftTarget | null => (ref.current ? { el: ref.current, email, now, density, onFilter, onLeave: setLeaving } : null)

  // A live update while lifted shows in the lift too.
  useEffect(() => {
    const t = ref.current && { el: ref.current, email, now, density, onFilter, onLeave: setLeaving }
    if (t && lift?.isLifted(email.id)) lift.refresh(t)
  }, [lift, email, now, density, onFilter])

  const openMenuAtCard = () => {
    const r = ref.current?.getBoundingClientRect()
    if (r) menu(email, r.left + 16, r.top + 24)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    // FR-UI-028 keyboard: card keys from Settings (j/k, x, e, p, r, ⇧J by default), Ctrl/⌘+C, Shift+F10.
    const key = cardKeyAction(e)
    if (key) {
      e.preventDefault()
      lift?.hide()
      if (key === 'next' || key === 'prev') {
        const row = ref.current?.closest<HTMLElement>('[data-pos]')
        const pos = Number(row?.dataset.pos) + (key === 'next' ? 1 : -1)
        const find = (p: number) => row?.parentElement?.querySelector<HTMLElement>(`[data-pos="${p}"] .card`)
        const to = find(pos)
        to?.focus()
        to?.scrollIntoView({ block: 'nearest' })
      } else if (key === 'select') selection.toggle(email.id)
      else if (key === 'done') void quick.toggleHandled()
      else if (key === 'jira') void quick.send('create_jira_issue')
      else if (key === 'copy') copySummary(email, toast)
      else if (key === 'project') {
        const r = ref.current?.getBoundingClientRect()
        const ids = selection.selected.has(email.id) ? [...selection.selected] : [email.id]
        if (r) pickProject(ids, r.left + 16, r.top + 24)
      } else if (key === 'remind') {
        const r = ref.current?.getBoundingClientRect()
        const ids = selection.selected.has(email.id) ? [...selection.selected] : [email.id]
        if (r) pickRemind(ids, r.left + 16, r.top + 24)
      }
      else openMenuAtCard()
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      lift?.hide()
      open(email.id)
    } else if (e.key === 'Tab' && !e.shiftKey && lift?.isLifted(email.id) && lift.enterBar()) {
      // Tab goes to the lifted quick actions next, then on through the card (CardLift).
      e.preventDefault()
    }
  }

  return (
    <article
      ref={ref}
      className="card"
      data-density={density}
      data-fresh={fresh || undefined}
      data-leaving={leaving || undefined}
      data-selected={selected || undefined}
      aria-selected={selection.selected.size > 0 ? selected : undefined}
      aria-labelledby={subjectId}
      aria-describedby="card-hint"
      tabIndex={0}
      onClick={(e) => {
        if (press.current?.fired) {
          press.current = null
          return
        }
        // FR-UI-027: Ctrl/⌘+click toggles, Shift+click selects a range in this column; a plain click opens the
        // drawer and ends any selection.
        if (e.ctrlKey || e.metaKey) return selection.toggle(email.id)
        if (e.shiftKey) return selection.range(email.id, columnOrder(ref.current))
        selection.clear()
        lift?.hide()
        open(email.id)
      }}
      // Shift+click would otherwise select the text between the two cards.
      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
      onPointerDown={(e) => {
        if (e.pointerType !== 'touch' || !lift) return
        const start = { x: e.clientX, y: e.clientY, fired: false, timer: 0 }
        start.timer = window.setTimeout(() => {
          const t = target()
          if (!t) return
          start.fired = true
          lift.menu(t)
        }, LONG_PRESS_MS)
        press.current = start
      }}
      onPointerMove={(e) => {
        const p = press.current
        if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE) cancelPress()
      }}
      onPointerUp={cancelPress}
      onPointerCancel={cancelPress}
      // Touch: the browser's own long-press menu would cover ours. Mouse: our card menu (FR-UI-028), except on links,
      // which keep the browser's menu.
      onContextMenu={(e) => {
        if (press.current) return e.preventDefault()
        if ((e.target as HTMLElement).closest('a[href]')) return
        e.preventDefault()
        lift?.hide()
        menu(email, e.clientX, e.clientY)
      }}
      onKeyDown={onKeyDown}
      // FR-UI-028: drag onto a sidebar project to add it; a selected card carries the whole selection.
      draggable
      onDragStart={(e) => {
        lift?.hide()
        startEmailDrag(e, selection.selected.has(email.id) ? [...selection.selected] : [email.id])
      }}
      onPointerEnter={(e) => {
        const t = e.pointerType === 'mouse' && canLift() ? target() : null
        if (t) lift?.enter(t)
      }}
      onPointerLeave={(e) => e.pointerType === 'mouse' && lift?.leave()}
      onFocus={(e) => {
        // Keyboard focus on the card itself lifts it; focus on a button inside it shows that button instead.
        const t = e.target === e.currentTarget && e.currentTarget.matches(':focus-visible') && canLift() ? target() : null
        if (t) lift?.focus(t)
        else if (lift?.isLifted(email.id)) lift.hide()
      }}
      onBlur={(e) => {
        if (e.target === e.currentTarget) lift?.blur(email.id, e.relatedTarget)
      }}
    >
      <CardBody email={email} now={now} subjectId={subjectId} filter={filter} />
    </article>
  )
})
