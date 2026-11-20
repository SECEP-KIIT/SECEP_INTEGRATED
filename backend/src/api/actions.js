// Actions (§6.5, FR-ORC-001–007, FR-UI-029): proposals execute only after the owner accepts, only allow-listed
// types with valid payloads, one Jira issue per action (FR-ORC-005).
import { Router } from 'express';
import { Fail, Fields, UUID, csv, idParam, isDate, isDateTime, isEmail, isInt, isOptStr, isStr, object, own, pageParams, route, searchParams, toPage } from '../http.js';
import { removeStored } from './files.js';
import { audit } from '../services/audit.js';
import { query, tx } from '../services/db.js';
import { CARD_PROJECTS, listItem, toAction } from '../services/emails.js';
import { publish } from '../services/events.js';
import { JiraError, createIssue, deleteIssue } from '../services/jira.js';

export const actions = Router();

const TYPES = ['create_jira_issue', 'add_board_card', 'add_calendar_event'];
const COLUMNS = ['todo', 'in_progress', 'done'];
const PRIORITIES = ['Highest', 'High', 'Medium', 'Low'];
const PAYLOAD_KEYS = ['title', 'description', 'priority', 'due_date', 'start', 'end', 'attendees'];
/** FR-ORC-004: urgency → Jira priority. */
const PRIORITY_FOR = { Critical: 'Highest', High: 'High', Medium: 'Medium', Low: 'Low' };
/** FR-UI-029: "about 10 s" in the UI; a little more here for the round trip. */
const UNDO_WINDOW_S = 12;

/** enrich.v1 field rules for (partial) payload edits. */
function checkPayloadFields(f, p, prefix = 'payload.') {
  for (const k of Object.keys(p)) if (!PAYLOAD_KEYS.includes(k)) f.add(prefix + k, 'Unknown field');
  if ('title' in p && !isOptStr(p.title, 120)) f.add(`${prefix}title`, 'At most 120 characters');
  if ('description' in p && !isOptStr(p.description, 2000)) f.add(`${prefix}description`, 'At most 2000 characters');
  if ('priority' in p && p.priority !== null && !PRIORITIES.includes(p.priority)) f.add(`${prefix}priority`, 'Not a Jira priority');
  if ('due_date' in p && p.due_date !== null && !isDate(p.due_date)) f.add(`${prefix}due_date`, 'Must be YYYY-MM-DD');
  for (const k of ['start', 'end']) if (k in p && p[k] !== null && !isDateTime(p[k])) f.add(prefix + k, 'Must be an ISO date-time');
  if ('attendees' in p && p.attendees !== null && !(Array.isArray(p.attendees) && p.attendees.every(isEmail))) f.add(`${prefix}attendees`, 'Must be a list of email addresses');
}

/** §6.4 per-type rules, enforced before execution (FR-ORC-002). */
function checkTypeRules(type, p, f) {
  if (!p.title) f.add('payload.title', 'Required');
  if (type === 'create_jira_issue' && !p.priority) f.add('payload.priority', 'Required for a Jira issue');
  if (type === 'add_calendar_event') {
    if (!p.start) f.add('payload.start', 'Required for a calendar event');
    if (!p.end) f.add('payload.end', 'Required for a calendar event');
    if (!p.attendees?.length) f.add('payload.attendees', 'Required for a calendar event');
    if (p.start && p.end && p.end <= p.start) f.add('payload.end', 'Must be after start');
  }
}

const mine = async (db, userId, id) => (await db.query(`SELECT a.*, ${CARD_PROJECTS} FROM actions a WHERE a.id = $1 AND a.user_id = $2`, [id, userId])).rows[0];

const URGENCIES = ['Critical', 'High', 'Medium', 'Low'];
const SOURCES = ['in_person', 'call', 'chat'];
const CARD_KEYS = ['title', 'description', 'due_date', 'due_time', 'urgency', 'checklist', 'source', 'person'];
const isUserCard = (a) => a.origin === 'user' && a.email_id === null && a.type === 'add_board_card';

