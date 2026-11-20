// Task 8a: breakpoints, grid geometry, layout edits, page keys, and GET/PUT /layouts against the real mock.
import { setupServer } from 'msw/node'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { layoutOptions, putLayout, queryClient } from '../api/queries'
import type { Layout, LayoutPage, Widget } from '../api/types'
import { filterQuery, NO_FILTERS, parseColumnQuery } from '../inbox/cardModel'
import { deviceClassOf } from '../lib/breakpoints'
import { addDays, inDueBucket, matchesDue } from '../lib/due'
import { control } from '../mocks/control'
import { handlers } from '../mocks/handlers'
import { filterError } from '../mocks/routes/emails'
import { signIn } from '../mocks/session'
import { STARTERS, starterLayout } from '../mocks/starters'
import { db, initStore } from '../mocks/store/db'
import { fromPlaced, load, SCHEMA_VERSION, STORAGE_KEY, type PlacedWidget } from '../mocks/store/persist'
import { flow, rowCount } from './grid'
import {
  addPage,
  addWidget,
  BUILT_TYPES,
  COLUMN_PRESETS,
  duplicateWidget,
  fullViewHref,
  MAX_PAGES,
  MAX_WIDGETS,
  movePage,
  moveWidget,
  removePage,
  removeWidget,
  reorderWidget,
  resizeWidget,
  restorePage,
  slots,
  stackTargetBefore,
  stackWidget,
  unstackWidget,
} from './layoutModel'
import { pageKeyAction } from './pageKeys'

