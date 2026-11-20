// Projects and the board (FR-ORC-007, FR-UI-016/020, task 10): pure helpers, so they can be tested without a DOM.
import type { Action, BoardColumn, Project } from '../api/types'
import { daysUntil } from '../inbox/cardModel'

export const BOARD_COLUMNS: { key: BoardColumn; title: string }[] = [
  { key: 'todo', title: 'To do' },
  { key: 'in_progress', title: 'In progress' },
  { key: 'done', title: 'Done' },
]

/** The board's cards per column, in board_position order (FR-ORC-007). */
export function byColumn(items: readonly Action[]): Record<BoardColumn, Action[]> {
  const out: Record<BoardColumn, Action[]> = { todo: [], in_progress: [], done: [] }
  for (const a of items) if (a.board_column) out[a.board_column].push(a)
  for (const k of Object.keys(out) as BoardColumn[]) out[k].sort((a, b) => (a.board_position ?? 0) - (b.board_position ?? 0) || a.created_at.localeCompare(b.created_at))
  return out
}

/** A card's due date: the Jira due date, or the day a calendar event starts. YYYY-MM-DD or null. */
export function cardDue(a: Pick<Action, 'payload' | 'type'>): string | null {
  if (a.payload.due_date) return a.payload.due_date
  const start = 'start' in a.payload ? a.payload.start : null
  return a.type === 'add_calendar_event' && start ? start.slice(0, 10) : null
}

/** Not done and past its due date: what turns a project's ring amber (FR-UI-020). */
export const isOverdue = (a: Action, now: Date) => {
  const due = cardDue(a)
  return a.board_column !== 'done' && due !== null && daysUntil(due, now) < 0
}

const HOUR = 3_600_000

/** The project view's deadline countdown (FR-UI-020): hours under two days, then days. */
export function deadlineText(deadline: string | null, now: Date): string | null {
  if (!deadline) return null
  const ms = Date.parse(deadline) - now.getTime()
  if (ms < 0) {
    const days = Math.floor(-ms / (24 * HOUR))
    return days < 1 ? 'Deadline passed today' : `${days} ${days === 1 ? 'day' : 'days'} past the deadline`
  }
  if (ms < 48 * HOUR) {
    const h = Math.max(1, Math.round(ms / HOUR))
    return `${h} ${h === 1 ? 'hour' : 'hours'} left`
  }
  const days = Math.round(ms / (24 * HOUR))
  return `${days} days left`
}

export type RingTone = 'ok' | 'amber' | 'red'

/**
 * FR-UI-020: red when the deadline is under 48 h away (or passed) with progress under 70 %; else amber when any
 * task is overdue; else the project's own colour. `overdue` is unknown (undefined) where the cards aren't loaded,
 * e.g. the sidebar: then only the deadline rule applies.
 */
export function ringTone(p: Pick<Project, 'deadline' | 'progress'>, now: Date, overdue?: number): RingTone {
  const pct = p.progress.total ? p.progress.done / p.progress.total : 0
  if (p.deadline && Date.parse(p.deadline) - now.getTime() < 48 * HOUR && pct < 0.7) return 'red'
  if (overdue) return 'amber'
  return 'ok'
}

/** The ring's stroke for a tone: the project colour, or the warning colours (never colour alone: see the label). */
export const toneColour = (tone: RingTone, colour: string) => (tone === 'red' ? 'var(--ring-red)' : tone === 'amber' ? 'var(--ring-amber)' : colour)

export const toneLabel = (tone: RingTone) => (tone === 'red' ? 'At risk: deadline close' : tone === 'amber' ? 'Tasks overdue' : null)

/** Swatches offered for a new project (any #rrggbb is valid on the wire). */
export const PROJECT_COLOURS = ['#3b5bdb', '#1971c2', '#0c8599', '#2b8a3e', '#5c940d', '#e67700', '#e8590c', '#c92a2a', '#a61e4d', '#862e9c', '#5f3dc4', '#495057']

/** A date input's YYYY-MM-DD as the end of that day in the user's time zone, ISO (projects.deadline is timestamptz). */
export function deadlineFromDay(day: string): string | null {
  if (!day) return null
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d, 23, 59, 0).toISOString()
}

/** The other way, for the edit form. */
export function dayFromDeadline(deadline: string | null): string {
  if (!deadline) return ''
  const t = new Date(deadline)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}
