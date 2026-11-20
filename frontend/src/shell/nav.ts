import { Inbox, LayoutGrid, ShieldAlert, SquareKanban, type LucideIcon } from 'lucide-react'
import type { Glance, Me } from '../api/types'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  visible?: (me: Me) => boolean
  /** Count badge from GET /me/glance (FR-UI-002). */
  count?: (g: Glance) => number | null
}

export const canReviewSecurity = (me: Me) => me.permissions.includes('security.review')
export const isAdmin = (me: Me) => me.is_admin

// FR-UI-002 top section. Shared by the sidebar and the phone tab bar, so both apply the same gating.
// Hiding is a convenience only: the API enforces RBAC and returns 403 regardless (FR-ADM-005).
// Home (the paged dashboard at /) leads the list: a change to FR-UI-002 for v1.3 (proposals §15.3).
export const NAV: NavItem[] = [
  { to: '/', label: 'Home', icon: LayoutGrid },
  { to: '/inbox', label: 'Inbox', icon: Inbox, count: (g) => g.counts.inbox_unread },
  { to: '/board', label: 'Board', icon: SquareKanban, count: (g) => g.counts.board_todo },
  { to: '/security', label: 'Security', icon: ShieldAlert, visible: canReviewSecurity, count: (g) => g.counts.security_flags },
]

export const visibleNav = (me: Me | undefined) => NAV.filter((i) => !i.visible || (me !== undefined && i.visible(me)))

/**
 * The phone tab bar (proposals §15.3): Home, Inbox, Board, Security, then More. Security shows only with
 * security.review, like in the sidebar. Calendar is v2: no sidebar entry, route or buttons until then.
 */
const PHONE_TABS = ['/', '/inbox', '/board', '/security']
export const phoneTabs = (me: Me | undefined) => visibleNav(me).filter((i) => PHONE_TABS.includes(i.to))
/** Everything in the sidebar's top section that isn't a phone tab, for the More page. */
export const moreNav = (me: Me | undefined) => visibleNav(me).filter((i) => !PHONE_TABS.includes(i.to))
