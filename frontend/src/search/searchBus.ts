// Search ↔ the rest of the app. The palette shows a picked email alone in the Inbox (with a "search: …" pill), and
// the pill can reopen the palette with the same words.
import type { EmailListItem } from '../api/types'
import { goTo } from '../lib/navigate'
import { openEmail } from '../lib/openEmail'

const OPEN = 'secep:open-search'

/** /inbox?found=<id>&sq=<words>: the Inbox shows only this email; its drawer opens (with the thread). */
export function searchResultPath(id: string, q: string) {
  const p = new URLSearchParams({ found: id })
  if (q) p.set('sq', q)
  return `/inbox?${p}`
}

export function showSearchResult(email: Pick<EmailListItem, 'id'>, q: string) {
  const onInbox = location.pathname === '/inbox'
  openEmail(email.id, onInbox)
  goTo(searchResultPath(email.id, q))
}

export function openSearch(q = '') {
  dispatchEvent(new CustomEvent<string>(OPEN, { detail: q }))
}

export function onOpenSearch(fn: (q: string) => void) {
  const h = (e: Event) => fn((e as CustomEvent<string>).detail)
  addEventListener(OPEN, h)
  return () => removeEventListener(OPEN, h)
}
