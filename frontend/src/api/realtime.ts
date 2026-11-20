// Live updates over Socket.io (§6.5: path /api/socket.io, namespace /ws, access token on connect, payloads §6.4.1).
// The same code runs against the MSW socket mock and against M6.
//
// Cache policy:
// - An event for an email/action the cache already holds patches it IN PLACE. No reordering and no height change
//   under the cursor (NFR-PERF-011).
// - An email the cache doesn't hold (a real arrival) is NOT inserted into any visible list. It is only recorded in
//   `arrivals` below; the "↑ n new" pill and scroll preservation are the column widget's policy (FR-UI-024).
import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { Socket } from 'socket.io-client'
import { dueDateOfActions } from '../lib/due'
import { raiseAlert } from '../lib/alertBus'
import { maybePopUp } from '../lib/popupGate'
import { currentAccessToken, refreshForSocket } from './client'
import type { Action, AppNotification, EmailDetail, EmailListItem, LinkView, Page, SecurityFlag } from './types'

interface Events {
  'email.triaged': { email_id: string; email: EmailListItem }
  'email.enriched': { email_id: string; status: EmailListItem['status']; summary_one_line: string | null; summary_short: string | null; actions: Action[] }
  'email.flagged': { email_id: string; security_flag: SecurityFlag; links: LinkView[] }
  'action.updated': { action: Action }
  // PROPOSED (pending SRS v1.3): the item shape of GET /notifications.
  'notification.new': { notification: AppNotification }
}

// ── New-arrival signal (read by the column widgets' "↑ n new" pill, FR-UI-024) ─────────────────────────────────
// Each arrival keeps its card, so every column can count only the arrivals that match its own filters. A column
// stops counting an arrival once the arrival is in its loaded pages (after the pill resets it to page 1).
const ARRIVALS_MAX = 200
/** An email that arrived over the socket, with the time it arrived here (the pill's baseline compares to it). */
export interface Arrival {
  email: EmailListItem
  at: number
}
const arrivalItems = new Map<string, Arrival>()
const arrivalListeners = new Set<() => void>()
let arrivalsSnapshot: readonly Arrival[] = []

export const arrivals = {
  subscribe(listener: () => void) {
    arrivalListeners.add(listener)
    return () => void arrivalListeners.delete(listener)
  },
  /** Emails that arrived after their lists were loaded, oldest first. Stable between changes. */
  get: () => arrivalsSnapshot,
  clear() {
    arrivalItems.clear()
    publishArrivals()
  },
}
function publishArrivals() {
  arrivalsSnapshot = [...arrivalItems.values()]
  for (const l of arrivalListeners) l()
}
function addArrival(email: EmailListItem) {
  arrivalItems.delete(email.id) // re-signalled: it moves to the end with its new time
  arrivalItems.set(email.id, { email, at: Date.now() })
  for (const id of arrivalItems.keys()) {
    if (arrivalItems.size <= ARRIVALS_MAX) break
    arrivalItems.delete(id)
  }
  publishArrivals()
}

/**
 * Counts an email the caller's own change made newly visible to a list that is on screen (e.g. restored from
 * Handled while an inbox column shows). Same signal as a real arrival: it is never inserted, only counted by the pill.
 */
export function signalArrival(email: EmailListItem) {
  addArrival(listFields(email) as EmailListItem)
}

// ── Cache patching ─────────────────────────────────────────────────────────────────────────────────────────────
// Email lists are cached either as one Page (plain queries) or as InfiniteData of Pages (the column widgets).
type ListData = Page<EmailListItem> | InfiniteData<Page<EmailListItem>, unknown>
const pagesOf = (data: ListData): Page<EmailListItem>[] => ('pages' in data ? data.pages : [data])

function patchPage(page: Page<EmailListItem>, id: string, patch: Partial<EmailListItem>): Page<EmailListItem> {
  return page.items.some((e) => e.id === id) ? { ...page, items: page.items.map((e) => (e.id === id ? { ...e, ...patch } : e)) } : page
}

/**
 * Patches an email IN PLACE wherever it is cached: list pages, the open detail, and a pending arrival. Never adds or
 * reorders. Returns whether any list or detail held it. Exported for mutations that get the new state back.
 */
export function patchEmailCache(qc: QueryClient, id: string, patch: Partial<EmailDetail>): boolean {
  let found = false
  const item = listFields(patch)
  for (const [key, data] of qc.getQueriesData<ListData>({ queryKey: ['emails'] })) {
    if (!data || !pagesOf(data).some((p) => p.items.some((e) => e.id === id))) continue
    found = true
    qc.setQueryData<ListData>(key, 'pages' in data ? { ...data, pages: data.pages.map((p) => patchPage(p, id, item)) } : patchPage(data, id, item))
  }
  const detail = qc.getQueryData<EmailDetail>(['email', id])
  if (detail) {
    found = true
    qc.setQueryData<EmailDetail>(['email', id], { ...detail, ...patch })
  }
  const arrival = arrivalItems.get(id)
  if (arrival) {
    arrivalItems.set(id, { ...arrival, email: { ...arrival.email, ...item } })
    publishArrivals()
  }
  return found
}

