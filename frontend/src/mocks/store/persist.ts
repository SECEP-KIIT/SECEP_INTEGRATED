// Optional persistence of the mock store (VITE_MOCK_PERSIST=1). Only state a user created or changed is saved:
// users and their ui_prefs, read state, actions, label corrections and rules, projects, models, the audit log,
// settings, and which emails arrived. Everything regenerable (the seeded mailbox) is reseeded on load.
//
// Never persisted: secret values. That covers the fake masked credentials and the Jira/LLM tokens in settings
// (CLAUDE.md: nothing secret in localStorage).
//
// The blob carries a schema version. On any mismatch or parse problem it is discarded and the store reseeds, so a
// stale, incompatible store is never loaded.
import type { LayoutPage, Widget, WidgetSize } from '../../api/types'
import type { Db, SettingsRow } from './types'
import { backfillEmailCards } from './emailCardsCore'

export const STORAGE_KEY = 'secep.mock'
// 2: handled state; correction ids are UUIDs. 3: link samples, wall-clock action times. 4: layouts.
// 5: ordered widgets with size and hidden (proposals §16.3); version 4 layouts are converted, not discarded.
// 6: widgets gain `stacked` (F18, proposals §17); versions 4 and 5 are converted with stacked: false.
export const SCHEMA_VERSION = 6

type PersistedSettings = Omit<SettingsRow, 'jira' | 'llm'> & {
  jira: Omit<SettingsRow['jira'], 'token'> & { token_set: boolean }
  llm: Omit<SettingsRow['llm'], 'api_key'> & { api_key_set: boolean }
}

export interface Snapshot {
  schema: number
  seed: number
  data: {
    users: Db['users']
    reads: Record<string, string[]>
    handled: Record<string, [string, string][]>
    actions: ReturnType<Db['actions']['get']>[]
    corrections: Db['corrections']
    labelRules: Db['labelRules']
    projects: Db['projects']
    /** Added in QA pass 5; older snapshots have none. */
    projectItems?: Db['projectItems']
    /** Added in task 12; older snapshots have none. */
    notes?: Db['notes']
    /** Added in the task 13 polish; older snapshots have none. */
    reminders?: Db['reminders']
    models: Db['models']
    audit: Db['audit']
    settings: PersistedSettings
    arrivals: Db['arrivals']
    layouts: Record<string, NonNullable<ReturnType<Db['layouts']['get']>>>
  }
}

export function snapshot(db: Db, seed: number): Snapshot {
  const { jira, llm, ...rest } = db.settings
  const { token, ...jiraRest } = jira
  const { api_key, ...llmRest } = llm
  return {
    schema: SCHEMA_VERSION,
    seed,
    data: {
      users: db.users,
      reads: Object.fromEntries([...db.reads].map(([u, ids]) => [u, [...ids]])),
      handled: Object.fromEntries([...db.handled].map(([u, m]) => [u, [...m]])),
      actions: [...db.actions.values()],
      corrections: db.corrections,
      labelRules: db.labelRules,
      projects: db.projects,
      projectItems: db.projectItems,
      notes: db.notes,
      reminders: db.reminders,
      models: db.models,
      audit: db.audit,
      settings: { ...rest, jira: { ...jiraRest, token_set: token !== null }, llm: { ...llmRest, api_key_set: api_key !== null } },
      arrivals: db.arrivals,
      layouts: Object.fromEntries(db.layouts),
    },
  }
}

/** A widget as saved before proposals §16.3: free placement on a 12-column grid, or in 2 × 4 phone slots. */
export type PlacedWidget = Omit<Widget, 'size' | 'hidden' | 'stacked'> & { x: number; y: number; w: number; h: number }

/**
 * The §16.3 migration, as M6 would run it on user_layouts: widgets sorted by y, then x, with the size from the width.
 * Grid: up to 4 of 12 columns is small, up to 8 medium, else large. Phone slots: half width small, full × 1 medium,
 * full × 2 large. Nothing is hidden.
 */
export function fromPlaced(widgets: readonly PlacedWidget[], phone: boolean): Widget[] {
  const size = ({ w, h }: PlacedWidget): WidgetSize =>
    phone ? (w < 2 ? 'small' : h < 2 ? 'medium' : 'large') : w <= 4 ? 'small' : w <= 8 ? 'medium' : 'large'
  return [...widgets]
    .sort((a, b) => a.y - b.y || a.x - b.x)
    .map((w) => {
      const { x: _x, y: _y, w: _w, h: _h, ...rest } = w
      return { ...rest, size: size(w), hidden: false, stacked: false }
    })
}

type V4Layouts = Record<string, Partial<Record<string, { pages: (Omit<LayoutPage, 'widgets'> & { widgets: PlacedWidget[] })[]; updated_at: string }>>>

