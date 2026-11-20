// Card keyboard shortcuts (FR-UI-028, item 8). Pure mapping, unit-tested; EmailCard runs the result.
import type { EmailListItem } from '../api/types'
import type { InboxApi } from './inboxContext'
import { matches, type KeyActionId } from '../lib/keybinds'

export type CardKey = 'next' | 'prev' | 'select' | 'done' | 'jira' | 'copy' | 'menu' | 'project' | 'remind' | null

interface KeyLike {
  key: string
  code?: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

/** The editable card keys (Settings → Keyboard, proposals §28.3), in the order they're tried. */
const CARD_KEYS: (KeyActionId & CardKey)[] = ['next', 'prev', 'select', 'done', 'project', 'remind', 'jira']

/**
 * By default j/k move, x selects, e handles, p files in a project, r reminds, ⇧J sends to Jira; all of those can be
 * rebound in Settings. Fixed: arrows move, Ctrl/⌘+C copies, Shift+F10 or the menu key opens the menu.
 */
export function cardKeyAction(e: KeyLike): CardKey {
  const mod = e.ctrlKey || e.metaKey
  if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'c') return 'copy'
  if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) return 'menu'
  if (!mod && !e.altKey && e.key === 'ArrowDown') return 'next'
  if (!mod && !e.altKey && e.key === 'ArrowUp') return 'prev'
  return CARD_KEYS.find((id) => matches(e, id)) ?? null
}

/** Ctrl/⌘+C on a card: subject and one-line summary. Both are already masked by the server (FR-SEC-006). */
export function copySummary(email: EmailListItem, toast: InboxApi['toast']) {
  const text = [email.subject || '(no subject)', email.summary_one_line].filter(Boolean).join(' — ')
  navigator.clipboard?.writeText(text).then(
    () => toast('Summary copied'),
    () => toast("Couldn't copy to the clipboard", 'error'),
  )
}