/** User-card payload rules (§6.4 FR-CNT-002, proposals §19.1), for a whole payload or a partial edit. */
function checkCardPayload(f, p, partial) {
  for (const k of Object.keys(p)) if (!CARD_KEYS.includes(k)) f.add(`payload.${k}`, 'Unknown field');
  if ((!partial || 'title' in p) && !(isStr(p.title, 120) && p.title.trim())) f.add('payload.title', 'Required, at most 120 characters');
  if ('description' in p && !isOptStr(p.description, 2000)) f.add('payload.description', 'At most 2000 characters');
  if ('due_date' in p && p.due_date !== null && !isDate(p.due_date)) f.add('payload.due_date', 'Must be YYYY-MM-DD');
  if ('due_time' in p && p.due_time !== null && !(typeof p.due_time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(p.due_time))) f.add('payload.due_time', 'Must be HH:MM');
  if ('urgency' in p && p.urgency !== null && !URGENCIES.includes(p.urgency)) f.add('payload.urgency', 'Not an urgency');
  const item = (i) => i && typeof i === 'object' && isStr(i.text, 200) && i.text.trim() && typeof i.done === 'boolean' && Object.keys(i).length === 2;
  if ('checklist' in p && !(Array.isArray(p.checklist) && p.checklist.length <= 50 && p.checklist.every(item))) f.add('payload.checklist', 'Up to 50 items of {text, done}');
  if ('source' in p && p.source !== null && !SOURCES.includes(p.source)) f.add('payload.source', 'Must be in_person, call or chat');
  if ('person' in p && !isOptStr(p.person, 120)) f.add('payload.person', 'At most 120 characters');
}

/** action.updated, and the card's counts (proposed actions, Jira key, due date) in place. */
async function emitUpdated(a) {
  publish(a.user_id, 'action.updated', { action: toAction(a) });
  if (a.email_id) publish(a.user_id, 'email.triaged', { email_id: a.email_id, email: await listItem(a.user_id, a.email_id) });
}

/** Reorders a board column with `a` at `position`, closing the gap in the column it left (FR-ORC-007). */
async function boardMove(c, a, column, position) {
  const cards = (await c.query(
    'SELECT id FROM actions WHERE user_id = $1 AND board_column = $2 AND id <> $3 ORDER BY board_position, created_at',
    [a.user_id, column, a.id],
  )).rows.map((r) => r.id);
  cards.splice(Math.min(position, cards.length), 0, a.id);
  await c.query(
    'UPDATE actions SET board_column = $2, board_position = x.pos - 1 FROM unnest($1::uuid[]) WITH ORDINALITY AS x(id, pos) WHERE actions.id = x.id',
    [cards, column],
  );
  if (a.board_column && a.board_column !== column) await renumber(c, a.user_id, a.board_column);
}

async function renumber(c, userId, column) {
  await c.query(
    `UPDATE actions SET board_position = x.pos - 1 FROM (
       SELECT id, row_number() OVER (ORDER BY board_position, created_at) AS pos FROM actions WHERE user_id = $1 AND board_column = $2) x
     WHERE actions.id = x.id`,
    [userId, column],
  );
}

route(actions, 'get', '/actions', 'user', async (req, user) => {
  const params = searchParams(req);
  const p = pageParams(params);
  const column = csv(params, 'column', COLUMNS);
  const status = params.get('status');
  // PROPOSED (proposals §18.3): a project's cards, from its emails or filed in it.
  const project = params.get('project') || null;
  if (project) {
    if (!UUID.test(project)) throw new Fail(404, 'not_found', 'Project not found');
    own((await query('SELECT id FROM projects WHERE id = $1 AND owner_user_id = $2', [project, user.id])).rows[0], 'Project');
  }
  const { rows } = await query(
    `SELECT a.*, ${CARD_PROJECTS} FROM actions a WHERE user_id = $1 AND ($2::text[] IS NULL OR board_column = ANY($2)) AND ($3::text IS NULL OR status = $3)
       AND ($6::uuid IS NULL OR a.email_id IN (SELECT email_id FROM email_projects WHERE project_id = $6)
            OR a.id IN (SELECT action_id FROM card_projects WHERE project_id = $6))
      ORDER BY board_position NULLS LAST, created_at DESC LIMIT $4 OFFSET $5`,
    [user.id, column, status || null, p.limit + 1, p.offset, project],
  );
  return toPage(rows.map(toAction), p);
});

