// Layouts (FR-UI-010; PROPOSED shape, proposals §13). One saved layout per user and device class. Owner-only by
// construction: the row is keyed by the caller's id from the token, so no request can name another user's layout.
import type { Layout, LayoutDeviceClass, LayoutPage, WidgetSize, WidgetType } from '../../api/types'
import { Fail, route } from '../http/route'
import { isDateTime, isInt, object, type Fields } from '../http/validate'
import { starterLayout } from '../starters'
import { changed, db } from '../store/db'
import { filterError } from './emails'

const DEVICES: LayoutDeviceClass[] = ['desktop', 'tablet', 'phone']
const TYPES: WidgetType[] = ['inbox_column', 'board', 'projects', 'reminders', 'calendar', 'notes', 'stats', 'security']
const SWATCHES = ['slate', 'blue', 'teal', 'green', 'amber', 'orange', 'red', 'violet']
const SORTS = ['smart', 'newest', 'oldest', 'due', 'urgency', 'sender', 'confidence']
const DENSITIES = ['compact', 'comfortable', 'spacious']
const SIZES: WidgetSize[] = ['small', 'medium', 'large']
// Order in the array is the order on the page (proposals §16.3): no positions.
const WIDGET_KEYS = ['id', 'type', 'size', 'hidden', 'stacked', 'title', 'colour', 'icon', 'filter', 'sort', 'density']
/** Caps (task 8 decision): Ctrl+1…9 reaches every page. */
export const MAX_PAGES = 9
export const MAX_WIDGETS = 24

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
/** One emoji (a single grapheme that is pictographic), e.g. "🔥" or "🛡️". */
const isEmoji = (v: unknown) =>
  typeof v === 'string' && v.length <= 16 && [...segmenter.segment(v)].length === 1 && /\p{Extended_Pictographic}/u.test(v)
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function device(params: { deviceClass: string }): LayoutDeviceClass {
  const d = params.deviceClass as LayoutDeviceClass
  if (!DEVICES.includes(d)) throw new Fail(400, 'bad_request', 'deviceClass must be desktop, tablet or phone')
  return d
}

function checkWidget(f: Fields, at: string, w: unknown, ids: Set<string>) {
  if (!isRecord(w)) return f.add(at, 'Expected an object')
  for (const k of Object.keys(w)) if (!WIDGET_KEYS.includes(k)) f.add(`${at}.${k}`, 'Unknown field')
  for (const k of WIDGET_KEYS) if (!(k in w)) f.add(`${at}.${k}`, 'Required')
  if (typeof w.id !== 'string' || !UUID.test(w.id)) f.add(`${at}.id`, 'Must be a uuid')
  else if (ids.has(w.id)) f.add(`${at}.id`, 'Duplicate id')
  else ids.add(w.id)
  if (!TYPES.includes(w.type as WidgetType)) f.add(`${at}.type`, 'Unknown widget type')
  if (!SIZES.includes(w.size as WidgetSize)) f.add(`${at}.size`, 'Must be small, medium or large')
  if (typeof w.hidden !== 'boolean') f.add(`${at}.hidden`, 'Must be true or false')
  if (typeof w.stacked !== 'boolean') f.add(`${at}.stacked`, 'Must be true or false')
  if (w.title !== null && !(typeof w.title === 'string' && w.title.trim().length >= 1 && w.title.length <= 60)) f.add(`${at}.title`, 'Must be 1–60 characters or null')
  if (w.colour !== null && !SWATCHES.includes(w.colour as string)) f.add(`${at}.colour`, `Must be one of ${SWATCHES.join(', ')} or null`)
  if (w.icon !== null && !isEmoji(w.icon)) f.add(`${at}.icon`, 'Must be one emoji or null')
  if (w.sort !== null && !SORTS.includes(w.sort as string)) f.add(`${at}.sort`, 'Unknown sort')
  if (w.density !== null && !DENSITIES.includes(w.density as string)) f.add(`${at}.density`, 'Unknown density')
  if (w.filter !== null) {
    if (w.type !== 'inbox_column') f.add(`${at}.filter`, 'Only inbox columns have a filter')
    else if (typeof w.filter !== 'string' || w.filter.length > 500) f.add(`${at}.filter`, 'Must be a query string')
    else {
      const err = filterError(w.filter)
      if (err) f.add(`${at}.filter`, err)
    }
  }
}

