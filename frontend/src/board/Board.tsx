import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useQuery } from '@tanstack/react-query'
import { matches } from '../lib/keybinds'
import { AlarmClock, CalendarPlus, ListChecks, SquareCheck, Zap } from 'lucide-react'
import { memo, useMemo, useState, type DragEvent, type ReactNode } from 'react'
import { boardOptions, boardPosition, isCard, moveCard } from '../api/queries'
import type { Action, BoardColumn } from '../api/types'
import { openCard } from '../cards/cardBus'
import { hasFiles, uploadAll } from '../files/upload'
import { SOURCE_ICON } from '../cards/sourceIcon'
import { dueTag } from '../inbox/cardModel'
import { errorText, useInbox } from '../inbox/inboxContext'
import type { PickerAt } from '../inbox/ProjectPicker'
import { RemindPicker } from '../inbox/RemindPicker'
import { BOARD_COLUMNS, byColumn, cardDue } from '../projects/projectModel'
import { useMinuteClock } from '../shell/useMinuteClock'
// Tags, buttons and column states share the inbox's styles (also when /board is opened directly).
import '../inbox/inbox.css'
import './board.css'
import { carriesEmails, droppedEmails } from '../lib/dragEmails'

type Layout = Record<BoardColumn, string[]>

const ids = (cols: Record<BoardColumn, Action[]>): Layout => ({
  todo: cols.todo.map((a) => a.id),
  in_progress: cols.in_progress.map((a) => a.id),
  done: cols.done.map((a) => a.id),
})
const columnOf = (layout: Layout, id: string): BoardColumn | null =>
  (Object.keys(layout) as BoardColumn[]).find((k) => k === id || layout[k].includes(id)) ?? null

/**
 * The board (FR-ORC-007, task 10): To do · In progress · Done. A card lands in To do when a Jira issue or board card
 * is created; moves persist (PATCH /actions/:id) and arrive live in other tabs (action.updated). Drag with the
 * pointer, or with the keyboard: Space picks a card up, arrows move it, Space drops, Esc cancels (dnd-kit).
 * `project` shows only that project's cards (GET /actions?project=). A card with an email opens it in the drawer.
 */
