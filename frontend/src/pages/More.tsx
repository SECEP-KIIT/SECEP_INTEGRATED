import { Settings, UserCog } from 'lucide-react'
import { NavLink } from 'react-router'
import { useMe, useProjects } from '../api/queries'
import { isAdmin, moreNav } from '../shell/nav'
import { ThemeChoice } from '../shell/ThemeChoice'

// Phone "More" tab: whatever isn't a phone tab (nav.ts phoneTabs), with the same gating as the sidebar.
export function Component() {
  const { data: me } = useMe()
  const { data: projects } = useProjects()

  return (
    <>
    <ul className="more-list">
      {moreNav(me).map(({ to, label, icon: Icon }) => (
          <li key={to}>
            <NavLink to={to} className="more-link">
              <Icon aria-hidden="true" size={20} /> {label}
            </NavLink>
          </li>
        ))}
      {projects?.items
        .filter((p) => !p.archived_at)
        .map((p) => (
          <li key={p.id}>
            <NavLink to={`/projects/${p.id}`} className="more-link">
              <span className="project-dot" style={{ background: p.colour }} aria-hidden="true" /> {p.name}
            </NavLink>
          </li>
        ))}
      <li>
        <NavLink to="/settings" className="more-link">
          <Settings aria-hidden="true" size={20} /> Settings
        </NavLink>
      </li>
      {me && isAdmin(me) && (
        <li>
          <NavLink to="/admin" className="more-link">
            <UserCog aria-hidden="true" size={20} /> Admin
          </NavLink>
        </li>
      )}
    </ul>
    {/* Phones have no sidebar avatar: the theme sits here until Settings (task 16). */}
    <div className="more-theme">
      <ThemeChoice />
    </div>
    </>
  )
}
