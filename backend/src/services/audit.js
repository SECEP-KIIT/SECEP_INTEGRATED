// Hash-chained audit log (FR-ADM-006, NFR-SEC-006): hash = sha256(prev_hash || canonical JSON of the row).
// Details never contain a secret value, body, summary or note text: only ids, types and outcomes.
import { createHash } from 'node:crypto';

const GENESIS = '0'.repeat(64);

export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Appends one entry. `db` is the pool or a transaction client; the chain is serialised per tenant by a lock. */
export async function audit(db, { tenantId, actorId, event, target = null, details = {} }) {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`audit:${tenantId}`]);
  const prev = (await db.query('SELECT hash FROM audit_log WHERE tenant_id = $1 ORDER BY id DESC LIMIT 1', [tenantId])).rows[0];
  const created_at = new Date().toISOString();
  const prev_hash = prev?.hash ?? GENESIS;
  const row = { tenant_id: tenantId, actor_user_id: actorId, event, target, details, prev_hash, created_at };
  const hash = createHash('sha256').update(prev_hash + canonical(row)).digest('hex');
  await db.query(
    `INSERT INTO audit_log (tenant_id, actor_user_id, event, target, details, prev_hash, hash, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [tenantId, actorId, event, target, details, prev_hash, hash, created_at],
  );
}
