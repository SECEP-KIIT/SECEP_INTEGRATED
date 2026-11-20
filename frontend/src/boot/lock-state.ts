// Pure lock-screen logic (FR-WP-001–005), no DOM, so it can be unit-tested. lock.ts wires it to the page.

/** Real boot steps, weighted as in frontend-decisions item 15. The weights sum to 100. */
export type Step = 'app' | 'me' | 'emails' | 'layout' | 'socket'
export const STEP_WEIGHTS: Record<Step, number> = { app: 40, me: 25, emails: 25, layout: 5, socket: 5 }

/**
 * locked: lock visible · waiting: the user asked to enter before ready, so show Loading · done: ready after waiting,
 * the Loading box shows a green tick for a moment (DONE_HOLD_MS) before releasing · open: dashboard.
 */
export type View = 'locked' | 'waiting' | 'done' | 'open'

/** How long the done tick stays before the sheet rises (spinner → tick → slide up). */
export const DONE_HOLD_MS = 400

export interface LockState {
  view: View
  done: readonly Step[]
  /** Enter by itself when ready: phones (FR-WP-005) and "Skip lock screen" (FR-WP-001). */
  auto: boolean
  /** Has the dashboard been entered once? Auto-enter applies only to the first boot, never to the idle curtain. */
  entered: boolean
}

export type LockEvent =
  | { type: 'step'; step: Step }
  | { type: 'request' } // click or key press on the lock
  | { type: 'idle' }
  | { type: 'auto'; auto: boolean }
  | { type: 'release' } // the done tick has been shown

export const INITIAL: LockState = { view: 'locked', done: [], auto: false, entered: false }

export const progressOf = (done: readonly Step[]) => done.reduce((sum, s) => sum + STEP_WEIGHTS[s], 0)
const isReady = (s: LockState) => progressOf(s.done) >= 100

const open = (s: LockState): LockState => ({ ...s, view: 'open', entered: true })

export function reduce(s: LockState, e: LockEvent): LockState {
  switch (e.type) {
    case 'step': {
      if (s.done.includes(e.step)) return s
      const next = { ...s, done: [...s.done, e.step] }
      if (!isReady(next)) return next
      // Ready. The user already asked (FR-WP-003): confirm with the done tick first, then release. Otherwise enter by
      // itself on first boot when auto (nothing was shown loading, so there is nothing to confirm).
      if (next.view === 'waiting') return { ...next, view: 'done' }
      return next.auto && !next.entered ? open(next) : next
    }
    case 'request':
      if (s.view !== 'locked') return s
      return isReady(s) ? open(s) : { ...s, view: 'waiting' }
    case 'release':
      return s.view === 'done' ? open(s) : s
    case 'idle':
      return s.view === 'open' ? { ...s, view: 'locked' } : s
    case 'auto': {
      const next = { ...s, auto: e.auto }
      return e.auto && !s.entered && (s.view === 'locked' || s.view === 'waiting') && isReady(next) ? open(next) : next
    }
  }
}

/** Segment length for the loading ring, in % of the outline. Never zero, so there is always something travelling. */
export const ringLength = (progress: number) => Math.min(100, Math.max(8, progress))

export type MotionPref = 'full' | 'reduced' | 'off'

/**
 * ui_prefs.motion combined with the OS setting: the most reduction wins, unless the user explicitly chose Full in
 * Settings (FR-UI-032). Unset follows the OS.
 */
/** ui_prefs.theme (PROPOSED, proposals §16.6): Light, Dark, or Auto (follow the system). Unset = Auto. */
export type ThemePref = 'light' | 'dark' | 'auto'

/** The theme to show: the user's choice, or the system's when Auto. */
export const effectiveTheme = (pref: ThemePref | undefined, osDark: boolean): 'light' | 'dark' =>
  pref === 'light' || pref === 'dark' ? pref : osDark ? 'dark' : 'light'

export function effectiveMotion(pref: MotionPref | undefined, osReduced: boolean): MotionPref {
  if (pref === 'off' || pref === 'reduced' || pref === 'full') return pref
  return osReduced ? 'reduced' : 'full'
}

/** Idle return (FR-WP-004): desktop only, off when idle_minutes is null. */
export function isIdle(lastActiveMs: number, nowMs: number, idleMinutes: number | null, phone: boolean) {
  return !phone && idleMinutes !== null && idleMinutes > 0 && nowMs - lastActiveMs >= idleMinutes * 60_000
}
