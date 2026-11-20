// Open an email's drawer from outside the inbox tree (the notification bell). The page's InboxHost listens; if the
// host isn't mounted yet (we're about to navigate to the Inbox), the request waits for it.
const EVENT = 'secep:open-email'
let pending: string | null = null

export function openEmail(id: string, hostMounted: boolean) {
  pending = id
  if (hostMounted) dispatchEvent(new CustomEvent<string>(EVENT, { detail: id }))
}

export function onOpenEmail(fn: (id: string) => void) {
  if (pending) {
    const id = pending
    pending = null
    queueMicrotask(() => fn(id))
  }
  const handler = (e: Event) => {
    pending = null
    fn((e as CustomEvent<string>).detail)
  }
  addEventListener(EVENT, handler)
  return () => removeEventListener(EVENT, handler)
}
