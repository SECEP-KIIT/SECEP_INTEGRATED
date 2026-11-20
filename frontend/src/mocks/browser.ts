import { setupWorker } from 'msw/browser'
import { onControl, setControl } from './control'
import { handlers } from './handlers'
import { startArrivals } from './pipeline'
import { startReminders } from './reminders'
import { adoptDb, db, initStore, onChanged, resetStore } from './store/db'
import { publish, subscribe } from './store/events'
import { createTabSync } from './tabsync'

// Dev only (main.tsx imports this behind DEV && VITE_MOCK). The store persists across reloads unless
// VITE_MOCK_PERSIST=0: a reload that silently reseeds made QA checks misleading.
initStore({ persistEnabled: import.meta.env.VITE_MOCK_PERSIST !== '0' })

// Every tab in step (src/mocks/tabsync.ts): another tab's changes arrive here as live events.
export const tabs = createTabSync(new BroadcastChannel('secep.mock'), {
  getDb: () => db,
  adoptDb,
  deliver: (userId, event, payload) => publish(userId, event, payload, { remote: true }),
  applyControl: (patch) => setControl(patch, { remote: true }),
  onReset: () => {
    resetStore()
    location.reload()
  },
})
onChanged(tabs.changed)
subscribe((userId, event, payload, remote) => {
  if (!remote) tabs.published(userId, event, payload)
})
onControl(tabs.control)
await tabs.join()

// Background mail comes from one tab at a time (the holder of this lock), as one real mailbox would; when that tab
// closes, another takes over. Without Web Locks, every tab sends.
if ('locks' in navigator) {
  void navigator.locks.request('secep.mock.arrivals', () => {
    startArrivals()
    startReminders()
    return new Promise<never>(() => {})
  })
} else {
  startArrivals()
  startReminders()
}

export const worker = setupWorker(...handlers)
