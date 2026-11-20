// Notes (FR-CNT-003, proposals §19.2): on an email, card or project, or standalone; stored as typed (no masking).
// Note bodies are never logged.
import { Router } from 'express';
import { Fail, UUID, idParam, isStr, object, own, pageParams, route, searchParams, toPage } from '../http.js';
import { query } from '../services/db.js';
import { listItem } from '../services/emails.js';
import { publish } from '../services/events.js';

export const notes = Router();

const TARGETS = ['email', 'card', 'project'];
const MAX = 20_000;

const toNote = (n) => ({
  id: n.id,
  target_type: n.target_type,
  target_id: n.target_id,
  body: n.body,
  created_at: n.created_at.toISOString(),
  updated_at: n.updated_at.toISOString(),
});

/** The target must be the user's own: 404 otherwise. */
async function checkTarget(user, type, id) {
  if (!UUID.test(id)) throw new Fail(404, 'not_found', 'Target not found');
  const sql = {
    email: 'SELECT e.id FROM emails e JOIN mailboxes m ON m.id = e.mailbox_id WHERE e.id = $1 AND m.user_id = $2',
    card: 'SELECT id FROM actions WHERE id = $1 AND user_id = $2 AND email_id IS NULL',
    project: 'SELECT id FROM projects WHERE id = $1 AND owner_user_id = $2',
  }[type];
  own((await query(sql, [id, user.id])).rows[0], type === 'card' ? 'Card' : type === 'email' ? 'Email' : 'Project');
}

async function emitEmail(user, n) {
  if (n.target_type === 'email') publish(user.id, 'email.triaged', { email_id: n.target_id, email: await listItem(user.id, n.target_id) });
}

route(notes, 'get', '/notes', 'user', async (req, user) => {
  const params = searchParams(req);
  const p = pageParams(params);
  const type = params.get('target_type');
  const id = params.get('target_id');
  if (type && type !== 'none' && !TARGETS.includes(type)) throw new Fail(400, 'bad_request', 'Unknown target_type');
  if (type && type !== 'none' && !id) throw new Fail(400, 'bad_request', 'target_id is required with target_type');
  if (type && type !== 'none') await checkTarget(user, type, id);
  const { rows } = await query(
    `SELECT * FROM notes WHERE owner_user_id = $1
        AND ($2::text IS NULL OR ($2 = 'none' AND target_type IS NULL) OR (target_type = $2 AND target_id = $3::uuid))
      ORDER BY updated_at DESC LIMIT $4 OFFSET $5`,
    [user.id, type, type && type !== 'none' ? id : null, p.limit + 1, p.offset],
  );
  return toPage(rows.map(toNote), p);
});

route(notes, 'post', '/notes', 'user', async (req, user) => {
  const f = object(req.body).only(['target_type', 'target_id', 'body']);
  const type = f.body.target_type ?? null;
  const id = f.body.target_id ?? null;
  if (type !== null && !TARGETS.includes(type)) f.add('target_type', 'Must be email, card, project or null');
  if ((type === null) !== (id === null)) f.add('target_id', 'Give both target_type and target_id, or neither');
  if (!isStr(f.body.body, MAX)) f.add('body', `Text, at most ${MAX} characters`);
  f.done();
  if (type) await checkTarget(user, type, id);
  const row = (await query('INSERT INTO notes (tenant_id, owner_user_id, target_type, target_id, body) VALUES ($1, $2, $3, $4, $5) RETURNING *', [user.tenant_id, user.id, type, id, f.body.body])).rows[0];
  await emitEmail(user, row);
  return toNote(row);
}, { status: 201 });

route(notes, 'patch', '/notes/:id', 'user', async (req, user) => {
  const id = idParam(req, 'Note');
  const f = object(req.body).only(['body']);
  if (!isStr(f.body.body, MAX)) f.add('body', `Text, at most ${MAX} characters`);
  f.done();
  const row = own((await query('UPDATE notes SET body = $3, updated_at = now() WHERE id = $1 AND owner_user_id = $2 RETURNING *', [id, user.id, f.body.body])).rows[0], 'Note');
  return toNote(row);
});

route(notes, 'delete', '/notes/:id', 'user', async (req, user) => {
  const id = idParam(req, 'Note');
  const { rows: [n] } = await query('DELETE FROM notes WHERE id = $1 AND owner_user_id = $2 RETURNING *', [id, user.id]);
  own(n, 'Note');
  await emitEmail(user, n);
});