/** Only list fields go into list caches, so a detail-only field never leaks into a list item. */
function listFields(patch: Partial<EmailDetail>): Partial<EmailListItem> {
  const { body_text: _b, summary_short: _s, actions: _a, links: _l, attachments: _t, masked_secrets: _m, auth_results: _r, thread: _h, ...item } = patch
  return item
}

/** The email as any list or the open detail holds it now, before an event patches it. */
function cachedEmail(qc: QueryClient, id: string): Pick<EmailListItem, 'handled' | 'read'> | undefined {
  const detail = qc.getQueryData<EmailDetail>(['email', id])
  if (detail) return detail
  for (const [, data] of qc.getQueriesData<ListData>({ queryKey: ['emails'] })) {
    const hit = data && pagesOf(data).flatMap((p) => p.items).find((e) => e.id === id)
    if (hit) return hit
  }
  return undefined
}

/**
 * Whether a list's per-user state view admits an email: Handled lists only handled mail and every other view lists
 * none (§10.3); the Unread view holds only unread mail (§12.3).
 */
export function stateAdmits(query: string, e: Pick<EmailListItem, 'handled' | 'read'>) {
  const view = new URLSearchParams(query).get('view')?.split(',') ?? []
  return view.includes('handled') === e.handled && !(view.includes('unread') && e.read)
}

/**
 * Settles every cached list after the user's state for one email changed (handled §10.3, read §12.3), whether the
 * change came from this tab's PATCH or from another session's `email.triaged`. It is decided from the new state
 * alone, so the outcome never depends on whether the socket echo arrives before or after the response (F11):
 * - a list the email no longer belongs to drops it: a deliberate removal, not a layout shift (item 9);
 * - a list it now belongs to never gets it inserted (NFR-PERF-011). On screen, the list counts it in "↑ n new"; off
 *   screen (a view not shown right now), the list is marked stale, so it reloads the next time it's shown. Lists
 *   are otherwise never refetched (staleTime: Infinity), so without this a cached view would stay wrong.
 */
export function settleLists(qc: QueryClient, email: EmailListItem, opts: { restore?: boolean } = {}) {
  for (const [key, data] of qc.getQueriesData<InfiniteData<Page<EmailListItem>, unknown>>({ queryKey: ['emails', 'list'] })) {
    if (!data) continue
    const held = data.pages.some((p) => p.items.some((e) => e.id === email.id))
    const admits = stateAdmits(String(key[2] ?? ''), email)
    if (held && !admits) {
      qc.setQueryData(key, { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.filter((e) => e.id !== email.id) })) })
    } else if (!held && admits) {
      const onScreen = (qc.getQueryCache().find({ queryKey: key, exact: true })?.getObserversCount() ?? 0) > 0
      // An undo puts the email back where it was: the user asked for it, so it isn't new mail for the pill
      // (QA pass 5). The list reloads in place.
      if (onScreen && opts.restore) void qc.invalidateQueries({ queryKey: key, exact: true })
      else if (onScreen) signalArrival(email)
      else void qc.invalidateQueries({ queryKey: key, exact: true, refetchType: 'none' })
    }
  }
}

/** Replaces an action in place in action lists and in its email's open detail. Exported for mutations. */
export function patchActionCache(qc: QueryClient, action: Action) {
  const onBoard = action.status === 'done' && action.board_column !== null
  for (const [key, data] of qc.getQueriesData<Page<Action>>({ queryKey: ['actions'] })) {
    if (!data) continue
    const held = data.items.some((a) => a.id === action.id)
    if (key[1] === 'board') {
      // The board (FR-ORC-007) holds the cards placed in a column: a card joins when it lands in To do and leaves
      // when an undo takes it off. A project's board can't tell membership from the action, so it reloads.
      if (key[2] !== null && held !== onBoard) void qc.invalidateQueries({ queryKey: key, exact: true })
      else if (held && !onBoard) qc.setQueryData<Page<Action>>(key, { ...data, items: data.items.filter((a) => a.id !== action.id) })
      else if (held) qc.setQueryData<Page<Action>>(key, { ...data, items: data.items.map((a) => (a.id === action.id ? action : a)) })
      else if (onBoard && key[2] === null) qc.setQueryData<Page<Action>>(key, { ...data, items: [...data.items, action] })
    } else if (held) {
      qc.setQueryData<Page<Action>>(key, { ...data, items: data.items.map((a) => (a.id === action.id ? action : a)) })
    }
  }
  // Proposals §27.2: a Jira issue or event sent from a card shows in that card's list.
  if (action.card_id && !qc.getQueryData<Page<Action>>(['actions', 'card', action.card_id])?.items.some((a) => a.id === action.id)) {
    void qc.invalidateQueries({ queryKey: ['actions', 'card', action.card_id], exact: true })
  }
  if (!action.email_id) return
  const detail = qc.getQueryData<EmailDetail>(['email', action.email_id])
  if (detail?.actions.some((a) => a.id === action.id)) {
    qc.setQueryData<EmailDetail>(['email', action.email_id], {
      ...detail,
      actions: detail.actions.map((a) => (a.id === action.id ? action : a)),
    })
  }
}

