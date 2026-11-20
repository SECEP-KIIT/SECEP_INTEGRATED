// Opening quick-add and a card's sheet from anywhere (topbar +, n, paste, the board). Both are mounted once in the
// shell, as their own chunk, and listen for these events (the same pattern as the project dialog).

export interface QuickAddRequest {
  /** Prefilled line (a paste). */
  text?: string
  /** Files the card into this project (opened on a project's page). */
  projectId?: string
  /** Files pasted or dropped: attached once the card exists (12c). */
  files?: File[]
}

type Kind = 'quick-add' | 'card'
const EVENT = 'secep:cards'
const pending: Partial<Record<Kind, unknown>> = {}

function send(kind: Kind, detail: unknown) {
  pending[kind] = detail
  dispatchEvent(new CustomEvent(EVENT, { detail: { kind, detail } }))
}

function listen<T>(kind: Kind, fn: (d: T) => void) {
  if (pending[kind] !== undefined) fn(pending[kind] as T)
  const handler = (e: Event) => {
    const { kind: k, detail } = (e as CustomEvent<{ kind: Kind; detail: T }>).detail
    if (k === kind) fn(detail)
  }
  addEventListener(EVENT, handler)
  return () => removeEventListener(EVENT, handler)
}

export const openQuickAdd = (req: QuickAddRequest = {}) => send('quick-add', req)
export const onQuickAdd = (fn: (req: QuickAddRequest) => void) => listen('quick-add', fn)
export const openCard = (id: string) => send('card', id)
export const onOpenCard = (fn: (id: string) => void) => listen('card', fn)
/** The layer closed: nothing is pending any more. */
export const settled = (kind: Kind) => void delete pending[kind]
/** Whether anything has been asked for yet (the shell loads the chunk on the first request). */
export const onAnyCardRequest = (fn: () => void) => {
  if (Object.keys(pending).length) fn()
  const handler = () => fn()
  addEventListener(EVENT, handler)
  return () => removeEventListener(EVENT, handler)
}
