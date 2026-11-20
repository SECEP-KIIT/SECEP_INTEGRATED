// Layout edits as pure functions over the layout shape (pages → ordered widgets, proposals §13 and §16.3). The
// dashboard keeps one local copy and saves it whole (PUT is a full replace). Unit-tested in dashboard.test.ts.
import type { LayoutPage, Swatch, Widget, WidgetSize, WidgetType } from '../api/types'

/** Caps, the same as the server's (task 8 decision). Ctrl+1…9 reaches every page. */
export const MAX_PAGES = 9
export const MAX_WIDGETS = 24

/** The 8 named swatches (FR-UI-008). Each has a visible name in the menu, so the colour is never the only cue. */
export const SWATCHES: { key: Swatch; label: string }[] = [
  { key: 'slate', label: 'Slate' },
  { key: 'blue', label: 'Blue' },
  { key: 'teal', label: 'Teal' },
  { key: 'green', label: 'Green' },
  { key: 'amber', label: 'Amber' },
  { key: 'orange', label: 'Orange' },
  { key: 'red', label: 'Red' },
  { key: 'violet', label: 'Violet' },
]

/** Emoji offered in the icon picker. Any single emoji is valid on the wire. */
export const ICONS = ['📥', '📬', '🔥', '📅', '🗓️', '⏰', '↩️', '🧐', '🛡️', '⭐', '📌', '💼', '📊', '✈️', '🧭', '💬', '✅', '🧾', '🔔', '🏷️', '📎', '🗂️', '⚡', '🌙']

const DEFAULT_TITLE: Record<WidgetType, string> = {
  inbox_column: 'Inbox',
  board: 'Board',
  projects: 'Projects',
  reminders: 'Reminders',
  calendar: 'Calendar',
  notes: 'Notes',
  stats: 'Stats',
  security: 'Security',
}
export const widgetTitle = (w: Pick<Widget, 'type' | 'title'>) => w.title ?? DEFAULT_TITLE[w.type]

/** ⤢: the /inbox full view with this column's filter and sort, in the GET /emails vocabulary. */
export function fullViewHref(w: Pick<Widget, 'filter' | 'sort'>) {
  const parts = [w.filter, w.sort && w.sort !== 'newest' ? `sort=${w.sort}` : ''].filter(Boolean)
  return parts.length ? `/inbox?${parts.join('&')}` : '/inbox'
}

/** Widget types the client can render today. The gallery offers only these; tasks 10–15 add theirs. */
export const BUILT_TYPES: WidgetType[] = ['inbox_column', 'board', 'notes', 'stats']

export interface WidgetPreset {
  key: string
  /** Default inbox_column. */
  type?: WidgetType
  title: string
  icon: string
  colour: Swatch | null
  /** GET /emails filter parameters (proposals §13). */
  filter: string
  sort: Widget['sort']
}

/** The Board widget (FR-ORC-007, task 10): the board as a tile; ⤢ opens /board. */
export const BOARD_PRESET: WidgetPreset = { key: 'board', type: 'board', title: 'Board', icon: '📋', colour: null, filter: '', sort: null }
export const NOTES_PRESET: WidgetPreset = { key: 'notes', type: 'notes', title: 'Notes', icon: '📝', colour: null, filter: '', sort: null }
/** Stats (the former Metrics page): counts for everyone, classifier metrics for admins. */
export const STATS_PRESET: WidgetPreset = { key: 'stats', type: 'stats', title: 'Stats', icon: '📊', colour: null, filter: '', sort: null }

/** Gallery entries: inbox columns as saved filters (FR-UI-006), in the GET /emails vocabulary. */
export const COLUMN_PRESETS: WidgetPreset[] = [
  { key: 'inbox', title: 'Inbox', icon: '📥', colour: null, filter: '', sort: 'newest' },
  { key: 'unread', title: 'Unread', icon: '📬', colour: 'blue', filter: 'view=unread', sort: 'newest' },
  { key: 'critical', title: 'Critical + High', icon: '🔥', colour: 'red', filter: 'urgency=Critical,High', sort: 'newest' },
  { key: 'due', title: 'Due today', icon: '📅', colour: 'amber', filter: 'view=due_today', sort: 'newest' },
  { key: 'overdue', title: 'Overdue', icon: '⏰', colour: 'orange', filter: 'view=overdue', sort: 'newest' },
  { key: 'reply', title: 'Needs my reply', icon: '↩️', colour: 'teal', filter: 'view=needs_reply', sort: 'newest' },
  { key: 'week', title: 'Due this week', icon: '🗓️', colour: 'amber', filter: 'due=next_7_days', sort: 'newest' },
  { key: 'review', title: 'Needs review', icon: '🧐', colour: 'violet', filter: 'needs_review=true', sort: 'confidence' },
  { key: 'security', title: 'Security-flagged', icon: '🛡️', colour: 'slate', filter: 'flag=suspicious,malicious', sort: 'newest' },
  { key: 'handled', title: 'Handled', icon: '✅', colour: 'green', filter: 'view=handled', sort: 'newest' },
]

