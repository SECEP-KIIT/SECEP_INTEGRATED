// Projects (FR-UI-016–017, §6.5 v1.1 "/projects"). Wire shapes PROPOSED in proposals §4 and §18: a user-owned
// container of emails and cards; archiving replaces deletion. An email or card may be in several projects; the first
// one it gets is primary (FR-UI-017), and when the primary leaves, the oldest remaining one takes over.
import { Router } from 'express';
import { Fail, UUID, idParam, isDateTime, isOptStr, isStr, object, own, pageParams, route, searchParams, toPage } from '../http.js';
import { query, tx } from '../services/db.js';
import { CARD_PROJECTS, listItem, toAction } from '../services/emails.js';
import { publish } from '../services/events.js';

export const projects = Router();

const HEX = /^#[0-9a-fA-F]{6}$/;
const JIRA_KEY = /^[A-Z][A-Z0-9]{1,9}$/;
const JIRA_ISSUE = /^[A-Z][A-Z0-9]{1,9}-\d+$/;
const FIELDS = ['name', 'colour', 'icon', 'description', 'deadline', 'jira_project_key', 'jira_epic'];
/** A user's projects, archived included (they stay searchable, FR-UI-016). */
const MAX_PROJECTS = 100;

/** Projects with derived progress: done / total of the board cards from the project's emails or filed in it. */
const PROJECT_SELECT = `
  SELECT pr.*, coalesce(pg.done, 0)::int AS done, coalesce(pg.total, 0)::int AS total
    FROM projects pr
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE a.board_column = 'done') AS done, count(*) AS total FROM actions a
       WHERE a.user_id = pr.owner_user_id AND a.board_column IS NOT NULL
         AND (a.email_id IN (SELECT email_id FROM email_projects WHERE project_id = pr.id)
              OR a.id IN (SELECT action_id FROM card_projects WHERE project_id = pr.id))) pg ON true`;

const toProject = (r) => ({
  id: r.id, name: r.name, colour: r.colour, icon: r.icon, description: r.description,
  deadline: r.deadline?.toISOString() ?? null, jira_project_key: r.jira_project_key, jira_epic: r.jira_epic,
  archived_at: r.archived_at?.toISOString() ?? null, created_at: r.created_at.toISOString(),
  progress: { done: r.done, total: r.total },
});

async function load(userId, id) {
  return (await query(`${PROJECT_SELECT} WHERE pr.id = $1 AND pr.owner_user_id = $2`, [id, userId])).rows[0];
}

function checkFields(f, partial) {
  const b = f.body;
  if (!partial || 'name' in b) if (!isStr(b.name, 60) || !b.name.trim()) f.add('name', 'Required, at most 60 characters');
  if (!partial || 'colour' in b) if (typeof b.colour !== 'string' || !HEX.test(b.colour)) f.add('colour', 'Must be #rrggbb');
  if ('icon' in b && !(b.icon === null || (isStr(b.icon, 16) && [...b.icon].length <= 4))) f.add('icon', 'One emoji, or null');
  if ('description' in b && !isOptStr(b.description, 500)) f.add('description', 'At most 500 characters');
  if ('deadline' in b && b.deadline !== null && !isDateTime(b.deadline)) f.add('deadline', 'Must be an ISO date-time, or null');
  if ('jira_project_key' in b && b.jira_project_key !== null && !(typeof b.jira_project_key === 'string' && JIRA_KEY.test(b.jira_project_key))) {
    f.add('jira_project_key', 'A Jira project key, like ATL');
  }
  if ('jira_epic' in b && b.jira_epic !== null && !(typeof b.jira_epic === 'string' && JIRA_ISSUE.test(b.jira_epic))) f.add('jira_epic', 'A Jira issue key, like ATL-100');
}

/** Tells every open tab that an email's or card's projects changed: cards patch in place. */
async function emitItem(userId, { email_id, action_id }) {
  if (email_id) publish(userId, 'email.triaged', { email_id, email: await listItem(userId, email_id) });
  if (action_id) {
    const a = (await query(`SELECT a.*, ${CARD_PROJECTS} FROM actions a WHERE a.id = $1`, [action_id])).rows[0];
    if (a) publish(userId, 'action.updated', { action: toAction(a) });
  }
}

// Active projects first, then archived; each oldest first (the sidebar order).
route(projects, 'get', '/projects', 'user', async (req, user) => {
  const p = pageParams(searchParams(req));
  const { rows } = await query(
    `${PROJECT_SELECT} WHERE pr.owner_user_id = $1 ORDER BY pr.archived_at NULLS FIRST, pr.created_at, pr.id LIMIT $2 OFFSET $3`,
    [user.id, p.limit + 1, p.offset],
  );
  return toPage(rows.map(toProject), p);
});