/** Version 4 → 5: every saved layout converted with fromPlaced. Everything else is unchanged. */
export function migrateV4(snap: Snapshot): Snapshot {
  const layouts = snap.data.layouts as unknown as V4Layouts
  const next: Snapshot['data']['layouts'] = {}
  for (const [user, byDevice] of Object.entries(layouts)) {
    next[user] = Object.fromEntries(
      Object.entries(byDevice).map(([dc, saved]) => [
        dc,
        saved && { ...saved, pages: saved.pages.map((p) => ({ ...p, widgets: fromPlaced(p.widgets, dc === 'phone') })) },
      ]),
    )
  }
  return { ...snap, schema: SCHEMA_VERSION, data: { ...snap.data, layouts: next } }
}

/** Version 5 → 6 (F18): every saved widget gets stacked: false, so existing layouts look exactly as before. */
export function migrateV5(snap: Snapshot): Snapshot {
  const next: Snapshot['data']['layouts'] = {}
  for (const [user, byDevice] of Object.entries(snap.data.layouts)) {
    next[user] = Object.fromEntries(
      Object.entries(byDevice).map(([dc, saved]) => [
        dc,
        saved && { ...saved, pages: saved.pages.map((p) => ({ ...p, widgets: p.widgets.map((w) => ({ ...w, stacked: false })) })) },
      ]),
    )
  }
  return { ...snap, schema: SCHEMA_VERSION, data: { ...snap.data, layouts: next } }
}

/** Returns the snapshot if it is usable for this schema and seed; otherwise discards it and returns null. */
export function load(storage: Pick<Storage, 'getItem' | 'removeItem'>, seed: number): Snapshot | null {
  let raw: string | null
  try {
    raw = storage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Snapshot
    const layoutsOk = typeof parsed?.data?.layouts === 'object'
    // migrateV4 already writes stacked: false, so a version 4 store goes straight to 6.
    const snap = parsed?.schema === 4 && layoutsOk ? migrateV4(parsed) : parsed?.schema === 5 && layoutsOk ? migrateV5(parsed) : parsed
    const d = snap?.data
    const ok =
      snap?.schema === SCHEMA_VERSION &&
      snap.seed === seed &&
      Array.isArray(d?.users) && Array.isArray(d.actions) && Array.isArray(d.arrivals) &&
      typeof d.reads === 'object' && typeof d.handled === 'object' && typeof d.layouts === 'object' && d.settings?.jira !== undefined
    if (ok) return snap
  } catch {
    // fall through to discard
  }
  console.info('[mock] discarding an incompatible persisted store and reseeding')
  storage.removeItem(STORAGE_KEY)
  return null
}

/** Applies a loaded snapshot on top of a freshly seeded store (arrivals must already be replayed). */
export function apply(db: Db, snap: Snapshot) {
  const d = snap.data
  db.users = d.users
  db.reads = new Map(Object.entries(d.reads).map(([u, ids]) => [u, new Set(ids)]))
  db.handled = new Map(Object.entries(d.handled).map(([u, pairs]) => [u, new Map(pairs.filter(([id]) => db.emails.has(id)))]))
  for (const a of d.actions) if (a && (a.email_id === null || db.emails.has(a.email_id))) db.actions.set(a.id, a)
  db.corrections = d.corrections.filter((c) => db.emails.has(c.email_id))
  for (const c of db.corrections) {
    const triage = db.emails.get(c.email_id)?.triage
    if (!triage) continue
    triage[c.field].label = c.new_label as never
    if (c.field === 'email_type') triage.email_type.source = 'user'
    triage.needs_review = false
  }
  db.layouts = new Map(Object.entries(d.layouts))
  db.labelRules = d.labelRules
  // Older snapshots kept a static progress on each project; it's derived now.
  db.projects = d.projects.map(({ progress: _p, ...p }: Db['projects'][number] & { progress?: unknown }) => p)
  if (d.projectItems) db.projectItems = d.projectItems.filter((i) => (i.email_id ? db.emails.has(i.email_id) : !!i.action_id && db.actions.has(i.action_id)))
  if (d.notes) db.notes = d.notes.filter((n) => n.target_type !== 'email' || db.emails.has(n.target_id!))
  db.reminders = d.reminders ?? []
  backfillEmailCards(db)
  db.models = d.models
  db.audit = d.audit
  // Secrets keep their seeded values; only the "is it set" state is restored.
  const { jira, llm, ...rest } = d.settings
  const { token_set, ...jiraRest } = jira
  const { api_key_set, ...llmRest } = llm
  db.settings = {
    ...rest,
    jira: { ...jiraRest, token: token_set ? db.settings.jira.token ?? 'mock-jira-token' : null },
    llm: { ...llmRest, api_key: api_key_set ? db.settings.llm.api_key ?? 'mock-llm-key' : null },
  }
}

export function save(storage: Pick<Storage, 'setItem'>, db: Db, seed: number) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(snapshot(db, seed)))
  } catch (err) {
    console.warn('[mock] could not persist the store', err)
  }
}