route(actions, 'post', '/emails/:id/actions', 'user', async (req, user) => {
  const emailId = idParam(req, 'Email');
  const email = own(await listItem(user.id, emailId), 'Email');
  const f = object(req.body).only(['type', 'payload']);
  const type = f.body.type;
  if (!TYPES.includes(type)) f.add('type', 'Not an allowed action type');
  const raw = f.body.payload ?? {};
  if (typeof raw !== 'object' || Array.isArray(raw)) f.add('payload', 'Must be an object');
  else checkPayloadFields(f, raw);
  f.done();
  const payload = { title: null, description: null, priority: null, due_date: null, start: null, end: null, attendees: null, ...raw };
  if (type === 'create_jira_issue' && !payload.priority && email.triage) payload.priority = PRIORITY_FOR[email.triage.urgency.label];
  checkTypeRules(type, payload, f);
  f.done('action_invalid', 'Action payload fails the per-type rules');
  const { rows: [a] } = await query(
    `INSERT INTO actions (tenant_id, email_id, user_id, type, payload, origin) VALUES ($1,$2,$3,$4,$5,'user') RETURNING *`,
    [user.tenant_id, emailId, user.id, type, payload],
  );
  await emitUpdated(a);
  return toAction(a);
}, { status: 201 });

// User card (FR-CNT-002, proposals §19.1): no email, done, at the end of To do.
route(actions, 'post', '/actions', 'user', async (req, user) => {
  const f = object(req.body).only(['type', 'payload']);
  if (f.body.type !== 'add_board_card') f.add('type', 'Only add_board_card');
  const p = f.body.payload ?? {};
  if (typeof p !== 'object' || Array.isArray(p) || p === null) f.add('payload', 'Must be an object');
  else checkCardPayload(f, p, false);
  f.done();
  if (p.due_time && !p.due_date) f.add('payload.due_time', 'Needs a due date');
  f.done();
  const payload = {
    title: p.title.trim(), description: p.description ?? null, due_date: p.due_date ?? null, due_time: p.due_time ?? null,
    urgency: p.urgency ?? null, checklist: p.checklist ?? [], source: p.source ?? null, person: p.person ?? null,
  };
  const row = await tx(async (c) => {
    const a = (await c.query(
      `INSERT INTO actions (tenant_id, email_id, user_id, type, payload, origin, status) VALUES ($1, NULL, $2, 'add_board_card', $3, 'user', 'done') RETURNING *`,
      [user.tenant_id, user.id, payload],
    )).rows[0];
    await boardMove(c, a, 'todo', Number.MAX_SAFE_INTEGER); // as an accepted action lands (FR-ORC-007)
    return mine(c, user.id, a.id);
  });
  await emitUpdated(row);
  return toAction(row);
}, { status: 201 });

// PROPOSED (proposals §19.1): delete a user card; the client's Undo re-creates it.
route(actions, 'delete', '/actions/:id', 'user', async (req, user) => {
  const id = idParam(req, 'Action');
  const stored = await tx(async (c) => {
    const a = own(await mine(c, user.id, id), 'Action');
    if (!isUserCard(a)) throw new Fail(409, 'conflict', 'Only cards you made can be deleted');
    const keys = (await c.query("DELETE FROM files WHERE target_type = 'card' AND target_id = $1 RETURNING storage_key", [id])).rows.map((r) => r.storage_key);
    await c.query("DELETE FROM notes WHERE target_type = 'card' AND target_id = $1", [id]);
    await c.query('DELETE FROM actions WHERE id = $1', [id]);
    if (a.board_column) await renumber(c, user.id, a.board_column);
    await audit(c, { tenantId: user.tenant_id, actorId: user.id, event: 'action.delete', target: id, details: { type: a.type } });
    return keys;
  });
  await removeStored(stored);
});

/**
 * Runs an accepted action (FR-ORC-003/010). Jira 400/401: the action fails with Jira's message and the caller
 * gets it back (FR-ORC-006). Retries exhausted on 429/5xx: 502 upstream_error.
 */