export function Board({
  project,
  variant = 'full',
  label = 'Board',
  onEmailDrop,
}: {
  project?: string
  variant?: 'full' | 'tile'
  label?: string
  /** A project's board: emails dragged from a list onto a column (proposals §23). */
  onEmailDrop?: (ids: string[], column: BoardColumn) => void
}) {
  const { toast } = useInbox()
  const board = useQuery(boardOptions(project))
  const cols = useMemo(() => byColumn(board.data?.items ?? []), [board.data])
  const byId = useMemo(() => new Map((board.data?.items ?? []).map((a) => [a.id, a])), [board.data])
  // While dragging, the order the user sees; null otherwise (the cache's order).
  const [drag, setDrag] = useState<{ id: string; layout: Layout } | null>(null)
  const layout = drag?.layout ?? ids(cols)
  const sensors = useSensors(
    // A small distance, so a click still opens the card.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const onDragStart = ({ active }: DragStartEvent) => setDrag({ id: String(active.id), layout: ids(cols) })

  // Crossing into another column moves the card there in the preview, before it's dropped.
  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !drag) return
    const from = columnOf(drag.layout, String(active.id))
    const to = columnOf(drag.layout, String(over.id))
    if (!from || !to || from === to) return
    const next = { ...drag.layout, [from]: drag.layout[from].filter((x) => x !== active.id) }
    const at = next[to].indexOf(String(over.id))
    next[to] = [...next[to]]
    next[to].splice(at < 0 ? next[to].length : at, 0, String(active.id))
    setDrag({ ...drag, layout: next })
  }

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const current = drag
    setDrag(null)
    if (!current || !over) return
    const id = String(active.id)
    const card = byId.get(id)
    const column = columnOf(current.layout, String(over.id))
    if (!card || !column) return
    const list = [...current.layout[column]]
    const overIndex = list.indexOf(String(over.id))
    const from = list.indexOf(id)
    if (overIndex >= 0 && from >= 0 && overIndex !== from) list.splice(overIndex, 0, ...list.splice(from, 1))
    const at = list.indexOf(id)
    if (card.board_column === column && ids(cols)[column].indexOf(id) === at) return // dropped where it was
    // The card after it here (or the last before it), as the server knows them.
    const others = list.filter((x) => x !== id).map((x) => byId.get(x)!)
    const next = others[at] ?? null
    const position = boardPosition(card, column, next, next ? null : (others.at(-1) ?? null))
    moveCard(card, column, position).catch((err: unknown) => toast(errorText(err), 'error'))
  }

  const total = board.data?.items.length ?? 0
  return (
    <div className="board" data-variant={variant} aria-label={label} role="group">
      {board.isPending && <p className="col-state">Loading the board…</p>}
      {board.isError && (
        <p className="col-state" role="alert">
          Couldn't load the board. {errorText(board.error)}{' '}
          <button type="button" className="text-button" onClick={() => void board.refetch()}>
            Try again
          </button>
        </p>
      )}
      {board.isSuccess && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDrag(null)}
          accessibility={{ screenReaderInstructions: { draggable: 'To move a card, press Space, then the arrow keys. Space drops it, Escape cancels.' } }}
        >
          <div className="board-cols">
            {BOARD_COLUMNS.map((c) => (
              <BoardLane key={c.key} column={c.key} title={c.title} count={layout[c.key].length} empty={total === 0 && c.key === 'todo'} onEmailDrop={onEmailDrop}>
                <SortableContext id={c.key} items={layout[c.key]} strategy={verticalListSortingStrategy}>
                  {layout[c.key].map((id) => {
                    const a = byId.get(id)
                    return a ? <SortableCard key={id} action={a} column={c.key} dragging={drag?.id === id} /> : null
                  })}
                </SortableContext>
              </BoardLane>
            ))}
          </div>
          <DragOverlay dropAnimation={null}>{drag && byId.get(drag.id) ? <CardFace action={byId.get(drag.id)!} column={columnOf(drag.layout, drag.id) ?? 'todo'} lifted /> : null}</DragOverlay>
        </DndContext>
      )}
    </div>
  )
}

