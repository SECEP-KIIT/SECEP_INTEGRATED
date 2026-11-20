// The short tour (proposals §29.1): five "where things are" steps, plus Admin for admins. A spotlight over the part
// of the screen and a small card beside it; on a phone, or when the part isn't on screen, the card sits at the
// bottom / in the middle. Steps with a related setting show it in the card ("change it now or later in Settings").
// Lazy-loaded: none of this is in the first paint. Not a modal: the page stays usable; Esc closes, ←/→ move.
import { X } from 'lucide-react'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { useUpdatePreferences } from '../api/queries'
import { display, useBindings } from '../lib/keybinds'
import { goTo } from '../lib/navigate'
import { DEFAULT_QUIET } from '../lib/popupRules'
import { usePrefs } from '../shell/prefs'
import { markDone, saveOnboarding } from './onboarding'
import './onboarding.css'

interface Step {
  route?: string
  target?: string
  title: string
  body: (k: Record<string, string>) => ReactNode
  setting?: 'notify' | 'lock'
}

const STEPS: Step[] = [
  {
    route: '/inbox',
    target: '.column',
    title: 'Your inbox, sorted',
    body: (k) => (
      <>
        Every email arrives labelled with its type, urgency and mood. Hover a card for quick buttons, right-click for
        more, or use <kbd>{k.next}</kbd>/<kbd>{k.prev}</kbd> to move and <kbd>{k.done}</kbd> to mark it handled.
      </>
    ),
  },
  {
    route: '/inbox',
    target: '.column .card',
    title: 'Open an email',
    body: () => <>Click a card to open its panel: a short summary, the labels, and proposed actions you can Send to Jira, Edit or Decline.</>,
  },
  {
    route: '/board',
    target: '.board',
    title: 'Your board',
    body: (k) => (
      <>
        Accepted tasks land in To do. Drag cards between To do, In progress and Done. Press <kbd>{k.quick_add}</kbd> anywhere to add a card of your
        own, and <kbd>{k.remind}</kbd> on a card to be reminded later.
      </>
    ),
  },
  {
    target: '.search-pill',
    title: 'Find anything',
    body: (k) => (
      <>
        <kbd>{k.search}</kbd> or <kbd>{k.search_alt}</kbd> searches email subjects and projects. Filters narrow it down, and Go deeper searches the
        email text.
      </>
    ),
  },
  {
    target: '.lock-now',
    title: 'Pop-ups and privacy',
    body: (k) => (
      <>
        Only urgent or frustrated emails pop up. Quiet hours keep the nights calm. <kbd>{k.lock}</kbd> locks the screen. Keys, pop-ups and the
        rest are all in Settings, and your Getting started list is on Home.
      </>
    ),
    setting: 'notify',
  },
]
const ADMIN_STEP: Step = {
  target: 'a[href="/admin"]',
  title: 'Admin',
  body: () => <>As an admin you also have the Admin page: connections, users, and the classifier models with their scores.</>,
}