route(projects, 'post', '/projects', 'user', async (req, user) => {
  const f = object(req.body).only(FIELDS);
  checkFields(f, false);
  f.done();
  const b = f.body;
  const count = (await query('SELECT count(*)::int AS n FROM projects WHERE owner_user_id = $1', [user.id])).rows[0].n;
  if (count >= MAX_PROJECTS) throw new Fail(409, 'conflict', `At most ${MAX_PROJECTS} projects`);
  const { rows } = await query(
    `INSERT INTO projects (tenant_id, owner_user_id, name, colour, icon, description, deadline, jira_project_key, jira_epic)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [user.tenant_id, user.id, b.name.trim(), b.colour.toLowerCase(), b.icon ?? null, b.description ?? null, b.deadline ?? null, b.jira_project_key ?? null, b.jira_epic ?? null],
  );
  return toProject(await load(user.id, rows[0].id));
}, { status: 201 });

route(projects, 'get', '/projects/:id', 'user', async (req, user) => toProject(own(await load(user.id, idParam(req, 'Project')), 'Project')));

route(projects, 'patch', '/projects/:id', 'user', async (req, user) => {
  const id = idParam(req, 'Project');
  own(await load(user.id, id), 'Project');
  const f = object(req.body).only([...FIELDS, 'archived']);
  checkFields(f, true);
  if ('archived' in f.body && typeof f.body.archived !== 'boolean') f.add('archived', 'Must be true or false');
  f.done();
  const b = { ...f.body };
  if (typeof b.name === 'string') b.name = b.name.trim();
  if (typeof b.colour === 'string') b.colour = b.colour.toLowerCase();
  const args = [id];
  const arg = (v) => (args.push(v), `$${args.length}`);
  const sets = FIELDS.filter((k) => k in b).map((k) => `${k} = ${arg(b[k])}`);
  // Archiving keeps the first time; un-archiving clears it.
  if (b.archived === true) sets.push('archived_at = coalesce(archived_at, now())');
  if (b.archived === false) sets.push('archived_at = NULL');
  if (sets.length) await query(`UPDATE projects SET ${sets.join(', ')} WHERE id = $1`, args);
  return toProject(await load(user.id, id));
});

/**
 * POST /projects/:id/items {email_id | action_id, primary?} (PROPOSED proposals §18.2): adds an email or a card.
 * Adding one already there only applies `primary`. Response: the item.
 */
route(projects, 'post', '/projects/:id/items', 'user', async (req, user) => {
  const id = idParam(req, 'Project');
  const project = own(await load(user.id, id), 'Project');
  const f = object(req.body).only(['email_id', 'action_id', 'primary']);
  const { email_id, action_id, primary } = f.body;
  if ((email_id === undefined) === (action_id === undefined)) f.add('email_id', 'Exactly one of email_id and action_id');
  for (const [k, v] of [['email_id', email_id], ['action_id', action_id]]) if (v !== undefined && !(typeof v === 'string' && UUID.test(v))) f.add(k, 'Must be an id');
  if (primary !== undefined && typeof primary !== 'boolean') f.add('primary', 'Must be true or false');
  f.done();
  if (project.archived_at) throw new Fail(409, 'conflict', 'This project is archived');
  if (email_id) own(await listItem(user.id, email_id), 'Email');
  if (action_id) own((await query('SELECT id FROM actions WHERE id = $1 AND user_id = $2', [action_id, user.id])).rows[0], 'Card');

  const [table, col, itemId] = email_id ? ['email_projects', 'email_id', email_id] : ['card_projects', 'action_id', action_id];
  const row = await tx(async (c) => {
    // One item at a time, so two adds can't both become primary.
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [itemId]);
    const has = (await c.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${col} = $1`, [itemId])).rows[0].n;
    await c.query(
      `INSERT INTO ${table} (${col}, project_id, is_primary) VALUES ($1, $2, $3) ON CONFLICT (${col}, project_id) DO NOTHING`,
      [itemId, id, has === 0],
    );
    if (primary === true) {
      await c.query(`UPDATE ${table} SET is_primary = false WHERE ${col} = $1 AND project_id <> $2 AND is_primary`, [itemId, id]);
      await c.query(`UPDATE ${table} SET is_primary = true WHERE ${col} = $1 AND project_id = $2`, [itemId, id]);
    }
    return (await c.query(`SELECT * FROM ${table} WHERE ${col} = $1 AND project_id = $2`, [itemId, id])).rows[0];
  });
  await emitItem(user.id, { email_id, action_id });
  return {
    project_id: id, email_id: email_id ?? null, action_id: action_id ?? null,
    is_primary: row.is_primary, added_at: row.added_at.toISOString(),
  };
});

/** DELETE /projects/:id/items/:itemId: the email or action id. When the primary leaves, the oldest remaining one is. */
route(projects, 'delete', '/projects/:id/items/:itemId', 'user', async (req, user) => {
  const id = idParam(req, 'Project');
  own(await load(user.id, id), 'Project');
  const itemId = req.params.itemId;
  if (!UUID.test(itemId)) throw new Fail(404, 'not_found', 'Item not in this project');
  const removed = await tx(async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [itemId]);
    for (const [table, col] of [['email_projects', 'email_id'], ['card_projects', 'action_id']]) {
      const gone = (await c.query(`DELETE FROM ${table} WHERE ${col} = $1 AND project_id = $2 RETURNING is_primary`, [itemId, id])).rows[0];
      if (!gone) continue;
      if (gone.is_primary) {
        await c.query(
          `UPDATE ${table} SET is_primary = true WHERE ${col} = $1 AND project_id =
             (SELECT project_id FROM ${table} WHERE ${col} = $1 ORDER BY added_at, project_id LIMIT 1)`,
          [itemId],
        );
      }
      return col === 'email_id' ? { email_id: itemId } : { action_id: itemId };
    }
    return null;
  });
  if (!removed) throw new Fail(404, 'not_found', 'Item not in this project');
  await emitItem(user.id, removed);
});
