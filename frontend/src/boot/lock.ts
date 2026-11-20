// Lock screen controller (FR-WP-001–005). The lock is static markup in index.html, so it paints before any app
// code (FR-WP-002). This module drives it. It is imported by both the boot entry and the app, and must stay ONE module
// instance (one state machine); the build check in the README verifies Vite emits it once.
import { currentDevice } from '../lib/breakpoints'
import {
  DONE_HOLD_MS,
  INITIAL,
  effectiveMotion,
  effectiveTheme,
  isIdle,
  progressOf,
  reduce,
  ringLength,
  type LockEvent,
  type MotionPref,
  type ThemePref,
  type Step,
} from './lock-state'

/**
 * Boot preferences mirrored from ui_prefs, because the static lock has to decide before /me answers (skip the lock?
 * reduced motion? dark?). Only a boolean, a number and two keywords, nothing personal or secret, so localStorage is
 * acceptable here (CLAUDE.md: nothing secret in localStorage). The server copy (ui_prefs) stays authoritative.
 */
export interface BootPrefs {
  skip_lock: boolean
  idle_minutes: number | null
  motion?: MotionPref
  theme?: ThemePref
}
const MIRROR_KEY = 'secep.boot'
const DEFAULTS: BootPrefs = { skip_lock: false, idle_minutes: 15 }

const OS_REDUCED = '(prefers-reduced-motion: reduce)'
const OS_DARK = '(prefers-color-scheme: dark)'
const SETTLE_MS = 300 // a little over the 250 ms enter transition

let state = INITIAL
let prefs = DEFAULTS
let lastActive = Date.now()
let started = false

const $ = (id: string) => document.getElementById(id)
// Phones never idle-lock and dissolve automatically (FR-WP-005); "phone" is the shared breakpoint.
const isPhone = () => currentDevice() === 'phone'

function readMirror(): BootPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(MIRROR_KEY) ?? 'null') as Partial<BootPrefs> | null
    return {
      skip_lock: raw?.skip_lock === true,
      idle_minutes: raw?.idle_minutes === null || typeof raw?.idle_minutes === 'number' ? raw.idle_minutes : 15,
      motion: raw?.motion,
      theme: raw?.theme === 'light' || raw?.theme === 'dark' ? raw.theme : 'auto',
    }
  } catch {
    return DEFAULTS // storage blocked or corrupt: fall back to the safe defaults
  }
}

function applyMotion() {
  document.documentElement.dataset.motion = effectiveMotion(prefs.motion, matchMedia(OS_REDUCED).matches)
}

/**
 * <html data-theme> for the app's colours (proposals §16.6). The lock screen and wallpaper keep their own look. Set
 * from the mirror at boot, so a dark choice is there before the app paints, and again when ui_prefs arrive.
 */
function applyTheme() {
  document.documentElement.dataset.theme = effectiveTheme(prefs.theme, matchMedia(OS_DARK).matches)
}

let settleTimer: ReturnType<typeof setTimeout> | undefined

function render() {
  const html = document.documentElement
  const app = $('root')
  const lock = $('lock')
  const progress = progressOf(state.done)
  const wasOpen = html.dataset.lock === 'open'

  html.dataset.lock = state.view
  html.toggleAttribute('data-ready', progress >= 100)
  const len = ringLength(progress)
  $('lock-ring')?.style.setProperty('stroke-dasharray', `${len} ${100 - len}`)

  // While the lock is up, the dashboard is inert: no focus, no clicks, hidden from screen readers. This is a
  // privacy curtain, not authentication (FR-WP-004); the computer's own lock is the real security boundary.
  if (app) {
    app.inert = state.view !== 'open'
    app.toggleAttribute('aria-hidden', state.view !== 'open')
  }
  if (lock) {
    lock.inert = state.view === 'open'
    if (state.view !== 'open' && document.activeElement !== lock) lock.focus({ preventScroll: true })
  }
  const status = $('lock-status')
  if (status) status.textContent = state.view === 'waiting' ? 'Loading SECEP…' : state.view === 'done' ? 'SECEP is ready' : ''

  // Frosted bars only blur once the sheet has stopped moving: nothing may animate beneath a moving
  // backdrop-filter area (frontend-decisions item 9).
  if (state.view === 'open' && !wasOpen) {
    clearTimeout(settleTimer)
    settleTimer = setTimeout(() => html.toggleAttribute('data-settled', true), SETTLE_MS)
  } else if (state.view !== 'open') {
    clearTimeout(settleTimer)
    html.toggleAttribute('data-settled', false)
  }
}

