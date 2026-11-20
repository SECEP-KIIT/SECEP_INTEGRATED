// First-run help (19 Nov 2026, proposals §29): a short tour, a "Getting started" checklist on Home, and two first-use
// hints. Progress is per person in ui_prefs.onboarding; this module reads it from the /me cache and writes it back.
import { api } from '../api/client'
import { queryClient, useMe } from '../api/queries'
import { shellToast } from '../lib/toastBus'
import type { Me, PreferencesResponse } from '../api/types'

export type ChecklistId = 'open_email' | 'send_jira' | 'quick_add' | 'search' | 'popup_rules' | 'quiet_hours'
export type HintId = 'card_keys' | 'remind'

export interface Onboarding {
  /** unset = never offered; paused = closed midway (Settings offers Resume). */
  tour?: 'done' | 'skipped' | 'paused'
  tour_step?: number
  checklist_hidden?: boolean
  done?: ChecklistId[]
  hints?: HintId[]
}

export const CHECKLIST: { id: ChecklistId; label: string }[] = [
  { id: 'open_email', label: 'Open an email' },
  { id: 'send_jira', label: 'Send a task to Jira' },
  { id: 'quick_add', label: 'Add a card of your own' },
  { id: 'search', label: 'Search your mail' },
  { id: 'popup_rules', label: 'Choose which emails pop up' },
  { id: 'quiet_hours', label: 'Turn on quiet hours' },
]
const CHECK_IDS = new Set<string>(CHECKLIST.map((c) => c.id))
const HINT_IDS = new Set<string>(['card_keys', 'remind'])

/** Validator for the mock route and the resolver: all keys optional, extra keys refused. */
export function isOnboarding(v: unknown): v is Onboarding {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  const known = ['tour', 'tour_step', 'checklist_hidden', 'done', 'hints']
  if (Object.keys(o).some((k) => !known.includes(k))) return false
  if (o.tour !== undefined && !['done', 'skipped', 'paused'].includes(o.tour as string)) return false
  if (o.tour_step !== undefined && !(Number.isInteger(o.tour_step) && (o.tour_step as number) >= 0 && (o.tour_step as number) < 20)) return false
  if (o.checklist_hidden !== undefined && typeof o.checklist_hidden !== 'boolean') return false
  const list = (x: unknown, ok: Set<string>) => x === undefined || (Array.isArray(x) && x.length <= 10 && x.every((i) => typeof i === 'string' && ok.has(i)))
  return list(o.done, CHECK_IDS) && list(o.hints, HINT_IDS)
}

const read = (): Onboarding | null => {
  const me = queryClient.getQueryData<Me>(['me'])
  if (!me) return null
  const o = me.ui_prefs.onboarding
  return isOnboarding(o) ? o : {}
}

let chain: Promise<unknown> = Promise.resolve()

/**
 * Merge into ui_prefs.onboarding. The cache changes at once; writes go one at a time and each sends the latest
 * whole object, so two quick ticks can't overwrite each other on the server.
 */
export function saveOnboarding(patch: Partial<Onboarding>) {
  const me = queryClient.getQueryData<Me>(['me'])
  if (!me) return
  queryClient.setQueryData<Me>(['me'], { ...me, ui_prefs: { ...me.ui_prefs, onboarding: { ...read(), ...patch } } })
  chain = chain
    .then(() =>
      api<PreferencesResponse>('/me/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onboarding: read() ?? {} }),
      }),
    )
    .catch(() => {
      // Best effort: a lost tick only means the checklist shows the item again.
    })
}

/** Tick a checklist item when the user does the thing. Cheap when already ticked (no request). */
export function markDone(id: ChecklistId) {
  const o = read()
  if (!o || o.done?.includes(id)) return
  const done = [...(o.done ?? []), id]
  saveOnboarding({ done })
  if (done.length === CHECKLIST.length && !o.checklist_hidden) shellToast("You're all set: Getting started is complete.")
}

export function markHintSeen(id: HintId) {
  const o = read()
  if (!o || o.hints?.includes(id)) return
  saveOnboarding({ hints: [...(o.hints ?? []), id] })
}

export function useOnboarding(): Onboarding | null {
  const { data: me } = useMe()
  if (!me) return null
  const o = me.ui_prefs.onboarding
  return isOnboarding(o) ? o : {}
}

// ── Starting the tour from anywhere (Settings, search) ─────────────────────────────────────────────────────────
const START = 'secep:tour-start'
export const startTour = (step = 0) => dispatchEvent(new CustomEvent<number>(START, { detail: step }))
export function onStartTour(fn: (step: number) => void) {
  const h = (e: Event) => fn((e as CustomEvent<number>).detail)
  addEventListener(START, h)
  return () => removeEventListener(START, h)
}