async function execute(a, user, target = {}) {
  const { rows: [t] } = await query('SELECT settings FROM tenants WHERE id = $1', [user.tenant_id]);
  let ref = null;
  let extStatus = null;
  try {
    if (a.type === 'create_jira_issue') {
      ref = await createIssue(t.settings, a.payload, { assigneeEmail: user.email, projectKey: target.project_key ?? null, epic: target.epic ?? null });
      extStatus = 'To Do';
    } else if (a.type === 'add_calendar_event') {
      // Google Calendar events.insert comes with the Calendar feature (FR-CAL, S); simulated until then.
      ref = `evt_${crypto.randomUUID().slice(0, 8)}`;
    }
  } catch (err) {
    if (!(err instanceof JiraError)) throw err;
    const failed = await tx(async (c) => {
      const row = (await c.query(`UPDATE actions SET status = 'failed', error = $2, updated_at = now() WHERE id = $1 RETURNING *`, [a.id, `Jira ${err.status}: ${err.message}`])).rows[0];
      await audit(c, { tenantId: user.tenant_id, actorId: user.id, event: 'action.execute', target: a.id, details: { type: a.type, outcome: 'failed', status: err.status } });
      return row;
    });
    await emitUpdated(failed);
    if (err.retryable) throw new Fail(502, 'upstream_error', 'Jira is unavailable', { provider: 'jira', status: err.status, message: err.message });
    return failed;
  }
  const done = await tx(async (c) => {
    const row = (await c.query(
      `UPDATE actions SET status = 'done', error = NULL, external_ref = $2, external_status = $3,
              external_kind = $4, undo_until = now() + make_interval(secs => $5), updated_at = now()
        WHERE id = $1 RETURNING *`,
      [a.id, ref, extStatus, a.type === 'create_jira_issue' ? 'jira_issue' : a.type === 'add_calendar_event' ? 'calendar_event' : null, UNDO_WINDOW_S],
    )).rows[0];
    // FR-ORC-007: accepted cards and created issues land at the end of To do.
    await boardMove(c, row, 'todo', Number.MAX_SAFE_INTEGER);
    await audit(c, { tenantId: user.tenant_id, actorId: user.id, event: 'action.execute', target: a.id, details: { type: a.type, outcome: 'done', external_ref: ref } });
    return mine(c, user.id, a.id);
  });
  await emitUpdated(done);
  return done;
}

route(actions, 'post', '/actions/:id/accept', 'user', async (req, user) => {
  const id = idParam(req, 'Action');
  const f = object(req.body ?? {}).only(['payload', 'mode', 'jira']);
  const edits = f.body.payload ?? {};
  if (typeof edits !== 'object' || Array.isArray(edits)) f.add('payload', 'Must be an object');
  else checkPayloadFields(f, edits);
  // mode "comment" (FR-ORC-013, S) is accepted and treated as "issue" until commenting is built.
  if (f.body.mode !== undefined && !['issue', 'comment'].includes(f.body.mode)) f.add('mode', 'Must be issue or comment');
  // PROPOSED (proposals 25.2): where the issue goes. null means the default project and no epic.
  const jira = f.body.jira ?? {};
  if (typeof jira !== 'object' || jira === null || Array.isArray(jira)) f.add('jira', 'Must be an object');
  else {
    for (const k of Object.keys(jira)) if (!['project_key', 'epic'].includes(k)) f.add(`jira.${k}`, 'Unknown field');
    if ('project_key' in jira && !isOptStr(jira.project_key, 40)) f.add('jira.project_key', 'At most 40 characters');
    if ('epic' in jira && !isOptStr(jira.epic, 80)) f.add('jira.epic', 'At most 80 characters');
  }
  f.done();

  // Claim it in one statement, so a double click can never create two issues (FR-ORC-005).
  const claimed = await tx(async (c) => {
    const a = own(await mine(c, user.id, id), 'Action');
    if (a.status === 'done') return { done: a };
    if (a.status === 'executing') throw new Fail(409, 'conflict', 'Action is already executing');
    if (a.status === 'rejected') throw new Fail(409, 'conflict', 'Action was rejected');
    const payload = { ...a.payload, ...edits };
    if (a.type === 'create_jira_issue' && !payload.priority && a.email_id) {
      const urg = (await c.query('SELECT urgency FROM emails WHERE id = $1', [a.email_id])).rows[0]?.urgency;
      if (urg) payload.priority = PRIORITY_FOR[urg];
    }
    const rules = new Fields({});
    checkTypeRules(a.type, payload, rules);
    rules.done('action_invalid', 'Action payload fails the per-type rules');
    const row = (await c.query(
      `UPDATE actions SET status = 'executing', payload = $2, updated_at = now() WHERE id = $1 AND status IN ('proposed','failed') RETURNING *`,
      [id, payload],
    )).rows[0];
    if (!row) throw new Fail(409, 'conflict', 'Action changed in the meantime');
    return { run: row };
  });
  if (claimed.done) return toAction(claimed.done);
  try {
    return toAction(await execute(claimed.run, user, jira));
  } catch (err) {
    // Never leave it stuck in executing: an unexpected error marks it failed, so Retry works.
    if (!(err instanceof Fail)) await query(`UPDATE actions SET status = 'failed', error = 'Unexpected error', updated_at = now() WHERE id = $1 AND status = 'executing'`, [id]);
    throw err;
  }
});