function BoardLane({ column, title, count, empty, onEmailDrop, children }: { column: BoardColumn; title: string; count: number; empty: boolean; onEmailDrop?: (ids: string[], column: BoardColumn) => void; children: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: column })
  const [emailOver, setEmailOver] = useState(false)
  const headId = `lane-${column}`
  // Emails come by native drag and drop (from any list), cards by dnd-kit; the two never mix.
  const emailDrop = onEmailDrop
    ? {
        onDragOver: (e: DragEvent) => {
          if (!carriesEmails(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setEmailOver(true)
        },
        onDragLeave: (e: DragEvent) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setEmailOver(false),
        onDrop: (e: DragEvent) => {
          if (!carriesEmails(e)) return
          e.preventDefault()
          setEmailOver(false)
          const ids = droppedEmails(e)
          if (ids.length) onEmailDrop(ids, column)
        },
      }
    : {}
  return (
    <section className="board-lane" data-column={column} data-over={isOver || emailOver || undefined} aria-labelledby={headId} {...emailDrop}>
      <h3 className="board-lane-head" id={headId}>
        {title} <span className="col-count">{count}</span>
      </h3>
      <ol className="board-list" ref={setNodeRef}>
        {children}
        {count === 0 && (
          <li className="board-empty" aria-hidden={!empty || undefined}>
            {empty ? 'Cards appear here when you send an email to Jira or add a board card.' : 'Drop cards here'}
          </li>
        )}
      </ol>
    </section>
  )
}

function SortableCard({ action, column, dragging }: { action: Action; column: BoardColumn; dragging: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: action.id })
  const { open, toast } = useInbox()
  // "Remind me" on a board card (19 Nov 2026): right-click, r, or the ⏰ button. An email's card reminds about the email.
  const [remind, setRemind] = useState<PickerAt | null>(null)
  const remindTarget = action.email_id ? { type: 'email' as const } : isCard(action) ? { type: 'card' as const, title: action.payload.title } : null
  const remindAt = (x: number, y: number) => remindTarget && setRemind({ ids: [action.email_id ?? action.id], x, y })
  // An email's card opens the email; a user card opens its sheet (FR-CNT-002).
  const openAction = (a: Action) => (a.email_id ? open(a.email_id) : isCard(a) ? openCard(a.id) : undefined)
  // FR-UI-028: files dropped from the desktop onto a card you made are attached to it.
  const [fileOver, setFileOver] = useState(false)
  const fileDrop = isCard(action)
    ? {
        onDragOver: (e: DragEvent) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          setFileOver(true)
        },
        onDragLeave: () => setFileOver(false),
        onDrop: (e: DragEvent) => {
          if (!hasFiles(e)) return
          e.preventDefault()
          setFileOver(false)
          const files = [...e.dataTransfer.files]
          void uploadAll({ type: 'card', id: action.id }, files).then((failed) =>
            toast(failed ? `${failed} of ${files.length} files couldn't be attached` : `Attached ${files.length === 1 ? files[0].name : `${files.length} files`}`, failed ? 'error' : 'info'),
          )
        },
      }
    : {}
  return (
    <li
      {...fileDrop}
      data-file-over={fileOver || undefined}
      ref={setNodeRef}
      className="board-item"
      data-dragging={dragging || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-roledescription="Board card"
      onClick={() => openAction(action)}
      onContextMenu={(e) => {
        if (!remindTarget) return
        e.preventDefault()
        remindAt(e.clientX, e.clientY)
      }}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e)
        if (e.defaultPrevented) return
        if (e.key === 'Enter') openAction(action)
        else if (matches(e, 'remind')) {
          const r = e.currentTarget.getBoundingClientRect()
          remindAt(r.left, r.bottom)
        }
      }}
    >
      <CardFace action={action} column={column} />
      {remindTarget && (
        <button
          type="button"
          className="board-remind"
          title="Remind me (r)"
          aria-keyshortcuts="r"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            const r = e.currentTarget.getBoundingClientRect()
            remindAt(r.left, r.bottom)
          }}
        >
          <AlarmClock size={14} aria-hidden="true" />
          <span className="sr-only">Remind me</span>
        </button>
      )}
      {remind && remindTarget && <RemindPicker at={remind} target={remindTarget} onClose={() => setRemind(null)} />}
    </li>
  )
}

const TYPE: Record<Action['type'], { icon: typeof Zap; label: string }> = {
  create_jira_issue: { icon: Zap, label: 'Jira issue' },
  add_calendar_event: { icon: CalendarPlus, label: 'Calendar event' },
  add_board_card: { icon: SquareCheck, label: 'Card' },
}

/** One card's face: type and Jira key, title, due date. The same in the list and while dragged. */
const CardFace = memo(function CardFace({ action, column, lifted = false }: { action: Action; column: BoardColumn; lifted?: boolean }) {
  const now = useMinuteClock()
  const user = isCard(action) ? action.payload : null
  const source = user?.source ? SOURCE_ICON[user.source] : null
  const { icon: Icon, label } = source ?? TYPE[action.type]
  const due = column === 'done' ? null : dueTag(cardDue(action), now)
  const list = user?.checklist ?? []
  return (
    <div className="board-card" data-lifted={lifted || undefined}>
      <span className="board-card-type">
        <Icon size={13} aria-hidden="true" />
        {action.external_ref ?? (user ? `${label}${user.person ? ` · ${user.person}` : ''}` : label)}
      </span>
      <span className="board-card-title">{action.payload.title ?? 'Untitled card'}</span>
      {(due || list.length > 0 || user?.urgency) && (
        <span className="board-card-tags">
          {due && (
            <span className="tag" data-tone={due.tone} title={due.label}>
              {due.text}
            </span>
          )}
          {user?.urgency && (user.urgency === 'Critical' || user.urgency === 'High') && (
            <span className="tag" data-tone={user.urgency === 'Critical' ? 'danger' : 'warn'}>
              {user.urgency}
            </span>
          )}
          {list.length > 0 && (
            <span className="tag" data-tone="muted" title="Checklist">
              <ListChecks size={12} aria-hidden="true" />
              {list.filter((i) => i.done).length}/{list.length}
            </span>
          )}
        </span>
      )}
    </div>
  )
})