function checkPages(f: Fields, pages: unknown) {
  if (!Array.isArray(pages) || pages.length < 1 || pages.length > MAX_PAGES) return f.add('pages', `Must be 1–${MAX_PAGES} pages`)
  const ids = new Set<string>()
  pages.forEach((p, i) => {
    const at = `pages.${i}`
    if (!isRecord(p)) return f.add(at, 'Expected an object')
    for (const k of Object.keys(p)) if (!['id', 'name', 'order', 'widgets'].includes(k)) f.add(`${at}.${k}`, 'Unknown field')
    if (typeof p.id !== 'string' || !UUID.test(p.id)) f.add(`${at}.id`, 'Must be a uuid')
    else if (ids.has(p.id)) f.add(`${at}.id`, 'Duplicate id')
    else ids.add(p.id)
    if (!(typeof p.name === 'string' && p.name.trim().length >= 1 && p.name.length <= 40)) f.add(`${at}.name`, 'Must be 1–40 characters')
    if (!isInt(p.order, 0, MAX_PAGES - 1)) f.add(`${at}.order`, `Must be 0–${MAX_PAGES - 1}`)
    if (!Array.isArray(p.widgets) || p.widgets.length > MAX_WIDGETS) return f.add(`${at}.widgets`, `At most ${MAX_WIDGETS} widgets`)
    p.widgets.forEach((w, j) => checkWidget(f, `${at}.widgets.${j}`, w, ids))
    // F18 stacks: a stacked widget follows an unstacked one of the same size (at most two per slot).
    const ws = p.widgets as unknown[]
    ws.forEach((w, j) => {
      if (!isRecord(w) || w.stacked !== true) return
      const prev = ws[j - 1]
      if (!isRecord(prev) || prev.stacked !== false) f.add(`${at}.widgets.${j}.stacked`, 'A stacked widget must follow an unstacked one (at most two per slot)')
      else if (prev.size !== w.size) f.add(`${at}.widgets.${j}.size`, 'A stacked widget has the size of the widget it shares a slot with')
    })
  })
}

const respond = (dc: LayoutDeviceClass, saved: { pages: LayoutPage[]; updated_at: string } | undefined): Layout =>
  saved ? { device_class: dc, pages: structuredClone(saved.pages), updated_at: saved.updated_at, is_default: false } : starterLayout(dc)

export const layoutRoutes = [
  route<{ deviceClass: string }>('get', '/layouts/:deviceClass', 'user', ({ user, params }) => {
    const dc = device(params)
    return respond(dc, db.layouts.get(user.id)?.[dc])
  }),

  // A full replace (task 8 decision), checked against the version the edit started from.
  route<{ deviceClass: string }>('put', '/layouts/:deviceClass', 'user', ({ user, params, body }) => {
    const dc = device(params)
    const f = object(body).only(['pages', 'base_updated_at'])
    if (!('base_updated_at' in f.body) || (f.body.base_updated_at !== null && !isDateTime(f.body.base_updated_at))) {
      f.add('base_updated_at', 'Must be the updated_at the edit started from, or null')
    }
    checkPages(f, f.body.pages)
    f.done()

    const mine = db.layouts.get(user.id) ?? {}
    const current = mine[dc]
    if ((f.body.base_updated_at ?? null) !== (current?.updated_at ?? null)) {
      throw new Fail(409, 'conflict', 'The layout was changed somewhere else since this edit started', { updated_at: current?.updated_at ?? null })
    }
    // Strictly increasing, so two saves in the same millisecond still have different versions.
    const now = Math.max(Date.now(), current ? Date.parse(current.updated_at) + 1 : 0)
    mine[dc] = { pages: structuredClone(f.body.pages as LayoutPage[]), updated_at: new Date(now).toISOString() }
    db.layouts.set(user.id, mine)
    changed()
    return respond(dc, mine[dc])
  }),
]
