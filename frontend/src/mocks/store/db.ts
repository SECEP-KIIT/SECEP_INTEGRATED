// The mock store singleton: seeded on start, optionally restored from localStorage, saved after changes.
import { SEED, addEmail, createDb, enrichEmail, scoreLinks, syncJiraSeq, withIdBlock } from './generate'
import { apply, load, save, STORAGE_KEY } from './persist'
import { rng } from './random'
import { TEMPLATES } from './templates'
import { bindStore } from './serialize'
import type { Db, EmailRow, UserRow } from './types'

export let db: Db = createDb(Date.now())
bindStore(() => db)

let persist = false
let saveTimer: ReturnType<typeof setTimeout> | undefined

const storage = () => (typeof localStorage === 'undefined' ? null : localStorage)

export const userById = (id: string): UserRow | undefined => db.users.find((u) => u.id === id)
export const emailsOf = (userId: string) => [...db.emails.values()].filter((e) => e.user_id === userId)
export const readsOf = (userId: string) => {
  let set = db.reads.get(userId)
  if (!set) db.reads.set(userId, (set = new Set()))
  return set
}

// ── Arrivals ────────────────────────────────────────────────────────────────────────────────────────────────────
// A live arrival and its replay after a reload run the SAME steps with the same id blocks and random streams,
// so ids match what persisted actions and read state refer to.

const arrivalRng = (index: number, step: number) => rng(SEED + 7919 * (index + 1) + step)

/** Step 1 (M2 + M3): the email lands with labels, no summary, links pending. Applies personal label rules. */
export function insertArrival(index: number, { replay = false } = {}): EmailRow {
  const a = db.arrivals[index]
  const user = userById(a.user_id)!
  const email = withIdBlock(index, 0, () =>
    addEmail(db, { template: TEMPLATES[a.template], user, receivedAt: Date.parse(a.received_at), r: arrivalRng(index, 0), arriving: true }),
  )
  applyLabelRules(email, { countHit: !replay })
  return email
}

/** Step 2 (M4): summaries and the proposed action. */
export function enrichArrival(index: number, email: EmailRow) {
  const a = db.arrivals[index]
  withIdBlock(index, 500, () => enrichEmail(db, email, TEMPLATES[a.template], userById(a.user_id)!, arrivalRng(index, 1)))
}

/** Step 3 (M5): link verdicts and the email's security flag. */
export function scoreArrival(index: number, email: EmailRow) {
  scoreLinks(db, email, TEMPLATES[db.arrivals[index].template])
}

/** FR-ML-013: personal rules apply after classification, for that user only, labelled source = "rule". */
function applyLabelRules(email: EmailRow, { countHit }: { countHit: boolean }) {
  if (!email.triage) return
  for (const rule of db.labelRules) {
    if (rule.user_id !== email.user_id || rule.sender !== email.from.address.toLowerCase()) continue
    const field = email.triage[rule.field]
    field.label = rule.label as never
    if (rule.field === 'email_type') email.triage.email_type.source = 'rule'
    if (countHit) rule.hit_count++
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────────────────────────────────────────────

export function initStore({ persistEnabled }: { persistEnabled: boolean }) {
  persist = persistEnabled
  db = createDb(Date.now())
  const store = storage()
  if (!persist || !store) return
  const snap = load(store, SEED)
  if (!snap) return
  try {
    // Rules first, so replayed arrivals get the same labels they had live.
    db.labelRules = snap.data.labelRules
    for (const a of snap.data.arrivals) {
      const index = db.arrivals.push(a) - 1
      const email = insertArrival(index, { replay: true })
      enrichArrival(index, email)
      scoreArrival(index, email)
    }
    apply(db, snap)
    syncJiraSeq(db)
  } catch (err) {
    console.info('[mock] persisted store did not apply cleanly; reseeding', err)
    store.removeItem(STORAGE_KEY)
    db = createDb(Date.now())
  }
}

const changeListeners = new Set<() => void>()

/** Runs after every change made in this tab (the cross-tab sync, src/mocks/tabsync.ts). */
export function onChanged(listener: () => void) {
  changeListeners.add(listener)
  return () => void changeListeners.delete(listener)
}

/** Call after any user-visible mutation; tells listeners, and saves (debounced) when persistence is on. */
export function changed() {
  for (const l of changeListeners) l()
  if (!persist) return
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const store = storage()
    if (store) save(store, db, SEED)
  }, 400)
}

/**
 * Takes over the store another tab sent (a structured clone of its whole Db). Not saved here: the sending tab saves
 * its own changes, and both tabs share one localStorage.
 */
export function adoptDb(next: Db) {
  db = next
  syncJiraSeq(db)
}

export function resetStore() {
  storage()?.removeItem(STORAGE_KEY)
  db = createDb(Date.now())
}
