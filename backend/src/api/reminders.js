// Manual reminders (FR-REM-002, SRS §6.5 GET/POST /reminders, PATCH/DELETE /reminders/:id; shapes PROPOSED, proposals §21).
// "Remind me" on an email or card: one notification when `fire_at` passes. Titles are stored for the owner only and
// never logged; the notification title stays generic.
import { Router } from 'express';
import { Fail, UUID, idParam, isDateTime, isStr, object, own, pageParams, route, searchParams, toPage } from '../http.js';
import { query } from '../services/db.js';
import { publish } from '../services/events.js';

export const reminders = Router();

const TARGETS = ['email', 'card'];

const toReminder = (r) => ({
  id: r.id,
  kind: r.kind,
  target: r.target_type ? { type: r.target_type, id: r.target_id } : null,
  title: r.title,
  fire_at: r.fire_at.toISOString(),
  status: r.status,
  fired_at: r.fired_at?.toISOString() ?? null,
});

async function checkTarget(user, type, id) {
  if (!UUID.test(id)) throw new Fail(404, 'not_found', 'Target not found');
  const sql = {
    email: 'SELECT e.id FROM emails e JOIN mailboxes m ON m.id = e.mailbox_id WHERE e.id = $1 AND m.user_id = $2',
    card: 'SELECT id FROM actions WHERE id = $1 AND user_id = $2 AND email_id IS NULL',
  }[type];
  own((await query(sql, [id, user.id])).rows[0], type === 'card' ? 'Card' : 'Email');
}

route(reminders, 'get', '/reminders', 'user', async (req, user) => {
  const params = searchParams(req);
  const p = pageParams(params);
  const status = params.get('status');
  if (status && !['scheduled', 'fired', 'cancelled'].includes(status)) throw new Fail(400, 'bad_request', 'Unknown status');
  const { rows } = await query(
    `SELECT * FROM reminders WHERE user_id = $1 AND kind = 'manual' AND ($2::text IS NULL OR status = $2)
      ORDER BY fire_at LIMIT $3 OFFSET $4`,
    [user.id, status, p.limit + 1, p.offset],
  );
  return toPage(rows.map(toReminder), p);
});

route(reminders, 'post', '/reminders', 'user', async (req, user) => {
  const f = object(req.body).only(['target', 'title', 'fire_at']);
  const t = f.body.target ?? null;
  if (t !== null && !(t && typeof t === 'object' && TARGETS.includes(t.type) && typeof t.id === 'string')) f.add('target', 'Must be {type: email|card, id} or null');
  if (!isStr(f.body.title, 200) || !f.body.title.trim()) f.add('title', 'Text, 1–200 characters');
  if (!isDateTime(f.body.fire_at)) f.add('fire_at', 'Must be a date-time');
  else if (Date.parse(f.body.fire_at) <= Date.now()) f.add('fire_at', 'Must be in the future');
  f.done();
  if (t) await checkTarget(user, t.type, t.id);
  const { rows: [r] } = await query(
    `INSERT INTO reminders (tenant_id, user_id, kind, target_type, target_id, title, fire_at) VALUES ($1, $2, 'manual', $3, $4, $5, $6) RETURNING *`,
    [user.tenant_id, user.id, t?.type ?? null, t?.id ?? null, f.body.title.trim(), f.body.fire_at],
  );
  return toReminder(r);
}, { status: 201 });

route(reminders, 'patch', '/reminders/:id', 'user', async (req, user) => {
  const id = idParam(req, 'Reminder');
  const f = object(req.body).only(['fire_at', 'status']);
  if ('fire_at' in f.body && (!isDateTime(f.body.fire_at) || Date.parse(f.body.fire_at) <= Date.now())) f.add('fire_at', 'Must be a future date-time');
  if ('status' in f.body && f.body.status !== 'cancelled') f.add('status', 'Only "cancelled" can be set');
  f.done();
  const { rows: [r] } = await query(
    `UPDATE reminders SET fire_at = coalesce($3::timestamptz, fire_at), status = coalesce($4, status)
      WHERE id = $1 AND user_id = $2 AND kind = 'manual' AND status = 'scheduled' RETURNING *`,
    [id, user.id, f.body.fire_at ?? null, f.body.status ?? null],
  );
  return toReminder(own(r, 'Reminder'));
});

route(reminders, 'delete', '/reminders/:id', 'user', async (req, user) => {
  const id = idParam(req, 'Reminder');
  own((await query("DELETE FROM reminders WHERE id = $1 AND user_id = $2 AND kind = 'manual' RETURNING id", [id, user.id])).rows[0], 'Reminder');
});

/** FR-REM-003 (PostgreSQL half): fire what is due, once. The claim and the notification are one statement, so two
 *  API instances never both fire the same reminder. Redis indexing is M6's later step. Returns how many fired. */
export async function fireDueReminders() {
  const { rows } = await query(
    `WITH due AS (
       UPDATE reminders SET status = 'fired', fired_at = now()
        WHERE id IN (SELECT id FROM reminders WHERE status = 'scheduled' AND fire_at <= now() ORDER BY fire_at LIMIT 100 FOR UPDATE SKIP LOCKED)
        RETURNING user_id, target_type, target_id, title)
     INSERT INTO notifications (user_id, kind, payload)
     SELECT user_id, 'reminder',
            jsonb_build_object('title', 'Reminder due', 'body', title,
              'target', CASE WHEN target_type IS NULL THEN NULL ELSE jsonb_build_object('type', target_type, 'id', target_id) END)
       FROM due
     RETURNING id, user_id, kind, payload, read_at, created_at`,
  );
  for (const n of rows) {
    publish(n.user_id, 'notification.new', {
      notification: { id: n.id, kind: n.kind, title: n.payload.title, body: n.payload.body ?? null, target: n.payload.target ?? null, read_at: null, created_at: n.created_at.toISOString() },
    });
  }
  return rows.length;
}
