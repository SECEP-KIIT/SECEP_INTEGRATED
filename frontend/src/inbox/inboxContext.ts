import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import type { ActionType, EmailListItem } from '../api/types'

export interface OpenOptions {
  /** Open the drawer with the composer for this action type (⇧-click, or no proposal to send as is). */
  compose?: Exclude<ActionType, 'add_board_card'>
}

/** A toast's one button, e.g. Undo (the FR-UI-029 pattern). Running it dismisses the toast. */
export interface ToastAction {
  label: string
  run: () => void
}

export interface Toast {
  id: number
  message: string
  tone: 'info' | 'error'
  action?: ToastAction
  /** A second button, shown before `action` (e.g. See · Undo). */
  extra?: ToastAction
}

/** What cards can ask the inbox page to do: open the drawer, show a toast. */
export interface InboxApi {
  open: (id: string, opts?: OpenOptions) => void
  toast: (message: string, tone?: Toast['tone'], action?: ToastAction, extra?: ToastAction) => void
  /** The project picker (FR-UI-017), one per page, for these emails at a point on screen. */
  pickProject: (ids: readonly string[], x: number, y: number) => void
  /** "Remind me" picker (FR-REM-002). */
  pickRemind: (ids: readonly string[], x: number, y: number) => void
  /** The `?` legend (FR-UI-014), one per page however many columns it has. */
  showLegend: () => void
  /** The card right-click menu (FR-UI-028), one per page, at a point on screen. */
  menu: (email: EmailListItem, x: number, y: number) => void
}

export const InboxContext = createContext<InboxApi>({ open: () => {}, toast: () => {}, showLegend: () => {}, menu: () => {}, pickProject: () => {}, pickRemind: () => {} })
export const useInbox = () => useContext(InboxContext)

const TOAST_MS = 5_000
/** An undo stays offered for about 10 s (FR-UI-029). */
export const UNDO_MS = 10_000

/**
 * A small toast queue. A toast with an action (Undo) stays for UNDO_MS, and Ctrl/⌘+Z runs the latest one still
 * on screen (FR-UI-029).
 */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const next = useRef(0)
  const lastUndo = useRef<{ id: number; run: () => void } | null>(null)
  const dismiss = useCallback((id: number) => {
    if (lastUndo.current?.id === id) lastUndo.current = null
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])
  const push = useCallback(
    (message: string, tone: Toast['tone'] = 'info', action?: ToastAction, extra?: ToastAction) => {
      const id = ++next.current
      if (action?.label === 'Undo') lastUndo.current = { id, run: action.run }
      setToasts((t) => [...t.slice(-2), { id, message, tone, action, extra }])
      setTimeout(() => dismiss(id), action ? UNDO_MS : TOAST_MS)
    },
    [dismiss],
  )
  /** Ctrl/⌘+Z: false when there's nothing left to undo. */
  const undo = useCallback(() => {
    const u = lastUndo.current
    if (!u) return false
    dismiss(u.id)
    u.run()
    return true
  }, [dismiss])
  return { toasts, push, dismiss, undo }
}

/** User-facing text for an API failure. Never shows email content; server messages never contain any (§6.4.1). */
export function errorText(err: unknown): string {
  if (!(err instanceof ApiError)) return 'Something went wrong. Check your connection and try again.'
  switch (err.code) {
    case 'upstream_error':
      return 'Jira is unavailable right now. The action is marked failed; retry it from the details.'
    case 'conflict':
      return 'That changed in the meantime. The details show its current state.'
    case 'action_invalid':
    case 'validation_failed':
      return 'Some fields need fixing before this can be sent.'
    case 'not_found':
      return 'This email is no longer available.'
    default:
      return err.message
  }
}
