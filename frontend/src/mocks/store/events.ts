// Server-side event bus of the mock: store mutations publish here, the Socket.io mock delivers to room user:{id}.
// `remote` marks an event another tab's store published (src/mocks/tabsync.ts): it is delivered to this tab's
// sockets but not sent back out.
type Listener = (userId: string, event: string, payload: unknown, remote: boolean) => void
const listeners = new Set<Listener>()

export function publish(userId: string, event: string, payload: unknown, { remote = false } = {}) {
  for (const l of listeners) l(userId, event, payload, remote)
}

export function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