export default function Tour({ start, admin, onClose }: { start: number; admin: boolean; onClose: () => void }) {
  const steps = admin ? [...STEPS, ADMIN_STEP] : STEPS
  const [index, setIndex] = useState(Math.min(start, steps.length - 1))
  const step = steps[index]
  // The target's box for the step it was measured on (a stale box from the last step is ignored).
  const [found, setFound] = useState<{ at: number; rect: DOMRect | null }>({ at: -1, rect: null })
  const rect = found.at === index ? found.rect : null
  const card = useRef<HTMLDivElement>(null)
  const id = useId()
  const b = useBindings()
  const keys = Object.fromEntries(Object.entries(b).map(([a, c]) => [a, display(c)]))

  const finish = useCallback(
    (how: 'done' | 'paused') => {
      saveOnboarding(how === 'done' ? { tour: 'done', tour_step: 0 } : { tour: 'paused', tour_step: index })
      onClose()
    },
    [index, onClose],
  )

  // Go to the step's page, then find its target (it may take a moment to render).
  useEffect(() => {
    if (step.route && location.pathname !== step.route) goTo(step.route)
    saveOnboarding({ tour: 'paused', tour_step: index })
    let tries = 0
    let timer = 0
    const find = () => {
      const el = step.target ? document.querySelector<HTMLElement>(step.target) : null
      const r = el?.getBoundingClientRect()
      if (r && r.width > 0 && r.height > 0) {
        el!.scrollIntoView({ block: 'nearest' })
        setFound({ at: index, rect: el!.getBoundingClientRect() })
      } else if (++tries < 15) timer = window.setTimeout(find, 100)
      else setFound({ at: index, rect: null })
    }
    timer = window.setTimeout(find, 0)
    // Pages settle after the first paint (lists load, columns size): re-measure while the step is up, and only
    // re-render when the box actually moved.
    const same = (a: DOMRect | null, b: DOMRect | null) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height)
    const remeasure = window.setInterval(() => {
      const el = step.target ? document.querySelector<HTMLElement>(step.target) : null
      const r = el && el.getBoundingClientRect().width > 0 ? el.getBoundingClientRect() : null
      setFound((f) => (f.at === index && same(f.rect, r) ? f : { at: index, rect: r }))
    }, 250)
    return () => {
      clearTimeout(timer)
      clearInterval(remeasure)
    }
  }, [step, index])

  useLayoutEffect(() => card.current?.focus({ preventScroll: true }), [index])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || document.querySelector('dialog[open]')) return
      if (e.key === 'Escape') finish('paused')
      else if (e.key === 'ArrowRight' && card.current?.contains(document.activeElement)) setIndex((i) => Math.min(i + 1, steps.length - 1))
      else if (e.key === 'ArrowLeft' && card.current?.contains(document.activeElement)) setIndex((i) => Math.max(i - 1, 0))
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [finish, steps.length])

  const last = index === steps.length - 1
  const phone = matchMedia('(max-width: 640px)').matches
  const place = placeCard(rect, phone)

  return (
    <div className="tour" data-placed={place.mode}>
      {rect && (
        <div
          className="tour-spot"
          aria-hidden="true"
          style={{ transform: `translate(${rect.left - 6}px, ${rect.top - 6}px)`, width: rect.width + 12, height: rect.height + 12 }}
        />
      )}
      <div ref={card} className="tour-card" role="dialog" aria-labelledby={`${id}-t`} aria-describedby={`${id}-b`} tabIndex={-1} style={place.style} key={index}>
        <div className="tour-head">
          <span className="tour-count">
            {index + 1} of {steps.length}
          </span>
          <button type="button" className="icon-button" aria-label="Close the tour" title="Close (Esc)" onClick={() => finish('paused')}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <h2 id={`${id}-t`}>{step.title}</h2>
        <p id={`${id}-b`}>{step.body(keys)}</p>
        {step.setting === 'notify' && <NotifySetting />}
        <p className="tour-later">You can change any setting now, or later in Settings.</p>
        <div className="tour-buttons">
          <button type="button" className="text-button" onClick={() => finish('done')}>
            Skip tour
          </button>
          <span className="tour-spacer" />
          {index > 0 && (
            <button type="button" className="ghost-button" onClick={() => setIndex(index - 1)}>
              Back
            </button>
          )}
          <button type="button" className="primary-button" onClick={() => (last ? finish('done') : setIndex(index + 1))}>
            {last ? 'Done' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * The card sits beside the spotlight where there's room, else below or above it. When the target fills the screen
 * (a whole column or the board), there is no outside: the card goes to the bottom-right corner, away from the
 * headings at the top. On a phone it's a bottom sheet.
 */
function placeCard(rect: DOMRect | null, phone: boolean): { mode: 'bottom' | 'center' | 'beside' | 'corner'; style?: React.CSSProperties } {
  if (phone) return { mode: 'bottom' }
  if (!rect) return { mode: 'center' }
  const W = 340
  const gap = 14
  const vw = innerWidth
  const vh = innerHeight
  const H = 300 // the tallest card (the last step, with its settings)
  const clampY = (y: number) => Math.max(12, Math.min(y, vh - H - 12))
  const clampX = (x: number) => Math.max(12, Math.min(x, vw - W - 12))
  if (rect.right + gap + W < vw) return { mode: 'beside', style: { transform: `translate(${rect.right + gap}px, ${clampY(rect.top)}px)` } }
  if (rect.left - gap - W > 0) return { mode: 'beside', style: { transform: `translate(${rect.left - gap - W}px, ${clampY(rect.top)}px)` } }
  if (rect.bottom + gap + H < vh) return { mode: 'beside', style: { transform: `translate(${clampX(rect.left)}px, ${rect.bottom + gap}px)` } }
  if (rect.top - gap - H > 0) return { mode: 'beside', style: { transform: `translate(${clampX(rect.left)}px, ${rect.top - gap - H}px)` } }
  return { mode: 'corner' }
}

/** Pop-up rule for normal time and the quiet-hours switch, right in the card. */
function NotifySetting() {
  const prefs = usePrefs()
  const update = useUpdatePreferences()
  const normal = prefs.popup_rules.normal
  return (
    <div className="tour-setting">
      <label>
        Pop up
        <select
          onClick={() => markDone('popup_rules')}
          value={normal.urgency}
          onChange={(e) => (markDone('popup_rules'), update.mutate({ popup_rules: { ...prefs.popup_rules, normal: { ...normal, urgency: e.target.value as typeof normal.urgency } } }))}
        >
          <option value="all">every email</option>
          <option value="medium">Medium and above</option>
          <option value="high">High and above</option>
          <option value="critical">Critical only</option>
          <option value="none">nothing</option>
        </select>
      </label>
      <label className="tour-switch">
        <input type="checkbox" role="switch" checked={prefs.quiet_hours !== null} onChange={(e) => (e.target.checked && markDone('quiet_hours'), update.mutate({ quiet_hours: e.target.checked ? DEFAULT_QUIET : null }))} />
        Quiet hours ({(prefs.quiet_hours ?? DEFAULT_QUIET).start}–{(prefs.quiet_hours ?? DEFAULT_QUIET).end})
      </label>
    </div>
  )
}