describe('the one breakpoint constant', () => {
  it('phone ≤ 640, tablet 641–1023, desktop ≥ 1024', () => {
    expect(deviceClassOf(360)).toBe('phone')
    expect(deviceClassOf(640)).toBe('phone')
    expect(deviceClassOf(641)).toBe('tablet')
    expect(deviceClassOf(1023)).toBe('tablet')
    expect(deviceClassOf(1024)).toBe('desktop')
  })

  it('no stylesheet has its own width media query (they select on html[data-device])', () => {
    const css = import.meta.glob<string>('../**/*.css', { query: '?raw', import: 'default', eager: true })
    expect(Object.keys(css).length).toBeGreaterThan(3)
    for (const [p, text] of Object.entries(css)) expect(text, p).not.toMatch(/@media[^{]*(max|min)-width/)
  })
})

const widget = (patch: Partial<Widget>): Widget => ({
  id: crypto.randomUUID(), type: 'inbox_column', size: 'small', hidden: false, stacked: false, title: null, colour: null, icon: null, filter: '', sort: null, density: null, ...patch,
})
const pageOf = (widgets: Widget[]): LayoutPage => ({ id: crypto.randomUUID(), name: 'P', order: 0, widgets })

describe('flow geometry (proposals §16.3)', () => {
  it('tiles fill rows of 3 slots left to right; one that does not fit the rest of a row starts the next', () => {
    expect(flow(['small', 'small', 'small', 'small'])).toEqual([{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 1, col: 0 }])
    // medium after small fits (1 + 2); large after small doesn't, so it starts row 1 and pushes the next tile down.
    expect(flow(['small', 'medium', 'small'])).toEqual([{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 1, col: 0 }])
    expect(flow(['small', 'large', 'small'])).toEqual([{ row: 0, col: 0 }, { row: 1, col: 0 }, { row: 2, col: 0 }])
    expect(rowCount([])).toBe(0)
    expect(rowCount(['medium', 'medium'])).toBe(2)
  })
})

describe('layout edits', () => {
  it('pages: at most 9, at least 1, reorderable', () => {
    let pages: LayoutPage[] = [pageOf([])]
    for (let i = 1; i < MAX_PAGES; i++) pages = addPage(pages)!
    expect(pages).toHaveLength(MAX_PAGES)
    expect(addPage(pages)).toBeNull()
    const one = [pageOf([])]
    expect(removePage(one, one[0].id)).toBe(one)
    const two = addPage(one)!
    const moved = movePage(two, two[1].id, -1)
    expect(moved.find((p) => p.id === two[1].id)!.order).toBe(0)
  })

  it('a deleted page comes back where it was (undo, FR-UI-029 pattern)', () => {
    const pages = addPage(addPage([pageOf([])])!)!
    const middle = pages[1]
    const after = removePage(pages, middle.id)
    expect(after.map((p) => p.order)).toEqual([0, 1])
    const back = restorePage(after, middle)!
    expect(back.map((p) => p.id)).toEqual(pages.map((p) => p.id))
    expect(back.map((p) => p.order)).toEqual([0, 1, 2])
    expect(restorePage(back, middle)).toBeNull() // already there
  })

  it('dragging: same-size tiles swap; a different size takes the place and the rest move one along', () => {
    const [a, b, c, d] = [widget({ size: 'small' }), widget({ size: 'medium' }), widget({ size: 'small' }), widget({ size: 'large' })]
    const page = pageOf([a, b, c, d])
    const ids = (p: LayoutPage) => p.widgets.map((w) => w.id)
    expect(ids(reorderWidget(page, a.id, c.id))).toEqual([c.id, b.id, a.id, d.id]) // small ↔ small: swap
    expect(ids(reorderWidget(page, d.id, b.id))).toEqual([a.id, d.id, b.id, c.id]) // large onto medium: insert
    expect(ids(reorderWidget(page, a.id, d.id))).toEqual([b.id, c.id, d.id, a.id]) // small onto large, later in order
    expect(reorderWidget(page, a.id, a.id)).toBe(page) // its own place: nothing to save
  })

  it('phone sheet: a section moves to another place and the rest close up; hiding keeps its place', () => {
    const [a, b, c] = [widget({ title: 'A' }), widget({ title: 'B' }), widget({ title: 'C' })]
    const page = pageOf([a, b, c])
    expect(moveWidget(page, 0, 2).widgets.map((w) => w.title)).toEqual(['B', 'C', 'A'])
    expect(moveWidget(page, 2, 0).widgets.map((w) => w.title)).toEqual(['C', 'A', 'B'])
    expect(moveWidget(page, 1, 1)).toBe(page)
    expect(moveWidget(page, 0, 5)).toBe(page)
  })

  it('adding and duplicating append in order, up to the cap', () => {
    const one = addWidget(pageOf([]), COLUMN_PRESETS[0])!
    expect(one.widgets[0]).toMatchObject({ size: 'small', hidden: false, title: 'Inbox' })
    const two = addWidget(one, COLUMN_PRESETS[1], 'large')!
    const dup = duplicateWidget(two, one.widgets[0].id)!
    expect(dup.widgets.map((w) => w.title)).toEqual(['Inbox', 'Inbox', 'Unread'])
    expect(new Set(dup.widgets.map((w) => w.id)).size).toBe(3)
    const full = pageOf(Array.from({ length: MAX_WIDGETS }, () => widget({})))
    expect(addWidget(full, COLUMN_PRESETS[0])).toBeNull()
    expect(duplicateWidget(full, full.widgets[0].id)).toBeNull()
  })

  it('a layout saved before §16.3 converts: sorted by y, then x, sized by width (store schema 4 → 5)', () => {
    const placed = (x: number, y: number, w: number, h: number, title: string): PlacedWidget => {
      const { size: _s, hidden: _h, stacked: _k, ...rest } = widget({ title })
      return { ...rest, x, y, w, h }
    }
    const grid = fromPlaced([placed(8, 0, 4, 12, 'C'), placed(0, 12, 12, 6, 'D'), placed(0, 0, 8, 12, 'A')], false)
    expect(grid.map((w) => [w.title, w.size])).toEqual([['A', 'medium'], ['C', 'small'], ['D', 'large']])
    expect(grid.every((w) => w.hidden === false && !('x' in w))).toBe(true)
    const phone = fromPlaced([placed(1, 2, 1, 1, 'S'), placed(0, 0, 2, 2, 'L'), placed(0, 2, 1, 1, 'R'), placed(0, 3, 2, 1, 'M')], true)
    expect(phone.map((w) => [w.title, w.size])).toEqual([['L', 'large'], ['R', 'small'], ['S', 'small'], ['M', 'medium']])

    // A version 4 store is migrated on load, not discarded.
    const v4 = { schema: 4, seed: 42, data: { users: [], actions: [], arrivals: [], reads: {}, handled: {}, settings: { jira: {} }, layouts: { u1: { desktop: { updated_at: '2026-11-02T10:00:00.000Z', pages: [{ id: 'p', name: 'P', order: 0, widgets: [placed(4, 0, 4, 12, 'Second'), placed(0, 0, 4, 12, 'First')] }] } } } } }
    const storage = { getItem: (k: string) => (k === STORAGE_KEY ? JSON.stringify(v4) : null), removeItem: vi.fn() }
    const snap = load(storage, 42)!
    expect(snap.schema).toBe(SCHEMA_VERSION)
    expect(snap.data.layouts.u1.desktop!.pages[0].widgets.map((w) => w.title)).toEqual(['First', 'Second'])
    expect(storage.removeItem).not.toHaveBeenCalled()
    expect(snap.data.layouts.u1.desktop!.pages[0].widgets.every((w) => w.stacked === false)).toBe(true)

    // A version 5 store (before F18) gains stacked: false on every widget.
    const v5 = { ...v4, schema: 5, data: { ...v4.data, layouts: { u1: { desktop: { updated_at: '2026-11-02T10:00:00.000Z', pages: [{ id: 'p', name: 'P', order: 0, widgets: [{ ...widget({ title: 'Old' }), stacked: undefined }] }] } } } } }
    const s5 = load({ getItem: () => JSON.stringify(v5), removeItem: vi.fn() }, 42)!
    expect(s5.schema).toBe(SCHEMA_VERSION)
    expect(s5.data.layouts.u1.desktop!.pages[0].widgets[0]).toMatchObject({ title: 'Old', stacked: false })
  })

  it('stacks (F18): two per slot, equal size; pairs move, resize and split as one slot', () => {
    const [a, b, c] = [widget({ title: 'A', size: 'small' }), widget({ title: 'B', size: 'medium' }), widget({ title: 'C', size: 'small' })]
    const page = pageOf([a, b, c])
    const titles = (p: LayoutPage) => slots(p.widgets).map((s) => s.map((w) => w.title).join('+'))

    // B under A takes A's width; C can't join the full pair.
    const ab = stackWidget(page, b.id, a.id)
    expect(titles(ab)).toEqual(['A+B', 'C'])
    expect(ab.widgets.map((w) => [w.title, w.size, w.stacked])).toEqual([['A', 'small', false], ['B', 'small', true], ['C', 'small', false]])
    expect(stackWidget(ab, c.id, a.id)).toBe(ab)
    expect(stackTargetBefore(ab, c.id)).toBeNull()
    expect(stackTargetBefore(page, b.id)).toBe(a.id)

    // Resizing either resizes the slot; the pair moves as one; dragging B out leaves A behind.
    expect(resizeWidget(ab, b.id, 'large').widgets.map((w) => w.size)).toEqual(['large', 'large', 'small'])
    expect(titles(reorderWidget(ab, a.id, c.id))).toEqual(['C', 'A+B'])
    expect(titles(reorderWidget(ab, b.id, c.id))).toEqual(['A', 'C', 'B'])
    expect(reorderWidget(ab, b.id, a.id)).toBe(ab)

    // Removing either gives the other the slot back, never joining the slot before.
    const cab = stackWidget(pageOf([c, a, b]), b.id, a.id)
    expect(titles(removeWidget(cab, a.id))).toEqual(['C', 'B'])
    expect(removeWidget(cab, a.id).widgets.every((w) => !w.stacked)).toBe(true)
    expect(titles(removeWidget(cab, b.id))).toEqual(['C', 'A'])
    expect(titles(unstackWidget(cab, b.id))).toEqual(['C', 'A', 'B'])
    expect(titles(duplicateWidget(cab, a.id)!)).toEqual(['C', 'A+B', 'A'])
  })

  it('a column filter is the GET /emails vocabulary, both ways; ⤢ links with it', () => {
    const filters = { ...NO_FILTERS, view: ['due_today' as const], urgency: ['Critical' as const, 'High' as const], sender: 'contoso-client.example' }
    expect(filterQuery(filters)).toBe('view=due_today&urgency=Critical,High&sender=contoso-client.example')
    expect(parseColumnQuery(filterQuery(filters)).filters).toEqual(filters)
    expect(fullViewHref({ filter: 'view=overdue', sort: 'urgency' })).toBe('/inbox?view=overdue&sort=urgency')
    for (const p of COLUMN_PRESETS) expect(filterError(p.filter), p.key).toBeNull()
    const more = { ...NO_FILTERS, due: ['overdue' as const, 'next_7_days' as const], needs_review: true }
    expect(filterQuery(more)).toBe('due=overdue,next_7_days&needs_review=true')
    expect(parseColumnQuery(filterQuery(more)).filters).toEqual(more)
    expect(filterError('due=next_7_days&needs_review=true')).toBeNull()
    expect(filterError('due=soon')).not.toBeNull()
  })
})

describe('due buckets (proposals §15.1)', () => {
  it('next_7_days is a rolling 7 days from today; later is after it; none is no due date', () => {
    const today = '2026-11-02'
    expect(addDays(today, 6)).toBe('2026-11-08')
    expect(addDays('2026-12-28', 6)).toBe('2027-01-03')
    expect(inDueBucket('2026-11-01', 'overdue', today)).toBe(true)
    expect(inDueBucket(today, 'today', today)).toBe(true)
    expect(inDueBucket(today, 'next_7_days', today)).toBe(true)
    expect(inDueBucket('2026-11-08', 'next_7_days', today)).toBe(true)
    expect(inDueBucket('2026-11-09', 'next_7_days', today)).toBe(false)
    expect(inDueBucket('2026-11-09', 'later', today)).toBe(true)
    expect(inDueBucket(null, 'none', today)).toBe(true)
    expect(inDueBucket(null, 'overdue', today)).toBe(false)
    expect(matchesDue('2026-11-01', [], today)).toBe(true)
    expect(matchesDue('2026-11-01', ['today', 'overdue'], today)).toBe(true)
  })
})

describe('page keys (FR-UI-007)', () => {
  const key = (k: string, extra: object = {}) => ({ key: k, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, target: null, ...extra })
  it('Ctrl+←/→ and Ctrl+1…9; never while typing or inside a dialog', () => {
    expect(pageKeyAction(key('ArrowRight'), 3)).toEqual({ by: 1 })
    expect(pageKeyAction(key('2'), 3)).toEqual({ to: 1 })
    expect(pageKeyAction(key('5'), 3)).toBeNull()
    expect(pageKeyAction(key('ArrowLeft', { ctrlKey: false }), 3)).toBeNull()
    expect(pageKeyAction(key('ArrowLeft', { target: { tagName: 'INPUT' } }), 3)).toBeNull()
    expect(pageKeyAction(key('ArrowLeft', { target: { tagName: 'DIV', closest: () => ({}) } }), 3)).toBeNull()
  })
})

// ── GET / PUT /layouts/:deviceClass against the mock ─────────────────────────────────────────────────────────

vi.stubGlobal('location', new URL('http://localhost/'))
const server = setupServer(...handlers)
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  initStore({ persistEnabled: false })
  control.latency = [0, 0]
  signIn(db.users[0].id)
  queryClient.clear()
})

