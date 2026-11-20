// Hash-chained audit log (FR-ADM-006, §6.6): hash = sha256(prev_hash || canonical JSON of the row).
// Details never contain email content, tokens or secrets: only ids, types and outcomes.
import { changed, db } from './db'
import type { AuditRow } from './types'

const GENESIS = '0'.repeat(64)

/** JSON with sorted keys, so the same row always hashes the same. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export type AuditEvent = 'login' | 'settings.update' | 'action.execute' | 'action.undo' | 'action.delete' | 'secret.reveal' | 'model.promote'

export async function audit(actorUserId: string | null, event: AuditEvent, target: string | null, details: Record<string, unknown> = {}) {
  const prev = db.audit[db.audit.length - 1]
  const row: Omit<AuditRow, 'hash'> = {
    id: (prev?.id ?? 0) + 1,
    created_at: new Date().toISOString(),
    actor_user_id: actorUserId,
    event,
    target,
    details,
    prev_hash: prev?.hash ?? GENESIS,
  }
  const entry: AuditRow = { ...row, hash: await sha256(row.prev_hash + canonical(row)) }
  db.audit.push(entry)
  changed()
  return entry
}

/** Recomputes the chain; true when no row was altered, removed or reordered. */
export async function verifyChain(rows: AuditRow[]) {
  let prev = GENESIS
  for (const { hash, ...row } of rows) {
    if (row.prev_hash !== prev || hash !== (await sha256(row.prev_hash + canonical(row)))) return false
    prev = hash
  }
  return true
}
