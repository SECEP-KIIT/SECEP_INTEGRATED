// Starter pages (FR-UI-007): what GET /layouts/:deviceClass returns while nothing is saved. Same pages as the
// frontend mock (frontend/src/mocks/starters.ts); ids are stable so two GETs return the same layout.
const uid = (ns, n) => `${ns.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const NS_LAYOUT = 11;

const column = (title, icon, colour, filter, sort, size = 'small') => ({ type: 'inbox_column', size, title, icon, colour, filter, sort, density: null });

const STARTERS = [
  { name: 'Today', widgets: [
    column('Critical + High', '🔥', 'red', 'urgency=Critical,High', 'newest'),
    column('Due today', '📅', 'amber', 'view=due_today', 'newest'),
    column('Overdue', '⏰', 'orange', 'view=overdue', 'newest'),
  ] },
  { name: 'Triage', widgets: [
    column('Unread', '📬', 'blue', 'view=unread', 'newest'),
    column('Needs review', '🧐', 'violet', 'needs_review=true', 'confidence'),
    column('Security-flagged', '🛡️', 'slate', 'flag=suspicious,malicious', 'newest'),
  ] },
  { name: 'Planning', widgets: [
    column('Due this week', '🗓️', 'amber', 'due=next_7_days', 'newest', 'medium'),
    column('Needs my reply', '↩️', 'teal', 'view=needs_reply', 'newest'),
    // The Metrics page became this widget (19 Nov 2026).
    { type: 'stats', size: 'small', title: 'Stats', icon: '📊', colour: null, filter: null, sort: null, density: null },
  ] },
  // QA pass 5: where "See" on a Mark-handled toast goes. Only the Handled view, full width.
  { name: 'Handled', widgets: [
    column('Handled', '✅', 'green', 'view=handled', 'newest', 'large'),
  ] },
];

export function starterLayout(device) {
  let n = 0;
  const pages = STARTERS.map((page, order) => ({
    id: uid(NS_LAYOUT, 1000 + order),
    name: page.name,
    order,
    widgets: page.widgets.map((w) => ({ id: uid(NS_LAYOUT, ++n), ...w, hidden: false, stacked: false })),
  }));
  return { device_class: device, pages, updated_at: null, is_default: true };
}
