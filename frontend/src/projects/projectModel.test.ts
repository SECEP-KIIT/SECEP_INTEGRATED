// Task 10: the board's order and moves, and the project view's countdown and ring (FR-ORC-007, FR-UI-020).
import { describe, expect, it } from 'vitest'
import { boardPosition, placeCard } from '../api/queries'
import type { Action, BoardColumn } from '../api/types'
import { BOARD_PRESET, addWidget } from '../dashboard/layoutModel'
import { byColumn, cardDue, dayFromDeadline, deadlineFromDay, deadlineText, isOverdue, ringTone } from './projectModel'

const card = (id: string, column: BoardColumn | null, position: number | null, payload: Partial<Action['payload']> = {}, type: Action['type'] = 'add_board_card'): Action =>
  ({
    id, email_id: null, type, origin: 'decoder', status: 'done', payload: { title: id, description: null, priority: null, due_date: null, start: null, end: null, attendees: null, ...payload },
    board_column: column, board_position: position, external_ref: null, external_status: null, error: null,
    created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
  }) as Action

const order = (items: Action[], c: BoardColumn) => byColumn(items)[c].map((a) => a.id)
const NOW = new Date('2026-11-18T12:00:00+05:30')

describe('the board (FR-ORC-007)', () => {
  it('groups by column in position order and ignores cards off the board', () => {
    const items = [card('b', 'todo', 1), card('a', 'todo', 0), card('x', null, null), card('d', 'done', 0)]
    expect(byColumn(items)).toMatchObject({ todo: [{ id: 'a' }, { id: 'b' }], in_progress: [], done: [{ id: 'd' }] })
  })

  it("placeCard follows the server's arithmetic on a board that shows only some cards", () => {
    // The user's todo column is a0 b1 c2 d3; a project's board shows only a, c and d.
    const subset = [card('a', 'todo', 0), card('c', 'todo', 2), card('d', 'todo', 3), card('z', 'done', 0)]
    // Moving a to just before d: position = d's 3 minus 1 (a leaves from before it) = 2.
    const pos = boardPosition(subset[0], 'todo', subset[2], null)
    expect(pos).toBe(2)
    const moved = placeCard(subset, 'a', 'todo', pos)
    expect(order(moved, 'todo')).toEqual(['c', 'a', 'd'])
    // c and d keep the user's global positions, shifted as the server shifts them.
    expect(moved.find((x) => x.id === 'c')?.board_position).toBe(1)
    expect(moved.find((x) => x.id === 'd')?.board_position).toBe(3)
  })

  it('boardPosition: before a card, at the end, into an empty column', () => {
    const a = card('a', 'todo', 0)
    const b = card('b', 'in_progress', 4)
    const c = card('c', 'in_progress', 7)
    expect(boardPosition(a, 'in_progress', b, null)).toBe(4) // from another column: no shift
    expect(boardPosition(a, 'in_progress', null, c)).toBe(8)
    expect(boardPosition(b, 'in_progress', null, c)).toBe(7) // its own column, from before the last
    expect(boardPosition(a, 'done', null, null)).toBe(0)
  })

  it('a card is due on its Jira due date or its event day; overdue only while not done', () => {
    expect(cardDue(card('j', 'todo', 0, { due_date: '2026-11-17' }))).toBe('2026-11-17')
    expect(cardDue(card('e', 'todo', 0, { start: '2026-11-20T09:00:00+05:30' }, 'add_calendar_event'))).toBe('2026-11-20')
    expect(isOverdue(card('j', 'todo', 0, { due_date: '2026-11-17' }), NOW)).toBe(true)
    expect(isOverdue(card('j', 'done', 0, { due_date: '2026-11-17' }), NOW)).toBe(false)
    expect(isOverdue(card('j', 'todo', 0), NOW)).toBe(false)
  })

  it('the Board widget has no filter or sort (only inbox columns do)', () => {
    const page = addWidget({ id: 'p', name: 'P', order: 0, widgets: [] }, BOARD_PRESET)!
    expect(page.widgets[0]).toMatchObject({ type: 'board', filter: null, sort: null })
  })
})

describe('the project view (FR-UI-020)', () => {
  const at = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString()

  it('counts down in hours under two days, then in days; says when it passed', () => {
    expect(deadlineText(null, NOW)).toBeNull()
    expect(deadlineText(at(30), NOW)).toBe('30 hours left')
    expect(deadlineText(at(0.2), NOW)).toBe('1 hour left')
    expect(deadlineText(at(24 * 5), NOW)).toBe('5 days left')
    expect(deadlineText(at(-3), NOW)).toBe('Deadline passed today')
    expect(deadlineText(at(-50), NOW)).toBe('2 days past the deadline')
  })

  it('ring: red under 48 h with under 70 % done, else amber with overdue tasks, else ok', () => {
    const p = (deadline: string | null, done: number, total: number) => ({ deadline, progress: { done, total } })
    expect(ringTone(p(at(30), 1, 4), NOW)).toBe('red')
    expect(ringTone(p(at(30), 3, 4), NOW)).toBe('ok') // 75 %
    expect(ringTone(p(at(30), 0, 0), NOW)).toBe('red') // nothing done yet
    expect(ringTone(p(at(-5), 1, 4), NOW)).toBe('red') // passed
    expect(ringTone(p(at(100), 1, 4), NOW, 2)).toBe('amber')
    expect(ringTone(p(at(30), 1, 4), NOW, 2)).toBe('red') // red wins
    expect(ringTone(p(null, 0, 4), NOW, 0)).toBe('ok')
  })

  it('a date input day round-trips through the deadline (end of that day, local)', () => {
    expect(deadlineFromDay('')).toBeNull()
    expect(dayFromDeadline(deadlineFromDay('2026-11-21'))).toBe('2026-11-21')
    expect(dayFromDeadline(null)).toBe('')
  })
})
