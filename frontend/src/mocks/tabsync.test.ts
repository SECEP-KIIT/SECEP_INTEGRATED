// Two tabs in one process: each has its own store and its own "sockets", joined by real BroadcastChannels (Node
// has them). Tab A is the real mock (store, pipeline, event bus); tab B is a second store fed only by the channel.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { control } from './control'
import { deliver } from './pipeline'
import { createDb } from './store/generate'
import { adoptDb, db, initStore, onChanged } from './store/db'
import { publish, subscribe } from './store/events'
import type { Db } from './store/types'
import { createTabSync, type Channel } from './tabsync'

const settle = () => new Promise((r) => setTimeout(r, 30))
let name = ''
let cleanups: (() => void)[] = []
afterEach(() => {
  for (const c of cleanups) c()
  cleanups = []
})
beforeEach(() => {
  name = `secep.test.${crypto.randomUUID()}`
  initStore({ persistEnabled: false })
  control.latency = [0, 0]
  control.speed = 1000
})

/** A tab: its own store and a log of what reached its sockets, in order. */
function tab(store: { db: Db }) {
  const log: string[] = []
  const channel = new BroadcastChannel(name) as unknown as Channel
  const sync = createTabSync(channel, {
    getDb: () => store.db,
    adoptDb: (next) => {
      store.db = next
      log.push(`store:${next.emails.size}`)
    },
    deliver: (_user, event, payload) => log.push(`${event}:${(payload as { email_id?: string }).email_id ?? ''}`),
    applyControl: (patch) => log.push(`control:${JSON.stringify(patch)}`),
    onReset: () => log.push('reset'),
  })
  cleanups.push(sync.close)
  return { store, log, sync }
}

/** Tab A wired to the real mock singletons, exactly as browser.ts does it. */
function realTab() {
  const log: string[] = []
  const sync = createTabSync(new BroadcastChannel(name) as unknown as Channel, {
    getDb: () => db,
    adoptDb,
    deliver: (userId, event, payload) => publish(userId, event, payload, { remote: true }),
    applyControl: () => {},
    onReset: () => {},
  })
  const offChanged = onChanged(sync.changed)
  const offEvents = subscribe((userId, event, payload, remote) => {
    if (remote) log.push(`remote ${event}`)
    else sync.published(userId, event, payload)
  })
  cleanups.push(sync.close, () => void offChanged(), () => void offEvents())
  return { log, sync }
}

describe('cross-tab mock (QA pass 3, commit 1)', () => {
  it('mail delivered in tab A reaches tab B as live events, each after the store that holds the email', async () => {
    realTab()
    const b = tab({ db: createDb(Date.now()) })
    const before = b.store.db.emails.size
    await deliver(db.users[0].id, 1) // template 1 has no links: triaged, then enriched
    await settle()

    const id = [...db.emails.values()].at(-1)!.id
    expect(b.store.db.emails.has(id)).toBe(true)
    expect(b.store.db.emails.size).toBe(before + 1)
    const triaged = b.log.indexOf(`email.triaged:${id}`)
    const enriched = b.log.indexOf(`email.enriched:${id}`)
    expect(triaged).toBeGreaterThan(0)
    expect(b.log[triaged - 1]).toMatch(/^store:/)
    expect(enriched).toBeGreaterThan(triaged)
    // B now answers REST from the enriched email, like A.
    expect(b.store.db.emails.get(id)?.status).toBe(db.emails.get(id)?.status)
  })

  it('an event delivered to B is not sent back to A (no echo)', async () => {
    const a = realTab()
    const b = tab({ db: createDb(Date.now()) })
    await deliver(db.users[0].id, 1)
    await settle()
    expect(b.log.some((l) => l.startsWith('email.triaged'))).toBe(true)
    expect(a.log).toEqual([])
  })

  it('a change in B (no event) still updates A, so a reload or a REST call in A agrees', async () => {
    realTab()
    const b = tab({ db: structuredClone(db) })
    const email = [...b.store.db.emails.values()][0]
    b.store.db.reads.set(email.user_id, new Set([email.id]))
    b.sync.changed()
    b.sync.changed() // coalesced into one message
    await settle()
    expect(db.reads.get(email.user_id)?.has(email.id)).toBe(true)
  })

  it('a new tab joins with the current store; the first tab joins nobody', async () => {
    const first = tab({ db: createDb(Date.now()) })
    expect(await first.sync.join(50)).toBe(false)
    first.store.db.arrivals.push({ template: 0, received_at: new Date().toISOString(), user_id: first.store.db.users[0].id })
    const second = tab({ db: createDb(Date.now()) })
    expect(await second.sync.join(500)).toBe(true)
    expect(second.store.db.arrivals).toHaveLength(1)
  })

  it('dev-panel knobs and a reset reach the other tabs', async () => {
    const a = tab({ db: createDb(Date.now()) })
    const b = tab({ db: createDb(Date.now()) })
    a.sync.control({ paused: true })
    a.sync.reset()
    await settle()
    expect(b.log).toEqual(['control:{"paused":true}', 'reset'])
    expect(a.log).toEqual([])
  })
})