/** Applies one socket event to the query cache. Exported for tests. */
export function applyEvent<E extends keyof Events>(qc: QueryClient, event: E, payload: Events[E]) {
  handle(qc, event, payload)
}

function handle<E extends keyof Events>(qc: QueryClient, event: E, payload: Events[E]) {
  switch (event) {
    case 'email.triaged': {
      const { email_id, email } = payload as Events['email.triaged']
      const before = cachedEmail(qc, email_id)
      // Known email (e.g. relabelled): in place. Unknown: signal only.
      if (!patchEmailCache(qc, email_id, email) && !arrivalItems.has(email_id)) {
        addArrival(email)
        // FR-REM-007: a new email interrupts only if the pop-up rules for now (Normal, Focus, Quiet) let it through.
        maybePopUp(email)
      }
      // Handled or read changed in another tab or session (§10.3, §12.3): the same list settling as a local PATCH.
      if (before && (before.handled !== email.handled || before.read !== email.read)) settleLists(qc, email)
      break
    }
    case 'email.enriched': {
      const p = payload as Events['email.enriched']
      patchEmailCache(qc, p.email_id, {
        status: p.status,
        summary_one_line: p.summary_one_line,
        summary_short: p.summary_short,
        actions: p.actions,
        proposed_action_count: p.actions.filter((a) => a.status === 'proposed').length,
        // The event has no due_date (§6.5): derive it from its actions with the §10.2 rule, so a Due tile can count
        // an arrival whose due date only appears at enrichment (proposals §16.1).
        due_date: dueDateOfActions(p.actions),
      })
      break
    }
    case 'email.flagged': {
      const p = payload as Events['email.flagged']
      patchEmailCache(qc, p.email_id, { security_flag: p.security_flag, links: p.links })
      break
    }
    case 'action.updated':
      patchActionCache(qc, (payload as Events['action.updated']).action)
      break
    case 'notification.new': {
      const { notification } = payload as Events['notification.new']
      // The notification list isn't the inbox: newest first is its natural order.
      qc.setQueryData<Page<AppNotification>>(['notifications'], (page) =>
        page && !page.items.some((n) => n.id === notification.id) ? { ...page, items: [notification, ...page.items] } : page,
      )
      // FR-REM-004: a reminder or meeting that fires pops up in the app as well as in the bell.
      if (notification.kind === 'reminder' || notification.kind === 'meeting') {
        raiseAlert(notification)
      }
      break
    }
  }
  // Counts for the sidebar badges and the lock glance change with almost every event.
  void qc.invalidateQueries({ queryKey: ['glance'] })
}

// ── Connection ─────────────────────────────────────────────────────────────────────────────────────────────────
let socket: Socket | null = null
let started = false

/**
 * Connects once for the app's lifetime. `onSettled` fires on the first connect or first failure (boot step).
 *
 * socket.io-client is imported lazily, for two reasons: it stays out of the app chunk (NFR-PERF-010), and
 * engine.io-client captures `globalThis.WebSocket` when its module is first evaluated. A static import would load
 * before MSW patches WebSocket in dev (main.tsx enables mocking first), and the socket would bypass the mock.
 */
export function connectRealtime(qc: QueryClient, onSettled: () => void) {
  if (started) return
  started = true
  let settled = false
  const settle = () => {
    if (!settled) {
      settled = true
      onSettled()
    }
  }
  // A socket that neither connects nor fails (e.g. nothing listening) must not hold the lock screen forever.
  setTimeout(settle, 5_000)
  void import('socket.io-client').then(({ io }) => open(io, qc, settle), settle)
}

function open(io: typeof import('socket.io-client').io, qc: QueryClient, settle: () => void) {
  let retriedAuth = false
  socket = io('/ws', {
    path: '/api/socket.io',
    // WebSocket only: no long-polling fallback (Caddy proxies WebSockets; the mock intercepts only WebSockets).
    transports: ['websocket'],
    // Called on every (re)connect, so a reconnect sends the current token, not the one from the first attempt.
    // The token goes in the handshake payload, never the URL, where proxies and logs would record it.
    auth: (cb) => void currentAccessToken().then((token) => cb({ token })),
  })

  socket.on('connect', () => {
    retriedAuth = false
    settle()
  })
  socket.on('connect_error', async (err) => {
    settle()
    // The server refused the token (expired): refresh once and reconnect. Without a new token, stay disconnected
    // rather than loop; the REST client handles the signed-out case.
    if (err.message === 'unauthenticated' && !retriedAuth) {
      retriedAuth = true
      if (await refreshForSocket()) socket?.connect()
    }
  })

  const events: (keyof Events)[] = ['email.triaged', 'email.enriched', 'email.flagged', 'action.updated', 'notification.new']
  for (const event of events) socket.on(event, (payload: Events[typeof event]) => handle(qc, event, payload))
}
