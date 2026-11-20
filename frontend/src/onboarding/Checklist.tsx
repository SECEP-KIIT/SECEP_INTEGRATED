// "Getting started" on Home (proposals §29.2): six things to try, ticked as you do them, in any order. Each row has a
// Go button that takes you there. Hide puts it away (Settings › Tutorial brings it back).
import { Check, X } from 'lucide-react'
import { openQuickAdd } from '../cards/cardBus'
import { goTo } from '../lib/navigate'
import { openSearch } from '../search/searchBus'
import { CHECKLIST, saveOnboarding, useOnboarding, type ChecklistId } from './onboarding'
import './onboarding.css'

const GO: Record<ChecklistId, () => void> = {
  open_email: () => goTo('/inbox'),
  send_jira: () => goTo('/inbox'),
  quick_add: () => openQuickAdd({}),
  search: () => openSearch(''),
  popup_rules: () => goTo('/settings#notifications'),
  quiet_hours: () => goTo('/settings#notifications'),
}

export function Checklist() {
  const o = useOnboarding()
  if (!o || o.checklist_hidden) return null
  const done = new Set(o.done ?? [])
  const count = CHECKLIST.filter((c) => done.has(c.id)).length
  // Complete = done with it: the list goes away (markDone shows a toast for the last tick).
  if (count === CHECKLIST.length) return null
  return (
    <section className="checklist" aria-labelledby="checklist-title">
      <header>
        <h2 id="checklist-title">Getting started</h2>
        <span className="checklist-count">
          {count} of {CHECKLIST.length}
        </span>
        <div className="checklist-bar" aria-hidden="true">
          <span style={{ transform: `scaleX(${count / CHECKLIST.length})` }} />
        </div>
        <button type="button" className="icon-button" aria-label="Hide Getting started" title="Hide (Settings › Tutorial brings it back)" onClick={() => saveOnboarding({ checklist_hidden: true })}>
          <X size={16} aria-hidden="true" />
        </button>
      </header>
      <ul>
        {CHECKLIST.map((c) => {
          const ok = done.has(c.id)
          return (
            <li key={c.id} data-done={ok || undefined}>
              <span className="checklist-mark" aria-hidden="true">
                {ok && <Check size={13} />}
              </span>
              <span className="checklist-label">
                {c.label}
                <span className="sr-only">{ok ? ' (done)' : ''}</span>
              </span>
              {!ok && (
                <button type="button" className="text-button" onClick={GO[c.id]}>
                  Go
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