function dispatch(e: LockEvent) {
  const next = reduce(state, e)
  if (next === state) return
  const entering = next.view === 'done' && state.view !== 'done'
  const was = state.view
  state = next
  // The app hears the curtain come down and go up (lib/lockLayers.ts closes dialogs and reopens the email panel).
  if (was === 'open' && next.view !== 'open') dispatchEvent(new Event(LOCKING))
  else if (was !== 'open' && next.view === 'open') dispatchEvent(new Event(UNLOCKED))
  render()
  // Spinner → green tick → slide up: hold the tick briefly, then release into the dashboard.
  if (entering) setTimeout(() => dispatch({ type: 'release' }), DONE_HOLD_MS)
}

const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })

function tickClock() {
  const now = new Date()
  const time = $('lock-time')
  if (time) {
    time.textContent = timeFmt.format(now)
    time.setAttribute('datetime', now.toISOString())
  }
  const date = $('lock-date')
  if (date) date.textContent = dateFmt.format(now)
  setTimeout(tickClock, 60_000 - (Date.now() % 60_000))
}

/** The lock's refresh button (top right) refreshes without opening the lock. */
const onRefresh = (t: EventTarget | null) => !!(t as Element | null)?.closest?.('#lock-refresh')

function onKey(e: KeyboardEvent) {
  // Synthetic keys (the Escape that closes menus as the lock comes down) never open it again.
  if (!e.isTrusted) return
  lastActive = Date.now()
  if (state.view === 'open') return
  if (onRefresh(e.target) && (e.key === 'Enter' || e.key === ' ')) return
  // The key only opens the lock; it must not also reach the app (e.g. F would toggle focus mode).
  e.stopPropagation()
  if (!e.ctrlKey && !e.metaKey && !e.altKey) e.preventDefault()
  dispatch({ type: 'request' })
}

function onPointerDown(e: PointerEvent) {
  lastActive = Date.now()
  if (state.view !== 'open' && !onRefresh(e.target)) dispatch({ type: 'request' })
}

const markActive = () => {
  lastActive = Date.now()
}

/** Idempotent: the boot entry calls it first; the app may call it again safely. */
export function initLock() {
  if (started) return
  started = true
  prefs = readMirror()
  applyMotion()
  applyTheme()
  state = reduce(state, { type: 'auto', auto: prefs.skip_lock || isPhone() })

  addEventListener('keydown', onKey, { capture: true })
  addEventListener('pointerdown', onPointerDown, { capture: true })
  for (const type of ['pointermove', 'wheel', 'touchstart'] as const) addEventListener(type, markActive, { passive: true })
  matchMedia(OS_REDUCED).addEventListener('change', applyMotion)
  matchMedia(OS_DARK).addEventListener('change', applyTheme) // Auto follows the system as it changes

  setInterval(() => {
    if (state.view === 'open' && isIdle(lastActive, Date.now(), prefs.idle_minutes, isPhone())) dispatch({ type: 'idle' })
  }, 15_000)

  tickClock()
  render()
}

/** Window events: the lock has come down over the dashboard / gone up again. */
export const LOCKING = 'secep:locking'
export const UNLOCKED = 'secep:unlocked'

export const lock = {
  /** True while the dashboard is showing (no lock or loading curtain over it). */
  isOpen: () => state.view === 'open',
  /** Report a finished boot step (FR-WP-003 progress). */
  step(step: Step) {
    dispatch({ type: 'step', step })
  },
  /** "Lock now" (topbar button, Alt+L): the same privacy curtain as the idle return, without the wait. */
  now() {
    if (state.view === 'open') dispatch({ type: 'idle' })
  },
  /** Apply ui_prefs once /me arrives, and mirror the boot-relevant ones for the next static paint. */
  configure(next: BootPrefs) {
    prefs = next
    try {
      localStorage.setItem(MIRROR_KEY, JSON.stringify(next))
    } catch {
      // Storage blocked: the next boot uses defaults, which is safe.
    }
    applyMotion()
    applyTheme()
    dispatch({ type: 'auto', auto: next.skip_lock || isPhone() })
  },
}
