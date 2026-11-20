// Starter pages (FR-UI-007, task 8 decision): what GET /layouts/:deviceClass returns while nothing is saved.
// Data, not code: later tasks add their widgets here (Board in task 10, Calendar in task 14). Only widget types that
// exist today are listed. Filters use the GET /emails query vocabulary (proposals §13).
import type { Layout, LayoutDeviceClass, LayoutPage, Widget, WidgetSize } from '../api/types'
import { uid } from './store/random'

type StarterWidget = Omit<Widget, 'id' | 'hidden' | 'stacked'>

/** Desktop and tablet: rows of 3 slots (proposals §16.3). Phones stack the same widgets as sections. */
const column = (title: string, icon: string, colour: Widget['colour'], filter: string, sort: Widget['sort'], size: WidgetSize = 'small'): StarterWidget => ({
  type: 'inbox_column', size, title, icon, colour, filter, sort, density: null,
})

export const STARTERS: { name: string; widgets: StarterWidget[] }[] = [
  {
    name: 'Today',
    widgets: [
      // Handled mail is outside every list except the Handled view, so "not handled" needs no parameter.
      column('Critical + High', '🔥', 'red', 'urgency=Critical,High', 'newest'),
      column('Due today', '📅', 'amber', 'view=due_today', 'newest'),
      column('Overdue', '⏰', 'orange', 'view=overdue', 'newest'),
    ],
  },
  {
    name: 'Triage',
    widgets: [
      column('Unread', '📬', 'blue', 'view=unread', 'newest'),
      // needs_review=true (proposals §15.2), least-confident first.
      column('Needs review', '🧐', 'violet', 'needs_review=true', 'confidence'),
      column('Security-flagged', '🛡️', 'slate', 'flag=suspicious,malicious', 'newest'),
    ],
  },
  {
    name: 'Planning',
    widgets: [
      // due=next_7_days: a rolling 7 days from today (proposals §15.1).
      column('Due this week', '🗓️', 'amber', 'due=next_7_days', 'newest', 'medium'),
      column('Needs my reply', '↩️', 'teal', 'view=needs_reply', 'newest'),
      // The Metrics page became this widget (19 Nov 2026).
      { type: 'stats', size: 'small', title: 'Stats', icon: '📊', colour: null, filter: null, sort: null, density: null },
    ],
  },
  {
    // QA pass 5: where "See" on a Mark-handled toast goes. Only the Handled view, full width.
    name: 'Handled',
    widgets: [column('Handled', '✅', 'green', 'view=handled', 'newest', 'large')],
  },
]

const NS_LAYOUT = 11

/** The starter layout for one device class. Ids are stable, so two GETs of the default return the same layout. */
export function starterLayout(device: LayoutDeviceClass): Layout {
  let n = 0
  const pages: LayoutPage[] = STARTERS.map((page, order) => ({
    id: uid(NS_LAYOUT, 1000 + order),
    name: page.name,
    order,
    widgets: page.widgets.map((w) => ({ id: uid(NS_LAYOUT, ++n), ...w, hidden: false, stacked: false })),
  }))
  return { device_class: device, pages, updated_at: null, is_default: true }
}
