import { LogOut, PanelLeftClose, PanelLeftOpen, Settings, UserCog } from 'lucide-react'
import { useEffect, useRef, useState, type FocusEvent, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { NavLink } from 'react-router'
import { signOutNow } from '../api/client'
import { useGlance, useMe, useUpdatePreferences } from '../api/queries'
import { isAdmin, visibleNav } from './nav'
import { usePrefs } from './prefs'
import { SidebarProjects } from './SidebarProjects'
import { ThemeChoice } from './ThemeChoice'

const PEEK_INTENT_MS = 150
const PEEK_LEAVE_MS = 200

/** Hover-peek (Arc style): a collapsed sidebar opens as an overlay after a short hover intent, without moving content. */
function usePeek(enabled: boolean) {
  const [peek, setPeek] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const later = (value: boolean, ms: number) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setPeek(value), ms)
  }
  useEffect(() => () => clearTimeout(timer.current), [])

  // Expanded sidebars never peek; a stale `peek` from before expanding is simply ignored.
  if (!enabled) return { peek: false, handlers: {} }
  return {
    peek,
    handlers: {
      onPointerEnter: (e: PointerEvent) => e.pointerType === 'mouse' && later(true, PEEK_INTENT_MS),
      onPointerLeave: () => later(false, PEEK_LEAVE_MS),
      // Keyboard users get the labels too while focus is inside.
      onFocus: () => later(true, 0),
      onBlur: (e: FocusEvent) => !e.currentTarget.contains(e.relatedTarget) && later(false, 0),
    },
  }
}

/** Ambient urgency (FR-UI-005): steady glow while Critical is unread; three pulses each time the count goes up. */
function useCriticalGlow(critical: number) {
  const previous = useRef(critical)
  const [pulse, setPulse] = useState(0)
  useEffect(() => {
    if (critical > previous.current) setPulse((n) => n + 1)
    previous.current = critical
  }, [critical])
  return pulse
}

/**
 * The avatar menu: who is signed in, and the theme for now (proposals §16.6; Settings takes it over in task 16). A
 * small hand-made menu, not a popover library, so nothing heavy joins the first load. Esc, a click outside or Tab
 * closes it and returns focus to the avatar.
 */
function UserMenu({ name, email }: { name: string; email: string | undefined }) {
  const [at, setAt] = useState<{ left: number; bottom: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const open = at !== null
  const close = (refocus: boolean) => {
    setAt(null)
    if (refocus) button.current?.focus()
  }
  const toggle = () => {
    const r = button.current?.getBoundingClientRect()
    setAt(open || !r ? null : { left: r.left, bottom: innerHeight - r.top + 4 })
  }

  useEffect(() => {
    if (!open) return
    // Focus goes to the chosen theme, so the keyboard lands in the menu although it lives in a portal.
    menu.current?.querySelector<HTMLInputElement>('input:checked')?.focus()
    const outside = (e: globalThis.PointerEvent) => {
      const t = e.target as Node
      if (!menu.current?.contains(t) && !button.current?.contains(t)) setAt(null)
    }
    // Esc wherever focus is; claimed (preventDefault) so Focus mode, which skips handled keys, doesn't also act.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      setAt(null)
      if (menu.current?.contains(document.activeElement)) button.current?.focus()
    }
    const onResize = () => setAt(null)
    addEventListener('pointerdown', outside, true)
    addEventListener('keydown', onKey, true)
    addEventListener('resize', onResize)
    return () => {
      removeEventListener('pointerdown', outside, true)
      removeEventListener('keydown', onKey, true)
      removeEventListener('resize', onResize)
    }
  }, [open])

  return (
    <li className="nav-user">
      <button ref={button} type="button" className="nav-link" aria-expanded={open} aria-controls="user-menu" title={email} onClick={toggle}>
        <span className="nav-icon">
          <span className="avatar" aria-hidden="true">
            {name[0].toUpperCase()}
          </span>
        </span>
        <span className="nav-label">{name}</span>
      </button>
      {/* In a portal: the sidebar panel clips (overflow, clip-path) and its backdrop-filter traps fixed children. */}
      {at &&
        createPortal(
          <div
            ref={menu}
            className="user-menu"
            id="user-menu"
            role="group"
            aria-label="Account"
            style={{ left: at.left, bottom: at.bottom }}
            onKeyDown={(e) => {
              // Tab leaves the menu back to where it opened from.
              if (e.key === 'Tab') {
                e.preventDefault()
                close(true)
              }
            }}
          >
            <p className="user-menu-who">
              <strong>{name}</strong>
              {email && <span>{email}</span>}
            </p>
            <ThemeChoice />
            <button type="button" className="user-menu-signout" onClick={() => void signOutNow()}>
              <LogOut size={16} aria-hidden="true" /> Sign out
            </button>
          </div>,
          document.body,
        )}
    </li>
  )
}

export function Sidebar() {
  const { data: me } = useMe()
  const { data: glance } = useGlance()
  const { sidebar_collapsed: collapsed } = usePrefs()
  const updatePrefs = useUpdatePreferences()
  const { peek, handlers } = usePeek(collapsed)
  const critical = glance?.counts.critical_unread ?? 0
  const pulse = useCriticalGlow(critical)
  const name = me?.display_name ?? me?.email

  return (
    <nav
      className="sidebar"
      aria-label="Main"
      data-collapsed={collapsed || undefined}
      data-peek={peek || undefined}
      data-glow={critical > 0 || undefined}
      {...handlers}
    >
      {/* A new key restarts the pulse animation. The glow is pre-drawn and animates opacity only (item 9). */}
      <span className={pulse ? 'glow pulse' : 'glow'} key={pulse} aria-hidden="true" />
      <div className="sidebar-panel">
        <ul className="nav">
          {visibleNav(me).map(({ to, label, icon: Icon, count }) => {
            const n = glance && count ? count(glance) : null
            const showCritical = to === '/inbox' && critical > 0
            return (
              <li key={to}>
                <NavLink to={to} end={to === '/'} className="nav-link">
                  <span className="nav-icon">
                    <Icon aria-hidden="true" size={20} />
                    {showCritical && <span className="crit-dot" aria-hidden="true" />}
                  </span>
                  <span className="nav-label">{label}</span>
                  {showCritical && <span className="sr-only">, {critical} Critical unread</span>}
                  {n ? (
                    <span className="badge">
                      {n}
                      <span className="sr-only"> {to === '/inbox' ? 'unread' : 'items'}</span>
                    </span>
                  ) : null}
                </NavLink>
              </li>
            )
          })}
        </ul>

        <SidebarProjects />

        <ul className="nav nav-bottom">
          {name && <UserMenu name={name} email={me?.email} />}
          <li>
            <NavLink to="/settings" className="nav-link">
              <span className="nav-icon">
                <Settings aria-hidden="true" size={20} />
              </span>
              <span className="nav-label">Settings</span>
            </NavLink>
          </li>
          {me && isAdmin(me) && (
            <li>
              <NavLink to="/admin" className="nav-link">
                <span className="nav-icon">
                  <UserCog aria-hidden="true" size={20} />
                </span>
                <span className="nav-label">Admin</span>
              </NavLink>
            </li>
          )}
          <li>
            <button type="button" className="nav-link" onClick={() => updatePrefs.mutate({ sidebar_collapsed: !collapsed })}>
              <span className="nav-icon">
                {collapsed ? <PanelLeftOpen aria-hidden="true" size={20} /> : <PanelLeftClose aria-hidden="true" size={20} />}
              </span>
              <span className="nav-label">{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
            </button>
          </li>
        </ul>
      </div>
    </nav>
  )
}
