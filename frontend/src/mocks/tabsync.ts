// Keeps every open tab's mock in step, the way one real server serves every tab (dev only, like all of src/mocks).
//
// MSW runs inside each page, so each tab has its own copy of the mock store. Over a BroadcastChannel:
// - after a change, the tab that made it sends its whole store (a structured clone; Maps and Sets survive), and the
//   other tabs adopt it, so REST answers agree everywhere;
// - every socket event it published follows, and the other tabs deliver it to their own sockets as if the server
//   had sent it. The store always goes before the event, so a tab that reacts to an event (opens the email, say)
//   already has the email.
// - a new tab asks for the current store before it serves its first request (`join`);
// - dev-panel knobs (pause, speed…) and a reset reach every tab.
// Last writer wins. Two tabs changing the store in the same instant can lose one change; for a dev mock driven by
// one person that is acceptable. Background arrivals come from one tab only (browser.ts), which avoids most of it.
import type { Db } from './store/types'

export type TabMessage =
  | { kind: 'hello'; from: string }
  | { kind: 'state'; db: Db; to?: string }
  | { kind: 'event'; userId: string; event: string; payload: unknown }
  | { kind: 'control'; patch: Record<string, unknown> }
  | { kind: 'reset' }

/** The part of BroadcastChannel this uses, so tests can pass a real channel or a fake. */
export interface Channel {
  postMessage(message: TabMessage): void
  addEventListener(type: 'message', listener: (event: MessageEvent<TabMessage>) => void): void
  close(): void
}

export interface TabSyncDeps {
  /** This tab's store, to send. */
  getDb: () => Db
  /** Another tab's store, to take over. */
  adoptDb: (db: Db) => void
  /** Deliver another tab's event to this tab's sockets only. */
  deliver: (userId: string, event: string, payload: unknown) => void
  /** Apply another tab's dev-panel knobs here, without sending them back. */
  applyControl: (patch: Record<string, unknown>) => void
  /** Another tab reset the store: drop this one too (and reload). */
  onReset: () => void
}

export function createTabSync(channel: Channel, deps: TabSyncDeps) {
  const me = crypto.randomUUID()
  let dirty = false
  let joined: ((adopted: boolean) => void) | null = null

  const sendState = () => {
    dirty = false
    channel.postMessage({ kind: 'state', db: deps.getDb() })
  }

  channel.addEventListener('message', ({ data: m }) => {
    switch (m.kind) {
      case 'hello':
        channel.postMessage({ kind: 'state', db: deps.getDb(), to: m.from })
        break
      case 'state':
        if (m.to !== undefined && m.to !== me) break
        if (m.to === me) {
          // The first answer to our hello wins; the other tabs hold the same store.
          if (!joined) break
          joined(true)
          joined = null
        }
        deps.adoptDb(m.db)
        break
      case 'event':
        deps.deliver(m.userId, m.event, m.payload)
        break
      case 'control':
        deps.applyControl(m.patch)
        break
      case 'reset':
        deps.onReset()
        break
    }
  })

  return {
    /** Asks the open tabs for their store; resolves true once adopted, false after `timeoutMs` (the first tab). */
    join(timeoutMs = 200): Promise<boolean> {
      return new Promise((resolve) => {
        joined = resolve
        setTimeout(() => {
          if (joined === resolve) {
            joined = null
            resolve(false)
          }
        }, timeoutMs)
        channel.postMessage({ kind: 'hello', from: me })
      })
    },
    /** This tab changed the store. Several changes in one task go out as one message. */
    changed() {
      if (dirty) return
      dirty = true
      queueMicrotask(() => {
        if (dirty) sendState()
      })
    },
    /** This tab published a socket event: the store first (it may hold what the event refers to), then the event. */
    published(userId: string, event: string, payload: unknown) {
      sendState()
      channel.postMessage({ kind: 'event', userId, event, payload })
    },
    control(patch: Record<string, unknown>) {
      channel.postMessage({ kind: 'control', patch })
    },
    reset() {
      channel.postMessage({ kind: 'reset' })
    },
    close: () => channel.close(),
  }
}