export const newId = () => crypto.randomUUID()
export const sortedPages = (pages: LayoutPage[]) => [...pages].sort((a, b) => a.order - b.order)
const renumber = (pages: LayoutPage[]) => sortedPages(pages).map((p, order) => ({ ...p, order }))

export function addPage(pages: LayoutPage[], name?: string): LayoutPage[] | null {
  if (pages.length >= MAX_PAGES) return null
  return renumber([...pages, { id: newId(), name: name ?? `Page ${pages.length + 1}`, order: pages.length, widgets: [] }])
}

export const renamePage = (pages: LayoutPage[], id: string, name: string) =>
  pages.map((p) => (p.id === id && name.trim() ? { ...p, name: name.trim().slice(0, 40) } : p))

/** Removes a page; the last page can't be removed (a layout has at least one). */
/** Removes a page; the last page can't be removed (a layout has at least one). */
export const removePage = (pages: LayoutPage[], id: string) => (pages.length <= 1 ? pages : renumber(pages.filter((p) => p.id !== id)))

/** Undo of a removal (FR-UI-029 pattern): the page goes back where it was. null if the page cap was reached since. */
export function restorePage(pages: LayoutPage[], page: LayoutPage): LayoutPage[] | null {
  if (pages.length >= MAX_PAGES || pages.some((p) => p.id === page.id)) return null
  const list = sortedPages(pages)
  list.splice(Math.min(page.order, list.length), 0, page)
  return list.map((p, order) => ({ ...p, order }))
}

/** Moves a page one step left (-1) or right (+1). */
export function movePage(pages: LayoutPage[], id: string, by: -1 | 1): LayoutPage[] {
  const list = sortedPages(pages)
  const i = list.findIndex((p) => p.id === id)
  const j = i + by
  if (i < 0 || j < 0 || j >= list.length) return pages
  ;[list[i], list[j]] = [list[j], list[i]]
  return list.map((p, order) => ({ ...p, order }))
}

export const updatePage = (pages: LayoutPage[], id: string, fn: (p: LayoutPage) => LayoutPage | null) =>
  pages.map((p) => (p.id === id ? (fn(p) ?? p) : p))

/** The page "See" on a Mark-handled toast opens (QA pass 5): the first with a Handled column, best one alone. */
export function handledPage(pages: LayoutPage[]): LayoutPage | null {
  const isHandled = (w: Widget) => w.type === 'inbox_column' && new URLSearchParams(w.filter ?? '').get('view')?.split(',').includes('handled')
  const sorted = sortedPages(pages)
  return sorted.find((p) => p.widgets.length === 1 && isHandled(p.widgets[0])) ?? sorted.find((p) => p.widgets.some(isHandled)) ?? null
}

/** A Handled page at the end, for layouts saved before it was a starter page. null at the page cap. */
export function addHandledPage(pages: LayoutPage[]): LayoutPage[] | null {
  const next = addPage(pages, 'Handled')
  if (!next) return null
  const preset = COLUMN_PRESETS.find((p) => p.key === 'handled')!
  const last = sortedPages(next).at(-1)!
  return updatePage(next, last.id, (p) => addWidget(p, preset, 'large'))
}

/** Adds a widget at the end of the page; null when the page holds MAX_WIDGETS already. */
export function addWidget(page: LayoutPage, preset: WidgetPreset, size: WidgetSize = 'small'): LayoutPage | null {
  if (page.widgets.length >= MAX_WIDGETS) return null
  const type = preset.type ?? 'inbox_column'
  // Only inbox columns have a filter and a sort (§6.4 Widget; PUT /layouts answers 422 otherwise).
  const column = type === 'inbox_column'
  const w: Widget = { id: newId(), type, size, hidden: false, stacked: false, title: preset.title, icon: preset.icon, colour: preset.colour, filter: column ? preset.filter : null, sort: column ? preset.sort : null, density: null }
  return { ...page, widgets: [...page.widgets, w] }
}

/**
 * Slots (F18): a widget with `stacked` shares the slot of the widget before it, the two at half height each. At most
 * two per slot; a stacked widget always has its base's size. `slots` reads that from the list, `flat` writes it back
 * and restores those rules, so every edit below goes through the two.
 */
export function slots(widgets: readonly Widget[]): Widget[][] {
  const out: Widget[][] = []
  for (const w of widgets) {
    const last = out.at(-1)
    if (w.stacked && last?.length === 1) last.push(w)
    else out.push([w])
  }
  return out
}
const flat = (page: LayoutPage, s: Widget[][]): LayoutPage => ({
  ...page,
  widgets: s.flatMap((slot) => slot.map((w, i) => ({ ...w, stacked: i === 1, size: slot[0].size }))),
})
const slotOf = (s: Widget[][], id: string) => s.findIndex((slot) => slot.some((w) => w.id === id))

