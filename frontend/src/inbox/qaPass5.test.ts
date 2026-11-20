// QA pass 5: undo restores in place, project membership on cards, the Handled page, the board's local move.
import { QueryClient, QueryObserver, type InfiniteData } from '@tanstack/react-query'
import { beforeEach, describe, expect, it } from 'vitest'
import { placeCard, withProject } from '../api/queries'
import { arrivals, patchActionCache, settleLists } from '../api/realtime'
import type { Action, EmailListItem, LayoutPage, Page } from '../api/types'
import { addHandledPage, handledPage, MAX_PAGES } from '../dashboard/layoutModel'
import { createDb } from '../mocks/store/generate'
import { starterLayout } from '../mocks/starters'
import { toAction, toListItem } from '../mocks/store/serialize'
import { projectTag, splitDot } from './cardModel'

const db = createDb(Date.parse('2026-11-04T10:00:00Z'))
const items = [...db.emails.values()].filter((e) => e.user_id === db.users[0].id).slice(0, 4).map((e) => toListItem(db, e))
const KEY = ['emails', 'list', '']

describe('undo of Mark handled (QA pass 5)', () => {
  let qc: QueryClient
  beforeEach(() => {
    qc = new QueryClient()
    arrivals.clear()
    qc.setQueryData<InfiniteData<Page<EmailListItem>, unknown>>(KEY, { pages: [{ items: items.slice(1), next_cursor: null }], pageParams: [null] })
    // An observer: the list is on screen.
    new QueryObserver(qc, { queryKey: KEY, enabled: false }).subscribe(() => {})
  })

  it('a restore reloads the list in place instead of counting it in "↑ n new"', () => {
    const restored = { ...items[0], handled: false }
    settleLists(qc, restored, { restore: true })
    expect(arrivals.get()).toEqual([])
    expect(qc.getQueryState(KEY)?.isInvalidated).toBe(true)
  })

  it('a change from elsewhere still only counts in the pill', () => {
    settleLists(qc, { ...items[0], handled: false })
    expect(arrivals.get().map((a) => a.email.id)).toEqual([items[0].id])
  })
})

describe('projects on cards (FR-UI-017)', () => {
  const a = { id: 'a', name: 'Atlas', colour: '#111111' }
  const b = { id: 'b', name: 'Pune', colour: '#222222' }

  it('the first project is primary; removing the primary promotes the next; adding twice is a no-op', () => {
    const one = withProject([], a, true)
    expect(one).toEqual([{ ...a, is_primary: true }])
    const two = withProject(one, b, true)
    expect(two.map((r) => [r.id, r.is_primary])).toEqual([['a', true], ['b', false]])
    expect(withProject(two, b, true)).toEqual(two)
    expect(withProject(two, a, false)).toEqual([{ ...b, is_primary: true }])
  })

  it('tag: "Name +n", every name in the label, a split dot of at most 4 slices', () => {
    expect(projectTag([])).toBeNull()
    const refs = withProject(withProject([], a, true), b, true)
    expect(projectTag(refs)).toMatchObject({ kind: 'project', text: 'Atlas +1', label: 'Projects: Atlas (primary), Pune', colours: ['#111111', '#222222'] })
    expect(splitDot(['#111111'])).toBe('#111111')
    expect(splitDot(['#1', '#2', '#3', '#4', '#5'])).toBe('conic-gradient(#1 0% 25%, #2 25% 50%, #3 50% 75%, #4 75% 100%)')
  })

  it('seeded mail filed in projects shows them on its list item', () => {
    const filed = [...db.emails.values()].map((e) => toListItem(db, e)).find((e) => e.projects.length)
    expect(filed?.projects[0]).toMatchObject({ is_primary: true, colour: expect.stringMatching(/^#/) })
  })
})

describe('the Handled page (QA pass 5)', () => {
  it('is a starter page with only a full-width Handled column', () => {
    const page = handledPage(starterLayout('desktop').pages)!
    expect(page.name).toBe('Handled')
    expect(page.widgets).toHaveLength(1)
    expect(page.widgets[0]).toMatchObject({ filter: 'view=handled', size: 'large' })
  })

  it('a layout saved without one gets it added at the end; none at the page cap', () => {
    const pages: LayoutPage[] = [{ id: 'p1', name: 'Mine', order: 0, widgets: [] }]
    expect(handledPage(pages)).toBeNull()
    const next = addHandledPage(pages)!
    expect(handledPage(next)?.order).toBe(1)
    const full = Array.from({ length: MAX_PAGES }, (_, i) => ({ id: `p${i}`, name: `P${i}`, order: i, widgets: [] }))
    expect(addHandledPage(full)).toBeNull()
  })
})

describe('board cache (FR-ORC-007)', () => {
  const card = (id: string, column: Action['board_column'], position: number) =>
    ({ ...toAction([...db.actions.values()][0]), id, status: 'done', board_column: column, board_position: position }) as Action

  it('placeCard moves a card and renumbers both columns', () => {
    const board = [card('a', 'todo', 0), card('b', 'todo', 1), card('c', 'todo', 2), card('d', 'done', 0)]
    const moved = placeCard(board, 'b', 'done', 0)
    const col = (c: string) => moved.filter((x) => x.board_column === c).sort((x, y) => x.board_position! - y.board_position!).map((x) => x.id)
    expect(col('todo')).toEqual(['a', 'c'])
    expect(col('done')).toEqual(['b', 'd'])
    expect(placeCard(board, 'a', 'todo', 2).filter((x) => x.board_column === 'todo').sort((x, y) => x.board_position! - y.board_position!).map((x) => x.id)).toEqual(['b', 'c', 'a'])
  })

  it('a card joins the board when it lands in a column and leaves when undone', () => {
    const qc = new QueryClient()
    const BOARD = ['actions', 'board', null]
    qc.setQueryData<Page<Action>>(BOARD, { items: [], next_cursor: null })
    patchActionCache(qc, card('x', 'todo', 0))
    expect(qc.getQueryData<Page<Action>>(BOARD)!.items.map((a) => a.id)).toEqual(['x'])
    patchActionCache(qc, { ...card('x', null, 0), status: 'proposed', board_position: null })
    expect(qc.getQueryData<Page<Action>>(BOARD)!.items).toEqual([])
  })
})