route(actions, 'post', '/actions/:id/reject', 'user', async (req, user) => {
  const id = idParam(req, 'Action');
  const a = own(await mine({ query }, user.id, id), 'Action');
  if (!['proposed', 'failed'].includes(a.status)) throw new Fail(409, 'conflict', `Cannot reject a ${a.status} action`);
  const { rows: [row] } = await query(`UPDATE actions SET status = 'rejected', updated_at = now() WHERE id = $1 RETURNING *`, [id]);
  await emitUpdated(row);
  return toAction(row);
});

// FR-UI-029 / §6.5: within the window, delete the created issue or event, back to proposed and off the board.
route(actions, 'post', '/actions/:id/undo', 'user', async (req, user) => {
  const id = idParam(req, 'Action');
  const a = own(await mine({ query }, user.id, id), 'Action');
  if (a.status !== 'done' || !a.undo_until || a.undo_until < new Date()) throw new Fail(409, 'conflict', 'This action can no longer be undone');
  if (a.type === 'create_jira_issue' && a.external_ref) {
    const { rows: [t] } = await query('SELECT settings FROM tenants WHERE id = $1', [user.tenant_id]);
    try {
      await deleteIssue(t.settings, a.external_ref);
    } catch (err) {
      if (err instanceof JiraError) throw new Fail(502, 'upstream_error', "Couldn't delete the Jira issue", { provider: 'jira', status: err.status, message: err.message });
      throw err;
    }
  }
  const row = await tx(async (c) => {
    const r = (await c.query(
      `UPDATE actions SET status = 'proposed', external_ref = NULL, external_status = NULL, external_kind = NULL, undo_until = NULL,
              board_column = NULL, board_position = NULL, updated_at = now() WHERE id = $1 RETURNING *`,
      [id],
    )).rows[0];
    if (a.board_column) await renumber(c, user.id, a.board_column);
    await audit(c, { tenantId: user.tenant_id, actorId: user.id, event: 'action.undo', target: id, details: { type: a.type, external_ref: a.external_ref } });
    return r;
  });
  await emitUpdated(row);
  return toAction(row);
});

// Board moves (FR-ORC-007) and, for user cards, payload edits (v1.1, proposals §19.1).
route(actions, 'patch', '/actions/:id', 'user', async (req, user) => {
  const id = idParam(req, 'Action');
  const f = object(req.body).only(['board_column', 'board_position', 'payload']);
  const move = 'board_column' in f.body || 'board_position' in f.body;
  const edit = f.body.payload;
  if (!move && edit === undefined) f.add('payload', 'Nothing to change');
  if (move) {
    if (!COLUMNS.includes(f.body.board_column)) f.add('board_column', 'Must be todo, in_progress or done');
    if (!isInt(f.body.board_position, 0, 10_000)) f.add('board_position', 'Must be a non-negative integer');
  }
  if (edit !== undefined) {
    if (!edit || typeof edit !== 'object' || Array.isArray(edit)) f.add('payload', 'Must be an object');
    else checkCardPayload(f, edit, true);
  }
  f.done();
  const row = await tx(async (c) => {
    const a = own(await mine(c, user.id, id), 'Action');
    if (edit !== undefined) {
      if (!isUserCard(a)) throw new Fail(409, 'conflict', 'Only cards you made can be edited here');
      const next = { ...a.payload, ...edit };
      if (next.due_time && !next.due_date) f.add('payload.due_time', 'Needs a due date');
      f.done();
      next.title = next.title.trim();
      await c.query('UPDATE actions SET payload = $2 WHERE id = $1', [id, next]);
    }
    if (move) {
      if (a.status !== 'done') throw new Fail(409, 'conflict', 'Only cards on the board can move');
      await boardMove(c, a, f.body.board_column, f.body.board_position);
    }
    await c.query('UPDATE actions SET updated_at = now() WHERE id = $1', [id]);
    return mine(c, user.id, id);
  });
  await emitUpdated(row);
  return toAction(row);
});