/** A copy right after the original's slot, on its own. */
export function duplicateWidget(page: LayoutPage, id: string): LayoutPage | null {
  const s = slots(page.widgets)
  const i = slotOf(s, id)
  if (i < 0 || page.widgets.length >= MAX_WIDGETS) return null
  const w = s[i].find((x) => x.id === id)!
  s.splice(i + 1, 0, [{ ...w, id: newId(), stacked: false }])
  return flat(page, s)
}

/** Removing one of a pair gives the other the whole slot back. */
export const removeWidget = (page: LayoutPage, id: string): LayoutPage =>
  flat(page, slots(page.widgets).map((slot) => slot.filter((w) => w.id !== id)).filter((slot) => slot.length > 0))

/** Size belongs to the slot: resizing either of a pair resizes both. */
export function resizeWidget(page: LayoutPage, id: string, size: WidgetSize): LayoutPage {
  const s = slots(page.widgets)
  const i = slotOf(s, id)
  if (i < 0) return page
  s[i] = s[i].map((w) => ({ ...w, size }))
  return flat(page, s)
}

/** Whether `activeId` can be stacked under `targetId`: the target is alone in its slot. */
export function canStack(page: LayoutPage, activeId: string, targetId: string): boolean {
  if (activeId === targetId) return false
  const s = slots(page.widgets)
  const i = slotOf(s, targetId)
  return i >= 0 && s[i].length === 1 && slotOf(s, activeId) >= 0
}

/** Stacks a widget under another (F18): it leaves its own slot and takes the target's width. */
export function stackWidget(page: LayoutPage, activeId: string, targetId: string): LayoutPage {
  if (!canStack(page, activeId, targetId)) return page
  const s = slots(page.widgets).map((slot) => slot.filter((w) => w.id !== activeId)).filter((slot) => slot.length > 0)
  const moving = page.widgets.find((w) => w.id === activeId)!
  s[slotOf(s, targetId)].push(moving)
  return flat(page, s)
}

/** Splits a pair: the widget gets its own slot right after its partner. */
export function unstackWidget(page: LayoutPage, id: string): LayoutPage {
  const s = slots(page.widgets)
  const i = slotOf(s, id)
  if (i < 0 || s[i].length < 2) return page
  const w = s[i].find((x) => x.id === id)!
  s.splice(i, 1, s[i].filter((x) => x.id !== id), [w])
  return flat(page, s)
}

/** The slot before this widget's, when it's free to stack under (menu: "Stack under previous"). */
export function stackTargetBefore(page: LayoutPage, id: string): string | null {
  const s = slots(page.widgets)
  const i = slotOf(s, id)
  return i > 0 && s[i].length === 1 && s[i - 1].length === 1 ? s[i - 1][0].id : null
}

export const patchWidget = (page: LayoutPage, id: string, patch: Partial<Omit<Widget, 'id' | 'type'>>): LayoutPage => ({
  ...page,
  widgets: page.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)),
})

/**
 * Dragging a tile onto another (proposals §16.3), slot by slot (F18: a pair moves together). Same-size slots swap
 * places. Otherwise the dragged slot takes the target's place and the slots from there on move one along; the flow
 * then pushes them right and down. A widget dragged out of a pair leaves it and moves on its own. The same page
 * object comes back when nothing changes, so hovering a tile's own place saves nothing.
 */
export function reorderWidget(page: LayoutPage, activeId: string, overId: string): LayoutPage {
  let s = slots(page.widgets)
  const a = slotOf(s, activeId)
  const o = slotOf(s, overId)
  if (a < 0 || o < 0 || a === o) return page
  // A stacked widget being dragged leaves its pair first (its base stays where it was).
  if (s[a].length === 2 && s[a][1].id === activeId) {
    s = [...s.slice(0, a), [s[a][0]], [s[a][1]], ...s.slice(a + 1)]
  }
  const from = slotOf(s, activeId)
  const to = slotOf(s, overId)
  if (s[from][0].size === s[to][0].size) {
    ;[s[from], s[to]] = [s[to], s[from]]
  } else {
    const [moved] = s.splice(from, 1)
    s.splice(to, 0, moved)
  }
  return flat(page, s)
}

/** Phone edit sheet (proposals §16.4): a section dragged to another place in the list; the rest close up. */
export function moveWidget(page: LayoutPage, from: number, to: number): LayoutPage {
  if (from === to || from < 0 || to < 0 || from >= page.widgets.length || to >= page.widgets.length) return page
  const widgets = [...page.widgets]
  const [moved] = widgets.splice(from, 1)
  widgets.splice(to, 0, moved)
  return { ...page, widgets }
}