const get = (dc: string) => queryClient.fetchQuery({ ...layoutOptions(dc as 'desktop'), staleTime: 0 })
const fails = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (err) {
    return err as ApiError
  }
  throw new Error('expected a failure')
}

describe('layouts API (proposals §13)', () => {
  it('nothing saved: 200 with the starter pages, is_default true; only built widget types', async () => {
    for (const dc of ['desktop', 'tablet', 'phone'] as const) {
      const layout = await get(dc)
      expect(layout).toMatchObject({ device_class: dc, updated_at: null, is_default: true })
      expect(layout.pages.map((p) => p.name)).toEqual(STARTERS.map((s) => s.name))
      for (const w of layout.pages.flatMap((p) => p.widgets)) {
        expect(BUILT_TYPES).toContain(w.type)
        if (w.type === 'inbox_column') expect(filterError(w.filter!)).toBeNull()
        else expect(w.filter).toBeNull()
      }
    }
    expect((await get('desktop')).pages[0].widgets.map((w) => w.title)).toEqual(['Critical + High', 'Due today', 'Overdue'])
    expect((await get('desktop')).pages[1].widgets.map((w) => [w.title, w.filter, w.sort])).toContainEqual(['Needs review', 'needs_review=true', 'confidence'])
    expect((await get('desktop')).pages[2].widgets.map((w) => [w.title, w.filter])).toEqual([['Due this week', 'due=next_7_days'], ['Needs my reply', 'view=needs_reply'], ['Stats', null]])
    // Ordered tiles with a size, no positions (proposals §16.3): three small tiles fill Today's one row.
    expect((await get('desktop')).pages[0].widgets.map((w) => [w.size, w.hidden])).toEqual([['small', false], ['small', false], ['small', false]])
    expect((await get('desktop')).pages[2].widgets.map((w) => w.size)).toEqual(['medium', 'small', 'small'])
    expect((await get('tablet')).pages).toEqual((await get('desktop')).pages)
    expect(Object.keys((await get('phone')).pages[0].widgets[0])).not.toContain('x')
  })

  it('PUT is a full replace with an updated_at check; a stale save gets 409', async () => {
    const start = await get('desktop')
    const pages = [{ ...start.pages[0], name: 'Mine' }]
    const saved = await putLayout('desktop', { pages, base_updated_at: null })
    expect(saved).toMatchObject({ is_default: false, pages: [{ name: 'Mine' }], updated_at: expect.any(String) })
    expect(await get('desktop')).toEqual(saved)
    // Another window still on the starter version:
    expect(await fails(putLayout('desktop', { pages, base_updated_at: null }))).toMatchObject({ status: 409, code: 'conflict' })
    const next = await putLayout('desktop', { pages, base_updated_at: saved.updated_at })
    expect(Date.parse(next.updated_at!)).toBeGreaterThan(Date.parse(saved.updated_at!))
    // Device classes are separate.
    expect((await get('phone')).is_default).toBe(true)
  })

  it('422 for an unknown widget type, a bad filter, a non-emoji icon, a bad size, old positions and the caps; 400 for a bad device', async () => {
    const start: Layout = await get('desktop')
    const w = start.pages[0].widgets[0]
    const put = (widgets: Partial<Widget>[], dc: 'desktop' | 'phone' = 'desktop') =>
      fails(putLayout(dc, { pages: [{ ...start.pages[0], widgets: widgets.map((x) => ({ ...w, id: crypto.randomUUID(), ...x })) as Widget[] }], base_updated_at: null }))
    const field = async (p: Promise<ApiError>) => Object.keys(((await p).details as { fields: Record<string, string> }).fields)
    expect(await field(put([{ type: 'kanban' as never }]))).toContain('pages.0.widgets.0.type')
    expect(await field(put([{ filter: 'type=Spam' }]))).toEqual(['pages.0.widgets.0.filter'])
    expect(await field(put([{ filter: 'sort=urgency' }]))).toEqual(['pages.0.widgets.0.filter'])
    expect(await field(put([{ icon: 'ab' }]))).toEqual(['pages.0.widgets.0.icon'])
    expect(await field(put([{ colour: '#ff0000' as never }]))).toEqual(['pages.0.widgets.0.colour'])
    expect(await field(put([{ size: 'huge' as never }]))).toEqual(['pages.0.widgets.0.size'])
    expect(await field(put([{ hidden: 'no' as never }], 'phone'))).toEqual(['pages.0.widgets.0.hidden'])
    // F18: a stacked widget follows an unstacked one of the same size.
    expect(await field(put([{ stacked: true }]))).toEqual(['pages.0.widgets.0.stacked'])
    expect(await field(put([{}, { stacked: true, size: 'medium' }]))).toEqual(['pages.0.widgets.1.size'])
    expect(await field(put([{}, { stacked: true }, { stacked: true }]))).toEqual(['pages.0.widgets.2.stacked'])
    // The old free-placement fields are unknown now.
    expect(await field(put([{ x: 0 } as never]))).toEqual(['pages.0.widgets.0.x'])
    expect((await put(Array.from({ length: 25 }, () => ({}))))).toMatchObject({ status: 422 })
    const tooMany = Array.from({ length: 10 }, (_, order) => ({ id: crypto.randomUUID(), name: `P${order}`, order: order % 9, widgets: [] }))
    expect((await fails(putLayout('desktop', { pages: tooMany, base_updated_at: null }))).status).toBe(422)
    expect((await fails(queryClient.fetchQuery({ ...layoutOptions('watch' as never), retry: false }))).status).toBe(400)
  })

  it('the starter layout is the same on every GET (stable ids)', () => {
    expect(starterLayout('desktop')).toEqual(starterLayout('desktop'))
  })
})
